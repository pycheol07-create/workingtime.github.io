// === js/lib/sensitive-cols.js ===
// 엑셀 업로드 → Firestore 저장 전 민감 열 거르기. 2026-10-14 보안점검(설계: 보안점검_설계.md)
//
//   · 원가 열(원가·단가·위안·달러·환율·추가항목2 …) → 통째로 버린다.
//   · 공급처 열(공급처·거래처·vendor …) → 값이 '코드 모양'(숫자 포함 영숫자 2~12자)이면 남기고, 아니면(이름) 키를 지운다.
//   · '공급처상품명'·'공급처코드' 는 어느 쪽에도 안 걸린다. 둘 다 걸리면 원가로 본다.
// ⚠️ 패턴은 앱\보안점검\민감열_점검.py 와 같아야 한다 — 한쪽을 바꾸면 같이 바꿀 것.
// 순수 모듈(DOM/Firebase 의존 없음). 값은 밖으로 내지 않는다 — 버린 머리글 이름과 건수만 돌려준다.

const NORM_RE = /[\s​﻿]/g;
export const COST_RE = /원가|매입가|매입단가|공급가|공급단가|구매가|사입가|단가|마진|margin|cost|orgprice|위안|달러|환율|추가항목2/i;
export const SUPPLIER_RE = /공급처|공급사|공급업체|거래처|매입처|vendor|supplier|supply/i;
export const KEEP = new Set(['공급처상품명', '공급처코드']);
export const CODE_LIKE = /^(?=.*\d)[A-Za-z0-9-]{2,12}$/;

/** 머리글 비교용 — 공백·zero-width·BOM 제거 (location.js 업로드 정규화와 같음) */
export const normHeader = (h) => String(h ?? '').replace(NORM_RE, '');

/** 원가 열인가 (KEEP 은 아님) */
export function isCostCol(h) {
    const n = normHeader(h);
    if (!n || KEEP.has(n)) return false;
    return COST_RE.test(n);
}

/** 공급처 열인가 (원가 열이면 원가로 보므로 false) */
export function isSupplierCol(h) {
    const n = normHeader(h);
    if (!n || KEEP.has(n)) return false;
    return !COST_RE.test(n) && SUPPLIER_RE.test(n);
}

/** 머리글 목록·설정에서 아예 빼는 열 (= 원가 열) */
export const isDroppedHeader = (h) => isCostCol(h);

/** 값이 공급처 코드 모양인가 */
export const isCodeLike = (v) => CODE_LIKE.test(String(v ?? '').trim());

/**
 * 한 행(객체)을 정리한 사본을 돌려준다. 원본은 건드리지 않는다.
 * @returns {{out: object, droppedCols: string[], supplierValuesRemoved: number}}
 *   droppedCols — 이 행에서 지운 원가 열 머리글, supplierValuesRemoved — 지운 공급처 '이름' 값 개수(빈 값 제외)
 */
export function cleanRaw(obj) {
    const out = {};
    const droppedCols = [];
    let supplierValuesRemoved = 0;
    if (!obj || typeof obj !== 'object') return { out, droppedCols, supplierValuesRemoved };
    for (const [k, v] of Object.entries(obj)) {
        if (isCostCol(k)) { droppedCols.push(k); continue; }
        if (isSupplierCol(k) && !isCodeLike(v)) {
            if (v !== null && v !== undefined && String(v).trim() !== '') supplierValuesRemoved++;
            continue;
        }
        out[k] = v;
    }
    return { out, droppedCols, supplierValuesRemoved };
}

/** 행의 '공급처코드' 열 값(머리글 정규화 후 비교). 없거나 비었으면 '' — 빈칸확보 공급처 표시에서 먼저 쓴다 */
export function supplierCodeOf(rd) {
    if (!rd || typeof rd !== 'object') return '';
    for (const [k, v] of Object.entries(rd)) {
        if (normHeader(k) !== '공급처코드') continue;
        const s = String(v ?? '').trim();
        if (s) return s;
    }
    return '';
}

/** 여러 행을 정리하고 합계를 돌려준다 — 토스트 문구용 */
export function cleanRows(rows) {
    const dropped = new Set();
    let supplierValuesRemoved = 0;
    const out = (rows || []).map(r => {
        const c = cleanRaw(r);
        c.droppedCols.forEach(h => dropped.add(h));
        supplierValuesRemoved += c.supplierValuesRemoved;
        return c.out;
    });
    return { rows: out, droppedCols: [...dropped], supplierValuesRemoved };
}
