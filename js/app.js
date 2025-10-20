import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, teamGroups, taskGroups, taskTypes } from './config.js'; // teamGroups, taskGroups 추가 확인
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime, formatDuration, formatTimeTo24H } from './utils.js'; // formatDuration, formatTimeTo24H 추가
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
const closeHistoryBtn = document.getElementById('close-history-btn'); // 사용되지 않으면 제거 가능
const historyDateList = document.getElementById('history-date-list'); // History 관련 UI 요소들
const historyViewContainer = document.getElementById('history-view-container');
const historyTabs = document.getElementById('history-tabs');
const quantityModal = document.getElementById('quantity-modal');
const confirmQuantityBtn = document.getElementById('confirm-quantity-btn');
const cancelQuantityBtn = document.getElementById('cancel-quantity-btn');
const deleteHistoryModal = document.getElementById('delete-history-modal');
const confirmHistoryDeleteBtn = document.getElementById('confirm-history-delete-btn'); // 사용되지 않으면 제거 가능
const cancelHistoryDeleteBtn = document.getElementById('cancel-history-delete-btn'); // 사용되지 않으면 제거 가능
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
const manualAddModal = document.getElementById('manual-add-modal');
const openManualAddModalBtn = document.getElementById('open-manual-add-modal-btn');
const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
const cancelManualAddBtn = document.getElementById('cancel-manual-add-btn');

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
let appConfig = { memberWages: {} }; // config.js 에서 default 값 사용 가능
let selectedTaskForStart = null;
let selectedGroupForAdd = null;
let recordToDeleteId = null;
let recordToStopId = null;
let historyKeyToDelete = null; // History 관련 변수
let allHistoryData = []; // History 관련 변수
let recordToEditId = null;
let deleteMode = 'single';
let elapsedTimeTimer = null; // 타이머 변수 복원
let groupToStopId = null;
let quantityModalContext = { mode: 'today', dateKey: null, onConfirm: null, onCancel: null };
let tempSelectedMembers = [];

// ======[ 타이머 함수 복원 ]======
const updateElapsedTimes = () => {
    let totalOngoingMinutes = 0;
    const now = new Date();
    // 초까지 고려하여 정확한 시간 계산
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
                    // 유효한 시간인지 확인
                    if (!isNaN(pauseStart) && !isNaN(pauseEnd) && pauseEnd > pauseStart) {
                        totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                    }
                }
            });
            // 유효한 시간인지 확인
            if (!isNaN(startTime) && !isNaN(nowTimeForCalc) && nowTimeForCalc >= startTime) {
                const elapsedMilliseconds = (nowTimeForCalc - startTime) - (totalPauseMinutes * 60 * 1000);
                const elapsedMinutes = Math.max(0, elapsedMilliseconds / (1000 * 60)); // 음수 방지
                totalOngoingMinutes += elapsedMinutes;
            }
        } catch (e) {
            console.error("Error calculating ongoing time for record:", record, e);
        }
    });

    document.querySelectorAll('.ongoing-duration').forEach(el => {
        try {
            const status = el.dataset.status;
            if (status === 'paused') { return; } // 일시정지 상태면 업데이트 안 함

            const startTimeStr = el.dataset.startTime;
            if (!startTimeStr) return;
            const startTime = new Date(`1970-01-01T${startTimeStr}`);

            // 유효한 시작 시간인지 확인
            if (isNaN(startTime)) return;

            const recordId = el.dataset.recordId; // recordId 타입 확인 (문자열일 수 있음)
            const record = (appState.workRecords || []).find(r => String(r.id) === recordId); // id 비교 시 타입 일치 확인

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

            // 유효한 시간인지 확인하고 계산
            if (!isNaN(nowTimeForCalc) && nowTimeForCalc >= startTime) {
                const elapsedMilliseconds = (nowTimeForCalc - startTime) - (totalPauseMinutes * 60 * 1000);
                const elapsedMinutes = Math.max(0, elapsedMilliseconds / (1000 * 60)); // 음수 방지
                el.textContent = `(진행: ${formatDuration(elapsedMinutes)})`;
            } else {
                 el.textContent = `(진행: 0 분)`; // 오류 시 기본값
            }
        } catch(e) {
             console.error("Error updating duration element:", el, e);
             el.textContent = `(오류)`;
        }
    });

    // 완료된 시간 + 현재 진행중인 시간 합산
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalCompletedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0); // duration이 없을 경우 0

    const liveTotalWorkTime = totalCompletedMinutes + totalOngoingMinutes;
    const summaryTimeEl = document.getElementById('summary-total-work-time');
    if (summaryTimeEl) {
        summaryTimeEl.textContent = formatDuration(liveTotalWorkTime);
    }
};
// =============================

const render = () => {
    // 순서 중요: 상태 기반 렌더링 먼저 수행
    renderRealtimeStatus(appState);
    renderCompletedWorkLog(appState);
    updateSummary(appState);
    renderTaskAnalysis(appState);
    // 타이머 함수는 렌더링 후 별도로 호출될 수 있음 (또는 여기서 호출)
    // updateElapsedTimes(); // 여기서 호출하면 초기 로딩 시 한번 업데이트
};

// --- Main Logic & Firebase Integration ---
const startWorkGroup = (members, task) => {
    const groupId = Date.now();
    const startTime = getCurrentTime();
    const newRecords = members.map(member => ({
        id: groupId + Math.random(), // ID 생성 방식 개선 고려
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId,
        pauses: []
    }));
    if (!appState.workRecords) appState.workRecords = []; // 배열 초기화 확인
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
    const recordsToStop = appState.workRecords.filter(r => r.groupId === groupId && (r.status === 'ongoing' || r.status === 'paused'));
    if (recordsToStop.length === 0) return; // 중지할 기록 없으면 종료

    finalizeStopGroup(groupId, null); // 우선 처리량 없이 종료 로직 실행
};

const finalizeStopGroup = (groupId, quantity) => {
    const endTime = getCurrentTime();
    let taskName = '';
    let stoppedCount = 0; // 실제로 상태가 변경된 기록 수

    (appState.workRecords || []).forEach(record => {
        if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
            taskName = record.task; // 그룹 내 마지막 기록의 task 이름으로 설정될 수 있음

            if (record.status === 'paused') {
                const lastPause = record.pauses?.[record.pauses.length - 1]; // Optional chaining
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
                record.duration = 0; // 유효하지 않으면 0
            }
            stoppedCount++;
        }
    });

    if (quantity !== null && taskName) {
        if (!appState.taskQuantities) appState.taskQuantities = {}; // 초기화 확인
        appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + quantity;
    }

    // hiddenGroupIds 처리 (선택적: 이미 완료된 그룹 ID를 숨길 필요가 있는지?)
    // if (stoppedCount > 0 && !(appState.hiddenGroupIds || []).includes(groupId)) {
    //     if (!appState.hiddenGroupIds) appState.hiddenGroupIds = [];
    //     appState.hiddenGroupIds.push(groupId);
    // }

    if (stoppedCount > 0) { // 변경된 경우에만 저장
        saveStateToFirestore();
    }
    quantityOnStopModal.classList.add('hidden'); // 모달 닫기
    groupToStopId = null; // 컨텍스트 초기화
}

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
        console.warn("Record not found or already completed:", recordId);
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
        // 저장 전 데이터 유효성 검사 (선택적)
        const stateToSave = JSON.stringify(appState);
        await setDoc(docRef, { state: stateToSave });
        console.log("State saved to Firestore."); // 디버깅 로그
    } catch (error) {
        console.error("Error saving state to Firestore:", error);
        showToast("데이터 동기화 중 오류 발생.", true);
    }
}

async function saveProgress() {
    const dateStr = getTodayDateString();
    showToast(`현재까지 완료된 기록을 저장합니다...`);

    const historyDocRef = doc(db, "artifacts", APP_ID, "history", dateStr);

    try {
        const docSnap = await getDoc(historyDocRef);
        const existingData = docSnap.exists() ? docSnap.data() : { workRecords: [], taskQuantities: {}, onLeaveMembers: [] };

        const completedRecordsFromState = (appState.workRecords || []).filter(r => r.status === 'completed');

        // 처리량 집계 (appState.taskQuantities가 숫자만 포함하도록)
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

        // 기록 병합 및 중복 제거
        const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
        const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());

        // 처리량 병합 (기존값 + 새로운 값)
        const finalQuantities = { ...(existingData.taskQuantities || {}) };
        for (const task in currentQuantities) {
             finalQuantities[task] = (finalQuantities[task] || 0) + currentQuantities[task];
        }

        const dataToSave = {
            workRecords: uniqueRecords,
            taskQuantities: finalQuantities,
            // 중간 저장 시 현재 휴무 상태 저장
            onLeaveMembers: appState.onLeaveMembers || []
        };

        await setDoc(historyDocRef, dataToSave);

        // 중간 저장 후 현재 상태 초기화 (옵션)
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
        // 변경된 상태를 저장해야 saveProgress에서 반영됨
        await saveStateToFirestore();
    }

    // 모든 기록(강제 완료 포함)을 history에 최종 저장
    await saveProgress();

    if(shouldReset){
        // 앱 상태 초기화
        appState.workRecords = [];
        appState.taskQuantities = {};
        appState.hiddenGroupIds = [];
        appState.onLeaveMembers = []; // 휴무 멤버 초기화
        taskTypes.forEach(task => { // 처리량 객체 구조 유지
            appState.taskQuantities[task] = 0;
        });

        // 초기화된 상태를 Firestore 'daily_data' 에 저장
        await saveStateToFirestore();
        showToast(`오늘의 업무 기록을 초기화했습니다.`);
        // 화면 즉시 업데이트
        render();
    }
}


// --- Event Listeners ---
teamStatusBoard.addEventListener('click', (e) => {
    // Priority 1: Specific buttons inside a card
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) {
        const groupId = parseFloat(stopGroupButton.dataset.groupId);
        stopWorkGroup(groupId); // finalizeStopGroup에서 처리량 없이 종료
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
        e.stopPropagation(); // 카드 클릭 방지
        const recordId = parseFloat(individualStopBtn.dataset.recordId);
        const record = (appState.workRecords || []).find(r => r.id === recordId);
        if (record) {
            recordToStopId = recordId;
            stopIndividualConfirmMessage.textContent = `${record.member}님의 '${record.task}' 업무를 종료하시겠습니까?`;
            stopIndividualConfirmModal.classList.remove('hidden');
        } else {
             console.warn("Stop individual failed: Record not found", recordId);
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

        if (!appState.onLeaveMembers) appState.onLeaveMembers = []; // 배열 초기화 확인
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
        // 버튼이나 멤버 목록 내부 클릭 시 무시
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
    const targetButton = e.target.closest('button');
    if (!targetButton) return;

    const action = targetButton.dataset.action;
    const recordId = parseFloat(targetButton.dataset.recordId);

    if (action === 'edit') {
        recordToEditId = recordId;
        const record = (appState.workRecords || []).find(r => r.id === recordId);
        if (!record) {
             console.error("Edit failed: Record not found", recordId);
             showToast("수정할 기록을 찾을 수 없습니다.", true);
             return;
        }

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

        document.getElementById('edit-start-time').value = record.startTime || ''; // null 방지
        document.getElementById('edit-end-time').value = record.endTime || ''; // null 방지

        editRecordModal.classList.remove('hidden');
    } else if (action === 'delete') {
        deleteMode = 'single';
        recordToDeleteId = recordId;
        document.getElementById('delete-confirm-message').textContent = '정말로 이 기록을 삭제하시겠습니까?';
        deleteConfirmModal.classList.remove('hidden');
    }
});

deleteAllCompletedBtn.addEventListener('click', () => {
    deleteMode = 'all';
    document.getElementById('delete-confirm-message').textContent = '정말로 오늘 완료된 모든 기록을 삭제하시겠습니까?';
    deleteConfirmModal.classList.remove('hidden');
});

confirmDeleteBtn.addEventListener('click', () => {
    if (!appState.workRecords) appState.workRecords = []; // 배열 확인
    if (deleteMode === 'single' && recordToDeleteId !== null) {
        appState.workRecords = appState.workRecords.filter(record => record.id !== recordToDeleteId);
        showToast('기록이 삭제되었습니다.');
    } else if (deleteMode === 'all') {
        appState.workRecords = appState.workRecords.filter(record => record.status !== 'completed');
        showToast('완료된 모든 기록이 삭제되었습니다.');
    }
    saveStateToFirestore(); // 변경 사항 저장
    deleteConfirmModal.classList.add('hidden');
    recordToDeleteId = null; // 초기화
    deleteMode = 'single'; // 모드 초기화
});

endShiftBtn.addEventListener('click', () => {
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
            // 처리량 저장 없이 마감
            saveDayDataToHistory(true);
        }
    };
    quantityModal.classList.remove('hidden');
});

saveProgressBtn.addEventListener('click', saveProgress);

openHistoryBtn.addEventListener('click', () => {
    // loadAndRenderHistoryList(); // History 관련 기능 필요시 구현
    historyModal.classList.remove('hidden');
});

resetAppBtn.addEventListener('click', () => {
    resetAppModal.classList.remove('hidden');
});

confirmResetAppBtn.addEventListener('click', async () => {
    try {
        const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
        await deleteDoc(docRef);

        // 로컬 상태 즉시 초기화 및 화면 반영
        appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        taskTypes.forEach(task => appState.taskQuantities[task] = 0);
        render(); // 빈 상태로 즉시 렌더링

        showToast('데이터가 초기화되었습니다.'); // 새로고침 메시지 제거
        // 새로고침 대신 초기화된 상태로 계속 사용
        // setTimeout(() => location.reload(), 1000);
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
         console.error("Edit failed: Record not found in state", recordToEditId);
         showToast("수정할 기록을 찾을 수 없습니다.", true);
         editRecordModal.classList.add('hidden'); // 모달 닫기
         recordToEditId = null;
         return;
    }
    const record = appState.workRecords[recordIndex];


    const newStartTime = document.getElementById('edit-start-time').value;
    const newEndTime = document.getElementById('edit-end-time').value;
    const newtask = document.getElementById('edit-task-type').value;
    const newMember = document.getElementById('edit-member-name').value; // 이름 필드 확인

    if (!newMember || !newtask || !newStartTime || !newEndTime) {
         showToast('모든 필드를 입력해주세요.', true);
         return;
    }
     if (newStartTime >= newEndTime) {
        showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true);
        return;
    }

    // 새 객체를 만들어 교체 (불변성 유지 권장)
    const updatedRecord = { ...record }; // 기존 기록 복사
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

    if (!isNaN(start) && !isNaN(end) && end >= start) {
        const newDuration = (end - start) / (1000 * 60) - totalPauseMinutes;
        updatedRecord.duration = Math.max(0, newDuration);
    } else {
        updatedRecord.duration = 0; // 유효하지 않으면 0
    }

    // 상태 업데이트
    appState.workRecords[recordIndex] = updatedRecord;

    saveStateToFirestore(); // 변경된 상태 저장
    showToast('기록이 수정되었습니다.');
    editRecordModal.classList.add('hidden');
    recordToEditId = null; // 초기화
});

confirmQuantityOnStopBtn.addEventListener('click', () => {
    const quantity = parseInt(document.getElementById('quantity-on-stop-input').value, 10) || 0;
    finalizeStopGroup(groupToStopId, quantity); // 수량과 함께 종료 처리
});

cancelQuantityOnStopBtn.addEventListener('click', () => {
    finalizeStopGroup(groupToStopId, null); // 수량 없이 종료 처리
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
    // 모달 닫기 버튼 공통 처리 사용
    // if (e.target.closest('.modal-close-btn')) {
    //     taskSelectModal.classList.add('hidden');
    // }
});

confirmStopIndividualBtn.addEventListener('click', () => {
    if (recordToStopId !== null) {
        stopWorkIndividual(recordToStopId);
    }
    stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null; // 초기화
});

cancelStopIndividualBtn.addEventListener('click', () => {
    stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null; // 초기화
});

// 공통 모달 닫기 버튼 이벤트
document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        // data-modal-id 속성 대신 closest 사용으로 단순화
        e.target.closest('.fixed.inset-0')?.classList.add('hidden');
    });
});


// 개별 취소 버튼들
cancelDeleteBtn.addEventListener('click', () => deleteConfirmModal.classList.add('hidden'));
cancelQuantityBtn.addEventListener('click', () => {
    if (quantityModalContext.onCancel) {
        quantityModalContext.onCancel();
    }
    quantityModal.classList.add('hidden');
});
cancelHistoryDeleteBtn.addEventListener('click', () => deleteHistoryModal.classList.add('hidden'));
cancelEditBtn.addEventListener('click', () => editRecordModal.classList.add('hidden'));
cancelResetAppBtn.addEventListener('click', () => resetAppModal.classList.add('hidden'));
cancelQuantityOnStopBtn.addEventListener('click', () => quantityOnStopModal.classList.add('hidden')); // 추가
cancelStopIndividualBtn.addEventListener('click', () => stopIndividualConfirmModal.classList.add('hidden')); // 추가
cancelEditPartTimerBtn.addEventListener('click', () => editPartTimerModal.classList.add('hidden')); // 추가
cancelManualAddBtn.addEventListener('click', () => manualAddModal.classList.add('hidden')); // 추가
document.getElementById('cancel-team-select-btn')?.addEventListener('click', () => teamSelectModal.classList.add('hidden')); // 팀 선택 취소

// 토글 기능
[toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
    if (!toggle) return; // 요소가 없는 경우 건너뛰기
    toggle.addEventListener('click', () => {
        if (window.innerWidth < 768) {
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            if (!content) return; // 다음 요소 없으면 종료

            content.classList.toggle('hidden');
            // display 속성 직접 토글 (더 안전)
            if (content.id === 'summary-content') {
                if (content.classList.contains('hidden')) {
                     content.style.display = 'none';
                } else {
                     content.style.display = 'grid'; // grid로 보이게
                }
            } else {
                 if (content.classList.contains('hidden')) {
                     content.style.display = 'none';
                } else {
                     content.style.display = 'block'; // block으로 보이게
                }
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
        return; // 다른 버튼 로직과 분리
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
        return; // 다른 버튼 로직과 분리
    }

    // 알바 추가 버튼
    const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
    if (addPartTimerBtn) {
        if(!appState.partTimers) appState.partTimers = [];
        const newId = Date.now();
        const newName = `알바 ${appState.partTimers.length + 1}`;
        // 이름 중복 방지 (선택적)
        let finalName = newName;
        let counter = 2;
        while (appState.partTimers.some(p => p.name === finalName) || teamGroups.flatMap(g => g.members).includes(finalName)) {
            finalName = `${newName} (${counter++})`;
        }

        appState.partTimers.push({ id: newId, name: finalName });
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState));
        return; // 다른 버튼 로직과 분리
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
        return; // 다른 버튼 로직과 분리
    }

    // 알바 삭제 버튼
    const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
    if(deletePartTimerBtn){
        const id = parseFloat(deletePartTimerBtn.dataset.partTimerId);
        appState.partTimers = (appState.partTimers || []).filter(p => p.id !== id);
        // 관련 작업 기록 삭제는 정책에 따라 결정 (여기서는 유지)
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState));
        return; // 다른 버튼 로직과 분리
    }
});

confirmEditPartTimerBtn.addEventListener('click', () => {
    const id = parseFloat(partTimerEditIdInput.value);
    const partTimerIndex = (appState.partTimers || []).findIndex(p => p.id === id);
    if (partTimerIndex === -1) {
         editPartTimerModal.classList.add('hidden');
         return; // 수정할 알바 없음
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
        // 상태 업데이트 (불변성 유지)
        appState.partTimers[partTimerIndex] = { ...partTimer, name: newNameTrimmed };

        // 기록 업데이트 (새 배열 생성)
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

// --- App Initialization ---
function main() {
    renderTaskSelectionModal();
    displayCurrentDate();

    // 타이머 시작 (setInterval 호출 복원)
    if (elapsedTimeTimer) clearInterval(elapsedTimeTimer);
    elapsedTimeTimer = setInterval(updateElapsedTimes, 1000); // 1초마다 시간 업데이트

    // 초기 상태 설정
    const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
    taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);
    appState = defaultState;
    // render(); // 초기 렌더링 제거됨

    connectionStatusEl.textContent = '연결 중...';
    statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

    if (!firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("AIzaSy") === false) { // 더 간단한 API 키 형식 체크
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
            console.log("Firebase Auth State Changed: User Logged In", user.uid); // 로그인 확인 로그
            // await fetchAppConfig();

            const todayDocRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
            if (unsubscribeToday) unsubscribeToday();

            unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
                console.log("Firestore Snapshot Received"); // 스냅샷 수신 로그
                try {
                    const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};
                    console.log("Loaded State:", loadedState); // 로드된 데이터 로그

                    // 상태 병합 및 기본값 보장
                    appState = {
                        ...defaultState,
                        ...loadedState,
                        workRecords: loadedState.workRecords || [],
                        taskQuantities: loadedState.taskQuantities || defaultState.taskQuantities,
                        onLeaveMembers: loadedState.onLeaveMembers || [],
                        partTimers: loadedState.partTimers || [],
                        hiddenGroupIds: loadedState.hiddenGroupIds || []
                     };
                    console.log("Merged App State:", appState); // 병합된 상태 로그

                    render(); // 최종 렌더링
                    connectionStatusEl.textContent = '동기화';
                    statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';

                } catch (parseError) {
                     console.error("Error parsing state from Firestore:", parseError);
                     showToast("데이터 로딩 중 오류 발생 (파싱 실패).", true);
                     appState = defaultState; // 파싱 실패 시 기본 상태로 초기화
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
                 render(); // 연결 오류 시 기본 상태 렌더링
            });
        } else {
             console.log("Firebase Auth State Changed: User Logged Out"); // 로그아웃 상태 로그
             connectionStatusEl.textContent = '인증 필요'; // "인증 대기 중" 보다 명확하게
             statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
             if (unsubscribeToday) {
                 unsubscribeToday(); // 리스너 해제
                 unsubscribeToday = undefined; // 변수 초기화
             }
             // 로그아웃 시 앱 상태 초기화 및 화면 업데이트
             appState = defaultState;
             render();
        }
    });

    // 익명 로그인 시도
    signInAnonymously(auth).catch(error => {
        console.error("Anonymous sign-in failed:", error);
        showToast("자동 인증에 실패했습니다.", true);
        connectionStatusEl.textContent = '인증 실패';
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    });
}

// History 관련 함수들 (필요시 구현)
// async function fetchAllHistoryData() { ... }
// const loadAndRenderHistoryList = async () => { ... };
// window.openHistoryQuantityModal = (dateKey) => { ... };
// const renderHistoryDetail = async (dateKey) => { ... };
// const renderSummaryView = (viewType, data, key) => { ... };
// const renderWeeklyHistory = async () => { ... };
// const renderMonthlyHistory = async () => { ... };
// window.requestHistoryDeletion = (dateKey) => { ... };
// window.downloadHistoryAsExcel = async (dateKey) => { ... };
// const switchHistoryView = (view) => { ... };

main();