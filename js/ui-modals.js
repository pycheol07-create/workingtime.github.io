// === js/ui-modals.js ===

import { appState, appConfig, persistentLeaveSchedule, OTHER_LEAVE_TYPE, TIME_BASED_LEAVE_TYPES, isPersistentLeaveType, leaveTypeLabel } from './state.js?v=202610281554';
// ✅ getCurrentTime 유틸 함수 추가 임포트
import { calculateDateDifference, getTodayDateString, calculateWorkingDays, getCurrentTime, isMemberActiveOn, escapeHtml } from './utils.js?v=202610281554';
import { onLeaveScheduleChanged } from './leave-schedule-sync.js?v=202610281554';

// 근속연수 계산 헬퍼 함수 (#년 #개월 #일째)
const calculateTenure = (joinDateStr) => {
    if (!joinDateStr || joinDateStr === '-') return '';
    
    const start = new Date(joinDateStr);
    const now = new Date();
    
    if (start > now) return '입사 예정';

    let years = now.getFullYear() - start.getFullYear();
    let months = now.getMonth() - start.getMonth();
    let days = now.getDate() - start.getDate();

    if (days < 0) {
        months--;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
    }

    if (months < 0) {
        years--;
        months += 12;
    }

    // "일째" 표현을 위해 +1
    return `${years}년 ${months}개월 ${days + 1}일째`;
};

// 근무 개월 수 계산 헬퍼
const calculateMonthsWorked = (joinDateStr) => {
    if (!joinDateStr || joinDateStr === '-') return 0;
    const start = new Date(joinDateStr);
    const now = new Date();
    
    let months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    // 입사일(일자)이 지나지 않았으면 1개월 차감 (만근 기준)
    if (now.getDate() < start.getDate()) {
        months--;
    }
    return Math.max(0, months);
};

// 연차 사용 내역 계산 & 자동 병합 로직
const calculateLeaveUsage = (memberName) => {
    const leaveSettings = (appConfig.memberLeaveSettings && appConfig.memberLeaveSettings[memberName]) || { totalLeave: 15, joinDate: '-', leaveResetDate: '', expirationDate: '' };
    let totalLeave = leaveSettings.totalLeave;
    const joinDate = leaveSettings.joinDate;
    const leaveResetDate = leaveSettings.leaveResetDate; 
    const expirationDate = leaveSettings.expirationDate; 

    let isAutoCalculated = false;

    // 1순위: 관리자가 '적용 시작일'을 직접 설정한 경우 (우선 사용)
    if (leaveResetDate && leaveResetDate !== '') {
        isAutoCalculated = false;
    } 
    // 2순위: 12개월 미만 근속자인 경우 -> 근무 개월 수만큼 자동 부여
    else if (joinDate && joinDate !== '-') {
        const monthsWorked = calculateMonthsWorked(joinDate);
        if (monthsWorked < 12) { 
            totalLeave = monthsWorked; 
            isAutoCalculated = true;
        }
    }

    const rawHistory = (persistentLeaveSchedule.onLeaveMembers || [])
        .filter(item => {
            if (item.member !== memberName || item.type !== '연차') return false;
            if (leaveResetDate && item.startDate < leaveResetDate) return false;
            return true;
        })
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    const mergedHistory = [];
    if (rawHistory.length > 0) {
        let current = {
            ...rawHistory[0],
            startDate: rawHistory[0].startDate,
            endDate: rawHistory[0].endDate || rawHistory[0].startDate,
            ids: [rawHistory[0].id] 
        };
        
        let currentEndObj = new Date(current.endDate);

        for (let i = 1; i < rawHistory.length; i++) {
            const next = rawHistory[i];
            const nextStartObj = new Date(next.startDate);
            const nextEndObj = new Date(next.endDate || next.startDate);
            
            const dayAfterCurrentEnd = new Date(currentEndObj);
            dayAfterCurrentEnd.setDate(dayAfterCurrentEnd.getDate() + 1);

            if (nextStartObj <= dayAfterCurrentEnd) {
                if (nextEndObj > currentEndObj) {
                    currentEndObj = nextEndObj;
                    current.endDate = next.endDate || next.startDate;
                }
                current.ids.push(next.id);
            } else {
                mergedHistory.push(current);
                current = {
                    ...next,
                    startDate: next.startDate,
                    endDate: next.endDate || next.startDate,
                    ids: [next.id]
                };
                currentEndObj = new Date(current.endDate);
            }
        }
        mergedHistory.push(current);
    }

    let realUsedCount = 0;
    let cumulativeDays = 0;

    const finalHistory = mergedHistory.map((item) => {
        const days = calculateWorkingDays(item.startDate, item.endDate);
        realUsedCount += days;
        
        const startNth = cumulativeDays + 1;
        const endNth = cumulativeDays + days;
        cumulativeDays += days;

        const nthStr = (days > 1) ? `${startNth}~${endNth}` : `${startNth}`;

        return {
            ...item,
            days,
            nth: nthStr,
            isMerged: item.ids.length > 1
        };
    });

    return {
        total: totalLeave,
        used: realUsedCount,
        remaining: totalLeave - realUsedCount,
        joinDate: joinDate,
        leaveResetDate: leaveResetDate, 
        expirationDate: expirationDate, 
        isAutoCalculated: isAutoCalculated, 
        history: finalHistory.reverse() 
    };
};

// doneTasks(선택): 오늘 한 업무 — 정렬에만 쓴다. 칸 순서 = 누락 → 오늘 한 업무 → 나머지(각 묶음 안은 원래 순서).
// 0(또는 값 없음)은 빈칸 + 흐린 placeholder 0 으로 보인다. 빈칸은 저장할 때 0 이다(listeners-form-quantity.js
// Number('')||0) — '0건 확인' 체크는 '업무는 했는데 실제로 0건' 이라는 뜻이라 빈칸(아직 안 넣음)과 따로 둔다.
export const renderQuantityModalInputs = (sourceQuantities = {}, quantityTaskTypes = [], missingTasksList = [], confirmedZeroTasks = [], doneTasks = []) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    if (!container) return;
    container.innerHTML = '';

    // 예정 물량 모드 전용 안내는 기본적으로 숨긴다(예정 모드에서 다시 켬)
    document.getElementById('planned-auto-hint')?.classList.add('hidden');
    // 예정 물량 모드(자동 저장)가 숨긴 [취소]·저장 상태 줄을 되돌린다 — 예정 모드는 이 함수 뒤에 다시 바꾼다
    document.getElementById('planned-autosave-status')?.classList.add('hidden');
    document.getElementById('cancel-quantity-btn')?.classList.remove('hidden');

    const missingTaskSet = new Set(missingTasksList);
    const confirmedZeroSet = new Set(confirmedZeroTasks);
    const doneTaskSet = new Set(Array.isArray(doneTasks) ? doneTasks : []);
    const rank = (t) => (missingTaskSet.has(t) && !confirmedZeroSet.has(t)) ? 0 : (doneTaskSet.has(t) ? 1 : 2);
    const orderedTasks = quantityTaskTypes.map((t, i) => [t, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(x => x[0]);

    orderedTasks.forEach(task => {
        const div = document.createElement('div');
        const isConfirmed = confirmedZeroSet.has(task);
        const isMissing = missingTaskSet.has(task) && !isConfirmed;
        const warningClass = isMissing ? 'warning-missing-quantity' : '';
        const rawValue = sourceQuantities[task];
        const shownValue = (rawValue == null || rawValue === '' || Number(rawValue) === 0) ? '' : rawValue;

        // 업무명은 관리자가 넣는 값 — 라벨·id·data 속성 모두 escape(브라우저가 속성값을 되돌려 읽으므로 id·dataset.task 는 원래 이름 그대로)
        const t = escapeHtml(task);
        div.innerHTML = `
            <div class="flex justify-between items-end mb-1">
                <label for="modal-quantity-${t}" class="block text-sm font-medium text-gray-700 ${isMissing ? 'text-yellow-700 font-bold' : ''}">
                    ${t} ${isMissing ? '(누락됨)' : ''}
                </label>
                 <div class="flex items-center">
                    <input type="checkbox" id="modal-confirm-zero-${t}" data-task="${t}"
                           class="confirm-zero-checkbox w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 transition"
                           ${isConfirmed ? 'checked' : ''}>
                    <label for="modal-confirm-zero-${t}" class="ml-1 text-xs text-gray-500 cursor-pointer select-none">0건 확인</label>
                </div>
            </div>
            <input type="number" inputmode="numeric" id="modal-quantity-${t}" data-task="${t}" value="${escapeHtml(shownValue)}" placeholder="0" min="0" step="1"
                   class="mt-1 w-full bg-gray-50 border border-gray-300 text-gray-900 placeholder-gray-400 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 transition ${warningClass}">
        `;
        container.appendChild(div);
    });

    container.querySelectorAll('.confirm-zero-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const task = e.target.dataset.task;
            const input = container.querySelector(`#${CSS.escape(`modal-quantity-${task}`)}`);   // '상.하차' 처럼 점·공백이 있는 이름도 찾게
            const label = container.querySelector(`label[for="${CSS.escape(`modal-quantity-${task}`)}"]`);

            if (e.target.checked) {
                input.classList.remove('warning-missing-quantity');
                label.classList.remove('text-yellow-700', 'font-bold');
                label.textContent = task;
            } else {
                if (Number(input.value) <= 0 && missingTaskSet.has(task)) {
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

// 오늘 처리량 창 — 비어 있는 업무 칸에 미리 저장해 둔 예정 물량을 채운다(2026-10-26).
//   어떤 칸을 채울지는 lib/planned-prefill.js. 채운 칸은 호박색 + '예정값' 안내로 구분하고, 칸을 고치거나 0건 확인을 누르면 표시를 뗀다.
//   [저장]을 누르면 채운 값이 그대로 처리량으로 저장된다(사용자 결정 — 고치고 저장하라고 안내한다).
//   renderQuantityModalInputs 바로 뒤에 부른다. 돌려주는 값: 채운 칸 수.
export const applyPlannedPrefill = (fill = {}) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    if (!container) return 0;
    let n = 0;
    Object.entries(fill || {}).forEach(([task, value]) => {
        const input = container.querySelector(`#${CSS.escape(`modal-quantity-${task}`)}`);
        if (!input || input.value !== '') return;
        input.value = String(value);
        // 누락 경고(빨강·'(누락됨)')가 호박색을 덮으므로 채운 칸에서는 뗀다 — 값이 들어 있는데 누락이라고 보이지 않게
        const label = container.querySelector(`label[for="${CSS.escape(`modal-quantity-${task}`)}"]`);
        input.classList.remove('warning-missing-quantity');
        if (label) { label.classList.remove('text-yellow-700', 'font-bold'); label.textContent = `${task} (예정값)`; }
        input.classList.add('planned-prefill', '!bg-amber-50', '!border-amber-300', 'dark:!bg-amber-900/30');
        const note = document.createElement('p');
        note.className = 'planned-prefill-note mt-1 text-xs font-medium text-amber-700 dark:text-amber-300';
        note.textContent = '예정값 — 실제 처리량으로 고쳐서 저장하세요';
        input.insertAdjacentElement('afterend', note);
        const ac = new AbortController();   // 칸을 고치거나 0건 확인하면 두 리스너를 함께 뗀다(사람이 친 값을 지우지 않게)
        const unmark = () => {
            ac.abort();
            input.classList.remove('planned-prefill', '!bg-amber-50', '!border-amber-300', 'dark:!bg-amber-900/30');
            if (label && label.textContent === `${task} (예정값)`) label.textContent = task;
            note.remove();
        };
        input.addEventListener('input', unmark, { signal: ac.signal });
        container.querySelector(`#${CSS.escape(`modal-confirm-zero-${task}`)}`)
            ?.addEventListener('change', (e) => { if (e.target.checked) { input.value = ''; unmark(); } }, { signal: ac.signal });
        n++;
    });
    if (n > 0) {
        const head = document.createElement('p');
        head.className = 'planned-prefill-note col-span-full mb-1 text-xs text-amber-700 dark:text-amber-300';
        head.textContent = `처리량이 비어 있는 ${n}개 업무에 예정 물량을 미리 채웠습니다(호박색 칸). 저장하면 그 값이 처리량으로 저장됩니다.`;
        container.prepend(head);
    }
    return n;
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

        let tasksHtml = tasks.map(task => `<button type="button" data-task="${escapeHtml(task)}" class="task-select-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:ring-2 focus:ring-blue-300">${escapeHtml(task)}</button>`).join('');

        groupDiv.innerHTML = `
            <div class="bg-gray-50 rounded-lg border">
                <h3 class="text-lg font-bold text-gray-800 mb-0 p-3 border-b bg-gray-100 rounded-t-lg">${groupName}</h3>
                <div class="p-3 grid grid-cols-1 gap-2">${tasksHtml}</div>
            </div>
        `;
        container.appendChild(groupDiv);
    });
};

// opts.selected : 처음부터 선택해 둘 이름들(본인 미리 선택·다시 그릴 때 선택 유지 — UX 개선 2번).
//                 고를 수 없는 칸(업무 중·근태·출근 전)은 선택하지 않는다.
// 본인(appState.currentUser) 그룹을 맨 앞에, 본인 칸에는 '나' 표시. 본인이 출근 전이면 [출근하고 시작] 버튼
// (.self-clockin-start-btn — listeners-form-team.js 가 기존 출근 처리 processClockIn 으로 출근한 뒤 시작한다).
export const renderTeamSelectionModalContent = (task, appState, teamGroups = [], opts = {}) => {
    const titleEl = document.getElementById('team-select-modal-title');
    const container = document.getElementById('team-select-modal-content');
    if (!titleEl || !container) return;
    const selfName = appState.currentUser || null;
    const selectedSet = new Set(Array.isArray(opts.selected) ? opts.selected : []);

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

    // 지각은 이벤트성 기록(도착 시각)이라 "현재 휴무 상태"가 아님.
    // 외출도 endTime이 있으면 이미 복귀한 것.
    const onLeaveMemberMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime) && item.type !== '지각')
            .map(item => [item.member, item])
    );

    const baseClasses = "member-select-btn w-full p-2 rounded-lg border-2 text-center transition-all duration-200 min-h-[50px] flex flex-col justify-center";
    const disabledClasses = "bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed opacity-60";
    const unselectedClasses = "bg-white border-gray-300 text-gray-900 hover:bg-blue-50 hover:border-blue-300";
    // listeners-form-team.js 의 SELECTED_CLASSES 와 같아야 한다(선택 여부를 bg-blue-600 으로 판단)
    const selectedClasses = "bg-blue-600 border-blue-600 text-white hover:bg-blue-700";
    // 휴대폰(768px 미만)은 그룹을 세로로 쌓고, PC 는 192px 칸을 가로로 늘어놓는다
    const groupBoxClasses = 'flex-shrink-0 w-full md:w-48 bg-gray-100 rounded-lg flex flex-col';
    const selfTag = '<span class="ml-1 align-middle text-[11px] font-bold px-1.5 rounded bg-blue-100 text-blue-700">나</span>';
    const clockInStartBtn = '<button type="button" class="self-clockin-start-btn w-full mt-1 p-2 rounded-lg border-2 border-blue-600 bg-white text-blue-700 font-bold text-sm hover:bg-blue-50 transition">출근하고 시작</button>';

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean);
    // 본인 그룹을 맨 앞으로(나머지 순서는 그대로)
    const selfGroupIdx = selfName ? orderedTeamGroups.findIndex(g => (g.members || []).includes(selfName)) : -1;
    if (selfGroupIdx > 0) orderedTeamGroups.unshift(...orderedTeamGroups.splice(selfGroupIdx, 1));

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = groupBoxClasses;
        groupContainer.innerHTML = `
            <div class="flex justify-between items-center p-2 border-b border-gray-200">
                <h4 class="text-md font-bold text-gray-800">${group.name}</h4>
                <button type="button" class="group-select-all-btn text-xs bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-2 py-1 rounded shadow-sm transition-all" data-group-name="${group.name}">전체</button>
            </div>`;

        const memberList = document.createElement('div');
        memberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
        memberList.dataset.groupName = group.name;

        [...new Set(group.members)].forEach(member => {
            if (!isMemberActiveOn(member, null, appConfig)) return; // 🚪 퇴사자(오늘 기준 비활성) 제외
            const isOngoing = ongoingMembers.has(member);
            const isPaused = pausedMembers.has(member);
            const leaveEntry = onLeaveMemberMap.get(member);
            const isOnLeave = !!leaveEntry;
            
            const attendance = appState.dailyAttendance?.[member];
            const isClockedIn = attendance && attendance.status === 'active';
            const isReturned = attendance && attendance.status === 'returned';

            const isDisabled = isOngoing || isPaused || isOnLeave || !isClockedIn;
            const isSelf = member === selfName;
            const isSelected = !isDisabled && selectedSet.has(member);

            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            card.className = `${baseClasses} ${isDisabled ? disabledClasses : (isSelected ? selectedClasses : unselectedClasses)}`;
            if (isDisabled) card.disabled = true;

            let statusLabel = '';
            if (isOngoing) { statusLabel = '<div class="text-xs text-blue-500 font-medium">업무 중</div>'; }
            else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600 font-medium">휴식 중</div>'; }
            else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500 font-medium">${leaveEntry.type} 중</div>`; }
            else if (isReturned) { statusLabel = '<div class="text-xs text-gray-400 font-medium">퇴근 완료</div>'; }
            else if (!isClockedIn) { statusLabel = '<div class="text-xs text-gray-400 font-medium">출근 전</div>'; }
            
            card.innerHTML = `<div class="font-bold">${member}${isSelf ? selfTag : ''}</div>${statusLabel}`;

            memberList.appendChild(card);
            // 본인이 출근 전(근태·업무·퇴근 아님)이면 칸 아래 [출근하고 시작] — 자동 출근이 아니라 한 번 눌러야 한다
            if (isSelf && !isOngoing && !isPaused && !isOnLeave && !isClockedIn && !isReturned) {
                memberList.insertAdjacentHTML('beforeend', clockInStartBtn);
            }
        });
        groupContainer.appendChild(memberList);
        container.appendChild(groupContainer);
    });

    const albaGroupContainer = document.createElement('div');
    albaGroupContainer.className = groupBoxClasses;
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

        const attendance = appState.dailyAttendance?.[pt.name];
        const isClockedIn = attendance && attendance.status === 'active';
        const isReturned = attendance && attendance.status === 'returned';
        const isDisabled = isOngoing || isPaused || isOnLeave || !isClockedIn;
        const isSelected = !isDisabled && selectedSet.has(pt.name);

        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        card.className = `${baseClasses} ${isDisabled ? disabledClasses : (isSelected ? selectedClasses : unselectedClasses)}`;
        if (isDisabled) card.disabled = true;

        let statusLabel = '';
        if (isOngoing) { statusLabel = '<div class="text-xs text-blue-500 font-medium">업무 중</div>'; }
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
    // 본인이 알바면 알바 그룹을 맨 앞으로
    if (selfName && (appState.partTimers || []).some(pt => pt.name === selfName)) container.prepend(albaGroupContainer);
    else container.appendChild(albaGroupContainer);
};

export const renderLeaveTypeModalOptions = (leaveTypes = [], initialTab = 'setting') => {
    const container = document.getElementById('leave-type-options');
    const dateInputsDiv = document.getElementById('leave-date-inputs');
    const timeInputsDiv = document.getElementById('leave-time-inputs'); // ✅ 추가된 영역
    const confirmBtn = document.getElementById('confirm-leave-btn');
    
    const tabSetting = document.getElementById('tab-leave-setting');
    const tabStatus = document.getElementById('tab-leave-status');
    const panelSetting = document.getElementById('panel-leave-setting');
    const panelStatus = document.getElementById('panel-leave-status');
    const memberNameEl = document.getElementById('leave-member-name');
    
    if (!container) return;

    const memberName = memberNameEl ? memberNameEl.textContent : '';

    const updateStatusView = () => {
        const stats = calculateLeaveUsage(memberName);
        const today = getTodayDateString();
        
        const totalEl = document.getElementById('status-total-days');
        const usedEl = document.getElementById('status-used-days');
        const remainEl = document.getElementById('status-remaining-days');
        const joinDateEl = document.getElementById('status-join-date');
        const historyListEl = document.getElementById('status-history-list');

        if (totalEl) {
            const autoCalcBadge = stats.isAutoCalculated ? '<span class="text-xs text-blue-500 block font-normal">(12개월 미만 자동 계산)</span>' : '';
            totalEl.innerHTML = `${stats.total}일 ${autoCalcBadge}`;
        }
        if (usedEl) usedEl.textContent = `${stats.used}일`;
        
        if (remainEl) {
            remainEl.className = stats.remaining < 0 ? "text-3xl font-bold text-red-600" : "text-3xl font-bold text-blue-600";
            
            let periodHtml = '';
            if (stats.leaveResetDate || stats.expirationDate) {
                const start = stats.leaveResetDate || '';
                const end = stats.expirationDate || '';
                const rangeStr = (start && end) ? `${start} ~ ${end}` : (start ? `${start} ~` : `~ ${end}`);
                
                const isExpired = stats.expirationDate && today > stats.expirationDate;
                const expiredBadge = isExpired ? '<span class="text-red-500 font-bold ml-1">(만료됨)</span>' : '';
                
                periodHtml = `<div class="text-xs text-gray-500 font-normal mt-1">사용 가능 기한: ${rangeStr}${expiredBadge}</div>`;
            }
            
            remainEl.innerHTML = `<div>${stats.remaining}일</div>${periodHtml}`;
        }
        
        if (joinDateEl) {
            const tenureText = calculateTenure(stats.joinDate);
            let dateText = stats.joinDate && stats.joinDate !== '-' ? stats.joinDate : '-';
            
            joinDateEl.innerHTML = `${dateText} <span class="text-blue-600 font-bold ml-1">(${tenureText})</span>`;
        }

        if (historyListEl) {
            historyListEl.innerHTML = '';
            if (stats.history.length === 0) {
                historyListEl.innerHTML = '<li class="text-center text-gray-400 py-4">사용 내역이 없습니다.</li>';
            } else {
                stats.history.forEach(h => {
                    const idsString = h.ids.join(',');
                    const mergedBadge = h.isMerged ? '<span class="text-[11px] text-purple-600 bg-purple-50 border border-purple-200 px-1 rounded ml-1">병합됨</span>' : '';
                    const editBtnHtml = h.isMerged ? '' : `<button type="button" class="text-xs text-gray-400 hover:text-blue-600 underline transition btn-edit-leave-history" data-id="${h.ids[0]}" data-member="${h.member}">수정</button>`;

                    historyListEl.innerHTML += `
                        <li class="flex justify-between items-center bg-white p-2 rounded border border-gray-100 shadow-sm">
                            <div>
                                <span class="font-semibold text-gray-700 text-xs block flex items-center">
                                    <span class="text-blue-500 mr-1">[${h.nth}차]</span> ${h.startDate} ${h.endDate && h.endDate !== h.startDate ? '~ ' + h.endDate.slice(5) : ''}
                                    ${mergedBadge}
                                </span>
                                <span class="text-[11px] text-gray-400">-${h.days}일 차감</span>
                            </div>
                            <div class="flex items-center gap-2">
                                ${editBtnHtml}
                                <button type="button" class="text-xs text-gray-400 hover:text-red-600 underline transition btn-delete-leave-history" data-ids="${idsString}" data-member="${h.member}">삭제</button>
                            </div>
                        </li>`;
                });
            }
        }
    };

    // 일정 등록 탭 우측 패널: 해당 멤버의 모든 예정 근태 (오늘 포함, 모든 유형)
    const updateUpcomingLeaveView = () => {
        const upcomingListEl = document.getElementById('status-upcoming-list');
        const upcomingCountEl = document.getElementById('status-upcoming-count');
        if (!upcomingListEl) return;

        const today = getTodayDateString();
        const TYPE_STYLE = {
            '연차':    'bg-blue-50 text-blue-700 border-blue-200',
            '출장':    'bg-purple-50 text-purple-700 border-purple-200',
            '결근':    'bg-red-50 text-red-700 border-red-200',
            '기타':    'bg-gray-100 text-gray-700 border-gray-300',
            '휴직':    'bg-gray-100 text-gray-700 border-gray-300',
            '매장근무': 'bg-emerald-50 text-emerald-700 border-emerald-200',
            '재택근무': 'bg-teal-50 text-teal-700 border-teal-200',
            '외근':    'bg-amber-50 text-amber-700 border-amber-200'
        };

        const upcoming = (persistentLeaveSchedule.onLeaveMembers || [])
            .filter(item => {
                if (!item || item.member !== memberName) return false;
                if (!item.startDate) return false; // 시간성(외출·조퇴·지각)은 일자 문서에 저장 — 제외
                const end = item.endDate || item.startDate;
                return end >= today; // 오늘 포함 이후
            })
            .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

        if (upcomingCountEl) upcomingCountEl.textContent = upcoming.length > 0 ? `총 ${upcoming.length}건` : '';

        upcomingListEl.innerHTML = '';
        if (upcoming.length === 0) {
            upcomingListEl.innerHTML = '<li class="text-center text-gray-400 py-8 text-xs">예정된 근태가 없습니다.</li>';
            return;
        }
        upcoming.forEach(item => {
            const endStr = item.endDate || item.startDate;
            const days = calculateWorkingDays(item.startDate, endStr);
            const rangeText = (endStr && endStr !== item.startDate) ? `${item.startDate} ~ ${endStr}` : item.startDate;
            const isInProgress = item.startDate <= today && today <= endStr;
            const progressBadge = isInProgress ? '<span class="text-[11px] text-orange-700 font-bold bg-orange-50 border border-orange-200 px-1.5 py-0.5 rounded">진행중</span>' : '';
            const typeStyle  = TYPE_STYLE[item.type] || 'bg-gray-50 text-gray-700 border-gray-200';
            upcomingListEl.innerHTML += `
                <li class="flex justify-between items-center bg-gray-50 p-2 rounded border border-gray-100 gap-2">
                    <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span class="text-[11px] font-bold px-2 py-0.5 rounded border shrink-0 ${typeStyle}">${item.type}</span>
                        <span class="text-xs font-medium text-gray-700 truncate">${rangeText}</span>
                        ${progressBadge}
                    </div>
                    <div class="flex items-center gap-1 shrink-0">
                        <span class="text-[11px] text-gray-400 mr-0.5">${days}일</span>
                        <button type="button" class="btn-edit-leave-history text-[11px] font-bold text-blue-600 hover:text-blue-800 px-1.5 py-0.5 rounded hover:bg-blue-50" data-id="${item.id}">수정</button>
                        <button type="button" class="btn-delete-leave-history text-[11px] font-bold text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50" data-ids="${item.id}">삭제</button>
                    </div>
                </li>`;
        });
    };
    // 삭제·수정 후 목록 즉시 갱신용으로 노출(모달 열려있는 동안만 유효)
    window.__refreshUpcomingLeave = updateUpcomingLeaveView;

    // 🔗 캘린더·데이터관리 등 다른 화면에서 근태가 바뀌어도 이 목록을 최신으로 유지
    onLeaveScheduleChanged('my-leave-modal', () => {
        try { window.__refreshUpcomingLeave && window.__refreshUpcomingLeave(); } catch (e) {}
    });

    const activateTab = (tab) => {
        if (tab === 'status') {
            tabStatus.className = "flex-1 py-3 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 transition";
            tabSetting.className = "flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition";
            panelStatus.classList.remove('hidden');
            panelSetting.classList.add('hidden');
            if(confirmBtn) confirmBtn.classList.add('hidden');
            updateStatusView();
        } else {
            tabSetting.className = "flex-1 py-3 text-sm font-semibold text-blue-600 border-b-2 border-blue-600 transition";
            tabStatus.className = "flex-1 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 transition";
            panelSetting.classList.remove('hidden');
            panelStatus.classList.add('hidden');

            // 우측 예정 근태 리스트 갱신
            updateUpcomingLeaveView();

            // ✅ [추가 로직] 설정 탭으로 올 때 값 초기화 및 기본값 설정
            if(confirmBtn) {
                confirmBtn.classList.remove('hidden');
                confirmBtn.textContent = '설정 저장';
                delete confirmBtn.dataset.editingId;

                const sInput = document.getElementById('leave-start-date-input');
                const eInput = document.getElementById('leave-end-date-input');
                const stInput = document.getElementById('leave-start-time-input');
                const etInput = document.getElementById('leave-end-time-input');

                if(sInput) sInput.value = getTodayDateString(); // 기본값: 오늘 날짜
                if(eInput) eInput.value = '';
                if(stInput) stInput.value = getCurrentTime(); // 기본값: 현재 시간
                if(etInput) etInput.value = '';

                document.querySelectorAll('input[name="leave-type"]').forEach((r,i) => r.checked = i===0);

                // 첫 라디오 버튼 선택 후 체인지 이벤트 발생시켜 화면 갱신
                const firstRadio = container.querySelector('input[type="radio"]');
                if(firstRadio) firstRadio.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    };

    if (tabSetting) tabSetting.onclick = () => activateTab('setting');
    if (tabStatus) tabStatus.onclick = () => activateTab('status');

    activateTab(initialTab);

    // 라디오 버튼 생성
    container.innerHTML = '';
    leaveTypes.forEach((type, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center p-3 border border-gray-200 rounded-xl bg-white hover:bg-blue-50 hover:border-blue-200 transition cursor-pointer shadow-sm';
        div.innerHTML = `
            <input id="leave-type-${index}" name="leave-type" type="radio" value="${type}" class="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 focus:ring-blue-500 focus:ring-2 cursor-pointer leave-type-radio">
            <label for="leave-type-${index}" class="w-full ml-2 text-sm font-bold text-gray-700 cursor-pointer select-none">${type}</label>
        `;
        container.appendChild(div);
    });

    // ✅ [추가 로직] 클릭한 종류에 따라 날짜 입력창 vs 시간 입력창 노출 분기 처리
    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('leave-type-radio')) {
            const selectedType = e.target.value;
            
            // '기타'를 고르면 항목명 직접 입력칸을 연다.
            const otherWrap = document.getElementById('leave-other-label-wrap');
            const otherInput = document.getElementById('leave-other-label-input');
            if (otherWrap) {
                const isOther = (selectedType === OTHER_LEAVE_TYPE);
                otherWrap.classList.toggle('hidden', !isOther);
                if (isOther && otherInput) setTimeout(() => otherInput.focus(), 30);
                if (!isOther && otherInput) otherInput.value = '';
            }

            // 기간(날짜) 선택형 / 시간 선택형 — 종류 목록은 state.js 한 곳에서만 관리한다.
            const timeTypes = TIME_BASED_LEAVE_TYPES;

            if (isPersistentLeaveType(selectedType)) {
                if(dateInputsDiv) dateInputsDiv.classList.remove('hidden');
                if(timeInputsDiv) timeInputsDiv.classList.add('hidden');
                
                const sInput = document.getElementById('leave-start-date-input');
                if(sInput && !sInput.value) sInput.value = getTodayDateString();

            } else if (timeTypes.includes(selectedType)) {
                if(dateInputsDiv) dateInputsDiv.classList.add('hidden');
                if(timeInputsDiv) timeInputsDiv.classList.remove('hidden');
                
                const stInput = document.getElementById('leave-start-time-input');
                if(stInput && !stInput.value) stInput.value = getCurrentTime();
                
            } else {
                if(dateInputsDiv) dateInputsDiv.classList.add('hidden');
                if(timeInputsDiv) timeInputsDiv.classList.add('hidden');
            }
        }
    });

    // 렌더링 직후 첫 번째 옵션 기본 트리거
    const firstRadio = container.querySelector('input[type="radio"]');
    if (firstRadio) {
        firstRadio.checked = true;
        firstRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const sInput = document.getElementById('leave-start-date-input');
    const eInput = document.getElementById('leave-end-date-input');
    const preview = document.getElementById('leave-count-preview');
    
    // 미리보기 업데이트 
    const updatePreview = () => {
        if (!preview) return;
        const sVal = sInput ? sInput.value : '';
        const eVal = eInput ? eInput.value : '';
        
        if (sVal && eVal) {
            const diff = calculateWorkingDays(sVal, eVal);
            preview.textContent = `총 ${diff}일(평일) 적용 예정`; 
        } else if (sVal) {
            const diff = calculateWorkingDays(sVal, sVal);
            preview.textContent = diff > 0 ? `1일 적용 예정` : `0일 적용 예정 (주말/휴일)`;
        } else {
            preview.textContent = '';
        }
    };
    if (sInput) sInput.addEventListener('change', updatePreview);
    if (eInput) eInput.addEventListener('change', updatePreview);
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