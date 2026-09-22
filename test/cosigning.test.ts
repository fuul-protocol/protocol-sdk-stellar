import { expect, spyOn, test } from "bun:test";
import { Account, Asset, FeeBumpTransaction, Keypair, Memo, Networks, Operation, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { cosignPreparedTransaction, keypairSigner, signPreparedTransaction, type CosignOptions, type FuulSigner } from "../src/index.js";

const source = Keypair.random();
const first = Keypair.random();
const second = Keypair.random();
const destination = Keypair.random();
const networkPassphrase = Networks.STANDALONE;

function prepared() {
  return new TransactionBuilder(new Account(source.publicKey(), "42"), { networkPassphrase, fee: "100" })
    .addOperation(Operation.payment({ destination: destination.publicKey(), asset: Asset.native(), amount: "1" }))
    .setTimeout(300).build();
}
function review(tx: Transaction | FeeBumpTransaction): CosignOptions {
  return { expectedSource: tx instanceof FeeBumpTransaction ? tx.feeSource : tx.source, expectedHash: tx.hash().toString("hex"), maxFeeStroops: 10_000n };
}
function wallet(change: (tx: Transaction | FeeBumpTransaction) => Transaction | FeeBumpTransaction, key = first): FuulSigner {
  return { address: key.publicKey(), async signTransaction(encoded, options) {
    const tx = change(TransactionBuilder.fromXDR(encoded, options!.networkPassphrase!));
    return { signedTxXdr: tx.toXDR(), signerAddress: key.publicKey() };
  } };
}

test("two account cosigners sign the same reviewed body without changing caller-owned envelopes", async () => {
  const tx = prepared(); const original = tx.toXDR(); const reviewed = review(tx);
  const one = await cosignPreparedTransaction(tx, keypairSigner(first), reviewed);
  const snapshot = one.toXDR(); const two = await cosignPreparedTransaction(one, keypairSigner(second), reviewed);
  expect(tx.toXDR()).toBe(original); expect(one.toXDR()).toBe(snapshot);
  expect(one.signatures).toHaveLength(1); expect(two.signatures).toHaveLength(2);
  expect(two.source).toBe(source.publicKey()); expect(two.hash().toString("hex")).toBe(reviewed.expectedHash);
  expect(first.verify(two.hash(), two.signatures[0]!.signature())).toBe(true);
  expect(second.verify(two.hash(), two.signatures[1]!.signature())).toBe(true);
  await expect(signPreparedTransaction(tx, keypairSigner(first), reviewed.maxFeeStroops)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
});

test("the wallet receives the selected cosigner, network, reviewed XDR and submit false", async () => {
  const tx = prepared(); let calls = 0;
  class Wallet implements FuulSigner {
    #signer = keypairSigner(first);
    get address() { return first.publicKey(); }
    async signTransaction(...args: Parameters<FuulSigner["signTransaction"]>) {
      calls++;
      expect(args[0]).toBe(tx.toXDR());
      expect(args[1]).toEqual({ networkPassphrase, address: first.publicKey(), submit: false });
      return this.#signer.signTransaction(...args);
    }
  }
  expect((await cosignPreparedTransaction(tx, new Wallet(), review(tx))).signatures).toHaveLength(1);
  expect(calls).toBe(1);
});

test("source, hash, network, fee and expiry mismatches stop before wallet interaction", async () => {
  let calls = 0; const signer: FuulSigner = { address: first.publicKey(), async signTransaction() { calls++; throw new Error("Unexpected signing request"); } };
  const tx = prepared(); const options = review(tx);
  for (const altered of [
    { ...options, expectedSource: first.publicKey() }, { ...options, expectedHash: "00".repeat(32) },
    { ...options, expectedHash: options.expectedHash.toUpperCase() }, { ...options, maxFeeStroops: 99n }, { ...options, maxFeeStroops: 0n },
  ]) await expect(cosignPreparedTransaction(tx, signer, altered)).rejects.toThrow();
  const networkChanged = new Transaction(tx.toXDR(), Networks.TESTNET);
  await expect(cosignPreparedTransaction(networkChanged, signer, options)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  const envelope = tx.toEnvelope(); envelope.v1().tx().cond().timeBounds().maxTime(xdr.Uint64.fromString("1"));
  const expired = new Transaction(envelope, networkPassphrase);
  await expect(cosignPreparedTransaction(expired, signer, review(expired))).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  expect(calls).toBe(0);
});

test("wallet body changes and wrong-network signatures cannot satisfy a reviewed hash", async () => {
  const tx = prepared(); const options = review(tx);
  for (const mutate of [
    (value: Transaction | FeeBumpTransaction) => { const changed = TransactionBuilder.cloneFrom(value as Transaction).addMemo(Memo.text("changed")).build(); changed.sign(first); return changed; },
    (value: Transaction | FeeBumpTransaction) => { const changed = new Transaction(value.toXDR(), Networks.TESTNET); changed.sign(first); return changed; },
  ]) await expect(cosignPreparedTransaction(tx, wallet(mutate), options)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
});

test("a wallet cannot substitute a legacy envelope even when its transaction hash matches", async () => {
  const tx = prepared();
  const v1 = tx.toEnvelope().v1().tx();
  const legacy = new Transaction(xdr.TransactionEnvelope.envelopeTypeTxV0(new xdr.TransactionV0Envelope({
    tx: new xdr.TransactionV0({ sourceAccountEd25519: source.rawPublicKey(), fee: v1.fee(), seqNum: v1.seqNum(),
      timeBounds: v1.cond().timeBounds(), memo: v1.memo(), operations: v1.operations(), ext: new xdr.TransactionV0Ext(0) }),
    signatures: [],
  })), networkPassphrase);
  legacy.sign(first);
  expect(legacy.hash().equals(tx.hash())).toBe(true);
  expect(first.verify(tx.hash(), legacy.signatures[0]!.signature())).toBe(true);
  await expect(cosignPreparedTransaction(tx, wallet(() => legacy), review(tx))).rejects.toMatchObject({ code: "WALLET_MUTATION" });
});

test("wallets must append exactly one valid signature from the selected key", async () => {
  const tx = prepared();
  for (const alter of [
    (value: Transaction | FeeBumpTransaction) => value,
    (value: Transaction | FeeBumpTransaction) => { value.sign(second); return value; },
    (value: Transaction | FeeBumpTransaction) => { value.sign(first, first); return value; },
    (value: Transaction | FeeBumpTransaction) => { value.sign(first); value.signatures[0]!.signature(Buffer.alloc(64)); return value; },
    (value: Transaction | FeeBumpTransaction) => { value.sign(first); value.signatures[0]!.hint(Buffer.alloc(4)); return value; },
  ]) await expect(cosignPreparedTransaction(tx, wallet(alter), review(tx))).rejects.toMatchObject({ code: "WALLET_MUTATION" });
});

test("wallets cannot remove, reorder, replace or duplicate earlier account signatures", async () => {
  const tx = prepared(); tx.sign(source, second);
  for (const alter of [
    (value: Transaction | FeeBumpTransaction) => { value.signatures.splice(0, 1); value.sign(first); return value; },
    (value: Transaction | FeeBumpTransaction) => { value.signatures.reverse(); value.sign(first); return value; },
    (value: Transaction | FeeBumpTransaction) => { value.signatures[0] = value.signatures[1]!; value.sign(first); return value; },
    (value: Transaction | FeeBumpTransaction) => { value.sign(first); value.signatures.push(value.signatures[0]!); return value; },
  ]) await expect(cosignPreparedTransaction(tx, wallet(alter), review(tx))).rejects.toMatchObject({ code: "WALLET_MUTATION" });
});

test("an existing valid signature from this cosigner is rejected without another wallet prompt", async () => {
  const tx = prepared(); tx.sign(first); let calls = 0;
  await expect(cosignPreparedTransaction(tx, { address: first.publicKey(), async signTransaction() { calls++; throw new Error("must not sign twice"); } }, review(tx))).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  expect(calls).toBe(0);
});

test("a fee source can collect multiple signatures while retaining its signed inner transaction", async () => {
  const inner = prepared(); inner.sign(source); const innerXdr = inner.toXDR();
  const feeBump = TransactionBuilder.buildFeeBumpTransaction(destination.publicKey(), "200", inner, networkPassphrase);
  const one = await cosignPreparedTransaction(feeBump, keypairSigner(first), review(feeBump));
  const two = await cosignPreparedTransaction(one, keypairSigner(second), review(feeBump));
  expect(two).toBeInstanceOf(FeeBumpTransaction); expect(two.innerTransaction.toXDR()).toBe(innerXdr);
  expect(two.feeSource).toBe(destination.publicKey()); expect(two.signatures).toHaveLength(2);
  expect(first.verify(two.hash(), two.signatures[0]!.signature())).toBe(true);
  expect(second.verify(two.hash(), two.signatures[1]!.signature())).toBe(true);
  const unsignedInner = TransactionBuilder.buildFeeBumpTransaction(destination.publicKey(), "200", prepared(), networkPassphrase);
  await expect(cosignPreparedTransaction(unsignedInner, keypairSigner(first), review(unsignedInner))).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
});

test("cancellation settles while a wallet waits and rejects its late signature", async () => {
  const tx = prepared(); const controller = new AbortController();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }); const wait = new Promise<void>(resolve => { release = resolve; });
  const signer = keypairSigner(first);
  const result = cosignPreparedTransaction(tx, { address: first.publicKey(), async signTransaction(...args) { entered(); await wait; return signer.signTransaction(...args); } }, { ...review(tx), signal: controller.signal });
  await started; controller.abort();
  try { await expect(result).rejects.toMatchObject({ code: "ABORTED" }); }
  finally { release(); }
  expect(tx.signatures).toHaveLength(0);
});

test("review options, caller envelope and signer fields are snapshotted before wallet wait", async () => {
  const tx = prepared(); const original = tx.toXDR(); const options = review(tx);
  const signer: FuulSigner = { address: first.publicKey(), async signTransaction(encoded, parameters) {
    options.expectedHash = "00".repeat(32); options.expectedSource = second.publicKey(); options.maxFeeStroops = 1n;
    tx.sign(second); signer.address = second.publicKey();
    const value = TransactionBuilder.fromXDR(encoded, parameters!.networkPassphrase!); value.sign(first);
    return { signedTxXdr: value.toXDR(), signerAddress: first.publicKey() };
  } };
  const signed = await cosignPreparedTransaction(tx, signer, options);
  expect(signed.hash().equals(new Transaction(original, networkPassphrase).hash())).toBe(true);
  expect(signed.signatures).toHaveLength(1); expect(first.verify(signed.hash(), signed.signatures[0]!.signature())).toBe(true);
});

test("malformed wallet envelopes and wrong signer identity are rejected", async () => {
  const tx = prepared();
  for (const response of [
    { signedTxXdr: "invalid", signerAddress: first.publicKey() },
    { signedTxXdr: tx.toXDR() + "\n", signerAddress: first.publicKey() },
    { signedTxXdr: "A".repeat(2 * 1024 * 1024 + 1), signerAddress: first.publicKey() },
    { signedTxXdr: tx.toXDR(), signerAddress: second.publicKey() },
  ]) await expect(cosignPreparedTransaction(tx, { address: first.publicKey(), async signTransaction() { return response; } }, review(tx))).rejects.toMatchObject({ code: "WALLET_MUTATION" });
  await expect(cosignPreparedTransaction(tx, { address: first.publicKey(), async signTransaction() { return { signedTxXdr: "", error: { message: "declined", code: -1 } }; } }, review(tx))).rejects.toMatchObject({ code: "WALLET_REJECTED" });
});

test("regular and fee-bump envelopes that expire during cosigning cannot complete", async () => {
  for (const sponsored of [false, true]) {
    const inner = prepared(); inner.sign(source);
    const tx = sponsored ? TransactionBuilder.buildFeeBumpTransaction(destination.publicKey(), "200", inner, networkPassphrase) : inner;
    const expires = (Number(inner.timeBounds!.maxTime) + 1) * 1000;
    const signer = keypairSigner(first); let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined;
    try {
      await expect(cosignPreparedTransaction(tx as Transaction, { address: first.publicKey(), async signTransaction(...args) {
        const signed = await signer.signTransaction(...args); clock = spyOn(Date, "now").mockReturnValue(expires); return signed;
      } }, review(tx))).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
    } finally { clock?.mockRestore(); }
  }
});

test("pre-cancelled and full envelopes do not prompt the wallet", async () => {
  let calls = 0; const signer: FuulSigner = { address: first.publicKey(), async signTransaction() { calls++; throw new Error("must not prompt"); } };
  const tx = prepared(); const controller = new AbortController(); controller.abort();
  await expect(cosignPreparedTransaction(tx, signer, { ...review(tx), signal: controller.signal })).rejects.toMatchObject({ code: "ABORTED" });
  for (let i = 0; i < 20; i++) tx.sign(Keypair.random());
  await expect(cosignPreparedTransaction(tx, signer, review(tx))).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  expect(calls).toBe(0);
});
