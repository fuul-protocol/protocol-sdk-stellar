import { Server } from "@stellar/stellar-sdk/rpc";

/** Create an RPC client with an actual HTTP deadline and bounded responses.
 * The pinned Stellar SDK does not apply its constructor timeout to HTTP.
 * Transaction recovery and operation deadlines remain the caller's responsibility.
 */
export function createFuulRpcServer(url: string, options: Server.Options = {}): Server {
  const timeout = options.timeout ?? 20_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000) {
    throw new RangeError("RPC timeout must be an integer between 1 and 60000 milliseconds");
  }
  const server = new Server(url, {
    allowHttp: options.allowHttp ?? false,
    ...(options.headers ? { headers: { ...options.headers } } : {}),
  });
  Object.assign(server.httpClient.defaults, {
    timeout,
    maxRedirects: 0,
    maxContentLength: 64 * 1024 * 1024,
  });
  return server;
}
