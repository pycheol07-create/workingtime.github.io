// === js/lib/mibal2-access.js ===
// 신규 미발계산기(china-mibal2.html) 입장 판정 — 순수 함수(DOM/Firebase 없음). 2026-10-27.
// 표준 권한 계산(js/lib/perm.js resolve·can — js/page-gate.js 와 같은 것)을 그대로 쓴다.
//   관리자이거나 'china.mibal2' 기능이 있으면 들어간다. 퇴사자·명단 밖·기능 없음은 막는다.
// tests/mibal2-access.test.js 가 본다.
import { resolve, can } from './perm.js?v=202610280933';

export const MIBAL2_FEATURE = 'china.mibal2';
export const MIBAL2_DENIED_MSG = '이 화면을 볼 권한이 없습니다 — 관리자에게 요청하세요';

/** mainConfig 데이터 + 로그인 이메일 → { ok, isAdmin } */
export function mibal2Access(cfg, email) {
    const r = resolve(cfg || {}, email);
    return { ok: !!(r.isAdmin || can(r, MIBAL2_FEATURE)), isAdmin: !!r.isAdmin };
}
