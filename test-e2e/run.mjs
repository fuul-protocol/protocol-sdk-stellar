import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [target = 'local', ...extra] = process.argv.slice(2);
assert(['local', 'testnet'].includes(target) && !extra.length, 'Usage: node test-e2e/run.mjs [local|testnet]');
const root = fileURLToPath(new URL('../', import.meta.url));
const contracts = resolve(root, process.env.FUUL_CONTRACTS_PATH || '../protocol-contracts-stellar');
const protocol = process.env.FUUL_E2E_PROTOCOL || '28';
assert(['27', '28'].includes(protocol), 'FUUL_E2E_PROTOCOL must be 27 or 28');
assert.match(execFileSync('stellar', ['--version'], { encoding: 'utf8' }), /^stellar 27\.1\.0 /);
const provenance = JSON.parse(await readFile(join(root, 'contracts.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of provenance.source.files) {
  assert.equal(hash(await readFile(join(contracts, file.path))), file.sha256, `Contract source differs: ${file.path}`);
}
const socket = createServer();
await new Promise((resolve, reject) => socket.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = socket.address().port;
await new Promise(resolve => socket.close(resolve));
const id = `fuul-sdk-${randomUUID().slice(0, 8)}`;
const env = { ...process.env, FUUL_E2E_NETWORK: target, FUUL_E2E_PROTOCOL: protocol, FUUL_E2E_PORT: String(port) };
const compose = ['compose', '-p', id, '-f', 'test-e2e/compose.yaml'];
const output = join(root, '.local/e2e');
await mkdir(join(output, 'wasm'), { recursive: true });
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed (${result.signal || result.status})`);
}
run('stellar', ['contract', 'build', '--locked'], contracts);
run('cargo', ['+1.92.0', 'build', '--manifest-path', 'test-e2e/fixtures/Cargo.toml', '--locked', '--release', '--target', 'wasm32v1-none']);
run('bun', ['run', 'build']);
const builds = { contracts: {} }, upgrades = { coreSourceCommit: provenance.source.commit, contracts: {} };
for (const name of ['manager', 'factory', 'project']) {
  const artifact = `fuul_${name}.wasm`, upgrade = `fuul_upgrade_${name}_fixture.wasm`;
  for (const file of [artifact, upgrade]) await copyFile(join(contracts, 'target/wasm32v1-none/release', file), join(output, 'wasm', file));
  const previous = hash(await readFile(join(output, 'wasm', artifact)));
  if (`${process.platform}-${process.arch}` === provenance.platform) {
    assert.equal(previous, provenance.contracts[`fuul-${name}`].wasmSha256, `Release Wasm differs: ${name}`);
  }
  builds.contracts[`fuul-${name}`] = { wasmSha256: previous };
  upgrades.contracts[`fuul-${name}`] = { previousWasmSha256: previous, wasmSha256: hash(await readFile(join(output, 'wasm', upgrade))), file: upgrade };
}
await writeFile(join(output, 'provenance.json'), JSON.stringify(builds, null, 2) + '\n');
await writeFile(join(output, 'upgrades.json'), JSON.stringify(upgrades, null, 2) + '\n');
run('bun', ['x', '--no-install', 'tsc', '-p', 'test-e2e/tsconfig.json']);
let passed = false, started = false;
try {
  if (target === 'local') {
    const context = JSON.parse(execFileSync('docker', ['context', 'inspect'], { encoding: 'utf8' }))[0];
    assert((process.env.DOCKER_HOST || context.Endpoints.docker.Host).startsWith('unix://'), 'E2E requires local Docker');
    started = true;
    run('docker', [...compose, 'up', '-d', '--wait', '--wait-timeout', '360', '--pull', 'missing']);
  }
  run('bun', ['test', './test-e2e', '--max-concurrency', '1', '--timeout', '480000']);
  passed = true;
} finally {
  if (started) {
    const logs = spawnSync('docker', [...compose, 'logs', '--no-color'], { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    await writeFile(join(output, `${id}.log`), logs.stdout || logs.stderr || '');
    const cleanup = spawnSync('docker', [...compose, 'down', '--volumes'], { cwd: root, env, stdio: 'inherit' });
    assert.equal(cleanup.status, 0, 'Could not remove this test network');
  }
  await writeFile(join(output, `${id}.json`), JSON.stringify({ target, protocol: Number(protocol), passed, finishedAt: new Date().toISOString() }, null, 2) + '\n');
}
