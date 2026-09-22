import { expect, test } from "bun:test";
import { Account, Address, Asset, Contract, Keypair, Networks, Operation, SorobanDataBuilder, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { Server } from "@stellar/stellar-sdk/rpc";
import { checkSorobanResources, inspectSorobanResources, readSorobanResourceLimits, submitSignedTransaction, type SorobanResourceLimits } from "../src/index.js";
import { resourceConfigFixture } from "./fixtures/resources.js";

const key = Keypair.random(), passphrase = Networks.STANDALONE;
const contract = new Contract(StrKey.encodeContract(Buffer.alloc(32, 42)));
const code = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 1) }));
const persistent = (id: number, temporary = false) => xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
  contract: new Address(contract.contractId()).toScAddress(), key: xdr.ScVal.scvU32(id),
  durability: temporary ? xdr.ContractDataDurability.temporary() : xdr.ContractDataDurability.persistent(),
}));
function transaction(operation = contract.call("answer"), read: xdr.LedgerKey[] = [], write: xdr.LedgerKey[] = [], archived: number[] = []): Transaction {
  const data = new SorobanDataBuilder().setResources(90_000, 1234, 5678).setResourceFee(1000).setReadOnly(read).setReadWrite(write).build();
  if (archived.length) data.ext(new xdr.SorobanTransactionDataExt(1, new xdr.SorobanResourcesExtV0({ archivedSorobanEntries: archived })));
  return new TransactionBuilder(new Account(key.publicKey(), "42"), { networkPassphrase: passphrase, fee: "1100" })
    .addOperation(operation).setSorobanData(data).setTimeout(300).build();
}
function rpcFixture() {
  let response = resourceConfigFixture(), sends = 0, envelope: xdr.TransactionEnvelope | undefined;
  const rpc = {
    getNetwork: async () => ({ passphrase, protocolVersion: "28" }),
    getLedgerEntries: async (..._keys: xdr.LedgerKey[]) => response,
    sendTransaction: async (tx: Transaction) => { sends++; envelope = tx.toEnvelope(); return { status: "PENDING", hash: tx.hash().toString("hex") }; },
    getTransaction: async (txHash: string) => ({ status: "SUCCESS", txHash, ledger: 102, envelopeXdr: envelope }),
  };
  return { rpc, server: rpc as unknown as Server, get response() { return response; }, set response(value) { response = value; }, get sends() { return sends; } };
}

test("reads all current limits without relying on RPC response order", async () => {
  const f = rpcFixture(); f.response.entries.reverse();
  const requested: string[] = [];
  f.rpc.getLedgerEntries = async (...keys) => { requested.push(...keys.map(key => key.configSetting().configSettingId().name)); return f.response; };
  const limits = await readSorobanResourceLimits(f.server, passphrase);
  expect(requested).toHaveLength(5); expect(new Set(requested).size).toBe(5);
  expect(limits.maximum).toEqual({ instructions: 100_000n, diskReadBytes: 10_000n, writeBytes: 10_000n,
    diskReadEntries: 40n, writeEntries: 30n, footprintEntries: 60n, transactionBytes: 10_000n, largestKeyBytes: 250n });
  expect(limits.ledger).toBe(100); expect(Object.isFrozen(limits.maximum)).toBe(true);
  f.response.entries.find(e => e.val.configSetting().switch().name === "configSettingContractComputeV0")!.val.configSetting().contractCompute().txMaxInstructions(xdr.Int64.fromString("9007199254740993"));
  expect((await readSorobanResourceLimits(f.server, passphrase)).maximum.instructions).toBe(9007199254740993n);
});

test("rejects missing, duplicated, misidentified, malformed and future configuration entries", async () => {
  const mutations = [
    (f: ReturnType<typeof rpcFixture>) => { f.response.entries.pop(); },
    (f: ReturnType<typeof rpcFixture>) => { f.response.entries[4] = f.response.entries[0]!; },
    (f: ReturnType<typeof rpcFixture>) => { f.response.entries[0]!.val = f.response.entries[1]!.val; },
    (f: ReturnType<typeof rpcFixture>) => { f.response.entries[0]!.lastModifiedLedgerSeq = 101; },
    (f: ReturnType<typeof rpcFixture>) => { f.response.latestLedger = Number.NaN; },
    (f: ReturnType<typeof rpcFixture>) => { f.response.entries[0]!.val.configSetting().contractCompute().txMaxInstructions(xdr.Int64.fromString("-1")); },
  ];
  for (const mutate of mutations) {
    const f = rpcFixture(); mutate(f);
    await expect(readSorobanResourceLimits(f.server, passphrase)).rejects.toMatchObject({ code: "RESOURCE_CONFIG" });
  }
  const f = rpcFixture();
  await expect(readSorobanResourceLimits(f.server, Networks.PUBLIC)).rejects.toMatchObject({ code: "NETWORK_MISMATCH" });
  for (const protocolVersion of ["26", "028", "28.0", "0", "", undefined]) {
    f.server.getNetwork = async () => ({ passphrase, protocolVersion }) as Awaited<ReturnType<Server["getNetwork"]>>;
    await expect(readSorobanResourceLimits(f.server, passphrase)).rejects.toMatchObject({ code: "RESOURCE_CONFIG" });
  }
  // A later protocol keeps reading live limits instead of disabling every submission after a network upgrade.
  for (const protocolVersion of ["27", "29", 30]) {
    f.server.getNetwork = async () => ({ passphrase, protocolVersion }) as Awaited<ReturnType<Server["getNetwork"]>>;
    expect((await readSorobanResourceLimits(f.server, passphrase)).protocolVersion).toBe(Number(protocolVersion));
  }
});

test("each resource accepts its exact maximum and reports one unit over", async () => {
  const limits = await readSorobanResourceLimits(rpcFixture().server, passphrase);
  const account = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: key.xdrAccountId() }));
  const tx = transaction(contract.call("answer"), [account, code], [persistent(1)]); tx.sign(key);
  const usage = inspectSorobanResources(tx, limits)!.usage;
  expect(usage).toEqual({ instructions: 90_000n, diskReadBytes: 1234n, writeBytes: 5678n, diskReadEntries: 1n,
    footprintEntries: 3n, writeEntries: 1n, transactionBytes: BigInt(tx.toEnvelope().toXDR().length), largestKeyBytes: BigInt(persistent(1).toXDR().length) });
  for (const name of Object.keys(usage) as (keyof typeof usage)[]) {
    const boundary: SorobanResourceLimits = { ...limits, maximum: { ...limits.maximum, [name]: usage[name] } };
    expect(inspectSorobanResources(tx, boundary)!.violations).toEqual([]);
    const over = inspectSorobanResources(tx, { ...boundary, maximum: { ...boundary.maximum, [name]: usage[name] - 1n } })!;
    expect(over.violations).toEqual([{ resource: name, actual: String(usage[name]), maximum: String(usage[name] - 1n) }]);
  }
});

test("counts archived reads and explicit restoration separately from live Soroban entries", async () => {
  const limits = await readSorobanResourceLimits(rpcFixture().server, passphrase);
  const tx = transaction(contract.call("answer"), [persistent(1)], [code, persistent(2), persistent(3, true)], [0, 1]);
  expect(inspectSorobanResources(tx, limits)!.usage.diskReadEntries).toBe(2n);
  const restore = transaction(Operation.restoreFootprint({}), [], [code, persistent(2)]);
  expect(inspectSorobanResources(restore, limits)!.usage.diskReadEntries).toBe(2n);
  const live = transaction(contract.call("answer"), [code, persistent(2)], []);
  expect(inspectSorobanResources(live, limits)!.usage.diskReadEntries).toBe(0n);
  const extend = transaction(Operation.extendFootprintTtl({ extendTo: 100 }), [code, persistent(2)]);
  expect(inspectSorobanResources(extend, limits)!.usage.diskReadEntries).toBe(0n);
});

test("rejects invalid footprints and archived indexes before RPC submission", async () => {
  const limits = await readSorobanResourceLimits(rpcFixture().server, passphrase);
  const invalid = [
    transaction(contract.call("answer"), [code], [code]),
    transaction(contract.call("answer"), [resourceConfigFixture().entries[0]!.key]),
    transaction(contract.call("answer"), [], [code, persistent(1)], [1, 0]),
    transaction(contract.call("answer"), [], [code], [0, 0]),
    transaction(contract.call("answer"), [], [code], [1]),
    transaction(contract.call("answer"), [], [persistent(1, true)], [0]),
    transaction(Operation.restoreFootprint({}), [code], [persistent(1)]),
    transaction(Operation.restoreFootprint({}), [], [persistent(1, true)]),
    transaction(Operation.extendFootprintTtl({ extendTo: 100 }), [], [code]),
  ];
  for (const tx of invalid) expect(() => inspectSorobanResources(tx, limits)).toThrow(expect.objectContaining({ code: "INVALID_TRANSACTION" }));
});

test("measures signatures and the fee bump inner envelope exactly as Core does", async () => {
  const limits = await readSorobanResourceLimits(rpcFixture().server, passphrase);
  const inner = transaction(), unsignedBytes = inner.toEnvelope().toXDR().length;
  inner.sign(key); expect(inner.toEnvelope().toXDR().length - unsignedBytes).toBe(72);
  const outer = TransactionBuilder.buildFeeBumpTransaction(key, "2000", inner, passphrase); outer.sign(key);
  const exact = { ...limits, maximum: { ...limits.maximum, transactionBytes: BigInt(inner.toEnvelope().toXDR().length) } };
  const report = inspectSorobanResources(outer, exact)!;
  expect(report.usage.transactionBytes).toBe(BigInt(inner.toEnvelope().toXDR().length));
  expect(report.usage.transactionBytes).toBeLessThan(BigInt(outer.toEnvelope().toXDR().length));
  expect(report.violations).toEqual([]); expect(report.hash).toBe(outer.hash().toString("hex"));
});

test("submission rejects an excessive declaration or stale config without creating an uncertain outcome", async () => {
  const f = rpcFixture(), tx = transaction(); tx.sign(key);
  f.response.entries[0]!.val.configSetting().contractCompute().txMaxInstructions(xdr.Int64.fromString("89999"));
  await expect(submitSignedTransaction(f.server, tx)).rejects.toMatchObject({ code: "RESOURCE_LIMIT", details: { resource: "instructions", actual: "90000", maximum: "89999" } });
  expect(f.sends).toBe(0);
  f.response = resourceConfigFixture();
  await expect(checkSorobanResources(f.server, tx, 101)).rejects.toMatchObject({ code: "RESOURCE_CONFIG" });
  expect((await submitSignedTransaction(f.server, tx)).ledger).toBe(102); expect(f.sends).toBe(1);
});

test("bounded submission ignores late resource reads after cancellation or timeout", async () => {
  for (const mode of ["timeout", "abort"]) {
    const f = rpcFixture(), tx = transaction(); tx.sign(key);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    f.rpc.getLedgerEntries = async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return f.response; };
    const controller = new AbortController();
    const pending = submitSignedTransaction(f.server, tx, { timeoutMs: mode === "timeout" ? 20 : 1000, signal: controller.signal });
    await started; if (mode === "abort") controller.abort();
    await expect(pending).rejects.toMatchObject({ code: mode === "timeout" ? "NETWORK_ERROR" : "ABORTED" });
    release(); await new Promise(resolve => setTimeout(resolve, 0)); expect(f.sends).toBe(0);
  }
});

test("captures the reviewed envelope before an asynchronous limits read", async () => {
  const f = rpcFixture(), tx = transaction(); tx.sign(key); const hash = tx.hash().toString("hex");
  f.rpc.getLedgerEntries = async () => { tx.sign(Keypair.random()); return f.response; };
  const result = await checkSorobanResources(f.server, tx);
  expect(result!.hash).toBe(hash);
  expect(result!.usage.transactionBytes).toBe(BigInt(tx.toEnvelope().toXDR().length - 72));
});

test("classic payments do not request Soroban configuration", async () => {
  const f = rpcFixture(); f.rpc.getLedgerEntries = async () => { throw new Error("Classic payment requested Soroban settings"); };
  const tx = new TransactionBuilder(new Account(key.publicKey(), "42"), { networkPassphrase: passphrase, fee: "100" })
    .addOperation(Operation.payment({ destination: key.publicKey(), asset: Asset.native(), amount: "1" })).setTimeout(60).build(); tx.sign(key);
  expect(await checkSorobanResources(f.server, tx)).toBeUndefined();
  expect((await submitSignedTransaction(f.server, tx)).ledger).toBe(102);
});
