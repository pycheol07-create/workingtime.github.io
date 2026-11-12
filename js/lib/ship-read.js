// === js/lib/ship-read.js ===
// 플랫폼 출고 입력 엑셀 읽기 — Python 판 load_workbook_any(직진배송_자동화.py) 와 같은 칸 값을 만든다.
//   파일 머리 서명으로 형식 판별(확장자 무관): OLE2 → 진짜 .xls(Python: xlrd) / ZIP → .xlsx(openpyxl data_only) / '<' → HTML 로 위장한 .xls(bs4)
//   SheetJS 는 넘겨받은 XLSX 로만 쓴다(raw 값). 플랫폼 출고는 0.20.3(cdn.sheetjs.com — 다른 화면의 0.18.5 와 따로, 2026-11-10).
//   시트 범위는 <dimension> 을 믿지 않고 칸을 훑어 다시 센다(actualRange). HTML 은 SheetJS 를 쓰지 않고 여기서 bs4(html.parser) 처럼 읽는다
//   — SheetJS 는 colspan 으로 칸을 밀고 숫자 모양을 제 규칙으로 바꿔 Python 판과 달라진다.
// 칸 값 모양(= Python 판): null · 글자 · 숫자 · 참거짓. 고객 열은 읽는 쪽(ship-zikjin·ship-ably)이 머리글로 골라 쓰고 여기서는 거르지 않는다.
// Python 판과 일부러 다른 점(2026-11-10):
//   · 정수인 소수(float) 칸 — 형식 상관없이(.xls 는 xlrd 가 숫자를 모두 float, .xlsx 는 '1.2345E+5'·'1.0' 처럼 적힌 칸, HTML 은 '3.0')
//     Python 판은 str() 이 '12345.0' 이 되어 코드가 틀리고 로케이션 정렬·봉 구성까지 바뀌었다 → 정수로 본다
//     (사용자 결정 '12345.0 버그 고침' 의 취지, 비교 시험의 의도된 차이 INT_FLOAT)
//   · HTML 숫자 모양 글자: 앞자리 0(예 '00123')·15자리 넘는 숫자는 글자로 둔다(Python 은 int 로 바꿔 0 을 잃음 / JS 는 자릿수를 잃음)
//   · UTF-8 BOM 뒤에 '<' 가 오는 HTML 도 HTML 로 본다(Python 판은 '알 수 없는 형식' → .xls 로 읽다 실패)

import { pyStr, pyStrip } from './ship-core.js?v=202611120950';
import { HTML_ENTITIES } from './ship-html-entities.js?v=202611120950';

export const FORMAT = Object.freeze({ XLS: 'xls_binary', XLSX: 'xlsx_zip', HTML: 'html', UNKNOWN: 'unknown' });

const toU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

/** _detect_file_format */
export function detectFormat(bytes) {
    const h = toU8(bytes).subarray(0, 512);
    if (h[0] === 0xD0 && h[1] === 0xCF && h[2] === 0x11 && h[3] === 0xE0) return FORMAT.XLS;
    if (h[0] === 0x50 && h[1] === 0x4B && h[2] === 0x03 && h[3] === 0x04) return FORMAT.XLSX;
    let i = (h[0] === 0xEF && h[1] === 0xBB && h[2] === 0xBF) ? 3 : 0;
    while (i < h.length && [0x20, 0x09, 0x0A, 0x0D, 0x0B, 0x0C].includes(h[i])) i++;
    if (h[i] === 0x3C) return FORMAT.HTML;
    return FORMAT.UNKNOWN;
}

// ---------------------------------------------------------------- 책·시트 모양
/**
 * 칸 값 2차원 배열(0 기준) → 시트. cell(r, c) 는 1 기준(openpyxl 과 같음), 없는 칸은 null.
 */
export function sheetFromRows(name, rows) {
    const grid = rows || [];
    let maxCol = 0;
    for (const r of grid) if (r && r.length > maxCol) maxCol = r.length;
    return {
        name,
        maxRow: grid.length,
        maxCol,
        cell(r, c) {
            const row = grid[r - 1];
            const v = row ? row[c - 1] : undefined;
            return v === undefined ? null : v;
        },
    };
}

/** 시트 목록 → 책. active 는 활성 시트 번호(0 기준) */
export function makeBook(format, sheets, active = 0) {
    const byName = new Map(sheets.map(s => [s.name, s]));
    const names = sheets.map(s => s.name);
    return {
        format,
        sheetNames: names,
        activeName: names[Math.min(Math.max(0, active | 0), Math.max(0, names.length - 1))],
        sheet(name) { return byName.get(name) || null; },
        active() { return byName.get(this.activeName) || null; },
    };
}

/** 시험·화면용: { 시트이름: aoa } → 책 */
export function bookFromAoa(obj, format = FORMAT.XLSX, active = 0) {
    return makeBook(format, Object.entries(obj).map(([n, rows]) => sheetFromRows(n, rows)), active);
}

// ---------------------------------------------------------------- SheetJS (xlsx · xls)
const ERR_TEXT = { 0x00: '#NULL!', 0x07: '#DIV/0!', 0x0F: '#VALUE!', 0x17: '#REF!', 0x1D: '#NAME?', 0x24: '#NUM!', 0x2A: '#N/A', 0x2B: '#GETTING_DATA' };

/** SheetJS 칸 → Python 판 값. format: xlsx(openpyxl) / xls(xlrd). formulas: 수식 칸을 '=…' 글자로(openpyxl 기본 읽기) */
export function normCell(cell, format, formulas = false) {
    if (!cell) return null;
    if (formulas && format === FORMAT.XLSX && cell.f) return '=' + cell.f;
    const v = cell.v;
    switch (cell.t) {
        case 's':
        case 'str':
            if (v === undefined || v === null) return null;
            if (format === FORMAT.XLS && v === '') return null;   // xlrd 빈 글자 → None
            return String(v);
        case 'n':
            return (typeof v === 'number') ? v : null;
        case 'b':
            if (format === FORMAT.XLS) return v ? 1 : 0;           // xlrd 는 참거짓을 1/0 으로
            return !!v;
        case 'e':
            if (format === FORMAT.XLS) return typeof v === 'number' ? v : 0;   // xlrd: 오류 코드 숫자
            return ERR_TEXT[v] || cell.w || '#N/A';                             // openpyxl: '#N/A' 글자
        case 'd':
            return v instanceof Date ? v : null;
        default:
            return null;
    }
}

/**
 * 시트의 실제 범위 — <dimension>(!ref)은 믿지 않고 칸 키를 전부 훑는다.
 * (만든 프로그램이 dimension 을 작게 적으면 아래 행을 못 읽는다. openpyxl 은 dimension 을 보지 않고 칸을 다 읽는다)
 */
export function actualRange(X, ws) {
    let maxRow = 0, maxCol = 0;
    if (!ws) return { maxRow, maxCol };
    for (const k of Object.keys(ws)) {
        if (k[0] === '!') continue;
        const a = X.utils.decode_cell(k);
        if (!(a.r >= 0 && a.c >= 0)) continue;
        if (a.r + 1 > maxRow) maxRow = a.r + 1;
        if (a.c + 1 > maxCol) maxCol = a.c + 1;
    }
    return { maxRow, maxCol };
}

function sheetFromSheetJS(X, name, ws, format, formulas) {
    const { maxRow, maxCol } = actualRange(X, ws);
    const enc = X.utils.encode_cell;
    return {
        name,
        maxRow,
        maxCol,
        cell(r, c) {
            if (!ws || r < 1 || c < 1) return null;   // 읽지 않은 시트(opts.sheets 밖)는 빈 시트
            return normCell(ws[enc({ r: r - 1, c: c - 1 })], format, formulas);
        },
    };
}

/**
 * 엑셀 바이트 → 책 (load_workbook_any).
 * opts.formulas: .xlsx 수식 칸을 '=…' 로(직진 출고리스트 원본 — Python 판은 data_only 없이 읽는다)
 * opts.sheets:   이 시트만 읽기(큰 원본 시간 줄이기). 없으면 전부
 */
export function readBook(X, bytes, fileName = '', opts = {}) {
    const u8 = toU8(bytes);
    let fmt = detectFormat(u8);
    if (fmt === FORMAT.UNKNOWN) {
        const ext = (String(fileName).toLowerCase().match(/\.[^.\\/]+$/) || [''])[0];
        if (ext === '.xlsx' || ext === '.xlsm') fmt = FORMAT.XLSX;
        else if (ext === '.xls') fmt = FORMAT.XLS;
        else throw new Error(`지원하지 않는 파일 형식: ${ext || '(확장자 없음)'} (.xlsx, .xlsm, .xls 만 지원)`);
    }
    if (fmt === FORMAT.HTML) return readHtmlBook(u8);

    const formulas = !!opts.formulas && fmt === FORMAT.XLSX;
    const ro = { type: 'array', cellFormula: formulas, cellDates: false, cellHTML: false, cellText: false, cellStyles: false };
    if (opts.sheets) ro.sheets = opts.sheets;
    const wb = X.read(u8, ro);
    const names = wb.SheetNames.map(n => (fmt === FORMAT.XLS ? Array.from(n || '').slice(0, 31).join('') : n));
    const sheets = wb.SheetNames.map((n, i) => sheetFromSheetJS(X, names[i] || `Sheet${i + 1}`, wb.Sheets[n], fmt, formulas));
    let active = 0;
    if (fmt === FORMAT.XLSX) {
        const v = wb.Workbook && wb.Workbook.WBView && wb.Workbook.WBView[0];
        if (v && v.activeTab !== undefined) active = Number(v.activeTab) || 0;
    }
    return makeBook(fmt, sheets, active);
}

// ---------------------------------------------------------------- HTML (bs4 html.parser 흉내)
/** 글자 풀기: utf-8 → cp949(euc-kr) → utf-8(바꿔 넣기). 줄바꿈은 Python 텍스트 모드처럼 \n 으로 */
export function decodeText(bytes) {
    const u8 = toU8(bytes);
    let text = null;
    for (const enc of ['utf-8', 'euc-kr']) {
        try { text = new TextDecoder(enc, { fatal: true }).decode(u8); break; } catch (_) { /* 다음 */ }
    }
    if (text === null) text = new TextDecoder('utf-8').decode(u8);
    return text.replace(/\r\n?/g, '\n');
}

// windows-1252 의 0x80~0x9F (bs4 는 &#128;~&#159; 를 cp1252 로 읽는다. 81·8D·8F·90·9D 는 cp1252 에 없어 그 번호 글자 그대로)
const CP1252 = {
    0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030,
    0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022,
    0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};

function charRef(n) {
    if (!Number.isFinite(n) || n === 0 || n > 0x10FFFF || (n >= 0xD800 && n <= 0xDFFF)) return '�';
    if (CP1252[n]) return String.fromCodePoint(CP1252[n]);
    return String.fromCodePoint(n);
}

/**
 * 글 조각의 문자 참조 풀기 — bs4(html.parser, convert_charrefs 끔)와 같게:
 *   &이름 / &이름;  표(html5, ship-html-entities.js)에 있으면 그 글자, 없으면 '&이름'(뒤 ';' 는 버려짐). ';' 없어도 된다.
 *   &#번호 / &#x16진  ';' 없어도 된다. 0·서로게이트·범위 밖은 U+FFFD, 128~159 는 cp1252.
 *   그 밖의 '&' 는 그대로.
 */
export function unescapeHtml(s) {
    return s.replace(/&(?:#([0-9]+|[xX][0-9a-fA-F]+)(?![0-9a-fA-F])|([a-zA-Z][-.a-zA-Z0-9]*));?/g, (m, num, name) => {
        if (num !== undefined) {
            const n = num[0] === 'x' || num[0] === 'X' ? parseInt(num.slice(1), 16) : parseInt(num, 10);
            return charRef(n);
        }
        const v = Object.prototype.hasOwnProperty.call(HTML_ENTITIES, name) ? HTML_ENTITIES[name] : undefined;
        return v === undefined ? '&' + name : v;
    });
}

const VOID = new Set(['br', 'hr', 'input', 'img', 'meta', 'spacer', 'link', 'frame', 'base', 'col', 'area', 'embed', 'keygen', 'menuitem', 'source', 'track', 'wbr', 'basefont', 'bgsound', 'command', 'param']);
const RAW_TEXT = new Set(['script', 'style']);
const SKIP_TEXT = new Set(['script', 'style', 'template']);   // bs4 get_text 가 빼는 글(Script·Stylesheet·TemplateString)

/** HTML → 간단한 나무 { name, children:[node|글자], parent } (bs4 html.parser 처럼 자동 닫기 없음) */
export function parseHtml(text) {
    const root = { name: '[document]', children: [], parent: null };
    let cur = root;
    const re = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][^\s/>]*)\s*[^>]*>|<([a-zA-Z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
    let last = 0, m;
    const pushText = (t) => { if (t) cur.children.push(unescapeHtml(t)); };
    while ((m = re.exec(text))) {
        pushText(text.slice(last, m.index));
        last = re.lastIndex;
        const tok = m[0];
        if (m[1]) {                                    // 닫는 태그 — 가장 가까운 같은 이름까지 닫는다(없으면 무시)
            const name = m[1].toLowerCase();
            let n = cur;
            while (n && n.name !== name) n = n.parent;
            if (n && n.parent) cur = n.parent;
        } else if (m[2]) {
            const name = m[2].toLowerCase();
            const el = { name, children: [], parent: cur };
            cur.children.push(el);
            const selfClose = /\/\s*$/.test(m[3] || '');
            if (VOID.has(name) || selfClose) continue;
            if (RAW_TEXT.has(name)) {                  // script·style 안은 그대로 글
                const end = new RegExp(`</${name}\\s*>`, 'ig');
                end.lastIndex = last;
                const e = end.exec(text);
                const stop = e ? e.index : text.length;
                if (stop > last) el.children.push(text.slice(last, stop));
                last = e ? end.lastIndex : text.length;
                re.lastIndex = last;
                continue;
            }
            cur = el;
        } else if (tok.startsWith('<![CDATA[')) {
            cur.children.push(tok.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, ''));
        }
        // 주석·선언·처리 지시는 버린다(get_text 에 안 들어감)
    }
    pushText(text.slice(last));
    return root;
}

/** find_all(names) — 문서 순서, 자손 전부 */
export function findAll(node, names) {
    const out = [];
    const want = names === true ? null : new Set([].concat(names));
    const walk = (n) => {
        for (const ch of n.children) {
            if (typeof ch === 'string') continue;
            if (!want || want.has(ch.name)) out.push(ch);
            walk(ch);
        }
    };
    walk(node);
    return out;
}

/** get_text(strip=True) — 글 조각마다 strip, 빈 것 빼고 이어 붙임 */
export function getTextStrip(node) {
    const parts = [];
    const walk = (n, skip) => {
        for (const ch of n.children) {
            if (typeof ch === 'string') {
                if (skip) continue;
                const t = pyStrip(ch);
                if (t) parts.push(t);
            } else {
                walk(ch, skip || SKIP_TEXT.has(ch.name));
            }
        }
    };
    walk(node, false);
    return parts.join('');
}

/**
 * HTML 칸 글자 → 값 (_load_xls_html 의 숫자 바꾸기). 빈 글자 → null.
 * '.' 이 있는 숫자 모양 → 소수, 정수 모양 → 정수. 앞자리 0·15자리 넘는 정수는 글자 그대로(웹판에서 고침).
 */
export function htmlValue(val) {
    if (val === '') return null;
    if (val.includes('.') && /^\d+$/.test(val.replace('.', '').replace(/^-+/, ''))) {
        return /^-?(\d+\.?\d*|\.\d+)$/.test(val) ? Number(val) : val;   // float() 이 못 읽으면(예 '--1.5') 글자
    }
    if (/^\d+$/.test(val.replace(/^-+/, ''))) {
        if (!/^-?\d+$/.test(val)) return val;                       // int('--5') 실패 → 글자
        const digits = val.replace('-', '');
        if ((digits.length > 1 && digits[0] === '0') || digits.length > 15) return val;
        const n = Number(val);
        return n === 0 ? 0 : n;
    }
    return val;
}

/** HTML 로 위장한 .xls → 책(시트 하나). 시트 이름은 'x:name' 같은 태그 글, 없으면 'worksheet' */
export function readHtmlBook(bytes) {
    const root = parseHtml(decodeText(bytes));
    let sheetName = 'worksheet';
    for (const tag of findAll(root, true)) {
        if (tag.name.endsWith(':name')) {
            const t = getTextStrip(tag);
            if (t) { sheetName = Array.from(t).slice(0, 31).join(''); break; }
        }
    }
    const tables = findAll(root, 'table');
    if (!tables.length) throw new Error('HTML 파일에 <table> 요소가 없습니다.');
    const rows = [];
    for (const table of tables) {
        for (const tr of findAll(table, 'tr')) {
            rows.push(findAll(tr, ['td', 'th']).map(cell => htmlValue(getTextStrip(cell))));
        }
    }
    return makeBook(FORMAT.HTML, [sheetFromRows(sheetName, rows)], 0);
}

/**
 * find_header_columns — row 행의 머리글 → 열 번호(1 기준). 같은 이름은 뒤 열이 이기고 순서는 처음 나온 자리(Python dict).
 * clean: 머리글 글자 다듬기(기본 str(v).strip())
 */
export function headerColumns(sheet, row = 1, clean = (v) => pyStrip(pyStr(v))) {
    const headers = new Map();
    for (let c = 1; c <= sheet.maxCol; c++) {
        const v = sheet.cell(row, c);
        if (v !== null && v !== undefined) headers.set(clean(v), c);
    }
    return headers;
}
