// === admin.js (SortableJS 드래그 앤 드롭 기능 추가, '주요 업무' 관리 기능 추가) ===

import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';

// [추가] Sortable 임포트 (admin.html에서 로드됨)
const Sortable = window.Sortable;

let db;
let appConfig = {};
const ADMIN_PASSWORD = "anffbxla123"; // 🚨 실제 운영 시에는 절대 이렇게 사용하면 안 됩니다! 임시 비밀번호입니다.

// [추가] 드래그 핸들 SVG 아이콘
const dragHandleSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 drag-handle" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16m-7 6h7" transform="rotate(90 12 12)" />
    </svg>
`;

document.addEventListener('DOMContentLoaded', () => {
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
    renderTaskGroups(config.taskGroups || {});
    renderQuantityTasks(config.quantityTaskTypes || []);
    renderKeyTasks(config.keyTasks || []); // [추가] 주요 업무 렌더링
    
    initializeSortables(); // [추가] SortableJS 초기화
}

function renderTeamGroups(teamGroups, memberWages) {
    const container = document.getElementById('team-groups-container');
    container.innerHTML = '';
    teamGroups.forEach((group, index) => {
        const groupEl = document.createElement('div');
        // [수정] 그룹 카드에도 드래그 핸들 및 식별 클래스 추가
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 team-group-card sortable-item';
        groupEl.dataset.index = index;
        
        const membersHtml = group.members.map((member, mIndex) => `
            <div class="sortable-item member-item">
                ${dragHandleSvg}
                <input type="text" value="${member}" class="member-name flex-grow" placeholder="팀원 이름">
                <label class="text-sm whitespace-nowrap">시급:</label>
                <input type="number" value="${memberWages[member] || 0}" class="member-wage w-28" placeholder="시급">
                <button class="btn btn-danger btn-small delete-member-btn" data-m-index="${mIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-2">
                    ${dragHandleSvg} <input type="text" value="${group.name}" class="text-lg font-semibold team-group-name w-48">
                </div>
                <button class="btn btn-danger btn-small delete-team-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 members-container">${membersHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-member-btn">+ 팀원 추가</button>
        `;
        container.appendChild(groupEl);
    });
    // [추가] 팀원 목록 Sortable 초기화
    initializeSortables('.members-container');
}

function renderTaskGroups(taskGroups) {
    const container = document.getElementById('task-groups-container');
    container.innerHTML = '';
    Object.entries(taskGroups).forEach(([groupName, tasks], index) => {
        const groupEl = document.createElement('div');
        // [수정] 그룹 카드에도 드래그 핸들 및 식별 클래스 추가
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card sortable-item';
        groupEl.dataset.index = index;

        const tasksHtml = tasks.map((task, tIndex) => `
            <div class="sortable-item task-item">
                ${dragHandleSvg}
                <input type="text" value="${task}" class="task-name flex-grow">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <div class="flex items-center gap-2">
                    ${dragHandleSvg} <input type="text" value="${groupName}" class="text-lg font-semibold task-group-name w-48">
                </div>
                <button class="btn btn-danger btn-small delete-task-group-btn">그룹 삭제</button>
            </div>
            <div class="pl-4 border-l-2 border-gray-200 space-y-2 tasks-container">${tasksHtml}</div>
            <button class="btn btn-secondary btn-small mt-3 add-task-btn">+ 업무 추가</button>
        `;
        container.appendChild(groupEl);
    });
    // [추가] 업무 목록 Sortable 초기화
    initializeSortables('.tasks-container');
}

function renderQuantityTasks(quantityTasks) {
    const container = document.getElementById('quantity-tasks-container');
    container.innerHTML = '';
    quantityTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        // [수정] quantity-task-item -> sortable-item으로 변경, 드래그 핸들 추가
        taskEl.className = 'sortable-item quantity-task-item';
        taskEl.innerHTML = `
            ${dragHandleSvg}
            <input type="text" value="${task}" class="quantity-task-name flex-grow">
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

// [추가] 주요 업무 렌더링 함수
function renderKeyTasks(keyTasks) {
    const container = document.getElementById('key-tasks-container');
    container.innerHTML = '';
    keyTasks.forEach((task, index) => {
        const taskEl = document.createElement('div');
        taskEl.className = 'sortable-item key-task-item';
        taskEl.innerHTML = `
            ${dragHandleSvg}
            <input type="text" value="${task}" class="key-task-name flex-grow">
            <button class="btn btn-danger btn-small delete-key-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

// [추가] SortableJS 초기화 함수
function initializeSortables(selector = null) {
    const options = {
        animation: 150,
        handle: '.drag-handle', // 드래그 핸들 클래스 지정
        ghostClass: 'sortable-ghost', // 드래그 중인 아이템에 적용될 클래스
    };

    if (selector) {
        // 특정 셀렉터(예: '.members-container')에만 적용 (동적 생성 시)
        document.querySelectorAll(selector).forEach(el => {
            if (el && !el.sortableInstance) { // 중복 초기화 방지
                el.sortableInstance = Sortable.create(el, options);
            }
        });
    } else {
        // 페이지 로드 시 전체 컨테이너에 적용
        const containers = [
            document.getElementById('team-groups-container'),
            document.getElementById('task-groups-container'),
            document.getElementById('quantity-tasks-container'),
            document.getElementById('key-tasks-container')
        ];
        containers.forEach(container => {
            if (container && !container.sortableInstance) {
                container.sortableInstance = Sortable.create(container, options);
            }
        });
        // 자식 컨테이너들도 초기화
        initializeSortables('.members-container');
        initializeSortables('.tasks-container');
    }
}


// --- 이벤트 리스너 설정 ---

function setupEventListeners() {
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);

    document.getElementById('add-team-group-btn').addEventListener('click', () => {
        const newGroup = { name: '새 그룹', members: ['새 팀원'] };
        appConfig.teamGroups = appConfig.teamGroups || [];
        appConfig.teamGroups.push(newGroup);
        if (!appConfig.memberWages) appConfig.memberWages = {};
        appConfig.memberWages['새 팀원'] = 10000;
        renderTeamGroups(appConfig.teamGroups, appConfig.memberWages);
        // [중요] 새로 추가된 그룹의 자식(.members-container)에 Sortable 재적용
        initializeSortables('.members-container');
    });

    document.getElementById('add-task-group-btn').addEventListener('click', () => {
        const newGroupName = `새 업무 그룹 ${Object.keys(appConfig.taskGroups || {}).length + 1}`;
        appConfig.taskGroups[newGroupName] = ['새 업무'];
        renderTaskGroups(appConfig.taskGroups);
        // [중요] 새로 추가된 그룹의 자식(.tasks-container)에 Sortable 재적용
        initializeSortables('.tasks-container');
    });

    document.getElementById('add-quantity-task-btn').addEventListener('click', () => {
        appConfig.quantityTaskTypes.push('새 처리량 업무');
        renderQuantityTasks(appConfig.quantityTaskTypes);
    });
    
    // [추가] 주요 업무 추가 버튼
    document.getElementById('add-key-task-btn').addEventListener('click', () => {
        appConfig.keyTasks = appConfig.keyTasks || [];
        appConfig.keyTasks.push('새 주요 업무');
        renderKeyTasks(appConfig.keyTasks);
    });

    document.body.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-member-btn')) {
            const container = e.target.previousElementSibling; // .members-container
            const newMemberEl = document.createElement('div');
            newMemberEl.className = 'sortable-item member-item'; // [수정] 클래스 변경
            newMemberEl.innerHTML = `
                ${dragHandleSvg} <input type="text" value="새 팀원" class="member-name flex-grow" placeholder="팀원 이름">
                <label class="text-sm whitespace-nowrap">시급:</label>
                <input type="number" value="10000" class="member-wage w-28" placeholder="시급">
                <button class="btn btn-danger btn-small delete-member-btn">삭제</button>
            `;
            container.appendChild(newMemberEl);
        }
        if (e.target.classList.contains('delete-member-btn')) {
            e.target.closest('.member-item').remove();
        }
        if (e.target.classList.contains('delete-team-group-btn')) {
            e.target.closest('.team-group-card').remove();
        }

        if (e.target.classList.contains('add-task-btn')) {
            const container = e.target.previousElementSibling; // .tasks-container
            const newTaskEl = document.createElement('div');
            newTaskEl.className = 'sortable-item task-item'; // [수정] 클래스 변경
            newTaskEl.innerHTML = `
                ${dragHandleSvg} <input type="text" value="새 업무" class="task-name flex-grow">
                <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
            `;
            container.appendChild(newTaskEl);
        }
        if (e.target.classList.contains('delete-task-btn')) {
            e.target.closest('.task-item').remove();
        }
        if (e.target.classList.contains('delete-task-group-btn')) {
            e.target.closest('.task-group-card').remove();
        }
        if (e.target.classList.contains('delete-quantity-task-btn')) {
            e.target.closest('.quantity-task-item').remove();
        }
        // [추가] 주요 업무 삭제
        if (e.target.classList.contains('delete-key-task-btn')) {
            e.target.closest('.key-task-item').remove();
        }
    });
}

// --- 데이터 저장 ---

async function handleSaveAll() {
    try {
        const newConfig = {
            teamGroups: [],
            memberWages: {},
            taskGroups: {},
            quantityTaskTypes: [],
            keyTasks: [], // [추가]
            defaultPartTimerWage: 10000
        };

        // 1. 팀원 및 시급 정보 읽기 (이제 순서대로 읽힘)
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

        // 2. 업무 정보 읽기 (이제 순서대로 읽힘)
        document.querySelectorAll('.task-group-card').forEach(groupCard => {
            const groupName = groupCard.querySelector('.task-group-name').value.trim();
            if (!groupName) return;

            const tasks = [];
            groupCard.querySelectorAll('.task-item').forEach(taskItem => {
                const taskName = taskItem.querySelector('.task-name').value.trim();
                if (taskName) tasks.push(taskName);
            });
            newConfig.taskGroups[groupName] = tasks;
        });

        // 3. 처리량 업무 정보 읽기 (이제 순서대로 읽힘)
        document.querySelectorAll('.quantity-task-item').forEach(taskItem => {
            const taskName = taskItem.querySelector('.quantity-task-name').value.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // [추가] 4. 주요 업무 정보 읽기 (순서대로 읽힘)
        document.querySelectorAll('.key-task-item').forEach(taskItem => {
            const taskName = taskItem.querySelector('.key-task-name').value.trim();
            if (taskName) newConfig.keyTasks.push(taskName);
        });

        // 5. 알바 시급 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // 6. Firestore에 저장
        await saveAppConfig(db, newConfig);
        appConfig = newConfig;
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}