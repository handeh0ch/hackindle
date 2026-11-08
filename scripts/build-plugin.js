import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Assembles an installable KOReader plugin directory from plugin/*.lua.
// Plugin-local modules are renamed with a prefix so their generic names (state,
// source, app, reset ...) cannot collide with KOReader modules on package.path.
// Only modules reachable from main.lua are shipped; test-only files stay out.
export const PLUGIN_NAME = 'kindle_sync';
const prefix = `${PLUGIN_NAME}_`;
const requirePattern = /\brequire\s*[(,]?\s*(["'])([^"']+)\1/g;
export function buildPlugin(sourceDir, outDir) {
  const available = new Set(readdirSync(sourceDir).filter(name => name.endsWith('.lua')).map(name => name.slice(0, -4)));
  const local = module => available.has(module) && module !== 'main' && module !== '_meta';
  const sources = new Map(), order = [];
  const visit = name => {
    if (sources.has(name)) return;
    const text = readFileSync(path.join(sourceDir, `${name}.lua`), 'utf8');
    sources.set(name, text); order.push(name);
    for (const match of text.matchAll(requirePattern)) if (local(match[2])) visit(match[2]);
  };
  if (!available.has('main') || !available.has('_meta')) throw new Error('plugin main.lua and _meta.lua are required');
  visit('main');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, '_meta.lua'), readFileSync(path.join(sourceDir, '_meta.lua')));
  for (const name of order) {
    const text = sources.get(name).replace(requirePattern, (whole, quote, module) => local(module) ? whole.replace(`${quote}${module}${quote}`, `${quote}${prefix}${module}${quote}`) : whole);
    writeFileSync(path.join(outDir, name === 'main' ? 'main.lua' : `${prefix}${name}.lua`), text);
  }
  return order.map(name => name === 'main' ? 'main.lua' : `${prefix}${name}.lua`);
}
// Minimal ZIP writer (deflate, UTF-8 names, fixed timestamp) for the installable
// directory. Only files of the built plugin directory are archived, under one
// top-level `<name>.koplugin/` folder, so the archive cannot carry settings,
// state databases or books.
export function zipDirectory(dir, rootName) {
  const entries = [];
  let offset = 0;
  const parts = [];
  for (const name of readdirSync(dir).sort()) {
    const data = readFileSync(path.join(dir, name)), packed = deflateRawSync(data), label = Buffer.from(`${rootName}/${name}`, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(label.length, 26);
    parts.push(local, label, packed);
    entries.push({ label, crc, packed: packed.length, size: data.length, offset });
    offset += local.length + label.length + packed.length;
  }
  const central = entries.map(entry => {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(8, 10); header.writeUInt16LE(0, 12); header.writeUInt16LE(0x21, 14); header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.packed, 20); header.writeUInt32LE(entry.size, 24); header.writeUInt16LE(entry.label.length, 28);
    header.writeUInt32LE(entry.offset, 42);
    return Buffer.concat([header, entry.label]);
  });
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const requested = process.argv.slice(2).find(argument => !argument.startsWith('--'));
  const out = requested ?? path.join(root, '.local', 'build', `${PLUGIN_NAME}.koplugin`);
  const files = buildPlugin(path.join(root, 'plugin'), out);
  process.stdout.write(`Built ${files.length + 1} files in ${out}\n`);
  if (process.argv.includes('--zip')) {
    const archive = `${out}.zip`;
    writeFileSync(archive, zipDirectory(out, path.basename(out)));
    process.stdout.write(`Wrote ${archive}\n`);
  }
}
