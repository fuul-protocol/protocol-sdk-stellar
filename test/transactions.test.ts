import { arm } from "./fixtures/xdr.js";
import { describe, expect, spyOn, test } from "bun:test";
import { Account, Address, buildAuthorizationEntryPreimage, buildWithDelegatesEntry, Contract, hash, inspectAuthEntry, Keypair, Networks, SorobanDataBuilder, StrKey, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, type SignAuthEntry } from "@stellar/stellar-sdk/contract";
import { Api, type Server } from "@stellar/stellar-sdk/rpc";
import { TransactionExecutor, keypairSigner, submitSignedTransaction, signPreparedTransaction, waitForTransaction, type FuulSigner } from "../src/index.js";
import { resourceConfigFixture } from "./fixtures/resources.js";

const key = Keypair.random();
const contractId = StrKey.encodeContract(Buffer.alloc(32, 42));
const networkPassphrase = Networks.STANDALONE;
function fixture() {
  let sequence = 1;
  let sends = 0;
  let hash = "";
  let envelope: xdr.TransactionEnvelope | undefined;
  const rpc = {
    async getNetwork() { return { passphrase: networkPassphrase, protocolVersion: 28 }; },
    async getLedgerEntries() { return resourceConfigFixture(); },
    async getLatestLedger() { return { id: "ledger", sequence: 100, protocolVersion: 28 }; },
    async getAccount() { return new Account(key.publicKey(), String(sequence)); },
    async simulateTransaction() { return {
      id: "test", latestLedger: 100, _parsed: true,
      minResourceFee: "1000", transactionData: new SorobanDataBuilder().setResources(10000, 0, 0).setResourceFee(1000),
      result: { auth: [], retval: xdr.ScVal.scvU32(42) }, events: [],
    }; },
    async sendTransaction(tx: { hash(): Uint8Array; sequence?: string; toEnvelope(): xdr.TransactionEnvelope }) { sends++; if (tx.sequence !== undefined) sequence = Number(tx.sequence); hash = Buffer.from(tx.hash()).toString("hex"); envelope = tx.toEnvelope(); return { status: "PENDING", hash }; },
    // Like the real RPC, a confirmed observation carries the included envelope.
    async getTransaction(requested: string) { return { status: Api.GetTransactionStatus.SUCCESS, txHash: requested, ledger: 102, envelopeXdr: envelope, returnValue: xdr.ScVal.scvU32(43) }; },
  };
  const server = rpc as unknown as Server;
  const build = () => AssembledTransaction.build<number>({ publicKey: key.publicKey(), rpcUrl: "http://localhost/rpc", allowHttp: true, server, networkPassphrase, contractId, method: "answer", parseResultXdr: val => arm(val, "scvU32").u32 });
  const executor = (signer = keypairSigner(key), maxFeeStroops = 10000n) => new TransactionExecutor({ rpc: server, networkPassphrase, signer, maxFeeStroops });
  return { rpc, server, build, executor, get sends() { return sends; } };
}

function unsignedAuthorization(address: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
      address: new Address(address).toScAddress(), nonce: xdr.Int64.fromString("123"),
      signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid(),
    })),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({
        contractAddress: new Address(contractId).toScAddress(), functionName: "answer", args: [],
      })), subInvocations: [],
    }),
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Preparation did not settle promptly")), 500);
    })]);
  } finally { clearTimeout(timer); }
}

describe("transaction execution", () => {
  test("rejects oversized simulations before the envelope wallet and leaves the queue available", async () => {
    const f = fixture(), signer = keypairSigner(key); let wallets = 0;
    const executor = f.executor({ address: key.publicKey(), async signTransaction(...args) { wallets++; return signer.signTransaction(...args); } });
    f.rpc.getLedgerEntries = async () => {
      const response = resourceConfigFixture();
      Reflect.set(arm(arm(response.entries[0]!.val, "configSetting").configSetting, "configSettingContractComputeV0").contractCompute, "txMaxInstructions", xdr.Int64.fromString("9999"));
      return response;
    };
    await expect(executor.execute(f.build)).rejects.toMatchObject({ code: "RESOURCE_LIMIT" });
    expect(wallets).toBe(0); expect(f.sends).toBe(0); expect(executor.pendingTransactionHash).toBeUndefined();
    f.rpc.getLedgerEntries = async () => resourceConfigFixture();
    expect((await executor.execute(f.build)).result).toBe(43); expect(wallets).toBe(1); expect(f.sends).toBe(1);
  });
  test("rechecks network limits after wallet review and includes the final envelope signature", async () => {
    for (const mode of ["limits-change", "signature-size", "stale-ledger"] as const) {
      const f = fixture(), signer = keypairSigner(key); let signed = false, unsignedSize = 0;
      f.rpc.getLedgerEntries = async () => {
        const response = resourceConfigFixture();
        if (mode === "limits-change" && signed) Reflect.set(arm(arm(response.entries[0]!.val, "configSetting").configSetting, "configSettingContractComputeV0").contractCompute, "txMaxInstructions", xdr.Int64.fromString("9999"));
        if (mode === "signature-size" && signed) Reflect.set(arm(arm(response.entries[3]!.val, "configSetting").configSetting, "configSettingContractBandwidthV0").contractBandwidth, "txMaxSizeBytes", unsignedSize);
        if (mode === "stale-ledger" && signed) response.latestLedger = 99;
        return response;
      };
      const executor = f.executor({ address: key.publicKey(), async signTransaction(envelope, options) {
        unsignedSize = TransactionBuilder.fromXdr(envelope, networkPassphrase).toEnvelope().toXdr().length;
        const result = await signer.signTransaction(envelope, options); signed = true; return result;
      } });
      await expect(executor.execute(f.build)).rejects.toMatchObject(mode === "stale-ledger" ? { code: "RESOURCE_CONFIG" }
        : { code: "RESOURCE_LIMIT", details: { resource: mode === "limits-change" ? "instructions" : "transactionBytes" } });
      expect(signed).toBe(true); expect(f.sends).toBe(0); expect(executor.pendingTransactionHash).toBeUndefined();
    }
  });
  test("allows wallet review to exceed the RPC timeout while the transaction remains valid", async () => {
    for (const phase of ["authorization", "envelope"] as const) {
      const f = fixture(); const authorizer = Keypair.random(); const wallet = keypairSigner(key);
      const authWallet = keypairSigner(authorizer).signAuthEntry as SignAuthEntry;
      const simulate = f.server.simulateTransaction.bind(f.server);
      if (phase === "authorization") f.server.simulateTransaction = async (...args) => ({
        ...await simulate(...args), result: { auth: [unsignedAuthorization(authorizer.publicKey())], retval: xdr.ScVal.scvU32(42) },
      });
      const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, maxFeeStroops: 10000n,
        signer: { address: key.publicKey(), async signTransaction(...args) {
          if (phase === "envelope") await new Promise(resolve => setTimeout(resolve, 50));
          return wallet.signTransaction(...args);
        } },
        authorizationSigners: [{ address: authorizer.publicKey(), async signAuthEntry(...args) {
          await new Promise(resolve => setTimeout(resolve, 50)); return authWallet(...args);
        } }],
      });
      expect((await executor.execute(f.build, { timeoutMs: 20 })).result).toBe(43);
      expect(f.sends).toBe(1);
    }
  });
  test("cancels stalled preparation reads and ignores their late results", async () => {
    for (const phase of ["build", "enforce"] as const) {
      const f = fixture(); const executor = f.executor(); const controller = new AbortController();
      const entered = deferred<void>(); const release = deferred<void>();
      const simulate = f.server.simulateTransaction.bind(f.server);
      if (phase === "enforce") f.server.simulateTransaction = async (...args) => {
        if (args[2] === "enforce") { entered.resolve(); await release.promise; }
        return simulate(...args);
      };
      const pending = executor.execute(async () => {
        if (phase === "build") { entered.resolve(); await release.promise; }
        return f.build();
      }, { signal: controller.signal });
      await withDeadline(entered.promise); controller.abort();
      try {
        await expect(withDeadline(pending)).rejects.toMatchObject({ code: "ABORTED" });
        expect(executor.pendingTransactionHash).toBeUndefined(); expect(f.sends).toBe(0);
        f.server.simulateTransaction = simulate;
        expect((await withDeadline(executor.execute(f.build))).result).toBe(43);
        expect(f.sends).toBe(1);
      } finally { release.resolve(); await pending.catch(() => undefined); }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.sends).toBe(1);
    }
  });
  test("bounds stalled preparation reads without creating an unresolved submission", async () => {
    for (const phase of ["build", "enforce"] as const) {
      const f = fixture(); const executor = f.executor(); const release = deferred<void>();
      const simulate = f.server.simulateTransaction.bind(f.server);
      if (phase === "enforce") f.server.simulateTransaction = async (...args) => {
        if (args[2] === "enforce") await release.promise;
        return simulate(...args);
      };
      const pending = executor.execute(async () => {
        if (phase === "build") await release.promise;
        return f.build();
      }, { timeoutMs: 20 });
      try {
        await expect(withDeadline(pending)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
        expect(executor.pendingTransactionHash).toBeUndefined(); expect(f.sends).toBe(0);
      } finally { release.resolve(); await pending.catch(() => undefined); }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.sends).toBe(0);
    }
  });
  test("cancels stalled authorization and envelope wallets without submitting late signatures", async () => {
    for (const phase of ["authorization", "envelope"] as const) {
      const f = fixture(); const controller = new AbortController();
      const entered = deferred<void>(); const release = deferred<void>();
      const authorizer = Keypair.random(); const wallet = keypairSigner(key);
      const authWallet = keypairSigner(authorizer).signAuthEntry as SignAuthEntry;
      const simulate = f.server.simulateTransaction.bind(f.server);
      if (phase === "authorization") f.server.simulateTransaction = async (...args) => ({
        ...await simulate(...args), result: { auth: [unsignedAuthorization(authorizer.publicKey())], retval: xdr.ScVal.scvU32(42) },
      });
      let envelopeCalls = 0, stall = true;
      const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, maxFeeStroops: 10000n,
        signer: { address: key.publicKey(), async signTransaction(...args) {
          envelopeCalls++;
          if (phase === "envelope" && stall) { entered.resolve(); await release.promise; }
          return wallet.signTransaction(...args);
        } },
        authorizationSigners: [{ address: authorizer.publicKey(), async signAuthEntry(...args) {
          if (stall) { entered.resolve(); await release.promise; }
          return authWallet(...args);
        } }],
      });
      const pending = executor.execute(f.build, { signal: controller.signal });
      await withDeadline(entered.promise); controller.abort();
      try {
        await expect(withDeadline(pending)).rejects.toMatchObject({ code: "ABORTED" });
        expect(executor.pendingTransactionHash).toBeUndefined(); expect(f.sends).toBe(0);
        expect(envelopeCalls).toBe(phase === "envelope" ? 1 : 0);
        stall = false;
        expect((await withDeadline(executor.execute(f.build))).result).toBe(43);
        expect(f.sends).toBe(1);
      } finally { release.resolve(); await pending.catch(() => undefined); }
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(f.sends).toBe(1);
    }
  });
  test("retains the prepared operation and result parser while an authorization wallet waits", async () => {
    const f = fixture(); const authorizer = Keypair.random();
    const simulate = f.rpc.simulateTransaction;
    f.server.simulateTransaction = async () => ({ ...await simulate(), result: { auth: [unsignedAuthorization(authorizer.publicKey())], retval: xdr.ScVal.scvU32(42) } });
    const assembled = await f.build();
    const signAuthEntry = keypairSigner(authorizer).signAuthEntry as SignAuthEntry;
    let submittedMethod = "", authorizationCalls = 0;
    const send = f.rpc.sendTransaction;
    f.server.sendTransaction = async tx => {
      if (!(tx instanceof Transaction) || tx.operations[0]?.type !== "invokeHostFunction") throw new Error("Expected a contract call");
      submittedMethod = arm(tx.operations[0].func, "hostFunctionTypeInvokeContract").invokeContract.functionName.toString();
      return await send(tx) as Api.SendTransactionResponse;
    };
    const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, signer: keypairSigner(key), maxFeeStroops: 10000n,
      authorizationSigners: [{ address: authorizer.publicKey(), async signAuthEntry(preimage, options) {
        authorizationCalls++;
        await Promise.resolve();
        assembled.built = TransactionBuilder.cloneFrom(assembled.built!, { fee: assembled.built!.fee })
          .clearOperations().addOperation(new Contract(contractId).call("unexpected_operation")).build();
        assembled.options.parseResultXdr = () => 999;
        return signAuthEntry(preimage, options);
      } }],
    });
    const receipt = await executor.execute(() => Promise.resolve(assembled));
    expect(authorizationCalls).toBe(1);
    expect(submittedMethod).toBe("answer");
    expect(receipt.result).toBe(43);
    expect(f.sends).toBe(1);
  });
  test("accepts signer instances with prototype methods and private state", async () => {
    class Wallet implements FuulSigner {
      #signer = keypairSigner(key);
      get address() { return this.#signer.address; }
      signTransaction(...args: Parameters<FuulSigner["signTransaction"]>) { return this.#signer.signTransaction(...args); }
    }
    const f = fixture();
    expect((await f.executor(new Wallet()).execute(f.build)).result).toBe(43);
    expect(f.sends).toBe(1);
  });
  test("binds authorization callbacks to signer instances without retaining enumerable signing material", async () => {
    const f = fixture(); const authKey = Keypair.random();
    class Authorizer {
      #signer = keypairSigner(authKey);
      get address() { return this.#signer.address; }
      signAuthEntry(...args: Parameters<SignAuthEntry>) { authorized = true; return (this.#signer.signAuthEntry as SignAuthEntry)(...args); }
    }
    const authorizer = new Authorizer(); let authorized = false;
    const simulate = f.rpc.simulateTransaction;
    f.server.simulateTransaction = async () => ({ ...await simulate(), result: { auth: [unsignedAuthorization(authorizer.address)], retval: xdr.ScVal.scvU32(42) } });
    const assembled = await f.build();
    const executor = new TransactionExecutor({ rpc: f.server, signer: keypairSigner(key), networkPassphrase, maxFeeStroops: 10000n, authorizationSigners: [authorizer] });
    expect((await executor.execute(() => Promise.resolve(assembled))).result).toBe(43);
    expect(authorized).toBe(true);
    const serialized = JSON.parse(JSON.stringify(executor, (_name, value) => typeof value === "bigint" ? value.toString() : value));
    expect(Object.keys(serialized.options.authorizationSigners[0])).toEqual(["address"]);
  });
  test("signs private copies of legacy and upgraded authorization credentials with exact invocation bytes", async () => {
    for (const kind of ["address", "addressV2", "addressWithDelegates"] as const) {
      const f = fixture(); const authorizer = Keypair.random();
      let entry = unsignedAuthorization(authorizer.publicKey());
      if (kind === "addressV2") Reflect.set(entry, "credentials", xdr.SorobanCredentials.sorobanCredentialsAddressV2(arm(entry.credentials, "sorobanCredentialsAddress").address));
      if (kind === "addressWithDelegates") entry = buildWithDelegatesEntry({ entry, validUntilLedgerSeq: 0, delegates: [{ address: key.publicKey(), signature: xdr.ScVal.scvU32(7) }] });
      const original = entry.toXdr("base64");
      const simulate = f.rpc.simulateTransaction;
      f.server.simulateTransaction = async (tx, _resources, mode) => {
        if (mode === "enforce") {
          if (!(tx instanceof Transaction) || tx.operations[0]?.type !== "invokeHostFunction") throw new Error("Expected contract operation");
          const signed = tx.operations[0].auth![0]!;
          const info = inspectAuthEntry(signed);
          expect(info.credentialType).toBe(kind);
          expect(info.address).toBe(authorizer.publicKey());
          expect(info.nonce).toBe(123n);
          expect(info.signatureExpirationLedger).toBe(200);
          expect(signed.rootInvocation.toXdr("base64")).toBe(entry.rootInvocation.toXdr("base64"));
          expect(authorizer.verify(hash(buildAuthorizationEntryPreimage(signed, 200, networkPassphrase).toXdr()), info.signers[0]!.signatures![0]!.signature)).toBe(true);
          if (kind === "addressWithDelegates") expect(arm(info.signers[1]!.rawSignature, "scvU32").u32).toBe(7);
        }
        return { ...await simulate(), result: { auth: [entry], retval: xdr.ScVal.scvU32(42) } };
      };
      const assembled = await f.build();
      const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, signer: keypairSigner(key), maxFeeStroops: 10000n, authorizationSigners: [keypairSigner(authorizer)] });
      expect((await executor.execute(() => Promise.resolve(assembled))).result).toBe(43);
      expect(entry.toXdr("base64")).toBe(original);
      expect(assembled.built!.operations[0]!.type).toBe("invokeHostFunction");
      expect(f.sends).toBe(1);
    }
  });
  test("signs every repeated-address root independently without merging consent and intent", async () => {
    const f = fixture();
    const entries = [123, 124, 125].map((nonce, index) => {
      const entry = unsignedAuthorization(key.publicKey());
      Reflect.set(arm(entry.credentials, "sorobanCredentialsAddress").address, "nonce", xdr.Int64.fromString(String(nonce)));
      Reflect.set(arm(entry.rootInvocation.function, "sorobanAuthorizedFunctionTypeContractFn").contractFn, "args", [xdr.ScVal.scvU32(index)]);
      return entry;
    });
    const original = entries.map(entry => entry.toXdr("base64"));
    const simulate = f.rpc.simulateTransaction;
    let enforced = 0;
    f.server.simulateTransaction = async (tx, _resources, mode) => {
      if (mode === "enforce") {
        if (!(tx instanceof Transaction) || tx.operations[0]?.type !== "invokeHostFunction") throw new Error("Expected contract operation");
        const signed = tx.operations[0].auth!;
        expect(signed).toHaveLength(3);
        for (const [index, entry] of signed.entries()) {
          const info = inspectAuthEntry(entry);
          expect(info.nonce).toBe(BigInt(123 + index));
          expect(entry.rootInvocation.toXdr("base64")).toBe(entries[index]!.rootInvocation.toXdr("base64"));
          expect(key.verify(hash(buildAuthorizationEntryPreimage(entry, 200, networkPassphrase).toXdr()), info.signers[0]!.signatures![0]!.signature)).toBe(true);
        }
        enforced++;
      }
      return { ...await simulate(), result: { auth: entries, retval: xdr.ScVal.scvU32(42) } };
    };
    expect((await f.executor().execute(f.build, { authorizations: entries.map(entry => ({ address: key.publicKey(), invocation: entry.rootInvocation.toXdr("base64") })) })).result).toBe(43);
    expect(enforced).toBe(1);
    expect(f.sends).toBe(1);
    expect(entries.map(entry => entry.toXdr("base64"))).toEqual(original);
  });
  test("rejects an invalid authorization ledger before asking the wallet or submitting", async () => {
    for (const sequence of [NaN, 0, -1, 1.5, 0xffff_ffff - 99]) {
      const f = fixture(); const authorizer = Keypair.random(); let signs = 0;
      const simulate = f.rpc.simulateTransaction;
      f.server.simulateTransaction = async () => ({ ...await simulate(), result: { auth: [unsignedAuthorization(authorizer.publicKey())], retval: xdr.ScVal.scvU32(42) } });
      f.rpc.getLatestLedger = async () => ({ id: "ledger", sequence, protocolVersion: 28 });
      const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, signer: keypairSigner(key), maxFeeStroops: 10000n,
        authorizationSigners: [{ address: authorizer.publicKey(), async signAuthEntry() { signs++; throw new Error("must not sign"); } }],
      });
      await expect(executor.execute(f.build)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
      expect(signs).toBe(0); expect(f.sends).toBe(0);
    }
  });
  test("does not expose signing material through the signer object's properties", () => {
    const signer = keypairSigner(key);
    expect(typeof signer.signAuthEntry).toBe("function");
    // Only inspect property names; test diagnostics must never contain key material.
    expect(Object.keys(JSON.parse(JSON.stringify(signer)))).toEqual(["address"]);
  });
  test("returns the confirmed result, not the simulated result", async () => {
    const f = fixture();
    const tx = await f.build();
    expect(tx.result).toBe(42);
    const result = await f.executor().execute(() => Promise.resolve(tx));
    expect(result.result).toBe(43);
    expect(result.ledger).toBe(102);
    expect(f.sends).toBe(1);
  });
  test("rejects a fee above the budget before asking the wallet", async () => {
    const f = fixture(); let signs = 0;
    const signer = { ...keypairSigner(key), signTransaction: async () => { signs++; throw new Error("must not sign"); } };
    await expect(f.executor(signer, 1n).execute(f.build)).rejects.toMatchObject({ code: "FEE_LIMIT" });
    expect(signs).toBe(0); expect(f.sends).toBe(0);
  });
  test("rejects a wallet that changes the fee or source transaction", async () => {
    const f = fixture();
    const signer: FuulSigner = { address: key.publicKey(), async signTransaction() {
      const tx = new TransactionBuilder(new Account(key.publicKey(), "1"), { fee: "9999", networkPassphrase }).addOperation(new Contract(contractId).call("answer")).setTimeout(60).build();
      tx.sign(key); return { signedTxXdr: tx.toXdr() };
    } };
    await expect(f.executor(signer).execute(f.build)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
    expect(f.sends).toBe(0);
  });
  test("checks the network before simulation or signing", async () => {
    const f = fixture(); let built = false;
    f.rpc.getNetwork = async () => ({ passphrase: Networks.PUBLIC, protocolVersion: 28 });
    await expect(f.executor().execute(() => { built = true; return f.build(); })).rejects.toMatchObject({ code: "NETWORK_MISMATCH" });
    expect(built).toBe(false); expect(f.sends).toBe(0);
  });
  test("serializes builders and continues after an earlier failure", async () => {
    const f = fixture(); const execute = f.executor(); const sequences: string[] = [];
    const results = await Promise.allSettled([
      execute.execute(async () => { throw new Error("first simulation fails"); }),
      execute.execute(async () => { const tx = await f.build(); sequences.push(tx.built!.sequence); return tx; }),
      execute.execute(async () => { const tx = await f.build(); sequences.push(tx.built!.sequence); return tx; }),
    ]);
    expect(results.map(result => result.status)).toEqual(["rejected", "fulfilled", "fulfilled"]);
    expect(sequences).toEqual(["2", "3"]);
  });
  test("holds later builders after an uncertain submission until the original hash is reconciled", async () => {
    const f = fixture(); const executor = f.executor(); const send = f.rpc.sendTransaction;
    f.rpc.sendTransaction = async tx => { await send(tx); throw new Error("lost response after acceptance"); };
    await expect(executor.execute(f.build)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    let built = false;
    await expect(executor.execute(() => { built = true; return f.build(); })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(built).toBe(false); expect(f.sends).toBe(1);
    // Reconciliation reads the original hash, consumes no sequence, and releases the queue only after confirmation.
    const recovered = await executor.reconcilePending();
    expect(recovered?.ledger).toBe(102); expect(f.sends).toBe(1);
    f.rpc.sendTransaction = send;
    expect((await executor.execute(f.build)).result).toBe(43);
    expect(f.sends).toBe(2);
  });
  test("does not submit an already cancelled action", async () => {
    const f = fixture();
    await expect(f.executor().execute(f.build, { signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "ABORTED" });
    expect(f.sends).toBe(0);
  });
  test("checks the final resource fee after signed authorization simulation", async () => {
    const f = fixture(); const simulate = f.rpc.simulateTransaction;
    let simulations = 0, signs = 0;
    f.rpc.simulateTransaction = async () => {
      const response = await simulate();
      if (++simulations > 1) { response.minResourceFee = "20000"; response.transactionData.setResourceFee(20000); }
      return response;
    };
    const signer = { ...keypairSigner(key), signTransaction: async () => { signs++; throw new Error("must not sign"); } };
    await expect(f.executor(signer).execute(f.build)).rejects.toMatchObject({ code: "FEE_LIMIT" });
    expect(signs).toBe(0); expect(f.sends).toBe(0);
  });
  test("stops invalid authorizations before requesting the envelope signature", async () => {
    const f = fixture(); const simulate = f.rpc.simulateTransaction;
    let signs = 0;
    f.server.simulateTransaction = async (_tx, _resources, mode) => mode === "enforce" ? { _parsed: true, error: "HostError: Error(Auth, InvalidAction)", id: "bad-auth", latestLedger: 100, events: [] } : simulate();
    const signer = { ...keypairSigner(key), signTransaction: async () => { signs++; throw new Error("must not sign"); } };
    await expect(f.executor(signer).execute(f.build)).rejects.toMatchObject({ code: "SIMULATION_FAILED" });
    expect(signs).toBe(0); expect(f.sends).toBe(0);
  });
  test("returns contract codes from both simulations and keeps the queue usable", async () => {
    for (const phase of ["initial", "enforced"] as const) {
      const f = fixture(); const simulate = f.server.simulateTransaction.bind(f.server);
      let signs = 0;
      const wallet = keypairSigner(key);
      const signer = { ...wallet, async signTransaction(...args: Parameters<typeof wallet.signTransaction>) {
        signs++; return wallet.signTransaction(...args);
      } };
      f.server.simulateTransaction = async (...args) => phase === "initial" || args[2] === "enforce"
        ? { _parsed: true, error: "HostError: Error(Contract, #6102)", id: "replay", latestLedger: 100, events: [] }
        : simulate(...args);
      const executor = f.executor(signer);
      await expect(executor.execute(f.build)).rejects.toMatchObject({
        code: "CONTRACT_ERROR", details: { contractCode: 6102 },
      });
      expect(signs).toBe(0); expect(f.sends).toBe(0);
      expect(executor.pendingTransactionHash).toBeUndefined();
      f.server.simulateTransaction = simulate;
      expect((await executor.execute(f.build)).result).toBe(43);
      expect(signs).toBe(1); expect(f.sends).toBe(1);
    }
  });
  test("distinguishes a confirmed payment from a result decoding failure", async () => {
    const f = fixture();
    const tx = await f.build(); tx.options.parseResultXdr = value => { if (arm(value, "scvU32").u32 === 43) throw new Error("incompatible confirmed result"); return arm(value, "scvU32").u32; };
    await expect(f.executor().execute(() => Promise.resolve(tx))).rejects.toMatchObject({ code: "RESULT_DECODE_FAILED" });
    expect(f.sends).toBe(1);
  });
  test("rejects an incompatible simulated return type before requesting an envelope signature", async () => {
    for (const invalidPass of ["initial", "enforced"]) {
      const f = fixture(); let signs = 0;
      const signer = { ...keypairSigner(key), signTransaction: async () => { signs++; throw new Error("must not sign"); } };
      const tx = await f.build();
      tx.options.parseResultXdr = value => {
        if (invalidPass === "initial" || value.type !== "scvU32") throw new TypeError("incompatible return type");
        return value.u32;
      };
      if (invalidPass === "enforced") {
        const simulate = f.rpc.simulateTransaction;
        f.server.simulateTransaction = async () => ({ ...await simulate(), result: { auth: [], retval: xdr.ScVal.scvBool(false) } });
      }
      await expect(f.executor(signer).execute(() => Promise.resolve(tx))).rejects.toThrow("incompatible return type");
      expect(signs).toBe(0); expect(f.sends).toBe(0);
    }
  });
});

describe("submission and confirmation", () => {
  test("rejects regular and sponsored transactions that expire while the wallet waits", async () => {
    for (const sponsored of [false, true]) {
      const f = fixture(); const inner = (await f.build()).built!;
      inner.sign(key);
      const tx = sponsored ? TransactionBuilder.buildFeeBumpTransaction(key, "100", inner, networkPassphrase) : inner;
      const expiredTime = (Number(inner.timeBounds!.maxTime) + 1) * 1000;
      const wallet = keypairSigner(key); let clock: ReturnType<typeof spyOn<typeof Date, "now">> | undefined;
      try {
        await expect(signPreparedTransaction(tx as Transaction, { address: key.publicKey(), async signTransaction(...args) {
          const result = await wallet.signTransaction(...args);
          clock = spyOn(Date, "now").mockReturnValue(expiredTime);
          return result;
        } }, 10000n)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
        expect(f.sends).toBe(0);
      } finally { clock?.mockRestore(); }
    }
  });
  test("rejects removal of existing signatures while collecting another signature", async () => {
    const f = fixture(); const tx = (await f.build()).built!;
    const cosigner = Keypair.random(); tx.sign(cosigner);
    const wallet: FuulSigner = { address: key.publicKey(), async signTransaction(envelope) {
      const changed = TransactionBuilder.fromXdr(envelope, networkPassphrase);
      changed.signatures.splice(0); changed.sign(key);
      return { signedTxXdr: changed.toXdr() };
    } };
    await expect(signPreparedTransaction(tx, wallet, 10000n)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
    const signed = await signPreparedTransaction(tx, keypairSigner(key), 10000n);
    expect(signed.signatures.map(signature => signature.toXdr("base64"))).toContain(tx.signatures[0]!.toXdr("base64"));
    expect(signed.signatures.length).toBe(2);
  });
  test("rejects a wallet that adds a garbage or foreign signature instead of the signer's own", async () => {
    const f = fixture(); const tx = (await f.build()).built!;
    const garbage = { address: key.publicKey(), signTransaction: async (envelope: string) => {
      const copy = TransactionBuilder.fromXdr(envelope, networkPassphrase) as Transaction;
      copy.signatures.push(new xdr.DecoratedSignature({ hint: key.signatureHint(), signature: Buffer.alloc(64, 7) }));
      return { signedTxXdr: copy.toXdr() };
    } };
    await expect(signPreparedTransaction(tx, garbage, 10000n)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
    const foreign = { address: key.publicKey(), signTransaction: async (envelope: string) => {
      const copy = TransactionBuilder.fromXdr(envelope, networkPassphrase) as Transaction; copy.sign(Keypair.random());
      return { signedTxXdr: copy.toXdr() };
    } };
    await expect(signPreparedTransaction(tx, foreign, 10000n)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
    const padded = { address: key.publicKey(), signTransaction: async (envelope: string) => ({ signedTxXdr: " " + envelope }) };
    await expect(signPreparedTransaction(tx, padded, 10000n)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
    expect((await signPreparedTransaction(tx, keypairSigner(key), 10000n)).signatures.length).toBe(1);
  });
  test("binds a confirmed observation to the returned envelope, not the echoed hash", async () => {
    const f = fixture(); const tx = (await f.build()).built!; tx.sign(key);
    const other = new TransactionBuilder(new Account(key.publicKey(), "77"), { fee: "9999", networkPassphrase }).addOperation(new Contract(contractId).call("answer")).setTimeout(60).build(); other.sign(key);
    const hash = Buffer.from(tx.hash()).toString("hex");
    f.rpc.getTransaction = async requested => ({ status: Api.GetTransactionStatus.SUCCESS, txHash: requested, ledger: 105, envelopeXdr: other.toEnvelope(), returnValue: xdr.ScVal.scvU32(43) });
    await expect(waitForTransaction(f.server, hash, { networkPassphrase })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await expect(submitSignedTransaction(f.server, tx)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN", details: { hash } });
    f.rpc.getTransaction = async requested => ({ status: Api.GetTransactionStatus.SUCCESS, txHash: requested, ledger: 105, envelopeXdr: tx.toEnvelope(), returnValue: xdr.ScVal.scvU32(43) });
    expect((await waitForTransaction(f.server, hash, { networkPassphrase })).ledger).toBe(105);
    expect((await waitForTransaction(f.server, hash, { networkPassphrase })).ledger).toBe(105);
  });
  test("cancels a stalled submission with a recoverable hash and sends only once", async () => {
    const f = fixture(); const tx = (await f.build()).built!; tx.sign(key);
    const controller = new AbortController(); let attempts = 0;
    f.rpc.sendTransaction = () => { attempts++; controller.abort(); return new Promise(() => {}); };
    const pending = submitSignedTransaction(f.server, tx, { signal: controller.signal });
    // The independent deadline makes a pre-fix hang fail promptly without leaving timers behind.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("submission did not cancel")), 100); })])).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN", details: { hash: Buffer.from(tx.hash()).toString("hex") } });
    } finally { clearTimeout(timer); }
    expect(attempts).toBe(1);
  });
  test("bounds a stalled submission and identity read without losing outcome semantics", async () => {
    const f = fixture(); const tx = (await f.build()).built!; tx.sign(key);
    f.rpc.sendTransaction = () => new Promise(() => {});
    await expect(submitSignedTransaction(f.server, tx, { timeoutMs: 10 })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN", details: { hash: Buffer.from(tx.hash()).toString("hex") } });
    f.rpc.getNetwork = () => new Promise(() => {});
    await expect(submitSignedTransaction(f.server, tx, { timeoutMs: 10 })).rejects.toMatchObject({ code: "NETWORK_ERROR" });
    const controller = new AbortController();
    const pending = submitSignedTransaction(f.server, tx, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "ABORTED" });
    expect(f.sends).toBe(0);
  });
  test("retains the transaction hash for malformed acknowledgements and incomplete confirmation records", async () => {
    const f = fixture(); const tx = (await f.build()).built!; tx.sign(key);
    f.server.sendTransaction = async () => ({ status: "PENDING" }) as Api.SendTransactionResponse;
    await expect(submitSignedTransaction(f.server, tx)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN", details: { hash: Buffer.from(tx.hash()).toString("hex") } });
    const rpc = { getTransaction: async () => ({ status: Api.GetTransactionStatus.SUCCESS, ledger: 102 }) } as unknown as Server;
    await expect(waitForTransaction(rpc, Buffer.from(tx.hash()).toString("hex"), { networkPassphrase })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  test("a lost submission response retains the exact hash without resubmitting", async () => {
    const f = fixture(); let attempts = 0;
    const tx = (await f.build()).built!; tx.sign(key);
    f.rpc.sendTransaction = async () => { attempts++; throw new Error("connection lost after acceptance"); };
    await expect(submitSignedTransaction(f.server, tx)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN", details: { hash: Buffer.from(tx.hash()).toString("hex") } });
    expect(attempts).toBe(1);
    f.rpc.getTransaction = async txHash => ({ status: Api.GetTransactionStatus.SUCCESS, txHash, ledger: 102, envelopeXdr: tx.toEnvelope(), returnValue: xdr.ScVal.scvU32(43) });
    expect((await waitForTransaction(f.server, Buffer.from(tx.hash()).toString("hex"), { networkPassphrase })).ledger).toBe(102);
  });
  test("retries failed reads but never a rejected submission", async () => {
    const f = fixture(); let reads = 0;
    const tx = (await f.build()).built!; tx.sign(key);
    f.rpc.getTransaction = async hash => { if (++reads === 1) throw new Error("temporary transport failure"); return { status: Api.GetTransactionStatus.SUCCESS, txHash: hash, ledger: 104, envelopeXdr: tx.toEnvelope(), returnValue: xdr.ScVal.scvU32(1) }; };
    expect((await waitForTransaction(f.server, Buffer.from(tx.hash()).toString("hex"), { networkPassphrase, pollIntervalMs: 1 })).ledger).toBe(104);
    f.rpc.sendTransaction = async () => ({ status: "TRY_AGAIN_LATER", hash: Buffer.from(tx.hash()).toString("hex") });
    await expect(submitSignedTransaction(f.server, tx)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
  });
  test("timeout and cancellation preserve an unknown outcome", async () => {
    const rpc = { getTransaction: async () => ({ status: "NOT_FOUND" }) } as unknown as Server;
    await expect(waitForTransaction(rpc, "b".repeat(64), { networkPassphrase, timeoutMs: 5, pollIntervalMs: 1 })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await expect(waitForTransaction(rpc, "b".repeat(64), { networkPassphrase, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    await expect(waitForTransaction(rpc, "b".repeat(64), { networkPassphrase, timeoutMs: 0 })).rejects.toThrow();
  });
  test("enforces the confirmation deadline even if a read never resolves", async () => {
    const rpc = { getTransaction: () => new Promise(() => {}) } as unknown as Server;
    const started = Date.now();
    await expect(waitForTransaction(rpc, "c".repeat(64), { networkPassphrase, timeoutMs: 10 })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(Date.now() - started).toBeLessThan(500);
  });
  test("validates confirmation settings before sending funds", async () => {
    const f = fixture(); const tx = (await f.build()).built!; tx.sign(key);
    await expect(submitSignedTransaction(f.server, tx, { timeoutMs: 0 })).rejects.toThrow();
    expect(f.sends).toBe(0);
  });
  test("signs and submits fee sponsorship without changing the inner transaction", async () => {
    const f = fixture(); const inner = (await f.build()).built!; inner.sign(key);
    const payer = Keypair.random();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(payer.publicKey(), "200", inner, networkPassphrase);
    const signed = await signPreparedTransaction(feeBump, keypairSigner(payer), 10000n);
    expect(signed.innerTransaction.toXdr()).toBe(inner.toXdr());
    expect(signed.feeSource).toBe(payer.publicKey());
    expect(signed.signatures.length).toBe(1);
    expect((await submitSignedTransaction(f.server, signed)).ledger).toBe(102);
    expect(f.sends).toBe(1);
  });
});

describe("authorization intent boundaries", () => {
  test("rejects a hostile root, changed arguments, child call, duplicate, or undeclared source authorization before any signature", async () => {
    for (const mode of ["contract", "function", "arguments", "child", "duplicate", "source", "late-invalid"] as const) {
      const f = fixture(); const other = Keypair.random(); let signs = 0;
      const entry = unsignedAuthorization(mode === "source" ? key.publicKey() : other.publicKey());
      const root = arm(entry.rootInvocation.function, "sorobanAuthorizedFunctionTypeContractFn").contractFn;
      if (mode === "contract") Reflect.set(root, "contractAddress", new Address(StrKey.encodeContract(Buffer.alloc(32, 99))).toScAddress());
      if (mode === "function") Reflect.set(root, "functionName", new xdr.XdrString("transfer"));
      if (mode === "arguments") Reflect.set(root, "args", [xdr.ScVal.scvU32(999)]);
      if (mode === "child") Reflect.set(entry.rootInvocation, "subInvocations", [unsignedAuthorization(other.publicKey()).rootInvocation]);
      const entries = [entry];
      if (mode === "duplicate" || mode === "late-invalid") {
        const extra = unsignedAuthorization(other.publicKey());
        Reflect.set(arm(extra.credentials, "sorobanCredentialsAddress").address, "nonce", xdr.Int64.fromString("124"));
        if (mode === "late-invalid") Reflect.set(arm(extra.rootInvocation.function, "sorobanAuthorizedFunctionTypeContractFn").contractFn, "functionName", new xdr.XdrString("steal"));
        entries.push(extra);
      }
      const simulate = f.rpc.simulateTransaction;
      f.server.simulateTransaction = async () => ({ ...await simulate(), result: { auth: entries, retval: xdr.ScVal.scvU32(42) } });
      const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, maxFeeStroops: 10000n,
        signer: { ...keypairSigner(key), async signAuthEntry() { signs++; throw new Error("must not sign"); }, async signTransaction() { signs++; throw new Error("must not sign"); } },
        authorizationSigners: [{ address: other.publicKey(), async signAuthEntry() { signs++; throw new Error("must not sign"); } }],
      });
      await expect(executor.execute(f.build)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
      expect(signs).toBe(0); expect(f.sends).toBe(0);
    }
  });

  test("does not let a declared tree authorize another contract", async () => {
    const f = fixture(); const other = Keypair.random(); const entry = unsignedAuthorization(other.publicKey());
    Reflect.set(arm(entry.rootInvocation.function, "sorobanAuthorizedFunctionTypeContractFn").contractFn, "contractAddress", new Address(StrKey.encodeContract(Buffer.alloc(32, 98))).toScAddress());
    const simulate = f.rpc.simulateTransaction;
    f.server.simulateTransaction = async () => ({ ...await simulate(), result: { auth: [entry], retval: xdr.ScVal.scvU32(42) } });
    const executor = new TransactionExecutor({ rpc: f.server, networkPassphrase, signer: keypairSigner(key), maxFeeStroops: 10000n, authorizationSigners: [keypairSigner(other)] });
    await expect(executor.execute(f.build, { authorizations: [{ address: other.publicKey(), invocation: entry.rootInvocation.toXdr("base64") }] })).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
    expect(f.sends).toBe(0);
  });

  test("rejects new auth injected by the enforce simulation before the envelope wallet", async () => {
    const f = fixture(); let signs = 0; const simulate = f.server.simulateTransaction.bind(f.server);
    f.server.simulateTransaction = async (...args) => {
      const result = await simulate(...args);
      if (args[2] === "enforce" && Api.isSimulationSuccess(result)) result.result!.auth = [unsignedAuthorization(key.publicKey())];
      return result;
    };
    const signer = { ...keypairSigner(key), async signTransaction() { signs++; throw new Error("must not sign"); } };
    await expect(f.executor(signer).execute(f.build)).rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
    expect(signs).toBe(0); expect(f.sends).toBe(0);
  });

  test("keeps source blocked for ERROR and TRY_AGAIN_LATER until the original transaction is observed", async () => {
    for (const status of ["ERROR", "TRY_AGAIN_LATER"] as const) {
      const f = fixture(); const send = f.rpc.sendTransaction; const executor = f.executor();
      f.server.sendTransaction = async tx => ({ ...await send(tx), status }) as Api.SendTransactionResponse;
      await expect(executor.execute(f.build)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
      expect(executor.pendingTransactionHash).toBeDefined();
      let builds = 0;
      await expect(executor.execute(() => { builds++; return f.build(); })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
      expect(builds).toBe(0); expect(f.sends).toBe(1);
      expect((await executor.reconcilePending())!.ledger).toBe(102);
      expect(executor.pendingTransactionHash).toBeUndefined();
    }
  });

  test("releases an expired pending transaction only with complete retained ledger coverage", async () => {
    const f = fixture(); const executor = f.executor(); let maxTime = 0;
    f.server.sendTransaction = async tx => { maxTime = Number((tx as Transaction).timeBounds!.maxTime); throw new Error("response lost"); };
    await expect(executor.execute(f.build)).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    let oldestLedger = 101;
    f.server.getTransaction = async txHash => ({ status: Api.GetTransactionStatus.NOT_FOUND, txHash, latestLedger: 200,
      latestLedgerCloseTime: String(maxTime + 1) as unknown as number, oldestLedger, oldestLedgerCloseTime: maxTime - 200 });
    await expect(executor.reconcilePending({ timeoutMs: 5, pollIntervalMs: 1 })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN" });
    expect(executor.pendingTransactionHash).toBeDefined();
    oldestLedger = 99;
    await expect(executor.reconcilePending({ timeoutMs: 5, pollIntervalMs: 1 })).rejects.toMatchObject({ code: "TRANSACTION_EXPIRED" });
    expect(executor.pendingTransactionHash).toBeUndefined();
  });

  test("rejects an extra foreign signature even with a valid signer signature", async () => {
    const f = fixture(); const tx = (await f.build()).built!;
    const signer = { ...keypairSigner(key), async signTransaction(envelope: string) {
      const copy = TransactionBuilder.fromXdr(envelope, networkPassphrase); copy.sign(key, Keypair.random());
      return { signedTxXdr: copy.toXdr() };
    } };
    await expect(signPreparedTransaction(tx, signer, 10000n)).rejects.toMatchObject({ code: "WALLET_MUTATION" });
  });
});
