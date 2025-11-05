// === app-history-logic.js (이력 관리 로직) ===

import {
    appState, appConfig, db, auth, allHistoryData, context,
    historyDateList, historyTabs, attendanceHistoryTabs,
    workHistoryPanel, attendanceHistoryPanel, trendAnalysisPanel, reportPanel, reportTabs,
    deleteHistoryModal, quantityModal,
    render, debouncedSaveState, saveStateToFirestore
} from './app.js';
import {
  renderQuantityModalInputs, renderAttendanceDailyHistory, renderAttendanceWeeklyHistory,
  renderAttendanceMonthlyHistory, renderWeeklyHistory, renderMonthlyHistory,
  renderTrendAnalysisCharts, renderReportDaily, renderReportWeekly, renderReportMonthly, renderReportYearly
} from './ui.js';
import {
    formatDuration, isWeekday, getWeekOfYear, getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast
} from './utils.js';
import { doc, setDoc, getDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// --- 내부 헬퍼 함수 ---

const _syncTodayToHistory = () => {
    const todayKey = getTodayDateString();
    const liveTodayData = {
        id: todayKey,
        workRecords: JSON.parse(JSON.stringify(appState.workRecords || [])),
        taskQuantities: JSON.parse(JSON.stringify(appState.taskQuantities || {})),
        onLeaveMembers: [...(JSON.parse(JSON.stringify(appState.dailyOnLeaveMembers || []))), ...(JSON.parse(JSON.stringify(appState.dateBasedOnLeaveMembers || [])))],
        partTimers: JSON.parse(JSON.stringify(appState.partTimers || []))
    };
    const idx = allHistoryData.findIndex(d => d.id === todayKey);
    if (idx > -1) allHistoryData[idx] = liveTodayData;
    else { allHistoryData.unshift(liveTodayData); allHistoryData.sort((a, b) => b.id.localeCompare(a.id)); }
};

export const checkMissingQuantities = (dayData) => {
    if (!dayData || !dayData.workRecords) return [];
    const quantities = dayData.taskQuantities || {};
    const durationByTask = dayData.workRecords.reduce((acc, r) => {
        if (r.task && r.duration > 0) acc[r.task] = (acc[r.task] || 0) + r.duration;
        return acc;
    }, {});
    const quantityTaskTypes = appConfig.quantityTaskTypes || [];
    return Object.keys(durationByTask).filter(task => quantityTaskTypes.includes(task) && (!quantities[task] || Number(quantities[task]) <= 0));
};

// --- 핵심 로직 함수 ---

export async function saveProgress(isAutoSave = false) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();
    if (!isAutoSave) showToast('현재 상태를 이력에 저장합니다...');
    
    try {
        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);
        const docSnap = await getDoc(historyDocRef);
        const existingData = docSnap.exists() ? (docSnap.data() || {}) : {};
        
        const allRecordsSnapshot = (appState.workRecords || []).map(record => {
            const snapshot = JSON.parse(JSON.stringify(record));
            if (snapshot.status !== 'completed') {
                snapshot.duration = calcElapsedMinutes(snapshot.startTime, now, snapshot.pauses);
                snapshot.endTime = now;
            }
            return snapshot;
        });

        const currentQuantities = {};
        for (const task in (appState.taskQuantities || {})) {
            const q = Number(appState.taskQuantities[task]);
            if (!Number.isNaN(q) && q >= 0) currentQuantities[task] = q;
        }

        const mergedRecordsMap = new Map();
        (existingData.workRecords || []).forEach(r => mergedRecordsMap.set(r.id, r));
        allRecordsSnapshot.forEach(r => mergedRecordsMap.set(r.id, r));

        await setDoc(historyDocRef, {
            workRecords: Array.from(mergedRecordsMap.values()),
            taskQuantities: currentQuantities,
            onLeaveMembers: [...(appState.dailyOnLeaveMembers || []), ...(appState.dateBasedOnLeaveMembers || [])],
            partTimers: appState.partTimers || []
        });

        if (isAutoSave) console.log(`Auto-save completed at ${now}`);
        else showToast('현재 상태가 이력에 저장되었습니다.');
    } catch (e) {
        console.error('Error in saveProgress:', e);
        showToast(`이력 저장 오류: ${e.message}`, true);
    }
}

export async function saveDayDataToHistory(shouldReset) {
    const endTime = getCurrentTime();
    (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused').forEach(rec => {
        if (rec.status === 'paused') {
            const lastPause = rec.pauses?.[rec.pauses.length - 1];
            if (lastPause && lastPause.end === null) lastPause.end = endTime;
        }
        rec.status = 'completed';
        rec.endTime = endTime;
        rec.duration = calcElapsedMinutes(rec.startTime, endTime, rec.pauses);
    });

    await saveProgress(false);
    appState.workRecords = [];
    if (shouldReset) {
        Object.keys(appState.taskQuantities || {}).forEach(task => appState.taskQuantities[task] = 0);
        appState.partTimers = [];
        appState.hiddenGroupIds = [];
        appState.dailyOnLeaveMembers = (getCurrentTime() < "17:30") ? (appState.dailyOnLeaveMembers || []).filter(e => e.type === '조퇴') : [];
        showToast('오늘의 업무 기록을 초기화했습니다.');
    }
    await saveStateToFirestore();
    render();
}

export async function fetchAllHistoryData() {
    try {
        const querySnapshot = await getDocs(collection(db, 'artifacts', 'team-work-logger-v2', 'history'));
        const data = [];
        querySnapshot.forEach((doc) => {
            const d = doc.data();
            if (d && ((d.workRecords?.length > 0) || (d.onLeaveMembers?.length > 0) || (d.partTimers?.length > 0))) {
                data.push({ id: doc.id, ...d });
            }
        });
        allHistoryData.length = 0;
        allHistoryData.push(...data.sort((a, b) => b.id.localeCompare(a.id)));
        return allHistoryData;
    } catch (error) {
        console.error('Error fetching history:', error);
        showToast('이력 로딩 실패', true);
        return [];
    }
}

// --- 화면 렌더링 및 전환 함수 ---

export const loadAndRenderHistoryList = async () => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">로딩 중...</div></li>';
    await fetchAllHistoryData();
    _syncTodayToHistory();

    if (allHistoryData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 없음</div></li>';
        ['history-daily-view','history-weekly-view','history-monthly-view','history-attendance-daily-view','history-attendance-weekly-view','history-attendance-monthly-view','report-daily-view','report-weekly-view','report-monthly-view','report-yearly-view'].forEach(id => document.getElementById(id).innerHTML = '');
        return;
    }

    // 탭 초기화
    [historyTabs, attendanceHistoryTabs, reportTabs].forEach(tabs => tabs?.querySelectorAll('button').forEach(btn => btn.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600')));
    document.querySelectorAll('.history-main-tab-btn').forEach(btn => btn.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600'));
    document.querySelector('.history-main-tab-btn[data-main-tab="work"]')?.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
    historyTabs?.querySelector('button[data-view="daily"]')?.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');

    // 패널 초기화
    [attendanceHistoryPanel, trendAnalysisPanel, reportPanel].forEach(p => p?.classList.add('hidden'));
    workHistoryPanel?.classList.remove('hidden');
    document.querySelectorAll('#history-view-container > div, #attendance-history-view-container > div, #report-view-container > div').forEach(v => v.classList.add('hidden'));
    document.getElementById('history-daily-view')?.classList.remove('hidden');

    context.activeMainHistoryTab = 'work';
    context.reportSortState = {};
    context.currentReportParams = null;
    renderHistoryDateListByMode('day');
};

export const renderHistoryDateListByMode = (mode = 'day') => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '';
    _syncTodayToHistory();

    const filtered = (context.historyStartDate || context.historyEndDate) ? allHistoryData.filter(d => (!context.historyStartDate || d.id >= context.historyStartDate) && (!context.historyEndDate || d.id <= context.historyEndDate)) : allHistoryData;
    let keys = [];
    if (mode === 'day') keys = filtered.map(d => d.id);
    else {
        const keySet = new Set(filtered.map(d => mode === 'week' ? getWeekOfYear(new Date(d.id + "T00:00:00")) : (mode === 'month' ? d.id.substring(0, 7) : d.id.substring(0, 4))));
        keys = Array.from(keySet).sort((a, b) => b.localeCompare(a));
    }

    if (keys.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        return;
    }

    keys.forEach(key => {
        const li = document.createElement('li');
        let warning = (mode === 'day' && checkMissingQuantities(filtered.find(d => d.id === key)).length > 0) ? 'warning-no-quantity' : '';
        li.innerHTML = `<button data-key="${key}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition ${warning}">${key}</button>`;
        historyDateList.appendChild(li);
    });

    const firstBtn = historyDateList.firstChild?.querySelector('button');
    if (firstBtn) {
        firstBtn.classList.add('bg-blue-100', 'font-bold');
        const key = firstBtn.dataset.key;
        context.reportSortState = {};
        
        const tab = context.activeMainHistoryTab;
        if (tab === 'work') {
            if (mode === 'day') renderHistoryDetail(key);
            else if (mode === 'week') renderWeeklyHistory(key, filtered, appConfig);
            else if (mode === 'month') renderMonthlyHistory(key, filtered, appConfig);
        } else if (tab === 'attendance') {
            if (mode === 'day') renderAttendanceDailyHistory(key, filtered);
            else if (mode === 'week') renderAttendanceWeeklyHistory(key, filtered);
            else if (mode === 'month') renderAttendanceMonthlyHistory(key, filtered);
        } else if (tab === 'report') {
            if (mode === 'day') renderReportDaily(key, filtered, appConfig, context);
            else if (mode === 'week') renderReportWeekly(key, filtered, appConfig, context);
            else if (mode === 'month') renderReportMonthly(key, filtered, appConfig, context);
            else if (mode === 'year') renderReportYearly(key, filtered, appConfig, context);
        }
    }
};

export const openHistoryQuantityModal = (dateKey) => {
    const isToday = dateKey === getTodayDateString();
    const data = isToday ? { workRecords: appState.workRecords, taskQuantities: appState.taskQuantities } : allHistoryData.find(d => d.id === dateKey);
    if (!data) return showToast('데이터를 찾을 수 없습니다.', true);

    renderQuantityModalInputs(data.taskQuantities || {}, appConfig.quantityTaskTypes, checkMissingQuantities(data));
    document.getElementById('quantity-modal-title').textContent = `${dateKey} 처리량 수정`;
    context.quantityModalContext.mode = 'history';
    context.quantityModalContext.dateKey = dateKey;
    document.getElementById('confirm-quantity-btn').textContent = '수정 저장';
    if (quantityModal) quantityModal.classList.remove('hidden');
};

export const renderHistoryDetail = (dateKey, previousDayData = null) => {
    const view = document.getElementById('history-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">로딩 중...</div>';
    
    const data = allHistoryData.find(d => d.id === dateKey);
    if (!data) { view.innerHTML = '<div class="text-center text-red-500">데이터 없음</div>'; return; }

    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};
    const wageMap = { ...appConfig.memberWages };
    (data.partTimers || []).forEach(pt => { if (pt?.name && !wageMap[pt.name]) wageMap[pt.name] = pt.wage || 0; });

    const allRegulars = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
    const onLeave = new Set((data.onLeaveMembers || []).map(e => e.member));
    const activeCount = allRegulars.size - [...onLeave].filter(n => allRegulars.has(n)).length + (data.partTimers || []).length - [...onLeave].filter(n => (data.partTimers || []).some(pt => pt.name === n)).length;

    const totalDuration = records.reduce((s, r) => s + (Number(r.duration) || 0), 0);
    const totalQty = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);
    const metrics = {};
    
    records.forEach(r => {
        if (!metrics[r.task]) metrics[r.task] = { duration: 0, cost: 0, quantity: Number(quantities[r.task]) || 0 };
        metrics[r.task].duration += (Number(r.duration) || 0);
        metrics[r.task].cost += ((Number(r.duration) || 0) / 60) * (wageMap[r.member] || 0);
    });
    Object.keys(metrics).forEach(t => {
        metrics[t].avgThroughput = metrics[t].duration > 0 ? (metrics[t].quantity / metrics[t].duration) : 0;
        metrics[t].avgCostPerItem = metrics[t].quantity > 0 ? (metrics[t].cost / metrics[t].quantity) : 0;
    });

    // (이전 데이터 비교 로직 생략 - 리포트 기능으로 대체 권장)

    let html = `
        <div class="mb-6 pb-4 border-b flex justify-between items-center"><h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3><div><button class="bg-blue-500 hover:bg-blue-600 text-white py-1 px-3 rounded text-sm" data-action="open-history-quantity-modal" data-date-key="${dateKey}">처리량 수정</button><button class="bg-green-600 hover:bg-green-700 text-white py-1 px-3 rounded text-sm ml-2" data-action="download-history-excel" data-date-key="${dateKey}">엑셀</button><button class="bg-red-600 hover:bg-red-700 text-white py-1 px-3 rounded text-sm ml-2" data-action="request-history-deletion" data-date-key="${dateKey}">삭제</button></div></div>
        <div class="flex flex-wrap gap-4 mb-6 text-center">
            <div class="bg-white p-4 rounded shadow-sm flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">근무 인원</h4><p class="text-2xl font-bold">${activeCount} 명</p></div>
            <div class="bg-white p-4 rounded shadow-sm flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold">${formatDuration(totalDuration)}</p></div>
            <div class="bg-white p-4 rounded shadow-sm flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold">${totalQty} 개</p></div>
            <div class="bg-white p-4 rounded shadow-sm flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">분당 평균</h4><p class="text-2xl font-bold">${totalDuration > 0 ? (totalQty / totalDuration).toFixed(2) : '0.00'} 개/분</p></div>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="bg-white p-4 rounded shadow-sm"><h4 class="text-lg font-bold mb-3">업무별 처리량</h4><div class="space-y-2 max-h-60 overflow-y-auto">${Object.entries(metrics).filter(([,m])=>m.quantity>0).sort(([a],[b])=>a.localeCompare(b)).map(([t,m])=>`<div class="flex justify-between text-sm border-b pb-1"><span class="font-semibold">${t}</span><span>${m.quantity} 개</span></div>`).join('')||'<p class="text-gray-500 text-sm">데이터 없음</p>'}</div></div>
            <div class="bg-white p-4 rounded shadow-sm"><h4 class="text-lg font-bold mb-3">업무별 시간 비중</h4><div class="space-y-3 max-h-60 overflow-y-auto">${Object.entries(metrics).filter(([,m])=>m.duration>0).sort(([,a],[,b])=>b.duration-a.duration).map(([t,m])=>{const pct=(m.duration/totalDuration*100).toFixed(1);return `<div><div class="flex justify-between mb-1 text-sm"><span class="font-semibold">${t}</span><span>${formatDuration(m.duration)} (${pct}%)</span></div><div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width:${pct}%"></div></div></div>`}).join('')||'<p class="text-gray-500 text-sm">데이터 없음</p>'}</div></div>
        </div>`;
    view.innerHTML = html;
};

export const requestHistoryDeletion = (dateKey) => {
    context.historyKeyToDelete = dateKey;
    if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};

export const switchHistoryView = (view) => {
    document.querySelectorAll('#history-view-container > div, #attendance-history-view-container > div, #report-view-container > div').forEach(v => v.classList.add('hidden'));
    [historyTabs, attendanceHistoryTabs, reportTabs].forEach(t => t?.querySelectorAll('button').forEach(b => b.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2')));

    let mode = 'day', targetView, targetTab;
    if (view.includes('weekly')) mode = 'week'; else if (view.includes('monthly')) mode = 'month'; else if (view.includes('yearly')) mode = 'year';

    targetView = document.getElementById(view === 'daily' ? 'history-daily-view' : (view === 'weekly' ? 'history-weekly-view' : (view === 'monthly' ? 'history-monthly-view' : view)));
    targetTab = document.querySelector(`button[data-view="${view}"]`);

    if (targetView) targetView.classList.remove('hidden');
    if (targetTab) targetTab.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
    renderHistoryDateListByMode(mode);
};