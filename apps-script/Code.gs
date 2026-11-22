/**
 * Nabíjení – záloha na Google Disk.
 * Vlož celý tento soubor na script.google.com (Nový projekt), změň TOKEN a nasaď jako webovou aplikaci
 * (Spustit jako: Já, Přístup: Kdokoli). Postup krok za krokem je v NASTAVENI.md.
 *
 * Na Disku vznikne složka „Nabíjení Kony“:
 *   nabijeni-data.json        – kompletní data aplikace (z toho se obnovuje)
 *   Nabíjení – evidence       – Google tabulka se všemi nabíjeními (jen pro čtení, přepisuje se)
 *   Fotky/                    – fotky palubní desky
 *   Zálohy/                   – měsíční kopie dat (pro jistotu)
 */

// ▼▼▼ ZMĚŇ: vymysli si dlouhé heslo a stejné zadej v aplikaci (Nastavení → Záloha na Google Disk)
const TOKEN = 'ZMEN-MĚ-na-dlouhe-heslo';
// ▲▲▲

const FOLDER_NAME = 'Nabíjení Kony';
const DATA_FILE = 'nabijeni-data.json';
const SHEET_NAME = 'Nabíjení – evidence';

function doGet() {
  return out({ ok: true, app: 'nabijeni', info: 'Skript běží. Aplikace posílá data metodou POST.' });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out({ ok: false, error: 'Neplatný požadavek.' });
  }
  if (!TOKEN || TOKEN.indexOf('ZMEN') === 0) return out({ ok: false, error: 'Ve skriptu není nastavené heslo (TOKEN).' });
  if (req.token !== TOKEN) return out({ ok: false, error: 'Špatné heslo (TOKEN) – musí být stejné ve skriptu i v aplikaci.' });

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return out({ ok: false, error: 'Disk je zaneprázdněný, zkus to za chvíli.' });
  }
  try {
    const folder = mainFolder();
    switch (req.action) {
      case 'ping':
        return out({ ok: true, folderUrl: folder.getUrl() });
      case 'pull':
        return out({ ok: true, data: readData(folder) });
      case 'push': {
        writeData(folder, req.data);
        const sheetUrl = writeSheet(folder, req.rows || []);
        return out({ ok: true, savedAt: new Date().toISOString(), folderUrl: folder.getUrl(), sheetUrl: sheetUrl });
      }
      case 'photo':
        return out({ ok: true, id: savePhoto(folder, req.name, req.b64) });
      default:
        return out({ ok: false, error: 'Neznámá akce: ' + req.action });
    }
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function mainFolder() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      if (!f.isTrashed()) return f;
    } catch (err) { /* složka smazaná → vytvoř novou */ }
  }
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function subFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function findFile(folder, name) {
  const it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}

function readData(folder) {
  const f = findFile(folder, DATA_FILE);
  if (!f) return null;
  return JSON.parse(f.getBlob().getDataAsString('UTF-8'));
}

function writeData(folder, data) {
  if (!data || !Array.isArray(data.sessions)) throw new Error('Chybí data.');
  const text = JSON.stringify(data);
  const f = findFile(folder, DATA_FILE);
  if (f) f.setContent(text); else folder.createFile(DATA_FILE, text, 'application/json');
  // jedna kopie za měsíc (přepisuje se během měsíce)
  const backups = subFolder(folder, 'Zálohy');
  const name = 'nabijeni-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM') + '.json';
  const b = findFile(backups, name);
  if (b) b.setContent(text); else backups.createFile(name, text, 'application/json');
}

function writeSheet(folder, rows) {
  const props = PropertiesService.getScriptProperties();
  let ss = null;
  const id = props.getProperty('SHEET_ID');
  if (id) {
    try { ss = SpreadsheetApp.openById(id); if (DriveApp.getFileById(id).isTrashed()) ss = null; } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(SHEET_NAME);
    const file = DriveApp.getFileById(ss.getId());
    file.moveTo(folder);
    props.setProperty('SHEET_ID', ss.getId());
  }
  const sh = ss.getSheets()[0];
  sh.setName('Nabíjení');
  sh.clear();
  if (!rows.length) return ss.getUrl();
  const width = rows[0].length;
  const isoRe = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;
  const values = rows.map(function (r, i) {
    const row = r.slice(0, width);
    while (row.length < width) row.push('');
    return i === 0 ? row : row.map(function (v) { return typeof v === 'string' && isoRe.test(v) ? new Date(v) : v; });
  });
  sh.getRange(1, 1, values.length, width).setValues(values);
  sh.getRange(1, 1, 1, width).setFontWeight('bold').setBackground('#dfe5f3');
  sh.setFrozenRows(1);
  if (values.length > 1) {
    sh.getRange(2, 1, values.length - 1, 2).setNumberFormat('d.m.yyyy h:mm');
    sh.getRange(2, 6, values.length - 1, 1).setNumberFormat('0.00');   // do baterie
    sh.getRange(2, 9, values.length - 1, 1).setNumberFormat('0.00');   // ze sítě
    sh.getRange(2, 10, values.length - 1, 2).setNumberFormat('#,##0.00 "Kč"');
    // řádek se součty
    const last = values.length;
    const sumRow = last + 1;
    sh.getRange(sumRow, 1).setValue('Celkem').setFontWeight('bold');
    sh.getRange(sumRow, 6).setFormula('=SUM(F2:F' + last + ')').setNumberFormat('0.00').setFontWeight('bold');
    sh.getRange(sumRow, 9).setFormula('=SUM(I2:I' + last + ')').setNumberFormat('0.00').setFontWeight('bold');
    sh.getRange(sumRow, 11).setFormula('=SUM(K2:K' + last + ')').setNumberFormat('#,##0.00 "Kč"').setFontWeight('bold');
  }
  sh.autoResizeColumns(1, width);
  return ss.getUrl();
}

function savePhoto(folder, name, b64) {
  if (!name || !b64) throw new Error('Chybí fotka.');
  const photos = subFolder(folder, 'Fotky');
  const existing = findFile(photos, name);
  if (existing) return existing.getId();
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', name);
  return photos.createFile(blob).getId();
}

/** Spusť jednou ručně (▶ Spustit) – vytvoří složku a odsouhlasíš přístup k Disku. */
function setup() {
  const folder = mainFolder();
  Logger.log('Složka: ' + folder.getUrl());
}
