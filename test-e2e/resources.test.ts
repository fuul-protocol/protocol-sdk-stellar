import { expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { Address, Asset, Contract, Keypair, Operation, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { checkSorobanResources, createFuulRpcServer, inspectSorobanResources, readSorobanResourceLimits, submitSignedTransaction } from "../dist/esm/index.js";
import { protocol, target, networkPassphrase, rpcUrl, allowHttp, fundTestAccount, guardNetwork } from "./network.js";

test("resource checks agree with Core rejection and permit signed normal and fee-bump calls", async () => {
  const rpc = createFuulRpcServer(rpcUrl, { allowHttp });
  await guardNetwork(rpc);
  const network = await rpc.getNetwork();
  expect(network.passphrase).toBe(networkPassphrase); expect(Number(network.protocolVersion)).toBe(Number(protocol));
  const source = Keypair.random(), payer = Keypair.random();
  const records: Record<string, unknown>[] = []; let passed = false;
  const evidence: Record<string, unknown> = { protocol: Number(protocol), networkPassphrase, rpcUrl, source: source.publicKey(), payer: payer.publicKey(), records };
  try {
    for (const key of [source, payer]) {
      await fundTestAccount(rpc, key.publicKey());
    }
    const token = new Contract(Asset.native().contractId(networkPassphrase));
    const send = async (name: string, signed: Parameters<typeof submitSignedTransaction>[1]) => {
      const report = await checkSorobanResources(rpc, signed);
      expect(report?.violations).toEqual([]);
      const result = await submitSignedTransaction(rpc, signed, { pollIntervalMs: 250 });
      expect(result.envelopeXdr.toXDR("base64")).toBe(signed.toXDR());
      records.push({ name, report, hash: signed.hash().toString("hex"), ledger: result.ledger,
        envelopeXdr: signed.toXDR(), resultXdr: result.resultXdr.toXDR("base64"), resultMetaXdr: result.resultMetaXdr.toXDR("base64") });
      return result;
    };
    if (!(await rpc.getLedgerEntries(token.getFootprint())).entries.length) {
      const deploy = await rpc.prepareTransaction(new TransactionBuilder(await rpc.getAccount(source.publicKey()), { networkPassphrase, fee: "100" })
        .addOperation(Operation.createStellarAssetContract({ asset: Asset.native() })).setTimeout(120).build());
      deploy.sign(source); await send("deploy native SAC", deploy);
    }
    const prepare = async () => rpc.prepareTransaction(new TransactionBuilder(await rpc.getAccount(source.publicKey()), { networkPassphrase, fee: "100" })
      .addOperation(token.call("balance", new Address(source.publicKey()).toScVal())).setTimeout(120).build());
    const valid = await prepare(), limits = await readSorobanResourceLimits({ getNetwork: rpc.getNetwork.bind(rpc), async getLedgerEntries(...keys) {
      const response = await rpc.getLedgerEntries(...keys);
      evidence.configuration = { ledger: response.latestLedger, entries: response.entries.map(entry => ({ keyXdr: entry.key.toXDR("base64"), valueXdr: entry.val.toXDR("base64") })) };
      return response;
    } }, networkPassphrase);
    evidence.limits = limits;
    const envelope = valid.toEnvelope();
    const over = limits.maximum.instructions + 1n;
    if (over > 0xffff_ffffn) throw new Error("Cannot construct a one-unit-over instruction declaration");
    envelope.v1().tx().ext().sorobanData().resources().instructions(Number(over));
    const invalid = new Transaction(envelope, networkPassphrase); invalid.sign(source);
    expect(inspectSorobanResources(invalid, limits)!.violations).toContainEqual({ resource: "instructions", actual: String(over), maximum: String(limits.maximum.instructions) });
    const sequence = (await rpc.getAccount(source.publicKey())).sequenceNumber();
    let broadcasts = 0;
    const guardedRpc = {
      getNetwork: rpc.getNetwork.bind(rpc), getLedgerEntries: rpc.getLedgerEntries.bind(rpc), getTransaction: rpc.getTransaction.bind(rpc),
      sendTransaction: async (...args: Parameters<typeof rpc.sendTransaction>) => { broadcasts++; return rpc.sendTransaction(...args); },
    };
    await expect(submitSignedTransaction(guardedRpc, invalid)).rejects.toMatchObject({ code: "RESOURCE_LIMIT", details: { resource: "instructions" } });
    expect(broadcasts).toBe(0);
    // Deliberately submit this invalid test envelope directly to Core as an independent oracle.
    const rejected = await rpc.sendTransaction(invalid);
    expect(rejected.status).toBe("ERROR");
    expect(rejected.errorResult?.result().switch().name).toBe("txSorobanInvalid");
    expect((await rpc.getAccount(source.publicKey())).sequenceNumber()).toBe(sequence);
    evidence.rejected = { hash: invalid.hash().toString("hex"), envelopeXdr: invalid.toXDR(), status: rejected.status,
      resultXdr: rejected.errorResult?.toXDR("base64"), diagnostics: rejected.diagnosticEvents?.map(event => event.toXDR("base64")), sdkBroadcasts: broadcasts, sequenceUnchanged: true };
    valid.sign(source); await send("native balance", valid);
    const inner = await prepare(); inner.sign(source);
    const outer = TransactionBuilder.buildFeeBumpTransaction(payer, "1000", inner, networkPassphrase); outer.sign(payer);
    const report = await checkSorobanResources(rpc, outer);
    expect(report!.usage.transactionBytes).toBe(BigInt(inner.toEnvelope().toXDR().length));
    expect(report!.usage.transactionBytes).toBeLessThan(BigInt(outer.toEnvelope().toXDR().length));
    await send("fee-bump native balance", outer);
    passed = true;
  } finally {
    const directory = new URL("../.local/", import.meta.url); await mkdir(directory, { recursive: true });
    const output = new URL(`resource-admission-${target}-${protocol}-${randomUUID()}.json`, directory);
    await writeFile(output, JSON.stringify({ ...evidence, passed }, (_, value) => typeof value === "bigint" ? String(value) : value, 2) + "\n", { flag: "wx" });
    console.info(JSON.stringify({ resourceEvidence: output.pathname, passed, receipts: records.length }));
  }
}, 180_000);
