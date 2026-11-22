// Data v telefonu (IndexedDB). Aplikace jede vždy odsud – Google Disk je jen záloha navíc.
// kv – nastavení a stav zálohy, sessions – nabíjení, photos – fotky palubní desky.

import { withDefaults } from './model.js';
import { uid } from './ui.js';

const DB_NAME = 'nabijeni';
const DB_VER = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const idb = {
  get: (store, key) => tx(store, 'readonly', (s) => s.get(key)),
  put: (store, value, key) => tx(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key))),
  del: (store, key) => tx(store, 'readwrite', (s) => s.delete(key)),
  all: (store) => tx(store, 'readonly', (s) => s.getAll()),
  clear: (store) => tx(store, 'readwrite', (s) => s.clear()),
};

// ---- změny → posluchači (záloha na Disk, překreslení)
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = (what) => listeners.forEach((fn) => { try { fn(what); } catch (e) { console.error(e); } });

// ---- nastavení
let settingsCache = null;
export async function getSettings() {
  if (!settingsCache) settingsCache = withDefaults(await idb.get('kv', 'settings'));
  return settingsCache;
}
export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = withDefaults({
    ...cur, ...patch,
    reader: { ...cur.reader, ...(patch.reader || {}) },
    sync: { ...cur.sync, ...(patch.sync || {}) },
  });
  next.settingsUpdatedAt = new Date().toISOString();
  await idb.put('kv', next, 'settings');
  settingsCache = next;
  changed('settings');
  return next;
}

export const getKv = (k) => idb.get('kv', k);
export const setKv = (k, v) => idb.put('kv', v, k);

// ---- nabíjení
export async function allSessionsRaw() {
  return idb.all('sessions');
}
export async function listSessions() {
  const all = await idb.all('sessions');
  return all.filter((s) => !s.deleted).sort((a, b) => Date.parse(b.start?.t || 0) - Date.parse(a.start?.t || 0));
}
export const getSession = (id) => idb.get('sessions', id);

export async function saveSession(sess, { silent = false } = {}) {
  if (!sess.id) sess.id = uid();
  if (!sess.createdAt) sess.createdAt = new Date().toISOString();
  sess.updatedAt = new Date().toISOString();
  await idb.put('sessions', sess);
  if (!silent) changed('sessions');
  return sess;
}
// bez posunu času změny (např. doplnění odkazu na fotku na Disku)
export const putSessionRaw = (sess) => idb.put('sessions', sess);

export async function deleteSession(id) {
  const s = await getSession(id);
  if (!s) return;
  // „náhrobek“, ať se smazání propíše i do zálohy na Disku
  await saveSession({ id: s.id, deleted: true, start: { t: s.start?.t }, createdAt: s.createdAt });
  for (const part of ['start', 'end']) if (s[part]?.photo) await idb.del('photos', s[part].photo);
}

export async function runningSession() {
  const all = await listSessions();
  return all.find((s) => s.status === 'running') || null;
}

// ---- fotky
export async function savePhoto(blob, meta = {}) {
  const id = uid();
  await idb.put('photos', { id, blob, type: blob.type || 'image/jpeg', size: blob.size, createdAt: new Date().toISOString(), ...meta });
  return id;
}
export const getPhoto = (id) => (id ? idb.get('photos', id) : Promise.resolve(null));

export async function storageInfo() {
  const photos = await idb.all('photos');
  const bytes = photos.reduce((s, p) => s + (p.size || 0), 0);
  return { photos: photos.length, bytes };
}

// ---- záloha do souboru a obnova
export async function exportJson() {
  const sessions = await idb.all('sessions');
  const settings = await getSettings();
  const { reader, sync, ...pub } = settings;
  return { app: 'nabijeni', version: 1, exportedAt: new Date().toISOString(), settings: pub, sessions };
}

export async function importSessions(list) {
  let n = 0;
  for (const s of list || []) {
    if (!s || !s.id) continue;
    const cur = await getSession(s.id);
    if (!cur || Date.parse(s.updatedAt || 0) > Date.parse(cur.updatedAt || 0)) {
      if (cur) for (const part of ['start', 'end']) if (cur[part]?.photo && s[part] && !s[part].photo) s[part].photo = cur[part].photo;
      await idb.put('sessions', s);
      n++;
    }
  }
  if (n) changed('sessions');
  return n;
}

export async function wipeAll() {
  await idb.clear('sessions');
  await idb.clear('photos');
  changed('sessions');
}

export async function askPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* nevadí */ }
}
