import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, teamGroups, taskGroups, taskTypes, quantityTaskTypes, defaultMemberWages } from './config.js';
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday } from './utils.js';
import {
    renderRealtimeStatus,
    renderCompletedWorkLog,
    updateSummary,
    renderTaskAnalysis,
    renderTaskSelectionModal,
    renderTeamSelectionModalContent,
    renderQuantityModalInputs
} from './ui.js';

// --- DOM Elements ---
const connectionStatusEl = document.getElementById('connection-status');
const statusDotEl = document.getElementById('status-dot');
const teamStatusBoard = document.getElementById('team-status-board');
const workLogBody = document.getElementById('work-log-body');

// --- Modal Elements ---
const teamSelectModal = document.getElementById('team-select-modal');
const deleteConfirmModal = document.getElementById('delete-confirm-modal');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const historyModal = document.getElementById('history-modal');
const openHistoryBtn = document.getElementById('open-history-btn');
const closeHistoryBtn = document.getElementById('close-history-btn');
const historyDateList = document.getElementById('history-date-list');
const historyViewContainer = document.getElementById('history-view-container');
const historyTabs = document.getElementById('history-tabs');
const quantityModal = document.getElementById('quantity-modal');
const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
const deleteHistoryModal = document.getElementById('delete-history-modal');
const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn');
const cancelHistoryDeleteBtn = document.getElementById('cancel-history-delete-btn');
const deleteAllCompletedBtn = document.getElementById('delete-all-completed-btn');
const editRecordModal = document.getElementById('edit-record-modal');
const confirmEditBtn = document.getElementById('confirm-edit-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');
const saveProgressBtn = document.getElementById('save-progress-btn');
const quantityOnStopModal = document.getElementById('quantity-on-stop-modal');
const confirmQuantityOnStopBtn = document.getElementById('confirm-quantity-on-stop');
const cancelQuantityOnStopBtn = document.getElementById('cancel-quantity-on-stop');
const endShiftBtn = document.getElementById('end-shift-btn');
const resetAppBtn = document.getElementById('reset-app-btn');
const resetAppModal = document.getElementById('reset-app-modal');
const confirmResetAppBtn = document.getElementById('confirm-reset-app-btn');
const cancelResetAppBtn = document.getElementById('cancel-reset-app-btn');
const taskSelectModal = document.getElementById('task-select-modal');
const stopIndividualConfirmModal = document.getElementById('stop-individual-confirm-modal');
const confirmStopIndividualBtn = document.getElementById('confirm-stop-individual-btn');
const cancelStopIndividualBtn = document.getElementById('cancel-stop-individual-btn');
const stopIndividualConfirmMessage = document.getElementById('stop-individual-confirm-message');
const editPartTimerModal = document.getElementById('edit-part-timer-modal');
const confirmEditPartTimerBtn = document.getElementById('confirm-edit-part-timer-btn');
const cancelEditPartTimerBtn = document.getElementById('cancel-edit-part-timer-btn');
const partTimerNewNameInput = document.getElementById('part-timer-new-name');
const partTimerEditIdInput = document.getElementById('part-timer-edit-id');
// 수동 추가 모달 요소 없음

// --- Toggles ---
const toggleCompletedLog = document.getElementById('toggle-completed-log');
const toggleAnalysis = document.getElementById('toggle-analysis');
const toggleSummary = document.getElementById('toggle-summary');


// --- Firebase State ---
let db, auth;
let unsubscribeToday;
const APP_ID = "team-work-logger-v2";

// --- App State ---
let appState = {
    workRecords: [],
    taskQuantities: {},
    onLeaveMembers: [],
    partTimers: [],
    hiddenGroupIds: []
};
let appConfig = { memberWages: defaultMemberWages };
let selectedTaskForStart = null;
let selectedGroupForAdd = null;
let recordToDeleteId = null;
let recordToStopId = null;
let historyKeyToDelete = null;
let allHistoryData = [];
let recordToEditId = null;
let deleteMode = 'single';
let elapsedTimeTimer = null;
let groupToStopId = null;
let quantityModalContext = { mode: 'today', dateKey: null, onConfirm: null, onCancel: null };
let tempSelectedMembers = [];

// ======[ 타이머 함수 ]======
const updateElapsedTimes = () => {
    let totalOngoingMinutes = 0;
    const now = new Date();
    const nowTimeForCalc = new Date(`1970-01-01T${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`);

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');

    ongoingRecords.forEach(record => {
        try {
            const startTime = new Date(`1970-01-01T${record.startTime}`);
            let totalPauseMinutes = 0;
            (record.pauses || []).forEach(p => {
                if(p.start && p.end){
                    const pauseStart = new Date(`1970-01-01T${p.start}`);
                    const pauseEnd = new Date(`1970-01-01T${p.end}`);
                    if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                        totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                    }
                }
            });
            if (!isNaN(startTime) && !isNaN(nowTimeForCalc) && nowTimeForCalc >= startTime) {
                const elapsedMilliseconds = (nowTimeForCalc - startTime) - (totalPauseMinutes * 60 * 1000);
                const elapsedMinutes = Math.max(0, elapsedMilliseconds / (1000 * 60));
                totalOngoingMinutes += elapsedMinutes;
            }
        } catch (e) {
            // console.error("Error calculating ongoing time for record:", record, e); // 로그 줄임
        }
    });

    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const status = el.dataset.status;
            if (status === 'paused') { return; }

            const startTimeStr = el.dataset.startTime;
            if (!startTimeStr) return;
            const startTime = new Date(`1970-01-01T${startTimeStr}`);

            if (isNaN(startTime)) return;

            const recordId = el.dataset.recordId;
            const record = (appState.workRecords || []).find(r => String(r.id) === recordId);

            let totalPauseMinutes = 0;
            if(record && record.pauses){
                (record.pauses || []).forEach(p => {
                    if(p.start && p.end){
                        const pauseStart = new Date(`1970-01-01T${p.start}`);
                        const pauseEnd = new Date(`1970-01-01T${p.end}`);
                        if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                            totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                        }
                    }
                });
            }

            if (!isNaN(nowTimeForCalc) && nowTimeForCalc >= startTime) {
                const elapsedMilliseconds = (nowTimeForCalc - startTime) - (totalPauseMinutes * 60 * 1000);
                const elapsedMinutes = Math.max(0, elapsedMilliseconds / (1000 * 60));
                el.textContent = `(진행: ${formatDuration(elapsedMinutes)})`;
            } else {
                 el.textContent = `(진행: 0 분)`;
            }
        } catch(e) {
             // console.error("Error updating duration element:", el, e); // 로그 줄임
             el.textContent = `(오류)`;
        }
    });

    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalCompletedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0);

    const liveTotalWorkTime = totalCompletedMinutes + totalOngoingMinutes;
    const summaryTimeEl = document.getElementById('summary-total-work-time');
    if (summaryTimeEl) {
        summaryTimeEl.textContent = formatDuration(liveTotalWorkTime);
    }
};
// =============================

const render = () => {
    try {
        renderRealtimeStatus(appState);
        renderCompletedWorkLog(appState);
        updateSummary(appState);
        renderTaskAnalysis(appState);
    } catch (e) {
        console.error("Render error:", e);
        showToast("화면 렌더링 오류 발생.", true);
    }
};

// --- Main Logic & Firebase Integration ---
const startWorkGroup = (members, task) => {
     const groupId = Date.now();
    const startTime = getCurrentTime();
    const newRecords = members.map(member => ({
        id: groupId + Math.random(),
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId,
        pauses: []
    }));
    if (!appState.workRecords) appState.workRecords = [];
    appState.workRecords.push(...newRecords);
    saveStateToFirestore();
};

const addMembersToWorkGroup = (members, task, groupId) => {
     const startTime = getCurrentTime();
    const newRecords = members.map(member => ({
        id: Date.now() + Math.random(),
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId,
        pauses: []
    }));
    if (!appState.workRecords) appState.workRecords = [];
    appState.workRecords.push(...newRecords);
    saveStateToFirestore();
};

const stopWorkGroup = (groupId) => {
     const recordsToStop = (appState.workRecords || []).filter(r => r.groupId === groupId && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return;
    finalizeStopGroup(groupId, null);
};

const finalizeStopGroup = (groupId, quantity) => {
     const endTime = getCurrentTime();
    let taskName = '';
    let stoppedCount = 0;

    (appState.workRecords || []).forEach(record => {
        if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
            taskName = record.task;

            if (record.status === 'paused') {
                const lastPause = record.pauses?.[record.pauses.length - 1];
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }

            record.status = 'completed';
            record.endTime = endTime;
            const start = new Date(`1970-01-01T${record.startTime}`);
            const end = new Date(`1970-01-01T${endTime}`);

            let totalPauseMinutes = 0;
            (record.pauses || []).forEach(p => {
                if (p.start && p.end) {
                    const pauseStart = new Date(`1970-01-01T${p.start}`);
                    const pauseEnd = new Date(`1970-01-01T${p.end}`);
                    if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                         totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                    }
                }
            });

            if (!isNaN(start) && !isNaN(end) && end >= start) {
                const totalDuration = (end - start) / (1000 * 60);
                record.duration = Math.max(0, totalDuration - totalPauseMinutes);
            } else {
                record.duration = 0;
            }
            stoppedCount++;
        }
    });

    if (quantity !== null && taskName) {
        if (!appState.taskQuantities) appState.taskQuantities = {};
        appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + quantity;
    }

    if (stoppedCount > 0) {
        saveStateToFirestore();
    }
    quantityOnStopModal.classList.add('hidden');
    groupToStopId = null;
};

const stopWorkIndividual = (recordId) => {
     const endTime = getCurrentTime();
    const record = (appState.workRecords || []).find(r => r.id === recordId);
    if (record && (record.status === 'ongoing' || record.status === 'paused')) {

        if (record.status === 'paused') {
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) {
                lastPause.end = endTime;
            }
        }

        record.status = 'completed';
        record.endTime = endTime;
        const start = new Date(`1970-01-01T${record.startTime}`);
        const end = new Date(`1970-01-01T${endTime}`);

        let totalPauseMinutes = 0;
        (record.pauses || []).forEach(p => {
            if (p.start && p.end) {
                const pauseStart = new Date(`1970-01-01T${p.start}`);
                const pauseEnd = new Date(`1970-01-01T${p.end}`);
                 if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                    totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                 }
            }
        });

        if (!isNaN(start) && !isNaN(end) && end >= start) {
            const totalDuration = (end - start) / (1000 * 60);
            record.duration = Math.max(0, totalDuration - totalPauseMinutes);
        } else {
             record.duration = 0;
        }

        saveStateToFirestore();
        showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
    } else {
        showToast("이미 완료되었거나 찾을 수 없는 기록입니다.", true);
    }
};

const pauseWorkGroup = (groupId) => {
     const currentTime = getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (record.groupId === groupId && record.status === 'ongoing') {
            record.status = 'paused';
            if (!record.pauses) record.pauses = [];
            record.pauses.push({ start: currentTime, end: null });
            changed = true;
        }
    });
    if (changed) {
        saveStateToFirestore();
        showToast('업무가 일시정지 되었습니다.');
    }
};

const resumeWorkGroup = (groupId) => {
     const currentTime = getCurrentTime();
    let changed = false;
    (appState.workRecords || []).forEach(record => {
        if (record.groupId === groupId && record.status === 'paused') {
            record.status = 'ongoing';
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }
            changed = true;
        }
    });
    if (changed) {
        saveStateToFirestore();
        showToast('업무를 다시 시작합니다.');
    }
};

// --- Firebase Functions ---
async function saveStateToFirestore() {
     if (!auth || !auth.currentUser) {
        console.warn("Cannot save state: User not authenticated.");
        return;
    }
    try {
        const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
        const stateToSave = JSON.stringify(appState);
        await setDoc(docRef, { state: stateToSave });
        console.log("State saved to Firestore.");
    } catch (error) {
        console.error("Error saving state to Firestore:", error);
        showToast("데이터 동기화 중 오류 발생.", true);
    }
}

// ======[ saveProgress 함수 수정: 상태 초기화 로직 변경 ]======
async function saveProgress() {
    const dateStr = getTodayDateString();
    showToast(`현재까지 완료된 기록을 저장합니다...`);

    const historyDocRef = doc(db, "artifacts", APP_ID, "history", dateStr);

    try {
        const docSnap = await getDoc(historyDocRef);
        const existingData = docSnap.exists() ? docSnap.data() : { workRecords: [], taskQuantities: {}, onLeaveMembers: [] };

        const completedRecordsFromState = (appState.workRecords || []).filter(r => r.status === 'completed');

        const currentQuantities = {};
        for (const task in (appState.taskQuantities || {})) {
            const quantity = parseInt(appState.taskQuantities[task], 10);
            if (!isNaN(quantity) && quantity > 0) {
                currentQuantities[task] = quantity;
            }
        }

        if (completedRecordsFromState.length === 0 && Object.keys(currentQuantities).length === 0) {
            return showToast('저장할 새로운 완료 기록이나 처리량이 없습니다.', true);
        }

        const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
        const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

        const finalQuantities = { ...(existingData.taskQuantities || {}) };
        for (const task in currentQuantities) {
             finalQuantities[task] = (finalQuantities[task] || 0) + currentQuantities[task];
        }

        const dataToSave = {
            workRecords: uniqueRecords,
            taskQuantities: finalQuantities,
            onLeaveMembers: appState.onLeaveMembers || [] // 현재 휴무 상태 저장
        };

        await setDoc(historyDocRef, dataToSave);

        // 중간 저장 후 현재 상태에서 완료된 기록과 처리량만 초기화
        appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
        // taskQuantities 객체는 유지하되 값만 0으로 초기화
        Object.keys(appState.taskQuantities || {}).forEach(task => {
            appState.taskQuantities[task] = 0;
        });
        // partTimers 와 onLeaveMembers는 초기화하지 않음

        await saveStateToFirestore(); // 초기화된 현재 상태 저장

        showToast(`현재까지의 기록이 성공적으로 저장되었습니다.`);
        render(); // 초기화된 상태로 화면 업데이트

    } catch (e) {
        console.error("Error in saveProgress: ", e);
        showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
    }
}
// =============================================================

async function saveDayDataToHistory(shouldReset) {
     const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    if (ongoingRecords.length > 0) {
        const endTime = getCurrentTime();
        ongoingRecords.forEach(rec => {
            if (rec.status === 'paused') {
                const lastPause = rec.pauses?.[rec.pauses.length - 1];
                if (lastPause && lastPause.end === null) {
                    lastPause.end = endTime;
                }
            }
            rec.status = 'completed';
            rec.endTime = endTime;
            const start = new Date(`1970-01-01T${rec.startTime}`);
            const end = new Date(`1970-01-01T${endTime}`);
            let totalPauseMinutes = 0;
            (rec.pauses || []).forEach(p => {
                if (p.start && p.end) {
                    const pauseStart = new Date(`1970-01-01T${p.start}`);
                    const pauseEnd = new Date(`1970-01-01T${p.end}`);
                    if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                        totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                    }
                }
            });
             if (!isNaN(start) && !isNaN(end) && end >= start) {
                const totalDuration = (end - start) / (1000 * 60);
                rec.duration = Math.max(0, totalDuration - totalPauseMinutes);
            } else {
                 rec.duration = 0;
            }
        });
        await saveStateToFirestore(); // 강제 완료 상태 저장
    }

    // saveProgress 호출 시 완료 기록 저장 및 현재 상태 초기화 (workRecords, taskQuantities)
    await saveProgress();

    if(shouldReset){
        // 추가 초기화: hiddenGroupIds, onLeaveMembers (partTimers는 유지)
        appState.hiddenGroupIds = [];
        appState.onLeaveMembers = [];
        // 이미 saveProgress에서 workRecords와 taskQuantities가 초기화됨

        await saveStateToFirestore(); // 최종 초기화 상태 저장
        showToast(`오늘의 업무 기록을 초기화했습니다.`);
        render(); // 초기화된 UI 표시
    }
}


// ======[ 이력 보기 관련 함수 추가 시작 ]======

async function fetchAllHistoryData() {
    const historyCollectionRef = collection(db, "artifacts", APP_ID, "history");
    try {
        const querySnapshot = await getDocs(historyCollectionRef);
        allHistoryData = [];
        querySnapshot.forEach((doc) => {
            // 데이터 형식 검증 추가 (선택적)
            const data = doc.data();
            if (data && data.workRecords) { // 최소한 workRecords가 있는지 확인
                 allHistoryData.push({ id: doc.id, ...data });
            } else {
                 console.warn("Skipping invalid history data:", doc.id);
            }
        });
        console.log("Fetched all history data:", allHistoryData.length, "items");
        return allHistoryData;
    } catch (error) {
        console.error("Error fetching all history data:", error);
        showToast("전체 이력 로딩 실패", true);
        return [];
    }
}

const loadAndRenderHistoryList = async () => {
    if (!historyDateList) return;
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';
    allHistoryData = [];

    const historyData = await fetchAllHistoryData();

    if (historyData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
        document.getElementById('history-daily-view').innerHTML = '';
        document.getElementById('history-weekly-view').innerHTML = '';
        document.getElementById('history-monthly-view').innerHTML = '';
        return;
    }

    const dates = historyData.map(d => d.id).sort((a, b) => b.localeCompare(a));

    historyDateList.innerHTML = '';
    dates.forEach(dateKey => {
        const li = document.createElement('li');
        li.innerHTML = `<button data-key="${dateKey}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${dateKey}</button>`;
        historyDateList.appendChild(li);
    });

    if (historyDateList.firstChild) {
        const firstButton = historyDateList.firstChild.querySelector('button');
        if (firstButton) {
            firstButton.classList.add('bg-blue-100', 'font-bold');
            switchHistoryView('daily');
            renderHistoryDetail(firstButton.dataset.key);
        }
    } else {
         switchHistoryView('daily');
         document.getElementById('history-daily-view').innerHTML = '<div class="text-center text-gray-500 p-8">표시할 이력이 없습니다.</div>';
    }
};

window.openHistoryQuantityModal = (dateKey) => {
     const data = allHistoryData.find(d => d.id === dateKey);
     if (!data) {
         showToast("해당 날짜의 데이터를 찾을 수 없습니다.", true);
         return;
     }

     renderQuantityModalInputs(data.taskQuantities || {});

     document.getElementById('quantity-modal-title').textContent = `${dateKey} 처리량 수정`;

     quantityModalContext = {
         mode: 'history',
         dateKey: dateKey,
         onConfirm: async (newQuantities) => {
             const dataToUpdateIndex = allHistoryData.findIndex(d => d.id === dateKey);
             if (dataToUpdateIndex === -1) return;

             // 캐시 업데이트
             allHistoryData[dataToUpdateIndex].taskQuantities = newQuantities;

             // Firestore 업데이트
             const historyDocRef = doc(db, "artifacts", APP_ID, "history", dateKey);
             try {
                 await setDoc(historyDocRef, allHistoryData[dataToUpdateIndex]);
                 showToast(`${dateKey}의 처리량이 수정되었습니다.`);
                 renderHistoryDetail(dateKey); // 현재 뷰 다시 렌더링
             } catch (error) {
                  console.error("Error updating history quantities:", error);
                  showToast("처리량 업데이트 중 오류 발생.", true);
             }
         },
         onCancel: () => {}
     };

     document.getElementById('confirm-quantity-btn').textContent = "수정 저장";
     document.getElementById('cancel-quantity-btn').textContent = "취소";
     quantityModal.classList.remove('hidden');
};

const renderHistoryDetail = (dateKey) => {
    const view = document.getElementById('history-daily-view');
    if (!view) return;
    view.innerHTML = `<div class="text-center text-gray-500">데이터 로딩 중...</div>`;

    const data = allHistoryData.find(d => d.id === dateKey);

    if (!data) {
        view.innerHTML = `<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>`;
        return;
    }

    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};
    const onLeaveMembers = data.onLeaveMembers || [];

    const allRegularMembers = new Set(teamGroups.flatMap(g => g.members));
    // 이력 데이터에 저장된 알바 정보 사용 시도, 없으면 현재 상태 사용 (근사치)
    const partTimersFromHistory = data.partTimers; // history에 partTimers 저장 필요
    const allPartTimersCount = partTimersFromHistory ? partTimersFromHistory.length : (appState.partTimers || []).length;
    const activeMembersCount = allRegularMembers.size - onLeaveMembers.length + allPartTimersCount;

    const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);

    const taskGroupsDurations = {};
    records.forEach(record => {
        if (!record.groupId) return; // groupId 없으면 계산 불가
        if (!taskGroupsDurations[record.groupId]) {
            taskGroupsDurations[record.groupId] = { start: record.startTime || '23:59:59', end: record.endTime || '00:00:00' };
        } else {
            if (record.startTime && record.startTime < taskGroupsDurations[record.groupId].start) {
                taskGroupsDurations[record.groupId].start = record.startTime;
            }
            if (record.endTime && record.endTime > taskGroupsDurations[record.groupId].end) {
                 taskGroupsDurations[record.groupId].end = record.endTime;
            }
        }
    });
    let totalOverallDuration = 0;
    Object.values(taskGroupsDurations).forEach(groupTime => {
         const start = new Date(`1970-01-01T${groupTime.start}`);
         const end = new Date(`1970-01-01T${groupTime.end}`);
         if (!isNaN(start) && !isNaN(end) && end >= start) {
              totalOverallDuration += (end - start) / (1000 * 60);
         }
    });


    const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (parseInt(q, 10) || 0), 0);
    const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';
    const taskDurations = records.reduce((acc, rec) => {
        acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0);
        return acc;
    }, {});

    let nonWorkHtml = '';
    if (isWeekday(dateKey)) {
        const totalPotentialMinutes = activeMembersCount * 8 * 60;
        const nonWorkMinutes = totalPotentialMinutes - totalSumDuration;
        const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
        nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center">
            <h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4>
            <p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes > 0 ? nonWorkMinutes : 0)}</p>
            <p class="text-xs text-gray-500 mt-1">(추정치)</p>
        </div>`;
    } else {
        nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex flex-col justify-center items-center">
            <h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4>
            <p class="text-lg font-bold text-gray-400">주말</p>
        </div>`;
    }

    let html = `
        <div class="mb-6 pb-4 border-b flex justify-between items-center">
            <h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3>
            <div>
                <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm" onclick="openHistoryQuantityModal('${dateKey}')">처리량 수정</button>
                <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="downloadHistoryAsExcel('${dateKey}')">엑셀</button>
                <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="requestHistoryDeletion('${dateKey}')">삭제</button>
            </div>
        </div>

        <div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">
            <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">근무 인원</h4><p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p></div>
            <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
            ${nonWorkHtml}
            <div class="bg-white p-4 rounded-lg shadow-sm text-center col-span-2"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
            <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div class="bg-white p-4 rounded-lg shadow-sm">
                <h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4>
                <div class="space-y-2 max-h-48 overflow-y-auto">
    `;
    let hasQuantities = false;
    Object.entries(quantities)
        .filter(([, qty]) => parseInt(qty, 10) > 0)
        .sort(([taskA], [taskB]) => taskA.localeCompare(taskB))
        .forEach(([task, qty]) => {
            hasQuantities = true;
            html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${qty} 개</span></div>`;
    });
    if (!hasQuantities) {
        html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    }
    html += `</div></div>`;

    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasThroughput = false;
     Object.entries(quantities)
        .filter(([, qty]) => parseInt(qty, 10) > 0)
        .sort(([taskA], [taskB]) => taskA.localeCompare(taskB))
        .forEach(([task, qty]) => {
            hasThroughput = true;
            const durationForTask = taskDurations[task] || 0;
            const throughputForTask = durationForTask > 0 ? ((parseInt(qty, 10) || 0) / durationForTask).toFixed(2) : '0.00';
            html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${throughputForTask} 개/분</span></div>`;
    });
    if (!hasThroughput) {
        html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    }
    html += `</div></div>`;
    html += `</div>`;

    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 시간 비중</h4><div class="space-y-3">`;
    Object.entries(taskDurations)
        .filter(([, duration]) => duration > 0)
        .sort(([,a],[,b]) => b - a)
        .forEach(([task, duration]) => {
            const percentage = totalSumDuration > 0 ? (duration / totalSumDuration * 100).toFixed(1) : 0;
            html += `
                <div>
                    <div class="flex justify-between items-center mb-1 text-sm">
                        <span class="font-semibold text-gray-600">${task}</span>
                        <span>${formatDuration(duration)} (${percentage}%)</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
                </div>
            `;
    });
    if (Object.keys(taskDurations).filter(k => taskDurations[k] > 0).length === 0) {
         html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
    }
    html += `</div></div>`;

    view.innerHTML = html;
};

 const renderWeeklyHistory = () => {
     const view = document.getElementById('history-weekly-view');
     if (!view) return;
     view.innerHTML = `<div class="text-center text-gray-500">주별 데이터 집계 중...</div>`;

     const weeklyData = allHistoryData.reduce((acc, day) => {
         if (!day.id || !day.workRecords) return acc;
         try {
             const weekKey = getWeekOfYear(new Date(day.id));
             if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };
             acc[weekKey].workRecords.push(...(day.workRecords || []));
             Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                 acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (parseInt(qty, 10) || 0);
             });
         } catch (e) {
              console.error("Error processing day for weekly summary:", day.id, e);
         }
         return acc;
     }, {});

     const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
     if(sortedWeeks.length === 0) {
         view.innerHTML = `<div class="text-center text-gray-500">주별 데이터가 없습니다.</div>`;
         return;
     }

     view.innerHTML = sortedWeeks.map(weekKey => renderSummaryView('weekly', weeklyData[weekKey], weekKey)).join('<div class="my-4 border-t"></div>'); // 구분선 추가
 };

 const renderMonthlyHistory = () => {
      const view = document.getElementById('history-monthly-view');
      if (!view) return;
     view.innerHTML = `<div class="text-center text-gray-500">월별 데이터 집계 중...</div>`;

     const monthlyData = allHistoryData.reduce((acc, day) => {
         if (!day.id || !day.workRecords) return acc;
         try {
             const monthKey = day.id.substring(0, 7);
             if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
             acc[monthKey].workRecords.push(...(day.workRecords || []));
              Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                 acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (parseInt(qty, 10) || 0);
             });
         } catch (e) {
             console.error("Error processing day for monthly summary:", day.id, e);
         }
         return acc;
     }, {});

     const sortedMonths = Object.keys(monthlyData).sort((a, b) => b.localeCompare(a));
     if(sortedMonths.length === 0) {
         view.innerHTML = `<div class="text-center text-gray-500">월별 데이터가 없습니다.</div>`;
         return;
     }

     view.innerHTML = sortedMonths.map(monthKey => renderSummaryView('monthly', monthlyData[monthKey], monthKey)).join('<div class="my-4 border-t"></div>'); // 구분선 추가
 };

 window.requestHistoryDeletion = (dateKey) => {
     historyKeyToDelete = dateKey;
     deleteHistoryModal.classList.remove('hidden');
 };

 window.downloadHistoryAsExcel = async (dateKey) => {
     try {
         const data = allHistoryData.find(d => d.id === dateKey);
         if (!data || !data.workRecords || data.workRecords.length === 0) {
             return showToast('다운로드할 데이터가 없습니다.', true);
         }
         const records = data.workRecords;

         // --- Helper for appending total row --- (간단 버전)
         const appendTotalRow = (ws, data, headers) => {
             if (!data || data.length === 0) return;
             const total = {};
             headers.forEach((header, index) => {
                 if (index === 0) {
                     total[header] = '총 합계';
                 } else if (header.includes('(분)') || header.includes('(원)')) { // 숫자 컬럼만 합산
                     const sum = data.reduce((acc, row) => acc + (Number(row[header]) || 0), 0);
                     total[header] = Math.round(sum); // 반올림
                 } else {
                      total[header] = ''; // 텍스트 컬럼은 비움
                 }
             });
             XLSX.utils.sheet_add_json(ws, [total], { skipHeader: true, origin: -1 });
         };

         // --- Sheet 1: 상세 기록 ---
         const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)'];
         const sheet1Data = records.map(r => ({
             '팀원': r.member,
             '업무 종류': r.task,
             '시작 시간': formatTimeTo24H(r.startTime),
             '종료 시간': formatTimeTo24H(r.endTime),
             '소요 시간(분)': Math.round(r.duration || 0)
         }));
         const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
         appendTotalRow(worksheet1, sheet1Data, sheet1Headers);


         // --- Sheet 2: 업무별 요약 ---
         const sheet2Headers = ['업무 종류', '총 소요 시간(분)', '총 인건비(원)'];
         const summaryByTask = {};
         records.forEach(r => {
             if (!summaryByTask[r.task]) {
                 summaryByTask[r.task] = { totalDuration: 0, totalCost: 0 };
             }
             const wage = appConfig.memberWages[r.member] || 0; // 설정된 임금 사용
             const cost = ((r.duration || 0) / 60) * wage;
             summaryByTask[r.task].totalDuration += (r.duration || 0);
             summaryByTask[r.task].totalCost += cost;
         });
         const sheet2Data = Object.keys(summaryByTask).sort().map(task => ({
             '업무 종류': task,
             '총 소요 시간(분)': Math.round(summaryByTask[task].totalDuration),
             '총 인건비(원)': Math.round(summaryByTask[task].totalCost)
         }));
         const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
         appendTotalRow(worksheet2, sheet2Data, sheet2Headers);

         // --- Sheet 3: 파트별 인건비 ---
         const sheet3Headers = ['파트', '총 인건비(원)'];
         const memberToPartMap = new Map();
         teamGroups.forEach(group => {
             group.members.forEach(member => memberToPartMap.set(member, group.name));
         });
         const summaryByPart = {};
         records.forEach(r => {
             // 알바 등 파트 정보 없는 경우 '기타'로 처리
             const part = memberToPartMap.get(r.member) || '기타';
             if (!summaryByPart[part]) summaryByPart[part] = { totalCost: 0 };
             const wage = appConfig.memberWages[r.member] || 0;
             const cost = ((r.duration || 0) / 60) * wage;
             summaryByPart[part].totalCost += cost;
         });
         const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({
             '파트': part,
             '총 인건비(원)': Math.round(summaryByPart[part].totalCost)
         }));
          const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
          appendTotalRow(worksheet3, sheet3Data, sheet3Headers);

         // --- Auto-fit column widths ---
         const fitToColumn = (ws) => {
             const objectMaxLength = [];
             const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
             if (!data || data.length === 0) return; // 데이터 없으면 종료

             // 헤더 길이 계산
             if (data[0]) {
                  Object.keys(data[0]).forEach((key, index) => {
                      objectMaxLength[index] = String(data[0][key]).length;
                  });
             }
             // 데이터 길이 계산
             data.slice(1).forEach(row => {
                  Object.keys(row).forEach((key, index) => {
                      const cellLength = String(row[key] || '').length; // null/undefined 방지
                      objectMaxLength[index] = Math.max(objectMaxLength[index] || 10, cellLength); // 최소 너비 10
                  });
             });
             ws["!cols"] = objectMaxLength.map(w => ({ width: w + 2 })); // 약간의 여백 추가
         };

         fitToColumn(worksheet1);
         fitToColumn(worksheet2);
         fitToColumn(worksheet3);


         // --- Create Workbook and Download ---
         const workbook = XLSX.utils.book_new();
         XLSX.utils.book_append_sheet(workbook, worksheet1, '상세 기록');
         XLSX.utils.book_append_sheet(workbook, worksheet2, '업무별 요약');
         XLSX.utils.book_append_sheet(workbook, worksheet3, '파트별 인건비');
         XLSX.writeFile(workbook, `업무기록_${dateKey}.xlsx`);

     } catch (error) {
         console.error("Excel export failed:", error);
         showToast("Excel 파일 생성에 실패했습니다.", true);
     }
 };

 const switchHistoryView = (view) => {
     const dateListContainer = document.getElementById('history-date-list-container');
     if (dateListContainer) {
          dateListContainer.style.display = view === 'daily' ? 'block' : 'none';
     }
     historyTabs.querySelectorAll('button').forEach(btn => {
         const isActive = btn.dataset.view === view;
         btn.classList.toggle('font-semibold', isActive);
         btn.classList.toggle('text-blue-600', isActive);
         btn.classList.toggle('border-b-2', isActive);
         btn.classList.toggle('border-blue-600', isActive);
         btn.classList.toggle('text-gray-500', !isActive);
     });
     Array.from(historyViewContainer.children).forEach(child => {
          if (child.id === `history-${view}-view`) {
              child.classList.remove('hidden');
          } else {
              child.classList.add('hidden');
          }
     });

     if (view === 'daily') {
         const selectedDateBtn = historyDateList?.querySelector('button.font-bold');
         if (selectedDateBtn) {
             renderHistoryDetail(selectedDateBtn.dataset.key);
         } else {
              const dailyView = document.getElementById('history-daily-view');
              if(dailyView) dailyView.innerHTML = `<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>`;
         }
     } else if (view === 'weekly') {
          renderWeeklyHistory();
     } else if (view === 'monthly') {
          renderMonthlyHistory();
     }
 };

// ======[ 이력 보기 관련 함수 추가 끝 ]======


// --- Event Listeners ---

teamStatusBoard.addEventListener('click', (e) => {
    // ... (이전과 동일) ...
     // Priority 1: Specific buttons inside a card
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) {
        const groupId = parseFloat(stopGroupButton.dataset.groupId);
        stopWorkGroup(groupId);
        return;
    }

    const pauseGroupButton = e.target.closest('.pause-work-group-btn');
    if (pauseGroupButton) {
        const groupId = parseFloat(pauseGroupButton.dataset.groupId);
        pauseWorkGroup(groupId);
        return;
    }

    const resumeGroupButton = e.target.closest('.resume-work-group-btn');
    if (resumeGroupButton) {
        const groupId = parseFloat(resumeGroupButton.dataset.groupId);
        resumeWorkGroup(groupId);
        return;
    }

    const individualStopBtn = e.target.closest('[data-action="stop-individual"]');
    if (individualStopBtn) {
        e.stopPropagation();
        const recordId = parseFloat(individualStopBtn.dataset.recordId);
        const record = (appState.workRecords || []).find(r => r.id === recordId);
        if (record) {
            recordToStopId = recordId;
            stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            stopIndividualConfirmModal.classList.remove('hidden');
        }
        return;
    }

    // Priority 2: Member card in the "All Members" section
    const memberCard = e.target.closest('[data-member-toggle-leave]');
    if (memberCard) {
        const memberName = memberCard.dataset.memberToggleLeave;
        const isWorking = (appState.workRecords || []).some(r => r.member === memberName && (r.status === 'ongoing' || r.status === 'paused'));

        if (isWorking) {
            showToast(`${memberName}님은 현재 업무 중이므로 휴무로 변경할 수 없습니다.`, true);
            return;
        }

        if (!appState.onLeaveMembers) appState.onLeaveMembers = [];
        const onLeaveIndex = appState.onLeaveMembers.indexOf(memberName);
        if (onLeaveIndex > -1) {
            appState.onLeaveMembers.splice(onLeaveIndex, 1);
            showToast(`${memberName}님의 휴무가 취소되었습니다.`);
        } else {
            appState.onLeaveMembers.push(memberName);
            showToast(`${memberName}님이 휴무로 설정되었습니다.`);
        }
        saveStateToFirestore();
        return;
    }

    // Priority 3: Fallback to the main card action
    const card = e.target.closest('div[data-action]');
    if (card) {
        if (e.target.closest('button, .members-list')) {
            return;
        }

        const action = card.dataset.action;

        if (action === 'start-task') {
            const task = card.dataset.task;
            selectedTaskForStart = task;
            selectedGroupForAdd = null;
            renderTeamSelectionModalContent(task, appState);
            document.getElementById('team-select-modal-title').textContent = `'${task}' 업무 시작`;
            teamSelectModal.classList.remove('hidden');
        } else if (action === 'other') {
            selectedTaskForStart = null;
            selectedGroupForAdd = null;
            taskSelectModal.classList.remove('hidden');
        } else if (action === 'add-member') {
            const task = card.dataset.task;
            const groupId = parseFloat(card.dataset.groupId);
            selectedTaskForStart = task;
            selectedGroupForAdd = groupId;
            renderTeamSelectionModalContent(task, appState);
            document.getElementById('team-select-modal-title').textContent = `'${task}' 업무에 인원 추가`;
            teamSelectModal.classList.remove('hidden');
        }
    }
});


workLogBody.addEventListener('click', (e) => {
    // ... (이전과 동일) ...
     const targetButton = e.target.closest('button');
    if (!targetButton) return;

    const action = targetButton.dataset.action;
    const recordId = parseFloat(targetButton.dataset.recordId);

    if (action === 'edit') {
        recordToEditId = recordId;
        const record = (appState.workRecords || []).find(r => r.id === recordId);
        if (!record) return;

        document.getElementById('edit-member-name').value = record.member;

        const taskSelect = document.getElementById('edit-task-type');
        taskSelect.innerHTML = '';
        Object.entries(taskGroups).forEach(([groupName, tasks]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = groupName;
            tasks.sort().forEach(task => {
                const option = document.createElement('option');
                option.value = task;
                option.textContent = task;
                if (task === record.task) {
                    option.selected = true;
                }
                optgroup.appendChild(option);
            });
            taskSelect.appendChild(optgroup);
        });

        document.getElementById('edit-start-time').value = record.startTime || '';
        document.getElementById('edit-end-time').value = record.endTime || '';

        editRecordModal.classList.remove('hidden');
    } else if (action === 'delete') {
        deleteMode = 'single';
        recordToDeleteId = recordId;
        document.getElementById('delete-confirm-message').textContent = '정말로 이 기록을 삭제하시겠습니까?';
        deleteConfirmModal.classList.remove('hidden');
    }
});

deleteAllCompletedBtn.addEventListener('click', () => {
    // ... (이전과 동일) ...
    deleteMode = 'all';
    document.getElementById('delete-confirm-message').textContent = '정말로 오늘 완료된 모든 기록을 삭제하시겠습니까?';
    deleteConfirmModal.classList.remove('hidden');
});

confirmDeleteBtn.addEventListener('click', () => {
    // ... (이전과 동일) ...
     if (!appState.workRecords) appState.workRecords = [];
    if (deleteMode === 'single' && recordToDeleteId !== null) {
        appState.workRecords = appState.workRecords.filter(record => record.id !== recordToDeleteId);
        showToast('기록이 삭제되었습니다.');
    } else if (deleteMode === 'all') {
        appState.workRecords = appState.workRecords.filter(record => record.status !== 'completed');
        showToast('완료된 모든 기록이 삭제되었습니다.');
    }
    saveStateToFirestore();
    deleteConfirmModal.classList.add('hidden');
    recordToDeleteId = null;
    deleteMode = 'single';
});

endShiftBtn.addEventListener('click', () => {
    // ... (이전과 동일) ...
     renderQuantityModalInputs(appState.taskQuantities);
    document.getElementById('quantity-modal-title').textContent = "업무 마감 전 처리량 입력";
    document.getElementById('confirm-quantity-btn').textContent = "저장하고 마감";
    document.getElementById('cancel-quantity-btn').textContent = "저장 없이 마감";

    quantityModalContext = {
        mode: 'end-shift',
        onConfirm: (newQuantities) => {
            appState.taskQuantities = newQuantities;
            saveDayDataToHistory(true);
        },
        onCancel: () => {
            saveDayDataToHistory(true);
        }
    };
    quantityModal.classList.remove('hidden');
});

saveProgressBtn.addEventListener('click', saveProgress);

// --- 이력 보기 관련 이벤트 리스너 ---
openHistoryBtn.addEventListener('click', () => {
    loadAndRenderHistoryList();
    historyModal.classList.remove('hidden');
});

closeHistoryBtn.addEventListener('click', () => {
     historyModal.classList.add('hidden');
});

historyDateList.addEventListener('click', (e) => {
    const button = e.target.closest('button.history-date-btn');
    if (button) {
        document.querySelectorAll('#history-date-list button').forEach(btn => btn.classList.remove('bg-blue-100', 'font-bold'));
        button.classList.add('bg-blue-100', 'font-bold');
        switchHistoryView('daily');
        renderHistoryDetail(button.dataset.key);
    }
});

historyTabs.addEventListener('click', (e) => {
    const button = e.target.closest('button.history-tab-btn');
    if (button && button.dataset.view) {
        switchHistoryView(button.dataset.view);
    }
});

confirmHistoryDeleteBtn.addEventListener('click', async () => {
    if (historyKeyToDelete) {
        const docRef = doc(db, "artifacts", APP_ID, "history", historyKeyToDelete);
        try {
            await deleteDoc(docRef);
            showToast('선택한 날짜의 기록이 삭제되었습니다.');
            loadAndRenderHistoryList(); // 목록 새로고침
            const dailyView = document.getElementById('history-daily-view');
            if(dailyView) dailyView.innerHTML = `<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>`;
        } catch (error) {
             console.error("Error deleting history data:", error);
             showToast("이력 삭제 중 오류 발생.", true);
        }
    }
    deleteHistoryModal.classList.add('hidden');
    historyKeyToDelete = null;
});
// -----------------------------


resetAppBtn.addEventListener('click', () => {
    resetAppModal.classList.remove('hidden');
});

confirmResetAppBtn.addEventListener('click', async () => {
     try {
        const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
        await deleteDoc(docRef);

        appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        taskTypes.forEach(task => appState.taskQuantities[task] = 0);
        render();

        showToast('데이터가 초기화되었습니다.');
    } catch (error) {
        console.error("Error resetting data:", error);
        showToast('초기화 중 오류가 발생했습니다.', true);
    }
    resetAppModal.classList.add('hidden');
});


confirmQuantityBtn.addEventListener('click', () => {
    const inputs = document.querySelectorAll('#modal-task-quantity-inputs input');
    const newQuantities = {};
    inputs.forEach(input => {
        const task = input.dataset.task;
        const value = parseInt(input.value, 10);
        newQuantities[task] = (!isNaN(value) && value >= 0) ? value : 0;
    });

    if (quantityModalContext.onConfirm) {
        quantityModalContext.onConfirm(newQuantities);
    }
    quantityModal.classList.add('hidden');
});

confirmEditBtn.addEventListener('click', () => {
     if (recordToEditId === null) return;

    const recordIndex = (appState.workRecords || []).findIndex(r => r.id === recordToEditId);
    if (recordIndex === -1) {
         editRecordModal.classList.add('hidden');
         recordToEditId = null;
         return;
    }
    const record = appState.workRecords[recordIndex];

    const newStartTime = document.getElementById('edit-start-time').value;
    const newEndTime = document.getElementById('edit-end-time').value;
    const newtask = document.getElementById('edit-task-type').value;
    const newMember = document.getElementById('edit-member-name').value;

    if (!newMember || !newtask || !newStartTime || !newEndTime || newStartTime >= newEndTime) {
         showToast('입력값을 확인해주세요. (종료 시간 > 시작 시간)', true);
         return;
    }

    const updatedRecord = { ...record };
    updatedRecord.member = newMember;
    updatedRecord.startTime = newStartTime;
    updatedRecord.endTime = newEndTime;
    updatedRecord.task = newtask;

    const start = new Date(`1970-01-01T${newStartTime}`);
    const end = new Date(`1970-01-01T${newEndTime}`);
    let totalPauseMinutes = 0;
    (updatedRecord.pauses || []).forEach(p => {
        if (p.start && p.end) {
             const pauseStart = new Date(`1970-01-01T${p.start}`);
             const pauseEnd = new Date(`1970-01-01T${p.end}`);
              if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
              }
         }
     });

    if (!isNaN(start) && !isNaN(end)) {
        const newDuration = (end - start) / (1000 * 60) - totalPauseMinutes;
        updatedRecord.duration = Math.max(0, newDuration);
    } else {
        updatedRecord.duration = 0;
    }

    appState.workRecords[recordIndex] = updatedRecord;

    saveStateToFirestore();
    showToast('기록이 수정되었습니다.');
    editRecordModal.classList.add('hidden');
    recordToEditId = null;
});

confirmQuantityOnStopBtn.addEventListener('click', () => {
     const quantity = parseInt(document.getElementById('quantity-on-stop-input').value, 10) || 0;
    finalizeStopGroup(groupToStopId, quantity);
});

taskSelectModal.addEventListener('click', e => {
     if (e.target.classList.contains('task-select-btn')) {
        const task = e.target.dataset.task;
        selectedTaskForStart = task;
        selectedGroupForAdd = null;
        taskSelectModal.classList.add('hidden');
        renderTeamSelectionModalContent(task, appState);
        document.getElementById('team-select-modal-title').textContent = `'${task}' 업무 시작`;
        teamSelectModal.classList.remove('hidden');
    }
});

confirmStopIndividualBtn.addEventListener('click', () => {
     if (recordToStopId !== null) {
        stopWorkIndividual(recordToStopId);
    }
    stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null;
});

// 공통 모달 닫기 버튼 이벤트
document.querySelectorAll('.modal-close-btn').forEach(btn => {
     btn.addEventListener('click', (e) => {
        e.target.closest('.fixed.inset-0')?.classList.add('hidden');
    });
});


// 개별 취소 버튼들
cancelDeleteBtn.addEventListener('click', () => deleteConfirmModal.classList.add('hidden'));
cancelQuantityBtn.addEventListener('click', () => {
    if (quantityModalContext.onCancel) quantityModalContext.onCancel();
    quantityModal.classList.add('hidden');
});
cancelHistoryDeleteBtn.addEventListener('click', () => deleteHistoryModal.classList.add('hidden'));
cancelEditBtn.addEventListener('click', () => editRecordModal.classList.add('hidden'));
cancelResetAppBtn.addEventListener('click', () => resetAppModal.classList.add('hidden'));
cancelQuantityOnStopBtn.addEventListener('click', () => quantityOnStopModal.classList.add('hidden'));
cancelStopIndividualBtn.addEventListener('click', () => stopIndividualConfirmModal.classList.add('hidden'));
cancelEditPartTimerBtn.addEventListener('click', () => editPartTimerModal.classList.add('hidden'));
document.getElementById('cancel-team-select-btn')?.addEventListener('click', () => {
     teamSelectModal.classList.add('hidden');
     tempSelectedMembers = [];
     selectedTaskForStart = null;
     selectedGroupForAdd = null;
});

// 토글 기능
[toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
     if (!toggle) return;
    toggle.addEventListener('click', () => {
        if (window.innerWidth < 768) {
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            if (!content) return;

            content.classList.toggle('hidden');
            if (content.id === 'summary-content') {
                content.style.display = content.classList.contains('hidden') ? 'none' : 'grid';
            } else {
                content.style.display = content.classList.contains('hidden') ? 'none' : 'block';
            }
            if(arrow) arrow.classList.toggle('rotate-180');
        }
    });
});


teamSelectModal.addEventListener('click', e => {
     // 팀원 선택/해제
    const card = e.target.closest('button[data-member-name]');
    if (card && !card.disabled) {
        const memberName = card.dataset.memberName;
        const index = tempSelectedMembers.indexOf(memberName);
        if (index > -1) {
            tempSelectedMembers.splice(index, 1);
            card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100');
        } else {
            tempSelectedMembers.push(memberName);
            card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-100');
        }
        return;
    }

    // 그룹 전체 선택/해제
    const selectAllBtn = e.target.closest('.group-select-all-btn');
    if (selectAllBtn) {
        const groupName = selectAllBtn.dataset.groupName;
        const memberListContainer = teamSelectModal.querySelector(`div[data-group-name="${groupName}"]`);
        if (!memberListContainer) return;

        const memberCards = Array.from(memberListContainer.querySelectorAll('button[data-member-name]'));
        const availableMembers = memberCards
            .filter(card => !card.disabled)
            .map(card => card.dataset.memberName);

        if (availableMembers.length === 0) return;

        const areAllSelected = availableMembers.every(member => tempSelectedMembers.includes(member));

        if (areAllSelected) {
            tempSelectedMembers = tempSelectedMembers.filter(member => !availableMembers.includes(member));
            memberCards.forEach(card => {
                if (!card.disabled) card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100');
            });
        } else {
            availableMembers.forEach(member => {
                if (!tempSelectedMembers.includes(member)) {
                    tempSelectedMembers.push(member);
                }
            });
            memberCards.forEach(card => {
                if (!card.disabled) card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-100');
            });
        }
        return;
    }

    // 알바 추가 버튼
    const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
    if (addPartTimerBtn) {
        if(!appState.partTimers) appState.partTimers = [];
        let counter = appState.partTimers.length + 1;
        let newName = `알바 ${counter}`;
        const allNames = teamGroups.flatMap(g => g.members).concat(appState.partTimers.map(p => p.name));
        while(allNames.includes(newName)) {
             counter++;
             newName = `알바 ${counter}`;
        }
        const newId = Date.now();

        appState.partTimers.push({ id: newId, name: newName });
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState));
        return;
    }

    // 알바 수정 버튼
    const editPartTimerBtn = e.target.closest('.edit-part-timer-btn');
    if (editPartTimerBtn) {
        const id = parseFloat(editPartTimerBtn.dataset.partTimerId);
        const partTimer = (appState.partTimers || []).find(p => p.id === id);
        if (partTimer) {
            partTimerEditIdInput.value = id;
            partTimerNewNameInput.value = partTimer.name;
            editPartTimerModal.classList.remove('hidden');
        }
        return;
    }

    // 알바 삭제 버튼
    const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
    if(deletePartTimerBtn){
        const id = parseFloat(deletePartTimerBtn.dataset.partTimerId);
        appState.partTimers = (appState.partTimers || []).filter(p => p.id !== id);
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState));
        return;
    }
});

confirmEditPartTimerBtn.addEventListener('click', () => {
     const id = parseFloat(partTimerEditIdInput.value);
    const partTimerIndex = (appState.partTimers || []).findIndex(p => p.id === id);
    if (partTimerIndex === -1) {
         editPartTimerModal.classList.add('hidden');
         return;
    }
    const partTimer = appState.partTimers[partTimerIndex];
    const newName = partTimerNewNameInput.value;

    if (newName && newName.trim() !== '' && newName.trim() !== partTimer.name) {
        const newNameTrimmed = newName.trim();
        const allNames = teamGroups.flatMap(g => g.members)
                             .concat((appState.partTimers || []).filter((p, index) => index !== partTimerIndex).map(p => p.name));
        if (allNames.includes(newNameTrimmed)) {
            showToast('해당 이름은 이미 사용 중입니다.', true);
            return;
        }

        const oldName = partTimer.name;
        appState.partTimers[partTimerIndex] = { ...partTimer, name: newNameTrimmed };

        appState.workRecords = (appState.workRecords || []).map(record => {
            if (record.member === oldName) {
                return { ...record, member: newNameTrimmed };
            }
            return record;
        });

        saveStateToFirestore().then(() => {
            renderTeamSelectionModalContent(selectedTaskForStart, appState);
            editPartTimerModal.classList.add('hidden');
            showToast('알바 이름이 수정되었습니다.');
        });
    } else if (newName && newName.trim() === '') {
        showToast('알바 이름은 비워둘 수 없습니다.', true);
    } else {
        editPartTimerModal.classList.add('hidden');
    }
});

// 팀 선택 완료 버튼
document.getElementById('confirm-team-select-btn')?.addEventListener('click', () => {
     if (tempSelectedMembers.length === 0) {
        showToast('추가할 팀원을 선택해주세요.', true);
        return;
    }

    if (selectedGroupForAdd !== null) {
        addMembersToWorkGroup(tempSelectedMembers, selectedTaskForStart, selectedGroupForAdd);
        showToast(`${selectedTaskForStart} 업무에 인원이 추가되었습니다.`);
    } else if (selectedTaskForStart) {
        startWorkGroup(tempSelectedMembers, selectedTaskForStart);
        showToast(`${selectedTaskForStart} 업무를 시작합니다.`);
    }

    teamSelectModal.classList.add('hidden');
    tempSelectedMembers = [];
    selectedTaskForStart = null;
    selectedGroupForAdd = null;
});

// 수동 추가 관련 이벤트 리스너 없음

// --- App Initialization ---
function main() {
    renderTaskSelectionModal();
    displayCurrentDate();

    // 타이머 시작
    if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
    elapsedTimeTimer = setInterval(updateElapsedTimes, 1000);

    const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
    taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);
    appState = defaultState;
    // 초기 렌더링 제거됨

    connectionStatusEl.textContent = '연결 중...';
    statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

    if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("AIzaSy") === false) {
        connectionStatusEl.textContent = "설정 필요";
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        showToast("Firebase API 키 구성 정보가 올바르지 않습니다.", true);
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
    } catch (error) {
         console.error("Firebase 초기화 실패:", error);
         showToast("Firebase 초기화에 실패했습니다.", true);
         connectionStatusEl.textContent = '초기화 실패';
         statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
         return;
    }

    onAuthStateChanged(auth, async user => {
        if (user) {
            console.log("Firebase Auth State Changed: User Logged In", user.uid);

            const todayDocRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
            if (unsubscribeToday) unsubscribeToday();

            unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
                console.log("Firestore Snapshot Received");
                try {
                    // 기본 상태 정의 (Firestore 데이터 없을 때 사용)
                    const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
                    taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);

                    const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};
                    console.log("Loaded State:", loadedState);

                    // 상태 병합: Firestore 데이터가 있으면 사용하고, 없으면 기본값 사용
                    appState = {
                        ...defaultState, // 기본 구조 보장
                        ...loadedState, // Firestore 데이터 덮어쓰기
                        // 각 배열 속성이 로드된 상태에 없거나 null일 경우 빈 배열([])로 설정
                        workRecords: loadedState.workRecords || [],
                        taskQuantities: loadedState.taskQuantities || defaultState.taskQuantities,
                        onLeaveMembers: loadedState.onLeaveMembers || [],
                        partTimers: loadedState.partTimers || [],
                        hiddenGroupIds: loadedState.hiddenGroupIds || []
                     };
                    console.log("Merged App State:", appState);

                    render(); // 최종 렌더링
                    connectionStatusEl.textContent = '동기화';
                    statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';

                } catch (parseError) {
                     console.error("Error parsing state from Firestore:", parseError);
                     showToast("데이터 로딩 중 오류 발생 (파싱 실패).", true);
                     // 파싱 실패 시 안전하게 기본 상태로 초기화 후 렌더링
                     appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
                     taskTypes.forEach(task => appState.taskQuantities[task] = 0);
                     render();
                     connectionStatusEl.textContent = '데이터 오류';
                     statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                }

            }, (error) => {
                console.error("Firebase onSnapshot error:", error);
                showToast("실시간 연결에 실패했습니다.", true);
                connectionStatusEl.textContent = '연결 오류';
                statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                 // 연결 오류 시 기본 상태로 초기화 후 렌더링
                 appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
                 taskTypes.forEach(task => appState.taskQuantities[task] = 0);
                 render();
            });
        } else {
             console.log("Firebase Auth State Changed: User Logged Out");
             connectionStatusEl.textContent = '인증 필요';
             statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
             if (unsubscribeToday) {
                 unsubscribeToday();
                 unsubscribeToday = undefined;
             }
             // 로그아웃 시 기본 상태로 초기화 후 렌더링
             appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
             taskTypes.forEach(task => appState.taskQuantities[task] = 0);
             render();
        }
    });

    signInAnonymously(auth).catch(error => {
        console.error("Anonymous sign-in failed:", error);
        showToast("자동 인증에 실패했습니다.", true);
        connectionStatusEl.textContent = '인증 실패';
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    });
}

main();