import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
// ======[ 변경: teamGroups, taskGroups import 확인 ]======
import { firebaseConfig, teamGroups, taskGroups, taskTypes } from './config.js';
// ====================================================
import { showToast, getTodayDateString, displayCurrentDate, getCurrentTime } from './utils.js';
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
// ======[ 수동 추가 모달 요소 추가됨 ]======
const manualAddModal = document.getElementById('manual-add-modal');
const openManualAddModalBtn = document.getElementById('open-manual-add-modal-btn');
const confirmManualAddBtn = document.getElementById('confirm-manual-add-btn');
const cancelManualAddBtn = document.getElementById('cancel-manual-add-btn');
// ====================================

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
let appConfig = { memberWages: {} };
let selectedTaskForStart = null;
let selectedGroupForAdd = null;
let recordToDeleteId = null;
let recordToStopId = null;
let historyKeyToDelete = null;
let allHistoryData = [];
let recordToEditId = null;
let deleteMode = 'single';
let elapsedTimeTimer = null; // updateElapsedTimes 함수가 없으므로 주석 처리 또는 삭제 고려
let groupToStopId = null;
let quantityModalContext = { mode: 'today', dateKey: null, onConfirm: null, onCancel: null };
let tempSelectedMembers = [];

const render = () => {
    renderRealtimeStatus(appState);
    renderCompletedWorkLog(appState);
    updateSummary(appState);
    renderTaskAnalysis(appState);
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
    appState.workRecords.push(...newRecords);
    saveStateToFirestore();
};

const addMembersToWorkGroup = (members, task, groupId) => {
    const startTime = getCurrentTime();
    const newRecords = members.map(member => ({
        id: Date.now() + Math.random(), // Use a more unique ID
        member,
        task,
        startTime,
        endTime: null,
        duration: null,
        status: 'ongoing',
        groupId, // Use the existing group ID
        pauses: []
    }));
    appState.workRecords.push(...newRecords);
    saveStateToFirestore();
};

const stopWorkGroup = (groupId) => {
    const records = appState.workRecords.filter(r => r.groupId === groupId && r.status === 'ongoing');
    if (records.length === 0) {
         // If no ongoing records, check for paused records to stop them.
        const pausedRecords = appState.workRecords.filter(r => r.groupId === groupId && r.status === 'paused');
        if (pausedRecords.length > 0) {
            finalizeStopGroup(groupId, null);
        }
        return;
    }
    finalizeStopGroup(groupId, null);
};

const finalizeStopGroup = (groupId, quantity) => {
    const endTime = getCurrentTime();
    let taskName = '';
    appState.workRecords.forEach(record => {
        if (record.groupId === groupId && (record.status === 'ongoing' || record.status === 'paused')) {
            taskName = record.task;

            if (record.status === 'paused') {
                const lastPause = record.pauses[record.pauses.length - 1];
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
                    totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                }
            });

            const totalDuration = (end - start) / (1000 * 60);
            record.duration = Math.max(0, totalDuration - totalPauseMinutes); // 음수 방지
        }
    });

    if (quantity !== null && taskName) {
        appState.taskQuantities[taskName] = (appState.taskQuantities[taskName] || 0) + quantity;
    }

    if (!(appState.hiddenGroupIds || []).includes(groupId)) {
        if (!appState.hiddenGroupIds) appState.hiddenGroupIds = [];
        appState.hiddenGroupIds.push(groupId);
    }

    saveStateToFirestore();
    quantityOnStopModal.classList.add('hidden');
    groupToStopId = null;
}

const stopWorkIndividual = (recordId) => {
    const endTime = getCurrentTime();
    const record = appState.workRecords.find(r => r.id === recordId);
    if (record && (record.status === 'ongoing' || record.status === 'paused')) {

        if (record.status === 'paused') {
            const lastPause = record.pauses[record.pauses.length - 1];
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
                totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
            }
        });

        const totalDuration = (end - start) / (1000 * 60);
        record.duration = Math.max(0, totalDuration - totalPauseMinutes); // 음수 방지

        saveStateToFirestore();
        showToast(`${record.member}님의 ${record.task} 업무가 종료되었습니다.`);
    }
};

const pauseWorkGroup = (groupId) => {
    const currentTime = getCurrentTime();
    appState.workRecords.forEach(record => {
        if (record.groupId === groupId && record.status === 'ongoing') {
            record.status = 'paused';
            if (!record.pauses) record.pauses = [];
            record.pauses.push({ start: currentTime, end: null });
        }
    });
    saveStateToFirestore();
    showToast('업무가 일시정지 되었습니다.');
};

const resumeWorkGroup = (groupId) => {
    const currentTime = getCurrentTime();
    appState.workRecords.forEach(record => {
        if (record.groupId === groupId && record.status === 'paused') {
            record.status = 'ongoing';
            const lastPause = record.pauses[record.pauses.length - 1];
            if (lastPause && lastPause.end === null) {
                lastPause.end = currentTime;
            }
        }
    });
    saveStateToFirestore();
    showToast('업무를 다시 시작합니다.');
};

// --- Firebase Functions ---
async function fetchAppConfig() {
    // defaultMemberWages를 config.js에서 직접 가져오므로 이 함수는 불필요할 수 있음
    // 필요하다면 Firestore에서 가져오는 로직 유지
    // const configDocRef = doc(db, "artifacts", APP_ID, "config", "wages");
    // try {
    //     const docSnap = await getDoc(configDocRef);
    //     if (docSnap.exists() && Object.keys(docSnap.data()).length > 0) {
    //         appConfig.memberWages = docSnap.data();
    //     } else {
    //         console.warn("Wages configuration not found in Firestore or is empty. Using default values.");
    //         appConfig.memberWages = defaultMemberWages;
    //     }
    // } catch (error) {
    //     console.error("Error fetching config, using default values:", error);
    //     appConfig.memberWages = defaultMemberWages;
    // }
}

async function saveStateToFirestore() {
    if (!auth || !auth.currentUser) return;
    try {
        const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
        await setDoc(docRef, { state: JSON.stringify(appState) });
    } catch (error) {
        console.error("Error saving state to Firestore:", error);
        showToast("데이터 저장 중 오류 발생.", true);
    }
}

async function saveProgress() {
    const dateStr = getTodayDateString();
    showToast(`현재까지 완료된 기록을 저장합니다...`);

    const historyDocRef = doc(db, "artifacts", APP_ID, "history", dateStr);

    try {
        const docSnap = await getDoc(historyDocRef);
        const existingData = docSnap.exists() ? docSnap.data() : { workRecords: [], taskQuantities: {} };

        const completedRecordsFromState = appState.workRecords.filter(r => r.status === 'completed');

        if (completedRecordsFromState.length === 0 && Object.values(appState.taskQuantities || {}).every(q => (parseInt(q,10) || 0) === 0)) {
            return showToast('저장할 새로운 완료 기록이 없습니다.', true);
        }

        const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
        // id를 기준으로 중복 제거 (Map 활용)
        const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());
        // taskQuantities 병합 (기존 값 + 새로운 값)
        const finalQuantities = { ...(existingData.taskQuantities || {}) };
        for (const task in appState.taskQuantities) {
             finalQuantities[task] = (finalQuantities[task] || 0) + (appState.taskQuantities[task] || 0);
        }


        const dataToSave = {
            workRecords: uniqueRecords,
            taskQuantities: finalQuantities,
            onLeaveMembers: appState.onLeaveMembers || []
        };

        await setDoc(historyDocRef, dataToSave);
        // 중간 저장 후에는 현재 앱 상태의 완료 기록과 처리량을 초기화해야 할 수 있음 (선택사항)
        // appState.workRecords = appState.workRecords.filter(r => r.status !== 'completed');
        // taskTypes.forEach(task => { appState.taskQuantities[task] = 0; });
        // await saveStateToFirestore();

        showToast(`현재까지의 기록이 성공적으로 저장되었습니다.`);

    } catch (e) {
        console.error("Error in saveProgress: ", e);
        showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
    }
}

async function saveDayDataToHistory(shouldReset) {
    // 진행 중인 작업 강제 완료
    const ongoingRecords = appState.workRecords.filter(r => r.status === 'ongoing' || r.status === 'paused');
    if (ongoingRecords.length > 0) {
         ongoingRecords.forEach(rec => {
             const endTime = getCurrentTime();
             if (rec.status === 'paused') { // 일시정지 상태에서 마감 시 처리
                 const lastPause = rec.pauses[rec.pauses.length - 1];
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
                     totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
                 }
             });
             const totalDuration = (end - start) / (1000 * 60);
             rec.duration = Math.max(0, totalDuration - totalPauseMinutes);
         });
         // 강제 완료된 기록도 저장해야 하므로 saveState 먼저 호출
         await saveStateToFirestore();
    }

    // 최종 저장 (saveProgress 호출)
    await saveProgress();

    if(shouldReset){
        // 앱 상태 초기화
        appState.workRecords = [];
        appState.taskQuantities = {};
        appState.hiddenGroupIds = [];
        appState.onLeaveMembers = []; // 휴무 멤버도 초기화 (다음 날 자동 리셋)
        // taskQuantities 초기화 (모든 taskTypes에 대해 0으로)
        taskTypes.forEach(task => {
            appState.taskQuantities[task] = 0;
        });

        await saveStateToFirestore();
        showToast(`오늘의 업무 기록을 초기화했습니다.`);
        // 필요시 페이지 새로고침
        // setTimeout(() => location.reload(), 1000);
    }
}

// --- Event Listeners ---
teamStatusBoard.addEventListener('click', (e) => {
    // Priority 1: Specific buttons inside a card
    const stopGroupButton = e.target.closest('.stop-work-group-btn');
    if (stopGroupButton) {
        const groupId = parseFloat(stopGroupButton.dataset.groupId);
        // 처리량 입력 필요한지 확인 (선택적)
        // const groupTask = appState.workRecords.find(r => r.groupId === groupId)?.task;
        // if (groupTask && quantityTaskTypes.includes(groupTask)) { ... }
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
        e.stopPropagation(); // 이벤트 버블링 중단 중요!
        const recordId = parseFloat(individualStopBtn.dataset.recordId);
        const record = appState.workRecords.find(r => r.id === recordId);
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

        const onLeaveIndex = (appState.onLeaveMembers || []).indexOf(memberName);
        if (onLeaveIndex > -1) {
            appState.onLeaveMembers.splice(onLeaveIndex, 1);
            showToast(`${memberName}님의 휴무가 취소되었습니다.`);
        } else {
            if (!appState.onLeaveMembers) appState.onLeaveMembers = [];
            appState.onLeaveMembers.push(memberName);
            showToast(`${memberName}님이 휴무로 설정되었습니다.`);
        }
        saveStateToFirestore();
        return;
    }

    // Priority 3: Fallback to the main card action
    const card = e.target.closest('div[data-action]');
    if (card) {
        // 버튼이나 멤버 목록 내부 클릭 시 무시 (버블링 방지 강화)
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
        const record = appState.workRecords.find(r => r.id === recordId);
        if (!record) return;

        document.getElementById('edit-member-name').value = record.member;

        const taskSelect = document.getElementById('edit-task-type');
        taskSelect.innerHTML = ''; // Clear previous options
        Object.entries(taskGroups).forEach(([groupName, tasks]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = groupName;
            tasks.sort().forEach(task => { // Sort tasks within group
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

        document.getElementById('edit-start-time').value = record.startTime;
        document.getElementById('edit-end-time').value = record.endTime;

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
});

endShiftBtn.addEventListener('click', () => {
    renderQuantityModalInputs(appState.taskQuantities);
    document.getElementById('quantity-modal-title').textContent = "업무 마감 전 처리량 입력";
    document.getElementById('confirm-quantity-btn').textContent = "저장하고 마감";
    document.getElementById('cancel-quantity-btn').textContent = "저장 없이 마감";

    quantityModalContext = {
        mode: 'end-shift',
        onConfirm: (newQuantities) => {
            appState.taskQuantities = newQuantities; // Save final quantities
            saveDayDataToHistory(true); // Save all data and reset
        },
        onCancel: () => {
            saveDayDataToHistory(true); // Save without final quantities and reset
        }
    };
    quantityModal.classList.remove('hidden');
});

saveProgressBtn.addEventListener('click', saveProgress);

openHistoryBtn.addEventListener('click', () => {
    // loadAndRenderHistoryList(); // History 관련 기능은 분리 또는 필요시 구현
    historyModal.classList.remove('hidden');
});

resetAppBtn.addEventListener('click', () => {
    resetAppModal.classList.remove('hidden');
});

confirmResetAppBtn.addEventListener('click', async () => {
    try {
        // Firestore에서 오늘의 데이터 삭제
        const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
        await deleteDoc(docRef);

        // 로컬 앱 상태 초기화 (옵션)
        appState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
        taskTypes.forEach(task => appState.taskQuantities[task] = 0);
        render(); // 빈 상태로 화면 다시 그리기

        showToast('데이터가 초기화되었습니다. 새로고침합니다.');
        setTimeout(() => location.reload(), 1000); // 1초 후 새로고침
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

    const record = appState.workRecords.find(r => r.id === recordToEditId);
    if (!record) return;

    const newStartTime = document.getElementById('edit-start-time').value;
    const newEndTime = document.getElementById('edit-end-time').value;
    const newtask = document.getElementById('edit-task-type').value;
    const newMember = document.getElementById('edit-member-name').value; // 이름도 수정 가능하게 (선택적)

    // 입력값 검증
    if (!newMember || !newtask || !newStartTime || !newEndTime) {
         showToast('모든 필드를 입력해주세요.', true);
         return;
    }
     if (newStartTime >= newEndTime) {
        showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true);
        return;
    }

    record.member = newMember;
    record.startTime = newStartTime;
    record.endTime = newEndTime;
    record.task = newtask;

    const start = new Date(`1970-01-01T${newStartTime}`);
    const end = new Date(`1970-01-01T${newEndTime}`);
    // 수정 시에는 기존 pause 기록을 유지해야 함 (여기서는 단순 계산)
    let totalPauseMinutes = 0;
    (record.pauses || []).forEach(p => {
        if (p.start && p.end) {
             const pauseStart = new Date(`1970-01-01T${p.start}`);
             const pauseEnd = new Date(`1970-01-01T${p.end}`);
             totalPauseMinutes += (pauseEnd - pauseStart) / (1000 * 60);
         }
     });
    const newDuration = (end - start) / (1000 * 60) - totalPauseMinutes;
    record.duration = newDuration > 0 ? newDuration : 0;


    saveStateToFirestore();
    showToast('기록이 수정되었습니다.');
    editRecordModal.classList.add('hidden');
    recordToEditId = null;
});

confirmQuantityOnStopBtn.addEventListener('click', () => {
    const quantity = parseInt(document.getElementById('quantity-on-stop-input').value, 10) || 0;
    finalizeStopGroup(groupToStopId, quantity);
});

cancelQuantityOnStopBtn.addEventListener('click', () => {
    finalizeStopGroup(groupToStopId, null); // 처리량 없이 종료
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
    if (e.target.closest('.modal-close-btn')) {
        taskSelectModal.classList.add('hidden');
    }
});

confirmStopIndividualBtn.addEventListener('click', () => {
    if (recordToStopId !== null) {
        stopWorkIndividual(recordToStopId);
    }
    stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null;
});

cancelStopIndividualBtn.addEventListener('click', () => {
    stopIndividualConfirmModal.classList.add('hidden');
    recordToStopId = null;
});

// 공통 모달 닫기 버튼 이벤트 (data-modal-id 속성 사용)
document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const modalId = e.target.dataset.modalId;
        if (modalId) {
            const modal = document.getElementById(modalId);
            if (modal) {
                modal.classList.add('hidden');
            }
        } else { // 이전 버전 호환 (가장 가까운 모달 닫기)
            e.target.closest('.fixed.inset-0')?.classList.add('hidden');
        }
    });
});

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

// 토글 기능 (모바일 반응형 유지)
[toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
    toggle.addEventListener('click', () => {
        if (window.innerWidth < 768) { // md breakpoint
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            content.classList.toggle('hidden');
            if (content.id === 'summary-content') {
                 content.classList.toggle('grid'); // Summary는 grid 토글
            } else {
                 content.classList.toggle('block'); // 다른건 block 토글
            }
            if(arrow) arrow.classList.toggle('rotate-180');
        }
    });
});

teamSelectModal.addEventListener('click', e => {
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
    }

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
            // 전체 선택 해제
            tempSelectedMembers = tempSelectedMembers.filter(member => !availableMembers.includes(member));
            memberCards.forEach(card => {
                if (!card.disabled) card.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-100');
            });
        } else {
            // 전체 선택
            availableMembers.forEach(member => {
                if (!tempSelectedMembers.includes(member)) {
                    tempSelectedMembers.push(member);
                }
            });
            memberCards.forEach(card => {
                if (!card.disabled) card.classList.add('ring-2', 'ring-blue-500', 'bg-blue-100');
            });
        }
    }

    const addPartTimerBtn = e.target.closest('#add-part-timer-modal-btn');
    if (addPartTimerBtn) {
        if(!appState.partTimers) appState.partTimers = [];
        const newId = Date.now();
        const newName = `알바 ${appState.partTimers.length + 1}`;
        appState.partTimers.push({ id: newId, name: newName });
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState));
    }

    const editPartTimerBtn = e.target.closest('.edit-part-timer-btn');
    if (editPartTimerBtn) {
        const id = parseFloat(editPartTimerBtn.dataset.partTimerId);
        const partTimer = appState.partTimers.find(p => p.id === id);
        if (partTimer) {
            partTimerEditIdInput.value = id;
            partTimerNewNameInput.value = partTimer.name;
            editPartTimerModal.classList.remove('hidden');
        }
    }

    const deletePartTimerBtn = e.target.closest('.delete-part-timer-btn');
    if(deletePartTimerBtn){
        const id = parseFloat(deletePartTimerBtn.dataset.partTimerId);
        appState.partTimers = appState.partTimers.filter(p => p.id !== id);
        saveStateToFirestore().then(() => renderTeamSelectionModalContent(selectedTaskForStart, appState));
    }
});

confirmEditPartTimerBtn.addEventListener('click', () => {
    const id = parseFloat(partTimerEditIdInput.value);
    const partTimer = appState.partTimers.find(p => p.id === id);
    const newName = partTimerNewNameInput.value;

    if (partTimer && newName && newName.trim() !== '' && newName.trim() !== partTimer.name) {
        const newNameTrimmed = newName.trim();
        // 모든 정직원 이름 + 다른 알바 이름과 중복 확인
        const allNames = teamGroups.flatMap(g => g.members)
                             .concat((appState.partTimers || []).filter(p => p.id !== id).map(p => p.name));
        if (allNames.includes(newNameTrimmed)) {
            showToast('해당 이름은 이미 사용 중입니다.', true);
            return;
        }

        const oldName = partTimer.name;
        partTimer.name = newNameTrimmed;

        // 진행중/완료된 기록의 멤버 이름도 변경
        appState.workRecords.forEach(record => {
            if (record.member === oldName) {
                record.member = newNameTrimmed;
            }
        });

        saveStateToFirestore().then(() => {
            renderTeamSelectionModalContent(selectedTaskForStart, appState); // 모달 다시 그리기
            editPartTimerModal.classList.add('hidden');
            showToast('알바 이름이 수정되었습니다.');
        });
    } else if (newName && newName.trim() === '') {
        showToast('알바 이름은 비워둘 수 없습니다.', true);
    } else {
        editPartTimerModal.classList.add('hidden'); // 변경 없으면 그냥 닫기
    }
});

cancelEditPartTimerBtn.addEventListener('click', () => {
    editPartTimerModal.classList.add('hidden');
});

document.getElementById('confirm-team-select-btn').addEventListener('click', () => {
    if (tempSelectedMembers.length === 0) {
        showToast('추가할 팀원을 선택해주세요.', true);
        return;
    }

    if (selectedGroupForAdd !== null) {
        // Add members to existing group
        addMembersToWorkGroup(tempSelectedMembers, selectedTaskForStart, selectedGroupForAdd);
        showToast(`${selectedTaskForStart} 업무에 인원이 추가되었습니다.`);
    } else if (selectedTaskForStart) {
        // Start a new group
        startWorkGroup(tempSelectedMembers, selectedTaskForStart);
        showToast(`${selectedTaskForStart} 업무를 시작합니다.`);
    }

    teamSelectModal.classList.add('hidden');
    tempSelectedMembers = []; // 선택 초기화
    selectedTaskForStart = null;
    selectedGroupForAdd = null; // 초기화
});

document.getElementById('cancel-team-select-btn').addEventListener('click', () => {
    teamSelectModal.classList.add('hidden');
    tempSelectedMembers = []; // 선택 초기화
    selectedTaskForStart = null;
    selectedGroupForAdd = null;
});

// ======[ 수동 추가 모달 이벤트 리스너 추가됨 ]======
openManualAddModalBtn.addEventListener('click', () => {
    // 이름 드롭다운 채우기
    const memberSelect = document.getElementById('manual-member-name');
    memberSelect.innerHTML = '<option value="">-- 이름 선택 --</option>'; // 기본 옵션
    const allMembers = teamGroups.flatMap(g => g.members);
    (appState.partTimers || []).forEach(pt => allMembers.push(pt.name));
    [...new Set(allMembers)].sort().forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        option.textContent = member;
        memberSelect.appendChild(option);
    });

    // 업무 드롭다운 채우기
    const taskSelect = document.getElementById('manual-task-type');
    taskSelect.innerHTML = '<option value="">-- 업무 선택 --</option>'; // 기본 옵션
    Object.entries(taskGroups).forEach(([groupName, tasks]) => {
        const optgroup = document.createElement('optgroup');
        optgroup.label = groupName;
        tasks.sort().forEach(task => {
            const option = document.createElement('option');
            option.value = task;
            option.textContent = task;
            optgroup.appendChild(option);
        });
        taskSelect.appendChild(optgroup);
    });

    document.getElementById('manual-start-time').value = '';
    document.getElementById('manual-end-time').value = '';

    manualAddModal.classList.remove('hidden');
});

confirmManualAddBtn.addEventListener('click', () => {
    const member = document.getElementById('manual-member-name').value;
    const task = document.getElementById('manual-task-type').value;
    const startTime = document.getElementById('manual-start-time').value;
    const endTime = document.getElementById('manual-end-time').value;

    if (!member || !task || !startTime || !endTime) {
        showToast('모든 필드를 입력해주세요.', true);
        return;
    }
    if (startTime >= endTime) {
        showToast('종료 시간은 시작 시간보다 늦어야 합니다.', true);
        return;
    }

    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const duration = (end - start) / (1000 * 60);

    if (duration <= 0 || isNaN(duration)) {
        showToast('유효한 시간을 입력해주세요.', true);
        return;
    }

    const newRecord = {
        id: Date.now() + Math.random(),
        member: member,
        task: task,
        startTime: startTime,
        endTime: endTime,
        duration: duration,
        status: 'completed',
        groupId: `manual-${Date.now()}`,
        pauses: []
    };

    appState.workRecords.push(newRecord);
    saveStateToFirestore();

    showToast('업무 기록이 수동으로 추가되었습니다.');
    manualAddModal.classList.add('hidden');
});

cancelManualAddBtn.addEventListener('click', () => {
    manualAddModal.classList.add('hidden');
});

const manualAddModalCloseBtn = manualAddModal.querySelector('.modal-close-btn[data-modal-id="manual-add-modal"]');
if (manualAddModalCloseBtn) {
    manualAddModalCloseBtn.addEventListener('click', () => {
        manualAddModal.classList.add('hidden');
    });
}
// ====================================

// --- App Initialization ---
function main() {
    renderTaskSelectionModal();
    displayCurrentDate();

    // 초기 상태 설정
    const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
    taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);
    appState = defaultState;
    // render(); // <--- 초기 렌더링 호출 제거 (깜빡임 방지)

    connectionStatusEl.textContent = '연결 중...';
    statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

    if (!firebaseConfig.apiKey || firebaseConfig.apiKey === "YOUR_API_KEY") { // API 키 유효성 검사 강화
        connectionStatusEl.textContent = "설정 필요";
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        showToast("Firebase 구성 정보가 올바르지 않습니다.", true);
        return;
    }

    try {
        const app = initializeApp(firebaseConfig);
        db = getFirestore(app);
        auth = getAuth(app);
    } catch (error) {
         console.error("Firebase 초기화 실패:", error);
         showToast("Firebase 초기화에 실패했습니다. 설정을 확인하세요.", true);
         connectionStatusEl.textContent = '초기화 실패';
         statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
         return;
    }

    onAuthStateChanged(auth, async user => {
        if (user) {
            // await fetchAppConfig(); // 필요 시 활성화

            const todayDocRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
            if (unsubscribeToday) unsubscribeToday(); // 이전 리스너 해제

            unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
                const loadedState = docSnap.exists() ? JSON.parse(docSnap.data().state || '{}') : {};

                // 기본 상태와 병합 (누락된 속성 방지)
                appState = {
                    ...defaultState, // 기본 구조 보장
                    ...loadedState, // Firestore 데이터 덮어쓰기
                    // 각 속성별 기본값 보장 (Firestore 데이터에 누락된 경우)
                    workRecords: loadedState.workRecords || [],
                    taskQuantities: loadedState.taskQuantities || defaultState.taskQuantities,
                    onLeaveMembers: loadedState.onLeaveMembers || [],
                    partTimers: loadedState.partTimers || [],
                    hiddenGroupIds: loadedState.hiddenGroupIds || []
                 };

                render(); // 데이터 로드/병합 후 최종 렌더링
                connectionStatusEl.textContent = '동기화';
                statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
            }, (error) => {
                console.error("Firebase onSnapshot error:", error);
                showToast("실시간 연결에 실패했습니다.", true);
                connectionStatusEl.textContent = '연결 오류';
                statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
                 // 오류 발생 시 기본 상태로 렌더링 (선택적)
                 appState = defaultState;
                 render();
            });
        } else {
             // 로그아웃 상태 처리 (인증 기능 추가 시)
             console.log("로그아웃 상태 또는 인증 대기 중");
             connectionStatusEl.textContent = '인증 대기 중';
             statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500';
             if (unsubscribeToday) unsubscribeToday();
        }
    });

    // 익명 로그인 시도
    signInAnonymously(auth).catch(error => {
        console.error("Anonymous sign-in failed:", error);
        showToast("인증에 실패했습니다. Firebase 설정을 확인하세요.", true);
        connectionStatusEl.textContent = '인증 실패';
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    });
}

main();