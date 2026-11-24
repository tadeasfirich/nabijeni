// Čtení údajů z fotky palubní desky přes AI (Gemini – zdarma, nebo Claude).
// Offline OCR (Tesseract) jsme testovali na skutečných fotkách: % baterie přečetl správně jen u 2–3 fotek ze 6,
// proto se čte přes AI. Bez klíče nebo bez internetu se údaje vyplní ručně.

import { blobToBase64 } from './photo.js';
import { sanitizeRead, parseDay, parseCz } from './model.js';

export const PROMPT = `Na fotce je přístrojová deska elektromobilu Hyundai Kona Electric během nabíjení (český text „Do dobití zbývá“).
Přečti a vrať POUZE JSON objekt s klíči:
- "soc": aktuální stav baterie v % (velké číslo uvnitř ikony baterie; NE číslo v závorce), celé číslo
- "target": cílové nabití v % z údaje v závorce, např. „(90%)“ → 90, jinak null
- "remaining_min": zbývající čas do dobití v minutách, např. „9h 50m“ → 590, „1h 5m“ → 65, jinak null
- "kw": nabíjecí výkon v kW u ikony blesku, např. 3.5, jinak null
- "odometer": stav tachometru v km (číslo vpravo dole před „km“), celé číslo, jinak null
- "charging": true, pokud obrazovka ukazuje nabíjení, jinak false
Když si hodnotou nejsi jistý, dej null. Žádný další text.`;

export function readerReady(settings) {
  const r = settings.reader || {};
  if (r.provider === 'claude') return !!r.claudeKey;
  if (r.provider === 'gemini') return !!r.geminiKey;
  return false;
}

export function readerName(settings) {
  return settings.reader?.provider === 'claude' ? 'Claude' : 'Gemini';
}

function extractJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI nevrátila čitelný výsledek.');
  return JSON.parse(m[0]);
}

async function withTimeout(promise, ms, ctrl) {
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await promise; } finally { clearTimeout(t); }
}

// Záložní modely, když zvolený model Google zrovna nestíhá (503/429/500) nebo neexistuje (404).
export const GEMINI_FALLBACKS = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
const RETRY = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function geminiOnce(b64, model, key, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const ctrl = new AbortController();
  const res = await withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ctrl.signal,
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: prompt }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  }), 45000, ctrl);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(apiError('Gemini', res.status, j?.error?.message));
    err.status = res.status;
    throw err;
  }
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return extractJson(text);
}

// Zvolený model → 2 opakování s pauzou → záložní modely. Vrací i model, který nakonec přečetl.
async function readGemini(b64, r, onStatus, prompt = PROMPT) {
  const key = r.geminiKey.trim();
  const chosen = (r.geminiModel || GEMINI_FALLBACKS[0]).trim();
  const models = [chosen, ...GEMINI_FALLBACKS.filter((m) => m !== chosen)];
  let lastErr;
  for (const model of models) {
    for (let attempt = 0; attempt < (model === chosen ? 3 : 2); attempt++) {
      try {
        const out = await geminiOnce(b64, model, key, prompt);
        out.__model = model;
        return out;
      } catch (e) {
        lastErr = e;
        if (!RETRY.has(e.status) && e.status !== 404) throw e;   // špatný klíč apod. – nemá smysl zkoušet dál
        if (e.status === 404) break;                              // model neexistuje → hned další
        if (attempt < 2) { onStatus?.(`Google je přetížený, zkouším znovu…`); await sleep(1500 * (attempt + 1)); }
      }
    }
    onStatus?.(`Zkouším jiný model…`);
  }
  throw lastErr;
}

async function readClaude(b64, r, prompt = PROMPT) {
  const ctrl = new AbortController();
  const res = await withTimeout(fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: ctrl.signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': r.claudeKey.trim(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: (r.claudeModel || 'claude-haiku-5-5').trim(),
      max_tokens: 2000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: prompt },
      ] }],
    }),
  }), 45000, ctrl);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError('Claude', res.status, j?.error?.message));
  const text = (j.content || []).map((c) => c.text || '').join('');
  return extractJson(text);
}

function apiError(name, status, msg) {
  if (status === 400 && /api key|API_KEY/i.test(msg || '')) return `${name}: neplatný klíč. Zkontroluj ho v Nastavení.`;
  if (status === 401 || status === 403) return `${name}: klíč nefunguje (${status}). Zkontroluj ho v Nastavení.`;
  if (status === 404) return `${name}: model nenalezen – v Nastavení zkus jiný název modelu. (${msg || ''})`;
  if (status === 429) return `${name}: vyčerpaný limit, zkus to za chvíli.`;
  if (status === 503 || status === 500 || status === 502 || status === 504) return `${name} je teď přetížený (${status}) – zkus to za chvíli, nebo vyplň údaje ručně.`;
  return `${name}: chyba ${status}${msg ? ` – ${msg}` : ''}`;
}

// → { values: {soc, target, remainMin, kw, odo}, raw, charging }
export async function readPhoto(blob, settings, onStatus) {
  if (!navigator.onLine) throw new Error('Jsi offline – údaje vyplň ručně.');
  if (!readerReady(settings)) throw new Error('Čtení fotek není nastavené – přidej klíč v Nastavení.');
  const b64 = await blobToBase64(blob);
  const r = settings.reader;
  let raw;
  try {
    raw = r.provider === 'claude' ? await readClaude(b64, r) : await readGemini(b64, r, onStatus);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Čtení trvá moc dlouho – vyplň údaje ručně.');
    if (e instanceof TypeError) throw new Error('Nepodařilo se spojit s AI – vyplň údaje ručně.');
    throw e;
  }
  return { values: sanitizeRead(raw), raw, charging: raw?.charging !== false, model: raw?.__model || null };
}

export const TABLE_PROMPT = `Na obrázku je tabulka (často snímek obrazovky z Google Tabulek) s evidencí nabíjení elektromobilu.
Najdi řádky s nabíjením (sloupce typicky: Datum, doba v hodinách, Spotřeba kWh, cena v Kč). Řádky s parametry (cena za kWh, výkon) a záhlaví nevracej.
Vrať POUZE JSON: {"price_per_kwh": cena za kWh z tabulky nebo null, "rows": [{"date": "datum přesně jak je v tabulce, např. 8.11 nebo 9.11.2026", "hours": číslo nebo null, "kwh": číslo nebo null, "cost": číslo v Kč nebo null}]}.
Čísla s desetinnou čárkou převeď na tečku. Nic nevymýšlej – co nevidíš, dej null.`;

// Snímek tabulky → řádky { day, hours, kwh, cost }
export async function readTable(blob, settings, onStatus) {
  if (!navigator.onLine) throw new Error('Jsi offline – vlož řádky jako text.');
  if (!readerReady(settings)) throw new Error('Čtení obrázků není nastavené – přidej klíč v Nastavení, nebo vlož řádky jako text.');
  const b64 = await blobToBase64(blob);
  const r = settings.reader;
  let raw;
  try {
    raw = r.provider === 'claude' ? await readClaude(b64, r, TABLE_PROMPT) : await readGemini(b64, r, onStatus, TABLE_PROMPT);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Čtení trvá moc dlouho – zkus to znovu, nebo vlož řádky jako text.');
    if (e instanceof TypeError) throw new Error('Nepodařilo se spojit s AI.');
    throw e;
  }
  const rows = [];
  for (const x of raw?.rows || []) {
    const day = parseDay(x.date);
    if (!day) continue;
    rows.push({ day, hours: parseCz(x.hours), kwh: parseCz(x.kwh), cost: parseCz(x.cost) });
  }
  return { rows, price: parseCz(raw?.price_per_kwh) };
}
