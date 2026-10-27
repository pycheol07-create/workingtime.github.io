// === js/lib/inbound-diff.js ===
// 미발계산기(js/china-stock-goods.js) '패킹 대비 입고 오차' — 순수 함수(DOM/Firebase 없음).
// tests/inbound-diff.test.js 가 본다.
//
// 차이 d = 도착수량 − 입고확인. 양수 = 부족입고, 음수 = 과입고.
// src = 'scan'(앱 스캔) | 'manual'(입고확인 칸 수동 입력) | 'none'(입고확인 빈칸 = 미스캔).
//   미스캔은 오차로 세지 않고 따로 센다(통계 필터 includeNoScan 으로 오차에 넣을 수 있다 — 그때 d = 도착수량).
// 저장 문서 ChinaStockGoods_InboundDiff/{shipKey} 모양(firestore.rules 의 hasOnly 와 같다):
//   { shipKey, ships, arrivals, savedAt, savedAtMs, by, trigger, rev, prev?, totals, rows }
//   rows: [{ c, nm, op, sp, a, byShip:{출고일:수량}, q, src, d, u?:1 }]  (u = 오더리스트에 없는 미등록 입고분)
// 공급처는 코드 모양(AA9999)만 남긴다. 원가·단가는 다루지 않는다.

export const SHIP_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SUPPLIER_CODE_RE = /^[A-Z]{2}\d{4}$/;
export const DOC_BYTE_LIMIT = 900000;   // 문서 1MiB 한도 안에서 여유를 둔 상한(china-stock-goods.js MAP_STR_LIMIT 와 같은 값)
export const NO_SUPPLIER = '(코드 없음)';
export const BUNDLE_LABEL = '묶음';
export const DOC_KEYS = ['shipKey', 'ships', 'arrivals', 'savedAt', 'savedAtMs', 'by', 'trigger', 'rev', 'prev', 'totals', 'rows'];

const int = (v) => { const n = parseInt(String(v == null ? '' : v).trim(), 10); return isNaN(n) ? 0 : n; };

/**
 * 표 한 줄의 차이. row = { arrivalQty, confirmed, confSrc? }
 *   입고확인이 빈칸이거나 숫자로 읽히지 않으면 'none'(미스캔), 아니면 confSrc === 'scan' 일 때만 'scan', 그 외 'manual'.
 * → { a, q, d, src }  (src 'none' 이면 q = 0, d = a)
 */
export function diffOf(row) {
    const r = row || {};
    const a = int(r.arrivalQty);
    const blank = isNaN(parseInt(String(r.confirmed == null ? '' : r.confirmed).trim(), 10));
    const src = blank ? 'none' : (r.confSrc === 'scan' ? 'scan' : 'manual');
    const q = src === 'none' ? 0 : int(r.confirmed);
    return { a, q, d: a - q, src };
}

/** 출고일 목록 → 문서 ID. 하나면 그 날짜, 여럿이면 정렬해 '+' 로 잇는다. 모양이 틀린 날짜가 있거나 비면 '' */
export function shipKeyOf(dates) {
    const list = [...new Set((Array.isArray(dates) ? dates : []).map(s => String(s || '').trim()))].filter(Boolean).sort();
    if (!list.length || list.some(s => !SHIP_RE.test(s))) return '';
    return list.join('+');
}

function supplierCode(v) {
    const s = String(v == null ? '' : v).trim().toUpperCase();
    return SUPPLIER_CODE_RE.test(s) ? s : '';
}

/** 행 배열 → 합계(문서 totals 모양) */
export function totalsOf(rows) {
    const t = { n: 0, arr: 0, conf: 0, short: 0, over: 0, errN: 0, noScanN: 0, noScanQ: 0 };
    (rows || []).forEach(r => {
        t.n++; t.arr += r.a || 0; t.conf += r.q || 0;
        if (r.src === 'none') { t.noScanN++; t.noScanQ += r.a || 0; return; }
        if (r.d > 0) { t.short += r.d; t.errN++; } else if (r.d < 0) { t.over += -r.d; t.errN++; }
    });
    return t;
}

/**
 * 지금 표(미발계산기 모드 tableData)로 기록 문서를 만든다.
 *   rows: tableData — { code, name, option, arrivalQty, confirmed, confSrc, byShip, unregistered, unregisteredLoc }
 *   dates: 체크한 출고일들 · arrivalByShip: 출고일 → 본사도착일[] · supplierOf(code) → 공급처 값(코드 모양만 남김)
 *   by: 기록자 이름 · now: Date · trigger: 'pre-reset' | 'manual'
 * 출고일 모양이 틀리면 Error. 도착 0 이면서 미등록이 아닌 줄(위치지정용 덧붙인 줄 등)은 뺀다.
 */
export function buildDiffRecord({ rows, dates, arrivalByShip, supplierOf, by, now, trigger } = {}) {
    const shipKey = shipKeyOf(dates);
    if (!shipKey) throw new Error('출고일 형식이 맞지 않거나 선택된 출고일이 없습니다.');
    const ships = shipKey.split('+');
    const arrSet = new Set();
    ships.forEach(s => ((arrivalByShip || {})[s] || []).forEach(x => { const v = String(x || '').trim(); if (SHIP_RE.test(v)) arrSet.add(v); }));
    const out = [];
    (rows || []).forEach(row => {
        if (!row || row.unregisteredLoc) return;
        const code = String(row.code || '').trim(); if (!code) return;
        const { a, q, d, src } = diffOf(row);
        const u = !!row.unregistered;
        if (a <= 0 && !u) return;
        if (u && q <= 0) return;
        const byShip = {};
        Object.entries(row.byShip || {}).forEach(([s, n]) => { const v = int(n); if (ships.includes(s) && v) byShip[s] = v; });
        const r = { c: code, nm: String(row.name || ''), op: String(row.option || ''), sp: supplierCode(supplierOf ? supplierOf(code) : ''), a, byShip, q, src, d };
        if (u) r.u = 1;
        out.push(r);
    });
    const t = now instanceof Date ? now : new Date(now || Date.now());
    return {
        shipKey, ships, arrivals: [...arrSet].sort(),
        savedAt: t, savedAtMs: t.getTime(),
        by: String(by || ''), trigger: trigger === 'pre-reset' ? 'pre-reset' : 'manual',
        rev: 1, totals: totalsOf(out), rows: out,
    };
}

/** 자동 저장(미발 초기화 직전) 여부 — 앱 스캔 입고가 한 건이라도 있어야 저장한다 */
export function shouldAutoSave(rec) {
    return !!(rec && Array.isArray(rec.rows) && rec.rows.some(r => r.src === 'scan' && (r.q || 0) > 0));
}

/**
 * 같은 shipKey 덮어쓰기. old = 저장돼 있던 문서(없으면 null).
 * → { rec(새 객체, rev = 옛 rev + 1, prev = 옛 합계), confDropped: 새 입고합이 옛 것보다 작음(호출 쪽이 확인창) }
 */
export function mergeRev(old, rec) {
    const next = { ...rec };
    delete next.prev;
    if (!old || !old.totals) { next.rev = 1; return { rec: next, confDropped: false }; }
    const ot = old.totals || {};
    next.rev = (int(old.rev) || 1) + 1;
    next.prev = { arr: int(ot.arr), conf: int(ot.conf), at: Number(old.savedAtMs) || 0 };
    return { rec: next, confDropped: int(rec.totals && rec.totals.conf) < int(ot.conf) };
}

/** UTF-8 바이트 수(JSON 기준 — Firestore 실제 크기의 근사치) */
export function byteSize(obj) {
    const s = JSON.stringify(obj);
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s).length;
    return unescape(encodeURIComponent(s)).length;
}

/** 크기가 한도를 넘으면 행의 nm·op 를 뺀 사본. → { rec, shrunk, size, ok } (ok=false 면 빼고도 넘음) */
export function shrinkIfLarge(rec, limit = DOC_BYTE_LIMIT) {
    let size = byteSize(rec);
    if (size <= limit) return { rec, shrunk: false, size, ok: true };
    const small = { ...rec, rows: (rec.rows || []).map(r => { const x = { ...r }; delete x.nm; delete x.op; return x; }) };
    size = byteSize(small);
    return { rec: small, shrunk: true, size, ok: size <= limit };
}

// ---------------------------------------------------------------------------
// 통계 — records = 저장된 문서 배열. opts = { from?, to?, kind: 'all'|'short'|'over', includeNoScan: bool }
//   패킹 줄: 출고일 하나짜리 문서 → 그 출고일 한 줄.
//            여러 출고일 묶음 → 한 출고일에만 있는 코드는 그 출고일 줄로, 걸친 코드·출고일 없는 미등록분은 '묶음' 줄로.
//   같은 출고일이 여러 문서에 있으면 '앱 스캔 입고가 있는 문서' → '늦게 저장한 문서' 순으로 하나만 쓴다
//   (뒤로 밀린 문서의 줄은 출고일이 하나라도 겹치면 뺀다 — 묶음 줄 포함).
// ---------------------------------------------------------------------------

function shipsOf(rec) {
    return (rec && Array.isArray(rec.ships) && rec.ships.length) ? rec.ships : String((rec && rec.shipKey) || '').split('+').filter(Boolean);
}

/** 같은 출고일이 겹칠 때 어느 문서가 앞서는가 — 스캔 입고 있음 우선, 다음 늦게 저장. 정렬 비교 함수 */
export function recPriority(a, b) {
    return (Number(shouldAutoSave(b)) - Number(shouldAutoSave(a))) || ((Number(b.savedAtMs) || 0) - (Number(a.savedAtMs) || 0));
}

/** 날짜(YYYY-MM-DD)에 days 를 더한다(UTC 계산 — 시간대 영향 없음) */
export function shiftIso(iso, days) {
    const [y, m, d] = String(iso).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
}

/**
 * 기간 조회용 문서 ID 범위. 문서 ID 는 첫 출고일로 시작하므로
 *   start = from − 30일(묶음의 앞 출고일이 기간 앞일 수 있음), end = to + '~'('+' 로 이어진 묶음 ID 도 포함).
 *   빈 값은 '' (그쪽은 제한 없음). 줄 단위 거르기는 collectLines 가 한다.
 */
export function queryRange(from, to) {
    return {
        start: SHIP_RE.test(String(from || '')) ? shiftIso(from, -30) : '',
        end: SHIP_RE.test(String(to || '')) ? to + '~' : '',
    };
}

/** rec 와 출고일이 겹치는 다른 문서(같은 shipKey 는 뺀다) → [{ shipKey, ships, common, hasScan, savedAtMs }] */
export function overlapping(records, rec) {
    const mine = new Set(shipsOf(rec));
    return (records || []).filter(r => r && r.shipKey !== rec.shipKey).map(r => {
        const ships = shipsOf(r);
        return { shipKey: String(r.shipKey || ships.join('+')), ships, common: ships.filter(s => mine.has(s)), hasScan: shouldAutoSave(r), savedAtMs: Number(r.savedAtMs) || 0 };
    }).filter(o => o.common.length).sort((a, b) => a.shipKey.localeCompare(b.shipKey));
}

/** 한 문서 → 패킹 줄들 [{ key, ships, bundle, rows, rec }] */
export function splitRecord(rec) {
    const ships = shipsOf(rec);
    const rows = (rec && rec.rows) || [];
    if (ships.length <= 1) return [{ key: ships[0] || '', ships, bundle: false, rows, rec }];
    const per = {}; const bundle = [];
    rows.forEach(r => {
        const ks = Object.keys(r.byShip || {}).filter(k => (r.byShip[k] || 0) > 0);
        if (ks.length === 1 && ships.includes(ks[0])) (per[ks[0]] = per[ks[0]] || []).push(r);
        else bundle.push(r);
    });
    const lines = ships.filter(s => per[s]).map(s => ({ key: s, ships: [s], bundle: false, rows: per[s], rec }));
    if (bundle.length) lines.push({ key: ships.join('+'), ships, bundle: true, rows: bundle, rec });
    return lines;
}

function inRange(ships, from, to) {
    return ships.some(s => (!from || s >= from) && (!to || s <= to));
}

/** 기간·중복 정리를 거친 패킹 줄 */
export function collectLines(records, opts = {}) {
    const recs = (records || []).filter(r => r && Array.isArray(r.rows)).slice().sort(recPriority);
    const taken = new Set(); const out = [];
    recs.forEach(rec => {
        splitRecord(rec).forEach(l => {
            if (!inRange(l.ships, opts.from, opts.to)) return;
            if (l.ships.some(s => taken.has(s))) return;
            out.push(l);
        });
        shipsOf(rec).forEach(s => taken.add(s));
    });
    return out;
}

/** 통계에서 한 행을 어떻게 보는가 → { err: 오차로 셈?, d, noScan } */
function rowView(r, opts) {
    const noScan = r.src === 'none';
    let d = noScan ? (r.a || 0) : (r.d || 0);
    let err = d !== 0 && (!noScan || !!opts.includeNoScan);
    if (err && opts.kind === 'short' && d < 0) err = false;
    if (err && opts.kind === 'over' && d > 0) err = false;
    return { err, d, noScan, inDen: !noScan || !!opts.includeNoScan };
}

// den = 오차율 분모(도착합). 미스캔을 오차에서 빼면(includeNoScan 꺼짐) 미스캔 행의 도착수량도 분모에서 뺀다.
function emptyAgg() { return { n: 0, arr: 0, conf: 0, errN: 0, short: 0, over: 0, abs: 0, noScanN: 0, noScanQ: 0, den: 0 }; }
function addRow(g, r, v) {
    g.n++; g.arr += r.a || 0; g.conf += r.q || 0;
    if (v.inDen) g.den += r.a || 0;
    if (v.noScan) { g.noScanN++; g.noScanQ += r.a || 0; }
    if (v.err) { g.errN++; g.abs += Math.abs(v.d); if (v.d > 0) g.short += v.d; else g.over += -v.d; }
}
function rateOf(g) { return g.den > 0 ? g.abs / g.den : null; }

/** 1. 패킹별 — 출고일 내림차순 */
export function summarizeByShip(records, opts = {}) {
    return collectLines(records, opts).map(l => {
        const g = emptyAgg();
        l.rows.forEach(r => addRow(g, r, rowView(r, opts)));
        return {
            key: l.key, ships: l.ships, bundle: l.bundle, label: l.bundle ? `${l.ships.join('+')} ${BUNDLE_LABEL}` : l.key,
            arrivals: (l.rec.arrivals || []).slice(), ...g, rate: rateOf(g),
            by: String(l.rec.by || ''), savedAtMs: Number(l.rec.savedAtMs) || 0,
        };
    }).sort((a, b) => b.key.localeCompare(a.key));
}

/** 패킹별 줄들의 전체 요약 — 패킹 수는 출고일 줄만, 묶음 줄은 bundles 로 따로. 오차율 분모는 줄들의 den 합 */
export function overallSummary(lines) {
    const g = { packs: 0, bundles: 0, ...emptyAgg() };
    (lines || []).forEach(l => {
        if (l.bundle) g.bundles++; else g.packs++;
        Object.keys(emptyAgg()).forEach(k => { g[k] += l[k] || 0; });
    });
    return { ...g, rate: rateOf(g) };
}

/** 2. 월별 추이(패킹 줄의 마지막 출고일 기준 YYYY-MM) — 월 오름차순. packs = 출고일 줄 수, bundles = 묶음 줄 수 */
export function monthlyTrend(records, opts = {}) {
    const m = {};
    collectLines(records, opts).forEach(l => {
        const month = l.ships[l.ships.length - 1].slice(0, 7);
        const g = m[month] = m[month] || { month, packs: 0, bundles: 0, ...emptyAgg() };
        if (l.bundle) g.bundles++; else g.packs++;
        l.rows.forEach(r => addRow(g, r, rowView(r, opts)));
    });
    return Object.values(m).map(g => ({ ...g, rate: rateOf(g) })).sort((a, b) => a.month.localeCompare(b.month));
}

/** 3. 상품코드 순위 — 오차가 있는 코드만, |차이| 합 내림차순. limit 0 이면 전부 */
export function topCodes(records, opts = {}, limit = 0) {
    const m = {};
    collectLines(records, opts).forEach(l => l.rows.forEach(r => {
        const v = rowView(r, opts);
        const g = m[r.c] = m[r.c] || { c: r.c, nm: '', op: '', sp: '', packs: 0, ...emptyAgg() };
        if (!g.nm && r.nm) g.nm = r.nm;
        if (!g.op && r.op) g.op = r.op;
        if (!g.sp && r.sp) g.sp = r.sp;
        addRow(g, r, v);
        if (v.err) g.packs++;
    }));
    const list = Object.values(m).filter(g => g.errN > 0).map(g => ({ ...g, rate: rateOf(g) }))
        .sort((a, b) => (b.abs - a.abs) || (b.errN - a.errN) || a.c.localeCompare(b.c));
    return limit > 0 ? list.slice(0, limit) : list;
}

/** 4. 공급처 코드 순위 — 코드만(빈 값은 '(코드 없음)'), |차이| 합 내림차순. 오차 없는 공급처는 뺀다 */
export function bySupplier(records, opts = {}) {
    const m = {};
    collectLines(records, opts).forEach(l => l.rows.forEach(r => {
        const sp = supplierCode(r.sp) || NO_SUPPLIER;
        const v = rowView(r, opts);
        const g = m[sp] = m[sp] || { sp, codes: new Set(), ...emptyAgg() };
        addRow(g, r, v);
        if (v.err) g.codes.add(r.c);
    }));
    return Object.values(m).filter(g => g.errN > 0)
        .map(g => ({ ...g, codes: g.codes.size, rate: rateOf(g) }))
        .sort((a, b) => (b.abs - a.abs) || (b.errN - a.errN) || a.sp.localeCompare(b.sp));
}

const pct = (v) => (v === null || v === undefined) ? '' : (Math.round(v * 1000) / 10).toFixed(1) + '%';
function fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const STATS_TABS = ['ship', 'month', 'code', 'supplier'];
export const STATS_TAB_LABEL = { ship: '패킹별', month: '월별 추이', code: '상품코드 순위', supplier: '공급처 코드 순위' };

/**
 * 탭 하나를 표(2차원 배열, 첫 줄 = 머리글)로. 화면 표와 엑셀 받기가 같이 쓴다.
 *   tab: 'ship' | 'month' | 'code' | 'supplier', data: 해당 함수 결과
 */
export function statsAoa(tab, data) {
    const list = Array.isArray(data) ? data : [];
    if (tab === 'ship') {
        return [['출고일', '입고일', '품목수', '도착합', '입고합', '오차품목수', '부족', '과입고', '오차율', '미스캔(품목)', '미스캔(수량)', '저장자', '시각'],
            ...list.map(r => [r.label, (r.arrivals || []).join(','), r.n, r.arr, r.conf, r.errN, r.short, r.over, pct(r.rate), r.noScanN, r.noScanQ, r.by, fmtTime(r.savedAtMs)])];
    }
    if (tab === 'month') {
        return [['월', '패킹수', '묶음줄', '품목수', '도착합', '입고합', '오차품목수', '부족', '과입고', '오차율', '미스캔(품목)', '미스캔(수량)'],
            ...list.map(r => [r.month, r.packs, r.bundles || 0, r.n, r.arr, r.conf, r.errN, r.short, r.over, pct(r.rate), r.noScanN, r.noScanQ])];
    }
    if (tab === 'code') {
        return [['순위', '상품코드', '상품명', '옵션', '공급처코드', '오차패킹수', '도착합', '입고합', '부족', '과입고', '오차합(|차이|)', '오차율'],
            ...list.map((r, i) => [i + 1, r.c, r.nm, r.op, r.sp || NO_SUPPLIER, r.packs, r.arr, r.conf, r.short, r.over, r.abs, pct(r.rate)])];
    }
    if (tab === 'supplier') {
        return [['순위', '공급처코드', '오차상품수', '오차건수', '도착합', '입고합', '부족', '과입고', '오차합(|차이|)', '오차율'],
            ...list.map((r, i) => [i + 1, r.sp, r.codes, r.errN, r.arr, r.conf, r.short, r.over, r.abs, pct(r.rate)])];
    }
    return [];
}

/** 화면에 띄울 확인창 요약 문구(오차 품목 수·수량, 미스캔) */
export function diffSummaryText(rec) {
    const t = (rec && rec.totals) || totalsOf([]);
    return `오차 ${t.errN.toLocaleString()}품목 (부족 ${t.short.toLocaleString()} · 과입고 ${t.over.toLocaleString()})`
        + ` · 미스캔 ${t.noScanN.toLocaleString()}품목 ${t.noScanQ.toLocaleString()}장`;
}
