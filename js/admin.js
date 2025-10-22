// === admin.js (주요 업무 및 처리량 업무 순서 변경 기능 추가) ===

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
    renderKeyTasks(config.keyTasks || []); // [추가]
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
            <div class="flex items-center gap-2 mb-2 member-item">
                <input type="text" value="${member}" class="member-name" placeholder="팀원 이름">
                <label class="text-sm whitespace-nowrap">시급:</label>
                <input type="number" value="${memberWages[member] || 0}" class="member-wage w-28" placeholder="시급">
                <button class="btn btn-danger btn-small delete-member-btn" data-m-index="${mIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <input type="text" value="${group.name}" class="text-lg font-semibold team-group-name w-1/3">
                <button class="btn btn-danger btn-small delete-team-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 members-container">${membersHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-member-btn">+ 팀원 추가</button>
        `;
        container.appendChild(groupEl);
    });
}

// [추가] 주요 업무 렌더링 함수
function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    container.innerHTML = '';
    keyTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        // [수정] draggable 속성 추가 및 스타일링
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 key-task-item';
        taskEl.dataset.index = index;
        taskEl.draggable = true; // 드래그 가능하게
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
    Object.entries(taskGroups).forEach(([groupName, tasks], index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;
        groupEl.draggable = true; // 그룹 카드 드래그 가능하게

        const tasksHtml = tasks.map((task, tIndex) => `
            <div class="flex items-center gap-2 mb-2 task-item">
                <input type="text" value="${task}" class="task-name">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
             <div class="flex justify-between items-center mb-4">
                <div class="flex items-center"> <span class="drag-handle cursor-move text-gray-400 hover:text-gray-600 mr-2 text-xl -mt-1">☰</span>
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
        // [수정] draggable 속성 추가 및 스타일링
        taskEl.className = 'flex items-center gap-2 mb-1 p-1 rounded hover:bg-gray-100 quantity-task-item';
        taskEl.dataset.index = index;
        taskEl.draggable = true; // 드래그 가능하게
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
    document.getElementById('add-key-task-btn').addEventListener('click', addKeyTask); // [추가]
    document.getElementById('add-task-group-btn').addEventListener('click', addTaskGroup);
    document.getElementById('add-quantity-task-btn').addEventListener('click', addQuantityTask);

    document.body.addEventListener('click', handleDynamicClicks);

    // [추가] 드래그 앤 드롭 이벤트 리스너 (주요 업무, 처리량 업무, 업무 그룹)
    setupDragDropListeners('#key-tasks-container', '.key-task-item');
    setupDragDropListeners('#quantity-tasks-container', '.quantity-task-item');
    setupDragDropListeners('#task-groups-container', '.task-group-card'); // 업무 그룹 순서 변경
}

// [추가] 동적 항목 추가 함수들
function addTeamGroup() {
    const newGroup = { name: '새 그룹', members: ['새 팀원'] };
    appConfig.teamGroups = appConfig.teamGroups || [];
    appConfig.teamGroups.push(newGroup);
    if (!appConfig.memberWages) appConfig.memberWages = {};
    appConfig.memberWages['새 팀원'] = 10000;
    renderTeamGroups(appConfig.teamGroups, appConfig.memberWages);
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
}

function addQuantityTask() {
    appConfig.quantityTaskTypes = appConfig.quantityTaskTypes || [];
    appConfig.quantityTaskTypes.push('새 처리량 업무');
    renderQuantityTasks(appConfig.quantityTaskTypes);
}

// [수정] 동적 클릭 이벤트 핸들러 분리
function handleDynamicClicks(e) {
    // 팀원 추가/삭제, 팀 그룹 삭제
    if (e.target.classList.contains('add-member-btn')) {
        const container = e.target.previousElementSibling;
        const newMemberEl = document.createElement('div');
        newMemberEl.className = 'flex items-center gap-2 mb-2 member-item';
        newMemberEl.innerHTML = `
            <input type="text" value="새 팀원" class="member-name" placeholder="팀원 이름">
            <label class="text-sm whitespace-nowrap">시급:</label>
            <input type="number" value="10000" class="member-wage w-28" placeholder="시급">
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
        newTaskEl.className = 'flex items-center gap-2 mb-2 task-item';
        newTaskEl.innerHTML = `
            <input type="text" value="새 업무" class="task-name">
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

// [추가] 드래그 앤 드롭 설정 함수
function setupDragDropListeners(containerSelector, itemSelector) {
    const container = document.querySelector(containerSelector);
    if (!container) return;

    container.addEventListener('dragstart', (e) => {
        // 드래그 핸들에서만 드래그 시작되도록 (선택 사항)
        if (e.target.closest(itemSelector) && e.target.classList.contains('drag-handle')) {
           draggedItem = e.target.closest(itemSelector);
           if (draggedItem) {
               setTimeout(() => draggedItem.classList.add('dragging'), 0);
               e.dataTransfer.effectAllowed = 'move';
           }
        } else if (e.target.closest(itemSelector) && containerSelector === '#task-groups-container') {
             // 업무 그룹 카드는 핸들 클릭해야만 이동
            if (e.target.classList.contains('drag-handle')) {
                draggedItem = e.target.closest(itemSelector);
                if (draggedItem) {
                    setTimeout(() => draggedItem.classList.add('dragging'), 0);
                    e.dataTransfer.effectAllowed = 'move';
                }
            } else {
                 e.preventDefault(); // 핸들 아니면 드래그 막기
            }
        }
         else {
             // 주요 업무, 처리량 업무는 아이템 전체 드래그 가능하도록 (핸들 필수 아님)
             if(containerSelector !== '#task-groups-container') {
                draggedItem = e.target.closest(itemSelector);
                 if (draggedItem) {
                    setTimeout(() => draggedItem.classList.add('dragging'), 0);
                    e.dataTransfer.effectAllowed = 'move';
                }
             } else {
                 e.preventDefault(); // 업무 그룹은 핸들 아니면 무조건 막기
             }
        }
    });

    container.addEventListener('dragend', (e) => {
        if (draggedItem) {
            draggedItem.classList.remove('dragging');
            draggedItem = null;
            // 드롭 후 시각적 피드백 제거
            container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    });

    container.addEventListener('dragover', (e) => {
        e.preventDefault(); // 필수: drop 이벤트 허용
        const targetItem = e.target.closest(itemSelector);
         container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (targetItem && targetItem !== draggedItem) {
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
        container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));

        if (targetItem && draggedItem && targetItem !== draggedItem) {
            const children = Array.from(container.children);
            const draggedIndex = children.indexOf(draggedItem);
            const targetIndex = children.indexOf(targetItem);

            // 삽입: target 위에 놓으면 target 앞으로, target 아래쪽에 놓으면 target 뒤로 (옵션)
            // 현재는 간단하게 target 앞에 삽입
            if (draggedIndex < targetIndex) {
                container.insertBefore(draggedItem, targetItem.nextSibling);
            } else {
                container.insertBefore(draggedItem, targetItem);
            }

            // 인덱스 재설정 (필요 시)
            Array.from(container.children).forEach((item, index) => {
                item.dataset.index = index;
                const deleteBtn = item.querySelector('.delete-key-task-btn, .delete-quantity-task-btn');
                if(deleteBtn) deleteBtn.dataset.index = index;
            });

        }
        if (draggedItem) {
           draggedItem.classList.remove('dragging');
        }
        draggedItem = null;
    });
}


// --- 데이터 저장 ---

async function handleSaveAll() {
    try {
        const newConfig = {
            teamGroups: [],
            memberWages: {},
            keyTasks: [], // [추가]
            taskGroups: {},
            quantityTaskTypes: [],
            defaultPartTimerWage: 10000
        };

        // 1. 팀원 및 시급 정보 읽기
        document.querySelectorAll('.team-group-card').forEach(groupCard => {
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

        // [추가] 1.5. 주요 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#key-tasks-container .key-task-item').forEach(item => {
             const taskName = item.querySelector('.key-task-name').value.trim();
             if (taskName) newConfig.keyTasks.push(taskName);
        });


        // 2. 업무 정보 읽기 (순서 반영)
        // 임시 객체 사용 (순서 보장 위해)
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
             orderedTaskGroups[groupName] = tasks; // 순서대로 객체에 추가
        });
        newConfig.taskGroups = orderedTaskGroups; // 최종 할당


        // 3. 처리량 업무 정보 읽기 (순서 반영)
        document.querySelectorAll('#quantity-tasks-container .quantity-task-item').forEach(item => {
            const taskName = item.querySelector('.quantity-task-name').value.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // 3.5. 전역 설정 (알바 시급) 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // 4. Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

        // UI 다시 렌더링 (순서가 바뀐 경우 반영)
        renderAdminUI(appConfig);


    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}