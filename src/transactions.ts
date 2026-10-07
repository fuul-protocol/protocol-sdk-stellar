import { authorizeEntry, FeeBumpTransaction, inspectAuthEntry, Keypair, StrKey, Transaction, TransactionBuilder } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { KeypairSigner, type AssembledTransaction, type ClientOptions, type SignAuthEntry, type SignTransaction } from "@stellar/stellar-sdk/contract";
import { Api, assembleTransaction, type Server } from "@stellar/stellar-sdk/rpc";
import { FuulError, parseContractError } from "./errors.js";
import { checkSorobanResources } from "./resources.js";
import type { ExpectedAuthorization } from "./authorization.js";

export interface ConfirmationOptions {
  /** Network identity for standalone confirmation. Required by waitForTransaction. */
  networkPassphrase?: string;
  /** Bounds each preparation read and the shared submission/confirmation phase. Wallet review has no time limit. */
  timeoutMs?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
}
export interface ExecutionOptions extends ConfirmationOptions {
  /** Explicit consent for custom arguments or nested calls. Never derive this list from RPC authorization entries. */
  authorizations?: readonly ExpectedAuthorization[];
}
export interface SubmissionOptions extends ConfirmationOptions {
  /** Reject Soroban settings older than the simulation or a prior resource check. */
  minimumResourceLedger?: number;
}
export type TransactionRpc = Pick<Server, "sendTransaction" | "getTransaction" | "getNetwork" | "getLedgerEntries">;
export type ConfirmedTransaction = Api.GetSuccessfulTransactionResponse;

function positive(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) throw new RangeError(`${label} must be an integer from 1 to 2147483647`);
}
function settings(options: ConfirmationOptions) {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const interval = options.pollIntervalMs ?? 1_000;
  positive(timeoutMs, "timeoutMs"); positive(interval, "pollIntervalMs");
  return { timeoutMs, interval };
}
class RequestDeadlineError extends Error {}

function boundedRequest<T>(request: Promise<T>, timeoutMs: number | undefined, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { cleanup(); reject(new Error("RPC request cancelled")); };
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => { cleanup(); reject(new RequestDeadlineError("RPC request deadline exceeded")); }, Math.max(1, timeoutMs));
    signal?.addEventListener("abort", cancel, { once: true });
    request.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) cancel();
  });
}
function aborted(signal?: AbortSignal, hash?: string): void {
  if (signal?.aborted) throw new FuulError(hash ? "OUTCOME_UNKNOWN" : "ABORTED", hash ? "Confirmation cancelled; transaction outcome is unknown" : "Operation cancelled before submission", { hash });
}

function assertUnexpired(transaction: Transaction | FeeBumpTransaction): void {
  const inner = transaction instanceof FeeBumpTransaction ? transaction.innerTransaction : transaction;
  if (!inner.timeBounds || BigInt(inner.timeBounds.maxTime) <= BigInt(Math.floor(Date.now() / 1000))) throw new FuulError("INVALID_TRANSACTION", "Transaction must have a finite, unexpired time bound");
}

/** A late preparation or wallet result cannot resume execution after cancellation. */
async function beforeSubmission<T>(start: () => Promise<T>, timeoutMs: number | undefined, signal?: AbortSignal): Promise<T> {
  aborted(signal);
  try {
    const result = await boundedRequest(start(), timeoutMs, signal);
    aborted(signal);
    return result;
  } catch (cause) {
    aborted(signal);
    if (cause instanceof RequestDeadlineError) throw new FuulError("NETWORK_ERROR", "Transaction preparation timed out; the executor did not submit a transaction", {}, { cause });
    throw cause;
  }
}
async function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const done = () => { clearTimeout(timer); signal?.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Poll a known transaction hash. This function never submits a transaction. */
export async function waitForTransaction(rpc: Pick<Server, "getTransaction">, hash: string, options: ConfirmationOptions & { networkPassphrase: string }): Promise<ConfirmedTransaction> {
  options = { ...options };
  if (!options.networkPassphrase) throw new TypeError("networkPassphrase is required for transaction confirmation");
  if (typeof hash !== "string" || !/^[a-f0-9]{64}$/i.test(hash)) throw new TypeError("hash must contain 32 hexadecimal bytes");
  const { timeoutMs, interval } = settings(options);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    aborted(options.signal, hash);
    let response: Api.GetTransactionResponse;
    try { response = await boundedRequest(rpc.getTransaction(hash), deadline - Date.now(), options.signal); }
    catch (error) { lastError = error; await delay(Math.min(interval, Math.max(0, deadline - Date.now())), options.signal); continue; }
    if (!response || (response.txHash !== undefined && (typeof response.txHash !== "string" || response.txHash.toLowerCase() !== hash.toLowerCase()))) throw new FuulError("OUTCOME_UNKNOWN", "RPC returned an invalid transaction observation", { hash });
    if (response.status === Api.GetTransactionStatus.SUCCESS || response.status === Api.GetTransactionStatus.FAILED) {
      if (typeof response.txHash !== "string" || !Number.isInteger(response.ledger) || response.ledger < 1 || response.ledger > 0xffff_ffff) throw new FuulError("OUTCOME_UNKNOWN", "RPC transaction result is missing its hash or valid ledger", { hash });
      // The RPC client echoes the requested hash, so bind the observation to the returned envelope itself.
      if (options.networkPassphrase !== undefined) {
        let observed: string | undefined;
        try {
          const envelope = TransactionBuilder.fromXdr(response.envelopeXdr, options.networkPassphrase);
          observed = Buffer.from(envelope.hash()).toString("hex");
          if (observed !== hash.toLowerCase() && envelope instanceof FeeBumpTransaction) observed = Buffer.from(envelope.innerTransaction.hash()).toString("hex");
        } catch { observed = undefined; }
        if (observed !== hash.toLowerCase()) throw new FuulError("OUTCOME_UNKNOWN", "RPC returned a different transaction for the requested hash", { hash });
      }
    }
    if (response.status === Api.GetTransactionStatus.SUCCESS) return response;
    if (response.status === Api.GetTransactionStatus.FAILED) throw new FuulError("TRANSACTION_FAILED", "Transaction failed on chain", { hash }, { cause: response });
    await delay(Math.min(interval, Math.max(0, deadline - Date.now())), options.signal);
  }
  aborted(options.signal, hash);
  throw new FuulError("OUTCOME_UNKNOWN", "Transaction confirmation timed out; query the hash before retrying", { hash }, { cause: lastError });
}

/** Submit exactly once. Network errors retain the hash for confirmation recovery. */
export async function submitSignedTransaction(rpc: TransactionRpc, transaction: Transaction | FeeBumpTransaction, options: SubmissionOptions = {}): Promise<ConfirmedTransaction> {
  options = { ...options };
  const { timeoutMs } = settings(options);
  aborted(options.signal);
  transaction = TransactionBuilder.fromXdr(transaction.toXdr(), transaction.networkPassphrase);
  let network: Awaited<ReturnType<TransactionRpc["getNetwork"]>>;
  try { network = await boundedRequest(rpc.getNetwork(), timeoutMs, options.signal); }
  catch (cause) {
    aborted(options.signal);
    throw new FuulError("NETWORK_ERROR", "RPC network identity could not be read; no transaction was submitted", {}, { cause });
  }
  if (network.passphrase !== transaction.networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "RPC network does not match the transaction");
  if (!transaction.signatures.length) throw new FuulError("INVALID_TRANSACTION", "Transaction has no envelope signatures");
  await beforeSubmission(() => checkSorobanResources(rpc, transaction, options.minimumResourceLedger), timeoutMs, options.signal);
  const hash = Buffer.from(transaction.hash()).toString("hex");
  aborted(options.signal);
  const deadline = Date.now() + timeoutMs;
  let response: Api.SendTransactionResponse;
  try { response = await boundedRequest(rpc.sendTransaction(transaction), timeoutMs, options.signal); }
  catch (cause) { throw new FuulError("OUTCOME_UNKNOWN", "Submission response was lost; query the hash before retrying", { hash }, { cause }); }
  if (typeof response?.hash !== "string" || response.hash.toLowerCase() !== hash) throw new FuulError("OUTCOME_UNKNOWN", "Submission did not return the expected transaction hash", { hash });
  if (response.status !== "PENDING" && response.status !== "DUPLICATE") {
    if (response.status !== "ERROR" && response.status !== "TRY_AGAIN_LATER") throw new FuulError("OUTCOME_UNKNOWN", "RPC returned an unknown submission status", { hash });
    throw new FuulError("OUTCOME_UNKNOWN", `Submission reply is ${response.status}; reconcile the hash before retrying`, { hash, status: response.status }, { cause: response });
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new FuulError("OUTCOME_UNKNOWN", "Submission deadline exceeded; query the hash before retrying", { hash });
  return waitForTransaction(rpc, hash, { ...options, timeoutMs: remaining, networkPassphrase: transaction.networkPassphrase });
}

export interface FuulSigner {
  address: string;
  signTransaction: SignTransaction;
  signAuthEntry?: ClientOptions["signAuthEntry"];
}

/** Adapt an in-memory test or backend keypair. The key is never serialized or logged. */
export function keypairSigner(keypair: Keypair): FuulSigner {
  if (!keypair.canSign()) throw new TypeError("keypair must contain signing material");
  const address = keypair.publicKey();
  // Authorization preimages already contain their network ID. Keep the keypair private.
  const authorizationSigner = new KeypairSigner(keypair, "");
  return {
    address,
    async signAuthEntry(preimage, options) {
      if (options?.address !== address) throw new FuulError("INVALID_TRANSACTION", "Authorization signer address does not match");
      return authorizationSigner.signAuthEntry(preimage, options);
    },
    async signTransaction(envelope, options) {
      if (!options?.networkPassphrase || options.address !== address || options.submit) throw new FuulError("INVALID_TRANSACTION", "Invalid signer network, account, or submission request");
      const transaction = TransactionBuilder.fromXdr(envelope, options.networkPassphrase);
      transaction.sign(keypair);
      return { signedTxXdr: transaction.toXdr(), signerAddress: address };
    },
  };
}

/** Sign an inspected envelope, including a separately prepared restore or TTL transaction. */
export function signPreparedTransaction(transaction: Transaction, signer: FuulSigner, maxFeeStroops: bigint): Promise<Transaction>;
export function signPreparedTransaction(transaction: FeeBumpTransaction, signer: FuulSigner, maxFeeStroops: bigint): Promise<FeeBumpTransaction>;
export async function signPreparedTransaction(transaction: Transaction | FeeBumpTransaction, signer: FuulSigner, maxFeeStroops: bigint): Promise<Transaction | FeeBumpTransaction> {
  const signerAddress = signer.address;
  const source = transaction instanceof FeeBumpTransaction ? transaction.feeSource : transaction.source;
  const inner = transaction instanceof FeeBumpTransaction ? transaction.innerTransaction : transaction;
  if (source !== signerAddress) throw new FuulError("INVALID_TRANSACTION", "Transaction source does not match the signer");
  if (typeof maxFeeStroops !== "bigint" || maxFeeStroops <= 0n) throw new RangeError("maxFeeStroops must be positive");
  if (BigInt(transaction.fee) > maxFeeStroops) throw new FuulError("FEE_LIMIT", "Transaction exceeds maxFeeStroops");
  assertUnexpired(transaction);
  if (transaction instanceof FeeBumpTransaction && !inner.signatures.length) throw new FuulError("INVALID_TRANSACTION", "Fee-bump inner transaction must already be signed");
  // Snapshot before awaiting a wallet callback; do not trust a mutable caller-owned object.
  const envelope = transaction.toXdr();
  const expectedHash = transaction.hash();
  const existingSignatures = transaction.signatures.map(signature => signature.toXdr("base64"));
  const networkPassphrase = transaction.networkPassphrase;
  const signed = await signer.signTransaction(envelope, { networkPassphrase, address: signerAddress, submit: false });
  if (signed.error) throw new FuulError("WALLET_REJECTED", "Wallet declined to sign the transaction", {}, { cause: signed.error });
  if (signed.signerAddress !== undefined && signed.signerAddress !== signerAddress) throw new FuulError("WALLET_MUTATION", "Wallet returned a different signer account");
  let result: Transaction | FeeBumpTransaction;
  try { result = decodeCosigningEnvelope(signed.signedTxXdr, networkPassphrase); }
  catch (cause) { throw new FuulError("WALLET_MUTATION", "Wallet returned an invalid transaction envelope", {}, { cause }); }
  if (result.toEnvelope().type !== transaction.toEnvelope().type || !Buffer.from(result.hash()).equals(Buffer.from(expectedHash))) throw new FuulError("WALLET_MUTATION", "Wallet changed the prepared transaction body");
  const returnedSignatures = result.signatures.map(signature => signature.toXdr("base64"));
  for (const signature of existingSignatures) {
    const index = returnedSignatures.indexOf(signature);
    if (index < 0) throw new FuulError("WALLET_MUTATION", "Wallet removed an existing envelope signature");
    returnedSignatures.splice(index, 1);
  }
  if (!returnedSignatures.length) throw new FuulError("INVALID_TRANSACTION", "Wallet returned an unsigned envelope");
  if (returnedSignatures.length !== 1 || result.signatures.length > 20) throw new FuulError("WALLET_MUTATION", "Wallet must add exactly one signature within the envelope limit");
  // An account source must contribute at least one signature that verifies for the signer's own key.
  if (StrKey.isValidEd25519PublicKey(signerAddress)) {
    const key = Keypair.fromPublicKey(signerAddress);
    const hint = key.rawPublicKey().subarray(-4);
    const added = result.signatures.filter(signature => returnedSignatures.includes(signature.toXdr("base64")));
    if (!added.some(signature => Buffer.from(signature.hint.toBytes()).equals(Buffer.from(hint)) && signature.signature.toBytes().length === 64 && key.verify(expectedHash, signature.signature.toBytes()))) {
      throw new FuulError("WALLET_MUTATION", "Wallet did not add a valid signature from the signer account");
    }
  }
  assertUnexpired(result);
  return result;
}

export interface CosignOptions {
  /** Reviewed transaction source, or the outer fee source for a fee-bump envelope. */
  expectedSource: string;
  /** Reviewed transaction hash, including the network ID and complete transaction body. */
  expectedHash: string;
  /** Complete transaction fee ceiling, including resource fees. */
  maxFeeStroops: bigint;
  /** Cancel local collection. A late wallet response cannot complete this call. */
  signal?: AbortSignal;
}

/**
 * Collect one Ed25519 account signature without requiring the signer to be the source.
 * This verifies signature integrity, not the account's on-chain signer weights or thresholds.
 * The function makes no RPC call and never submits. Existing signatures keep their exact order.
 */
export function cosignPreparedTransaction(transaction: Transaction, signer: FuulSigner, options: CosignOptions): Promise<Transaction>;
export function cosignPreparedTransaction(transaction: FeeBumpTransaction, signer: FuulSigner, options: CosignOptions): Promise<FeeBumpTransaction>;
export async function cosignPreparedTransaction(
  transaction: Transaction | FeeBumpTransaction, signer: FuulSigner, options: CosignOptions,
): Promise<Transaction | FeeBumpTransaction> {
  options = { ...options };
  aborted(options.signal);
  if (typeof options.expectedHash !== "string" || !/^[a-f0-9]{64}$/.test(options.expectedHash)) throw new TypeError("expectedHash must be the lowercase reviewed transaction hash");
  if (typeof options.maxFeeStroops !== "bigint" || options.maxFeeStroops <= 0n) throw new RangeError("maxFeeStroops must be positive");
  const address = signer.address;
  if (typeof address !== "string" || !StrKey.isValidEd25519PublicKey(address)) throw new TypeError("Cosigner address must be an Ed25519 account public key");
  if (typeof signer.signTransaction !== "function") throw new TypeError("Cosigner must provide signTransaction");
  const sign = signer.signTransaction.bind(signer);
  const passphrase = transaction.networkPassphrase;
  const original = decodeCosigningEnvelope(transaction.toXdr(), passphrase);
  const source = original instanceof FeeBumpTransaction ? original.feeSource : original.source;
  if (typeof options.expectedSource !== "string" || options.expectedSource !== source) throw new FuulError("INVALID_TRANSACTION", "Transaction source differs from the reviewed source");
  if (Buffer.from(original.hash()).toString("hex") !== options.expectedHash) throw new FuulError("INVALID_TRANSACTION", "Transaction differs from the reviewed hash");
  if (BigInt(original.fee) > options.maxFeeStroops) throw new FuulError("FEE_LIMIT", "Transaction exceeds maxFeeStroops");
  assertUnexpired(original);
  if (original instanceof FeeBumpTransaction && !original.innerTransaction.signatures.length) throw new FuulError("INVALID_TRANSACTION", "Fee-bump inner transaction must already be signed");
  const key = Keypair.fromPublicKey(address);
  const expectedHint = key.rawPublicKey().subarray(-4);
  const hash = original.hash();
  const valid = (signature: typeof original.signatures[number]) => Buffer.from(signature.hint.toBytes()).equals(Buffer.from(expectedHint))
    && signature.signature.toBytes().length === 64 && key.verify(hash, signature.signature.toBytes());
  if (original.signatures.length >= 20) throw new FuulError("INVALID_TRANSACTION", "Transaction has no room for another envelope signature");
  if (original.signatures.some(valid)) throw new FuulError("INVALID_TRANSACTION", "This account already signed the envelope");
  const existing = original.signatures.map(signature => signature.toXdr("base64"));
  const envelope = original.toXdr();
  const signed = await beforeSubmission(() => sign(envelope, { networkPassphrase: passphrase, address, submit: false }), undefined, options.signal);
  if (signed?.error) throw new FuulError("WALLET_REJECTED", "Wallet declined to cosign the transaction", {}, { cause: signed.error });
  if (!signed || (signed.signerAddress !== undefined && signed.signerAddress !== address)) throw new FuulError("WALLET_MUTATION", "Wallet returned a different cosigner account");
  let result: Transaction | FeeBumpTransaction;
  try { result = decodeCosigningEnvelope(signed.signedTxXdr, passphrase); }
  catch (cause) { throw new FuulError("WALLET_MUTATION", "Wallet returned an invalid transaction envelope", {}, { cause }); }
  if (result.toEnvelope().type !== original.toEnvelope().type || !Buffer.from(result.hash()).equals(Buffer.from(hash))) throw new FuulError("WALLET_MUTATION", "Wallet changed the reviewed transaction body");
  if (result.signatures.length !== existing.length + 1
    || existing.some((signature, index) => result.signatures[index]?.toXdr("base64") !== signature)) {
    throw new FuulError("WALLET_MUTATION", "Wallet must preserve existing signatures and append exactly one signature");
  }
  if (!valid(result.signatures.at(-1)!)) throw new FuulError("WALLET_MUTATION", "Wallet did not add a valid signature from the selected cosigner");
  assertUnexpired(result);
  aborted(options.signal);
  return result;
}

function decodeCosigningEnvelope(value: unknown, passphrase: string): Transaction | FeeBumpTransaction {
  if (typeof value !== "string" || value.length === 0 || value.length > 2 * 1024 * 1024
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
    || Buffer.from(value, "base64").toString("base64") !== value) throw new TypeError("Cosigning requires bounded canonical base64 XDR");
  const transaction = TransactionBuilder.fromXdr(value, passphrase);
  if (transaction.toXdr() !== value) throw new TypeError("Cosigning requires canonical envelope XDR");
  return transaction;
}

export interface ExecutorOptions {
  rpc: Server;
  networkPassphrase: string;
  signer: FuulSigner;
  /** Maximum complete transaction fee in stroops, including Soroban resources. */
  maxFeeStroops: bigint;
  authorizationSigners?: readonly Pick<FuulSigner, "address" | "signAuthEntry">[];
}
export interface TransactionReceipt<T> {
  hash: string;
  ledger: number;
  result: T;
  transaction: ConfirmedTransaction;
}

function authorizationCallback(owner: Pick<FuulSigner, "signAuthEntry">): SignAuthEntry | undefined {
  const candidate = owner.signAuthEntry;
  if (typeof candidate === "function") return candidate.bind(owner);
  if (candidate instanceof Keypair) return new KeypairSigner(candidate, "").signAuthEntry;
  return candidate?.signAuthEntry?.bind(candidate);
}

/** Queue simulations and submissions for one source account within this process. */
export class TransactionExecutor {
  private tail: Promise<unknown> = Promise.resolve();
  private unresolvedHash?: string;
  private pendingWindow?: { hash: string; firstLedger: number; maxTime: number };
  private readonly options: ExecutorOptions;
  constructor(options: ExecutorOptions) {
    if (!StrKey.isValidEd25519PublicKey(options.signer.address)) throw new TypeError("source signer must be a Stellar account");
    if (typeof options.maxFeeStroops !== "bigint" || options.maxFeeStroops <= 0n) throw new RangeError("maxFeeStroops must be a positive bigint");
    this.options = {
      ...options,
      signer: { address: options.signer.address, signTransaction: options.signer.signTransaction.bind(options.signer), signAuthEntry: authorizationCallback(options.signer) },
      authorizationSigners: options.authorizationSigners?.map(signer => ({ address: signer.address, signAuthEntry: authorizationCallback(signer) })),
    };
  }
  execute<T>(build: () => Promise<AssembledTransaction<T>>, confirmation: ExecutionOptions = {}): Promise<TransactionReceipt<T>> {
    confirmation = { ...confirmation, authorizations: confirmation.authorizations?.map(item => ({ ...item })) };
    const pending = this.tail.then(() => this.run(build, confirmation)).catch(error => {
      if (error instanceof FuulError && error.code === "OUTCOME_UNKNOWN" && error.details.hash) this.unresolvedHash = error.details.hash;
      throw error;
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  /** A submitted transaction whose final outcome must be resolved before another builder can run. */
  get pendingTransactionHash(): string | undefined { return this.unresolvedHash; }

  /** Resolve inclusion or prove expiry within the RPC's complete retained ledger window. */
  reconcilePending(confirmation: ConfirmationOptions = {}): Promise<ConfirmedTransaction | undefined> {
    confirmation = { ...confirmation };
    const pending = this.tail.then(async () => {
      const hash = this.unresolvedHash;
      if (!hash) return undefined;
      const { timeoutMs } = settings(confirmation);
      aborted(confirmation.signal, hash);
      let network: Awaited<ReturnType<Server["getNetwork"]>>;
      try { network = await boundedRequest(this.options.rpc.getNetwork(), timeoutMs, confirmation.signal); }
      catch (cause) { throw new FuulError("OUTCOME_UNKNOWN", "Network identity could not be checked while reconciling the pending transaction", { hash }, { cause }); }
      if (network.passphrase !== this.options.networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "RPC network does not match the configured network", { hash });
      try {
        const transaction = await waitForTransaction(this.options.rpc, hash, { ...confirmation, networkPassphrase: this.options.networkPassphrase });
        this.unresolvedHash = undefined;
        this.pendingWindow = undefined;
        return transaction;
      } catch (error) {
        if (error instanceof FuulError && error.code === "TRANSACTION_FAILED") {
          this.unresolvedHash = undefined;
          this.pendingWindow = undefined;
        } else if (error instanceof FuulError && error.code === "OUTCOME_UNKNOWN" && !confirmation.signal?.aborted) {
          const window = this.pendingWindow;
          const observation = await boundedRequest(this.options.rpc.getTransaction(hash), timeoutMs, confirmation.signal);
          if (window?.hash === hash && observation.status === Api.GetTransactionStatus.NOT_FOUND
            && observation.txHash === hash
            && Number.isSafeInteger(observation.oldestLedger) && observation.oldestLedger > 0 && observation.oldestLedger <= window.firstLedger
            && Number.isSafeInteger(observation.latestLedger) && observation.latestLedger >= window.firstLedger
            && ledgerTimestamp(observation.latestLedgerCloseTime) > window.maxTime) {
            this.unresolvedHash = undefined;
            this.pendingWindow = undefined;
            throw new FuulError("TRANSACTION_EXPIRED", "Transaction expired without inclusion in the retained ledger window", { hash });
          }
        }
        throw error;
      }
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }
  private async run<T>(build: () => Promise<AssembledTransaction<T>>, confirmation: ExecutionOptions): Promise<TransactionReceipt<T>> {
    if (this.unresolvedHash) throw new FuulError("OUTCOME_UNKNOWN", "A previous submission remains unresolved; call reconcilePending before another transaction", { hash: this.unresolvedHash });
    const { timeoutMs } = settings(confirmation);
    const { rpc, signer, networkPassphrase, maxFeeStroops } = this.options;
    aborted(confirmation.signal);
    let network: Awaited<ReturnType<Server["getNetwork"]>>;
    try { network = await boundedRequest(rpc.getNetwork(), timeoutMs, confirmation.signal); }
    catch (cause) {
      aborted(confirmation.signal);
      throw new FuulError("NETWORK_ERROR", "RPC network identity could not be read; no transaction was prepared", {}, { cause });
    }
    if (network.passphrase !== networkPassphrase) throw new FuulError("NETWORK_MISMATCH", "RPC network does not match the configured network");
    let assembled: AssembledTransaction<T>;
    try {
      assembled = await beforeSubmission(build, timeoutMs, confirmation.signal);
      // Reject failed simulations, archived state, and incompatible results before signing.
      void assembled.simulationData;
      void assembled.result;
    } catch (cause) { throw parseContractError(cause) ?? cause; }
    if (assembled.options.networkPassphrase !== networkPassphrase || assembled.options.publicKey !== signer.address) throw new FuulError("INVALID_TRANSACTION", "Prepared call uses a different network or source account");
    if (assembled.options.signTransaction || assembled.options.signAuthEntry || assembled.options.restore) throw new FuulError("INVALID_TRANSACTION", "Build calls without signing callbacks or automatic restoration");
    const parseResult = assembled.options.parseResultXdr.bind({ ...assembled.options });
    let unsigned = TransactionBuilder.fromXdr(assembled.toXdr(), networkPassphrase);
    if (!(unsigned instanceof Transaction)) throw new FuulError("INVALID_TRANSACTION", "Expected a regular contract transaction");
    this.checkTransaction(unsigned, maxFeeStroops);
    // Authorization callbacks can yield to code that still owns `assembled`.
    // Keep its body, authorization trees, and parser private from this point.
    unsigned = await this.authorizeTransaction(unsigned, confirmation, assembled.simulation?.latestLedger);
    // Verify actual authorization signatures and refresh their resource requirements.
    const enforced = await beforeSubmission(() => rpc.simulateTransaction(unsigned, undefined, "enforce"), timeoutMs, confirmation.signal);
    if (Api.isSimulationError(enforced)) throw parseContractError(enforced.error)
      ?? new FuulError("SIMULATION_FAILED", "Signed authorization failed simulation", {}, { cause: enforced.error });
    if (Api.isSimulationRestore(enforced)) throw new FuulError("RESTORATION_REQUIRED", "Contract state must be restored before signing this transaction");
    if (!Api.isSimulationSuccess(enforced)) throw new FuulError("SIMULATION_FAILED", "RPC did not return a successful authorization simulation");
    if (!enforced.result) throw new FuulError("SIMULATION_FAILED", "Contract simulation returned no result");
    parseResult(enforced.result.retval);
    const approvedAuth = authorizationBytes(unsigned);
    unsigned = assembleTransaction(unsigned, enforced).build();
    if (authorizationBytes(unsigned) !== approvedAuth) throw new FuulError("INVALID_TRANSACTION", "RPC changed the approved authorization entries");
    this.checkTransaction(unsigned, maxFeeStroops);
    const resourceReport = await beforeSubmission(() => checkSorobanResources(rpc, unsigned, enforced.latestLedger), timeoutMs, confirmation.signal);
    aborted(confirmation.signal);
    // Wallet review can take longer than an RPC deadline. Cancellation still
    // releases the queue and prevents a late signed envelope from being sent.
    const transaction = await beforeSubmission(() => signPreparedTransaction(unsigned, signer, maxFeeStroops), undefined, confirmation.signal);
    const hash = Buffer.from(transaction.hash()).toString("hex");
    this.pendingWindow = { hash, firstLedger: enforced.latestLedger, maxTime: Number(transaction.timeBounds!.maxTime) };
    let confirmed: ConfirmedTransaction;
    try {
      confirmed = await submitSignedTransaction(rpc, transaction, { ...confirmation, minimumResourceLedger: resourceReport?.limits.ledger });
    } catch (error) {
      if (!(error instanceof FuulError && error.code === "OUTCOME_UNKNOWN")) this.pendingWindow = undefined;
      throw error;
    }
    this.pendingWindow = undefined;
    try {
      if (!confirmed.returnValue) throw new Error("Confirmed contract transaction has no return value");
      return { hash, ledger: confirmed.ledger, result: parseResult(confirmed.returnValue), transaction: confirmed };
    } catch (cause) {
      throw new FuulError("RESULT_DECODE_FAILED", "Transaction succeeded, but its result could not be decoded; do not resubmit", { hash }, { cause });
    }
  }
  private async authorizeTransaction(transaction: Transaction, confirmation: ExecutionOptions, simulationLedger?: number): Promise<Transaction> {
    const envelope = transaction.toEnvelope();
    // Soroban transactions use the v1 envelope. Leave other regular envelopes
    // to the existing simulation and assembly validation when they have no auth.
    if (envelope.type !== "envelopeTypeTx") return transaction;
    const entries = envelope.v1.tx.operations.flatMap(operation => {
      const body = operation.body;
      if (body.type !== "invokeHostFunction") return [];
      const invocation = body.invokeHostFunctionOp;
      return invocation.auth.map((entry, index) => ({ entry, index, operation: invocation }));
    });
    const pending = entries.map(item => ({ ...item, info: inspectAuthEntry(item.entry) }))
      .filter(item => item.info.address !== null && !item.info.signers[0]!.signed);
    // Validate the complete batch before a signature can leave this process.
    const expected = [...(confirmation.authorizations ?? [])];
    const implicit = new Set<string>();
    for (const item of pending) {
      const address = item.info.address!;
      const invocation = item.entry.rootInvocation;
      const host = item.operation.hostFunction;
      if (host.type !== "hostFunctionTypeInvokeContract" || invocation.function.type !== "sorobanAuthorizedFunctionTypeContractFn") {
        throw new FuulError("INVALID_TRANSACTION", "Unexpected authorization function");
      }
      const call = host.invokeContract;
      const root = invocation.function.contractFn;
      if (!Buffer.from(root.contractAddress.toXdr()).equals(Buffer.from(call.contractAddress.toXdr())) || root.functionName.toString() !== call.functionName.toString()) {
        throw new FuulError("INVALID_TRANSACTION", "Authorization targets a different contract or function");
      }
      const match = expected.findIndex(value => value.address === address && value.invocation === invocation.toXdr("base64"));
      if (match >= 0) { expected.splice(match, 1); continue; }
      const exact = address !== this.options.signer.address && !implicit.has(address)
        && invocation.subInvocations.length === 0 && Buffer.from(root.toXdr()).equals(Buffer.from(call.toXdr()));
      if (!exact || confirmation.authorizations !== undefined) throw new FuulError("INVALID_TRANSACTION", "Authorization is outside the application's declared intent");
      implicit.add(address);
    }
    const auth = new Map((this.options.authorizationSigners ?? []).map(item => [item.address, item]));
    auth.set(this.options.signer.address, this.options.signer);
    const { timeoutMs } = settings(confirmation);
    for (const address of new Set(pending.map(item => item.info.address!))) {
      const authorization = auth.get(address);
      const signAuthEntry = authorization && authorizationCallback(authorization);
      if (!signAuthEntry) throw new FuulError("MISSING_SIGNER", `Missing authorization signer for ${address}`);
      aborted(confirmation.signal);
      let ledger: Awaited<ReturnType<Server["getLatestLedger"]>>;
      try { ledger = await boundedRequest(this.options.rpc.getLatestLedger(), timeoutMs, confirmation.signal); }
      catch (cause) {
        aborted(confirmation.signal);
        throw new FuulError("NETWORK_ERROR", "Authorization ledger could not be read; no transaction was submitted", {}, { cause });
      }
      if (!Number.isInteger(ledger.sequence) || ledger.sequence < 1 || ledger.sequence > 0xffff_ffff - 100) throw new FuulError("INVALID_TRANSACTION", "Authorization requires a valid ledger sequence");
      if (!Number.isInteger(simulationLedger) || ledger.sequence < simulationLedger! || ledger.sequence > simulationLedger! + 12) throw new FuulError("INVALID_TRANSACTION", "Authorization ledger is inconsistent with simulation");
      for (const item of pending.filter(item => item.info.address === address)) {
        aborted(confirmation.signal);
        const signed = await authorizeEntry(item.entry, async preimage => {
          const result = await beforeSubmission(() => signAuthEntry(preimage.toXdr("base64"), { address }), undefined, confirmation.signal);
          if (result.error) throw new FuulError("WALLET_REJECTED", "Wallet declined to authorize the transaction", {}, { cause: result.error });
          return Buffer.from(result.signedAuthEntry, "base64");
        }, ledger.sequence + 100, this.options.networkPassphrase);
        item.operation.auth[item.index] = signed;
      }
    }
    return new Transaction(envelope, this.options.networkPassphrase);
  }
  private checkTransaction(transaction: Transaction, maximum: bigint): void {
    if (transaction.source !== this.options.signer.address) throw new FuulError("INVALID_TRANSACTION", "Transaction source does not match the signer");
    if (BigInt(transaction.fee) > maximum) throw new FuulError("FEE_LIMIT", "Prepared transaction exceeds maxFeeStroops", { feeStroops: transaction.fee, maxFeeStroops: maximum.toString() });
    assertUnexpired(transaction);
  }
}

function authorizationBytes(transaction: Transaction): string {
  return transaction.operations.map(operation => operation.type === "invokeHostFunction"
    ? (operation.auth ?? []).map(entry => entry.toXdr("base64")).join(",") : "").join(";");
}

function ledgerTimestamp(value: unknown): number {
  // RPC timestamps can be decimal strings despite the upstream TypeScript declaration.
  if (typeof value === "string" && /^(0|[1-9][0-9]{0,15})$/.test(value)) value = Number(value);
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : -1;
}
