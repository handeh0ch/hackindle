import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
// Assembles an installable KOReader plugin directory from plugin/*.lua.
// Plugin-local modules are renamed with a prefix so their generic names (state,
// source, app, reset ...) cannot collide with KOReader modules on package.path.
// Only modules reachable from main.lua are shipped; test-only files stay out.
export const PLUGIN_NAME = 'kindle_sync';
const prefix = `${PLUGIN_NAME}_`;
const requirePattern = /\brequire\s*\(?\s*(["'])([^"']+)\1/g;
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
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = process.argv[2] ?? path.join(root, '.local', 'build', `${PLUGIN_NAME}.koplugin`);
  const files = buildPlugin(path.join(root, 'plugin'), out);
  process.stdout.write(`Built ${files.length + 1} files in ${out}\n`);
}
