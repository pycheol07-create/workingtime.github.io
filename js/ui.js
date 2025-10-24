// === ui.js (업무 카드 그리드 및 직원 카드 크기 조정) ===

import { formatTimeTo24H, formatDuration, getWeekOfYear } from './utils.js'; // getWeekOfYear import

// ... (taskCardStyles, taskTitleColors 정의는 이전과 동일) ...
const taskCardStyles = {
    'default': {
        card: ['bg-blue-50', 'border-gray-300', 'text-gray-700', 'shadow-sm'],
        hover: 'hover:border-blue-500 hover:shadow-md',
        subtitle: 'text-gray-500',
        buttonBgOff: 'bg-gray-200',
        buttonTextOff: 'text-gray-500'
    },
    'ongoing': {
        card: ['bg-blue-100', 'border-blue-500', 'text-gray-900', 'shadow-xl', 'shadow-blue-200/50'], // 진행 중 강조
        hover: 'hover:border-blue-600',
        subtitle: 'text-gray-600',
        buttonBgOn: 'bg-blue-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-blue-700'
    },
    'paused': {
        card: ['bg-yellow-50', 'border-yellow-300', 'text-yellow-800', 'shadow-md', 'shadow-yellow-100/50'],
        hover: 'hover:border-yellow-400 hover:shadow-lg',
        title: 'text-yellow-800',
        subtitle: 'text-yellow-700',
        buttonBgOn: 'bg-yellow-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-yellow-700'
    }
};
const taskTitleColors = {
    '국내배송': 'text-green-700',
    '중국제작': 'text-purple-700',
    '직진배송': 'text-emerald-700',
    '채우기': 'text-sky-700',
    '개인담당업무': 'text-indigo-700',
    '티니': 'text-red-700',
    '택배포장': 'text-orange-700',
    '해외배송': 'text-cyan-700',
    '재고조사': 'text-fuchsia-700',
    '앵글정리': 'text-amber-700',
    '상품재작업': 'text-yellow-800',
    '상.하차': 'text-stone-700',
    '검수': 'text-teal-700',
    '아이롱': 'text-violet-700',
    '오류': 'text-rose-700',
    '강성': 'text-pink-700',
    '2층업무': 'text-neutral-700',
    '재고찾는시간': 'text-lime-700',
    '매장근무': 'text-blue-700',
    '출장': 'text-gray-700',
    'default': 'text-blue-700'
};


export const renderQuantityModalInputs = (sourceQuantities = {}, quantityTaskTypes = []) => {
    // ... (이전과 동일) ...
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
    // ... (이전과 동일) ...
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

// ✅ [수정] appConfig 파라미터 추가 및 로직 변경
export const renderTaskAnalysis = (appState, appConfig) => {
    // ✅ [수정] 렌더링 대상을 #analysis-task-summary-panel로 변경
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; // 이 패널만 초기화
    
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalLoggedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0);

    if (totalLoggedMinutes === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">완료된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        // ✅ [추가] 개인별 통계 드롭다운도 비워둠
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};

    const taskAnalysis = completedRecords.reduce((acc, record) => {
        if (record && record.task) { // record 유효성 검사 추가
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
    
    // ✅ [추가] 총 휴식 시간 계산
    let totalBreakMinutes = 0;
    completedRecords.forEach(record => {
        (record.pauses || []).forEach(pause => {
            // 'break' 타입이거나, 타입이 없는 구(old) 데이터도 휴식으로 간주
            if (pause.start && pause.end && (pause.type === 'break' || !pause.type)) { 
                const s = new Date(`1970-01-01T${pause.start}:00Z`).getTime();
                const e = new Date(`1970-01-01T${pause.end}:00Z`).getTime();
                if (e > s) {
                    totalBreakMinutes += (e - s) / 60000;
                }
            }
        });
    });
    
    // ✅ [수정] 렌더링 위치 변경 및 '총 휴식' 시간 추가
    analysisContainer.innerHTML = `<div class="flex flex-col md:flex-row items-center gap-6 md:gap-8">
        <div class="flex-shrink-0">
            <div class="chart" style="background: ${finalGradient};">
                <div class="chart-center">
                    <span class="text-sm text-gray-500">총 업무</span>
                    <span class="text-xl font-bold text-blue-600">${formatDuration(totalLoggedMinutes)}</span>
                    <span class="text-xs text-gray-500 mt-1">총 휴식: ${formatDuration(Math.round(totalBreakMinutes))}</span>
                </div>
            </div>
        </div>
        ${legendHTML}
    </div>`;


    // ✅ [추가] 개인별 통계 드롭다운 채우기
    const memberSelect = document.getElementById('analysis-member-select');
    if (memberSelect) {
        const staff = (appConfig.teamGroups || []).flatMap(g => g.members);
        const partTimers = (appState.partTimers || []).map(p => p.name);
        
        const allMembers = [...new Set([...staff, ...partTimers])].sort((a, b) => a.localeCompare(b));
        
        let optionsHtml = '<option value="">--- 직원/알바 선택 ---</option>';
        allMembers.forEach(member => {
            optionsHtml += `<option value="${member}">${member}</option>`;
        });
        memberSelect.innerHTML = optionsHtml;
    }
};

export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = []) => {
    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) {
        console.error("Element #team-status-board not found!");
        return;
    }
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
    // ✅ [수정] 그리드 컬럼 설정 변경 (xl: 7개 추가)
    presetGrid.className = 'grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4';

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));
    
    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);

        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');

        let currentStyle;
        if (isPaused) {
            currentStyle = taskCardStyles['paused'];
        } else if (isOngoing || groupRecords.length > 0) {
            currentStyle = taskCardStyles['ongoing'];
        } else {
            currentStyle = taskCardStyles['default'];
        }

        const titleClass = isPaused ? currentStyle.title : (taskTitleColors[task] || taskTitleColors['default']);

        card.className = `p-3 rounded-lg border flex flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')} ${currentStyle.hover}`;


        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];

            card.dataset.action = 'add-member';
            card.dataset.groupId = firstRecord.groupId;
            card.dataset.task = firstRecord.task;

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {

                const isRecPaused = rec.status === 'paused';

                const memberTextColor = isRecPaused ? 'text-yellow-800' : 'text-gray-800';
                const timeTextColor = isRecPaused ? 'text-yellow-600' : 'text-gray-500';
                const stopButtonBg = isRecPaused ? 'bg-yellow-200 hover:bg-yellow-300' : 'bg-red-100 hover:bg-red-200';
                const stopButtonText = isRecPaused ? 'text-yellow-700' : 'text-red-700';
                const memberRowBg = isRecPaused ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50';

                let pauseResumeButtonHtml = '';
                if (rec.status === 'ongoing') {
                    pauseResumeButtonHtml = `<button data-action="pause-individual" data-record-id="${rec.id}" class="inline-block text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-700 px-2 py-0.5 rounded ml-1 flex-shrink-0">정지</button>`;
                } else if (rec.status === 'paused') {
                    pauseResumeButtonHtml = `<button data-action="resume-individual" data-record-id="${rec.id}" class="inline-block text-xs bg-green-100 hover:bg-green-200 text-green-700 px-2 py-0.5 rounded ml-1 flex-shrink-0">재개</button>`;
                }

                membersHtml += `<div class="text-sm ${memberRowBg} rounded p-1 group flex justify-between items-center">
                    <span class="font-semibold ${memberTextColor} break-keep mr-1 inline-block text-left" title="${rec.member}">${rec.member}</span>
                    <span class="text-xs ${timeTextColor} flex-grow text-center">(${formatTimeTo24H(rec.startTime)}) ${isRecPaused ? '(휴식중)' : ''}</span>
                    <div class="flex-shrink-0 flex items-center">
                        ${pauseResumeButtonHtml}
                        <button data-action="stop-individual" data-record-id="${rec.id}" class="inline-block text-xs ${stopButtonBg} ${stopButtonText} px-2 py-0.5 rounded ml-1">종료</button>
                    </div>
                </div>`;
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime);
            const recordIdForDuration = representativeRecord ? representativeRecord.id : groupRecords[0].id;

            const durationStatus = isOngoing ? 'ongoing' : 'paused';

            const stopBtnClass = `bg-red-600 hover:bg-red-700 text-white`;

            card.innerHTML = `<div class="flex flex-col h-full">
                                <div class="font-bold text-lg ${titleClass} break-keep">${firstRecord.task} ${isPaused ? ' (일시정지)' : ''}</div>
                                <div class="text-xs ${currentStyle.subtitle} my-2">시작: ${formatTimeTo24H(earliestStartTime)} <span class="ongoing-duration" data-start-time="${earliestStartTime || ''}" data-status="${durationStatus}" data-record-id="${recordIdForDuration || ''}"></span></div>
                                <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">${groupRecords.length}명 참여중:</div>
                                <div class="flex-grow">${membersHtml}</div>
                                <div class="mt-auto space-y-2 pt-2">
                                    <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} w-full text-white font-bold py-2 rounded-md transition text-sm">
                                        ${isPaused ? '전체 재개' : '전체 정지'}
                                    </button>
                                    <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn ${stopBtnClass} w-full text-white font-bold py-2 rounded-md transition text-sm">전체 종료</button>
                                </div>
                            </div>`;
        } else {
            card.dataset.action = 'start-task';
            card.dataset.task = task;

            card.innerHTML = `
                <div class="flex-grow">
                    <div class="font-bold text-lg ${titleClass} break-keep">${task}</div>
                    <div class="text-xs ${currentStyle.subtitle} my-2">시작: 시작 전</div>
                    <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">참여 인원 (0명):</div>
                    <div class="text-xs ${currentStyle.subtitle} italic flex-grow flex items-center justify-center text-center">카드를 클릭하여 팀원 선택</div>
                </div>
                <div class="mt-auto space-y-2 pt-2">
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} w-full font-bold py-2 rounded-md text-sm opacity-50 cursor-not-allowed">일시정지</button>
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} w-full font-bold py-2 rounded-md text-sm opacity-50 cursor-not-allowed">종료</button>
                </div>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    const otherStyle = taskCardStyles['default'];
    otherTaskCard.className = `p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-all duration-200 cursor-pointer ${otherStyle.card.join(' ')} ${otherStyle.hover}`;
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
    allMembersHeader.innerHTML = `<h3 class="text-lg font-bold text-gray-700">전체 팀원 현황 (클릭하여 근태 설정/취소)</h3>`;
    allMembersContainer.appendChild(allMembersHeader);

    const ongoingRecordsForStatus = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Map(ongoingRecordsForStatus.map(r => [r.member, r.task]));
    const pausedMembers = new Map((appState.workRecords || []).filter(r => r.status === 'paused').map(r => [r.member, r.task]));

    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const onLeaveStatusMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => [item.member, item])
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

            // ✅ [수정] 직원 카드 크기 조정: w-24 -> w-28, min-h-[64px] -> min-h-[72px]
            card.className = 'p-1 rounded-lg border text-center transition-shadow min-h-[72px] w-28 flex flex-col justify-center';
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
                                  <div class="text-xs">${leaveInfo.type}</div>
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

    // --- 알바 섹션 ---
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
             // ✅ [수정] 알바 카드 크기 조정: w-24 -> w-28, min-h-[64px] -> min-h-[72px]
             card.className = 'relative p-1 rounded-lg border text-center transition-shadow min-h-[72px] w-28 flex flex-col justify-center';

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
                     if (albaLeaveInfo.endTime) { detailText += ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}`; }
                     else if (albaLeaveInfo.type === '외출') { detailText += ' ~'; }
                  } else if (albaLeaveInfo.startDate) {
                    detailText = albaLeaveInfo.startDate.substring(5);
                    if (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate) { detailText += ` ~ ${albaLeaveInfo.endDate.substring(5)}`; }
                  }
                 card.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div>
                                   <div class="text-xs">${albaLeaveInfo.type}</div>
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

// ... (renderCompletedWorkLog, updateSummary, renderTeamSelectionModalContent, renderLeaveTypeModalOptions, renderSummaryView, renderWeeklyHistory, renderMonthlyHistory, renderAttendanceDailyHistory, renderAttendanceWeeklyHistory, renderAttendanceMonthlyHistory 함수들은 이전과 동일) ...
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

    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    
    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime)) 
            .map(item => item.member)
    );
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
    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    
    const onLeaveMemberMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime)) 
            .map(item => [item.member, item])
    );

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
            const leaveEntry = onLeaveMemberMap.get(member);
            const isOnLeave = !!leaveEntry;
            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

            if (isWorking || isOnLeave) card.disabled = true;

            let statusLabel = '';
            if (isWorking) { statusLabel = '<div class="text-xs text-red-500">업무 중</div>'; }
            else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500">${leaveEntry.type} 중</div>`; }
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
        const leaveEntry = onLeaveMemberMap.get(pt.name);
        const isOnLeave = !!leaveEntry;
        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

        if (isWorking || isOnLeave) card.disabled = true;

        let statusLabel = '';
        if (isWorking) { statusLabel = '<div class="text-xs text-red-500">업무 중</div>'; }
        else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500">${leaveEntry.type} 중</div>`; }
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

const renderSummaryView = (mode, dataset, periodKey, wageMap = {}) => {
    const records = dataset.workRecords || [];
    const quantities = dataset.taskQuantities || {};

    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities || {}).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0;
        return s + ((r.duration || 0) / 60) * wage;
    }, 0);

    const overallAvgThroughput = totalDuration > 0 ? (totalQuantity / totalDuration).toFixed(2) : '0.00';
    const overallAvgCostPerItem = totalQuantity > 0 ? (totalCost / totalQuantity).toFixed(0) : '0';

    const taskSummary = records.reduce((acc, r) => {
        if (!r || !r.task) return acc;
        if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0 };
        acc[r.task].duration += (r.duration || 0);
        const wage = wageMap[r.member] || 0;
        acc[r.task].cost += ((r.duration || 0) / 60) * wage;
        return acc;
    }, {});

    Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
        const qty = Number(qtyValue) || 0;
        if (taskSummary[task]) {
            taskSummary[task].quantity = qty;
            taskSummary[task].avgThroughput = taskSummary[task].duration > 0 ? (qty / taskSummary[task].duration).toFixed(2) : '0.00';
            taskSummary[task].avgCostPerItem = qty > 0 ? (taskSummary[task].cost / qty).toFixed(0) : '0';
        } else if (qty > 0) {
            taskSummary[task] = { duration: 0, cost: 0, quantity: qty, avgThroughput: 'N/A', avgCostPerItem: 'N/A' };
        }
    });

    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">`;
    html += `<h3 class="text-xl font-bold mb-4">${periodKey} 요약</h3>`;

    html += `<div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 text-center">
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 시간</div><div class="text-lg font-bold">${formatDuration(totalDuration)}</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 처리량</div><div class="text-lg font-bold">${totalQuantity} 개</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 인건비</div><div class="text-lg font-bold">${Math.round(totalCost).toLocaleString()} 원</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리량</div><div class="text-lg font-bold">${overallAvgThroughput} 개/분</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리비용</div><div class="text-lg font-bold">${overallAvgCostPerItem} 원/개</div></div>
    </div>`;

    html += `<h4 class="text-lg font-semibold mb-3 text-gray-700">업무별 평균</h4>`;
    html += `<div class="overflow-x-auto max-h-60">
               <table class="w-full text-sm text-left text-gray-600">
                 <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0">
                   <tr>
                     <th scope="col" class="px-4 py-2">업무</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리량 (개/분)</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리비용 (원/개)</th>
                   </tr>
                 </thead>
                 <tbody>`;

    const sortedTasks = Object.keys(taskSummary).sort();
    let hasTaskData = false;
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const summary = taskSummary[task];
            if (summary && (summary.duration > 0 || summary.quantity > 0)) {
                hasTaskData = true;
                html += `<tr class="bg-white border-b hover:bg-gray-50">
                           <td class="px-4 py-2 font-medium text-gray-900">${task}</td>
                           <td class="px-4 py-2 text-right">${summary.avgThroughput || '0.00'}</td>
                           <td class="px-4 py-2 text-right">${summary.avgCostPerItem || '0'}</td>
                         </tr>`;
            }
        });
    }

    if (!hasTaskData) {
        html += `<tr><td colspan="3" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }

    html += `    </tbody>
               </table>
             </div>`;

    html += `</div>`;
    return html;
};

export const renderWeeklyHistory = (allHistoryData, appConfig) => {
    const view = document.getElementById('history-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 데이터 집계 중...</div>';

    try {
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };


        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string') return acc;
            try {
                const dateObj = new Date(day.id);
                if (isNaN(dateObj.getTime())) return acc;

                const weekKey = getWeekOfYear(dateObj);
                if (!weekKey) return acc;

                if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };

                acc[weekKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) {
                console.error("Error processing day in weekly aggregation:", day.id, e);
            }
            return acc;
        }, {});

        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
        if (sortedWeeks.length === 0) {
            view.innerHTML = '<div class="text-center text-gray-500">주별 데이터가 없습니다.</div>';
            return;
        }

        view.innerHTML = sortedWeeks.map(weekKey => renderSummaryView('weekly', weeklyData[weekKey], weekKey, combinedWageMap)).join('');
    } catch (error) {
        console.error("Error in renderWeeklyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">주별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
    }
};

export const renderMonthlyHistory = (allHistoryData, appConfig) => {
    const view = document.getElementById('history-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 데이터 집계 중...</div>';

    try {
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                 if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };


        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string' || day.id.length < 7) return acc;
            try {
                const monthKey = day.id.substring(0,7);
                if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;

                if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
                acc[monthKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) {
                 console.error("Error processing day in monthly aggregation:", day.id, e);
            }
            return acc;
        }, {});

        const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));
        if (sortedMonths.length === 0) {
            view.innerHTML = '<div class="text-center text-gray-500">월별 데이터가 없습니다.</div>';
            return;
        }

        view.innerHTML = sortedMonths.map(monthKey => renderSummaryView('monthly', monthlyData[monthKey], monthKey, combinedWageMap)).join('');
    } catch (error) {
        console.error("Error in renderMonthlyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">월별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
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
            <div>
                <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm"
                        onclick="downloadAttendanceHistoryAsExcel('${dateKey}')">
                    근태 엑셀 (전체)
                </button>
                <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                        onclick="requestHistoryDeletion('${dateKey}')">
                    삭제
                </button>
            </div>
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
        if (entry.startTime) {
            detailText = formatTimeTo24H(entry.startTime);
            if (entry.endTime) {
                detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
            } else if (entry.type === '외출') {
                detailText += ' ~';
            }
        } else if (entry.startDate) {
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

    const weeklyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string') return acc;
        try {
             const dateObj = new Date(day.id);
             if (isNaN(dateObj.getTime())) return acc;
             const weekKey = getWeekOfYear(dateObj);
             if (!weekKey) return acc;

            if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                if (entry && entry.type && entry.member) {
                    if (entry.startDate) {
                        const currentDate = day.id;
                        const startDate = entry.startDate;
                        const endDate = entry.endDate || entry.startDate;
                        if (currentDate >= startDate && currentDate <= endDate) {
                            acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    } else {
                        acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                }
            });
            acc[weekKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance weekly aggregation:", day.id, e); }
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

            if(entry.startDate) {
                 acc[key].count += 1;
            } else {
                acc[key].count += 1;
            }
            return acc;
        }, {});

        Object.values(summary).forEach(item => {
             if (['연차', '출장', '결근'].includes(item.type)) {
                 item.days = item.count;
             }
        });


        html += `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
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

    const monthlyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 7) return acc;
         try {
            const monthKey = day.id.substring(0, 7);
             if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;

            if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                 if (entry && entry.type && entry.member) {
                    if (entry.startDate) {
                        const currentDate = day.id;
                        const startDate = entry.startDate;
                        const endDate = entry.endDate || entry.startDate;
                        if (currentDate >= startDate && currentDate <= endDate) {
                            acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                        }
                    } else {
                        acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                }
            });
            acc[monthKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance monthly aggregation:", day.id, e); }
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
            } else {
                acc[key].count += 1;
            }
            return acc;
        }, {});

        Object.values(summary).forEach(item => {
             if (['연차', '출장', '결근'].includes(item.type)) {
                 item.days = item.count;
             }
        });

        html += `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
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