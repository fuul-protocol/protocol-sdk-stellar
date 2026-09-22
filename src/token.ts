import { Address, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, type MethodOptions } from "@stellar/stellar-sdk/contract";
import type { FuulNetworkOptions } from "./sdk.js";
import { validateAddress, validateContractId, validateUnsignedBigInt } from "./validation.js";
import { readString, readTokenAmount, readU32, readVoid } from "./results.js";
import { assertUnsignedCall } from "./client-safety.js";

const MAX_I128 = (1n << 127n) - 1n;
const address = (value: string) => { validateAddress(value, "token address argument"); return Address.fromString(value).toScVal(); };
const amount = (value: bigint) => { validateUnsignedBigInt(value, MAX_I128, "amount"); return nativeToScVal(value, { type: "i128" }); };

/** SEP-41 token calls for funding projects and distributors. */
export class TokenClient {
  private readonly network: FuulNetworkOptions;
  constructor(readonly contractId: string, network: FuulNetworkOptions) {
    validateContractId(contractId, "token contract ID");
    this.network = { ...network };
  }
  private call<T>(method: string, args: xdr.ScVal[], parseResultXdr: (value: xdr.ScVal) => T, options?: MethodOptions): Promise<AssembledTransaction<T>> {
    assertUnsignedCall(this.network);
    assertUnsignedCall(options);
    return AssembledTransaction.build({ ...this.network, ...options, contractId: this.contractId, method, args, parseResultXdr });
  }
  balance(owner: string, options?: MethodOptions) { return this.call("balance", [address(owner)], readTokenAmount, options); }
  decimals(options?: MethodOptions) { return this.call("decimals", [], readU32, options); }
  name(options?: MethodOptions) { return this.call("name", [], readString, options); }
  symbol(options?: MethodOptions) { return this.call("symbol", [], readString, options); }
  transfer(input: { from: string; to: string; amount: bigint }, options?: MethodOptions) {
    return this.call("transfer", [address(input.from), address(input.to), amount(input.amount)], readVoid, options);
  }
  allowance(input: { from: string; spender: string }, options?: MethodOptions) {
    return this.call("allowance", [address(input.from), address(input.spender)], readTokenAmount, options);
  }
  approve(input: { from: string; spender: string; amount: bigint; expirationLedger: number }, options?: MethodOptions) {
    if (!Number.isInteger(input.expirationLedger) || input.expirationLedger < 0 || input.expirationLedger > 0xffff_ffff) throw new RangeError("expirationLedger must be a u32");
    return this.call("approve", [address(input.from), address(input.spender), amount(input.amount), nativeToScVal(input.expirationLedger, { type: "u32" })], readVoid, options);
  }
  transferFrom(input: { spender: string; from: string; to: string; amount: bigint }, options?: MethodOptions) {
    return this.call("transfer_from", [address(input.spender), address(input.from), address(input.to), amount(input.amount)], readVoid, options);
  }
  burn(input: { from: string; amount: bigint }, options?: MethodOptions) {
    return this.call("burn", [address(input.from), amount(input.amount)], readVoid, options);
  }
  burnFrom(input: { spender: string; from: string; amount: bigint }, options?: MethodOptions) {
    return this.call("burn_from", [address(input.spender), address(input.from), amount(input.amount)], readVoid, options);
  }
}
