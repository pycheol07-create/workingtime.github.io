// === admin.js (업무 이름 일괄 변경 기능 추가) ===

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';

let db;
let appConfig = {};
const ADMIN_PASSWORD = "anffbxla123";

// ✅ [이름 변경] 초기 업무 그룹 상태를 저장할 변수
let initialTaskGroups = {};

// 드래그 상태 관리 변수
let draggedItem = null;

// ... (getDragAfterElement 함수는 이전과 동일) ...
function getDragAfterElement(container, y, itemSelector) {
    const draggableElements = [...container.querySelectorAll(`${itemSelector}:not(.dragging)`)];

    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}


document.addEventListener('DOMContentLoaded', () => {
    // ... (비밀번호 관련 코드는 동일) ...
    const passwordPrompt = document.getElementById('password-prompt');
    const passwordInput = document.getElementById('admin-password');
    const passwordSubmitBtn = document.getElementById('password-submit-btn');
    const adminContent = document.getElementById('admin-content');

    const attemptLogin = () => {
        if (passwordInput.value === ADMIN_PASSWORD) {
            passwordPrompt.classList.add('hidden');
            adminContent.classList.remove('hidden');
            initializeApp();
        } else {
            alert('비밀번호가 틀렸습니다.');
            passwordInput.value = '';
        }
    };

    passwordSubmitBtn.addEventListener('click', attemptLogin);
    passwordInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    const initializeApp = async () => {
        try {
            db = initializeFirebase().db;
            appConfig = await loadAppConfig(db);
            // 기본값 보장
            if (!appConfig.keyTasks) appConfig.keyTasks = ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
            if (!appConfig.quantityTaskTypes) appConfig.quantityTaskTypes = [];
            if (!appConfig.teamGroups) appConfig.teamGroups = [];
            if (!appConfig.taskGroups) appConfig.taskGroups = {};

            // ✅ [이름 변경] 초기 업무 그룹 상태 저장 (Deep copy)
            initialTaskGroups = JSON.parse(JSON.stringify(appConfig.taskGroups));

            renderAdminUI(appConfig);
            setupEventListeners();
        } catch (e) {
            console.error("초기화 실패:", e);
            alert("앱 초기화에 실패했습니다. 콘솔을 확인하세요.");
        }
    };
});

// --- UI 렌더링 ---
// ... (renderAdminUI, renderTeamGroups, renderKeyTasks, renderTaskGroups, renderQuantityTasks 함수는 이전과 동일) ...
function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    renderTeamGroups(config.teamGroups || [], config.memberWages || {});
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || {});
    renderQuantityTasks(config.quantityTaskTypes || []);
}

function renderTeamGroups(teamGroups, memberWages) {
    const container = document.getElementById('team-groups-container');
    container.innerHTML = '';
    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
        groupEl.dataset.index = index;

        const membersHtml = group.members.map((member, mIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item">
                <span class="drag-handle" draggable="true">☰</span>
                <input type="text" value="${member}" class="member-name" placeholder="팀원 이름">
                <label class="text-sm whitespace-nowrap">시급:</label>
                <input type="number" value="${memberWages[member] || 0}" class="member-wage w-28" placeholder="시급">
                <button class="btn btn-danger btn-small delete-member-btn" data-m-index="${mIndex}">삭제</button>
            </div>
        `).join(''); 

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center">
                    <span class="drag-handle" draggable="true">☰</span> 
                    <input type="text" value="${group.name}" class="text-lg font-semibold team-group-name w-auto">
                </div>
                <button class="btn btn-danger btn-small delete-team-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 members-container">${membersHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-member-btn">+ 팀원 추가</button>
        `; 
        container.appendChild(groupEl);
    });
}

function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    container.innerHTML = '';
    keyTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 key-task-item';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> <input type="text" value="${task}" class="key-task-name flex-grow">
            <button class="btn btn-danger btn-small delete-key-task-btn" data-index="${index}">삭제</button>
        `; 
        container.appendChild(taskEl);
    });
}


function renderTaskGroups(taskGroups) {
    const container = document.getElementById('task-groups-container');
    container.innerHTML = '';
    const groupNames = Object.keys(taskGroups);

    groupNames.forEach((groupName, index) => {
        const tasks = taskGroups[groupName] || [];
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;

        const tasksHtml = tasks.map((task, tIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item">
                <span class="drag-handle" draggable="true">☰</span>
                <input type="text" value="${task}" class="task-name flex-grow">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join(''); 

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-4">
                <div class="flex items-center"> 
                   <span class="drag-handle" draggable="true">☰</span>
                   <input type="text" value="${groupName}" class="text-lg font-semibold task-group-name w-auto">
                 </div>
                <button class="btn btn-danger btn-small delete-task-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 tasks-container">${tasksHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-task-btn">+ 업무 추가</button>
        `; 
        container.appendChild(groupEl);
    });
}

function renderQuantityTasks(quantityTasks) {
    const container = document.getElementById('quantity-tasks-container');
    container.innerHTML = '';
    quantityTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 quantity-task-item';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> <input type="text" value="${task}" class="quantity-task-name flex-grow">
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `; 
        container.appendChild(taskEl);
    });
}


// --- 이벤트 리스너 설정 ---
// ... (setupEventListeners, addTeamGroup, addKeyTask, addTaskGroup, addQuantityTask, handleDynamicClicks, setupDragDropListeners 함수는 이전과 동일) ...
function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
    document.getElementById('add-team-group-btn').addEventListener('click', addTeamGroup);
    document.getElementById('add-key-task-btn').addEventListener('click', addKeyTask);
    document.getElementById('add-task-group-btn').addEventListener('click', addTaskGroup);
    document.getElementById('add-quantity-task-btn').addEventListener('click', addQuantityTask);

    document.body.addEventListener('click', handleDynamicClicks);

    setupDragDropListeners('#team-groups-container', '.team-group-card'); // 1. 팀 그룹 (카드)
    setupDragDropListeners('.members-container', '.member-item'); // 2. 팀원 (항목)
    
    setupDragDropListeners('#key-tasks-container', '.key-task-item'); // 3. 주요 업무 (항목)
    
    setupDragDropListeners('#task-groups-container', '.task-group-card'); // 4. 업무 그룹 (카드)
    setupDragDropListeners('.tasks-container', '.task-item'); // 5. 업무 (항목)

    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item'); // 6. 처리량 업무 (항목)
}

function addTeamGroup() {
    const newGroup = { name: '새 그룹', members: ['새 팀원'] };
    appConfig.teamGroups = appConfig.teamGroups || [];
    appConfig.teamGroups.push(newGroup);
    if (!appConfig.memberWages) appConfig.memberWages = {};
    appConfig.memberWages['새 팀원'] = appConfig.defaultPartTimerWage || 10000;
    
    renderTeamGroups(appConfig.teamGroups, appConfig.memberWages);
    setupDragDropListeners('.members-container', '.member-item'); 
}

function addKeyTask() {
    appConfig.keyTasks = appConfig.keyTasks || [];
    appConfig.keyTasks.push('새 주요 업무');
    renderKeyTasks(appConfig.keyTasks);
}

function addTaskGroup() {
    const newGroupName = `새 업무 그룹 ${Object.keys(appConfig.taskGroups || {}).length + 1}`;
    if (!appConfig.taskGroups) appConfig.taskGroups = {};
    appConfig.taskGroups[newGroupName] = ['새 업무'];
    
    renderTaskGroups(appConfig.taskGroups);
    setupDragDropListeners('.tasks-container', '.task-item');
}

function addQuantityTask() {
    appConfig.quantityTaskTypes = appConfig.quantityTaskTypes || [];
    appConfig.quantityTaskTypes.push('새 처리량 업무');
    renderQuantityTasks(appConfig.quantityTaskTypes);
}

function handleDynamicClicks(e) {
    // 팀원 추가/삭제, 팀 그룹 삭제
    if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item';
        newMemberEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 팀원" class="member-name" placeholder="팀원 이름">
            <label class="text-sm whitespace-nowrap">시급:</label>
            <input type="number" value="${appConfig.defaultPartTimerWage || 10000}" class="member-wage w-28" placeholder="시급">
            <button class="btn btn-danger btn-small delete-member-btn">삭제</button>
        `; 
        container.appendChild(newMemberEl);
    } else if (e.target.classList.contains('delete-member-btn')) {
        e.target.closest('.member-item').remove();
    } else if (e.target.classList.contains('delete-team-group-btn')) {
        e.target.closest('.team-group-card').remove();
    }
    // 주요 업무 삭제
    else if (e.target.classList.contains('delete-key-task-btn')) {
        e.target.closest('.key-task-item').remove();
    }
    // 업무 추가/삭제, 업무 그룹 삭제
    else if (e.target.classList.contains('add-task-btn')) {
        const container = e.target.previousElementSibling;
        const newTaskEl = document.createElement('div');
        newTaskEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item';
        newTaskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 업무" class="task-name flex-grow">
            <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
        `; 
        container.appendChild(newTaskEl);
    } else if (e.target.classList.contains('delete-task-btn')) {
        e.target.closest('.task-item').remove();
    } else if (e.target.classList.contains('delete-task-group-btn')) {
        e.target.closest('.task-group-card').remove();
    }
    // 처리량 업무 삭제
    else if (e.target.classList.contains('delete-quantity-task-btn')) {
        e.target.closest('.quantity-task-item').remove();
    }
}


function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    if (containers.length === 0) return;

    containers.forEach(container => {
        const listenerId = `drag-${itemSelector.replace('.', '')}`;
        if (container.dataset.dragListenersAttached?.includes(listenerId)) {
            return;
        }
        container.dataset.dragListenersAttached = (container.dataset.dragListenersAttached || '') + listenerId;

        container.addEventListener('dragstart', (e) => {
            if (!e.target.classList.contains('drag-handle')) {
                e.preventDefault(); 
                return;
            }
            const item = e.target.closest(itemSelector); 
            if (!item || item.parentElement !== container) return;
            
            e.stopPropagation();
            draggedItem = item;
            setTimeout(() => draggedItem.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
        });

        container.addEventListener('dragend', (e) => {
            if (!draggedItem || draggedItem.parentElement !== container) return;
            e.stopPropagation();
            draggedItem.classList.remove('dragging');
            draggedItem = null;
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault(); 
            if (!draggedItem || draggedItem.parentElement !== container) return;
            e.stopPropagation(); 
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            if (afterElement) {
                afterElement.classList.add('drag-over');
            }
        });

         container.addEventListener('dragleave', (e) => {
             if (!draggedItem || draggedItem.parentElement !== container) return;
             e.stopPropagation(); 
             container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
         });

        container.addEventListener('drop', (e) => {
            e.preventDefault(); 
            if (!draggedItem || draggedItem.parentElement !== container) return;
            e.stopPropagation(); 
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            if (afterElement) {
                container.insertBefore(draggedItem, afterElement);
            } else {
                container.appendChild(draggedItem);
            }
        });
    }); 
}


// --- 데이터 저장 ---
// [수정] handleSaveAll: 업무 이름 변경 감지 및 일괄 적용 로직 추가
async function handleSaveAll() {
    try {
        const newConfig = {
            teamGroups: [],
            memberWages: {},
            keyTasks: [], 
            taskGroups: {},
            quantityTaskTypes: [],
            defaultPartTimerWage: 10000
        };

        // 1. 팀원 및 시급 정보 읽기 (순서 반영)
        document.querySelectorAll('#team-groups-container .team-group-card').forEach(groupCard => {
            const groupName = groupCard.querySelector('.team-group-name').value.trim();
            if (!groupName) return;
            const newGroup = { name: groupName, members: [] };
            groupCard.querySelectorAll('.member-item').forEach(memberItem => {
                const memberName = memberItem.querySelector('.member-name').value.trim();
                const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
                if (!memberName) return;
                newGroup.members.push(memberName);
                newConfig.memberWages[memberName] = memberWage;
            });
            newConfig.teamGroups.push(newGroup);
        });

        // 2. 주요 업무 정보 읽기 (순서 반영) - 이름 변경 전 원본 읽기
        const originalKeyTasks = [];
        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
             const taskName = item.querySelector('.key-task-name').value.trim();
             if (taskName) originalKeyTasks.push(taskName);
        });
        newConfig.keyTasks = [...originalKeyTasks]; // 복사


        // 3. 업무 정보 읽기 (순서 반영)
        const orderedTaskGroups = {};
        // ✅ [이름 변경] 이름 변경 매핑 생성
        const taskNameChangeMap = new Map();

        document.querySelectorAll('#task-groups-container .task-group-card').forEach((groupCard, groupIndex) => {
            const groupNameInput = groupCard.querySelector('.task-group-name');
            const groupName = groupNameInput ? groupNameInput.value.trim() : '';
            if (!groupName) return;

            const tasks = [];
            
            // 초기 상태의 그룹 이름 찾기 (순서 기반)
            const initialGroupName = Object.keys(initialTaskGroups)[groupIndex];
            const initialTasksInGroup = initialTaskGroups[initialGroupName] || [];

            groupCard.querySelectorAll('.task-item').forEach((taskItem, taskIndex) => {
                const taskName = taskItem.querySelector('.task-name').value.trim();
                if (taskName) {
                    tasks.push(taskName);
                    // 초기 상태의 업무 이름 가져오기
                    const initialTaskName = initialTasksInGroup[taskIndex]; 
                    if (initialTaskName && initialTaskName !== taskName) {
                         // 이름이 변경되었으면 매핑에 추가
                        taskNameChangeMap.set(initialTaskName, taskName);
                        console.log(`Task name changed: ${initialTaskName} -> ${taskName}`);
                    }
                }
            });
             orderedTaskGroups[groupName] = tasks;
        });
        newConfig.taskGroups = orderedTaskGroups;


        // 4. 처리량 업무 정보 읽기 (순서 반영) - 이름 변경 전 원본 읽기
        const originalQuantityTasks = [];
        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            const taskName = item.querySelector('.quantity-task-name').value.trim();
            if (taskName) originalQuantityTasks.push(taskName);
        });
        newConfig.quantityTaskTypes = [...originalQuantityTasks]; // 복사


        // ✅ [이름 변경] keyTasks와 quantityTaskTypes에 이름 변경 적용
        if (taskNameChangeMap.size > 0) {
            newConfig.keyTasks = newConfig.keyTasks.map(task => taskNameChangeMap.get(task) || task);
            newConfig.quantityTaskTypes = newConfig.quantityTaskTypes.map(task => taskNameChangeMap.get(task) || task);
            console.log("Applied task name changes to keyTasks and quantityTaskTypes.");
        }


        // 5. 전역 설정 (알바 시급) 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // 6. Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        
        // ✅ [이름 변경] 초기 상태 업데이트
        initialTaskGroups = JSON.parse(JSON.stringify(appConfig.taskGroups)); 

        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        // 7. UI 다시 렌더링 (리스너 재설정 포함)
        renderAdminUI(appConfig);
        setupEventListeners(); // 렌더링 후 리스너 재설정


    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}