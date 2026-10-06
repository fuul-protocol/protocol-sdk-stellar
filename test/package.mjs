import { mkdtemp, readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'fuul-sdk-consumer-'));
try {
const packed = JSON.parse(execFileSync('npm', ['pack', '--json', '--pack-destination', temporary], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0];
assert.ok(packed.files.some(file => file.path === 'dist/esm/index.js'));
assert.ok(packed.files.some(file => file.path === 'dist/cjs/index.js'));
assert.ok(packed.files.every(file => !/^(test|fixtures|\.local|node_modules|\.env)/.test(file.path)));
const sources = (await readdir(new URL('src/', root), { recursive: true })).map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.ts'));
const outputs = sources.flatMap(path => [
  ...['.js', '.js.map', '.d.ts', '.d.ts.map'].map(extension => `dist/esm/${path.slice(0, -3)}${extension}`),
  ...['.js', '.d.ts'].map(extension => `dist/cjs/${path.slice(0, -3)}${extension}`),
]);
outputs.push('dist/cjs/package.json', 'dist/types/stellar-js-xdr.d.ts');
assert.deepEqual(packed.files.map(file => file.path).filter(path => path.startsWith('dist/')).sort(), outputs.sort(),
  'The package must contain the current source outputs and licensed XDR declaration only');
const consumer = join(temporary, 'consumer'); await mkdir(consumer);
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(temporary, packed.filename)], { cwd: consumer, stdio: ['ignore', 'pipe', 'pipe'] });
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const imports = Object.keys(pkg.exports).map(name => pkg.name + (name === '.' ? '' : name.slice(1)));
await writeFile(join(consumer, 'check.mjs'), `
import assert from 'node:assert/strict';
for (const name of ${JSON.stringify(imports)}) assert.ok(Object.keys(await import(name)).length, name);
const { parseAmount, formatAmount, cosignPreparedTransaction, keypairSigner, inspectSorobanResources } = await import(${JSON.stringify(pkg.name)});
assert.equal(parseAmount(formatAmount(9007199254740993n)), 9007199254740993n);
const { Account, Asset, Keypair, Operation, SorobanDataBuilder, TransactionBuilder } = await import('@stellar/stellar-sdk');
const source = Keypair.random(), first = Keypair.random(), second = Keypair.random();
const unsigned = new TransactionBuilder(new Account(source.publicKey(), '42'), { fee: '100', networkPassphrase: 'offline consumer' })
  .addOperation(Operation.payment({ destination: source.publicKey(), asset: Asset.native(), amount: '1' })).setTimeout(300).build();
const review = { expectedSource: source.publicKey(), expectedHash: unsigned.hash().toString('hex'), maxFeeStroops: 1000n };
const one = await cosignPreparedTransaction(unsigned, keypairSigner(first), review);
const two = await cosignPreparedTransaction(one, keypairSigner(second), review);
assert.equal(two.signatures.length, 2); assert.equal(unsigned.signatures.length, 0);
assert(first.verify(two.hash(), two.signatures[0].signature())); assert(second.verify(two.hash(), two.signatures[1].signature()));
const restore = new TransactionBuilder(new Account(source.publicKey(), '42'), { fee: '100', networkPassphrase: 'offline consumer' })
  .addOperation(Operation.restoreFootprint({})).setSorobanData(new SorobanDataBuilder().setResources(1000, 20, 30).build()).setTimeout(300).build();
const maximum = { instructions: 999n, diskReadBytes: 100n, writeBytes: 100n, diskReadEntries: 1n, writeEntries: 1n,
  footprintEntries: 1n, transactionBytes: 10000n, largestKeyBytes: 250n };
const resource = inspectSorobanResources(restore, { networkPassphrase: 'offline consumer', protocolVersion: 28, ledger: 10, maximum });
assert.deepEqual(resource.violations, [{ resource: 'instructions', actual: '1000', maximum: '999' }]);
assert.equal(resource.usage.transactionBytes, BigInt(restore.toEnvelope().toXDR().length));
console.log('Packed package installed and imported in an independent Node consumer.');
`);
execFileSync(process.execPath, ['check.mjs'], { cwd: consumer, stdio: 'inherit' });
await writeFile(join(consumer, 'check.cjs'), `
const assert = require('node:assert/strict');
for (const name of ${JSON.stringify(imports)}) assert.ok(Object.keys(require(name)).length, name);
const { parseAmount, formatAmount, keypairSigner, claimAuthorizations } = require(${JSON.stringify(pkg.name)});
const { Keypair } = require('@stellar/stellar-sdk');
assert.equal(parseAmount(formatAmount(9007199254740993n)), 9007199254740993n);
assert.equal(keypairSigner(Keypair.random()).address.length, 56);
assert.equal(typeof claimAuthorizations, 'function');
console.log('Packed package required from an independent CommonJS consumer.');
`);
execFileSync(process.execPath, ['check.cjs'], { cwd: consumer, stdio: 'inherit' });
await writeFile(join(consumer, 'check.ts'), `${imports.map((name, index) => `import * as entry${index} from ${JSON.stringify(name)};\nvoid entry${index};`).join('\n')}
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
void executor; void read;
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
`);
await writeFile(join(consumer, 'check-require.cts'), `${imports.map((name, index) => `import entry${index} = require(${JSON.stringify(name)});\nvoid entry${index};`).join('\n')}
import sdk = require(${JSON.stringify(pkg.name)});
const amount: bigint = sdk.parseAmount('1');
declare const client: sdk.FuulSdk;
void amount; void client;
`);
await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', skipLibCheck: false, types: [] }, include: ['check.ts', 'check-require.cts'] }));
execFileSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', 'tsconfig.json'], { cwd: consumer, stdio: 'inherit' });
console.log('Installed declarations passed a strict TypeScript consumer check.');
const audited = spawnSync('npm', ['audit', '--omit=dev', '--json'], { cwd: consumer, encoding: 'utf8' });
const audit = JSON.parse(audited.stdout || '{}');
assert.equal(audit.metadata?.vulnerabilities?.total, 0, 'Installed consumer dependencies must pass npm audit');
await mkdir(new URL('.local/', root), { recursive: true });
await writeFile(new URL(`.local/package-evidence-node-${process.versions.node.split('.')[0]}.json`, root), JSON.stringify({ node: process.version, name: pkg.name, version: pkg.version, exports: imports, declarationsChecked: true, compressedBytes: packed.size, unpackedBytes: packed.unpackedSize, integrity: packed.integrity, vulnerabilities: audit.metadata.vulnerabilities, checkedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`Package: ${packed.size} bytes compressed; ${packed.unpackedSize} bytes unpacked.`);

} finally { await rm(temporary, { recursive: true, force: true }); }
