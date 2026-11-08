// HTML and SVG renderers. Every dynamic value goes through esc(); no view builds
// markup from unescaped text. Charts have a table alternative.
import { UNAVAILABLE, formatDate, formatPages, formatDuration } from './format.js';
import { PERIODS } from './overview.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

export function stateHtml(kind, message = '') {
  if (kind === 'loading') return '<p class="state" role="status">Loading…</p>';
  if (kind === 'error') return `<p class="state error" role="alert">Could not load this data (${esc(message)}). <button type="button" data-action="retry">Retry</button></p>`;
  if (kind === 'alert') return `<p class="state error" role="alert">${esc(message)}</p>`;
  if (kind === 'unauthorized') return '<p class="state" role="status">Sign in to continue.</p>';
  if (kind === 'unavailable') return `<p class="state" role="status">${esc(message || 'This data is unavailable.')} Unavailable is not zero.</p>`;
  return `<p class="state" role="status">${esc(message)}</p>`;
}

export function loginHtml(message) {
  const notice = message ? `<p class="state error" role="alert">${esc(message)}</p>` : '';
  return `<h2>Sign in</h2>${notice}<form data-form="login"><label>Username <input name="username" autocomplete="username" required></label>`
    + '<label>Password <input type="password" name="password" autocomplete="current-password" required></label><button type="submit">Sign in</button></form>';
}

const pagesText =value => value === null ? UNAVAILABLE : `${Math.round(value * 10) / 10}`;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const round1 = value => Math.round(value * 10) / 10;

// X-axis text: weekdays for a week, otherwise "24 Oct" every few days counted back from the latest day.
function dayTick(date, index, count) {
  if (count <= 7) return WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return (count - 1 - index) % (count <= 14 ? 2 : 5) === 0 ? formatDate(date).replace(/ \d{4}$/, '') : '';
}

// Smooth line with a soft area, broken at unavailable days (dashed gap lines). Each segment is
// a horizontal-tangent cubic through the measured points, so the curve never overshoots a value.
// 'single' is a wide, low chart for wide screens; 'halves' a taller one that stays legible on a phone.
export function lineChartSvg(chart, layout = 'halves') {
  const width = layout === 'single' ? 880 : 400, height = layout === 'single' ? 220 : 240, top = 30, bottom = 30, side = 24;
  const count = Math.max(chart.bars.length, 1), step = count > 1 ? (width - 2 * side) / (count - 1) : 0, base = height - bottom;
  const points = chart.bars.map((bar, index) => ({ ...bar, x: round1(side + index * step),
    y: bar.value === null ? null : round1(base - (chart.max > 0 ? (base - top) * bar.value / chart.max : 0)) }));
  const runs = [[]];
  points.forEach(point => point.y === null ? runs.push([]) : runs.at(-1).push(point));
  const shapes = runs.filter(run => run.length > 1).map(run => {
    const curve = run.slice(1).reduce((path, point, index) => {
      const prev = run[index], mid = round1((point.x - prev.x) / 2);
      return `${path} C${round1(prev.x + mid)} ${prev.y} ${round1(point.x - mid)} ${point.y} ${point.x} ${point.y}`;
    }, `M${run[0].x} ${run[0].y}`);
    return `<path class="area" d="${curve} L${run.at(-1).x} ${base} L${run[0].x} ${base} Z"/><path class="line" d="${curve}"/>`;
  });
  const labels = count <= 14;
  const marks = points.map((point, index) => {
    const tick = dayTick(point.date, index, count);
    const axis = tick ? `<text class="tick" x="${point.x}" y="${height - 8}">${esc(tick)}</text>` : '';
    if (point.y === null) return `<line class="gap" x1="${point.x}" x2="${point.x}" y1="${top}" y2="${base}"></line><circle class="hit" cx="${point.x}" cy="${round1((top + base) / 2)}" r="11" data-tip="${esc(point.label)}"></circle>${axis}`;
    const value = labels ? `<text class="value" x="${point.x}" y="${point.y - 10}">${point.state === 'partial' ? '≥ ' : ''}${pagesText(point.value)}</text>` : '';
    return `<circle class="hit" cx="${point.x}" cy="${point.y}" r="11" data-tip="${esc(point.label)}"></circle><circle class="point ${point.state}" cx="${point.x}" cy="${point.y}" r="${labels ? 4 : 3}"></circle>${value}${axis}`;
  });
  return `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily reading over the last ${chart.period} days"><title>Daily reading in conditional pages</title>`
    + `<line class="baseline" x1="0" x2="${width}" y1="${base}" y2="${base}"/>${shapes.join('')}${marks.join('')}</svg>`;
}

export function chartTableHtml(chart) {
  const rows = chart.bars.map(bar => `<tr><th scope="row">${esc(formatDate(bar.date))}</th><td>${bar.value === null ? UNAVAILABLE : `${bar.state === 'partial' ? '≥ ' : ''}${pagesText(bar.value)}`}</td></tr>`);
  return `<table class="chart-table"><caption>Daily reading, conditional pages</caption><thead><tr><th scope="col">Date</th><th scope="col">Pages</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

const cellText = (grid, value, perPage) => grid.metric === 'volume' ? formatPages(value, perPage) : formatDuration(value);

// Monthly totals: a text alternative to the heatmap. A month is "≥" when any elapsed day is
// partial or has no data; days without data are counted so an empty month is not read as zero.
export function calendarTableHtml(grid, perPage) {
  const rows = grid.months.map((month, index) => {
    const prefix = `${grid.year}-${String(index + 1).padStart(2, '0')}-`;
    const cells = grid.weeks.flat().filter(cell => cell && cell.date.startsWith(prefix) && !cell.future);
    const measured = cells.filter(cell => cell.value !== null);
    const missing = cells.length - measured.length;
    const incomplete = missing > 0 || measured.some(cell => cell.state === 'partial');
    const total = measured.reduce((sum, cell) => sum + cell.value, 0);
    const shown = measured.length === 0 ? UNAVAILABLE : `${incomplete ? '≥ ' : ''}${cellText(grid, total, perPage)}`;
    return `<tr><th scope="row">${esc(month.label)}</th><td>${esc(shown)}</td><td>${missing}</td></tr>`;
  });
  return `<table class="chart-table"><caption>${esc(grid.year)} ${grid.metric === 'volume' ? 'reading volume' : 'reading time'} by month</caption><thead><tr><th scope="col">Month</th><th scope="col">Total</th><th scope="col">Days without data</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function heatmapSvg(grid, perPage, layout = 'halves') {
  // 'halves' stacks Jan-Jun above Jul-Dec (readable on a phone); 'single' is one wide, short year for wide screens.
  const single = layout === 'single';
  const size = 11, gap = 3, pitch = size + gap, left = 30, top = 18, block = top + 7 * pitch + 6;
  const halfStart = single ? [0, 0] : [grid.months[0].week, grid.months[6].week];
  const columns = single ? [grid.weeks.length] : [grid.months[6].week - halfStart[0] + 1, grid.weeks.length - halfStart[1]];
  const text = [];
  grid.months.forEach((month, index) => {
    const half = single || index < 6 ? 0 : 1;
    text.push(`<text class="axis" x="${left + (month.week - halfStart[half]) * pitch}" y="${half * block + 12}">${esc(month.label)}</text>`);
  });
  (single ? [0] : [0, 1]).forEach(half => ['Mon', 'Wed', 'Fri'].forEach((name, index) => text.push(`<text class="axis" x="0" y="${half * block + top + index * 2 * pitch + size}">${name}</text>`)));
  const cells = [];
  grid.weeks.forEach((week, weekIndex) => week.forEach((cell, row) => {
    if (!cell) return;
    const half = single || Number(cell.date.slice(5, 7)) <= 6 ? 0 : 1;
    const level = cell.level !== null ? `level-${cell.level}` : cell.state;
    const shown = cell.value === null ? (cell.future ? 'future day' : UNAVAILABLE)
      : `${cell.state === 'partial' ? '≥ ' : ''}${cellText(grid, cell.value, perPage)}`;
    cells.push(`<rect class="cell ${level}${cell.state === 'partial' ? ' partial' : ''}" data-date="${esc(cell.date)}" x="${left + (weekIndex - halfStart[half]) * pitch}" y="${half * block + top + row * pitch}" width="${size}" height="${size}" rx="2.5" data-tip="${esc(cell.weekday)} ${esc(formatDate(cell.date))}: ${esc(shown)}"></rect>`);
  }));
  const width = left + Math.max(...columns) * pitch, height = (single ? 1 : 2) * block;
  return `<svg class="heatmap" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(grid.year)} reading calendar, ${grid.metric === 'volume' ? 'volume' : 'time'}">${text.join('')}${cells.join('')}</svg>`;
}

function cardHtml(card) {
  const bar = card.percent === null || card.percent === undefined ? '' : `<progress max="100" value="${card.percent}" aria-label="${esc(card.label)}"></progress>`;
  return `<article class="card ${esc(card.state)}"><h3>${esc(card.label)}</h3><p class="value">${esc(card.value)}</p>${bar}<p class="note">${esc(card.note)}</p></article>`;
}

export function overviewHtml({ model, period, metric, year, calendar, perPage, canNext = true, layout = 'halves' }) {
  if (model.state === 'empty') return `<h2>Overview</h2>${stateHtml('empty', 'No reading history yet. Read a book with the plugin connected, then sync.')}`;
  const periods = PERIODS.map(value => `<button type="button" data-period="${value}" aria-pressed="${value === period}">${value} days</button>`).join('');
  // Period and metric switches are segmented tabs: aria-pressed buttons drawn with an underline.
  const metrics = ['volume', 'time'].map(value => `<button type="button" data-metric="${value}" aria-pressed="${value === metric}">${value === 'volume' ? 'Volume' : 'Time'}</button>`).join('');
  const arrows = `<div class="year-nav" role="group" aria-label="Year"><button type="button" data-action="year" data-value="-1" aria-label="Previous year">‹</button><span>${esc(year)}</span>`
    + `<button type="button" data-action="year" data-value="1" aria-label="Next year"${canNext ? '' : ' disabled'}>›</button></div>`;
  return `<h2>Overview</h2><section class="cards" aria-label="Summary">${model.cards.map(cardHtml).join('')}</section>`
    + `<section aria-labelledby="chart-title"><h3 id="chart-title">Recent reading</h3><div class="toolbar tabs" role="group" aria-label="Period">${periods}</div>${lineChartSvg(model.chart, layout)}<details><summary>Show as table</summary>${chartTableHtml(model.chart)}</details></section>`
    + (calendar ? `<section aria-labelledby="calendar-title"><h3 id="calendar-title">${esc(year)} calendar</h3><div class="toolbar calendar-bar">${arrows}<div role="group" aria-label="Metric" class="toolbar tabs">${metrics}</div></div>`
      + `<div class="scroll" role="region" aria-label="Calendar, scrollable" tabindex="0">${heatmapSvg(calendar, perPage, layout)}</div>`
      + `<details><summary>Show calendar as table</summary>${calendarTableHtml(calendar, perPage)}</details></section>` : '');
}

export function libraryHtml({ library, search }) {
  const form = `<form data-form="search" role="search"><input type="search" name="q" value="${esc(search)}" aria-label="Search books" placeholder="Search title or author"><button type="submit">Search</button></form>`;
  if (library.state === 'empty') return `<h2>Library</h2>${form}${stateHtml('empty', 'No books yet. Read a book with the plugin connected, then sync.')}`;
  if (library.state === 'no_match') return `<h2>Library</h2>${form}${stateHtml('empty', `No book matches "${search}".`)}`;
  const cards = library.cards.map(card => {
    const cover = card.cover.url ? `<img src="${esc(card.cover.url)}" alt="" loading="lazy">` : `<span class="cover-fallback" aria-hidden="true">${esc(card.cover.initial)}</span>`;
    return `<li class="book"><a href="${esc(card.href)}">${cover}<span class="title">${esc(card.title)}</span></a><span class="authors">${esc(card.authors)}</span>`
      + `<span class="formats">${card.formats.map(esc).join(' · ')}</span><span class="progress ${esc(card.progress.state)}">${esc(card.progress.text)}${card.progress.format ? ` (${esc(card.progress.format)})` : ''}</span>`
      + `<span class="notes">${card.notes.active} notes${card.notes.archived ? `, ${card.notes.archived} archived` : ''}</span></li>`;
  }).join('');
  const more = library.truncated ? `<p class="note">Showing the first ${library.cards.length} books; refine the search to see others.</p>` : '';
  return `<h2>Library</h2>${form}<ul class="books">${cards}</ul>${more}`;
}
