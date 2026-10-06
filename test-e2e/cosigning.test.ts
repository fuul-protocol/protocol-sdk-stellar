import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { Address, Asset, Contract, FeeBumpTransaction, Keypair, Operation, Transaction, TransactionBuilder, nativeToScVal } from "@stellar/stellar-sdk";
import { Api } from "@stellar/stellar-sdk/rpc";
import { cosignPreparedTransaction, createFuulRpcServer, keypairSigner, submitSignedTransaction } from "../dist/esm/index.js";
import { protocol, networkPassphrase, rpcUrl, evidenceTag, allowHttp, fundTestAccount, guardNetwork } from "./network.js";

test("cosigns Soroban transfers and fee-bump envelopes with disabled account master keys", async () => {

  const rpc = createFuulRpcServer(rpcUrl, { allowHttp });
  await guardNetwork(rpc);
  const network = await rpc.getNetwork();
  expect(network.passphrase).toBe(networkPassphrase); expect(Number(network.protocolVersion)).toBe(Number(protocol));
  // All keys are disposable and remain in memory. Evidence contains public keys and signed envelopes only.
  const source = Keypair.random(), payer = Keypair.random(), recipient = Keypair.random();
  const sourceSigners = [Keypair.random(), Keypair.random()], payerSigners = [Keypair.random(), Keypair.random()];
  const records: Array<{ name: string; hash: string; ledger: number; envelopeXdr: string; resultXdr: string; resultMetaXdr: string }> = [];
  let rejected: Record<string, unknown> | undefined; let passed = false;
  const maximum = 1_000_000_000n;
  const asset = new Contract(Asset.native().contractId(networkPassphrase));
  const policy = {
    source: { account: source.publicKey(), signers: sourceSigners.map(key => key.publicKey()) },
    payer: { account: payer.publicKey(), signers: payerSigners.map(key => key.publicKey()) },
  };
  const cosign = async (tx: Transaction | FeeBumpTransaction, keys: Keypair[]) => {
    const review = { expectedSource: tx instanceof FeeBumpTransaction ? tx.feeSource : tx.source, expectedHash: tx.hash().toString("hex"), maxFeeStroops: maximum };
    let signed = tx;
    for (const key of keys) signed = await cosignPreparedTransaction(signed as Transaction, keypairSigner(key), review);
    return signed;
  };
  const send = async (name: string, signed: Transaction | FeeBumpTransaction) => {
    const receipt = await submitSignedTransaction(rpc, signed, { pollIntervalMs: 250 });
    expect(receipt.envelopeXdr.toXDR("base64")).toBe(signed.toXDR());
    records.push({ name, hash: signed.hash().toString("hex"), ledger: receipt.ledger, envelopeXdr: signed.toXDR(),
      resultXdr: receipt.resultXdr.toXDR("base64"), resultMetaXdr: receipt.resultMetaXdr.toXDR("base64") });
    return receipt;
  };
  const balance = async (account: string) => {
    const tx = new TransactionBuilder(await rpc.getAccount(source.publicKey()), { networkPassphrase, fee: "100" })
      .addOperation(asset.call("balance", new Address(account).toScVal())).setTimeout(60).build();
    const simulation = await rpc.simulateTransaction(tx);
    if (!Api.isSimulationSuccess(simulation) || !simulation.result) throw new Error("Native balance simulation failed");
    const parts = simulation.result.retval.i128();
    return (parts.hi().toBigInt() << 64n) + parts.lo().toBigInt();
  };
  const transfer = async () => rpc.prepareTransaction(new TransactionBuilder(await rpc.getAccount(source.publicKey()), { networkPassphrase, fee: "100" })
    .addOperation(asset.call("transfer", new Address(source.publicKey()).toScVal(), new Address(recipient.publicKey()).toScVal(), nativeToScVal(10_000n, { type: "i128" }))).setTimeout(120).build());
  try {
    for (const key of [source, payer, recipient]) {
      await fundTestAccount(rpc, key.publicKey());
    }
    if (!(await rpc.getLedgerEntries(asset.getFootprint())).entries.length) {
      const tx = await rpc.prepareTransaction(new TransactionBuilder(await rpc.getAccount(source.publicKey()), { networkPassphrase, fee: "100" })
        .addOperation(Operation.createStellarAssetContract({ asset: Asset.native() })).setTimeout(120).build());
      tx.sign(source); await send("create native asset", tx);
    }
    for (const [key, signers] of [[source, sourceSigners], [payer, payerSigners]] as const) {
      const tx = new TransactionBuilder(await rpc.getAccount(key.publicKey()), { networkPassphrase, fee: "100" });
      for (const signer of signers) tx.addOperation(Operation.setOptions({ signer: { ed25519PublicKey: signer.publicKey(), weight: 1 } }));
      tx.addOperation(Operation.setOptions({ masterWeight: 0, lowThreshold: 2, medThreshold: 2, highThreshold: 2 })).setTimeout(120);
      const signed = tx.build(); signed.sign(key); await send(key === source ? "configure source cosigners" : "configure payer cosigners", signed);
    }
    const beforeRecipient = await balance(recipient.publicKey());
    const unsigned = await transfer();
    const firstSignature = await cosign(unsigned, [sourceSigners[0]!]);
    const sequence = (await rpc.getAccount(source.publicKey())).sequenceNumber();
    const response = await rpc.sendTransaction(firstSignature);
    expect(response.status).toBe("ERROR"); expect(response.errorResult?.result().switch().name).toBe("txBadAuth");
    expect((await rpc.getAccount(source.publicKey())).sequenceNumber()).toBe(sequence);
    rejected = { hash: firstSignature.hash().toString("hex"), envelopeXdr: firstSignature.toXDR(), status: response.status,
      resultXdr: response.errorResult!.toXDR("base64"), sequenceUnchanged: sequence };
    await send("cosigned native transfer", await cosign(firstSignature, [sourceSigners[1]!]));
    expect(await balance(recipient.publicKey()) - beforeRecipient).toBe(10_000n);

    const beforeSource = await balance(source.publicKey()); const beforePayer = await balance(payer.publicKey());
    const signedInner = await cosign(await transfer(), sourceSigners);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(payer.publicKey(), "200", signedInner as Transaction, networkPassphrase);
    const signed = await cosign(feeBump, payerSigners);
    expect(signed).toBeInstanceOf(FeeBumpTransaction);
    expect((signed as FeeBumpTransaction).innerTransaction.toXDR()).toBe(signedInner.toXDR());
    const receipt = await send("cosigned fee-bump native transfer", signed);
    expect(beforeSource - await balance(source.publicKey())).toBe(10_000n);
    expect(beforePayer - await balance(payer.publicKey())).toBe(receipt.resultXdr.feeCharged().toBigInt());
    expect(await balance(recipient.publicKey()) - beforeRecipient).toBe(20_000n);
    passed = true;
  } finally {
    await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
    await writeFile(new URL(`../.local/cosigning-${evidenceTag}.json`, import.meta.url), JSON.stringify({
      schemaVersion: 1, passed, networkPassphrase, rpcUrl, protocol: Number(protocol), recordedAt: new Date().toISOString(),
      policy, recipient: recipient.publicKey(), rejected, records,
    }, null, 2) + "\n");
  }
}, 360_000);
