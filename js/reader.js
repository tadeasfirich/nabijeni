// Čtení údajů z fotky palubní desky přes AI (Gemini – zdarma, nebo Claude).
// Offline OCR (Tesseract) jsme testovali na skutečných fotkách: % baterie přečetl správně jen u 2–3 fotek ze 6,
// proto se čte přes AI. Bez klíče nebo bez internetu se údaje vyplní ručně.

import { blobToBase64 } from './photo.js';
import { sanitizeRead } from './model.js';

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

async function readGemini(b64, r) {
  const model = (r.geminiModel || 'gemini-flash-latest').trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(r.geminiKey.trim())}`;
  const ctrl = new AbortController();
  const res = await withTimeout(fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: ctrl.signal,
    body: JSON.stringify({
      contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: b64 } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  }), 45000, ctrl);
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(apiError('Gemini', res.status, j?.error?.message));
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  return extractJson(text);
}

async function readClaude(b64, r) {
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
      max_tokens: 300,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } },
        { type: 'text', text: PROMPT },
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
  return `${name}: chyba ${status}${msg ? ` – ${msg}` : ''}`;
}

// → { values: {soc, target, remainMin, kw, odo}, raw, charging }
export async function readPhoto(blob, settings) {
  if (!navigator.onLine) throw new Error('Jsi offline – údaje vyplň ručně.');
  if (!readerReady(settings)) throw new Error('Čtení fotek není nastavené – přidej klíč v Nastavení.');
  const b64 = await blobToBase64(blob);
  const r = settings.reader;
  let raw;
  try {
    raw = r.provider === 'claude' ? await readClaude(b64, r) : await readGemini(b64, r);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Čtení trvá moc dlouho – vyplň údaje ručně.');
    if (e instanceof TypeError) throw new Error('Nepodařilo se spojit s AI – vyplň údaje ručně.');
    throw e;
  }
  return { values: sanitizeRead(raw), raw, charging: raw?.charging !== false };
}
