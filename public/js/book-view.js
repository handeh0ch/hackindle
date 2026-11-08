// HTML and SVG for the book page. Every dynamic value goes through esc(). The chart shows pages per
// day as bars (left axis) and the selected source's progress as a line (right axis, 0-100%).
import { UNAVAILABLE, formatDate, formatPercent } from './format.js';
import { esc } from './views.js';
import { PERIOD_CHOICES } from './book.js';

const round1 = value => Math.round(value * 10) / 10;
const PERIOD_LABELS = { 30: '30 days', 90: '90 days', 365: '1 year' };

// x-axis labels: every 5th day for a month, every 14th for a quarter, month starts for a year.
function tickText(date, index, count) {
  if (count <= 35) return (count - 1 - index) % 5 === 0 ? formatDate(date).replace(/ \d{4}$/, '') : '';
  if (count <= 120) return (count - 1 - index) % 14 === 0 ? formatDate(date).replace(/ \d{4}$/, '') : '';
  return date.endsWith('-01') ? formatDate(date).split(' ')[1] : '';
}

export function bookChartSvg(chart, layout = 'halves') {
  const wide = layout === 'single', width = wide ? 880 : 400, height = wide ? 260 : 280, left = 34, right = 40, top = 16, bottom = 30;
  const count = Math.max(chart.bars.length, 1), plot = width - left - right, step = plot / count, base = height - bottom, span = base - top;
  const barWidth = round1(Math.max(step * 0.62, 0.8)), centre = index => round1(left + step * (index + 0.5));
  const grid = [0, 0.5, 1].map(part => {
    const y = round1(base - span * part);
    return `<line class="grid" x1="${left}" x2="${width - right}" y1="${y}" y2="${y}"></line>`
      + `<text class="axis-left" x="${left - 6}" y="${y + 4}">${round1(chart.max * part)}</text><text class="axis-right" x="${width - right + 6}" y="${y + 4}">${part * 100}%</text>`;
  });
  const bars = [], hits = [], ticks = [], line = [];
  chart.bars.forEach((bar, index) => {
    const x = centre(index), tick = tickText(bar.date, index, chart.bars.length);
    if (tick) ticks.push(`<text class="tick" x="${x}" y="${height - 8}">${esc(tick)}</text>`);
    if (bar.value === null) bars.push(`<line class="gap" x1="${x}" x2="${x}" y1="${top}" y2="${base}"></line>`);
    else if (bar.value > 0) {
      const high = round1(span * bar.value / chart.max);
      bars.push(`<rect class="bar ${bar.state}" x="${round1(x - barWidth / 2)}" y="${round1(base - high)}" width="${barWidth}" height="${high}" rx="1"></rect>`);
    }
    hits.push(`<rect class="hit" x="${round1(x - step / 2)}" y="${top}" width="${round1(step)}" height="${span}" data-tip="${esc(bar.label)}"></rect>`);
    if (bar.percent !== null) line.push({ index, x, y: round1(base - span * bar.percent / 100) });
  });
  // The line joins only observed days that follow each other; a day without an observation breaks it (no interpolation).
  const runs = [];
  line.forEach(point => { const last = runs.at(-1); if (last && point.index === last.at(-1).index + 1) last.push(point); else runs.push([point]); });
  const path = runs.filter(run => run.length > 1).map(run => `<path class="progress-line" d="${run.map((point, index) => `${index ? 'L' : 'M'}${point.x} ${point.y}`).join(' ')}"></path>`).join('');
  const points = line.map(point => `<circle class="progress-point" cx="${point.x}" cy="${point.y}" r="3"></circle>`);
  return `<svg class="chart book-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pages per day as bars and reading progress as a line"><title>Pages per day and reading progress</title>`
    + `${grid.join('')}<line class="baseline" x1="${left}" x2="${width - right}" y1="${base}" y2="${base}"></line>${bars.join('')}${path}${points.join('')}${ticks.join('')}${hits.join('')}</svg>`;
}

function chartTable(chart) {
  const rows = chart.bars.map(bar => `<tr><th scope="row">${esc(formatDate(bar.date))}</th><td>${esc(bar.pagesText)}</td><td>${bar.fraction === null ? UNAVAILABLE : esc(formatPercent(bar.fraction))}</td></tr>`);
  return '<table class="chart-table"><caption>Pages per day and progress at the end of the day</caption><thead><tr><th scope="col">Date</th><th scope="col">Pages</th><th scope="col">Progress</th></tr></thead>'
    + `<tbody>${rows.join('')}</tbody></table>`;
}

function summaryCard(label, item, note) {
  return `<article class="card ${esc(item.state)}"><h3>${esc(label)}</h3><p class="value">${esc(item.text)}</p><p class="note">${esc(note)}</p></article>`;
}

function sessionHtml(row) {
  const time = `${row.time.text}${row.time.state === 'unavailable' ? '' : ' active'}`;
  return `<li class="session"><span class="when">${esc(row.started)}${row.ongoing ? ' · in progress' : ''}${row.cycle ? ` · ${esc(row.cycle)}` : ''}</span>`
    + `<span class="sr">New pages </span><span class="amount ${esc(row.pages.state)}">${esc(row.pages.text)}</span>`
    + `<span class="sr">Active time </span><span class="spent ${esc(row.time.state)}">${esc(time)}</span></li>`;
}

function journalHtml(journal) {
  // The server pages sessions by id, not by time: a cut-off list is an arbitrary subset, so nothing is said about age.
  const intro = journal.total ? `<p class="note">${journal.truncated ? `${journal.total} sessions loaded. Some sessions, of any age, are not listed.` : `${journal.total} ${journal.total === 1 ? 'session' : 'sessions'}, newest first.`}</p>` : '';
  const list = journal.rows.length ? `<ol class="journal">${journal.rows.map(sessionHtml).join('')}</ol>` : '<p class="state">No sessions recorded for this file yet.</p>';
  const more = journal.hasMore ? `<p class="note">${journal.remaining} older ${journal.remaining === 1 ? 'session is' : 'sessions are'} hidden.</p><button type="button" data-action="journal-more">Show 10 more</button>` : '';
  return `<section aria-labelledby="journal-title"><h3 id="journal-title" tabindex="-1">Reading journal</h3>${intro}${list}${more}</section>`;
}

function cyclesHtml(cycles, complete) {
  const items = cycles.map(item => `<li class="cycle">${esc(item.label)}: started ${esc(item.started)}, ${item.finished ? `finished ${esc(item.finished)}` : 'not finished'}</li>`);
  return `<section aria-labelledby="cycles-title"><h3 id="cycles-title">Reading cycles</h3>`
    + (items.length ? `<ul class="cycles">${items.join('')}</ul>` : '<p class="state">No reading cycles recorded for this file.</p>')
    + `<p class="note">Only cycles started explicitly on the device are listed.${complete ? '' : ' Some cycles may not be listed, so they are not numbered.'}</p></section>`;
}

export function bookHtml(model, { layout = 'halves', grouping = '', flash = '' } = {}) {
  const cover = model.cover.url ? `<img src="${esc(model.cover.url)}" alt="">` : `<span class="cover-fallback" aria-hidden="true">${esc(model.cover.initial)}</span>`;
  const head = `<div class="book-head"><div class="cover">${cover}</div><div><h2>${esc(model.title)}</h2>`
    + `<p class="authors">${esc(model.authors || 'Unknown author')}</p><p class="formats">${model.formats.map(esc).join(' · ')} · ${model.activeDays} active ${model.activeDays === 1 ? 'day' : 'days'}</p>`
    + `${model.tracked ? `<p class="note">Tracked ${esc(model.tracked)}</p>` : ''}<p class="crumb"><a href="#/books">Back to library</a></p></div></div>`;
  const tabs = model.tabs.map(tab => `<button type="button" data-action="book-source" data-value="${esc(tab.id)}" aria-pressed="${tab.selected}">${esc(tab.label)} · ${esc(tab.progress)}</button>`).join('');
  const source = `<section aria-labelledby="source-title"><h3 id="source-title">File</h3><div class="toolbar tabs" role="group" aria-label="Source file">${tabs}</div>`
    + `<p class="note">Each file keeps its own progress, sessions and cycles; they are never joined across files. ${esc(model.selected.format)}: ${esc(model.selected.progress)} read, last opened ${esc(model.selected.lastOpened)}.</p></section>`;
  const periods = PERIOD_CHOICES.map(value => `<button type="button" data-action="book-period" data-value="${value}" aria-pressed="${value === model.days}">${PERIOD_LABELS[value]}</button>`).join('');
  const summary = model.summary;
  const period = `<section aria-labelledby="period-title"><h3 id="period-title">Reading in this period</h3><div class="toolbar tabs" role="group" aria-label="Period">${periods}</div>`
    + `<div class="cards three">${summaryCard('Pages read', summary.pages, 'conditional pages')}${summaryCard('Active time', summary.minutes, 'KOReader active time')}${summaryCard('Active days', summary.activeDays, 'days with reading')}</div>`
    + `${bookChartSvg(model.chart, layout)}<p class="legend"><span class="key-bars">Bars: pages per day (left axis)</span> <span class="key-line">Points: progress of the selected file on days it was observed (right axis)</span></p>`
    + `${model.chart.hasProgress ? '' : '<p class="note">No progress recorded in this period.</p>'}`
    + `${model.progressComplete ? '' : '<p class="note">Progress history is cut off. Newer progress observations are missing, so the line stops early.</p>'}`
    + `<details><summary>Show chart as table</summary>${chartTable(model.chart)}</details></section>`;
  return `${flash}${head}${source}${period}${cyclesHtml(model.journal.cycles, model.journal.cyclesComplete)}${journalHtml(model.journal)}${grouping}`;
}
