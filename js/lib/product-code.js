// === js/lib/product-code.js ===
// 스캐너(scan.html) 위치지정 모드의 상품코드 형식 판정. 2026-10-19
//
// 2026-10-19 사용자 결정: 위치지정에서는 'S + 숫자 6자리'(예: S550076)만 정상으로 본다.
// 그 밖의 코드는 오류로 알리고, 작업자가 [강제추가]를 눌러야 큐에 들어간다.
// 바코드→상품코드 변환(resolveCode)·숫자 6자리에 'S' 붙이기는 호출하는 쪽에서 먼저 한다.
// 순수 모듈(DOM/Firebase 의존 없음).

export const PRODUCT_CODE_RE = /^S\d{6}$/;

/**
 * 상품코드 정리 + 형식 판정. 앞뒤 공백을 지우고 대문자로 바꾼 뒤 검사한다(소문자 s 도 받음).
 * @param {*} raw
 * @returns {{ ok: boolean, code: string }} code = 정리된 값(ok 가 false 여도 돌려줌)
 */
export function checkProductCode(raw) {
    const code = String(raw == null ? '' : raw).trim().toUpperCase();
    return { ok: PRODUCT_CODE_RE.test(code), code };
}
