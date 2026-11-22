// Zápis Excelu (.xlsx) bez knihoven – převzato z aplikace Inventura a rozšířeno
// o desetinná čísla, datum s časem a vzorce (součty). Funguje offline.

import { zip } from './zip.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// Datum → sériové číslo Excelu v místním čase (Excel časová pásma nezná).
export function toSerial(v) {
  const d = new Date(v);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()) / 86400000 + 25569;
}


const esc = (s) => String(s)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colName(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// styly buněk (index do cellXfs)
export const S = { normal: 0, head: 1, bold: 2, title: 3, money: 4, muted: 5, wrap: 6, int: 7, dec2: 8, dt: 9, date: 10, moneyB: 11, dec2B: 12, koef: 13, intB: 14 };

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;Kč&quot;"/><numFmt numFmtId="165" formatCode="d.m.yyyy\\ h:mm"/><numFmt numFmtId="166" formatCode="d.m.yyyy"/><numFmt numFmtId="167" formatCode="0.00#"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="15"/><color rgb="FF14171F"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF5A6172"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDFE5F3"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="FF14171F"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="left"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function sheetName(name, used) {
  let n = String(name).replace(/[\[\]:*?/\\]/g, '-').slice(0, 31) || 'List';
  let k = 2;
  while (used.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${k++}`;
  used.add(n.toLowerCase());
  return n;
}

// Buňka: hodnota, nebo { v, s } se stylem z S.
// Buňka se vzorcem: { f: 'SUM(A2:A9)', v: předpočítaná hodnota, s }.
function cellXml(ref, cell) {
  let v = cell, s = 0;
  if (cell && typeof cell === 'object' && !(cell instanceof Date)) { v = cell.v; s = cell.s || 0; }
  if (cell && typeof cell === 'object' && cell.f) {
    const val = typeof v === 'number' && Number.isFinite(v) ? `<v>${v}</v>` : '';
    return `<c r="${ref}"${s ? ` s="${s}"` : ''}><f>${esc(cell.f)}</f>${val}</c>`;
  }
  if (v instanceof Date) v = toSerial(v);
  if (v === null || v === undefined || v === '') return s ? `<c r="${ref}" s="${s}"/>` : '';
  if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${s ? ` s="${s}"` : ''}><v>${v}</v></c>`;
  if (typeof v === 'boolean') return `<c r="${ref}" t="b"${s ? ` s="${s}"` : ''}><v>${v ? 1 : 0}</v></c>`;
  return `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
}

// sheets: [{ name, widths: [číslo,…], rows: [[buňka,…],…], headerRow?: index řádku s hlavičkou tabulky }]
export function writeWorkbook(sheets) {
  const used = new Set();
  const names = sheets.map((s) => sheetName(s.name, used));
  const files = [];
  const defined = [];

  sheets.forEach((sh, i) => {
    const rows = sh.rows || [];
    const maxCols = Math.max(1, sh.widths ? sh.widths.length : 0, ...rows.map((r) => r.length));
    const hr = sh.headerRow;
    const lastRow = Math.max(1, rows.length);
    const pane = hr !== undefined && hr !== null
      ? `<pane ySplit="${hr + 1}" topLeftCell="A${hr + 2}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${hr + 2}" sqref="A${hr + 2}"/>`
      : '';
    const cols = (sh.widths || []).map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('');
    const data = rows.map((r, ri) => {
      const cells = (r || []).map((c, ci) => cellXml(`${colName(ci)}${ri + 1}`, c)).join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    }).join('');
    let filter = '';
    if (hr !== undefined && hr !== null && rows.length > hr + 1) {
      const ref = `A${hr + 1}:${colName(maxCols - 1)}${lastRow}`;
      filter = `<autoFilter ref="${ref}"/>`;
      defined.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${names[i].replace(/'/g, "''")}'!$A$${hr + 1}:$${colName(maxCols - 1)}$${lastRow}</definedName>`);
    }
    files.push({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<dimension ref="A1:${colName(maxCols - 1)}${lastRow}"/>
<sheetViews><sheetView workbookViewId="0"${i === 0 ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${data}</sheetData>
${filter}
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`,
    });
  });

  const wb = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView activeTab="0"/></bookViews>
<sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
${defined.length ? `<definedNames>${defined.join('')}</definedNames>` : ''}
</workbook>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}
<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:creator>Nabíjení</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified>
</cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Nabíjení</Application></Properties>`;

  return zip([
    { name: '[Content_Types].xml', data: ct },
    { name: '_rels/.rels', data: rootRels },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    { name: 'xl/workbook.xml', data: wb },
    { name: 'xl/_rels/workbook.xml.rels', data: wbRels },
    { name: 'xl/styles.xml', data: STYLES },
    ...files,
  ], XLSX_MIME);
}
