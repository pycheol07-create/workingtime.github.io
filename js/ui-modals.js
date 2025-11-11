// === js/ui-modals.js ===

// ✅ [신규] app.js 대신 state.js에서 직접 상태를 가져옵니다.
import { appState, appConfig } from './state.js';

// ... (renderQuantityModalInputs, renderTaskSelectionModal 함수는 기존과 동일하므로 생략) ...
export const renderQuantityModalInputs = (sourceQuantities = {}, quantityTaskTypes = [], missingTasksList = [], confirmedZeroTasks = []) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    if (!container) return;
    container.innerHTML = '';

    const missingTaskSet = new Set(missingTasksList);
    const confirmedZeroSet = new Set(confirmedZeroTasks);

    quantityTaskTypes.forEach(task => {
        const div = document.createElement('div');
        const isConfirmed = confirmedZeroSet.has(task);
        // ✅ [핵심] 이 로직이 누락 항목을 확인합니다.
        const isMissing = missingTaskSet.has(task) && !isConfirmed;
        // ✅ [핵심] 여기서 경고 클래스를 할당합니다.
        const warningClass = isMissing ? 'warning-missing-quantity' : '';

        div.innerHTML = `
            <div class="flex justify-between items-end mb-1">
                <label for="modal-quantity-${task}" class="block text-sm font-medium text-gray-700 ${isMissing ? 'text-yellow-700 font-bold' : ''}">
                    ${task} ${isMissing ? '(누락됨)' : ''}
                </label>
                 <div class="flex items-center">
                    <input type="checkbox" id="modal-confirm-zero-${task}" data-task="${task}"
                           class="confirm-zero-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 transition"
                           ${isConfirmed ? 'checked' : ''}>
                    <label for="modal-confirm-zero-${task}" class="ml-1 text-xs text-gray-500 cursor-pointer select-none">0건 확인</label>
                </div>
            </div>
            <input type="number" id="modal-quantity-${task}" data-task="${task}" value="${sourceQuantities[task] || 0}" min="0"
                   class="mt-1 w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 transition ${warningClass}">
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('.confirm-zero-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const task = e.target.dataset.task;
            const input = container.querySelector(`#modal-quantity-${task}`);
            const label = container.querySelector(`label[for="modal-quantity-${task}"]`);

            if (e.target.checked) {
                // ✅ [핵심] 체크 시 경고 클래스를 제거합니다.
                input.classList.remove('warning-missing-quantity');
                label.classList.remove('text-yellow-700', 'font-bold');
                label.textContent = task;
            } else {
                // ✅ [핵심] 체크 해제 시, 누락 상태라면 경고 클래스를 다시 추가합니다.
                // (주의: missingTaskSet은 이 스코프에서 접근이 안되므로, 0건 기준 재확인)
                if (Number(input.value) <= 0 && missingTaskSet.has(task)) { // 0건이면서 원래 누락 목록에 있었다면
                     input.classList.add('warning-missing-quantity');
                     label.classList.add('text-yellow-700', 'font-bold');
                     if (!label.textContent.includes('(누락됨)')) {
                         label.textContent = `${task} (누락됨)`;
                     }
                }
            }
        });
    });
};

export const renderTaskSelectionModal = (taskGroups = []) => {
    const container = document.getElementById('task-modal-content');
    if (!container) return;
    container.innerHTML = '';

    taskGroups.forEach((group) => {
        const groupName = group.name;
        const tasks = group.tasks || [];

        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex-1';

        let tasksHtml = tasks.map(task => `<button type="button" data-task="${task}" class="task-select-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:ring-2 focus:ring-blue-300">${task}</button>`).join('');

        groupDiv.innerHTML = `
            <div class="bg-gray-50 rounded-lg border">
                <h3 class="text-lg font-bold text-gray-800 mb-0 p-3 border-b bg-gray-100 rounded-t-lg">${groupName}</h3>
                <div class="p-3 grid grid-cols-1 gap-2">${tasksHtml}</div>
            </div>
        `;
        container.appendChild(groupDiv);
    });
};

// ✅ [수정] '출근 전' 상태 비활성화 로직 추가
export const renderTeamSelectionModalContent = (task, appState, teamGroups = []) => {
    const titleEl = document.getElementById('team-select-modal-title');
    const container = document.getElementById('team-select-modal-content');
    if (!titleEl || !container) return;

    titleEl.textContent = `'${task || '기타 업무'}' 팀원 선택`;
    container.innerHTML = '';

    const ongoingMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'ongoing').map(r => r.member)
    );
    const pausedMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'paused').map(r => r.member)
    );

    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];

    const onLeaveMemberMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => [item.member, item])
    );

    const baseClasses = "member-select-btn w-full p-2 rounded-lg border-2 text-center transition-all duration-200 min-h-[50px] flex flex-col justify-center";
    const disabledClasses = "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-60"; // ✨ 비활성화 스타일 강화
    const unselectedClasses = "bg-white border-gray-300 text-gray-900 hover:bg-blue-50 hover:border-blue-300";

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean);

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col';
        groupContainer.innerHTML = `
            <div class="flex justify-between items-center p-2 border-b border-gray-200">
                <h4 class="text-md font-bold text-gray-800">${group.name}</h4>
                <button type="button" class="group-select-all-btn text-xs bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-2 py-1 rounded shadow-sm transition-all" data-group-name="${group.name}">전체</button>
            </div>`;

        const memberList = document.createElement('div');
        memberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
        memberList.dataset.groupName = group.name;

        [...new Set(group.members)].forEach(member => {
            const isOngoing = ongoingMembers.has(member);
            const isPaused = pausedMembers.has(member);
            const leaveEntry = onLeaveMemberMap.get(member);
            const isOnLeave = !!leaveEntry;
            
            // ✨ 출근 상태 체크
            const attendance = appState.dailyAttendance?.[member];
            const isClockedIn = attendance && attendance.status === 'active';
            const isReturned = attendance && attendance.status === 'returned';

            // ✨ 선택 불가 조건에 '출근 안 함(또는 퇴근함)' 추가
            const isDisabled = isOngoing || isPaused || isOnLeave || !isClockedIn;

            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            card.className = `${baseClasses} ${isDisabled ? disabledClasses : unselectedClasses}`;
            if (isDisabled) card.disabled = true;

            let statusLabel = '';
            if (isOngoing) { statusLabel = '<div class="text-xs text-red-400 font-medium">업무 중</div>'; }
            else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600 font-medium">휴식 중</div>'; }
            else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500 font-medium">${leaveEntry.type} 중</div>`; }
            else if (isReturned) { statusLabel = '<div class="text-xs text-gray-400 font-medium">퇴근 완료</div>'; } // ✨ 퇴근 상태 표시
            else if (!isClockedIn) { statusLabel = '<div class="text-xs text-gray-400 font-medium">출근 전</div>'; } // ✨ 출근 전 상태 표시
            
            card.innerHTML = `<div class="font-bold">${member}</div>${statusLabel}`;

            memberList.appendChild(card);
        });
        groupContainer.appendChild(memberList);
        container.appendChild(groupContainer);
    });

    // 알바 그룹
    const albaGroupContainer = document.createElement('div');
    albaGroupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col';
    albaGroupContainer.innerHTML = `<div class="flex justify-between items-center p-2 border-b border-gray-200">
                                         <h4 class="text-md font-bold text-gray-800">알바</h4>
                                         <div>
                                             <button type="button" class="group-select-all-btn text-xs bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-2 py-1 rounded shadow-sm transition-all" data-group-name="알바">전체</button>
                                             <button id="add-part-timer-modal-btn" class="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 px-2 py-1 rounded ml-1 transition-all">+ 추가</button>
                                         </div>
                                    </div>`;
    const albaMemberList = document.createElement('div');
    albaMemberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
    albaMemberList.dataset.groupName = '알바';

    (appState.partTimers || []).forEach(pt => {
        const isOngoing = ongoingMembers.has(pt.name);
        const isPaused = pausedMembers.has(pt.name);
        const leaveEntry = onLeaveMemberMap.get(pt.name);
        const isOnLeave = !!leaveEntry;

        // ✨ 알바 출근 상태 체크
        const attendance = appState.dailyAttendance?.[pt.name];
        const isClockedIn = attendance && attendance.status === 'active';
        const isReturned = attendance && attendance.status === 'returned';
        const isDisabled = isOngoing || isPaused || isOnLeave || !isClockedIn;

        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        card.className = `${baseClasses} ${isDisabled ? disabledClasses : unselectedClasses}`;
        if (isDisabled) card.disabled = true;

        let statusLabel = '';
        if (isOngoing) { statusLabel = '<div class="text-xs text-red-400 font-medium">업무 중</div>'; }
        else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600 font-medium">휴식 중</div>'; }
        else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500 font-medium">${leaveEntry.type} 중</div>`; }
        else if (isReturned) { statusLabel = '<div class="text-xs text-gray-400 font-medium">퇴근 완료</div>'; }
        else if (!isClockedIn) { statusLabel = '<div class="text-xs text-gray-400 font-medium">출근 전</div>'; }

        card.innerHTML = `<div class="font-bold">${pt.name}</div>${statusLabel}`;

        cardWrapper.appendChild(card);

        const editBtn = document.createElement('button');
        editBtn.dataset.partTimerId = pt.id;
        editBtn.className = 'edit-part-timer-btn absolute top-1 right-6 p-1 text-gray-400 hover:text-blue-600 transition-colors';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L13.196 5.2z" /></svg>`;
        cardWrapper.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.dataset.partTimerId = pt.id;
        deleteBtn.className = 'delete-part-timer-btn absolute top-1 right-1 p-1 text-gray-400 hover:text-red-600 transition-colors';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
        cardWrapper.appendChild(deleteBtn);

        albaMemberList.appendChild(cardWrapper);
    });

    albaGroupContainer.appendChild(albaMemberList);
    container.appendChild(albaGroupContainer);
};

export const renderLeaveTypeModalOptions = (leaveTypes = []) => {
    const container = document.getElementById('leave-type-options');
    const dateInputsDiv = document.getElementById('leave-date-inputs');
    if (!container || !dateInputsDiv) return;

    container.innerHTML = '';
    leaveTypes.forEach((type, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center';
        div.innerHTML = `
            <input id="leave-type-${index}" name="leave-type" type="radio" value="${type}" class="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 leave-type-radio">
            <label for="leave-type-${index}" class="ml-2 block text-sm font-medium text-gray-700">${type}</label>
        `;
        container.appendChild(div);
    });

    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('leave-type-radio')) {
            const selectedType = e.target.value;
            if (selectedType === '연차' || selectedType === '출장' || selectedType === '결근') {
                dateInputsDiv.classList.remove('hidden');
            } else {
                dateInputsDiv.classList.add('hidden');
            }
        }
    });

    const firstRadio = container.querySelector('input[type="radio"]');
    if (firstRadio) {
        firstRadio.checked = true;
        if (firstRadio.value === '연차' || firstRadio.value === '출장' || firstRadio.value === '결근') {
            dateInputsDiv.classList.remove('hidden');
        } else {
            dateInputsDiv.classList.add('hidden');
        }
    }
};

export const renderManualAddModalDatalists = (appState, appConfig) => {
    const memberDatalist = document.getElementById('manual-add-member-list');
    const taskDatalist = document.getElementById('manual-add-task-list');

    if (!memberDatalist || !taskDatalist) return;

    memberDatalist.innerHTML = '';
    const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
    const partTimerMembers = (appState.partTimers || []).map(p => p.name);

    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();

    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        memberDatalist.appendChild(option);
    });

    taskDatalist.innerHTML = '';
    const allTasks = [...new Set((appConfig.taskGroups || []).flatMap(group => group.tasks))].sort();

    allTasks.forEach(task => {
        const option = document.createElement('option');
        option.value = task;
        taskDatalist.appendChild(option);
    });
};