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
    writeFileSync(path.join(source, '_meta.lua'), 'return {name="hackindle"}\n');
    writeFileSync(path.join(source, 'main.lua'), 'local W=require("ui/widget/container/widgetcontainer")\nlocal s=require("state")\nlocal ok=pcall(require, "dynamic")\nreturn require \'state\'\n');
    writeFileSync(path.join(source, 'state.lua'), 'local h = require("helper")\nreturn {}\n');
    writeFileSync(path.join(source, 'helper.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'dynamic.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'unused.lua'), 'return {}\n');
    const files = buildPlugin(source, out);
    assert.deepEqual(files.sort(), ['hackindle_dynamic.lua', 'hackindle_helper.lua', 'hackindle_state.lua', 'main.lua']);
    assert.deepEqual(readdirSync(out).sort(), ['_meta.lua', 'hackindle_dynamic.lua', 'hackindle_helper.lua', 'hackindle_state.lua', 'main.lua']);
    const main = readFileSync(path.join(out, 'main.lua'), 'utf8');
    assert.match(main, /require\("ui\/widget\/container\/widgetcontainer"\)/);
    assert.match(main, /require\("hackindle_state"\)/);
    assert.match(main, /require 'hackindle_state'/);
    assert.match(main, /pcall\(require, "hackindle_dynamic"\)/);
    assert.match(readFileSync(path.join(out, 'hackindle_state.lua'), 'utf8'), /require\("hackindle_helper"\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('plugin build resolves dotted subdirectory modules into a flat output', () => {
  const root = scratch();
  try {
    const source = path.join(root, 'src'), out = path.join(root, 'out');
    mkdirSync(path.join(source, 'protocol'), { recursive: true });
    mkdirSync(path.join(source, 'koreader', 'device'), { recursive: true });
    writeFileSync(path.join(source, '_meta.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'main.lua'), 'local c = require("protocol.codec")\nlocal ok = pcall(require, "koreader.device.http")\nreturn c\n');
    writeFileSync(path.join(source, 'protocol', 'codec.lua'), 'return require("protocol.json")\n');
    writeFileSync(path.join(source, 'protocol', 'json.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'koreader', 'device', 'http.lua'), 'return {}\n');
    const files = buildPlugin(source, out);
    assert.deepEqual(files.sort(), ['hackindle_codec.lua', 'hackindle_http.lua', 'hackindle_json.lua', 'main.lua']);
    assert.deepEqual(readdirSync(out).sort(), ['_meta.lua', ...files].sort());
    const main = readFileSync(path.join(out, 'main.lua'), 'utf8');
    assert.match(main, /require\("hackindle_codec"\)/);
    assert.match(main, /pcall\(require, "hackindle_http"\)/);
    assert.match(readFileSync(path.join(out, 'hackindle_codec.lua'), 'utf8'), /require\("hackindle_json"\)/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('plugin build refuses two reachable modules that would share one flat file name', () => {
  const root = scratch();
  try {
    const source = path.join(root, 'src');
    mkdirSync(path.join(source, 'a'), { recursive: true });
    mkdirSync(path.join(source, 'b'), { recursive: true });
    writeFileSync(path.join(source, '_meta.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'main.lua'), 'require("a.state")\nrequire("b.state")\n');
    writeFileSync(path.join(source, 'a', 'state.lua'), 'return {}\n');
    writeFileSync(path.join(source, 'b', 'state.lua'), 'return {}\n');
    assert.throws(() => buildPlugin(source, path.join(root, 'out')), /file names must be unique/);
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
    const pluginDir = path.join(repo, 'projects', 'plugin');
    const files = buildPlugin(pluginDir, out);
    const names = new Set(readdirSync(out).map(name => name.slice(0, -4)));
    // Both the dotted source name and its bare basename must be gone from the built output.
    const local = new Set(readdirSync(pluginDir, { recursive: true }).filter(file => file.endsWith('.lua')).flatMap(file => {
      const dotted = file.slice(0, -4).split(path.sep).join('.');
      return [dotted, dotted.split('.').pop()];
    }));
    assert.ok(files.includes('main.lua') && !files.includes('hackindle_sqlite.lua') && !files.includes('hackindle_cover.lua'));
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
    buildPlugin(path.join(repo, 'projects', 'plugin'), out);
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
    assert.ok(seen.every(name => /\/(main|_meta|hackindle_[a-z0-9_]+)\.lua$/.test(name)));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
