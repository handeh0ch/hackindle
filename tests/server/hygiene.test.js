import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const lines = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8').split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
// Personal tooling and provider links stay out of the public repository, the container build context and the Vercel upload.
const PERSONAL = ['.mcp.json', '.claude/', 'neon.ts', '.neon'];

test('personal agent, MCP and provider-link files are git-ignored', () => {
  const ignore = lines('.gitignore');
  for (const entry of PERSONAL) assert.ok(ignore.includes(entry), `.gitignore must list ${entry}`);
  for (const entry of ['.env', '.env.*', '*.local']) assert.ok(ignore.includes(entry), entry);
});

test('they are also excluded from the Docker context and the Vercel upload', () => {
  for (const file of ['.dockerignore', '.vercelignore']) {
    const entries = lines(file);
    for (const entry of ['.mcp.json', '.claude', 'neon.ts', '.neon']) assert.ok(entries.includes(entry), `${file} must list ${entry}`);
  }
});

test('the published package does not depend on any provider tooling', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const names = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
  assert.deepEqual(names.filter(name => /^@?neon/i.test(name) || /vercel/i.test(name)), []);
});
