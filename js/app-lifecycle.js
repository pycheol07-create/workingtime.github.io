// === js/app-lifecycle.js ===
import * as State from './state.js';
import { getCurrentTime, displayCurrentDate, getTodayDateString, isWeekday, calcElapsedMinutes, formatDuration, showToast } from './utils.js';
import { saveProgress } from './history-data-manager.js';
import { saveStateToFirestore } from './app-data.js';

export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    displayCurrentDate();
    
    const todayDate = getTodayDateString();
    const isTodayWeekday = isWeekday(todayDate);
    
    const currentUserLower = (State.appState.currentUser || '').toLowerCase();
    const isAdmin = State.appConfig?.memberRoles?.[currentUserLower] === 'admin';
    
    if (isTodayWeekday && now === '12:30' && !State.appState.lunchPauseExecuted) {
        State.appState.lunchPauseExecuted = true;
        if (isAdmin && State.context.autoPauseForLunch) {
            try {
                const tasksPaused = await State.context.autoPauseForLunch();
                if (tasksPaused > 0) showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
            } catch (e) { console.error("Error during auto-pause: ", e); }
            saveStateToFirestore(); 
        }
    }

    if (isTodayWeekday && now === '13:30' && !State.appState.lunchResumeExecuted) {
        State.appState.lunchResumeExecuted = true;
        if (isAdmin && State.context.autoResumeFromLunch) {
            try {
                const tasksResumed = await State.context.autoResumeFromLunch();
                if (tasksResumed > 0) showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
            } catch (e) { console.error("Error during auto-resume: ", e); }
            saveStateToFirestore(); 
        }
    }

    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const startTime = el.dataset.startTime;
            if (!startTime) return;

            const status = el.dataset.status;
            const pauses = JSON.parse(el.dataset.pausesJson || '[]');
            
            if (status === 'paused') {
                const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                const tempPauses = [...pauses.slice(0, -1), { start: lastPause?.start || startTime, end: now }];
                const dur = calcElapsedMinutes(startTime, now, tempPauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;
            } else { 
                const dur = calcElapsedMinutes(startTime, now, pauses);
                el.textContent = `(진행: ${formatDuration(dur)})`;
            }
        } catch (e) { }
    });

    const completedRecords = (State.appState.workRecords || []).filter(r => r.status === 'completed');
    const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);
    const ongoingLiveRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');
    let totalOngoingMinutes = 0;
    ongoingLiveRecords.forEach(rec => {
        totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
    });
    
    const el = document.getElementById('summary-total-work-time');
    if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

export const autoSaveProgress = () => {
    // 🚨 1분마다 떨어지던 최악의 '쓰기(Write) 폭탄' 제거 완료!
    // (진행 데이터는 개별 동작마다 이미 DB에 실시간 저장되고 있으므로, 여기서 전체 이력을 무한 덮어쓰기 할 필요가 100% 없습니다.)
    if (State.isDataDirty) {
        console.log("Auto-save bypassed to block unnecessary Firebase Writes.");
        State.setIsDataDirty(false);
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};