# Fuul Stellar SDK

TypeScript clients for Fuul projects, funding, claims, administration, events and contract storage.
Supports Node.js 22 and 24, Bun, and browsers with Web Crypto.

Build from this repository or install a release archive. The package is not published to npm.
The [contracts repository](https://github.com/eloizxyz/protocol-contracts-stellar) contains the Rust contracts.
[contracts.json](contracts.json) records their source commit, Wasm hashes and generated binding hashes.

## Install

Build with Node.js 22 and Bun 1.3.12:

```sh
bun install --frozen-lockfile
bun run build
npm pack --ignore-scripts
```

Install the archive in your application:

```sh
npm install /path/to/fuul-protocol-stellar-sdk-0.2.0-rc.8.tgz
```

## Create a project

Supply the network settings, deployed addresses and a wallet that implements `FuulSigner`.

```ts
import { FuulActions, FuulSdk } from "@fuul-protocol/stellar-sdk";

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
node test/package.mjs
bun audit
```

The tests cover SDK behavior and installation in an independent, strict TypeScript consumer.
The [network test guide](https://github.com/eloizxyz/protocol-sdk-stellar/blob/main/test-e2e/README.md) covers local E2E and an explicit public Testnet run.
The [deployment guide](https://github.com/eloizxyz/protocol-contracts-stellar/blob/main/deploy.md) includes a Testnet walkthrough and Mainnet configuration.
The [SDK example](https://github.com/eloizxyz/protocol-sdk-stellar/blob/main/examples/demo.mjs) reads state, funds Projects, submits claims and demonstrates pause controls.
After the guide exports the deployment values, run `node examples/demo.mjs status`. Writes require `--submit`; Mainnet also requires `--mainnet`.

To update contract bindings, use Rust 1.92.0, Stellar CLI 27.1.0 and a clean contracts checkout:

```sh
node scripts/bindings.mjs generate ../protocol-contracts-stellar
node scripts/bindings.mjs verify ../protocol-contracts-stellar
```

Both commands rebuild contracts in an isolated directory. Verification uses the recorded build platform and rejects changed sources, bindings or Wasm hashes.
