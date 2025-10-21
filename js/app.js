import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, teamGroups, taskGroups, taskTypes, quantityTaskTypes, defaultMemberWages } from './config.js'; // 필요한 설정값 추가
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H, getWeekOfYear, isWeekday } from './utils.js'; // 필요한 유틸 함수 추가
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
// 수동 추가 모달 요소 제거됨

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
let appConfig = { memberWages: defaultMemberWages }; // Firestore 대신 기본값 사용
let selectedTaskForStart = null;
let selectedGroupForAdd = null;
let recordToDeleteId = null;
let recordToStopId = null;
let historyKeyToDelete = null;
let allHistoryData = []; // 이력 데이터 캐시
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
            console.error("Error calculating ongoing time for record:", record, e);
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
             console.error("Error updating duration element:", el, e);
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
        showToast("화면을 그리는데 오류가 발생했습니다.", true);
        // 오류 발생 시 기본 상태로 복구 시도 (선택적)
        // appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        // taskTypes.forEach(task => appState.taskQuantities[task] = 0);
        // renderRealtimeStatus(appState); // 기본 상태로 다시 렌더링 시도
    }
};

// --- Main Logic & Firebase Integration ---
const startWorkGroup = (members, task) => {
    // ... (이전과 동일) ...
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
    // ... (이전과 동일) ...
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
    // ... (이전과 동일) ...
     const recordsToStop = (appState.workRecords || []).filter(r => r.groupId === groupId && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return;
    finalizeStopGroup(groupId, null);
};

const finalizeStopGroup = (groupId, quantity) => {
    // ... (이전과 동일, duration 음수 방지 확인) ...
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
                record.duration = Math.max(0, totalDuration - totalPauseMinutes); // 음수 방지
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
    // ... (이전과 동일, duration 음수 방지 확인) ...
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
            record.duration = Math.max(0, totalDuration - totalPauseMinutes); // 음수 방지
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
    // ... (이전과 동일) ...
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
    // ... (이전과 동일) ...
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
    // ... (이전과 동일) ...
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

// ======[ saveProgress 함수 수정: 처리량 누적 및 상태 초기화 ]======
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

        // 처리량 누적 로직 수정
        const finalQuantities = { ...(existingData.taskQuantities || {}) };
        for (const task in currentQuantities) {
             finalQuantities[task] = (finalQuantities[task] || 0) + currentQuantities[task]; // 기존값 + 현재값
        }

        const dataToSave = {
            workRecords: uniqueRecords,
            taskQuantities: finalQuantities,
            onLeaveMembers: appState.onLeaveMembers || [] // 현재 휴무 상태 저장
        };

        await setDoc(historyDocRef, dataToSave);

        // 중간 저장 후 현재 상태에서 완료된 기록과 처리량 초기화 (중복 저장 방지)
        appState.workRecords = (appState.workRecords || []).filter(r => r.status !== 'completed');
        appState.taskQuantities = {}; // 처리량 초기화
        taskTypes.forEach(task => { appState.taskQuantities[task] = 0; });
        await saveStateToFirestore(); // 초기화된 상태 저장

        showToast(`현재까지의 기록이 성공적으로 저장되었습니다.`);

    } catch (e) {
        console.error("Error in saveProgress: ", e);
        showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
    }
}
// =============================================================

async function saveDayDataToHistory(shouldReset) {
    // ... (이전과 동일, saveProgress 호출 전 상태 저장 확인) ...
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
        await saveStateToFirestore(); // 강제 완료된 상태 저장
    }

    await saveProgress(); // 모든 완료 기록(강제 완료 포함)을 history에 저장 및 현재 상태 초기화

    if(shouldReset){
        // saveProgress에서 이미 초기화되었으므로 추가 초기화 불필요
        showToast(`오늘의 업무 기록을 초기화했습니다.`);
        render(); // 초기화된 상태로 UI 업데이트
    }
}


// ======[ 이력 보기 관련 함수 추가 시작 ]======

// Firestore에서 모든 history 데이터를 가져와 캐시에 저장
async function fetchAllHistoryData() {
    // if (allHistoryData.length > 0) return allHistoryData; // 캐시 사용 (선택적)

    const historyCollectionRef = collection(db, "artifacts", APP_ID, "history");
    try {
        const querySnapshot = await getDocs(historyCollectionRef);
        allHistoryData = []; // 항상 새로고침
        querySnapshot.forEach((doc) => {
            allHistoryData.push({ id: doc.id, ...doc.data() });
        });
        console.log("Fetched all history data:", allHistoryData); // 로그 추가
        return allHistoryData;
    } catch (error) {
        console.error("Error fetching all history data:", error);
        showToast("전체 이력 로딩 실패", true);
        return [];
    }
}

// History 날짜 목록 렌더링 및 첫 항목 자동 선택/표시
const loadAndRenderHistoryList = async () => {
    if (!historyDateList) return; // 요소 없으면 종료
    historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">이력 로딩 중...</div></li>';
    allHistoryData = []; // 캐시 초기화

    const historyData = await fetchAllHistoryData();

    if (historyData.length === 0) {
        historyDateList.innerHTML = '<li><div class="p-4 text-center text-gray-500">저장된 이력이 없습니다.</div></li>';
         // 뷰 컨테이너 초기화
         document.getElementById('history-daily-view').innerHTML = '';
         document.getElementById('history-weekly-view').innerHTML = '';
         document.getElementById('history-monthly-view').innerHTML = '';
        return;
    }

    const dates = historyData.map(d => d.id).sort((a, b) => b.localeCompare(a)); // 최신순 정렬

    historyDateList.innerHTML = '';
    dates.forEach(dateKey => {
        const li = document.createElement('li');
        li.innerHTML = `<button data-key="${dateKey}" class="history-date-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:outline-none focus:ring-2 focus:ring-blue-300">${dateKey}</button>`;
        historyDateList.appendChild(li);
    });

    // 첫 번째 날짜 자동 선택 및 상세 보기
    if (historyDateList.firstChild) {
        const firstButton = historyDateList.firstChild.querySelector('button');
        if (firstButton) {
            firstButton.classList.add('bg-blue-100', 'font-bold');
            switchHistoryView('daily'); // 일별 탭 활성화
            renderHistoryDetail(firstButton.dataset.key); // 상세 내용 렌더링
        }
    } else {
         // 날짜가 없을 경우 기본 메시지 표시
         switchHistoryView('daily'); // 기본 탭은 일별
         document.getElementById('history-daily-view').innerHTML = '<div class="text-center text-gray-500 p-8">표시할 이력이 없습니다.</div>';
    }
};

// 특정 날짜의 처리량 수정 모달 열기
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
             // 전체 데이터를 다시 저장 (덮어쓰기)
             try {
                 await setDoc(historyDocRef, allHistoryData[dataToUpdateIndex]);
                 showToast(`${dateKey}의 처리량이 수정되었습니다.`);
                 renderHistoryDetail(dateKey); // 현재 뷰 다시 렌더링
             } catch (error) {
                  console.error("Error updating history quantities:", error);
                  showToast("처리량 업데이트 중 오류 발생.", true);
             }
         },
         onCancel: () => { /* Just close */ }
     };

     document.getElementById('confirm-quantity-btn').textContent = "수정 저장";
     document.getElementById('cancel-quantity-btn').textContent = "취소";
     quantityModal.classList.remove('hidden');
};

// 특정 날짜의 상세 정보 렌더링
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
    // 이력 데이터에 알바 정보가 없을 수 있으므로, 현재 상태의 알바 수를 기준으로 계산 (근사치)
    const allPartTimersCount = (appState.partTimers || []).length;
    // 근무 인원은 해당 날짜의 휴무자를 제외하고 계산
    const activeMembersCount = allRegularMembers.size - onLeaveMembers.length + allPartTimersCount;

    const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);

    // 전체 시간 계산 로직 (그룹별 중복 시간 제외)
    const taskGroupsDurations = {};
    records.forEach(record => {
        if (!taskGroupsDurations[record.groupId]) {
            taskGroupsDurations[record.groupId] = { start: record.startTime, end: record.endTime };
        } else {
            if (record.startTime < taskGroupsDurations[record.groupId].start) {
                taskGroupsDurations[record.groupId].start = record.startTime;
            }
            if (record.endTime > taskGroupsDurations[record.groupId].end) {
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

    // 비업무시간 계산
    let nonWorkHtml = '';
    if (isWeekday(dateKey)) {
        const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간 기준
        const nonWorkMinutes = totalPotentialMinutes - totalSumDuration;
        const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
        nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center">
            <h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4>
            <p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes > 0 ? nonWorkMinutes : 0)}</p>
            <p class="text-xs text-gray-500 mt-1">(추정치)</p> {/* 추정치임을 명시 */}
            {/* <p class="text-xs text-gray-500 mt-1">총 ${formatDuration(totalPotentialMinutes)} 중 (${percentage}%)</p> */}
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
            {/* <div class="bg-white p-4 rounded-lg shadow-sm text-center"><h4 class="text-sm font-semibold text-gray-500">전체 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalOverallDuration)}</p></div> */}
            ${nonWorkHtml}
            <div class="bg-white p-4 rounded-lg shadow-sm text-center" colspan="2"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
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
        .sort(([taskA], [taskB]) => taskA.localeCompare(taskB)) // 가나다 순 정렬
        .forEach(([task, qty]) => {
            hasQuantities = true;
            html += `<div class="flex justify-between items-center text-sm border-b pb-1"><span class="font-semibold text-gray-600">${task}</span><span>${qty} 개</span></div>`;
    });
    if (!hasQuantities) {
        html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    }
    html += `</div></div>`; // End of 업무별 처리량

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
    html += `</div></div>`; // End of 업무별 분당 처리량
    html += `</div>`; // End of grid

    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 시간 비중</h4><div class="space-y-3">`;
    Object.entries(taskDurations)
        .filter(([, duration]) => duration > 0) // 시간 0 이상만 표시
        .sort(([,a],[,b]) => b - a) // 시간 많은 순 정렬
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
    html += `</div></div>`; // End of 업무별 시간 비중

    view.innerHTML = html;
};

// 주별/월별 요약 렌더링 함수 (구조만 제공, 상세 구현 필요)
const renderSummaryView = (viewType, data, key) => {
     if (!data) return ''; // 데이터 없으면 빈 문자열 반환
     const totalDuration = (data.workRecords || []).reduce((sum, r) => sum + (r.duration || 0), 0);
     const totalQuantity = Object.values(data.taskQuantities || {}).reduce((sum, q) => sum + (parseInt(q,10) || 0), 0);
     const avgThroughput = totalDuration > 0 ? (totalQuantity / totalDuration).toFixed(2) : '0.00';
     const taskDurations = (data.workRecords || []).reduce((acc, rec) => {
         acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0);
         return acc;
     }, {});

     let html = `
         <div class="bg-white p-4 rounded-lg shadow-sm">
             <div class="pb-3 border-b mb-3">
                 <div class="flex justify-between items-baseline">
                      <h3 class="text-xl font-bold text-blue-600">${key}</h3>
                      <span class="text-lg font-semibold text-gray-800">${avgThroughput} <span class="text-sm font-normal text-gray-500">개/분</span></span>
                 </div>
                 <div class="text-sm text-gray-500 mt-1">
                     <span>총 업무 시간: ${formatDuration(totalDuration)}</span>
                     <span class="mx-2">|</span>
                     <span>총 처리량: ${totalQuantity} 개</span>
                 </div>
             </div>
             <div>
                 <h4 class="text-md font-bold mb-2 text-gray-600">업무별 분당 처리량</h4>
                 <div class="space-y-1 max-h-40 overflow-y-auto">
     `;

     let hasQuantities = false;
     Object.entries(data.taskQuantities || {})
         .filter(([, qty]) => parseInt(qty, 10) > 0)
         .sort(([taskA], [taskB]) => taskA.localeCompare(taskB))
         .forEach(([task, qty]) => {
             hasQuantities = true;
             const durationForTask = taskDurations[task] || 0;
             const throughputForTask = durationForTask > 0 ? ((parseInt(qty, 10) || 0) / durationForTask).toFixed(2) : '0.00';
             html += `<div class="flex justify-between items-center text-sm text-gray-700 border-b pb-1"><span class="font-medium">${task}</span><span>${throughputForTask} 개/분</span></div>`;
     });
      if (!hasQuantities) {
         html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
     }

     html += `</div></div></div>`;
     return html;
 };

 const renderWeeklyHistory = () => {
     const view = document.getElementById('history-weekly-view');
     if (!view) return;
     view.innerHTML = `<div class="text-center text-gray-500">주별 데이터 집계 중...</div>`;

     // 데이터 집계
     const weeklyData = allHistoryData.reduce((acc, day) => {
         if (!day.id || !day.workRecords) return acc; // 데이터 형식 오류 방지
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

     view.innerHTML = sortedWeeks.map(weekKey => renderSummaryView('weekly', weeklyData[weekKey], weekKey)).join('');
 };

 const renderMonthlyHistory = () => {
      const view = document.getElementById('history-monthly-view');
      if (!view) return;
     view.innerHTML = `<div class="text-center text-gray-500">월별 데이터 집계 중...</div>`;

     // 데이터 집계
     const monthlyData = allHistoryData.reduce((acc, day) => {
         if (!day.id || !day.workRecords) return acc;
         try {
             const monthKey = day.id.substring(0, 7); // YYYY-MM
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

     view.innerHTML = sortedMonths.map(monthKey => renderSummaryView('monthly', monthlyData[monthKey], monthKey)).join('');
 };

 // 이력 삭제 요청
 window.requestHistoryDeletion = (dateKey) => {
     historyKeyToDelete = dateKey;
     document.getElementById('delete-history-modal').classList.remove('hidden'); // 모달 ID 직접 사용
 };

 // 이력 엑셀 다운로드
 window.downloadHistoryAsExcel = async (dateKey) => {
     // 초기 index.html 스크립트의 구현 내용 참고하여 복원 (XLSX 라이브러리 필요)
     try {
         const data = allHistoryData.find(d => d.id === dateKey);
         if (!data || !data.workRecords || data.workRecords.length === 0) {
             return showToast('다운로드할 데이터가 없습니다.', true);
         }
         const records = data.workRecords;

         const appendTotalRow = (ws, data, headers) => { /* ... (구현 생략) ... */ };

         // Sheet 1: 상세 기록
         const sheet1Headers = ['팀원', '업무 종류', '시작 시간', '종료 시간', '소요 시간(분)'];
         const sheet1Data = records.map(r => ({/*...*/}));
         const worksheet1 = XLSX.utils.json_to_sheet(sheet1Data, { header: sheet1Headers });
         // appendTotalRow(worksheet1, sheet1Data, sheet1Headers);

         // Sheet 2: 업무별 요약
         const sheet2Headers = ['업무 종류', '총 소요 시간(분)', '총 인건비(원)'];
         const summaryByTask = {};
         records.forEach(r => {/*...*/});
         const sheet2Data = Object.keys(summaryByTask).sort().map(task => ({/*...*/}));
         const worksheet2 = XLSX.utils.json_to_sheet(sheet2Data, { header: sheet2Headers });
         // appendTotalRow(worksheet2, sheet2Data, sheet2Headers);

         // Sheet 3: 파트별 인건비
         const sheet3Headers = ['파트', '총 인건비(원)'];
         const memberToPartMap = new Map();
         teamGroups.forEach(group => group.members.forEach(member => memberToPartMap.set(member, group.name)));
         const summaryByPart = {};
         records.forEach(r => {/*...*/});
         const sheet3Data = Object.keys(summaryByPart).sort().map(part => ({/*...*/}));
         const worksheet3 = XLSX.utils.json_to_sheet(sheet3Data, { header: sheet3Headers });
         // appendTotalRow(worksheet3, sheet3Data, sheet3Headers);

         const fitToColumn = (ws) => { /* ... (구현 생략) ... */ };
         fitToColumn(worksheet1);
         fitToColumn(worksheet2);
         fitToColumn(worksheet3);

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


 // History 탭 및 목록 아이템 클릭 시 뷰 전환
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

     // 데이터 로딩은 각 뷰 렌더링 함수에서 처리
     if (view === 'daily') {
         // 현재 선택된 날짜가 있으면 해당 상세 뷰 렌더링
         const selectedDateBtn = historyDateList?.querySelector('button.font-bold');
         if (selectedDateBtn) {
             renderHistoryDetail(selectedDateBtn.dataset.key);
         } else {
              // 선택된 날짜 없으면 안내 메시지
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

// ... (teamStatusBoard, workLogBody 등 기존 리스너 유지) ...

// ======[ 이력 보기 관련 이벤트 리스너 추가 ]======
openHistoryBtn.addEventListener('click', () => {
    loadAndRenderHistoryList(); // 모달 열 때 데이터 로드 및 렌더링 시작
    historyModal.classList.remove('hidden');
});

closeHistoryBtn.addEventListener('click', () => {
     historyModal.classList.add('hidden');
});

historyDateList.addEventListener('click', (e) => {
    const button = e.target.closest('button.history-date-btn');
    if (button) {
        // 기존 선택 해제
        document.querySelectorAll('#history-date-list button').forEach(btn => btn.classList.remove('bg-blue-100', 'font-bold'));
        // 새 항목 선택 표시
        button.classList.add('bg-blue-100', 'font-bold');
        // 일별 상세 뷰로 전환하고 해당 날짜 데이터 렌더링
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
            // 목록 새로고침
            loadAndRenderHistoryList();
            // 현재 상세 뷰 초기화 (선택적)
            const dailyView = document.getElementById('history-daily-view');
            if(dailyView) dailyView.innerHTML = `<div class="text-center text-gray-500 p-8">왼쪽 목록에서 날짜를 선택하세요.</div>`;

        } catch (error) {
             console.error("Error deleting history data:", error);
             showToast("이력 삭제 중 오류 발생.", true);
        }
    }
    deleteHistoryModal.classList.add('hidden');
    historyKeyToDelete = null; // 초기화
});

// ===========================================

// ... (나머지 기존 이벤트 리스너들: confirmQuantityBtn, confirmEditBtn 등) ...

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
// cancelManualAddBtn 관련 코드 제거됨
document.getElementById('cancel-team-select-btn')?.addEventListener('click', () => {
     teamSelectModal.classList.add('hidden');
     tempSelectedMembers = []; // 선택 초기화
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
    // ... (이전 팀 선택/알바 관리 로직과 동일) ...
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
        const newId = Date.now(); // ID는 여기서 생성

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
    // ... (이전과 동일) ...
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
    // ... (이전과 동일) ...
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
                    const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};
                    console.log("Loaded State:", loadedState);

                    appState = {
                        ...defaultState,
                        ...loadedState,
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
                     appState = defaultState;
                     render();
                     connectionStatusEl.textContent = '데이터 오류';
                     statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                }

            }, (error) => {
                console.error("Firebase onSnapshot error:", error);
                showToast("실시간 연결에 실패했습니다.", true);
                connectionStatusEl.textContent = '연결 오류';
                statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                 appState = defaultState;
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
             appState = defaultState;
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