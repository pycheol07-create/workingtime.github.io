// === js/lib/mibal-formula-guard.js ===
// 미발계산기 미발수량 공식(mibalFormula) 화이트리스트 검사. 2026-10-14 보안점검(설계: 보안점검_설계.md 3절)
//
// 공식은 new Function 으로 실행되므로, 실행 전에 '계산식'만 들어 있는지 확인한다.
//   허용: 숫자 · 공백 · + - * / % ( ) < > = ! ? : & | , · 변수 이름(allowedVars) · Math.max/min/round/floor/ceil/abs
//   거부: 대괄호 · 따옴표 · 백틱 · 세미콜론 · 중괄호 · 역슬래시 · '=>' · 그 밖의 이름(this·constructor·alert·window 등)
// 순수 모듈(DOM/Firebase 의존 없음).

const MATH_FNS = new Set(['max', 'min', 'round', 'floor', 'ceil', 'abs']);
const FORBIDDEN = /[\[\]'"`;{}\\]|=>/;
const ID = '[\\p{L}_$][\\p{L}\\p{N}_$]*';
// 공백 | 숫자 | 이름(점으로 이어진 것 포함) | 연산자 한 글자
const TOKEN_RE = new RegExp(`(\\s+)|(\\d+(?:\\.\\d+)?|\\.\\d+)|(${ID}(?:\\s*\\.\\s*${ID})*)|([+\\-*/%()<>=!?:&|,])`, 'uy');

/**
 * @param {string} expr 공식 문자열
 * @param {Iterable<string>} allowedVars 쓸 수 있는 변수 이름(기본 변수 + 추가 변수 + 계산 변수)
 * @returns {boolean} 계산식으로만 이루어져 있으면 true
 */
export function isSafeMibalFormula(expr, allowedVars) {
    if (typeof expr !== 'string' || !expr.trim() || expr.length > 2000) return false;
    if (FORBIDDEN.test(expr)) return false;
    const vars = new Set(allowedVars || []);
    TOKEN_RE.lastIndex = 0;
    let pos = 0;
    while (pos < expr.length) {
        TOKEN_RE.lastIndex = pos;
        const m = TOKEN_RE.exec(expr);
        if (!m) return false; // 허용 안 된 글자
        const name = m[3];
        if (name !== undefined) {
            const parts = name.split('.').map(s => s.trim());
            if (parts.length === 1) {
                if (!vars.has(parts[0])) return false;
            } else if (!(parts.length === 2 && parts[0] === 'Math' && MATH_FNS.has(parts[1]))) {
                return false;
            }
        }
        pos = TOKEN_RE.lastIndex;
    }
    return true;
}
