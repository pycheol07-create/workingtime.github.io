// === js/lib/ship-compare.js ===
// 'exe 결과와 비교하기'(ship.html #sp-compare, 2026-11-12) — exe 결과 파일과 웹 결과 파일을 칸 값으로 견준다.
//   앱\플랫폼출고자동화\tests\결과비교.py(값·자료형·크기·시트) · test_웹판비교.py intended()·split_diffs() 와 같은 판정.
//   + 자리에 따른 의도된 차이(intendedAt — 패키지명 접두 PACK_PREFIX · drop_no_master 와 같은 NO_MASTER, 2026-11-13).
//   서식(글꼴·채움·테두리·열 너비 등)은 견주지 않는다 — 화면에 그렇게 안내한다.
//   결과에는 위치·개수만 담는다(값은 보여 주지 않는다 — 실제 출고 파일). 순수 모듈(SheetJS 는 넘겨받음). 테스트: tests/ship-compare.test.js

import { pyStr, PACK_PREFIX } from './ship-core.js?v=202611131354';

const DIGITS = /^-?\d+$/;

/** 'A'·'AB' 열 글자 */
export function colLetter(c) {
    let s = '';
    for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
}

/** 칸 값 → (값, 자료형). 수식은 '=…' 글자(결과비교.py 의 openpyxl 값과 같게)
 *  .xls 는 SheetJS 가 숫자를 모두 숫자로 읽는다(xlrd 와 같음) — 정수인 소수는 JS 에서 정수와 구별되지 않는다 */
function cellOf(cell) {
    if (!cell) return [null, 'n'];
    if (cell.f) return ['=' + cell.f, 'f'];
    if (cell.t === 'z' || cell.v === undefined || cell.v === null || cell.v === '') return [null, 'n'];
    if (cell.t === 'n') return [cell.v, 'n'];        // openpyxl 처럼 숫자·빈칸 모두 'n'
    if (cell.t === 'b') return [cell.v, 'b'];
    if (cell.t === 'd') return [cell.v instanceof Date ? cell.v.toISOString() : String(cell.v), 'd'];
    if (cell.t === 'e') return [cell.w || '#ERR', 'e'];
    return [String(cell.v), 's'];
}

/** 엑셀 바이트 → { names, sheets: { 이름: { rows, cols, cells: Map('r,c' → [값, 자료형]) } } } */
export function gridOf(X, bytes) {
    const wb = X.read(bytes, { type: 'array', cellFormula: true, cellNF: false, cellStyles: false, cellDates: false, dense: false });
    const sheets = {};
    for (const name of wb.SheetNames) {
        const ws = wb.Sheets[name];
        const cells = new Map();
        let rows = 0, cols = 0;
        for (const addr of Object.keys(ws)) {
            if (addr[0] === '!') continue;
            const rc = X.utils.decode_cell(addr);
            const v = cellOf(ws[addr]);
            if (v[0] === null) continue;
            const r = rc.r + 1, c = rc.c + 1;
            cells.set(`${r},${c}`, v);
            if (r > rows) rows = r;
            if (c > cols) cols = c;
        }
        sheets[name] = { rows, cols, cells };
    }
    return { names: [...wb.SheetNames], sheets };
}

/** 두 격자 → 차이 [{ cat:'시트'|'크기'|'값'|'자료형', sheet, row, col, a, b }] (a = 왼쪽(exe), b = 오른쪽(웹)) */
export function compareGrids(A, B) {
    const diffs = [];
    if (A.names.join('\u0000') !== B.names.join('\u0000')) diffs.push({ cat: '시트', sheet: '', row: 0, col: 0 });
    for (const name of A.names) {
        const a = A.sheets[name], b = B.sheets[name];
        if (!b) continue;
        if (a.rows !== b.rows || a.cols !== b.cols) diffs.push({ cat: '크기', sheet: name, row: 0, col: 0 });
        const R = Math.max(a.rows, b.rows), C = Math.max(a.cols, b.cols);
        for (let r = 1; r <= R; r++) {
            for (let c = 1; c <= C; c++) {
                const [va, ta] = a.cells.get(`${r},${c}`) || [null, 'n'];
                const [vb, tb] = b.cells.get(`${r},${c}`) || [null, 'n'];
                if (va !== vb) diffs.push({ cat: '값', sheet: name, row: r, col: c, a: va, b: vb });
                if (ta !== tb) diffs.push({ cat: '자료형', sheet: name, row: r, col: c, a: ta, b: tb });
            }
        }
    }
    return diffs;
}

function pyInt(v) {
    if (typeof v === 'boolean') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : null;
    if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return Number(v.trim());
    return null;
}

/** 의도된 차이면 그 이름(a = exe 값, b = 웹 값) — test_웹판비교.py intended() 와 같다 */
export function intended(a, b) {
    if (typeof a === 'string' && a.endsWith('.0') && DIGITS.test(a.slice(0, -2)) && pyStr(b) === a.slice(0, -2)) return 'INT_FLOAT';
    if (typeof b === 'string' && DIGITS.test(b) && b.replace(/^-/, '').startsWith('0') && b.replace(/^-/, '').length > 1) {
        const ia = pyInt(a), ib = pyInt(b);
        if (ia !== null && ib !== null && ia === ib && pyStr(a) !== b) return 'HTML_ZERO';
    }
    return null;
}

// 자리에 따른 의도된 차이(파일 짝 키 = pairKey) — 2026-11-13
//   PACK_PREFIX: 웹판은 패키지명 앞에 플랫폼 접두(직진 ZG · 에이블리 AB, ship-core.packageNameBase). exe 는 YYMMDD-NN.
//     칸: 직진 출고리스트 지그재그양식서 A 8행~ · 패키지번호 B 2행~ · 피킹작업지시서 A 2행~(ZG·AB) · 에이블리 대량입고 A 6행~.
//     웹 값 = 그 파일 플랫폼 접두 + exe 값일 때만.
//   NO_MASTER: 웹판은 직진 출고리스트 원본 없이(출고요청으로) 만든다 — 지그재그양식서 8행~ G(시즌)·I(공장상품명)가 빈칸.
//     test_웹판비교.py drop_no_master 와 같은 조건(웹 값이 빈칸일 때만).
const PREFIX_CELLS = {
    '직진배송출고리스트.xlsx': { pre: PACK_PREFIX.zikjin, at: (d) => (d.sheet === '지그재그양식서' && d.col === 1 && d.row >= 8) || (d.sheet === '패키지번호' && d.col === 2 && d.row >= 2) },
    'ZG_피킹작업지시서.xlsx': { pre: PACK_PREFIX.zikjin, at: (d) => d.sheet === '피킹작업지시서' && d.col === 1 && d.row >= 2 },
    'AB_피킹작업지시서.xlsx': { pre: PACK_PREFIX.ably, at: (d) => d.sheet === '피킹작업지시서' && d.col === 1 && d.row >= 2 },
    '에이블리_대량입고.xlsx': { pre: PACK_PREFIX.ably, at: (d) => d.col === 1 && d.row >= 6 },   // 대량입고는 양식의 활성 시트(이름은 양식마다)
};

/** 이 파일(key)의 이 칸(d) 차이가 자리 때문에 의도된 것이면 그 이름 */
export function intendedAt(key, d) {
    const rule = PREFIX_CELLS[key];
    if (rule && rule.at(d) && typeof d.a === 'string' && d.a !== '' && d.b === rule.pre + d.a) return 'PACK_PREFIX';
    if (key === '직진배송출고리스트.xlsx' && d.sheet === '지그재그양식서' && d.row >= 8 && (d.col === 7 || d.col === 9)
        && d.b === null && d.a !== null && d.a !== undefined) return 'NO_MASTER';
    return null;
}

/** (의도된 차이 [{why, where}], 그 밖의 차이) — 같은 칸의 자료형 차이는 값 차이를 따라간다(split_diffs).
 *  key(파일 짝 키, pairKey)를 주면 자리에 따른 의도된 차이(intendedAt)도 본다 */
export function splitDiffs(diffs, key = '') {
    const ok = new Map();
    for (const d of diffs) {
        if (d.cat === '값' && d.row && d.col) {
            const why = intended(d.a, d.b) || intendedAt(key, d);
            if (why) ok.set(`${d.sheet}\u0000${d.row}\u0000${d.col}`, why);
        }
    }
    const good = [], bad = [];
    for (const d of diffs) {
        const k = `${d.sheet}\u0000${d.row}\u0000${d.col}`;
        if ((d.cat === '값' || d.cat === '자료형') && ok.has(k)) {
            if (d.cat === '값') good.push({ why: ok.get(k), where: whereOf(d) });
        } else {
            bad.push(d);
        }
    }
    return { good, bad };
}

export function whereOf(d) {
    if (d.row && d.col) return `${d.sheet}!${colLetter(d.col)}${d.row}`;
    return d.sheet || '(통합 문서)';
}

/** '직진배송출고리스트_261110.xlsx' → '직진배송출고리스트.xlsx'(날짜만 빼고 짝) */
export function pairKey(name) {
    return String(name || '').replace(/_\d{6}(?=\.\w+$)/, '');
}

/** 차이 → 줄(값 없이: 종류별 개수 + 위치 앞 limit 개) */
export function summarizeDiffs(diffs, limit = 20) {
    const by = new Map();
    for (const d of diffs) {
        if (!by.has(d.cat)) by.set(d.cat, []);
        by.get(d.cat).push(whereOf(d));
    }
    const lines = [];
    for (const [cat, w] of by) {
        const more = w.length > limit ? ` 외 ${w.length - limit}곳` : '';
        lines.push(`[${cat}] ${w.length}곳: ${w.slice(0, limit).join(', ')}${more}`);
    }
    return lines;
}

/**
 * 짝 맞춰 견주기.
 * @param {Array<{name, grid}>} left   exe 쪽
 * @param {Array<{name, grid}>} right  웹 쪽
 * @returns {Array<{key, left?, right?, missing?: 'left'|'right', good, bad, lines}>}
 */
export function comparePairs(left, right) {
    const L = new Map(left.map(f => [pairKey(f.name), f]));
    const Rm = new Map(right.map(f => [pairKey(f.name), f]));
    const keys = [...new Set([...L.keys(), ...Rm.keys()])].sort();
    return keys.map(key => {
        const a = L.get(key), b = Rm.get(key);
        if (!a || !b) return { key, left: a && a.name, right: b && b.name, missing: a ? 'right' : 'left', good: [], bad: [], lines: [] };
        const { good, bad } = splitDiffs(compareGrids(a.grid, b.grid), key);
        return { key, left: a.name, right: b.name, good, bad, lines: summarizeDiffs(bad) };
    });
}
