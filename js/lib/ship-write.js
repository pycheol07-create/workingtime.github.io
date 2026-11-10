// === js/lib/ship-write.js ===
// 플랫폼 출고 결과 파일 쓰기 — 서식 엑셀은 템플릿 zip 을 JSZip 으로 열어 시트별 sheetData 만 바꾼다(1단계 시제품으로 확정, 2026-11-10).
//   조건부서식·유효성·이름 정의·styles·병합 XML 은 원본 그대로 둔다(ExcelJS 는 duplicateValues·containsText 를 잃어 쓰지 않음).
//   Python 판(openpyxl load → save)과 같게 하려고:
//     · 남기는 행(머리글)은 원본 XML 그대로, 그 아래는 '값만 비움'(칸 서식 s 는 남김) 또는 '행째 지움'(시트1 8행 아래 — 새 칸 서식 없음)
//     · 새 글자는 inlineStr, '=' 로 시작하는 2자 이상 글자는 수식(openpyxl 동작), 제어 문자는 멈춤(openpyxl IllegalCharacterError)
//     · calcChain·미리보기 그림(thumbnail)·프린터 설정(printerSettings — 프린터 이름이 들어 있을 수 있음) 제거, 열 때 다시 계산(fullCalcOnLoad)
//     · 아무 칸도 쓰지 않게 된 공유 문자열(sharedStrings)은 뺀다 — 지운 옛 마스터 글이 파일 안에 남지 않게(웹판에서 더함)
//   재고출고용 .xls(biff8)는 js/lib/xls-limits.js xlsBytes 를 쓴다.
// JSZip·XLSX 는 넘겨받은 것으로만 쓴다(브라우저 CDN · node 공용).

import { xlsBytes } from './xls-limits.js?v=202611102106';

// ---------------------------------------------------------------- XML 도우미
const escXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unescXml = (s) => String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e];
});
// 엑셀(XML)에 쓸 수 없는 글자: openpyxl ILLEGAL_CHARACTERS_RE(제어 문자) + XML 1.0 에 없는 U+FFFE·U+FFFF + 짝 없는 서로게이트.
// Python 판은 앞의 것에서 IllegalCharacterError, 뒤의 것은 저장(utf-8 인코딩·XML)에서 멈춘다 — 웹판도 멈추고 안내한다(조용히 지우지 않음).
export const ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function colName(c) {
    let s = '';
    while (c > 0) { const k = (c - 1) % 26; s = String.fromCharCode(65 + k) + s; c = Math.floor((c - 1) / 26); }
    return s;
}
export function decodeRef(ref) {
    const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref);
    if (!m) return null;
    let c = 0;
    for (const ch of m[1].toUpperCase()) c = c * 26 + ch.charCodeAt(0) - 64;
    return { r: Number(m[2]), c };
}
function attr(attrs, name) {
    const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
    return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
}
function dropAttrs(attrs, names) {
    let s = attrs;
    for (const n of names) s = s.replace(new RegExp(`\\s${n}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'g'), '');
    return s;
}

/** 새 칸 XML. v: null · 숫자 · 글자 · 참거짓 · { f: '수식' } . s: 칸 서식 번호(옛 칸에서 물려받을 때) */
export function cellXml(ref, v, s) {
    const sa = s ? ` s="${s}"` : '';
    if (v === null || v === undefined) return s ? `<c r="${ref}"${sa}/>` : '';
    if (typeof v === 'object' && !(v instanceof Date) && typeof v.f === 'string') return `<c r="${ref}"${sa}><f>${escXml(v.f)}</f></c>`;
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) return cellXml(ref, String(v), s);
        return `<c r="${ref}"${sa}><v>${v}</v></c>`;
    }
    if (typeof v === 'boolean') return `<c r="${ref}"${sa} t="b"><v>${v ? 1 : 0}</v></c>`;
    const t = v instanceof Date ? v.toISOString() : String(v);
    if (ILLEGAL.test(t)) throw new Error(`엑셀에 쓸 수 없는 글자(제어 문자 등)가 있습니다 (${ref}) — 입력 파일의 그 칸을 고친 뒤 다시 해 주세요.`);
    if (t.length > 1 && t.startsWith('=')) return `<c r="${ref}"${sa}><f>${escXml(t.slice(1))}</f></c>`;
    const sp = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}"${sa} t="inlineStr"><is><t${sp}>${escXml(t)}</t></is></c>`;
}

/** sheetData 안 행들 → [{ r, attrs, inner, raw }] (r 없는 행은 앞 행 + 1) */
function parseRows(inner) {
    const rows = [];
    const re = /<row\b([^>]*?)(\/?)>/g;
    let m, prev = 0;
    while ((m = re.exec(inner))) {
        const start = m.index;
        let content = '', end = re.lastIndex;
        if (!m[2]) {
            const close = inner.indexOf('</row>', end);
            if (close < 0) throw new Error('시트 XML 의 행이 닫히지 않았습니다.');
            content = inner.slice(end, close);
            end = close + 6;
            re.lastIndex = end;
        }
        const rv = attr(m[1], 'r');
        const r = rv ? Number(rv) : prev + 1;
        prev = r;
        rows.push({ r, attrs: m[1], inner: content, raw: inner.slice(start, end) });
    }
    return rows;
}

/** 행 안 칸들 → [{ c, ref, attrs, raw }] (r 없는 칸은 앞 칸 + 1) */
function parseCells(rowInner, rowNo) {
    const cells = [];
    const re = /<c\b([^>]*?)(\/?)>/g;
    let m, prev = 0;
    while ((m = re.exec(rowInner))) {
        const start = m.index;
        let end = re.lastIndex, content = '';
        if (!m[2]) {
            const close = rowInner.indexOf('</c>', end);
            if (close < 0) throw new Error('시트 XML 의 칸이 닫히지 않았습니다.');
            content = rowInner.slice(end, close);
            end = close + 4;
            re.lastIndex = end;
        }
        const rv = attr(m[1], 'r');
        const d = rv ? decodeRef(rv) : null;
        const c = d ? d.c : prev + 1;
        prev = c;
        let raw = rowInner.slice(start, end);
        if (!rv) raw = raw.replace(/^<c\b/, `<c r="${colName(c)}${rowNo}"`);
        cells.push({ c, ref: `${colName(c)}${rowNo}`, attrs: m[1], content, raw });
    }
    return cells;
}

function findSheetData(xml) {
    const m = /<sheetData\b[^>]*\/>|<sheetData\b[^>]*>/.exec(xml);
    if (!m) throw new Error('시트 XML 에서 sheetData 를 찾지 못했습니다(지원하지 않는 양식).');
    if (m[0].endsWith('/>')) {
        const e = m.index + m[0].length;
        return { start: m.index, end: e, inner: '', innerStart: e, innerEnd: e, selfClosed: true };
    }
    const innerStart = m.index + m[0].length;
    const close = xml.indexOf('</sheetData>', innerStart);
    if (close < 0) throw new Error('시트 XML 의 sheetData 가 닫히지 않았습니다.');
    return { start: m.index, end: close + 12, inner: xml.slice(innerStart, close), innerStart, innerEnd: close };
}

/**
 * 시트 XML 의 sheetData 바꾸기.
 * keepUpTo 행까지는 그대로. 그 아래:
 *   dropOld=true  → 옛 행·칸을 모두 지우고 새 행만(시트1 빠른 모드 — Python 판은 칸·행 높이를 지움)
 *   dropOld=false → 옛 칸은 값만 비우고 서식(s)은 남김(열 1..clearCols). clearCols 밖 옛 칸은 그대로. 행 속성(높이 등)은 남김.
 * newRows[i] 는 keepUpTo + 1 + i 행의 값(1열부터).
 */
export function rewriteSheetXml(xml, { keepUpTo, rows: newRows = [], dropOld = false, clearCols = Infinity }) {
    const sd = findSheetData(xml);
    const oldRows = parseRows(sd.inner);
    const out = [];
    let minR = Infinity, minC = Infinity, maxR = 0, maxC = 0;
    const note = (r, c) => { if (r < minR) minR = r; if (r > maxR) maxR = r; if (c < minC) minC = c; if (c > maxC) maxC = c; };
    const olds = new Map();
    for (const row of oldRows) {
        if (row.r <= keepUpTo) {
            out.push(row.raw);
            for (const cell of parseCells(row.inner, row.r)) note(row.r, cell.c);
        } else if (!dropOld) {
            olds.set(row.r, row);
        }
    }
    let lastOld = 0;
    for (const k of olds.keys()) if (k > lastOld) lastOld = k;
    const lastRow = Math.max(keepUpTo + newRows.length, lastOld);
    for (let r = keepUpTo + 1; r <= lastRow; r++) {
        const vals = newRows[r - keepUpTo - 1] || [];
        const old = olds.get(r);
        const oldCells = old ? parseCells(old.inner, r) : [];
        const byCol = new Map(oldCells.map(x => [x.c, x]));
        const cols = new Set(byCol.keys());
        for (let c = 1; c <= vals.length; c++) if (vals[c - 1] !== null && vals[c - 1] !== undefined) cols.add(c);
        let cells = '';
        for (const c of [...cols].sort((a, b) => a - b)) {
            const oc = byCol.get(c);
            const v = c <= vals.length ? vals[c - 1] : undefined;
            const ref = `${colName(c)}${r}`;
            let x;
            if (v !== null && v !== undefined) {
                const s = oc ? attr(oc.attrs, 's') : null;
                x = cellXml(ref, v, s && s !== '0' ? s : null);
            } else if (oc && c > clearCols) {
                x = oc.raw;                                    // 비우는 범위 밖 옛 칸은 그대로
            } else if (oc) {
                const s = attr(oc.attrs, 's');
                x = s && s !== '0' ? `<c r="${ref}" s="${s}"/>` : '';
            } else {
                x = '';
            }
            if (x) { cells += x; note(r, c); }
        }
        const rowAttrs = old ? dropAttrs(old.attrs, ['r', 'spans']) : '';
        if (cells) out.push(`<row r="${r}"${rowAttrs}>${cells}</row>`);
        else if (old) out.push(`<row r="${r}"${rowAttrs}/>`);
    }
    let res = xml.slice(0, sd.start) + `<sheetData>${out.join('')}</sheetData>` + xml.slice(sd.end);
    const dim = maxR ? (minR === maxR && minC === maxC ? `${colName(minC)}${minR}` : `${colName(minC)}${minR}:${colName(maxC)}${maxR}`) : 'A1';
    res = res.replace(/<dimension\b[^>]*\/>/, `<dimension ref="${dim}"/>`);
    return res;
}

// ---------------------------------------------------------------- 통합 문서 부품
function resolveTarget(baseDir, target) {
    if (target.startsWith('/')) return target.slice(1);
    const parts = (baseDir ? baseDir.split('/') : []).concat(target.split('/'));
    const out = [];
    for (const p of parts) {
        if (!p || p === '.') continue;
        if (p === '..') out.pop(); else out.push(p);
    }
    return out.join('/');
}
const relsPathOf = (part) => {
    const i = part.lastIndexOf('/');
    return `${part.slice(0, i + 1)}_rels/${part.slice(i + 1)}.rels`;
};
const dirOf = (part) => part.slice(0, Math.max(0, part.lastIndexOf('/')));

function parseRels(xml) {
    const out = [];
    for (const m of xml.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
        out.push({ raw: m[0], id: attr(m[1], 'Id'), type: attr(m[1], 'Type') || '', target: unescXml(attr(m[1], 'Target') || ''), mode: attr(m[1], 'TargetMode') });
    }
    return out;
}

/** 통합 문서 → 시트 목록 [{ name, part, kind }] + 활성 시트 번호 + 공유 문자열 부품 */
export async function workbookParts(zip) {
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const relsXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rels = parseRels(relsXml);
    const sheets = [];
    for (const m of wbXml.matchAll(/<sheet\b([^>]*?)\/?>/g)) {
        const name = unescXml(attr(m[1], 'name') || '');
        const idm = /(?:^|\s)[\w]+:id\s*=\s*"([^"]*)"/.exec(m[1]);
        const rel = idm && rels.find(r => r.id === idm[1]);
        if (!rel) continue;
        sheets.push({ name, part: resolveTarget('xl', rel.target), kind: /chartsheet/.test(rel.type) ? 'chart' : 'work' });
    }
    const av = /<workbookView\b[^>]*?\sactiveTab\s*=\s*"(\d+)"/.exec(wbXml);
    const sst = rels.find(r => /\/sharedStrings$/.test(r.type));
    return { wbXml, relsXml, rels, sheets, activeTab: av ? Number(av[1]) : 0, sstPart: sst ? resolveTarget('xl', sst.target) : null };
}

const APP_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>';

/** 부품 쓰기 — 폴더 항목(xl/ 등)을 새로 만들지 않는다(원본 zip 처럼) */
function put(zip, p, data) {
    zip.file(p, data, { createFolders: false });
}

async function readStr(zip, p) {
    const f = zip.file(p);
    return f ? f.async('string') : null;
}

/** calcChain 제거(수식 칸이 바뀌면 옛 계산 순서가 Excel '복구' 를 부른다 — openpyxl 도 쓰지 않음) */
async function removeCalcChain(zip, info, ct) {
    const rel = info.rels.find(r => /\/calcChain$/.test(r.type));
    const part = rel ? resolveTarget('xl', rel.target) : 'xl/calcChain.xml';
    let removed = false;
    if (zip.file(part)) { zip.remove(part); removed = true; }
    if (rel) {
        info.relsXml = info.relsXml.replace(rel.raw, '');
        put(zip, 'xl/_rels/workbook.xml.rels', info.relsXml);
        removed = true;
    }
    ct.xml = ct.xml.replace(new RegExp(`<Override\\b[^>]*PartName="/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g'), '');
    return removed;
}

/** 프린터 설정·미리보기 그림 제거(openpyxl 저장 결과와 같게 — 프린터 이름 같은 PC 정보가 밖으로 나가지 않게) */
async function removePrinterAndThumb(zip, ct) {
    const relFiles = Object.keys(zip.files).filter(p => /(^|\/)_rels\/[^/]*\.rels$/.test(p));
    for (const rp of relFiles) {
        let xml = await readStr(zip, rp);
        if (!xml) continue;
        const isRoot = rp === '_rels/.rels';                     // 패키지 맨 위(미리보기 그림 연결)
        const srcPart = isRoot ? null : rp.replace(/_rels\/([^/]+)\.rels$/, '$1');
        const baseDir = isRoot ? '' : dirOf(srcPart);
        const bad = parseRels(xml).filter(r => /\/(printerSettings|thumbnail)$/.test(r.type) && r.mode !== 'External');
        if (!bad.length) continue;
        let src = srcPart && zip.file(srcPart) ? await readStr(zip, srcPart) : null;
        for (const r of bad) {
            xml = xml.replace(r.raw, '');
            const target = resolveTarget(baseDir, r.target);
            if (zip.file(target)) zip.remove(target);
            ct.xml = ct.xml.replace(new RegExp(`<Override\\b[^>]*PartName="/${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*/>`, 'g'), '');
            if (src) src = src.replace(new RegExp(`(<pageSetup\\b[^>]*?)\\s[\\w]+:id\\s*=\\s*"${r.id}"`, 'g'), '$1');
        }
        if (/<Relationship\b/.test(xml) || isRoot) put(zip, rp, xml);
        else zip.remove(rp);                                       // 연결이 하나도 안 남은 시트 rels 는 지운다(openpyxl 판처럼)
        if (src !== null && srcPart) put(zip, srcPart, src);
    }
    const leftBin = Object.keys(zip.files).some(p => /\.bin$/i.test(p) && !zip.files[p].dir);
    if (!leftBin) ct.xml = ct.xml.replace(/<Default\b[^>]*Extension="bin"[^>]*printerSettings[^>]*\/>/gi, '');
    // 비게 된 폴더 항목도 지운다(원본 zip 에 폴더 항목이 있었을 때)
    for (const d of Object.keys(zip.files).filter(p => zip.files[p].dir)) {
        if (!Object.keys(zip.files).some(p => p !== d && p.startsWith(d))) zip.remove(d);
    }
}

/** 열 때 다시 계산 — 새 수식(시트2 G·H)에 저장된 값이 없으므로(openpyxl 판도 fullCalcOnLoad="1") */
function setFullCalc(wbXml) {
    const m = /<calcPr\b([^>]*?)\/>/.exec(wbXml);
    if (m) {
        if (/\sfullCalcOnLoad\s*=/.test(m[1])) return wbXml.replace(m[0], m[0].replace(/fullCalcOnLoad\s*=\s*"[^"]*"/, 'fullCalcOnLoad="1"'));
        return wbXml.replace(m[0], `<calcPr${m[1]} fullCalcOnLoad="1"/>`);
    }
    for (const anchor of [/<\/definedNames>|<definedNames\s*\/>/, /<\/externalReferences>/, /<\/functionGroups>|<functionGroups\b[^>]*\/>/, /<\/sheets>/]) {
        const a = anchor.exec(wbXml);
        if (a) return wbXml.slice(0, a.index + a[0].length) + '<calcPr fullCalcOnLoad="1"/>' + wbXml.slice(a.index + a[0].length);
    }
    return wbXml;
}

/** 칸 안 공유 문자열 번호 바꾸기 — fn(old) → new */
function mapSstRefs(sheetXml, fn) {
    const sd = findSheetData(sheetXml);
    const re = /<c\b([^>]*?)(\/?)>/g;
    const inner = sd.inner;
    let m, last = 0;
    const parts = [];
    while ((m = re.exec(inner))) {
        if (m[2]) continue;
        const close = inner.indexOf('</c>', re.lastIndex);
        if (close < 0) throw new Error('칸이 닫히지 않았습니다.');
        if (attr(m[1], 't') === 's') {
            const content = inner.slice(re.lastIndex, close);
            const vm = /<v>\s*(\d+)\s*<\/v>/.exec(content);
            if (vm) {
                const nv = fn(Number(vm[1]));
                parts.push(inner.slice(last, re.lastIndex), content.replace(vm[0], `<v>${nv}</v>`));
                last = close;
            }
        }
        re.lastIndex = close + 4;
    }
    parts.push(inner.slice(last));
    return sheetXml.slice(0, sd.innerStart) + parts.join('') + sheetXml.slice(sd.innerEnd);
}

/** 어느 칸에서도 쓰지 않는 공유 문자열 빼기. 반환: 뺀 개수(못 하면 -1 — 원본 그대로 둠) */
async function compactSharedStrings(zip, info) {
    if (!info.sstPart || !zip.file(info.sstPart)) return 0;
    const sstXml = await readStr(zip, info.sstPart);
    const head = /<sst\b[^>]*>/.exec(sstXml);
    if (!head) return -1;
    const items = [...sstXml.matchAll(/<si\b[^>]*\/>|<si\b[^>]*>[\s\S]*?<\/si>/g)].map(x => x[0]);
    const sheetXml = new Map();
    const used = new Set();
    let refs = 0;
    for (const s of info.sheets) {
        if (s.kind !== 'work') continue;
        const x = await readStr(zip, s.part);
        if (x === null) continue;
        try {
            mapSstRefs(x, (i) => { used.add(i); refs++; return i; });
        } catch (_) { return -1; }
        sheetXml.set(s.part, x);
    }
    for (const i of used) if (i >= items.length) return -1;   // 번호가 목록 밖 — 손대지 않는다
    if (used.size === items.length) return 0;
    const keep = [...used].sort((a, b) => a - b);
    const remap = new Map(keep.map((old, i) => [old, i]));
    for (const [part, x] of sheetXml) put(zip, part, mapSstRefs(x, (i) => remap.get(i)));
    const tail = sstXml.slice(sstXml.lastIndexOf('</sst>'));
    let open = head[0].replace(/\s(count|uniqueCount)\s*=\s*"[^"]*"/g, '');
    open = open.replace(/^<sst\b/, `<sst count="${refs}" uniqueCount="${keep.length}"`);
    const pre = sstXml.slice(0, head.index);
    put(zip, info.sstPart, pre + open + keep.map(i => items[i]).join('') + tail);
    return items.length - keep.length;
}

/**
 * 템플릿 xlsx 고쳐 쓰기.
 * edits: [{ sheet: 시트이름 | sheetIndex: 번호(0 기준, 'active' 면 활성 시트), keepUpTo, rows, dropOld, clearCols }]
 * @returns {Promise<{ bytes: Uint8Array, calcChainRemoved: boolean, sstRemoved: number }>}
 */
export async function rewriteXlsx(JSZip, templateBytes, edits) {
    const zip = await JSZip.loadAsync(templateBytes);
    if (!zip.file('xl/workbook.xml')) throw new Error('엑셀(.xlsx) 양식이 아닙니다.');
    const info = await workbookParts(zip);
    const ct = { xml: await readStr(zip, '[Content_Types].xml') || '' };
    for (const e of edits) {
        let s;
        if (e.sheet !== undefined) s = info.sheets.find(x => x.name === e.sheet);
        else s = info.sheets[e.sheetIndex === 'active' ? info.activeTab : e.sheetIndex];
        if (!s || s.kind !== 'work') throw new Error(`양식에 '${e.sheet !== undefined ? e.sheet : e.sheetIndex}' 시트가 없습니다.`);
        const xml = await readStr(zip, s.part);
        put(zip, s.part, rewriteSheetXml(xml, e));
    }
    const calcChainRemoved = await removeCalcChain(zip, info, ct);
    await removePrinterAndThumb(zip, ct);
    put(zip, 'xl/workbook.xml', setFullCalc(info.wbXml));
    // 문서 속성(app.xml)은 openpyxl 판처럼 새로 쓴다 — 원본의 회사명·관리자·시트 제목 목록이 따라 나가지 않게
    if (zip.file('docProps/app.xml')) put(zip, 'docProps/app.xml', APP_XML);
    const sstRemoved = await compactSharedStrings(zip, info);
    put(zip, '[Content_Types].xml', ct.xml);
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    return { bytes, calcChainRemoved, sstRemoved };
}

/** 직진배송출고리스트 — ship-zikjin.zikjinStep2 결과로 */
export function zikjinListBytes(JSZip, templateBytes, r) {
    return rewriteXlsx(JSZip, templateBytes, [
        { sheet: '지그재그양식서', keepUpTo: 7, rows: r.sheet1, dropOld: true },
        { sheet: '재고로그조회리스트', keepUpTo: 1, rows: r.sheet2 },
        { sheet: '패키지번호', keepUpTo: 1, rows: r.sheet3 },
    ]);
}

/** 에이블리 대량입고 — ship-ably.ablyStep2 결과로(활성 시트 6행부터, 1~7열만 비움) */
export function ablyBulkBytes(JSZip, templateBytes, r) {
    return rewriteXlsx(JSZip, templateBytes, [{ sheetIndex: 'active', keepUpTo: 5, rows: r.rows, clearCols: 7 }]);
}

/** 재고출고용 .xls(biff8) — 1단계 결과로. 한도를 넘으면 { problem } */
export function stockXlsBytes(X, step1) {
    const res = xlsBytes(X, [{ name: step1.sheetName, aoa: step1.aoa }]);
    if (res.bytes) res.bytes = new Uint8Array(res.bytes);
    return res;
}
