import type { Server } from "@stellar/stellar-sdk/rpc";
import type { ClientOptions as ContractClientOptions } from "@stellar/stellar-sdk/contract";

import { Client as FactoryClient } from "./contracts/fuul-factory/index.js";
import { Client as ManagerClient } from "./contracts/fuul-manager/index.js";
import { Client as ProjectClient } from "./contracts/fuul-project/index.js";
import { validateContractId } from "./validation.js";
import { TokenClient } from "./token.js";
import { TransactionExecutor, type ExecutorOptions, type FuulSigner } from "./transactions.js";
import { KycClient, MultiTokenClient, NonFungibleClient } from "./adapters.js";
import { createFuulRpcServer } from "./rpc.js";
import { unsignedClient } from "./client-safety.js";

export interface FuulContractIds {
  factory: string;
  manager: string;
}

export type FuulNetworkOptions = Omit<
  ContractClientOptions,
  "contractId" | "errorTypes" | "server"
> & {
  server?: Server;
  /** HTTP deadline in milliseconds (default 20000, maximum 60000).
   * Configure an injected server directly instead of using this option. */
  rpcTimeoutMs?: number;
};

export interface FuulSdkOptions extends FuulNetworkOptions {
  contracts: FuulContractIds;
}

/** Provides configured typed clients for every Fuul Stellar contract. */
export class FuulSdk {
  readonly rpc: Server;
  readonly factory: FactoryClient;
  readonly manager: ManagerClient;

  private readonly network: FuulNetworkOptions & { server: Server };

  constructor(options: FuulSdkOptions) {
    validateContractId(options.contracts.factory, "contracts.factory");
    validateContractId(options.contracts.manager, "contracts.manager");

    // Signing callbacks never reach the generated clients: the executor and the exported signing
    // helpers are the only signing paths, so upstream auto-restore cannot sign outside their guards.
    const { contracts, rpcTimeoutMs, signTransaction: _signTransaction, signAuthEntry: _signAuthEntry, ...network } = options;
    if (network.server !== undefined && rpcTimeoutMs !== undefined) {
      throw new Error("Configure the injected server timeout directly, or omit server to use rpcTimeoutMs");
    }
    const server =
      network.server ??
      createFuulRpcServer(network.rpcUrl, {
        allowHttp: network.allowHttp,
        headers: network.headers,
        timeout: rpcTimeoutMs,
      });
    this.network = { ...network, server };
    this.rpc = server;
    this.factory = unsignedClient(new FactoryClient({
      ...this.network,
      contractId: contracts.factory,
    }));
    this.manager = unsignedClient(new ManagerClient({
      ...this.network,
      contractId: contracts.manager,
    }));
  }

  project(contractId: string): ProjectClient {
    validateContractId(contractId, "project contract ID");
    return unsignedClient(new ProjectClient({ ...this.network, contractId }));
  }

  /** Create clients for another source account. The original clients stay independent. */
  withSigner(signer: FuulSigner): FuulSdk {
    return new FuulSdk({
      ...this.network, publicKey: signer.address, signTransaction: undefined, signAuthEntry: undefined,
      contracts: { factory: this.factory.options.contractId, manager: this.manager.options.contractId },
    });
  }

  executor(options: Omit<ExecutorOptions, "rpc" | "networkPassphrase">): TransactionExecutor {
    return new TransactionExecutor({ ...options, rpc: this.rpc, networkPassphrase: this.network.networkPassphrase });
  }

  token(contractId: string): TokenClient { return new TokenClient(contractId, this.network); }
  kyc(contractId: string): KycClient { return new KycClient(contractId, this.network); }
  nonFungible(contractId: string): NonFungibleClient { return new NonFungibleClient(contractId, this.network); }
  multiToken(contractId: string): MultiTokenClient { return new MultiTokenClient(contractId, this.network); }

}
