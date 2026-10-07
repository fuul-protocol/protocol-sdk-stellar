import assert from "node:assert/strict";

/** Narrow fixture unions without weakening the application's runtime checks. */
export function arm<T extends { type: string }, K extends T["type"]>(value: T, type: K): Extract<T, { type: K }> {
  assert.equal(value.type, type);
  return value as Extract<T, { type: K }>;
}
