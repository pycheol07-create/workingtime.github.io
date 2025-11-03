// === admin.js (Firebase 인증 적용 버전) ===

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';
// ✅ [추가] Firebase Auth import
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

let db, auth; // ✅ auth 추가
let appConfig = {};
// const ADMIN_PASSWORD = "anffbxla123"; // ⛔️ [삭제]

// ✅ [수정] 현황판 아이템 정의 (새 항목 추가)
const DASHBOARD_ITEM_DEFINITIONS = {
    'total-staff': { title: '총원 (직원/알바)' },
    'leave-staff': { title: '휴무' },
    'active-staff': { title: '근무 (직원/알바)' },
    'working-staff': { title: '업무중' },
    'idle-staff': { title: '대기' },
    'ongoing-tasks': { title: '진행업무' },
    'total-work-time': { title: '업무진행시간' },
    'domestic-invoice': { title: '국내송장(예상)', isQuantity: true }, // isQuantity 플래그 추가
    'china-production': { title: '중국제작', isQuantity: true },
    'direct-delivery': { title: '직진배송', isQuantity: true }
};

// ✅ [추가] 모든 현황판 항목 정의 가져오기 (기본 + 커스텀)
function getAllDashboardDefinitions(config) {
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...(config.dashboardCustomItems || {})
    };
}

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

// ⛔️ [삭제] 기존 DOMContentLoaded 리스너 (파일 하단으로 이동 및 수정됨)
/*
document.addEventListener('DOMContentLoaded', () => {
    // ... (기존 비밀번호 입력 로직) ...
});
*/

// --- UI 렌더링 ---
// (renderAdminUI, renderTeamGroups 함수는 이전과 동일)
function renderAdminUI(config) {
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    renderTeamGroups(config.teamGroups || [], config.memberWages || {}, config.memberEmails || {}); // ✅ memberEmails 추가
    // ✅ [수정] dashboardQuantities 전달 추가
    renderDashboardItemsConfig(config.dashboardItems || [], config.dashboardQuantities || {});
    renderKeyTasks(config.keyTasks || []);
    renderTaskGroups(config.taskGroups || {});
    renderQuantityTasks(config.quantityTaskTypes || []);
    // ✅ [추가] 연동 맵 렌더링 호출
    renderQuantityToDashboardMapping(config);
}

function renderTeamGroups(teamGroups, memberWages, memberEmails) { // ✅ memberEmails 파라미터 추가
    const container = document.getElementById('team-groups-container');
    container.innerHTML = '';
    
    // ✅ [추가] memberRoles 정보 가져오기 (appConfig는 전역 변수여야 함)
    const memberRoles = appConfig.memberRoles || {};

    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        // [수정] groupEl에서 draggable="true" 제거
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
        groupEl.dataset.index = index;
        // groupEl.draggable = true; // [제거]

        // ✅ [수정] 이메일 필드 추가 및 정렬 클래스(w-*, ml-auto) 적용
        const membersHtml = group.members.map((member, mIndex) => {
            const memberEmail = memberEmails[member] || '';
            // ✅ [추가] 현재 이메일의 역할 조회
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
        `; // [수정] group-card의 handle에 draggable="true" 추가
        container.appendChild(groupEl);
    });
}


// ✅ [수정] 현황판 항목 설정 렌더링 함수 (수량 입력 필드 완전 삭제)
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
        // ✅ [수정] is-quantity-item 클래스는 유지 (구분용)
        itemEl.className = `flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 dashboard-item-config ${isQuantity ? 'is-quantity-item' : ''}`;
        itemEl.dataset.index = index;

        // 핸들 + 이름
        let itemHtml = `
            <span class="drag-handle" draggable="true">☰</span>
            <span class="dashboard-item-name flex-grow p-2 ${isQuantity ? 'bg-yellow-50' : 'bg-gray-100'} rounded text-sm font-medium" data-id="${id}">${itemDef.title}</span>
        `;
        
        // ⛔️ [삭제] isQuantity가 true일 때 수량 입력 필드를 추가하던 <div class="ml-auto...">...</div> 블록 전체 삭제

        // 삭제 버튼
        itemHtml += `<button class="btn btn-danger btn-small delete-dashboard-item-btn ml-2" data-id="${id}">삭제</button>`;

        itemEl.innerHTML = itemHtml;
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


function renderTaskGroups(taskGroups) { // taskGroups is now an Array: [{name: 'G1', tasks: [...]}, ...]
    const container = document.getElementById('task-groups-container');
    container.innerHTML = '';
    
    // ⛔️ [삭제] const groupNames = Object.keys(taskGroups);
    
    // ✅ [수정] taskGroups 배열(Array)을 직접 순회(forEach)합니다.
    (taskGroups || []).forEach((group, index) => { // .forEach 앞에 (taskGroups || [])로 안전장치 추가
        
        // ✅ [수정] groupName과 tasks를 배열 요소(group)에서 가져옵니다.
        const groupName = group.name;
        const tasks = group.tasks || []; // tasks도 배열이어야 합니다.
        
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;

        // ✅ [정상] tasks는 이제 배열이므로 .map()이 정상 작동합니다.
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

/**
 * ✅ [수정] 현황판-처리량 연동 설정 UI를 렌더링합니다.
 * (DOM을 기준으로 현황판 목록을 읽어옵니다)
 */
function renderQuantityToDashboardMapping(config) {
    const container = document.getElementById('quantity-mapping-container');
    if (!container) return;
    container.innerHTML = '';

    // 1. config에서 현재 저장된 매핑 값과 처리량 업무 목록은 가져옵니다.
    const mapping = config.quantityToDashboardMap || {};
    const quantityTasks = config.quantityTaskTypes || [];

    // 2. ✅ [수정] 현황판 항목 정의는 '제목' 조회를 위해서만 사용합니다.
    const allDefinitions = getAllDashboardDefinitions(config);

    // 3. ✅ [수정] 선택 가능한 '수량 현황판' 목록을 DOM에서 직접 읽어옵니다.
    const dashboardOptions = [];
    dashboardOptions.push(`<option value="">-- 연동 안 함 --</option>`);
    
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(itemSpan => {
        const id = itemSpan.dataset.id;
        const def = allDefinitions[id];
        
        // DOM에 있는 항목 중, 정의가 존재하고(def) 수량 항목(isQuantity)인 것만
        if (def && def.isQuantity) {
            // DOM에 표시된 텍스트(예: '국내송장(예상)')를 가져옵니다.
            const title = itemSpan.textContent.trim(); 
            dashboardOptions.push(`<option value="${id}">${title}</option>`);
        }
    });

    // 4. 처리량 업무 목록이 없으면 메시지 표시
    if (quantityTasks.length === 0) {
        container.innerHTML = `<p class="text-sm text-gray-500 text-center">'처리량 집계 업무'에 항목을 먼저 추가해주세요.</p>`;
        return;
    }
    
    // 5. '처리량 업무' 목록을 순회하며 행 생성
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
        
        // 6. 현재 저장된 값으로 <select> 값 설정
        const select = row.querySelector('.dashboard-mapping-select');
        if (select) {
            // 만약 저장된 값이 DOM에서 삭제되어 목록에 없더라도,
            // select.value는 자동으로 첫 번째(-- 연동 안 함 --) 항목을 선택하게 됩니다.
            select.value = currentSelection;
        }

        container.appendChild(row);
    });
}


// --- 이벤트 리스너 설정 ---

// [수정] 이벤트 리스너 설정 함수
function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
    document.getElementById('add-team-group-btn').addEventListener('click', addTeamGroup);

    // ✅ [수정] 현황판 항목 추가 버튼 리스너 (기존 + 커스텀)
    document.getElementById('add-dashboard-item-btn').addEventListener('click', openDashboardItemModal);
    document.getElementById('add-custom-dashboard-item-btn').addEventListener('click', addCustomDashboardItem); // 새 리스너

    // ✅ [수정] '주요 업무 추가' 버튼 리스너 (중복 제거 및 올바른 위치)
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
            // ✅ [수정] addDashboardItem 호출 부분을 render 후 재호출하도록 변경 (임시 추가 대응)
            // addDashboardItem(itemId); // 직접 DOM 추가 대신, appConfig 업데이트 후 다시 그림
            if (appConfig.dashboardItems && !appConfig.dashboardItems.includes(itemId)) {
                appConfig.dashboardItems.push(itemId);
                // ⛔️ [삭제] 아래 4줄 삭제 (dashboardQuantities는 더 이상 사용 안 함)
                // if (!itemId.startsWith('custom-')) {
                //    if (!appConfig.dashboardQuantities) appConfig.dashboardQuantities = {};
                //    appConfig.dashboardQuantities[itemId] = 0;
                // }
                renderDashboardItemsConfig(appConfig.dashboardItems, {}); // ✅ 빈 객체 전달
                // ✅ [FIX] 연동 설정 UI도 다시 렌더링
                renderQuantityToDashboardMapping(appConfig);
            } else {
                alert("이미 추가된 항목입니다.");
            }
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

// ✅ [수정] addTeamGroup 함수 (DOM 직접 추가 방식으로 변경)
function addTeamGroup() {
    const container = document.getElementById('team-groups-container');
    if (!container) return;

    // 새 그룹을 위한 데이터 (로컬 appConfig는 '저장' 시에만 업데이트)
    const newGroupName = '새 그룹';
    const newMemberName = '새 팀원';
    const defaultWage = appConfig.defaultPartTimerWage || 10000;

    // 새 그룹 DOM 생성
    const groupEl = document.createElement('div');
    groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card';
    
    // ✅ [수정] 새 멤버 HTML (역할 드롭다운 포함)
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
    
    // DOM에 추가
    container.appendChild(groupEl);

    // ✅ [추가] 방금 생성된 새 .members-container에 드래그 리스너 수동 부착
    const newMembersContainer = groupEl.querySelector('.members-container');
    if (newMembersContainer) {
        // setupDragDropListeners 함수는 여러 컨테이너를 대상으로 하므로,
        // 여기서는 단일 엘리먼트에 리스너를 붙이는 로직을 직접 수행하거나,
        // setupDragDropListeners가 단일 엘리먼트도 처리할 수 있게 해야 합니다.
        // 가장 간단한 해결책은 setupDragDropListeners를 다시 호출하는 것입니다.
        setupDragDropListeners('.members-container', '.member-item');
    }
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
// ✅ [수정] addTaskGroup 함수 (DOM 직접 추가 방식으로 변경)
function addTaskGroup() {
    const container = document.getElementById('task-groups-container');
    if (!container) return;

    // 새 그룹을 위한 데이터 (로컬 appConfig는 '저장' 시에만 업데이트)
    const newGroupName = `새 업무 그룹 ${container.children.length + 1}`;
    const newTaskName = '새 업무';

    // 새 그룹 DOM 생성
    const groupEl = document.createElement('div');
    groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
    
    // 새 업무 HTML
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
    
    // DOM에 추가
    container.appendChild(groupEl);

    // ✅ [추가] 방금 생성된 새 .tasks-container에 드래그 리스너 수동 부착
    // 및 새 input에 blur 리스너 부착
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


// ✅ [수정] 현황판 항목 추가 모달 열기 (모든 정의 사용)
function openDashboardItemModal() {
    const listContainer = document.getElementById('select-dashboard-item-list');
    listContainer.innerHTML = '';

    const currentItemIds = new Set();
    document.querySelectorAll('#dashboard-items-container .dashboard-item-name').forEach(item => {
        currentItemIds.add(item.dataset.id);
    });

    // ✅ [수정] 모든 정의 가져오기
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    let hasItemsToAdd = false;

    // ✅ [수정] 모든 정의를 순회하며 버튼 생성
    Object.keys(allDefinitions).sort((a, b) => allDefinitions[a].title.localeCompare(allDefinitions[b].title)).forEach(id => {
        const itemDef = allDefinitions[id];
        const isAlreadyAdded = currentItemIds.has(id);

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dashboard-item-select-btn w-full text-left p-2 rounded-md border focus:ring-2 focus:ring-blue-300';
        // ✅ [수정] 커스텀 항목 구분 표시 (선택 사항)
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
        // 이미 모든 항목이 추가된 경우, 추가 메시지 표시
         const noItemsMsg = document.createElement('p');
         noItemsMsg.className = 'text-gray-500 col-span-full text-center';
         noItemsMsg.textContent = '추가할 수 있는 항목이 없습니다.';
         listContainer.appendChild(noItemsMsg);
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

// ✅ [추가] 새 커스텀 수량 항목 추가 함수
function addCustomDashboardItem() {
    const newTitle = prompt("새로 추가할 수량 항목의 이름을 입력하세요:");
    if (!newTitle || newTitle.trim() === '') {
        alert("항목 이름은 비워둘 수 없습니다.");
        return;
    }
    const trimmedTitle = newTitle.trim();

    // ID 생성 (단순화: 현재 시간 + 랜덤 숫자) - 충돌 가능성 낮음
    const newId = `custom-${Date.now()}-${Math.random().toString(16).substring(2, 6)}`;

    // 모든 정의 가져와서 중복 타이틀 확인
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const titleExists = Object.values(allDefinitions).some(def => def.title.toLowerCase() === trimmedTitle.toLowerCase());
    if (titleExists) {
        alert("이미 같은 이름의 항목이 존재합니다.");
        return;
    }

    // appConfig에 커스텀 항목 정보 추가 (임시)
    if (!appConfig.dashboardCustomItems) appConfig.dashboardCustomItems = {};
    appConfig.dashboardCustomItems[newId] = { title: trimmedTitle, isQuantity: true };

    // ⛔️ [삭제] appConfig 수량 정보 초기화 (임시)
    // if (!appConfig.dashboardQuantities) appConfig.dashboardQuantities = {};
    // appConfig.dashboardQuantities[newId] = 0;

    // appConfig 아이템 목록에 추가 (임시) - UI 렌더링용
    if (!appConfig.dashboardItems) appConfig.dashboardItems = [];
    appConfig.dashboardItems.push(newId);

    // UI 즉시 업데이트 (전체 다시 그리기)
    renderDashboardItemsConfig(appConfig.dashboardItems, {}); // ✅ 빈 객체 전달
    // ✅ [FIX] 연동 설정 UI도 다시 렌더링
    renderQuantityToDashboardMapping(appConfig);

    alert(`'${trimmedTitle}' 항목이 추가되었습니다. '모든 변경사항 저장'을 눌러야 최종 반영됩니다.`);
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

    // ✅ [추가] 현황판 항목 삭제
    else if (e.target.classList.contains('delete-dashboard-item-btn')) {
        e.target.closest('.dashboard-item-config').remove();
        // ✅ [FIX] 연동 설정 UI를 다시 렌더링하여 드롭다운을 업데이트합니다.
        renderQuantityToDashboardMapping(appConfig);
    }
    
    // ✅ [추가] 설정 카드 접기/펴기
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
        return; // 토글 클릭 시 다른 동작(삭제 등) 방지
    }
    
    // 팀원 추가/삭제, 팀 그룹 삭제
    if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item';
        // newMemberEl.draggable = true; // [제거]
        // ✅ [수정] 이메일 및 역할 필드 추가
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


// ✅ [수정] 드래그 앤 드롭 설정 함수 (중복 부착 방지 로직 수정)
function setupDragDropListeners(containerSelector, itemSelector) {
    const containers = document.querySelectorAll(containerSelector);
    if (containers.length === 0) return;

    const listenerId = `drag-${itemSelector.replace('.', '')}`;

    containers.forEach(container => {
        // ✅ [수정] 중복 부착 방지: 이미 이 컨테이너(DOM element)에 리스너가 붙었는지 확인
        if (container.dataset.dragListenersAttached?.includes(listenerId)) {
            return;
        }
        // ✅ [수정] 리스너가 부착되었다고 표시
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
            
            // ✅ [수정] item의 부모가 이 리스너가 부착된 container와 일치하는지 확인
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
            // ✅ [수정] draggedItem이 있고, 그 부모가 이 container인지 확인
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
            
            // ✅ [수정] draggedItem이 있고, 그 부모가 이 container인지 확인
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
             // ✅ [수정] draggedItem이 있고, 그 부모가 이 container인지 확인
             if (!draggedItem || draggedItem.parentElement !== container) return;
             e.stopPropagation(); 
             // .drag-over 클래스 정리
             container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
         });

        // [drop] - 드롭했을 때
        container.addEventListener('drop', (e) => {
            // ✅ [수정] preventDefault()는 여기서도 필요함 (브라우저 기본 동작 방지)
            e.preventDefault(); 
            // ✅ [수정] draggedItem이 있고, 그 부모가 이 container인지 확인
            if (!draggedItem || draggedItem.parentElement !== container) return;
            e.stopPropagation(); 
            
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
            
            const afterElement = getDragAfterElement(container, e.clientY, itemSelector);
            
            if (afterElement) {
                container.insertBefore(draggedItem, afterElement);
            } else {
                container.appendChild(draggedItem);
            }

            // ✅ [FIX] 현황판 항목이 드롭되었을 때만 연동 UI 갱신
            if (containerSelector === '#dashboard-items-container') {
                renderQuantityToDashboardMapping(appConfig);
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
            memberEmails: {}, 
            memberRoles: {}, 
            dashboardItems: [],
            dashboardCustomItems: {}, 
            quantityToDashboardMap: {}, 
            keyTasks: [],
            taskGroups: [], // ✅ [수정] 객체 {} 에서 배열 [] 로 변경
            quantityTaskTypes: [],
            defaultPartTimerWage: 10000
        };
        
        // 0. [유지] 이메일 중복 검사 맵
        const emailCheck = new Map();
        let isEmailDuplicate = false;
        let duplicateEmailValue = '';

        // 1. [유지] 팀원 및 시급 정보 읽기 (순서 반영)
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
        
        // 1b. [유지] 이메일 중복 시 저장 차단
        if (isEmailDuplicate) {
            alert(`[저장 실패] 이메일 주소 '${duplicateEmailValue}'가 여러 팀원에게 중복 할당되었습니다. 이메일 주소는 고유해야 합니다.`);
            return; // 저장 중단
        }


        // 2. [유지] 현황판 항목 순서 및 커스텀 정의 읽기
        const allDefinitions = getAllDashboardDefinitions(appConfig); 
        document.querySelectorAll('#dashboard-items-container .dashboard-item-config').forEach(item => {
            const nameSpan = item.querySelector('.dashboard-item-name');
            if (nameSpan) {
                const id = nameSpan.dataset.id;
                newConfig.dashboardItems.push(id); // 순서 저장
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

        // 3. [유지] 주요 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
             const taskName = item.querySelector('.key-task-name').textContent.trim();
             if (taskName) newConfig.keyTasks.push(taskName);
        });


        // 4. ✅ [수정] 업무 정보 읽기 (순서 반영) - 배열 방식으로 저장
        // const orderedTaskGroups = {}; // (삭제)
        document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
            const groupNameInput = groupCard.querySelector('.task-group-name');
            const groupName = groupNameInput ? groupNameInput.value.trim() : '';
            if (!groupName) return;
            const tasks = [];
            groupCard.querySelectorAll('.task-item').forEach(taskItem => {
                const taskName = taskItem.querySelector('.task-name').value.trim();
                if (taskName) tasks.push(taskName);
            });
             // newConfig.taskGroups[groupName] = tasks; // (삭제)
             newConfig.taskGroups.push({ name: groupName, tasks: tasks }); // ✅ [수정] 배열에 객체로 추가
        });
        // newConfig.taskGroups = orderedTaskGroups; // (삭제)


        // 5. [유지] 처리량 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            const taskName = item.querySelector('.quantity-task-name').textContent.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // 6. [유지] 전역 설정 (알바 시급) 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // 7. [유지] 처리량-현황판 연동 맵 정보 읽기
        document.querySelectorAll('#quantity-mapping-container .mapping-row').forEach(row => {
            const taskName = row.dataset.taskName;
            const select = row.querySelector('.dashboard-mapping-select');
            const selectedId = select.value;
            if (taskName && selectedId) {
                newConfig.quantityToDashboardMap[taskName] = selectedId;
            }
        });

        // 8. ✅ [수정] 데이터 유효성 검사 (배열 구조 반영)
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
            return; // 저장 중단
        }

        // 9. [유지] Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        // 10. [유지] UI 다시 렌더링
        renderAdminUI(appConfig);
        setupEventListeners(); 

    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}

// ⛔️ [삭제] 기존 DOMContentLoaded 리스너 (파일 상단 근처로 이동)
/*
document.addEventListener('DOMContentLoaded', () => {
    // ... (기존 비밀번호 입력 로직) ...
});
*/

// ✅ [추가] 새로운 DOMContentLoaded 리스너 (Firebase Auth 기반)
document.addEventListener('DOMContentLoaded', () => {
    const adminContent = document.getElementById('admin-content');
    
    // 1. Firebase 초기화
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

    // 2. 인증 상태 감지
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // 3. 사용자가 로그인한 경우 -> 역할 확인
            try {
                // 설정 로드 (역할 정보 포함)
                appConfig = await loadAppConfig(db);
                
                const userEmail = user.email;
                if (!userEmail) {
                    throw new Error("로그인한 사용자의 이메일을 찾을 수 없습니다.");
                }

                const userEmailLower = user.email.toLowerCase();
                const memberRoles = appConfig.memberRoles || {};
                const currentUserRole = memberRoles[userEmailLower] || 'user';

                if (currentUserRole === 'admin') {
                    // 4a. 관리자 확인!
                    // (이전 initializeApp의 로직을 여기에 실행)
                    renderAdminUI(appConfig);
                    setupEventListeners();
                    adminContent.classList.remove('hidden'); // 컨텐츠 표시
                } else {
                    // 4b. 관리자가 아님
                    adminContent.innerHTML = `<h2 class="text-2xl font-bold text-yellow-600 p-8 text-center">접근 거부: 관리자 계정이 아닙니다.</h2>`;
                    adminContent.classList.remove('hidden');
                }
            } catch (e) {
                console.error("역할 확인 중 오류:", e);
                adminContent.innerHTML = `<h2 class="text-2xl font-bold text-red-600 p-8 text-center">오류 발생: ${e.message}</h2>`;
                adminContent.classList.remove('hidden');
            }
        } else {
            // 4c. 로그인하지 않음
            adminContent.innerHTML = `<h2 class="text-2xl font-bold text-gray-600 p-8 text-center">접근 거부: 로그인이 필요합니다.<br><br><a href="index.html" class="text-blue-600 hover:underline">메인 앱으로 이동하여 로그인하세요.</a></h2>`;
            adminContent.classList.remove('hidden');
        }
    });
});