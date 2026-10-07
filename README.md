# Fuul Stellar SDK

TypeScript clients for Fuul projects, funding, claims, administration, events and contract storage.
Supports Node.js 22.12 or later, Node.js 24, Bun, and browsers with Web Crypto.
The package provides ESM and CommonJS builds.

The [contracts repository](https://github.com/fuul-protocol/protocol-contracts-stellar) contains the Rust contracts.
[contracts.json](contracts.json) records their source commit, Wasm hashes and generated binding hashes.

## Install

After Fuul publishes this release, install it from npm:

```sh
npm install @fuul/sdk-stellar
```

To install from source, build with Node.js 22.12 or later and Bun 1.3.12:

```sh
bun install --frozen-lockfile
bun run build
npm pack
```

Install the archive in your application:

```sh
npm install /path/to/fuul-sdk-stellar-0.3.0.tgz
```

CommonJS applications can use `require("@fuul/sdk-stellar")`.
CommonJS TypeScript projects need TypeScript 5.8 or later.
TypeScript applications use `module: "NodeNext"` and `moduleResolution: "NodeNext"`.
For ESM, set `type: "module"` in the application package. Otherwise, TypeScript emits CommonJS.

This release uses Stellar JS SDK 17.2.1. Use that version for Stellar transaction and XDR objects in your application.
Stellar byte results use `Uint8Array`. Existing `Buffer` inputs remain valid.
`Uint8Array` has no hex encoding: `bytes.toString("hex")` returns comma-separated numbers without an error. Convert explicitly, for example `Buffer.from(bytes).toString("hex")`.
Decoded event topics and values follow the same rule. A string with invalid UTF-8 decodes to `Uint8Array`.
External wallets that sign authorization entries must support CAP-71 address credentials, which Stellar SDK 17 records by default.

## Create a project

Supply the network settings, deployed addresses and a wallet that implements `FuulSigner`.

```ts
import { FuulActions, FuulSdk } from "@fuul/sdk-stellar";

const sdk = new FuulSdk({
  rpcUrl,
  networkPassphrase,
  contracts: { factory, manager },
}).withSigner(walletSigner);
const executor = sdk.executor({ signer: walletSigner, maxFeeStroops: 10_000_000n });
const actions = new FuulActions(sdk, executor);
const receipt = await actions.createFuulProject({
  admin: walletSigner.address,
  uri: "ipfs://your-project",
});
```

The receipt contains the confirmed result, transaction hash and ledger.
The fee ceiling includes Soroban resource fees. It does not cap token transfers or protocol fees.

## Integration

The [API guide](docs/api-guide.md) covers claims, authorization, recovery, multisignature, events and storage maintenance.
Use `bigint` amounts. Store each payment proof before submission.
Only sign claims for Projects verified through the approved Factory.
Projects can pay multiple currencies; Manager limits apply per currency across Projects.
Any per-Project currency restriction belongs in the signing backend.
After an uncertain submission, reconcile the original transaction hash before retrying.
Applications must persist their own transaction journal and coordinate source-account sequences.

`src/contracts` contains generated clients; the remaining `src` modules provide the transaction and integration API.
The SDK does not store keys or select Mainnet addresses.

## Development

```sh
bun run typecheck
bun test ./test/
bun run build
npm run test:package
bun audit
```

The tests cover SDK behavior and installation in independent ESM and CommonJS consumers with strict TypeScript checks.
The package check also tests signing in a browser bundle without Node globals.
The [network test guide](https://github.com/fuul-protocol/protocol-sdk-stellar/blob/main/test-e2e/README.md) covers local E2E and an explicit public Testnet run.
The [deployment guide](https://github.com/fuul-protocol/protocol-contracts-stellar/blob/main/deploy.md) includes a Testnet walkthrough and Mainnet configuration.
The [SDK example](https://github.com/fuul-protocol/protocol-sdk-stellar/blob/main/examples/demo.mjs) reads state, funds Projects, submits claims and demonstrates pause controls.
After the guide exports the deployment values, run `node examples/demo.mjs status`. Writes require `--submit`; Mainnet also requires `--mainnet`.

To update contract bindings, use Rust 1.92.0, Stellar CLI 27.1.0 and a clean contracts checkout:

```sh
node scripts/bindings.mjs generate ../protocol-contracts-stellar
node scripts/bindings.mjs verify ../protocol-contracts-stellar
```

Both commands rebuild contracts in an isolated directory. Verification uses the recorded build platform and rejects changed sources, bindings or Wasm hashes.

## Publish

Use an npm account with permission to publish under the `@fuul` scope.
Run the release checks:

```sh
bun install --frozen-lockfile
bun run typecheck
bun test ./test/
npm run test:package
```

Publish from the repository root so that npm runs the lifecycle hooks:

```sh
npm publish
```

The `prepack` hook rebuilds both formats. The `prepublishOnly` hook runs the typecheck, unit tests and package check before upload.
The package check installs the archive, checks every export, and audits consumer dependencies.
`publishConfig` sets public access and the `latest` tag.
