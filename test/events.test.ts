import { expect, test } from "bun:test";
import { Contract, StrKey, nativeToScVal } from "@stellar/stellar-sdk";
import type { Api, Server } from "@stellar/stellar-sdk/rpc";
import type { Spec } from "@stellar/stellar-sdk/contract";
import { decodeEvent, getEventPage, watchEvents } from "../src/index.js";

const contractId = StrKey.encodeContract(Buffer.alloc(32, 8));
const event = { id: "event-1", type: "contract", contractId: new Contract(contractId), txHash: "a".repeat(64), ledger: 123, ledgerClosedAt: "2026-09-06T00:00:00Z", topic: [nativeToScVal("claimed", { type: "symbol" })], value: nativeToScVal(9007199254740993n, { type: "i128" }), inSuccessfulContractCall: true, transactionIndex: 1, operationIndex: 1 } satisfies Api.EventResponse;
const response = { events: [event], cursor: "next-cursor", latestLedger: 124, oldestLedger: 1, latestLedgerCloseTime: "1", oldestLedgerCloseTime: "0" };

test("event decoding preserves bigint values and transaction coordinates", () => {
  expect(decodeEvent(event)).toMatchObject({ contractId, ledger: 123, topics: ["claimed"], value: 9007199254740993n, hash: "a".repeat(64) });
});
test("pagination switches to a cursor without repeating ledger bounds", async () => {
  const requests: Api.GetEventsRequest[] = [];
  const rpc = { async getEvents(request: Api.GetEventsRequest) { requests.push(request); return response; } };
  const first = await getEventPage(rpc, { contractIds: [contractId], startLedger: 100 });
  await getEventPage({ getEvents: async request => { requests.push(request); return { ...response, cursor: "last-cursor", events: [] }; } }, { contractIds: [contractId], cursor: first.cursor });
  expect(requests[0]).toHaveProperty("startLedger", 100);
  expect(requests[1]).not.toHaveProperty("startLedger");
  expect(requests[1]).toHaveProperty("cursor", "next-cursor");
});
test("rejects mixed pagination modes and non-advancing pages", async () => {
  const rpc = { getEvents: async () => response };
  await expect(getEventPage(rpc, { contractIds: [contractId], startLedger: 1, cursor: "bad" } as never)).rejects.toThrow();
  await expect(getEventPage(rpc, { contractIds: [contractId], cursor: "next-cursor" })).rejects.toThrow("did not advance");
  await expect(getEventPage(rpc, { contractIds: [], startLedger: 1 })).rejects.toThrow();
  await expect(getEventPage(rpc, { contractIds: [contractId], startLedger: 2, endLedger: 1 })).rejects.toThrow();
});
test("advances past failed contract calls without exposing their events", async () => {
  const page = await getEventPage({ getEvents: async () => ({ ...response, events: [{ ...event, inSuccessfulContractCall: false }] }) }, { contractIds: [contractId], startLedger: 1 });
  expect(page.events).toEqual([]); expect(page.cursor).toBe("next-cursor");
});
test("cancels an event stream even if an RPC read hangs", async () => {
  const rpc = { getEvents: () => new Promise(() => {}) } as unknown as Server;
  const controller = new AbortController();
  const stream = watchEvents(rpc, { contractIds: [contractId], startLedger: 1 }, { signal: controller.signal });
  const pending = stream.next(); controller.abort();
  expect((await pending).done).toBe(true);
});

test("cursor validation uses the request snapshot after an RPC wait", async () => {
  const query = { contractIds: [contractId], cursor: "request-cursor" };
  const rpc = { async getEvents() {
    query.cursor = "changed-by-caller";
    return { ...response, cursor: "request-cursor" };
  } };
  await expect(getEventPage(rpc, query)).rejects.toThrow("did not advance");
});

test("event decoding retains the specification selected when the request starts", async () => {
  const selected = { parseEvent: () => ({ name: "Original", data: {} }) } as unknown as Spec;
  const replacement = { parseEvent: () => ({ name: "Replacement", data: {} }) } as unknown as Spec;
  const specs = new Map([[contractId, selected]]);
  const rpc = { async getEvents() { specs.set(contractId, replacement); return response; } };
  expect((await getEventPage(rpc, { contractIds: [contractId], startLedger: 1 }, specs)).events[0]!.parsed?.name).toBe("Original");
});

test("a stream retains its query when configuration changes before the first read", async () => {
  const query = { contractIds: [contractId], startLedger: 100 };
  const controller = new AbortController();
  let requested: Api.GetEventsRequest | undefined;
  const rpc = { async getEvents(request: Api.GetEventsRequest) { requested = request; return response; } };
  const stream = watchEvents(rpc, query, { signal: controller.signal });
  query.startLedger = 120;
  try {
    await stream.next();
    expect(requested).toHaveProperty("startLedger", 100);
  } finally { controller.abort(); await stream.return(undefined); }
});

test("an active stream retains its query and continuation cursor across consumer processing", async () => {
  const requests: Api.GetEventsRequest[] = [];
  const controller = new AbortController();
  const query = { contractIds: [contractId], startLedger: 100, limit: 1 };
  const rpc = { async getEvents(request: Api.GetEventsRequest) {
    requests.push(request);
    return { ...response, cursor: `cursor-${requests.length}` };
  } };
  const stream = watchEvents(rpc, query, { signal: controller.signal, pollIntervalMs: 1 });
  try {
    const first = await stream.next();
    query.contractIds[0] = StrKey.encodeContract(Buffer.alloc(32, 99));
    query.limit = 50;
    first.value!.cursor = "consumer-edited-cursor";
    await stream.next();
    expect(requests[0]).toHaveProperty("startLedger", 100);
    expect(requests[1]).toMatchObject({ cursor: "cursor-1", filters: [{ type: "contract", contractIds: [contractId] }], limit: 1 });
  } finally { controller.abort(); await stream.return(undefined); }
});

test("stream cancellation keeps the original signal when the options object changes", async () => {
  const controller = new AbortController();
  const replacement = new AbortController();
  const options = { signal: controller.signal, pollIntervalMs: 1 };
  const rpc = { getEvents: () => new Promise(() => {}) } as unknown as Server;
  const stream = watchEvents(rpc, { contractIds: [contractId], startLedger: 1 }, options);
  options.signal = replacement.signal;
  const pending = stream.next();
  controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    expect(await Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("not cancelled"), 100); })])).toMatchObject({ done: true });
  } finally { clearTimeout(timer); replacement.abort(); await stream.return(undefined); }
});

test("rejects non-string input and response cursors", async () => {
  let calls = 0;
  const rpc = { async getEvents() { calls++; return response; } };
  await expect(getEventPage(rpc, { contractIds: [contractId], cursor: 123 as unknown as string })).rejects.toThrow(TypeError);
  expect(calls).toBe(0);
  await expect(getEventPage({ getEvents: async () => ({ ...response, cursor: 123 as unknown as string }) }, { contractIds: [contractId], startLedger: 1 })).rejects.toThrow("cursor");
});
