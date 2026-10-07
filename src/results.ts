import { scValToNative, xdr } from "@stellar/stellar-sdk";
import { validateUnsignedBigInt } from "./validation.js";

function requireType<T extends xdr.ScVal["type"]>(value: xdr.ScVal, expected: T): asserts value is Extract<xdr.ScVal, { type: T }> {
  if (value.type !== expected) throw new TypeError(`Contract returned ${value.type}; expected ${expected}`);
}

export function readVoid(value: xdr.ScVal): null {
  requireType(value, "scvVoid"); return null;
}
export function readBoolean(value: xdr.ScVal): boolean {
  requireType(value, "scvBool"); return value.b;
}
export function readU32(value: xdr.ScVal): number {
  requireType(value, "scvU32"); return value.u32;
}
export function readTokenAmount(value: xdr.ScVal): bigint {
  requireType(value, "scvI128");
  const amount: unknown = scValToNative(value);
  validateUnsignedBigInt(amount as bigint, (1n << 127n) - 1n, "returned token amount");
  return amount as bigint;
}
export function readString(value: xdr.ScVal): string {
  requireType(value, "scvString");
  const text: unknown = scValToNative(value);
  if (typeof text !== "string") throw new TypeError("Contract returned an invalid UTF-8 string");
  return text;
}
