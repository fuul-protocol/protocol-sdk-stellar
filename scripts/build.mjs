import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
const ts = createRequire(import.meta.url)('typescript');
await rm(new URL('dist/', root), { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });

// CommonJS build for require() consumers. The ESM build above already type-checked the sources,
// so each file is transpiled on its own; declarations are shared with the ESM build.
const sources = (await readdir(new URL('src/', root), { recursive: true })).map(path => path.replaceAll('\\', '/')).filter(path => path.endsWith('.ts'));
for (const path of sources) {
  const source = await readFile(new URL(`src/${path}`, root), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const base = path.slice(0, -3);
  await mkdir(new URL(`dist/cjs/${dirname(path)}/`, root), { recursive: true });
  await writeFile(new URL(`dist/cjs/${base}.js`, root), outputText);
  const declaration = await readFile(new URL(`dist/esm/${base}.d.ts`, root), 'utf8');
  await writeFile(new URL(`dist/cjs/${base}.d.ts`, root), declaration.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n'));
}
await writeFile(new URL('dist/cjs/package.json', root), JSON.stringify({ type: 'commonjs' }) + '\n');

// Stellar 16.3.0 ships this declaration but omits it from its exported type graph.
// Include its exact licensed bytes so each package subpath works in strict consumers.
const source = await readFile(new URL('node_modules/@stellar/stellar-sdk/types/stellar__js-xdr/index.d.ts', root));
const provenance = JSON.parse(await readFile(new URL('scripts/stellar-types.json', root), 'utf8'));
assert.equal(createHash('sha256').update(source).digest('hex'), provenance.sha256, 'Stellar XDR declarations changed; review before updating the pin');
const target = new URL('dist/types/stellar-js-xdr.d.ts', root);
await mkdir(new URL('dist/types/', root), { recursive: true });
await writeFile(target, source);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
for (const entry of Object.values(pkg.exports)) {
  for (const condition of [entry.import, entry.require]) {
    const declaration = new URL(condition.types, root);
    const path = relative(dirname(fileURLToPath(declaration)), fileURLToPath(target)).replaceAll('\\', '/');
    const contents = await readFile(declaration, 'utf8');
    const directive = `/// <reference path="${path}" />`;
    await writeFile(declaration, directive + '\n/// <reference types="node" />\n' + contents);
    // Keep declaration source-map positions aligned after inserting the reference (ESM only ships maps).
    if (condition === entry.require) continue;
    const mapFile = new URL(condition.types + '.map', root);
    const map = JSON.parse(await readFile(mapFile, 'utf8'));
    map.mappings = ';;' + map.mappings;
    await writeFile(mapFile, JSON.stringify(map));
  }
}

const contracts = JSON.parse(await readFile(new URL('contracts.json', root), 'utf8'));
for (const [name, record] of Object.entries(contracts.contracts)) {
  // Hash the committed (LF) bytes even when a Windows checkout converted them to CRLF.
  const source = (await readFile(new URL(`src/contracts/${name}/index.ts`, root), 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), record.bindingSha256, `${name}: regenerate bindings after changing contracts`);
}
