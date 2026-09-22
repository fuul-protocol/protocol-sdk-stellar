import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [mode, argument, ...extra] = process.argv.slice(2);
assert(['generate', 'verify'].includes(mode) && argument && !extra.length,
  'Usage: node scripts/bindings.mjs <generate|verify> <clean-contracts-repository>');
const root = fileURLToPath(new URL('../', import.meta.url));
const port = resolve(argument);
const names = ['manager', 'factory', 'project'];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: port, encoding: 'utf8' }).trim();
async function snapshot() {
  const files = [];
  async function capture(path) { files.push({ path, sha256: sha256(await readFile(join(port, path))) }); }
  async function directory(path) {
    for (const entry of await readdir(join(port, path), { withFileTypes: true })) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) await directory(child);
      else { assert(entry.isFile(), `Unsupported build input: ${child}`); await capture(child); }
    }
  }
  for (const file of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml']) await capture(file);
  for (const name of ['core', ...names]) {
    await capture(`contracts/fuul-${name}/Cargo.toml`);
    await directory(`contracts/fuul-${name}/src`);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=all') !== '',
    buildInputsSha256: sha256(JSON.stringify(files)), files };
}
const source = await snapshot();
assert.equal(source.dirty, false, 'Commit the contracts before generating or verifying bindings');
assert.match(execFileSync('stellar', ['--version'], { encoding: 'utf8' }), /^stellar 27\.1\.0 /);
assert.match(execFileSync('rustc', ['--version'], { cwd: port, encoding: 'utf8' }), /^rustc 1\.92\.0 /);
const platform = `${process.platform}-${process.arch}`;
const previous = mode === 'verify' ? JSON.parse(await readFile(join(root, 'contracts.json'), 'utf8')) : null;
if (previous) {
  assert.equal(previous.schemaVersion, 2);
  assert.equal(previous.source.dirty, false);
  assert.equal(previous.platform, platform, 'Use the recorded build platform for byte verification');
  assert.deepEqual(previous.source.files, source.files, 'Contract source differs from binding provenance');
  assert.equal(previous.source.buildInputsSha256, source.buildInputsSha256);
  git('merge-base', '--is-ancestor', previous.source.commit, source.commit);
  assert.deepEqual(Object.keys(previous.contracts).sort(), names.map(n => `fuul-${n}`).sort());
}
const temporary = await mkdtemp(join(tmpdir(), 'fuul-bindings-'));
try {
  // An isolated build prevents stale files from satisfying artifact verification.
  const target = join(temporary, 'target');
  execFileSync('stellar', ['contract', 'build', '--locked'], {
    cwd: port, stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: target },
  });
  const contracts = {}, bindings = [];
  const bufferGlobal = 'if (typeof window !== "undefined") {\n  //@ts-ignore Buffer exists\n  window.Buffer = window.Buffer || Buffer;\n}\n';
  for (const name of names) {
    const wasm = join(target, `wasm32v1-none/release/fuul_${name}.wasm`);
    const output = join(temporary, name);
    execFileSync('stellar', ['contract', 'bindings', 'typescript', '--wasm', wasm, '--output-dir', output], { stdio: 'inherit' });
    const upstream = await readFile(join(output, 'src/index.ts'), 'utf8');
    assert.equal(upstream.split(bufferGlobal).length, 2, 'Review changes in the generator before removing its Buffer global');
    const binding = upstream.replace(bufferGlobal, '');
    const record = { upstreamBindingSha256: sha256(upstream), bindingSha256: sha256(binding), wasmSha256: sha256(await readFile(wasm)) };
    const nameInPackage = `fuul-${name}`;
    contracts[nameInPackage] = record;
    const path = join(root, `src/contracts/${nameInPackage}/index.ts`);
    if (previous) {
      assert.deepEqual(record, previous.contracts[nameInPackage], `${name}: regenerated artifacts differ`);
      assert.equal(await readFile(path, 'utf8'), binding, `${name}: checked-in binding differs`);
    } else bindings.push({ path, binding });
  }
  assert.deepEqual(await snapshot(), source, 'Contract source changed during generation');
  if (!previous) {
    for (const { path, binding } of bindings) await writeFile(path, binding);
    const provenance = { schemaVersion: 2, sourceRepository: 'https://github.com/eloizxyz/protocol-contracts-stellar',
      stellarCli: '27.1.0', stellarSdk: '16.3.0', platform, source, contracts };
    await writeFile(join(root, 'contracts.json'), JSON.stringify(provenance, null, 2) + '\n');
  }
  console.log(`${mode}: three bindings and Wasm hashes verified against ${source.commit}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
