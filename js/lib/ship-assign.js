// === js/lib/ship-assign.js ===
// 플랫폼 출고 화면 — 여러 파일을 한꺼번에 끌어다 놓으면 머리글을 보고 칸을 정해 준다(2026-11-10 웹 이식).
//   파일 앞쪽 몇 줄만 읽는다(peekBook). 칸 값은 ship-read 와 같은 규칙(normCell · HTML 은 readHtmlBook).
//   판정은 계산 코드(ship-zikjin·ship-ably)가 실제로 찾는 머리글과 같은 것을 본다 — 판정이 맞아도 계산이 따로 다시 검사한다.
// 순수 모듈(XLSX 는 넘겨받음). 테스트: tests/ship-assign.test.js

import { pyStr, pyStrip, looksLikeStockOut, STOCK_OUT_MSG } from './ship-core.js?v=202611121542';
import { detectFormat, FORMAT, readHtmlBook, normCell } from './ship-read.js?v=202611121542';
import { TEMPLATE_SHEETS } from './ship-zikjin.js?v=202611121542';
import { TMPL_HEADERS, TMPL_HEADER_ROW, REQ_HEADER_ROW } from './ship-ably.js?v=202611121542';

export const KIND = Object.freeze({
    ZIKJIN_REQUEST: 'zikjinRequest',   // 직진 출고요청(GPM)
    ZIKJIN_TEMPLATE: 'zikjinTemplate', // 직진배송출고리스트 원본 — 2026-11-12 부터 칸에 넣지 않는다(양식은 앱 Storage, 안내만)
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
//   직진 2단계에 원본 칸이 없다(2026-11-12) — 양식은 앱에 저장(관리자가 올림), SKU·상품명·옵션은 출고요청에서.
export const ZIKJIN_TEMPLATE_NOTE = '직진배송출고리스트 원본은 이제 넣지 않습니다(양식은 앱에 저장되어 있음) — 양식이 바뀌었으면 관리자가 [설정] › 기본 양식에서 다시 올립니다.';
export const SLOTS = Object.freeze({
    zikjin: { 1: { request: KIND.ZIKJIN_REQUEST }, 2: { admin: KIND.ADMIN, request: KIND.ZIKJIN_REQUEST } },
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

const TAB_NAME = { zikjin: '직진배송', ably: '에이블리' };

/**
 * 판정된 파일들 → 어느 탭·단계로 갈지(2026-11-12 — 올린 파일로 직진·에이블리를 알아보고 저절로 진행).
 *   탭: 출고요청·양식(원본)이 어느 플랫폼 것인지로. 출고전표만 있으면(직진·에이블리 같은 모양) 1단계를 마치고
 *       2단계를 기다리는 탭(pending) — 하나뿐이면 그 탭, 아니면 지금 탭.
 *   단계: 출고전표가 있으면 2단계, 아니고 출고요청이 있으면 1단계, 양식(원본)만이면 2단계(칸에 넣기만).
 *         1단계로 갈 때 같이 넣은 에이블리 양식은 화면이 2단계 칸에 넣어 둔다(js/ship.js dropMany).
 *         직진 원본은 칸이 없어 안내만 한다(assignFiles — ZIKJIN_TEMPLATE_NOTE).
 * @param {Array<{kind}>} files
 * @param {{ tab: 'zikjin'|'ably', pending?: { zikjin?: boolean, ably?: boolean } }} now
 * @returns {{ tab, step: 1|2|null, note: string|null, error: string|null }}  step null = 넣을 파일이 없음(칸을 안 바꿈)
 */
export function routeFiles(files, { tab, pending = {} } = {}) {
    const kinds = new Set((files || []).map(f => f.kind));
    const plats = new Set([...kinds].map(k => PLATFORM_OF[k]).filter(Boolean));
    if (plats.size > 1) return { tab, step: null, note: null, error: '직진배송 파일과 에이블리 파일이 섞여 있습니다 — 한 플랫폼씩 넣어 주세요.' };
    let to = plats.size ? [...plats][0] : null;
    let note = null;
    const hasAdmin = kinds.has(KIND.ADMIN);
    if (!to) {
        if (!hasAdmin) return { tab, step: null, note: null, error: null };
        const waiting = ['zikjin', 'ably'].filter(p => pending[p]);
        to = waiting.length === 1 ? waiting[0] : (TAB_NAME[tab] ? tab : 'zikjin');
        if (waiting.length !== 1) note = `출고전표만으로는 직진·에이블리를 가릴 수 없어 지금 탭(${TAB_NAME[to]})에 넣었습니다 — 다르면 탭을 바꿔 다시 넣어 주세요.`;
    }
    const request = to === 'zikjin' ? KIND.ZIKJIN_REQUEST : KIND.ABLY_REQUEST;
    let step;
    if (hasAdmin) step = 2;
    else if (kinds.has(request)) step = 1;
    else if (kinds.has(KIND.ZIKJIN_TEMPLATE) || kinds.has(KIND.ABLY_TEMPLATE)) step = 2;
    else step = null;
    return { tab: to, step, note, error: null };
}

/**
 * 판정된 파일들 → 지금 화면(플랫폼·단계)의 칸에 넣기.
 * files: [{ name, kind, ... }] (넣은 순서). 같은 칸에 두 파일이면 먼저 것만 넣고 나머지는 안내.
 * opts.screen: 기존 방식 화면(직진·에이블리 따로, js/lib/ship-flow.js modeView)이면 true — 다른 쪽 파일 안내를 '그 화면으로 바꾸라'로.
 *   (넣지 않는 것은 같다. 화면을 저절로 바꾸지 않는다)
 * @returns {{ assign: {[slot]: file}, notes: string[] }}
 */
export function assignFiles(files, platform, step, opts = {}) {
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
        // 직진 원본 안내는 직진일 때만 — 에이블리 화면이면 아래 '다른 쪽 파일' 안내
        if (f.kind === KIND.ZIKJIN_TEMPLATE && platform === 'zikjin') { notes.push(`'${f.name}' — ${ZIKJIN_TEMPLATE_NOTE}`); continue; }
        if (f.kind === KIND.UNKNOWN) { notes.push(`'${f.name}' — 어떤 파일인지 알 수 없어 넣지 않았습니다(칸에 직접 넣어 주세요).`); continue; }
        const other = PLATFORM_OF[f.kind];
        if (other && other !== platform) {
            const nm = other === 'ably' ? '에이블리' : '직진배송';
            notes.push(opts.screen
                ? `'${f.name}' — 이 파일은 ${nm} 파일 같습니다(${KIND_LABEL[f.kind]}). 이 화면(${TAB_NAME[platform] || platform})에는 넣지 않았습니다 — 위쪽 [통합으로 돌아가기]를 누르거나 [개별 선택] › ${nm} 화면에서 넣어 주세요.`
                : `'${f.name}' — ${KIND_LABEL[f.kind]} 입니다. 이번에 넣은 ${TAB_NAME[platform] || platform} 쪽에는 넣지 않았습니다 — 이 파일만 따로 놓아 주세요.`);
        } else {
            notes.push(`'${f.name}' — ${KIND_LABEL[f.kind]} 는 ${step}단계에 쓰지 않습니다.`);
        }
    }
    return { assign, notes };
}
