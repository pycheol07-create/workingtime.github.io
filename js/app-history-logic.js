// === js/app-history-logic.js ===
import {
    appState, appConfig, db, auth,
    allHistoryData,
    context,
    historyModal,
    historyDateList, historyTabs, attendanceHistoryTabs,
    workHistoryPanel, attendanceHistoryPanel, trendAnalysisPanel,
    reportPanel, reportTabs,
    deleteHistoryModal,
    quantityModal,
    render, debouncedSaveState, saveStateToFirestore,
    markDataAsDirty,
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
    getTodayDateString, getCurrentTime, calcElapsedMinutes, showToast, formatTimeTo24H
} from './utils.js';

import {
    doc, setDoc, getDoc, collection, getDocs, deleteDoc, runTransaction,
    query, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


// ✅ [신규] workRecords 컬렉션 참조 헬퍼
const getWorkRecordsCollectionRef = () => {
    const today = getTodayDateString();
    return collection(db, 'artifacts', 'team-work-logger-v2', 'daily_data', today, 'workRecords');
};


// ✅ [중요] Firestore에서 직접 데이터를 읽어와 로컬 이력과 동기화하는 함수
const _syncTodayToHistory = async () => {
    const todayKey = getTodayDateString();
    const now = getCurrentTime();

    // 1. Firestore의 'daily_data/{today}/workRecords' 컬렉션에서 직접 최신 데이터를 가져옵니다.
    let liveWorkRecordsDocs = [];
    try {
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const querySnapshot = await getDocs(workRecordsColRef);
        liveWorkRecordsDocs = querySnapshot.docs.map(doc => doc.data());
    } catch (e) {
        console.error("Error fetching live work records for sync: ", e);
        liveWorkRecordsDocs = appState.workRecords || [];
    }

    // 2. 진행 중인 업무의 시간(duration, endTime)을 현재 기준으로 최신화합니다.
    const liveWorkRecords = (liveWorkRecordsDocs || []).map(record => {
        const snapshot = JSON.parse(JSON.stringify(record));
        if (snapshot.status === 'ongoing' || snapshot.status === 'paused') {
             snapshot.duration = calcElapsedMinutes(snapshot.startTime, now, snapshot.pauses);
             snapshot.endTime = now;
        }
        return snapshot;
    });

    // 3. 메타데이터(수량, 근태 등)는 로컬 상태를 사용합니다.
    const liveTodayData = {
        id: todayKey,
        workRecords: liveWorkRecords,
        taskQuantities: JSON.parse(JSON.stringify(appState.taskQuantities || {})),
        confirmedZeroTasks: JSON.parse(JSON.stringify(appState.confirmedZeroTasks || [])),
        onLeaveMembers: [
            ...(JSON.parse(JSON.stringify(appState.dailyOnLeaveMembers || []))),
            ...(JSON.parse(JSON.stringify(appState.dateBasedOnLeaveMembers || [])))
        ],
        partTimers: JSON.parse(JSON.stringify(appState.partTimers || []))
    };

    // 4. 전역 allHistoryData 배열에 오늘자 데이터를 덮어씌웁니다.
    const idx = allHistoryData.findIndex(d => d.id === todayKey);
    if (idx > -1) {
        allHistoryData[idx] = liveTodayData;
    } else {
        allHistoryData.push(liveTodayData);
        allHistoryData.sort((a, b) => b.id.localeCompare(a.id)); // 날짜 내림차순 정렬 유지
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


// ✅ [수정] 현재 상태를 이력에 저장 (Firestore에서 최신 데이터 읽기 포함)
export async function saveProgress(isAutoSave = false) {
    const dateStr = getTodayDateString();
    const now = getCurrentTime();

    if (!isAutoSave) {
        showToast('현재 상태를 이력에 저장합니다...');
    }

    const historyDocRef = doc(db, 'artifacts', 'team-work-logger-v2', 'history', dateStr);

    try {
        // 1. 저장 직전, Firestore에서 최신 workRecords를 다시 읽어옵니다.
        const workRecordsColRef = getWorkRecordsCollectionRef();
        const querySnapshot = await getDocs(workRecordsColRef);
        const liveWorkRecordsDocs = querySnapshot.docs.map(doc => doc.data());

        const allRecordsSnapshot = (liveWorkRecordsDocs || []).map(record => {
            const snapshot = JSON.parse(JSON.stringify(record));
            if (snapshot.status === 'ongoing' || snapshot.status === 'paused') {
                snapshot.duration = calcElapsedMinutes(snapshot.startTime, now, snapshot.pauses);
                snapshot.endTime = now;
            }
            return snapshot;
        });

        // 2. 저장할 데이터 구성
        const currentQuantities = {};
        for (const task in (appState.taskQuantities || {})) {
            const q = Number(appState.taskQuantities[task]);
            if (!Number.isNaN(q) && q >= 0) {
                currentQuantities[task] = q;
            }
        }
        
        const dataToSave = {
            id: dateStr,
            workRecords: allRecordsSnapshot,
            taskQuantities: currentQuantities,
            confirmedZeroTasks: appState.confirmedZeroTasks || [],
            onLeaveMembers: [
                ...(appState.dailyOnLeaveMembers || []),
                ...(appState.dateBasedOnLeaveMembers || [])
            ],
            partTimers: appState.partTimers || []
        };

        // 3. 데이터가 비어있으면 문서 삭제, 아니면 덮어쓰기
        if (allRecordsSnapshot.length === 0 && Object.keys(currentQuantities).length === 0 && dataToSave.onLeaveMembers.length === 0 && dataToSave.partTimers.length === 0) {
            const docSnap = await getDoc(historyDocRef);
            if(docSnap.exists()) {
                await deleteDoc(historyDocRef);
            }
        } else {
            await runTransaction(db, async (transaction) => {
                transaction.set(historyDocRef, dataToSave); 
            });
        }

        // 4. 로컬 이력 데이터도 동기화
        await _syncTodayToHistory();

        if (isAutoSave) {
            console.log(`Auto-save to history completed at ${now}`);
        } else {
            showToast('현재 상태가 이력에 저장되었습니다.');
        }

    } catch (e) {
        console.error('Error in saveProgress: ', e);
        if (!isAutoSave) {
             showToast(`이력 저장 실패: ${e.message}`, true);
        }
    }
}

export async function saveDayDataToHistory(shouldReset) {
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    
    // 1. 진행 중인 업무 일괄 마감 처리
    if (ongoingRecords.length > 0) {
        try {
            const batch = writeBatch(db);
            const endTime = getCurrentTime();
            const workRecordsColRef = getWorkRecordsCollectionRef();
            
            ongoingRecords.forEach(rec => {
                const docRef = doc(workRecordsColRef, rec.id);
                let pauses = rec.pauses || [];
                if (rec.status === 'paused') {
                    const lastPause = pauses.length > 0 ? pauses[pauses.length - 1] : null;
                    if (lastPause && lastPause.end === null) {
                        lastPause.end = endTime;
                    }
                }
                const duration = calcElapsedMinutes(rec.startTime, endTime, pauses);
                
                batch.update(docRef, {
                    status: 'completed',
                    endTime: endTime,
                    duration: duration,
                    pauses: pauses
                });
            });
            await batch.commit();
        } catch (e) {
             console.error("Error finalizing ongoing tasks: ", e);
             showToast("진행 중인 업무 마감 처리 중 일부 오류 발생.", true);
        }
    }

    // 2. 이력 저장
    await saveProgress(false);

    // 3. 초기화 (업무 마감 시)
    if (shouldReset) {
        try {
            const workRecordsColRef = getWorkRecordsCollectionRef();
            const q = query(workRecordsColRef);
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                const deleteBatch = writeBatch(db);
                querySnapshot.forEach(doc => { deleteBatch.delete(doc.ref); });
                await deleteBatch.commit();
            }

            appState.workRecords = [];
            Object.keys(appState.taskQuantities || {}).forEach(task => { appState.taskQuantities[task] = 0; });
            appState.confirmedZeroTasks = [];
            appState.partTimers = [];
            appState.hiddenGroupIds = [];

            const now = getCurrentTime();
            if (now < "17:30") {
                appState.dailyOnLeaveMembers = (appState.dailyOnLeaveMembers || []).filter(entry => entry.type === '조퇴');
            } else {
                appState.dailyOnLeaveMembers = [];
            }

            await saveStateToFirestore();
            
            showToast('오늘의 업무 기록을 이력에 저장하고 초기화했습니다.');

        } catch (e) {
             console.error("Error during day reset: ", e);
             showToast("초기화 중 오류가 발생했습니다.", true);
        }
    }
}

export async function fetchAllHistoryData() {
    const historyCollectionRef = collection(db, 'artifacts', 'team-work-logger-v2', 'history');
    try {
        const querySnapshot = await getDocs(historyCollectionRef);
        const data = [];
        querySnapshot.forEach((doc) => {
            if (doc.data()) {
                 data.push({ id: doc.id, ...doc.data() });
            }
        });
        data.sort((a, b) => b.id.localeCompare(a.id));

        allHistoryData.length = 0;
        allHistoryData.push(...data);

        return allHistoryData;
    } catch (error) {
        console.error('Error fetching all history data:', error);
        showToast('전체 이력 로딩 실패', true);
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
        clearAllHistoryViews();
        return;
    }

    resetHistoryTabs();

    if (workHistoryPanel) workHistoryPanel.classList.remove('hidden');
    hideOtherPanels('work');

    context.activeMainHistoryTab = 'work';
    context.reportSortState = {};
    context.currentReportParams = null;

    await renderHistoryDateListByMode('day');
};

export const renderHistoryDateListByMode = async (mode = 'day') => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '';

    await _syncTodayToHistory();

    const filteredData = filterHistoryData();
    let keys = getKeysByMode(filteredData, mode);

    if (keys.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">데이터 없음</div></li>';
        clearAllHistoryViews();
        return;
    }

    keys.forEach(key => {
        const li = document.createElement('li');
        let hasWarning = false;
        let titleAttr = '';

        if (mode === 'day') {
            const dayData = filteredData.find(d => d.id === key);
            if (dayData) {
                const missingTasks = checkMissingQuantities(dayData);
                hasWarning = missingTasks.length > 0;
                if (hasWarning) {
                    titleAttr = ` title="처리량 누락: ${missingTasks.join(', ')}"`;
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

// --- 내부 헬퍼 함수들 ---

function clearAllHistoryViews() {
    const viewIds = [
        'history-daily-view', 'history-weekly-view', 'history-monthly-view',
        'history-attendance-daily-view', 'history-attendance-weekly-view', 'history-attendance-monthly-view',
        'report-daily-view', 'report-weekly-view', 'report-monthly-view', 'report-yearly-view'
    ];
    viewIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = '';
    });
}

function resetHistoryTabs() {
    document.querySelectorAll('.history-main-tab-btn[data-main-tab="work"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.remove('font-medium', 'text-gray-500');
    });
    document.querySelectorAll('.history-main-tab-btn:not([data-main-tab="work"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-b-2', 'border-blue-600');
        btn.classList.add('text-gray-500');
    });
    document.querySelectorAll('#history-tabs button[data-view="daily"]').forEach(btn => {
        btn.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.remove('text-gray-500');
    });
    document.querySelectorAll('#history-tabs button:not([data-view="daily"])').forEach(btn => {
        btn.classList.remove('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        btn.classList.add('text-gray-500');
    });
}

function hideOtherPanels(activePanel) {
    if (activePanel !== 'work') workHistoryPanel?.classList.add('hidden');
    if (activePanel !== 'attendance') attendanceHistoryPanel?.classList.add('hidden');
    if (activePanel !== 'trends') trendAnalysisPanel?.classList.add('hidden');
    if (activePanel !== 'report') reportPanel?.classList.add('hidden');
}

function filterHistoryData() {
    if (!context.historyStartDate && !context.historyEndDate) {
        return allHistoryData;
    }
    return allHistoryData.filter(d => {
        const date = d.id;
        const start = context.historyStartDate;
        const end = context.historyEndDate;
        if (start && end) return date >= start && date <= end;
        if (start) return date >= start;
        if (end) return date <= end;
        return true;
    });
}

function getKeysByMode(data, mode) {
    if (mode === 'day') {
        return data.map(d => d.id);
    }
    const set = new Set();
    data.forEach(d => {
        const dateObj = new Date(d.id + "T00:00:00");
        if (mode === 'week') set.add(getWeekOfYear(dateObj));
        else if (mode === 'month') set.add(d.id.substring(0, 7));
        else if (mode === 'year') set.add(d.id.substring(0, 4));
    });
    return Array.from(set).sort((a, b) => b.localeCompare(a));
}

// ✅ [완전한 구현] 이력 처리량 수정 모달 열기
export const openHistoryQuantityModal = (dateKey) => {
    const todayDateString = getTodayDateString();

    if (dateKey === todayDateString) {
        const todayData = {
            id: todayDateString,
            workRecords: appState.workRecords || [],
            taskQuantities: appState.taskQuantities || {},
            confirmedZeroTasks: appState.confirmedZeroTasks || []
        };
        const missingTasksList = checkMissingQuantities(todayData);
        renderQuantityModalInputs(appState.taskQuantities || {}, appConfig.quantityTaskTypes, missingTasksList, appState.confirmedZeroTasks || []);
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
                appState.taskQuantities = newQuantities;
                appState.confirmedZeroTasks = confirmedZeroTasks;
                await saveStateToFirestore();
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

// ✅ [완전한 구현] 이력 상세 렌더링
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

    // 내부 헬퍼 (metrics diff)
    const getDiffHtml = (metric, current, previousMetric) => {
        const currValue = current || 0;
        let prevValue = 0;
        let prevDate = previousMetric?.date || '이전';

        if (!previousMetric) {
            if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
            return '';
        }

        if (metric === 'quantity') prevValue = previousMetric.quantity || 0;
        else if (metric === 'avgThroughput') prevValue = previousMetric.avgThroughput || 0;
        else if (metric === 'avgCostPerItem') prevValue = previousMetric.avgCostPerItem || 0;
        else if (metric === 'duration') prevValue = previousMetric.duration || 0;

        if (prevValue === 0) {
            if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
            return '';
        }

        const diff = currValue - prevValue;
        if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;

        const percent = (diff / prevValue) * 100;
        const sign = diff > 0 ? '↑' : '↓';

        let colorClass = 'text-gray-500';
        if (metric === 'avgThroughput' || metric === 'quantity') {
            colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
        } else if (metric === 'avgCostPerItem' || metric === 'duration') {
            colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
        }

        let diffStr = '';
        let prevStr = '';
        if (metric === 'duration') {
            diffStr = formatDuration(Math.abs(diff));
            prevStr = formatDuration(prevValue);
        } else if (metric === 'avgCostPerItem' || metric === 'quantity') {
            diffStr = Math.abs(diff).toFixed(0);
            prevStr = prevValue.toFixed(0);
        } else {
            diffStr = Math.abs(diff).toFixed(2);
            prevStr = prevValue.toFixed(2);
        }

        return `<span class="text-xs ${colorClass} ml-1 font-mono" title="${prevDate}: ${prevStr}">
                  ${sign} ${diffStr} (${percent.toFixed(0)}%)
              </span>`;
    };


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
            const diffHtml = getDiffHtml('quantity', metrics.quantity, prevMetric);
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
            const diffHtml = getDiffHtml('avgThroughput', metrics.avgThroughput, prevMetric);
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
            const diffHtml = getDiffHtml('avgCostPerItem', metrics.avgCostPerItem, prevMetric);
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
            const diffHtml = getDiffHtml('duration', metrics.duration, prevMetric);

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
    context.historyKeyToDelete = dateKey;
    if (deleteHistoryModal) deleteHistoryModal.classList.remove('hidden');
};

// ✅ [수정] async 적용
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
    if (reportTabs) {
        reportTabs.querySelectorAll('button').forEach(btn => {
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
            tabToActivate = historyTabs?.querySelector('button[data-view="daily"]');
            break;
        case 'weekly':
            listMode = 'week';
            viewToShow = document.getElementById('history-weekly-view');
            tabToActivate = historyTabs?.querySelector('button[data-view="weekly"]');
            break;
        case 'monthly':
            listMode = 'month';
            viewToShow = document.getElementById('history-monthly-view');
            tabToActivate = historyTabs?.querySelector('button[data-view="monthly"]');
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
            break;
        case 'attendance-monthly':
            listMode = 'month';
            viewToShow = document.getElementById('history-attendance-monthly-view');
            tabToActivate = attendanceHistoryTabs?.querySelector('button[data-view="attendance-monthly"]');
            break;
        case 'report-daily':
            listMode = 'day';
            viewToShow = document.getElementById('report-daily-view');
            tabToActivate = reportTabs?.querySelector('button[data-view="report-daily"]');
            break;
        case 'report-weekly':
            listMode = 'week';
            viewToShow = document.getElementById('report-weekly-view');
            tabToActivate = reportTabs?.querySelector('button[data-view="report-weekly"]');
            break;
        case 'report-monthly':
            listMode = 'month';
            viewToShow = document.getElementById('report-monthly-view');
            tabToActivate = reportTabs?.querySelector('button[data-view="report-monthly"]');
            break;
        case 'report-yearly':
            listMode = 'year';
            viewToShow = document.getElementById('report-yearly-view');
            tabToActivate = reportTabs?.querySelector('button[data-view="report-yearly"]');
            break;
    }

    await renderHistoryDateListByMode(listMode);

    if (viewToShow) viewToShow.classList.remove('hidden');
    if (tabToActivate) {
        tabToActivate.classList.add('font-semibold', 'text-blue-600', 'border-blue-600', 'border-b-2');
        tabToActivate.classList.remove('text-gray-500');
    }
};