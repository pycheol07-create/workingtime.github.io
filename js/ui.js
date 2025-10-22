import { formatTimeTo24H, formatDuration } from './utils.js';

// 업무별 카드 스타일 정의 (중복 선언 제거)
const taskCardStyles = {
    '국내배송': ['bg-green-50', 'border-green-200', 'text-green-800'],
    '중국제작': ['bg-purple-50', 'border-purple-200', 'text-purple-800'],
    '직진배송': ['bg-emerald-50', 'border-emerald-200', 'text-emerald-800'],
    '채우기': ['bg-sky-50', 'border-sky-200', 'text-sky-800'],
    '개인담당업무': ['bg-indigo-50', 'border-indigo-200', 'text-indigo-800'],
    '티니': ['bg-red-50', 'border-red-200', 'text-red-800'],
    '택배포장': ['bg-orange-50', 'border-orange-200', 'text-orange-800'],
    '해외배송': ['bg-cyan-50', 'border-cyan-200', 'text-cyan-800'],
    '재고조사': ['bg-fuchsia-50', 'border-fuchsia-200', 'text-fuchsia-800'],
    '앵글정리': ['bg-amber-50', 'border-amber-200', 'text-amber-800'],
    '상품재작업': ['bg-yellow-50', 'border-yellow-200', 'text-yellow-800'],
    '상.하차': ['bg-stone-50', 'border-stone-200', 'text-stone-800'],
    '검수': ['bg-teal-50', 'border-teal-200', 'text-teal-800'],
    '아이롱': ['bg-violet-50', 'border-violet-200', 'text-violet-800'],
    '오류': ['bg-rose-50', 'border-rose-200', 'text-rose-800'],
    '강성': ['bg-pink-50', 'border-pink-200', 'text-pink-800'],
    '2층업무': ['bg-neutral-50', 'border-neutral-200', 'text-neutral-800'],
    '재고찾는시간': ['bg-lime-50', 'border-lime-200', 'text-lime-800'],
    '매장근무': ['bg-cyan-50', 'border-cyan-200', 'text-cyan-800'],
    '출장': ['bg-gray-50', 'border-gray-200', 'text-gray-800'],
    'default': ['bg-blue-50', 'border-blue-200', 'text-blue-800'],
    'paused': ['bg-yellow-50', 'border-yellow-200', 'text-yellow-800']
};


export const renderQuantityModalInputs = (sourceQuantities = {}, quantityTaskTypes = []) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    if (!container) return;
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

export const renderTaskSelectionModal = (taskGroups = {}) => {
    const container = document.getElementById('task-modal-content');
    if (!container) return;
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
    if (!analysisContainer) return;
    analysisContainer.innerHTML = '';
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalLoggedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0);

    if (totalLoggedMinutes === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">완료된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        return;
    }

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};

    const taskAnalysis = completedRecords.reduce((acc, record) => {
        if (record.task) {
            acc[record.task] = (acc[record.task] || 0) + (record.duration || 0);
        }
        return acc;
    }, {});

    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow">';

    sortedTasks.forEach(([task, minutes]) => {
        const percentage = totalLoggedMinutes > 0 ? (minutes / totalLoggedMinutes) * 100 : 0;
        const color = taskColorsHex[task] || '#6b7280';
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


export const renderRealtimeStatus = (appState, teamGroups = []) => {
    // [삭제] 로딩 스피너 숨기기 로직 제거 (app.js에서 처리)
    
    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) {
        console.error("Element #team-status-board not found!");
        return;
    }
    // `app.js`에서 스피너를 숨긴 후 이 함수가 호출되므로,
    // `innerHTML`을 비우는 것이 안전합니다.
    teamStatusBoard.innerHTML = '';

    const memberGroupMap = new Map();
    teamGroups.forEach(group => group.members.forEach(member => {
        if (!memberGroupMap.has(member)) memberGroupMap.set(member, group.name);
    }));

    // --- Section 1: Preset Task Quick Actions ---
    const presetTaskContainer = document.createElement('div');
    presetTaskContainer.className = 'mb-6';
    presetTaskContainer.innerHTML = `<h3 class="text-lg font-bold text-gray-700 border-b pb-2 mb-4">주요 업무 (시작할 업무 카드를 클릭)</h3>`;

    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4';

    const baseTasks = ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));
    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        const isPaused = groupRecords.some(r => r.status === 'paused');

        let styleClasses = taskCardStyles[task] || taskCardStyles['default'];
        if (isPaused) {
            styleClasses = taskCardStyles['paused'];
        }
        const [bgColor, borderColor, titleColor] = styleClasses;
        const hoverBorderColor = borderColor.replace('-200', '-400');

        card.className = `p-3 rounded-lg border flex flex-col justify-between min-h-[300px] transition-shadow cursor-pointer hover:shadow-md ${bgColor} ${borderColor} hover:${hoverBorderColor}`;

        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];
            card.dataset.action = 'add-member';
            card.dataset.groupId = firstRecord.groupId;
            card.dataset.task = firstRecord.task;

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                membersHtml += `<div class="text-sm text-gray-700 hover:bg-gray-100 rounded p-1 group flex justify-between items-center">
                    <span class="font-semibold text-gray-800 break-keep mr-1 inline-block w-12 text-left truncate" title="${rec.member}">${rec.member}</span>
                    <span class="text-xs text-gray-500 flex-grow text-center">(${formatTimeTo24H(rec.startTime)})</span>
                    <button data-action="stop-individual" data-record-id="${rec.id}" class="inline-block text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded hover:bg-red-200 ml-1 flex-shrink-0">종료</button>
                </div>`;
            });
            membersHtml += '</div>';

            let statusText = isPaused ? ' (일시정지)' : '';
            let participationCount = groupRecords.length;

            const buttonHtml = `<div class="mt-auto space-y-2 pt-2">
                                <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} w-full text-white font-bold py-2 rounded-md transition text-sm">${isPaused ? '업무재개' : '일시정지'}</button>
                                <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn bg-red-600 hover:bg-red-700 w-full text-white font-bold py-2 rounded-md transition text-sm">종료</button>
                            </div>`;

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime);
            const recordIdForDuration = representativeRecord ? representativeRecord.id : groupRecords[0].id;
            const durationStatus = isPaused ? 'paused' : 'ongoing';

            card.innerHTML = `<div class="flex flex-col h-full">
                                <div class="font-bold text-lg ${titleColor} break-keep">${firstRecord.task}${statusText}</div>
                                <div class="text-xs text-gray-500 my-2">시작: ${formatTimeTo24H(earliestStartTime)} <span class="ongoing-duration" data-start-time="${earliestStartTime || ''}" data-status="${durationStatus}" data-record-id="${recordIdForDuration || ''}"></span></div>
                                <div class="font-semibold text-gray-600 text-sm mb-1">${participationCount}명 참여중:</div>
                                <div class="flex-grow">${membersHtml}</div>
                                ${buttonHtml}
                            </div>`;
        } else {
            card.dataset.action = 'start-task';
            card.dataset.task = task;

            card.innerHTML = `
                <div class="flex-grow">
                    <div class="font-bold text-lg ${titleColor} break-keep">${task}</div>
                    <div class="text-xs text-gray-500 my-2">시작: 시작 전</div>
                    <div class="font-semibold text-gray-600 text-sm mb-1">참여 인원 (0명):</div>
                    <div class="text-xs text-gray-400 italic flex-grow flex items-center">카드를 클릭하여 팀원 선택</div>
                </div>
                <div class="mt-auto space-y-2 pt-2">
                    <button class="bg-yellow-500 text-white font-bold py-2 rounded-md text-sm w-full opacity-50 cursor-not-allowed">일시정지</button>
                    <button class="bg-red-600 text-white font-bold py-2 rounded-md text-sm w-full opacity-50 cursor-not-allowed">종료</button>
                </div>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    otherTaskCard.className = 'p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-shadow cursor-pointer hover:shadow-md hover:border-gray-400 bg-gray-50 border-gray-200';
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `
        <div class="font-bold text-lg text-gray-700">기타 업무</div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div class="text-xs text-gray-500 mt-3">새로운 업무 시작</div>
    `;
    presetGrid.appendChild(otherTaskCard);
    presetTaskContainer.appendChild(presetGrid);
    teamStatusBoard.appendChild(presetTaskContainer);


    // --- Section 2: ALL TEAM MEMBER STATUS ---
    const allMembersContainer = document.createElement('div');
    const allMembersHeader = document.createElement('div');
    allMembersHeader.className = 'flex justify-between items-center border-b pb-2 mb-4 mt-8';
    allMembersHeader.innerHTML = `<h3 class="text-lg font-bold text-gray-700">전체 팀원 현황 (클릭하여 휴무 설정/취소)</h3>`;
    allMembersContainer.appendChild(allMembersHeader);

    const ongoingRecordsForStatus = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Map(ongoingRecordsForStatus.map(r => [r.member, r.task]));
    const pausedMembers = new Map((appState.workRecords || []).filter(r => r.status === 'paused').map(r => [r.member, r.task]));
    
    // [수정] appState.onLeaveMembers는 이제 오늘 날짜에 필터링된 *전체* 휴무 목록임
    const onLeaveStatusMap = new Map(
        (appState.onLeaveMembers || []).map(item => [item.member, item])
    );

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
            const leaveInfo = onLeaveStatusMap.get(member);
            const isOnLeave = !!leaveInfo;
            const isWorking = workingMembers.has(member) || pausedMembers.has(member);

            card.className = 'p-1 rounded-lg border text-center transition-shadow min-h-[64px] w-24 flex flex-col justify-center';
            card.dataset.memberToggleLeave = member;
            if (!isWorking) {
                card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
            } else {
                card.classList.add('opacity-70', 'cursor-not-allowed');
            }

            if (isOnLeave) {
                card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                let detailText = '';
                if (leaveInfo.startTime) {
                    detailText = formatTimeTo24H(leaveInfo.startTime);
                    if (leaveInfo.endTime) {
                         detailText += ` - ${formatTimeTo24H(leaveInfo.endTime)}`;
                    } else if (leaveInfo.type === '외출') {
                         detailText += ' ~';
                    }
                }
                else if (leaveInfo.startDate) {
                    detailText = leaveInfo.startDate.substring(5);
                    if (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate) {
                        detailText += ` ~ ${leaveInfo.endDate.substring(5)}`;
                    }
                }
                card.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div>
                                  <div class="text-xs">${leaveInfo.type || '휴무'}</div>
                                  ${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
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

    const workingAlbaMembers = new Set((appState.workRecords || []).filter(r => (r.status === 'ongoing' || r.status === 'paused')).map(r => r.member));
    const activePartTimers = (appState.partTimers || []).filter(pt => {
        return workingAlbaMembers.has(pt.name) || onLeaveStatusMap.has(pt.name);
    });

    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div');
        albaContainer.className = 'mb-4';
        albaContainer.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2">알바</h4>`;

        const albaGrid = document.createElement('div');
        albaGrid.className = 'flex flex-wrap gap-2';

        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             card.type = 'button';
             card.dataset.memberToggleLeave = pt.name;
             card.className = 'relative p-1 rounded-lg border text-center transition-shadow min-h-[64px] w-24 flex flex-col justify-center';

             const currentlyWorkingTask = workingMembers.get(pt.name);
             const isPaused = pausedMembers.has(pt.name);
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = currentlyWorkingTask || isPaused;

             if (!isAlbaWorking) {
                 card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
             } else {
                 card.classList.add('opacity-70', 'cursor-not-allowed');
             }

             if (isAlbaOnLeave) {
                 card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                 let detailText = '';
                 if (albaLeaveInfo.startTime) {
                     detailText = formatTimeTo24H(albaLeaveInfo.startTime);
                     if (albaLeaveInfo.endTime) {
                         detailText += ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}`;
                     } else if (albaLeaveInfo.type === '외출') {
                         detailText += ' ~';
                     }
                 } else if (albaLeaveInfo.startDate) {
                    detailText = albaLeaveInfo.startDate.substring(5);
                    if (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate) {
                        detailText += ` ~ ${albaLeaveInfo.endDate.substring(5)}`;
                    }
                 }
                 card.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div>
                                   <div class="text-xs">${albaLeaveInfo.type || '휴무'}</div>
                                   ${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
             } else if (currentlyWorkingTask) {
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
    teamStatusBoard.appendChild(presetTaskContainer);
    teamStatusBoard.appendChild(allMembersContainer);
};

export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = '';
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    if (!completedRecords || completedRecords.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">완료된 업무가 없습니다.</td></tr>`;
        return;
    }

    const groupedRecords = completedRecords.reduce((acc, record) => {
        if (!acc[record.task]) acc[record.task] = [];
        acc[record.task].push(record);
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
            groupedRecords[task].sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(record => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b border-gray-200 hover:bg-gray-50';
                row.innerHTML = `<td class="px-6 py-4 font-medium text-gray-900">${record.member || 'N/A'}</td><td class="px-6 py-4">${record.task || 'N/A'}</td><td class="px-6 py-4">${formatTimeTo24H(record.startTime)}</td><td class="px-6 py-4">${formatTimeTo24H(record.endTime)}</td><td class="px-6 py-4">${formatDuration(record.duration)}</td><td class="px-6 py-4 text-right space-x-2"><button data-action="edit" data-record-id="${record.id}" class="font-medium text-blue-500 hover:underline">수정</button><button data-action="delete" data-record-id="${record.id}" class="font-medium text-red-500 hover:underline">삭제</button></td>`;
                workLogBody.appendChild(row);
            });
        });
    }
};

export const updateSummary = (appState, teamGroups = []) => {
    const summaryTotalStaffEl = document.getElementById('summary-total-staff');
    const summaryLeaveStaffEl = document.getElementById('summary-leave-staff');
    const summaryActiveStaffEl = document.getElementById('summary-active-staff');
    const summaryWorkingStaffEl = document.getElementById('summary-working-staff');
    const summaryIdleStaffEl = document.getElementById('summary-idle-staff');
    const summaryOngoingTasksEl = document.getElementById('summary-ongoing-tasks');

    const allStaffMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    // [수정] appState.onLeaveMembers는 이미 필터링된 목록임
    const onLeaveEntries = appState.onLeaveMembers || [];
    const onLeaveMemberNames = new Set(onLeaveEntries.map(item => item.member));
    const onLeaveTotalCount = onLeaveMemberNames.size; 

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const workingMembers = new Set(ongoingOrPausedRecords.map(r => r.member));
    const workingStaffCount = [...workingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...workingMembers].filter(member => allPartTimers.has(member)).length;
    const totalWorkingCount = workingMembers.size;

    const availableStaffCount = totalStaffCount - [...onLeaveMemberNames].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = totalPartTimerCount - [...onLeaveMemberNames].filter(member => allPartTimers.has(member)).length;
    
    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount);
    const totalIdleCount = idleStaffCount; 

    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    // DOM 업데이트
    if (summaryTotalStaffEl) summaryTotalStaffEl.textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (summaryLeaveStaffEl) summaryLeaveStaffEl.textContent = `${onLeaveTotalCount}`;
    if (summaryActiveStaffEl) summaryActiveStaffEl.textContent = `${availableStaffCount}/${availablePartTimerCount}`; 
    if (summaryWorkingStaffEl) summaryWorkingStaffEl.textContent = `${totalWorkingCount}`;
    if (summaryIdleStaffEl) summaryIdleStaffEl.textContent = `${totalIdleCount}`;
    if (summaryOngoingTasksEl) summaryOngoingTasksEl.textContent = `${ongoingTaskCount}`;
};

export const renderTeamSelectionModalContent = (task, appState, teamGroups = []) => {
    const titleEl = document.getElementById('team-select-modal-title');
    const container = document.getElementById('team-select-modal-content');
    if (!titleEl || !container) return;

    titleEl.textContent = `'${task || '기타 업무'}' 팀원 선택`;
    container.innerHTML = '';

    const allWorkingMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused').map(r => r.member)
    );
    // [수정] appState.onLeaveMembers는 이미 필터링된 목록임
    const onLeaveMemberNames = new Set((appState.onLeaveMembers || []).map(item => item.member));

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
            const isOnLeave = onLeaveMemberNames.has(member); 
            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

            if (isWorking || isOnLeave) card.disabled = true;

            let statusLabel = '';
            if (isWorking) {
                statusLabel = '<div class="text-xs text-red-500">업무 중</div>';
            } else if (isOnLeave) {
                statusLabel = '<div class="text-xs text-gray-500">휴무 중</div>'; 
            }
            card.innerHTML = `<div class="font-semibold">${member}</div>${statusLabel}`;

            memberList.appendChild(card);
        });
        groupContainer.appendChild(memberList);
        container.appendChild(groupContainer);
    });

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
        const isOnLeave = onLeaveMemberNames.has(pt.name); 
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
            statusLabel = '<div class="text-xs text-gray-500">휴무 중</div>'; 
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

    // 라디오 버튼 변경 시 이벤트 리스너 추가
    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('leave-type-radio')) {
            const selectedType = e.target.value;
            // [수정] 연차, 출장, 결근 선택 시 날짜 필드 보이기
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
        // [수정] 초기 상태 확인 및 날짜 필드 표시/숨김 (맨 처음 로드 시)
        if (firstRadio.value === '연차' || firstRadio.value === '출장' || firstRadio.value === '결근') {
            dateInputsDiv.classList.remove('hidden');
        } else {
            dateInputsDiv.classList.add('hidden');
        }
    }
};

export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    const data = allHistoryData.find(d => d.id === dateKey);
    
    let html = `
        <div class="mb-4 pb-2 border-b flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">${dateKey} 근태 현황</h3>
            <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                    onclick="downloadAttendanceHistoryAsExcel('${dateKey}')">
                근태 엑셀
            </button>
        </div>
    `;

    if (!data || !data.onLeaveMembers || data.onLeaveMembers.length === 0) {
        html += `<div class="bg-white p-4 rounded-lg shadow-sm text-center text-gray-500">해당 날짜의 근태 기록이 없습니다.</div>`;
        view.innerHTML = html;
        return;
    }

    const leaveEntries = data.onLeaveMembers;
    leaveEntries.sort((a, b) => (a.member || '').localeCompare(b.member || '')); 

    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                    <tr>
                        <th scope="col" class="px-6 py-3">이름</th>
                        <th scope="col" class="px-6 py-3">유형</th>
                        <th scope="col" class="px-6 py-3">시간 / 기간</th>
                    </tr>
                </thead>
                <tbody>
    `;

    leaveEntries.forEach(entry => {
        let detailText = '-';
        if (entry.startTime) { // 외출/조퇴
            detailText = formatTimeTo24H(entry.startTime);
            if (entry.endTime) {
                detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
            } else if (entry.type === '외출') {
                detailText += ' ~';
            }
        } else if (entry.startDate) { // 연차/출장/결근
            detailText = entry.startDate;
            if (entry.endDate && entry.endDate !== entry.startDate) {
                detailText += ` ~ ${entry.endDate}`;
            }
        }

        html += `
            <tr class="bg-white border-b">
                <td class="px-6 py-4 font-medium text-gray-900">${entry.member}</td>
                <td class="px-6 py-4">${entry.type}</td>
                <td class="px-6 py-4">${detailText}</td>
            </tr>
        `;
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    view.innerHTML = html;
};

export const renderAttendanceWeeklyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    const weeklyData = allHistoryData.reduce((acc, day) => {
        if (!day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0) return acc;
        try {
            const weekKey = getWeekOfYear(new Date(day.id));
            if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };
            
            day.onLeaveMembers.forEach(entry => {
                if (entry.startDate) {
                    const currentDate = day.id;
                    const startDate = entry.startDate;
                    const endDate = entry.endDate || entry.startDate; 
                    if (currentDate >= startDate && currentDate <= endDate) {
                         acc[weekKey].leaveEntries.push({ ...entry, date: day.id }); 
                    }
                } else {
                     acc[weekKey].leaveEntries.push(entry); 
                }
            });
            acc[weekKey].dateKeys.add(day.id);
        } catch (e) { /* noop */ }
        return acc;
    }, {});

    const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
    if (sortedWeeks.length === 0) {
        view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터가 없습니다.</div>';
        return;
    }
    
    let html = '';
    sortedWeeks.forEach(weekKey => {
        const data = weeklyData[weekKey];
        const summary = data.leaveEntries.reduce((acc, entry) => {
            const key = `${entry.member}-${entry.type}`;
            if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };
            
            if(entry.startDate) { // 연차, 출장, 결근 (날짜 기반)
                acc[key].count += 1; // 횟수 = 일수
                acc[key].days += 1;
            } else { // 외출, 조퇴
                acc[key].count += 1; // 횟수
            }
            return acc;
        }, {});

        html += `<div class="bg-white p-4 rounded-lg shadow-sm">
                    <h3 class="text-xl font-bold mb-3">${weekKey}</h3>
                    <div class="space-y-1">`;
        
        if (Object.keys(summary).length === 0) {
             html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
        } else {
            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                 html += `<div class="flex justify-between text-sm">
                            <span class="font-semibold text-gray-700">${item.member}</span>
                            <span>${item.type}</span>
                            <span class="text-right">${item.days > 0 ? `${item.days}일` : `${item.count}회`}</span>
                         </div>`;
            });
        }
        html += `</div></div>`;
    });

    view.innerHTML = html;
};

export const renderAttendanceMonthlyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    const monthlyData = allHistoryData.reduce((acc, day) => {
        if (!day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0) return acc;
        try {
            const monthKey = day.id.substring(0, 7);
            if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                if (entry.startDate) {
                    const currentDate = day.id;
                    const startDate = entry.startDate;
                    const endDate = entry.endDate || entry.startDate;
                    if (currentDate >= startDate && currentDate <= endDate) {
                         acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                } else {
                     acc[monthKey].leaveEntries.push(entry);
                }
            });
            acc[monthKey].dateKeys.add(day.id);
        } catch (e) { /* noop */ }
        return acc;
    }, {});

    const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));
    if (sortedMonths.length === 0) {
        view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터가 없습니다.</div>';
        return;
    }

    let html = '';
    sortedMonths.forEach(monthKey => {
        const data = monthlyData[monthKey];
        const summary = data.leaveEntries.reduce((acc, entry) => {
            const key = `${entry.member}-${entry.type}`;
            if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };
            
            if(entry.startDate) {
                acc[key].count += 1;
                acc[key].days += 1;
            } else {
                acc[key].count += 1;
            }
            return acc;
        }, {});

        html += `<div class="bg-white p-4 rounded-lg shadow-sm">
                    <h3 class="text-xl font-bold mb-3">${monthKey}</h3>
                    <div class="space-y-1">`;

        if (Object.keys(summary).length === 0) {
             html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
        } else {
            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                 html += `<div class="flex justify-between text-sm">
                            <span class="font-semibold text-gray-700">${item.member}</span>
                            <span>${item.type}</span>
                            <span class="text-right">${item.days > 0 ? `${item.days}일` : `${item.count}회`}</span>
                         </div>`;
            });
        }
        html += `</div></div>`;
    });

    view.innerHTML = html;
};