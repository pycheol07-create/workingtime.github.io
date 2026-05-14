// === js/app-lifecycle.js ===
import * as State from './state.js';
import { getCurrentTime, displayCurrentDate, getTodayDateString, isWeekday, calcElapsedMinutes, formatDuration, showToast } from './utils.js';
import { saveProgress } from './history-data-manager.js';
import { saveStateToFirestore } from './app-data.js';

// ✨ 서버 동기화 오류를 막기 위한 '브라우저 전용(Local)' 점심시간 잠금 변수
let localLunchPauseExecuted = false;
let localLunchResumeExecuted = false;
let lastCheckedDay = null;

export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    displayCurrentDate();
    
    const todayDate = getTodayDateString();
    const isTodayWeekday = isWeekday(todayDate);
    
    // 날짜가 바뀌면(자정) 잠금장치 스스로 초기화
    if (lastCheckedDay !== todayDate) {
        localLunchPauseExecuted = false;
        localLunchResumeExecuted = false;
        lastCheckedDay = todayDate;
    }
    
    const currentUserLower = (State.appState.currentUser || '').toLowerCase();
    const isAdmin = State.appConfig?.memberRoles?.[currentUserLower] === 'admin';
    
    // 🚨 전역 잠금(DB) 대신 로컬 잠금으로 변경하여 부분 누락 현상 100% 방지
    if (isTodayWeekday && now === '12:30' && !localLunchPauseExecuted) {
        localLunchPauseExecuted = true; 
        if (isAdmin && State.context.autoPauseForLunch) {
            try {
                const tasksPaused = await State.context.autoPauseForLunch();
                if (tasksPaused > 0) showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
            } catch (e) { console.error("Error during auto-pause: ", e); }
        }
    }

    if (isTodayWeekday && now === '13:30' && !localLunchResumeExecuted) {
        localLunchResumeExecuted = true;
        if (isAdmin && State.context.autoResumeFromLunch) {
            try {
                const tasksResumed = await State.context.autoResumeFromLunch();
                if (tasksResumed > 0) showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
            } catch (e) { console.error("Error during auto-resume: ", e); }
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
    if (State.isDataDirty) {
        console.log("Auto-save bypassed to block unnecessary Firebase Writes.");
        State.setIsDataDirty(false);
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};