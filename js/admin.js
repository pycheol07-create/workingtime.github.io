// === admin.js (기본 알바 시급 불러오기/저장하기 추가) ===

// [수정] loadConfiguration, saveConfiguration -> loadAppConfig, saveAppConfig
import { initializeFirebase, loadAppConfig, saveAppConfig } from './config.js';

let db;
let appConfig = {};
const ADMIN_PASSWORD = "anffbxla123"; // 🚨 실제 운영 시에는 절대 이렇게 사용하면 안 됩니다! 임시 비밀번호입니다.

document.addEventListener('DOMContentLoaded', () => {
    const passwordPrompt = document.getElementById('password-prompt');
    const passwordInput = document.getElementById('admin-password');
    const passwordSubmitBtn = document.getElementById('password-submit-btn');
    const adminContent = document.getElementById('admin-content');

    // 비밀번호 입력 처리
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

    // 관리자 앱 초기화
    const initializeApp = async () => {
        try {
            db = initializeFirebase().db;
            // [수정] loadConfiguration -> loadAppConfig
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
    // [추가] 기본 알바 시급 렌더링
    const wageInput = document.getElementById('default-part-timer-wage');
    if (wageInput) {
        wageInput.value = config.defaultPartTimerWage || 10000;
    }

    renderTeamGroups(config.teamGroups || [], config.memberWages || {});
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

function renderTaskGroups(taskGroups) {
    const container = document.getElementById('task-groups-container');
    container.innerHTML = '';
    Object.entries(taskGroups).forEach(([groupName, tasks], index) => {
        const groupEl = document.createElement('div');
        groupEl.className = 'p-4 border rounded-lg bg-gray-50 task-group-card';
        groupEl.dataset.index = index;

        const tasksHtml = tasks.map((task, tIndex) => `
            <div class="flex items-center gap-2 mb-2 task-item">
                <input type="text" value="${task}" class="task-name">
                <button class="btn btn-danger btn-small delete-task-btn" data-t-index="${tIndex}">삭제</button>
            </div>
        `).join('');

        groupEl.innerHTML = `
            <div class="flex justify-between items-center mb-4">
                <input type="text" value="${groupName}" class="text-lg font-semibold task-group-name w-1/3">
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
        taskEl.className = 'flex items-center gap-2 mb-2 quantity-task-item';
        taskEl.innerHTML = `
            <input type="text" value="${task}" class="quantity-task-name">
            <button class="btn btn-danger btn-small delete-quantity-task-btn" data-index="${index}">삭제</button>
        `;
        container.appendChild(taskEl);
    });
}

// --- 이벤트 리스너 설정 ---

function setupEventListeners() {
    // 전체 저장
    document.getElementById('save-all-btn').addEventListener('click', handleSaveAll);

    // 팀 그룹 추가
    document.getElementById('add-team-group-btn').addEventListener('click', () => {
        const newGroup = { name: '새 그룹', members: ['새 팀원'] };
        appConfig.teamGroups = appConfig.teamGroups || [];
        appConfig.teamGroups.push(newGroup);
        if (!appConfig.memberWages) appConfig.memberWages = {};
        appConfig.memberWages['새 팀원'] = 10000; // 기본 시급
        renderTeamGroups(appConfig.teamGroups, appConfig.memberWages);
    });

    // 업무 그룹 추가
    document.getElementById('add-task-group-btn').addEventListener('click', () => {
        const newGroupName = `새 업무 그룹 ${Object.keys(appConfig.taskGroups || {}).length + 1}`;
        appConfig.taskGroups[newGroupName] = ['새 업무'];
        renderTaskGroups(appConfig.taskGroups);
    });

    // 처리량 업무 추가
    document.getElementById('add-quantity-task-btn').addEventListener('click', () => {
        appConfig.quantityTaskTypes.push('새 처리량 업무');
        renderQuantityTasks(appConfig.quantityTaskTypes);
    });

    // 동적 이벤트 위임 (삭제/추가 버튼)
    document.body.addEventListener('click', (e) => {
        // 팀원 추가
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
        }
        // 팀원 삭제
        if (e.target.classList.contains('delete-member-btn')) {
            e.target.closest('.member-item').remove();
        }
        // 팀 그룹 삭제
        if (e.target.classList.contains('delete-team-group-btn')) {
            e.target.closest('.team-group-card').remove();
        }

        // 업무 추가
        if (e.target.classList.contains('add-task-btn')) {
            const container = e.target.previousElementSibling;
            const newTaskEl = document.createElement('div');
            newTaskEl.className = 'flex items-center gap-2 mb-2 task-item';
            newTaskEl.innerHTML = `
                <input type="text" value="새 업무" class="task-name">
                <button class="btn btn-danger btn-small delete-task-btn">삭제</button>
            `;
            container.appendChild(newTaskEl);
        }
        // 업무 삭제
        if (e.target.classList.contains('delete-task-btn')) {
            e.target.closest('.task-item').remove();
        }
        // 업무 그룹 삭제
        if (e.target.classList.contains('delete-task-group-btn')) {
            e.target.closest('.task-group-card').remove();
        }
        // 처리량 업무 삭제
        if (e.target.classList.contains('delete-quantity-task-btn')) {
            e.target.closest('.quantity-task-item').remove();
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
            defaultPartTimerWage: 10000 // [추가] 기본값 설정
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

        // 2. 업무 정보 읽기
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

        // 3. 처리량 업무 정보 읽기
        document.querySelectorAll('.quantity-task-item').forEach(taskItem => {
            const taskName = taskItem.querySelector('.quantity-task-name').value.trim();
            if (taskName) newConfig.quantityTaskTypes.push(taskName);
        });

        // [추가] 3.5. 전역 설정 (알바 시급) 읽기
        const wageInput = document.getElementById('default-part-timer-wage');
        if (wageInput) {
            newConfig.defaultPartTimerWage = Number(wageInput.value) || 10000;
        }

        // 4. Firestore에 저장
        // [수정] saveConfiguration -> saveAppConfig
        await saveAppConfig(db, newConfig);
        appConfig = newConfig; // 로컬 캐시 업데이트
        alert('✅ 성공! 모든 변경사항이 Firestore에 저장되었습니다.');

    } catch (e) {
        console.error("저장 실패:", e);
        alert(`❌ 저장 실패. 오류: ${e.message}`);
    }
}