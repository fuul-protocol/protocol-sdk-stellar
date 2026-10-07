import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";





export const ManagerError = {
  6300: {message:"InvalidArgument"},
  6301: {message:"DuplicateSigner"},
  6302: {message:"LimitAlreadySet"},
  6303: {message:"LimitBelowCumulative"},
  6304: {message:"OverTheLimit"},
  6305: {message:"DeadlineExpired"},
  6306: {message:"NotEnoughSigners"},
  6307: {message:"InvalidSigner"},
  6308: {message:"AmountOverflow"},
  6309: {message:"IncorrectFee"}
}


export interface CurrencyTokenLimit {
  claim_cooldown_period_started: u64;
  claim_limit_per_cooldown: u256;
  cumulative_claim_per_cooldown: u256;
}











export type TokenType = {tag: "StellarAsset", values: void} | {tag: "NonFungible", values: void} | {tag: "MultiToken", values: void};


export interface ClaimCheck {
  amount: i128;
  currency: string;
  currency_type: TokenType;
  deadline: u256;
  project_address: string;
  proof: Uint8Array;
  reason: ClaimReason;
  signers: Array<string>;
  to: string;
  token_id: u256;
}

export type ClaimReason = {tag: "AffiliatePayout", values: void} | {tag: "EndUserPayout", values: void};




export const AccessControlError = {
  2000: {message:"Unauthorized"},
  2001: {message:"AdminNotSet"},
  2002: {message:"IndexOutOfBounds"},
  2003: {message:"AdminRoleNotFound"},
  2004: {message:"RoleCountIsNotZero"},
  2005: {message:"RoleNotFound"},
  2006: {message:"AdminAlreadySet"},
  2007: {message:"RoleNotHeld"},
  2008: {message:"RoleIsEmpty"},
  2009: {message:"TransferInProgress"},
  2010: {message:"MaxRolesExceeded"}
}

export const PausableError = {
  /**
   * The operation failed because the contract is paused.
   */
  1000: {message:"EnforcedPause"},
  /**
   * The operation failed because the contract is not paused.
   */
  1001: {message:"ExpectedPause"}
}

export interface Client {
  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim: ({caller, checks}: {caller: string, checks: Array<ClaimCheck>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a paused transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  paused: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpause: ({caller}: {caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({new_wasm_hash, operator}: {new_wasm_hash: Uint8Array, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a has_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_role: ({role, account}: {role: string, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a grant_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  grant_role: ({role, account, caller}: {role: string, account: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a keep_alive transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  keep_alive: (options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a pauser_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  pauser_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a revoke_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_role: ({role, account, caller}: {role: string, account: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a native_asset transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  native_asset: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a users_claims transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  users_claims: ({user, currency}: {user: string, currency: string}, options?: MethodOptions) => Promise<AssembledTransaction<u256>>

  /**
   * Construct and simulate a kyc_validator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  kyc_validator: (options?: MethodOptions) => Promise<AssembledTransaction<Option<string>>>

  /**
   * Construct and simulate a renounce_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  renounce_role: ({role, caller}: {role: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a unpauser_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpauser_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a claim_cooldown transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_cooldown: (options?: MethodOptions) => Promise<AssembledTransaction<u128>>

  /**
   * Construct and simulate a get_role_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_admin: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a currency_limits transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  currency_limits: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<CurrencyTokenLimit>>

  /**
   * Construct and simulate a get_role_member transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_member: ({role, index}: {role: string, index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_role_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_members: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a required_signers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  required_signers: (options?: MethodOptions) => Promise<AssembledTransaction<u128>>

  /**
   * Construct and simulate a claim_signer_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim_signer_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_kyc_validator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_kyc_validator: ({caller, validator}: {caller: string, validator: Option<string>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a add_currency_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_currency_limit: ({caller, token, limit}: {caller: string, token: string, limit: u256}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a default_admin_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_admin_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a min_claim_cooldown transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  min_claim_cooldown: (options?: MethodOptions) => Promise<AssembledTransaction<u128>>

  /**
   * Construct and simulate a set_claim_cooldown transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_claim_cooldown: ({caller, period}: {caller: string, period: u128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_required_signers transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_required_signers: ({caller, value}: {caller: string, value: u128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_role_member_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_member_count: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a no_claim_fee_addresses transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  no_claim_fee_addresses: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a add_no_claim_fee_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  add_no_claim_fee_address: ({caller, account}: {caller: string, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_currency_token_limit transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_currency_token_limit: ({caller, token, limit}: {caller: string, token: string, limit: u256}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a remove_no_claim_fee_address transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_no_claim_fee_address: ({caller, account}: {caller: string, account: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, pauser, unpauser, initial_required_signers, claim_signers, accepted_currency, native_asset, initial_kyc_validator, initial_currency_limit}: {admin: string, pauser: string, unpauser: string, initial_required_signers: u128, claim_signers: Array<string>, accepted_currency: string, native_asset: string, initial_kyc_validator: Option<string>, initial_currency_limit: u256},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Uint8Array | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({admin, pauser, unpauser, initial_required_signers, claim_signers, accepted_currency, native_asset, initial_kyc_validator, initial_currency_limit}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAADE1hbmFnZXJFcnJvcgAAAAoAAAAAAAAAD0ludmFsaWRBcmd1bWVudAAAABicAAAAAAAAAA9EdXBsaWNhdGVTaWduZXIAAAAYnQAAAAAAAAAPTGltaXRBbHJlYWR5U2V0AAAAGJ4AAAAAAAAAFExpbWl0QmVsb3dDdW11bGF0aXZlAAAYnwAAAAAAAAAMT3ZlclRoZUxpbWl0AAAYoAAAAAAAAAAPRGVhZGxpbmVFeHBpcmVkAAAAGKEAAAAAAAAAEE5vdEVub3VnaFNpZ25lcnMAABiiAAAAAAAAAA1JbnZhbGlkU2lnbmVyAAAAAAAYowAAAAAAAAAOQW1vdW50T3ZlcmZsb3cAAAAAGKQAAAAAAAAADEluY29ycmVjdEZlZQAAGKU=",
        "AAAAAQAAAAAAAAAAAAAAEkN1cnJlbmN5VG9rZW5MaW1pdAAAAAAAAwAAAAAAAAAdY2xhaW1fY29vbGRvd25fcGVyaW9kX3N0YXJ0ZWQAAAAAAAAGAAAAAAAAABhjbGFpbV9saW1pdF9wZXJfY29vbGRvd24AAAAMAAAAAAAAAB1jdW11bGF0aXZlX2NsYWltX3Blcl9jb29sZG93bgAAAAAAAAw=",
        "AAAABQAAAAAAAAAAAAAABlBhdXNlZAAAAAAAAQAAAAZwYXVzZWQAAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAB0NsYWltZWQAAAAAAQAAAAdjbGFpbWVkAAAAAAgAAAAAAAAAD3Byb2plY3RfYWRkcmVzcwAAAAATAAAAAQAAAAAAAAACdG8AAAAAABMAAAAAAAAAAAAAAAhjdXJyZW5jeQAAABMAAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAAAAAAAA1jdXJyZW5jeV90eXBlAAAAAAAH0AAAAAlUb2tlblR5cGUAAAAAAAAAAAAAAAAAAAh0b2tlbl9pZAAAAAwAAAAAAAAAAAAAAAZyZWFzb24AAAAAB9AAAAALQ2xhaW1SZWFzb24AAAAAAAAAAAAAAAAFcHJvb2YAAAAAAAPuAAAAIAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACFVucGF1c2VkAAAAAQAAAAh1bnBhdXNlZAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAD1Rva2VuTGltaXRBZGRlZAAAAAABAAAAEXRva2VuX2xpbWl0X2FkZGVkAAAAAAAAAgAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAAAAAAAAAAAFbGltaXQAAAAAAAAMAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAEVRva2VuTGltaXRVcGRhdGVkAAAAAAAAAQAAABN0b2tlbl9saW1pdF91cGRhdGVkAAAAAAIAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAAAAAABWxpbWl0AAAAAAAADAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAE0t5Y1ZhbGlkYXRvclVwZGF0ZWQAAAAAAQAAABVreWNfdmFsaWRhdG9yX3VwZGF0ZWQAAAAAAAABAAAAAAAAAAl2YWxpZGF0b3IAAAAAAAPoAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAAFENsYWltQ29vbGRvd25VcGRhdGVkAAAAAQAAABZjbGFpbV9jb29sZG93bl91cGRhdGVkAAAAAAABAAAAAAAAAAZwZXJpb2QAAAAAAAoAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAFk5vQ2xhaW1GZWVBZGRyZXNzQWRkZWQAAAAAAAEAAAAabm9fY2xhaW1fZmVlX2FkZHJlc3NfYWRkZWQAAAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFlJlcXVpcmVkU2lnbmVyc1VwZGF0ZWQAAAAAAAEAAAAYcmVxdWlyZWRfc2lnbmVyc191cGRhdGVkAAAAAQAAAAAAAAAFdmFsdWUAAAAAAAAKAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAGE5vQ2xhaW1GZWVBZGRyZXNzUmVtb3ZlZAAAAAEAAAAcbm9fY2xhaW1fZmVlX2FkZHJlc3NfcmVtb3ZlZAAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAC",
        "AAAAAAAAAAAAAAAFY2xhaW0AAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABmNoZWNrcwAAAAAD6gAAB9AAAAAKQ2xhaW1DaGVjawAAAAAAAA==",
        "AAAAAAAAAAAAAAAFcGF1c2UAAAAAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAGcGF1c2VkAAAAAAAAAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAHdW5wYXVzZQAAAAABAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAACAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAIaGFzX3JvbGUAAAACAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAKZ3JhbnRfcm9sZQAAAAAAAwAAAAAAAAAEcm9sZQAAABEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAKa2VlcF9hbGl2ZQAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAALcGF1c2VyX3JvbGUAAAAAAAAAAAEAAAAR",
        "AAAAAAAAAAAAAAALcmV2b2tlX3JvbGUAAAAAAwAAAAAAAAAEcm9sZQAAABEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMbmF0aXZlX2Fzc2V0AAAAAAAAAAEAAAAT",
        "AAAAAAAAAAAAAAAMdXNlcnNfY2xhaW1zAAAAAgAAAAAAAAAEdXNlcgAAABMAAAAAAAAACGN1cnJlbmN5AAAAEwAAAAEAAAAM",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAkAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAGcGF1c2VyAAAAAAATAAAAAAAAAAh1bnBhdXNlcgAAABMAAAAAAAAAGGluaXRpYWxfcmVxdWlyZWRfc2lnbmVycwAAAAoAAAAAAAAADWNsYWltX3NpZ25lcnMAAAAAAAPqAAAAEwAAAAAAAAARYWNjZXB0ZWRfY3VycmVuY3kAAAAAAAATAAAAAAAAAAxuYXRpdmVfYXNzZXQAAAATAAAAAAAAABVpbml0aWFsX2t5Y192YWxpZGF0b3IAAAAAAAPoAAAAEwAAAAAAAAAWaW5pdGlhbF9jdXJyZW5jeV9saW1pdAAAAAAADAAAAAA=",
        "AAAAAAAAAAAAAAANa3ljX3ZhbGlkYXRvcgAAAAAAAAAAAAABAAAD6AAAABM=",
        "AAAAAAAAAAAAAAANcmVub3VuY2Vfcm9sZQAAAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAANdW5wYXVzZXJfcm9sZQAAAAAAAAAAAAABAAAAEQ==",
        "AAAAAAAAAAAAAAAOY2xhaW1fY29vbGRvd24AAAAAAAAAAAABAAAACg==",
        "AAAAAAAAAAAAAAAOZ2V0X3JvbGVfYWRtaW4AAAAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAABE=",
        "AAAAAAAAAAAAAAAPY3VycmVuY3lfbGltaXRzAAAAAAEAAAAAAAAABXRva2VuAAAAAAAAEwAAAAEAAAfQAAAAEkN1cnJlbmN5VG9rZW5MaW1pdAAA",
        "AAAAAAAAAAAAAAAPZ2V0X3JvbGVfbWVtYmVyAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAVpbmRleAAAAAAAAAQAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAQZ2V0X3JvbGVfbWVtYmVycwAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAA+oAAAAT",
        "AAAAAAAAAAAAAAAQcmVxdWlyZWRfc2lnbmVycwAAAAAAAAABAAAACg==",
        "AAAAAAAAAAAAAAARY2xhaW1fc2lnbmVyX3JvbGUAAAAAAAAAAAAAAQAAABE=",
        "AAAAAAAAAAAAAAARc2V0X2t5Y192YWxpZGF0b3IAAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACXZhbGlkYXRvcgAAAAAAA+gAAAATAAAAAA==",
        "AAAAAAAAAAAAAAASYWRkX2N1cnJlbmN5X2xpbWl0AAAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAFbGltaXQAAAAAAAAMAAAAAA==",
        "AAAAAAAAAAAAAAASZGVmYXVsdF9hZG1pbl9yb2xlAAAAAAAAAAAAAQAAABE=",
        "AAAAAAAAAAAAAAASbWluX2NsYWltX2Nvb2xkb3duAAAAAAAAAAAAAQAAAAo=",
        "AAAAAAAAAAAAAAASc2V0X2NsYWltX2Nvb2xkb3duAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABnBlcmlvZAAAAAAACgAAAAA=",
        "AAAAAAAAAAAAAAAUc2V0X3JlcXVpcmVkX3NpZ25lcnMAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAABXZhbHVlAAAAAAAACgAAAAA=",
        "AAAAAAAAAAAAAAAVZ2V0X3JvbGVfbWVtYmVyX2NvdW50AAAAAAAAAQAAAAAAAAAEcm9sZQAAABEAAAABAAAABA==",
        "AAAAAAAAAAAAAAAWbm9fY2xhaW1fZmVlX2FkZHJlc3NlcwAAAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAYYWRkX25vX2NsYWltX2ZlZV9hZGRyZXNzAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAdhY2NvdW50AAAAABMAAAAA",
        "AAAAAAAAAAAAAAAYc2V0X2N1cnJlbmN5X3Rva2VuX2xpbWl0AAAAAwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABWxpbWl0AAAAAAAADAAAAAA=",
        "AAAAAAAAAAAAAAAbcmVtb3ZlX25vX2NsYWltX2ZlZV9hZGRyZXNzAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHYWNjb3VudAAAAAATAAAAAA==",
        "AAAAAgAAAAAAAAAAAAAACVRva2VuVHlwZQAAAAAAAAMAAAAAAAAAAAAAAAxTdGVsbGFyQXNzZXQAAAAAAAAAAAAAAAtOb25GdW5naWJsZQAAAAAAAAAAAAAAAApNdWx0aVRva2VuAAA=",
        "AAAAAQAAAAAAAAAAAAAACkNsYWltQ2hlY2sAAAAAAAoAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAIY3VycmVuY3kAAAATAAAAAAAAAA1jdXJyZW5jeV90eXBlAAAAAAAH0AAAAAlUb2tlblR5cGUAAAAAAAAAAAAACGRlYWRsaW5lAAAADAAAAAAAAAAPcHJvamVjdF9hZGRyZXNzAAAAABMAAAAAAAAABXByb29mAAAAAAAD7gAAACAAAAAAAAAABnJlYXNvbgAAAAAH0AAAAAtDbGFpbVJlYXNvbgAAAAAAAAAAB3NpZ25lcnMAAAAD6gAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAh0b2tlbl9pZAAAAAw=",
        "AAAAAgAAAAAAAAAAAAAAC0NsYWltUmVhc29uAAAAAAIAAAAAAAAAAAAAAA9BZmZpbGlhdGVQYXlvdXQAAAAAAAAAAAAAAAANRW5kVXNlclBheW91dAAAAA==",
        "AAAABQAAACFFbWl0dGVkIGFmdGVyIGEgY29udHJhY3QgdXBncmFkZS4AAAAAAAAAAAAAEENvbnRyYWN0VXBncmFkZWQAAAABAAAAEWNvbnRyYWN0X3VwZ3JhZGVkAAAAAAAAAgAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIGdyYW50ZWQuAAAAAAAAAAAAAAtSb2xlR3JhbnRlZAAAAAABAAAADHJvbGVfZ3JhbnRlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIHJldm9rZWQuAAAAAAAAAAAAAAtSb2xlUmV2b2tlZAAAAAABAAAADHJvbGVfcmV2b2tlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAAEkFjY2Vzc0NvbnRyb2xFcnJvcgAAAAAACwAAAAAAAAAMVW5hdXRob3JpemVkAAAH0AAAAAAAAAALQWRtaW5Ob3RTZXQAAAAH0QAAAAAAAAAQSW5kZXhPdXRPZkJvdW5kcwAAB9IAAAAAAAAAEUFkbWluUm9sZU5vdEZvdW5kAAAAAAAH0wAAAAAAAAASUm9sZUNvdW50SXNOb3RaZXJvAAAAAAfUAAAAAAAAAAxSb2xlTm90Rm91bmQAAAfVAAAAAAAAAA9BZG1pbkFscmVhZHlTZXQAAAAH1gAAAAAAAAALUm9sZU5vdEhlbGQAAAAH1wAAAAAAAAALUm9sZUlzRW1wdHkAAAAH2AAAAAAAAAASVHJhbnNmZXJJblByb2dyZXNzAAAAAAfZAAAAAAAAABBNYXhSb2xlc0V4Y2VlZGVkAAAH2g==",
        "AAAABAAAAAAAAAAAAAAADVBhdXNhYmxlRXJyb3IAAAAAAAACAAAANFRoZSBvcGVyYXRpb24gZmFpbGVkIGJlY2F1c2UgdGhlIGNvbnRyYWN0IGlzIHBhdXNlZC4AAAANRW5mb3JjZWRQYXVzZQAAAAAAA+gAAAA4VGhlIG9wZXJhdGlvbiBmYWlsZWQgYmVjYXVzZSB0aGUgY29udHJhY3QgaXMgbm90IHBhdXNlZC4AAAANRXhwZWN0ZWRQYXVzZQAAAAAAA+k=" ]),
      options
    )
  }
  public readonly fromJSON = {
    claim: this.txFromJSON<null>,
        pause: this.txFromJSON<null>,
        paused: this.txFromJSON<boolean>,
        unpause: this.txFromJSON<null>,
        upgrade: this.txFromJSON<null>,
        has_role: this.txFromJSON<boolean>,
        grant_role: this.txFromJSON<null>,
        keep_alive: this.txFromJSON<null>,
        pauser_role: this.txFromJSON<string>,
        revoke_role: this.txFromJSON<null>,
        native_asset: this.txFromJSON<string>,
        users_claims: this.txFromJSON<u256>,
        kyc_validator: this.txFromJSON<Option<string>>,
        renounce_role: this.txFromJSON<null>,
        unpauser_role: this.txFromJSON<string>,
        claim_cooldown: this.txFromJSON<u128>,
        get_role_admin: this.txFromJSON<string>,
        currency_limits: this.txFromJSON<CurrencyTokenLimit>,
        get_role_member: this.txFromJSON<string>,
        get_role_members: this.txFromJSON<Array<string>>,
        required_signers: this.txFromJSON<u128>,
        claim_signer_role: this.txFromJSON<string>,
        set_kyc_validator: this.txFromJSON<null>,
        add_currency_limit: this.txFromJSON<null>,
        default_admin_role: this.txFromJSON<string>,
        min_claim_cooldown: this.txFromJSON<u128>,
        set_claim_cooldown: this.txFromJSON<null>,
        set_required_signers: this.txFromJSON<null>,
        get_role_member_count: this.txFromJSON<u32>,
        no_claim_fee_addresses: this.txFromJSON<boolean>,
        add_no_claim_fee_address: this.txFromJSON<null>,
        set_currency_token_limit: this.txFromJSON<null>,
        remove_no_claim_fee_address: this.txFromJSON<null>
  }
}