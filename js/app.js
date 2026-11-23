// Nabíjení – evidence nabíjení elektromobilu ze společné elektřiny.
// Start: vyfotit palubní desku → AI přečte údaje → potvrdit. Konec: „Dobito“ jedním ťuknutím,
// nebo „Ukončit dříve“ = vyfotit a aplikace dopočítá rozdíl. Data v telefonu, záloha na Google Disk.

import { h, mount, mark, toast, modal, ask, confirmDialog, formDialog, fmt, downloadBlob, uid } from './ui.js';
import * as D from './data.js';
import { calc, sumUp, calibration, check, coefFor, seasonFor, estimatedEnd, overdue, isRunning, monthKey, monthRange, inRange, SEASON_LABEL, round, DEFAULTS } from './model.js';
import { preparePhoto } from './photo.js';
import { readPhoto, readerReady, readerName } from './reader.js';
import { syncNow, scheduleSync, markDirty, syncState, onSyncStatus, syncConfigured, testConnection, isBusy } from './sync.js';
import { workbook, printReport, fileName, periodLabel, calcLine, nf, kc, MODE_LABEL } from './report.js';

const VERSION = '1.0.0';
const REPO = 'https://github.com/tadeasfirich/nabijeni';
const app = document.getElementById('app');
let content, pill, nav;
let draft = null;              // rozpracovaný záznam z fotky (start / konec)
let draftUi = null;            // odkazy do formuláře rozpracovaného záznamu
let pending = null;            // co se má stát s vybranou fotkou
let lastRoute = '';
let tick = null;
const overview = { mode: 'month', month: monthKey(new Date()), from: '', to: '' };

// ---------------------------------------------------------------- pomocníci
const p2 = (n) => String(n).padStart(2, '0');
function toLocalInput(v) {
  const d = new Date(v);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function fromLocalInput(s) {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const isoDay = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
function duration(min) {
  if (min === null || min === undefined) return '';
  const m = Math.max(0, Math.round(min));
  const hh = Math.floor(m / 60), mm = m % 60;
  return hh ? `${hh} h ${mm} min` : `${mm} min`;
}
function monthName(key) {
  const [y, m] = key.split('-').map(Number);
  const n = new Date(y, m - 1, 1).toLocaleDateString('cs-CZ', { month: 'long' });
  return `${n} ${y}`;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

async function lastOdo(exceptId) {
  const list = await D.listSessions();
  for (const s of list) {
    if (s.id === exceptId) continue;
    const v = parseNum(s.end?.odo) ?? parseNum(s.start?.odo);
    if (v !== null) return v;
  }
  return null;
}

// ---------------------------------------------------------------- kostra
function shell() {
  pill = h('button', { class: 'pill', onclick: () => { location.hash = '#/nastaveni'; setTimeout(() => document.getElementById('zaloha')?.scrollIntoView(), 120); } }, '…');
  nav = h('nav', { class: 'switcher', 'aria-label': 'Hlavní nabídka' },
    h('a', { href: '#/', 'data-r': 'home' }, 'Nabíjení'),
    h('a', { href: '#/prehled', 'data-r': 'prehled' }, 'Přehled'),
    h('a', { href: '#/nastaveni', 'data-r': 'nastaveni' }, 'Nastavení'));
  content = h('main', { class: 'content', id: 'main' });
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, id: 'cam' });
  const galInput = h('input', { type: 'file', accept: 'image/*', hidden: true, id: 'gal' });
  for (const inp of [camInput, galInput]) {
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      inp.value = '';
      if (!f || !pending) return;
      const { kind, sessionId } = pending;
      pending = null;
      try { await startDraft(kind, sessionId, f); } catch (e) { toast(e.message || 'Fotku se nepodařilo načíst.'); }
    });
  }
  mount(app, h('div', { class: 'shell' },
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/' }, brandMark(), h('span', null, h('b', null, 'Nabíjení'), h('small', null, 'Kona · 64 kWh'))),
      h('span', { class: 'spacer' }), pill, nav),
    content, camInput, galInput));
}

function brandMark(big = false) {
  return h('span', { class: `brand-mark ${big ? 'big' : ''}`, 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('b'));
}

async function updatePill(state, busy) {
  const s = await D.getSettings();
  const st = state || await syncState();
  pill.className = 'pill';
  if (!syncConfigured(s)) { mount(pill, mark('opt'), 'jen v telefonu'); return; }
  if (busy ?? isBusy()) { mount(pill, mark('wait'), 'zálohuji…'); return; }
  if (st.lastErr) { pill.className = 'pill warn'; mount(pill, mark('bad'), navigator.onLine ? 'Disk – chyba' : 'offline'); return; }
  if (st.dirty) { mount(pill, mark('wait'), 'čeká na zálohu'); return; }
  mount(pill, mark('ok'), st.lastOk ? `Disk ${fmt.time(st.lastOk)}` : 'Disk');
}

function pickPhoto(kind, source, sessionId) {
  pending = { kind, sessionId };
  document.getElementById(source === 'camera' ? 'cam' : 'gal').click();
}

// ---------------------------------------------------------------- směrování
const ROUTES = [
  [/^#\/?$/, 'home', () => viewHome()],
  [/^#\/foto$/, 'home', () => viewDraft()],
  [/^#\/n\/([\w-]+)$/, 'home', (m) => viewDetail(m[1])],
  [/^#\/prehled$/, 'prehled', () => viewOverview()],
  [/^#\/nastaveni$/, 'nastaveni', () => viewSettings()],
];

let autoBusy = false;
async function autoFinish() {
  if (autoBusy) return 0;
  autoBusy = true;
  try {
    const s = await D.getSettings();
    const due = overdue(await D.listSessions());
    for (const run of due) {
      run.end = { t: estimatedEnd(run), soc: run.target ?? s.target, mode: 'auto' };
      run.status = 'done';
      await D.saveSession(run, { silent: true });
    }
    if (due.length) {
      const c = calc(due[0]);
      toast(due.length === 1
        ? `Nabíjení od ${fmt.short(due[0].start.t)} uzavřeno jako dobito do ${due[0].end.soc} % (${nf(c.grid)} kWh · ${kc(c.cost)}). Jinak? Otevři ho a uprav.`
        : `Uzavřeno ${due.length} nabíjení jako dobito. Jinak? Otevři je a uprav.`, { kind: 'ok', timeout: 8000 });
      if (syncConfigured(s)) markDirty();
    }
    return due.length;
  } finally { autoBusy = false; }
}

async function render() {
  await autoFinish();
  const hash = location.hash || '#/';
  let found = ROUTES.find(([re]) => re.test(hash));
  if (!found) { location.hash = '#/'; return; }
  const [re, tab, view] = found;
  clearInterval(tick);
  nav.querySelectorAll('a').forEach((a) => (a.dataset.r === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const nodes = await view(hash.match(re));
  if (nodes === null) return;
  mount(content, nodes);
  if (hash !== lastRoute) window.scrollTo(0, 0);
  lastRoute = hash;
}

// ---------------------------------------------------------------- domů
async function viewHome() {
  const s = await D.getSettings();
  const list = await D.listSessions();
  const run = list.find(isRunning);
  const thisMonth = monthKey(new Date());
  const monthList = list.filter((x) => x.status === 'done' && monthKey(x.start.t) === thisMonth);
  const t = sumUp(monthList);

  const top = run ? runningCard(run, s) : h('section', { class: 'box start-box' },
    h('h4', null, 'Nové nabíjení'),
    h('p', { class: 'muted' }, 'Připoj kabel, počkej, až se na palubní desce ukáže „Do dobití zbývá“, a vyfoť ji.'),
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn primary xl', onclick: () => pickPhoto('start', 'camera') }, cameraIco(), 'Vyfotit a začít'),
      h('div', { class: 'btn-row two' },
        h('button', { class: 'btn ghost', onclick: () => pickPhoto('start', 'gallery') }, 'Fotka z galerie'),
        h('button', { class: 'btn ghost', onclick: () => startDraft('start', null, null) }, 'Zadat ručně'))),
    readerReady(s) ? null : h('p', { class: 'hint' }, 'Údaje z fotky zatím vyplňuješ ručně. Automatické čtení zapneš v ', h('a', { href: '#/nastaveni' }, 'Nastavení'), ' (klíč Gemini je zdarma).'));

  const groups = new Map();
  for (const x of list.slice(0, 60)) {
    const k = monthKey(x.start.t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(x);
  }

  return [
    top,
    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, cap(monthName(thisMonth))), h('span', { class: 'spacer' }), h('a', { href: '#/prehled', class: 'small' }, 'Export')),
      h('div', { class: 'kpis' },
        kpi(nf(t.grid, 1), 'kWh ze sítě'),
        kpi(nf(t.cost, 0), 'Kč celkem'),
        kpi(String(t.count), 'nabíjení'))),
    list.length ? h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Historie')),
      [...groups.entries()].map(([k, items]) => h('div', { class: 'month' },
        h('p', { class: 'eyebrow' }, monthName(k)),
        h('div', { class: 'rows' }, items.map(sessRow))))) :
      h('section', { class: 'section' }, h('p', { class: 'muted' }, 'Zatím tu není žádné nabíjení.')),
  ];
}

function kpi(big, label) {
  return h('div', { class: 'kpi' }, h('b', null, big), h('span', null, label));
}

function cameraIco() {
  return h('span', { class: 'cam-ico', 'aria-hidden': 'true' });
}

function sessRow(x) {
  const c = calc(x);
  const kind = x.status === 'running' ? 'wait' : (c.grid === null ? 'bad' : 'ok');
  return h('a', { class: 'row', href: `#/n/${x.id}` },
    mark(kind),
    h('span', { class: 'grow' },
      h('b', null, `${fmt.date(x.start.t)} `, h('span', { class: 'muted' }, fmt.time(x.start.t))),
      h('small', null, x.status === 'running' ? `${x.start.soc} % → nabíjí se` :
        `${x.start.soc} → ${x.end?.soc ?? '?'} %${x.end?.mode === 'drive' ? ' · dříve' : ''}${c.measured ? ' · elektroměr' : ''}`)),
    x.status === 'done' ? h('span', { class: 'row-num' }, h('b', null, `${nf(c.grid, 1)} kWh`), h('small', null, kc(c.cost))) : null,
    h('span', { class: 'chev' }));
}

function runningCard(run, s) {
  const est = estimatedEnd(run);
  const estLine = h('p', { class: 'run-est' });
  const upd = () => {
    if (!est) { estLine.textContent = 'Odhad konce neznám.'; return; }
    const left = (Date.parse(est) - Date.now()) / 60000;
    if (left <= 0) { clearInterval(tick); render(); return; }
    estLine.textContent = `Dobito asi ${fmt.short(est)} – za ${duration(left)}`;
  };
  upd();
  tick = setInterval(upd, 30000);
  const target = run.target ?? s.target;
  return h('section', { class: 'box dark run' },
    h('h4', null, 'Nabíjí se'),
    h('p', { class: 'run-big' }, `${run.start.soc} %`, h('span', { class: 'arrow' }), `${target} %`),
    h('p', { class: 'run-meta' }, `Od ${fmt.short(run.start.t)} · ${SEASON_LABEL[run.season]} × ${nf(run.coef)}${run.start.kw ? ` · ${nf(run.start.kw, 1)} kW` : ''}`),
    estLine,
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn primary xl on-dark', onclick: () => finishAtTarget(run) }, `Dobito – ${target} %`),
      h('button', { class: 'btn xl', onclick: () => pickPhoto('end', 'camera', run.id) }, cameraIco(), 'Ukončit dříve – vyfotit'),
      h('div', { class: 'btn-row two' },
        h('button', { class: 'btn dark small', onclick: () => pickPhoto('end', 'gallery', run.id) }, 'Fotka z galerie'),
        h('button', { class: 'btn dark small', onclick: () => startDraft('end', run.id, null) }, 'Zadat ručně'))),
    h('p', { class: 'run-links' }, h('a', { href: `#/n/${run.id}` }, 'Detail a úpravy')));
}

async function finishAtTarget(run) {
  const s = await D.getSettings();
  const target = run.target ?? s.target;
  const est = estimatedEnd(run);
  const endT = est && Date.parse(est) < Date.now() ? est : new Date().toISOString();
  const preview = { ...run, end: { t: endT, soc: target, mode: 'dobito' }, status: 'done' };
  const ok = await ask(`Dobito do ${target} %?`, calcLine(preview), [
    { label: 'Uložit', value: 'ok', kind: 'primary' },
    { label: 'Dobilo se jinak – zadat ručně', value: 'manual' },
    { label: 'Zpět', value: null, kind: 'ghost' },
  ]);
  if (ok === 'manual') return startDraft('end', run.id, null);
  if (ok !== 'ok') return;
  run.end = { t: endT, soc: target, mode: 'dobito' };
  run.status = 'done';
  await D.saveSession(run);
  const c = calc(run);
  toast(`Uloženo: ${nf(c.grid)} kWh · ${kc(c.cost)}`, { kind: 'ok' });
  render();
}

// ---------------------------------------------------------------- fotka → potvrzení
async function startDraft(kind, sessionId, file) {
  const s = await D.getSettings();
  if (kind === 'start') {
    const run = await D.runningSession();
    if (run) {
      const v = await ask('Předchozí nabíjení běží', `Od ${fmt.short(run.start.t)} (${run.start.soc} %). Co s ním?`, [
        { label: `Ukončit jako dobito do ${run.target ?? s.target} %`, value: 'finish', kind: 'primary' },
        { label: 'Smazat ho', value: 'del' },
        { label: 'Zpět', value: null, kind: 'ghost' },
      ]);
      if (!v) return;
      if (v === 'finish') {
        const est = estimatedEnd(run);
        run.end = { t: est && Date.parse(est) < Date.now() ? est : new Date().toISOString(), soc: run.target ?? s.target, mode: 'dobito' };
        run.status = 'done';
        await D.saveSession(run);
      } else await D.deleteSession(run.id);
    }
  }
  let prepared = { blob: null, time: new Date(), fromExif: false };
  if (file) {
    const close = toast('Připravuji fotku…', { timeout: 20000 });
    try { prepared = await preparePhoto(file); } finally { close(); }
  }
  if (draft?.url) URL.revokeObjectURL(draft.url);
  draft = {
    id: uid(), kind, sessionId,
    blob: prepared.blob, url: prepared.blob ? URL.createObjectURL(prepared.blob) : null,
    t: prepared.time, fromExif: prepared.fromExif,
    src: {}, status: prepared.blob ? (readerReady(s) ? 'reading' : 'none') : 'manual', msg: '',
  };
  if (location.hash === '#/foto') render(); else location.hash = '#/foto';
  if (draft.status === 'reading') runRead(draft);
}

async function runRead(d) {
  const s = await D.getSettings();
  d.status = 'reading'; d.msg = '';
  draftUi?.status();
  try {
    const r = await readPhoto(d.blob, s, (msg) => { if (draft === d) { d.progress = msg; draftUi?.status(); } });
    if (draft !== d) return;
    d.progress = '';
    d.src = r.values;
    const n = Object.keys(r.values).length;
    d.status = n ? 'ok' : 'err';
    d.msg = !n ? 'Na fotce jsem nic nepřečetl – vyplň údaje ručně.'
      : !r.charging ? 'Fotka asi neukazuje obrazovku nabíjení – zkontroluj hodnoty.'
        : r.values.soc === undefined ? 'Stav baterie jsem nepřečetl – doplň ho.' : '';
  } catch (e) {
    if (draft !== d) return;
    d.status = 'err';
    d.msg = e.message;
  }
  draftUi?.status();
  draftUi?.apply();
}

async function viewDraft() {
  const d = draft;
  if (!d) { location.hash = '#/'; return null; }
  const s = await D.getSettings();
  const run = d.sessionId ? await D.getSession(d.sessionId) : null;
  if (d.kind === 'end' && !run) { location.hash = '#/'; return null; }
  const prevOdo = await lastOdo(d.sessionId);
  const isStart = d.kind === 'start';
  const touched = new Set();

  const inp = (name, attrs = {}) => {
    const el = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', name, ...attrs });
    el.addEventListener('input', () => { touched.add(name); recompute(); });
    return el;
  };
  const f = {
    soc: inp('soc', { class: 'big-input', inputmode: 'numeric', placeholder: '–' }),
    t: h('input', { type: 'datetime-local', name: 't', value: toLocalInput(d.t) }),
    odo: inp('odo', { inputmode: 'numeric', placeholder: prevOdo ? `minule ${prevOdo}` : 'km' }),
    remH: inp('remH', { inputmode: 'numeric', placeholder: 'h' }),
    remM: inp('remM', { inputmode: 'numeric', placeholder: 'min' }),
    target: inp('target', { inputmode: 'numeric', value: String(s.target) }),
    kw: inp('kw', { value: nf(s.kw, 1) }),
    note: h('input', { type: 'text', name: 'note', placeholder: 'nepovinné' }),
  };
  f.t.addEventListener('input', () => { touched.add('t'); updSeason(); recompute(); });
  const tags = {};
  const tag = (k) => (tags[k] = h('em', { class: 'from-photo', hidden: true }, 'z fotky'));

  let season = seasonFor(d.t, s);
  let seasonTouched = false;
  const seasonSeg = h('div', { class: 'seg' });
  const drawSeason = () => mount(seasonSeg, ['zima', 'leto'].map((k) => h('button', {
    type: 'button', 'aria-pressed': String(season === k),
    onclick: () => { season = k; seasonTouched = true; drawSeason(); recompute(); },
  }, `${cap(SEASON_LABEL[k])} × ${nf(coefFor(k, s))}`)));
  const updSeason = () => { if (!seasonTouched) { season = seasonFor(fromLocalInput(f.t.value) || d.t, s); drawSeason(); } };
  drawSeason();

  const stepper = (delta) => h('button', {
    type: 'button', class: 'step', 'aria-label': delta > 0 ? 'Přidat 1 %' : 'Ubrat 1 %',
    onclick: () => { const v = parseNum(f.soc.value) ?? (isStart ? 20 : run?.start?.soc ?? 50); f.soc.value = String(Math.min(100, Math.max(0, Math.round(v + delta)))); touched.add('soc'); recompute(); },
  }, delta > 0 ? '+' : '−');

  const statusBox = h('div', { class: 'read-status' });
  const msgBox = h('div', { class: 'msgs' });
  const calcBox = h('div', { class: 'box fill calc', hidden: isStart });
  const saveBtn = h('button', { class: 'btn primary xl wide', type: 'submit' }, isStart ? 'Uložit začátek nabíjení' : 'Uložit konec nabíjení');

  function values() {
    const remH = parseNum(f.remH.value), remM = parseNum(f.remM.value);
    return {
      soc: parseNum(f.soc.value) === null ? null : Math.round(parseNum(f.soc.value)),
      t: fromLocalInput(f.t.value),
      odo: parseNum(f.odo.value) === null ? null : Math.round(parseNum(f.odo.value)),
      remainMin: remH === null && remM === null ? null : (remH || 0) * 60 + (remM || 0),
      target: parseNum(f.target.value),
      kw: parseNum(f.kw.value),
      note: f.note.value.trim(),
    };
  }
  function recompute() {
    const v = values();
    const res = check(d.kind, v, { lastOdo: prevOdo, startSoc: run?.start?.soc, startT: run?.start?.t });
    mount(msgBox,
      res.errors.map((e) => h('p', { class: 'form-err' }, e)),
      res.warnings.map((w) => h('p', { class: 'warn-line' }, mark('bad'), w)));
    if (!isStart && run) {
      const preview = { ...run, end: { t: v.t, soc: v.soc, mode: 'drive' } };
      const c = calc(preview);
      mount(calcBox, c.grid === null ? h('p', { class: 'muted' }, 'Zadej stav baterie a spočítám, kolik se nabilo.') : [
        h('h4', null, 'Výpočet'),
        h('p', { class: 'calc-big' }, h('b', null, `${nf(c.grid)} kWh`), h('span', null, ` · ${kc(c.cost)}`)),
        h('p', { class: 'small muted' }, calcLine(preview)),
        h('p', { class: 'small muted' }, `Nabíjelo se ${c.hours !== null ? duration(c.hours * 60) : '?'}${c.timeKwh ? ` · podle času a výkonu by to bylo ${nf(c.timeKwh)} kWh` : ''}.`),
      ]);
    }
    saveBtn.disabled = res.errors.length > 0;
    return { v, res };
  }

  function apply() {
    const src = d.src || {};
    const set = (key, el, val) => {
      if (val === undefined || val === null) return;
      if (touched.has(key)) return;
      el.value = String(val);
      if (tags[key]) tags[key].hidden = false;
    };
    set('soc', f.soc, src.soc);
    set('odo', f.odo, src.odo);
    if (isStart) {
      if (src.remainMin !== undefined && !touched.has('remH') && !touched.has('remM')) {
        f.remH.value = String(Math.floor(src.remainMin / 60));
        f.remM.value = String(src.remainMin % 60);
        if (tags.rem) tags.rem.hidden = false;
      }
      set('target', f.target, src.target);
      if (src.kw !== undefined) set('kw', f.kw, nf(src.kw, 1));
    }
    recompute();
  }

  function status() {
    const st = d.status;
    if (st === 'manual') { mount(statusBox); statusBox.hidden = true; return; }
    statusBox.hidden = false;
    statusBox.className = `read-status ${st}`;
    if (st === 'reading') mount(statusBox, h('span', { class: 'spin' }), h('span', null, `Čtu údaje z fotky (${readerName(s)})…`, d.progress ? h('small', null, d.progress) : null));
    else if (st === 'ok') mount(statusBox, mark('ok'), h('span', null, 'Přečteno z fotky – zkontroluj a potvrď.', d.msg ? h('small', null, d.msg) : null));
    else if (st === 'none') mount(statusBox, mark('opt'), h('span', null, 'Vyplň údaje z fotky. ', h('a', { href: '#/nastaveni' }, 'Zapnout automatické čtení')));
    else mount(statusBox, mark('bad'), h('span', null, d.msg || 'Nepodařilo se přečíst.'),
      h('button', { type: 'button', class: 'btn small ghost', onclick: () => runRead(d) }, 'Zkusit znovu'));
  }

  async function save(e) {
    e.preventDefault();
    const { v, res } = recompute();
    if (res.errors.length) return;
    saveBtn.disabled = true;
    const photo = d.blob ? await D.savePhoto(d.blob, { kind: d.kind }) : null;
    if (isStart) {
      const sess = {
        status: 'running',
        car: s.car, capacity: s.capacity, price: s.price,
        kw: v.kw ?? s.kw, target: v.target ?? s.target,
        season, coef: coefFor(season, s),
        start: { t: v.t, soc: v.soc, odo: v.odo, remainMin: v.remainMin, kw: v.kw, target: v.target, photo, read: d.status === 'ok' ? d.src : null },
        note: v.note,
      };
      await D.saveSession(sess);
      toast(`Začátek uložen: ${v.soc} %`, { kind: 'ok' });
    } else {
      run.end = { t: v.t, soc: v.soc, odo: v.odo, photo, mode: d.blob ? 'drive' : 'rucne', read: d.status === 'ok' ? d.src : null };
      run.status = 'done';
      if (v.note) run.note = [run.note, v.note].filter(Boolean).join(' · ');
      await D.saveSession(run);
      const c = calc(run);
      toast(`Uloženo: ${nf(c.grid)} kWh · ${kc(c.cost)}`, { kind: 'ok' });
    }
    if (d.url) URL.revokeObjectURL(d.url);
    draft = null; draftUi = null;
    location.hash = '#/';
  }

  const photoEl = d.url ? h('button', { type: 'button', class: 'photo', onclick: () => zoom(d.url) }, h('img', { src: d.url, alt: 'Fotka palubní desky' }), h('span', null, 'Zvětšit')) : null;

  const view = [
    h('a', { class: 'back', href: '#/', onclick: () => { draft = null; draftUi = null; } }, 'Zpět'),
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, isStart ? 'Začátek nabíjení' : 'Konec nabíjení'),
      h('h1', { class: 'title' }, isStart ? 'Kolik má baterie teď?' : 'Kolik se nabilo?'),
      !isStart && run ? h('p', { class: 'sub' }, `Start ${fmt.short(run.start.t)} na ${run.start.soc} % · ${SEASON_LABEL[run.season]} × ${nf(run.coef)}`) : null),
    h('form', { class: 'draft', onsubmit: save },
      photoEl,
      statusBox,
      h('div', { class: 'field soc-field' }, h('span', null, 'Baterie', tag('soc')),
        h('div', { class: 'stepper' }, stepper(-1), f.soc, h('span', { class: 'unit' }, '%'), stepper(1))),
      isStart ? h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, 'Do dobití zbývá', tag('rem')), h('div', { class: 'hm' }, f.remH, h('span', null, 'h'), f.remM, h('span', null, 'min'))),
        h('label', { class: 'field' }, h('span', null, 'Cíl %', tag('target')), f.target)) : null,
      isStart ? h('label', { class: 'field' }, h('span', null, 'Výkon kW', tag('kw')), f.kw) : null,
      h('label', { class: 'field' }, h('span', null, 'Tachometr km', tag('odo')), f.odo),
      h('label', { class: 'field' }, h('span', null, 'Čas', d.fromExif ? h('em', { class: 'from-photo' }, 'z fotky') : null), f.t),
      isStart ? h('div', { class: 'field' }, h('span', { class: 'muted' }, 'Koeficient ztrát'), seasonSeg) : null,
      h('label', { class: 'field' }, h('span', null, 'Poznámka'), f.note),
      calcBox,
      msgBox,
      h('div', { class: 'btn-col sticky-save' }, saveBtn,
        h('button', { type: 'button', class: 'btn ghost', onclick: () => { draft = null; draftUi = null; location.hash = '#/'; } }, 'Zrušit'))),
  ];
  draftUi = { status, apply };
  status();
  apply();
  return view;
}

function zoom(url) {
  modal((close) => [h('img', { src: url, class: 'zoom', alt: 'Fotka', onclick: close }), h('button', { class: 'btn wide', onclick: close }, 'Zavřít')], { wide: true });
}

// ---------------------------------------------------------------- detail
async function viewDetail(id) {
  const x = await D.getSession(id);
  if (!x || x.deleted) return [h('a', { class: 'back', href: '#/' }, 'Zpět'), h('p', null, 'Záznam nenalezen.')];
  const s = await D.getSettings();
  const c = calc(x);
  const photos = [];
  for (const part of ['start', 'end']) {
    const p = x[part];
    if (!p) continue;
    const ph = p.photo ? await D.getPhoto(p.photo) : null;
    if (ph?.blob) {
      const url = URL.createObjectURL(ph.blob);
      photos.push(h('button', { class: 'photo small', onclick: () => zoom(url) }, h('img', { src: url, alt: '' }), h('span', null, part === 'start' ? 'Start' : 'Konec')));
    } else if (p.photoDrive) {
      photos.push(h('a', { class: 'btn ghost small', href: `https://drive.google.com/file/d/${p.photoDrive}/view`, target: '_blank', rel: 'noopener' }, `Fotka ${part === 'start' ? 'startu' : 'konce'} na Disku`));
    }
  }
  const meterInp = h('input', { type: 'text', inputmode: 'decimal', placeholder: 'kWh z elektroměru', value: x.meterKwh != null ? nf(x.meterKwh, 2) : '' });
  const rowsTbl = [
    ['Začátek', `${fmt.dt(x.start.t)} · ${x.start.soc} %`],
    x.start.remainMin != null ? ['Do dobití zbývalo', duration(x.start.remainMin)] : null,
    x.end ? ['Konec', `${fmt.dt(x.end.t)} · ${x.end.soc} % · ${x.end.mode === 'dobito' ? `dobito do ${x.end.soc} %` : MODE_LABEL[x.end.mode] || ''}`] : ['Konec', 'nabíjí se'],
    c.hours !== null ? ['Doba', duration(c.hours * 60)] : null,
    ['Tachometr', x.start.odo ? `${x.start.odo.toLocaleString('cs-CZ')} km` : '–'],
    ['Koeficient', c.measured ? `${nf(c.realCoef, 3)} (z elektroměru)` : `${SEASON_LABEL[x.season]} × ${nf(x.coef)}`],
    ['Cena', `${nf(x.price)} Kč/kWh`],
    c.timeKwh ? ['Kontrola podle času', `${nf(c.hours)} h × ${nf(x.kw, 1)} kW = ${nf(c.timeKwh)} kWh`] : null,
    x.note ? ['Poznámka', x.note] : null,
  ].filter(Boolean);

  return [
    h('a', { class: 'back', href: '#/' }, 'Zpět'),
    h('div', { class: 'page-head' },
      h('p', { class: 'eyebrow' }, x.status === 'running' ? 'Probíhá' : 'Nabíjení'),
      h('h1', { class: 'title' }, `${fmt.date(x.start.t)} · ${x.start.soc} → ${x.end?.soc ?? '…'} %`)),
    x.status === 'running' ? runningCard(x, s) : h('div', { class: 'kpis' },
      kpi(nf(c.grid), c.measured ? 'kWh ze sítě (elektroměr)' : 'kWh ze sítě'),
      kpi(nf(c.cost), 'Kč'),
      kpi(`${c.dSoc} %`, `nabito · ${nf(c.battery)} kWh`)),
    x.status === 'done' ? h('p', { class: 'small muted calc-line' }, calcLine(x)) : null,
    h('table', { class: 'kv' }, h('tbody', null, rowsTbl.map(([k, v]) => h('tr', null, h('th', null, k), h('td', null, v))))),
    photos.length ? h('div', { class: 'photos' }, photos) : null,
    x.status === 'done' ? h('section', { class: 'box dashed meter' },
      h('h4', null, 'Elektroměr (nepovinné)'),
      h('p', { class: 'small muted' }, 'Když máš na zásuvce měřák spotřeby, zapiš skutečné kWh. Použijí se místo výpočtu a z několika měření spočítám skutečný koeficient.'),
      h('div', { class: 'manual' }, meterInp, h('button', {
        class: 'btn', onclick: async () => {
          const v = parseNum(meterInp.value);
          x.meterKwh = v && v > 0 ? round(v, 3) : null;
          const rc = calc(x).realCoef;
          if (rc && (rc < 1 || rc > 1.6) && !(await confirmDialog('Opravdu?', `Koeficient by vyšel ${nf(rc, 2)} – obvykle bývá 1,1–1,35. Zkontroluj, jestli jsou kWh z elektroměru jen za toto nabíjení.`, 'Uložit i tak', 'Opravit'))) return;
          await D.saveSession(x);
          toast(x.meterKwh ? 'Elektroměr uložen.' : 'Údaj z elektroměru smazán.', { kind: 'ok' });
          render();
        },
      }, 'Uložit'))) : null,
    h('div', { class: 'btn-row actions' },
      h('button', { class: 'btn', onclick: () => editSession(x) }, 'Upravit'),
      h('button', { class: 'btn ghost', onclick: async () => {
        if (!(await confirmDialog('Smazat nabíjení?', `${fmt.dt(x.start.t)} · ${x.start.soc} → ${x.end?.soc ?? '…'} %. Smaže se i ze zálohy.`, 'Smazat', 'Nechat'))) return;
        await D.deleteSession(x.id);
        toast('Smazáno.');
        location.hash = '#/';
      } }, 'Smazat')),
  ];
}

async function editSession(x) {
  const fields = [
    { name: 'startT', label: 'Začátek', type: 'datetime-local', value: toLocalInput(x.start.t), required: true },
    { name: 'startSoc', label: 'Baterie na začátku %', inputmode: 'numeric', value: String(x.start.soc ?? ''), required: true },
    { name: 'remain', label: 'Do dobití zbývalo (minut)', inputmode: 'numeric', value: x.start.remainMin != null ? String(x.start.remainMin) : '' },
    { name: 'odo', label: 'Tachometr km', inputmode: 'numeric', value: x.start.odo != null ? String(x.start.odo) : '' },
  ];
  if (x.end) fields.push(
    { name: 'endT', label: 'Konec', type: 'datetime-local', value: toLocalInput(x.end.t), required: true },
    { name: 'endSoc', label: 'Baterie na konci %', inputmode: 'numeric', value: String(x.end.soc ?? ''), required: true },
  );
  fields.push(
    { name: 'coef', label: 'Koeficient ztrát', inputmode: 'decimal', value: nf(x.coef), required: true },
    { name: 'price', label: 'Cena Kč/kWh', inputmode: 'decimal', value: nf(x.price), required: true },
    { name: 'note', label: 'Poznámka', value: x.note || '' },
  );
  const r = await formDialog('Upravit nabíjení', fields, { ok: 'Uložit změny' });
  if (!r) return;
  const n = (k) => parseNum(r[k]);
  const next = structuredClone(x);
  next.start.t = fromLocalInput(r.startT) || x.start.t;
  next.start.soc = Math.round(n('startSoc'));
  next.start.remainMin = n('remain');
  next.start.odo = n('odo');
  if (x.end) {
    next.end.t = fromLocalInput(r.endT) || x.end.t;
    next.end.soc = Math.round(n('endSoc'));
    if (next.end.soc !== x.end.soc || next.end.t !== x.end.t) next.end.mode = x.end.mode === 'drive' ? 'drive' : 'upraveno';
  }
  next.coef = n('coef') ?? x.coef;
  next.price = n('price') ?? x.price;
  next.note = r.note;
  const errs = [];
  if (!(next.start.soc >= 0 && next.start.soc <= 100)) errs.push('Baterie na začátku musí být 0–100 %.');
  if (x.end && !(next.end.soc >= next.start.soc && next.end.soc <= 100)) errs.push('Baterie na konci musí být víc než na začátku a nejvýš 100 %.');
  if (x.end && Date.parse(next.end.t) < Date.parse(next.start.t)) errs.push('Konec je dřív než začátek.');
  if (!(next.coef >= 1 && next.coef <= 2)) errs.push('Koeficient má být mezi 1 a 2.');
  if (errs.length) { await ask('Nelze uložit', errs.join(' '), [{ label: 'Rozumím', value: true, kind: 'primary' }]); return; }
  await D.saveSession(next);
  toast('Změny uloženy.', { kind: 'ok' });
  render();
}

// ---------------------------------------------------------------- přehled a export
async function viewOverview() {
  const s = await D.getSettings();
  const all = (await D.listSessions()).filter((x) => x.status === 'done');
  const months = [...new Set([monthKey(new Date()), ...all.map((x) => monthKey(x.start.t))])].sort().reverse();
  if (!months.includes(overview.month)) overview.month = months[0];
  if (!overview.from) {
    const now = new Date();
    overview.from = isoDay(new Date(now.getFullYear(), now.getMonth(), 1));
    overview.to = isoDay(now);
  }
  const range = overview.mode === 'month' ? monthRange(overview.month) : { from: overview.from, to: overview.to };
  const list = inRange(all, range.from, range.to);
  const t = sumUp(list);
  const cal = calibration(all);

  const modeSeg = h('div', { class: 'seg tabs' },
    h('button', { 'aria-pressed': String(overview.mode === 'month'), onclick: () => { overview.mode = 'month'; render(); } }, 'Měsíc'),
    h('button', { 'aria-pressed': String(overview.mode === 'range'), onclick: () => { overview.mode = 'range'; render(); } }, 'Vlastní období'));

  const picker = overview.mode === 'month'
    ? h('label', { class: 'field' }, h('span', null, 'Měsíc'),
      h('select', { onchange: (e) => { overview.month = e.target.value; render(); } },
        months.map((m) => { const o = h('option', { value: m }, cap(monthName(m))); if (m === overview.month) o.selected = true; return o; })))
    : h('div', { class: 'grid2' },
      h('label', { class: 'field' }, h('span', null, 'Od'), h('input', { type: 'date', value: overview.from, onchange: (e) => { overview.from = e.target.value; render(); } })),
      h('label', { class: 'field' }, h('span', null, 'Do'), h('input', { type: 'date', value: overview.to, onchange: (e) => { overview.to = e.target.value; render(); } })));

  const excel = async (share = false) => {
    const blob = workbook(list, { ...range, settings: s });
    const name = fileName(range.from, range.to, 'xlsx');
    if (share) {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: `Nabíjení ${periodLabel(range.from, range.to)}` }); return; } catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    downloadBlob(name, blob);
  };
  const canShare = (() => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })] }); } catch { return false; } })();

  return [
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Přehled a export'), h('h1', { class: 'title' }, periodLabel(range.from, range.to))),
    modeSeg,
    picker,
    h('div', { class: 'kpis four' },
      kpi(nf(t.grid), 'kWh ze sítě'),
      kpi(nf(t.cost), 'Kč celkem'),
      kpi(String(t.count), 'nabíjení'),
      kpi(nf(t.battery), 'kWh do baterie')),
    h('div', { class: 'btn-col' },
      h('button', { class: 'btn primary', disabled: !list.length, onclick: () => excel(false) }, 'Stáhnout Excel'),
      h('button', { class: 'btn', disabled: !list.length, onclick: () => printReport(list, { ...range, settings: s }) }, 'PDF / tisk'),
      canShare ? h('button', { class: 'btn ghost', disabled: !list.length, onclick: () => excel(true) }, 'Poslat Excel (sdílet)') : null),
    h('p', { class: 'small muted' }, 'PDF: v okně tisku zvol „Uložit jako PDF“.'),
    list.length ? h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Datum'), h('th', null, 'Baterie'), h('th', { class: 'n' }, 'Ze sítě'), h('th', { class: 'n' }, 'Částka'))),
      h('tbody', null, [...list].reverse().map((x) => {
        const c = calc(x);
        return h('tr', { class: 'click', onclick: () => { location.hash = `#/n/${x.id}`; } },
          h('td', null, fmt.date(x.start.t), h('small', { class: 'muted' }, ` ${fmt.time(x.start.t)}`)),
          h('td', null, `${x.start.soc} → ${x.end.soc} %`),
          h('td', { class: 'n' }, nf(c.grid)),
          h('td', { class: 'n' }, nf(c.cost)));
      })),
      h('tfoot', null, h('tr', null, h('td', { colspan: 2 }, h('b', null, 'Celkem')), h('td', { class: 'n' }, h('b', null, nf(t.grid))), h('td', { class: 'n' }, h('b', null, nf(t.cost))))))) :
      h('p', { class: 'muted' }, 'V tomto období není žádné dokončené nabíjení.'),
    (cal.zima || cal.leto) ? h('section', { class: 'box fill section' },
      h('h4', null, 'Kalibrace podle elektroměru'),
      ['zima', 'leto'].map((k) => cal[k] ? h('p', null, `${cap(SEASON_LABEL[k])}: skutečný koeficient ${nf(cal[k].coef, 3)} z ${cal[k].n} ${fmt.plural(cal[k].n, 'měření', 'měření', 'měření')} (nastaveno ${nf(coefFor(k, s))}).`) : null),
      h('a', { href: '#/nastaveni' }, 'Upravit koeficienty v Nastavení')) : null,
  ];
}

// ---------------------------------------------------------------- nastavení
async function viewSettings() {
  const s = await D.getSettings();
  const st = await syncState();
  const info = await D.storageInfo();
  const count = (await D.listSessions()).length;
  const cal = calibration(await D.listSessions());

  const numField = (label, key, { unit = '', d = 2, min = 0, max = 1e6, hint } = {}) => {
    const el = h('input', { type: 'text', inputmode: 'decimal', value: nf(s[key], d) });
    el.addEventListener('change', async () => {
      const v = parseNum(el.value);
      if (v === null || v < min || v > max) { toast(`${label}: zadej číslo ${nf(min, 0)}–${nf(max, 0)}.`); el.value = nf(s[key], d); return; }
      await D.saveSettings({ [key]: v });
      s[key] = v;
      toast(`${label}: uloženo.`, { kind: 'ok' });
    });
    return h('label', { class: 'field' }, h('span', null, label, unit ? h('em', null, ` (${unit})`) : null), el, hint ? h('small', { class: 'muted' }, hint) : null);
  };

  // měsíce zimy
  const monthsBox = h('div', { class: 'seg months' });
  const drawMonths = () => mount(monthsBox, Array.from({ length: 12 }, (_, i) => i + 1).map((m) => h('button', {
    type: 'button', 'aria-pressed': String(s.winterMonths.includes(m)),
    onclick: async () => {
      const set = new Set(s.winterMonths);
      set.has(m) ? set.delete(m) : set.add(m);
      s.winterMonths = [...set].sort((a, b) => a - b);
      await D.saveSettings({ winterMonths: s.winterMonths });
      drawMonths();
    },
  }, new Date(2026, m - 1, 1).toLocaleDateString('cs-CZ', { month: 'short' }).replace('.', ''))));
  drawMonths();

  // čtení fotek
  const r = s.reader;
  const provSeg = h('div', { class: 'seg' });
  const keyBox = h('div', { class: 'stack-s' });
  const testOut = h('div', { class: 'test-out' });
  const drawReader = () => {
    mount(provSeg, [['gemini', 'Gemini (zdarma)'], ['claude', 'Claude']].map(([k, label]) => h('button', {
      type: 'button', 'aria-pressed': String(r.provider === k),
      onclick: async () => { r.provider = k; await D.saveSettings({ reader: { provider: k } }); drawReader(); },
    }, label)));
    const isG = r.provider !== 'claude';
    const keyName = isG ? 'geminiKey' : 'claudeKey';
    const modelName = isG ? 'geminiModel' : 'claudeModel';
    const keyInp = h('input', { type: 'password', autocomplete: 'off', value: r[keyName] || '', placeholder: isG ? 'AIza…' : 'sk-ant-…' });
    const modelInp = h('input', { type: 'text', autocomplete: 'off', value: r[modelName] || '' });
    keyInp.addEventListener('change', async () => { r[keyName] = keyInp.value.trim(); await D.saveSettings({ reader: { [keyName]: r[keyName] } }); toast('Klíč uložen (jen v tomto telefonu).', { kind: 'ok' }); });
    modelInp.addEventListener('change', async () => { r[modelName] = modelInp.value.trim() || DEFAULTS.reader[modelName]; modelInp.value = r[modelName]; await D.saveSettings({ reader: { [modelName]: r[modelName] } }); toast('Model uložen.', { kind: 'ok' }); });
    mount(keyBox,
      h('label', { class: 'field' }, h('span', null, isG ? 'Klíč Gemini API' : 'Klíč Claude API'), keyInp,
        h('small', { class: 'muted' }, isG
          ? h('span', null, 'Zdarma na ', h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), ' → Create API key. Fotky se v bezplatné verzi mohou použít ke zlepšování Googlu – je na nich jen palubní deska.')
          : h('span', null, 'Placené podle spotřeby (asi haléř za fotku): ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), '.'))),
      h('label', { class: 'field' }, h('span', null, 'Model'), modelInp, h('small', { class: 'muted' }, `Výchozí: ${DEFAULTS.reader[modelName]}. Když Google/Anthropic model vyřadí, napiš sem novější.`)));
  };
  drawReader();
  const testReader = async () => {
    const prog = h('span', null, ' Čtu ukázkovou fotku…');
    mount(testOut, h('p', { class: 'muted' }, h('span', { class: 'spin' }), prog));
    try {
      const blob = await (await fetch('docs/test-foto.jpg', { cache: 'no-store' })).blob();
      const cur = await D.getSettings();
      const res = await readPhoto(blob, cur, (msg) => { prog.textContent = ` ${msg}`; });
      const v = res.values;
      const ok = v.soc === 48 && v.odo === 90887;
      mount(testOut, h('p', { class: ok ? 'ok-line' : 'warn-line' }, mark(ok ? 'ok' : 'bad'),
        `Přečteno: baterie ${v.soc ?? '?'} %, cíl ${v.target ?? '?'} %, zbývá ${v.remainMin != null ? duration(v.remainMin) : '?'}, ${v.kw ?? '?'} kW, tachometr ${v.odo ?? '?'} km.`,
        ok ? ' Sedí (48 %, 90 887 km).' : ' Správně je 48 %, 9 h 50 min, 3,5 kW, 90 887 km.'),
        res.model && cur.reader.provider !== 'claude' && res.model !== cur.reader.geminiModel ? h('p', { class: 'small' }, `Zvolený model nestíhal, přečetl to ${res.model}. `,
          h('button', { class: 'btn small', onclick: async () => { await D.saveSettings({ reader: { geminiModel: res.model } }); toast('Model změněn.', { kind: 'ok' }); render(); } }, `Používat ${res.model}`)) : null);
    } catch (e) {
      mount(testOut, h('p', { class: 'form-err' }, e.message));
    }
  };

  // záloha
  const sy = s.sync;
  const urlInp = h('input', { type: 'url', value: sy.url || '', placeholder: 'https://script.google.com/macros/s/…/exec' });
  const tokInp = h('input', { type: 'password', value: sy.token || '', placeholder: 'heslo z řádku TOKEN ve skriptu' });
  const syncOut = h('div', { class: 'test-out' });
  const saveSync = async () => { await D.saveSettings({ sync: { url: urlInp.value.trim(), token: tokInp.value.trim() } }); };
  urlInp.addEventListener('change', saveSync);
  tokInp.addEventListener('change', saveSync);
  const enabled = h('input', { type: 'checkbox', checked: sy.enabled });
  enabled.addEventListener('change', async () => {
    await saveSync();
    await D.saveSettings({ sync: { enabled: enabled.checked } });
    updatePill();
    if (enabled.checked) doSync();
  });
  const doSync = async (restore = false) => {
    await saveSync();
    const cur = await D.getSettings();
    if (!syncConfigured(cur)) { mount(syncOut, h('p', { class: 'form-err' }, 'Vyplň adresu skriptu i heslo a zapni zálohování.')); return; }
    mount(syncOut, h('p', { class: 'muted' }, h('span', { class: 'spin' }), restore ? ' Obnovuji z Disku…' : ' Zálohuji…'));
    try {
      const res = await syncNow({ restore });
      mount(syncOut, h('p', { class: 'ok-line' }, mark('ok'), res.offline ? 'Jsi offline – zálohuje se, až bude internet.' : `Hotovo${res.photos ? ` (nahráno ${res.photos} ${fmt.plural(res.photos, 'fotka', 'fotky', 'fotek')})` : ''}.`));
      if (restore) render();
    } catch (e) {
      mount(syncOut, h('p', { class: 'form-err' }, e.message));
    }
    updatePill();
  };
  const testSync = async () => {
    await saveSync();
    mount(syncOut, h('p', { class: 'muted' }, h('span', { class: 'spin' }), ' Zkouším spojení…'));
    try {
      const res = await testConnection(urlInp.value.trim(), tokInp.value.trim());
      mount(syncOut, h('p', { class: 'ok-line' }, mark('ok'), 'Spojení funguje. ', res.folderUrl ? h('a', { href: res.folderUrl, target: '_blank', rel: 'noopener' }, 'Otevřít složku na Disku') : null));
    } catch (e) { mount(syncOut, h('p', { class: 'form-err' }, e.message)); }
  };

  const fileInp = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  fileInp.addEventListener('change', async () => {
    const f = fileInp.files[0]; fileInp.value = '';
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const n = await D.importSessions(j.sessions || []);
      toast(`Nahráno ${n} ${fmt.plural(n, 'záznam', 'záznamy', 'záznamů')}.`, { kind: 'ok' });
      render();
    } catch { toast('Soubor není záloha z této aplikace.'); }
  });

  return [
    h('div', { class: 'page-head' }, h('p', { class: 'eyebrow' }, 'Nastavení'), h('h1', { class: 'title' }, 'Nastavení')),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Auto a elektřina')),
      numField('Cena elektřiny', 'price', { unit: 'Kč/kWh', d: 2, min: 0.1, max: 100, hint: 'Platí pro nová nabíjení. U starších ji změníš v detailu → Upravit.' }),
      h('div', { class: 'grid2' },
        numField('Kapacita baterie', 'capacity', { unit: 'kWh', d: 1, min: 10, max: 200 }),
        numField('Nabíjecí limit', 'target', { unit: '%', d: 0, min: 50, max: 100 })),
      numField('Obvyklý výkon', 'kw', { unit: 'kW', d: 1, min: 1, max: 22 })),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Koeficient ztrát')),
      h('p', { class: 'small' }, 'Část elektřiny ze zásuvky se při nabíjení ztratí (nabíječka v autě, elektronika, v zimě ohřev baterie). Proto: ze sítě = nabito % × kapacita × koeficient.'),
      h('div', { class: 'grid2' },
        numField('Léto', 'coefSummer', { d: 2, min: 1, max: 2 }),
        numField('Zima', 'coefWinter', { d: 2, min: 1, max: 2 })),
      h('div', { class: 'field' }, h('span', { class: 'muted' }, 'Zimní měsíce'), monthsBox),
      h('p', { class: 'hint' }, 'Měření přímo na Kona Electric 64 kWh (Univerzita Pardubice, 2023) vyšlo na průměrnou účinnost AC nabíjení 85 % = koeficient ≈ 1,18. Při pomalém 3,5 kW nabíjení a v zimě bývají ztráty vyšší. Nejpřesnější je pár nabíjení změřit měřákem v zásuvce a zapsat do detailu – aplikace spočítá skutečný koeficient.'),
      (cal.zima || cal.leto) ? h('div', { class: 'btn-row' }, ['zima', 'leto'].map((k) => cal[k] ? h('button', {
        class: 'btn small', onclick: async () => { await D.saveSettings({ [k === 'zima' ? 'coefWinter' : 'coefSummer']: round(cal[k].coef, 2) }); toast('Koeficient upraven.', { kind: 'ok' }); render(); },
      }, `${cap(SEASON_LABEL[k])}: použít naměřený ${nf(cal[k].coef, 2)}`) : null)) : null),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Čtení údajů z fotky')),
      provSeg, keyBox,
      h('div', { class: 'btn-row' }, h('button', { class: 'btn', onclick: testReader }, 'Vyzkoušet na ukázkové fotce')),
      testOut),

    h('section', { class: 'section', id: 'zaloha' },
      h('div', { class: 'section-head' }, h('h2', null, 'Záloha na Google Disk')),
      h('p', { class: 'small' }, 'Data jsou vždy v telefonu a aplikace jede i bez internetu. Záloha posílá kopii (data, tabulku a fotky) do tvého Google Disku přes malý skript. Návod: ',
        h('a', { href: `${REPO}/blob/main/NASTAVENI.md#3-záloha-na-google-disk-10-minut`, target: '_blank', rel: 'noopener' }, 'NASTAVENI.md'), '.'),
      h('label', { class: 'check' }, enabled, h('span', null, 'Zálohovat na Google Disk')),
      h('label', { class: 'field' }, h('span', null, 'Adresa skriptu (…/exec)'), urlInp),
      h('label', { class: 'field' }, h('span', null, 'Heslo (TOKEN)'), tokInp),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: testSync }, 'Otestovat spojení'),
        h('button', { class: 'btn', onclick: () => doSync(false) }, 'Zálohovat teď'),
        h('button', { class: 'btn ghost', onclick: async () => { if (await confirmDialog('Obnovit z Disku?', 'Stáhne zálohu a sloučí ji s daty v telefonu (novější změna vyhrává). Nic se nesmaže.', 'Obnovit', 'Zpět')) doSync(true); } }, 'Obnovit z Disku')),
      syncOut,
      h('p', { class: 'small muted' },
        st.lastOk ? `Poslední záloha: ${fmt.dt(st.lastOk)}. ` : 'Zatím nezálohováno. ',
        st.lastErr ? `Poslední chyba: ${st.lastErr} ` : '',
        st.folderUrl ? h('a', { href: st.folderUrl, target: '_blank', rel: 'noopener' }, 'Složka') : null,
        st.sheetUrl ? [' · ', h('a', { href: st.sheetUrl, target: '_blank', rel: 'noopener' }, 'Tabulka')] : null)),

    h('section', { class: 'section' },
      h('div', { class: 'section-head' }, h('h2', null, 'Data v telefonu')),
      h('p', { class: 'small' }, `${count} ${fmt.plural(count, 'nabíjení', 'nabíjení', 'nabíjení')} · ${info.photos} ${fmt.plural(info.photos, 'fotka', 'fotky', 'fotek')} (${nf(info.bytes / 1048576, 1)} MB).`),
      h('div', { class: 'btn-row' },
        h('button', { class: 'btn', onclick: async () => downloadBlob(`nabijeni-zaloha-${isoDay(new Date())}.json`, new Blob([JSON.stringify(await D.exportJson(), null, 1)], { type: 'application/json' })) }, 'Stáhnout zálohu (.json)'),
        h('button', { class: 'btn ghost', onclick: () => fileInp.click() }, 'Nahrát zálohu'),
        fileInp),
      h('button', { class: 'btn ghost small danger', onclick: async () => {
        if (!(await confirmDialog('Smazat všechna data v telefonu?', 'Smaže nabíjení i fotky v tomto telefonu. Záloha na Disku zůstane, ale při příští záloze se mohou smazané záznamy znovu stáhnout.', 'Smazat vše', 'Zpět'))) return;
        if (!(await confirmDialog('Opravdu?', 'Tohle nejde vrátit.', 'Ano, smazat', 'Ne'))) return;
        await D.wipeAll(); toast('Smazáno.'); render();
      } }, 'Smazat vše v telefonu')),

    h('p', { class: 'small muted about' }, `Nabíjení ${VERSION} · `, h('a', { href: REPO, target: '_blank', rel: 'noopener' }, 'GitHub'), ' · Design by Tadeáš'),
  ];
}

// ---------------------------------------------------------------- start
async function init() {
  shell();
  D.onChange(async (what) => {
    if (syncConfigured(await D.getSettings())) markDirty();
    updatePill();
    if (what === 'sessions' && /^#\/?$|^#\/prehled$/.test(location.hash || '#/') && !document.querySelector('.overlay')) render();
  });
  onSyncStatus((st, busy) => updatePill(st, busy));
  window.addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && /^#\/?$|^#\/n\//.test(location.hash || '#/')) render(); });
  window.addEventListener('online', () => { updatePill(); scheduleSync(500); });
  window.addEventListener('offline', () => updatePill());
  await render();
  updatePill();
  D.askPersistentStorage();
  scheduleSync(1500);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init().catch((e) => {
  console.error(e);
  mount(app, h('div', { class: 'content' }, h('h1', null, 'Aplikace se nespustila'), h('p', null, String(e.message || e))));
});
