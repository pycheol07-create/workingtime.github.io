// === admin.js (모달 추가, 수정 기능, 삭제 확인 추가) ===

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';

let db;
let appConfig = {};
const ADMIN_PASSWORD = "anffbxla123";

// 드래그 상태 관리 변수
let draggedItem = null;

// 모달 상태 관리 변수
let currentModalTarget = null; // 'key' 또는 'quantity'
let taskJustAdded = null; // '업무 관리'에서 방금 추가한 업무 이름

// [추가] 삭제 확인 모달 관련 변수
let taskToDeleteInfo = { name: null, element: null, source: null }; // source: 'taskManagement'

// 드롭 위치 계산 헬퍼 함수
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

// '업무 관리' 섹션에서 모든 업무 이름 가져오기 (그룹 포함)
function getAllTaskNamesFromDOM(includeGroups = false) {
    const tasks = [];
    document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
        const groupName = groupCard.querySelector('.task-group-name')?.value.trim();
        const groupTasks = [];
        groupCard.querySelectorAll('.task-item .task-name').forEach(input => {
            const taskName = input.value.trim();
            if (taskName) {
                if (includeGroups) {
                    groupTasks.push({ name: taskName, group: groupName || '미분류' });
                } else {
                    groupTasks.push(taskName);
                }
            }
        });
        tasks.push(...groupTasks);
    });
     // 그룹 없는 단순 이름 목록 반환 시 Set으로 중복 제거 후 배열 반환
    return includeGroups ? tasks : Array.from(new Set(tasks));
}

// '처리량 집계 업무 관리' 섹션에서 모든 업무 이름 가져오기
function getAllQuantityTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#quantity-tasks-container .quantity-task-item .task-name-display').forEach(span => { // [수정] .task-name-display span에서 읽기
        const taskName = span.textContent.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}

// '주요 업무 관리' 섹션에서 모든 업무 이름 가져오기
function getAllKeyTaskNamesFromDOM() {
    const taskNames = new Set();
    document.querySelectorAll('#key-tasks-container .key-task-item .task-name-display').forEach(span => { // [수정] .task-name-display span에서 읽기
        const taskName = span.textContent.trim();
        if (taskName) taskNames.add(taskName);
    });
    return Array.from(taskNames);
}


// [수정] '업무 선택' 모달 내용 채우기 (그룹별 분류)
function populateTaskSelectModal() {
    const allTasksWithGroups = getAllTaskNamesFromDOM(true); // 그룹 정보 포함하여 가져오기
    const listContainer = document.getElementById('select-task-list');
    const modalTitle = document.getElementById('select-task-modal-title');

    if (!listContainer || !modalTitle) return;

    listContainer.innerHTML = ''; // 초기화

    if (currentModalTarget === 'key') {
        modalTitle.textContent = "주요 업무로 추가할 업무 선택";
    } else if (currentModalTarget === 'quantity') {
        modalTitle.textContent = "처리량 집계 업무로 추가할 업무 선택";
    }

    if (allTasksWithGroups.length === 0) {
        listContainer.innerHTML = '<p class="text-gray-500 col-span-full text-center">먼저 \'업무 관리\' 섹션에서 업무를 1개 이상 등록해주세요.</p>';
        return;
    }

    // 그룹별로 업무 분류
    const tasksByGroup = allTasksWithGroups.reduce((acc, task) => {
        const group = task.group || '미분류';
        if (!acc[group]) acc[group] = [];
        acc[group].push(task.name);
        return acc;
    }, {});

    // 그룹 순서 (필요 시 조정)
    const groupOrder = Object.keys(tasksByGroup).sort((a,b) => a.localeCompare(b));

    // 그룹별로 렌더링
    groupOrder.forEach(groupName => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex-1 min-w-[150px]'; // flex-1 추가
        const tasksHtml = tasksByGroup[groupName]
            .sort((a,b) => a.localeCompare(b))
            .map(taskName => `<button type="button" data-task-name="${taskName}" class="task-select-list-btn w-full text-left p-2 rounded-md border btn-secondary focus:ring-2 focus:ring-blue-300">${taskName}</button>`)
            .join('');

        groupDiv.innerHTML = `
            <div class="bg-gray-50 rounded-lg border h-full">
                <h3 class="text-sm font-bold text-gray-700 mb-0 p-2 border-b bg-gray-100 rounded-t-lg">${groupName}</h3>
                <div class="p-2 grid grid-cols-1 gap-1">${tasksHtml}</div>
            </div>
        `;
        listContainer.appendChild(groupDiv);
    });
}


document.addEventListener('DOMContentLoaded', () => {
    // 비밀번호 관련 코드... (동일)
    const passwordPrompt = document.getElementById('password-prompt');
    const passwordInput = document.getElementById('admin-password');
    const passwordSubmitBtn = document.getElementById('password-submit-btn');
    const adminContent = document.getElementById('admin-content');

    const attemptLogin = () => { /* ... */ }; // 내용은 동일
    passwordSubmitBtn.addEventListener('click', attemptLogin);
    passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(); });

    const initializeApp = async () => { /* ... */ }; // 내용은 동일
});

// --- UI 렌더링 ---
function renderAdminUI(config) { /* ... */ } // 내용은 동일
function renderTeamGroups(teamGroups, memberWages) { /* ... */ } // 내용은 동일

// [수정] renderKeyTasks 함수 (텍스트 + 수정 버튼 + 드롭다운 추가)
function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    container.innerHTML = '';
    const allTaskOptions = getAllTaskNamesFromDOM(); // 드롭다운 옵션용

    keyTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 key-task-item';
        taskEl.dataset.index = index;
        taskEl.dataset.originalTask = task; // 원래 값 저장

        const optionsHtml = allTaskOptions
            .map(opt => `<option value="${opt}" ${opt === task ? 'selected' : ''}>${opt}</option>`)
            .join('');

        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <span class="task-name-display flex-grow">${task}</span>
            <select class="task-name-edit flex-grow hidden">
                ${optionsHtml}
            </select>
            <div class="task-actions">
                <button class="edit-task-btn" title="수정">✏️</button>
                <button class="save-task-btn hidden" title="저장">✔️</button>
                <button class="cancel-task-btn hidden" title="취소">❌</button>
                <button class="btn btn-danger btn-small delete-key-task-btn" data-index="${index}">삭제</button>
            </div>
        `;
        container.appendChild(taskEl);
    });
}

function renderTaskGroups(taskGroups) { /* ... */ } // 내용은 동일

// [수정] renderQuantityTasks 함수 (텍스트 + 수정 버튼 + 드롭다운 추가)
function renderQuantityTasks(quantityTasks) {
    const container = document.getElementById('quantity-tasks-container');
    container.innerHTML = '';
    const allTaskOptions = getAllTaskNamesFromDOM(); // 드롭다운 옵션용

    quantityTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 quantity-task-item';
        taskEl.dataset.index = index;
        taskEl.dataset.originalTask = task; // 원래 값 저장

        const optionsHtml = allTaskOptions
            .map(opt => `<option value="${opt}" ${opt === task ? 'selected' : ''}>${opt}</option>`)
            .join('');

        taskEl.innerHTML = `
            <span class="drag-handle" draggable="true">☰</span>
            <span class="task-name-display flex-grow">${task}</span>
            <select class="task-name-edit flex-grow hidden">
                ${optionsHtml}
            </select>
            <div class="task-actions">
                <button class="edit-task-btn" title="수정">✏️</button>
                <button class="save-task-btn hidden" title="저장">✔️</button>
                <button class="cancel-task-btn hidden" title="취소">❌</button>
                <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
            </div>
        `;
        container.appendChild(taskEl);
    });
}


// --- 이벤트 리스너 설정 ---
// [수정] 이벤트 리스너 설정 함수
function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
    document.getElementById('add-team-group-btn').addEventListener('click', addTeamGroup);

    // '주요 업무 추가' 버튼 리스너
    document.getElementById('add-key-task-btn').addEventListener('click', () => {
        currentModalTarget = 'key';
        populateTaskSelectModal();
        document.getElementById('select-task-modal').classList.remove('hidden');
    });

    document.getElementById('add-task-group-btn').addEventListener('click', addTaskGroup);

    // '처리량 업무 추가' 버튼 리스너
    document.getElementById('add-quantity-task-btn').addEventListener('click', () => {
        currentModalTarget = 'quantity';
        populateTaskSelectModal();
        document.getElementById('select-task-modal').classList.remove('hidden');
    });

    // 동적 클릭 핸들러 (모달 닫기, 수정 버튼 등 포함)
    document.body.addEventListener('click', handleDynamicClicks);

    // '업무 선택' 모달에서 업무 클릭 시
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

    // '처리량 집계 추가' 확인 모달 버튼
    document.getElementById('confirm-add-to-quantity-btn').addEventListener('click', () => {
        if (taskJustAdded) {
            addQuantityTask(taskJustAdded); // 추가 함수 호출
        }
        document.getElementById('confirm-add-to-quantity-modal').classList.add('hidden');
        taskJustAdded = null;
    });
    document.getElementById('cancel-add-to-quantity-btn').addEventListener('click', () => {
        document.getElementById('confirm-add-to-quantity-modal').classList.add('hidden');
        taskJustAdded = null;
    });

    // [추가] '연결된 업무 삭제' 확인 모달 버튼
    document.getElementById('confirm-delete-everywhere-btn').addEventListener('click', () => {
        const { name, element, source } = taskToDeleteInfo;
        if (element && source === 'taskManagement') {
            // 1. '업무 관리'에서 삭제
            element.remove();
            // 2. '주요 업무'에서도 삭제 (DOM 직접 조작)
            document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
                if (item.querySelector('.task-name-display').textContent === name) {
                    item.remove();
                }
            });
            // 3. '처리량 집계'에서도 삭제 (DOM 직접 조작)
            document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
                if (item.querySelector('.task-name-display').textContent === name) {
                    item.remove();
                }
            });
        }
        document.getElementById('confirm-delete-linked-task-modal').classList.add('hidden');
        taskToDeleteInfo = { name: null, element: null, source: null };
    });
    document.getElementById('confirm-delete-here-btn').addEventListener('click', () => {
        const { element, source } = taskToDeleteInfo;
        // '업무 관리'에서만 삭제
        if (element && source === 'taskManagement') {
            element.remove();
        }
        document.getElementById('confirm-delete-linked-task-modal').classList.add('hidden');
        taskToDeleteInfo = { name: null, element: null, source: null };
    });
    document.getElementById('cancel-delete-linked-task-btn').addEventListener('click', () => {
        document.getElementById('confirm-delete-linked-task-modal').classList.add('hidden');
        taskToDeleteInfo = { name: null, element: null, source: null };
    });


    // 드래그앤드롭 리스너 설정 (동일)
    setupDragDropListeners('#team-groups-container', '.team-group-card');
    setupDragDropListeners('.members-container', '.member-item');
    setupDragDropListeners('#key-tasks-container', '.key-task-item');
    setupDragDropListeners('#task-groups-container', '.task-group-card');
    setupDragDropListeners('.tasks-container', '.task-item');
    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item');
}

// ... (addTeamGroup 함수는 이전과 동일) ...
function addTeamGroup() { /* ... */ }

// [수정] addKeyTask 함수 (중복 체크 강화)
function addKeyTask(taskName) {
    const nameToAdd = taskName?.trim();
    if (!nameToAdd) return; // 이름 없으면 무시

    // 현재 DOM 기준으로 중복 확인
    const existingTasks = getAllKeyTaskNamesFromDOM().map(t => t.toLowerCase());
    if (existingTasks.includes(nameToAdd.toLowerCase())) {
        alert("이미 '주요 업무'에 등록된 업무입니다.");
        return;
    }

    // 새 항목 추가 (renderKeyTasks를 직접 호출하지 않고 DOM에 직접 추가)
    const container = document.getElementById('key-tasks-container');
    const allTaskOptions = getAllTaskNamesFromDOM();
    const optionsHtml = allTaskOptions
        .map(opt => `<option value="${opt}" ${opt === nameToAdd ? 'selected' : ''}>${opt}</option>`)
        .join('');

    const taskEl = document.createElement('div');
    taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 key-task-item';
    taskEl.dataset.originalTask = nameToAdd; // 원래 값 저장
    taskEl.innerHTML = `
        <span class="drag-handle" draggable="true">☰</span>
        <span class="task-name-display flex-grow">${nameToAdd}</span>
        <select class="task-name-edit flex-grow hidden">
            ${optionsHtml}
        </select>
        <div class="task-actions">
            <button class="edit-task-btn" title="수정">✏️</button>
            <button class="save-task-btn hidden" title="저장">✔️</button>
            <button class="cancel-task-btn hidden" title="취소">❌</button>
            <button class="btn btn-danger btn-small delete-key-task-btn">삭제</button>
        </div>
    `;
    container.appendChild(taskEl);

    // appConfig 업데이트 (저장 시 사용됨) - 배열 직접 수정
    appConfig.keyTasks = appConfig.keyTasks || [];
    appConfig.keyTasks.push(nameToAdd);

}

// ... (addTaskGroup 함수는 이전과 동일) ...
function addTaskGroup() { /* ... */ }

// [수정] addQuantityTask 함수 (중복 체크 강화)
function addQuantityTask(taskName) {
    const nameToAdd = taskName?.trim();
    if (!nameToAdd) return; // 이름 없으면 무시

    // 현재 DOM 기준으로 중복 확인
    const existingTasks = getAllQuantityTaskNamesFromDOM().map(t => t.toLowerCase());
    if (existingTasks.includes(nameToAdd.toLowerCase())) {
        if (taskJustAdded === taskName) return; // 'confirm' 모달에서 추가 시 중복이면 조용히 무시
        alert("이미 '처리량 집계 업무'에 등록된 업무입니다.");
        return;
    }

    // 새 항목 추가 (renderQuantityTasks를 직접 호출하지 않고 DOM에 직접 추가)
    const container = document.getElementById('quantity-tasks-container');
    const allTaskOptions = getAllTaskNamesFromDOM();
    const optionsHtml = allTaskOptions
        .map(opt => `<option value="${opt}" ${opt === nameToAdd ? 'selected' : ''}>${opt}</option>`)
        .join('');

    const taskEl = document.createElement('div');
    taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 quantity-task-item';
    taskEl.dataset.originalTask = nameToAdd; // 원래 값 저장
    taskEl.innerHTML = `
        <span class="drag-handle" draggable="true">☰</span>
        <span class="task-name-display flex-grow">${nameToAdd}</span>
        <select class="task-name-edit flex-grow hidden">
            ${optionsHtml}
        </select>
        <div class="task-actions">
            <button class="edit-task-btn" title="수정">✏️</button>
            <button class="save-task-btn hidden" title="저장">✔️</button>
            <button class="cancel-task-btn hidden" title="취소">❌</button>
            <button class="btn btn-danger btn-small delete-quantity-task-btn">삭제</button>
        </div>
    `;
    container.appendChild(taskEl);

    // appConfig 업데이트 (저장 시 사용됨) - 배열 직접 수정
    appConfig.quantityTaskTypes = appConfig.quantityTaskTypes || [];
    appConfig.quantityTaskTypes.push(nameToAdd);
}

// '업무 관리'에서 '새 업무' 추가 후 이름 변경 시(blur) 호출될 함수 (동일)
function handleNewTaskNameBlur(e) { /* ... */ }

// [추가] 수정 모드 진입 함수
function enterEditMode(itemElement) {
    const taskDisplay = itemElement.querySelector('.task-name-display');
    const taskEditSelect = itemElement.querySelector('.task-name-edit');
    const actionsDiv = itemElement.querySelector('.task-actions');
    const editBtn = actionsDiv.querySelector('.edit-task-btn');
    const saveBtn = actionsDiv.querySelector('.save-task-btn');
    const cancelBtn = actionsDiv.querySelector('.cancel-task-btn');
    const deleteBtn = actionsDiv.querySelector('.delete-key-task-btn, .delete-quantity-task-btn'); // 삭제 버튼 클래스 확인

    // 현재 값을 select의 기본값으로 설정
    taskEditSelect.value = taskDisplay.textContent;
    itemElement.dataset.originalTask = taskDisplay.textContent; // 수정 취소 대비

    taskDisplay.classList.add('hidden');
    taskEditSelect.classList.remove('hidden');
    editBtn.classList.add('hidden');
    deleteBtn.classList.add('hidden'); // 수정 중에는 삭제 버튼 숨김
    saveBtn.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
}

// [추가] 수정 모드 종료 함수 (저장 또는 취소)
function exitEditMode(itemElement, saveChanges = false) {
    const taskDisplay = itemElement.querySelector('.task-name-display');
    const taskEditSelect = itemElement.querySelector('.task-name-edit');
    const actionsDiv = itemElement.querySelector('.task-actions');
    const editBtn = actionsDiv.querySelector('.edit-task-btn');
    const saveBtn = actionsDiv.querySelector('.save-task-btn');
    const cancelBtn = actionsDiv.querySelector('.cancel-task-btn');
    const deleteBtn = actionsDiv.querySelector('.delete-key-task-btn, .delete-quantity-task-btn');

    if (saveChanges) {
        const newTaskName = taskEditSelect.value;
        // 중복 체크 (자신 제외)
        const parentContainerId = itemElement.closest('div[id$="-container"]').id;
        let existingTasks = [];
        if (parentContainerId === 'key-tasks-container') {
            existingTasks = getAllKeyTaskNamesFromDOM();
        } else if (parentContainerId === 'quantity-tasks-container') {
            existingTasks = getAllQuantityTaskNamesFromDOM();
        }
        
        const isDuplicate = existingTasks.some(task => 
            task.toLowerCase() === newTaskName.toLowerCase() && task !== itemElement.dataset.originalTask
        );

        if (isDuplicate) {
            alert("이미 목록에 존재하는 업무 이름입니다. 다른 이름을 선택해주세요.");
            return false; // 변경사항 저장 실패, 수정 모드 유지 안 함 (필요시 수정)
        }
        taskDisplay.textContent = newTaskName; // 화면 업데이트
        itemElement.dataset.originalTask = newTaskName; // 원본 값도 업데이트
    } else {
        // 취소 시 원래 값으로 복원 (DOM 업데이트 필요 없음, select 숨기기만)
    }

    taskDisplay.classList.remove('hidden');
    taskEditSelect.classList.add('hidden');
    editBtn.classList.remove('hidden');
    deleteBtn.classList.remove('hidden');
    saveBtn.classList.add('hidden');
    cancelBtn.classList.add('hidden');
    return true; // 성공
}

// [수정] handleDynamicClicks 함수 (수정 버튼, 업무 삭제 로직 변경)
function handleDynamicClicks(e) {
    const closeBtn = e.target.closest('.modal-close-btn');
    if (closeBtn) { /* ... 모달 닫기 로직 (동일) ... */ }

    // 팀원 추가/삭제, 팀 그룹 삭제 (동일)
    if (e.target.classList.contains('add-member-btn')) { /* ... */ }
    else if (e.target.classList.contains('delete-member-btn')) { /* ... */ }
    else if (e.target.classList.contains('delete-team-group-btn')) { /* ... */ }

    // [수정] 주요 업무 삭제 버튼 (클래스 변경됨)
    else if (e.target.classList.contains('delete-key-task-btn')) {
        e.target.closest('.key-task-item').remove();
    }
    // [추가] 주요 업무 수정 버튼
    else if (e.target.classList.contains('edit-task-btn') && e.target.closest('.key-task-item')) {
        enterEditMode(e.target.closest('.key-task-item'));
    }
    // [추가] 주요 업무 수정 저장 버튼
    else if (e.target.classList.contains('save-task-btn') && e.target.closest('.key-task-item')) {
        exitEditMode(e.target.closest('.key-task-item'), true);
    }
    // [추가] 주요 업무 수정 취소 버튼
    else if (e.target.classList.contains('cancel-task-btn') && e.target.closest('.key-task-item')) {
        exitEditMode(e.target.closest('.key-task-item'), false);
    }

    // 업무 추가/삭제, 업무 그룹 삭제
    else if (e.target.classList.contains('add-task-btn')) { /* ... blur 이벤트 추가 로직 (동일) ... */ }
    // [수정] '업무 관리'의 업무 삭제 버튼
    else if (e.target.classList.contains('delete-task-btn')) {
        const taskItemElement = e.target.closest('.task-item');
        const taskNameInput = taskItemElement.querySelector('.task-name');
        const taskNameToDelete = taskNameInput.value.trim();

        if (taskNameToDelete) {
            const isUsedInKeyTasks = getAllKeyTaskNamesFromDOM().includes(taskNameToDelete);
            const isUsedInQuantityTasks = getAllQuantityTaskNamesFromDOM().includes(taskNameToDelete);

            if (isUsedInKeyTasks || isUsedInQuantityTasks) {
                // 다른 목록에서 사용 중이면 확인 모달 띄우기
                taskToDeleteInfo = { name: taskNameToDelete, element: taskItemElement, source: 'taskManagement' };
                const msgEl = document.getElementById('confirm-delete-linked-task-message');
                let usedIn = [];
                if (isUsedInKeyTasks) usedIn.push("'주요 업무'");
                if (isUsedInQuantityTasks) usedIn.push("'처리량 집계'");
                if (msgEl) msgEl.textContent = `삭제하려는 '${taskNameToDelete}' 업무는 ${usedIn.join(', ')} 목록에서도 사용되고 있습니다. 어떻게 삭제하시겠습니까?`;
                document.getElementById('confirm-delete-linked-task-modal').classList.remove('hidden');
            } else {
                // 다른 곳에서 사용 안 되면 바로 삭제
                taskItemElement.remove();
            }
        } else {
            // 이름 없는 항목은 그냥 삭제
            taskItemElement.remove();
        }
    } else if (e.target.classList.contains('delete-task-group-btn')) {
        e.target.closest('.task-group-card').remove();
    }

    // [수정] 처리량 업무 삭제 버튼 (클래스 변경됨)
    else if (e.target.classList.contains('delete-quantity-task-btn')) {
        e.target.closest('.quantity-task-item').remove();
    }
    // [추가] 처리량 업무 수정 버튼
    else if (e.target.classList.contains('edit-task-btn') && e.target.closest('.quantity-task-item')) {
        enterEditMode(e.target.closest('.quantity-task-item'));
    }
    // [추가] 처리량 업무 수정 저장 버튼
    else if (e.target.classList.contains('save-task-btn') && e.target.closest('.quantity-task-item')) {
        exitEditMode(e.target.closest('.quantity-task-item'), true);
    }
    // [추가] 처리량 업무 수정 취소 버튼
    else if (e.target.classList.contains('cancel-task-btn') && e.target.closest('.quantity-task-item')) {
        exitEditMode(e.target.closest('.quantity-task-item'), false);
    }
}

// === admin.js (이어서) ===

// 드래그 앤 드롭 설정 함수 (동일)
function setupDragDropListeners(containerSelector, itemSelector) { /* ... */ }

// --- 데이터 저장 ---
// [수정] handleSaveAll (읽는 방식 변경, 유효성 검사 위치 변경)
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

        // 1. 팀원 및 시급 정보 읽기 (순서 반영) - 동일
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

        // 2. 주요 업무 정보 읽기 (순서 반영) - [수정] span에서 읽기
        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
             const taskName = item.querySelector('.task-name-display').textContent.trim(); // span에서 읽기
             if (taskName) newConfig.keyTasks.push(taskName);
        });

        // 3. 업무 정보 읽기 (순서 반영) - 동일
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


        // 4. 처리량 업무 정보 읽기 (순서 반영) - [수정] span에서 읽기
        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            const taskName = item.querySelector('.task-name-display').textContent.trim(); // span에서 읽기
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // 5. 전역 설정 (알바 시급) 읽기 - 동일
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // [이동 및 유지] 6. 데이터 유효성 검사
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
            errorMsg += "오류가 있는 항목을 수정하거나 '업무 관리' 섹션에 해당 업무를 먼저 추가해주세요.";
            alert(errorMsg);
            return; // 저장 중단
        }


        // 7. Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        // 8. UI 다시 렌더링 (리스너 재설정 포함)
        // [주의] 저장 성공 후에는 UI를 다시 렌더링해야 DOM과 appConfig 상태가 일치합니다.
        // 하지만 이렇게 하면 수정 중이던 상태가 초기화될 수 있습니다.
        // 지금은 일단 저장 후 새로고침하는 방식으로 유지합니다.
        renderAdminUI(appConfig);
        setupEventListeners();


    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}