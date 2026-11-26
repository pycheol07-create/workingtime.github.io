// === js/lib/mibal2-filter.js — 부족수량관리(신규) 표 열 필터(2026-11-26 사용자 요청: 예전 화면처럼 모든 열에) ===
// 순수 함수만(시험 tests/mibal2-filter.test.js). 화면 연결은 js/china-mibal2.js(머리글 단추 → js/table-filter.js 떠 있는 목록).
//   · 값 = 화면에 보이는 글자 기준. 숫자는 쉼표 없는 정수 글자, 모르는 값은 '(모름)'.
//   · 입고확인(conf) = '일치' / '불일치' / '(모름)' — 예전 화면([Ver 8.90] 색으로 거르기)과 같이, 칸이 빨간지(입고확인 ≠ 도착)로.
//   · 플래그(flags) = 여러 값 — 고른 플래그 중 하나라도 있으면 통과, 플래그 없는 행은 '(없음)'.
//   · 박스(box) = 여러 값(플래그처럼) — 행의 boxList(js/lib/pack-boxes.js boxesFor 의 list), 없으면 '(없음)'. 목록은 번호 순(A2 < A10).
//   · 저장 모양: null = 전체, [] = 아무것도, { ex: [값…] } = 그 값만 뺀다(2026-11-26 리뷰 — '고른 값만' 으로 두면
//     실시간으로 새로 생긴 값(새 차이·새 코드)의 행이 조용히 숨는다). 목록 창(js/table-filter.js)은 '체크한 값 배열' 을 주고받으므로
//     toStored·toChecked 로 바꾼다. 옛 배열 모양(그 값만)도 그대로 읽는다.
//   · 목록 값은 엑셀처럼 '다른 열 필터를 통과한 행' 에서 뽑는다(그 열 자신의 필터는 빼고).

export const UNKNOWN = '(모름)';
export const NO_FLAG = '(없음)';
export const MATCH = '일치';
export const MISMATCH = '불일치';

const numText = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? UNKNOWN : String(Math.round(Number(v)));

/** 입고확인 일치 여부 — 화면 confCellHtml 의 mismatch 와 같은 식(입고확인 ≠ 도착이면 빨강) */
export function confMatchText(r) {
    if (!r || r.confSrc === undefined) return UNKNOWN;
    return (parseInt(r.conf) || 0) !== (parseInt(r.arr) || 0) ? MISMATCH : MATCH;
}

/** 한 칸의 필터 값. flags 는 배열(여러 값), 그 밖은 글자 하나. flagLabel(f) = 화면 플래그 글자 */
export function filterValueOf(r, key, flagLabel = (f) => f) {
    switch (key) {
        case 'code': case 'name': case 'option': return String(r[key] == null ? '' : r[key]).trim();
        case 'loc': return r.locInfo ? String(r.loc == null ? '' : r.loc) : '미지정';
        case 'conf': return confMatchText(r);
        case 'flags': { const fs = Array.isArray(r.flags) ? r.flags.map(flagLabel) : []; return fs.length ? fs : [NO_FLAG]; }
        case 'box': return Array.isArray(r.boxList) && r.boxList.length ? r.boxList.map(String) : [NO_FLAG];
        default: return numText(r[key]);
    }
}

const passOne = (val, f) => {
    if (f == null) return true;
    if (!Array.isArray(f) && typeof f === 'object' && Array.isArray(f.ex)) {   // 뺀 값만 빼기
        const ex = f.ex.map(String);
        return Array.isArray(val) ? val.some(v => !ex.includes(String(v))) : !ex.includes(String(val));
    }
    const pick = (Array.isArray(f) ? f : [f]).map(String);
    return Array.isArray(val) ? val.some(v => pick.includes(String(v))) : pick.includes(String(val));
};

/** 목록 창이 준 '체크한 값'(null = 전부) → 저장 모양. options = 그때 목록 */
export function toStored(checked, options) {
    if (checked == null) return null;
    if (!checked.length) return [];
    const on = new Set(checked.map(String));
    const ex = (options || []).map(String).filter(v => !on.has(v));
    return ex.length ? { ex } : null;
}
/** 저장 모양 → 목록 창에 줄 '체크한 값'(null = 전부) */
export function toChecked(f, options) {
    if (f == null) return null;
    if (Array.isArray(f)) return f.map(String);
    if (typeof f === 'object' && Array.isArray(f.ex)) {
        const ex = new Set(f.ex.map(String));
        const on = (options || []).map(String).filter(v => !ex.has(v));
        return on.length === (options || []).length ? null : on;
    }
    return [String(f)];
}

/** 행이 모든 열 필터를 통과하나(except = 빼고 볼 열 하나) */
export function rowPasses(r, filters, flagLabel, except = null) {
    for (const [k, f] of Object.entries(filters || {})) {
        if (k === except || f == null) continue;
        if (!passOne(filterValueOf(r, k, flagLabel), f)) return false;
    }
    return true;
}

/** 열 하나의 목록 값(다른 열 필터를 통과한 행에서). 숫자 열은 수 순서, 그 밖은 가나다. '(모름)'·'(없음)'·'미지정'은 맨 뒤 */
export function optionsFor(rows, key, filters, flagLabel) {
    const set = new Set();
    (rows || []).forEach(r => {
        if (!rowPasses(r, filters, flagLabel, key)) return;
        const v = filterValueOf(r, key, flagLabel);
        (Array.isArray(v) ? v : [v]).forEach(x => set.add(String(x)));
    });
    const tail = [UNKNOWN, NO_FLAG, '미지정'];
    const head = [...set].filter(v => !tail.includes(v));
    if (key === 'conf') head.sort((a, b) => (a === MISMATCH ? -1 : b === MISMATCH ? 1 : 0));   // 불일치 먼저
    else if (head.every(v => /^-?\d+$/.test(v))) head.sort((a, b) => Number(a) - Number(b));
    else if (key === 'box') head.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true }));   // 박스 번호 순(A2 < A10, -1: 3 < -2: 1)
    else head.sort((a, b) => a.localeCompare(b, 'ko'));
    return [...head, ...tail.filter(v => set.has(v))];
}

/** 걸려 있는 열 필터 수 */
export const activeFilterCount = (filters) => Object.values(filters || {}).filter(f => f != null).length;
