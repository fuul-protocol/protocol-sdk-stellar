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





export const FactoryError = {
  6200: {message:"EmptyUri"},
  6201: {message:"InvalidArgument"},
  6202: {message:"TrackerOverflow"}
}










export interface ProjectFees {
  native_user_claim_fee: i128;
  project_claim_fee: u32;
  remove_fee: u32;
}


export interface FeesInformation {
  fee_collector: string;
  fees: ProjectFees;
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
   * Construct and simulate a revoke_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  revoke_role: ({role, account, caller}: {role: string, account: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a manager_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  manager_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a project_fees transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  project_fees: ({project}: {project: string}, options?: MethodOptions) => Promise<AssembledTransaction<ProjectFees>>

  /**
   * Construct and simulate a fee_collector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fee_collector: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a renounce_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  renounce_role: ({role, caller}: {role: string, caller: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_role_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_admin: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a set_remove_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_remove_fee: ({caller, project, value_bps}: {caller: string, project: string, value_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_role_member transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_member: ({role, index}: {role: string, index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a contract_tracker transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  contract_tracker: (options?: MethodOptions) => Promise<AssembledTransaction<u128>>

  /**
   * Construct and simulate a get_role_members transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_members: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<Array<string>>>

  /**
   * Construct and simulate a has_manager_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  has_manager_role: ({account}: {account: string}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a project_wasm_hash transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  project_wasm_hash: (options?: MethodOptions) => Promise<AssembledTransaction<Uint8Array>>

  /**
   * Construct and simulate a set_fee_collector transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee_collector: ({caller, new_collector}: {caller: string, new_collector: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a default_admin_role transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_admin_role: (options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a default_remove_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_remove_fee: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a create_fuul_project transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  create_fuul_project: ({project_admin, project_info_uri, kyc_required}: {project_admin: string, project_info_uri: string, kyc_required: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<string>>

  /**
   * Construct and simulate a get_fees_information transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_fees_information: ({project}: {project: string}, options?: MethodOptions) => Promise<AssembledTransaction<FeesInformation>>

  /**
   * Construct and simulate a get_role_member_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_role_member_count: ({role}: {role: string}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a set_project_claim_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_project_claim_fee: ({caller, project, value_bps}: {caller: string, project: string, value_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_default_remove_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_default_remove_fee: ({caller, value_bps}: {caller: string, value_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a default_native_claim_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_native_claim_fee: (options?: MethodOptions) => Promise<AssembledTransaction<i128>>

  /**
   * Construct and simulate a default_project_claim_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  default_project_claim_fee: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a set_native_user_claim_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_native_user_claim_fee: ({caller, project, value}: {caller: string, project: string, value: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_default_native_claim_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_default_native_claim_fee: ({caller, value}: {caller: string, value: i128}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a set_default_project_claim_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_default_project_claim_fee: ({caller, value_bps}: {caller: string, value_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
        /** Constructor/Initialization Args for the contract's `__constructor` method */
        {admin, manager, fee_collector, project_wasm_hash}: {admin: string, manager: string, fee_collector: string, project_wasm_hash: Uint8Array},
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
    return ContractClient.deploy({admin, manager, fee_collector, project_wasm_hash}, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAABAAAAAAAAAAAAAAADEZhY3RvcnlFcnJvcgAAAAMAAAAAAAAACEVtcHR5VXJpAAAYOAAAAAAAAAAPSW52YWxpZEFyZ3VtZW50AAAAGDkAAAAAAAAAD1RyYWNrZXJPdmVyZmxvdwAAABg6",
        "AAAABQAAAAAAAAAAAAAADlByb2plY3RDcmVhdGVkAAAAAAABAAAAD3Byb2plY3RfY3JlYXRlZAAAAAADAAAAAAAAAApwcm9qZWN0X2lkAAAAAAAKAAAAAAAAAAAAAAAQZGVwbG95ZWRfYWRkcmVzcwAAABMAAAABAAAAAAAAABBwcm9qZWN0X2luZm9fdXJpAAAAEAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAEFJlbW92ZUZlZVVwZGF0ZWQAAAABAAAAEnJlbW92ZV9mZWVfdXBkYXRlZAAAAAAAAgAAAAAAAAAPcHJvamVjdF9hZGRyZXNzAAAAABMAAAAAAAAAAAAAAApyZW1vdmVfZmVlAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAE0ZlZUNvbGxlY3RvclVwZGF0ZWQAAAAAAQAAABVmZWVfY29sbGVjdG9yX3VwZGF0ZWQAAAAAAAABAAAAAAAAAA1uZXdfY29sbGVjdG9yAAAAAAAAEwAAAAEAAAAC",
        "AAAABQAAAAAAAAAAAAAAFU5hdGl2ZUNsYWltRmVlVXBkYXRlZAAAAAAAAAEAAAAYbmF0aXZlX2NsYWltX2ZlZV91cGRhdGVkAAAAAgAAAAAAAAAPcHJvamVjdF9hZGRyZXNzAAAAABMAAAAAAAAAAAAAABBuYXRpdmVfY2xhaW1fZmVlAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAFlByb2plY3RDbGFpbUZlZVVwZGF0ZWQAAAAAAAEAAAAZcHJvamVjdF9jbGFpbV9mZWVfdXBkYXRlZAAAAAAAAAIAAAAAAAAAD3Byb2plY3RfYWRkcmVzcwAAAAATAAAAAAAAAAAAAAARcHJvamVjdF9jbGFpbV9mZWUAAAAAAAAEAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAAF0RlZmF1bHRSZW1vdmVGZWVVcGRhdGVkAAAAAAEAAAAaZGVmYXVsdF9yZW1vdmVfZmVlX3VwZGF0ZWQAAAAAAAEAAAAAAAAAEmRlZmF1bHRfcmVtb3ZlX2ZlZQAAAAAABAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAAHERlZmF1bHROYXRpdmVDbGFpbUZlZVVwZGF0ZWQAAAABAAAAIGRlZmF1bHRfbmF0aXZlX2NsYWltX2ZlZV91cGRhdGVkAAAAAQAAAAAAAAAcbmV3X2RlZmF1bHRfbmF0aXZlX2NsYWltX2ZlZQAAAAsAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAHURlZmF1bHRQcm9qZWN0Q2xhaW1GZWVVcGRhdGVkAAAAAAAAAQAAAB1EZWZhdWx0UHJvamVjdENsYWltRmVlVXBkYXRlZAAAAAAAAAEAAAAAAAAAFW5ld19wcm9qZWN0X2NsYWltX2ZlZQAAAAAAAAQAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAACAAAAAAAAAA1uZXdfd2FzbV9oYXNoAAAAAAAD7gAAACAAAAAAAAAACG9wZXJhdG9yAAAAEwAAAAA=",
        "AAAAAAAAAAAAAAAIaGFzX3JvbGUAAAACAAAAAAAAAARyb2xlAAAAEQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAE=",
        "AAAAAAAAAAAAAAAKZ3JhbnRfcm9sZQAAAAAAAwAAAAAAAAAEcm9sZQAAABEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAKa2VlcF9hbGl2ZQAAAAAAAAAAAAA=",
        "AAAAAAAAAAAAAAALcmV2b2tlX3JvbGUAAAAAAwAAAAAAAAAEcm9sZQAAABEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAAMbWFuYWdlcl9yb2xlAAAAAAAAAAEAAAAR",
        "AAAAAAAAAAAAAAAMcHJvamVjdF9mZWVzAAAAAQAAAAAAAAAHcHJvamVjdAAAAAATAAAAAQAAB9AAAAALUHJvamVjdEZlZXMA",
        "AAAAAAAAAAAAAAANX19jb25zdHJ1Y3RvcgAAAAAAAAQAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHbWFuYWdlcgAAAAATAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAAAAAARcHJvamVjdF93YXNtX2hhc2gAAAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAANZmVlX2NvbGxlY3RvcgAAAAAAAAAAAAABAAAAEw==",
        "AAAAAAAAAAAAAAANcmVub3VuY2Vfcm9sZQAAAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAA",
        "AAAAAAAAAAAAAAAOZ2V0X3JvbGVfYWRtaW4AAAAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAABE=",
        "AAAAAAAAAAAAAAAOc2V0X3JlbW92ZV9mZWUAAAAAAAMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHcHJvamVjdAAAAAATAAAAAAAAAAl2YWx1ZV9icHMAAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAPZ2V0X3JvbGVfbWVtYmVyAAAAAAIAAAAAAAAABHJvbGUAAAARAAAAAAAAAAVpbmRleAAAAAAAAAQAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAQY29udHJhY3RfdHJhY2tlcgAAAAAAAAABAAAACg==",
        "AAAAAAAAAAAAAAAQZ2V0X3JvbGVfbWVtYmVycwAAAAEAAAAAAAAABHJvbGUAAAARAAAAAQAAA+oAAAAT",
        "AAAAAAAAAAAAAAAQaGFzX21hbmFnZXJfcm9sZQAAAAEAAAAAAAAAB2FjY291bnQAAAAAEwAAAAEAAAAB",
        "AAAAAAAAAAAAAAARcHJvamVjdF93YXNtX2hhc2gAAAAAAAAAAAAAAQAAA+4AAAAg",
        "AAAAAAAAAAAAAAARc2V0X2ZlZV9jb2xsZWN0b3IAAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAADW5ld19jb2xsZWN0b3IAAAAAAAATAAAAAA==",
        "AAAAAAAAAAAAAAASZGVmYXVsdF9hZG1pbl9yb2xlAAAAAAAAAAAAAQAAABE=",
        "AAAAAAAAAAAAAAASZGVmYXVsdF9yZW1vdmVfZmVlAAAAAAAAAAAAAQAAAAQ=",
        "AAAAAAAAAAAAAAATY3JlYXRlX2Z1dWxfcHJvamVjdAAAAAADAAAAAAAAAA1wcm9qZWN0X2FkbWluAAAAAAAAEwAAAAAAAAAQcHJvamVjdF9pbmZvX3VyaQAAABAAAAAAAAAADGt5Y19yZXF1aXJlZAAAAAEAAAABAAAAEw==",
        "AAAAAAAAAAAAAAAUZ2V0X2ZlZXNfaW5mb3JtYXRpb24AAAABAAAAAAAAAAdwcm9qZWN0AAAAABMAAAABAAAH0AAAAA9GZWVzSW5mb3JtYXRpb24A",
        "AAAAAAAAAAAAAAAVZ2V0X3JvbGVfbWVtYmVyX2NvdW50AAAAAAAAAQAAAAAAAAAEcm9sZQAAABEAAAABAAAABA==",
        "AAAAAAAAAAAAAAAVc2V0X3Byb2plY3RfY2xhaW1fZmVlAAAAAAAAAwAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAdwcm9qZWN0AAAAABMAAAAAAAAACXZhbHVlX2JwcwAAAAAAAAQAAAAA",
        "AAAAAAAAAAAAAAAWc2V0X2RlZmF1bHRfcmVtb3ZlX2ZlZQAAAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAl2YWx1ZV9icHMAAAAAAAAEAAAAAA==",
        "AAAAAAAAAAAAAAAYZGVmYXVsdF9uYXRpdmVfY2xhaW1fZmVlAAAAAAAAAAEAAAAL",
        "AAAAAAAAAAAAAAAZZGVmYXVsdF9wcm9qZWN0X2NsYWltX2ZlZQAAAAAAAAAAAAABAAAABA==",
        "AAAAAAAAAAAAAAAZc2V0X25hdGl2ZV91c2VyX2NsYWltX2ZlZQAAAAAAAAMAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAHcHJvamVjdAAAAAATAAAAAAAAAAV2YWx1ZQAAAAAAAAsAAAAA",
        "AAAAAAAAAAAAAAAcc2V0X2RlZmF1bHRfbmF0aXZlX2NsYWltX2ZlZQAAAAIAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAFdmFsdWUAAAAAAAALAAAAAA==",
        "AAAAAAAAAAAAAAAdc2V0X2RlZmF1bHRfcHJvamVjdF9jbGFpbV9mZWUAAAAAAAACAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACXZhbHVlX2JwcwAAAAAAAAQAAAAA",
        "AAAAAQAAAAAAAAAAAAAAC1Byb2plY3RGZWVzAAAAAAMAAAAAAAAAFW5hdGl2ZV91c2VyX2NsYWltX2ZlZQAAAAAAAAsAAAAAAAAAEXByb2plY3RfY2xhaW1fZmVlAAAAAAAABAAAAAAAAAAKcmVtb3ZlX2ZlZQAAAAAABA==",
        "AAAAAQAAAAAAAAAAAAAAD0ZlZXNJbmZvcm1hdGlvbgAAAAACAAAAAAAAAA1mZWVfY29sbGVjdG9yAAAAAAAAEwAAAAAAAAAEZmVlcwAAB9AAAAALUHJvamVjdEZlZXMA",
        "AAAABQAAACFFbWl0dGVkIGFmdGVyIGEgY29udHJhY3QgdXBncmFkZS4AAAAAAAAAAAAAEENvbnRyYWN0VXBncmFkZWQAAAABAAAAEWNvbnRyYWN0X3VwZ3JhZGVkAAAAAAAAAgAAAAAAAAAIb3BlcmF0b3IAAAATAAAAAAAAAAAAAAANbmV3X3dhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIGdyYW50ZWQuAAAAAAAAAAAAAAtSb2xlR3JhbnRlZAAAAAABAAAADHJvbGVfZ3JhbnRlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAACVFdmVudCBlbWl0dGVkIHdoZW4gYSByb2xlIGlzIHJldm9rZWQuAAAAAAAAAAAAAAtSb2xlUmV2b2tlZAAAAAABAAAADHJvbGVfcmV2b2tlZAAAAAMAAAAAAAAABHJvbGUAAAARAAAAAQAAAAAAAAAHYWNjb3VudAAAAAATAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABAAAAAAAAAAAAAAAEkFjY2Vzc0NvbnRyb2xFcnJvcgAAAAAACwAAAAAAAAAMVW5hdXRob3JpemVkAAAH0AAAAAAAAAALQWRtaW5Ob3RTZXQAAAAH0QAAAAAAAAAQSW5kZXhPdXRPZkJvdW5kcwAAB9IAAAAAAAAAEUFkbWluUm9sZU5vdEZvdW5kAAAAAAAH0wAAAAAAAAASUm9sZUNvdW50SXNOb3RaZXJvAAAAAAfUAAAAAAAAAAxSb2xlTm90Rm91bmQAAAfVAAAAAAAAAA9BZG1pbkFscmVhZHlTZXQAAAAH1gAAAAAAAAALUm9sZU5vdEhlbGQAAAAH1wAAAAAAAAALUm9sZUlzRW1wdHkAAAAH2AAAAAAAAAASVHJhbnNmZXJJblByb2dyZXNzAAAAAAfZAAAAAAAAABBNYXhSb2xlc0V4Y2VlZGVkAAAH2g==" ]),
      options
    )
  }
  public readonly fromJSON = {
    upgrade: this.txFromJSON<null>,
        has_role: this.txFromJSON<boolean>,
        grant_role: this.txFromJSON<null>,
        keep_alive: this.txFromJSON<null>,
        revoke_role: this.txFromJSON<null>,
        manager_role: this.txFromJSON<string>,
        project_fees: this.txFromJSON<ProjectFees>,
        fee_collector: this.txFromJSON<string>,
        renounce_role: this.txFromJSON<null>,
        get_role_admin: this.txFromJSON<string>,
        set_remove_fee: this.txFromJSON<null>,
        get_role_member: this.txFromJSON<string>,
        contract_tracker: this.txFromJSON<u128>,
        get_role_members: this.txFromJSON<Array<string>>,
        has_manager_role: this.txFromJSON<boolean>,
        project_wasm_hash: this.txFromJSON<Uint8Array>,
        set_fee_collector: this.txFromJSON<null>,
        default_admin_role: this.txFromJSON<string>,
        default_remove_fee: this.txFromJSON<u32>,
        create_fuul_project: this.txFromJSON<string>,
        get_fees_information: this.txFromJSON<FeesInformation>,
        get_role_member_count: this.txFromJSON<u32>,
        set_project_claim_fee: this.txFromJSON<null>,
        set_default_remove_fee: this.txFromJSON<null>,
        default_native_claim_fee: this.txFromJSON<i128>,
        default_project_claim_fee: this.txFromJSON<u32>,
        set_native_user_claim_fee: this.txFromJSON<null>,
        set_default_native_claim_fee: this.txFromJSON<null>,
        set_default_project_claim_fee: this.txFromJSON<null>
  }
}