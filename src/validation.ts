import { StrKey } from "@stellar/stellar-sdk";

export function validateBytes(value: Uint8Array, label: string): void {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${label} must be a Uint8Array or Buffer`);
  }
}

// JS SDK Address also accepts muxed accounts, pools and claimable balances.
// Fuul's Rust Address arguments and authorization support accounts/contracts.
export function validateAddress(address: string, label: string): void {
  if (!StrKey.isValidEd25519PublicKey(address) && !StrKey.isValidContract(address)) {
    throw new TypeError(`${label} must be a Stellar account or contract address`);
  }
}

export function validateContractId(address: string, label: string): void {
  if (!StrKey.isValidContract(address)) {
    throw new TypeError(`${label} must be a valid Stellar contract ID`);
  }
}

export function validateUnsignedBigInt(value: bigint, maximum: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be a bigint`);
  }
  if (value < 0n || value > maximum) {
    throw new RangeError(`${label} is outside the supported integer range`);
  }
}
