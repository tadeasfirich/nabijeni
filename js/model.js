// Výpočty nabíjení – čisté funkce bez prohlížeče (dají se testovat i v Node).
//
// Ze sítě (kWh) = nabito % / 100 × kapacita baterie × koeficient ztrát
// Částka (Kč)   = ze sítě × cena za kWh
// Když je u nabíjení zapsaný údaj z elektroměru, použije se ten a koeficient se z něj dopočítá.

export const DEFAULTS = {
  car: 'Hyundai Kona Electric 2021',
  capacity: 64,          // využitelná kapacita baterie, kWh
  target: 90,            // nabíjecí limit v autě, %
  kw: 3.5,               // obvyklý nabíjecí výkon
  price: 6.7,            // Kč za kWh
  coefSummer: 1.18,      // ztráty při nabíjení 3,5 kW – léto
  coefWinter: 1.25,      // zima (ohřev baterie, delší nabíjení)
  winterMonths: [11, 12, 1, 2, 3],
  reader: { provider: 'gemini', geminiKey: '', geminiModel: 'gemini-flash-latest', claudeKey: '', claudeModel: 'claude-haiku-5-5' },
  sync: { enabled: false, url: '', token: '' },
};

export function withDefaults(saved) {
  const s = saved || {};
  return {
    ...DEFAULTS, ...s,
    reader: { ...DEFAULTS.reader, ...(s.reader || {}) },
    sync: { ...DEFAULTS.sync, ...(s.sync || {}) },
  };
}

export const round = (x, d = 2) => (x === null || x === undefined || !Number.isFinite(x)) ? null : Math.round(x * 10 ** d) / 10 ** d;

export function seasonFor(date, settings) {
  const m = new Date(date).getMonth() + 1;
  return (settings.winterMonths || DEFAULTS.winterMonths).includes(m) ? 'zima' : 'leto';
}
export const coefFor = (season, settings) => (season === 'zima' ? settings.coefWinter : settings.coefSummer);
export const SEASON_LABEL = { zima: 'zima', leto: 'léto' };

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// Odhad, kdy auto dojede do limitu (z údaje „Do dobití zbývá“ na fotce startu).
// Když údaj chybí, dopočítá se: (cíl − start) % × kapacita × koeficient ÷ výkon.
export function estimatedEnd(sess) {
  const st = sess?.start;
  if (!st || !st.t) return null;
  let min = num(st.remainMin);
  if (min === null) {
    const target = num(sess.target) ?? num(st.target) ?? DEFAULTS.target;
    const kw = num(st.kw) ?? num(sess.kw) ?? DEFAULTS.kw;
    if (num(st.soc) === null || !kw) return null;
    const kwh = Math.max(0, target - num(st.soc)) / 100 * (num(sess.capacity) ?? DEFAULTS.capacity) * (num(sess.coef) ?? 1.2);
    min = Math.round(kwh / kw * 60);
  }
  return new Date(Date.parse(st.t) + min * 60000).toISOString();
}

// Nabíjení, jejichž odhadovaný konec už minul → mají se uzavřít jako dobito do limitu.
export function overdue(list, now = Date.now()) {
  return list.filter((s) => isRunning(s) && estimatedEnd(s) && Date.parse(estimatedEnd(s)) <= now);
}

// Hlavní výpočet jednoho nabíjení.
export function calc(sess) {
  const st = sess?.start;
  const en = sess?.end;
  const out = { dSoc: null, battery: null, grid: null, cost: null, hours: null, timeKwh: null, coef: num(sess?.coef), measured: false, realCoef: null };
  if (!st) return out;
  // import ze staré tabulky: kWh jsou dané (hodiny × výkon), procenta baterie nejsou
  const imp = num(sess?.importKwh);
  if (imp !== null) {
    out.imported = true;
    out.grid = round(imp, 2);
    out.cost = round(imp * (num(sess.price) ?? 0), 2);
    out.hours = num(sess.hours);
    return out;
  }
  if (en && num(en.soc) !== null && num(st.soc) !== null) {
    out.dSoc = Math.max(0, num(en.soc) - num(st.soc));
    out.battery = round(out.dSoc / 100 * (num(sess.capacity) ?? DEFAULTS.capacity), 2);
    const meter = num(sess.meterKwh);
    if (meter !== null && meter > 0) {
      out.grid = round(meter, 2);
      out.measured = true;
      out.realCoef = out.battery > 0 ? round(meter / out.battery, 3) : null;
    } else {
      out.grid = round(out.battery * (out.coef ?? 1), 2);
    }
    out.cost = round(out.grid * (num(sess.price) ?? 0), 2);
  }
  if (en && en.t) {
    out.hours = round((Date.parse(en.t) - Date.parse(st.t)) / 3600000, 2);
    if (num(sess.kw) && out.hours > 0) out.timeKwh = round(out.hours * num(sess.kw), 2);
  }
  return out;
}

export function sumUp(list) {
  const t = { count: 0, battery: 0, grid: 0, cost: 0, hours: 0, measured: 0 };
  for (const s of list) {
    const c = calc(s);
    if (c.grid === null) continue;
    t.count++;
    t.battery += c.battery || 0;
    if (c.imported) t.imported = (t.imported || 0) + 1;
    t.grid += c.grid;
    t.cost += c.cost;
    t.hours += c.hours || 0;
    if (c.measured) t.measured++;
  }
  for (const k of ['battery', 'grid', 'cost', 'hours']) t[k] = round(t[k], 2);
  return t;
}

// Skutečný koeficient z nabíjení, u kterých je zapsaný elektroměr (vážený průměr).
export function calibration(list) {
  const r = {};
  for (const season of ['zima', 'leto']) {
    let b = 0, m = 0, n = 0;
    for (const s of list) {
      const c = calc(s);
      if (!c.measured || !c.battery || s.season !== season) continue;
      b += c.battery; m += c.grid; n++;
    }
    r[season] = n ? { n, coef: round(m / b, 3) } : null;
  }
  return r;
}

export const isDone = (s) => s && s.status === 'done' && !s.deleted;
export const isRunning = (s) => s && s.status === 'running' && !s.deleted;

// Kontrola hodnot (z fotky i ruční). Vrací { errors: [], warnings: [] }.
export function check(kind, v, ctx = {}) {
  const errors = [];
  const warnings = [];
  const soc = num(v.soc);
  if (soc === null) errors.push('Chybí stav baterie (%).');
  else if (soc < 0 || soc > 100) errors.push('Stav baterie musí být 0–100 %.');
  if (kind === 'end' && ctx.startSoc !== undefined && soc !== null) {
    if (soc < ctx.startSoc) errors.push(`Konec (${soc} %) je méně než start (${ctx.startSoc} %).`);
    else if (soc === ctx.startSoc) warnings.push('Baterie se nenabila – nabito 0 %.');
  }
  const odo = num(v.odo);
  if (odo !== null && ctx.lastOdo !== undefined && ctx.lastOdo !== null) {
    if (odo < ctx.lastOdo) warnings.push(`Tachometr (${odo} km) je menší než minule (${ctx.lastOdo} km).`);
    else if (odo - ctx.lastOdo > 3000) warnings.push(`Od minula přibylo ${odo - ctx.lastOdo} km – je tachometr správně?`);
  }
  if (!v.t) errors.push('Chybí čas.');
  if (v.t && ctx.startT && Date.parse(v.t) < Date.parse(ctx.startT)) errors.push('Konec je dřív než začátek nabíjení.');
  if (v.t && Date.parse(v.t) > Date.now() + 10 * 60000) warnings.push('Čas je v budoucnosti.');
  return { errors, warnings };
}

// Hodnoty přečtené z fotky → očištěné a ověřené rozsahy (nesmyslné hodnoty zahodí).
export function sanitizeRead(r) {
  const out = {};
  const int = (x) => { const n = num(typeof x === 'string' ? x.replace(/[^\d.,-]/g, '').replace(',', '.') : x); return n === null ? null : Math.round(n); };
  const soc = int(r?.soc);
  if (soc !== null && soc >= 0 && soc <= 100) out.soc = soc;
  const target = int(r?.target);
  if (target !== null && target >= 50 && target <= 100) out.target = target;
  const rem = int(r?.remaining_min);
  if (rem !== null && rem >= 0 && rem <= 72 * 60) out.remainMin = rem;
  const kw = num(typeof r?.kw === 'string' ? r.kw.replace(',', '.') : r?.kw);
  if (kw !== null && kw > 0.3 && kw <= 22) out.kw = round(kw, 1);
  const odo = int(r?.odometer);
  if (odo !== null && odo > 0 && odo < 2000000) out.odo = odo;
  return out;
}

export function monthKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Nabíjení v období [from, to] podle data začátku (to včetně celého dne).
export function inRange(list, from, to) {
  const a = from ? new Date(from + 'T00:00:00').getTime() : -Infinity;
  const b = to ? new Date(to + 'T23:59:59.999').getTime() : Infinity;
  return list.filter((s) => { const t = Date.parse(s.start?.t); return t >= a && t <= b; });
}

export function monthRange(key) {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
}

// Sloučení se zálohou z Disku: u každého záznamu vyhrává novější změna (i smazání).
export function mergeSessions(local, remote) {
  const map = new Map(local.map((s) => [s.id, s]));
  const changed = [];
  for (const r of remote || []) {
    const l = map.get(r.id);
    if (!l || Date.parse(r.updatedAt || 0) > Date.parse(l.updatedAt || 0)) {
      // fotku v telefonu si necháme, i když přijde verze z Disku
      if (l) for (const part of ['start', 'end']) {
        if (l[part]?.photo && r[part] && !r[part].photo) r[part].photo = l[part].photo;
      }
      map.set(r.id, r);
      changed.push(r);
    }
  }
  return { all: [...map.values()], changed };
}

// ---------------------------------------------------------------- import ze staré tabulky
const p2 = (n) => String(n).padStart(2, '0');
export function parseCz(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[\s\u00a0]/g, '').replace(/kč|kwh|kw|h$/gi, '').replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// „8.11“, „8. 11.“, „9.11.2026“, „2026-11-08“ → '2026-11-08'. Bez roku: letošní, pokud nevychází do budoucna.
export function parseDay(raw, now = new Date()) {
  const s = String(raw ?? '').trim();
  let y = null, m, d, mm;
  if ((mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +mm[1]; m = +mm[2]; d = +mm[3]; }
  else if ((mm = s.match(/^(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(\d{4}))?\.?$/))) { d = +mm[1]; m = +mm[2]; y = mm[3] ? +mm[3] : null; }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (!y) {
    y = now.getFullYear();
    if (new Date(y, m - 1, d).getTime() > now.getTime() + 86400000) y--;
  }
  const dt = new Date(y, m - 1, d);
  if (dt.getMonth() !== m - 1) return null;
  return `${y}-${p2(m)}-${p2(d)}`;
}

// Vložený text (zkopírované buňky z Google Tabulek/Excelu). Sloupce: datum, doba h, kWh, Kč – další se ignorují.
export function parseTableText(text, now = new Date()) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.includes('\t') ? line.split('\t') : line.includes(';') ? line.split(';') : line.trim().split(/\s{2,}|\s(?=\d)/);
    const day = parseDay(cells[0], now);
    if (!day) continue;
    const nums = cells.slice(1).map(parseCz).filter((x) => x !== null);
    rows.push({ day, hours: nums[0] ?? null, kwh: nums[1] ?? null, cost: nums[2] ?? null });
  }
  return rows;
}

// Doplní chybějící hodnoty: kWh = hodiny × výkon, cena za kWh = Kč ÷ kWh (jinak z nastavení).
export function normalizeImport(rows, { kw, price }) {
  return rows.map((r) => {
    let hours = r.hours, kwh = r.kwh;
    if (kwh === null && hours !== null) kwh = hours * kw;
    if (hours === null && kwh !== null && kw) hours = kwh / kw;
    const p = r.cost !== null && kwh ? r.cost / kwh : price;
    return { day: r.day, hours: round(hours, 2), kwh: round(kwh, 3), price: round(p, 2), kw: hours && kwh ? round(kwh / hours, 2) : kw };
  }).filter((r) => r.kwh !== null && r.kwh > 0);
}

const localDay = (iso) => { const d = new Date(iso); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
// Stejný den začátku = už je v aplikaci.
export function findDuplicate(row, sessions) {
  return sessions.find((s) => !s.deleted && s.start?.t && localDay(s.start.t) === row.day) || null;
}

export function importSession(row) {
  const [y, m, d] = row.day.split('-').map(Number);
  const start = new Date(y, m - 1, d, 18, 0);
  const end = new Date(start.getTime() + (row.hours || 0) * 3600000);
  return {
    source: 'import', status: 'done', approxTime: true,
    start: { t: start.toISOString(), soc: null },
    end: { t: end.toISOString(), soc: null, mode: 'import' },
    importKwh: row.kwh, hours: row.hours, kw: row.kw, price: row.price,
    coef: null, season: null, capacity: DEFAULTS.capacity, note: 'import z tabulky',
  };
}
