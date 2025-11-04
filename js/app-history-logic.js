// === app-history-logic.js (이력, 마감, 저장, 엑셀 관련 로직) ===

import {
    appState, appConfig, db, auth, 
    allHistoryData, // ✅ app.js에서 export
    context, // 👈 [수정] context 객체 import
    
    // DOM Elements (app.js에서 가져옴)
    historyDateList, historyTabs, attendanceHistoryTabs, 
    historyViewContainer, attendanceHistoryViewContainer, 
    // 👈 [수정] 3개 패널 import
    workHistoryPanel, attendanceHistoryPanel, trendAnalysisPanel, 
    historyAttendanceDailyView, historyAttendanceWeeklyView, historyAttendanceMonthlyView,
    deleteHistoryModal,
    quantityModal,

    // Core Functions (app.js에서 가져옴)
    render, debouncedSaveState, saveStateToFirestore,
    markDataAsDirty,
    
    // 엑셀 라이브러리 (XLSX는 index.html에서 전역 로드)
} from './app.js';

// UI 렌더링 함수들 (ui.js를 통해 import)
// ================== [ ✨ 수정된 부분 ✨ ] ==================
// (ui-history.js에서 가져오는 함수 목록이 변경됩니다)
import {
  renderQuantityModalInputs,
  renderAttendanceDailyHistory,
  renderAttendanceWeeklyHistory,
  renderAttendanceMonthlyHistory,
  renderWeeklyHistory,
  renderMonthlyHistory,
  renderTrendAnalysisCharts
} from './ui.js';
// =======================================================

// 유틸리티 함수들
import { 
    formatTimeTo24H, formatDuration, getWeekOfYear, isWeekday,
    getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast
} from './utils.js';

// Firebase (Firestore)
import { 
    doc, setDoc, getDoc, collection, getDocs, deleteDoc 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ✅ [신규] 해당 날짜의 데이터에 "업무 시간은 있으나 처리량이 0"인 업무가 있는지 확인하는 헬퍼 함수
// (appConfig가 필요하므로 app.js에서 import된 appConfig를 사용합니다)
export const checkMissingQuantities = (dayData) => { // ✅ [수정] export 추가
    if (!dayData || !dayData.workRecords) return []; // ✅ [수정] false 대신 빈 배열 반환

    const records = dayData.workRecords;
    const quantities = dayData.taskQuantities || {};

    // 1. 업무별 총 소요 시간을 집계
    const durationByTask = records.reduce((acc, r) => {
        if (r.task && r.duration > 0) {
            acc[r.task] = (acc[r.task] || 0) + r.duration;
        }
        return acc;
    }, {});

    // 2. 소요 시간이 0보다 큰 업무들
    const tasksWithDuration = Object.keys(durationByTask);
    if (tasksWithDuration.length === 0) return []; // ✅ [수정] false 대신 빈 배열 반환

    // 3. '처리량 집계 대상' 업무 목록 가져_
    const quantityTaskTypes = appConfig.quantityTaskTypes || [];
    
    // ✅ [추가] 누락된 업무를 저장할 배열
    const missingTasks = [];

    // 4. 소요 시간은 있으나 처리량이 0인 '집계 대상' 업무가 있는지 확인
    for (const task of tasksWithDuration) {
        // 이 업무가 '처리량 집계 대상' 업무인지 확인
        if (quantityTaskTypes.includes(task)) {
            // 처리량 집계 대상인데, 처리량이 0이거나 없으면
            if (!quantities[task] || Number(quantities[task]) <= 0) {
                // 🚨 [수정] return true 대신, 배열에 추가
                missingTasks.push(task); 
            }
        }
    }
    
    // ✅ [수정] 경고할 항목 배열을 반환 (없으면 빈 배열 [])
    return missingTasks;
};

/**
 * 현재까지 완료된 기록을 'history' 컬렉션에 저장합니다.
 * (app.js의 saveProgress)
 * @param {boolean} [isAutoSave=false] - 자동 저장 모드 여부
 */
export async function saveProgress(isAutoSave = false) {
  const dateStr = getTodayDateString();
  
  if (!isAutoSave) {
    showToast('현재까지 완료된 기록을 저장합니다...');
  }
  
  const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);
  
  try {
    const docSnap = await getDoc(historyDocRef);
    const existingData = docSnap.exists() ? (docSnap.data() || { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] }) : { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [] };
    const completedRecordsFromState = (appState.workRecords || []).filter(r => r.status === 'completed');

    const currentQuantities = {};
    for (const task in (appState.taskQuantities || {})) {
      const q = Number(appState.taskQuantities[task]);
      if (!Number.isNaN(q) && q >= 0) { 
         currentQuantities[task] = q;
      }
    }

    const currentLeaveMembersCombined = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const currentPartTimers = appState.partTimers || [];

    if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0 && currentLeaveMembersCombined.length === 0 && currentPartTimers.length === 0 && !(existingData.workRecords?.length > 0) && !(existingData.taskQuantities && Object.keys(existingData.taskQuantities).length > 0) && !(existingData.onLeaveMembers?.length > 0) && !(existingData.partTimers?.length > 0)) {
        if (!isAutoSave) {
            showToast('저장할 새로운 완료 기록, 처리량, 근태 정보 또는 알바 정보가 없습니다.', true);
        }
        // app.js의 isDataDirty = false; (app.js의 autoSaveProgress에서 처리)
        return;
    }

    const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
    const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

    const finalQuantities = currentQuantities;

    const combinedPartTimers = [...(existingData.partTimers || []), ...currentPartTimers];
    const uniquePartTimers = Array.from(new Map(combinedPartTimers.map(item => [item.id, item])).values());

    const dataToSave = {
      workRecords: uniqueRecords,
      taskQuantities: finalQuantities, 
      onLeaveMembers: currentLeaveMembersCombined, 
      partTimers: uniquePartTimers
    };

    await setDoc(historyDocRef, dataToSave);

    if (isAutoSave) {
        console.log("Auto-save completed.");
    } else {
        showToast('현재까지의 기록이 성공적으로 저장되었습니다.');
    }
    // app.js의 isDataDirty = false; (app.js의 autoSaveProgress에서 처리)

  } catch (e) {
    console.error('Error in saveProgress: ', e);
    showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
  }
}

/**
 * 업무 마감 또는 앱 초기화 시 호출됩니다.
 * 진행 중인 작업을 완료 처리하고, 이력에 저장한 후, appState를 초기화합니다.
 * (app.js의 saveDayDataToHistory)
 * @param {boolean} shouldReset - 수량, 알바, 근태 등 모든 것을 초기화할지 여부
 */
export async function saveDayDataToHistory(shouldReset) {
  const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
  if (ongoingRecords.length > 0) {
    const endTime = getCurrentTime(); 
    ongoingRecords.forEach(rec => {
      if (rec.status === 'paused') {
        const lastPause = rec.pauses?.[rec.pauses.length - 1];
        if (lastPause && lastPause.end === null) lastPause.end = endTime;
      }
      rec.status = 'completed';
      rec.endTime = endTime;
      rec.duration = calcElapsedMinutes(rec.startTime, endTime, rec.pauses);
    });
  }

  await saveProgress(false); 

  appState.workRecords = [];
  
  if (shouldReset) {
      Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
      appState.partTimers = [];
      appState.hiddenGroupIds = [];

      const now = getCurrentTime(); 
      
      if (now < "17:30") {
          appState.dailyOnLeaveMembers = (appState.dailyOnLeaveMembers || []).filter(entry => entry.type === '조퇴');
      } else {
          appState.dailyOnLeaveMembers = [];
      }
      
      showToast('오늘의 업무 기록을 초기화했습니다.');
  } 
  
  await saveStateToFirestore(); 
  render();
}

/**
 * Firestore 'history' 컬렉션에서 모든 데이터를 가져와 전역 변수(app.js의)에 저장합니다.
 * (app.js의 fetchAllHistoryData)
 */
export async function fetchAllHistoryData() {
  const historyCollectionRef = collection(db, 'artifacts', 'team-work-logger-v2', 'history');
  try {
    const querySnapshot = await getDocs(historyCollectionRef);
    const data = []; // 임시 배열
    querySnapshot.forEach((doc) => {
      const docData = doc.data();
      if (docData && ( (docData.workRecords && docData.workRecords.length > 0) || (docData.onLeaveMembers && docData.onLeaveMembers.length > 0) || (docData.partTimers && docData.partTimers.length > 0) )) {
         data.push({ id: doc.id, ...docData });
      }
    });
    data.sort((a, b) => b.id.localeCompare(a.id));
    
    // app.js의 전역 변수 업데이트
    allHistoryData.length = 0; // 기존 배열 비우기
    allHistoryData.push(...data); // 새 데이터 채우기
    
    return allHistoryData; // 업데이트된 배열 반환
  } catch (error) {
    console.error('Error fetching all history data:', error);
    showToast('전체 이력 로딩 실패', true);
    allHistoryData.length = 0; // 오류 시에도 비우기
    return [];
  }
}

/**
 * 👈 [수정] 이력 데이터를 다시 불러오고, 기본 탭('일별 상세')을 렌더링합니다.
 * (app.js의 loadAndRenderHistoryList)
 */
export const loadAndRenderHistoryList = async () => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';
    
    await fetchAllHistoryData(); // app.js의 allHistoryData가 업데이트됨

    if (allHistoryData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
        const viewsToClear = [
            'history-daily-view', 'history-weekly-view', 'history-monthly-view', 
            'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view'
        ];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    // ✅ [수정] 모달을 열 때 항상 '업무 이력'의 '일별 상세' 탭을 강제로 활성화하고 
    // ✅ 데이터를 즉시 렌더링하도록 수정합니다.

    // 1. 메인 탭(업무 이력) 활성화 (UI)
    document.querySelectorAll('.history-main-tab-btn[data-main-tab="work"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.remove('font-medium', 'text-gray-500');
    });
    document.querySelectorAll('.history-main-tab-btn:not([data-main-tab="work"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.add('font-medium', 'text-gray-500');
    });

    // 2. 서브 탭(일별 상세) 활성화 (UI)
    document.querySelectorAll('#history-tabs button[data-view="daily"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.remove('text-gray-500');
    });
    document.querySelectorAll('#history-tabs button:not([data-view="daily"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.add('text-gray-500');
    });
    
    // 3. 패널(업무 이력) 및 뷰(일별 상세) 표시 (UI)
    if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
    if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
    if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');

    document.getElementById('history-daily-view')?.classList.remove('hidden');
    document.getElementById('history-weekly-view')?.classList.add('hidden');
    document.getElementById('history-monthly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-daily-view')?.classList.add('hidden');
    document.getElementById('history-attendance-weekly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-monthly-view')?.classList.add('hidden');

    // 4. 👈 [핵심 수정] '상태(context)'를 'work'로 설정
    context.activeMainHistoryTab = 'work';

    // 5. '일별' 모드로 날짜 목록 렌더링 (이 함수가 '일별 상세' 데이터도 렌더링함)
    renderHistoryDateListByMode('day');
};


/**
 * 👈 [수정] 이력 목록(왼쪽)을 모드(일/주/월) 및 '기간 필터'에 맞게 렌더링합니다.
 * (app.js의 renderHistoryDateListByMode)
 * @param {string} mode - 'day', 'week', 'month'
 */
export const renderHistoryDateListByMode = (mode = 'day') => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '';

    // 1. 👈 [추가] 기간 필터링 적용
    const filteredData = (context.historyStartDate || context.historyEndDate)
        ? allHistoryData.filter(d => {
            const date = d.id;
            const start = context.historyStartDate;
            const end = context.historyEndDate;
            // 시작일과 종료일이 모두 있으면
            if (start && end) return date >= start && date <= end;
            // 시작일만 있으면
            if (start) return date >= start;
            // 종료일만 있으면
            if (end) return date <= end;
            // 둘 다 없으면 (필터링 안 함 - 이 경우는 context 체크로 인해 발생하지 않음)
            return true;
          })
        : allHistoryData; // 필터가 없으면 전체 데이터 사용

    let keys = [];
    
    if (mode === 'day') {
        keys = filteredData.map(d => d.id);
    } else if (mode === 'week') {
        const weekSet = new Set(filteredData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
        keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
    } else if (mode === 'month') {
        const monthSet = new Set(filteredData.map(d => d.id.substring(0, 7)));
        keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    }

    if (keys.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        
        // 👈 [추가] 목록이 비었을 때 오른쪽 상세 뷰도 비움
        const viewsToClear = [
            'history-daily-view', 'history-weekly-view', 'history-monthly-view', 
            'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view'
        ];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        
        return;
    }

    // ✅ [수정] keys.forEach 루프 수정
    keys.forEach(key => {
        const li = document.createElement('li');
        
        // --- [ ✨ 수정된 부분 ✨ ] ---
        let hasWarning = false;
        let titleAttr = ''; // 툴팁(title) 속성을 저장할 변수

        // '일별' 모드일 때만 경고 확인
        if (mode === 'day') {
            const dayData = filteredData.find(d => d.id === key);
            if (dayData) {
                // 1. checkMissingQuantities는 이제 배열을 반환합니다.
                const missingTasksList = checkMissingQuantities(dayData);
                // 2. 배열 길이가 0보다 크면 경고가 있는 것입니다.
                hasWarning = missingTasksList.length > 0;
                
                if (hasWarning) {
                    // 3. title 속성에 누락된 업무 목록을 추가합니다.
                    titleAttr = ` title="처리량 누락: ${missingTasksList.join(', ')}"`;
                }
            }
        }
        
        // 4. 클래스와 title 속성을 HTML에 적용합니다.
        li.innerHTML = `<button data-key="${key}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${hasWarning ? 'warning-no-quantity' : ''}"${titleAttr}>${key}</button>`;
        // --- [ ✨ 수정 끝 ✨ ] ---

        historyDateList.appendChild(li);
    });

    const firstButton = historyDateList.firstChild?.querySelector('button');
    if (firstButton) {
        firstButton.classList.add('bg-blue-100', 'font-bold');
        
        // ================== [ ✨ 수정된 부분 ✨ ] ==================
        // 모드(day, week, month)에 관계없이 첫 번째 항목의 상세 뷰를 렌더링하도록 수정
        const key = firstButton.dataset.key;
        
        if (context.activeMainHistoryTab === 'work') {
            if (mode === 'day') {
                // 👈 [수정] filteredData를 기준으로 previousDayData를 찾음
                const currentIndex = filteredData.findIndex(d => d.id === key);
                const previousDayData = (currentIndex > -1 && currentIndex + 1 < filteredData.length) 
                                        ? filteredData[currentIndex + 1] 
                                        : null;
                renderHistoryDetail(key, previousDayData);
            } else if (mode === 'week') {
                // 👈 [수정] filteredData를 전달
                renderWeeklyHistory(key, filteredData, appConfig); 
            } else if (mode === 'month') {
                // 👈 [수정] filteredData를 전달
                renderMonthlyHistory(key, filteredData, appConfig); 
            }
        } else { // attendance tab
            if (mode === 'day') {
                renderAttendanceDailyHistory(key, filteredData); // 👈 filteredData 전달
            } else if (mode === 'week') {
                renderAttendanceWeeklyHistory(key, filteredData); // 👈 filteredData 전달
            } else if (mode === 'month') {
                renderAttendanceMonthlyHistory(key, filteredData); // 👈 filteredData 전달
            }
        }
        // =========================================================
    }
};

/**
 * 이력 보기에서 '처리량 수정' 모달을 엽니다.
 * (app.js의 window.openHistoryQuantityModal)
 */
export const openHistoryQuantityModal = (dateKey) => {
    const todayDateString = getTodayDateString();
    let quantitiesToShow = {};
    let dayData = null; // ✅ [추가] dayData를 저장할 변수

    if (dateKey === todayDateString) {
        quantitiesToShow = appState.taskQuantities || {};
        // ✅ [추가] 오늘의 데이터로 dayData 객체를 구성합니다.
        dayData = {
            id: dateKey,
            workRecords: appState.workRecords || [],
            taskQuantities: appState.taskQuantities || {},
            // (참고: checkMissingQuantities는 workRecords와 taskQuantities만 필요합니다)
        };
    } else {
        dayData = allHistoryData.find(d => d.id === dateKey); // ✅ [수정] 변수 이름을 data에서 dayData로
        if (!dayData) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        quantitiesToShow = dayData.taskQuantities || {};
    }

    // ✅ [추가] 누락된 업무 목록을 계산합니다.
    const missingTasksList = checkMissingQuantities(dayData);

    // ✅ [수정] renderQuantityModalInputs에 missingTasksList를 전달합니다.
    renderQuantityModalInputs(quantitiesToShow, appConfig.quantityTaskTypes, missingTasksList);
    
    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateKey} 처리량 수정`;

    // ✅ [수정] onConfirm 로직을 함수 내부로 올바르게 이동
    context.quantityModalContext.mode = 'history';
    context.quantityModalContext.dateKey = dateKey;
    context.quantityModalContext.onConfirm = async (newQuantities) => {
        
        const idx = allHistoryData.findIndex(d => d.id === dateKey);
        if (idx === -1 && dateKey !== todayDateString) { 
             showToast('이력 데이터를 찾을 수 없어 수정할 수 없습니다.', true);
             return;
        }
        
        if (idx > -1) {
            allHistoryData[idx] = { ...allHistoryData[idx], taskQuantities: newQuantities };
        }

        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            const dataToSave = (idx > -1) 
                ? allHistoryData[idx] 
                : { id: dateKey, taskQuantities: newQuantities, workRecords: [], onLeaveMembers: [], partTimers: [] }; 
            
            await setDoc(historyDocRef, dataToSave);
            
            showToast(`${dateKey}의 처리량이 수정되었습니다.`);

            if (dateKey === getTodayDateString()) {
                appState.taskQuantities = newQuantities;
                render(); 
            }
            
            if (dateKey !== todayDateString) {
                 const activeSubTabBtn = historyTabs?.querySelector('button.font-semibold');
                 const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';
                 switchHistoryView(currentView);
            }

        } catch (e) {
            console.error('Error updating history quantities:', e);
            showToast('처리량 업데이트 중 오류 발생.', true);
        }
    }; // ✅ onConfirm 함수가 여기서 끝남
    
    context.quantityModalContext.onCancel = () => {};


    const cBtn = document.getElementById('confirm-quantity-btn');
    const xBtn = document.getElementById('cancel-quantity-btn');
    if (cBtn) cBtn.textContent = '수정 저장';
    if (xBtn) xBtn.textContent = '취소';
    if (quantityModal) quantityModal.classList.remove('hidden');
};

/**
 * 이력 보기 - 일별 상세 뷰를 렌더링합니다.
 * (app.js의 renderHistoryDetail)
 */
export const renderHistoryDetail = (dateKey, previousDayData = null) => {
  const view = document.getElementById('history-daily-view');
  if (!view) return;
  view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';
  
  // 👈 [수정] '전체' 데이터에서 ID로 조회
  const data = allHistoryData.find(d => d.id === dateKey);
  if (!data) { 
      view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>'; 
      return; 
  }

  const records = data.workRecords || [];
  const quantities = data.taskQuantities || {};
  const onLeaveMemberEntries = data.onLeaveMembers || [];
  const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
  const partTimersFromHistory = data.partTimers || [];

  const wageMap = { ...appConfig.memberWages };
  partTimersFromHistory.forEach(pt => {
      if (pt && pt.name && !wageMap[pt.name]) { // 👈 [수정] pt 유효성 검사
          wageMap[pt.name] = pt.wage || 0;
      }
  });

  const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
  const activeMembersCount = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length
                           + partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;

  // --- 1. 현재일(Current) 데이터 계산 ---
  const totalSumDuration = records.reduce((sum, r) => sum + (Number(r.duration) || 0), 0); // 👈 [수정] Number()
  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

  const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (Number(rec.duration) || 0); return acc; }, {}); // 👈 [수정] Number()
  const taskCosts = records.reduce((acc, rec) => {
      const wage = wageMap[rec.member] || 0;
      const cost = ((Number(rec.duration) || 0) / 60) * wage;
      acc[rec.task] = (acc[rec.task] || 0) + cost;
      return acc;
  }, {});
  
  const taskMetrics = {};
  const allTaskKeys = new Set([...Object.keys(taskDurations), ...Object.keys(quantities)]);
  allTaskKeys.forEach(task => {
      const duration = taskDurations[task] || 0;
      const cost = taskCosts[task] || 0;
      const qty = Number(quantities[task]) || 0;
      
      taskMetrics[task] = {
          duration: duration,
          cost: cost,
          quantity: qty,
          avgThroughput: duration > 0 ? (qty / duration) : 0,
          avgCostPerItem: qty > 0 ? (cost / qty) : 0
      };
  });


  // --- 2. [✨ 수정] 전일(Previous) 데이터 계산 (최근 기록 조회) ---
  let prevTaskMetrics = {};
  const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);

  if (currentIndex > -1) {
      allTaskKeys.forEach(task => {
          let foundPrevDayData = null;
          // 현재 날짜의 다음 인덱스부터 (즉, 과거로) 순회
          for (let i = currentIndex + 1; i < allHistoryData.length; i++) {
              const prevDay = allHistoryData[i];
              // 해당 날짜에 이 'task'에 대한 기록(업무시간 or 처리량)이 있는지 확인
              if (prevDay.workRecords?.some(r => r.task === task && (r.duration || 0) > 0) || (prevDay.taskQuantities?.[task] || 0) > 0) {
                  foundPrevDayData = prevDay;
                  break; // 가장 가까운 과거의 기록을 찾았으면 중단
              }
          }

          // 만약 찾았다면, 해당 날짜의 'task' 메트릭을 계산
          if (foundPrevDayData) {
              const prevRecords = foundPrevDayData.workRecords || [];
              const prevQuantities = foundPrevDayData.taskQuantities || {};
              
              const taskRecords = prevRecords.filter(r => r.task === task);
              const duration = taskRecords.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
              const cost = taskRecords.reduce((sum, r) => {
                  const wage = wageMap[r.member] || 0;
                  return sum + ((Number(r.duration) || 0) / 60) * wage;
              }, 0);
              const qty = Number(prevQuantities[task]) || 0;

              prevTaskMetrics[task] = {
                  date: foundPrevDayData.id, // [추가] 며칠 전 데이터인지 툴팁에 표시
                  duration: duration,
                  cost: cost,
                  quantity: qty,
                  avgThroughput: duration > 0 ? (qty / duration) : 0,
                  avgCostPerItem: qty > 0 ? (cost / qty) : 0
              };
          }
          // 못 찾았다면 prevTaskMetrics[task]는 undefined로 남음
      });
  }
  // --- [✨ 수정 끝] ---
  
  
  // --- 3. [✨ 수정] HTML 렌더링 (getDiffHtmlForMetric 헬퍼 함수 수정) ---
  
  // [✨ 수정] 헬퍼 함수가 previousMetric 객체를 받도록 변경 (툴팁에 날짜 추가)
  const getDiffHtmlForMetric = (metric, current, previousMetric) => {
      const currValue = current || 0;
      
      // [수정] prevValue 및 prevDate 추출
      let prevValue = 0;
      let prevDate = previousMetric?.date || '이전'; // 날짜
      
      if (!previousMetric) { // [수정]
          if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
          return ''; 
      }
      
      // [수정] metric에 따라 prevValue 할당
      if (metric === 'quantity') prevValue = previousMetric.quantity || 0;
      else if (metric === 'avgThroughput') prevValue = previousMetric.avgThroughput || 0;
      else if (metric === 'avgCostPerItem') prevValue = previousMetric.avgCostPerItem || 0;
      else if (metric === 'duration') prevValue = previousMetric.duration || 0;
      // (avgStaff, avgTime은 이 함수에서 사용 안 함)

      if (prevValue === 0) {
           if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
          return ''; 
      }
      
      const diff = currValue - prevValue;
      if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
      
      const percent = (diff / prevValue) * 100;
      const sign = diff > 0 ? '↑' : '↓';
      
      let colorClass = 'text-gray-500';
      if (metric === 'avgThroughput' || metric === 'avgStaff' || metric === 'quantity') { 
          colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
      } else if (metric === 'avgCostPerItem' || metric === 'avgTime' || metric === 'duration') { 
          colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
      }
      
      let diffStr = '';
      let prevStr = '';
      if (metric === 'avgTime' || metric === 'duration') {
          diffStr = formatDuration(Math.abs(diff));
          prevStr = formatDuration(prevValue);
      } else if (metric === 'avgStaff' || metric === 'avgCostPerItem' || metric === 'quantity') {
          diffStr = Math.abs(diff).toFixed(0);
          prevStr = prevValue.toFixed(0);
      } else { 
          diffStr = Math.abs(diff).toFixed(2);
          prevStr = prevValue.toFixed(2);
      }
  
      // [수정] title에 prevDate 추가
      return `<span class="text-xs ${colorClass} ml-1 font-mono" title="${prevDate}: ${prevStr}">
                  ${sign} ${diffStr} (${percent.toFixed(0)}%)
              </span>`;
  };


  // --- 4. HTML 렌더링 (본문) ---
  const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

  let nonWorkHtml = '';
  if (isWeekday(dateKey)) {
    const totalPotentialMinutes = activeMembersCount * 8 * 60; 
    const nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalSumDuration);
    const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes)}</p><p class="text-xs text-gray-500 mt-1">(추정치, ${percentage}%)</p></div>`;
  } else {
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px] flex flex-col justify-center items-center"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-lg font-bold text-gray-400">주말</p></div>`;
  }

  // (버튼 부분은 이전 단계에서 data-action으로 수정된 상태입니다)
  let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3>
      <div>
        <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                data-action="open-history-quantity-modal" data-date-key="${dateKey}">처리량 수정</button>
        <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                data-action="download-history-excel" data-date-key="${dateKey}">엑셀 (전체)</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                data-action="request-history-deletion" data-date-key="${dateKey}">삭제</button>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">근무 인원</h4><p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
      ${nonWorkHtml}
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
    </div>
  `;
  
  html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;
  
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasQuantities = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasQuantities = true;
      // [✨ 수정] 헬퍼 함수 호출 방식 변경
      const prevMetricQty = prevTaskMetrics[task] || null;
      const diffHtml = getDiffHtmlForMetric('quantity', metrics.quantity, prevMetricQty);
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.quantity} 개 ${diffHtml}</span>
               </div>`;
    });
  if (!hasQuantities) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasThroughput = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0) 
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasThroughput = true;
      // [✨ 수정] 헬퍼 함수 호출 방식 변경
      const prevMetricThroughput = prevTaskMetrics[task] || null;
      const diffHtml = getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevMetricThroughput);
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgThroughput.toFixed(2)} 개/분 ${diffHtml}</span>
               </div>`;
    });
  if (!hasThroughput) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasCostPerItem = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0) 
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasCostPerItem = true;
      // [✨ 수정] 헬퍼 함수 호출 방식 변경
      const prevMetricCost = prevTaskMetrics[task] || null;
      const diffHtml = getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevMetricCost);
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgCostPerItem.toFixed(0)} 원/개 ${diffHtml}</span>
               </div>`;
    });
  if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
  html += `</div></div>`;
  html += `</div>`; 

  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 시간 비중</h4><div class="space-y-3">`;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.duration > 0)
    .sort(([,a],[,b]) => b.duration - a.duration)
    .forEach(([task, metrics]) => {
      const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
      // [✨ 수정] 헬퍼 함수 호출 방식 변경
      const prevMetricDuration = prevTaskMetrics[task] || null;
      const diffHtml = getDiffHtmlForMetric('duration', metrics.duration, prevMetricDuration); 
      
      html += `
        <div>
          <div class="flex justify-between items-center mb-1 text-sm">
            <span class="font-semibold text-gray-600">${task}</span>
            <span>${formatDuration(metrics.duration)} (${percentage}%) ${diffHtml}</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
        </div>`;
    });
  if (Object.values(taskMetrics).every(m => (m.duration || 0) <= 0)) {
    html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
  }
  html += `</div></div>`;

  view.innerHTML = html;
};

/**
 * 이력 삭제 확인 모달을 엽니다.
 */
export const requestHistoryDeletion = (dateKey) => {
  context.historyKeyToDelete = dateKey; // ✅ context.
  if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};

/**
 * 이력 보기 탭(일/주/월)을 전환합니다.
 */
export const switchHistoryView = (view) => {
  const allViews = [
      document.getElementById('history-daily-view'),
      document.getElementById('history-weekly-view'),
      document.getElementById('history-monthly-view'),
      document.getElementById('history-attendance-daily-view'),
      document.getElementById('history-attendance-weekly-view'),
      document.getElementById('history-attendance-monthly-view')
  ];
  allViews.forEach(v => v && v.classList.add('hidden'));

  if (historyTabs) {
      historyTabs.querySelectorAll('button').forEach(btn => {
          btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
          btn.classList.add('text-gray-500');
      });
  }
  if (attendanceHistoryTabs) {
      attendanceHistoryTabs.querySelectorAll('button').forEach(btn => {
          btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
          btn.classList.add('text-gray-500');
      });
  }

  const dateListContainer = document.getElementById('history-date-list-container');
  if (dateListContainer) {
      dateListContainer.style.display = 'block'; 
  }

  let viewToShow = null;
  let tabToActivate = null;
  let listMode = 'day'; 

  switch(view) {
      case 'daily':
          listMode = 'day'; 
          viewToShow = document.getElementById('history-daily-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="daily"]');
          break;
      case 'weekly':
          listMode = 'week'; 
          viewToShow = document.getElementById('history-weekly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="weekly"]');
          // ================== [ ✨ 수정된 부분 ✨ ] ==================
          // (렌더링 호출 삭제)
          // renderWeeklyHistory(allHistoryData, appConfig); 
          // =======================================================
          break;
      case 'monthly':
          listMode = 'month'; 
          viewToShow = document.getElementById('history-monthly-view');
          tabToActivate = historyTabs?.querySelector('button[data-view="monthly"]');
          // ================== [ ✨ 수정된 부분 ✨ ] ==================
          // (렌더링 호출 삭제)
          // renderMonthlyHistory(allHistoryData, appConfig); 
          // =======================================================
          break;
      case 'attendance-daily':
          listMode = 'day'; 
          viewToShow = document.getElementById('history-attendance-daily-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
          break;
      case 'attendance-weekly':
          listMode = 'week'; 
          viewToShow = document.getElementById('history-attendance-weekly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
          // ================== [ ✨ 수정된 부분 ✨ ] ==================
          // (렌더링 호출 삭제)
          // renderAttendanceWeeklyHistory(allHistoryData); 
          // =======================================================
          break;
      case 'attendance-monthly':
          listMode = 'month'; 
          viewToShow = document.getElementById('history-attendance-monthly-view');
          tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
          // ================== [ ✨ 수정된 부분 ✨ ] ==================
          // (렌더링 호출 삭제)
          // renderAttendanceMonthlyHistory(allHistoryData); 
          // =======================================================
          break;
  }
  
  // 👈 [수정] 이 함수가 필터링된 목록을 렌더링합니다.
  renderHistoryDateListByMode(listMode);

  if (viewToShow) viewToShow.classList.remove('hidden');
  if (tabToActivate) {
      tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
      tabToActivate.classList.remove('text-gray-500');
  }
};