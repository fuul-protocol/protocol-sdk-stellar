/** Manager role meanings mapped to Soroban Symbols, not EVM bytes32 identifiers. */
export const MANAGER_ROLES = Object.freeze({
  DEFAULT_ADMIN_ROLE: "default_admin",
  PAUSER_ROLE: "pauser",
  UNPAUSER_ROLE: "unpauser",
  CLAIM_SIGNER_ROLE: "claim_signer",
} as const);
