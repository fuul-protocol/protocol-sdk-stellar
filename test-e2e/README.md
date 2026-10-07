# Network tests

These tests exercise the built SDK through a real Stellar RPC node.
They cover claims, signing, fees, replay protection, recovery, events, adapters, storage, upgrades, multisignature, and resource limits.
Disposable keys remain in memory. The suites support a local network and public Testnet.

## Prepare

Use Node.js 22.12 or later, Bun 1.3.12, Rust 1.92.0, and Stellar CLI 27.1.0.
For local tests, start Docker with Compose.
Clone the contracts repository beside this repository as `protocol-contracts-stellar`.
Use the contracts commit from `contracts.json`. Set `FUUL_CONTRACTS_PATH` if its location differs.

```sh
bun install --frozen-lockfile
bun run test:e2e
```

The runner verifies the contract source hashes, builds the contracts and test fixtures, and builds the SDK.
It starts a pinned local node on a free loopback port. It removes its own containers and ledger volume afterward.
The default protocol is 28. To test Protocol 27:

```sh
FUUL_E2E_PROTOCOL=27 bun run test:e2e
```

Builds on the recorded release platform must match the Wasm hashes in `contracts.json`.
Other platforms record their own artifact hashes while testing the same recorded sources.
Generated artifacts and transaction evidence stay in `.local/`. They are excluded from the package.

## Public Testnet

The following command submits transactions to Stellar public Testnet with disposable Friendbot-funded accounts:

```sh
bun run test:e2e testnet
```

The suite verifies the network passphrase and protocol before funding or contract execution.
The runner reads Testnet's current protocol unless `FUUL_E2E_PROTOCOL` specifies the expected version.
It rejects Mainnet and arbitrary RPC endpoints. It does not load production keys.
Some instances undergo upgrades to test-only replacements. These instances are not application deployments.
Use the separate deployment guide for a retained deployment and video demonstration.

## Fixtures and CI

`fixtures/` contains small KYC, NFT, multi-token, and storage contracts for SDK integration tests.
They are not production adapters. Upgrade fixtures come from the pinned contracts repository.
The contracts repository owns protocol invariants. This suite checks their use through the SDK and network transaction lifecycle.

GitHub Actions tests both local protocols. It checks out the contracts commit from `contracts.json`.
The delivery repositories each start with one commit. The recorded contracts commit exists in the new contracts repository.
Transfer both repositories together so that this commit remains available.
By default, the contracts repository is `<owner>/protocol-contracts-stellar`.
Set the `CONTRACTS_REPOSITORY` repository variable if its name differs.
For a private contracts repository, provide a read-only `CONTRACTS_DEPLOY_KEY` SSH key with access to that repository.
