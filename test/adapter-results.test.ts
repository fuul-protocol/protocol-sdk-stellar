import { expect, test } from "bun:test";
import { Account, Keypair, nativeToScVal, SorobanDataBuilder, StrKey, xdr } from "@stellar/stellar-sdk";
import type { Server } from "@stellar/stellar-sdk/rpc";
import { KycClient, MultiTokenClient, NonFungibleClient, readContract, TokenClient } from "../src/index.js";

const account = Keypair.random().publicKey();
const contract = StrKey.encodeContract(Buffer.alloc(32, 17));
function fixture() {
  let result = xdr.ScVal.scvVoid();
  const server = {
    getAccount: async () => new Account(account, "1"),
    simulateTransaction: async () => ({ id: "test", _parsed: true, latestLedger: 100, events: [], minResourceFee: "1000", transactionData: new SorobanDataBuilder().setResourceFee(1000), result: { auth: [], retval: result } }),
  } as unknown as Server;
  return {
    network: { publicKey: account, rpcUrl: "http://localhost/rpc", allowHttp: true, server, networkPassphrase: "test" },
    respond(value: xdr.ScVal) { result = value; },
  };
}

test("token reads reject return types that do not match SEP-41", async () => {
  const f = fixture(); const token = new TokenClient(contract, f.network);
  f.respond(nativeToScVal("999"));
  await expect(readContract(token.balance(account))).rejects.toThrow();
  f.respond(nativeToScVal(-1n, { type: "i128" }));
  await expect(readContract(token.balance(account))).rejects.toThrow();
  f.respond(nativeToScVal(999n, { type: "u128" }));
  await expect(readContract(token.allowance({ from: account, spender: account }))).rejects.toThrow();
  f.respond(nativeToScVal(999n, { type: "i128" }));
  expect(await readContract(token.balance(account))).toBe(999n);
  f.respond(nativeToScVal(7, { type: "i32" }));
  await expect(readContract(token.decimals())).rejects.toThrow();
  f.respond(nativeToScVal(7, { type: "u32" }));
  expect(await readContract(token.decimals())).toBe(7);
  await expect(readContract(token.name())).rejects.toThrow();
  f.respond(nativeToScVal("FUUL"));
  expect(await readContract(token.symbol())).toBe("FUUL");
});

test("KYC reads require a boolean and never accept a truthy integer", async () => {
  const f = fixture(); const kyc = new KycClient(contract, f.network);
  f.respond(nativeToScVal(1, { type: "u32" }));
  await expect(readContract(kyc.isRegistered(account))).rejects.toThrow();
  f.respond(nativeToScVal(false));
  expect(await readContract(kyc.isRegistered(account))).toBe(false);
});

test("token and asset adapter writes require the pinned void return type", async () => {
  const f = fixture();
  const calls = [
    () => new TokenClient(contract, f.network).transfer({ from: account, to: account, amount: 1n }),
    () => new NonFungibleClient(contract, f.network).transfer({ from: account, to: account, tokenId: 1 }),
    () => new MultiTokenClient(contract, f.network).transfer({ from: account, to: account, tokenId: 1, amount: 1n }),
  ];
  f.respond(nativeToScVal(false));
  for (const call of calls) await expect(readContract(call())).rejects.toThrow();
  f.respond(xdr.ScVal.scvVoid());
  for (const call of calls) expect(await readContract(call())).toBeNull();
});
