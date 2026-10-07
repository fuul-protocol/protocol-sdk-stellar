import { arm } from "./fixtures/xdr.js";
import { expect, test } from "bun:test";
import { Keypair, StrKey, xdr, scValToNative } from "@stellar/stellar-sdk";
import { FuulActions, currencyType, claimReason, type FuulSdk, type TransactionExecutor } from "../src/index.js";

test("queued project claims retain the caller, recipient and exact proof after input mutation", async () => {
  const first = StrKey.encodeContract(Buffer.alloc(32, 1));
  const other = StrKey.encodeContract(Buffer.alloc(32, 2));
  const caller = Keypair.random().publicKey();
  const recipient = Keypair.random().publicKey();
  const visited: unknown[] = [];
  const sdk = { manager: { options: { contractId: first }, claim: async (args: unknown) => { visited.push(args); } } } as unknown as FuulSdk;
  let captured: { authorizations: { invocation: string }[] } | undefined;
  let start!: () => void;
  const gate = new Promise<void>(resolve => { start = resolve; });
  const executor = { execute: (build: () => Promise<unknown>, options: typeof captured) => { captured = options; return gate.then(build); } } as unknown as TransactionExecutor;
  const actions = new FuulActions(sdk, executor);
  const check = { project: first, to: recipient, currency: other, currencyType: currencyType.stellarAsset,
    amount: 123n, reason: claimReason.endUserPayout, deadline: 1_900_000_000n, proof: Buffer.alloc(32, 3), signers: [caller] };
  const input = { caller, checks: [check], nativeFee: { asset: other, collector: recipient, amount: 20_000n } };
  const pending = actions.claimRewards(input);
  input.caller = recipient; check.project = other; check.to = caller; check.proof.fill(4); input.checks.length = 0; input.nativeFee.amount = 99_000n; input.nativeFee.collector = caller;
  start(); await pending;
  const authorization = xdr.SorobanAuthorizedInvocation.fromXdr(captured!.authorizations[1]!.invocation, "base64");
  expect(arm(authorization.subInvocations[0]!.function, "sorobanAuthorizedFunctionTypeContractFn").contractFn.args.map(scValToNative)).toEqual([caller, recipient, 20_000n]);
  expect(visited).toEqual([{ caller, checks: [{ project_address: first, to: recipient, currency: other,
    currency_type: currencyType.stellarAsset, amount: 123n, reason: claimReason.endUserPayout,
    deadline: 1_900_000_000n, token_id: 0n, proof: Buffer.alloc(32, 3), signers: [caller] }] }]);
});
