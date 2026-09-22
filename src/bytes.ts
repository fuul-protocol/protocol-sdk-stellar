import { Buffer } from "buffer";

import { validateBytes } from "./validation.js";

export type Bytes32Input = Uint8Array | `0x${string}`;

const HEX_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function toBytes32(value: Bytes32Input, label = "value"): Buffer {
  if (typeof value !== "string") {
    validateBytes(value, label);
  }
  const bytes =
    typeof value === "string"
      ? HEX_32_PATTERN.test(value)
        ? Buffer.from(value.slice(2), "hex")
        : undefined
      : Buffer.from(value);

  if (bytes === undefined || bytes.length !== 32) {
    throw new TypeError(`${label} must be exactly 32 bytes`);
  }

  return Buffer.from(bytes);
}

export function bytesToHex(value: Uint8Array): `0x${string}` {
  validateBytes(value, "value");
  return `0x${Buffer.from(value).toString("hex")}`;
}
