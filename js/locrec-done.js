// === js/locrec-done.js ===
// 대시보드 '오늘 업무 처리량' — 로케이션 동선관리 실적 = 오늘 변경 추천 표에서 '완료'로 표시한 건수(2026-11-25 사용자 요청).
//   예전에는 다른 업무처럼 '쓴 시간 × 기준 속도'로 어림했다. 표에 실제 완료가 남으니 그 숫자를 쓴다.
// 💰 구독하지 않는다 — locRecWork/marks 한 문서를 getDoc 으로 읽고 TTL_MS 동안 기억한다(대시보드에 상시 구독을 두지 않는 규칙, js/locrec-dash.js).
//   카드가 이 업무를 그릴 때만 읽는다(ui-main-dashboard.js). 대시보드 변경 추천 창을 닫으면 invalidate 로 다시 읽게 한다.
// 읽기는 등록 직원 전원(firestore.rules — locRecWork 는 쓰기만 기능으로 막는다). 못 읽으면 null → 카드는 예전처럼 시간 어림.
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MARKS_PATH = 'artifacts/team-work-logger-v2/locRecWork/marks';
export const TTL_MS = 3 * 60 * 1000;

let marks = null;       // 마지막으로 읽은 marks (못 읽었으면 null)
let at = 0;             // 마지막으로 읽으려 한 시각(실패해도 TTL 동안 다시 안 읽는다)
let pending = null;
let viewMod = null;     // lib/locrec-view.js (처음 읽을 때 같이 싣는다)
const listeners = new Set();   // 값이 바뀌면 부를 함수(대시보드 카드) — 누가 읽기를 시작했든 모두 부른다

/** 오늘 완료 건수 — 아직 못 읽었거나 실패면 null */
export function locRecDoneToday() {
    if (!marks || !viewMod) return null;
    try { return viewMod.doneCountToday(marks, viewMod.dayKey(Date.now())); } catch (e) { return null; }
}

/** TTL 이 지났으면 다시 읽는다. 새 값을 받으면 onChange(). → 읽기가 끝나면 풀리는 Promise(안 읽으면 바로 풀림 — 처리량 창이 기다린다) */
export function refreshLocRecDone(onChange) {
    if (typeof onChange === 'function') listeners.add(onChange);
    if (pending) return pending;
    if (at && Date.now() - at < TTL_MS) return Promise.resolve();
    if (!State.db || !State.auth || !State.auth.currentUser) return Promise.resolve();
    at = Date.now();
    const before = locRecDoneToday();
    pending = Promise.all([
        getDoc(doc(State.db, MARKS_PATH)),
        viewMod ? Promise.resolve(viewMod) : import('./lib/locrec-view.js?v=e93900011313-fdf32cdb')
    ]).then(([snap, v]) => {
        viewMod = v;
        const d = snap.exists() ? (snap.data({ serverTimestamps: 'estimate' }) || {}) : {};
        marks = (d.marks && typeof d.marks === 'object') ? d.marks : {};
        // 사본으로 돈다 — 부른 함수가 그리면서 다시 등록해도 이번 차례에는 안 부른다(Set.forEach 는 새로 넣은 것까지 돌아 멈췄다, 2026-11-25)
        if (locRecDoneToday() !== before) [...listeners].forEach(fn => { try { fn(); } catch (e) { /* 그리기 실패는 무시 */ } });
    }).catch(e => {
        console.warn('[locrec] 오늘 완료 건수를 읽지 못했습니다', (e && e.code) || '');
    }).finally(() => { pending = null; });
    return pending;
}

/** 다음 그리기 때 다시 읽게(대시보드 변경 추천 창을 닫을 때) */
export function invalidateLocRecDone() { at = 0; }
