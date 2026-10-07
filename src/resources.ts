import { FeeBumpTransaction, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import type { Server } from "@stellar/stellar-sdk/rpc";
import { FuulError } from "./errors.js";

export type SorobanResource = "instructions" | "diskReadBytes" | "writeBytes" | "diskReadEntries"
  | "writeEntries" | "footprintEntries" | "transactionBytes" | "largestKeyBytes";
export interface SorobanResourceLimits {
  readonly networkPassphrase: string;
  /** Integer protocol version reported by the RPC. 27 or later is accepted; limits are read live. */
  readonly protocolVersion: number;
  readonly ledger: number;
  readonly maximum: Readonly<Record<SorobanResource, bigint>>;
}
export interface SorobanResourceReport {
  readonly hash: string;
  readonly limits: SorobanResourceLimits;
  readonly usage: Readonly<Record<SorobanResource, bigint>>;
  readonly violations: readonly { resource: SorobanResource; actual: string; maximum: string }[];
}
export type ResourceRpc = Pick<Server, "getNetwork" | "getLedgerEntries">;

const configNames = ["configSettingContractComputeV0", "configSettingContractLedgerCostV0",
  "configSettingContractLedgerCostExtV0", "configSettingContractBandwidthV0", "configSettingContractDataKeySizeBytes"] as const;
const names: readonly SorobanResource[] = ["instructions", "diskReadBytes", "writeBytes", "diskReadEntries",
  "writeEntries", "footprintEntries", "transactionBytes", "largestKeyBytes"];

function configError(message: string): never { throw new FuulError("RESOURCE_CONFIG", message); }
function invalid(message: string): never { throw new FuulError("INVALID_TRANSACTION", message); }
function ledger(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffff_ffff) configError("Resource settings have an invalid ledger");
}
function validateLimits(limits: SorobanResourceLimits): void {
  if (!Number.isInteger(limits.protocolVersion) || limits.protocolVersion < 27) configError("Resource checks require Protocol 27 or later");
  if (typeof limits.networkPassphrase !== "string" || !limits.networkPassphrase) configError("Resource settings have no network passphrase");
  ledger(limits.ledger);
  for (const name of names) {
    const value = limits.maximum[name];
    if (typeof value !== "bigint" || value < 0n || value > (name === "instructions" ? 0x7fff_ffff_ffff_ffffn : 0xffff_ffffn)) {
      configError(`Resource settings have an invalid ${name} maximum`);
    }
  }
}

/** Read the current network limits in one ledger-entry request. No cached limits or fallback constants.
 * Use createFuulRpcServer for HTTP deadlines. A report is an RPC observation, not a ledger membership proof.
 */
export async function readSorobanResourceLimits(rpc: ResourceRpc, networkPassphrase: string): Promise<SorobanResourceLimits> {
  const network = await rpc.getNetwork();
  if (network.passphrase !== networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "RPC network does not match the resource check");
  const reported = network.protocolVersion as unknown;
  const protocol = typeof reported === "number" ? reported
    : typeof reported === "string" && /^[1-9][0-9]{0,8}$/.test(reported) ? Number(reported) : Number.NaN;
  if (!Number.isInteger(protocol) || protocol < 27) configError("Resource checks require Protocol 27 or later");
  const keys = configNames.map(name => xdr.LedgerKey.configSetting(new xdr.LedgerKeyConfigSetting({ configSettingId: xdr.ConfigSettingId[name] })));
  const response = await rpc.getLedgerEntries(...keys);
  try {
    ledger(response.latestLedger);
    if (response.entries.length !== keys.length) configError("RPC omitted or duplicated resource settings");
    const values = new Map<string, xdr.ConfigSettingEntry>();
    const expected = new Set(keys.map(key => key.toXdr("base64")));
    for (const entry of response.entries) {
      const encoded = entry.key.toXdr("base64");
      if (!expected.delete(encoded) || entry.val.type !== "configSetting" || entry.key.type !== "configSetting") configError("RPC returned an unexpected resource setting");
      const setting = entry.val.configSetting;
      if (entry.key.configSetting.configSettingId.name !== setting.type) configError("Resource setting key and value disagree");
      if (entry.lastModifiedLedgerSeq !== undefined) {
        ledger(entry.lastModifiedLedgerSeq);
        if (entry.lastModifiedLedgerSeq > response.latestLedger) configError("Resource setting comes from a future ledger");
      }
      values.set(setting.type, setting);
    }
    const computeEntry = values.get(configNames[0])!;
    const costEntry = values.get(configNames[1])!;
    const extended = values.get(configNames[2])!;
    const bandwidth = values.get(configNames[3])!;
    const keySize = values.get(configNames[4])!;
    if (computeEntry.type !== configNames[0] || costEntry.type !== configNames[1] || extended.type !== configNames[2]
      || bandwidth.type !== configNames[3] || keySize.type !== configNames[4]) configError("Resource setting types disagree");
    const compute = computeEntry.contractCompute;
    const cost = costEntry.contractLedgerCost;
    const limits: SorobanResourceLimits = {
      networkPassphrase, protocolVersion: protocol, ledger: response.latestLedger,
      maximum: {
        instructions: compute.txMaxInstructions, diskReadBytes: BigInt(cost.txMaxDiskReadBytes),
        writeBytes: BigInt(cost.txMaxWriteBytes), diskReadEntries: BigInt(cost.txMaxDiskReadEntries),
        writeEntries: BigInt(cost.txMaxWriteLedgerEntries),
        footprintEntries: BigInt(extended.contractLedgerCostExt.txMaxFootprintEntries),
        transactionBytes: BigInt(bandwidth.contractBandwidth.txMaxSizeBytes),
        largestKeyBytes: BigInt(keySize.contractDataKeySizeBytes),
      },
    };
    validateLimits(limits);
    return Object.freeze({ ...limits, maximum: Object.freeze(limits.maximum) });
  } catch (cause) {
    if (cause instanceof FuulError) throw cause;
    throw new FuulError("RESOURCE_CONFIG", "RPC returned malformed resource settings", {}, { cause });
  }
}

function sorobanTransaction(transaction: Transaction | FeeBumpTransaction): Transaction | undefined {
  const inner = transaction instanceof FeeBumpTransaction ? transaction.innerTransaction : transaction;
  const operations = inner.operations;
  const isSoroban = operations.some(op => ["invokeHostFunction", "restoreFootprint", "extendFootprintTtl"].includes(op.type));
  const envelope = inner.toEnvelope();
  const hasData = envelope.type === "envelopeTypeTx" && envelope.v1.tx.ext.type === "sorobanData";
  if (!isSoroban && !hasData) return undefined;
  if (!isSoroban || operations.length !== 1 || !hasData) invalid("Soroban transaction must have one Soroban operation and resource data");
  return inner;
}
function persistent(key: xdr.LedgerKey): boolean {
  return key.type === "contractCode" || (key.type === "contractData" && key.contractData.durability.name === "persistent");
}

/** Inspect declared resources against a supplied snapshot. Classic transactions return undefined.
 * Core checks the inner signed envelope size for fee bumps. Memory and event bytes require simulation.
 * This check does not replace Core validation, authorization, fee calculation or simulation.
 */
export function inspectSorobanResources(transaction: Transaction | FeeBumpTransaction, limits: SorobanResourceLimits): SorobanResourceReport | undefined {
  validateLimits(limits);
  if (transaction.networkPassphrase !== limits.networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "Resource settings belong to a different network");
  const inner = sorobanTransaction(transaction);
  if (!inner) return undefined;
  const envelope = inner.toEnvelope();
  if (envelope.type !== "envelopeTypeTx" || envelope.v1.tx.ext.type !== "sorobanData") invalid("Missing Soroban transaction data");
  const data = envelope.v1.tx.ext.sorobanData, resources = data.resources;
  const read = resources.footprint.readOnly, write = resources.footprint.readWrite, footprint = [...read, ...write];
  const seen = new Set<string>();
  let largestKeyBytes = 0;
  for (const key of footprint) {
    if (!["account", "trustline", "contractData", "contractCode"].includes(key.type)) invalid("Soroban footprint contains an unsupported ledger key");
    const encoded = key.toXdr("base64");
    if (seen.has(encoded)) invalid("Soroban footprint contains a duplicate ledger key");
    seen.add(encoded);
    largestKeyBytes = Math.max(largestKeyBytes, key.toXdr().length);
  }
  const archived = data.ext.type === "resourceExt" ? data.ext.resourceExt.archivedSorobanEntries : [];
  let previous = -1;
  for (const index of archived) {
    if (index <= previous || index >= write.length || !persistent(write[index]!)) invalid("Soroban archived entry indexes must be sorted, unique and refer to persistent write entries");
    previous = index;
  }
  const restoring = inner.operations[0]!.type === "restoreFootprint";
  if (restoring && (read.length > 0 || write.some(key => !persistent(key)))) invalid("Restore footprint must contain only persistent write entries");
  if (inner.operations[0]!.type === "extendFootprintTtl" && (write.length > 0 || read.some(key => !["contractData", "contractCode"].includes(key.type)))) {
    invalid("TTL footprint must contain only Soroban read entries");
  }
  const diskReads = restoring ? write.length
    : footprint.filter(key => !["contractData", "contractCode"].includes(key.type)).length + archived.length;
  const usage = Object.freeze({
    instructions: BigInt(resources.instructions), diskReadBytes: BigInt(resources.diskReadBytes), writeBytes: BigInt(resources.writeBytes),
    diskReadEntries: BigInt(diskReads), writeEntries: BigInt(write.length), footprintEntries: BigInt(footprint.length),
    transactionBytes: BigInt(inner.toEnvelope().toXdr().length), largestKeyBytes: BigInt(largestKeyBytes),
  });
  const snapshot = Object.freeze({ ...limits, maximum: Object.freeze({ ...limits.maximum }) });
  const violations = names.filter(name => usage[name] > snapshot.maximum[name])
    .map(resource => Object.freeze({ resource, actual: usage[resource].toString(), maximum: snapshot.maximum[resource].toString() }));
  return Object.freeze({ hash: Buffer.from(transaction.hash()).toString("hex"), limits: snapshot, usage, violations: Object.freeze(violations) });
}

/** Read current limits and reject an oversized transaction without signing or submitting it.
 * The exact envelope is captured before RPC reads. Recheck after adding signatures or a wallet delay.
 */
export async function checkSorobanResources(rpc: ResourceRpc, transaction: Transaction | FeeBumpTransaction, minimumLedger = 1): Promise<SorobanResourceReport | undefined> {
  ledger(minimumLedger);
  const snapshot = TransactionBuilder.fromXdr(transaction.toXdr(), transaction.networkPassphrase);
  if (!sorobanTransaction(snapshot)) return undefined;
  const limits = await readSorobanResourceLimits(rpc, snapshot.networkPassphrase);
  if (limits.ledger < minimumLedger) configError("Resource settings are older than the transaction simulation");
  const report = inspectSorobanResources(snapshot, limits)!;
  const first = report.violations[0];
  if (first) throw new FuulError("RESOURCE_LIMIT", `Soroban ${first.resource} exceeds the network maximum`, { ...first, hash: report.hash });
  return report;
}
