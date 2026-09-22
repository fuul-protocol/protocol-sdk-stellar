import type { AssembledTransaction, MethodOptions } from "@stellar/stellar-sdk/contract";
import { createClaimCheck, type ClaimCheckInput } from "./claims.js";
import { claimAuthorizations, type NativeClaimFee } from "./authorization.js";
import { parseContractError } from "./errors.js";
import type { FuulSdk } from "./sdk.js";
import type { ConfirmationOptions, TransactionExecutor } from "./transactions.js";
import { validateAddress, validateContractId } from "./validation.js";

/** Return a successful simulation result. This helper never signs or submits. */
export async function readContract<T>(call: Promise<AssembledTransaction<T>>): Promise<T> {
  try {
    const transaction = await call;
    void transaction.simulationData;
    return transaction.result;
  } catch (error) { throw parseContractError(error) ?? error; }
}

/** Common workflows. Advanced administration remains available through every typed binding. */
export class FuulActions {
  constructor(readonly sdk: FuulSdk, readonly executor: TransactionExecutor) {}

  createFuulProject(input: { admin: string; uri: string; kycRequired?: boolean }, confirmation?: ConfirmationOptions) {
    validateAddress(input.admin, "project admin");
    if (typeof input.uri !== "string" || !input.uri.length) throw new TypeError("project URI must not be empty");
    const args = { project_admin: input.admin, project_info_uri: input.uri, kyc_required: input.kycRequired ?? false };
    return this.executor.execute(() => this.sdk.factory.create_fuul_project(args), confirmation);
  }

  /** Funding is a separate transaction; its receipt permits recovery if a later claim fails. */
  fund(input: { currency: string; from: string; contract: string; amount: bigint }, confirmation?: ConfirmationOptions) {
    validateContractId(input.contract, "funding destination");
    const client = this.sdk.token(input.currency);
    const args = { from: input.from, to: input.contract, amount: input.amount };
    return this.executor.execute(() => client.transfer(args), confirmation);
  }

  claimRewards(input: { caller: string; checks: readonly ClaimCheckInput[]; nativeFee?: NativeClaimFee }, confirmation?: ConfirmationOptions) {
    validateAddress(input.caller, "caller");
    if (!input.checks.length) throw new TypeError("claim batch must not be empty");
    const checks = input.checks.map(createClaimCheck);
    const caller = input.caller;
    return this.executor.execute(() => this.sdk.manager.claim({ caller, checks }), {
      ...confirmation, authorizations: claimAuthorizations(this.sdk.manager.options.contractId, checks, input.nativeFee ? { address: caller, nativeFee: input.nativeFee } : undefined),
    });
  }

  /** Simulations are independent observations and do not form an atomic ledger snapshot. */
  async projectState(contract: string, options?: MethodOptions) {
    const project = this.sdk.project(contract);
    const [admins, factory, uri, kycRequired, fees] = await Promise.all([
      readContract(project.get_role_members({ role: "default_admin" }, options)), readContract(project.factory(options)),
      readContract(project.project_info_uri(options)), readContract(project.kyc_required(options)),
      readContract(this.sdk.factory.get_fees_information({ project: contract }, options)),
    ]);
    return { contract, admins, factory, uri, kycRequired, fees };
  }
}
