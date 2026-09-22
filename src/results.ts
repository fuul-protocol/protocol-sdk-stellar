import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { validateUnsignedBigInt } from "./validation.js";

function requireType(value: xdr.ScVal, expected: xdr.ScValType): void {
  if (value.switch().value !== expected.value) throw new TypeError(`Contract returned ${value.switch().name}; expected ${expected.name}`);
}

export function readVoid(value: xdr.ScVal): null {
  requireType(value, xdr.ScValType.scvVoid()); return null;
}
export function readBoolean(value: xdr.ScVal): boolean {
  requireType(value, xdr.ScValType.scvBool()); return value.b();
}
export function readU32(value: xdr.ScVal): number {
  requireType(value, xdr.ScValType.scvU32()); return value.u32();
}
export function readTokenAmount(value: xdr.ScVal): bigint {
  requireType(value, xdr.ScValType.scvI128());
  const amount: unknown = scValToNative(value);
  validateUnsignedBigInt(amount as bigint, (1n << 127n) - 1n, "returned token amount");
  return amount as bigint;
}
export function readString(value: xdr.ScVal): string {
  requireType(value, xdr.ScValType.scvString());
  const text: unknown = scValToNative(value);
  if (typeof text !== "string") throw new TypeError("Contract returned an invalid UTF-8 string");
  return text;
}
