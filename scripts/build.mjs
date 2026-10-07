import { createHash } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const diagnosticsHost = {
  getCanonicalFileName: file => file,
  getCurrentDirectory: () => root,
  getNewLine: () => '\n',
};
function check(diagnostics) {
  const errors = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, diagnosticsHost));
}

const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
check(config.error ? [config.error] : []);
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
check(parsed.errors);
const packageFile = join(root, 'package.json');
const commonjsPackage = JSON.stringify({ ...JSON.parse(await readFile(packageFile, 'utf8')), type: 'commonjs' });

await rm(join(root, 'dist'), { recursive: true, force: true });
for (const format of ['esm', 'cjs']) {
  const options = { ...parsed.options, outDir: join(root, 'dist', format) };
  const host = ts.createCompilerHost(options);
  if (format === 'cjs') {
    // NodeNext uses package.json to select the format of both JS and declarations.
    const read = host.readFile;
    host.readFile = file => resolve(file) === packageFile ? commonjsPackage : read(file);
  }
  const program = ts.createProgram(parsed.fileNames, options, host);
  check(ts.getPreEmitDiagnostics(program));
  const result = program.emit();
  check(result.diagnostics);
  assert(!result.emitSkipped, `${format}: TypeScript skipped the build`);
}
await writeFile(join(root, 'dist/cjs/package.json'), '{"type":"commonjs"}\n');

const contracts = JSON.parse(await readFile(join(root, 'contracts.json'), 'utf8'));
for (const [name, record] of Object.entries(contracts.contracts)) {
  // Hash the committed (LF) bytes even when a Windows checkout converted them to CRLF.
  const source = (await readFile(join(root, `src/contracts/${name}/index.ts`), 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), record.bindingSha256, `${name}: regenerate bindings after changing contracts`);
}
