import { formatTimeTo24H, formatDuration } from './utils.js';
import { quantityTaskTypes, taskGroups, teamGroups } from './config.js';

export const renderQuantityModalInputs = (sourceQuantities = {}) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    container.innerHTML = '';
    quantityTaskTypes.forEach(task => {
        const div = document.createElement('div');
        div.innerHTML = `
            <label for="modal-quantity-${task}" class="block text-sm font-medium text-gray-700">${task}</label>
            <input type="number" id="modal-quantity-${task}" data-task="${task}" value="${sourceQuantities[task] || 0}" min="0" class="mt-1 w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 transition">
        `;
        container.appendChild(div);
    });
};

export const renderTaskSelectionModal = () => {
    const container = document.getElementById('task-modal-content');
    container.innerHTML = '';
    Object.entries(taskGroups).forEach(([groupName, tasks]) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex-1';
        let tasksHtml = tasks.map(task => `<button type="button" data-task="${task}" class="task-select-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:ring-2 focus:ring-blue-300">${task}</button>`).join('');
        groupDiv.innerHTML = `
            <div class="bg-gray-50 rounded-lg border h-full">
                <h3 class="text-lg font-bold text-gray-800 mb-0 p-3 border-b bg-gray-100 rounded-t-lg">${groupName}</h3>
                <div class="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">${tasksHtml}</div>
            </div>
        `;
        container.appendChild(groupDiv);
    });
};

export const renderTaskAnalysis = (appState) => {
    const analysisContainer = document.getElementById('analysis-content');
    analysisContainer.innerHTML = '';
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalLoggedMinutes = completedRecords.reduce((sum, record) => sum + record.duration, 0);

    if (totalLoggedMinutes === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">완료된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        return;
    }

    const taskColors = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399'};

    const taskAnalysis = completedRecords.reduce((acc, record) => {
        acc[record.task] = (acc[record.task] || 0) + record.duration;
        return acc;
    }, {});

    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow">';

    sortedTasks.forEach(([task, minutes]) => {
        const percentage = (minutes / totalLoggedMinutes) * 100;
        const color = taskColors[task] || '#6b7280';
        if (percentage > 0) {
            gradientParts.push(`${color} ${cumulativePercentage}% ${cumulativePercentage + percentage}%`);
            cumulativePercentage += percentage;
        }
        legendHTML += `<div class="flex items-center justify-between mb-2"><div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background-color: ${color};"></span><span class="font-semibold text-gray-700">${task}</span></div><div class="text-right"><div class="text-sm font-semibold text-gray-800">${formatDuration(minutes)}</div><div class="text-xs text-gray-500">${percentage.toFixed(1)}%</div></div></div>`;
    });
    legendHTML += '</div>';

    const finalGradient = `conic-gradient(${gradientParts.join(', ')})`;
    analysisContainer.innerHTML = `<div class="flex flex-col md:flex-row items-center gap-6 md:gap-8"><div class="flex-shrink-0"><div class="chart" style="background: ${finalGradient};"><div class="chart-center"><span class="text-sm text-gray-500">총 업무</span><span class="text-xl font-bold text-blue-600 mt-1">${formatDuration(totalLoggedMinutes)}</span></div></div></div>${legendHTML}</div>`;
};

export const renderRealtimeStatus = (appState) => {
    const teamStatusBoard = document.getElementById('team-status-board');
    teamStatusBoard.innerHTML = '';

    const memberGroupMap = new Map();
    teamGroups.forEach(group => group.members.forEach(member => {
        if (!memberGroupMap.has(member)) memberGroupMap.set(member, group.name);
    }));

    // --- Section 1: Preset Task Quick Actions ---
    const presetTaskContainer = document.createElement('div');
    presetTaskContainer.className = 'mb-6';
    presetTaskContainer.innerHTML = `<h3 class="text-lg font-bold text-gray-700 border-b pb-2 mb-4">주요 업무 (시작할 업무 카드를 클릭)</h3>`;

    // [변경점 1] 그리드 컬럼 수 변경 (lg 화면에서 4개) -> 가로폭 약간 줄어듦
    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4'; // gap-3 -> gap-4 로 간격 조정

    const baseTasks = ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));

    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);

        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];

            // [변경점 2] 카드 최소 높이 증가 (min-h-[220px] -> min-h-[300px])
            card.className = 'p-3 rounded-lg border flex flex-col justify-between min-h-[300px] transition-shadow cursor-pointer hover:shadow-md hover:border-blue-400';
            card.dataset.action = 'add-member';
            card.dataset.groupId = firstRecord.groupId;
            card.dataset.task = firstRecord.task;

            const isPaused = groupRecords.some(r => r.status === 'paused');

            // [변경점 3] 참여 인원 목록 최대 높이 증가 (max-h-24 -> max-h-48)
            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">'; // space-y-2 -> space-y-1 간격 줄임
            groupRecords.sort((a,b) => a.startTime.localeCompare(b.startTime)).forEach(rec => {
                // [변경점 4] 이름/시간/종료버튼을 한 줄에 표시 (flex 사용)
                membersHtml += `<div class="text-sm text-gray-700 hover:bg-gray-100 rounded p-1 group flex justify-between items-center">
                    <div> {/* 이름과 시간 묶음 */}
                        <span class="font-semibold text-gray-800 break-keep">${rec.member}</span>
                        <span class="text-xs text-gray-500 ml-1">(${formatTimeTo24H(rec.startTime)})</span>
                    </div>
                    <button data-action="stop-individual" data-record-id="${rec.id}" class="hidden group-hover:inline-block text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded hover:bg-red-200 ml-2 flex-shrink-0">종료</button>
                </div>`; // 기존 구조 삭제 및 변경
            });
            membersHtml += '</div>';

            if(isPaused) { card.classList.add('bg-yellow-50', 'border-yellow-200');} else {card.classList.add('bg-blue-50', 'border-blue-200');}
            let titleColorClass = isPaused ? 'text-yellow-800' : 'text-blue-800';
            let statusText = isPaused ? ' (일시정지)' : '';
            let participationCount = groupRecords.length;

            const buttonHtml = `<div class="mt-auto space-y-2 pt-2"> {/* pt-2 추가 */}
                                <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} w-full text-white font-bold py-2 rounded-md transition text-sm">${isPaused ? '업무재개' : '일시정지'}</button>
                                <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn bg-red-600 hover:bg-red-700 w-full text-white font-bold py-2 rounded-md transition text-sm">종료</button>
                            </div>`;

            const earliestStartTime = groupRecords.reduce((earliest, current) => (earliest < current.startTime ? earliest : current.startTime), "23:59");
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime);
            const durationStatus = isPaused ? 'paused' : 'ongoing';

            card.innerHTML = `<div class="flex flex-col h-full">
                                <div class="font-bold text-lg ${titleColorClass} break-keep">${firstRecord.task}${statusText}</div>
                                <div class="text-xs text-gray-500 my-2">시작: ${formatTimeTo24H(earliestStartTime)} <span class="ongoing-duration" data-start-time="${earliestStartTime}" data-status="${durationStatus}" data-record-id="${representativeRecord.id}"></span></div>
                                <div class="font-semibold text-gray-600 text-sm mb-1">참여 인원 (${participationCount}명):</div> {/* mb-2 -> mb-1 */}
                                <div class="flex-grow">${membersHtml}</div>
                                ${buttonHtml}
                            </div>`;
        } else {
            // [변경점 5] 카드 최소 높이 증가 (min-h-[220px] -> min-h-[300px])
            card.className = 'p-3 rounded-lg border flex flex-col justify-between min-h-[300px] transition-shadow cursor-pointer hover:shadow-md hover:border-blue-400 bg-blue-50 border-blue-200';
            card.dataset.action = 'start-task';
            card.dataset.task = task;

            card.innerHTML = `
                <div class="flex-grow">
                    <div class="font-bold text-lg text-blue-800 break-keep">${task}</div>
                    <div class="text-xs text-gray-500 my-2">시작: 시작 전</div>
                    <div class="font-semibold text-gray-600 text-sm mb-1">참여 인원 (0명):</div>
                    <div class="text-xs text-gray-400 italic flex-grow flex items-center">카드를 클릭하여 팀원 선택</div>
                </div>
                <div class="mt-auto space-y-2 pt-2"> {/* pt-2 추가 */}
                    <button class="bg-yellow-500 text-white font-bold py-2 rounded-md text-sm w-full opacity-50 cursor-not-allowed">일시정지</button>
                    <button class="bg-red-600 text-white font-bold py-2 rounded-md text-sm w-full opacity-50 cursor-not-allowed">종료</button>
                </div>
            `;
        }
        presetGrid.appendChild(card);
    });

    // [변경점 6] "기타 업무" 카드를 다시 presetGrid 안에 포함시킴
    const otherTaskCard = document.createElement('div');
    // [변경점 7] 카드 최소 높이 증가 (min-h-[220px] -> min-h-[300px])
    otherTaskCard.className = 'p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-shadow cursor-pointer hover:shadow-md hover:border-gray-400 bg-gray-50 border-gray-200';
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `
        <div class="font-bold text-lg text-gray-700">기타 업무</div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div class="text-xs text-gray-500 mt-3">새로운 업무 시작</div>
    `;
    presetGrid.appendChild(otherTaskCard); // presetGrid에 추가

    presetTaskContainer.appendChild(presetGrid); // presetGrid를 컨테이너에 추가
    teamStatusBoard.appendChild(presetTaskContainer); // 컨테이너를 최종 보드에 추가


    // --- Section 2: ALL TEAM MEMBER STATUS ---
    // (이 섹션은 변경 사항 없습니다)
    const allMembersContainer = document.createElement('div');
    const allMembersHeader = document.createElement('div');
    allMembersHeader.className = 'flex justify-between items-center border-b pb-2 mb-4 mt-8';
    allMembersHeader.innerHTML = `<h3 class="text-lg font-bold text-gray-700">전체 팀원 현황 (클릭하여 휴무 설정/취소)</h3>`;
    allMembersContainer.appendChild(allMembersHeader);

    // [중요 버그 수정 완료] const ongoingRecords -> ongoingRecordsForStatus 로 변수명 변경
    const ongoingRecordsForStatus = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Map(ongoingRecordsForStatus.map(r => [r.member, r.task]));
    const pausedMembers = new Map(appState.workRecords.filter(r => r.status === 'paused').map(r => [r.member, r.task]));

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean);


    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'mb-4';
        const groupHeader = document.createElement('div');
        groupHeader.className = 'flex items-center gap-2 mb-2';
        groupHeader.innerHTML = `<h4 class="text-md font-semibold text-gray-600">${group.name}</h4>`;
        groupContainer.appendChild(groupHeader);
        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2';
        const uniqueMembersInGroup = [...new Set(group.members)];

        uniqueMembersInGroup.forEach(member => {
            const card = document.createElement('button');
            card.type = 'button';
            const isOnLeave = (appState.onLeaveMembers || []).includes(member);
            const isWorking = workingMembers.has(member) || pausedMembers.has(member);

            card.className = 'p-1 rounded-lg border text-center transition-shadow min-h-[64px] w-24 flex flex-col justify-center';

            if (!isWorking) {
                card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                card.dataset.memberToggleLeave = member;
            } else {
                card.classList.add('cursor-not-allowed');
            }

            if (isOnLeave) {
                card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div><div class="text-xs">휴무</div>`;
            } else if (workingMembers.has(member)) {
                card.classList.add('bg-red-50', 'border-red-200');
                card.innerHTML = `<div class="font-semibold text-sm text-red-800 break-keep">${member}</div><div class="text-xs text-gray-600 truncate" title="${workingMembers.get(member)}">${workingMembers.get(member)}</div>`;
            } else if (pausedMembers.has(member)) {
                card.classList.add('bg-yellow-50', 'border-yellow-200');
                card.innerHTML = `<div class="font-semibold text-sm text-yellow-800 break-keep">${member}</div><div class="text-xs text-yellow-600">휴식 중</div>`;
            } else {
                card.classList.add('bg-green-50', 'border-green-200');
                card.innerHTML = `<div class="font-semibold text-sm text-green-800 break-keep">${member}</div><div class="text-xs text-green-600">대기 중</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    // Part-timer section
    const workingAlbaMembers = new Set(appState.workRecords.filter(r => (r.status === 'ongoing' || r.status === 'paused')).map(r => r.member));
    const activePartTimers = (appState.partTimers || []).filter(pt => workingAlbaMembers.has(pt.name));

    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div');
        albaContainer.className = 'mb-4';
        albaContainer.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2">알바</h4>`;

        const albaGrid = document.createElement('div');
        albaGrid.className = 'flex flex-wrap gap-2';

        activePartTimers.forEach(pt => {
             const card = document.createElement('div');
             card.className = 'relative p-1 rounded-lg border text-center transition-shadow min-h-[64px] w-24 flex flex-col justify-center';

             const currentlyWorkingTask = workingMembers.get(pt.name);
             const isPaused = pausedMembers.has(pt.name);

             if (currentlyWorkingTask) {
                 card.classList.add('bg-red-50', 'border-red-200');
                 card.innerHTML = `<div class="font-semibold text-sm text-red-800">${pt.name}</div><div class="text-xs text-gray-600 truncate" title="${currentlyWorkingTask}">${currentlyWorkingTask}</div>`;
             } else if (isPaused) {
                 card.classList.add('bg-yellow-50', 'border-yellow-200');
                 card.innerHTML = `<div class="font-semibold text-sm text-yellow-800">${pt.name}</div><div class="text-xs text-yellow-600">휴식 중</div>`;
             }
             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid);
        allMembersContainer.appendChild(albaContainer);
    }
    teamStatusBoard.appendChild(allMembersContainer);
};

export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    workLogBody.innerHTML = '';
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const groupedRecords = completedRecords.reduce((acc, record) => {
        (acc[record.task] = acc[record.task] || []).push(record);
        return acc;
    }, {});
    const sortedTasks = Object.keys(groupedRecords).sort();

    if (sortedTasks.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">완료된 업무가 없습니다.</td></tr>`;
    } else {
        sortedTasks.forEach(task => {
            const groupHeaderRow = document.createElement('tr');
            groupHeaderRow.className = 'bg-gray-100';
            groupHeaderRow.innerHTML = `<th colspan="6" class="px-6 py-3 text-left text-base text-blue-700 font-bold">${task}</th>`;
            workLogBody.appendChild(groupHeaderRow);
            groupedRecords[task].sort((a,b) => a.startTime.localeCompare(b.startTime)).forEach(record => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b border-gray-200 hover:bg-gray-50';
                row.innerHTML = `<td class="px-6 py-4 font-medium text-gray-900">${record.member}</td><td class="px-6 py-4">${record.task}</td><td class="px-6 py-4">${formatTimeTo24H(record.startTime)}</td><td class="px-6 py-4">${formatTimeTo24H(record.endTime)}</td><td class="px-6 py-4">${formatDuration(record.duration)}</td><td class="px-6 py-4 text-right space-x-2"><button data-action="edit" data-record-id="${record.id}" class="font-medium text-blue-500 hover:underline">수정</button><button data-action="delete" data-record-id="${record.id}" class="font-medium text-red-500 hover:underline">삭제</button></td>`;
                workLogBody.appendChild(row);
            });
        });
    }
};

export const updateSummary = (appState) => {
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Set(ongoingRecords.map(r => r.member));
    const allMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));

    const totalStaff = allMembers.size;
    const onLeaveCount = (appState.onLeaveMembers || []).length;
    const workingCount = workingMembers.size;
    const activeStaff = totalStaff - onLeaveCount + allPartTimers.size;
    const idleCount = activeStaff - workingCount;
    const ongoingTaskCount = new Set(ongoingRecords.map(r => r.task)).size;

    document.getElementById('summary-total-staff').textContent = `${totalStaff}`;
    document.getElementById('summary-leave-staff').textContent = `${onLeaveCount}`;
    document.getElementById('summary-active-staff').textContent = `${activeStaff}`;
    document.getElementById('summary-working-staff').textContent = `${workingCount}`;
    document.getElementById('summary-idle-staff').textContent = `${idleCount}`;
    document.getElementById('summary-ongoing-tasks').textContent = `${ongoingTaskCount}`;
};

export const renderTeamSelectionModalContent = (task, appState) => {
    document.getElementById('team-select-modal-title').textContent = `'${task || '기타 업무'}' 팀원 선택`;
    const container = document.getElementById('team-select-modal-content');
    container.innerHTML = '';

    const allWorkingMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused').map(r => r.member)
    );
    const onLeaveMembers = new Set(appState.onLeaveMembers || []);

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
                <button type="button" class="group-select-all-btn text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded" data-group-name="${group.name}">전체</button>
            </div>`;

        const memberList = document.createElement('div');
        memberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
        memberList.dataset.groupName = group.name;

        const uniqueMembersInGroup = [...new Set(group.members)];
        uniqueMembersInGroup.forEach(member => {
            const isWorking = allWorkingMembers.has(member);
            const isOnLeave = onLeaveMembers.has(member);
            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

            if (isWorking || isOnLeave) card.disabled = true;

            let statusLabel = '';
            if (isWorking) {
                statusLabel = '<div class="text-xs text-red-500">업무 중</div>';
            } else if (isOnLeave) {
                statusLabel = '<div class="text-xs text-gray-500">휴무</div>';
            }
            card.innerHTML = `<div class="font-semibold">${member}</div>${statusLabel}`;

            memberList.appendChild(card);
        });
        groupContainer.appendChild(memberList);
        container.appendChild(groupContainer);
    });

    // Render Alba group separately
    const albaGroupContainer = document.createElement('div');
    albaGroupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col';
    albaGroupContainer.innerHTML = `<div class="flex justify-between items-center p-2 border-b border-gray-200">
                                         <h4 class="text-md font-bold text-gray-800">알바</h4>
                                         <div>
                                             <button type="button" class="group-select-all-btn text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded" data-group-name="알바">전체</button>
                                             <button id="add-part-timer-modal-btn" class="text-xs bg-blue-200 hover:bg-blue-300 text-blue-800 px-2 py-0.5 rounded ml-1">+ 추가</button>
                                         </div>
                                    </div>`;
    const albaMemberList = document.createElement('div');
    albaMemberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
    albaMemberList.dataset.groupName = '알바';

    (appState.partTimers || []).forEach(pt => {
        const isWorking = allWorkingMembers.has(pt.name);
        const isOnLeave = onLeaveMembers.has(pt.name); // Also check for part-timers
        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

        if (isWorking || isOnLeave) card.disabled = true;

        let statusLabel = '';
        if (isWorking) {
            statusLabel = '<div class="text-xs text-red-500">업무 중</div>';
        } else if (isOnLeave) {
            statusLabel = '<div class="text-xs text-gray-500">휴무</div>';
        }
        card.innerHTML = `<div class="font-semibold">${pt.name}</div>${statusLabel}`;

        cardWrapper.appendChild(card);

        const editBtn = document.createElement('button');
        editBtn.dataset.partTimerId = pt.id;
        editBtn.className = 'edit-part-timer-btn absolute top-1 right-5 p-1 text-gray-400 hover:text-blue-600';
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L13.196 5.2z" /></svg>`;
        cardWrapper.appendChild(editBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.dataset.partTimerId = pt.id;
        deleteBtn.className = 'delete-part-timer-btn absolute top-1 right-1 p-1 text-gray-400 hover:text-red-600';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
        cardWrapper.appendChild(deleteBtn);

        albaMemberList.appendChild(cardWrapper);
    });

    albaGroupContainer.appendChild(albaMemberList);
    container.appendChild(albaGroupContainer);
};