import { describe, expect, test } from "bun:test";
import { parseAmount, formatAmount, calculateFee, parseContractError } from "../src/index.js";

describe("exact token amounts", () => {
  test("matches the pinned Rust fee multiplication overflow boundary", () => {
    const maximum = (1n << 127n) - 1n;
    for (const basisPoints of [2, 100, 9999, 10000]) {
      const boundary = maximum / BigInt(basisPoints);
      expect(calculateFee(boundary, basisPoints)).toBe(boundary * BigInt(basisPoints) / 10000n);
      expect(() => calculateFee(boundary + 1n, basisPoints)).toThrow("i128");
    }
    expect(calculateFee(maximum, 0)).toBe(0n);
    expect(calculateFee(maximum, 1)).toBe(maximum / 10000n);
  });
  test("round-trips values beyond JavaScript's safe number range", () => {
    for (const decimals of [0, 7, 18, 38]) {
      for (const value of [0n, 1n, 9007199254740993n, (1n << 127n) - 1n]) {
        expect(parseAmount(formatAmount(value, decimals), decimals)).toBe(value);
      }
    }
    expect(parseAmount("1.2345678")).toBe(12345678n);
    expect(calculateFee(999n, 100)).toBe(9n);
  });
  test("rejects lossy values and ambiguous representations", () => {
    for (const value of ["-1", "1e7", " 1", "01", ".1", "1.", "1.00000001", "Infinity", 1]) expect(() => parseAmount(value as string)).toThrow();
    expect(() => parseAmount((1n << 127n).toString(), 0)).toThrow();
    for (const decimals of [-1, 39, 1.5, NaN]) expect(() => formatAmount(1n, decimals)).toThrow();
    expect(() => calculateFee(1n, 10_001)).toThrow();
  });
});

test("contract errors retain numeric codes and preserve their original cause", () => {
  const original = new Error("HostError: Error(Contract, #6305)");
  const error = parseContractError(original, { 6305: { message: "DeadlineExpired" } });
  expect(error?.code).toBe("CONTRACT_ERROR");
  expect(error?.details.contractCode).toBe(6305);
  expect(error?.message).toBe("DeadlineExpired");
  expect(error?.cause).toBe(original);
  expect(parseContractError("HTTP 6305 connection error")).toBeUndefined();
});
