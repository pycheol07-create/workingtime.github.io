import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, collection, writeBatch, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db, auth;
let appConfig = {};
const APP_ID = 'team-work-logger-v2';

// ✅ [복원] 누락되었던 상수 정의
const DASHBOARD_ITEM_DEFINITIONS = {
    'total-staff': { title: '총원 (직원/알바)' },
    'leave-staff': { title: '휴무' },
    'active-staff': { title: '근무 (직원/알바)' },
    'working-staff': { title: '업무중' },
    'idle-staff': { title: '대기' },
    'ongoing-tasks': { title: '진행업무' },
    'total-work-time': { title: '업무진행시간' },
    'domestic-invoice': { title: '국내송장(예상)', isQuantity: true },
    'china-production': { title: '중국제작', isQuantity: true },
    'direct-delivery': { title: '직진배송', isQuantity: true }
};

// ⛔️ [삭제] getTodayDateString 함수 제거

function getAllDashboardDefinitions(config) {
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...(config.dashboardCustomItems || {})
    };
}

let draggedItem = null;
let currentModalTarget = null;
let taskJustAdded = null;

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

function getAllTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#task-groups-container .task-name').forEach(input => {
        const taskName = input.value.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

function populateTaskSelectModal() {
    const allTasks = getAllTaskNamesFromDOM();
    const listContainer = document.getElementById('select-task-list');
    const modalTitle = document.getElementById('select-task-modal-title');

    if (!listContainer || !modalTitle) return;

    listContainer.innerHTML = '';

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

function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    // ✨ [신규] 매출 분석 기준 렌더링
    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) {
        revenueUnitInput.value = config.revenueIncrementUnit || 10000000;
    }
    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) {
        workHoursInput.value = config.standardMonthlyWorkHours || 209;
    }

    renderTeamGroups(config.teamGroups || [], config.memberWages || {}, config.memberEmails || {});
    renderDashboardItemsConfig(config.dashboardItems || [], config.dashboardQuantities || {});
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || {});
    renderQuantityTasks(config.quantityTaskTypes || []);
    renderQuantityToDashboardMapping(config);
}

function renderTeamGroups(teamGroups, memberWages, memberEmails) {
    const container = document.getElementById('team-groups-container');
    container.innerHTML = '';

    const memberRoles = appConfig.memberRoles || {};

    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
        groupEl.dataset.index = index;

        const membersHtml = group.members.map((member, mIndex) => {
            const memberEmail = memberEmails[member] || '';
            const currentRole = (memberEmail && memberRoles[memberEmail.toLowerCase()]) ? memberRoles[memberEmail.toLowerCase()] : 'user';

            return `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item">
                <span class="drag-handle" draggable="true">☰</span>
                <input type="text" value="${member}" class="member-name w-32" placeholder="팀원 이름">
                
                <label class="text-sm whitespace-nowrap ml-2">로그인 이메일:</label>
                <input type="email" value="${memberEmail}" class="member-email w-48" placeholder="example@email.com">
                
                <label class="text-sm whitespace-nowrap ml-2">시급:</label>
                <input type="number" value="${memberWages[member] || 0}" class="member-wage w-20" placeholder="시급">
                
                <label class="text-sm whitespace-nowrap ml-2">역할:</label>
                <select class="member-role w-24 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                    <option value="user" ${currentRole === 'user' ? 'selected' : ''}>일반사용자</option>
                    <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>관리자</option>
                </select>
                
                <button class="btn btn-danger btn-small delete-member-btn ml-auto" data-m-index="${mIndex}">삭제</button>
            </div>
            `;
        }).join('');

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

function renderDashboardItemsConfig(itemIds, quantities) {
    const container = document.getElementById('dashboard-items-container');
    container.innerHTML = '';
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    itemIds.forEach((id, index) => {
        const itemDef = allDefinitions[id];
        if (!itemDef) {
            console.warn(`Dashboard item definition not found for ID: ${id}. Skipping render.`);
            return;
        }

        const itemEl = document.createElement('div');
        const isQuantity = itemDef.isQuantity === true;
        itemEl.className = `flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 dashboard-item-config ${isQuantity ? 'is-quantity-item' : ''}`;
        itemEl.dataset.index = index;

        let itemHtml = `
            <span class="drag-handle" draggable="true">☰</span>
            <span class="dashboard-item-name flex-grow p-2 ${isQuantity ? 'bg-yellow-50' : 'bg-gray-100'} rounded text-sm font-medium" data-id="${id}">${itemDef.title}</span>
        `;

        itemHtml += `<button class="btn btn-danger btn-small delete-dashboard-item-btn ml-2" data-id="${id}">삭제</button>`;

        itemEl.innerHTML = itemHtml;
        container.appendChild(itemEl);
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
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="key-task-name flex-grow p-2 bg-gray-100 rounded">${task}</span>
            <button class="btn btn-danger btn-small delete-key-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

function renderTaskGroups(taskGroups) {
    const container = document.getElementById('task-groups-container');
    container.innerHTML = '';

    (taskGroups || []).forEach((group, index) => {
        const groupName = group.name;
        const tasks = Array.isArray(group.tasks) ? group.tasks : [];

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
            <span class="drag-handle" draggable="true">☰</span> 
            <span class="quantity-task-name flex-grow p-2 bg-gray-100 rounded">${task}</span>
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

function renderQuantityToDashboardMapping(config) {
    const container = document.getElementById('quantity-mapping-container');
    if (!container) return;
    container.innerHTML = '';

    const mapping = config.quantityToDashboardMap || {};
    const quantityTasks = config.quantityTaskTypes || [];
    const allDefinitions = getAllDashboardDefinitions(config);

    const dashboardOptions = [];
    dashboardOptions.push(`<option value="">-- 연동 안 함 --</option>`);

    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(itemSpan => {
        const id = itemSpan.dataset.id;
        const def = allDefinitions[id];

        if (def && def.isQuantity) {
            const title = itemSpan.textContent.trim();
            dashboardOptions.push(`<option value="${id}">${title}</option>`);
        }
    });

    if (quantityTasks.length === 0) {
        container.innerHTML = `<p class="text-sm text-gray-500 text-center">'처리량 집계 업무'에 항목을 먼저 추가해주세요.</p>`;
        return;
    }

    quantityTasks.forEach(taskName => {
        const row = document.createElement('div');
        row.className = 'flex items-center gap-4 mapping-row p-2 rounded hover:bg-gray-100';
        row.dataset.taskName = taskName;

        const currentSelection = mapping[taskName] || '';

        row.innerHTML = `
            <label class="w-1/3 font-semibold text-gray-700">${taskName}</label>
            <span class="text-gray-400">&rarr;</span>
            <select class="dashboard-mapping-select w-2/3 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                ${dashboardOptions.join('')}
            </select>
        `;

        const select = row.querySelector('.dashboard-mapping-select');
        if (select) {
            select.value = currentSelection;
        }

        container.appendChild(row);
    });
}

function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
    document.getElementById('add-team-group-btn').addEventListener('click', addTeamGroup);
    document.getElementById('add-dashboard-item-btn').addEventListener('click', openDashboardItemModal);
    document.getElementById('add-custom-dashboard-item-btn').addEventListener('click', addCustomDashboardItem);

    // ⛔️ [삭제] 마이그레이션 버튼 리스너 제거
    // const migrateBtn = document.getElementById('migrate-today-data-btn');
    // if (migrateBtn) {
    //     migrateBtn.addEventListener('click', handleDataMigration);
    // }

    document.getElementById('add-key-task-btn').addEventListener('click', () => {
        currentModalTarget = 'key';
        populateTaskSelectModal();
        document.getElementById('select-task-modal').classList.remove('hidden');
    });

    document.getElementById('add-task-group-btn').addEventListener('click', addTaskGroup);

    document.getElementById('add-quantity-task-btn').addEventListener('click', () => {
        currentModalTarget = 'quantity';
        populateTaskSelectModal();
        document.getElementById('select-task-modal').classList.remove('hidden');
    });

    document.body.addEventListener('click', handleDynamicClicks);

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

    document.getElementById('select-dashboard-item-list').addEventListener('click', (e) => {
        const button = e.target.closest('.dashboard-item-select-btn');
        if (button) {
            const itemId = button.dataset.id;
            if (appConfig.dashboardItems && !appConfig.dashboardItems.includes(itemId)) {
                appConfig.dashboardItems.push(itemId);
                renderDashboardItemsConfig(appConfig.dashboardItems, {});
                renderQuantityToDashboardMapping(appConfig);
            } else {
                alert("이미 추가된 항목입니다.");
            }
            document.getElementById('select-dashboard-item-modal').classList.add('hidden');
        }
    });

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

    setupDragDropListeners('#team-groups-container', '.team-group-card');
    setupDragDropListeners('.members-container', '.member-item');
    setupDragDropListeners('#dashboard-items-container', '.dashboard-item-config');
    setupDragDropListeners('#key-tasks-container', '.key-task-item');
    setupDragDropListeners('#task-groups-container', '.task-group-card');
    setupDragDropListeners('.tasks-container', '.task-item');
    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item');
}

// ⛔️ [삭제] handleDataMigration 함수 전체 제거
// async function handleDataMigration() { ... }


function addTeamGroup() {
    const container = document.getElementById('team-groups-container');
    if (!container) return;

    const newGroupName = '새 그룹';
    const newMemberName = '새 팀원';
    const defaultWage = appConfig.defaultPartTimerWage || 10000;

    const groupEl = document.createElement('div');
    groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';

    const membersHtml = `
        <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item">
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="${newMemberName}" class="member-name w-32" placeholder="팀원 이름">
            
            <label class="text-sm whitespace-nowrap ml-2">로그인 이메일:</label>
            <input type="email" value="" class="member-email w-48" placeholder="example@email.com">
            
            <label class="text-sm whitespace-nowrap ml-2">시급:</label>
            <input type="number" value="${defaultWage}" class="member-wage w-20" placeholder="시급">
            
            <label class="text-sm whitespace-nowrap ml-2">역할:</label>
            <select class="member-role w-24 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                <option value="user" selected>일반사용자</option>
                <option value="admin">관리자</option>
            </select>
            
            <button class="btn btn-danger btn-small delete-member-btn ml-auto">삭제</button>
        </div>
    `;

    groupEl.innerHTML = `
        <div class="flex justify-between items-center mb-4">
            <div class="flex items-center">
                <span class="drag-handle" draggable="true">☰</span> 
                <input type="text" value="${newGroupName}" class="text-lg font-semibold team-group-name w-auto">
            </div>
            <button class="btn btn-danger btn-small delete-team-group-btn">그룹 삭제</button>
        </div>
        <div class="pl-4 border-l-2 border-gray-200 space-y-2 members-container">${membersHtml}</div>
        <button class="btn btn-secondary btn-small mt-3 add-member-btn">+ 팀원 추가</button>
    `;

    container.appendChild(groupEl);

    const newMembersContainer = groupEl.querySelector('.members-container');
    if (newMembersContainer) {
        setupDragDropListeners('.members-container', '.member-item');
    }
}

function addKeyTask(taskName) {
    const nameToAdd = taskName || '새 주요 업무';
    appConfig.keyTasks = appConfig.keyTasks || [];

    const existingTasks = (appConfig.keyTasks || []).map(t => t.trim().toLowerCase());
    if (existingTasks.includes(nameToAdd.trim().toLowerCase())) {
        alert("이미 '주요 업무'에 등록된 업무입니다.");
        return;
    }

    appConfig.keyTasks.push(nameToAdd);
    renderKeyTasks(appConfig.keyTasks);
}

function addTaskGroup() {
    const container = document.getElementById('task-groups-container');
    if (!container) return;

    const newGroupName = `새 업무 그룹 ${container.children.length + 1}`;
    const newTaskName = '새 업무';

    const groupEl = document.createElement('div');
    groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';

    const tasksHtml = `
        <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item">
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="${newTaskName}" class="task-name flex-grow">
            <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
        </div>
    `;

    groupEl.innerHTML = `
         <div class="flex justify-between items-center mb-4">
            <div class="flex items-center"> 
               <span class="drag-handle" draggable="true">☰</span>
               <input type="text" value="${newGroupName}" class="text-lg font-semibold task-group-name w-auto">
             </div>
            <button class="btn btn-danger btn-small delete-task-group-btn">그룹 삭제</button>
        </div>
        <div class="pl-4 border-l-2 border-gray-200 space-y-2 tasks-container">${tasksHtml}</div>
        <button class="btn btn-secondary btn-small mt-3 add-task-btn">+ 업무 추가</button>
    `;

    container.appendChild(groupEl);

    const newTasksContainer = groupEl.querySelector('.tasks-container');
    if (newTasksContainer) {
        setupDragDropListeners('.tasks-container', '.task-item');

        const newTaskNameInput = newTasksContainer.querySelector('.task-name');
        if (newTaskNameInput) {
            newTaskNameInput.focus();
            newTaskNameInput.addEventListener('blur', handleNewTaskNameBlur, { once: true });
        }
    }
}

function addQuantityTask(taskName) {
    const nameToAdd = taskName || '새 처리량 업무';
    appConfig.quantityTaskTypes = appConfig.quantityTaskTypes || [];

    const existingTasks = (appConfig.quantityTaskTypes || []).map(t => t.trim().toLowerCase());
    if (existingTasks.includes(nameToAdd.trim().toLowerCase())) {
        if (taskJustAdded === taskName) return;

        alert("이미 '처리량 집계 업무'에 등록된 업무입니다.");
        return;
    }

    appConfig.quantityTaskTypes.push(nameToAdd);
    renderQuantityTasks(appConfig.quantityTaskTypes);
}

function handleNewTaskNameBlur(e) {
    const newTaskName = e.target.value.trim();

    if (!newTaskName || newTaskName === '새 업무') return;

    const allQuantityTasks = (appConfig.quantityTaskTypes || []).map(t => t.trim().toLowerCase());

    if (allQuantityTasks.includes(newTaskName.toLowerCase())) {
        return;
    }

    taskJustAdded = newTaskName;
    const msgEl = document.getElementById('confirm-add-to-quantity-message');
    if (msgEl) {
        msgEl.textContent = `방금 추가한 '${newTaskName}' 업무를 처리량 집계 목록에도 추가하시겠습니까?`;
    }
    document.getElementById('confirm-add-to-quantity-modal').classList.add('hidden');
}

function openDashboardItemModal() {
    const listContainer = document.getElementById('select-dashboard-item-list');
    listContainer.innerHTML = '';

    const currentItemIds = new Set();
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
        currentItemIds.add(item.dataset.id);
    });

    const allDefinitions = getAllDashboardDefinitions(appConfig);
    let hasItemsToAdd = false;

    Object.keys(allDefinitions).sort((a, b) => allDefinitions[a].title.localeCompare(allDefinitions[b].title)).forEach(id => {
        const itemDef = allDefinitions[id];
        const isAlreadyAdded = currentItemIds.has(id);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dashboard-item-select-btn w-full text-left p-2 rounded-md border focus:ring-2 focus:ring-blue-300';
        button.textContent = itemDef.title + (id.startsWith('custom-') ? ' (커스텀)' : '');
        button.dataset.id = id;

        if (isAlreadyAdded) {
            button.disabled = true;
            button.classList.add('btn-secondary', 'opacity-50', 'cursor-not-allowed');
            button.classList.remove('btn-secondary');
        } else {
            hasItemsToAdd = true;
            button.classList.add('btn-secondary');
        }

        listContainer.appendChild(button);
    });

    if (!hasItemsToAdd) {
        const noItemsMsg = document.createElement('p');
        noItemsMsg.className = 'text-gray-500 col-span-full text-center';
        noItemsMsg.textContent = '추가할 수 있는 항목이 없습니다.';
        listContainer.appendChild(noItemsMsg);
    }

    document.getElementById('select-dashboard-item-modal').classList.remove('hidden');
}

function addCustomDashboardItem() {
    const newTitle = prompt("새로 추가할 수량 항목의 이름을 입력하세요:");
    if (!newTitle || newTitle.trim() === '') {
        alert("항목 이름은 비워둘 수 없습니다.");
        return;
    }
    const trimmedTitle = newTitle.trim();

    const newId = `custom-${Date.now()}-${Math.random().toString(16).substring(2, 6)}`;

    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const titleExists = Object.values(allDefinitions).some(def => def.title.toLowerCase() === trimmedTitle.toLowerCase());
    if (titleExists) {
        alert("이미 같은 이름의 항목이 존재합니다.");
        return;
    }

    if (!appConfig.dashboardCustomItems) appConfig.dashboardCustomItems = {};
    appConfig.dashboardCustomItems[newId] = { title: trimmedTitle, isQuantity: true };

    if (!appConfig.dashboardItems) appConfig.dashboardItems = [];
    appConfig.dashboardItems.push(newId);

    renderDashboardItemsConfig(appConfig.dashboardItems, {});
    renderQuantityToDashboardMapping(appConfig);

    alert(`'${trimmedTitle}' 항목이 추가되었습니다. '모든 변경사항 저장'을 눌러야 최종 반영됩니다.`);
}

function handleDynamicClicks(e) {
    const closeBtn = e.target.closest('.modal-close-btn');
    if (closeBtn) {
        const modalId = closeBtn.dataset.modalId;
        if (modalId) {
            const modal = document.getElementById(modalId);
            if (modal) modal.classList.add('hidden');
        }
    } else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        e.target.closest('.dashboard-item-config').remove();
        renderQuantityToDashboardMapping(appConfig);
    }

    const toggleBtn = e.target.closest('.config-card-toggle');
    if (toggleBtn) {
        const card = toggleBtn.closest('.config-card');
        const content = card.querySelector('.config-card-content');
        const arrow = toggleBtn.querySelector('svg');
        if (content) {
            content.classList.toggle('hidden');
        }
        if (arrow) {
            arrow.classList.toggle('arrow-rotated');
        }
        return;
    }

    if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item';
        newMemberEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 팀원" class="member-name w-32" placeholder="팀원 이름">
            
            <label class="text-sm whitespace-nowrap ml-2">로그인 이메일:</label>
            <input type="email" value="" class="member-email w-48" placeholder="example@email.com">
            
            <label class="text-sm whitespace-nowrap ml-2">시급:</label>
            <input type="number" value="${appConfig.defaultPartTimerWage || 10000}" class="member-wage w-20" placeholder="시급">
            
            <label class="text-sm whitespace-nowrap ml-2">역할:</label>
            <select class="member-role w-24 p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm">
                <option value="user" selected>일반사용자</option>
                <option value="admin">관리자</option>
            </select>
            
            <button class="btn btn-danger btn-small delete-member-btn ml-auto">삭제</button>
        `;
        container.appendChild(newMemberEl);
    } else if (e.target.classList.contains('delete-member-btn')) {
        e.target.closest('.member-item').remove();
    } else if (e.target.classList.contains('delete-team-group-btn')) {
        e.target.closest('.team-group-card').remove();
    } else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        e.target.closest('.dashboard-item-config').remove();
    } else if (e.target.classList.contains('delete-key-task-btn')) {
        e.target.closest('.key-task-item').remove();
    } else if (e.target.classList.contains('add-task-btn')) {
        const container = e.target.previousElementSibling;
        const newTaskEl = document.createElement('div');
        newTaskEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item';
        newTaskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <input type="text" value="새 업무" class="task-name flex-grow">
            <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
        `;
        container.appendChild(newTaskEl);

        const newTaskNameInput = newTaskEl.querySelector('.task-name');
        if (newTaskNameInput) {
            newTaskNameInput.focus();
            newTaskNameInput.addEventListener('blur', handleNewTaskNameBlur, { once: true });
        }

    } else if (e.target.classList.contains('delete-task-btn')) {
        e.target.closest('.task-item').remove();
    } else if (e.target.classList.contains('delete-task-group-btn')) {
        e.target.closest('.task-group-card').remove();
    } else if (e.target.classList.contains('delete-quantity-task-btn')) {
        e.target.closest('.quantity-task-item').remove();
    }
}

function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    if (containers.length === 0) return;

    const listenerId = `drag-${itemSelector.replace('.', '')}`;

    containers.forEach(container => {
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

            if (!item || item.parentElement !== container) {
                return;
            }

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

            if (containerSelector === '#dashboard-items-container') {
                renderQuantityToDashboardMapping(appConfig);
            }
        });
    });
}

async function handleSaveAll() {
    try {
        const newConfig = {
            teamGroups: [],
            memberWages: {},
            memberEmails: {},
            memberRoles: {},
            dashboardItems: [],
            dashboardCustomItems: {},
            quantityToDashboardMap: {},
            keyTasks: [],
            taskGroups: [],
            quantityTaskTypes: [],
            defaultPartTimerWage: 10000,
            // ✨ [신규] 매출 분석 기준 초기화
            revenueIncrementUnit: 10000000,
            standardMonthlyWorkHours: 209
        };

        const emailCheck = new Map();
        let isEmailDuplicate = false;
        let duplicateEmailValue = '';

        document.querySelectorAll('#team-groups-container .team-group-card').forEach(groupCard => {
            const groupName = groupCard.querySelector('.team-group-name').value.trim();
            if (!groupName) return;

            const newGroup = { name: groupName, members: [] };

            groupCard.querySelectorAll('.member-item').forEach(memberItem => {
                const memberName = memberItem.querySelector('.member-name').value.trim();
                const memberEmail = memberItem.querySelector('.member-email').value.trim();
                const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
                const memberRole = memberItem.querySelector('.member-role').value || 'user';

                if (!memberName) return;

                newGroup.members.push(memberName);
                newConfig.memberWages[memberName] = memberWage;

                if (memberEmail) {
                    const emailLower = memberEmail.toLowerCase();

                    if (emailCheck.has(emailLower) && emailCheck.get(emailLower) !== memberName) {
                        isEmailDuplicate = true;
                        duplicateEmailValue = memberEmail;
                    }
                    emailCheck.set(emailLower, memberName);

                    newConfig.memberEmails[memberName] = memberEmail;
                    newConfig.memberRoles[emailLower] = memberRole;
                }
            });
            newConfig.teamGroups.push(newGroup);
        });

        if (isEmailDuplicate) {
            alert(`[저장 실패] 이메일 주소 '${duplicateEmailValue}'가 여러 팀원에게 중복 할당되었습니다. 이메일 주소는 고유해야 합니다.`);
            return;
        }

        const allDefinitions = getAllDashboardDefinitions(appConfig);
        document.querySelectorAll('#dashboard-items-container .dashboard-item-config').forEach(item => {
            const nameSpan = item.querySelector('.dashboard-item-name');
            if (nameSpan) {
                const id = nameSpan.dataset.id;
                newConfig.dashboardItems.push(id);
                const itemDef = allDefinitions[id];
                if (!itemDef) return;

                if (id.startsWith('custom-')) {
                    newConfig.dashboardCustomItems[id] = {
                        title: itemDef.title,
                        isQuantity: true
                    };
                }
            }
        });

        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
            const taskName = item.querySelector('.key-task-name').textContent.trim();
            if (taskName) newConfig.keyTasks.push(taskName);
        });

        document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
            const groupNameInput = groupCard.querySelector('.task-group-name');
            const groupName = groupNameInput ? groupNameInput.value.trim() : '';
            if (!groupName) return;
            const tasks = [];
            groupCard.querySelectorAll('.task-item').forEach(taskItem => {
                const taskName = taskItem.querySelector('.task-name').value.trim();
                if (taskName) tasks.push(taskName);
            });
            newConfig.taskGroups.push({ name: groupName, tasks: tasks });
        });

        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            const taskName = item.querySelector('.quantity-task-name').textContent.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // ✨ [신규] 매출 분석 기준 수집
        const revenueUnitInput = document.getElementById('revenue-increment-unit');
        if (revenueUnitInput) {
            newConfig.revenueIncrementUnit = Number(revenueUnitInput.value) || 10000000;
        }
        const workHoursInput = document.getElementById('standard-monthly-work-hours');
        if (workHoursInput) {
            newConfig.standardMonthlyWorkHours = Number(workHoursInput.value) || 209;
        }

        document.querySelectorAll('#quantity-mapping-container .mapping-row').forEach(row => {
            const taskName = row.dataset.taskName;
            const select = row.querySelector('.dashboard-mapping-select');
            const selectedId = select.value;
            if (taskName && selectedId) {
                newConfig.quantityToDashboardMap[taskName] = selectedId;
            }
        });

        const allTaskNames = new Set(newConfig.taskGroups.flatMap(group => group.tasks).map(t => t.trim().toLowerCase()));
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
            return;
        }

        await saveAppConfig(db, newConfig);
        appConfig = newConfig;
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        renderAdminUI(appConfig);
        setupEventListeners();

    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');

    try {
        const firebase = initializeFirebase();
        db = firebase.db;
        auth = firebase.auth;
        if (!db || !auth) {
            throw new Error("Firebase DB 또는 Auth 초기화 실패");
        }
    } catch (e) {
        console.error(e);
        adminContent.innerHTML = `<h2 class="text-2xl font-bold text-red-600 p-8 text-center">Firebase 초기화 실패. 메인 앱이 정상 동작하는지 확인하세요.</h2>`;
        adminContent.classList.remove('hidden');
        return;
    }

    onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                appConfig = await loadAppConfig(db);

                const userEmail = user.email;
                if (!userEmail) {
                    throw new Error("로그인한 사용자의 이메일을 찾을 수 없습니다.");
                }

                const userEmailLower = user.email.toLowerCase();
                const memberRoles = appConfig.memberRoles || {};
                const currentUserRole = memberRoles[userEmailLower] || 'user';

                if (currentUserRole === 'admin') {
                    renderAdminUI(appConfig);
                    setupEventListeners();
                    adminContent.classList.remove('hidden');
                } else {
                    adminContent.innerHTML = `<h2 class="text-2xl font-bold text-yellow-600 p-8 text-center">접근 거부: 관리자 계정이 아닙니다.</h2>`;
                    adminContent.classList.remove('hidden');
                }
            } catch (e) {
                console.error("역할 확인 중 오류:", e);
                adminContent.innerHTML = `<h2 class="text-2xl font-bold text-red-600 p-8 text-center">오류 발생: ${e.message}</h2>`;
                adminContent.classList.remove('hidden');
            }
        } else {
            adminContent.innerHTML = `<h2 class="text-2xl font-bold text-gray-600 p-8 text-center">접근 거부: 로그인이 필요합니다.<br><br><a href="index.html" class="text-blue-600 hover:underline">메인 앱으로 이동하여 로그인하세요.</a></h2>`;
            adminContent.classList.remove('hidden');
        }
    });
});