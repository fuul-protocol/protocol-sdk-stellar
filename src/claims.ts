import { Buffer } from "buffer";

import type { ClaimCheck } from "./contracts/fuul-manager/index.js";
import { toBytes32, type Bytes32Input } from "./bytes.js";
import {
  validateAddress,
  validateContractId,
  validateUnsignedBigInt,
} from "./validation.js";

const MAX_I128 = (1n << 127n) - 1n;
const MAX_U32 = (1n << 32n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

export const currencyType = {
  stellarAsset: { tag: "StellarAsset", values: undefined },
  nonFungible: { tag: "NonFungible", values: undefined },
  multiToken: { tag: "MultiToken", values: undefined },
} as const;

export const claimReason = {
  affiliatePayout: { tag: "AffiliatePayout", values: undefined },
  endUserPayout: { tag: "EndUserPayout", values: undefined },
} as const;

export interface ClaimCheckInput {
  project: string;
  to: string;
  currency: string;
  currencyType: ClaimCheck["currency_type"];
  amount: bigint;
  reason: ClaimCheck["reason"];
  tokenId?: bigint;
  deadline: bigint;
  proof: Bytes32Input;
  signers: readonly string[];
}

export function createClaimCheck(input: ClaimCheckInput): ClaimCheck {
  validateContractId(input.project, "project");
  validateAddress(input.to, "to");
  validateContractId(input.currency, "currency");
  validateUnsignedBigInt(input.amount, MAX_I128, "amount");
  const tokenId = input.tokenId === undefined ? 0n : input.tokenId;
  validateUnsignedBigInt(tokenId, MAX_U256, "tokenId");
  if (!["StellarAsset", "NonFungible", "MultiToken"].includes(input.currencyType?.tag)) {
    throw new TypeError("currencyType must be a supported Fuul asset kind");
  }
  if (!["AffiliatePayout", "EndUserPayout"].includes(input.reason?.tag)) {
    throw new TypeError("reason must be a supported Fuul claim reason");
  }
  if (input.currencyType.tag !== "StellarAsset" && tokenId > MAX_U32) {
    throw new RangeError("tokenId must fit the pinned u32 asset adapter interface");
  }
  validateUnsignedBigInt(input.deadline, MAX_U256, "deadline");
  if (input.signers.length === 0) {
    throw new TypeError("at least one claim signer is required");
  }

  const uniqueSigners = new Set<string>();
  for (const signer of input.signers) {
    validateAddress(signer, "signer");
    if (uniqueSigners.has(signer)) {
      throw new TypeError("claim signers must be unique");
    }
    uniqueSigners.add(signer);
  }

  return {
    project_address: input.project,
    to: input.to,
    currency: input.currency,
    currency_type: { tag: input.currencyType.tag, values: undefined },
    amount: input.amount,
    reason: { tag: input.reason.tag, values: undefined },
    token_id: tokenId,
    deadline: input.deadline,
    proof: toBytes32(input.proof, "proof"),
    signers: [...input.signers],
  };
}

export function randomClaimProof(): Buffer {
  return Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}
