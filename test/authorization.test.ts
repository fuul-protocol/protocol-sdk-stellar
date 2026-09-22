import { expect, test } from "bun:test";
import { Address, Keypair, Networks, StrKey, nativeToScVal, xdr } from "@stellar/stellar-sdk";
import { ManagerContract, claimAuthorizations, claimReason, createClaimCheck, currencyType } from "../src/index.js";

const manager = StrKey.encodeContract(Buffer.alloc(32, 1));
const asset = StrKey.encodeContract(Buffer.alloc(32, 2));
const caller = Keypair.random().publicKey();
const collector = Keypair.random().publicKey();
const signer = Keypair.random().publicKey();
const client = new ManagerContract.Client({ contractId: manager, rpcUrl: "https://example.invalid", networkPassphrase: Networks.TESTNET });

for (const kind of [currencyType.stellarAsset, currencyType.nonFungible, currencyType.multiToken]) {
  test(`caller intent matches the generated ${kind.tag} ABI and its exact native fee`, () => {
    const checks = [createClaimCheck({ project: manager, currency: asset, to: collector, currencyType: kind,
      amount: 123n, tokenId: 9n, reason: claimReason.endUserPayout, deadline: (1n << 256n) - 1n, proof: Buffer.alloc(32, 5), signers: [signer] })];
    const expected = claimAuthorizations(manager, checks, { address: caller, nativeFee: { asset, collector, amount: 20_000n } });
    expect(expected).toHaveLength(2);
    const root = xdr.SorobanAuthorizedInvocation.fromXDR(expected[1]!.invocation, "base64");
    expect(root.function().contractFn().args().map(value => value.toXDR("base64"))).toEqual(
      client.spec.funcArgsToScVals("claim", { caller, checks }).map(value => value.toXDR("base64")));
    expect(root.subInvocations()).toHaveLength(1);
    const child = root.subInvocations()[0]!;
    expect(child.function().contractFn().contractAddress().toXDR("base64")).toBe(new Address(asset).toScAddress().toXDR("base64"));
    expect(child.function().contractFn().functionName().toString()).toBe("transfer");
    expect(child.function().contractFn().args().map(value => value.toXDR("base64"))).toEqual([
      new Address(caller).toScVal(), new Address(collector).toScVal(), nativeToScVal(20_000n, { type: "i128" }),
    ].map(value => value.toXDR("base64")));
    expect(child.subInvocations()).toHaveLength(0);
    expect(xdr.SorobanAuthorizedInvocation.fromXDR(expected[0]!.invocation, "base64").subInvocations()).toHaveLength(0);
    const free = claimAuthorizations(manager, checks, { address: caller, nativeFee: { asset, collector, amount: 0n } });
    expect(xdr.SorobanAuthorizedInvocation.fromXDR(free[1]!.invocation, "base64").subInvocations()).toHaveLength(0);
    for (const amount of [-1n, 1n << 127n]) expect(() => claimAuthorizations(manager, checks, { address: caller, nativeFee: { asset, collector, amount } })).toThrow();
  });
}
