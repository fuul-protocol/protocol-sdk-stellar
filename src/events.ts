import { scValToNative } from "@stellar/stellar-sdk";
import type { Spec } from "@stellar/stellar-sdk/contract";
import type { Api, Server } from "@stellar/stellar-sdk/rpc";
import { validateContractId } from "./validation.js";

export interface DecodedEvent {
  id: string;
  contractId?: string;
  hash: string;
  ledger: number;
  closedAt: string;
  topics: unknown[];
  value: unknown;
  /** Present when a matching contract specification was supplied. */
  parsed?: { name: string; data: Record<string, unknown> };
  raw: Api.EventResponse;
}
export function decodeEvent(event: Api.EventResponse, spec?: Spec): DecodedEvent {
  return {
    id: event.id, contractId: event.contractId?.contractId(), hash: event.txHash,
    ledger: event.ledger, closedAt: event.ledgerClosedAt,
    topics: event.topic.map(scValToNative), value: scValToNative(event.value),
    parsed: spec?.parseEvent(event.topic, event.value), raw: event,
  };
}
export interface EventPage {
  events: DecodedEvent[];
  /** Persist after processing the page to resume without gaps. */
  cursor: string;
  latestLedger: number;
  oldestLedger: number;
}
export type EventQuery = { contractIds: readonly string[]; limit?: number } & (
  { startLedger: number; endLedger?: number; cursor?: never } |
  { cursor: string; startLedger?: never; endLedger?: never }
);

export async function getEventPage(rpc: Pick<Server, "getEvents">, query: EventQuery, specs: ReadonlyMap<string, Spec> = new Map()): Promise<EventPage> {
  query = { ...query, contractIds: [...query.contractIds] };
  specs = new Map(specs);
  if (!query.contractIds.length || query.contractIds.length > 5) throw new RangeError("query must contain one to five contract IDs");
  query.contractIds.forEach(id => validateContractId(id, "event contract ID"));
  const limit = query.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) throw new RangeError("event limit must be from 1 to 10000");
  const filters: Api.EventFilter[] = [{ type: "contract", contractIds: [...query.contractIds] }];
  let request: Api.GetEventsRequest;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || !query.cursor) throw new TypeError("cursor must be a nonempty string");
    if (query.startLedger !== undefined || query.endLedger !== undefined) throw new TypeError("cursor and ledger bounds are mutually exclusive");
    request = { filters, cursor: query.cursor, limit };
  } else {
    if (!Number.isInteger(query.startLedger) || query.startLedger < 1 || query.startLedger > 0xffff_ffff) throw new RangeError("startLedger must be a positive u32");
    if (query.endLedger !== undefined && (!Number.isInteger(query.endLedger) || query.endLedger <= query.startLedger || query.endLedger > 0xffff_ffff)) throw new RangeError("endLedger must exceed startLedger and fit u32");
    request = { filters, startLedger: query.startLedger, endLedger: query.endLedger, limit };
  }
  const response = await rpc.getEvents(request);
  if (typeof response.cursor !== "string" || !response.cursor || (response.events.length && response.cursor === query.cursor)) throw new Error("RPC event cursor did not advance");
  return {
    events: response.events.filter(event => event.inSuccessfulContractCall).map(event => decodeEvent(event, specs.get(event.contractId?.contractId() ?? ""))),
    cursor: response.cursor, latestLedger: response.latestLedger, oldestLedger: response.oldestLedger,
  };
}

/** Follow event pages. The consumer owns durable cursor storage and processing retries. */
export function watchEvents(rpc: Pick<Server, "getEvents">, query: EventQuery, options: { signal: AbortSignal; pollIntervalMs?: number; specs?: ReadonlyMap<string, Spec> }): AsyncGenerator<EventPage, void, unknown> {
  // An async generator does not execute until next(). Capture configuration here,
  // before the caller can reuse its query or options for a different subscription.
  query = { ...query, contractIds: [...query.contractIds] };
  const signal = options.signal;
  const specs = new Map(options.specs);
  const interval = options.pollIntervalMs ?? 5_000;
  if (!Number.isSafeInteger(interval) || interval <= 0 || interval > 2_147_483_647) throw new RangeError("pollIntervalMs must be from 1 to 2147483647");
  if (query.endLedger !== undefined) throw new TypeError("watchEvents follows an open-ended stream; use getEventPage for a bounded range");
  return (async function* () {
    let next = query;
    while (!signal.aborted) {
      const page = await new Promise<EventPage | undefined>((resolve, reject) => {
        const cancel = () => { signal.removeEventListener("abort", cancel); resolve(undefined); };
        signal.addEventListener("abort", cancel, { once: true });
        getEventPage(rpc, next, specs).then(value => { signal.removeEventListener("abort", cancel); resolve(value); }, error => { signal.removeEventListener("abort", cancel); reject(error); });
        if (signal.aborted) cancel();
      });
      if (signal.aborted || page === undefined) return;
      // A yielded page belongs to the consumer. Save the continuation before yielding.
      next = { contractIds: query.contractIds, cursor: page.cursor, limit: query.limit };
      const fullPage = page.events.length >= (query.limit ?? 100);
      yield page;
      if (fullPage) continue;
      await new Promise<void>(resolve => {
        if (signal.aborted) { resolve(); return; }
        const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, interval);
        signal.addEventListener("abort", done, { once: true });
      });
    }
  })();
}
