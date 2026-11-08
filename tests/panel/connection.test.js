import test from 'node:test';
import assert from 'node:assert/strict';
import { gateOpen } from '../../public/js/flow.js';
import { parseTarget, buildConnection } from '../../public/js/connection.js';
import { connectionHtml } from '../../public/js/connection-view.js';

const device = (patch = {}) => ({ device_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', last_sync_at: '2026-11-08T10:15:00Z', reset_generation: 2, ...patch });
const goal = (patch = {}) => ({ year: 2026, target: 12, completed_unique_books: 3, ...patch });
const html = (parts = {}, extras = {}) => connectionHtml(buildConnection({ device: device(), goal: goal(), ...parts }), extras);

test('confirmation gates open only for an explicit acknowledgement or the exact word', () => {
  assert.equal(gateOpen('ack', { ack: 'on' }), true);
  assert.equal(gateOpen('ack', {}), false);
  assert.equal(gateOpen('reset', { confirm: 'reset' }), true);
  for (const typed of ['Reset', 'reset ', ' reset', 'res', '', undefined]) assert.equal(gateOpen('reset', { confirm: typed }), false, String(typed));
  assert.equal(gateOpen('other', { ack: 'on' }), false);
});

test('a goal target is a whole number from zero', () => {
  assert.equal(parseTarget('12'), 12);
  assert.equal(parseTarget(' 0 '), 0);
  for (const bad of ['', '-1', '1.5', '1e3', 'abc', '9007199254740993', '12 books', undefined, null]) assert.equal(parseTarget(bad), null, String(bad));
});

test('the device block shows what the server knows and does not claim a queue length', () => {
  const page = html();
  assert.match(page, /<h2>Connection<\/h2>/);
  assert.match(page, /dddddddd-dddd-4ddd-8ddd-dddddddddddd/);
  assert.match(page, /8 Nov 2026, 10:15 UTC/);
  assert.match(page, /Reset generation<\/dt><dd>2</);
  assert.match(page, /does not know how much data is still waiting on the Kindle/);
  assert.ok(!/queue length: \d|\d+ (items|packets) queued/i.test(page));
  assert.match(html({ device: device({ last_sync_at: null }) }), /No sync received yet/);
});

test('without a device the owner can still create the first token, but there is nothing to unbind', () => {
  // The plugin cannot link until it has a token, so the first token must be creatable before any device exists.
  const page = html({ device: device({ device_id: null, last_sync_at: null }) });
  assert.match(page, /No device linked/);
  assert.match(page, /<h4>Create device token<\/h4>/);
  assert.match(page, /<form data-form="device-rotate" data-gate="ack">/);
  assert.match(page, /any earlier token will stop working/i);
  assert.match(page, /Create token<\/button>/);
  assert.ok(!/data-form="device-unbind"/.test(page));
  assert.equal((page.match(/ data-gated disabled>/g) ?? []).length, 2);     // create token and reset
  assert.match(html({ device: device({ device_id: null, last_sync_at: null }) }, { token: 'AbC_123-xyz_AbC_123-xyz' }), /id="new-token"/);
});

test('rotate and unbind are destructive: each explains the consequence and starts disabled', () => {
  const page = html();
  assert.match(page, /<form data-form="device-rotate" data-gate="ack">/);
  assert.match(page, /current token stops working/i);
  assert.match(page, /<form data-form="device-unbind" data-gate="ack">/);
  assert.match(page, /replacement installation can bind/i);
  assert.equal((page.match(/ data-gated disabled>/g) ?? []).length, 3);   // rotate, unbind and reset
  assert.equal((page.match(/<input type="checkbox" name="ack" required>/g) ?? []).length, 2);
});

test('a new token is shown once with a copy hint and is not rendered otherwise', () => {
  const shown = html({}, { token: 'tok_<abc>' });
  assert.match(shown, /<div id="new-token" class="secret-box" tabindex="-1" role="group" aria-label="New device token">/);
  assert.match(shown, /<code class="secret">tok_&lt;abc&gt;<\/code>/);
  assert.match(shown, /shown only once/i);
  assert.match(shown, /select the token and copy it/i);
  assert.ok(!/new-token/.test(html()));
});

test('the goal editor offers the current target for the year', () => {
  const page = html();
  assert.match(page, /<form data-form="goal-save">/);
  assert.match(page, /<input type="number" name="target" min="0" step="1" inputmode="numeric" value="12" required>/);
  assert.match(page, /Books to finish in 2026/);
  assert.match(page, /3 unique books finished so far/);
  assert.match(page, /0 means no goal/);
  assert.match(html({ goal: goal({ target: 0, completed_unique_books: 1 }) }), /value="0"/);
  assert.match(html({ goal: goal({ completed_unique_books: 1 }) }), /1 unique book finished so far/);
});

test('reset warns about the consequences and needs the word reset typed', () => {
  const page = html();
  assert.match(page, /deletes all synced reading data and notes from this server; unsent data on the device is discarded/);
  assert.match(page, /<form data-form="reset" data-gate="reset">/);
  assert.match(page, /<input name="confirm" autocomplete="off" autocapitalize="off" spellcheck="false" required>/);
  assert.match(page, /<button type="submit" class="danger" data-gated disabled>Reset all data<\/button>/);
});

test('extra sections and the flash message are placed inside the page', () => {
  const page = html({}, { grouping: '<section id="grouping-test"></section>', flash: '<p class="state ok" role="status">Saved</p>' });
  assert.match(page, /id="grouping-test"/);
  assert.ok(page.indexOf('Saved') < page.indexOf('Device'));
});
