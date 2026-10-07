import { arm } from "./fixtures/xdr.js";
import { expect, test } from "bun:test";
import { Contract, Networks, StrKey, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import type { Api } from "@stellar/stellar-sdk/rpc";
import { FactoryContract, ManagerContract, ProjectContract, currencyType, claimReason, createClaimCheck, decodeEvent } from "../src/index.js";

const contractId = StrKey.encodeContract(Buffer.alloc(32, 8));
const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9));
const options = { contractId, networkPassphrase: Networks.STANDALONE, rpcUrl: "http://localhost:8000/rpc", allowHttp: true };

test("every core binding encodes the upgrade operator and decodes its executable hash", () => {
  const hash = Buffer.alloc(32, 7);
  for (const Client of [FactoryContract.Client, ManagerContract.Client, ProjectContract.Client]) {
    const spec = new Client(options).spec;
    const args = spec.funcArgsToScVals("upgrade", { new_wasm_hash: hash, operator: account });
    expect(args.map(value => value.type)).toEqual(["scvBytes", "scvAddress"]);
    expect(args.map(scValToNative)).toEqual([hash, account]);
    const value = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("new_wasm_hash"), val: nativeToScVal(hash) }),
      new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("operator"), val: nativeToScVal(account, { type: "address" }) }),
    ]);
    const event: Api.EventResponse = { id: "upgrade", type: "contract", contractId: new Contract(contractId),
      txHash: "b".repeat(64), ledger: 124, ledgerClosedAt: "2026-09-19T00:00:00Z",
      topic: [xdr.ScVal.scvSymbol("contract_upgraded")], value, inSuccessfulContractCall: true, transactionIndex: 1, operationIndex: 1 };
    expect(decodeEvent(event, spec).parsed).toEqual({ name: "ContractUpgraded", data: { new_wasm_hash: hash, operator: account } });
  }
});

test("current bindings preserve full numeric domains in actual ScVal arguments", () => {
  const manager = new ManagerContract.Client(options);
  const project = new ProjectContract.Client(options);
  const max = (1n << 256n) - 1n;
  const check = createClaimCheck({ project: contractId, to: account, currency: contractId,
    currencyType: currencyType.stellarAsset, reason: claimReason.endUserPayout, amount: 1n,
    tokenId: max, deadline: max, proof: Buffer.alloc(32), signers: [account] });
  const encoded = manager.spec.funcArgsToScVals("claim", { caller: account, checks: [check] });
  expect(scValToNative(encoded[1]!)[0]).toMatchObject({ token_id: max, deadline: max, amount: 1n });
  const fields = new Map(arm(arm(encoded[1]!, "scvVec").vec![0]!, "scvMap").map!.map(field => [arm(field.key, "scvSymbol").sym.toString(), field.val.type]));
  expect(fields.get("token_id")).toBe("scvU256");
  expect(fields.get("deadline")).toBe("scvU256");
  expect(fields.get("amount")).toBe("scvI128");
  for (const [method, args, type, expected] of [
    ["set_claim_cooldown", { caller: account, period: (1n << 128n) - 1n }, "scvU128", (1n << 128n) - 1n],
    ["set_required_signers", { caller: account, value: (1n << 96n) - 1n }, "scvU128", (1n << 96n) - 1n],
    ["set_currency_token_limit", { caller: account, token: contractId, limit: max }, "scvU256", max],
  ] as const) {
    const value = manager.spec.funcArgsToScVals(method, args).at(-1)!;
    expect(value.type).toBe(type);
    expect(scValToNative(value)).toBe(expected);
  }
  expect(project.spec.funcArgsToScVals("claim", { manager: contractId, to: account, currency: contractId,
    currency_type: currencyType.stellarAsset, amount: 1n, token_id: max, proof: Buffer.alloc(32), kyc_registered: false })[5]!.type).toBe("scvU256");
});

test("Manager spec decodes both actor events without inventing an actor for historical empty data", () => {
  const spec = new ManagerContract.Client(options).spec;
  for (const name of ["paused", "unpaused"]) {
    const value = xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("account"), val: nativeToScVal(account, { type: "address" }) })]);
    const event: Api.EventResponse = { id: "actor", type: "contract", contractId: new Contract(contractId),
      txHash: "a".repeat(64), ledger: 123, ledgerClosedAt: "2026-09-17T00:00:00Z",
      topic: [xdr.ScVal.scvSymbol(name)], value, inSuccessfulContractCall: true, transactionIndex: 1, operationIndex: 1 };
    expect(decodeEvent(event, spec).parsed).toEqual({ name: name === "paused" ? "Paused" : "Unpaused", data: { account } });
    expect(decodeEvent({ ...event, value: xdr.ScVal.scvMap([]) }, spec).parsed?.data).toEqual({});
  }
});
