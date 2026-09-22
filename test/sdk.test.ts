import { describe, expect, test } from "bun:test";
import { Networks, StrKey } from "@stellar/stellar-sdk";
import { Buffer } from "buffer";
import { Server } from "@stellar/stellar-sdk/rpc";

import { FuulSdk } from "../src/index.js";

const contractId = (byte: number) => StrKey.encodeContract(Buffer.alloc(32, byte));

describe("FuulSdk", () => {
  test("shares its bounded RPC across clients and signer changes", () => {
    const headers = { "x-fixture": "first" };
    const sdk = new FuulSdk({
      rpcUrl: "https://rpc.invalid", networkPassphrase: Networks.TESTNET,
      contracts: { factory: contractId(1), manager: contractId(2) }, rpcTimeoutMs: 1234, headers,
    });
    headers["x-fixture"] = "changed";
    expect(sdk.rpc.httpClient.defaults.timeout).toBe(1234);
    expect(new Headers(sdk.rpc.httpClient.defaults.headers).get("x-fixture")).toBe("first");
    expect(sdk.factory.options.server).toBe(sdk.rpc);
    expect(sdk.manager.options.server).toBe(sdk.rpc);
    expect(sdk.project(contractId(3)).options.server).toBe(sdk.rpc);
    const other = sdk.withSigner({ address: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4)), signTransaction: async signedTxXdr => ({ signedTxXdr }) });
    expect(other.rpc).toBe(sdk.rpc);
    expect(other.manager.options.server).toBe(sdk.rpc);
  });

  test("never forwards caller-supplied signing callbacks to the generated clients", () => {
    const signTransaction = async (signedTxXdr: string) => ({ signedTxXdr });
    const signAuthEntry = async (entry: string) => ({ signedAuthEntry: entry });
    const sdk = new FuulSdk({ rpcUrl: "https://rpc.invalid", networkPassphrase: Networks.TESTNET,
      contracts: { factory: contractId(1), manager: contractId(2) }, publicKey: StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9)), signTransaction, signAuthEntry } as never);
    for (const client of [sdk.factory, sdk.manager, sdk.project(contractId(3))]) {
      expect(client.options.signTransaction).toBeUndefined();
      expect(client.options.signAuthEntry).toBeUndefined();
      expect(client.options.publicKey).toBe(StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 9)));
    }
  });

  test("preserves an injected server and rejects a conflicting timeout", () => {
    const server = new Server("https://injected.invalid");
    Object.assign(server.httpClient.defaults, { timeout: 777, maxRedirects: 2, maxContentLength: 2048 });
    const options = { rpcUrl: "https://rpc.invalid", networkPassphrase: Networks.TESTNET,
      contracts: { factory: contractId(1), manager: contractId(2) }, server };
    const sdk = new FuulSdk(options);
    expect(sdk.rpc).toBe(server);
    expect(server.httpClient.defaults.timeout).toBe(777);
    expect(server.httpClient.defaults.maxRedirects).toBe(2);
    expect(server.httpClient.defaults.maxContentLength).toBe(2048);
    expect(() => new FuulSdk({ ...options, rpcTimeoutMs: 1000 })).toThrow("injected server");
  });

  test("configures all generated clients without a network request", () => {
    const ids = {
      factory: contractId(1),
      manager: contractId(2),
    };
    const sdk = new FuulSdk({
      rpcUrl: "https://rpc.invalid",
      networkPassphrase: Networks.TESTNET,
      contracts: ids,
    });

    expect(sdk.factory.options.contractId).toBe(ids.factory);
    expect(sdk.manager.options.contractId).toBe(ids.manager);
    expect(sdk.project(contractId(4)).options.contractId).toBe(contractId(4));
    expect(typeof sdk.manager.claim).toBe("function");
    expect(typeof sdk.factory.create_fuul_project).toBe("function");
  });

  test("rejects account IDs where contract IDs are required", () => {
    expect(
      () =>
        new FuulSdk({
          rpcUrl: "https://rpc.invalid",
          networkPassphrase: Networks.TESTNET,
          contracts: {
            factory: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
            manager: contractId(2),
          },
        }),
    ).toThrow("valid Stellar contract ID");
  });
});

test("rejects per-call auto-restore and signing callbacks before any RPC request", () => {
  const sdk = new FuulSdk({ rpcUrl: "https://must-not-be-read.invalid", networkPassphrase: Networks.TESTNET,
    contracts: { factory: contractId(1), manager: contractId(2) } });
  const unsafe = { restore: true, signTransaction: async (signedTxXdr: string) => ({ signedTxXdr }) };
  expect(() => sdk.manager.required_signers(unsafe)).toThrow("executor");
  expect(() => sdk.factory.contract_tracker(unsafe)).toThrow("executor");
  expect(() => sdk.project(contractId(3)).factory(unsafe)).toThrow("executor");
  expect(() => sdk.token(contractId(4)).decimals(unsafe)).toThrow("executor");
});
