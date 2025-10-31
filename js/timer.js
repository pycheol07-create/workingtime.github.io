// === js/timer.js ===

import { appState, setAppState } from './store.js';
import { debouncedSaveState } from './api.js';
import { getCurrentTime, formatDuration, calcElapsedMinutes } from './utils.js';
import { showToast } from './utils.js';

let elapsedTimeTimer = null;

/**
 * 1초마다 실행되며 진행 중인 업무의 시간을 업데이트하고
 * 점심시간 자동 정지/재개를 처리합니다.
 * (app.js에서 이동)
 */
const updateElapsedTimes = () => {
  const now = getCurrentTime(); // "HH:MM"

  // 12:30 자동 일시정지 로직
  if (now === '12:30' && !appState.lunchPauseExecuted) {
    appState.lunchPauseExecuted = true; // store.js의 appState 직접 수정
    let tasksPaused = 0;
    const currentTime = getCurrentTime(); 

    (appState.workRecords || []).forEach(record => {
      if (record.status === 'ongoing') {
        record.status = 'paused';
        record.pauses = record.pauses || [];
        record.pauses.push({ start: currentTime, end: null, type: 'lunch' }); 
        tasksPaused++;
      }
    });

    if (tasksPaused > 0) {
      console.log(`Auto-pausing ${tasksPaused} tasks for lunch break at 12:30.`);
      showToast(`점심시간입니다. 진행 중인 ${tasksPaused}개의 업무를 자동 일시정지합니다.`, false);
      debouncedSaveState(); 
    } else {
      debouncedSaveState(); 
    }
  }

  // 13:30 자동 재개 로직
  if (now === '13:30' && !appState.lunchResumeExecuted) {
    appState.lunchResumeExecuted = true; // store.js의 appState 직접 수정
    let tasksResumed = 0;
    const currentTime = getCurrentTime(); 

    (appState.workRecords || []).forEach(record => {
      if (record.status === 'paused') {
        const lastPause = record.pauses?.[record.pauses.length - 1];
        if (lastPause && lastPause.type === 'lunch' && lastPause.end === null) {
          record.status = 'ongoing';
          lastPause.end = currentTime; 
          tasksResumed++;
        }
      }
    });

    if (tasksResumed > 0) {
      console.log(`Auto-resuming ${tasksResumed} tasks after lunch break at 13:30.`);
      showToast(`점심시간 종료. ${tasksResumed}개의 업무를 자동 재개합니다.`, false);
      debouncedSaveState(); 
    } else {
      debouncedSaveState();
    }
  }
  
  // UI의 타이머 텍스트 업데이트
  document.querySelectorAll('.ongoing-duration').forEach(el => {
    try {
      const startTime = el.dataset.startTime;
      if (!startTime) return;

      const status = el.dataset.status;
      const pauses = JSON.parse(el.dataset.pausesJson || '[]'); 
      let currentPauses = pauses || [];

      if (status === 'paused') {
          const lastPause = currentPauses.length > 0 ? currentPauses[currentPauses.length - 1] : null;
          const tempPauses = [
              ...currentPauses.slice(0, -1),
              { start: lastPause?.start || startTime, end: now }
          ];
          const dur = calcElapsedMinutes(startTime, now, tempPauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;

      } else { // status === 'ongoing'
          const dur = calcElapsedMinutes(startTime, now, currentPauses);
          el.textContent = `(진행: ${formatDuration(dur)})`;
      }

    } catch(e) { /* noop */ }
  });

  // 대시보드 '업무진행시간' 업데이트
  const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
  const totalCompletedMinutes = completedRecords.reduce((sum, r) => sum + (r.duration || 0), 0);

  const ongoingLiveRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
  let totalOngoingMinutes = 0;
  ongoingLiveRecords.forEach(rec => {
      totalOngoingMinutes += calcElapsedMinutes(rec.startTime, now, rec.pauses);
  });

  const el = document.getElementById('summary-total-work-time');
  if (el) el.textContent = formatDuration(totalCompletedMinutes + totalOngoingMinutes);
};

/**
 * 1초짜리 타이머를 시작합니다.
 */
export function startElapsedTimer() {
    if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
    elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);
}

/**
 * 1초짜리 타이머를 중지합니다.
 */
export function stopElapsedTimer() {
    if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
    elapsedTimeTimer = null;
}