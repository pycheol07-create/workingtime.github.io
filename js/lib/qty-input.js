// === js/lib/qty-input.js ===
// 처리량 입력칸 값 검사 — 순수 함수(브라우저·Firebase 없음). tests/qty-input.test.js 가 본다.
// 규칙: 빈칸은 0, 0 이상 정수(숫자만)만 받는다. 음수·소수·지수(1e3)·글자는 받지 않는다.
//   badInput: <input type="number"> 의 validity.badInput — 숫자가 아닌 글자를 치면 value 가 '' 로 보여도 true 다.

/** 처리량 칸 → { ok, value }. ok 가 false 면 value 는 0. */
export const parseQtyInput = (raw, badInput = false) => {
    if (badInput) return { ok: false, value: 0 };
    const s = String(raw == null ? '' : raw).trim();
    if (s === '') return { ok: true, value: 0 };
    if (!/^\d+$/.test(s)) return { ok: false, value: 0 };
    const value = Number(s);
    if (!Number.isSafeInteger(value)) return { ok: false, value: 0 };
    return { ok: true, value };
};
