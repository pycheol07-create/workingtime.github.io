// === js/app-history-logic.js ===
import {
    appConfig, db,
    allHistoryData,
    context,
    historyModal,
    historyDateList, historyTabs, attendanceHistoryTabs,
    workHistoryPanel, attendanceHistoryPanel, trendAnalysisPanel,
    reportPanel, reportTabs,
    deleteHistoryModal,
    quantityModal,
    render
} from './app.js';

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

// Firestore 함수 임포트
import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc,
    query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 🔥 [수정] getDiffHtmlForMetric 추가 임포트
import { calculateStandardThroughputs, getDiffHtmlForMetric } from './ui-history-reports-logic.js';


// workRecords 컬렉션 참조 헬퍼
const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};

// 메인 데일리 문서 참조 헬퍼
const getDailyDocRef = () => {
    return doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
};


// Firestore에서 직접 데이터를 읽어와 로컬 이력 리스트와 동기화
const _syncTodayToHistory = async () => {
    const todayKey = getTodayDateString();
    const now = getCurrentTime();

    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordsSnapshot = await getDocs(workRecordsColRef);
        const liveWorkRecords = recordsSnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        const dailyDocSnap = await getDoc(getDailyDocRef());
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};

        const liveTodayData = {
            id: todayKey,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities || {},
            confirmedZeroTasks: dailyData.confirmedZeroTasks || [],
            onLeaveMembers: dailyData.onLeaveMembers || [],
            partTimers: dailyData.partTimers || [],
            dailyAttendance: dailyData.dailyAttendance || {}
        };

        const idx = allHistoryData.findIndex(d => d.id === todayKey);
        if (idx > -1) {
            allHistoryData[idx] = liveTodayData;
        } else {
            allHistoryData.unshift(liveTodayData);
            allHistoryData.sort((a, b) => b.id.localeCompare(a.id));
        }

    } catch (e) {
        console.error("Error syncing today to history cache: ", e);
    }
};

export const checkMissingQuantities = (dayData) => {
    if (!dayData || !dayData.workRecords) return [];

    const records = dayData.workRecords;
    const quantities = dayData.taskQuantities || {};
    const confirmedZeroTasks = dayData.confirmedZeroTasks || [];

    const durationByTask = records.reduce((acc, r) => {
        if (r.task && r.duration > 0) {
            acc[r.task] = (acc[r.task] || 0) + r.duration;
        }
        return acc;
    }, {});

    const tasksWithDuration = Object.keys(durationByTask);
    if (tasksWithDuration.length === 0) return [];

    const quantityTaskTypes = appConfig.quantityTaskTypes || [];
    const missingTasks = [];

    for (const task of tasksWithDuration) {
        if (quantityTaskTypes.includes(task)) {
            const quantity = Number(quantities[task]) || 0;
            if (quantity <= 0 && !confirmedZeroTasks.includes(task)) {
                missingTasks.push(task);
            }
        }
    }

    return missingTasks;
};


// 이력 저장 (서버 권위 방식)
export async function saveProgress(isAutoSave = false) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();

    if (!isAutoSave) {
        showToast('서버의 최신 상태를 이력에 저장합니다...');
    }

    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);

    try {
        const dailyDocSnap = await getDoc(getDailyDocRef());
        const dailyData = dailyDocSnap.exists() ? dailyDocSnap.data() : {};

        const workRecordsColRef = getWorkRecordsCollectionRef();
        const recordsSnapshot = await getDocs(workRecordsColRef);
        const liveWorkRecords = recordsSnapshot.docs.map(doc => {
            const data = doc.data();
            if (data.status === 'ongoing' || data.status === 'paused') {
                data.duration = calcElapsedMinutes(data.startTime, now, data.pauses);
                data.endTime = now;
            }
            return data;
        });

        if (liveWorkRecords.length === 0 && Object.keys(dailyData.taskQuantities || {}).length === 0) {
             return;
        }

        const historyData = {
            id: dateStr,
            workRecords: liveWorkRecords,
            taskQuantities: dailyData.taskQuantities || {},
            confirmedZeroTasks: dailyData.confirmedZeroTasks || [],
            onLeaveMembers: dailyData.onLeaveMembers || [],
            partTimers: dailyData.partTimers || [],
            dailyAttendance: dailyData.dailyAttendance || {},
            savedAt: now
        };

        await setDoc(historyDocRef, historyData);
        await _syncTodayToHistory();

        if (isAutoSave) {
            console.log(`Auto-save (server-authoritative) completed at ${now}`);
        } else {
            showToast('최신 상태가 이력에 안전하게 저장되었습니다.');
        }

    } catch (e) {
        console.error('Error in saveProgress (server-authoritative): ', e);
        if (!isAutoSave) {
             showToast(`이력 저장 중 오류가 발생했습니다: ${e.message}`, true);
        }
    }
}

// 업무 마감 (전체 강제 종료 포함)
export async function saveDayDataToHistory(shouldReset) {
    const workRecordsColRef = getWorkRecordsCollectionRef();
    const endTime = getCurrentTime();

    try {
        const q = query(workRecordsColRef, where('status', 'in', ['ongoing', 'paused']));
        const querySnapshot = await getDocs(q);

        if (!querySnapshot.empty) {
            const batch = writeBatch(db);
            querySnapshot.forEach(docSnap => {
                const record = docSnap.data();
                let pauses = record.pauses || [];
                if (record.status === 'paused') {
                    const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                    if (lastPause && lastPause.end === null) {
                        lastPause.end = endTime;
                    }
                }
                const duration = calcElapsedMinutes(record.startTime, endTime, pauses);

                batch.update(docSnap.ref, {
                    status: 'completed',
                    endTime: endTime,
                    duration: duration,
                    pauses: pauses
                });
            });
            await batch.commit();
            console.log(`${querySnapshot.size}개의 진행 중인 업무를 강제 종료했습니다.`);
        }
    } catch (e) {
         console.error("Error finalizing ongoing tasks during shift end: ", e);
         showToast("업무 마감 중 진행 업무 종료 실패. (이력 저장은 계속 진행합니다)", true);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
    await saveProgress(false);

    if (shouldReset) {
         try {
            const qAll = query(workRecordsColRef);
            const snapshotAll = await getDocs(qAll);
            if (!snapshotAll.empty) {
                const deleteBatch = writeBatch(db);
                snapshotAll.forEach(doc => deleteBatch.delete(doc.ref));
                await deleteBatch.commit();
            }
             // 초기화 시에는 전체 상태를 비워야 하므로 setDoc({}) 사용
             await setDoc(getDailyDocRef(), {});
        } catch (e) {
             console.error("Error clearing daily data: ", e);
        }
        
        // app.js의 onSnapshot이 상태를 비워줄 것이므로 여기서는 UI 알림만
        showToast('오늘의 업무 기록을 초기화했습니다.');
    }
}

export async function fetchAllHistoryData() {
    const historyCollectionRef = collection(db, 'artifacts', 'team-work-logger-v2', 'history');
    try {
        const querySnapshot = await getDocs(historyCollectionRef);
        const data = [];
        querySnapshot.forEach((doc) => {
            const docData = doc.data();
            if (docData) {
                 data.push({ id: doc.id, ...docData });
            }
        });
        data.sort((a, b) => b.id.localeCompare(a.id));

        allHistoryData.length = 0;
        allHistoryData.push(...data);

        return allHistoryData;
    } catch (error) {
        console.error('Error fetching all history data:', error);
        showToast('전체 이력 로딩 실패', true);
        allHistoryData.length = 0;
        return [];
    }
}

export const loadAndRenderHistoryList = async () => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';

    await fetchAllHistoryData();
    await _syncTodayToHistory();

    if (allHistoryData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
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

    if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
    if (attendanceHistoryPanel) attendanceHistoryPanel.classList.add('hidden');
    if (trendAnalysisPanel) trendAnalysisPanel.classList.add('hidden');
    if (reportPanel) reportPanel.classList.add('hidden');

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

    context.activeMainHistoryTab = 'work';
    context.reportSortState = {};
    context.currentReportParams = null;

    await renderHistoryDateListByMode('day');
};

export const renderHistoryDateListByMode = async (mode = 'day') => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '';

    await _syncTodayToHistory();

    const filteredData = (context.historyStartDate || context.historyEndDate)
        ? allHistoryData.filter(d => {
            const date = d.id;
            const start = context.historyStartDate;
            const end = context.historyEndDate;
            if (start && end) return date >= start && date <= end;
            if (start) return date >= start;
            if (end) return date <= end;
            return true;
        })
        : allHistoryData;

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
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
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
        historyDateList.appendChild(li);
    });

    const firstButton = historyDateList.firstChild?.querySelector('button');
    if (firstButton) {
        firstButton.click();
    }
};

export const openHistoryQuantityModal = (dateKey) => {
    const todayDateString = getTodayDateString();

    if (dateKey === todayDateString) {
        const todayData = {
            id: todayDateString,
            workRecords: appState.workRecords || [],
            taskQuantities: appState.taskQuantities || {},
            confirmedZeroTasks: appState.confirmedZeroTasks || []
        };
        // 실제로는 app.js의 appState를 참조해야 정확하지만, 
        // 이 함수가 호출될 때는 보통 이력 모드이거나 오늘 날짜라도 appState가 최신화되어 있음.
        // 여기서는 안전하게 appState가 아닌 Firestore에서 다시 읽거나, 
        // 이미 동기화된 allHistoryData를 사용하는 것이 좋음.
        const dayData = allHistoryData.find(d => d.id === dateKey);
        if (dayData) {
             const missingTasksList = checkMissingQuantities(dayData);
             renderQuantityModalInputs(dayData.taskQuantities || {}, appConfig.quantityTaskTypes, missingTasksList, dayData.confirmedZeroTasks || []);
        }
    } else {
        const dayData = allHistoryData.find(d => d.id === dateKey);
        if (!dayData) {
            return showToast('해당 날짜의 데이터를 찾을 수 없습니다.', true);
        }
        const missingTasksList = checkMissingQuantities(dayData);
        renderQuantityModalInputs(dayData.taskQuantities || {}, appConfig.quantityTaskTypes, missingTasksList, dayData.confirmedZeroTasks || []);
    }

    const title = document.getElementById('quantity-modal-title');
    if (title) title.textContent = `${dateKey} 처리량 수정`;

    context.quantityModalContext.mode = 'history';
    context.quantityModalContext.dateKey = dateKey;

    context.quantityModalContext.onConfirm = async (newQuantities, confirmedZeroTasks) => {
        if (!dateKey) return;

        const idx = allHistoryData.findIndex(d => d.id === dateKey);
        if (idx > -1) {
            allHistoryData[idx] = {
                ...allHistoryData[idx],
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            };
        }

        const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateKey);
        try {
            await setDoc(historyDocRef, {
                taskQuantities: newQuantities,
                confirmedZeroTasks: confirmedZeroTasks
            }, { merge: true });

            showToast(`${dateKey}의 처리량이 수정되었습니다.`);

            if (dateKey === getTodayDateString()) {
                 const dailyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'daily_data', getTodayDateString());
                 await setDoc(dailyDocRef, { taskQuantities: newQuantities, confirmedZeroTasks: confirmedZeroTasks }, { merge: true });
            }

            if (historyModal && !historyModal.classList.contains('hidden')) {
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
    if (quantityModal) quantityModal.classList.remove('hidden');
};

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
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });

    const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
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
        const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
        if (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) {
            prevDay = allHistoryData[currentIndex + 1];
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
            const diffHtml = getDiffHtmlForMetric('quantity', metrics.quantity, prevMetric);
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
            const diffHtml = getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevMetric);
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
            const diffHtml = getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevMetric);
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
            const diffHtml = getDiffHtmlForMetric('duration', metrics.duration, prevMetric);

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