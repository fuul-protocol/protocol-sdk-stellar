import { beforeAll, afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { Address, Asset, Contract, Keypair, Operation, StrKey, TransactionBuilder, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { AssembledTransaction, type SignAuthEntry } from "@stellar/stellar-sdk/contract";
import { Api, Server, assembleTransaction } from "@stellar/stellar-sdk/rpc";
import { createFuulRpcServer } from "@fuul/sdk-stellar";
import { protocol, networkPassphrase, rpcUrl, evidenceTag, allowHttp, fundTestAccount, guardNetwork } from "./network.js";
import { arm } from "../test/fixtures/xdr.js";
import {
  FuulSdk, FuulError, TransactionExecutor, keypairSigner, submitSignedTransaction, readContract,
  FactoryContract, ManagerContract,
  currencyType, claimReason, createClaimCheck, randomClaimProof, claimAuthorizations, type ExpectedAuthorization,
  calculateFee, getEventPage, watchEvents,
  FuulActions, getContractState, verifyDeployment, prepareLifecycleTransaction, signPreparedTransaction,
} from "@fuul/sdk-stellar";

const rpc = createFuulRpcServer(rpcUrl, { allowHttp });
// Disposable test keys stay in memory. Neither mode accepts an arbitrary RPC URL or Mainnet passphrase.
const admin = Keypair.random(), issuer = Keypair.random(), recipient = Keypair.random();
const collector = Keypair.random(), claimSigner = Keypair.random();
const address = admin.publicKey();
const native = Asset.native().contractId(networkPassphrase);
const asset = new Asset("FUUL", issuer.publicKey());
const currency = asset.contractId(networkPassphrase);
const network = { rpcUrl, networkPassphrase, allowHttp, server: rpc, publicKey: address };
const signer = keypairSigner(admin);
const executor = new TransactionExecutor({ rpc, networkPassphrase, signer, maxFeeStroops: 1_000_000_000n, authorizationSigners: [keypairSigner(claimSigner), keypairSigner(recipient)] });
const records: { name: string; hash: string; ledger: number }[] = [];
const adapters: Record<string, string> = {};
const contractHashes: Record<string, string> = {};
const upgradeContractHashes: Record<string, string> = {};
let sdk: FuulSdk;
let projectId: string;
let firstLedger: number;
let projectClaim: ReturnType<typeof createClaimCheck>;

async function send<T>(name: string, build: () => Promise<AssembledTransaction<T>>, authorizations?: readonly ExpectedAuthorization[]) {
  const receipt = await executor.execute(build, { pollIntervalMs: 250, timeoutMs: 30_000, authorizations });
  records.push({ name, hash: receipt.hash, ledger: receipt.ledger });
  return receipt.result;
}
async function classic(key: Keypair, operations: xdr.Operation[]) {
  const builder = new TransactionBuilder(await rpc.getAccount(key.publicKey()), { networkPassphrase, fee: "100" }).setTimeout(60);
  operations.forEach(op => builder.addOperation(op));
  const transaction = builder.build(); transaction.sign(key);
  const result = await submitSignedTransaction(rpc, transaction, { pollIntervalMs: 250 });
  records.push({ name: "create FUUL trustline", hash: Buffer.from(transaction.hash()).toString("hex"), ledger: result.ledger });
}
async function operation(name: string, op: xdr.Operation, key = admin) {
  const unsigned = new TransactionBuilder(await rpc.getAccount(key.publicKey()), { networkPassphrase, fee: "100" }).addOperation(op).setTimeout(60).build();
  const simulated = await rpc.simulateTransaction(unsigned, { cpuInstructions: 3_000_000 });
  if (!Api.isSimulationSuccess(simulated)) throw new Error("Test setup simulation failed");
  const transaction = assembleTransaction(unsigned, simulated).build();
  expect(BigInt(transaction.fee)).toBeLessThanOrEqual(1_000_000_000n);
  transaction.sign(key);
  const result = await submitSignedTransaction(rpc, transaction, { pollIntervalMs: 250 });
  records.push({ name, hash: Buffer.from(transaction.hash()).toString("hex"), ledger: result.ledger });
  return result.returnValue ? scValToNative(result.returnValue) : undefined;
}

beforeAll(async () => {
  await guardNetwork(rpc);

  const chain = await rpc.getNetwork();
  expect(chain.passphrase).toBe(networkPassphrase);
  expect(Number(chain.protocolVersion)).toBe(Number(protocol));
  expect((await rpc.getHealth()).status).toBe("healthy");
  firstLedger = (await rpc.getLatestLedger()).sequence;
  for (const key of [admin, issuer, recipient, collector, claimSigner]) {
    await fundTestAccount(rpc, key.publicKey());
  }
  for (const key of [admin, recipient, collector]) await classic(key, [Operation.changeTrust({ asset })]);
  if (!(await rpc.getLedgerEntries(new Contract(native).getFootprint())).entries.length) {
    await operation("deploy native token", Operation.createStellarAssetContract({ asset: Asset.native() }));
  }
  await operation("deploy reward token", Operation.createStellarAssetContract({ asset }));
  await operation("mint local rewards", new Contract(currency).call("mint", new Address(address).toScVal(), nativeToScVal(100_000_000_000n, { type: "i128" })), issuer);
  const provenance = JSON.parse(await readFile(new URL("../.local/e2e/provenance.json", import.meta.url), "utf8"));
  const hashes: Record<string, string> = {};
  for (const [name, entry] of Object.entries(provenance.contracts) as [string, { wasmSha256: string }][]) {
    const wasm = await readFile(new URL(`../.local/e2e/wasm/${name.replaceAll("-", "_")}.wasm`, import.meta.url));
    expect(createHash("sha256").update(wasm).digest("hex")).toBe(entry.wasmSha256);
    const uploaded = await operation(`upload ${name}`, Operation.uploadContractWasm({ wasm }));
    expect(Buffer.from(uploaded).toString("hex")).toBe(entry.wasmSha256);
    hashes[name] = entry.wasmSha256;
    contractHashes[name] = entry.wasmSha256;
  }
  const manager = await send("deploy manager", () => ManagerContract.Client.deploy({
    admin: address, pauser: address, unpauser: address, initial_required_signers: 1n,
    claim_signers: [claimSigner.publicKey()], accepted_currency: currency, native_asset: native, initial_kyc_validator: undefined,
    initial_currency_limit: 1_000_000_000_000n, // 100,000 units of this seven-decimal fixture token.
  }, { ...network, wasmHash: hashes["fuul-manager"]! }));
  const factory = await send("deploy project factory", () => FactoryContract.Client.deploy({
    admin: address, manager: manager.options.contractId, fee_collector: collector.publicKey(), project_wasm_hash: Buffer.from(hashes["fuul-project"]!, "hex"),
  }, { ...network, wasmHash: hashes["fuul-factory"]! }));
  sdk = new FuulSdk({ ...network, contracts: { manager: manager.options.contractId, factory: factory.options.contractId } });
  for (const name of ["kyc", "nft", "multi_token", "storage"]) {
    const wasm = await readFile(new URL(`./fixtures/target/wasm32v1-none/release/fuul_sdk_fixture_${name}.wasm`, import.meta.url));
    const wasmHash = await operation(`upload ${name} fixture`, Operation.uploadContractWasm({ wasm }));
    adapters[name] = await operation(`deploy ${name} fixture`, Operation.createCustomContract({ address: new Address(address), wasmHash, constructorArgs: [new Address(address).toScVal()] }));
  }
}, 480_000);

afterAll(async () => {
  await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
  await writeFile(new URL(`../.local/transactions-${evidenceTag}.json`, import.meta.url), JSON.stringify({ networkPassphrase, rpcUrl, protocol: Number(protocol), recordedAt: new Date().toISOString(),
    contracts: sdk ? { manager: sdk.manager.options.contractId, factory: sdk.factory.options.contractId, project: projectId } : {},
    wasmSha256: contractHashes, upgradeWasmSha256: upgradeContractHashes, adapters, records }, null, 2) + "\n");
});

describe(`SDK network workflows (${evidenceTag})`, () => {
  test("deploys all singleton contracts with expected constructor state", async () => {
    expect((await sdk.manager.has_role({ role: "default_admin", account: address })).result).toBe(true);
    expect((await sdk.manager.required_signers()).result).toBe(1n);
    expect((await sdk.factory.fee_collector()).result).toBe(collector.publicKey());
  });

  test("creates and funds a project through the SDK", async () => {
    projectId = await send("create project", () => sdk.factory.create_fuul_project({ project_admin: address, project_info_uri: "ipfs://fuul-sdk-local", kyc_required: false }));
    await send("fund project", () => sdk.token(currency).transfer({ from: address, to: projectId, amount: 1_000_000_000n }));
    expect((await sdk.project(projectId).project_info_uri()).result).toBe("ipfs://fuul-sdk-local");
    expect((await sdk.token(currency).balance(projectId)).result).toBe(1_000_000_000n);
  });

  test("settles a token transfer through the SDK-created bounded HTTP client", async () => {
    const client = new FuulSdk({ rpcUrl, networkPassphrase, allowHttp, publicKey: address,
      contracts: { factory: sdk.factory.options.contractId, manager: sdk.manager.options.contractId }, rpcTimeoutMs: 20_000 });
    const before = await readContract(client.token(currency).balance(recipient.publicKey()));
    const ownExecutor = client.executor({ signer, maxFeeStroops: 1_000_000_000n });
    const receipt = await ownExecutor.execute(() => client.token(currency).transfer({
      from: address, to: recipient.publicKey(), amount: 1n,
    }), { pollIntervalMs: 250, timeoutMs: 30_000 });
    records.push({ name: "bounded HTTP transfer", hash: receipt.hash, ledger: receipt.ledger });
    expect(receipt.ledger).toBeGreaterThan(0);
    expect(await readContract(client.token(currency).balance(recipient.publicKey()))).toBe(before + 1n);
    // Restore the recipient's starting balance for the subsequent exact reward assertions.
    const recipientClient = client.withSigner(keypairSigner(recipient));
    const returned = await recipientClient.executor({ signer: keypairSigner(recipient), maxFeeStroops: 1_000_000_000n })
      .execute(() => recipientClient.token(currency).transfer({ from: recipient.publicKey(), to: address, amount: 1n }),
        { pollIntervalMs: 250, timeoutMs: 30_000 });
    records.push({ name: "bounded HTTP return transfer", hash: returned.hash, ledger: returned.ledger });
  });

  test("settles a funded claim with a separate authorization signer and exact fees", async () => {
    projectClaim = createClaimCheck({ project: projectId, to: recipient.publicKey(), currency, currencyType: currencyType.stellarAsset, amount: 100_000_000n, reason: claimReason.affiliatePayout, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), proof: randomClaimProof(), signers: [claimSigner.publicKey()] });
    const fees = (await sdk.factory.get_fees_information({ project: projectId })).result;
    const before = (await sdk.token(currency).balance(collector.publicKey())).result;
    await send("claim project rewards", () => sdk.manager.claim({ caller: address, checks: [projectClaim] }), claimAuthorizations(sdk.manager.options.contractId, [projectClaim]));
    expect((await sdk.token(currency).balance(recipient.publicKey())).result).toBe(100_000_000n);
    expect((await sdk.token(currency).balance(collector.publicKey())).result - before).toBe(calculateFee(projectClaim.amount, fees.fees.project_claim_fee));
    expect((await sdk.manager.users_claims({ user: recipient.publicKey(), currency })).result).toBe(projectClaim.amount);
    expect((await sdk.project(projectId).claimed_proofs({ proof: projectClaim.proof })).result).toBe(true);
  });

  test("rejects replay without changing balances or account sequence", async () => {
    // Do not turn this into a first claim if an earlier setup or submission failed.
    expect(records.some(record => record.name === "claim project rewards")).toBe(true);
    expect((await sdk.project(projectId).claimed_proofs({ proof: projectClaim.proof })).result).toBe(true);
    const sequence = (await rpc.getAccount(address)).sequenceNumber();
    await expect(send("replay must fail", () => sdk.manager.claim({ caller: address, checks: [projectClaim] }), claimAuthorizations(sdk.manager.options.contractId, [projectClaim]))).rejects.toThrow();
    expect((await rpc.getAccount(address)).sequenceNumber()).toBe(sequence);
    expect((await sdk.token(currency).balance(recipient.publicKey())).result).toBe(100_000_000n);
  });

  test("serializes concurrent writes and manages pause state", async () => {
    await Promise.all([
      send("pause manager", () => sdk.manager.pause({ caller: address })),
      send("unpause manager", () => sdk.manager.unpause({ caller: address })),
    ]);
    expect((await sdk.manager.paused()).result).toBe(false);

  });

  test("updates project configuration and maintains all three instances", async () => {
    const project = sdk.project(projectId);
    await send("update project URI", () => project.set_project_uri({ caller: address, project_uri: "ipfs://fuul-sdk-updated" }));
    expect((await project.project_info_uri()).result).toBe("ipfs://fuul-sdk-updated");
    for (const client of [sdk.factory, sdk.manager, project]) {
      await send("maintain contract instance", () => client.keep_alive());
    }
  });

  test("reads and decodes on-chain events with a resumable cursor", async () => {
    const contractIds = [sdk.manager.options.contractId];
    const page = await getEventPage(rpc, { contractIds, startLedger: firstLedger, limit: 100 }, new Map([[contractIds[0]!, sdk.manager.spec]]));
    const claimed = page.events.find(event => event.parsed?.name === "Claimed");
    expect(claimed?.parsed?.data.amount).toBe(100_000_000n);
    expect(claimed?.parsed?.data.project_address).toBe(projectId);
    expect(claimed?.parsed?.data.currency_type).toEqual(currencyType.stellarAsset);
    const next = await getEventPage(rpc, { contractIds, cursor: page.cursor });
    expect(next.events.some(event => event.id === claimed?.id)).toBe(false);
    expect(page.events.length).toBeGreaterThan(1);
    const query = { contractIds: [...contractIds], startLedger: firstLedger, limit: 1 };
    const controller = new AbortController();
    const stream = watchEvents(rpc, query, { signal: controller.signal, pollIntervalMs: 1, specs: new Map([[contractIds[0]!, sdk.manager.spec]]) });
    const observed: string[] = [];
    try {
      query.startLedger = firstLedger + 1;
      for (let index = 0; index < page.events.length; index++) {
        const result = await stream.next();
        expect(result.done).toBe(false);
        if (result.done) throw new Error("Event stream ended before all confirmed events were read");
        observed.push(...result.value!.events.map(event => event.id));
        // Reusing application objects must not change this subscription's next request.
        query.contractIds[0] = sdk.factory.options.contractId;
        result.value!.cursor = "consumer-edited-cursor";
      }
    } finally { controller.abort(); await stream.return(undefined); }
    expect(observed).toEqual(page.events.map(event => event.id));
  });

  test("uses the higher-level project and funding workflows", async () => {
    const actions = new FuulActions(sdk, executor);
    const created = await actions.createFuulProject({ admin: address, uri: "ipfs://fuul-actions" });
    const funded = await actions.fund({ from: address, currency, contract: created.result, amount: 10_000_000n });
    records.push({ name: "actions create project", hash: created.hash, ledger: created.ledger }, { name: "actions fund project", hash: funded.hash, ledger: funded.ledger });
    expect((await actions.projectState(created.result)).uri).toBe("ipfs://fuul-actions");
    expect((await sdk.token(currency).balance(created.result)).result).toBe(10_000_000n);
    const input = { project: created.result, to: recipient.publicKey(), currency, currencyType: currencyType.stellarAsset,
      amount: 1_000n, reason: claimReason.endUserPayout, deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
      proof: randomClaimProof(), signers: [claimSigner.publicKey()] };
    const beforeRecipient = await readContract(sdk.token(currency).balance(recipient.publicKey()));
    const beforeCollector = await readContract(sdk.token(currency).balance(collector.publicKey()));
    const state = await actions.projectState(created.result);
    expect(state.admins).toEqual([address]);
    const receipt = await actions.claimRewards({ caller: address, checks: [input] });
    records.push({ name: "actions claim rewards", hash: receipt.hash, ledger: receipt.ledger });
    expect(await readContract(sdk.token(currency).balance(recipient.publicKey()))).toBe(beforeRecipient + input.amount);
    expect(await readContract(sdk.token(currency).balance(collector.publicKey())))
      .toBe(beforeCollector + calculateFee(input.amount, state.fees.fees.project_claim_fee));
    await expect(actions.claimRewards({ caller: address, checks: [input] }))
      .rejects.toMatchObject({ code: "CONTRACT_ERROR", details: { contractCode: 6102 } });
    await send("actions add project admin", () => sdk.project(created.result).grant_role({
      caller: address, role: "default_admin", account: recipient.publicKey(),
    }));
    expect((await actions.projectState(created.result)).admins).toEqual([address, recipient.publicKey()]);
  });

  test("validates KYC through an actual adapter before settling a claim", async () => {
    await send("configure KYC adapter", () => sdk.manager.set_kyc_validator({ caller: address, validator: adapters.kyc }));
    await send("require project KYC", () => sdk.project(projectId).set_kyc_required({ caller: address, required: true }));
    expect((await sdk.kyc(adapters.kyc!).isRegistered(recipient.publicKey())).result).toBe(false);
    const check = { ...projectClaim, proof: randomClaimProof(), amount: 50_000_000n };
    await expect(send("unregistered KYC claim must fail", () => sdk.manager.claim({ caller: address, checks: [check] }), claimAuthorizations(sdk.manager.options.contractId, [check]))).rejects.toThrow();
    await send("register KYC fixture user", () => fixtureCall(adapters.kyc!, "set_registered", [new Address(recipient.publicKey()).toScVal(), nativeToScVal(true)]));
    expect((await sdk.kyc(adapters.kyc!).isRegistered(recipient.publicKey())).result).toBe(true);
    const before = (await sdk.token(currency).balance(recipient.publicKey())).result;
    await send("KYC claim", () => sdk.manager.claim({ caller: address, checks: [check] }), claimAuthorizations(sdk.manager.options.contractId, [check]));
    expect((await sdk.token(currency).balance(recipient.publicKey())).result - before).toBe(check.amount);
  });

  test("funds and claims an NFT and a multi-token through their pinned interfaces", async () => {
    for (const token of [adapters.nft!, adapters.multi_token!]) await send("enable adapter currency", () => sdk.manager.add_currency_limit({ caller: address, token, limit: 1_000_000n }));
    await send("mint local NFT", () => fixtureCall(adapters.nft!, "mint", [new Address(address).toScVal(), nativeToScVal(7, { type: "u32" })]));
    await send("fund project NFT", () => sdk.nonFungible(adapters.nft!).transfer({ from: address, to: projectId, tokenId: 7 }));
    const nft = { ...projectClaim, currency: adapters.nft!, currency_type: currencyType.nonFungible, token_id: 7n, amount: 1n, proof: randomClaimProof() };
    await send("claim NFT", () => sdk.manager.claim({ caller: address, checks: [nft] }), claimAuthorizations(sdk.manager.options.contractId, [nft]));
    expect((await fixtureCall(adapters.nft!, "owner", [nativeToScVal(7, { type: "u32" })])).result).toBe(recipient.publicKey());
    await send("mint local multi-token", () => fixtureCall(adapters.multi_token!, "mint", [new Address(address).toScVal(), nativeToScVal(9, { type: "u32" }), nativeToScVal(20n, { type: "i128" })]));
    await send("fund project multi-token", () => sdk.multiToken(adapters.multi_token!).transfer({ from: address, to: projectId, tokenId: 9, amount: 5n }));
    const multi = { ...projectClaim, currency: adapters.multi_token!, currency_type: currencyType.multiToken, token_id: 9n, amount: 1n, proof: randomClaimProof() };
    await send("claim multi-token", () => sdk.manager.claim({ caller: address, checks: [multi] }), claimAuthorizations(sdk.manager.options.contractId, [multi]));
    expect((await fixtureCall(adapters.multi_token!, "balance", [new Address(recipient.publicKey()).toScVal(), nativeToScVal(9, { type: "u32" })])).result).toBe(1n);
  });

  test("verifies deployed code identity and explicitly extends instance TTL", async () => {
    const states = await verifyDeployment(rpc, { networkPassphrase, contracts: {
      manager: { contractId: sdk.manager.options.contractId, wasmHash: contractHashes["fuul-manager"]! },
      project: { contractId: projectId, wasmHash: contractHashes["fuul-project"]! },
    } });
    expect(states.manager!.wasmHash).toBe(contractHashes["fuul-manager"]!);
    await expect(verifyDeployment(rpc, { networkPassphrase, contracts: { project: { contractId: projectId, wasmHash: "0".repeat(64) } } })).rejects.toThrow();
    const before = await getContractState(rpc, projectId);
    const codeKey = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: Buffer.from(before.wasmHash!, "hex") }));
    const targets = [before.instanceKey, codeKey];
    const transaction = await prepareLifecycleTransaction(rpc, { source: address, networkPassphrase, keys: targets, action: { kind: "extend", extendTo: 1_600_000 }, maxFeeStroops: 1_000_000_000n });
    const footprint = arm(arm(transaction.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData.resources.footprint;
    expect(footprint.readOnly.map(key => key.toXdr("base64")).sort()).toEqual(targets.map(key => key.toXdr("base64")).sort());
    expect(footprint.readWrite).toHaveLength(0);
    const confirmed = await submitSignedTransaction(rpc, await signPreparedTransaction(transaction, signer, 1_000_000_000n), { pollIntervalMs: 250 });
    records.push({ name: "extend project TTL", hash: Buffer.from(transaction.hash()).toString("hex"), ledger: confirmed.ledger });
    expect((await getContractState(rpc, projectId)).liveUntilLedger!).toBeGreaterThan(before.liveUntilLedger!);
  });

  test("extends temporary and persistent values with one exact mixed footprint", async () => {
    const contractId = adapters.storage!; const symbol = xdr.ScVal.scvSymbol("shared");
    await send("write temporary and persistent storage fixture", () => fixtureCall(contractId, "set_entries", [symbol, xdr.ScVal.scvU32(111), xdr.ScVal.scvU32(222)]));
    const keys = [xdr.ContractDataDurability.temporary, xdr.ContractDataDurability.persistent].map(durability => xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(), key: symbol, durability,
    })));
    const before = await rpc.getLedgerEntries(...keys); expect(before.entries).toHaveLength(2);
    const snapshot = (response: Awaited<ReturnType<Server["getLedgerEntries"]>>) => keys.map(key => {
      const row = response.entries.find(row => row.key.toXdr("base64") === key.toXdr("base64"));
      if (!row || row.liveUntilLedgerSeq === undefined) throw new Error("Missing storage fixture observation");
      return { keyXdr: row.key.toXdr("base64"), durability: arm(row.key, "contractData").contractData.durability.name,
        valueXdr: row.val.toXdr("base64"), liveUntilLedger: row.liveUntilLedgerSeq, lastModifiedLedger: row.lastModifiedLedgerSeq };
    });
    const beforeEntries = snapshot(before);
    const transaction = await prepareLifecycleTransaction(rpc, { source: address, networkPassphrase, keys,
      action: { kind: "extend", extendTo: 1_600_000 }, maxFeeStroops: 1_000_000_000n });
    const footprint = arm(arm(transaction.toEnvelope(), "envelopeTypeTx").v1.tx.ext, "sorobanData").sorobanData.resources.footprint;
    expect(footprint.readOnly.map(key => key.toXdr("base64")).sort()).toEqual(keys.map(key => key.toXdr("base64")).sort());
    expect(footprint.readWrite).toHaveLength(0);
    const signed = await signPreparedTransaction(transaction, signer, 1_000_000_000n);
    const confirmed = await submitSignedTransaction(rpc, signed, { pollIntervalMs: 250 });
    const hash = Buffer.from(signed.hash()).toString("hex");
    records.push({ name: "extend temporary and persistent storage entries", hash, ledger: confirmed.ledger });
    const after = await rpc.getLedgerEntries(...keys); const afterEntries = snapshot(after);
    for (const [index, entry] of afterEntries.entries()) {
      expect(entry.valueXdr).toBe(beforeEntries[index]!.valueXdr);
      expect(entry.liveUntilLedger).toBeGreaterThanOrEqual(confirmed.ledger + 1_600_000);
      expect(entry.liveUntilLedger).toBeGreaterThan(beforeEntries[index]!.liveUntilLedger);
    }
    expect((await fixtureCall(contractId, "get_temporary", [symbol])).result).toBe(111);
    expect((await fixtureCall(contractId, "get_persistent", [symbol])).result).toBe(222);
    const sequence = (await rpc.getAccount(address)).sequenceNumber();
    await expect(prepareLifecycleTransaction(rpc, { source: address, networkPassphrase, keys,
      action: { kind: "restore" }, maxFeeStroops: 1_000_000_000n })).rejects.toThrow("persistent");
    expect((await rpc.getAccount(address)).sequenceNumber()).toBe(sequence);
    const wasm = await readFile(new URL("./fixtures/target/wasm32v1-none/release/fuul_sdk_fixture_storage.wasm", import.meta.url));
    await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
    await writeFile(new URL(`../.local/temporary-ttl-${evidenceTag}.json`, import.meta.url), JSON.stringify({
      status: "passed", networkPassphrase, protocol: Number(protocol), source: address, contractId,
      wasmSha256: createHash("sha256").update(wasm).digest("hex"), beforeLedger: before.latestLedger, afterLedger: after.latestLedger,
      extendTo: 1_600_000, hash, ledger: confirmed.ledger, before: beforeEntries, after: afterEntries,
      temporaryValue: 111, persistentValue: 222, mixedRestorationRejected: true, sequenceUnchangedAfterRejectedRestore: sequence,
    }, null, 2) + "\n");
  });

  test("sponsors a token transfer while preserving the source account's native balance", async () => {
    const beforeSource = (await sdk.token(native).balance(address)).result;
    const beforePayer = (await sdk.token(native).balance(collector.publicKey())).result;
    const beforeRecipient = (await sdk.token(currency).balance(recipient.publicKey())).result;
    const prepared = await sdk.token(currency).transfer({ from: address, to: recipient.publicKey(), amount: 1_000_000n });
    const signedInner = await signPreparedTransaction(prepared.built!, signer, 1_000_000_000n);
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(collector.publicKey(), "200", signedInner, networkPassphrase);
    const signed = await signPreparedTransaction(feeBump, keypairSigner(collector), 1_000_000_000n);
    const confirmed = await submitSignedTransaction(rpc, signed, { pollIntervalMs: 250 });
    records.push({ name: "sponsored token transfer", hash: Buffer.from(signed.hash()).toString("hex"), ledger: confirmed.ledger });
    expect((await sdk.token(currency).balance(recipient.publicKey())).result - beforeRecipient).toBe(1_000_000n);
    expect((await sdk.token(native).balance(address)).result).toBe(beforeSource);
    expect(beforePayer - (await sdk.token(native).balance(collector.publicKey())).result).toBe(BigInt(confirmed.resultXdr.feeCharged.toString()));
  });
  test("recovers an accepted transfer after a lost response without submitting twice", async () => {
    const before = (await sdk.token(currency).balance(recipient.publicKey())).result;
    const originalSend = rpc.sendTransaction;
    let submissions = 0;
    let acceptedHash: string | undefined;
    let recoveredHash: string | undefined;
    let rejectedBuilds = 0;
    try {
      rpc.sendTransaction = async transaction => {
        submissions++;
        const accepted = await originalSend.call(rpc, transaction);
        expect(accepted.status).toBe("PENDING");
        acceptedHash = accepted.hash;
        // The real RPC accepted the transaction. Lose only its response to the caller.
        throw new Error("Intentional local transport loss after acceptance");
      };
      let lost: unknown;
      try {
        await executor.execute(() => sdk.token(currency).transfer({ from: address, to: recipient.publicKey(), amount: 1n }), { pollIntervalMs: 250, timeoutMs: 30_000 });
      } catch (error) { lost = error; }
      expect(lost).toBeInstanceOf(FuulError);
      expect((lost as FuulError).code).toBe("OUTCOME_UNKNOWN");
      expect(acceptedHash).toMatch(/^[a-f0-9]{64}$/);
      expect((lost as FuulError).details.hash).toBe(acceptedHash);
      expect(executor.pendingTransactionHash).toBe(acceptedHash);
      await expect(executor.execute(async () => {
        rejectedBuilds++;
        return sdk.token(currency).transfer({ from: address, to: recipient.publicKey(), amount: 1n });
      })).rejects.toMatchObject({ code: "OUTCOME_UNKNOWN", details: { hash: acceptedHash } });
      expect(rejectedBuilds).toBe(0);
      const confirmed = await executor.reconcilePending({ pollIntervalMs: 250, timeoutMs: 30_000 });
      expect(confirmed?.txHash).toBe(acceptedHash);
      expect(confirmed?.status).toBe(Api.GetTransactionStatus.SUCCESS);
      expect(executor.pendingTransactionHash).toBeUndefined();
      expect(submissions).toBe(1);
      recoveredHash = confirmed!.txHash;
      records.push({ name: "recover transfer after lost submission response", hash: confirmed!.txHash, ledger: confirmed!.ledger });
    } finally {
      rpc.sendTransaction = originalSend;
    }
    expect((await sdk.token(currency).balance(recipient.publicKey())).result - before).toBe(1n);
    const next = await executor.execute(() => sdk.token(currency).transfer({ from: address, to: recipient.publicKey(), amount: 1n }), { pollIntervalMs: 250, timeoutMs: 30_000 });
    expect(next.hash).not.toBe(recoveredHash);
    records.push({ name: "new transfer after pending hash reconciliation", hash: next.hash, ledger: next.ledger });
    expect((await sdk.token(currency).balance(recipient.publicKey())).result - before).toBe(2n);
  });
  test("preserves the intended live transfer when application state changes during authorization", async () => {
    await send("fund authorization isolation fixture", () => sdk.token(currency).transfer({ from: address, to: recipient.publicKey(), amount: 3n }));
    const beforeRecipient = (await sdk.token(currency).balance(recipient.publicKey())).result;
    const beforeCollector = (await sdk.token(currency).balance(collector.publicKey())).result;
    const call = await sdk.token(currency).transfer({ from: recipient.publicKey(), to: collector.publicKey(), amount: 1n });
    const originalBody = call.toXdr();
    const authorize = keypairSigner(recipient).signAuthEntry as SignAuthEntry;
    let authorizationCalls = 0;
    const isolated = new TransactionExecutor({ rpc, networkPassphrase, signer, maxFeeStroops: 1_000_000_000n,
      authorizationSigners: [{ address: recipient.publicKey(), async signAuthEntry(preimage, options) {
        authorizationCalls++;
        await Promise.resolve();
        call.built = TransactionBuilder.cloneFrom(call.built!, { fee: call.built!.fee }).clearOperations()
          .addOperation(new Contract(currency).call("transfer", new Address(recipient.publicKey()).toScVal(), new Address(address).toScVal(), nativeToScVal(999n, { type: "i128" }))).build();
        call.options.parseResultXdr = () => { throw new Error("Caller replaced the result parser during authorization"); };
        return authorize(preimage, options);
      } }],
    });
    const receipt = await isolated.execute(() => Promise.resolve(call), { pollIntervalMs: 250, timeoutMs: 30_000 });
    records.push({ name: "transfer isolated from application authorization mutation", hash: receipt.hash, ledger: receipt.ledger });
    expect(authorizationCalls).toBe(1);
    expect(call.toXdr()).not.toBe(originalBody);
    expect((await sdk.token(currency).balance(recipient.publicKey())).result).toBe(beforeRecipient - 1n);
    expect((await sdk.token(currency).balance(collector.publicKey())).result).toBe(beforeCollector + 1n);
  });
  test("cancels live wallet waits and settles only the subsequent requested transfer", async () => {
    await send("fund wallet cancellation fixture", () => sdk.token(currency).transfer({ from: address, to: recipient.publicKey(), amount: 3n }));
    const observations: unknown[] = [];
    for (const phase of ["authorization", "envelope"] as const) {
      const controller = new AbortController();
      let entered!: () => void, release!: () => void, returned!: () => void;
      const walletEntered = new Promise<void>(resolve => { entered = resolve; });
      const walletReleased = new Promise<void>(resolve => { release = resolve; });
      const walletReturned = new Promise<void>(resolve => { returned = resolve; });
      const authorize = keypairSigner(recipient).signAuthEntry as SignAuthEntry;
      const originalSend = rpc.sendTransaction;
      let paused = true, submissions = 0;
      const beforeRecipient = (await sdk.token(currency).balance(recipient.publicKey())).result;
      const beforeCollector = (await sdk.token(currency).balance(collector.publicKey())).result;
      const startingSequence = (await rpc.getAccount(address)).sequenceNumber();
      const isolated = new TransactionExecutor({ rpc, networkPassphrase, maxFeeStroops: 1_000_000_000n,
        signer: { address, async signTransaction(...args) {
          const stalled = paused && phase === "envelope";
          if (stalled) { entered(); await walletReleased; }
          const signed = await signer.signTransaction(...args);
          if (stalled) returned();
          return signed;
        } },
        authorizationSigners: [{ address: recipient.publicKey(), async signAuthEntry(...args) {
          const stalled = paused && phase === "authorization";
          if (stalled) { entered(); await walletReleased; }
          const signed = await authorize(...args);
          if (stalled) returned();
          return signed;
        } }],
      });
      rpc.sendTransaction = transaction => { submissions++; return originalSend.call(rpc, transaction); };
      const build = () => sdk.token(currency).transfer({ from: recipient.publicKey(), to: collector.publicKey(), amount: 1n });
      const pending = isolated.execute(build, { signal: controller.signal, pollIntervalMs: 250, timeoutMs: 30_000 });
      // Observe rejection immediately, including failures before the wallet starts.
      const outcome = pending.then(() => { throw new Error("Cancelled fixture unexpectedly submitted"); }, error => error);
      try {
        await withLocalDeadline(Promise.race([walletEntered, outcome.then(error => { throw error; })]), 30_000);
        controller.abort();
        const error = await withLocalDeadline(outcome, 500);
        expect(error).toMatchObject({ code: "ABORTED" });
        expect(isolated.pendingTransactionHash).toBeUndefined(); expect(submissions).toBe(0);
        const cancelledSequence = (await rpc.getAccount(address)).sequenceNumber();
        expect(cancelledSequence).toBe(startingSequence);
        expect((await sdk.token(currency).balance(recipient.publicKey())).result).toBe(beforeRecipient);
        expect((await sdk.token(currency).balance(collector.publicKey())).result).toBe(beforeCollector);
        paused = false;
        const receipt = await isolated.execute(build, { pollIntervalMs: 250, timeoutMs: 30_000 });
        records.push({ name: `transfer after ${phase} wallet cancellation`, hash: receipt.hash, ledger: receipt.ledger });
        release(); await withLocalDeadline(walletReturned, 5_000);
        await new Promise(resolve => setTimeout(resolve, 0));
        const endingSequence = (await rpc.getAccount(address)).sequenceNumber();
        const afterRecipient = (await sdk.token(currency).balance(recipient.publicKey())).result;
        const afterCollector = (await sdk.token(currency).balance(collector.publicKey())).result;
        expect(submissions).toBe(1);
        expect(BigInt(endingSequence) - BigInt(startingSequence)).toBe(1n);
        expect(afterRecipient).toBe(beforeRecipient - 1n); expect(afterCollector).toBe(beforeCollector + 1n);
        observations.push({ phase, cancellationCode: error.code, startingSequence, cancelledSequence, endingSequence,
          beforeRecipient: beforeRecipient.toString(), beforeCollector: beforeCollector.toString(),
          afterRecipient: afterRecipient.toString(), afterCollector: afterCollector.toString(), submissions,
          subsequentTransactionHash: receipt.hash, subsequentTransactionLedger: receipt.ledger });
      } finally {
        controller.abort(); release(); await outcome.catch(() => undefined);
        rpc.sendTransaction = originalSend;
      }
    }
    await mkdir(new URL("../.local/", import.meta.url), { recursive: true });
    await writeFile(new URL(`../.local/wallet-cancellation-${evidenceTag}.json`, import.meta.url), JSON.stringify({
      networkPassphrase, protocol: Number(protocol), recordedAt: new Date().toISOString(),
      source: address, recipient: recipient.publicKey(), collector: collector.publicKey(), currency, observations,
    }, null, 2) + "\n");
  });
  test("upgrades and migrates all three contracts while retaining funded state and paid proofs", async () => {
    const provenance = JSON.parse(await readFile(new URL("../.local/e2e/upgrades.json", import.meta.url), "utf8"));
    const project = sdk.project(projectId);
    const instance = async (id: string) => {
      const entries = await rpc.getLedgerEntries(new Contract(id).getFootprint());
      expect(entries.entries).toHaveLength(1);
      const value = arm(arm(entries.entries[0]!.val, "contractData").contractData.val, "scvContractInstance").instance;
      return { hash: arm(value.executable, "contractExecutableWasm").wasmHash.toBytes(), storageXdr: xdr.ScVal.scvMap(value.storage).toXdr("base64") };
    };
    const balances = () => Promise.all([
      readContract(sdk.token(currency).balance(projectId)),
      readContract(sdk.token(currency).balance(recipient.publicKey())),
      readContract(sdk.token(currency).balance(collector.publicKey())),
      readContract(sdk.manager.users_claims({ user: recipient.publicKey(), currency })),
    ]);
    await send("pause before contract upgrades", () => sdk.manager.pause({ caller: address }));
    const state = () => Promise.all([
      balances(), readContract(project.claimed_proofs({ proof: projectClaim.proof })),
      readContract(sdk.manager.currency_limits({ token: currency })), readContract(sdk.factory.get_fees_information({ project: projectId })),
      readContract(sdk.factory.contract_tracker()), readContract(project.project_info_uri()),
      readContract(project.factory()), readContract(sdk.factory.project_wasm_hash()), readContract(sdk.manager.paused()),
    ]);
    const before = await state();
    const transitions = [];
    for (const [name, client] of [["manager", sdk.manager], ["factory", sdk.factory], ["project", project]] as const) {
      const artifact = provenance.contracts[`fuul-${name}`];
      expect(artifact.previousWasmSha256).toBe(contractHashes[`fuul-${name}`]);
      const wasm = await readFile(new URL(`../.local/e2e/wasm/${artifact.file}`, import.meta.url));
      expect(createHash("sha256").update(wasm).digest("hex")).toBe(artifact.wasmSha256);
      expect(Buffer.from(await operation(`upload ${name} upgrade fixture`, Operation.uploadContractWasm({ wasm }))).toString("hex")).toBe(artifact.wasmSha256);
      const original = await instance(client.options.contractId);
      expect(Buffer.from(original.hash).toString("hex")).toBe(artifact.previousWasmSha256);
      const args = { new_wasm_hash: Buffer.from(artifact.wasmSha256, "hex"), operator: address };
      const sequence = (await rpc.getAccount(address)).sequenceNumber();
      // Manager and Factory check their own role (OpenZeppelin 2000); a Project checks the Factory role (Project 6101).
      await expect(send("unauthorized upgrade must fail", () => client.upgrade({ ...args, operator: recipient.publicKey() })))
        .rejects.toMatchObject({ code: "CONTRACT_ERROR", details: { contractCode: name === "project" ? 6101 : 2000 } });
      expect((await rpc.getAccount(address)).sequenceNumber()).toBe(sequence);
      await send(`upgrade ${name}`, () => client.upgrade(args));
      const record = records.at(-1)!;
      const changed = await instance(client.options.contractId);
      expect(Buffer.from(changed.hash).toString("hex")).toBe(artifact.wasmSha256);
      expect(changed.storageXdr).toBe(original.storageXdr);
      const included = await rpc.getTransaction(record.hash);
      expect(included.status).toBe(Api.GetTransactionStatus.SUCCESS);
      if (included.status !== Api.GetTransactionStatus.SUCCESS) throw new Error("Upgrade was not included successfully");
      const events = included.events.contractEventsXdr.flat()
        .filter(event => {
          const hash = event.contractId?.toBytes();
          return hash !== undefined && Buffer.from(hash).equals(StrKey.decodeContract(client.options.contractId));
        })
        .map(event => ({ topics: event.body.v0.topics.map(scValToNative), data: scValToNative(event.body.v0.data) }));
      expect(events).toEqual([
        { topics: ["executable_update", ["Wasm", original.hash], ["Wasm", changed.hash]], data: [] },
        { topics: ["contract_upgraded"], data: { operator: address, new_wasm_hash: changed.hash } },
      ]);
      upgradeContractHashes[`fuul-${name}`] = artifact.wasmSha256;
      expect(await readContract(fixtureCall<number>(client.options.contractId, "fixture_schema_version", []))).toBe(0);
      await expect(send("unauthorized migration must fail", () => fixtureCall(client.options.contractId, "migrate_fixture", [new Address(recipient.publicKey()).toScVal()])))
        .rejects.toMatchObject({ code: "CONTRACT_ERROR", details: { contractCode: 2000 } });
      await send(`migrate upgraded ${name}`, () => fixtureCall(client.options.contractId, "migrate_fixture", [new Address(address).toScVal()]));
      expect(await readContract(fixtureCall<number>(client.options.contractId, "fixture_schema_version", []))).toBe(2);
      await expect(send("repeated migration must fail", () => fixtureCall(client.options.contractId, "migrate_fixture", [new Address(address).toScVal()])))
        .rejects.toMatchObject({ code: "CONTRACT_ERROR", details: { contractCode: 6900 } });
      expect(await state()).toEqual(before);
      transitions.push({ name, contractId: client.options.contractId, previousWasm: Buffer.from(original.hash).toString("hex"),
        newWasm: Buffer.from(changed.hash).toString("hex"), upgrade: record.hash, ledger: record.ledger });
    }
    await send("unpause after contract upgrades", () => sdk.manager.unpause({ caller: address }));
    const beforeNext = await balances();
    const replaySequence = (await rpc.getAccount(address)).sequenceNumber();
    await expect(send("upgraded replay must fail", () => sdk.manager.claim({ caller: address, checks: [projectClaim] }), claimAuthorizations(sdk.manager.options.contractId, [projectClaim])))
      .rejects.toMatchObject({ code: "CONTRACT_ERROR", details: { contractCode: 6102 } });
    expect((await rpc.getAccount(address)).sequenceNumber()).toBe(replaySequence);
    expect(await balances()).toEqual(beforeNext);
    const next = { ...projectClaim, proof: randomClaimProof(), amount: 1_000_000n };
    const fees = await readContract(sdk.factory.get_fees_information({ project: projectId }));
    const fee = calculateFee(next.amount, fees.fees.project_claim_fee);
    await send("claim after all upgrades", () => sdk.manager.claim({ caller: address, checks: [next] }), claimAuthorizations(sdk.manager.options.contractId, [next]));
    expect(await balances()).toEqual([beforeNext[0]! - next.amount - fee, beforeNext[1]! + next.amount, beforeNext[2]! + fee, beforeNext[3]! + next.amount]);
    expect(await readContract(project.claimed_proofs({ proof: projectClaim.proof }))).toBe(true);
    expect(await readContract(project.claimed_proofs({ proof: next.proof }))).toBe(true);
    await writeFile(new URL(`../.local/upgrades-${evidenceTag}.json`, import.meta.url), JSON.stringify({
      networkPassphrase, protocol: Number(protocol), transitions, replayContractCode: 6102,
      subsequentClaim: records.at(-1), fixtureSourceCommit: provenance.coreSourceCommit,
    }, null, 2) + "\n");
  }, 300_000);
  test("relays a claim only with the caller's exact native fee consent", async () => {
    const caller = recipient.publicKey();
    const actions = new FuulActions(sdk, executor);
    const input = { caller, checks: [{ project: projectId, to: caller, currency, currencyType: currencyType.stellarAsset,
      amount: 1_000n, reason: claimReason.endUserPayout, deadline: BigInt(Math.floor(Date.now() / 1000) + 600), proof: randomClaimProof(), signers: [claimSigner.publicKey()] }],
      nativeFee: { asset: native, collector: collector.publicKey(), amount: 20_000n } };
    const sequence = (await rpc.getAccount(address)).sequenceNumber();
    const before = await readContract(sdk.token(native).balance(caller));
    await expect(actions.claimRewards({ ...input, nativeFee: { ...input.nativeFee, amount: 20_001n } }))
      .rejects.toMatchObject({ code: "INVALID_TRANSACTION" });
    expect((await rpc.getAccount(address)).sequenceNumber()).toBe(sequence);
    const receipt = await actions.claimRewards(input);
    records.push({ name: "relayed claim with exact native fee", hash: receipt.hash, ledger: receipt.ledger });
    expect(before - await readContract(sdk.token(native).balance(caller))).toBe(20_000n);
  });
});

async function withLocalDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Wallet cancellation fixture exceeded its deadline")), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

function fixtureCall<T = unknown>(contractId: string, method: string, args: xdr.ScVal[]) {
  return AssembledTransaction.build<T>({ ...network, contractId, method, args, parseResultXdr: result => scValToNative(result) as T });
}
