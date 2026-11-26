// === js/lib/supplies-units.js — 비품 입출고 단위·바코드(순수, node 시험 tests/supplies-units.test.js) ===
// 비품관리 앱 기준 전환 2단계(2026-11-26). 비품 상세에서 미리 정해 두는 칸:
//   barcodes    : ['8801234567890', …]   0~5개, 1~40자, 영문·숫자·_- 만. 비품끼리·한 비품 안에서 겹치면 안 된다(대소문자 무시).
//   units       : [{ name:'박스', qty:500 }, …]  최대 4개. qty = 기본 단위(기존 unit 칸, 예: 장) 몇 개인지(정수 1~1,000,000).
//                 낱개(qty 1, 이름 = 기본 단위)는 늘 있는 단위로 본다 — units 에 qty 1 을 따로 두면 그 이름이 낱개 단추가 된다.
//   noSingleOut : 출고(사용) 때 낱개(qty 1) 단추를 숨긴다(박스 단위로만 꺼내는 비품).
//   favorite    : 자주 쓰는 비품 표시(입출고 화면 정렬용 — 이번 단계는 저장만).
// 화면(js/supplies.js)은 저장 전에 validateUnits 로 막고, 재고 패널 단추는 unitButtons, 수량 환산은 toBaseQty.

export const MAX_BARCODES = 5;
export const MAX_UNITS = 4;
export const MAX_UNIT_QTY = 1000000;
const BARCODE_RE = /^[A-Za-z0-9_-]{1,40}$/;

const str = (v) => (v == null ? '' : String(v)).trim();
const baseName = (it) => str(it && it.unit) || '개';

/** 저장된 비품 → { barcodes, units, noSingleOut, favorite } (빈 칸·빈 줄은 뺀다. 모양 검사는 validateUnits) */
export function normalizeItemUnits(it) {
    const src = it || {};
    const barcodes = (Array.isArray(src.barcodes) ? src.barcodes : []).map(str).filter(Boolean);
    const units = (Array.isArray(src.units) ? src.units : [])
        .map(u => ({ name: str(u && u.name), qty: u && u.qty != null && str(u.qty) !== '' ? Number(u.qty) : NaN }))
        .filter(u => u.name !== '' || Number.isFinite(u.qty));
    return { barcodes, units, noSingleOut: src.noSingleOut === true, favorite: src.favorite === true };
}

/**
 * 저장 전 검사 — 오류 글 목록(비었으면 통과). it = 저장하려는 비품(id·unit·barcodes·units·noSingleOut), allItems = 지금 비품 전체
 * @returns {string[]}
 */
export function validateUnits(it, allItems) {
    const errs = [];
    const n = normalizeItemUnits(it);
    if (n.barcodes.length > MAX_BARCODES) errs.push(`바코드는 ${MAX_BARCODES}개까지 넣을 수 있습니다.`);
    const seen = new Set();
    for (const b of n.barcodes) {
        if (!BARCODE_RE.test(b)) { errs.push(`바코드 '${b.slice(0, 40)}'는 영문·숫자·_- 로 40자까지만 됩니다.`); continue; }
        const k = b.toUpperCase();
        if (seen.has(k)) errs.push(`바코드 '${b}'를 두 번 넣었습니다.`);
        seen.add(k);
    }
    const myId = it && it.id;
    for (const other of Array.isArray(allItems) ? allItems : []) {
        if (!other || (myId != null && other.id === myId)) continue;
        for (const b of normalizeItemUnits(other).barcodes) {
            if (seen.has(b.toUpperCase())) errs.push(`바코드 '${b}'는 '${str(other.name)}' 비품이 이미 씁니다.`);
        }
    }

    if (n.units.length > MAX_UNITS) errs.push(`단위는 ${MAX_UNITS}개까지 넣을 수 있습니다.`);
    const names = new Set(), qtys = new Set();
    const base = baseName(it);
    for (const u of n.units) {
        if (u.name.length < 1 || u.name.length > 10) errs.push('단위 이름은 1~10자로 넣어 주세요.');
        if (!Number.isInteger(u.qty) || u.qty < 1 || u.qty > MAX_UNIT_QTY) {
            errs.push(`'${u.name || '(이름 없음)'}' 단위의 수량은 1~${MAX_UNIT_QTY.toLocaleString()} 사이 정수로 넣어 주세요.`);
            continue;
        }
        if (u.name && names.has(u.name)) errs.push(`단위 이름 '${u.name}'가 겹칩니다.`);
        if (qtys.has(u.qty)) errs.push(`단위 수량 ${u.qty.toLocaleString()}${base}가 겹칩니다.`);
        if (u.name === base && u.qty !== 1) errs.push(`'${u.name}'는 기본 단위 이름이라 1 이 아닌 수량을 줄 수 없습니다.`);
        names.add(u.name); qtys.add(u.qty);
    }
    if (n.noSingleOut && !n.units.some(u => Number.isInteger(u.qty) && u.qty > 1)) {
        errs.push('낱개 출고를 막으려면 2개 이상 묶음 단위를 하나 넣어 주세요.');
    }
    return errs;
}

/**
 * 재고 패널 단위 단추 — [{ name, qty, base }] 수량 작은 것부터. dir = 'in' | 'out' | 'count'
 * 낱개(qty 1)는 늘 있다(units 에 qty 1 이 있으면 그 이름으로). 출고 + noSingleOut 이면 낱개를 뺀다(남는 게 없으면 낱개만 둔다).
 */
export function unitButtons(it, dir) {
    const n = normalizeItemUnits(it);
    const ok = n.units.filter(u => u.name && Number.isInteger(u.qty) && u.qty >= 1 && u.qty <= MAX_UNIT_QTY);
    const byQty = new Map();
    for (const u of ok) if (!byQty.has(u.qty)) byQty.set(u.qty, { name: u.name, qty: u.qty, base: u.qty === 1 });
    if (!byQty.has(1)) byQty.set(1, { name: baseName(it), qty: 1, base: true });
    const all = [...byQty.values()].sort((a, b) => a.qty - b.qty);
    if (dir === 'out' && n.noSingleOut) {
        const rest = all.filter(u => u.qty !== 1);
        if (rest.length) return rest;
    }
    return all;
}

/** 단위 n 개 → 기본 단위 수량(정수). n 은 0 이상 정수(실사는 0 도 된다). 잘못되면 null */
export function toBaseQty(unit, n) {
    const q = Number(unit && unit.qty);
    const c = typeof n === 'string' ? (/^\s*\d+\s*$/.test(n) ? Number(n) : NaN) : Number(n);
    if (!Number.isInteger(q) || q < 1 || !Number.isInteger(c) || c < 0) return null;
    const v = q * c;
    return v > MAX_UNIT_QTY ? null : v;
}

/**
 * 화면용 — 단위 n 개 → { qty } 또는 { error:'format'(0 이상 정수 아님) | 'max'(한 번에 MAX_UNIT_QTY 넘음) }
 * (toBaseQty 와 같은 계산, 넘침을 형식 오류와 나눠 안내하려고)
 */
export function checkBaseQty(unit, n) {
    const q = Number(unit && unit.qty);
    const c = typeof n === 'string' ? (/^\s*\d+\s*$/.test(n) ? Number(n) : NaN) : Number(n);
    if (!Number.isInteger(q) || q < 1 || !Number.isInteger(c) || c < 0) return { error: 'format' };
    const v = q * c;
    return v > MAX_UNIT_QTY ? { error: 'max' } : { qty: v };
}

/** 바코드로 비품 찾기(앞뒤 공백·대소문자 무시) — 없으면 null */
export function findByBarcode(items, code) {
    const k = str(code).toUpperCase();
    if (!k) return null;
    for (const it of Array.isArray(items) ? items : []) {
        if (normalizeItemUnits(it).barcodes.some(b => b.toUpperCase() === k)) return it;
    }
    return null;
}
