// Shared plumbing for the F2 screens: one-shot messages, mutation error handling, the
// confirmation gates of destructive forms, and the reporting config.
import { ApiError } from './api.js';
import { esc } from '../views/views.js';

// A flash is shown on the next render of a page and then forgotten.
export function setFlash(ctx, kind, text) { ctx.flash = { kind, text }; }
export function takeFlash(ctx) {
  const flash = ctx.flash ?? null;
  ctx.flash = null;
  return flash;
}
export function flashHtml(flash) {
  if (!flash) return '';
  // The element takes focus after a mutation (id flash), so the message is read out instead of focus dropping to the page.
  return flash.kind === 'alert' ? `<p class="state error" id="flash" tabindex="-1" role="alert">${esc(flash.text)}</p>` : `<p class="state ok" id="flash" tabindex="-1" role="status">${esc(flash.text)}</p>`;
}

// Error text for the owner: a plain sentence plus the stable code, never the response body.
export function errorText(prefix, error, labels = {}) {
  const code = error instanceof ApiError ? error.code : 'unexpected';
  return `${labels[code] ?? prefix} (${code}).`;
}

// Runs a mutation, one at a time: a second call while one is in flight is dropped (a double submit).
// A 401 goes back through navigation, which shows the sign-in form.
export async function guarded(ctx, navigate, work) {
  if (ctx.busy) return { ok: false, handled: true };
  ctx.busy = true;
  try { return { ok: true, value: await work() }; }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) { await navigate(ctx.hash); return { ok: false, handled: true }; }
    return { ok: false, error: error instanceof ApiError ? error : new ApiError(0, 'unexpected') };
  } finally { ctx.busy = false; }
}

// Destructive forms stay disabled until confirmed: a checkbox, or the exact typed word for reset.
export function gateOpen(kind, values) {
  if (kind === 'ack') return values?.ack === 'on';
  if (kind === 'reset') return values?.confirm === 'reset';
  return false;
}

export async function needConfig(ctx) {
  ctx.config ??= await ctx.api.get('/owner/config');
  return ctx.config;
}

// A page for an address that is not valid or points at something that no longer exists.
export function missingHtml(title, text, link) {
  return `<h2>${esc(title)}</h2><p class="state" role="status">${esc(text)}${link ? ` <a href="${esc(link.href)}">${esc(link.text)}</a>` : ''}</p>`;
}
