// === js/app-lifecycle.js ===
import * as State from './state.js';
import { getCurrentTime, displayCurrentDate, getTodayDateString, isWeekday, calcElapsedMinutes, formatDuration, showToast } from './utils.js';
import { saveProgress } from './history-data-manager.js';
import { saveStateToFirestore } from './app-data.js';

let localLunchPauseExecuted = false;
let localLunchResumeExecuted = false;
let lastCheckedDay = null;

// ✨ 야근 확인 팝업 및 타이머용 변수 추가
let localAutoClosePromptExecuted = false;
let autoCloseTimer = null;

// ✨ 데이터 로딩 경합 방지를 위한 앱 시작 시간 기록
let appLoadTime = Date.now();

export const updateElapsedTimes = async () => {
    const now = getCurrentTime();
    displayCurrentDate();
    
    const todayDate = getTodayDateString();
    const isTodayWeekday = isWeekday(todayDate);
    
    // 날짜가 바뀌면(자정) 잠금장치 스스로 초기화
    if (lastCheckedDay !== todayDate) {
        localLunchPauseExecuted = false;
        localLunchResumeExecuted = false;
        
        // ✨ 다음 날을 위해 야근 팝업 잠금장치 초기화
        localAutoClosePromptExecuted = false; 
        if (autoCloseTimer) clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        
        lastCheckedDay = todayDate;
    }
    
    // ✨ 수정 1: 이름이 아닌 이미 저장된 권한 상태를 바탕으로 관리자 여부 판별
    const isAdmin = State.appState.currentUserRole === 'admin';
    
    // 12:30분 정각이 아니더라도 범위 내라면 감지
    const isLunchTime = now >= '12:30' && now < '13:30';
    const isAfterLunch = now >= '13:30';

    // ✨ 수정 2: 앱 실행 직후 3초 동안은 서버에서 데이터를 불러오는 중이므로 자동화 기능 대기
    const isDataReady = (Date.now() - appLoadTime > 3000) && State.appState.currentUser;

    if (isTodayWeekday && isDataReady) {
        // --- 1. 점심시간 일시정지 (12:30 ~ 13:29) ---
        if (isLunchTime && !localLunchPauseExecuted && !State.appState.lunchPauseExecuted) {
            localLunchPauseExecuted = true; 
            
            if (State.context.autoPauseForLunch) {
                try {
                    const tasksPaused = await State.context.autoPauseForLunch();
                    if (tasksPaused > 0) showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
                } catch (e) { console.error("Error during auto-pause: ", e); }
            }
        }

        // --- 2. 점심시간 재개 (13:30 이후) ---
        if (isAfterLunch && !localLunchResumeExecuted && !State.appState.lunchResumeExecuted) {
            localLunchResumeExecuted = true;
            
            if (State.context.autoResumeFromLunch) {
                try {
                    const tasksResumed = await State.context.autoResumeFromLunch();
                    if (tasksResumed > 0) showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
                } catch (e) { console.error("Error during auto-resume: ", e); }
            }
        }
    }

    // ✨ 핵심 방어막 3: 17:30 퇴근 시간 감지 및 야근 확인 팝업 (관리자 전용)
    // 데이터를 완전히 불러온 상태(isDataReady)일 때만 실행되도록 보호합니다.
    if (isAdmin && isTodayWeekday && now === '17:30' && !localAutoClosePromptExecuted && isDataReady) {
        localAutoClosePromptExecuted = true;
        
        // 현재 진행 중인 업무 찾기
        const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');
        
        // 진행 중인 업무가 있을 때만 팝업 띄우기
        if (ongoingRecords.length > 0) {
            const modal = document.getElementById('overtime-prompt-modal');
            const btnContinue = document.getElementById('btn-continue-overtime');
            const btnCloseNow = document.getElementById('btn-close-now');
            
            if (modal) modal.classList.remove('hidden');

            // 실제 마감을 수행하는 함수 (진행 중인 업무를 17:30으로 마감)
            const executeAutoClose = () => {
                ongoingRecords.forEach(rec => {
                    rec.status = 'completed';
                    rec.endTime = '17:30';
                    const totalMins = calcElapsedMinutes(rec.startTime, '17:30', rec.pauses || []);
                    rec.duration = totalMins > 0 ? totalMins : 0;
                });
                
                markDataAsDirty(); // 데이터 변경 알림 (서버에 딱 1번 저장됨)
                showToast('응답이 없어 17:30 기준으로 모든 업무가 자동 마감되었습니다.', true);
                if (modal) modal.classList.add('hidden');
            };

            // 1. 5분(300,000ms) 대기 타이머 시작
            autoCloseTimer = setTimeout(() => {
                executeAutoClose();
            }, 5 * 60 * 1000);

            // 2. [연장 근무 계속하기] 버튼 클릭 시
            if (btnContinue) {
                btnContinue.onclick = () => {
                    clearTimeout(autoCloseTimer); // 타이머 폭탄 해제!
                    if (modal) modal.classList.add('hidden');
                    showToast('연장 근무가 활성화되었습니다. 퇴근 시 직접 마감해주세요.', false);
                };
            }

            // 3. [지금 마감하기] 버튼 클릭 시 (기다리지 않고 즉시 마감)
            if (btnCloseNow) {
                btnCloseNow.onclick = () => {
                    clearTimeout(autoCloseTimer);
                    executeAutoClose();
                };
            }
        }
    }

    // 아래 로직들은 데이터와 무관하게 실시간 시간 계산을 담당하므로 보호막 밖에서 항상 실행됩니다.
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

export const autoSaveProgress = async () => {
    if (State.isDataDirty) {
        await saveStateToFirestore();
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};