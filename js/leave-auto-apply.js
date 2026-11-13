// === js/leave-auto-apply.js ===
// 예약 근태 자동 적용(2026-11-12).
//   근태 설정에서 외출·조퇴를 지금보다 늦은 시각으로 등록하면, 그 시각이 됐을 때 아직 업무 중인 기록을
//   예정 시각으로 끝낸다. 점심 자동 일시정지(js/app-lifecycle.js)처럼 '열려 있는 아무 브라우저나' 돌린다.
//   여러 PC 가 같은 분에 돌려도 forceEndMemberWork 가 트랜잭션으로 서버 값을 다시 읽어 한 번만 끝내고,
//   한 사람이 실패해도 다른 사람은 계속한다.
//   판정은 js/lib/leave-timing.js(dueLeaveCuts) — 한 번 끊고 나면 다시 돌려도 대상이 없다.

import * as State from './state.js?v=202611131153';
import { getCurrentTime } from './utils.js?v=202611131153';
import { isClosingInProgress } from './history-data-manager.js?v=202611131153';
import { dueLeaveCuts, activeLeaveKey } from './lib/leave-timing.js?v=202611131153';

// 돌고 있는 적용(Promise). 이미 돌고 있으면 새로 시작하지 않고 그것을 돌려준다 —
// 마감 확인창(listeners-main.js)의 await 가 매분 틱이 시작한 적용이 끝날 때까지 기다리게.
let inflight = null;

/**
 * 지금 시각이 된 예약 외출·조퇴를 적용한다(진행 중 업무를 예정 시각으로 종료).
 * @returns {Promise<{ended:number, members:number, failed:number}>}
 */
export function applyDueLeaves(now = getCurrentTime()) {
    if (inflight) return inflight;
    inflight = runDueLeaves(now).finally(() => { inflight = null; });
    return inflight;
}

async function runDueLeaves(now) {
    const res = { ended: 0, members: 0, failed: 0 };
    if (isClosingInProgress()) return res;   // 마감 중에는 마감이 기록을 끝낸다
    const cuts = dueLeaveCuts(State.appState.dailyOnLeaveMembers, State.appState.workRecords, now);
    if (!cuts.length) return res;
    const { forceEndMemberWork } = await import('./app-sync.js?v=202611131153');
    for (const { member, cutTime } of cuts) {
        try {
            const r = await forceEndMemberWork(member, cutTime, { onlyStartedBefore: true });
            if (r && r.ended > 0) { res.ended += r.ended; res.members++; }
        } catch (e) {
            // 오프라인·트랜잭션 충돌 등 — 이 사람만 건너뛰고 다음 분에 다시 본다
            res.failed++;
            console.warn('[예약 근태] 1명 적용 실패:', e && e.code ? e.code : e);
        }
    }
    if (res.ended || res.failed) console.warn(`[예약 근태] ${res.members}명 ${res.ended}건 종료, 실패 ${res.failed}명`);
    return res;
}

/** 지금 근태 중인 사람 집합(바뀌었으면 화면을 다시 그린다). */
export function activeLeaveSignature(now = getCurrentTime()) {
    return activeLeaveKey([
        ...(Array.isArray(State.appState.dailyOnLeaveMembers) ? State.appState.dailyOnLeaveMembers : []),
        ...(Array.isArray(State.appState.dateBasedOnLeaveMembers) ? State.appState.dateBasedOnLeaveMembers : []),
    ], now);
}
