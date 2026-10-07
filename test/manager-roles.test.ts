import { expect, test } from "bun:test";
import { Networks, StrKey, scValToNative } from "@stellar/stellar-sdk";
import * as sdk from "../src/index.js";

test("public Manager role meanings encode as the existing Soroban symbols", () => {
  const roles = Reflect.get(sdk, "MANAGER_ROLES");
  expect(roles).toBeDefined();
  const client = new sdk.ManagerContract.Client({
    contractId: StrKey.encodeContract(Buffer.alloc(32, 1)),
    networkPassphrase: Networks.STANDALONE, rpcUrl: "http://localhost:8000/rpc", allowHttp: true,
  });
  const account = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
  for (const [meaning, symbol] of [
    ["DEFAULT_ADMIN_ROLE", "default_admin"], ["PAUSER_ROLE", "pauser"],
    ["UNPAUSER_ROLE", "unpauser"], ["CLAIM_SIGNER_ROLE", "claim_signer"],
  ] as const) {
    const args = client.spec.funcArgsToScVals("grant_role", { role: roles[meaning], account, caller: account });
    expect(args[0]!.type).toBe("scvSymbol");
    expect(scValToNative(args[0]!)).toBe(symbol);
  }
  expect(Object.keys(roles)).toHaveLength(4);
  expect(Object.isFrozen(roles)).toBe(true);
});
