import { afterEach, describe, expect, test } from "bun:test";
import { createFuulRpcServer } from "../src/index.js";

const STELLAR_RPC_MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("bounded Stellar RPC HTTP transport", () => {
  test("aborts a stalled request using the actual HTTP timeout", async () => {
    let calls = 0; let aborted = false;
    globalThis.fetch = (async (_url, init) => new Promise((_resolve, reject) => {
      calls++; expect(init?.redirect).toBe("manual");
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal!.reason); }, { once: true });
    })) as typeof fetch;
    const server = createFuulRpcServer("https://rpc-fixture.invalid/", { timeout: 10 });
    const result = await Promise.race([server.getNetwork().catch(error => error), new Promise(resolve => setTimeout(() => resolve("timeout not applied"), 250))]);
    expect(result).toBeInstanceOf(Error); expect(String(result)).toContain("timeout"); expect(aborted).toBe(true); expect(calls).toBe(1);
  });

  test("rejects redirects without forwarding a second RPC request", async () => {
    let calls = 0;
    globalThis.fetch = (async (_url, init) => {
      calls++; expect(init?.redirect).toBe("manual");
      return new Response(null, { status: 307, headers: { location: "https://different-provider.invalid/" } });
    }) as typeof fetch;
    await expect(createFuulRpcServer("https://rpc-fixture.invalid/").getNetwork()).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test("caps streamed responses before parsing an oversized valid JSON body", async () => {
    let cancelled = false; let emitted = 0;
    globalThis.fetch = (async (_url, _init) => new Response(new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted === 0) controller.enqueue(new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"result":{"networkPassphrase":"'));
        else if (emitted <= STELLAR_RPC_MAX_RESPONSE_BYTES / (1024 * 1024) + 1) controller.enqueue(new Uint8Array(1024 * 1024).fill(97));
        else { controller.enqueue(new TextEncoder().encode('"}}')); controller.close(); }
        emitted++;
      }, cancel() { cancelled = true; },
    }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const error = await createFuulRpcServer("https://rpc-fixture.invalid/").getNetwork().catch(error => error);
    expect(error).toBeInstanceOf(Error); expect(String(error)).toContain("maxContentLength"); expect(cancelled).toBe(true);
    expect(emitted).toBeLessThanOrEqual(STELLAR_RPC_MAX_RESPONSE_BYTES / (1024 * 1024) + 2);
  });

  test("preserves the exact JSON-RPC request and parses a bounded successful response", async () => {
    const passphrase = "Test SDF Network ; September 2015"; let calls = 0;
    globalThis.fetch = (async (url, init) => {
      calls++; expect(String(url)).toBe("https://rpc-fixture.invalid/"); expect(init?.method).toBe("POST");
      const request = JSON.parse(String(init?.body)); expect(request.method).toBe("getNetwork"); expect(request.jsonrpc).toBe("2.0");
      return Response.json({ jsonrpc: "2.0", id: request.id, result: { passphrase, protocolVersion: 28 } });
    }) as typeof fetch;
    // Current RPC JSON uses a number while this pinned SDK declaration says
    // string. Verify the actual preserved JSON without coercing that wire value.
    expect(JSON.stringify(await createFuulRpcServer("https://rpc-fixture.invalid/").getNetwork())).toBe(JSON.stringify({ passphrase, protocolVersion: 28 }));
    expect(calls).toBe(1);
  });

  test("keeps HTTP restricted to explicitly selected local callers and rejects unbounded timeouts", () => {
    expect(() => createFuulRpcServer("http://127.0.0.1:18000/")).toThrow();
    expect(createFuulRpcServer("http://127.0.0.1:18000/", { allowHttp: true, timeout: 60_000 }).httpClient.defaults.timeout).toBe(60_000);
    for (const timeout of [0, -1, 60_001, Infinity, NaN]) expect(() => createFuulRpcServer("https://rpc-fixture.invalid/", { timeout })).toThrow("timeout");
  });
});
