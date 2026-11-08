// Browser bootstrap only: wires the DOM to the controller. Everything testable lives
// in the other modules; this file has no logic of its own beyond event forwarding.
import { createApi } from './api.js';
import { createController } from './app.js';
import { placeTip } from './tooltip.js';
import { rings } from './rings.js';
import { gateOpen } from './flow.js';

const root = document.getElementById('app');
// `focus` is a selector for the control that triggered a re-render, so keyboard focus is not lost.
const controller = createController({ api: createApi({ fetch: window.fetch.bind(window) }), render(html, focus) {
  root.innerHTML = html;
  // An action may open another page (for example the new book after a merge): keep the address in step.
  if (location.hash !== controller.ctx.hash) history.replaceState(null, '', controller.ctx.hash);
  markNav();
  if (focus) root.querySelector(focus)?.focus();
} });

function markNav() {
  const current = location.hash.split('/')[1] || 'overview';
  for (const link of document.querySelectorAll('[data-nav]')) link.toggleAttribute('aria-current', link.dataset.nav === current);
}

// Wide screens draw the year as one short block; narrow ones stack two half-year blocks.
const wide = window.matchMedia('(min-width: 700px)');
controller.ctx.layout = wide.matches ? 'single' : 'halves';
wide.addEventListener('change', () => controller.action('layout', wide.matches ? 'single' : 'halves'));

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action],[data-period],[data-metric]');
  if (!target) return;
  if (target.dataset.period) controller.action('period', target.dataset.period);
  else if (target.dataset.metric) controller.action('metric', target.dataset.metric);
  else controller.action(target.dataset.action, target.dataset.value);
});
// Destructive forms (data-gate) keep their button disabled until the checkbox or the typed word is right.
document.addEventListener('input', event => {
  const form = event.target.closest?.('[data-gate]');
  if (form) form.querySelector('[data-gated]').disabled = !gateOpen(form.dataset.gate, Object.fromEntries(new FormData(form)));
});
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-form]');
  if (!form) return;
  event.preventDefault();
  form.querySelector('[data-gated]')?.setAttribute('disabled', '');   // one click, one request
  controller.submit(form.dataset.form, Object.fromEntries(new FormData(form)));
});
window.addEventListener('hashchange', () => controller.navigate(location.hash));
controller.start(location.hash);

// Hover tooltip for calendar cells and chart points (text comes from data-tip). It pops out of the
// target, glides to the next target instead of blinking, and fades out when the pointer leaves.
// A tap on a touch screen also fires pointerover, so the same code serves phones.
const tip = document.getElementById('tip');
let shownFor = null, hideTimer = 0;
function showTip(target) {
  const isCell = target.classList.contains('cell');
  clearTimeout(hideTimer);
  const wasShown = tip.classList.contains('show');
  tip.textContent = target.dataset.tip;
  tip.hidden = false;
  tip.classList.toggle('glide', wasShown);               // only an already visible tooltip moves; a new one pops in place
  const box = target.getBoundingClientRect();
  const placed = placeTip({ anchor: { left: box.left, top: box.top, width: box.width, height: box.height },
    tip: { width: tip.offsetWidth, height: tip.offsetHeight }, viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
    gap: isCell ? 16 : 8 });   // a hovered calendar cell grows, so its tooltip sits a little higher
  tip.style.left = `${placed.left}px`;
  tip.style.top = `${placed.top}px`;
  tip.style.setProperty('--arrow', `${placed.arrow}px`);
  tip.dataset.placement = placed.placement;
  shownFor = target;
  if (isCell) heatUp(target); else heatDown();
  if (wasShown) tip.classList.add('show');
  else requestAnimationFrame(() => requestAnimationFrame(() => tip.classList.add('show')));
}
function hideTip() {
  tip.classList.remove('show', 'glide');
  shownFor = null;
  heatDown();
  hideTimer = setTimeout(() => { tip.hidden = true; }, 220);
}
document.addEventListener('pointerover', event => {
  const target = event.target.closest?.('[data-tip]');
  if (target && target !== shownFor) showTip(target);
  else if (!target && shownFor) hideTip();
});
document.addEventListener('pointerdown', event => { if (!event.target.closest?.('[data-tip]')) hideTip(); });
window.addEventListener('scroll', () => { if (shownFor) hideTip(); }, { passive: true });

// Calendar hover: the hovered cell grows and is lifted to the front, the cells around it blur and
// dim by distance (rings.js). Classes only; the look lives in style.css.
let warmed = [];
function heatDown() {
  for (const cell of warmed) cell.classList.remove('hot', 'near-1', 'near-2', 'near-3');
  warmed = [];
}
function heatUp(cell) {
  heatDown();
  const svg = cell.ownerSVGElement;
  const all = [...svg.querySelectorAll('.cell')];
  const place = element => ({ x: Number(element.getAttribute('x')), y: Number(element.getAttribute('y')) });
  const around = rings(place(cell), all.map(place), 14);
  all.forEach((other, index) => {
    if (around[index] === null) return;
    other.classList.add(around[index] === 0 ? 'hot' : `near-${around[index]}`);
    warmed.push(other);
  });
  svg.appendChild(cell);   // SVG paints in document order: bring the grown cell in front of its neighbours
}
