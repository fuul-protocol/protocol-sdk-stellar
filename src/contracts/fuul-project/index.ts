import { Buffer } from "buffer";
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





export const ProjectError = {
  6100: {message:"EmptyUri"},
  6101: {message:"Unauthorized"},
  6102: {message:"ProofAlreadyClaimed"},
  6103: {message:"KycRequiredForClaim"},
  6105: {message:"InvalidArgument"},
  6107: {message:"FeeCalculationFailed"}
}




export type TokenType = {tag: "StellarAsset", values: void} | {tag: "NonFungible", values: void} | {tag: "MultiToken", values: void};


export interface ProjectClaimResult {
  fee_collector: string;
  native_user_claim_fee: i128;
}




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

export interface Client {
  /**
   * Construct and simulate a claim transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claim: ({manager, to, currency, currency_type, amount, token_id, proof, kyc_registered}: {manager: string, to: string, currency: string, currency_type: TokenType, amount: i128, token_id: u256, proof: Buffer, kyc_registered: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<ProjectClaimResult>>

  /**
   * Construct and simulate a factory transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  factory: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Upgrades Project code with Factory administrator authorization.
   */
  upgrade: ({new_wasm_hash, operator}: {new_wasm_hash: Buffer, operator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

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
   * Construct and simulate a revoke_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_role: ({role, account, caller}: {role: string, account: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a kyc_required transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  kyc_required: (options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a remove_funds transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_funds: ({caller, receiver, currency, currency_type, amount, token_ids, amounts}: {caller: string, receiver: string, currency: string, currency_type: TokenType, amount: i128, token_ids: Array<i128>, amounts: Array<i128>}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a renounce_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  renounce_role: ({role, caller}: {role: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a claimed_proofs transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  claimed_proofs: ({proof}: {proof: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a get_role_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_admin: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_role_member transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_member: ({role, index}: {role: string, index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_project_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_project_uri: ({caller, project_uri}: {caller: string, project_uri: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_role_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_members: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a project_info_uri transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  project_info_uri: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_kyc_required transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_kyc_required: ({caller, required}: {caller: string, required: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a default_admin_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_admin_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_role_member_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_member_count: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {factory, project_admin, project_uri, kyc_required}: {factory: string, project_admin: string, project_uri: string, kyc_required: boolean},
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy({factory, project_admin, project_uri, kyc_required}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAADFByb2plY3RFcnJvcgAAAAYAAAAAAAAACEVtcHR5VXJpAAAX1AAAAAAAAAAMVW5hdXRob3JpemVkAAAX1QAAAAAAAAATUHJvb2ZBbHJlYWR5Q2xhaW1lZAAAABfWAAAAAAAAABNLeWNSZXF1aXJlZEZvckNsYWltAAAAF9cAAAAAAAAAD0ludmFsaWRBcmd1bWVudAAAABfZAAAAAAAAABRGZWVDYWxjdWxhdGlvbkZhaWxlZAAAF9s=",
        "AAAABQAAAAAAAAAAAAAADEZ1bmRzUmVtb3ZlZAAAAAEAAAANZnVuZHNfcmVtb3ZlZAAAAAAAAAYAAAAAAAAACHJlY2VpdmVyAAAAEwAAAAAAAAAAAAAACGN1cnJlbmN5AAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAADWN1cnJlbmN5X3R5cGUAAAAAAAfQAAAACVRva2VuVHlwZQAAAAAAAAAAAAAAAAAACXRva2VuX2lkcwAAAAAAA+oAAAALAAAAAAAAAAAAAAAHYW1vdW50cwAAAAPqAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEkt5Y1JlcXVpcmVkVXBkYXRlZAAAAAAAAQAAABRreWNfcmVxdWlyZWRfdXBkYXRlZAAAAAEAAAAAAAAACHJlcXVpcmVkAAAAAQAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAElByb2plY3RJbmZvVXBkYXRlZAAAAAAAAQAAABRwcm9qZWN0X2luZm9fdXBkYXRlZAAAAAEAAAAAAAAAEHByb2plY3RfaW5mb191cmkAAAAQAAAAAAAAAAI=",
        "AAAAAAAAAAAAAAAFY2xhaW0AAAAAAAAIAAAAAAAAAAdtYW5hZ2VyAAAAABMAAAAAAAAAAnRvAAAAAAATAAAAAAAAAAhjdXJyZW5jeQAAABMAAAAAAAAADWN1cnJlbmN5X3R5cGUAAAAAAAfQAAAACVRva2VuVHlwZQAAAAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAh0b2tlbl9pZAAAAAwAAAAAAAAABXByb29mAAAAAAAD7gAAACAAAAAAAAAADmt5Y19yZWdpc3RlcmVkAAAAAAABAAAAAQAAB9AAAAASUHJvamVjdENsYWltUmVzdWx0AAA=",
        "AAAAAAAAAAAAAAAHZmFjdG9yeQAAAAAAAAAAAQAAABM=",
        "AAAAAAAAAD9VcGdyYWRlcyBQcm9qZWN0IGNvZGUgd2l0aCBGYWN0b3J5IGFkbWluaXN0cmF0b3IgYXV0aG9yaXphdGlvbi4AAAAAB3VwZ3JhZGUAAAAAAgAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAhvcGVyYXRvcgAAABMAAAAA",
        "AAAAAAAAAAAAAAAIaGFzX3JvbGUAAAACAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAKZ3JhbnRfcm9sZQAAAAAAAwAAAAAAAAAEcm9sZQAAABEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAKa2VlcF9hbGl2ZQAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAALcmV2b2tlX3JvbGUAAAAAAwAAAAAAAAAEcm9sZQAAABEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMa3ljX3JlcXVpcmVkAAAAAAAAAAEAAAAB",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX2Z1bmRzAAAABwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAhyZWNlaXZlcgAAABMAAAAAAAAACGN1cnJlbmN5AAAAEwAAAAAAAAANY3VycmVuY3lfdHlwZQAAAAAAB9AAAAAJVG9rZW5UeXBlAAAAAAAAAAAAAAZhbW91bnQAAAAAAAsAAAAAAAAACXRva2VuX2lkcwAAAAAAA+oAAAALAAAAAAAAAAdhbW91bnRzAAAAA+oAAAALAAAAAA==",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAQAAAAAAAAAB2ZhY3RvcnkAAAAAEwAAAAAAAAANcHJvamVjdF9hZG1pbgAAAAAAABMAAAAAAAAAC3Byb2plY3RfdXJpAAAAABAAAAAAAAAADGt5Y19yZXF1aXJlZAAAAAEAAAAA",
        "AAAAAAAAAAAAAAANcmVub3VuY2Vfcm9sZQAAAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAOY2xhaW1lZF9wcm9vZnMAAAAAAAEAAAAAAAAABXByb29mAAAAAAAD7gAAACAAAAABAAAAAQ==",
        "AAAAAAAAAAAAAAAOZ2V0X3JvbGVfYWRtaW4AAAAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAABE=",
        "AAAAAAAAAAAAAAAPZ2V0X3JvbGVfbWVtYmVyAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAVpbmRleAAAAAAAAAQAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAPc2V0X3Byb2plY3RfdXJpAAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAALcHJvamVjdF91cmkAAAAAEAAAAAA=",
        "AAAAAAAAAAAAAAAQZ2V0X3JvbGVfbWVtYmVycwAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAA+oAAAAT",
        "AAAAAAAAAAAAAAAQcHJvamVjdF9pbmZvX3VyaQAAAAAAAAABAAAAEA==",
        "AAAAAAAAAAAAAAAQc2V0X2t5Y19yZXF1aXJlZAAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAIcmVxdWlyZWQAAAABAAAAAA==",
        "AAAAAAAAAAAAAAASZGVmYXVsdF9hZG1pbl9yb2xlAAAAAAAAAAAAAQAAABE=",
        "AAAAAAAAAAAAAAAVZ2V0X3JvbGVfbWVtYmVyX2NvdW50AAAAAAAAAQAAAAAAAAAEcm9sZQAAABEAAAABAAAABA==",
        "AAAAAgAAAAAAAAAAAAAACVRva2VuVHlwZQAAAAAAAAMAAAAAAAAAAAAAAAxTdGVsbGFyQXNzZXQAAAAAAAAAAAAAAAtOb25GdW5naWJsZQAAAAAAAAAAAAAAAApNdWx0aVRva2VuAAA=",
        "AAAAAQAAAAAAAAAAAAAAElByb2plY3RDbGFpbVJlc3VsdAAAAAAAAgAAAAAAAAANZmVlX2NvbGxlY3RvcgAAAAAAABMAAAAAAAAAFW5hdGl2ZV91c2VyX2NsYWltX2ZlZQAAAAAAAAs=",
        "AAAABQAAACFFbWl0dGVkIGFmdGVyIGEgY29udHJhY3QgdXBncmFkZS4AAAAAAAAAAAAAEENvbnRyYWN0VXBncmFkZWQAAAABAAAAEWNvbnRyYWN0X3VwZ3JhZGVkAAAAAAAAAgAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIGdyYW50ZWQuAAAAAAAAAAAAAAtSb2xlR3JhbnRlZAAAAAABAAAADHJvbGVfZ3JhbnRlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIHJldm9rZWQuAAAAAAAAAAAAAAtSb2xlUmV2b2tlZAAAAAABAAAADHJvbGVfcmV2b2tlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAAEkFjY2Vzc0NvbnRyb2xFcnJvcgAAAAAACwAAAAAAAAAMVW5hdXRob3JpemVkAAAH0AAAAAAAAAALQWRtaW5Ob3RTZXQAAAAH0QAAAAAAAAAQSW5kZXhPdXRPZkJvdW5kcwAAB9IAAAAAAAAAEUFkbWluUm9sZU5vdEZvdW5kAAAAAAAH0wAAAAAAAAASUm9sZUNvdW50SXNOb3RaZXJvAAAAAAfUAAAAAAAAAAxSb2xlTm90Rm91bmQAAAfVAAAAAAAAAA9BZG1pbkFscmVhZHlTZXQAAAAH1gAAAAAAAAALUm9sZU5vdEhlbGQAAAAH1wAAAAAAAAALUm9sZUlzRW1wdHkAAAAH2AAAAAAAAAASVHJhbnNmZXJJblByb2dyZXNzAAAAAAfZAAAAAAAAABBNYXhSb2xlc0V4Y2VlZGVkAAAH2g==" ]),
      options
    )
  }
  public readonly fromJSON = {
    claim: this.txFromJSON<ProjectClaimResult>,
        factory: this.txFromJSON<string>,
        upgrade: this.txFromJSON<null>,
        has_role: this.txFromJSON<boolean>,
        grant_role: this.txFromJSON<null>,
        keep_alive: this.txFromJSON<null>,
        revoke_role: this.txFromJSON<null>,
        kyc_required: this.txFromJSON<boolean>,
        remove_funds: this.txFromJSON<null>,
        renounce_role: this.txFromJSON<null>,
        claimed_proofs: this.txFromJSON<boolean>,
        get_role_admin: this.txFromJSON<string>,
        get_role_member: this.txFromJSON<string>,
        set_project_uri: this.txFromJSON<null>,
        get_role_members: this.txFromJSON<Array<string>>,
        project_info_uri: this.txFromJSON<string>,
        set_kyc_required: this.txFromJSON<null>,
        default_admin_role: this.txFromJSON<string>,
        get_role_member_count: this.txFromJSON<u32>
  }
}