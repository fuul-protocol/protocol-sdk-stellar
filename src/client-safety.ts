import type { Client, MethodOptions } from "@stellar/stellar-sdk/contract";
import { FuulError } from "./errors.js";

export function assertUnsignedCall(options?: MethodOptions): void {
  if (options?.signTransaction || options?.signAuthEntry || options?.restore) {
    throw new FuulError("INVALID_TRANSACTION", "Use the executor for signing and prepare restoration separately");
  }
}

/** Validate method options before upstream simulation can start an automatic restore. */
export function unsignedClient<T extends Client>(client: T): T {
  for (const fn of client.spec.funcs()) {
    const name = fn.name().toString();
    if (name === "__constructor") continue;
    const methods = client as unknown as Record<string, (...args: unknown[]) => unknown>;
    const method = methods[name]!;
    const optionsIndex = fn.inputs().length ? 1 : 0;
    methods[name] = (...args: unknown[]) => {
      assertUnsignedCall(client.options);
      assertUnsignedCall(args[optionsIndex] as MethodOptions | undefined);
      return method.apply(client, args);
    };
  }
  return client;
}
