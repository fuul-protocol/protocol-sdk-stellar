import { Account, Contract, Operation, SorobanDataBuilder, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import type { Server } from "@stellar/stellar-sdk/rpc";
import { FuulError } from "./errors.js";
import { validateContractId } from "./validation.js";

export interface ContractState {
  contractId: string;
  ledger: number;
  liveUntilLedger?: number;
  wasmHash?: string;
  executable: "wasm" | "stellarAsset" | "external";
  state: "live" | "expired" | "unknown";
  instanceKey: xdr.LedgerKey;
}

/** Read the deployed executable and instance TTL. Missing state is not treated as an empty contract. */
export async function getContractState(rpc: Pick<Server, "getLedgerEntries">, contractId: string): Promise<ContractState> {
  validateContractId(contractId, "contract ID");
  const instanceKey = new Contract(contractId).getFootprint();
  const result = await rpc.getLedgerEntries(instanceKey);
  if (!Number.isInteger(result.latestLedger) || result.latestLedger < 1 || result.latestLedger > 0xffff_ffff) throw new Error("RPC returned an invalid contract observation ledger");
  if (!result.entries.length) throw new Error("Contract instance is missing or archived; inspect the deployment and restoration requirements");
  const entry = result.entries[0]!;
  if (result.entries.length !== 1 || entry.key.toXDR("base64") !== instanceKey.toXDR("base64")) throw new Error("RPC returned an unexpected contract instance observation");
  if (entry.liveUntilLedgerSeq !== undefined && (!Number.isInteger(entry.liveUntilLedgerSeq) || entry.liveUntilLedgerSeq < 0 || entry.liveUntilLedgerSeq > 0xffff_ffff)) throw new Error("RPC returned an invalid contract instance TTL");
  const data = entry.val.contractData();
  const expected = instanceKey.contractData();
  if (data.contract().toXDR("base64") !== expected.contract().toXDR("base64") || data.key().toXDR("base64") !== expected.key().toXDR("base64") || data.durability().name !== "persistent") throw new Error("RPC contract instance data does not match the requested key");
  const executable = data.val().instance().executable();
  const kind = executable.switch().name;
  return {
    contractId, ledger: result.latestLedger, liveUntilLedger: entry.liveUntilLedgerSeq,
    wasmHash: kind === "contractExecutableWasm" ? executable.wasmHash().toString("hex") : undefined,
    executable: kind === "contractExecutableWasm" ? "wasm" : kind === "contractExecutableStellarAsset" ? "stellarAsset" : "external",
    state: entry.liveUntilLedgerSeq === undefined ? "unknown" : entry.liveUntilLedgerSeq < result.latestLedger ? "expired" : "live",
    instanceKey,
  };
}

export async function verifyDeployment(rpc: Pick<Server, "getNetwork" | "getLedgerEntries">, input: {
  networkPassphrase: string;
  contracts: Readonly<Record<string, { contractId: string; wasmHash: string }>>;
}): Promise<Record<string, ContractState>> {
  const { networkPassphrase } = input;
  const expectedContracts = Object.entries(input.contracts).map(([name, expected]) => [name, { ...expected }] as const);
  if (!expectedContracts.length) throw new TypeError("deployment must include at least one expected contract");
  for (const [, expected] of expectedContracts) {
    validateContractId(expected.contractId, "expected contract ID");
    if (!/^[a-f0-9]{64}$/i.test(expected.wasmHash)) throw new TypeError("expected Wasm hash must contain 32 hexadecimal bytes");
  }
  if ((await rpc.getNetwork()).passphrase !== networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "Deployment network does not match");
  const states: [string, ContractState][] = [];
  for (const [name, expected] of expectedContracts) {
    const state = await getContractState(rpc, expected.contractId);
    if (state.wasmHash !== expected.wasmHash.toLowerCase()) throw new Error(`Deployed Wasm hash does not match for ${name}`);
    states.push([name, state]);
  }
  return Object.fromEntries(states);
}

export type LifecycleRequest = { kind: "restore" } | { kind: "extend"; extendTo: number };

function invalidPreparation(message: string): never {
  throw new FuulError("INVALID_TRANSACTION", `Lifecycle preparation ${message}`);
}

/** Only resource measurements and the bounded fee may change during preparation. */
function inspectLifecyclePreparation(response: Transaction, expectedXdr: string, networkPassphrase: string, maximum: bigint): Transaction {
  if (!(response instanceof Transaction) || response.networkPassphrase !== networkPassphrase) invalidPreparation("returned a different transaction type or network");
  // Keep the result independent from an RPC adapter that retains its response.
  const prepared = new Transaction(response.toXDR(), networkPassphrase);
  const expected = xdr.TransactionEnvelope.fromXDR(expectedXdr, "base64").v1().tx();
  const envelope = prepared.toEnvelope();
  if (envelope.switch().name !== "envelopeTypeTx" || envelope.v1().signatures().length !== 0) invalidPreparation("must return an unsigned v1 transaction");
  const body = envelope.v1().tx();
  if (body.ext().switch() !== 1) invalidPreparation("removed the Soroban transaction data");
  const data = body.ext().sorobanData();
  const fee = BigInt(prepared.fee);
  if (fee > maximum) throw new FuulError("FEE_LIMIT", "Lifecycle transaction exceeds maxFeeStroops", { feeStroops: prepared.fee, maxFeeStroops: maximum.toString() });
  if (data.resourceFee().toBigInt() < 0n || fee < data.resourceFee().toBigInt() + BigInt(expected.fee())) invalidPreparation("returned inconsistent resource and inclusion fees");
  const footprint = data.resources().footprint();
  const expectedFootprint = expected.ext().sorobanData().resources().footprint();
  const keys = (entries: xdr.LedgerKey[]) => entries.map(entry => entry.toXDR("base64")).sort();
  if (JSON.stringify(keys(footprint.readOnly())) !== JSON.stringify(keys(expectedFootprint.readOnly()))
    || JSON.stringify(keys(footprint.readWrite())) !== JSON.stringify(keys(expectedFootprint.readWrite()))) invalidPreparation("changed the requested ledger entries or their access classes");
  // Compare all other envelope fields, including source, sequence, conditions,
  // memo, operation count, operation sources, kind, and extension target.
  const comparison = xdr.Transaction.fromXDR(body.toXDR());
  comparison.fee(expected.fee()); comparison.ext(expected.ext());
  if (comparison.toXDR("base64") !== expected.toXDR("base64")) invalidPreparation("changed the requested transaction body");
  return prepared;
}

/** Build and simulate an explicit lifecycle transaction. No signature or submission occurs. */
export async function prepareLifecycleTransaction(rpc: Pick<Server, "getNetwork" | "getAccount" | "prepareTransaction">, input: {
  source: string; networkPassphrase: string; keys: readonly xdr.LedgerKey[];
  action: LifecycleRequest; maxFeeStroops: bigint; timeoutSeconds?: number;
}): Promise<Transaction> {
  // Snapshot the complete request before any RPC call can yield to application code.
  input = { ...input, keys: input.keys.map(key => xdr.LedgerKey.fromXDR(key.toXDR())), action: { ...input.action } };
  if (!StrKey.isValidEd25519PublicKey(input.source)) throw new TypeError("lifecycle source must be a Stellar account");
  if (!input.keys.length) throw new TypeError("lifecycle footprint must not be empty");
  if (typeof input.maxFeeStroops !== "bigint" || input.maxFeeStroops <= 0n) throw new RangeError("maxFeeStroops must be positive");
  const timeout = input.timeoutSeconds ?? 300;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) throw new RangeError("timeoutSeconds must be positive");
  const encoded = input.keys.map(key => key.toXDR("base64"));
  if (new Set(encoded).size !== encoded.length) throw new TypeError("lifecycle footprint contains duplicate keys");
  if (input.action.kind !== "restore" && input.action.kind !== "extend") throw new TypeError("lifecycle action must be restore or extend");
  for (const key of input.keys) {
    const kind = key.switch().name;
    if (kind !== "contractCode" && kind !== "contractData") {
      throw new TypeError("lifecycle operations require contract data or Wasm keys");
    }
    if (input.action.kind === "restore" && kind === "contractData" && key.contractData().durability().name !== "persistent") {
      throw new TypeError("restoration requires persistent contract data or Wasm keys");
    }
  }
  if ((await rpc.getNetwork()).passphrase !== input.networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "Lifecycle network does not match");
  const data = new SorobanDataBuilder();
  let operation: xdr.Operation;
  if (input.action.kind === "restore") {
    data.setReadWrite([...input.keys]); operation = Operation.restoreFootprint({});
  } else {
    if (!Number.isInteger(input.action.extendTo) || input.action.extendTo <= 0 || input.action.extendTo > 0xffff_ffff) throw new RangeError("extendTo must be a positive u32");
    data.setReadOnly([...input.keys]); operation = Operation.extendFootprintTtl({ extendTo: input.action.extendTo });
  }
  const account = await rpc.getAccount(input.source);
  if (account.accountId() !== input.source) invalidPreparation("returned a different source account");
  const transaction = new TransactionBuilder(new Account(input.source, account.sequenceNumber()), { fee: "100", networkPassphrase: input.networkPassphrase })
    .addOperation(operation).setSorobanData(data.build()).setTimeout(timeout).build();
  const expectedXdr = transaction.toXDR();
  return inspectLifecyclePreparation(await rpc.prepareTransaction(transaction), expectedXdr, input.networkPassphrase, input.maxFeeStroops);
}
