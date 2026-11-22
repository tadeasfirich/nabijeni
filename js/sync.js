// Záloha na Google Disk přes tvůj Google Apps Script (apps-script/Code.gs).
// Telefon je hlavní; Disk je kopie. Při synchronizaci: stáhni zálohu → slouč (novější změna vyhrává)
// → nahraj chybějící fotky → ulož celek zpět (JSON + tabulka v Google Sheets).

import { getSettings, saveSettings, allSessionsRaw, putSessionRaw, getPhoto, getKv, setKv, importSessions } from './data.js';
import { blobToBase64 } from './photo.js';
import { sheetRows } from './report.js';

let timer = null;
let busy = false;
const statusListeners = new Set();
export const onSyncStatus = (fn) => statusListeners.add(fn);

export async function syncState() {
  return (await getKv('syncState')) || { lastOk: null, lastErr: null, dirty: false };
}
async function setState(patch) {
  const next = { ...(await syncState()), ...patch };
  await setKv('syncState', next);
  statusListeners.forEach((fn) => fn(next, busy));
  return next;
}

async function call(settings, payload, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // text/plain = „jednoduchý“ požadavek bez CORS preflightu, který Apps Script neumí
    const res = await fetch(settings.sync.url.trim(), {
      method: 'POST',
      body: JSON.stringify({ token: settings.sync.token, ...payload }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    const text = await res.text();
    let j;
    try { j = JSON.parse(text); } catch {
      throw new Error(/<html/i.test(text)
        ? 'Skript vrátil stránku místo dat – je nasazený jako webová aplikace s přístupem „Kdokoli“?'
        : 'Neplatná odpověď skriptu.');
    }
    if (!j.ok) throw new Error(j.error || 'Skript vrátil chybu.');
    return j;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Google Disk neodpovídá.');
    if (e instanceof TypeError) throw new Error('Nepodařilo se spojit s Google Diskem.');
    throw e;
  } finally { clearTimeout(t); }
}

export function syncConfigured(s) {
  return !!(s.sync?.enabled && s.sync?.url && s.sync?.token);
}

export async function markDirty() {
  await setState({ dirty: true });
  scheduleSync();
}

export function scheduleSync(delay = 2000) {
  clearTimeout(timer);
  timer = setTimeout(() => { syncNow().catch(() => {}); }, delay);
}

export async function testConnection(url, token) {
  return call({ sync: { url, token } }, { action: 'ping' }, 30000);
}

const PART_LABEL = { start: 'start', end: 'konec' };
function photoName(sess, part) {
  const d = new Date(sess[part].t);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())} ${PART_LABEL[part]} ${sess[part].soc ?? ''}%.jpg`;
}

// pull = true i při prvním spojení, ať se data z jiného telefonu nepřepíšou
export async function syncNow({ restore = false } = {}) {
  const settings = await getSettings();
  if (!syncConfigured(settings)) return { skipped: true };
  if (!navigator.onLine) { await setState({ lastErr: 'Offline – odešle se, až bude internet.' }); return { offline: true }; }
  if (busy) return { busy: true };
  busy = true;
  await setState({});
  try {
    // 1) stáhnout a sloučit
    const pulled = await call(settings, { action: 'pull' });
    const remote = pulled.data || null;
    if (remote?.sessions?.length) await importSessions(remote.sessions);
    if (restore && remote?.settings) {
      const { reader, sync, ...pub } = remote.settings;
      await saveSettings(pub);
    }
    // 2) fotky, které na Disku ještě nejsou
    const sessions = await allSessionsRaw();
    let photos = 0;
    for (const s of sessions) {
      if (s.deleted) continue;
      for (const part of ['start', 'end']) {
        const p = s[part];
        if (!p?.photo || p.photoDrive) continue;
        const ph = await getPhoto(p.photo);
        if (!ph?.blob) continue;
        const r = await call(settings, { action: 'photo', name: photoName(s, part), b64: await blobToBase64(ph.blob) }, 90000);
        p.photoDrive = r.id;
        s.updatedAt = new Date().toISOString();
        await putSessionRaw(s);
        photos++;
      }
    }
    // 3) uložit celek
    const fresh = (await allSessionsRaw());
    const { reader, sync, ...pub } = await getSettings();
    const pushed = await call(settings, {
      action: 'push',
      data: { app: 'nabijeni', version: 1, savedAt: new Date().toISOString(), settings: pub, sessions: fresh },
      rows: sheetRows(fresh.filter((s) => !s.deleted)),
    });
    await setState({ lastOk: new Date().toISOString(), lastErr: null, dirty: false, folderUrl: pushed.folderUrl || null, sheetUrl: pushed.sheetUrl || null });
    return { ok: true, photos };
  } catch (e) {
    await setState({ lastErr: e.message });
    throw e;
  } finally {
    busy = false;
    statusListeners.forEach(async (fn) => fn(await syncState(), busy));
  }
}

export const isBusy = () => busy;
