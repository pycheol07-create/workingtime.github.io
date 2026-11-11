// === js/lib/ship-assign.js ===
// 플랫폼 출고 화면 — 여러 파일을 한꺼번에 끌어다 놓으면 머리글을 보고 칸을 정해 준다(2026-11-10 웹 이식).
//   파일 앞쪽 몇 줄만 읽는다(peekBook). 칸 값은 ship-read 와 같은 규칙(normCell · HTML 은 readHtmlBook).
//   판정은 계산 코드(ship-zikjin·ship-ably)가 실제로 찾는 머리글과 같은 것을 본다 — 판정이 맞아도 계산이 따로 다시 검사한다.
// 순수 모듈(XLSX 는 넘겨받음). 테스트: tests/ship-assign.test.js

import { pyStr, pyStrip, looksLikeStockOut, STOCK_OUT_MSG } from './ship-core.js?v=202611111506';
import { detectFormat, FORMAT, readHtmlBook, normCell } from './ship-read.js?v=202611111506';
import { TEMPLATE_SHEETS } from './ship-zikjin.js?v=202611111506';
import { TMPL_HEADERS, TMPL_HEADER_ROW, REQ_HEADER_ROW } from './ship-ably.js?v=202611111506';

export const KIND = Object.freeze({
    ZIKJIN_REQUEST: 'zikjinRequest',   // 직진 출고요청(GPM)
    ZIKJIN_TEMPLATE: 'zikjinTemplate', // 직진배송출고리스트 원본
    ABLY_REQUEST: 'ablyRequest',       // 에이블리 도착보장출고요청
    ABLY_TEMPLATE: 'ablyTemplate',     // 에이블리 대량입고 양식
    ADMIN: 'admin',                    // 이지어드민 출고전표(직진·에이블리 같은 모양)
    STOCK_OUT: 'stockOut',             // 1단계 결과(재고출고용) — 어느 칸에도 넣지 않는다(출고전표로 잘못 넣는 것 막기)
    UNKNOWN: 'unknown',
});

export const KIND_LABEL = Object.freeze({
    zikjinRequest: '직진 출고요청', zikjinTemplate: '직진배송출고리스트 원본', ablyRequest: '에이블리 도착보장출고요청',
    ablyTemplate: '에이블리 대량입고 양식', admin: '이지어드민 출고전표', stockOut: '1단계 결과(재고출고용)', unknown: '알 수 없는 파일',
});

// 화면 칸: 플랫폼 → 단계 → { 칸 id: 종류 }
export const SLOTS = Object.freeze({
    zikjin: { 1: { request: KIND.ZIKJIN_REQUEST }, 2: { admin: KIND.ADMIN, template: KIND.ZIKJIN_TEMPLATE, request: KIND.ZIKJIN_REQUEST } },
    ably:   { 1: { request: KIND.ABLY_REQUEST },   2: { admin: KIND.ADMIN, request: KIND.ABLY_REQUEST, template: KIND.ABLY_TEMPLATE } },
});
const PLATFORM_OF = { zikjinRequest: 'zikjin', zikjinTemplate: 'zikjin', ablyRequest: 'ably', ablyTemplate: 'ably' };
export const PEEK_ROWS = 8;

const clean = (v) => (v === null || v === undefined ? '' : pyStrip(pyStr(v)));

/**
 * 파일 앞쪽만 읽은 모양 → { sheets: [{ name, rows }], active } (rows = 칸 값 2차원 배열, 0 기준).
 * HTML 위장 .xls 는 통째로 읽는다(작다). 알 수 없는 형식은 확장자로 한 번 더 보고, 그래도 아니면 예외.
 */
export function peekBook(X, bytes, fileName = '', rows = PEEK_ROWS) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let fmt = detectFormat(u8);
    if (fmt === FORMAT.UNKNOWN) {
        const ext = (String(fileName).toLowerCase().match(/\.[^.\\/]+$/) || [''])[0];
        if (ext === '.xlsx' || ext === '.xlsm') fmt = FORMAT.XLSX;
        else if (ext === '.xls') fmt = FORMAT.XLS;
        else throw new Error('엑셀 파일이 아닙니다.');
    }
    if (fmt === FORMAT.HTML) {
        const book = readHtmlBook(u8);
        return {
            active: 0,
            sheets: book.sheetNames.map(n => {
                const ws = book.sheet(n);
                const out = [];
                for (let r = 1; r <= Math.min(ws.maxRow, rows); r++) {
                    const row = [];
                    for (let c = 1; c <= ws.maxCol; c++) row.push(ws.cell(r, c));
                    out.push(row);
                }
                return { name: n, rows: out };
            }),
        };
    }
    const wb = X.read(u8, { type: 'array', sheetRows: rows, cellFormula: false, cellDates: false, cellHTML: false, cellText: false, cellStyles: false });
    const sheets = wb.SheetNames.map(n => {
        const ws = wb.Sheets[n];
        const out = [];
        if (ws) {
            for (const k of Object.keys(ws)) {
                if (k[0] === '!') continue;
                const a = X.utils.decode_cell(k);
                if (!(a.r >= 0 && a.c >= 0) || a.r >= rows) continue;
                while (out.length <= a.r) out.push([]);
                out[a.r][a.c] = normCell(ws[k], fmt, false);
            }
        }
        return { name: n, rows: out.map(r => Array.from(r, v => (v === undefined ? null : v))) };
    });
    let active = 0;
    if (fmt === FORMAT.XLSX) {
        const v = wb.Workbook && wb.Workbook.WBView && wb.Workbook.WBView[0];
        if (v && v.activeTab !== undefined) active = Number(v.activeTab) || 0;
    }
    return { sheets, active: Math.min(Math.max(0, active), Math.max(0, sheets.length - 1)) };
}

const headersOf = (row, fix = clean) => new Set((row || []).filter(v => v !== null && v !== undefined).map(fix));

/** 앞쪽 모양 → 종류(KIND) */
export function classifyPeek(peek) {
    const sheets = (peek && peek.sheets) || [];
    if (!sheets.length) return KIND.UNKNOWN;
    const names = sheets.map(s => s.name);
    if (TEMPLATE_SHEETS.every(n => names.includes(n))) return KIND.ZIKJIN_TEMPLATE;
    const act = sheets[peek.active || 0] || sheets[0];
    const row = (i) => (act.rows && act.rows[i - 1]) || [];
    // 대량입고 양식: 5행 7칸이 정확히 머리글 + 8번째 빈칸
    const h5 = row(TMPL_HEADER_ROW);
    if (TMPL_HEADERS.every((h, i) => clean(h5[i]) === h)) return KIND.ABLY_TEMPLATE;
    // 도착보장출고요청: 2행 머리글(줄바꿈 뺌)
    const h2 = headersOf(row(REQ_HEADER_ROW), v => pyStrip(pyStr(v).replace(/\n/g, '')));
    if (['SKU번호', '입고예정수량', '어드민상품코드'].every(h => h2.has(h))) return KIND.ABLY_REQUEST;
    // 직진 출고요청: 이름에 '직진배송' 이 든 시트가 1행에 상품코드·수량
    for (const s of sheets) {
        if (!s.name.includes('직진배송')) continue;
        const h1 = headersOf((s.rows || [])[0]);
        if (h1.has('상품코드') && h1.has('수량')) return KIND.ZIKJIN_REQUEST;
    }
    // 1단계 결과(재고출고용, 머리글 상품코드·수량 두 칸뿐) — 출고전표로 보지 않는다
    const h1 = headersOf(row(1));
    if (looksLikeStockOut(act.name, [...h1])) return KIND.STOCK_OUT;
    // 어드민 출고전표: 활성 시트 1행에 상품코드·수량
    if (h1.has('상품코드') && h1.has('수량')) return KIND.ADMIN;
    return KIND.UNKNOWN;
}

/**
 * 판정된 파일들 → 지금 화면(플랫폼·단계)의 칸에 넣기.
 * files: [{ name, kind, ... }] (넣은 순서). 같은 칸에 두 파일이면 먼저 것만 넣고 나머지는 안내.
 * @returns {{ assign: {[slot]: file}, notes: string[] }}
 */
export function assignFiles(files, platform, step) {
    const slots = (SLOTS[platform] || {})[step] || {};
    const assign = {};
    const notes = [];
    for (const f of files || []) {
        const slot = Object.keys(slots).find(k => slots[k] === f.kind);
        if (slot) {
            if (assign[slot]) notes.push(`'${f.name}' — ${KIND_LABEL[f.kind]} 파일이 둘이라 앞의 '${assign[slot].name}' 만 넣었습니다.`);
            else assign[slot] = f;
            continue;
        }
        if (f.kind === KIND.STOCK_OUT) { notes.push(`'${f.name}' — ${STOCK_OUT_MSG}`); continue; }
        if (f.kind === KIND.UNKNOWN) { notes.push(`'${f.name}' — 어떤 파일인지 알 수 없어 넣지 않았습니다(칸에 직접 넣어 주세요).`); continue; }
        const other = PLATFORM_OF[f.kind];
        if (other && other !== platform) {
            notes.push(`'${f.name}' — ${KIND_LABEL[f.kind]} 입니다. [${other === 'ably' ? '에이블리' : '직진배송'}] 탭에 넣어 주세요.`);
        } else {
            notes.push(`'${f.name}' — ${KIND_LABEL[f.kind]} 는 ${step}단계에 쓰지 않습니다.`);
        }
    }
    return { assign, notes };
}
