import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, setDoc, onSnapshot, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { firebaseConfig, teamGroups, taskGroups, taskTypes } from './config.js';
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
let elapsedTimeTimer = null;
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
            record.duration = totalDuration - totalPauseMinutes;
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
        record.duration = totalDuration - totalPauseMinutes;
        
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
    const configDocRef = doc(db, "artifacts", APP_ID, "config", "wages");
    try {
        const docSnap = await getDoc(configDocRef);
        if (docSnap.exists() && Object.keys(docSnap.data()).length > 0) {
            appConfig.memberWages = docSnap.data();
        } else {
            console.warn("Wages configuration not found in Firestore or is empty. Using default values.");
            appConfig.memberWages = defaultMemberWages; 
        }
    } catch (error) {
        console.error("Error fetching config, using default values:", error);
        appConfig.memberWages = defaultMemberWages;
    }
}

async function saveStateToFirestore() {
    if (!auth || !auth.currentUser) return;
    const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
    await setDoc(docRef, { state: JSON.stringify(appState) });
}

async function saveProgress() {
    const dateStr = getTodayDateString();
    showToast(`현재까지 완료된 기록을 저장합니다...`);

    const historyDocRef = doc(db, "artifacts", APP_ID, "history", dateStr);

    try {
        const docSnap = await getDoc(historyDocRef);
        const existingData = docSnap.exists() ? docSnap.data() : { workRecords: [], taskQuantities: {} };

        const completedRecordsFromState = appState.workRecords.filter(r => r.status === 'completed');
        
        if (completedRecordsFromState.length === 0 && Object.values(appState.taskQuantities).every(q => (parseInt(q,10) || 0) === 0)) {
            return showToast('저장할 새로운 완료 기록이 없습니다.', true);
        }

        const combinedRecords = [...(existingData.workRecords || []), ...completedRecordsFromState];
        const uniqueRecords = Array.from(new Map(combinedRecords.map(item => [item.id, item])).values());
        const finalQuantities = { ...(existingData.taskQuantities || {}), ...appState.taskQuantities };

        const dataToSave = {
            workRecords: uniqueRecords,
            taskQuantities: finalQuantities,
            onLeaveMembers: appState.onLeaveMembers || []
        };

        await setDoc(historyDocRef, dataToSave);
        showToast(`현재까지의 기록이 성공적으로 저장되었습니다.`);

    } catch (e) {
        console.error("Error in saveProgress: ", e);
        showToast(`중간 저장 중 오류가 발생했습니다: ${e.message}`, true);
    }
}

async function saveDayDataToHistory(shouldReset) {
    await saveProgress(); 
    const ongoingRecords = appState.workRecords.filter(r => r.status === 'ongoing');
    if (ongoingRecords.length > 0) {
         ongoingRecords.forEach(rec => {
             const endTime = getCurrentTime();
             rec.status = 'completed';
             rec.endTime = endTime;
             const start = new Date(`1970-01-01T${rec.startTime}`);
             const end = new Date(`1970-01-01T${endTime}`);
             rec.duration = (end - start) / (1000 * 60);
         });
         await saveProgress();
    }

    if(shouldReset){
        appState.workRecords = [];
        appState.taskQuantities = {};
        appState.hiddenGroupIds = [];
        taskTypes.forEach(task => {
            appState.taskQuantities[task] = 0;
        });
        
        await saveStateToFirestore();
        showToast(`오늘의 업무 기록을 초기화했습니다.`);
    }
}

// --- Event Listeners ---
teamStatusBoard.addEventListener('click', (e) => {
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

    // Priority 3: Fallback to the main card action, only if the click was not on an interactive element within it.
    const card = e.target.closest('div[data-action]');
    if (card) {
        // If the click was on any button or inside the members list, ignore it.
        if (e.target.closest('button') || e.target.closest('.members-list')) {
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
        taskSelect.innerHTML = '';
        Object.entries(taskGroups).forEach(([groupName, tasks]) => {
            const optgroup = document.createElement('optgroup');
            optgroup.label = groupName;
            tasks.forEach(task => {
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
openHistoryBtn.addEventListener('click', () => {
    // loadAndRenderHistoryList();
    historyModal.classList.remove('hidden');
});

resetAppBtn.addEventListener('click', () => {
    resetAppModal.classList.remove('hidden');
});

confirmResetAppBtn.addEventListener('click', async () => {
    try {
        const docRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
        await deleteDoc(docRef);
        showToast('데이터가 초기화되었습니다. 새로고침합니다.');
        setTimeout(() => location.reload(), 1000);
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

    record.startTime = newStartTime;
    record.endTime = newEndTime;
    record.task = newtask;

    if (newStartTime && newEndTime) {
        const start = new Date(`1970-01-01T${newStartTime}`);
        const end = new Date(`1970-01-01T${newEndTime}`);
        const newDuration = (end - start) / (1000 * 60);
        record.duration = newDuration > 0 ? newDuration : 0;
    } else {
        record.duration = 0;
    }

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
    finalizeStopGroup(groupToStopId, null);
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

document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.target.closest('.fixed').classList.add('hidden');
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

[toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
    toggle.addEventListener('click', () => {
        if (window.innerWidth < 768) {
            const content = toggle.nextElementSibling;
            const arrow = toggle.querySelector('svg');
            content.classList.toggle('hidden');
            if (content.id === 'summary-content') content.classList.toggle('grid');
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
        const allNames = teamGroups.flatMap(g => g.members).concat((appState.partTimers || []).filter(p => p.id !== id).map(p => p.name));
        if (allNames.includes(newNameTrimmed)) {
            showToast('해당 이름은 이미 사용 중입니다.', true);
            return;
        }
        
        const oldName = partTimer.name;
        partTimer.name = newNameTrimmed;

        appState.workRecords.forEach(record => {
            if (record.member === oldName) {
                record.member = newNameTrimmed;
            }
        });
        
        saveStateToFirestore().then(() => {
            renderTeamSelectionModalContent(selectedTaskForStart, appState);
            editPartTimerModal.classList.add('hidden');
            showToast('알바 이름이 수정되었습니다.');
        });
    } else {
        editPartTimerModal.classList.add('hidden'); // Close if no changes or empty name
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
    tempSelectedMembers = [];
    selectedTaskForStart = null;
    selectedGroupForAdd = null; // Reset this
});

document.getElementById('cancel-team-select-btn').addEventListener('click', () => {
    teamSelectModal.classList.add('hidden');
    tempSelectedMembers = [];
    selectedTaskForStart = null;
    selectedGroupForAdd = null;
});

// --- App Initialization ---
function main() {
    renderTaskSelectionModal();
    displayCurrentDate();
    
    const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
    taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);
    appState = defaultState;

    connectionStatusEl.textContent = '연결 중...';
    statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-yellow-500 animate-pulse';

    if (firebaseConfig.apiKey === "YOUR_API_KEY") {
        connectionStatusEl.textContent = "설정 필요";
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        showToast("프로그램 코드에 Firebase 구성 정보를 입력해주세요.", true);
        return;
    }

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    
    onAuthStateChanged(auth, async user => {
        if (user) {
            // await fetchAppConfig();

            const todayDocRef = doc(db, "artifacts", APP_ID, "daily_data", getTodayDateString());
            if (unsubscribeToday) unsubscribeToday();
            unsubscribeToday = onSnapshot(todayDocRef, (docSnap) => {
                const defaultState = { workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [], hiddenGroupIds: [] };
                taskTypes.forEach(task => defaultState.taskQuantities[task] = 0);
                
                if (docSnap.exists()) {
                    try {
                        const remoteState = JSON.parse(docSnap.data().state);
                        appState = { ...defaultState, ...remoteState };
                        if (!appState.workRecords) appState.workRecords = [];
                        if (!appState.taskQuantities) appState.taskQuantities = defaultState.taskQuantities;
                        if (!appState.onLeaveMembers) appState.onLeaveMembers = [];
                        if (!appState.partTimers) appState.partTimers = [];
                        if (!appState.hiddenGroupIds) appState.hiddenGroupIds = [];
                    } catch (e) {
                        console.error("Error parsing state from Firestore:", e);
                        appState = defaultState;
                    }
                } else {
                    appState = defaultState;
                }
                render();
                connectionStatusEl.textContent = '동기화';
                statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
            }, (error) => {
                console.error("Firebase onSnapshot error:", error);
                showToast("실시간 연결에 실패했습니다. 보안 규칙을 확인하세요.", true);
                connectionStatusEl.textContent = '연결 오류';
                statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
            });
        }
    });
    
    signInAnonymously(auth).catch(error => {
        console.error("Anonymous sign-in failed:", error);
        showToast("인증에 실패했습니다. Firebase 설정을 확인하세요.", true);
        connectionStatusEl.textContent = '인증 실패';
        statusDotEl.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
    });
}

main();
