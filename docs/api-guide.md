# API guide

## Configure the SDK

Supply `rpcUrl`, `networkPassphrase`, and the Manager and Factory addresses.
Use `verifyDeployment` with approved Wasm hashes before a write.
The SDK has no default Mainnet addresses.

The default RPC transport uses HTTPS, a 20-second request timeout, no redirects, and a 64 MiB response limit.
`rpcTimeoutMs` accepts 1 to 60,000 milliseconds.
For a local node, set `allowHttp: true`.
An injected `server` keeps its own transport configuration and cannot accompany `rpcTimeoutMs`.

`withSigner` returns clients for another source account. It does not retain wallet callbacks.
Supply signing callbacks to `sdk.executor`.
The SDK's clients reject per-call signing callbacks and automatic restoration before simulation.
Raw generated clients expose upstream APIs. Their callers must control those APIs directly.

## Read and write

Use `readContract(client.method(args))` for a simulation result.
Separate reads can observe different ledgers.

Use `executor.execute(() => client.method(args))` for a write.
Keep the builder inside `execute` so the executor selects the current account sequence.
A receipt contains the confirmed result, hash, ledger, and RPC response.

Use one executor per source account in each process.
Coordinate account sequences between processes.
The executor's queue is in memory. Persist a transaction journal in the application before production use.

The fee ceiling includes Soroban resource fees.
It does not cap token transfers, claim amounts, or protocol fees.
A wallet must preserve the transaction body and existing signatures, then add exactly one valid signature.

## Authorization

`authorizationSigners` supplies claim signers or other accounts that authorize contract calls.
For an ordinary call, the executor accepts one authorization per non-source account for the exact call, without child invocations.
Custom arguments, nested calls, or address credentials for the source require an explicit `authorizations` list.
Each list entry contains an address and the complete invocation as base64 XDR.
The executor compares the whole tree and limits repeated requests to the declared count.
Never derive this list from an RPC simulation response.

`FuulActions.claimRewards` constructs this list from your claim data.
For a direct Manager call:

```ts
const authorizations = claimAuthorizations(manager, checks);
const receipt = await executor.execute(
  () => sdk.manager.claim({ caller, checks }),
  { authorizations },
);
```

`claimAuthorizations` covers the recipient, Project, currency, amount, reason, token ID, deadline, and proof.
Claim signers permit no child invocation.
When the caller differs from the transaction source, supply `nativeFee` to `FuulActions.claimRewards`.
Set its `asset`, `collector`, and `amount` from trusted application configuration.
The amount is the exact native fee for the complete batch, including any caller exemption.
For a direct call, pass `{ address: caller, nativeFee }` as the third argument to `claimAuthorizations`.
This declares the caller's complete batch and its single native fee transfer. A changed fee requires new consent.
Use `amount: 0n` for a fee-exempt caller. Never copy this consent from simulated authorization entries.

The helper does not establish Project provenance.
The backend must sign only for Projects from the approved Factory's verified `ProjectCreated` events.
Verify the current Project code before payment if its upgrade authority is outside your custody policy.

Signers can use wallet callbacks or a backend `keypairSigner`.
Private keys must remain in the application's custody system.
A missing signer or unexpected authorization stops execution.
The executor simulates signed entries in enforcement mode before envelope signing.

## Amounts and proofs

Amounts use nonnegative `bigint` values in token base units.
Use `parseAmount` and the token's decimals to convert display amounts.
Floating point values, excess precision, and negative amounts are rejected.

`createClaimCheck` validates claim inputs and copies mutable buffers.
Deadlines use Unix seconds. NFT and multi-token IDs must fit `u32`.
Persist each 32-byte proof with its business payment before submission.
Do not replace a proof because confirmation timed out.

## Multiple currencies

A Factory can create Projects that hold and pay different assets. A Project has no fixed currency or currency allowlist.
The Manager must have a nonzero limit for each claim currency. Its cumulative limit is shared across Projects during the cooldown window.
Use `manager.add_currency_limit` to enable an asset and `manager.set_currency_token_limit` to change its limit.
The initial constructor adds both the selected asset and native XLM; these addresses must differ.

Pass the selected asset contract in each claim's `currency` and use that asset's integer base units.
Fund the Project in the same asset, including its Project fee. Native claim fees are still paid by the caller in XLM.
Recipient and collector trustlines are required for classic assets. Custom adapters need separate qualification.
The signing backend must enforce any Project-specific currency policy and verify Project provenance.
Keep each claim batch within one approved Factory because native fees use the last Project's reported collector.

## Recovery

After any uncertain submission, retain the original hash and call `executor.reconcilePending()`.
The executor does not send the transaction again.
It holds later builders until it observes success, on-chain failure, or expiry with complete RPC history coverage.
A missing result alone does not release the queue.
If the RPC no longer retains the submission window, the application must reconcile through its durable records and another provider.

For a separately stored hash, call `waitForTransaction(rpc, hash, { networkPassphrase })`.
The network passphrase is required to bind the returned envelope to that hash.
A fee-bumped receipt can resolve its included inner transaction.

| Error code | Meaning |
| --- | --- |
| `INVALID_TRANSACTION` | The call, authorization, or envelope violates the declared intent. |
| `NETWORK_MISMATCH` | The RPC reports a different network. |
| `NETWORK_ERROR` | A required preparation read failed. |
| `FEE_LIMIT` / `RESOURCE_LIMIT` | The fee or resource declaration exceeds its limit. |
| `MISSING_SIGNER` | A required authorization signer is absent. |
| `WALLET_REJECTED` / `WALLET_MUTATION` | The wallet declined or changed the requested signature. |
| `OUTCOME_UNKNOWN` | Reconcile the original hash before another submission. |
| `TRANSACTION_FAILED` | The transaction failed on chain. |
| `TRANSACTION_EXPIRED` | Complete retained history shows no inclusion before expiry. The queue is released. |
| `RESULT_DECODE_FAILED` | The transaction succeeded, but result decoding failed. Do not repeat the payment. |
| `CONTRACT_ERROR` | `details.contractCode` contains the reported contract error. |
| `RESTORATION_REQUIRED` | Prepare and approve a separate restoration transaction. |

## Other operations

Use `cosignPreparedTransaction` for account multisignature or fee sponsorship.
Supply the reviewed source, transaction hash, and fee ceiling independently of the envelope.
The helper signs without an RPC request. Account weights and thresholds still require network verification.

```ts
const signed = await cosignPreparedTransaction(prepared, signer, {
  expectedSource: reviewedSource,
  expectedHash: reviewedHash,
  maxFeeStroops: 10_000_000n,
});
```

Use `getEventPage` or `watchEvents` with a stored cursor and application-level deduplication.
RPC history is finite. The application needs an archive or backfill strategy for longer outages.

Use `getContractState` to inspect code identity and storage TTL.
`prepareLifecycleTransaction` prepares a restoration or TTL extension for explicit review and signing.
Fuul accepts external KYC, NFT, and multi-token interfaces. Verify each adapter before using it with production assets.

## Transaction resource checks

The executor checks declared Soroban resources after authorization simulation and before envelope signing.
`submitSignedTransaction` reads the limits again after signing. Both paths reject excessive declarations before submission.
The executor rejects settings older than its simulation or its earlier resource check.
Direct submission callers can pass `minimumResourceLedger` to impose the same ledger floor.
This includes restore and TTL transactions, and the inner transaction of a fee bump.

The check covers instructions, disk reads, writes, footprint entries, serialized keys and signed transaction size.
It uses the network configuration returned by RPC. It does not substitute fixed local-network limits for current network settings.
Protocol 27 or later is accepted, because the limits are read live from the network rather than assumed.
The accounting rules below were verified against Protocol 28; re-verify them after each network protocol upgrade.
Earlier protocols and missing, duplicate or malformed settings fail with `RESOURCE_CONFIG`.
Custom RPC clients passed to `submitSignedTransaction` must provide `getLedgerEntries`, in addition to the existing methods.

```ts
import { checkSorobanResources } from "@fuul/sdk-stellar/resources";

// signedTransaction has already been reviewed and signed.
const report = await checkSorobanResources(rpc, signedTransaction);
console.log(report?.usage.instructions); // bigint
console.log(report?.limits.ledger);
```

`checkSorobanResources` captures the envelope before RPC reads. It neither signs nor submits.
`RESOURCE_LIMIT` identifies the first excessive resource in `error.details.resource`, `actual` and `maximum`.
The two amounts are decimal strings. This error means the helper did not broadcast the transaction.
It does not imply that another process has not submitted the same envelope.

For an offline report, use `readSorobanResourceLimits` and `inspectSorobanResources`.
The inspector returns all resource violations and does not throw for an excessive resource.
It rejects duplicate or unsupported footprint keys and invalid restoration indexes.
Classic transactions return `undefined` and do not need Soroban configuration reads during submission.

Resource amounts in reports use `bigint`. Convert them to decimal strings when you store JSON.
The limits and reports contain immutable snapshots. Adding signatures changes transaction size; inspect the final envelope again.
For fee bumps, Core applies this resource-size check to the signed inner envelope.

These checks do not guarantee inclusion or successful execution. RPC observations can become stale before submission.
They are not cryptographic proofs of ledger membership. Simulation still checks memory, event output and contract execution.
Core still validates fees, account signatures, asset formats and all other transaction requirements.
Keep the existing fee ceiling and resolve uncertain submission outcomes by transaction hash.
Use `createFuulRpcServer` for bounded HTTP requests. Executor and submission resource checks also respect their deadline and cancellation settings.

Rules were checked against [Stellar Core v28.0.1](https://github.com/stellar/stellar-core/blob/947aad8413c189d85504acf72207e85eeda9b021/src/transactions/TransactionFrame.cpp)
and its [fee-bump delegation](https://github.com/stellar/stellar-core/blob/947aad8413c189d85504acf72207e85eeda9b021/src/transactions/FeeBumpTransactionFrame.cpp).
Stellar documents why a [successful simulation can still produce excessive resource declarations](https://developers.stellar.org/docs/learn/fundamentals/contract-development/errors-and-debugging/debugging-errors).
