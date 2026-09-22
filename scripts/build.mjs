import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);
await rm(new URL('dist/', root), { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(new URL('node_modules/typescript/bin/tsc', root)), '-p', 'tsconfig.json'], { cwd: root, stdio: 'inherit' });
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
  const declaration = new URL(entry.types, root);
  const path = relative(dirname(fileURLToPath(declaration)), fileURLToPath(target)).replaceAll('\\', '/');
  const contents = await readFile(declaration, 'utf8');
  const directive = `/// <reference path="${path}" />`;
  await writeFile(declaration, directive + '\n/// <reference types="node" />\n' + contents);
  // Keep declaration source-map positions aligned after inserting the reference.
  const mapFile = new URL(entry.types + '.map', root);
  const map = JSON.parse(await readFile(mapFile, 'utf8'));
  map.mappings = ';;' + map.mappings;
  await writeFile(mapFile, JSON.stringify(map));
}

const contracts = JSON.parse(await readFile(new URL('contracts.json', root), 'utf8'));
for (const [name, record] of Object.entries(contracts.contracts)) {
  const source = await readFile(new URL(`src/contracts/${name}/index.ts`, root));
  assert.equal(createHash('sha256').update(source).digest('hex'), record.bindingSha256, `${name}: regenerate bindings after changing contracts`);
}
