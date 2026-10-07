import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'fuul-sdk-consumer-'));
try {
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
assert.ok(packed.files.some(file => file.path === 'dist/esm/index.js'));
assert.ok(packed.files.some(file => file.path === 'dist/cjs/index.js'));
assert.ok(packed.files.every(file => !/^(test|fixtures|\.local|node_modules|\.env)/.test(file.path)));
const files = packed.files.map(file => file.path);
const sources = (await readdir(new URL('src/', root), { recursive: true })).map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.ts'));
const outputs = ['esm', 'cjs'].flatMap(format => sources.flatMap(path =>
  ['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => `dist/${format}/${path.slice(0, -3)}${extension}`)));
outputs.push('dist/cjs/package.json');
assert.deepEqual(files.filter(path => path.startsWith('dist/')).sort(), outputs.sort(), 'Packed builds must match the source tree');
const consumer = join(temporary, 'consumer'); await mkdir(consumer);
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
const imports = Object.keys(pkg.exports).map(name => pkg.name + (name === '.' ? '' : name.slice(1)));
const behavior = `
for (const name of ${JSON.stringify(imports)}) assert.ok(Object.keys(await load(name)).length, name);
const { parseAmount, formatAmount, cosignPreparedTransaction, keypairSigner, inspectSorobanResources, FactoryContract,
  claimAuthorizations, createClaimCheck, claimReason, currencyType } = await load(${JSON.stringify(pkg.name)});
assert.equal(parseAmount(formatAmount(9007199254740993n)), 9007199254740993n);
const { Account, Address, Asset, Keypair, Operation, SorobanDataBuilder, TransactionBuilder, StrKey, xdr,
  authorizeEntry, inspectAuthEntry, buildAuthorizationEntryPreimage, hash } = await load('@stellar/stellar-sdk');
const source = Keypair.random(), first = Keypair.random(), second = Keypair.random();
const unsigned = new TransactionBuilder(new Account(source.publicKey(), '42'), { fee: '100', networkPassphrase: 'offline consumer' })
  .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '1' })).setTimeout(300).build();
const review = { expectedSource: source.publicKey(), expectedHash: Buffer.from(unsigned.hash()).toString('hex'), maxFeeStroops: 1000n };
const one = await cosignPreparedTransaction(unsigned, keypairSigner(first), review);
const two = await cosignPreparedTransaction(one, keypairSigner(second), review);
assert.equal(two.signatures.length, 2); assert.equal(unsigned.signatures.length, 0);
assert(first.verify(two.hash(), two.signatures[0].signature)); assert(second.verify(two.hash(), two.signatures[1].signature));
const restore = new TransactionBuilder(new Account(source.publicKey(), '42'), { fee: '100', networkPassphrase: 'offline consumer' })
  .addOperation(Operation.restoreFootprint({})).setSorobanData(new SorobanDataBuilder().setResources(1000, 20, 30).build()).setTimeout(300).build();
const maximum = { instructions: 999n, diskReadBytes: 100n, writeBytes: 100n, diskReadEntries: 1n, writeEntries: 1n,
  footprintEntries: 1n, transactionBytes: 10000n, largestKeyBytes: 250n };
const resource = inspectSorobanResources(restore, { networkPassphrase: 'offline consumer', protocolVersion: 28, ledger: 10, maximum });
assert.deepEqual(resource.violations, [{ resource: 'instructions', actual: '1000', maximum: '999' }]);
assert.equal(resource.usage.transactionBytes, BigInt(restore.toEnvelope().toXdr().length));
const manager = StrKey.encodeContract(new Uint8Array(32).fill(1));
const claim = createClaimCheck({ project: manager, to: source.publicKey(), currency: manager,
  currencyType: currencyType.stellarAsset, amount: 9007199254740993n, reason: claimReason.endUserPayout,
  deadline: (1n << 256n) - 1n, proof: new Uint8Array(32).fill(3), signers: [first.publicKey()] });
const root = xdr.SorobanAuthorizedInvocation.fromXdr(claimAuthorizations(manager, [claim])[0].invocation, 'base64');
for (const variant of ['sorobanCredentialsAddress', 'sorobanCredentialsAddressV2']) {
  const entry = new xdr.SorobanAuthorizationEntry({ rootInvocation: root,
    credentials: xdr.SorobanCredentials[variant](new xdr.SorobanAddressCredentials({
      address: new Address(first.publicKey()).toScAddress(), nonce: 123n,
      signatureExpirationLedger: 0, signature: xdr.ScVal.scvVoid(),
    })),
  });
  const signed = await authorizeEntry(entry, first, 200, 'offline consumer');
  const info = inspectAuthEntry(signed);
  assert.equal(info.nonce, 123n); assert.equal(info.signatureExpirationLedger, 200);
  assert.equal(signed.rootInvocation.toXdr('base64'), root.toXdr('base64'));
  const signature = info.signers[0].signatures[0].signature;
  assert(first.verify(hash(buildAuthorizationEntryPreimage(signed, 200, 'offline consumer').toXdr()), signature));
  assert(!first.verify(hash(buildAuthorizationEntryPreimage(signed, 200, 'different network').toXdr()), signature));
}
const factory = new FactoryContract.Client({ contractId: manager, networkPassphrase: 'offline consumer', rpcUrl: 'https://example.invalid' });
assert(factory.spec.funcResToNative('project_wasm_hash', xdr.ScVal.scvBytes(new Uint8Array(32))) instanceof Uint8Array);
`;
for (const format of ['esm', 'cjs']) {
  const extension = format === 'esm' ? 'mjs' : 'cjs';
  const loader = format === 'esm' ? "import assert from 'node:assert/strict';\nconst load = name => import(name);"
    : "const assert = require('node:assert/strict');\nconst load = name => require(name);";
  await writeFile(join(consumer, `check.${extension}`), `${loader}\n(async () => {${behavior}\n})().catch(error => { console.error(error); process.exitCode = 1; });\n`);
  execFileSync(process.execPath, [`check.${extension}`], { cwd: consumer, stdio: 'inherit' });
  console.log(`Installed ${format.toUpperCase()} exports passed amount, signing, authorization, binding and resource checks.`);
}
const declarations = `${imports.map((name, index) => `import * as entry${index} from ${JSON.stringify(name)};\nvoid entry${index};`).join('\n')}
import { FuulSdk, parseAmount, cosignPreparedTransaction, type CosignOptions, type FuulSigner, type SorobanResourceLimits } from ${JSON.stringify(pkg.name)};
import { Transaction, FeeBumpTransaction } from '@stellar/stellar-sdk';
const amount: bigint = parseAmount('900719925.4740993');
declare const limits: SorobanResourceLimits;
const instructionLimit: bigint = limits.maximum.instructions;
void instructionLimit;
declare const sdk: FuulSdk;
declare const signer: FuulSigner;
const executor = sdk.executor({ signer, maxFeeStroops: amount });
const read: Promise<string[]> = sdk.factory.get_role_members({ role: "default_admin" }).then(tx => tx.result);
const bytes: Promise<Uint8Array> = sdk.factory.project_wasm_hash().then(tx => tx.result);
void executor; void read; void bytes;
declare const transaction: Transaction;
declare const feeBump: FeeBumpTransaction;
declare const review: CosignOptions;
const cosigned: Promise<Transaction> = cosignPreparedTransaction(transaction, signer, review);
const sponsored: Promise<FeeBumpTransaction> = cosignPreparedTransaction(feeBump, signer, review);
void cosigned; void sponsored;
// @ts-expect-error Cosigning requires an independently supplied source and transaction hash.
cosignPreparedTransaction(transaction, signer, { maxFeeStroops: amount });
// @ts-expect-error Floating point amounts must not satisfy the bigint fee API.
sdk.executor({ signer, maxFeeStroops: 1.5 });
`;
await writeFile(join(consumer, 'check.mts'), declarations);
await writeFile(join(consumer, 'check.cts'), declarations);
await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: false, types: [] }, include: ['check.mts', 'check.cts'] }));
execFileSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'inherit' });
console.log('Installed ESM and CommonJS declarations passed strict TypeScript checks.');
// Exercise the browser bundle without Node's Buffer or process globals.
// This catches byte/signature failures hidden by Node and Bun's native Buffer.
const browserFixture = await readFile(new URL('test/fixtures/browser.ts', root), 'utf8');
await writeFile(join(consumer, 'browser.ts'), browserFixture.replace('"../../src/index.js"', JSON.stringify(pkg.name)));
execFileSync('bun', ['--eval', `
  const result = await Bun.build({ entrypoints: ['browser.ts'], target: 'browser', format: 'esm', outdir: '.', naming: 'browser.mjs' });
  if (!result.success) throw new AggregateError(result.logs, 'Browser bundle failed');
`],
  { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
execFileSync(process.execPath, ['--input-type=module', '-e',
  'globalThis.Buffer = undefined; globalThis.process = undefined; await import("./browser.mjs");'],
  { cwd: consumer, stdio: 'inherit' });
console.log('Installed browser bundle passed signing and authorization checks without Node globals.');
const audited = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: consumer, encoding: 'utf8' });
if (audited.error) throw audited.error;
const audit = JSON.parse(audited.stdout || '{}');
assert.equal(audited.status, 0, 'Installed consumer dependency audit failed');
assert.equal(audit.metadata?.vulnerabilities?.total, 0, 'Installed consumer dependencies must pass npm audit');
await mkdir(new URL('.local/', root), { recursive: true });
await writeFile(new URL(`.local/package-evidence-node-${process.versions.node}.json`, root), JSON.stringify({ node: process.version, name: pkg.name, version: pkg.version, exports: imports, esmChecked: true, commonjsChecked: true, declarationsChecked: true, browserBundleChecked: true, compressedBytes: packed.size, unpackedBytes: packed.unpackedSize, integrity: packed.integrity, vulnerabilities: audit.metadata.vulnerabilities, checkedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`Package: ${packed.size} bytes compressed; ${packed.unpackedSize} bytes unpacked.`);

} finally { await rm(temporary, { recursive: true, force: true }); }
