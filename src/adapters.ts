import { Address, nativeToScVal, type xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, type MethodOptions } from "@stellar/stellar-sdk/contract";
import type { FuulNetworkOptions } from "./sdk.js";
import { validateAddress, validateContractId, validateUnsignedBigInt } from "./validation.js";
import { readBoolean, readVoid } from "./results.js";
import { assertUnsignedCall } from "./client-safety.js";

const addr = (value: string) => { validateAddress(value, "adapter address"); return new Address(value).toScVal(); };
const integer = (value: bigint, type: "i128" | "u64") => { validateUnsignedBigInt(value, type === "i128" ? (1n << 127n) - 1n : (1n << 64n) - 1n, type); return nativeToScVal(value, { type }); };
const tokenId = (id: number) => { if (!Number.isInteger(id) || id < 0 || id > 0xffff_ffff) throw new RangeError("tokenId must be a u32"); return nativeToScVal(id, { type: "u32" }); };

class AdapterClient {
  private readonly network: FuulNetworkOptions;
  constructor(readonly contractId: string, network: FuulNetworkOptions) {
    validateContractId(contractId, "adapter contract ID"); this.network = { ...network };
  }
  protected call<T>(method: string, args: xdr.ScVal[], parseResultXdr: (value: xdr.ScVal) => T, options?: MethodOptions) {
    assertUnsignedCall(this.network);
    assertUnsignedCall(options);
    return AssembledTransaction.build<T>({ ...this.network, ...options, contractId: this.contractId, method, args, parseResultXdr });
  }
}

/** The KYC interface consumed by the pinned Fuul manager. */
export class KycClient extends AdapterClient {
  isRegistered(user: string, options?: MethodOptions) { return this.call("is_user_kyc_registered", [addr(user)], readBoolean, options); }
}
/** The SEP-50 transfer subset consumed by the pinned Fuul project. */
export class NonFungibleClient extends AdapterClient {
  transfer(input: { from: string; to: string; tokenId: number }, options?: MethodOptions) {
    return this.call("transfer", [addr(input.from), addr(input.to), tokenId(input.tokenId)], readVoid, options);
  }
}
/** Fuul's version 1 multi-token transfer interface. */
export class MultiTokenClient extends AdapterClient {
  transfer(input: { from: string; to: string; tokenId: number; amount: bigint }, options?: MethodOptions) {
    return this.call("transfer", [addr(input.from), addr(input.to), tokenId(input.tokenId), integer(input.amount, "i128")], readVoid, options);
  }
}
