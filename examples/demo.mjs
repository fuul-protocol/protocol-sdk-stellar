// Small CLI example using the public SDK. Build the package before running it.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { Keypair, Networks, TransactionBuilder } from '@stellar/stellar-sdk';
import { FuulActions, FuulSdk, claimReason, currencyType, keypairSigner,
  readContract, verifyDeployment, waitForTransaction } from '@fuul/sdk-stellar';

const env = name => { assert(process.env[name], `Set ${name} first; see deploy.md.`); return process.env[name]; };
const json = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item, 2);
const print = value => console.log(json(value));
const [command = 'status', ...args] = process.argv.slice(2);
const commands = ['status', 'fund', 'claim', 'pause', 'unpause', 'reconcile'];
assert(commands.includes(command), `Commands: ${commands.join(', ')}`);
const network = env('FUUL_NETWORK');
assert(['testnet', 'mainnet'].includes(network), 'FUUL_NETWORK must be testnet or mainnet.');
const networkPassphrase = network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
const rpcUrl = process.env.RPC_URL || (network === 'testnet' ? 'https://soroban-testnet.stellar.org' : env('RPC_URL'));
const role = command === 'pause' ? 'PAUSER' : command === 'unpause' ? 'UNPAUSER' : command === 'reconcile' ? (args[0] || 'ADMIN') : 'ADMIN';
assert(['ADMIN', 'PAUSER', 'UNPAUSER'].includes(role), 'Reconcile role must be ADMIN, PAUSER or UNPAUSER.');
const source = env(role), manager = env('MANAGER'), factory = env('FACTORY'), project = env('PROJECT');
const sdk = new FuulSdk({ rpcUrl, networkPassphrase, publicKey: source, contracts: { manager, factory } });
const provenance = JSON.parse(await readFile(new URL('../contracts.json', import.meta.url), 'utf8'));
const contracts = Object.fromEntries(Object.entries({ manager, factory, project }).map(([name, contractId]) => [name, {
  contractId, wasmHash: process.env[`${name.toUpperCase()}_HASH`] || provenance.contracts[`fuul-${name}`].wasmSha256,
}]));
await verifyDeployment(sdk.rpc, { networkPassphrase, contracts });
assert.equal(await readContract(sdk.project(project).factory()), factory, 'Project belongs to another Factory.');
const currency = process.env.CURRENCY || await readContract(sdk.manager.native_asset());
const directory = `.local/demo/${network}/${source}`;
const pendingFile = `${directory}/pending.json`;
let pending;
try { pending = JSON.parse(await readFile(pendingFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

try {
  if (command === 'status') {
    print({ network, manager, factory, project, currency,
      paused: await readContract(sdk.manager.paused()),
      requiredSigners: await readContract(sdk.manager.required_signers()),
      fees: await readContract(sdk.factory.get_fees_information({ project })),
      currencyLimit: await readContract(sdk.manager.currency_limits({ token: currency })),
      projectBalance: await readContract(sdk.token(currency).balance(project)),
      pending: pending?.hash ?? null });
  } else if (command === 'reconcile') {
    assert(pending, 'No pending transaction for this source account.');
    const result = await waitForTransaction(sdk.rpc, pending.hash, { networkPassphrase });
    await rename(pendingFile, `${directory}/${pending.hash}.json`);
    print({ hash: pending.hash, ledger: result.ledger, status: result.status });
  } else {
    assert(args.includes('--submit'), 'Writes require --submit.');
    if (network === 'mainnet') assert(args.includes('--mainnet'), 'Mainnet writes also require --mainnet.');
    assert(!pending, 'An earlier transaction is unresolved. Run reconcile; never repeat funding after a timeout.');
    const keypair = Keypair.fromSecret(env(`${role}_SECRET`));
    assert.equal(keypair.publicKey(), source, 'Source key does not match its public address.');
    const baseSigner = keypairSigner(keypair);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const signer = { ...baseSigner, async signTransaction(xdr, options) {
      const hash = Buffer.from(TransactionBuilder.fromXdr(xdr, networkPassphrase).hash()).toString('hex');
      await writeFile(pendingFile, json({ hash, command, amount: args[0], proof: command === 'claim' ? args[1] : undefined, network, source, project, currency }), { flag: 'wx', mode: 0o600 });
      return baseSigner.signTransaction(xdr, options);
    } };
    const authorizationSigners = [];
    if (command === 'claim') {
      const claimKey = Keypair.fromSecret(env('SIGNER_SECRET'));
      assert.equal(claimKey.publicKey(), env('SIGNER'), 'Claim signer key does not match.');
      authorizationSigners.push(keypairSigner(claimKey));
    }
    const executor = sdk.executor({ signer, authorizationSigners,
      maxFeeStroops: BigInt(process.env.MAX_FEE_STROOPS || '10000000') });
    const actions = new FuulActions(sdk, executor);
    let receipt;
    if (command === 'fund' || command === 'claim') {
      assert(/^[1-9][0-9]*$/.test(args[0] || ''), 'First argument must be a positive amount in base units.');
      const amount = BigInt(args[0]);
      if (command === 'fund') receipt = await actions.fund({ currency, from: source, contract: project, amount });
      else {
        assert(/^[0-9a-f]{64}$/i.test(args[1] || ''), 'Supply the stored 32-byte payment proof as the second argument.');
        receipt = await actions.claimRewards({ caller: source, checks: [{ project,
          to: process.env.RECIPIENT || env('PROJECT_ADMIN'), currency, currencyType: currencyType.stellarAsset,
          amount, reason: claimReason.affiliatePayout, deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
          proof: Buffer.from(args[1], 'hex'), signers: [env('SIGNER')] }] });
      }
    } else {
      receipt = await executor.execute(() => sdk.manager[command]({ caller: source }));
    }
    await rename(pendingFile, `${directory}/${receipt.hash}.json`);
    print({ command, network, hash: receipt.hash, ledger: receipt.ledger, result: receipt.result });
  }
} catch (error) {
  // Do not print signing inputs, environment variables or full RPC errors.
  console.error(error.code || error.name, error.message);
  if (error.details?.hash) console.error('Transaction hash:', error.details.hash);
  if (error.details?.contractCode !== undefined) console.error('Contract error:', error.details.contractCode);
  process.exitCode = 1;
}
