import { Networks, StrKey } from "@stellar/stellar-sdk";
import type { Server } from "@stellar/stellar-sdk/rpc";

export const target = process.env.FUUL_E2E_NETWORK ?? "local";
if (!["local", "testnet"].includes(target)) throw new Error("E2E supports only local or Testnet");
export const protocol = process.env.FUUL_E2E_PROTOCOL ?? "28";
if (!["27", "28"].includes(protocol)) throw new Error("FUUL_E2E_PROTOCOL must be 27 or 28");
const port = process.env.FUUL_E2E_PORT ?? "18010";
if (!/^[0-9]{4,5}$/.test(port) || Number(port) > 65535 || Number(port) < 1024) throw new Error("Invalid local test port");
export const allowHttp = target === "local";
export const rpcUrl = allowHttp ? `http://127.0.0.1:${port}/soroban/rpc` : "https://soroban-testnet.stellar.org";
export const networkPassphrase = allowHttp ? Networks.STANDALONE : Networks.TESTNET;
export const evidenceTag = `${target}-${protocol}`;

export async function guardNetwork(rpc: Pick<Server, "getNetwork" | "getHealth">): Promise<void> {
  const [network, health] = await Promise.all([rpc.getNetwork(), rpc.getHealth()]);
  if (network.passphrase !== networkPassphrase || Number(network.protocolVersion) !== Number(protocol) || health.status !== "healthy") {
    throw new Error("E2E network identity or health does not match the selected target");
  }
}

/** Keys remain in memory. Only disposable account public keys reach Friendbot. */
export async function fundTestAccount(rpc: Pick<Server, "getNetwork" | "getHealth" | "getAccount">, account: string): Promise<void> {
  if (!StrKey.isValidEd25519PublicKey(account)) throw new Error("Invalid account public key");
  await guardNetwork(rpc);
  const faucet = allowHttp ? `http://127.0.0.1:${port}/friendbot` : "https://friendbot.stellar.org/";
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try { await rpc.getAccount(account); return; } catch { /* The disposable account can be absent. */ }
    try {
      const response = await fetch(`${faucet}?addr=${account}`, { signal: AbortSignal.timeout(20_000), redirect: "error" });
      if (response.ok) { await rpc.getAccount(account); return; }
      if (response.status < 500 && ![400, 429].includes(response.status)) throw new Error(`Friendbot rejected funding: ${response.status}`);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Friendbot rejected")) throw error;
    }
    await Bun.sleep(1000);
  }
  await rpc.getAccount(account);
}
