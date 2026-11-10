// === js/mibal2-gate.js ===
// 신규 부족수량관리 쓰기 덮개(비상 스위치, 2026-11-10) — Firebase 를 import 하지 않는다(받은 함수를 감쌀 뿐).
// 한 벌(모듈 하나)을 js/china-mibal2.js 와 js/china-mibal2-live*.js 가 같이 쓴다(같은 주소로 import → 같은 상태).
//   frozen(조회 전용)으로 시작한다 — 신규 화면이 스위치를 서버에서 읽고 '신규 쓰기'일 때만 풀어 준다(setFrozen(false)).
//   쓰기 함수는 gated(fn) 로 감싼다: 쓸 수 있을 때 = 멈추지 않았거나, 멈추기 전에 시작한 작업(run/enter) 안.
//   진행 중 작업을 중간에 끊으면(스캐너 반영·마감은 여러 단계) 스캐너 자료가 반쯤 바뀐 채 남으므로 끝까지 하게 둔다.

let frozen = true;
let depth = 0;          // 쓸 수 있을 때 시작한 작업 수(run·enter)

const frozenError = () => Object.assign(new Error('비상 전환 중 — 이 화면은 조회 전용입니다(기존 화면에서 작업하세요)'), { code: 'read-only' });

export const isFrozen = () => frozen;
export const isBusy = () => depth > 0;
/** 지금 쓸 수 있나 */
export const allowed = () => !frozen || depth > 0;
export function setFrozen(v) { frozen = !!v; }

/** 작업 시작 — 멈춰 있으면 세지 않는다(그 안의 쓰기는 막힌다). 돌려준 함수를 꼭 한 번 부른다 */
export function enter() {
    if (frozen) return () => {};
    depth++;
    let done = false;
    return () => { if (!done) { done = true; depth--; } };
}
export async function run(fn) {
    const leave = enter();
    try { return await fn(); } finally { leave(); }
}

/** Promise 를 돌려주는 쓰기 함수(setDoc·updateDoc·deleteDoc 등) 덮개 */
export const gated = (fn) => (...a) => (allowed() ? fn(...a) : Promise.reject(frozenError()));

/** writeBatch 덮개 — 만들 때와 commit 때 둘 다 본다 */
export const gatedBatch = (fn) => (...a) => {
    if (!allowed()) throw frozenError();
    const b = fn(...a);
    const commit = b.commit.bind(b);
    b.commit = () => (allowed() ? commit() : Promise.reject(frozenError()));
    return b;
};

/** 시험용 — 상태 되돌리기 */
export function _resetForTest() { frozen = true; depth = 0; }
