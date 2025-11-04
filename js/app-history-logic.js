// === app-history-logic.js (이력, 마감, 저장, 엑셀 관련 로직) ===

import {
    appState, appConfig, db, auth, 
    allHistoryData, // ✅ app.js에서 export
    context, // ✅ context 객체 import
    
    // DOM Elements (app.js에서 가져옴)
    historyDateList, historyTabs, attendanceHistoryTabs, 
    historyViewContainer, attendanceHistoryViewContainer, 
    workHistoryPanel, attendanceHistoryPanel, trendAnalysisPanel, // 👈 [수정] workHistoryPanel, attendanceHistoryPanel 2개 추가
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
 * 이력 데이터를 다시 불러오고, 현재 탭 설정에 맞게 목록과 뷰를 렌더링합니다.
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
 * 이력 목록(왼쪽)을 모드(일/주/월)에 맞게 렌더링합니다.
 * (app.js의 renderHistoryDateListByMode)
 * @param {string} mode - 'day', 'week', 'month'
 */
export const renderHistoryDateListByMode = (mode = 'day') => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '';

    let keys = [];
    
    if (mode === 'day') {
        keys = allHistoryData.map(d => d.id);
    } else if (mode === 'week') {
        const weekSet = new Set(allHistoryData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
        keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
    } else if (mode === 'month') {
        const monthSet = new Set(allHistoryData.map(d => d.id.substring(0, 7)));
        keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    }

    if (keys.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        return;
    }

    keys.forEach(key => {
        const li = document.createElement('li');
        li.innerHTML = `<button data-key="${key}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${key}</button>`;
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
                const previousDayData = (allHistoryData.length > 1) ? allHistoryData[1] : null;
                renderHistoryDetail(key, previousDayData);
            } else if (mode === 'week') {
                // (ui-history.js 수정 필요)
                renderWeeklyHistory(key, allHistoryData, appConfig); 
            } else if (mode === 'month') {
                // (ui-history.js 수정 필요)
                renderMonthlyHistory(key, allHistoryData, appConfig); 
            }
        } else { // attendance tab
            if (mode === 'day') {
                renderAttendanceDailyHistory(key, allHistoryData);
            } else if (mode === 'week') {
                // (ui-history.js 수정 필요)
                renderAttendanceWeeklyHistory(key, allHistoryData); 
            } else if (mode === 'month') {
                // (ui-history.js 수정 필요)
                renderAttendanceMonthlyHistory(key, allHistoryData); 
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

    if (dateKey === todayDateString) {
        quantitiesToShow = appState.taskQuantities || {};
    } else {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        quantitiesToShow = data.taskQuantities || {};
    }

    renderQuantityModalInputs(quantitiesToShow, appConfig.quantityTaskTypes);
    
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
      if (!wageMap[pt.name]) {
          wageMap[pt.name] = pt.wage || 0;
      }
  });

  const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
  const activeMembersCount = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length
                           + partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;

  // --- 1. 현재일(Current) 데이터 계산 ---
  const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);
  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

  // 👈 [수정] (rec.duration || 0)을 (Number(rec.duration) || 0)으로 변경
  const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (Number(rec.duration) || 0); return acc; }, {});
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


  // --- 2. 전일(Previous) 데이터 계산 ---
  let prevTaskMetrics = {};
  if (previousDayData) {
      const prevRecords = previousDayData.workRecords || [];
      const prevQuantities = previousDayData.taskQuantities || {};
      const prevTaskDurations = prevRecords.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});
      const prevTaskCosts = prevRecords.reduce((acc, rec) => {
          const wage = wageMap[rec.member] || 0;
          const cost = ((Number(rec.duration) || 0) / 60) * wage;
          acc[rec.task] = (acc[rec.task] || 0) + cost;
          return acc;
      }, {});
      const allPrevTaskKeys = new Set([...Object.keys(prevTaskDurations), ...Object.keys(prevQuantities)]);
      allPrevTaskKeys.forEach(task => {
          const duration = prevTaskDurations[task] || 0;
          const cost = prevTaskCosts[task] || 0;
          const qty = Number(prevQuantities[task]) || 0;
          prevTaskMetrics[task] = {
              duration: duration,
              cost: cost,
              quantity: qty,
              avgThroughput: duration > 0 ? (qty / duration) : 0,
              avgCostPerItem: qty > 0 ? (cost / qty) : 0
          };
      });
  }
  
  const getDiffHtmlForMetric = (metric, current, previous) => {
      const currValue = current || 0;
      const prevValue = previous || 0;
  
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
  
      return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                  ${sign} ${diffStr} (${percent.toFixed(0)}%)
              </span>`;
  };


  // --- 3. HTML 렌더링 ---
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

  // ================== [ ✨ 수정된 부분 ✨ ] ==================
  // (h3 태그에서 '(전일 대비)' 텍스트 삭제)
  let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3>
      <div>
  <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm" onclick="app.openHistoryQuantityModal('${dateKey}')">처리량 수정</button>
        <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="app.downloadHistoryAsExcel('${dateKey}')">엑셀 (전체)</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="app.requestHistoryDeletion('${dateKey}')">삭제</button>
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
      const prevQty = prevTaskMetrics[task]?.quantity || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('quantity', metrics.quantity, prevQty) : '';
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
      const prevThroughput = prevTaskMetrics[task]?.avgThroughput || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevThroughput) : '';
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
      const prevCostPerItem = prevTaskMetrics[task]?.avgCostPerItem || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevCostPerItem) : '';
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
      const prevDuration = prevTaskMetrics[task]?.duration || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('duration', metrics.duration, prevDuration) : ''; 
      
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

// =================================================================
// 엑셀 다운로드 함수
// =================================================================
const fitToColumn = (ws) => {
    const objectMaxLength = [];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
    if (!data || data.length === 0) return;
    if (data[0]) {
        Object.keys(data[0]).forEach((key, index) => {
            objectMaxLength[index] = String(data[0][key]).length;
        });
    }
    data.slice(1).forEach(row => {
        Object.keys(row).forEach((key, index) => {
            const cellLength = String(row[key] ?? '').length;
            objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength);
        });
    });
    ws['!cols'] = objectMaxLength.map(w => ({ width: w + 2 }));
};

const appendTotalRow = (ws, data, headers) => {
    if (!data || data.length === 0) return;
    const total = {};
    const sums = {};

    headers.forEach(header => {
        if (header.includes('(분)') || header.includes('(원)') || header.includes('(개)')) {
            sums[header] = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
        }
    });

    headers.forEach((header, index) => {
        if (index === 0) {
            total[header] = '총 합계';
        } else if (header.includes('(분)') || header.includes('총 인건비(원)') || header.includes('총 처리량(개)')) {
            total[header] = Math.round(sums[header]);
        } else if (header === '개당 처리비용(원)') {
            const totalCost = sums['총 인건비(원)'] || 0;
            const totalQty = sums['총 처리량(개)'] || 0;
            const totalCostPerItem = (totalQty > 0) ? (totalCost / totalQty) : 0;
            total[header] = Math.round(totalCostPerItem);
        } else {
            total[header] = '';
        }
    });
    XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
};

export const downloadHistoryAsExcel = async (dateKey) => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        
        const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
        const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                ? allHistoryData[currentIndex + 1] 
                                : null;

        const workbook = XLSX.utils.book_new();

        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // Sheet 1: 상세 기록
        const dailyRecords = data.workRecords || [];
        const dailyQuantities = data.taskQuantities || {};
        
        const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)'];
        const sheet1Data = dailyRecords.map(r => ({
            '팀원': r.member || '',
            '업무 종류': r.task || '',
            '시작 시간': formatTimeTo24H(r.startTime),
            '종료 시간': formatTimeTo24H(r.endTime),
            '소요 시간(분)': Math.round(Number(r.duration) || 0)
        }));
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
        if (sheet1Data.length > 0) appendTotalRow(worksheet1, sheet1Data, sheet1Headers);
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `상세 기록 (${dateKey})`);

        // Sheet 2: 업무 요약 (전일비 추가)
        let prevTaskSummary = {};
        if (previousDayData) {
            const prevRecords = previousDayData.workRecords || [];
            (prevRecords).forEach(r => {
                if (!prevTaskSummary[r.task]) {
                    prevTaskSummary[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
                }
                const wage = combinedWageMap[r.member] || 0;
                const cost = ((Number(r.duration) || 0) / 60) * wage;
                prevTaskSummary[r.task].totalDuration += (Number(r.duration) || 0);
                prevTaskSummary[r.task].totalCost += cost;
                prevTaskSummary[r.task].members.add(r.member);
            });
        }
        
        const summaryByTask = {};
        dailyRecords.forEach(r => {
            if (!summaryByTask[r.task]) {
                summaryByTask[r.task] = { totalDuration: 0, totalCost: 0, members: new Set() };
            }
            const wage = combinedWageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByTask[r.task].totalDuration += (Number(r.duration) || 0);
            summaryByTask[r.task].totalCost += cost;
            summaryByTask[r.task].members.add(r.member); 
        });
        
        const sheet2Headers = [
            '업무 종류', '진행 인원수', '총 소요 시간(분)', '총 인건비(원)', '총 처리량(개)', '개당 처리비용(원)',
            '진행 인원수(전일비)', '총 시간(전일비)', '총 인건비(전일비)', '총 처리량(전일비)', '개당 처리비용(전일비)'
        ];
        
        const sheet2Data = Object.keys(summaryByTask).sort().map(task => {
            const taskQty = Number(dailyQuantities[task]) || 0;
            const taskCost = summaryByTask[task].totalCost;
            const costPerItem = (taskQty > 0) ? (taskCost / taskQty) : 0;
            const staffCount = summaryByTask[task].members.size;
            const duration = summaryByTask[task].totalDuration;
            
            const prevSummary = prevTaskSummary[task] || { totalDuration: 0, totalCost: 0, members: new Set() };
            const prevQty = Number(previousDayData?.taskQuantities?.[task]) || 0;
            const prevCost = prevSummary.totalCost;
            const prevCostPerItem = (prevQty > 0) ? (prevCost / prevQty) : 0;
            const prevStaffCount = prevSummary.members.size;
            const prevDuration = prevSummary.totalDuration;

            return {
                '업무 종류': task,
                '진행 인원수': staffCount,
                '총 소요 시간(분)': Math.round(duration),
                '총 인건비(원)': Math.round(taskCost),
                '총 처리량(개)': taskQty,
                '개당 처리비용(원)': Math.round(costPerItem),
                '진행 인원수(전일비)': staffCount - prevStaffCount,
                '총 시간(전일비)': Math.round(duration - prevDuration),
                '총 인건비(전일비)': Math.round(taskCost - prevCost),
                '총 처리량(전일비)': taskQty - prevQty,
                '개당 처리비용(전일비)': Math.round(costPerItem - prevCostPerItem)
            };
        });
        
        const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
        if (sheet2Data.length > 0) appendTotalRow(worksheet2, sheet2Data, sheet2Headers); 
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, `업무 요약 (${dateKey})`);

        // Sheet 3: 파트별 인건비
        const sheet3Headers = ['파트', '총 인건비(원)'];
        const memberToPartMap = new Map();
        (appConfig.teamGroups || []).forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
        const summaryByPart = {};
        dailyRecords.forEach(r => {
            const part = memberToPartMap.get(r.member) || '알바';
            if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
            const wage = combinedWageMap[r.member] || 0;
            const cost = ((Number(r.duration) || 0) / 60) * wage;
            summaryByPart[part].totalCost += cost;
        });
        const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
            '파트': part,
            '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
        }));
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        if (sheet3Data.length > 0) appendTotalRow(worksheet3, sheet3Data, sheet3Headers);
        fitToColumn(worksheet3);
        XLSX.utils.book_append_sheet(workbook, worksheet3, `파트 인건비 (${dateKey})`);

        // Sheet 4: 주별 요약
        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string') return acc;
            try {
                const dateObj = new Date(day.id);
                if (isNaN(dateObj.getTime())) return acc;
                const weekKey = getWeekOfYear(dateObj);
                if (!weekKey) return acc;
                if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };
                acc[weekKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) { console.error("Error processing day in weekly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet4Data = [];
        const sheet4Headers = ['주(Week)', '업무', '총 시간(분)', '총 인건비(원)', '총 처리량(개)', '평균 처리량(개/분)', '평균 처리비용(원/개)', '총 참여인원(명)', '평균 처리시간(건)'];
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => a.localeCompare(b));

        for (const weekKey of sortedWeeks) {
            const dataset = weeklyData[weekKey];
            const records = dataset.workRecords || [];
            const quantities = dataset.taskQuantities || {};
            const taskSummary = records.reduce((acc, r) => {
                if (!r || !r.task) return acc;
                if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; 
                acc[r.task].duration += (r.duration || 0);
                const wage = combinedWageMap[r.member] || 0;
                acc[r.task].cost += ((r.duration || 0) / 60) * wage;
                acc[r.task].members.add(r.member); 
                acc[r.task].recordCount += 1; 
                return acc;
            }, {});
            Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
                const qty = Number(qtyValue) || 0;
                if (!taskSummary[task]) taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; 
                taskSummary[task].quantity = (taskSummary[task].quantity || 0) + qty;
            });
            Object.keys(taskSummary).sort().forEach(task => {
                const summary = taskSummary[task];
                const qty = summary.quantity || 0;
                const duration = summary.duration || 0;
                const cost = summary.cost || 0;
                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;
                
                sheet4Data.push({
                    '주(Week)': weekKey,
                    '업무': task,
                    '총 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff, 
                    '평균 처리시간(건)': formatDuration(avgTime) 
                });
            });
        }
        const worksheet4 = XLSX.utils.json_to_sheet(sheet4Data, { header: sheet4Headers });
        fitToColumn(worksheet4);
        XLSX.utils.book_append_sheet(workbook, worksheet4, '주별 업무 요약 (전체)');

        // Sheet 5: 월별 요약
        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string' || day.id.length < 7) return acc;
            try {
                const monthKey = day.id.substring(0,7);
                if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;
                if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
                acc[monthKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) { console.error("Error processing day in monthly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet5Data = [];
        const sheet5Headers = ['월(Month)', '업무', '총 시간(분)', '총 인건비(원)', '총 처리량(개)', '평균 처리량(개/분)', '평균 처리비용(원/개)', '총 참여인원(명)', '평균 처리시간(건)'];
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => a.localeCompare(b));

        for (const monthKey of sortedMonths) {
            const dataset = monthlyData[monthKey];
            const records = dataset.workRecords || [];
            const quantities = dataset.taskQuantities || {};
            const taskSummary = records.reduce((acc, r) => {
                if (!r || !r.task) return acc;
                if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
                acc[r.task].duration += (r.duration || 0);
                const wage = combinedWageMap[r.member] || 0;
                acc[r.task].cost += ((r.duration || 0) / 60) * wage;
                acc[r.task].members.add(r.member);
                acc[r.task].recordCount += 1;
                return acc;
            }, {});
            Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
                const qty = Number(qtyValue) || 0;
                if (!taskSummary[task]) taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
                taskSummary[task].quantity = (taskSummary[task].quantity || 0) + qty;
            });
            Object.keys(taskSummary).sort().forEach(task => {
                const summary = taskSummary[task];
                const qty = summary.quantity || 0;
                const duration = summary.duration || 0;
                const cost = summary.cost || 0;
                const avgThroughput = duration > 0 ? (qty / duration).toFixed(2) : '0.00';
                const avgCostPerItem = qty > 0 ? (cost / qty).toFixed(0) : '0';
                const avgStaff = summary.members.size;
                const avgTime = (summary.recordCount > 0) ? (duration / summary.recordCount) : 0;
                
                sheet5Data.push({
                    '월(Month)': monthKey,
                    '업무': task,
                    '총 시간(분)': Math.round(duration),
                    '총 인건비(원)': Math.round(cost),
                    '총 처리량(개)': qty,
                    '평균 처리량(개/분)': avgThroughput,
                    '평균 처리비용(원/개)': avgCostPerItem,
                    '총 참여인원(명)': avgStaff,
                    '평균 처리시간(건)': formatDuration(avgTime)
                });
            });
        }
        const worksheet5 = XLSX.utils.json_to_sheet(sheet5Data, { header: sheet5Headers });
        fitToColumn(worksheet5);
        XLSX.utils.book_append_sheet(workbook, worksheet5, '월별 업무 요약 (전체)');

        XLSX.writeFile(workbook, `업무기록_${dateKey}_및_전체요약.xlsx`);

    } catch (error) {
        console.error('Excel export failed:', error);
        showToast('Excel 파일 생성에 실패했습니다.', true);
    }
};

/**
 * 근태 이력 엑셀 다운로드
 */
export const downloadAttendanceHistoryAsExcel = async (dateKey) => {
    try {
        const data = allHistoryData.find(d => d.id === dateKey);
        if (!data) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }

        const workbook = XLSX.utils.book_new();

        const dailyRecords = data.onLeaveMembers || [];
        const sheet1Data = dailyRecords
            .sort((a, b) => (a.member || '').localeCompare(b.member || ''))
            .map(entry => {
                let detailText = '-';
                if (entry.startTime) {
                    detailText = formatTimeTo24H(entry.startTime);
                    if (entry.endTime) detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
                    else if (entry.type === '외출') detailText += ' ~';
                } else if (entry.startDate) {
                    detailText = entry.startDate;
                    if (entry.endDate && entry.endDate !== entry.startDate) detailText += ` ~ ${entry.endDate}`;
                }
                return {
                    '이름': entry.member || '',
                    '유형': entry.type || '',
                    '시간 / 기간': detailText
                };
            });
        
        const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: ['이름', '유형', '시간 / 기간'] });
        fitToColumn(worksheet1);
        XLSX.utils.book_append_sheet(workbook, worksheet1, `근태 기록 (${dateKey})`);

        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string') return acc;
            try {
                 const dateObj = new Date(day.id);
                 if (isNaN(dateObj.getTime())) return acc;
                 const weekKey = getWeekOfYear(dateObj);
                 if (!weekKey) return acc;
                if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };
                day.onLeaveMembers.forEach(entry => {
                    if (entry && entry.type && entry.member) {
                        if (entry.startDate) {
                            const currentDate = day.id;
                            const startDate = entry.startDate;
                            const endDate = entry.endDate || entry.startDate;
                            if (currentDate >= startDate && currentDate <= endDate) {
                                acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                            }
                        } else {
                            acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    }
                });
                acc[weekKey].dateKeys.add(day.id);
            } catch (e) { console.error("Error processing day in attendance weekly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet2Data = [];
        const sheet2Headers = ['주(Week)', '이름', '유형', '횟수/일수'];
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => a.localeCompare(b));

        for (const weekKey of sortedWeeks) {
            const weekSummaryData = weeklyData[weekKey];
            const summary = weekSummaryData.leaveEntries.reduce((acc, entry) => {
                const key = `${entry.member}-${entry.type}`;
                if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };
                if(entry.startDate) acc[key].count += 1;
                else acc[key].count += 1;
                return acc;
            }, {});

            Object.values(summary).forEach(item => {
                 if (['연차', '출장', '결근'].includes(item.type)) {
                     item.days = item.count;
                 }
            });

            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                sheet2Data.push({
                    '주(Week)': weekKey,
                    '이름': item.member,
                    '유형': item.type,
                    '횟수/일수': item.days > 0 ? `${item.days}일` : `${item.count}회`
                });
            });
        }
        const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
        fitToColumn(worksheet2);
        XLSX.utils.book_append_sheet(workbook, worksheet2, '주별 근태 요약 (전체)');

        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 7) return acc;
             try {
                const monthKey = day.id.substring(0, 7);
                 if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;
                if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };
                day.onLeaveMembers.forEach(entry => {
                     if (entry && entry.type && entry.member) {
                        if (entry.startDate) {
                            const currentDate = day.id;
                            const startDate = entry.startDate;
                            const endDate = entry.endDate || entry.startDate;
                            if (currentDate >= startDate && currentDate <= endDate) {
                                acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                            }
                        } else {
                            acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    }
                });
                acc[monthKey].dateKeys.add(day.id);
            } catch (e) { console.error("Error processing day in attendance monthly aggregation:", day.id, e); }
            return acc;
        }, {});

        const sheet3Data = [];
        const sheet3Headers = ['월(Month)', '이름', '유형', '횟수/일수'];
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => a.localeCompare(b));

        for (const monthKey of sortedMonths) {
            const monthSummaryData = monthlyData[monthKey];
            const summary = monthSummaryData.leaveEntries.reduce((acc, entry) => {
                const key = `${entry.member}-${entry.type}`;
                if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };
                if(entry.startDate) acc[key].count += 1;
                else acc[key].count += 1;
                return acc;
            }, {});

            Object.values(summary).forEach(item => {
                 if (['연차', '출장', '결근'].includes(item.type)) {
                     item.days = item.count;
                 }
            });

            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                sheet3Data.push({
                    '월(Month)': monthKey,
                    '이름': item.member,
                    '유형': item.type,
                    '횟수/일수': item.days > 0 ? `${item.days}일` : `${item.count}회`
                });
            });
        }
        const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
        fitToColumn(worksheet3);
        XLSX.utils.book_append_sheet(workbook, worksheet3, '월별 근태 요약 (전체)');

        XLSX.writeFile(workbook, `근태기록_${dateKey}_및_전체요약.xlsx`);

    } catch (error) {
        console.error('Attendance Excel export failed:', error);
        showToast('근태 Excel 파일 생성에 실패했습니다.', true);
    }
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
  
  renderHistoryDateListByMode(listMode);

  if (viewToShow) viewToShow.classList.remove('hidden');
  if (tabToActivate) {
      tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
      tabToActivate.classList.remove('text-gray-500');
  }
};