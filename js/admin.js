// === admin.js (모든 섹션 및 하위 항목 드래그앤드랍 기능 수정) ===

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';

let db;
let appConfig = {};
const ADMIN_PASSWORD = "anffbxla123";

// 드래그 상태 관리 변수
let draggedItem = null;

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
        groupEl.draggable = true; // 그룹 카드 드래그

        // ✅ [수정] .member-item 에 draggable=true 및 핸들(☰) 추가
        const membersHtml = group.members.map((member, mIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item" draggable="true">
                <span class="drag-handle">☰</span>
                <input type="text" value="${member}" class="member-name" placeholder="팀원 이름">
                <label class="text-sm whitespace-nowrap">시급:</label>
                <input type="number" value="${memberWages[member] || 0}" class="member-wage w-28" placeholder="시급">
                <button class="btn btn-danger btn-small delete-member-btn" data-m-index="${mIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center">
                    <span class="drag-handle">☰</span> 
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
        // ✅ [수정] UI 통일성을 위해 배경색/테두리/그림자 추가 (문제 1 해결)
        taskEl.className = 'flex items-center gap-2 mb-2 p-2 rounded border bg-white shadow-sm hover:bg-gray-50 key-task-item';
        taskEl.dataset.index = index;
        taskEl.draggable = true;
        taskEl.innerHTML = `
            <span class="drag-handle">☰</span> <input type="text" value="${task}" class="key-task-name flex-grow">
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
        groupEl.draggable = true; // 그룹 카드 드래그

        // ✅ [수정] .task-item 에 draggable=true 및 핸들(☰) 추가, input에 flex-grow 추가
        const tasksHtml = tasks.map((task, tIndex) => `
            <div class="flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item" draggable="true">
                <span class="drag-handle">☰</span>
                <input type="text" value="${task}" class="task-name flex-grow">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-4">
                <div class="flex items-center"> 
                   <span class="drag-handle">☰</span>
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
        // ✅ [수정] UI 통일성을 위해 배경색/테두리/그림자 추가 (문제 1 해결)
        taskEl.className = 'flex items-center gap-2 mb-2 p-2 rounded border bg-white shadow-sm hover:bg-gray-50 quantity-task-item';
        taskEl.dataset.index = index;
        taskEl.draggable = true;
        taskEl.innerHTML = `
            <span class="drag-handle">☰</span> <input type="text" value="${task}" class="quantity-task-name flex-grow">
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

// --- 이벤트 리스너 설정 ---

function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);
    document.getElementById('add-team-group-btn').addEventListener('click', addTeamGroup);
    document.getElementById('add-key-task-btn').addEventListener('click', addKeyTask);
    document.getElementById('add-task-group-btn').addEventListener('click', addTaskGroup);
    document.getElementById('add-quantity-task-btn').addEventListener('click', addQuantityTask);

    document.body.addEventListener('click', handleDynamicClicks);

    // ✅ [수정] 모든 레벨의 드래그앤드롭 리스너 설정 (문제 2 해결)
    setupDragDropListeners('#team-groups-container', '.team-group-card'); // 1. 팀 그룹 (카드)
    setupDragDropListeners('.members-container', '.member-item'); // 2. 팀원 (항목)
    
    setupDragDropListeners('#key-tasks-container', '.key-task-item'); // 3. 주요 업무 (항목)
    
    setupDragDropListeners('#task-groups-container', '.task-group-card'); // 4. 업무 그룹 (카드)
    setupDragDropListeners('.tasks-container', '.task-item'); // 5. 업무 (항목)

    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item'); // 6. 처리량 업무 (항목)
}

// [추가] 동적 항목 추가 함수들
function addTeamGroup() {
    const newGroup = { name: '새 그룹', members: ['새 팀원'] };
    appConfig.teamGroups = appConfig.teamGroups || [];
    appConfig.teamGroups.push(newGroup);
    if (!appConfig.memberWages) appConfig.memberWages = {};
    appConfig.memberWages['새 팀원'] = appConfig.defaultPartTimerWage || 10000;
    // ✅ [수정] 렌더링 후 리스너 재설정
    renderTeamGroups(appConfig.teamGroups, appConfig.memberWages);
    setupDragDropListeners('.members-container', '.member-item'); // 새로 생긴 .members-container에 리스너 추가
}

function addKeyTask() {
    appConfig.keyTasks = appConfig.keyTasks || [];
    appConfig.keyTasks.push('새 주요 업무');
    renderKeyTasks(appConfig.keyTasks);
    // (키 태스크는 컨테이너가 1개라 setupEventListeners에서 이미 처리됨)
}

function addTaskGroup() {
    const newGroupName = `새 업무 그룹 ${Object.keys(appConfig.taskGroups || {}).length + 1}`;
    if (!appConfig.taskGroups) appConfig.taskGroups = {};
    appConfig.taskGroups[newGroupName] = ['새 업무'];
    // ✅ [수정] 렌더링 후 리스너 재설정
    renderTaskGroups(appConfig.taskGroups);
    setupDragDropListeners('.tasks-container', '.task-item'); // 새로 생긴 .tasks-container에 리스너 추가
}

function addQuantityTask() {
    appConfig.quantityTaskTypes = appConfig.quantityTaskTypes || [];
    appConfig.quantityTaskTypes.push('새 처리량 업무');
    renderQuantityTasks(appConfig.quantityTaskTypes);
    // (처리량 태스크는 컨테이너가 1개라 setupEventListeners에서 이미 처리됨)
}

// [수정] 동적 클릭 이벤트 핸들러 분리
function handleDynamicClicks(e) {
    // 팀원 추가/삭제, 팀 그룹 삭제
    if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 member-item'; // ✅ 스타일 일치
        newMemberEl.draggable = true; // ✅ 드래그 가능
        newMemberEl.innerHTML = `
            <span class="drag-handle">☰</span> {/* ✅ 핸들 추가 */}
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
        newTaskEl.className = 'flex items-center gap-2 mb-2 p-1 rounded hover:bg-gray-100 task-item'; // ✅ 스타일 일치
        newTaskEl.draggable = true; // ✅ 드래그 가능
        newTaskEl.innerHTML = `
            <span class="drag-handle">☰</span> {/* ✅ 핸들 추가 */}
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

// ✅ [수정] 드래그 앤 드롭 설정 함수 (로직 대폭 수정)
function setupDragDropListeners(containerSelector, itemSelector) {
    // 1. [수정] 여러 컨테이너(예: .members-container)에 적용하기 위해 querySelectorAll 사용
    const containers = document.querySelectorAll(containerSelector);
    if (containers.length === 0) return;

    containers.forEach(container => {
        // 2. [수정] 중복 리스너 부착 방지 (고유 ID 사용)
        const listenerId = `drag-${itemSelector}`;
        if (container.dataset.dragListenersAttached?.includes(listenerId)) {
            return;
        }
        container.dataset.dragListenersAttached = (container.dataset.dragListenersAttached || '') + listenerId;


        container.addEventListener('dragstart', (e) => {
            const item = e.target.closest(itemSelector);

            // 3. [수정] 핸들(☰)을 클릭했을 때만 드래그 시작 (Input 등 방해 방지)
            if (!item || !e.target.classList.contains('drag-handle')) {
                e.preventDefault();
                return;
            }

            // 4. [수정] 이벤트 버블링 방지: 리스너가 부착된 컨테이너의 '직계 자식' 아이템이 맞는지 확인
            // (예: #team-groups-container(상위) 리스너가 .member-item(하위) 이벤트를 무시하도록)
            if (item.parentElement !== container) {
                return;
            }

            draggedItem = item;
            setTimeout(() => draggedItem.classList.add('dragging'), 0);
            e.dataTransfer.effectAllowed = 'move';
        });

        container.addEventListener('dragend', (e) => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
            }
            // 모든 드래그 오버 효과 제거
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        });

        container.addEventListener('dragover', (e) => {
            e.preventDefault();
            const targetItem = e.target.closest(itemSelector);
            
            // 이 컨테이너 내의 항목인지 확인
            if (targetItem && targetItem !== draggedItem && targetItem.parentElement === container) {
                 // 기존 효과 지우기 (같은 컨테이너 내에서만)
                 container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
                 targetItem.classList.add('drag-over'); // 드롭 위치 시각적 피드백
            }
        });

         container.addEventListener('dragleave', (e) => {
             const targetItem = e.target.closest(itemSelector);
             if (targetItem) {
                 targetItem.classList.remove('drag-over');
             }
         });


        container.addEventListener('drop', (e) => {
            e.preventDefault();
            const targetItem = e.target.closest(itemSelector);
            document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

            // 5. [수정] 드롭 유효성 검사 (반드시 같은 컨테이너 내에서만 이동)
            if (targetItem && draggedItem && targetItem !== draggedItem && 
                targetItem.parentElement === container && 
                draggedItem.parentElement === container) 
            {
                const children = Array.from(container.children);
                const draggedIndex = children.indexOf(draggedItem);
                const targetIndex = children.indexOf(targetItem);

                // 삽입
                if (draggedIndex < targetIndex) {
                    container.insertBefore(draggedItem, targetItem.nextSibling);
                } else {
                    container.insertBefore(draggedItem, targetItem);
                }
            }

            if (draggedItem) {
               draggedItem.classList.remove('dragging');
            }
            draggedItem = null;
        });
    }); // end containers.forEach
}


// --- 데이터 저장 ---

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
            
            // ✅ [수정] DOM에서 순서대로 읽기 (이미 올바르게 되어 있었음)
            groupCard.querySelectorAll('.member-item').forEach(memberItem => {
                const memberName = memberItem.querySelector('.member-name').value.trim();
                const memberWage = Number(memberItem.querySelector('.member-wage').value) || 0;
                if (!memberName) return;

                newGroup.members.push(memberName);
                newConfig.memberWages[memberName] = memberWage;
            });
            newConfig.teamGroups.push(newGroup);
        });

        // 2. 주요 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
             const taskName = item.querySelector('.key-task-name').value.trim();
             if (taskName) newConfig.keyTasks.push(taskName);
        });


        // 3. 업무 정보 읽기 (순서 반영)
        const orderedTaskGroups = {};
        document.querySelectorAll('#task-groups-container .task-group-card').forEach(groupCard => {
            const groupNameInput = groupCard.querySelector('.task-group-name');
            const groupName = groupNameInput ? groupNameInput.value.trim() : '';
            if (!groupName) return;

            const tasks = [];
            // ✅ [수정] DOM에서 순서대로 읽기 (이미 올바르게 되어 있었음)
            groupCard.querySelectorAll('.task-item').forEach(taskItem => {
                const taskName = taskItem.querySelector('.task-name').value.trim();
                if (taskName) tasks.push(taskName);
            });
             orderedTaskGroups[groupName] = tasks;
        });
        newConfig.taskGroups = orderedTaskGroups;


        // 4. 처리량 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            const taskName = item.querySelector('.quantity-task-name').value.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // 5. 전역 설정 (알바 시급) 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // 6. Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        // 7. UI 다시 렌더링 (리스너 재설정 포함)
        renderAdminUI(appConfig);
        // 렌더링 함수가 내부 컨테이너(.members-container 등)를 다시 만들었으므로,
        // 리스너를 다시 설정해줘야 합니다.
        setupEventListeners();


    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}