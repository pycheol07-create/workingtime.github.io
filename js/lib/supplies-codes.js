// === js/lib/supplies-codes.js — 비품코드(items[].ezCode) 자동 번호·중복 검사(순수, node 시험 tests/supplies-codes.test.js) ===
// 2026-11-27 비품관리 앱 기준 전환 뒤 — 코드 없는 비품에 'SP' + 4자리 일련번호(SP0001…)를 붙인다.
//   번호 = 이미 쓰인 SP 번호의 최댓값 + 1부터. 기존 코드(숫자 6자리·영문1+숫자6 등)는 그대로 둔다.
//   칸 이름은 ezCode 그대로(앱\비품재고연동 발주알림.py·연동.py 가 읽는다). 화면 이름만 '비품코드'.
//   한 칸에 쉼표로 여러 코드가 들어 있을 수 있다(옛 화면 안내) — 중복 검사·최댓값은 쉼표로 나눠 본다.
// 같은 규칙의 파이썬 사본: 앱\비품재고연동\비품코드_채우기.py(기존 빈 비품 한 번 채우기) — 한쪽만 바꾸지 말 것.

export const SP_PREFIX = 'SP';
export const SP_DIGITS = 4;
export const SP_CODE_RE = /^SP(\d{4,})$/;

/** 비교용 코드 — 공백을 모두 빼고 대문자 */
export const normCode = (v) => (v == null ? '' : String(v)).replace(/\s+/g, '').toUpperCase();

/** 칸 값 → 비교용 코드 목록(쉼표로 나눔, 빈 것 뺌) */
export const codesOf = (v) => (v == null ? '' : String(v)).split(',').map(normCode).filter(Boolean);

/** 코드가 비어 있나(공백·쉼표뿐이어도 빈 것) */
export const isBlankCode = (v) => codesOf(v).length === 0;

/**
 * 이지어드민 품목코드인가 — 비었거나 앱이 붙인 SP 번호(SP + 숫자 4자리 이상)면 false.
 * 앱\비품재고연동 연동.py 코드()·예측규칙.py 코드판정 과 같은 규칙(앞뒤 공백만 빼고 대문자로 통째 비교) — 한쪽만 바꾸지 말 것.
 */
export const isEzCode = (v) => {
    const c = (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) ? String(v).trim().toUpperCase() : '';
    return !!c && !SP_CODE_RE.test(c);
};

/** 코드 칸을 바꿨나 — 비교용(쉼표로 나눠 공백 빼고 대문자)으로 같으면 false */
export const codeChanged = (before, after) => codesOf(before).join(',') !== codesOf(after).join(',');

/** 이미 쓰인 SP 번호의 최댓값(없으면 0) */
export function maxSpNumber(items) {
    let max = 0;
    for (const it of Array.isArray(items) ? items : []) {
        if (!it) continue;
        for (const c of codesOf(it.ezCode)) {
            const m = SP_CODE_RE.exec(c);
            if (m) max = Math.max(max, Number(m[1]));
        }
    }
    return max;
}

export const spCode = (n) => SP_PREFIX + String(n).padStart(SP_DIGITS, '0');

/** 다음 SP 코드 n 개(최댓값 + 1 부터 차례로). n 이 0 이하면 [] */
export function nextSupplyCodes(items, n = 1) {
    const k = Math.max(0, Math.trunc(Number(n) || 0));
    const start = maxSpNumber(items) + 1;
    return Array.from({ length: k }, (_, i) => spCode(start + i));
}

/**
 * 코드가 빈 비품에 차례로 SP 코드를 붙인다(배열 순서대로). 원본은 바꾸지 않는다.
 * @returns {{ items: object[], assigned: { id, name, code }[] }} items = 새 배열(바뀐 비품만 사본, 나머지는 같은 객체)
 */
export function assignMissingCodes(items) {
    const src = Array.isArray(items) ? items : [];
    const blanks = src.filter(it => it && isBlankCode(it.ezCode));
    const codes = nextSupplyCodes(src, blanks.length);
    const assigned = [];
    let i = 0;
    const out = src.map(it => {
        if (!it || !isBlankCode(it.ezCode)) return it;
        const code = codes[i++];
        assigned.push({ id: it.id, name: it.name, code });
        return { ...it, ezCode: code };
    });
    return { items: out, assigned };
}

/**
 * 코드 겹침 — code(쉼표로 여러 개 가능)가 selfId 가 아닌 다른 비품의 코드와 겹치면 { code, item }, 아니면 null.
 * 같은 칸 안에서 같은 코드를 두 번 쓴 것도 겹침(item = null).
 */
export function findDuplicateCode(items, code, selfId) {
    const mine = codesOf(code);
    const seen = new Set();
    for (const c of mine) {
        if (seen.has(c)) return { code: c, item: null };
        seen.add(c);
    }
    if (!mine.length) return null;
    for (const it of Array.isArray(items) ? items : []) {
        if (!it || (selfId != null && it.id === selfId)) continue;
        const theirs = codesOf(it.ezCode);
        const hit = mine.find(c => theirs.includes(c));
        if (hit) return { code: hit, item: it };
    }
    return null;
}
