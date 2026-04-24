// === js/admin-ui.js ===
// 설명: 관리자 페이지의 UI 렌더링을 전담하는 모듈입니다. (다크모드 지원)

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

export function getAllTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#task-groups-container .task-name').forEach(input => {
        const taskName = input.value.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

export function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) wageInput.value = config.defaultPartTimerWage || 10000;

    const revenueUnitInput = document.getElementById('revenue-increment-unit');
    if (revenueUnitInput) revenueUnitInput.value = config.revenueIncrementUnit || 10000000;
    
    const workHoursInput = document.getElementById('standard-monthly-work-hours');
    if (workHoursInput) workHoursInput.value = config.standardMonthlyWorkHours || 209;

    renderTeamGroups(
        config.teamGroups || [], 
        config.memberWages || {}, 
        config.memberEmails || {}, 
        config.memberRoles || {}, 
        config.memberLeaveSettings || {}
    );
    
    renderDashboardItemsConfig(config.dashboardItems || [], config);
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || []);
    renderQuantityTasks(config.quantityTaskTypes || []);
    renderQuantityToDashboardMapping(config);
    renderCostAnalysisConfig(config);
}

export function renderCostAnalysisConfig(config) {
    const materialInput = document.getElementById('fixed-material-cost');
    if (materialInput) materialInput.value = config.fixedMaterialCost || 0;
    
    const shippingInput = document.getElementById('fixed-shipping-cost');
    if (shippingInput) shippingInput.value = config.fixedShippingCost || 0;
    
    const directDeliveryInput = document.getElementById('fixed-direct-delivery-cost');
    if (directDeliveryInput) directDeliveryInput.value = config.fixedDirectDeliveryCost || 0;

    const container = document.getElementById('cost-calc-tasks-container');
    if (container) {
        container.innerHTML = '';
        
        const allTasks = new Set();
        (config.taskGroups || []).forEach(group => {
            (group.tasks || []).forEach(task => allTasks.add(task));
        });

        const savedTasks = new Set(config.costCalcTasks || []);

        if (allTasks.size === 0) {
             container.innerHTML = '<p class="text-xs text-gray-400 dark:text-gray-500 col-span-full text-center py-4">등록된 업무가 없습니다.</p>';
        } else {
            Array.from(allTasks).sort().forEach(taskName => {
                const isChecked = savedTasks.has(taskName) ? 'checked' : '';
                const div = document.createElement('div');
                div.className = 'flex items-center p-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:border-purple-300 dark:hover:border-purple-500 transition-colors';
                div.innerHTML = `
                    <input type="checkbox" id="cost-task-${taskName}" value="${taskName}" class="cost-calc-task-checkbox w-4 h-4 text-purple-600 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 bg-gray-50 dark:bg-gray-900" ${isChecked}>
                    <label for="cost-task-${taskName}" class="ml-2 text-sm font-medium text-gray-700 dark:text-gray-200 cursor-pointer select-none flex-grow">${taskName}</label>
                `;
                container.appendChild(div);
            });
        }
    }
}

export function renderTeamGroups(teamGroups, memberWages, memberEmails, memberRoles, memberLeaveSettings = {}) {
    const container = document.getElementById('team-groups-container');
    if (!container) return;
    container.innerHTML = '';

    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm team-group-card transition-colors';
        groupEl.dataset.index = index;

        const membersHtml = group.members.map((member, mIndex) => {
            const memberEmail = memberEmails[member] || '';
            const currentRole = (memberEmail && memberRoles[memberEmail.toLowerCase()]) ? memberRoles[memberEmail.toLowerCase()] : 'user';
            
            const settings = memberLeaveSettings[member] || {};
            const joinDate = settings.joinDate || '';
            const totalLeave = settings.totalLeave !== undefined ? settings.totalLeave : 15;
            const leaveResetDate = settings.leaveResetDate || ''; 
            const expirationDate = settings.expirationDate || '';

            return `
            <div class="flex flex-col gap-3 mb-4 p-4 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/30 shadow-sm member-item transition-colors">
                <div class="flex flex-wrap md:flex-nowrap justify-between items-start gap-4">
                    <div class="flex flex-wrap items-center gap-3 w-full md:w-auto">
                        <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                        
                        <div class="flex flex-col">
                            <label class="text-[10px] text-gray-500 dark:text-gray-400 font-bold mb-1">이름</label>
                            <input type="text" value="${member}" class="member-name w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm font-bold dark:text-white outline-none focus:border-blue-500" placeholder="이름">
                        </div>
                        
                        <div class="flex flex-col">
                            <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">이메일</label>
                            <input type="email" value="${memberEmail}" class="member-email w-48 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="email">
                        </div>

                        <div class="flex flex-col">
                            <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">시급</label>
                            <input type="number" value="${memberWages[member] || 0}" class="member-wage w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500" placeholder="시급">
                        </div>
                        
                        <div class="flex flex-col">
                             <label class="text-[10px] text-gray-500 dark:text-gray-400 mb-1">권한</label>
                            <select class="member-role w-24 p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-md text-sm dark:text-white outline-none focus:border-blue-500">
                                <option value="user" ${currentRole === 'user' ? 'selected' : ''}>일반</option>
                                <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>관리자</option>
                            </select>
                        </div>
                    </div>
                    <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-2 rounded-md transition delete-member-btn" data-m-index="${mIndex}">삭제</button>
                </div>

                <div class="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <span class="text-xs font-bold text-blue-600 dark:text-blue-400 w-full md:w-auto mb-2 md:mb-0">🏖️ 연차 설정</span>
                    
                    <div class="flex flex-col">
                        <label class="text-[9px] text-blue-600 dark:text-blue-400 mb-1">입사일자</label>
                        <input type="date" value="${joinDate}" class="member-join-date w-32 p-1.5 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 rounded text-xs dark:text-gray-200 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-[9px] text-blue-600 dark:text-blue-400 mb-1">총연차(일)</label>
                        <input type="number" value="${totalLeave}" class="member-total-leave w-16 p-1.5 border border-blue-200 dark:border-blue-800 bg-white dark:bg-gray-800 rounded text-xs text-center dark:text-gray-200 outline-none" min="0">
                    </div>
                    
                    <div class="hidden md:block w-px h-8 bg-gray-300 dark:bg-gray-600 mx-2"></div>

                    <div class="flex flex-col">
                        <label class="text-[9px] text-gray-500 dark:text-gray-400 mb-1 font-bold">적용 시작일</label>
                        <input type="date" value="${leaveResetDate}" class="member-leave-reset-date w-32 p-1.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded text-xs font-bold text-gray-700 dark:text-gray-200 outline-none">
                    </div>
                    <div class="flex flex-col">
                        <label class="text-[9px] text-red-500 dark:text-red-400 mb-1 font-bold">사용 만료일</label>
                        <input type="date" value="${expirationDate}" class="member-leave-expiration-date w-32 p-1.5 border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 rounded text-xs text-red-700 dark:text-red-400 outline-none">
                    </div>
                </div>
            </div>
            `;
        }).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2">
                    <span class="drag-handle mr-2 cursor-move text-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300" draggable="true">☰</span> 
                    <input type="text" value="${group.name}" class="text-lg font-extrabold text-gray-800 dark:text-white team-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none">
                </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-team-group-btn">그룹 삭제</button>
            </div>
            <div class="space-y-3 members-container">${membersHtml}</div>
            
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-center">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition w-full md:w-auto shadow-sm add-member-btn">+ 팀원 추가</button>
            </div>
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
        const bgClass = isQuantity ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800 text-blue-700 dark:text-blue-400' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300';
        
        itemEl.className = `flex items-center gap-3 p-3 rounded-lg border ${bgClass} shadow-sm dashboard-item-config group transition-colors`;
        itemEl.dataset.index = index;

        let itemHtml = `
            <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
            <span class="dashboard-item-name flex-grow font-bold text-sm" data-id="${id}">
                ${isQuantity ? '📦 ' : ''}${itemDef.title}
            </span>
        `;
        itemHtml += `<button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-dashboard-item-btn opacity-0 group-hover:opacity-100" data-id="${id}">삭제</button>`;
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
        taskEl.className = 'flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm key-task-item group transition-colors';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span> 
            <span class="key-task-name flex-grow font-bold text-sm text-gray-700 dark:text-gray-300">⭐ ${task}</span>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-key-task-btn opacity-0 group-hover:opacity-100" data-index="${index}">삭제</button>
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
        groupEl.className = 'p-5 border border-gray-200 dark:border-gray-700 rounded-2xl bg-white dark:bg-gray-800 shadow-sm task-group-card transition-colors';
        groupEl.dataset.index = index;

        const tasksHtml = (group.tasks || []).map((task, tIndex) => `
            <div class="flex items-center justify-between p-2.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-500 transition-colors task-item group shadow-sm">
                <div class="flex items-center gap-2 flex-grow">
                    <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span>
                    <input type="text" value="${task}" class="task-name flex-grow p-1.5 bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 text-sm font-semibold dark:text-white outline-none">
                </div>
                <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-task-btn opacity-0 group-hover:opacity-100" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-5 pb-3 border-b border-gray-100 dark:border-gray-700">
                <div class="flex items-center gap-2"> 
                   <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move text-lg" draggable="true">☰</span>
                   <input type="text" value="${group.name}" class="text-lg font-extrabold text-gray-800 dark:text-white task-group-name w-auto bg-transparent border-b border-transparent hover:border-gray-300 dark:hover:border-gray-600 focus:border-blue-500 p-1 outline-none">
                 </div>
                <button class="text-xs bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 font-bold px-3 py-1.5 rounded-md transition delete-task-group-btn">그룹 삭제</button>
            </div>
            
            <div class="space-y-2 tasks-container grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">${tasksHtml}</div>
            
            <div class="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                <button class="text-sm bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 font-bold px-4 py-2 rounded-lg transition shadow-sm add-task-btn">+ 업무 추가</button>
            </div>
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
        taskEl.className = 'flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm quantity-task-item group transition-colors';
        taskEl.dataset.index = index;
        taskEl.innerHTML = `
            <span class="drag-handle text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 cursor-move" draggable="true">☰</span> 
            <span class="quantity-task-name flex-grow font-bold text-sm text-gray-700 dark:text-gray-300">📝 ${task}</span>
            <button class="text-xs text-gray-400 hover:text-red-500 dark:hover:text-red-400 font-bold px-2 py-1 rounded transition delete-quantity-task-btn opacity-0 group-hover:opacity-100" data-index="${index}">삭제</button>
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

    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(itemSpan => {
        const id = itemSpan.dataset.id;
        const def = allDefinitions[id];
        if (def && def.isQuantity) {
            const title = itemSpan.textContent.trim().replace('📦 ', '');
            dashboardOptions.push(`<option value="${id}">${title}</option>`);
        }
    });

    if (quantityTasks.length === 0) {
        container.innerHTML = `<p class="text-sm text-gray-500 dark:text-gray-400 text-center py-4">'처리량 집계 업무'에 항목을 먼저 추가해주세요.</p>`;
        return;
    }

    quantityTasks.forEach(taskName => {
        const row = document.createElement('div');
        row.className = 'flex flex-wrap md:flex-nowrap items-center gap-4 mapping-row p-4 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 transition-colors';
        row.dataset.taskName = taskName;

        const currentSelection = mapping[taskName] || '';

        row.innerHTML = `
            <label class="w-full md:w-1/3 font-extrabold text-sm text-gray-700 dark:text-gray-200 break-all">${taskName}</label>
            <span class="hidden md:inline text-gray-400">➡️</span>
            <select class="dashboard-mapping-select flex-grow p-2.5 border border-blue-200 dark:border-blue-800 rounded-lg shadow-sm focus:ring-blue-500 focus:border-blue-500 text-sm bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-400 font-bold outline-none transition-colors w-full md:w-auto">
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
        modalTitle.textContent = "메인 보드에 고정할 업무 선택";
    } else if (targetType === 'quantity') {
        modalTitle.textContent = "처리량을 입력받을 업무 선택";
    }

    if (allTasks.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 dark:text-gray-400 col-span-full text-center py-8">먼저 \'업무 등록 관리\' 섹션에서 업무를 1개 이상 생성해주세요.</p>';
        return;
    }

    allTasks.sort((a, b) => a.localeCompare(b)).forEach(taskName => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'task-select-list-btn w-full text-left p-3 rounded-xl border border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-500 transition-colors font-bold text-gray-700 dark:text-gray-200 text-sm shadow-sm';
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
        button.className = 'dashboard-item-select-btn w-full text-left p-3 rounded-xl border transition-colors font-bold text-sm shadow-sm';
        button.textContent = itemDef.title + (id.startsWith('custom-') ? ' (커스텀)' : '');
        button.dataset.id = id;

        if (isAlreadyAdded) {
            button.disabled = true;
            button.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-100', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700', 'text-gray-400', 'dark:text-gray-500');
        } else {
            hasItemsToAdd = true;
            button.classList.add('bg-blue-50', 'dark:bg-blue-900/20', 'border-blue-200', 'dark:border-blue-800', 'text-blue-700', 'dark:text-blue-400', 'hover:bg-blue-100', 'dark:hover:bg-blue-900/40');
        }
        listContainer.appendChild(button);
    });

    if (!hasItemsToAdd) {
        const noItemsMsg = document.createElement('p');
        noItemsMsg.className = 'text-gray-500 dark:text-gray-400 col-span-full text-center py-4';
        noItemsMsg.textContent = '모든 항목이 이미 위젯에 등록되어 있습니다.';
        listContainer.appendChild(noItemsMsg);
    }

    document.getElementById('select-dashboard-item-modal').classList.remove('hidden');
}