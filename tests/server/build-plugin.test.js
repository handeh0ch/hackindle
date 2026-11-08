import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlugin, PLUGIN_NAME, zipDirectory } from '../../scripts/build-plugin.js';

const scratch = () => mkdtempSync(path.join(process.env.TEMP ?? tmpdir(), 'build-plugin-'));

test('plugin build prefixes local modules, keeps KOReader requires and drops unreachable files', () => {
  const root = scratch();
  try {
    const source = path.join(root, 'src'), out = path.join(root, 'out');
    mkdirSync(source);
    writeFileSync(path.join(source, '_meta.lua'), 'return {name="kindle_sync"}\n');
    writeFileSync(path.join(source, 'main.lua'), 'local W=require("ui/widget/container/widgetcontainer")\nlocal s=require("state")\nlocal ok=pcall(require, "dynamic")\nreturn require \'state\'\n');
    writeFileSync(path.join(source, 'state.lua'), 'local h = require("helper")\nreturn {}\n');
    writeFileSync(path.join(source, 'helper.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'dynamic.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'unused.lua'), 'return {}\n');
    const files = buildPlugin(source, out);
    assert.deepEqual(files.sort(), ['kindle_sync_dynamic.lua', 'kindle_sync_helper.lua', 'kindle_sync_state.lua', 'main.lua']);
    assert.deepEqual(readdirSync(out).sort(), ['_meta.lua', 'kindle_sync_dynamic.lua', 'kindle_sync_helper.lua', 'kindle_sync_state.lua', 'main.lua']);
    const main = readFileSync(path.join(out, 'main.lua'), 'utf8');
    assert.match(main, /require\("ui\/widget\/container\/widgetcontainer"\)/);
    assert.match(main, /require\("kindle_sync_state"\)/);
    assert.match(main, /require 'kindle_sync_state'/);
    assert.match(main, /pcall\(require, "kindle_sync_dynamic"\)/);
    assert.match(readFileSync(path.join(out, 'kindle_sync_state.lua'), 'utf8'), /require\("kindle_sync_helper"\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('plugin build requires main.lua and _meta.lua', () => {
  const root = scratch();
  try {
    assert.throws(() => buildPlugin(root, path.join(root, 'out')), /main\.lua and _meta\.lua/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the real plugin builds with every local require resolved and no bare local names left', () => {
  const root = scratch();
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url)), out = path.join(root, `${PLUGIN_NAME}.koplugin`);
    const files = buildPlugin(path.join(repo, 'plugin'), out);
    const names = new Set(readdirSync(out).map(name => name.slice(0, -4))), local = new Set(readdirSync(path.join(repo, 'plugin')).map(name => name.slice(0, -4)));
    assert.ok(files.includes('main.lua') && !files.includes('kindle_sync_sqlite.lua') && !files.includes('kindle_sync_cover.lua'));
    for (const file of readdirSync(out)) {
      for (const match of readFileSync(path.join(out, file), 'utf8').matchAll(/\brequire\s*\(?\s*(["'])([^"']+)\1/g)) {
        const module = match[2];
        if (module.startsWith(`${PLUGIN_NAME}_`)) assert.ok(names.has(module), `${file} requires missing ${module}`);
        else assert.ok(!local.has(module) || module === 'main', `${file} still requires bare ${module}`);
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the plugin archive holds exactly the built files under one folder and round-trips', async () => {
  const { inflateRawSync, crc32 } = await import('node:zlib');
  const root = scratch();
  try {
    const repo = fileURLToPath(new URL('../..', import.meta.url)), out = path.join(root, `${PLUGIN_NAME}.koplugin`);
    buildPlugin(path.join(repo, 'plugin'), out);
    const archive = zipDirectory(out, `${PLUGIN_NAME}.koplugin`);
    const end = archive.length - 22;
    assert.equal(archive.readUInt32LE(end), 0x06054b50);
    const count = archive.readUInt16LE(end + 10), directory = archive.readUInt32LE(end + 16);
    const expected = readdirSync(out).sort();
    assert.equal(count, expected.length);
    let at = directory;
    const seen = [];
    for (let i = 0; i < count; i += 1) {
      assert.equal(archive.readUInt32LE(at), 0x02014b50);
      const packed = archive.readUInt32LE(at + 20), size = archive.readUInt32LE(at + 24), crc = archive.readUInt32LE(at + 16);
      const nameLength = archive.readUInt16LE(at + 28), offset = archive.readUInt32LE(at + 42);
      const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
      assert.equal(archive.readUInt32LE(offset), 0x04034b50);
      const start = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
      const data = inflateRawSync(archive.subarray(start, start + packed));
      assert.equal(data.length, size);
      assert.equal(crc32(data), crc);
      assert.deepEqual(data, readFileSync(path.join(out, name.slice(`${PLUGIN_NAME}.koplugin/`.length))));
      seen.push(name);
      at += 46 + nameLength;
    }
    assert.deepEqual(seen, expected.map(name => `${PLUGIN_NAME}.koplugin/${name}`));
    // No settings, state, database or book file can be part of the archive.
    assert.ok(seen.every(name => /\/(main|_meta|kindle_sync_[a-z0-9_]+)\.lua$/.test(name)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
