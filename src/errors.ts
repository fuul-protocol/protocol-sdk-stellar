export type FuulErrorCode =
  | "NETWORK_MISMATCH" | "NETWORK_ERROR" | "INVALID_TRANSACTION" | "FEE_LIMIT" | "MISSING_SIGNER"
  | "WALLET_REJECTED" | "WALLET_MUTATION" | "SUBMISSION_REJECTED"
  | "OUTCOME_UNKNOWN" | "TRANSACTION_FAILED" | "TRANSACTION_EXPIRED" | "ABORTED" | "CONTRACT_ERROR"
  | "SIMULATION_FAILED" | "RESTORATION_REQUIRED" | "RESULT_DECODE_FAILED" | "RESOURCE_LIMIT" | "RESOURCE_CONFIG";

/** A stable SDK error code. A transaction hash permits recovery after uncertain submission. */
export class FuulError extends Error {
  override readonly name = "FuulError";
  constructor(
    readonly code: FuulErrorCode,
    message: string,
    readonly details: { hash?: string; contractCode?: number; status?: string; feeStroops?: string; maxFeeStroops?: string; resource?: string; actual?: string; maximum?: string } = {},
    options?: ErrorOptions,
  ) { super(message, options); }
}

/** Translate an explicit Soroban contract error without guessing from unrelated digits. */
export function parseContractError(error: unknown, errorTypes: Record<number, { message: string }> = {}): FuulError | undefined {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = /Error\(Contract, #([0-9]+)\)/.exec(message);
  if (!match) return undefined;
  const contractCode = Number(match[1]);
  if (!Number.isSafeInteger(contractCode) || contractCode > 0xffff_ffff) return undefined;
  return new FuulError("CONTRACT_ERROR", errorTypes[contractCode]?.message ?? `Contract error ${contractCode}`, { contractCode }, { cause: error });
}
