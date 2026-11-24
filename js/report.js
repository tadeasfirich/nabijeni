// Výstupy: Excel (.xlsx) a přehledná stránka k tisku / uložení do PDF, plus řádky pro tabulku na Google Disku.

import { writeWorkbook, S } from './xlsx.js';
import { calc, sumUp, round, SEASON_LABEL, METHOD_LABEL } from './model.js';
import { fmt, h } from './ui.js';

export const MODE_LABEL = { import: 'import z tabulky', dobito: 'dobito do limitu', auto: 'dobito (uzavřeno automaticky)', drive: 'ukončeno dříve', rucne: 'ukončeno ručně', upraveno: 'upraveno ručně' };
const modeText = (s) => (s.end ? (s.end.mode === 'dobito' || s.end.mode === 'auto' ? `dobito do ${s.end.soc} %` : MODE_LABEL[s.end.mode] || '') : 'probíhá');

export const nf = (v, d = 2) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? '–'
  : Number(v).toLocaleString('cs-CZ', { minimumFractionDigits: d, maximumFractionDigits: d }));
export const kc = (v) => `${nf(v, 2)} Kč`;
export const kwh = (v) => `${nf(v, 2)} kWh`;

export function periodLabel(from, to) {
  const d = (iso) => fmt.date(iso + 'T12:00:00');
  if (from && to) return from === to ? d(from) : `${d(from)} – ${d(to)}`;
  if (from) return `od ${d(from)}`;
  if (to) return `do ${d(to)}`;
  return 'vše';
}

const sortAsc = (list) => [...list].sort((a, b) => Date.parse(a.start.t) - Date.parse(b.start.t));

// ---------------------------------------------------------------- Excel
const HEAD = ['Začátek', 'Konec', 'Hodin', 'Výkon kW', 'Start %', 'Konec %', 'Nabito %', 'Do baterie kWh', 'Ze sítě kWh',
  'Ztráty ×', 'Cena Kč/kWh', 'Částka Kč', 'Výpočet', 'Tachometr km', 'Ukončení', 'Poznámka'];
const WIDTHS = [17, 17, 8, 10, 9, 9, 10, 15, 13, 10, 12, 13, 22, 14, 22, 30];

export function workbook(list, { from, to, settings }) {
  const rows = sortAsc(list.filter((s) => s.end));
  const t = sumUp(rows);
  const data = rows.map((s) => {
    const c = calc(s);
    return [
      { v: new Date(s.start.t), s: s.approxTime ? S.date : S.dt },
      s.end?.t && !s.approxTime ? { v: new Date(s.end.t), s: S.dt } : '',
      c.chargeHours !== null ? { v: c.chargeHours, s: S.dec2 } : '',
      c.kw ? { v: c.kw, s: S.koef } : '',
      s.start.soc != null ? { v: Number(s.start.soc), s: S.int } : '',
      s.end.soc != null ? { v: Number(s.end.soc), s: S.int } : '',
      c.dSoc != null ? { v: c.dSoc, s: S.int } : '',
      c.battery != null ? { v: c.battery, s: S.dec2 } : '',
      { v: c.grid, s: S.dec2 },
      c.ratio ? { v: c.ratio, s: S.koef } : '',
      { v: Number(s.price), s: S.money },
      { v: c.cost, s: S.money },
      (METHOD_LABEL[c.method] || '') + (c.batteryEstimated ? ' – do baterie odhadem' : ''),
      s.start.odo ? { v: Number(s.start.odo), s: S.int } : '',
      modeText(s),
      s.note || '',
    ];
  });
  const first = 2, last = rows.length + 1;
  const sum = (col, style, v) => (rows.length ? { f: `SUM(${col}${first}:${col}${last})`, v, s: style } : { v: 0, s: style });
  const total = [{ v: 'Celkem', s: S.bold }, '', sum('C', S.dec2B, rows.reduce((a, s) => a + (calc(s).chargeHours || 0), 0)), '', '', '', '',
    sum('H', S.dec2B, t.battery), sum('I', S.dec2B, t.grid), '', '', sum('L', S.moneyB, t.cost), '', '', '', ''];

  const prices = [...new Set(rows.map((s) => Number(s.price)))];
  const methods = Object.entries(rows.reduce((a, s) => { const m = calc(s).method; a[m] = (a[m] || 0) + 1; return a; }, {}))
    .map(([m, n]) => `${n}× ${METHOD_LABEL[m]}`).join(' · ');
  const souhrn = [
    [{ v: 'Nabíjení Kony – souhrn', s: S.title }],
    [],
    [{ v: 'Období', s: S.bold }, periodLabel(from, to)],
    [{ v: 'Auto', s: S.bold }, `${settings.car} · ${settings.capacity} kWh`],
    [],
    [{ v: 'Počet nabíjení', s: S.bold }, { v: t.count, s: S.int }],
    [{ v: 'Spotřeba ze sítě', s: S.bold }, { v: t.grid, s: S.dec2B }, 'kWh'],
    [{ v: 'Částka', s: S.bold }, { v: t.cost, s: S.moneyB }],
    [{ v: 'Cena za kWh', s: S.bold }, prices.length === 1 ? { v: prices[0], s: S.money } : prices.length ? 'různá – viz list Nabíjení' : '–'],
    [{ v: 'Nabito do baterie', s: S.bold }, { v: t.battery, s: S.dec2 }, 'kWh'],
    [{ v: 'Výpočet', s: S.bold }, methods || '–'],
    [],
    [{ v: 'Jak se počítá', s: S.bold }, { v: 'Ze sítě = doba nabíjení × výkon zobrazený autem (to je odběr ze zásuvky). Do baterie = nabito % ÷ 100 × kapacita. Částka = ze sítě × cena za kWh. Kde chyběl čas nebo výkon: odhad nabito % × kapacita × koeficient. Elektroměr má vždy přednost.', s: S.wrap }],
    [{ v: 'Vytvořeno', s: S.muted }, { v: fmt.dt(new Date()), s: S.muted }],
  ];
  return writeWorkbook([
    { name: 'Souhrn', widths: [22, 60, 8], rows: souhrn },
    { name: 'Nabíjení', widths: WIDTHS, headerRow: 0, rows: [HEAD.map((v) => ({ v, s: S.head })), ...data, total] },
  ]);
}

export function fileName(from, to, ext) {
  const tag = from && to && from.slice(0, 7) === to.slice(0, 7) && from.endsWith('-01') ? from.slice(0, 7) : `${from || 'zacatek'}_${to || 'dnes'}`;
  return `nabijeni-${tag}.${ext}`;
}

// ---------------------------------------------------------------- řádky pro Google Sheets (zálohu)
export const SHEET_HEAD = ['Začátek', 'Konec', 'Start %', 'Konec %', 'Nabito %', 'Do baterie kWh', 'Hodin', 'Ztráty ×', 'Ze sítě kWh', 'Cena Kč/kWh', 'Částka Kč', 'Tachometr km', 'Ukončení', 'Výpočet', 'Poznámka', 'ID'];
export function sheetRows(list) {
  return [SHEET_HEAD, ...sortAsc(list.filter((s) => s.start?.t)).map((s) => {
    const c = calc(s);
    return [s.start.t, s.end?.t || '', s.start.soc ?? '', s.end?.soc ?? '', c.dSoc ?? '', c.battery ?? '', c.chargeHours ?? '',
      c.ratio ?? '', c.grid ?? '', s.price ?? '', c.cost ?? '', s.start.odo ?? '', modeText(s),
      METHOD_LABEL[c.method] || '', s.note || '', s.id];
  })];
}

// ---------------------------------------------------------------- tisk / PDF
export function printReport(list, { from, to, settings }) {
  const rows = sortAsc(list.filter((s) => s.end));
  const t = sumUp(rows);
  const box = document.getElementById('print');
  const timeRange = (s) => {
    if (s.approxTime) return `${nf(calc(s).hours, 2)} h`;
    const a = new Date(s.start.t), b = new Date(s.end.t);
    const sameDay = a.toDateString() === b.toDateString();
    return `${fmt.time(a)} – ${sameDay ? '' : `${b.getDate()}. ${b.getMonth() + 1}. `}${fmt.time(b)}`;
  };
  const prices = [...new Set(rows.map((s) => Number(s.price)))];
  const tag = { soc: 'odh.', meter: 'měř.', import: 'tab.' };
  box.replaceChildren(
    h('header', { class: 'p-head' },
      h('div', { class: 'p-brand' }, h('span', { class: 'p-mark' }), h('span', null, 'NABÍJENÍ · ', settings.car.toUpperCase())),
      h('h1', null, 'Spotřeba elektřiny za nabíjení'),
      h('p', { class: 'p-period' }, periodLabel(from, to))),
    h('section', { class: 'p-kpis' },
      h('div', null, h('b', null, nf(t.grid, 2)), h('span', null, 'kWh ze sítě')),
      h('div', { class: 'p-kpi-main' }, h('b', null, kc(t.cost)), h('span', null, 'k úhradě')),
      h('div', null, h('b', null, String(t.count)), h('span', null, fmt.plural(t.count, 'nabíjení', 'nabíjení', 'nabíjení'))),
      h('div', null, h('b', null, nf(t.battery, 2)), h('span', null, 'kWh do baterie'))),
    rows.length ? h('table', { class: 'p-table' },
      h('thead', null, h('tr', null, ['Datum', 'Čas', 'Baterie', 'Do baterie', 'Doba × výkon', 'Ze sítě', 'Částka'].map((x, i) => h('th', { class: i >= 3 ? 'n' : '' }, x)))),
      h('tbody', null, rows.map((s) => {
        const c = calc(s);
        return h('tr', null,
          h('td', null, fmt.date(s.start.t)),
          h('td', null, timeRange(s)),
          h('td', null, c.imported ? 'import' : `${s.start.soc} → ${s.end.soc} %`, s.end.mode === 'drive' ? h('small', null, ' dříve') : null),
          h('td', { class: 'n' }, c.battery != null ? `${nf(c.battery)}${c.batteryEstimated ? '*' : ''}` : '–'),
          h('td', { class: 'n' }, c.chargeHours != null && c.kw ? `${nf(c.chargeHours)} h × ${nf(c.kw, 1)}` : '–'),
          h('td', { class: 'n' }, nf(c.grid), tag[c.method] ? h('small', null, ` ${tag[c.method]}`) : null),
          h('td', { class: 'n' }, nf(c.cost)));
      })),
      h('tfoot', null, h('tr', null, h('td', { colspan: 3 }, 'Celkem'),
        h('td', { class: 'n' }, nf(t.battery)), h('td'), h('td', { class: 'n' }, nf(t.grid)), h('td', { class: 'n' }, nf(t.cost))))) :
      h('p', null, 'V tomto období není žádné dokončené nabíjení.'),
    h('footer', { class: 'p-foot' },
      h('p', null, h('b', null, 'Výpočet: '), 'ze sítě = doba nabíjení × výkon zobrazený autem (to je odběr ze zásuvky); ',
        `do baterie = nabito % × ${nf(settings.capacity, 0)} kWh; částka = ze sítě × ${prices.length === 1 ? `${nf(prices[0])} Kč/kWh` : 'cena za kWh u nabíjení'}.`,
        rows.some((s) => calc(s).method === 'soc') ? ' odh. = chyběl čas nebo výkon, odhad nabito % × kapacita × koeficient.' : '',
        t.measured ? ' měř. = údaj z elektroměru.' : '',
        t.imported ? ' tab. = import ze staré tabulky, * do baterie odhadem.' : ''),
      h('p', null, `kWh v tabulce jsou v kWh, částky v Kč. Vytvořeno ${fmt.dt(new Date())}.`)),
  );
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 80);
  setTimeout(done, 60000);
}

export function calcLine(sess) {
  const c = calc(sess);
  if (c.grid === null) return '';
  const money = `${nf(c.grid)} kWh × ${nf(sess.price)} Kč = ${kc(c.cost)}`;
  if (c.method === 'meter') return `Elektroměr ${money} · do baterie ${nf(c.battery)} kWh`;
  if (c.method === 'import') return `${nf(c.chargeHours)} h × ${nf(c.kw, 1)} kW = ${money}`;
  if (c.method === 'time') return `${nf(c.chargeHours)} h × ${nf(c.kw, 1)} kW = ${money}`;
  return `Odhad: ${c.dSoc} % × ${nf(sess.capacity, 0)} kWh = ${nf(c.battery)} kWh × ${nf(sess.coef)} = ${money}`;
}

export { round };
