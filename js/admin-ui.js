// === js/admin-ui.js ===
// 설명: 관리자 페이지의 UI 렌더링을 전담하는 모듈입니다.

export const DASHBOARD_ITEM_DEFINITIONS = {
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

export function getAllDashboardDefinitions(config) {
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...(config.dashboardCustomItems || {})
    };
}

// 현재 DOM에 있는 모든 업무 이름 가져오기 (헬퍼 함수)
export function getAllTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#task-groups-container .task-name').forEach(input => {
        const taskName = input.value.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

// 전체 관리자 UI 렌더링 진입점
export function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) {
        revenueUnitInput.value = config.revenueIncrementUnit || 10000000;
    }
    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) {
        workHoursInput.value = config.standardMonthlyWorkHours || 209;
    }

    renderTeamGroups(config.teamGroups || [], config.memberWages || {}, config.memberEmails || {}, config.memberRoles || {});
    renderDashboardItemsConfig(config.dashboardItems || [], config);
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || []);
    renderQuantityTasks(config.quantityTaskTypes || []);
    renderQuantityToDashboardMapping(config);
}

export function renderTeamGroups(teamGroups, memberWages, memberEmails, memberRoles) {
    const container = document.getElementById('team-groups-container');
    if (!container) return;
    container.innerHTML = '';

    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
        groupEl.dataset.index = index;

        const membersHtml = group.members.map((member, mIndex) => {
            const memberEmail = memberEmails[member] || '';
            // 이메일 키는 소문자로 통일하여 역할 확인
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

export function renderDashboardItemsConfig(itemIds, fullConfig) {
    const container = document.getElementById('dashboard-items-container');
    if (!container) return;
    container.innerHTML = '';
    const allDefinitions = getAllDashboardDefinitions(fullConfig);

    itemIds.forEach((id, index) => {
        const itemDef = allDefinitions[id];
        if (!itemDef) return;

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

export function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    if (!container) return;
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

export function renderTaskGroups(taskGroups) {
    const container = document.getElementById('task-groups-container');
    if (!container) return;
    container.innerHTML = '';

    (taskGroups || []).forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;

        const tasksHtml = (group.tasks || []).map((task, tIndex) => `
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
                   <input type="text" value="${group.name}" class="text-lg font-semibold task-group-name w-auto">
                 </div>
                <button class="btn btn-danger btn-small delete-task-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 tasks-container">${tasksHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-task-btn">+ 업무 추가</button>
        `;
        container.appendChild(groupEl);
    });
}

export function renderQuantityTasks(quantityTasks) {
    const container = document.getElementById('quantity-tasks-container');
    if (!container) return;
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

export function renderQuantityToDashboardMapping(config) {
    const container = document.getElementById('quantity-mapping-container');
    if (!container) return;
    container.innerHTML = '';

    const mapping = config.quantityToDashboardMap || {};
    const quantityTasks = config.quantityTaskTypes || [];
    const allDefinitions = getAllDashboardDefinitions(config);

    const dashboardOptions = [];
    dashboardOptions.push(`<option value="">-- 연동 안 함 --</option>`);

    // 현재 화면에 렌더링된 현황판 항목 중 '수량(isQuantity=true)'인 것만 옵션으로 제공
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

export function populateTaskSelectModal(targetType) {
    const allTasks = getAllTaskNamesFromDOM();
    const listContainer = document.getElementById('select-task-list');
    const modalTitle = document.getElementById('select-task-modal-title');

    if (!listContainer || !modalTitle) return;

    listContainer.innerHTML = '';

    if (targetType === 'key') {
        modalTitle.textContent = "주요 업무로 추가할 업무 선택";
    } else if (targetType === 'quantity') {
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

export function openDashboardItemModal(fullConfig) {
    const listContainer = document.getElementById('select-dashboard-item-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const currentItemIds = new Set();
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
        currentItemIds.add(item.dataset.id);
    });

    const allDefinitions = getAllDashboardDefinitions(fullConfig);
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
            button.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100', 'text-gray-500');
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