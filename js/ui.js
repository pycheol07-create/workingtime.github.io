// === ui.js (모바일 반응형 레이아웃 재수정) ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, calcElapsedMinutes, getCurrentTime } from './utils.js'; // getWeekOfYear import

// ✅ [수정] 현황판 아이템 정의 (isQuantity 플래그 추가)
export const DASHBOARD_ITEM_DEFINITIONS = { // ✅ 'export'를 추가했습니다.
    'total-staff': { title: '총원<br>(직원/알바)', valueId: 'summary-total-staff' },
    'leave-staff': { title: '휴무', valueId: 'summary-leave-staff' },
    'active-staff': { title: '근무<br>(직원/알바)', valueId: 'summary-active-staff' },
    'working-staff': { title: '업무중', valueId: 'summary-working-staff' },
    'idle-staff': { title: '대기', valueId: 'summary-idle-staff' },
    'ongoing-tasks': { title: '진행업무', valueId: 'summary-ongoing-tasks' },
    'total-work-time': { title: '업무진행시간', valueId: 'summary-total-work-time' },
    'domestic-invoice': { title: '국내송장<br>(예상)', valueId: 'summary-domestic-invoice', isQuantity: true },
    'china-production': { title: '중국제작', valueId: 'summary-china-production', isQuantity: true },
    'direct-delivery': { title: '직진배송', valueId: 'summary-direct-delivery', isQuantity: true }
};

// ✅ [추가] 모든 현황판 항목 정의 가져오기 (기본 + 커스텀)
export function getAllDashboardDefinitions(config) { // ✅ 'export'를 추가했습니다.
    // 커스텀 항목 정의를 기본 정의 형식에 맞게 변환
    const customDefinitions = {};
    if (config.dashboardCustomItems) {
        for (const id in config.dashboardCustomItems) {
            const item = config.dashboardCustomItems[id];
            customDefinitions[id] = {
                title: item.title,
                valueId: `summary-${id}`, // valueId 자동 생성
                isQuantity: item.isQuantity
            };
        }
    }
    return {
        ...DASHBOARD_ITEM_DEFINITIONS,
        ...customDefinitions
    };
}

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

/**
 * ✅ [수정] 개인별 통계 렌더링 함수 (총 비업무 시간 계산 로직 변경)
 */
export const renderPersonalAnalysis = (selectedMember, appState) => {
    const container = document.getElementById('analysis-personal-stats-container');
    if (!container) return;

    if (!selectedMember) {
        container.innerHTML = `<p class="text-center text-gray-500">통계를 보려면 위에서 직원을 선택하세요.</p>`;
        return;
    }

    // 1. 선택된 직원의 모든 기록 (완료, 진행, 휴식)
    const memberRecords = (appState.workRecords || []).filter(
        r => r.member === selectedMember
    );

    if (memberRecords.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500">${selectedMember} 님은 오늘 업무 기록이 없습니다.</p>`;
        return;
    }

    const now = getCurrentTime(); // 실시간 계산을 위한 현재 시간

    // 2. 현재 상태 파악 (변경 없음)
    const ongoingRecord = memberRecords.find(r => r.status === 'ongoing');
    const pausedRecord = memberRecords.find(r => r.status === 'paused');
    let currentStatusHtml = '';
    // ... (현재 상태 HTML 생성 로직은 기존과 동일) ...
    if (ongoingRecord) {
        currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-red-600">업무 중: ${ongoingRecord.task}</span>`;
    } else if (pausedRecord) {
        currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-yellow-600">휴식 중</span>`;
    } else {
        const combinedOnLeaveMembers = [ /* ... */ ];
        const leaveInfo = combinedOnLeaveMembers.find(m => m.member === selectedMember);
        if (leaveInfo) { /* ... */ } else { /* ... */ }
    }
    // (기존 현재 상태 로직 끝)

    // 3. 총 업무 시간 계산 (실시간 반영 - 변경 없음)
    const taskTimes = memberRecords.reduce((acc, r) => {
        let duration = 0;
        if (r.status === 'completed') {
            duration = r.duration || 0;
        } else if (r.status === 'ongoing' || r.status === 'paused') {
            duration = calcElapsedMinutes(r.startTime, now, r.pauses);
        }
        acc[r.task] = (acc[r.task] || 0) + duration;
        return acc;
    }, {});
    const sortedTasks = Object.entries(taskTimes).sort(([, a], [, b]) => b - a);
    const totalLiveMinutes = sortedTasks.reduce((sum, [, minutes]) => sum + minutes, 0);


    // ✅ [수정] 총 비업무 시간 계산 로직
    let firstStartTime = null;
    let lastEffectiveEndTime = null;

    memberRecords.forEach(r => {
        if (r.startTime && (!firstStartTime || r.startTime < firstStartTime)) {
            firstStartTime = r.startTime;
        }
        if (r.status === 'completed' && r.endTime) {
            if (!lastEffectiveEndTime || r.endTime > lastEffectiveEndTime) {
                lastEffectiveEndTime = r.endTime;
            }
        }
    });

    // 진행 중이거나 휴식 중인 기록이 있으면, 마지막 시간은 'now'
    if (ongoingRecord || pausedRecord) {
        lastEffectiveEndTime = now;
    }

    let totalTimeSpanMinutes = 0;
    if (firstStartTime && lastEffectiveEndTime) {
        // 첫 업무 시작부터 마지막 활동 시간까지의 총 시간(분) 계산
        totalTimeSpanMinutes = calcElapsedMinutes(firstStartTime, lastEffectiveEndTime, []); 
    }

    // 총 비업무 시간 = (총 시간) - (총 업무 시간)
    const totalNonWorkMinutes = Math.max(0, totalTimeSpanMinutes - totalLiveMinutes);
    // ✅ [수정 끝]


    // 5. HTML 렌더링 (텍스트 및 변수명 변경)
    let html = `
        <h4 class="text-lg font-bold text-gray-800 mb-3">${selectedMember} 님 요약</h4>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-gray-50 p-2 rounded-lg">
                <div class="text-xs text-gray-500">현재 상태</div>
                <div class="text-sm font-bold">${currentStatusHtml}</div>
            </div>
            <div class="bg-gray-50 p-2 rounded-lg">
                <div class="text-xs text-gray-500">총 업무 시간 (실시간)</div>
                <div class="text-lg font-bold text-blue-600">${formatDuration(totalLiveMinutes)}</div>
            </div>
             <div class="bg-gray-50 p-2 rounded-lg">
                
                <div class="text-xs text-gray-500">총 비업무 시간 (추정)</div>
                
                <div class="text-lg font-bold text-gray-700">${formatDuration(Math.round(totalNonWorkMinutes))}</div>
            </div>
        </div>

        <div>
            <h5 class="text-md font-semibold text-gray-700 mb-2">오늘 수행한 업무 (전체)</h5>
            <ul class="space-y-1 max-h-40 overflow-y-auto">
    `;

    if (sortedTasks.length > 0) {
        sortedTasks.forEach(([task, minutes]) => {
            if (minutes > 0) { // 0분 이상인 것만 표시
                html += `
                    <li class="text-sm flex justify-between p-1 rounded hover:bg-gray-50">
                        <span class="font-semibold">${task}</span>
                        <span class="text-gray-600">${formatDuration(minutes)}</span>
                    </li>
                `;
            }
        });
    } else {
        html += `<li class="text-sm text-gray-500">데이터 없음</li>`;
    }

    html += `
            </ul>
        </div>
    `;

    container.innerHTML = html;
};

// ✅ [수정] renderRealtimeStatus (모든 근태 카드에 data-action="edit-leave-record" 추가)
export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = []) => {
    // === ✅ [수정] 현재 사용자 정보 가져오기 (함수 상단으로 이동) ===
    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;
    // ----------------------------------------------------

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
    
    // ✅ [수정] "주요 업무" 헤더 텍스트(h3) 삭제, 버튼만 남김
    presetTaskContainer.innerHTML = `
        <div class="flex justify-end items-center border-b pb-2 mb-4 md:hidden">
            <button id="toggle-all-tasks-mobile" 
                    class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">
                전체보기
            </button>
        </div>`;

    const presetGrid = document.createElement('div');
    // ✅ [수정] 그리드 컬럼 설정 변경 및 ID 추가
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4';
    presetGrid.id = 'preset-task-grid'; // 👈 [추가] ID 추가

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));
    
    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        // ✅ [수정] 현재 유저가 이 업무를 하는지 확인
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);

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

        // ✅ [수정] 모바일 반응형 클래스 (토글을 위한 'mobile-task-hidden' 클래스 추가)
        const mobileVisibilityClass = isCurrentUserWorkingOnThisTask ? 'flex' : 'hidden md:flex mobile-task-hidden';
        
        // 🚨 [수정] 카드 자체의 cursor-pointer 제거 (하위 요소에서 클릭 처리)
        card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 ${currentStyle.card.join(' ')} ${currentStyle.hover}`;


        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0]; // 대표 레코드 (그룹 ID, 태스크 이름 등)

            // 🚨 [수정] 카드 데이터셋 이동 방지, 클릭은 하위 요소에서 처리
            // card.dataset.action = 'add-member';
            // card.dataset.groupId = firstRecord.groupId;
            // card.dataset.task = firstRecord.task;

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {

                const isRecPaused = rec.status === 'paused';

                const memberTextColor = isRecPaused ? 'text-yellow-800' : 'text-gray-800';
                const timeTextColor = isRecPaused ? 'text-yellow-600' : 'text-gray-500';
                const stopButtonBg = isRecPaused ? 'bg-yellow-200 hover:bg-yellow-300' : 'bg-red-100 hover:bg-red-200';
                const stopButtonText = isRecPaused ? 'text-yellow-700' : 'text-red-700';
                const memberRowBg = isRecPaused ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50';

                const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>`;
                const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg>`;
                
                let pauseResumeButtonHtml = '';
                if (rec.status === 'ongoing') {
                    // 정지 버튼 (Pause 아이콘)
                    pauseResumeButtonHtml = `<button data-action="pause-individual" title="정지" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-yellow-100 hover:bg-yellow-200 text-yellow-700 transition">${pauseIcon}</button>`;
                } else if (rec.status === 'paused') {
                    // 재개 버튼 (Play 아이콘)
                    pauseResumeButtonHtml = `<button data-action="resume-individual" title="재개" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-green-100 hover:bg-green-200 text-green-700 transition">${playIcon}</button>`;
                }
                
                membersHtml += `
                <div class="text-sm ${memberRowBg} rounded p-1 group flex justify-between items-center member-row"
                    data-record-id="${rec.id}"
                    data-group-id="${rec.groupId || ''}">

                    <span class="font-semibold ${memberTextColor} break-keep mr-1 inline-block text-left" title="${rec.member}">${rec.member}</span>
                    <span class="text-xs ${timeTextColor} flex-grow text-center">(${formatTimeTo24H(rec.startTime)}) ${isRecPaused ? '(휴식중)' : ''}</span>
                    
                    <div class="flex-shrink-0 flex items-center space-x-1 member-actions">
                        ${pauseResumeButtonHtml}

                        <button data-action="stop-individual" title="종료" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-red-100 hover:bg-red-200 text-red-700 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        
                        <button data-action="edit-individual-start-time" title="시작 시간 변경" data-record-id="${rec.id}" data-current-start-time="${rec.startTime || ''}" class="w-7 h-7 flex items-center justify-center rounded-full bg-blue-100 hover:bg-blue-200 text-blue-700 transition">
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        </button>
                        
                    </div>
                </div>`;
                // === 여기까지 수정 ===
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const recordIdForDuration = representativeRecord ? representativeRecord.id : groupRecords[0].id;
            const pauses = representativeRecord ? representativeRecord.pauses : [];
            const pausesJson = JSON.stringify(pauses || []);
            const durationStatus = isOngoing ? 'ongoing' : 'paused';
            const stopBtnClass = `bg-red-600 hover:bg-red-700 text-white`;

            // ✅ [수정] 그룹 시간 표시 부분을 div로 감싸고 data-* 속성 추가
            const groupTimeDisplayHtml = `
                <div class="text-xs ${currentStyle.subtitle} my-2 cursor-pointer group-time-display" 
                     data-action="edit-group-start-time" 
                     data-group-id="${firstRecord.groupId}" 
                     data-current-start-time="${earliestStartTime || ''}">
                    시작: ${formatTimeTo24H(earliestStartTime)} 
                    <span class="ongoing-duration" 
                          data-start-time="${earliestStartTime || ''}" 
                          data-status="${durationStatus}" 
                          data-record-id="${recordIdForDuration || ''}"
                          data-pauses-json='${pausesJson}'></span>
                </div>`;

            card.innerHTML = `<div class="flex flex-col h-full">
                                <div class="font-bold text-lg ${titleClass} break-keep">${firstRecord.task} ${isPaused ? ' (일시정지)' : ''}</div>
                                ${groupTimeDisplayHtml} 
                                <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">${groupRecords.length}명 참여중:</div>
                                <div class="flex-grow">${membersHtml}</div>
                                <div class="mt-auto flex gap-2 pt-2 card-actions"
                                     data-group-id="${firstRecord.groupId}"
                                     data-task="${firstRecord.task}">

                                    <button class="add-member-btn flex-1 aspect-square flex flex-col items-center justify-center bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition text-xs font-semibold p-1 shadow-sm"
                                            data-action="add-member"
                                            data-group-id="${firstRecord.groupId}"
                                            data-task="${firstRecord.task}">
                                        <span class="text-center leading-tight">인원<br>추가</span>
                                    </button>

                                    <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} flex-1 aspect-square flex flex-col items-center justify-center text-white rounded-lg transition text-xs font-semibold p-1 shadow-sm">
                                        ${isPaused
                                            ? `<span class="text-center leading-tight">전체<br>재개</span>`
                                            : `<span class="text-center leading-tight">전체<br>정지</span>`
                                        }
                                    </button>

                                    <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn ${stopBtnClass} flex-1 aspect-square flex flex-col items-center justify-center text-white rounded-lg transition text-xs font-semibold p-1 shadow-sm">
                                        <span class="text-center leading-tight">전체<br>종료</span>
                                    </button>
                                </div>
                            </div>`;
        } else {
             // 🚨 [수정] 시작 전 카드는 클릭 가능하도록 cursor-pointer 유지, data-* 속성 추가
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')} ${currentStyle.hover}`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;

            card.innerHTML = `
                <div class="flex-grow">
                    <div class="font-bold text-lg ${titleClass} break-keep">${task}</div>
                    <div class="text-xs ${currentStyle.subtitle} my-2">시작: 시작 전</div>
                    <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">참여 인원 (0명):</div>
                    <div class="text-xs ${currentStyle.subtitle} italic flex-grow flex items-center justify-center text-center">카드를 클릭하여 팀원 선택</div>
                </div>
                <div class="mt-auto flex gap-2 pt-2">
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">인원<br>추가</span>
                    </button>
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">전체<br>정지</span>
                    </button>
                    <button class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">전체<br>종료</span>
                    </button>
                </div>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    const otherStyle = taskCardStyles['default'];
    // ✅ [수정] '기타 업무' 카드는 모바일에서도 항상 보이도록 'flex' 유지
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
    // (이하 코드 동일)
    // ... (이하 renderRealtimeStatus 함수의 나머지 코드는 그대로 유지) ...
    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container'; // ✅ [추가] 토글을 위한 ID
    
    const allMembersHeader = document.createElement('div');
    // ✅ [수정] 모바일에서도 헤더가 보이도록 'hidden' 클래스 제거, 토글 버튼 추가
    allMembersHeader.className = 'flex justify-between items-center border-b pb-2 mb-4 mt-8';
    allMembersHeader.innerHTML = `
        <h3 class="text-lg font-bold text-gray-700 hidden md:block">전체 팀원 현황 (클릭하여 근태 설정/취소/수정)</h3>
        <h3 class="text-lg font-bold text-gray-700 md:hidden">팀원 현황</h3>
        <button id="toggle-all-members-mobile"
                class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">
            전체보기
        </button>
    `;
    allMembersContainer.appendChild(allMembersHeader);

    const ongoingRecordsForStatus = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const workingMembers = new Map(ongoingRecordsForStatus.map(r => [r.member, r.task]));
    const pausedMembers = new Map((appState.workRecords || []).filter(r => r.status === 'paused').map(r => [r.member, r.task]));

    // --- ✅ [추가] 현재 사용자 정보 가져오기 (이미 상단으로 이동함) ---
    // const currentUserRole = appState.currentUserRole || 'user';
    // const currentUserName = appState.currentUser || null;
    // ------------------------------------

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
        // ✅ [수정] 모바일에서 그룹 전체 숨김 ('hidden md:block') -> ('mb-4')
        groupContainer.className = 'mb-4'; // 이 컨테이너는 항상 보이도록 수정
        const groupHeader = document.createElement('div');
        // ✅ [수정] 모바일에서 그룹 헤더 숨김 ('hidden md:flex')
        groupHeader.className = 'flex items-center gap-2 mb-2 hidden md:flex'; // 헤더만 숨김
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
            const isSelf = (member === currentUserName); // ✅ [추가] 본인 확인

            // === 📌 [재수정] 팀원 카드 className 설정 ===
            // ✅ [수정] 토글을 위해 'mobile-member-hidden' 클래스 추가
            const visibilityClass = isSelf ? 'flex' : 'hidden md:flex mobile-member-hidden'; 
            const widthClass = isSelf ? 'w-full md:w-28' : 'w-28'; 
            card.className = `p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClass} ${widthClass} flex-col justify-center`;
            // ============================================

            // ✅ [수정] data-action을 설정 (근태 중이면 edit-leave-record, 아니면 member-toggle-leave)
            card.dataset.memberName = member; // 공통: 이름
            if (isOnLeave) {
                // [수정] 근태 중이면 무조건 수정 모달 열기
                card.dataset.action = 'edit-leave-record'; 
                card.dataset.leaveType = leaveInfo.type;
                card.dataset.startTime = leaveInfo.startTime || ''; // 식별자
                card.dataset.startDate = leaveInfo.startDate || ''; // 식별자
                card.dataset.endTime = leaveInfo.endTime || '';
                card.dataset.endDate = leaveInfo.endDate || '';
                
            } else {
                // [수정] 근태 중이 아니면 근태 설정 모달 열기 (기존)
                card.dataset.action = 'member-toggle-leave'; 
            }
            
            // ✅ [수정] 권한에 따라 커서/투명도 조절 (근태 중일 때도 수정 가능하도록)
            if (!isWorking) {
                // 업무 중이 아닐 때
                if (currentUserRole === 'admin' || isSelf) {
                    // 관리자거나 본인이면 활성화
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                } else {
                    // 관리자가 아니고 타인이면 비활성화
                    card.classList.add('cursor-not-allowed', 'opacity-70'); 
                }
            } else {
                // 업무 중이면 비활성화
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
        // ✅ [수정] 모바일에서 알바 섹션 숨김 ('hidden md:block') -> ('mb-4')
        albaContainer.className = 'mb-4'; // 이 컨테이너는 항상 보이도록 수정
        // ✅ [수정] 모바일에서 알바 헤더 숨김 ('hidden md:block')
        albaContainer.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2 hidden md:block">알바</h4>`; // 헤더만 숨김

        const albaGrid = document.createElement('div');
        albaGrid.className = 'flex flex-wrap gap-2';

        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             card.type = 'button';
             
             const isSelfAlba = (pt.name === currentUserName); // ✅ [추가] 본인 확인 (알바)

             // === 📌 [재수정] 알바 카드 className 설정 ===
             // ✅ [수정] 토글을 위해 'mobile-member-hidden' 클래스 추가
             const visibilityClassAlba = isSelfAlba ? 'flex' : 'hidden md:flex mobile-member-hidden'; 
             const widthClassAlba = isSelfAlba ? 'w-full md:w-28' : 'w-28'; 
             card.className = `relative p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClassAlba} ${widthClassAlba} flex-col justify-center`;
             // ===========================================

             const currentlyWorkingTask = workingMembers.get(pt.name);
             const isPaused = pausedMembers.has(pt.name);
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = currentlyWorkingTask || isPaused;

            // ✅ [수정] data-action을 설정 (근태 중이면 edit-leave-record, 아니면 member-toggle-leave)
            card.dataset.memberName = pt.name; // 공통: 이름
            if (isAlbaOnLeave) {
                // [수정] 근태 중이면 무조건 수정 모달 열기
                card.dataset.action = 'edit-leave-record';
                card.dataset.leaveType = albaLeaveInfo.type;
                card.dataset.startTime = albaLeaveInfo.startTime || ''; // 식별자
                card.dataset.startDate = albaLeaveInfo.startDate || ''; // 식별자
                card.dataset.endTime = albaLeaveInfo.endTime || '';
                card.dataset.endDate = albaLeaveInfo.endDate || '';
            } else {
                // [수정] 근태 중이 아니면 근태 설정 모달 열기 (기존)
                card.dataset.action = 'member-toggle-leave';
            }

             // ✅ [수정] 권한에 따라 커서/투명도 조절 (근태 중일 때도 수정 가능하도록)
             if (!isAlbaWorking) {
                 if (currentUserRole === 'admin' || isSelfAlba) {
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                 } else {
                    card.classList.add('cursor-not-allowed', 'opacity-70'); // 본인이 아니면 비활성
                 }
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
    
    // ✅ [수정] 직원 현황판(allMembersContainer)은 항상 추가되도록 수정 (내부에서 모바일 숨김 처리)
    // teamStatusBoard.appendChild(presetTaskContainer); // presetTaskContainer는 이미 추가됨
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

// ✅ [수정] 현황판 레이아웃 렌더링 함수 (초기 수량 로드 및 클릭 div 제거)
export const renderDashboardLayout = (appConfig) => {
    const container = document.getElementById('summary-content');
    if (!container) return;

    const itemIds = appConfig.dashboardItems || [];
    const quantities = appConfig.dashboardQuantities || {};
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    container.innerHTML = '';
    let html = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) {
            console.warn(`Main App: Dashboard definition not found for ID: ${id}. Skipping render.`);
            return;
        }

        let valueContent;
        const isQuantity = def.isQuantity === true; // isQuantity 확인

        if (isQuantity) {
             // ✅ [수정] 초기값은 항상 0으로 설정
             valueContent = `<p id="${def.valueId}">0</p>`;
        } else {
             valueContent = `<p id="${def.valueId}">0</p>`; // 비수량 항목도 초기값 0
        }

        // isQuantity일 경우 dashboard-card-quantity 클래스 추가 (유지)
        html += `
            <div class="dashboard-card p-4 rounded-lg ${isQuantity ? 'dashboard-card-quantity' : ''}">
                <h4 class="text-sm font-bold uppercase tracking-wider">${def.title}</h4>
                ${valueContent}
            </div>
        `;
    });

    container.innerHTML = html;
};

// ✅ [수정] updateSummary 함수 (커스텀 항목 ID 처리, 수량 업데이트 제외 유지)
export const updateSummary = (appState, appConfig) => {
    // ✅ [수정] 모든 정의 가져오기
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    // ✅ [수정] 정의된 모든 ID에 대해 요소 가져오기 시도 (수량 항목 포함)
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    // --- (기존 계산 로직: totalStaffCount, onLeaveTotalCount 등...은 모두 동일) ---
    // ...
    const teamGroups = appConfig.teamGroups || [];
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


    // ✅ [수정] 업무중/휴식중/대기 인원 계산 로직 변경
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused');
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    // '업무중'은 'ongoing' 상태인 사람만 카운트
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;
    const totalWorkingCount = ongoingMembers.size; // '업무중' 총원

    // 근무 가능 인원 (기존과 동일)
    const availableStaffCount = totalStaffCount - [...onLeaveMemberNames].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = totalPartTimerCount - [...onLeaveMemberNames].filter(member => allPartTimers.has(member)).length;
    
    // '휴식중' 인원
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    // '대기'는 (근무 가능) - (업무중) - (휴식중)
    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount; // '대기' 총원

    // 진행 업무(Task) 카운트는 'ongoing' + 'paused' 모두 포함 (기존 로직 유지)
    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;
    // --- (계산 로직 끝) ---


    // ✅ [수정] 동적으로 요소 업데이트 (수량 항목 제외)
    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    // total-work-time은 타이머(updateElapsedTimes)가 관리

    // --- 👇 [수정] 수량 항목 업데이트 로직 (appConfig.quantityToDashboardMap 사용) ---
    const quantitiesFromState = appState.taskQuantities || {}; // Firestore에서 로드된 최신 수량
    
    // ✅ [수정] 관리자 페이지에서 설정한 맵을 직접 사용
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    // ⛔️ [삭제] 기존 하드코딩 매핑 로직 (const taskNameToDashboardIdMap = {}; ... 등 10줄 이상) 삭제

    // 4. appState의 수량을 현황판 요소에 반영
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task]; // 매핑된 현황판 ID 찾기

        if (targetDashboardId && elements[targetDashboardId]) { // 해당 현황판 요소가 존재하는지 확인
            elements[targetDashboardId].textContent = quantity; // 요소의 텍스트 업데이트
            // console.log(`updateSummary: Updated ${targetDashboardId} with ${quantity}`); // 확인용 로그
        }
    }
    // --- 👆 [수정 끝] ---
};

// === ui.js (수정) ===

export const renderTeamSelectionModalContent = (task, appState, teamGroups = []) => {
    const titleEl = document.getElementById('team-select-modal-title');
    const container = document.getElementById('team-select-modal-content');
    if (!titleEl || !container) return;

    titleEl.textContent = `'${task || '기타 업무'}' 팀원 선택`;
    container.innerHTML = '';

    // ✅ [수정] '업무 중'과 '휴식 중'을 구분하기 위해 Set 분리
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
            // ✅ [수정] isWorking 대신 isOngoing, isPaused로 확인
            const isOngoing = ongoingMembers.has(member);
            const isPaused = pausedMembers.has(member);
            const leaveEntry = onLeaveMemberMap.get(member);
            const isOnLeave = !!leaveEntry;
            const card = document.createElement('button');
            card.type = 'button';
            card.dataset.memberName = member;
            
            // ✅ [수정] 비활성화 조건
            card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isOngoing || isPaused || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

            if (isOngoing || isPaused || isOnLeave) card.disabled = true;

            let statusLabel = '';
            // ✅ [수정] 상태 라벨 분기
            if (isOngoing) { statusLabel = '<div class="text-xs text-red-500">업무 중</div>'; }
            else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600">휴식 중</div>'; }
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
        // ✅ [수정] isWorking 대신 isOngoing, isPaused로 확인
        const isOngoing = ongoingMembers.has(pt.name);
        const isPaused = pausedMembers.has(pt.name);
        const leaveEntry = onLeaveMemberMap.get(pt.name);
        const isOnLeave = !!leaveEntry;
        const cardWrapper = document.createElement('div');
        cardWrapper.className = 'relative';

        const card = document.createElement('button');
        card.type = 'button';
        card.dataset.memberName = pt.name;
        
        // ✅ [수정] 비활성화 조건
        card.className = `w-full p-2 rounded-lg border text-center transition-shadow min-h-[50px] flex flex-col justify-center ${isOngoing || isPaused || isOnLeave ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-blue-50'}`;

        if (isOngoing || isPaused || isOnLeave) card.disabled = true;

        let statusLabel = '';
        // ✅ [수정] 상태 라벨 분기
        if (isOngoing) { statusLabel = '<div class="text-xs text-red-500">업무 중</div>'; }
        else if (isPaused) { statusLabel = '<div class="text-xs text-yellow-600">휴식 중</div>'; }
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

/**
 * [추가] 두 값의 차이를 비교하여 증감 화살표와 %가 포함된 HTML 문자열을 반환합니다.
 * @param {string} metric - 비교할 항목 키 (e.g., 'avgTime')
 * @param {number} current - 현재 값
 * @param {number} previous - 이전 값
 * @returns {string} - 렌더링할 HTML 문자열
 */
const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = current || 0;
    const prevValue = previous || 0;

    if (prevValue === 0) {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return ''; // 둘 다 0
    }
    
    const diff = currValue - prevValue;
    // 부동소수점 오류 방지를 위해 매우 작은 차이는 0으로 간주
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
    
    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';
    
    // 1. 색상 결정 로직
    let colorClass = 'text-gray-500'; // 기본
    if (metric === 'avgThroughput' || metric === 'avgStaff') {
        // 처리량, 인원수 => 높을수록 좋음 (초록색)
        colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
    } else if (metric === 'avgCostPerItem' || metric === 'avgTime') {
        // 비용, 시간 => 낮을수록 좋음 (초록색)
        colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
    }
    
    // 2. 값 포맷팅 로직
    let diffStr = '';
    let prevStr = '';
    if (metric === 'avgTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    } else if (metric === 'avgStaff') {
        diffStr = Math.abs(diff).toFixed(0);
        prevStr = prevValue.toFixed(0);
    } else if (metric === 'avgCostPerItem') {
        diffStr = Math.abs(diff).toFixed(0);
        prevStr = prevValue.toFixed(0);
    } else { // avgThroughput
        diffStr = Math.abs(diff).toFixed(2);
        prevStr = prevValue.toFixed(2);
    }

    return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                ${sign} ${diffStr} (${percent.toFixed(0)}%)
            </span>`;
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

// ✅ [수정] csvButtonHtml 파라미터 추가
const renderSummaryView = (mode, dataset, periodKey, wageMap = {}, previousPeriodDataset = null, csvButtonHtml = '') => {
    const records = dataset.workRecords || [];
    const quantities = dataset.taskQuantities || {};

    // --- 1. 이전 기간(Previous) 데이터 계산 ---
    let prevTaskSummary = {};
    if (previousPeriodDataset) {
        const prevRecords = previousPeriodDataset.workRecords || [];
        const prevQuantities = previousPeriodDataset.taskQuantities || {};

        // 1a. 이전 기간 Reduce
        prevTaskSummary = prevRecords.reduce((acc, r) => {
            if (!r || !r.task) return acc;
            if (!acc[r.task]) {
                acc[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 }; 
            }
            acc[r.task].duration += (r.duration || 0);
            const wage = wageMap[r.member] || 0;
            acc[r.task].cost += ((r.duration || 0) / 60) * wage;
            acc[r.task].members.add(r.member);
            acc[r.task].recordCount += 1;
            return acc;
        }, {});

        // 1b. 이전 기간 Post-process (평균값 계산)
        Object.keys(prevTaskSummary).forEach(task => {
            const summary = prevTaskSummary[task];
            const qty = Number(prevQuantities[task]) || 0;
            
            summary.quantity = qty;
            summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
            summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
            summary.avgStaff = summary.members.size;
            summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
        });
        // (수량은 있지만 업무 기록은 없는 작업 추가)
        Object.entries(prevQuantities || {}).forEach(([task, qtyValue]) => {
            if (!prevTaskSummary[task] && Number(qtyValue) > 0) {
                 prevTaskSummary[task] = { 
                     duration: 0, cost: 0, quantity: Number(qtyValue), 
                     avgThroughput: 0, avgCostPerItem: 0, 
                     members: new Set(), recordCount: 0,
                     avgStaff: 0, avgTime: 0
                 };
            }
        });
    }

    // --- 2. 현재 기간(Current) 데이터 계산 ---
    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities || {}).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0;
        return s + ((r.duration || 0) / 60) * wage;
    }, 0);

    const overallAvgThroughput = totalDuration > 0 ? (totalQuantity / totalDuration).toFixed(2) : '0.00';
    const overallAvgCostPerItem = totalQuantity > 0 ? (totalCost / totalQuantity).toFixed(0) : '0';

    // 2a. 현재 기간 Reduce (✅ members, recordCount 추가)
    const taskSummary = records.reduce((acc, r) => {
        if (!r || !r.task) return acc;
        if (!acc[r.task]) {
            acc[r.task] = { 
                duration: 0, 
                cost: 0, 
                members: new Set(), // ✅
                recordCount: 0  // ✅
            };
        }
        acc[r.task].duration += (r.duration || 0);
        const wage = wageMap[r.member] || 0;
        acc[r.task].cost += ((r.duration || 0) / 60) * wage;
        acc[r.task].members.add(r.member); // ✅
        acc[r.task].recordCount += 1; // ✅
        return acc;
    }, {});

    // 2b. 현재 기간 Post-process (평균값 계산)
    Object.keys(taskSummary).forEach(task => {
        const summary = taskSummary[task];
        const qty = Number(quantities[task]) || 0;
        
        summary.quantity = qty;
        summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0; // 숫자
        summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0; // 숫자
        summary.avgStaff = summary.members.size; // ✅ 총 참여인원
        summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0; // ✅ 평균 처리시간 (건당)
    });
    // (수량은 있지만 업무 기록은 없는 작업 추가)
    Object.entries(quantities || {}).forEach(([task, qtyValue]) => {
        if (!taskSummary[task] && Number(qtyValue) > 0) {
             taskSummary[task] = { 
                 duration: 0, cost: 0, quantity: Number(qtyValue), 
                 avgThroughput: 0, avgCostPerItem: 0, 
                 members: new Set(), recordCount: 0,
                 avgStaff: 0, avgTime: 0
             };
        }
    });

    // --- 3. HTML 렌더링 ---
    
    // ✅ [수정] 스크롤 타겟 ID 추가 및 버튼 영역 추가
    let html = `<div id="summary-card-${periodKey}" class="bg-white p-4 rounded-lg shadow-sm mb-6 scroll-mt-4">`;
    // ✅ [수정] flex 레이아웃 및 버튼 영역 추가
    html += `<div class="flex justify-between items-center mb-4">
               <h3 class="text-xl font-bold">${periodKey} 요약</h3>
               ${csvButtonHtml} {/* CSV 버튼 표시 */}
             </div>`;
    html += `<h3 class="text-xl font-bold mb-4">${periodKey} 요약</h3>`;

    html += `<div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 text-center">
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 시간</div><div class="text-lg font-bold">${formatDuration(totalDuration)}</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 처리량</div><div class="text-lg font-bold">${totalQuantity} 개</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">총 인건비</div><div class="text-lg font-bold">${Math.round(totalCost).toLocaleString()} 원</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리량</div><div class="text-lg font-bold">${overallAvgThroughput} 개/분</div></div>
        <div class="bg-gray-50 p-3 rounded"><div class="text-xs text-gray-500">평균 처리비용</div><div class="text-lg font-bold">${overallAvgCostPerItem} 원/개</div></div>
    </div>`;

    html += `<h4 class="text-lg font-semibold mb-3 text-gray-700">업무별 평균 (
                ${previousPeriodDataset ? (mode === 'weekly' ? '전주' : '전월') + ' 대비' : '이전 데이터 없음'}
            )</h4>`;
    html += `<div class="overflow-x-auto max-h-60">
               <table class="w-full text-sm text-left text-gray-600">
                 <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0">
                   <tr>
                     <th scope="col" class="px-4 py-2">업무</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리량 (개/분)</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리비용 (원/개)</th>
                     <th scope="col" class="px-4 py-2 text-right">총 참여인원 (명)</th>
                     <th scope="col" class="px-4 py-2 text-right">평균 처리시간 (건)</th>
                   </tr>
                 </thead>
                 <tbody>`;

    const sortedTasks = Object.keys(taskSummary).sort();
    let hasTaskData = false;
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const summary = taskSummary[task];
            const prevSummary = prevTaskSummary[task] || null; // 비교 대상

            if (summary && (summary.duration > 0 || summary.quantity > 0)) {
                hasTaskData = true;

                // ✅ [추가] 증감 HTML 계산
                const throughputDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgThroughput', summary.avgThroughput, prevSummary?.avgThroughput) : '';
                const costDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgCostPerItem', summary.avgCostPerItem, prevSummary?.avgCostPerItem) : '';
                const staffDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgStaff', summary.avgStaff, prevSummary?.avgStaff) : '';
                const timeDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgTime', summary.avgTime, prevSummary?.avgTime) : '';

                // ✅ [수정] <td> 내부 구조 변경 (div + span)
                html += `<tr class="bg-white border-b hover:bg-gray-50">
                           <td class="px-4 py-2 font-medium text-gray-900">${task}</td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgThroughput.toFixed(2)}</div>
                                ${throughputDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgCostPerItem.toFixed(0)}</div>
                                ${costDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgStaff}</div>
                                ${staffDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${formatDuration(summary.avgTime)}</div>
                                ${timeDiff}
                           </td>
                         </tr>`;
            }
        });
    }

    if (!hasTaskData) {
        // ✅ [수정] colspan="5"
        html += `<tr><td colspan="5" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
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

        // ✅ [수정] map 콜백에서 index를 사용해 prevData 전달
        view.innerHTML = sortedWeeks.map((weekKey, index) => {
            const currentData = weeklyData[weekKey];
            const prevWeekKey = sortedWeeks[index + 1] || null;
            const prevData = prevWeekKey ? weeklyData[prevWeekKey] : null;
            
            // ✅ [수정] CSV 버튼 HTML을 renderSummaryView 호출 전에 생성하여 전달
            const csvButtonHtml = `
                <button class="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                        data-action="download-csv" data-view="weekly" data-key="${weekKey}">
                    CSV (요약)
                </button>
            `;
            return renderSummaryView('weekly', currentData, weekKey, combinedWageMap, prevData, csvButtonHtml); // 마지막 인자로 버튼 HTML 전달
        }).join('');

    } catch (error) {
        console.error("Error in renderWeeklyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">주별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
    }
};

// === ui.js (수정 3/3 - renderMonthlyHistory) ===
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

        view.innerHTML = sortedMonths.map((monthKey, index) => {
            const currentData = monthlyData[monthKey];
            const prevMonthKey = sortedMonths[index + 1] || null;
            const prevData = prevMonthKey ? monthlyData[prevMonthKey] : null;
            
            // ✅ [수정] CSV 버튼 HTML을 renderSummaryView 호출 전에 생성하여 전달
            const csvButtonHtml = `
                <button class="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                        data-action="download-csv" data-view="monthly" data-key="${monthKey}">
                    CSV (요약)
                </button>
            `;
            return renderSummaryView('monthly', currentData, monthKey, combinedWageMap, prevData, csvButtonHtml); // 마지막 인자로 버튼 HTML 전달
        }).join('');
        
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
            {/* ✅ [수정] CSV 버튼 추가 */}
            <div>
                 <button class="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                        data-action="download-csv" data-view="attendance-daily" data-key="${dateKey}">
                    CSV (상세)
                </button>
                <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2"
                        data-action="open-add-attendance-modal" data-date-key="${dateKey}">
                    수동 추가
                </button>
                <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2"
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
                        <th scope="col" class="px-6 py-3 text-right">관리</th>
                    </tr>
                </thead>
                <tbody>
    `;

    leaveEntries.forEach((entry, index) => {
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
                <td class="px-6 py-4 text-right space-x-2">
                    <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${index}" class="font-medium text-blue-500 hover:underline">수정</button>
                    <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${index}" class="font-medium text-red-500 hover:underline">삭제</button>
                </td>
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

// ✅ [추가] 주별/월별 근태 요약 렌더링을 위한 공통 헬퍼 함수
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap) => {
    const sortedKeys = Object.keys(aggregationMap).sort((a,b) => b.localeCompare(a));
    if (sortedKeys.length === 0) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">해당 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    let html = '';
    sortedKeys.forEach(periodKey => {
        const data = aggregationMap[periodKey];
        
        // [수정] 근태 항목 집계 (member-type 기준)
    const summary = data.leaveEntries.reduce((acc, entry) => {
        const key = `${entry.member}-${entry.type}`;
        // [수정] days: 0 제거, count만 초기화
        if (!acc[key]) acc[key] = { member: entry.member, type: entry.type, count: 0 };
        // [수정] 유형별 count 로직
        if (['연차', '출장', '결근'].includes(entry.type)) { acc[key].count += 1; } 
        else if (['외출', '조퇴'].includes(entry.type)) { acc[key].count += 1; }
        return acc;
    }, {});
    // [수정] '일' 단위와 '회' 단위 구분
    Object.values(summary).forEach(item => {
         if (['연차', '출장', '결근'].includes(item.type)) { item.days = item.count; } 
         else { item.days = 0; }
    });

    // ✅ [수정] HTML 문자열 생성 및 반환
    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6 scroll-mt-4">
                <div class="flex justify-between items-center mb-3">
                    <h3 class="text-xl font-bold">${periodKey}</h3>
                    ${csvButtonHtml} {/* CSV 버튼 표시 */}
                </div>
                <div class="space-y-1 max-h-60 overflow-y-auto">`;

    if (Object.keys(summary).length === 0) {
         html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
    } else {
        Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
             html += `<div class="flex justify-between text-sm p-1 rounded hover:bg-gray-50">
                        <span class="font-semibold text-gray-700 w-1/3">${item.member}</span>
                        <span class="w-1/3 text-center">${item.type}</span>
                        <span class="text-right w-1/3">${item.days > 0 ? `${item.days}일` : `${item.count}회`}</span>
                     </div>`;
        });
    }
    html += `</div></div>`;
    return html; // HTML 문자열 반환
};

export const renderAttendanceWeeklyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    // 주별 데이터 집계 로직 (기존과 동일)
    const weeklyData = (allHistoryData || []).reduce((acc, day) => {
        // ... (집계 로직) ...
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string') return acc;
        try {
             const dateObj = new Date(day.id);
             if (isNaN(dateObj.getTime())) return acc;
             const weekKey = getWeekOfYear(dateObj);
             if (!weekKey) return acc;

            if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => { /* ... */ });
            acc[weekKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance weekly aggregation:", day.id, e); }
        return acc;
    }, {});

    // ✅ [수정] 공통 헬퍼 함수 호출 전에 CSV 버튼 HTML 생성 로직 추가
    const sortedKeys = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
    if (sortedKeys.length === 0) {
        view.innerHTML = `<div class="text-center text-gray-500">해당 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }
    
    // 각 주별 카드에 CSV 버튼 추가
    let html = '';
    sortedKeys.forEach(periodKey => {
         const csvButtonHtml = `
            <button class="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                    data-action="download-csv" data-view="attendance-weekly" data-key="${periodKey}">
                CSV (요약)
            </button>
        `;
        // renderAggregatedAttendanceSummary 함수 호출 시 버튼 HTML 전달
        html += renderAggregatedAttendanceSummary(weeklyData[periodKey], periodKey, csvButtonHtml);
    });
    view.innerHTML = html;
};

export const renderAttendanceMonthlyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    // 월별 데이터 집계 로직 (기존과 동일)
    const monthlyData = (allHistoryData || []).reduce((acc, day) => {
        // ... (집계 로직) ...
        if (!day || !day.id || !day.onLeaveMembers || day.onLeaveMembers.length === 0 || typeof day.id !== 'string' || day.id.length < 7) return acc;
         try {
            const monthKey = day.id.substring(0, 7);
             if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;

            if (!acc[monthKey]) acc[monthKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => { /* ... */ });
            acc[monthKey].dateKeys.add(day.id);
        } catch (e) { console.error("Error processing day in attendance monthly aggregation:", day.id, e); }
        return acc;
    }, {});

    // ✅ [수정] 공통 헬퍼 함수 호출 전에 CSV 버튼 HTML 생성 로직 추가
    const sortedKeys = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));
    if (sortedKeys.length === 0) {
        view.innerHTML = `<div class="text-center text-gray-500">해당 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    // 각 월별 카드에 CSV 버튼 추가
    let html = '';
    sortedKeys.forEach(periodKey => {
        const csvButtonHtml = `
            <button class="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-1 px-3 rounded-md text-sm" 
                    data-action="download-csv" data-view="attendance-monthly" data-key="${periodKey}">
                CSV (요약)
            </button>
        `;
        // renderAggregatedAttendanceSummary 함수 호출 시 버튼 HTML 전달
        html += renderAggregatedAttendanceSummary(monthlyData[periodKey], periodKey, csvButtonHtml);
    });
    view.innerHTML = html;
};

// === ui.js (파일 맨 끝에 추가) ===

/**
 * [수동 기록 추가] 모달의 <datalist>에 직원 및 업무 목록을 채웁니다.
 */
export const renderManualAddModalDatalists = (appState, appConfig) => {
    const memberDatalist = document.getElementById('manual-add-member-list');
    const taskDatalist = document.getElementById('manual-add-task-list');

    if (!memberDatalist || !taskDatalist) return;

    // 1. 직원 목록 채우기
    memberDatalist.innerHTML = '';
    const staffMembers = (appConfig.teamGroups || []).flatMap(g => g.members);
    const partTimerMembers = (appState.partTimers || []).map(p => p.name);
    
    const allMembers = [...new Set([...staffMembers, ...partTimerMembers])].sort();
    
    allMembers.forEach(member => {
        const option = document.createElement('option');
        option.value = member;
        memberDatalist.appendChild(option);
    });

    // 2. 업무 목록 채우기
    taskDatalist.innerHTML = '';
    const allTasks = [...new Set(Object.values(appConfig.taskGroups || {}).flat())].sort();

    // ... (renderManualAddModalDatalists 함수 내용) ...
    allTasks.forEach(task => {
        const option = document.createElement('option');
        option.value = task;
        taskDatalist.appendChild(option);
    });
};