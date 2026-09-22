import { Address, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import type { ClaimCheck } from "./contracts/fuul-manager/index.js";
import { validateAddress, validateContractId, validateUnsignedBigInt } from "./validation.js";

/** A complete authorization tree selected by the application before simulation. */
export interface ExpectedAuthorization {
  address: string;
  /** Base64 XDR of SorobanAuthorizedInvocation, including all child invocations. */
  invocation: string;
}

/** Native fee consent for the whole claim batch, selected from trusted application configuration. */
export interface NativeClaimFee {
  asset: string;
  collector: string;
  amount: bigint;
}

/** Build signer intent from local claim data. Project provenance remains the caller's responsibility. */
export function claimAuthorizations(manager: string, checks: readonly ClaimCheck[], caller?: { address: string; nativeFee: NativeClaimFee }): ExpectedAuthorization[] {
  validateContractId(manager, "manager");
  const fieldsFor = (check: ClaimCheck): Record<string, xdr.ScVal> => ({
    amount: nativeToScVal(check.amount, { type: "i128" }),
    currency: new Address(check.currency).toScVal(),
    deadline: nativeToScVal(check.deadline, { type: "u256" }),
    project_address: new Address(check.project_address).toScVal(),
    proof: nativeToScVal(check.proof),
    reason: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(check.reason.tag)]),
    to: new Address(check.to).toScVal(),
    token_id: nativeToScVal(check.token_id, { type: "u256" }),
  });
  const map = (fields: Record<string, xdr.ScVal>) => xdr.ScVal.scvMap(Object.keys(fields).sort().map(name =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(name), val: fields[name]! })));
  const expected = checks.flatMap(check => {
    const value = map(fieldsFor(check));
    const invocation = new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address(manager).toScAddress(), functionName: "claim", args: [value],
      })),
      subInvocations: [],
    }).toXDR("base64");
    return check.signers.map(address => { validateAddress(address, "claim signer"); return { address, invocation }; });
  });
  if (caller) {
    validateAddress(caller.address, "caller");
    validateContractId(caller.nativeFee.asset, "native fee asset");
    validateAddress(caller.nativeFee.collector, "native fee collector");
    validateUnsignedBigInt(caller.nativeFee.amount, (1n << 127n) - 1n, "native fee amount");
    const call = (contract: string, method: string, args: xdr.ScVal[], subInvocations: xdr.SorobanAuthorizedInvocation[] = []) =>
      new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({ contractAddress: new Address(contract).toScAddress(), functionName: method, args })), subInvocations });
    const child = caller.nativeFee.amount === 0n ? [] : [call(caller.nativeFee.asset, "transfer", [
      new Address(caller.address).toScVal(), new Address(caller.nativeFee.collector).toScVal(), nativeToScVal(caller.nativeFee.amount, { type: "i128" }),
    ])];
    const values = checks.map(check => map({ ...fieldsFor(check),
      currency_type: xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(check.currency_type.tag)]),
      signers: xdr.ScVal.scvVec(check.signers.map(address => new Address(address).toScVal())),
    }));
    expected.push({ address: caller.address, invocation: call(manager, "claim", [new Address(caller.address).toScVal(), xdr.ScVal.scvVec(values)], child).toXDR("base64") });
  }
  return expected;
}
