// === js/app-lifecycle.js ===
import * as State from './state.js';
import { getCurrentTime, displayCurrentDate, getTodayDateString, isWeekday, calcElapsedMinutes, formatDuration, showToast } from './utils.js';
import { saveProgress, saveLeaveSchedule } from './history-data-manager.js';
import { saveStateToFirestore } from './app-data.js';

export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    displayCurrentDate();
    
    const todayDate = getTodayDateString();
    const isTodayWeekday = isWeekday(todayDate);
    
    // 점심시간 자동 정지
    if (isTodayWeekday && now === '12:30' && !State.appState.lunchPauseExecuted) {
        State.appState.lunchPauseExecuted = true;
        if (State.context.autoPauseForLunch) {
            try {
                const tasksPaused = await State.context.autoPauseForLunch();
                if (tasksPaused > 0) showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
            } catch (e) { console.error("Error during auto-pause: ", e); }
        }
        saveStateToFirestore(); 
    }

    // 점심시간 자동 재개
    if (isTodayWeekday && now === '13:30' && !State.appState.lunchResumeExecuted) {
        State.appState.lunchResumeExecuted = true;
        if (State.context.autoResumeFromLunch) {
            try {
                const tasksResumed = await State.context.autoResumeFromLunch();
                if (tasksResumed > 0) showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
            } catch (e) { console.error("Error during auto-resume: ", e); }
        }
        saveStateToFirestore(); 
    }

    // 화면 시간 업데이트
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

    // 총 업무 시간 요약 업데이트
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
    const hasOngoing = (State.appState.workRecords || []).some(r => r.status === 'ongoing');
    if (State.isDataDirty || hasOngoing) {
        saveProgress(true); 
        State.setIsDataDirty(false);
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};