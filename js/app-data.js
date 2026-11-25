// === js/app-data.js ===
import { getTodayDateString, debounce } from './utils.js?v=202611251101';
import * as State from './state.js?v=202611251101';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js?v=202611251101';

export const generateId = () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

/**
 * 오늘 daily_data 문서에 merge 로 쓴다. **성공하면 true, 못 쓰면 false** 를 돌려준다(예전엔 실패를 삼키고 undefined).
 * 실패 안내 토스트는 여기서 한 번만 띄운다 — 호출한 쪽은 false 면 창을 닫지 않는 등 흐름만 정하면 된다.
 * 기존 호출부(알바 추가·자동저장·검수)는 반환값을 안 보므로 그대로 동작한다.
 * @param {object} updates
 * @param {object} [opts]
 * @param {boolean} [opts.requireOnline]  브라우저가 오프라인이면 쓰지 않고 false (쓰기를 대기열에 넣지 않는다)
 * @param {number}  [opts.timeoutMs]      이 시간 안에 서버 확인이 안 오면 false. 쓰기는 대기열에 남아 연결되면 올라갈 수 있다
 *                                        (같은 값을 다시 저장해도 merge 라 문제없다)
 * @param {string}  [opts.dateKey]        쓸 날짜(YYYY-MM-DD). 없으면 오늘 — 자정을 넘긴 탭이 어제 문서에 마지막 저장을 할 때 쓴다
 */
export async function updateDailyData(updates, opts = {}) {
    if (!State.auth || !State.auth.currentUser) {
        console.warn('Cannot update daily data: User not authenticated.');
        return false;
    }
    if (opts.requireOnline && typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('인터넷 연결이 끊겨 저장하지 못했습니다. 연결을 확인한 뒤 다시 저장해 주세요.', true);
        return false;
    }

    try {
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', opts.dateKey || getTodayDateString());
        const write = setDoc(docRef, updates, { merge: true });
        if (opts.timeoutMs > 0) {
            write.catch(() => {});   // 시간 초과 뒤 늦게 난 오류가 처리 안 된 거부로 남지 않게
            const r = await Promise.race([write.then(() => 'ok'), new Promise(res => setTimeout(() => res('timeout'), opts.timeoutMs))]);
            if (r === 'timeout') {
                showToast('서버 응답이 없어 저장을 확인하지 못했습니다. 연결을 확인한 뒤 다시 저장해 주세요.', true);
                return false;
            }
        } else {
            await write;
        }
        return true;
    } catch (error) {
        console.error('Error updating daily data atomically:', error);
        showToast(`데이터 저장 중 오류가 발생했습니다. 다시 시도해 주세요. (오류 코드: ${(error && error.code) || 'unknown'})`, true);
        return false;
    }
}

/** @param {{ dateKey?: string }} [opts] dateKey 를 주면 그 날짜 문서에 쓴다(없으면 오늘 — js/app-lifecycle.js handleDayRollover) */
export async function saveStateToFirestore({ dateKey } = {}) {
    // ✨ 핵심 방어막: 데이터에 변경 사항이 없으면(dirty가 아니면) 통신을 차단합니다. (쓰기 요금 방어)
    if (!State.isDataDirty) {
        return; 
    }

    const updates = {
        taskQuantities: State.appState.taskQuantities || {},
        onLeaveMembers: State.appState.dailyOnLeaveMembers || [],
        partTimers: State.appState.partTimers || [],
        hiddenGroupIds: State.appState.hiddenGroupIds || [],
        lunchPauseExecuted: State.appState.lunchPauseExecuted || false,
        lunchResumeExecuted: State.appState.lunchResumeExecuted || false,
        confirmedZeroTasks: State.appState.confirmedZeroTasks || [],
        // ⚠️ dailyAttendance는 여기서 쓰지 않는다.
        //  출퇴근(processClockIn/Out)·퇴근취소·업무마감(saveDayDataToHistory)·알바 추가/삭제/이름변경이
        //  각자 dailyAttendance를 직접 저장한다. 1분 자동저장이 근태 전체 객체를 merge로 덮어쓰면,
        //  상태가 아직 갱신 안 된 탭/이전 상태가 마감된 '퇴근'을 다시 '출근'으로 되돌리는 문제가 있어 제외.
        // ⚠️ inspectionList(샘플검수 대기 리스트)도 여기서 쓰지 않는다(2026-11-17) — dailyAttendance 와 같은 이유.
        //  리스트를 바꾸는 곳(검수 저장·개별 추가·패킹에서 만들기·리스트 비우기/삭제·지난 리스트 가져오기)이 각자
        //  runTransaction 으로 서버 값을 읽어 자기 변경만 쓴다. 여기서 화면 State 를 통째로 merge 하면
        //  다른 기기가 방금 넣은 줄이 지워진다(오프라인 대기열에 남은 옛 리스트도 같은 사고). inspectionDone·inspPicked 도 안 쓴다.
    };

    // 저장 완료 후에만 상태 초기화 — 실패했는데 지우면 바뀐 내용이 다음 자동저장에서 빠진다(다음 주기에 다시 시도)
    const ok = await updateDailyData(updates, dateKey ? { dateKey } : {});
    if (ok) State.setIsDataDirty(false);
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);