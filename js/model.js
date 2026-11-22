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
export function estimatedEnd(sess) {
  const st = sess?.start;
  if (!st || num(st.remainMin) === null) return null;
  return new Date(Date.parse(st.t) + num(st.remainMin) * 60000).toISOString();
}

// Hlavní výpočet jednoho nabíjení.
export function calc(sess) {
  const st = sess?.start;
  const en = sess?.end;
  const out = { dSoc: null, battery: null, grid: null, cost: null, hours: null, timeKwh: null, coef: num(sess?.coef), measured: false, realCoef: null };
  if (!st) return out;
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
    t.battery += c.battery;
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
