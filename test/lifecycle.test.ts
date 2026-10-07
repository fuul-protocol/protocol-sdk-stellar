import { arm } from "./fixtures/xdr.js";
import { expect, test } from "bun:test";
import { Account, Address, Contract, Keypair, Operation, SorobanDataBuilder, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { Server } from "@stellar/stellar-sdk/rpc";
import { getContractState, prepareLifecycleTransaction, verifyDeployment } from "../src/index.js";

const contractId = StrKey.encodeContract(Buffer.alloc(32, 11));
const wasmHash = Buffer.alloc(32, 12);
const key = new Contract(contractId).getFootprint();
const value = xdr.LedgerEntryData.contractData(new xdr.ContractDataEntry({
  ext: xdr.ExtensionPoint.v0(), contract: new Address(contractId).toScAddress(),
  key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent,
  val: xdr.ScVal.scvContractInstance(new xdr.ScContractInstance({ executable: xdr.ContractExecutable.contractExecutableWasm(wasmHash), storage: [] })),
}));

function lifecycleFixture(action: "restore" | "extend" = "extend") {
  const source = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 13));
  const input = { source, networkPassphrase: "test", keys: [key],
    action: action === "restore" ? { kind: "restore" as const } : { kind: "extend" as const, extendTo: 100 },
    maxFeeStroops: 1000n };
  const server = new Server("http://127.0.0.1:1/rpc", { allowHttp: true });
  server.getNetwork = async () => ({ passphrase: "test", protocolVersion: "28" });
  server.getAccount = async address => new Account(address, "1");
  server.simulateTransaction = async tx => {
    if (!(tx instanceof Transaction)) throw new Error("Expected regular transaction");
    return { _parsed: true, id: "lifecycle", latestLedger: 100, events: [], minResourceFee: "100",
      transactionData: new SorobanDataBuilder(arm(arm(tx.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData).setResources(100, 0, 0).setResourceFee(100) };
  };
  return { input, server };
}

test("extends temporary and persistent entries with the same storage key through Stellar preparation", async () => {
  const { input, server } = lifecycleFixture();
  const persistent = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract: new Address(contractId).toScAddress(), key: xdr.ScVal.scvSymbol("entry"), durability: xdr.ContractDataDurability.persistent }));
  const temporary = xdr.LedgerKey.fromXdr(persistent.toXdr());
  Reflect.set(arm(temporary, "contractData").contractData, "durability", xdr.ContractDataDurability.temporary);
  input.keys = [temporary, persistent];
  const prepared = await prepareLifecycleTransaction(server, input);
  const footprint = arm(arm(prepared.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData.resources.footprint;
  expect(footprint.readOnly.map(key => key.toXdr("base64")).sort()).toEqual(input.keys.map(key => key.toXdr("base64")).sort());
  expect(footprint.readWrite).toHaveLength(0); expect(prepared.operations[0]!.type).toBe("extendFootprintTtl");
  expect(prepared.signatures).toHaveLength(0);
});

test("rejects mixed temporary restoration and non-contract lifecycle keys before RPC reads", async () => {
  let calls = 0;
  const { input, server } = lifecycleFixture("restore");
  server.getNetwork = async () => { calls++; throw new Error("must not read"); };
  const temporary = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract: new Address(contractId).toScAddress(), key: xdr.ScVal.scvSymbol("entry"), durability: xdr.ContractDataDurability.temporary }));
  await expect(prepareLifecycleTransaction(server, { ...input, keys: [key, temporary] })).rejects.toThrow("persistent");
  const account = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(input.source).xdrAccountId() }));
  for (const action of [{ kind: "restore" as const }, { kind: "extend" as const, extendTo: 100 }]) {
    await expect(prepareLifecycleTransaction(server, { ...input, keys: [account], action })).rejects.toThrow("contract data or Wasm");
  }
  await expect(prepareLifecycleTransaction(server, { ...input, keys: [temporary, temporary], action: { kind: "extend", extendTo: 100 } })).rejects.toThrow("duplicate");
  expect(calls).toBe(0);
});

test("rejects replacement lifecycle targets from the actual Stellar preparation implementation", async () => {
  for (const action of ["restore", "extend"] as const) {
    const { input, server } = lifecycleFixture(action);
    const replacement = new Contract(StrKey.encodeContract(Buffer.alloc(32, 31))).getFootprint();
    const simulate = server.simulateTransaction.bind(server);
    server.simulateTransaction = async (...args) => {
      const response = await simulate(...args);
      if (!("transactionData" in response)) throw new Error("Expected successful simulation");
      if (action === "restore") response.transactionData.setReadWrite([replacement]);
      else response.transactionData.setReadOnly([replacement]);
      return response;
    };
    await expect(prepareLifecycleTransaction(server, input)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  }
});

test("rejects a different source account before lifecycle preparation", async () => {
  const { input, server } = lifecycleFixture(); let prepares = 0;
  server.getAccount = async () => new Account(StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 30)), "1");
  server.prepareTransaction = async tx => { prepares++; return tx as Transaction; };
  await expect(prepareLifecycleTransaction(server, input)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  expect(prepares).toBe(0);
});

test("rejects lifecycle body changes, signatures, and invalid resource fees from a preparer", async () => {
  const signer = Keypair.random();
  const options = (tx: Transaction) => ({ fee: tx.fee, sorobanData: arm(arm(tx.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData });
  const mutations: ((tx: Transaction) => Transaction)[] = [
    tx => TransactionBuilder.cloneFrom(tx, { ...options(tx), networkPassphrase: "different" }).build(),
    tx => { const envelope = tx.toEnvelope(); Reflect.set(arm(envelope, "envelopeTypeTx").v1.tx, "seqNum", xdr.Int64.fromString("99")); return new Transaction(envelope, "test"); },
    tx => { const envelope = tx.toEnvelope(); Reflect.set(arm(envelope, "envelopeTypeTx").v1.tx, "cond", xdr.Preconditions.precondNone()); return new Transaction(envelope, "test"); },
    tx => TransactionBuilder.cloneFrom(tx, options(tx)).clearOperations().addOperation(Operation.extendFootprintTtl({ extendTo: 999 })).build(),
    tx => TransactionBuilder.cloneFrom(tx, options(tx)).addOperation(Operation.restoreFootprint({})).build(),
    tx => { tx.sign(signer); return tx; },
    tx => { const envelope = tx.toEnvelope(); Reflect.set(arm(arm(envelope, "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData, "resourceFee", xdr.Int64.fromString("-1")); return new Transaction(envelope, "test"); },
    tx => { const envelope = tx.toEnvelope(); Reflect.set(arm(arm(envelope, "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData, "resourceFee", xdr.Int64.fromString("999")); return new Transaction(envelope, "test"); },
  ];
  for (const mutate of mutations) {
    const { input, server } = lifecycleFixture();
    server.prepareTransaction = async tx => mutate(tx as Transaction);
    await expect(prepareLifecycleTransaction(server, input)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  }
});

test("rejects lifecycle targets added, removed, duplicated, or moved between footprint classes", async () => {
  const additional = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: wasmHash }));
  for (const action of ["restore", "extend"] as const) for (const corrupt of ["extra", "missing", "duplicate", "class"] as const) {
    const { input, server } = lifecycleFixture(action);
    server.prepareTransaction = async tx => {
      const envelope = tx.toEnvelope(); const footprint = arm(arm(envelope, "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData.resources.footprint;
      const keys = corrupt === "extra" ? [key, additional] : corrupt === "missing" ? [] : corrupt === "duplicate" ? [key, key] : [key];
      Reflect.set(footprint, "readOnly", action === "extend" && corrupt !== "class" || action === "restore" && corrupt === "class" ? keys : []);
      Reflect.set(footprint, "readWrite", action === "restore" && corrupt !== "class" || action === "extend" && corrupt === "class" ? keys : []);
      return new Transaction(envelope, "test");
    };
    await expect(prepareLifecycleTransaction(server, input)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
  }
});

test("accepts resource measurement changes and reordered exact lifecycle targets using Stellar preparation", async () => {
  const additional = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: wasmHash }));
  for (const action of ["restore", "extend"] as const) {
    const { input, server } = lifecycleFixture(action); input.keys.push(additional);
    const simulate = server.simulateTransaction.bind(server);
    server.simulateTransaction = async (...args) => {
      const response = await simulate(...args);
      if (!("transactionData" in response)) throw new Error("Expected successful simulation");
      if (action === "restore") response.transactionData.setReadWrite([additional, key]);
      else response.transactionData.setReadOnly([additional, key]);
      return response;
    };
    const prepared = await prepareLifecycleTransaction(server, input);
    expect(prepared.fee).toBe("200"); expect(prepared.source).toBe(input.source); expect(prepared.sequence).toBe("2");
    expect(prepared.operations[0]!.type).toBe(action === "restore" ? "restoreFootprint" : "extendFootprintTtl");
    expect(arm(arm(prepared.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData.resources.instructions).toBe(100);
  }
});

test("keeps prepared lifecycle results and source sequences independent from RPC-owned objects", async () => {
  const { input, server } = lifecycleFixture();
  const account = new Account(input.source, "1"); let response: Transaction | undefined;
  server.getAccount = async () => account;
  server.prepareTransaction = async tx => { response = tx as Transaction; return response; };
  const prepared = await prepareLifecycleTransaction(server, input);
  const expected = prepared.toXdr();
  response!.sign(Keypair.random()); account.incrementSequenceNumber();
  expect(prepared.toXdr()).toBe(expected); expect(prepared.signatures).toHaveLength(0);
  expect(prepared.sequence).toBe("2"); expect(account.sequenceNumber()).toBe("2");
});

test("reports expired entries even when RPC still returns their data", async () => {
  const rpc = { getLedgerEntries: async () => ({ latestLedger: 100, entries: [{ key, val: value, liveUntilLedgerSeq: 99 }] }) };
  const state = await getContractState(rpc, contractId);
  expect(state.state).toBe("expired"); expect(state.wasmHash).toBe(Buffer.from(wasmHash).toString("hex"));
  const live = await getContractState({ getLedgerEntries: async () => ({ latestLedger: 100, entries: [{ key, val: value, liveUntilLedgerSeq: 100 }] }) }, contractId);
  expect(live.state).toBe("live");
  const unknown = await getContractState({ getLedgerEntries: async () => ({ latestLedger: 100, entries: [{ key, val: value }] }) }, contractId);
  expect(unknown.state).toBe("unknown");
});
test("rejects missing code and an unexpected deployed Wasm hash", async () => {
  await expect(getContractState({ getLedgerEntries: async () => ({ latestLedger: 100, entries: [] }) }, contractId)).rejects.toThrow();
  const rpc = { getNetwork: async () => ({ passphrase: "test" }), getLedgerEntries: async () => ({ latestLedger: 100, entries: [{ key, val: value, liveUntilLedgerSeq: 101 }] }) } as unknown as Server;
  await expect(verifyDeployment(rpc, { networkPassphrase: "test", contracts: { project: { contractId, wasmHash: "a".repeat(64) } } })).rejects.toThrow();
  await expect(verifyDeployment(rpc, { networkPassphrase: "wrong", contracts: { project: { contractId, wasmHash: Buffer.from(wasmHash).toString("hex") } } })).rejects.toMatchObject({ code: "NETWORK_MISMATCH" });
});
test("rejects duplicate and temporary restoration keys before contacting RPC", async () => {
  let calls = 0;
  const rpc = { getNetwork: async () => { calls++; return { passphrase: "test" }; } } as unknown as Server;
  const input = { source: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 13)), networkPassphrase: "test", action: { kind: "restore" as const }, maxFeeStroops: 1000n };
  await expect(prepareLifecycleTransaction(rpc, { ...input, keys: [key, key] })).rejects.toThrow("duplicate");
  const temporary = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract: new Address(contractId).toScAddress(), key: xdr.ScVal.scvSymbol("temporary"), durability: xdr.ContractDataDurability.temporary }));
  await expect(prepareLifecycleTransaction(rpc, { ...input, keys: [temporary] })).rejects.toThrow("persistent");
  expect(calls).toBe(0);
});

test("lifecycle preparation retains the approved keys, action, source, and fee ceiling across RPC waits", async () => {
  const source = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 13));
  const original = key.toXdr("base64");
  const input = { source, networkPassphrase: "test", keys: [xdr.LedgerKey.fromXdr(original, "base64")], action: { kind: "extend" as const, extendTo: 100 }, maxFeeStroops: 1000n };
  let selectedSource = "", selectedKey = "", selectedExtension = 0;
  const rpc: Pick<Server, "getNetwork" | "getAccount" | "prepareTransaction"> = {
    async getNetwork() {
      Reflect.set(arm(input.keys[0]!, "contractData").contractData, "contract", new Address(StrKey.encodeContract(Buffer.alloc(32, 31))).toScAddress());
      input.action.extendTo = 500; input.maxFeeStroops = 10000n;
      input.source = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 14));
      return { passphrase: "test", protocolVersion: "28" };
    },
    async getAccount(address) { selectedSource = address; return new Account(address, "1"); },
    async prepareTransaction(tx) {
      if (!(tx instanceof Transaction)) throw new Error("Expected a regular lifecycle transaction");
      selectedKey = arm(arm(tx.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData.resources.footprint.readOnly[0]!.toXdr("base64");
      const operation = tx.operations[0]!;
      if (operation.type === "extendFootprintTtl") selectedExtension = operation.extendTo;
      return TransactionBuilder.cloneFrom(tx, { fee: "2000", sorobanData: arm(arm(tx.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData }).build();
    },
  };
  await expect(prepareLifecycleTransaction(rpc, input)).rejects.toMatchObject({ code: "FEE_LIMIT" });
  expect(selectedSource).toBe(source); expect(selectedKey).toBe(original); expect(selectedExtension).toBe(100);
});

test("deployment verification snapshots the expected code before requesting network identity", async () => {
  const input = { networkPassphrase: "test", contracts: { project: { contractId, wasmHash: "a".repeat(64) } } };
  const rpc = {
    async getNetwork() { input.contracts.project.wasmHash = Buffer.from(wasmHash).toString("hex"); return { passphrase: "test", protocolVersion: "28" }; },
    async getLedgerEntries() { return { latestLedger: 100, entries: [{ key, val: value, liveUntilLedgerSeq: 101 }] }; },
  };
  await expect(verifyDeployment(rpc, input)).rejects.toThrow("does not match");
  await expect(verifyDeployment(rpc, { networkPassphrase: "test", contracts: {} })).rejects.toThrow();
});

test("contract state rejects invalid ledger and TTL metadata instead of reporting live state", async () => {
  for (const latestLedger of [NaN, Infinity, -1, 0, 0x1_0000_0000, 1.5]) {
    await expect(getContractState({ getLedgerEntries: async () => ({ latestLedger, entries: [{ key, val: value, liveUntilLedgerSeq: 101 }] }) }, contractId)).rejects.toThrow("ledger");
  }
  for (const liveUntilLedgerSeq of [NaN, Infinity, -1, 0x1_0000_0000, 1.5]) {
    await expect(getContractState({ getLedgerEntries: async () => ({ latestLedger: 100, entries: [{ key, val: value, liveUntilLedgerSeq }] }) }, contractId)).rejects.toThrow("TTL");
  }
});

test("deployment identity rejects mismatched entry contents and duplicate instance observations", async () => {
  const otherContract = StrKey.encodeContract(Buffer.alloc(32, 21));
  for (const corrupt of [
    (data: xdr.ContractDataEntry) => Reflect.set(data, "contract", new Address(otherContract).toScAddress()),
    (data: xdr.ContractDataEntry) => Reflect.set(data, "key", xdr.ScVal.scvSymbol("different")),
    (data: xdr.ContractDataEntry) => Reflect.set(data, "durability", xdr.ContractDataDurability.temporary),
  ]) {
    const altered = xdr.LedgerEntryData.fromXdr(value.toXdr());
    corrupt(arm(altered, "contractData").contractData);
    const rpc = {
      getNetwork: async () => ({ passphrase: "test", protocolVersion: "28" }),
      getLedgerEntries: async () => ({ latestLedger: 100, entries: [{ key, val: altered, liveUntilLedgerSeq: 101 }] }),
    };
    await expect(verifyDeployment(rpc, { networkPassphrase: "test", contracts: { project: { contractId, wasmHash: Buffer.from(wasmHash).toString("hex") } } })).rejects.toThrow("instance");
  }
  const entry = { key, val: value, liveUntilLedgerSeq: 101 };
  await expect(getContractState({ getLedgerEntries: async () => ({ latestLedger: 100, entries: [entry, entry] }) }, contractId)).rejects.toThrow("instance");
});
