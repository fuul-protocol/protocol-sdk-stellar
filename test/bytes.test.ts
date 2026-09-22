import { describe, expect, test } from "bun:test";
import { Buffer } from "buffer";

import { bytesToHex, toBytes32 } from "../src/bytes.js";

describe("exact byte inputs", () => {
  test("copies only the selected Uint8Array view and preserves hexadecimal bytes", () => {
    const source = new Uint8Array(34).fill(7);
    source[0] = 1;
    source[33] = 2;
    const proof = toBytes32(source.subarray(1, 33));
    expect(proof).toEqual(Buffer.alloc(32, 7));
    source.fill(9);
    expect(proof).toEqual(Buffer.alloc(32, 7));
    expect(toBytes32(`0x${"aB".repeat(32)}`)).toEqual(Buffer.alloc(32, 0xab));
    expect(bytesToHex(proof)).toBe(`0x${"07".repeat(32)}`);
  });

  test("rejects inputs that Buffer.from would truncate or reinterpret", () => {
    for (const value of [
      new Uint16Array(32).fill(256), new Int8Array(32).fill(-1),
      new Float64Array(32).fill(1.5), new ArrayBuffer(32),
      new DataView(new ArrayBuffer(32)), Array(32).fill(256),
      { type: "Buffer", data: Array(32).fill(1) },
      { length: 32, 0: 999 }, null, undefined, 32,
    ]) {
      expect(() => toBytes32(value as never)).toThrow(TypeError);
      expect(() => bytesToHex(value as never)).toThrow(TypeError);
    }
    expect(() => toBytes32(`0x${"gg".repeat(32)}`)).toThrow(TypeError);
  });
});
