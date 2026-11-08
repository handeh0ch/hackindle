import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8');
const copies = read('Dockerfile').split(/\r?\n/).filter(line => /^COPY\s/.test(line)).map(line => line.replace(/^COPY\s+/, '').trim());

test('the image carries everything the running app serves and needs', () => {
  const sources = copies.flatMap(line => line.split(/\s+/).slice(0, -1));
  for (const needed of ['index.js', 'contracts', 'server', 'db', 'public']) assert.ok(sources.includes(needed), `${needed} must be copied`);
  assert.ok(sources.some(source => source.includes('scripts/migrate.js')) && sources.some(source => source.includes('scripts/setup-owner.js')));
});

test('the image copies explicit paths only and never private or local material', () => {
  const sourcesOf = line => line.split(/\s+/).slice(0, -1);
  assert.ok(!copies.some(line => sourcesOf(line).some(source => source === '.' || source === './' || source === '*')), 'no COPY of the whole build context');
  for (const line of copies) assert.ok(!/\.env|\.local|private|backups|exports|\.git\b|kindle_sync\.conf|\.sqlite/.test(line), line);
  assert.match(read('Dockerfile'), /^USER node$/m);
  assert.match(read('Dockerfile'), /npm ci --omit=dev --ignore-scripts/);
});

test('.dockerignore keeps env files, credentials, local data and books out of the build context', () => {
  const ignore = read('.dockerignore').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  for (const entry of ['.git', '.env', '.env.*', 'node_modules', '.local', 'private', 'data', 'backups', 'exports']) assert.ok(ignore.includes(entry), entry);
  assert.ok(ignore.includes('!.env.example'));
});
