// === js/app-lifecycle.js ===
import * as State from './state.js';
import { getCurrentTime, displayCurrentDate, getTodayDateString, isWeekday, calcElapsedMinutes, formatDuration, showToast } from './utils.js';
import { saveProgress } from './history-data-manager.js';
import { saveStateToFirestore } from './app-data.js';
import { collection, doc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let localLunchPauseExecuted = false;
let localLunchResumeExecuted = false;
let lastCheckedDay = null;

// ✨ 야근 확인 팝업 및 타이머용 변수 추가
let localAutoClosePromptExecuted = false;
let autoCloseTimer = null;

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
    
    const currentUserLower = (State.appState.currentUser || '').toLowerCase();
    const isAdmin = State.appConfig?.memberRoles?.[currentUserLower] === 'admin';
    
    // ✨ 개선: 12:30분 정각이 아니더라도(예: 12:32분 접속) 범위 내라면 안전하게 감지
    const isLunchTime = now >= '12:30' && now < '13:30';
    const isAfterLunch = now >= '13:30';

    if (isTodayWeekday) {
        // --- 1. 점심시간 일시정지 (12:30 ~ 13:29) ---
        // ✨ 개선: 관리자(isAdmin) 조건 삭제! 누구나 접속해 있으면 서버 동기화를 통해 1회만 안전하게 실행
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
        // ✨ 개선: 역시 관리자 조건 삭제. 누군가 13:30 이후에 접속해 있다면 자동 재개
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
    // 5분 윈도우(17:30~17:34)로 백그라운드 탭의 setInterval throttle에 대응.
    // 한 명이 먼저 처리하면 onSnapshot으로 동기화돼 다른 관리자에겐 ongoing.length === 0이 되어
    // 추가 팝업이 뜨지 않음.
    if (isAdmin && isTodayWeekday && now >= '17:30' && now < '17:35' && !localAutoClosePromptExecuted) {
        localAutoClosePromptExecuted = true;

        const ongoingRecords = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');

        if (ongoingRecords.length > 0) {
            const modal = document.getElementById('overtime-prompt-modal');
            const btnContinue = document.getElementById('btn-continue-overtime');
            const btnCloseNow = document.getElementById('btn-close-now');

            if (modal) modal.classList.remove('hidden');

            // 실제 마감: Firestore workRecords 서브컬렉션을 batch.update.
            // (workRecords는 daily_data 문서의 필드가 아니라 별도 서브컬렉션이라
            //  markDataAsDirty/saveStateToFirestore로는 저장되지 않음)
            const executeAutoClose = async () => {
                // 실행 시점에 다시 필터 — 이미 누가 마감했으면 빈 배치(no-op)
                const ongoing = (State.appState.workRecords || []).filter(r => r.status === 'ongoing');
                if (ongoing.length === 0) {
                    if (modal) modal.classList.add('hidden');
                    return;
                }
                try {
                    const colRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'workRecords');
                    const lockColRef = collection(State.db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString(), 'activeLocks');
                    const batch = writeBatch(State.db);
                    ongoing.forEach(rec => {
                        const recRef = doc(colRef, rec.id);
                        const duration = Math.max(0, calcElapsedMinutes(rec.startTime, '17:30', rec.pauses || []));
                        batch.update(recRef, { status: 'completed', endTime: '17:30', duration });
                        // 🛡️ 멤버 잠금 해제
                        if (rec.member) batch.delete(doc(lockColRef, String(rec.member)));
                        // 화면 즉시 갱신용 로컬 미러
                        rec.status = 'completed';
                        rec.endTime = '17:30';
                        rec.duration = duration;
                    });
                    await batch.commit();
                    showToast(`17:30 기준으로 ${ongoing.length}개 업무가 자동 마감되었습니다.`, false);
                } catch (e) {
                    console.error('Auto-close batch error:', e);
                    showToast('업무 자동 마감 중 오류가 발생했습니다. 콘솔을 확인해주세요.', true);
                }
                if (modal) modal.classList.add('hidden');
            };

            // 1. 5분(300,000ms) 대기 타이머 시작
            autoCloseTimer = setTimeout(() => { executeAutoClose(); }, 5 * 60 * 1000);

            // 2. [연장 근무 계속하기]
            if (btnContinue) {
                btnContinue.onclick = () => {
                    clearTimeout(autoCloseTimer);
                    if (modal) modal.classList.add('hidden');
                    showToast('연장 근무가 활성화되었습니다. 퇴근 시 직접 마감해주세요.', false);
                };
            }

            // 3. [지금 마감하기]
            if (btnCloseNow) {
                btnCloseNow.onclick = async () => {
                    clearTimeout(autoCloseTimer);
                    await executeAutoClose();
                };
            }
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

export const autoSaveProgress = async () => {
    // 변경사항이 무시되는 버그를 고치고, 데이터가 실제로 변했을 때만 안전하게 저장 연동
    if (State.isDataDirty) {
        await saveStateToFirestore();
    }
};

export const markDataAsDirty = () => {
    State.setIsDataDirty(true);
};