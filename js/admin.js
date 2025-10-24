// === admin.js (모달 추가 및 로직 수정) ===

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';

let db;
let appConfig = {};
const ADMIN_PASSWORD = "anffbxla123";

// ✅ [추가] 현황판 아이템 정의
const DASHBOARD_ITEM_DEFINITIONS = {
    'total-staff': { title: '총원 (직원/알바)' },
    'leave-staff': { title: '휴무' },
    'active-staff': { title: '근무 (직원/알바)' },
    'working-staff': { title: '업무중' },
    'idle-staff': { title: '대기' },
    'ongoing-tasks': { title: '진행업무' },
    'total-work-time': { title: '업무진행시간' }
};

// 드래그 상태 관리 변수
let draggedItem = null;

// [추가] 모달 상태 관리 변수
let currentModalTarget = null; // 'key' 또는 'quantity'
let taskJustAdded = null; // '업무 관리'에서 방금 추가한 업무 이름

// [추가] 드롭 위치를 계산하는 헬퍼 함수 (이전과 동일)
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

// [추가] '업무 관리' 섹션에서 모든 업무 이름 가져오기
function getAllTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#task-groups-container .task-name').forEach(input => {
        const taskName = input.value.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

// [추가] '처리량 집계 업무 관리' 섹션에서 모든 업무 이름 가져오기
function getAllQuantityTaskNamesFromDOM() {
    const taskNames = new Set();
    // ✅ [수정] '.quantity-task-name'이 input이 아닌 span이므로 textContent로 읽도록 변경 (하지만 이 함수는 현재 사용되지 않음 - getAllTaskNamesFromDOM()을 사용)
    // 이 함수는 현재 로직(admin.js)에서 직접 호출되지는 않지만, 만약을 위해 textContent로 수정합니다.
    document.querySelectorAll('#quantity-tasks-container .quantity-task-name').forEach(item => {
        const taskName = item.textContent.trim(); // .value -> .textContent
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

// [추가] '업무 선택' 모달 내용 채우기
function populateTaskSelectModal() {
    const allTasks = getAllTaskNamesFromDOM();
    const listContainer = document.getElementById('select-task-list');
    const modalTitle = document.getElementById('select-task-modal-title');
    
    if (!listContainer || !modalTitle) return;
    
    listContainer.innerHTML = ''; // 초기화
    
    if (currentModalTarget === 'key') {
        modalTitle.textContent = "주요 업무로 추가할 업무 선택";
    } else if (currentModalTarget === 'quantity') {
        modalTitle.textContent = "처리량 집계 업무로 추가할 업무 선택";
    }

    if (allTasks.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 col-span-full text-center">먼저 \'업무 관리\' 섹션에서 업무를 1개 이상 등록해주세요.</p>';
        return;
    }

    allTasks.sort((a, b) => a.localeCompare(b)).forEach(taskName => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-select-list-btn w-full text-left p-2 rounded-md border btn-secondary focus:ring-2 focus:ring-blue-300';
        button.textContent = taskName;
        button.dataset.taskName = taskName;
        listContainer.appendChild(button);
    });
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

            renderAdminUI(appConfig);
            setupEventListeners();
        } catch (e) {
            console.error("초기화 실패:", e);
            alert("앱 초기화에 실패했습니다. 콘솔을 확인하세요.");
        }
    };
});

// --- UI 렌더링 ---
// (renderAdminUI, renderTeamGroups 함수는 이전과 동일)
function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    renderTeamGroups(config.teamGroups || [], config.memberWages || {});
    renderDashboardItemsConfig(config.dashboardItems || []); // ✅ [추가]
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || {});
    renderQuantityTasks(config.quantityTaskTypes || []);
}

function renderTeamGroups(teamGroups, memberWages) {
    const container = document.getElementById('team-groups-container');
    container.innerHTML = '';
    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        // [수정] groupEl에서 draggable="true" 제거
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
        groupEl.dataset.index = index;
        // groupEl.draggable = true; // [제거]

        const membersHtml = group.members.map((member, mIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item">
                <span class="drag-handle" draggable="true">☰</span>
                <input type="text" value="${member}" class="member-name" placeholder="팀원 이름">
                <label class="text-sm whitespace-nowrap">시급:</label>
                <input type="number" value="${memberWages[member] || 0}" class="member-wage w-28" placeholder="시급">
                <button class="btn btn-danger btn-small delete-member-btn" data-m-index="${mIndex}">삭제</button>
            </div>
        `).join(''); // [수정] member-item에서 draggable="true" 제거, handle에 draggable="true" 추가

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
        `; // [수정] group-card의 handle에 draggable="true" 추가
        container.appendChild(groupEl);
    });
}

// ✅ [추가] 현황판 항목 설정 렌더링 함수
function renderDashboardItemsConfig(itemIds) {
    const container = document.getElementById('dashboard-items-container');
    container.innerHTML = '';
    itemIds.forEach((id, index) => {
        const itemDef = DASHBOARD_ITEM_DEFINITIONS[id];
        if (!itemDef) return;
        const itemEl = document.createElement('div');
        itemEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 dashboard-item-config';
        itemEl.dataset.index = index;
        itemEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="dashboard-item-name flex-grow p-2 bg-gray-100 rounded" data-id="${id}">${itemDef.title}</span>
            <button class="btn btn-danger btn-small delete-dashboard-item-btn" data-id="${id}">삭제</button>
        `;
        container.appendChild(itemEl);
    });
}

// ✅ [수정] renderKeyTasks 함수: input을 span으로 변경
function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    container.innerHTML = '';
    keyTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        // [수정] key-task-item에서 draggable="true" 제거
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 key-task-item';
        taskEl.dataset.index = index;
        // taskEl.draggable = true; // [제거]
        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="key-task-name flex-grow p-2 bg-gray-100 rounded">${task}</span>
            <button class="btn btn-danger btn-small delete-key-task-btn" data-index="${index}">삭제</button>
        `; // [수정] handle에 draggable="true" 추가 및 input을 span으로 변경
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
        // [수정] task-group-card에서 draggable="true" 제거
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;
        // groupEl.draggable = true; // [제거]

        const tasksHtml = tasks.map((task, tIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item">
                <span class="drag-handle" draggable="true">☰</span>
                <input type="text" value="${task}" class="task-name flex-grow">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join(''); // [수정] task-item에서 draggable="true" 제거, handle에 draggable="true" 추가

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
        `; // [수정] group-card의 handle에 draggable="true" 추가
        container.appendChild(groupEl);
    });
}

// ✅ [수정] renderQuantityTasks 함수: input을 span으로 변경
function renderQuantityTasks(quantityTasks) {
    const container = document.getElementById('quantity-tasks-container');
    container.innerHTML = '';
    quantityTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        // [수정] quantity-task-item에서 draggable="true" 제거
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 quantity-task-item';
        taskEl.dataset.index = index;
        // taskEl.draggable = true; // [제거]
        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="quantity-task-name flex-grow p-2 bg-gray-100 rounded">${task}</span>
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `; // [수정] handle에 draggable="true" 추가 및 input을 span으로 변경
        container.appendChild(taskEl);
    });
}


// --- 이벤트 리스너 설정 ---

// [수정] 이벤트 리스너 설정 함수
function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
    document.getElementById('add-team-group-btn').addEventListener('click', addTeamGroup);
    
    // ✅ [추가] 현황판 항목 추가 버튼 리스너
    document.getElementById('add-dashboard-item-btn').addEventListener('click', openDashboardItemModal);

    // [수정] '주요 업무 추가' 버튼 리스너
    document.getElementById('add-key-task-btn').addEventListener('click', () => {
        currentModalTarget = 'key';
        populateTaskSelectModal();
        document.getElementById('select-task-modal').classList.remove('hidden');
    });

    document.getElementById('add-task-group-btn').addEventListener('click', addTaskGroup);

    // [수정] '처리량 업무 추가' 버튼 리스너
    document.getElementById('add-quantity-task-btn').addEventListener('click', () => {
        currentModalTarget = 'quantity';
        populateTaskSelectModal();
        document.getElementById('select-task-modal').classList.remove('hidden');
    });

    // [수정] 동적 클릭 핸들러 (모달 닫기 포함)
    document.body.addEventListener('click', handleDynamicClicks);

    // [추가] '업무 선택' 모달에서 업무 클릭 시
    document.getElementById('select-task-list').addEventListener('click', (e) => {
        const button = e.target.closest('.task-select-list-btn');
        if (button) {
            const taskName = button.dataset.taskName;
            if (currentModalTarget === 'key') {
                addKeyTask(taskName);
            } else if (currentModalTarget === 'quantity') {
                addQuantityTask(taskName);
            }
            document.getElementById('select-task-modal').classList.add('hidden');
            currentModalTarget = null;
        }
    });

    // ✅ [추가] '현황판 항목 선택' 모달에서 항목 클릭 시
    document.getElementById('select-dashboard-item-list').addEventListener('click', (e) => {
        const button = e.target.closest('.dashboard-item-select-btn');
        if (button) {
            const itemId = button.dataset.id;
            addDashboardItem(itemId);
            document.getElementById('select-dashboard-item-modal').classList.add('hidden');
        }
    });

    // [추가] '처리량 집계 추가' 확인 모달 버튼
    document.getElementById('confirm-add-to-quantity-btn').addEventListener('click', () => {
        if (taskJustAdded) {
            addQuantityTask(taskJustAdded);
        }
        document.getElementById('confirm-add-to-quantity-modal').classList.add('hidden');
        taskJustAdded = null;
    });
    document.getElementById('cancel-add-to-quantity-btn').addEventListener('click', () => {
        document.getElementById('confirm-add-to-quantity-modal').classList.add('hidden');
        taskJustAdded = null;
    });


    // [수정] 모든 레벨의 드래그앤드롭 리스너 설정
    setupDragDropListeners('#team-groups-container', '.team-group-card'); // 1. 팀 그룹 (카드)
    setupDragDropListeners('.members-container', '.member-item'); // 2. 팀원 (항목)
    
    setupDragDropListeners('#dashboard-items-container', '.dashboard-item-config'); // ✅ [추가] 현황판 항목 (항목)
    
    setupDragDropListeners('#key-tasks-container', '.key-task-item'); // 3. 주요 업무 (항목)
    
    setupDragDropListeners('#task-groups-container', '.task-group-card'); // 4. 업무 그룹 (카드)
    setupDragDropListeners('.tasks-container', '.task-item'); // 5. 업무 (항목)

    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item'); // 6. 처리량 업무 (항목)
}

// ... (addTeamGroup 함수는 이전과 동일) ...
function addTeamGroup() {
    const newGroup = { name: '새 그룹', members: ['새 팀원'] };
    appConfig.teamGroups = appConfig.teamGroups || [];
    appConfig.teamGroups.push(newGroup);
    if (!appConfig.memberWages) appConfig.memberWages = {};
    appConfig.memberWages['새 팀원'] = appConfig.defaultPartTimerWage || 10000;
    
    renderTeamGroups(appConfig.teamGroups, appConfig.memberWages);
    setupDragDropListeners('.members-container', '.member-item'); 
}

// [수정] addKeyTask 함수
function addKeyTask(taskName) {
    const nameToAdd = taskName || '새 주요 업무'; // taskName이 없는 경우 (혹시 모를 예외처리)
    appConfig.keyTasks = appConfig.keyTasks || [];
    
    // 중복 확인
    const existingTasks = (appConfig.keyTasks || []).map(t => t.trim().toLowerCase());
    if (existingTasks.includes(nameToAdd.trim().toLowerCase())) {
        alert("이미 '주요 업무'에 등록된 업무입니다.");
        return;
    }
    
    appConfig.keyTasks.push(nameToAdd);
    renderKeyTasks(appConfig.keyTasks);
}

// ... (addTaskGroup 함수는 이전과 동일) ...
function addTaskGroup() {
    const newGroupName = `새 업무 그룹 ${Object.keys(appConfig.taskGroups || {}).length + 1}`;
    if (!appConfig.taskGroups) appConfig.taskGroups = {};
    appConfig.taskGroups[newGroupName] = ['새 업무'];
    
    renderTaskGroups(appConfig.taskGroups);
    setupDragDropListeners('.tasks-container', '.task-item');
}

// [수정] addQuantityTask 함수
function addQuantityTask(taskName) {
    const nameToAdd = taskName || '새 처리량 업무'; // taskName이 없는 경우
    appConfig.quantityTaskTypes = appConfig.quantityTaskTypes || [];

    // 중복 확인
    const existingTasks = (appConfig.quantityTaskTypes || []).map(t => t.trim().toLowerCase());
     if (existingTasks.includes(nameToAdd.trim().toLowerCase())) {
        // 'confirm' 모달에서 추가할 때 이미 목록에 있다면 조용히 무시 (경고창 X)
        if (taskJustAdded === taskName) return; 
        
        alert("이미 '처리량 집계 업무'에 등록된 업무입니다.");
        return;
    }
    
    appConfig.quantityTaskTypes.push(nameToAdd);
    renderQuantityTasks(appConfig.quantityTaskTypes);
}

// [추가] '업무 관리'에서 '새 업무' 추가 후 이름 변경 시(blur) 호출될 함수 (요청한 팝업 기능)
function handleNewTaskNameBlur(e) {
    const newTaskName = e.target.value.trim();
    
    // 비어있거나 기본값이면 무시
    if (!newTaskName || newTaskName === '새 업무') return;

    // '처리량 집계' 목록에 이미 있는지 확인
    const allQuantityTasks = (appConfig.quantityTaskTypes || []).map(t => t.trim().toLowerCase());
    
    if (allQuantityTasks.includes(newTaskName.toLowerCase())) {
        return; // 이미 있으므로 팝업 띄우지 않음
    }

    // 팝업 띄우기
    taskJustAdded = newTaskName; // 전역 변수에 저장
    const msgEl = document.getElementById('confirm-add-to-quantity-message');
    if (msgEl) {
        msgEl.textContent = `방금 추가한 '${newTaskName}' 업무를 처리량 집계 목록에도 추가하시겠습니까?`;
    }
    document.getElementById('confirm-add-to-quantity-modal').classList.remove('hidden');
}


// ✅ [추가] 현황판 항목 추가 모달 열기
function openDashboardItemModal() {
    const listContainer = document.getElementById('select-dashboard-item-list');
    listContainer.innerHTML = '';

    // 현재 DOM에 있는 항목 ID들
    const currentItemIds = new Set();
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
        currentItemIds.add(item.dataset.id);
    });

    let hasItemsToAdd = false;
    // 전체 정의에서 현재 없는 것만 버튼으로 만듦
    Object.keys(DASHBOARD_ITEM_DEFINITIONS).forEach(id => {
        if (!currentItemIds.has(id)) {
            hasItemsToAdd = true;
            const itemDef = DASHBOARD_ITEM_DEFINITIONS[id];
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dashboard-item-select-btn w-full text-left p-2 rounded-md border btn-secondary focus:ring-2 focus:ring-blue-300';
            button.textContent = itemDef.title;
            button.dataset.id = id;
            listContainer.appendChild(button);
        }
    });

    if (!hasItemsToAdd) {
        listContainer.innerHTML = '<p class="text-gray-500 col-span-full text-center">추가할 수 있는 항목이 없습니다.</p>';
    }
    
    document.getElementById('select-dashboard-item-modal').classList.remove('hidden');
}

// ✅ [추가] 현황판 항목 DOM에 추가
function addDashboardItem(id) {
    const itemDef = DASHBOARD_ITEM_DEFINITIONS[id];
    if (!itemDef) return;

    // 중복 확인 (모달에서 이미 했지만, 안전장치)
    const currentItemIds = new Set();
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
        currentItemIds.add(item.dataset.id);
    });
    if (currentItemIds.has(id)) {
        alert("이미 추가된 항목입니다.");
        return;
    }

    const container = document.getElementById('dashboard-items-container');
    const itemEl = document.createElement('div');
    itemEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 dashboard-item-config';
    itemEl.innerHTML = `
        <span class="drag-handle" draggable="true">☰</span> 
        <span class="dashboard-item-name flex-grow p-2 bg-gray-100 rounded" data-id="${id}">${itemDef.title}</span>
        <button class="btn btn-danger btn-small delete-dashboard-item-btn" data-id="${id}">삭제</button>
    `;
    container.appendChild(itemEl);
}


// [수정] handleDynamicClicks 함수
function handleDynamicClicks(e) {
    // [추가] 모달 닫기 버튼
    const closeBtn = e.target.closest('.modal-close-btn');
    if (closeBtn) {
        const modalId = closeBtn.dataset.modalId;
        if (modalId) {
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.add('hidden');
        }
    }
    
    // 팀원 추가/삭제, 팀 그룹 삭제
    if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item';
        // newMemberEl.draggable = true; // [제거]
        newMemberEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 팀원" class="member-name" placeholder="팀원 이름">
            <label class="text-sm whitespace-nowrap">시급:</label>
            <input type="number" value="${appConfig.defaultPartTimerWage || 10000}" class="member-wage w-28" placeholder="시급">
            <button class="btn btn-danger btn-small delete-member-btn">삭제</button>
        `; // [수정] handle에 draggable="true" 추가
        container.appendChild(newMemberEl);
    } else if (e.target.classList.contains('delete-member-btn')) {
        e.target.closest('.member-item').remove();
    } else if (e.target.classList.contains('delete-team-group-btn')) {
        e.target.closest('.team-group-card').remove();
    }
    // ✅ [추가] 현황판 항목 삭제
    else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        e.target.closest('.dashboard-item-config').remove();
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
        // newTaskEl.draggable = true; // [제거]
        newTaskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 업무" class="task-name flex-grow">
            <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
        `; // [수정] handle에 draggable="true" 추가
        container.appendChild(newTaskEl);

        // [추가] 방금 추가된 '새 업무' input에 blur 이벤트 리스너 추가
        const newTaskNameInput = newTaskEl.querySelector('.task-name');
        if (newTaskNameInput) {
            newTaskNameInput.focus(); // 바로 이름 수정하도록 포커스
            // 포커스를 잃었을 때(이름 수정 완료 시) 팝업을 띄우기 위한 리스너
            newTaskNameInput.addEventListener('blur', handleNewTaskNameBlur, { once: true });
        }

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


// ✅ [수정] 드래그 앤 드롭 설정 함수 (로직 변경)
function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    if (containers.length === 0) return;

    containers.forEach(container => {
        // 중복 부착 방지
        const listenerId = `drag-${itemSelector.replace('.', '')}`;
        if (container.dataset.dragListenersAttached?.includes(listenerId)) {
            return;
        }
        container.dataset.dragListenersAttached = (container.dataset.dragListenersAttached || '') + listenerId;


        // [dragstart] - 핸들 클릭 시, 올바른 아이템이면 draggedItem 설정
        container.addEventListener('dragstart', (e) => {
            // [수정] e.target이 drag-handle인지 확인
            if (!e.target.classList.contains('drag-handle')) {
                // 핸들이 아니면(예: input 클릭) 드래그 시작 안 함
                e.preventDefault(); 
                return;
            }

            // [수정] e.target은 핸들(span)이므로, 부모 아이템(card/item)을 찾음
            const item = e.target.closest(itemSelector); 
            
            if (!item || item.parentElement !== container) {
                // 올바른 아이템이 아니거나, 해당 컨테이너의 자식이 아니면 무시
                return;
            }
            
            e.stopPropagation();
            draggedItem = item;
            setTimeout(() => draggedItem.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
        });

        // [dragend] - 드래그 종료 시, 모든 상태 초기화
        container.addEventListener('dragend', (e) => {
            if (!draggedItem || draggedItem.parentElement !== container) return;
            
            e.stopPropagation();
            draggedItem.classList.remove('dragging');
            draggedItem = null;
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        // [dragover] - 드래그 중인 아이템이 "내(컨테이너) 위"에 있을 때
        container.addEventListener('dragover', (e) => {
            // ✅ [핵심 수정] preventDefault()를 *무조건 맨 먼저* 호출
            e.preventDefault(); 
            
            if (!draggedItem || draggedItem.parentElement !== container) return;
            
            e.stopPropagation(); 
            
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            if (afterElement) {
                afterElement.classList.add('drag-over');
            } else {
                // 맨 끝에 추가 (별도 피드백 없음)
            }
        });

         container.addEventListener('dragleave', (e) => {
             if (!draggedItem || draggedItem.parentElement !== container) return;
             e.stopPropagation(); 
             // .drag-over 클래스 정리
             container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
         });

        // [drop] - 드롭했을 때
        container.addEventListener('drop', (e) => {
            // ✅ [수정] preventDefault()는 여기서도 필요함 (브라우저 기본 동작 방지)
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
            
            // cleanup은 dragend에서 처리
        });
    }); // end containers.forEach
}


// --- 데이터 저장 ---
// ✅ [수정] handleSaveAll (읽는 방식 수정)
async function handleSaveAll() {
    try {
        const newConfig = {
            teamGroups: [],
            memberWages: {},
            dashboardItems: [], // ✅ [추가]
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

        // ✅ [추가] 2. 현황판 항목 정보 읽기 (순서 반영)
        document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
            newConfig.dashboardItems.push(item.dataset.id);
        });

        // 3. 주요 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
             // [수정] .value -> .textContent
             const taskName = item.querySelector('.key-task-name').textContent.trim();
             if (taskName) newConfig.keyTasks.push(taskName);
        });


        // 4. 업무 정보 읽기 (순서 반영)
        const orderedTaskGroups = {};
        document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
            const groupNameInput = groupCard.querySelector('.task-group-name');
            const groupName = groupNameInput ? groupNameInput.value.trim() : '';
            if (!groupName) return;

            const tasks = [];
            
            groupCard.querySelectorAll('.task-item').forEach(taskItem => {
                const taskName = taskItem.querySelector('.task-name').value.trim();
                if (taskName) tasks.push(taskName);
            });
             orderedTaskGroups[groupName] = tasks;
        });
        newConfig.taskGroups = orderedTaskGroups;


        // 5. 처리량 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            // [수정] .value -> .textContent
            const taskName = item.querySelector('.quantity-task-name').textContent.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // 6. 전역 설정 (알바 시급) 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }
        
        // [추가] 7. 데이터 유효성 검사
        const allTaskNames = new Set(Object.values(newConfig.taskGroups).flat().map(t => t.trim().toLowerCase()));
        
        const invalidKeyTasks = newConfig.keyTasks.filter(task => !allTaskNames.has(task.trim().toLowerCase()));
        const invalidQuantityTasks = newConfig.quantityTaskTypes.filter(task => !allTaskNames.has(task.trim().toLowerCase()));

        if (invalidKeyTasks.length > 0 || invalidQuantityTasks.length > 0) {
            let errorMsg = "[저장 실패] '업무 관리' 목록에 존재하지 않는 업무 이름이 포함되어 있습니다.\n\n";
            if (invalidKeyTasks.length > 0) {
                errorMsg += `▶ 주요 업무 오류:\n- ${invalidKeyTasks.join('\n- ')}\n\n`;
            }
            if (invalidQuantityTasks.length > 0) {
                errorMsg += `▶ 처리량 집계 오류:\n- ${invalidQuantityTasks.join('\n- ')}\n\n`;
            }
            errorMsg += "오타를 수정하거나 '업무 관리' 섹션에 해당 업무를 먼저 추가해주세요.";
            alert(errorMsg);
            return; // 저장 중단
        }


        // 8. Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        // 9. UI 다시 렌더링 (리스너 재설정 포함)
        renderAdminUI(appConfig);
        setupEventListeners(); // 렌더링 후 리스너 재설정


    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}