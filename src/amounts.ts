const MAX_I128 = (1n << 127n) - 1n;

function checkDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38) {
    throw new RangeError("decimals must be an integer from 0 to 38");
  }
}

/** Convert a nonnegative decimal string to exact Soroban token units. No rounding. */
export function parseAmount(value: string, decimals = 7): bigint {
  checkDecimals(decimals);
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)) {
    throw new TypeError("amount must be a nonnegative decimal string without exponent notation");
  }
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) throw new RangeError("amount exceeds token precision");
  const units = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units > MAX_I128) throw new RangeError("amount exceeds i128");
  return units;
}

/** Format token units without passing through JavaScript floating-point numbers. */
export function formatAmount(units: bigint, decimals = 7): string {
  checkDecimals(decimals);
  if (typeof units !== "bigint" || units < 0n || units > MAX_I128) throw new RangeError("units must be a nonnegative i128 bigint");
  if (!decimals) return units.toString();
  const digits = units.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return digits.slice(0, -decimals) + (fraction ? `.${fraction}` : "");
}

/** Calculate a basis-point fee with the contract's integer rounding toward zero. */
export function calculateFee(amount: bigint, basisPoints: number): bigint {
  if (typeof amount !== "bigint" || amount < 0n || amount > MAX_I128) throw new RangeError("amount must be a nonnegative i128 bigint");
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > 10_000) throw new RangeError("basisPoints must be from 0 to 10000");
  const product = amount * BigInt(basisPoints);
  // The pinned Rust implementation checks multiplication before division.
  if (product > MAX_I128) throw new RangeError("fee multiplication exceeds i128");
  return product / 10_000n;
}
