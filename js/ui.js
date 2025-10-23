// === ui.js (이력: 일별 상세 멤버 목록 토글 기능 추가, 외출 복귀 상태 반영 수정) ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, isWeekday } from './utils.js'; // isWeekday import 추가

// Task Card Styling Configuration
const taskCardStyles = {
    'default': {
        card: ['bg-blue-50', 'border-gray-300', 'text-gray-700', 'shadow-sm'],
        hover: 'hover:border-blue-500 hover:shadow-md',
        subtitle: 'text-gray-500',
        buttonBgOff: 'bg-gray-200',
        buttonTextOff: 'text-gray-500'
    },
    'ongoing': {
        card: ['bg-blue-100', 'border-blue-500', 'text-gray-900', 'shadow-xl', 'shadow-blue-200/50'], // Highlight ongoing tasks
        hover: 'hover:border-blue-600',
        subtitle: 'text-gray-600',
        buttonBgOn: 'bg-blue-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-blue-700'
    },
    'paused': {
        card: ['bg-yellow-50', 'border-yellow-300', 'text-yellow-800', 'shadow-md', 'shadow-yellow-100/50'], // Highlight paused tasks
        hover: 'hover:border-yellow-400 hover:shadow-lg',
        title: 'text-yellow-800',
        subtitle: 'text-yellow-700',
        buttonBgOn: 'bg-yellow-600',
        buttonTextOn: 'text-white',
        buttonHoverOn: 'hover:bg-yellow-700'
    }
};

// Task Title Colors (Map task names to Tailwind text color classes)
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
    'default': 'text-blue-700' // Fallback color
};

/**
 * Renders input fields for task quantities in a modal.
 * @param {Object} sourceQuantities - An object mapping task names to their current quantities.
 * @param {string[]} quantityTaskTypes - An array of task names for which quantities should be tracked.
 */
export const renderQuantityModalInputs = (sourceQuantities = {}, quantityTaskTypes = []) => {
    const container = document.getElementById('modal-task-quantity-inputs');
    if (!container) return;
    container.innerHTML = ''; // Clear previous inputs
    // Create an input for each quantity task type
    quantityTaskTypes.forEach(task => {
        const div = document.createElement('div');
        div.innerHTML = `
            <label for="modal-quantity-${task}" class="block text-sm font-medium text-gray-700">${task}</label>
            <input type="number" id="modal-quantity-${task}" data-task="${task}" value="${sourceQuantities[task] || 0}" min="0" class="mt-1 w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg p-2 focus:ring-blue-500 focus:border-blue-500 transition">
        `;
        container.appendChild(div);
    });
};

/**
 * Renders task selection buttons grouped by category in a modal.
 * @param {Object} taskGroups - An object where keys are group names and values are arrays of task names.
 */
export const renderTaskSelectionModal = (taskGroups = {}) => {
    const container = document.getElementById('task-modal-content');
    if (!container) return;
    container.innerHTML = ''; // Clear previous content
    // Create a section for each task group
    Object.entries(taskGroups).forEach(([groupName, tasks]) => {
        const groupDiv = document.createElement('div');
        groupDiv.className = 'flex-1'; // Allow groups to grow and wrap
        // Create buttons for each task in the group
        let tasksHtml = tasks.map(task => 
            `<button type="button" data-task="${task}" class="task-select-btn w-full text-left p-3 rounded-md hover:bg-blue-100 transition focus:ring-2 focus:ring-blue-300">${task}</button>`
        ).join('');
        // Structure the group display
        groupDiv.innerHTML = `
            <div class="bg-gray-50 rounded-lg border h-full">
                <h3 class="text-lg font-bold text-gray-800 mb-0 p-3 border-b bg-gray-100 rounded-t-lg">${groupName}</h3>
                <div class="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">${tasksHtml}</div>
            </div>
        `;
        container.appendChild(groupDiv);
    });
};

/**
 * Renders a donut chart and legend showing the proportion of time spent on each completed task.
 * @param {Object} appState - The current application state containing workRecords.
 */
export const renderTaskAnalysis = (appState) => {
    const analysisContainer = document.getElementById('analysis-content');
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; // Clear previous analysis

    // Filter for completed records and calculate total duration
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalLoggedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0);

    // Display message if no completed tasks
    if (totalLoggedMinutes === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">완료된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        return;
    }

    // Colors for the chart segments (add more if needed)
    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280', 'default': '#6b7280'}; // Added default color

    // Aggregate duration per task
    const taskAnalysis = completedRecords.reduce((acc, record) => {
        if (record && record.task) { // Ensure record and task exist
            acc[record.task] = (acc[record.task] || 0) + (record.duration || 0);
        }
        return acc;
    }, {});

    // Sort tasks by duration (descending)
    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = []; // For conic-gradient background
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow">'; // For the legend items

    // Generate gradient parts and legend items
    sortedTasks.forEach(([task, minutes]) => {
        const percentage = totalLoggedMinutes > 0 ? (minutes / totalLoggedMinutes) * 100 : 0;
        const color = taskColorsHex[task] || taskColorsHex['default']; // Use specific color or default
        // Add segment to gradient if percentage > 0
        if (percentage > 0) {
            gradientParts.push(`${color} ${cumulativePercentage}% ${cumulativePercentage + percentage}%`);
            cumulativePercentage += percentage;
        }
        // Add item to legend HTML
        legendHTML += `
            <div class="flex items-center justify-between mb-2">
                <div class="flex items-center">
                    <span class="w-3 h-3 rounded-full mr-2" style="background-color: ${color};"></span>
                    <span class="font-semibold text-gray-700">${task}</span>
                </div>
                <div class="text-right">
                    <div class="text-sm font-semibold text-gray-800">${formatDuration(minutes)}</div>
                    <div class="text-xs text-gray-500">${percentage.toFixed(1)}%</div>
                </div>
            </div>`;
    });
    legendHTML += '</div>';

    // Construct the final conic gradient string
    const finalGradient = `conic-gradient(${gradientParts.join(', ')})`;
    // Render the chart and legend
    analysisContainer.innerHTML = `
        <div class="flex flex-col md:flex-row items-center gap-6 md:gap-8">
            <div class="flex-shrink-0">
                <div class="chart" style="background: ${finalGradient};">
                    <div class="chart-center">
                        <span class="text-sm text-gray-500">총 업무</span>
                        <span class="text-xl font-bold text-blue-600 mt-1">${formatDuration(totalLoggedMinutes)}</span>
                    </div>
                </div>
            </div>
            ${legendHTML}
        </div>`;
};

/**
 * Renders the main real-time status board, including task cards and team member status.
 * @param {Object} appState - The current application state.
 * @param {Array} teamGroups - Array of team group objects from config.
 * @param {Array} keyTasks - Array of key task names from config.
 */
export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = []) => {
    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) {
        console.error("Element #team-status-board not found!");
        return;
    }
    teamStatusBoard.innerHTML = ''; // Clear previous board

    // Create a map for quick lookup of member's group
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

    // Use keyTasks from config, with a fallback
    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    
    // Get currently ongoing or paused records and their task names
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));
    
    // Combine base tasks and active tasks, ensuring uniqueness
    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    // Render a card for each task to display
    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task); // Records for this specific task

        // Determine card style based on task status (paused, ongoing, or inactive)
        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');
        let currentStyle = isPaused ? taskCardStyles['paused'] : (isOngoing || groupRecords.length > 0 ? taskCardStyles['ongoing'] : taskCardStyles['default']);

        // Determine title color
        const titleClass = isPaused ? currentStyle.title : (taskTitleColors[task] || taskTitleColors['default']);

        // Set base card classes and styles
        card.className = `p-3 rounded-lg border flex flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')} ${currentStyle.hover}`;

        // --- Render card content based on whether the task is active ---
        if (groupRecords.length > 0) { // Task is active (ongoing or paused)
            const firstRecord = groupRecords[0]; // Use first record for group ID and task name

            // Set data attributes for actions (add member)
            card.dataset.action = 'add-member';
            card.dataset.groupId = firstRecord.groupId;
            card.dataset.task = firstRecord.task;

            // Generate HTML for the list of members participating in this task
            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                const isRecPaused = rec.status === 'paused';
                // Determine styling based on individual pause status
                const memberTextColor = isRecPaused ? 'text-yellow-800' : 'text-gray-800';
                const timeTextColor = isRecPaused ? 'text-yellow-600' : 'text-gray-500';
                const stopButtonBg = isRecPaused ? 'bg-yellow-200 hover:bg-yellow-300' : 'bg-red-100 hover:bg-red-200';
                const stopButtonText = isRecPaused ? 'text-yellow-700' : 'text-red-700';
                const memberRowBg = isRecPaused ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50';

                // Generate Pause/Resume button HTML based on status
                let pauseResumeButtonHtml = '';
                if (rec.status === 'ongoing') {
                    pauseResumeButtonHtml = `<button data-action="pause-individual" data-record-id="${rec.id}" class="inline-block text-xs bg-yellow-100 hover:bg-yellow-200 text-yellow-700 px-2 py-0.5 rounded ml-1 flex-shrink-0">정지</button>`;
                } else if (rec.status === 'paused') {
                    pauseResumeButtonHtml = `<button data-action="resume-individual" data-record-id="${rec.id}" class="inline-block text-xs bg-green-100 hover:bg-green-200 text-green-700 px-2 py-0.5 rounded ml-1 flex-shrink-0">재개</button>`;
                }

                // Add member row HTML
                membersHtml += `
                    <div class="text-sm ${memberRowBg} rounded p-1 group flex justify-between items-center">
                        {/* Name - removed w-12 and truncate */}
                        <span class="font-semibold ${memberTextColor} break-keep mr-1 inline-block text-left" title="${rec.member}">${rec.member}</span>
                        {/* Time and Pause Status */}
                        <span class="text-xs ${timeTextColor} flex-grow text-center">(${formatTimeTo24H(rec.startTime)}) ${isRecPaused ? '(휴식중)' : ''}</span>
                        {/* Action Buttons */}
                        <div class="flex-shrink-0 flex items-center">
                            ${pauseResumeButtonHtml}
                            <button data-action="stop-individual" data-record-id="${rec.id}" class="inline-block text-xs ${stopButtonBg} ${stopButtonText} px-2 py-0.5 rounded ml-1">종료</button>
                        </div>
                    </div>`;
            });
            membersHtml += '</div>';

            // Find the earliest start time for display and duration calculation reference
            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime);
            const recordIdForDuration = representativeRecord ? representativeRecord.id : groupRecords[0].id; // Use ID of earliest record for timer
            const durationStatus = isOngoing ? 'ongoing' : 'paused'; // Status for the duration timer
            const stopBtnClass = `bg-red-600 hover:bg-red-700 text-white`; // Style for the stop button

            // Set the inner HTML for the active task card
            card.innerHTML = `
                <div class="flex flex-col h-full">
                    {/* Task Title and Pause Indicator */}
                    <div class="font-bold text-lg ${titleClass} break-keep">${firstRecord.task} ${isPaused ? ' (일시정지)' : ''}</div>
                    {/* Start Time and Live Duration */}
                    <div class="text-xs ${currentStyle.subtitle} my-2">시작: ${formatTimeTo24H(earliestStartTime)} <span class="ongoing-duration" data-start-time="${earliestStartTime || ''}" data-status="${durationStatus}" data-record-id="${recordIdForDuration || ''}"></span></div>
                    {/* Member Count and List */}
                    <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">${groupRecords.length}명 참여중:</div>
                    <div class="flex-grow">${membersHtml}</div>
                    {/* Group Action Buttons */}
                    <div class="mt-auto space-y-2 pt-2">
                        <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} w-full text-white font-bold py-2 rounded-md transition text-sm">
                            ${isPaused ? '전체 재개' : '전체 정지'}
                        </button>
                        <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn ${stopBtnClass} w-full text-white font-bold py-2 rounded-md transition text-sm">전체 종료</button>
                    </div>
                </div>`;
        } else { // Task is inactive
            // Set data attributes for action (start task)
            card.dataset.action = 'start-task';
            card.dataset.task = task;

            // Set the inner HTML for the inactive task card
            card.innerHTML = `
                <div class="flex-grow">
                    <div class="font-bold text-lg ${titleClass} break-keep">${task}</div>
                    <div class="text-xs ${currentStyle.subtitle} my-2">시작: 시작 전</div>
                    <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">참여 인원 (0명):</div>
                    <div class="text-xs ${currentStyle.subtitle} italic flex-grow flex items-center justify-center text-center">카드를 클릭하여 팀원 선택</div>
                </div>
                {/* Disabled Action Buttons */}
                <div class="mt-auto space-y-2 pt-2">
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} w-full font-bold py-2 rounded-md text-sm opacity-50 cursor-not-allowed">일시정지</button>
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} w-full font-bold py-2 rounded-md text-sm opacity-50 cursor-not-allowed">종료</button>
                </div>
            `;
        }
        presetGrid.appendChild(card); // Add the card to the grid
    });

    // --- Add the 'Other Task' Card ---
    const otherTaskCard = document.createElement('div');
    const otherStyle = taskCardStyles['default'];
    otherTaskCard.className = `p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-all duration-200 cursor-pointer ${otherStyle.card.join(' ')} ${otherStyle.hover}`;
    otherTaskCard.dataset.action = 'other'; // Action to open task selection modal
    otherTaskCard.innerHTML = `
        <div class="font-bold text-lg text-gray-700">기타 업무</div>
        <svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div class="text-xs text-gray-500 mt-3">새로운 업무 시작</div>
    `;
    presetGrid.appendChild(otherTaskCard); // Add to the grid

    presetTaskContainer.appendChild(presetGrid); // Add grid to container
    teamStatusBoard.appendChild(presetTaskContainer); // Add container to board


    // --- Section 2: ALL TEAM MEMBER STATUS ---
    const allMembersContainer = document.createElement('div');
    const allMembersHeader = document.createElement('div');
    allMembersHeader.className = 'flex justify-between items-center border-b pb-2 mb-4 mt-8';
    allMembersHeader.innerHTML = `<h3 class="text-lg font-bold text-gray-700">전체 팀원 현황 (클릭하여 근태 설정/취소)</h3>`;
    allMembersContainer.appendChild(allMembersHeader);

    // Get current working/paused members
    const ongoingRecordsForStatus = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Map(ongoingRecordsForStatus.map(r => [r.member, r.task]));
    const pausedMembers = new Map((appState.workRecords || []).filter(r => r.status === 'paused').map(r => [r.member, r.task]));

    // Combine daily and date-based leave, filtering out returned '외출'
    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    const onLeaveStatusMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime)) // Exclude returned '외출'
            .map(item => [item.member, item])
    );

    // Define the order of team groups for display
    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean); // Filter out any groups not found

    // Render status cards for each member within their group
    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'mb-4';
        const groupHeader = document.createElement('div');
        groupHeader.className = 'flex items-center gap-2 mb-2';
        groupHeader.innerHTML = `<h4 class="text-md font-semibold text-gray-600">${group.name}</h4>`;
        groupContainer.appendChild(groupHeader);

        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2';
        const uniqueMembersInGroup = [...new Set(group.members)]; // Ensure unique members

        uniqueMembersInGroup.forEach(member => {
            const card = document.createElement('button');
            card.type = 'button'; // Make it a button for click interaction
            const leaveInfo = onLeaveStatusMap.get(member); // Check leave status
            const isOnLeave = !!leaveInfo;
            const isWorking = workingMembers.has(member) || pausedMembers.has(member); // Check work status

            // Base styling and interaction state
            card.className = 'p-1 rounded-lg border text-center transition-shadow min-h-[64px] w-24 flex flex-col justify-center';
            card.dataset.memberToggleLeave = member; // Data attribute for click handler
            // Enable click only if not working
            if (!isWorking) {
                card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
            } else {
                card.classList.add('opacity-70', 'cursor-not-allowed'); // Visually disable if working
                card.disabled = true; // Disable interaction if working
            }

            // --- Set card content and style based on status ---
            if (isOnLeave) {
                card.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500');
                // Format leave details (time or date range)
                let detailText = '';
                if (leaveInfo.startTime) { // Time-based leave (외출, 조퇴)
                    detailText = formatTimeTo24H(leaveInfo.startTime);
                    if (leaveInfo.endTime) detailText += ` - ${formatTimeTo24H(leaveInfo.endTime)}`;
                    else if (leaveInfo.type === '외출') detailText += ' ~'; // Indicate ongoing
                } else if (leaveInfo.startDate) { // Date-based leave
                    detailText = leaveInfo.startDate.substring(5); // Show MM-DD
                    if (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate) {
                        detailText += ` ~ ${leaveInfo.endDate.substring(5)}`; // Show range if different
                    }
                }
                card.innerHTML = `
                    <div class="font-semibold text-sm break-keep">${member}</div>
                    <div class="text-xs">${leaveInfo.type}</div>
                    ${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
            } else if (workingMembers.has(member)) { // Working (Ongoing)
                card.classList.add('bg-red-50', 'border-red-200');
                card.innerHTML = `
                    <div class="font-semibold text-sm text-red-800 break-keep">${member}</div>
                    <div class="text-xs text-gray-600 truncate" title="${workingMembers.get(member)}">${workingMembers.get(member)}</div>`;
            } else if (pausedMembers.has(member)) { // Working (Paused)
                card.classList.add('bg-yellow-50', 'border-yellow-200');
                card.innerHTML = `
                    <div class="font-semibold text-sm text-yellow-800 break-keep">${member}</div>
                    <div class="text-xs text-yellow-600">휴식 중</div>`;
            } else { // Idle (Available)
                card.classList.add('bg-green-50', 'border-green-200');
                card.innerHTML = `
                    <div class="font-semibold text-sm text-green-800 break-keep">${member}</div>
                    <div class="text-xs text-green-600">대기 중</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    // --- Render Part-timer Section (only if there are active part-timers) ---
    const workingAlbaMembers = new Set((appState.workRecords || []).filter(r => (r.status === 'ongoing' || r.status === 'paused')).map(r => r.member));
    // Include part-timers who are working OR on leave
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

             // Determine status
             const currentlyWorkingTask = workingMembers.get(pt.name);
             const isPaused = pausedMembers.has(pt.name);
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = currentlyWorkingTask || isPaused;

             // Enable click only if not working
             if (!isAlbaWorking) {
                 card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
             } else {
                 card.classList.add('opacity-70', 'cursor-not-allowed');
                 card.disabled = true;
             }

             // Set card content and style based on status
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
                 card.innerHTML = `
                    <div class="font-semibold text-sm break-keep">${pt.name}</div>
                    <div class="text-xs">${albaLeaveInfo.type}</div>
                    ${detailText ? `<div class="text-[10px] leading-tight mt-0.5">${detailText}</div>` : ''}`;
             } else if (currentlyWorkingTask) { // Working (Ongoing)
                 card.classList.add('bg-red-50', 'border-red-200');
                 card.innerHTML = `
                    <div class="font-semibold text-sm text-red-800">${pt.name}</div>
                    <div class="text-xs text-gray-600 truncate" title="${currentlyWorkingTask}">${currentlyWorkingTask}</div>`;
             } else if (isPaused) { // Working (Paused)
                 card.classList.add('bg-yellow-50', 'border-yellow-200');
                 card.innerHTML = `
                    <div class="font-semibold text-sm text-yellow-800">${pt.name}</div>
                    <div class="text-xs text-yellow-600">휴식 중</div>`;
             }
             // No 'Idle' state explicitly shown for part-timers unless they exist in appState.partTimers but are not active/on leave

             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid);
        allMembersContainer.appendChild(albaContainer); // Add alba section to the main container
    }
    // Append the main member status container to the board
    teamStatusBoard.appendChild(allMembersContainer);
};

/**
 * Renders the table body for completed work logs.
 * @param {Object} appState - The current application state.
 */
export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = ''; // Clear previous log

    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');

    // Display message if no completed records
    if (!completedRecords || completedRecords.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">완료된 업무가 없습니다.</td></tr>`;
        return;
    }

    // Group records by task name
    const groupedRecords = completedRecords.reduce((acc, record) => {
        if (!acc[record.task]) acc[record.task] = [];
        acc[record.task].push(record);
        return acc;
    }, {});
    const sortedTasks = Object.keys(groupedRecords).sort(); // Sort tasks alphabetically

    // Render rows for each task group
    if (sortedTasks.length === 0) { // Should not happen if completedRecords > 0
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">완료된 업무가 없습니다.</td></tr>`;
    } else {
        sortedTasks.forEach(task => {
            // Add a header row for the task group
            const groupHeaderRow = document.createElement('tr');
            groupHeaderRow.className = 'bg-gray-100';
            groupHeaderRow.innerHTML = `<th colspan="6" class="px-6 py-3 text-left text-base text-blue-700 font-bold">${task}</th>`;
            workLogBody.appendChild(groupHeaderRow);
            // Add rows for each record within the group, sorted by start time
            groupedRecords[task].sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(record => {
                const row = document.createElement('tr');
                row.className = 'bg-white border-b border-gray-200 hover:bg-gray-50';
                row.innerHTML = `
                    <td class="px-6 py-4 font-medium text-gray-900">${record.member || 'N/A'}</td>
                    <td class="px-6 py-4">${record.task || 'N/A'}</td>
                    <td class="px-6 py-4">${formatTimeTo24H(record.startTime)}</td>
                    <td class="px-6 py-4">${formatTimeTo24H(record.endTime)}</td>
                    <td class="px-6 py-4">${formatDuration(record.duration)}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit" data-record-id="${record.id}" class="font-medium text-blue-500 hover:underline">수정</button>
                        <button data-action="delete" data-record-id="${record.id}" class="font-medium text-red-500 hover:underline">삭제</button>
                    </td>`;
                workLogBody.appendChild(row);
            });
        });
    }
};

/**
 * Updates the summary dashboard numbers (total staff, on leave, working, etc.).
 * @param {Object} appState - The current application state.
 * @param {Array} teamGroups - Array of team group objects from config.
 */
export const updateSummary = (appState, teamGroups = []) => {
    // Get DOM elements for summary numbers
    const summaryTotalStaffEl = document.getElementById('summary-total-staff');
    const summaryLeaveStaffEl = document.getElementById('summary-leave-staff');
    const summaryActiveStaffEl = document.getElementById('summary-active-staff');
    const summaryWorkingStaffEl = document.getElementById('summary-working-staff');
    const summaryIdleStaffEl = document.getElementById('summary-idle-staff');
    const summaryOngoingTasksEl = document.getElementById('summary-ongoing-tasks');

    // Get all unique staff and part-timer names
    const allStaffMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    // Combine daily and date-based leave, filtering out returned '외출'
    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
    // ✅ [수정] Filter out returned '외출' members
    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime)) 
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;

    // Get currently working (ongoing or paused) members
    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const workingMembers = new Set(ongoingOrPausedRecords.map(r => r.member));
    const workingStaffCount = [...workingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...workingMembers].filter(member => allPartTimers.has(member)).length;
    const totalWorkingCount = workingMembers.size;

    // Calculate available staff/part-timers (Total - On Leave)
    const availableStaffCount = totalStaffCount - [...onLeaveMemberNames].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = totalPartTimerCount - [...onLeaveMemberNames].filter(member => allPartTimers.has(member)).length;

    // Calculate idle staff (Available Staff - Working Staff)
    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount);
    // Note: Idle part-timers are not currently calculated precisely
    const totalIdleCount = idleStaffCount; // For now, only show idle staff

    // Count unique ongoing/paused tasks
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    // Update the DOM elements with calculated values
    if (summaryTotalStaffEl) summaryTotalStaffEl.textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (summaryLeaveStaffEl) summaryLeaveStaffEl.textContent = `${onLeaveTotalCount}`;
    if (summaryActiveStaffEl) summaryActiveStaffEl.textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (summaryWorkingStaffEl) summaryWorkingStaffEl.textContent = `${totalWorkingCount}`;
    if (summaryIdleStaffEl) summaryIdleStaffEl.textContent = `${totalIdleCount}`;
    if (summaryOngoingTasksEl) summaryOngoingTasksEl.textContent = `${ongoingTaskCount}`;
};

/**
 * Renders the content of the team selection modal.
 * @param {string} task - The task for which members are being selected.
 * @param {Object} appState - The current application state.
 * @param {Array} teamGroups - Array of team group objects from config.
 */
export const renderTeamSelectionModalContent = (task, appState, teamGroups = []) => {
    // Get modal title and content container
    const titleEl = document.getElementById('team-select-modal-title');
    const container = document.getElementById('team-select-modal-content');
    if (!titleEl || !container) return;

    // Set modal title
    titleEl.textContent = `'${task || '기타 업무'}' 팀원 선택`; // Use task name or fallback
    container.innerHTML = ''; // Clear previous content

    // Get sets of working and on-leave members for quick lookup
    const allWorkingMembers = new Set(
        (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused').map(r => r.member)
    );
    const combinedOnLeaveMembers = [
        ...(appState.dailyOnLeaveMembers || []),
        ...(appState.dateBasedOnLeaveMembers || [])
    ];
     // ✅ [수정] Filter out returned '외출' members
    const onLeaveMemberMap = new Map(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime)) 
            .map(item => [item.member, item])
    );

    // Define the order of team groups
    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트'),
    ].filter(Boolean); // Filter out non-existent groups

    // Render each team group section
    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col'; // Fixed width column
        // Group header with 'Select All' button
        groupContainer.innerHTML = `
            <div class="flex justify-between items-center p-2 border-b border-gray-200">
                <h4 class="text-md font-bold text-gray-800">${group.name}</h4>
                <button type="button" class="group-select-all-btn text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded" data-group-name="${group.name}">전체</button>
            </div>`;

        // Container for member cards
        const memberList = document.createElement('div');
        memberList.className = 'space-y-2 flex-grow overflow-y-auto p-2'; // Scrollable list
        memberList.dataset.groupName = group.name; // For 'Select All' functionality

        const uniqueMembersInGroup = [...new Set(group.members)]; // Ensure uniqueness
        // Render card for each member
        uniqueMembersInGroup.forEach(member => {
            const isWorking = allWorkingMembers.has(member);
            const leaveEntry = onLeaveMemberMap.get(member); // Use updated map
            const isOnLeave = !!leaveEntry;

            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member; // Store member name
            // Base styling, disable if working or on leave
            card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;
            if (isWorking || isOnLeave) card.disabled = true;

            // Add status label if working or on leave
            let statusLabel = '';
            if (isWorking) { statusLabel = '<div class="text-xs text-red-500">업무 중</div>'; }
            else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500">${leaveEntry.type} 중</div>`; }
            card.innerHTML = `<div class="font-semibold">${member}</div>${statusLabel}`;

            memberList.appendChild(card);
        });
        groupContainer.appendChild(memberList);
        container.appendChild(groupContainer); // Add group section to modal content
    });

    // --- Render Part-timer Section ---
    const albaGroupContainer = document.createElement('div');
    albaGroupContainer.className = 'flex-shrink-0 w-48 bg-gray-100 rounded-lg flex flex-col';
    // Header with 'Select All' and 'Add Part-timer' buttons
    albaGroupContainer.innerHTML = `
        <div class="flex justify-between items-center p-2 border-b border-gray-200">
            <h4 class="text-md font-bold text-gray-800">알바</h4>
            <div>
                <button type="button" class="group-select-all-btn text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 px-2 py-0.5 rounded" data-group-name="알바">전체</button>
                <button id="add-part-timer-modal-btn" class="text-xs bg-blue-200 hover:bg-blue-300 text-blue-800 px-2 py-0.5 rounded ml-1">+ 추가</button>
            </div>
        </div>`;
    const albaMemberList = document.createElement('div');
    albaMemberList.className = 'space-y-2 flex-grow overflow-y-auto p-2';
    albaMemberList.dataset.groupName = '알바';

    // Render card for each part-timer
    (appState.partTimers || []).forEach(pt => {
        const isWorking = allWorkingMembers.has(pt.name);
        const leaveEntry = onLeaveMemberMap.get(pt.name); // Use updated map
        const isOnLeave = !!leaveEntry;

        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative'; // Wrapper for positioning edit/delete buttons

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        // Styling and disable logic same as regular members
        card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isWorking || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;
        if (isWorking || isOnLeave) card.disabled = true;

        // Status label
        let statusLabel = '';
        if (isWorking) { statusLabel = '<div class="text-xs text-red-500">업무 중</div>'; }
        else if (isOnLeave) { statusLabel = `<div class="text-xs text-gray-500">${leaveEntry.type} 중</div>`; }
        card.innerHTML = `<div class="font-semibold">${pt.name}</div>${statusLabel}`;

        cardWrapper.appendChild(card);

        // Edit Button (positioned top-right)
        const editBtn = document.createElement('button');
        editBtn.dataset.partTimerId = pt.id; // Store ID for action
        editBtn.className = 'edit-part-timer-btn absolute top-1 right-5 p-1 text-gray-400 hover:text-blue-600'; // Adjust position if needed
        editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L13.196 5.2z" /></svg>`;
        cardWrapper.appendChild(editBtn);

        // Delete Button (positioned next to edit)
        const deleteBtn = document.createElement('button');
        deleteBtn.dataset.partTimerId = pt.id; // Store ID for action
        deleteBtn.className = 'delete-part-timer-btn absolute top-1 right-1 p-1 text-gray-400 hover:text-red-600';
        deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" /></svg>`;
        cardWrapper.appendChild(deleteBtn);

        albaMemberList.appendChild(cardWrapper);
    });

    albaGroupContainer.appendChild(albaMemberList);
    container.appendChild(albaGroupContainer); // Add alba section to modal content
};

/**
 * Renders radio button options for leave types in the leave modal.
 * @param {string[]} leaveTypes - Array of leave type names.
 */
export const renderLeaveTypeModalOptions = (leaveTypes = []) => {
    const container = document.getElementById('leave-type-options');
    const dateInputsDiv = document.getElementById('leave-date-inputs'); // Date input section
    if (!container || !dateInputsDiv) return;

    container.innerHTML = ''; // Clear previous options
    // Create radio button for each leave type
    leaveTypes.forEach((type, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center';
        div.innerHTML = `
            <input id="leave-type-${index}" name="leave-type" type="radio" value="${type}" class="h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500 leave-type-radio">
            <label for="leave-type-${index}" class="ml-2 block text-sm font-medium text-gray-700">${type}</label>
        `;
        container.appendChild(div);
    });

    // Add event listener to show/hide date inputs based on selection
    container.addEventListener('change', (e) => {
        if (e.target.classList.contains('leave-type-radio')) {
            const selectedType = e.target.value;
            // Show date inputs only for specific types
            dateInputsDiv.classList.toggle('hidden', !(selectedType === '연차' || selectedType === '출장' || selectedType === '결근'));
        }
    });

    // Set initial state based on the first radio button
    const firstRadio = container.querySelector('input[type="radio"]');
    if (firstRadio) {
        firstRadio.checked = true; // Check the first option by default
        const initialType = firstRadio.value;
        dateInputsDiv.classList.toggle('hidden', !(initialType === '연차' || initialType === '출장' || initialType === '결근'));
    }
};

/**
 * Renders a summary block for weekly or monthly history data.
 * @param {string} mode - 'weekly' or 'monthly'.
 * @param {Object} dataset - The aggregated data for the period (workRecords, taskQuantities).
 * @param {string} periodKey - The identifier for the period (e.g., '2023-W42' or '2023-10').
 * @param {Object} wageMap - Map of member names to their hourly wages.
 * @returns {string} HTML string for the summary block.
 */
const renderSummaryView = (mode, dataset, periodKey, wageMap = {}) => {
    const records = dataset.workRecords || [];
    const quantities = dataset.taskQuantities || {};

    // Calculate overall totals
    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities || {}).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0; // Use wageMap or default to 0
        return s + ((r.duration || 0) / 60) * wage; // Cost = (duration in hours) * wage
    }, 0);

    // Calculate overall averages
    const overallAvgThroughput = totalDuration > 0 ? (totalQuantity / totalDuration).toFixed(2) : '0.00'; // Items per minute
    const overallAvgCostPerItem = totalQuantity > 0 ? (totalCost / totalQuantity).toFixed(0) : '0'; // Cost per item

    // Aggregate data per task
    const taskSummary = records.reduce((acc, r) => {
        if (!r || !r.task) return acc;
        if (!acc[r.task]) acc[r.task] = { duration: 0, cost: 0 };
        acc[r.task].duration += (r.duration || 0);
        const wage = wageMap[r.member] || 0;
        acc[r.task].cost += ((r.duration || 0) / 60) * wage;
        return acc;
    }, {});

    // Add quantity data and calculate task-specific averages
    Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
        const qty = Number(qtyValue) || 0;
        if (taskSummary[task]) { // If task exists in workRecords
            taskSummary[task].quantity = qty;
            taskSummary[task].avgThroughput = taskSummary[task].duration > 0 ? (qty / taskSummary[task].duration).toFixed(2) : '0.00';
            taskSummary[task].avgCostPerItem = qty > 0 ? (taskSummary[task].cost / qty).toFixed(0) : '0';
        } else if (qty > 0) { // If task only exists in quantities (e.g., manually entered)
            taskSummary[task] = { duration: 0, cost: 0, quantity: qty, avgThroughput: 'N/A', avgCostPerItem: 'N/A' };
        }
    });

    // --- Generate HTML for the summary block ---
    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">`;
    html += `<h3 class="text-xl font-bold mb-4">${periodKey} 요약</h3>`;

    // Overall summary cards
    html += `
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 text-center">
            <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 시간</div><div class="text-lg font-bold">${formatDuration(totalDuration)}</div></div>
            <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 처리량</div><div class="text-lg font-bold">${totalQuantity} 개</div></div>
            <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 인건비</div><div class="text-lg font-bold">${Math.round(totalCost).toLocaleString()} 원</div></div>
            <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리량</div><div class="text-lg font-bold">${overallAvgThroughput} 개/분</div></div>
            <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리비용</div><div class="text-lg font-bold">${overallAvgCostPerItem} 원/개</div></div>
        </div>`;

    // Task-specific averages table
    html += `<h4 class="text-lg font-semibold mb-3 text-gray-700">업무별 평균</h4>`;
    html += `
        <div class="overflow-x-auto max-h-60"> {/* Scrollable table container */}
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0"> {/* Sticky header */}
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
            // Only show tasks with duration or quantity
            if (summary && (summary.duration > 0 || summary.quantity > 0)) {
                hasTaskData = true;
                html += `
                    <tr class="bg-white border-b hover:bg-gray-50">
                        <td class="px-4 py-2 font-medium text-gray-900">${task}</td>
                        <td class="px-4 py-2 text-right">${summary.avgThroughput || '0.00'}</td>
                        <td class="px-4 py-2 text-right">${summary.avgCostPerItem || '0'}</td>
                    </tr>`;
            }
        });
    }

    if (!hasTaskData) { // Message if no relevant task data found
        html += `<tr><td colspan="3" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }

    html += `       </tbody>
                </table>
            </div> {/* End scrollable container */}
        </div>`; // End summary block
    return html;
};

/**
 * Renders the weekly work history summary view.
 * @param {Array} allHistoryData - Array of all daily history objects.
 * @param {Object} appConfig - The application configuration containing memberWages.
 */
export const renderWeeklyHistory = (allHistoryData, appConfig) => {
    const view = document.getElementById('history-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 데이터 집계 중...</div>'; // Loading message

    try {
        // Build a comprehensive wage map including historical part-timer wages
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                 if (pt && pt.name && !historyWageMap[pt.name]) { // Take the first wage found in history
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        // Merge historical wages with current config wages (config takes priority)
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // Aggregate daily data into weekly buckets
        const weeklyData = (allHistoryData || []).reduce((acc, day) => {
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string') return acc; // Basic validation
            try {
                 const dateObj = new Date(day.id);
                 if (isNaN(dateObj.getTime())) return acc; // Invalid date check

                const weekKey = getWeekOfYear(dateObj); // Get 'YYYY-Www' format
                if (!weekKey) return acc;

                // Initialize week bucket if it doesn't exist
                if (!acc[weekKey]) acc[weekKey] = { workRecords: [], taskQuantities: {} };

                // Add work records and aggregate quantities
                acc[weekKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id }))); // Add date info to record
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[weekKey].taskQuantities[task] = (acc[weekKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) {
                console.error("Error processing day in weekly aggregation:", day.id, e);
            }
            return acc;
        }, {});

        // Sort weeks chronologically (descending) and render summary for each
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
        if (sortedWeeks.length === 0) {
            view.innerHTML = '<div class="text-center text-gray-500">주별 데이터가 없습니다.</div>';
            return;
        }
        // Use renderSummaryView for each week
        view.innerHTML = sortedWeeks.map(weekKey => renderSummaryView('weekly', weeklyData[weekKey], weekKey, combinedWageMap)).join('');

    } catch (error) {
        console.error("Error in renderWeeklyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">주별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>'; // Error message
    }
};

/**
 * Renders the monthly work history summary view.
 * @param {Array} allHistoryData - Array of all daily history objects.
 * @param {Object} appConfig - The application configuration containing memberWages.
 */
export const renderMonthlyHistory = (allHistoryData, appConfig) => {
    const view = document.getElementById('history-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 데이터 집계 중...</div>'; // Loading message

    try {
        // Build comprehensive wage map (same logic as weekly)
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                 if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // Aggregate daily data into monthly buckets
        const monthlyData = (allHistoryData || []).reduce((acc, day) => {
            // Basic validation including checking for valid date string format
            if (!day || !day.id || !day.workRecords || typeof day.id !== 'string' || day.id.length < 7) return acc;
             try {
                const monthKey = day.id.substring(0, 7); // Get 'YYYY-MM' format
                 if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc; // Validate format

                // Initialize month bucket if needed
                if (!acc[monthKey]) acc[monthKey] = { workRecords: [], taskQuantities: {} };
                // Add records and aggregate quantities
                acc[monthKey].workRecords.push(...(day.workRecords || []).map(r => ({ ...r, date: day.id })));
                Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
                    acc[monthKey].taskQuantities[task] = (acc[monthKey].taskQuantities[task] || 0) + (Number(qty) || 0);
                });
            } catch (e) {
                 console.error("Error processing day in monthly aggregation:", day.id, e);
            }
            return acc;
        }, {});

        // Sort months chronologically (descending) and render
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));
        if (sortedMonths.length === 0) {
            view.innerHTML = '<div class="text-center text-gray-500">월별 데이터가 없습니다.</div>';
            return;
        }
        // Use renderSummaryView for each month
        view.innerHTML = sortedMonths.map(monthKey => renderSummaryView('monthly', monthlyData[monthKey], monthKey, combinedWageMap)).join('');

    } catch (error) {
        console.error("Error in renderMonthlyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">월별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>'; // Error message
    }
};

/**
 * Renders the daily attendance history view for a specific date.
 * @param {string} dateKey - The date to display (YYYY-MM-DD).
 * @param {Array} allHistoryData - Array of all daily history objects.
 */
export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    // Find the data for the selected date
    const data = allHistoryData.find(d => d.id === dateKey);

    // Header with date and action buttons (Excel Download, Delete)
    let html = `
        <div class="mb-4 pb-2 border-b flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">${dateKey} 근태 현황</h3>
            <div>
                <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm"
                        onclick="downloadAttendanceHistoryAsExcel('${dateKey}')">
                    근태 엑셀
                </button>
                <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                        onclick="requestHistoryDeletion('${dateKey}')"> {/* Uses the same deletion function */}
                    삭제
                </button>
            </div>
        </div>
    `;

    // Display message if no attendance data found for the date
    if (!data || !data.onLeaveMembers || data.onLeaveMembers.length === 0) {
        html += `<div class="bg-white p-4 rounded-lg shadow-sm text-center text-gray-500">해당 날짜의 근태 기록이 없습니다.</div>`;
        view.innerHTML = html;
        return;
    }

    const leaveEntries = data.onLeaveMembers;
    leaveEntries.sort((a, b) => (a.member || '').localeCompare(b.member || '')); // Sort by member name

    // Table structure for attendance records
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

    // Add a row for each leave entry
    leaveEntries.forEach(entry => {
        // Format the time or date range for display
        let detailText = '-';
        if (entry.startTime) {
            detailText = formatTimeTo24H(entry.startTime);
            if (entry.endTime) {
                detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
            } else if (entry.type === '외출') {
                detailText += ' ~'; // Indicate ongoing
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

    view.innerHTML = html; // Update the view content
};

/**
 * Renders the weekly attendance history summary view.
 * @param {Array} allHistoryData - Array of all daily history objects.
 */
export const renderAttendanceWeeklyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    // Aggregate daily attendance data into weekly buckets
    const weeklyData = (allHistoryData || []).reduce((acc, day) => {
        // Basic validation for day data
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string') return acc;
        try {
             const dateObj = new Date(day.id);
             if (isNaN(dateObj.getTime())) return acc; // Invalid date check
             const weekKey = getWeekOfYear(dateObj); // Get 'YYYY-Www'
             if (!weekKey) return acc;

            // Initialize week bucket if needed
            if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };

            // Process each leave entry for the day
            day.onLeaveMembers.forEach(entry => {
                 if (entry && entry.type && entry.member) { // Validate entry
                    // Handle date-range entries: only include if the current day falls within the range
                    if (entry.startDate) {
                        const currentDate = day.id;
                        const startDate = entry.startDate;
                        const endDate = entry.endDate || entry.startDate; // Assume single day if no end date
                        if (currentDate >= startDate && currentDate <= endDate) {
                            acc[weekKey].leaveEntries.push({ ...entry, date: day.id }); // Add date for context
                        }
                    } else { // Handle time-based entries (always relevant to the day)
                        acc[weekKey].leaveEntries.push({ ...entry, date: day.id });
                    }
                }
            });
            acc[weekKey].dateKeys.add(day.id); // Track which days contributed to this week
        } catch (e) { console.error("Error processing day in attendance weekly aggregation:", day.id, e); }
        return acc;
    }, {});

    // Sort weeks chronologically (descending)
    const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
    if (sortedWeeks.length === 0) {
        view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터가 없습니다.</div>';
        return;
    }

    let html = '';
    // Render summary for each week
    sortedWeeks.forEach(weekKey => {
        const data = weeklyData[weekKey];
        // Summarize leave entries by member and type
        const summary = data.leaveEntries.reduce((acc, entry) => {
            const key = `${entry.member}-${entry.type}`; // Unique key per member-type
            if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };

            // Increment count/days based on entry type
            if(entry.startDate) { // Date-based leave (연차, 출장, 결근) - count days
                 acc[key].count += 1; // Each entry represents one day within the range for this aggregation
            } else { // Time-based leave (외출, 조퇴) - count occurrences
                acc[key].count += 1;
            }
            return acc;
        }, {});

        // Convert day counts for specific types
        Object.values(summary).forEach(item => {
             if (['연차', '출장', '결근'].includes(item.type)) {
                 item.days = item.count; // Use 'days' for date-based leave
                 // item.count = 0; // Optionally reset count if only days are needed
             }
        });

        // Generate HTML for the week's summary
        html += `
            <div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                <h3 class="text-xl font-bold mb-3">${weekKey}</h3>
                <div class="space-y-1">`;

        if (Object.keys(summary).length === 0) {
             html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
        } else {
            // Display summary items sorted by member name
            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                 html += `
                    <div class="flex justify-between text-sm">
                        <span class="font-semibold text-gray-700">${item.member}</span>
                        <span>${item.type}</span>
                        {/* Display days for date-based, count for time-based */}
                        <span class="text-right">${item.days > 0 ? `${item.days}일` : `${item.count}회`}</span>
                    </div>`;
            });
        }
        html += `   </div>
            </div>`;
    });

    view.innerHTML = html; // Update view content
};

/**
 * Renders the monthly attendance history summary view.
 * @param {Array} allHistoryData - Array of all daily history objects.
 */
export const renderAttendanceMonthlyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    // Aggregate daily attendance data into monthly buckets
    const monthlyData = (allHistoryData || []).reduce((acc, day) => {
        // Basic validation, including checking for valid date string format
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 7) return acc;
         try {
            const monthKey = day.id.substring(0, 7); // Get 'YYYY-MM' format
             if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc; // Validate format

            // Initialize month bucket if needed
            if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };

            // Process each leave entry (same logic as weekly aggregation)
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
            acc[monthKey].dateKeys.add(day.id); // Track contributing days
        } catch (e) { console.error("Error processing day in attendance monthly aggregation:", day.id, e); }
        return acc;
    }, {});

    // Sort months chronologically (descending)
    const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));
    if (sortedMonths.length === 0) {
        view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터가 없습니다.</div>';
        return;
    }

    let html = '';
    // Render summary for each month
    sortedMonths.forEach(monthKey => {
        const data = monthlyData[monthKey];
        // Summarize leave entries by member and type (same logic as weekly)
        const summary = data.leaveEntries.reduce((acc, entry) => {
            const key = `${entry.member}-${entry.type}`;
            if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0, days: 0 };

            if(entry.startDate) {
                acc[key].count += 1; // Count days
            } else {
                acc[key].count += 1; // Count occurrences
            }
            return acc;
        }, {});

        // Convert day counts for specific types (same logic as weekly)
        Object.values(summary).forEach(item => {
             if (['연차', '출장', '결근'].includes(item.type)) {
                 item.days = item.count;
             }
        });

        // Generate HTML for the month's summary
        html += `
            <div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                <h3 class="text-xl font-bold mb-3">${monthKey}</h3>
                <div class="space-y-1">`;

        if (Object.keys(summary).length === 0) {
             html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
        } else {
            // Display summary items sorted by member name
            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                 html += `
                    <div class="flex justify-between text-sm">
                        <span class="font-semibold text-gray-700">${item.member}</span>
                        <span>${item.type}</span>
                        {/* Display days or count */}
                        <span class="text-right">${item.days > 0 ? `${item.days}일` : `${item.count}회`}</span>
                    </div>`;
            });
        }
        html += `   </div>
            </div>`;
    });

    view.innerHTML = html; // Update view content
};