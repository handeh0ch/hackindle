// HTML for #/connection. Destructive forms (rotate, unbind, reset) explain their consequence and
// start disabled: a checkbox or the typed word opens them (data-gate, see gateOpen in flow.js).
import { esc } from './views.js';

export function tokenBoxHtml(token) {
  return `<div id="new-token" class="secret-box" tabindex="-1" role="group" aria-label="New device token"><p><strong>New device token</strong></p><code class="secret">${esc(token)}</code>`
    + '<p class="note">It is shown only once and disappears when you leave this page. Select the token and copy it now, then paste it into the plugin settings on the Kindle.</p></div>';
}

const ack = text => `<label class="check"><input type="checkbox" name="ack" required> ${text}</label>`;

function deviceHtml(device, token) {
  if (!device.linked) {
    // The plugin cannot link until it has a token, so the first token is created here, before any device exists.
    return `<p class="state">No device linked. Create a token, put it in the plugin settings, then sync once to link the Kindle.</p><dl class="facts"><dt>Reset generation</dt><dd>${esc(device.generation)}</dd></dl>`
      + '<div class="group-box"><h4>Create device token</h4><p class="note">Creates the token the Kindle plugin uses to sync. It is shown once; if an earlier token exists it stops working immediately.</p>'
      + `<form data-form="device-rotate" data-gate="ack">${ack('I understand that any earlier token will stop working.')}<button type="submit" data-gated disabled>Create token</button></form>${token ? tokenBoxHtml(token) : ''}</div>`;
  }
  return `<dl class="facts"><dt>Device ID</dt><dd>${esc(device.id)}</dd><dt>Last sync</dt><dd>${esc(device.lastSync ?? 'No sync received yet')}</dd><dt>Reset generation</dt><dd>${esc(device.generation)}</dd></dl>`
    + '<p class="note">This server does not know how much data is still waiting on the Kindle; it only sees what has arrived.</p>'
    + '<div class="group-box"><h4>Rotate device token</h4><p class="note">Creates a new token. The current token stops working immediately, so the Kindle cannot sync until you paste the new token into the plugin settings.</p>'
    + `<form data-form="device-rotate" data-gate="ack">${ack('I understand that the current token will stop working.')}<button type="submit" data-gated disabled>Rotate token</button></form>${token ? tokenBoxHtml(token) : ''}</div>`
    + '<div class="group-box"><h4>Unbind device</h4><p class="note">Clears the device binding so a replacement installation can bind with the current token. The Kindle that is linked now stops syncing until it is bound again. No synced data is deleted.</p>'
    + `<form data-form="device-unbind" data-gate="ack">${ack('I understand that this device will be unbound.')}<button type="submit" data-gated disabled>Unbind device</button></form></div>`;
}

export function connectionHtml(model, { token = null, grouping = '', flash = '' } = {}) {
  const goal = model.goal, books = goal.completed === 1 ? 'book' : 'books';
  return `${flash}<h2>Connection</h2><section aria-labelledby="device-title"><h3 id="device-title">Device</h3>${deviceHtml(model.device, token)}</section>`
    + `<section aria-labelledby="goal-title"><h3 id="goal-title">Yearly goal</h3><form data-form="goal-save"><label>Books to finish in ${esc(goal.year)}`
    + `<input type="number" name="target" min="0" step="1" inputmode="numeric" value="${esc(goal.target)}" required></label><button type="submit">Save goal</button></form>`
    + `<p class="note">${esc(goal.completed)} unique ${books} finished so far. 0 means no goal. Rereading a book does not count twice.</p></section>`
    + `${grouping}<section class="danger-zone" aria-labelledby="reset-title"><h3 id="reset-title">Reset all data</h3>`
    + '<p>This deletes all synced reading data and notes from this server; unsent data on the device is discarded. It cannot be undone. Books on the Kindle are not touched.</p>'
    + '<form data-form="reset" data-gate="reset"><label><span>Type <strong>reset</strong> to confirm</span><input name="confirm" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>'
    + '<button type="submit" class="danger" data-gated disabled>Reset all data</button></form></section>';
}
