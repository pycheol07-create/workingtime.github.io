// === js/app-history-logic.js ===
// 설명: '이력 보기' 모달의 UI 렌더링과 상태 관리를 담당합니다.
// (데이터 로직은 history-data-manager.js로, 계산 로직은 analysis-logic.js로 분리됨)

import * as DOM from './dom-elements.js';
import * as State from './state.js';

// ⛔️ [삭제] app.js 임포트 (더 이상 사용하지 않음)

import {
    renderQuantityModalInputs,
    renderAttendanceDailyHistory,
    renderAttendanceWeeklyHistory,
    renderAttendanceMonthlyHistory,
    renderWeeklyHistory,
    renderMonthlyHistory,
    renderTrendAnalysisCharts,
    renderReportDaily,
    renderReportWeekly,
    renderReportMonthly,
    renderReportYearly
} from './ui.js';

import {
    formatDuration, isWeekday, getWeekOfYear,
    getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast
} from './utils.js';

// Firestore 함수 임포트 (openHistoryQuantityModal에서만 사용)
import {
    doc, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 표준 속도 계산 함수 임포트
import { calculateStandardThroughputs, PRODUCTIVITY_METRIC_DESCRIPTIONS, getDiffHtmlForMetric, createTableRow } from './ui-history-reports-logic.js';

// ✅ [신규] 분리된 분석 로직 임포트
import {
    checkMissingQuantities
    // ⛔️ [삭제] calculateSimulation, generateEfficiencyChartData, analyzeBottlenecks (이 파일에서 더 이상 사용 안 함)
} from './analysis-logic.js';

// ✅ [신규] 분리된 데이터 로직 임포트
import {
    syncTodayToHistory,
    // ⛔️ [삭제] saveProgress, saveDayDataToHistory (이 파일에서 더 이상 사용 안 함)
    fetchAllHistoryData,
    getDailyDocRef
} from './history-data-manager.js';


// ⛔️ [삭제] 다른 모듈을 위한 재내보내기(re-export) 구문이 모두 제거되었습니다.


// ✅ [신규] 연차/출장 등 지속성 근태 기록을 이력 데이터에 주입하는 헬퍼
function augmentHistoryWithPersistentLeave(historyData, leaveSchedule) {
    if (!leaveSchedule || !leaveSchedule.onLeaveMembers || leaveSchedule.onLeaveMembers.length === 0) {
        return historyData;
    }

    // 1. '연차', '출장', '결근' 타입의 근태만 필터링
    const persistentLeaves = leaveSchedule.onLeaveMembers.filter(
        entry => entry.type === '연차' || entry.type === '출장' || entry.type === '결근'
    );

    if (persistentLeaves.length === 0) return historyData;

    // 2. 중복 주입을 방지하기 위해, 각 날짜별로 이미 기록된 (멤버, 타입)을 Set으로 만듭니다.
    const existingEntriesMap = new Map();
    historyData.forEach(day => {
        const entries = new Set();
        (day.onLeaveMembers || []).forEach(entry => {
            // 날짜 기반(연차/출장/결근) 또는 '기타'에서 수동 추가된 날짜 기반 항목을 식별합니다.
            if (entry.startDate || entry.type === '연차' || entry.type === '출장' || entry.type === '결근') {
                entries.add(`${entry.member}::${entry.type}`);
            }
        });
        existingEntriesMap.set(day.id, entries);
    });

    // 3. 모든 지속성 근태 기록을 순회합니다.
    persistentLeaves.forEach(pLeave => {
        if (!pLeave.startDate) return; // 시작일이 없으면 처리 불가

        // ✅ [수정] new Date("YYYY-MM-DD")는 로컬 타임존 기준으로 생성됩니다.
        // KST (UTC+9)에서 "2025-11-14" -> 2025-11-14 00:00:00 KST
        // 이를 toISOString()으로 변환하면 2025-11-13T15:00:00Z 가 되어 날짜가 하루 밀립니다.
        // Date.UTC()를 사용하여 UTC 00:00:00 기준으로 Date 객체를 생성합니다.
        
        const [sY, sM, sD] = pLeave.startDate.split('-').map(Number);
        const effectiveEndDate = pLeave.endDate || pLeave.startDate;
        const [eY, eM, eD] = effectiveEndDate.split('-').map(Number);

        // Date.UTC는 월을 0-11 기준으로 받으므로 sM-1, eM-1을 사용
        const startDate = new Date(Date.UTC(sY, sM - 1, sD));
        const endDate = new Date(Date.UTC(eY, eM - 1, eD));

        // 4. 시작일부터 종료일까지 하루씩 순회합니다. (UTC 기준)
        for (let d = new Date(startDate); d <= endDate; d.setUTCDate(d.getUTCDate() + 1)) {
            
            // ✅ [수정] UTC Date 객체를 toISOString().slice(0, 10)으로 변환하면
            // (예: 2025-11-14T00:00:00.000Z -> "2025-11-14") 정확한 날짜가 나옵니다.
            const dateKey = d.toISOString().slice(0, 10);
            
            const dayData = historyData.find(day => day.id === dateKey);
            const existingEntries = existingEntriesMap.get(dateKey);

            // 5. 해당 날짜(dateKey)에 이력(dayData)이 존재하고, 중복 검사 맵(existingEntries)이 있을 경우
            if (dayData && existingEntries) {
                const entryKey = `${pLeave.member}::${pLeave.type}`;
                
                // 6. 아직 해당 날짜에 이 근태 기록이 주입되지 않았다면 주입합니다.
                if (!existingEntries.has(entryKey)) {
                    if (!dayData.onLeaveMembers) {
                        dayData.onLeaveMembers = [];
                    }
                    // pLeave 객체의 복사본을 주입 (원본 수정을 방지)
                    dayData.onLeaveMembers.push({ ...pLeave });
                    existingEntries.add(entryKey); // 맵에 추가하여 중복 방지
                }
            }
            // (만약 해당 날짜(dateKey)에 이력(dayData)이 아예 없다면, 아무것도 하지 않습니다.)
        }
    });

    return historyData;
}


export const loadAndRenderHistoryList = async () => {
    if (!DOM.historyDateList) return;
    DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';

    await fetchAllHistoryData(); // ✅ 1. Firebase에서 모든 이력 로드 (-> State.allHistoryData)
    await syncTodayToHistory();  // ✅ 2. 오늘 데이터 이력에 덮어쓰기 (-> State.allHistoryData)

    // ✅ [신규] 3. 지속성 근태 기록(연차 등)을 State.allHistoryData에 주입
    augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);

    if (State.allHistoryData.length === 0) {
        DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
        const viewsToClear = [
            'history-daily-view', 'history-weekly-view', 'history-monthly-view',
            'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view',
            'report-daily-view', 'report-weekly-view', 'report-monthly-view', 'report-yearly-view'
        ];
        viewsToClear.forEach(viewId => {
            const viewEl = document.getElementById(viewId);
            if (viewEl) viewEl.innerHTML = '';
        });
        return;
    }

    document.querySelectorAll('.history-main-tab-btn[data-main-tab="work"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.remove('font-medium', 'text-gray-500');
    });
    document.querySelectorAll('.history-main-tab-btn:not([data-main-tab="work"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.add('font-medium', 'text-gray-500');
    });

    document.querySelectorAll('#history-tabs button[data-view="daily"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.remove('text-gray-500');
    });
    document.querySelectorAll('#history-tabs button:not([data-view="daily"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.add('text-gray-500');
    });

    if (DOM.workHistoryPanel) DOM.workHistoryPanel.classList.remove('hidden');
    if (DOM.attendanceHistoryPanel) DOM.attendanceHistoryPanel.classList.add('hidden');
    if (DOM.trendAnalysisPanel) DOM.trendAnalysisPanel.classList.add('hidden');
    if (DOM.reportPanel) DOM.reportPanel.classList.add('hidden');

    document.getElementById('history-daily-view')?.classList.remove('hidden');
    document.getElementById('history-weekly-view')?.classList.add('hidden');
    document.getElementById('history-monthly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-daily-view')?.classList.add('hidden');
    document.getElementById('history-attendance-weekly-view')?.classList.add('hidden');
    document.getElementById('history-attendance-monthly-view')?.classList.add('hidden');
    document.getElementById('report-daily-view')?.classList.add('hidden');
    document.getElementById('report-weekly-view')?.classList.add('hidden');
    document.getElementById('report-monthly-view')?.classList.add('hidden');
    document.getElementById('report-yearly-view')?.classList.add('hidden');

    State.context.activeMainHistoryTab = 'work';
    State.context.reportSortState = {};
    State.context.currentReportParams = null;

    await renderHistoryDateListByMode('day');
};

export const renderHistoryDateListByMode = async (mode = 'day') => {
    if (!DOM.historyDateList) return;
    DOM.historyDateList.innerHTML = '';

    await syncTodayToHistory(); // ✅ 수정: 임포트된 함수 사용
    
    // ✅ [신규] 렌더링 직전에도 데이터 보강 (필터링 시 누락 방지)
    augmentHistoryWithPersistentLeave(State.allHistoryData, State.persistentLeaveSchedule);

    const filteredData = (State.context.historyStartDate || State.context.historyEndDate)
        ? State.allHistoryData.filter(d => {
            const date = d.id;
            const start = State.context.historyStartDate;
            const end = State.context.historyEndDate;
            if (start && end) return date >= start && date <= end;
            if (start) return date >= start;
            if (end) return date <= end;
            return true;
        })
        : State.allHistoryData;

    let keys = [];

    if (mode === 'day') {
        keys = filteredData.map(d => d.id);
    } else if (mode === 'week') {
        const weekSet = new Set(filteredData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))));
        keys = Array.from(weekSet).sort((a, b) => b.localeCompare(a));
    } else if (mode === 'month') {
        const monthSet = new Set(filteredData.map(d => d.id.substring(0, 7)));
        keys = Array.from(monthSet).sort((a, b) => b.localeCompare(a));
    } else if (mode === 'year') {
        const yearSet = new Set(filteredData.map(d => d.id.substring(0, 4)));
        keys = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
    }

    if (keys.length === 0) {
        DOM.historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        return;
    }

    keys.forEach(key => {
        const li = document.createElement('li');
        let hasWarning = false;
        let titleAttr = '';

        if (mode === 'day') {
            const dayData = filteredData.find(d => d.id === key);
            if (dayData) {
                const missingTasksList = checkMissingQuantities(dayData);
                hasWarning = missingTasksList.length > 0;
                if (hasWarning) {
                    titleAttr = ` title="처리량 누락: ${missingTasksList.join(', ')}"`;
                }
            }
        }

        li.innerHTML = `<button data-key="${key}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300 ${hasWarning ? 'warning-no-quantity' : ''}"${titleAttr}>${key}</button>`;
        DOM.historyDateList.appendChild(li);
    });

    const firstButton = DOM.historyDateList.firstChild?.querySelector('button');
    if (firstButton) {
        firstButton.click();
    }
};

export const openHistoryQuantityModal = (dateKey) => {
    const todayDateString = getTodayDateString();

    if (dateKey === todayDateString) {
        const todayData = {
            id: todayDateString,
            workRecords: State.appState.workRecords || [],
            taskQuantities: State.appState.taskQuantities || {},
            confirmedZeroTasks: State.appState.confirmedZeroTasks || []
        };
        const missingTasksList = checkMissingQuantities(todayData);
        renderQuantityModalInputs(State.appState.taskQuantities || {}, State.appConfig.quantityTaskTypes, missingTasksList, State.appState.confirmedZeroTasks || []);
    } else {
        const dayData = State.allHistoryData.find(d => d.id === dateKey);
        if (!dayData) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        const missingTasksList = checkMissingQuantities(dayData);
        renderQuantityModalInputs(dayData.taskQuantities || {}, State.appConfig.quantityTaskTypes, missingTasksList, dayData.confirmedZeroTasks || []);
    }

    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateKey} 처리량 수정`;

    State.context.quantityModalContext.mode = 'history';
    State.context.quantityModalContext.dateKey = dateKey;

    State.context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
        if (!dateKey) return;

        const idx = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (idx > -1) {
            State.allHistoryData[idx] = {
                ...State.allHistoryData[idx],
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            };
        }

        const historyDocRef = doc(State.db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            await setDoc(historyDocRef, {
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            }, { merge: true });

            showToast(`${dateKey}의 처리량이 수정되었습니다.`);

            if (dateKey === getTodayDateString()) {
                 // ✅ 수정: 임포트된 getDailyDocRef 사용
                 const dailyDocRef = getDailyDocRef();
                 await setDoc(dailyDocRef, { taskQuantities: newQuantities, confirmedZeroTasks: confirmedZeroTasks }, { merge: true });
            }

            if (DOM.historyModal && !DOM.historyModal.classList.contains('hidden')) {
                const activeSubTabBtn = document.querySelector('#history-tabs button.font-semibold')
                                     || document.querySelector('#report-tabs button.font-semibold');
                const currentView = activeSubTabBtn ? activeSubTabBtn.dataset.view : 'daily';

                await switchHistoryView(currentView);
            }

        } catch (e) {
            console.error('Error updating history quantities:', e);
            showToast('처리량 업데이트 중 오류가 발생했습니다.', true);
        }
    };

    const cBtn = document.getElementById('confirm-quantity-btn');
    const xBtn = document.getElementById('cancel-quantity-btn');
    if (cBtn) cBtn.textContent = '수정 저장';
    if (xBtn) xBtn.textContent = '취소';
    if (DOM.quantityModal) DOM.quantityModal.classList.remove('hidden');
};

export const renderHistoryDetail = (dateKey, previousDayData = null) => {
    const view = document.getElementById('history-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';

    const data = State.allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>';
        return;
    }

    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};
    const onLeaveMemberEntries = data.onLeaveMembers || [];
    const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
    const partTimersFromHistory = data.partTimers || [];

    const wageMap = { ...State.appConfig.memberWages };
    partTimersFromHistory.forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });

    const allRegularMembers = new Set((State.appConfig.teamGroups || []).flatMap(g => g.members));
    const activeMembersCount = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length
        + partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;

    const totalSumDuration = records.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
    const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

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

    let prevTaskMetrics = {};
    let prevDay = previousDayData;
    if (!prevDay) {
        const currentIndex = State.allHistoryData.findIndex(d => d.id === dateKey);
        if (currentIndex > -1 && currentIndex + 1 < State.allHistoryData.length) {
            prevDay = State.allHistoryData[currentIndex + 1];
        }
    }

    if (prevDay) {
        const prevRecords = prevDay.workRecords || [];
        const prevQuantities = prevDay.taskQuantities || {};

        allTaskKeys.forEach(task => {
            const taskRecords = prevRecords.filter(r => r.task === task);
            const duration = taskRecords.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
            const cost = taskRecords.reduce((sum, r) => {
                const wage = wageMap[r.member] || 0;
                return sum + ((Number(r.duration) || 0) / 60) * wage;
            }, 0);
            const qty = Number(prevQuantities[task]) || 0;

            if (duration > 0 || qty > 0) {
                prevTaskMetrics[task] = {
                    date: prevDay.id,
                    duration: duration,
                    cost: cost,
                    quantity: qty,
                    avgThroughput: duration > 0 ? (qty / duration) : 0,
                    avgCostPerItem: qty > 0 ? (cost / qty) : 0
                };
            }
        });
    }

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
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasQuantities = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('quantity', metrics.quantity, prevMetric?.quantity);
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
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasThroughput = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevMetric?.avgThroughput);
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
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasCostPerItem = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevMetric?.avgCostPerItem);
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
        .sort(([, a], [, b]) => b.duration - a.duration)
        .forEach(([task, metrics]) => {
            const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('duration', metrics.duration, prevMetric?.duration);

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

export const requestHistoryDeletion = (dateKey) => {
    State.context.historyKeyToDelete = dateKey;
    if (DOM.deleteHistoryModal) DOM.deleteHistoryModal.classList.remove('hidden');
};

export const switchHistoryView = async (view) => {
    const allViews = [
        document.getElementById('history-daily-view'),
        document.getElementById('history-weekly-view'),
        document.getElementById('history-monthly-view'),
        document.getElementById('history-attendance-daily-view'),
        document.getElementById('history-attendance-weekly-view'),
        document.getElementById('history-attendance-monthly-view'),
        document.getElementById('report-daily-view'),
        document.getElementById('report-weekly-view'),
        document.getElementById('report-monthly-view'),
        document.getElementById('report-yearly-view')
    ];
    allViews.forEach(v => v && v.classList.add('hidden'));

    if (DOM.historyTabs) {
        DOM.historyTabs.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
            btn.classList.add('text-gray-500');
        });
    }
    if (DOM.attendanceHistoryTabs) {
        DOM.attendanceHistoryTabs.querySelectorAll('button').forEach(btn => {
            btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
            btn.classList.add('text-gray-500');
        });
    }
    if (DOM.reportTabs) {
        DOM.reportTabs.querySelectorAll('button').forEach(btn => {
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

    switch (view) {
        case 'daily':
            listMode = 'day';
            viewToShow = document.getElementById('history-daily-view');
            tabToActivate = DOM.historyTabs?.querySelector('button[data-view="daily"]');
            break;
        case 'weekly':
            listMode = 'week';
            viewToShow = document.getElementById('history-weekly-view');
            tabToActivate = DOM.historyTabs?.querySelector('button[data-view="weekly"]');
            break;
        case 'monthly':
            listMode = 'month';
            viewToShow = document.getElementById('history-monthly-view');
            tabToActivate = DOM.historyTabs?.querySelector('button[data-view="monthly"]');
            break;
        case 'attendance-daily':
            listMode = 'day';
            viewToShow = document.getElementById('history-attendance-daily-view');
            tabToActivate = DOM.attendanceHistoryTabs?.querySelector('button[data-view="attendance-daily"]');
            break;
        case 'attendance-weekly':
            listMode = 'week';
            viewToShow = document.getElementById('history-attendance-weekly-view');
            tabToActivate = DOM.attendanceHistoryTabs?.querySelector('button[data-view="attendance-weekly"]');
            break;
        case 'attendance-monthly':
            listMode = 'month';
            viewToShow = document.getElementById('history-attendance-monthly-view');
            tabToActivate = DOM.attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
            break;
        case 'report-daily':
            listMode = 'day';
            viewToShow = document.getElementById('report-daily-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-daily"]');
            break;
        case 'report-weekly':
            listMode = 'week';
            viewToShow = document.getElementById('report-weekly-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-weekly"]');
            break;
        case 'report-monthly':
            listMode = 'month';
            viewToShow = document.getElementById('report-monthly-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-monthly"]');
            break;
        case 'report-yearly':
            listMode = 'year';
            viewToShow = document.getElementById('report-yearly-view');
            tabToActivate = DOM.reportTabs?.querySelector('button[data-view="report-yearly"]');
            break;
    }

    await renderHistoryDateListByMode(listMode);

    if (viewToShow) viewToShow.classList.remove('hidden');
    if (tabToActivate) {
        tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        tabToActivate.classList.remove('text-gray-500');
    }
};