// === js/app-data.js ===
import { getTodayDateString, debounce } from './utils.js?v=202610211215';
import * as State from './state.js?v=202610211215';
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { showToast } from './utils.js?v=202610211215';

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
        const docRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
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

export async function saveStateToFirestore() {
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
        inspectionList: State.appState.inspectionList || [] // 🔥 누락 방지를 위해 추가
    };

    // 저장 완료 후에만 상태 초기화 — 실패했는데 지우면 바뀐 내용이 다음 자동저장에서 빠진다(다음 주기에 다시 시도)
    const ok = await updateDailyData(updates);
    if (ok) State.setIsDataDirty(false);
}

export const debouncedSaveState = debounce(saveStateToFirestore, 1000);