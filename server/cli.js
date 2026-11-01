import { emitKeypressEvents } from 'node:readline';
import { bootstrapOwner } from './bootstrap.js';
export function readHidden(input, output, prompt) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new Error('Private terminal required'));
  output.write(prompt); emitKeypressEvents(input);
  const previous = input.isRaw; input.setRawMode(true); input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (failure) => {
      input.off('keypress', onKey); input.setRawMode(previous); input.pause(); output.write('\n');
      if (failure) reject(new Error('Input cancelled')); else resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === 'c') return finish(true);
      if (key.name === 'return' || key.name === 'enter') return finish(false);
      if (key.name === 'backspace') value = Array.from(value).slice(0, -1).join('');
      else if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(text)) value += text;
    };
    input.on('keypress', onKey);
  });
}
export async function bootstrapInteractive(db, input, output, read = readHidden, create = bootstrapOwner) {
  const username = await read(input, output, 'Owner username (hidden): ');
  const password = await read(input, output, 'Owner password: ');
  const confirmation = await read(input, output, 'Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match');
  if (!await create(db, username, password)) throw new Error('Owner already exists');
  output.write('Owner created.\n');
}
