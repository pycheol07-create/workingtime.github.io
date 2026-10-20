// === js/lib/calc-num.js ===
// 통합계산기 숫자 칸 공통 파서·표시 — 순수 함수(브라우저·Firebase 없음).
// calculator/index.html 의 모듈이 window.CalcNum 에 붙이고, calculator/InputControl.js 가 parseNum / parseIntNum 전역으로 감싼다.
// tests/calc-num.test.js 가 본다.
//
// 규칙: 쉼표는 천 단위 구분으로만 받는다 — '1,234' '12,345.6' 은 정상, '0,14' '1,5' '12,34,567' 처럼
//   쉼표 뒤가 정확히 세 자리 묶음이 아니면 NaN(소수점을 쉼표로 친 실수를 1,000 배 값으로 읽지 않게).
//   쉼표가 없으면 parseFloat / parseInt(…, 10) 와 똑같다 → 쉼표 없는 입력은 예전 계산과 결과가 같다.
//   빈칸·글자는 NaN(호출하는 쪽이 예전처럼 || 0 등으로 처리).

export const stripCommas = (v) => String(v ?? '').replace(/,/g, '');

const COMMA_NUM = /^\s*[-+]?\d{1,3}(,\d{3})+(\.\d*)?\s*$/;

/** 쉼표가 있는데 천 단위 묶음 모양이 아니다(예: '0,14') — 입력칸이 빨간 표시를 한다 */
export const hasBadCommas = (v) => {
    if (typeof v === 'number') return false;
    const s = String(v ?? '');
    return s.includes(',') && !COMMA_NUM.test(s);
};

/** 숫자 칸 → 숫자 (parseFloat 와 같고, 올바른 천 단위 쉼표만 무시) */
export const parseNum = (v) => {
    if (typeof v === 'number') return parseFloat(v);
    if (hasBadCommas(v)) return NaN;
    return parseFloat(stripCommas(v));
};

/** 정수 칸 → 정수 (parseInt(v, 10) 와 같고, 올바른 천 단위 쉼표만 무시) */
export const parseIntNum = (v) => {
    if (typeof v === 'number') return parseInt(v, 10);
    if (hasBadCommas(v)) return NaN;
    return parseInt(stripCommas(v), 10);
};

/**
 * 포커스가 빠진 칸에 보이는 글자 — 정수 부분에 천 단위 쉼표. 입력값 자체는 바꾸지 않는다(보이기만).
 * 숫자 모양이 아니거나 쉼표가 잘못 놓였으면(hasBadCommas) 친 글자 그대로 돌려준다. 소수 부분은 그대로.
 */
export const formatThousands = (v) => {
    const s = String(v ?? '');
    if (hasBadCommas(s)) return s;
    const m = /^\s*([-+]?)(\d+)(\.\d*)?\s*$/.exec(stripCommas(s));
    if (!m) return s;
    return m[1] + m[2].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (m[3] || '');
};

/**
 * 환율 칸 중 비어 있는 것 — 0·음수·빈칸·글자(NaN)는 '없음'. 예전엔 `|| 1` 로 1원 환율로 계산했다.
 * rates: { usdKrw: 1350, ... } (숫자 또는 칸 글자 — 글자는 parseNum 규칙), keys: 볼 칸 이름 배열.
 * 돌려주는 값: 비어 있는 키 배열(순서는 keys 그대로). 빈 배열이면 다 있다.
 */
export const missingRateFields = (rates, keys) => {
    const r = rates || {};
    return (keys || []).filter((k) => {
        const raw = r[k];
        const v = typeof raw === 'string' ? parseNum(raw) : raw;
        return !(Number.isFinite(v) && v > 0);
    });
};
