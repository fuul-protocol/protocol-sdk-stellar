import { describe, expect, test } from "bun:test";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";

import {
  currencyType,
  claimReason,
  createClaimCheck,
  randomClaimProof,
} from "../src/index.js";

const project = StrKey.encodeContract(Buffer.alloc(32, 1));
const currency = StrKey.encodeContract(Buffer.alloc(32, 2));
const recipient = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 3)).publicKey();
const signer = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4)).publicKey();

describe("claim helpers", () => {
  test("builds the manager binding shape without changing business fields", () => {
    const proof = Buffer.alloc(32, 7);
    const claim = createClaimCheck({
      project,
      to: recipient,
      currency,
      currencyType: currencyType.stellarAsset,
      amount: 100n,
      reason: claimReason.affiliatePayout,
      deadline: 1_800_000_000n,
      proof,
      signers: [signer],
    });

    expect(claim).toEqual({
      project_address: project,
      to: recipient,
      currency,
      currency_type: { tag: "StellarAsset", values: undefined },
      amount: 100n,
      reason: { tag: "AffiliatePayout", values: undefined },
      token_id: 0n,
      deadline: 1_800_000_000n,
      proof,
      signers: [signer],
    });
    expect(claim.proof).not.toBe(proof);
  });

  test("rejects malformed and ambiguous claims before simulation", () => {
    const base = {
      project,
      to: recipient,
      currency,
      currencyType: currencyType.stellarAsset,
      amount: 100n,
      reason: claimReason.endUserPayout,
      deadline: 1_800_000_000n,
      proof: Buffer.alloc(32),
      signers: [signer],
    };

    expect(() => createClaimCheck({ ...base, amount: -1n })).toThrow(RangeError);
    expect(() => createClaimCheck({ ...base, proof: Buffer.alloc(31) })).toThrow(TypeError);
    expect(() => createClaimCheck({ ...base, signers: [] })).toThrow("at least one");
    expect(() => createClaimCheck({ ...base, signers: [signer, signer] })).toThrow("unique");
  });

  test("enforces the pinned token identifier range for asset adapters", () => {
    const base = {
      project,
      to: recipient,
      currency,
      currencyType: currencyType.nonFungible,
      amount: 0n,
      reason: claimReason.endUserPayout,
      deadline: 1_800_000_000n,
      proof: Buffer.alloc(32),
      signers: [signer],
    };

    expect(createClaimCheck({ ...base, tokenId: (1n << 32n) - 1n }).token_id).toBe(
      (1n << 32n) - 1n,
    );
    expect(() => createClaimCheck({ ...base, tokenId: 1n << 32n })).toThrow(
      "pinned u32 asset adapter interface",
    );
    expect(() =>
      createClaimCheck({ ...base, currencyType: currencyType.multiToken, tokenId: 1n << 32n }),
    ).toThrow("pinned u32 asset adapter interface");
  });

  test("creates 32-byte replay proofs", () => {
    const first = randomClaimProof();
    const second = randomClaimProof();
    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
  });

  test("validates runtime address kinds enums and integer types", () => {
    const base = {
      project, currency, to: recipient, currencyType: currencyType.stellarAsset,
      amount: 100n, reason: claimReason.endUserPayout, deadline: 1_800_000_000n,
      proof: Buffer.alloc(32), signers: [signer],
    };
    for (const address of [
      StrKey.encodeMed25519PublicKey(Buffer.alloc(40)),
      StrKey.encodeLiquidityPool(Buffer.alloc(32)),
      StrKey.encodeClaimableBalance(Buffer.alloc(33)),
    ]) {
      expect(() => createClaimCheck({ ...base, to: address })).toThrow(TypeError);
      expect(() => createClaimCheck({ ...base, signers: [address] })).toThrow(TypeError);
    }
    expect(() => createClaimCheck({ ...base, project: recipient })).toThrow(TypeError);
    expect(() => createClaimCheck({ ...base, currency: recipient })).toThrow(TypeError);
    expect(createClaimCheck({ ...base, to: project, signers: [project] }).to).toBe(project);
    for (const value of [100, NaN, Infinity, "100", null, undefined]) {
      expect(() => createClaimCheck({ ...base, amount: value as unknown as bigint })).toThrow(TypeError);
      expect(() => createClaimCheck({ ...base, deadline: value as unknown as bigint })).toThrow(TypeError);
    }
    expect(() => createClaimCheck({ ...base, tokenId: 1 as unknown as bigint })).toThrow(TypeError);
    expect(() => createClaimCheck({ ...base, tokenId: null as unknown as bigint })).toThrow(TypeError);
    expect(() => createClaimCheck({ ...base, amount: 1n << 127n })).toThrow(RangeError);
    expect(() => createClaimCheck({ ...base, deadline: 1n << 256n })).toThrow(RangeError);
    expect(() => createClaimCheck({ ...base, currencyType: { tag: "Unknown" } as never })).toThrow(TypeError);
    expect(() => createClaimCheck({ ...base, reason: { tag: "Unknown" } as never })).toThrow(TypeError);
  });

  test("copies all mutable claim inputs", () => {
    const input = {
      project, currency, to: recipient,
      currencyType: { ...currencyType.stellarAsset }, reason: { ...claimReason.endUserPayout },
      amount: 100n, deadline: 1_800_000_000n, proof: Buffer.alloc(32, 1), signers: [signer],
    };
    const claim = createClaimCheck(input);
    Reflect.set(input.currencyType, "tag", "NonFungible");
    Reflect.set(input.reason, "tag", "AffiliatePayout");
    input.proof.fill(2);
    input.signers[0] = recipient;
    expect(claim.currency_type.tag).toBe("StellarAsset");
    expect(claim.reason.tag).toBe("EndUserPayout");
    expect(claim.proof).toEqual(Buffer.alloc(32, 1));
    expect(claim.signers).toEqual([signer]);
  });

  test("accepts full unsigned claim intent without widening transfer or adapter amounts", () => {
    const maximum = (1n << 256n) - 1n;
    const input = {
      project, currency, to: recipient, currencyType: currencyType.stellarAsset,
      amount: (1n << 127n) - 1n, reason: claimReason.endUserPayout,
      deadline: maximum, tokenId: maximum, proof: Buffer.alloc(32, 1), signers: [signer],
    };
    expect(createClaimCheck(input)).toMatchObject({ deadline: maximum, token_id: maximum, amount: input.amount });
    for (const field of ["deadline", "tokenId"] as const) {
      for (const value of [-1n, 1n << 256n]) {
        expect(() => createClaimCheck({ ...input, [field]: value })).toThrow(RangeError);
      }
    }
    expect(() => createClaimCheck({ ...input, amount: 1n << 127n })).toThrow(RangeError);
    for (const kind of [currencyType.nonFungible, currencyType.multiToken]) {
      expect(() => createClaimCheck({ ...input, currencyType: kind })).toThrow("pinned u32");
    }
  });
});
