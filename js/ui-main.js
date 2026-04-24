// === js/ui-main.js ===

import { formatTimeTo24H, formatDuration, calcElapsedMinutes, getCurrentTime, isWeekday, calculateDateDifference, calculateWorkingDays, calcTotalPauseMinutes } from './utils.js';
import { getAllDashboardDefinitions, taskCardStyles, taskTitleColors } from './ui.js';
import * as State from './state.js';

const getLeaveDisplayLabel = (member, leaveEntry) => {
    if (leaveEntry.type !== '연차') return leaveEntry.type;
    const settings = State.appConfig.memberLeaveSettings?.[member] || {};
    const resetDate = settings.leaveResetDate;

    const rawHistory = (State.persistentLeaveSchedule.onLeaveMembers || [])
        .filter(l => {
            if (l.member !== member || l.type !== '연차') return false;
            if (resetDate && l.startDate < resetDate) return false;
            return true;
        })
        .sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));

    if (rawHistory.length === 0) return '연차';

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
                if (next.id) current.ids.push(next.id);
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

    let cumulativeDays = 0;
    
    for (const block of mergedHistory) {
        const days = calculateWorkingDays(block.startDate, block.endDate);
        if (days === 0) continue;

        const startNth = cumulativeDays + 1;
        const endNth = cumulativeDays + days;
        cumulativeDays += days;

        const isIdMatch = leaveEntry.id && block.ids.includes(leaveEntry.id);
        const isDateMatch = (leaveEntry.startDate >= block.startDate && 
                             (leaveEntry.endDate || leaveEntry.startDate) <= block.endDate);

        if (isIdMatch || isDateMatch) {
            if (days === 1) {
                return `연차${startNth}`;
            } else {
                return `연차${startNth}-${endNth}`;
            }
        }
    }
    return '연차';
};

// 💡 알림 위젯 렌더링 로직
export const renderMemoWidget = (appState) => {
    const memoList = document.getElementById('widget-memo-list');
    if (!memoList) return;

    const todos = appState.adminTodos || appState.todos || [];
    
    if (todos.length === 0) {
        memoList.innerHTML = `<li class="text-yellow-700/60 dark:text-yellow-500/60 list-none -ml-4 text-center text-xs py-4 font-normal">등록된 중요 알림이 없습니다.</li>`;
        return;
    }

    let html = '';
    todos.forEach(todo => {
        const text = todo.text || todo.content || todo.title || todo.memo || (typeof todo === 'string' ? todo : '내용 없음');
        const textClass = todo.isCompleted || todo.status === 'completed' ? 'line-through text-yellow-700/50 dark:text-yellow-500/50' : 'text-yellow-900 dark:text-yellow-200';
        html += `<li class="${textClass}">${text}</li>`;
    });
    memoList.innerHTML = html;
};

// 1. 대시보드 레이아웃 렌더링 (다크 모드 클래스 추가)
export const renderDashboardLayout = (appConfig) => {
    const personnelContainer = document.getElementById('summary-personnel');
    const workloadContainer = document.getElementById('summary-workload');
    
    if (!personnelContainer && !workloadContainer) return;

    const itemIds = appConfig.dashboardItems || [];
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    let personnelHtml = '';
    let workloadHtml = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;

        const isQuantity = def.isQuantity === true;

        if (isQuantity) {
            workloadHtml += `
                <div class="flex justify-between items-center py-2 border-b border-blue-50 dark:border-blue-900/50 last:border-0 hover:bg-blue-50/50 dark:hover:bg-blue-900/30 transition-colors px-2 rounded">
                    <span class="text-xs font-bold text-blue-600 dark:text-blue-400">${def.title}</span>
                    <span id="${def.valueId}" class="text-sm font-extrabold text-blue-700 dark:text-blue-300 bg-white dark:bg-gray-800 px-2 py-0.5 rounded-md shadow-sm border border-blue-100 dark:border-blue-800 transition-all">0</span>
                </div>
            `;
        } else {
            personnelHtml += `
                <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors px-2 rounded">
                    <span class="text-xs font-medium text-gray-500 dark:text-gray-400">${def.title}</span>
                    <span id="${def.valueId}" class="text-sm font-extrabold text-gray-800 dark:text-gray-200 transition-all">0</span>
                </div>
            `;
        }
    });

    if (personnelContainer) personnelContainer.innerHTML = personnelHtml;
    if (workloadContainer) workloadContainer.innerHTML = workloadHtml;
};

// 2. 대시보드 수치 업데이트
export const updateSummary = (appState, appConfig) => {
    const allDefinitions = getAllDashboardDefinitions(appConfig);
    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    const teamGroups = appConfig.teamGroups || [];
    const allStaffMembers = new Set(teamGroups.flatMap(g => g.members));
    const allPartTimers = new Set((appState.partTimers || []).map(p => p.name));
    const totalStaffCount = allStaffMembers.size;
    const totalPartTimerCount = allPartTimers.size;

    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

    const onLeaveMemberNames = new Set(
        combinedOnLeaveMembers
            .filter(item => !(item.type === '외출' && item.endTime))
            .map(item => item.member)
    );
    const onLeaveTotalCount = onLeaveMemberNames.size;

    const attendanceMap = appState.dailyAttendance || {};
    const currentlyClockedIn = new Set(
        Object.keys(attendanceMap).filter(member => attendanceMap[member].status === 'active')
    );

    const availableStaffCount = [...currentlyClockedIn].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = [...currentlyClockedIn].filter(member => allPartTimers.has(member)).length;

    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused');
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    const totalWorkingCount = ongoingMembers.size;
    
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;

    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    const quantitiesFromState = appState.taskQuantities || {};
    const quantityStatuses = appState.taskQuantityStatuses || {};
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};
    
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task];

        if (targetDashboardId && elements[targetDashboardId]) {
            const el = elements[targetDashboardId];
            el.textContent = quantity;

            el.classList.remove('quantity-estimated', 'quantity-confirmed', 'text-red-500', 'text-green-500');

            const status = quantityStatuses[task];
            if (status === 'estimated') {
                el.classList.add('text-red-500'); 
            } else if (status === 'confirmed') {
                el.classList.add('text-green-500'); 
            }
        }
    }

    renderMemoWidget(appState);
};

export const renderTaskAnalysis = (appState, appConfig) => {
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; 
    
    const now = getCurrentTime();
    const allRecords = appState.workRecords || [];
    
    if (allRecords.length === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-400 py-8 text-sm">기록된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    let totalLoggedMinutes = 0;
    let totalBreakMinutes = 0;
    const taskAnalysis = {};

    allRecords.forEach(record => {
        let duration = 0;
        if (record.status === 'completed') {
            duration = record.duration || 0;
        } else {
            duration = calcElapsedMinutes(record.startTime, now, record.pauses);
        }

        if (record.task) {
             taskAnalysis[record.task] = (taskAnalysis[record.task] || 0) + duration;
             totalLoggedMinutes += duration;
        }

        (record.pauses || []).forEach(pause => {
            if (pause.start && (pause.type === 'break' || !pause.type)) { 
                const endTime = pause.end || now;
                const s = new Date(`1970-01-01T${pause.start}:00Z`).getTime();
                const e = new Date(`1970-01-01T${endTime}:00Z`).getTime();
                if (e > s) {
                    totalBreakMinutes += (e - s) / 60000;
                }
            }
        });
    });

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','샘플검수':'#14b8a6', '전량검수':'#9333ea', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};
    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow max-h-72 overflow-y-auto pr-2 space-y-2">';

    sortedTasks.forEach(([task, minutes]) => {
        const percentage = totalLoggedMinutes > 0 ? (minutes / totalLoggedMinutes) * 100 : 0;
        const color = taskColorsHex[task] || '#6b7280';
        if (percentage > 0) {
            gradientParts.push(`${color} ${cumulativePercentage}% ${cumulativePercentage + percentage}%`);
            cumulativePercentage += percentage;
        }
        legendHTML += `<div class="flex items-center justify-between p-2 rounded-lg bg-gray-50 dark:bg-gray-700 border border-gray-100 dark:border-gray-600"><div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2 shadow-sm" style="background-color: ${color};"></span><span class="font-bold text-gray-700 dark:text-gray-200 text-sm">${task}</span></div><div class="text-right"><div class="text-sm font-extrabold text-gray-800 dark:text-white">${formatDuration(minutes)}</div><div class="text-[10px] text-gray-500 dark:text-gray-400">${percentage.toFixed(1)}%</div></div></div>`;
    });
    legendHTML += '</div>';

    const finalGradient = gradientParts.length > 0 ? `conic-gradient(${gradientParts.join(', ')})` : 'conic-gradient(#e5e7eb 0% 100%)';
    
    analysisContainer.innerHTML = `<div class="flex flex-col md:flex-row items-center gap-6 md:gap-8">
        <div class="flex-shrink-0">
            <div class="chart shadow-sm" style="background: ${finalGradient}; width: 160px; height: 160px;">
                <div class="chart-center shadow-sm dark:bg-gray-800">
                    <span class="text-xs font-bold text-gray-400 dark:text-gray-500">총 업무</span>
                    <span class="text-xl font-extrabold text-blue-600 dark:text-blue-400">${formatDuration(totalLoggedMinutes)}</span>
                    <span class="text-[10px] text-gray-400 mt-1">휴식: ${formatDuration(Math.round(totalBreakMinutes))}</span>
                </div>
            </div>
        </div>
        <div class="flex-grow w-full md:w-auto">
            ${legendHTML}
        </div>
    </div>`;

    const memberSelect = document.getElementById('analysis-member-select');
    if (memberSelect && memberSelect.options.length <= 1) {
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

export const renderPersonalAnalysis = (selectedMember, appState) => {
    const container = document.getElementById('analysis-personal-stats-container');
    if (!container) return;

    if (!selectedMember) {
        container.innerHTML = `<p class="text-center text-gray-400 text-sm py-4">통계를 보려면 위에서 직원을 선택하세요.</p>`;
        return;
    }

    const memberRecords = (appState.workRecords || []).filter(r => r.member === selectedMember);
    const attendance = appState.dailyAttendance?.[selectedMember];
    const now = getCurrentTime();
    const ongoingRecord = memberRecords.find(r => r.status === 'ongoing');
    const pausedRecord = memberRecords.find(r => r.status === 'paused');
    
    let currentStatusHtml = '';
    if (ongoingRecord) {
        currentStatusHtml = `<span class="text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-1 rounded-md">업무 중: ${ongoingRecord.task}</span>`;
    } else if (pausedRecord) {
        currentStatusHtml = `<span class="text-sm font-bold text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/30 px-2 py-1 rounded-md">휴식 중</span>`;
    } else {
        const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
        const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
        const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];

        const leaveInfo = combinedOnLeaveMembers.find(m => m.member === selectedMember && !(m.type === '외출' && m.endTime));
        if (leaveInfo) {
             const label = getLeaveDisplayLabel(selectedMember, leaveInfo);
             currentStatusHtml = `<span class="text-sm font-bold text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-600 px-2 py-1 rounded-md">${label} 중</span>`;
        } else {
             if (attendance && attendance.status === 'active') {
                 currentStatusHtml = `<span class="text-sm font-bold text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded-md">대기 중</span>`;
             } else if (attendance && attendance.status === 'returned') {
                 currentStatusHtml = `<span class="text-sm font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">퇴근 완료</span>`;
             } else {
                 currentStatusHtml = `<span class="text-sm font-bold text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded-md">출근 전</span>`;
             }
        }
    }

    if (memberRecords.length === 0) {
         container.innerHTML = `
            <div class="flex justify-between items-center mb-4 pb-2 border-b border-gray-200 dark:border-gray-700">
                <h4 class="text-lg font-extrabold text-gray-800 dark:text-white">${selectedMember}</h4>
                ${currentStatusHtml}
            </div>
            <p class="text-center text-gray-400 text-sm py-4">오늘 업무 기록이 없습니다.</p>`;
        return;
    }

    const taskTimes = memberRecords.reduce((acc, r) => {
        let duration = 0;
        if (r.status === 'completed') {
            duration = r.duration || 0;
        } else {
            duration = calcElapsedMinutes(r.startTime, now, r.pauses);
        }
        acc[r.task] = (acc[r.task] || 0) + duration;
        return acc;
    }, {});
    const sortedTasks = Object.entries(taskTimes).sort(([, a], [, b]) => b - a);
    const totalLiveMinutes = sortedTasks.reduce((sum, [, minutes]) => sum + minutes, 0);

    let baseStartTime = null;
    if (attendance && attendance.inTime) {
        baseStartTime = attendance.inTime;
    } else {
        memberRecords.forEach(r => {
            if (r.startTime && (!baseStartTime || r.startTime < baseStartTime)) baseStartTime = r.startTime;
        });
    }

    let lastEffectiveEndTime = null;
    memberRecords.forEach(r => {
        if (r.status === 'completed' && r.endTime) {
            if (!lastEffectiveEndTime || r.endTime > lastEffectiveEndTime) lastEffectiveEndTime = r.endTime;
        }
    });
    if (ongoingRecord || pausedRecord) lastEffectiveEndTime = now;
    if (attendance && attendance.outTime && attendance.status === 'returned') {
         if (!lastEffectiveEndTime || attendance.outTime > lastEffectiveEndTime) lastEffectiveEndTime = attendance.outTime;
    }

    let totalTimeSpanMinutes = 0;
    if (baseStartTime && lastEffectiveEndTime) {
        totalTimeSpanMinutes = calcElapsedMinutes(baseStartTime, lastEffectiveEndTime, []); 
    }
    const totalNonWorkMinutes = Math.max(0, totalTimeSpanMinutes - totalLiveMinutes);

    let html = `
        <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
            <h4 class="text-lg font-extrabold text-gray-800 dark:text-white">${selectedMember}</h4>
            ${currentStatusHtml}
        </div>
        <div class="grid grid-cols-2 gap-3 mb-4 text-center">
            <div class="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-center">
                <div class="text-[11px] font-bold text-gray-400 dark:text-gray-500 mb-1">실제 업무시간</div>
                <div class="text-xl font-extrabold text-blue-600 dark:text-blue-400">${formatDuration(totalLiveMinutes)}</div>
            </div>
             <div class="bg-white dark:bg-gray-800 p-3 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm flex flex-col justify-center">
                <div class="text-[11px] font-bold text-gray-400 dark:text-gray-500 mb-1">비업무/휴식 추정</div>
                <div class="text-xl font-extrabold text-gray-500 dark:text-gray-400">${formatDuration(Math.round(totalNonWorkMinutes))}</div>
            </div>
        </div>
        <div>
            <h5 class="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">오늘 수행한 업무</h5>
            <ul class="space-y-2 max-h-40 overflow-y-auto pr-1">
    `;
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(([task, minutes]) => {
            if (minutes > 0) {
                html += `<li class="flex justify-between items-center p-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm"><span class="font-bold text-sm text-gray-700 dark:text-gray-200">${task}</span><span class="text-sm font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">${formatDuration(minutes)}</span></li>`;
            }
        });
    } else {
        html += `<li class="text-sm text-gray-400 text-center py-2">데이터 없음</li>`;
    }
    html += `</ul></div>`;
    container.innerHTML = html;
};

export const renderAttendanceToggle = (appState) => {
    const currentUser = appState.currentUser;
    if (!currentUser) return;

    const attendance = appState.dailyAttendance?.[currentUser];
    const status = attendance?.status;
    const isClockedIn = status === 'active';
    const isReturned = status === 'returned';

    const pcToggle = document.getElementById('pc-attendance-checkbox');
    const mobileToggle = document.getElementById('mobile-attendance-checkbox');
    const pcCancelBtn = document.getElementById('pc-clock-out-cancel-btn');
    const mobileCancelBtn = document.getElementById('mobile-clock-out-cancel-btn');

    if (pcToggle) pcToggle.checked = isClockedIn;
    if (mobileToggle) mobileToggle.checked = isClockedIn;

    if (pcCancelBtn) pcCancelBtn.classList.toggle('hidden', !isReturned);
    if (mobileCancelBtn) mobileCancelBtn.classList.toggle('hidden', !isReturned);
};

// 3. 실시간 팀 업무 진행 보드 렌더링 (다크 모드 적용)
export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = [], isMobileTaskViewExpanded = false, isMobileMemberViewExpanded = false) => {
    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;
    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) return;
    teamStatusBoard.innerHTML = '';

    const presetTaskContainer = document.createElement('div');
    presetTaskContainer.className = 'mb-6';
    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5';
    if (isMobileTaskViewExpanded) presetGrid.classList.add('mobile-expanded');

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const tasksToRender = [...new Set([...baseTasks, ...ongoingRecords.map(r => r.task)])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);
        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');
        const mobileVisibilityClass = (isCurrentUserWorkingOnThisTask || isMobileTaskViewExpanded) ? 'flex' : 'hidden md:flex mobile-task-hidden';
        
        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];
            const headerColor = isPaused ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
            const titleColor = isPaused ? 'text-yellow-800 dark:text-yellow-400' : 'text-blue-800 dark:text-blue-400';
            
            card.className = `${mobileVisibilityClass} flex-col min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden transition-all hover:shadow-md cursor-pointer`;
            card.dataset.task = task; 
            card.dataset.groupId = firstRecord.groupId; 

            let membersHtml = '<div class="p-2 overflow-y-auto max-h-48 space-y-1.5 bg-gray-50/50 dark:bg-gray-900/50 flex-grow">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                const isRecPaused = rec.status === 'paused';
                const pauseMin = calcTotalPauseMinutes(rec.pauses);
                const memberPauseText = pauseMin > 0 ? `<span class="text-[10px] text-gray-400 ml-1">(휴:${formatDuration(pauseMin)})</span>` : '';

                membersHtml += `
                    <div class="flex items-center justify-between p-2 rounded-lg bg-white dark:bg-gray-800 border ${isRecPaused ? 'border-yellow-200 dark:border-yellow-700' : 'border-gray-100 dark:border-gray-700'} shadow-sm hover:border-blue-300 dark:hover:border-blue-500 transition-colors member-row">
                        <div class="flex items-center gap-2 overflow-hidden">
                            <div class="w-2 h-2 shrink-0 rounded-full ${isRecPaused ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}"></div>
                            <span class="font-bold text-gray-800 dark:text-gray-200 text-sm truncate" title="${rec.member}">${rec.member}</span>
                            <span class="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">(${formatTimeTo24H(rec.startTime)})${memberPauseText}</span>
                        </div>
                        <div class="flex gap-1 shrink-0 member-actions">
                            ${isRecPaused 
                                ? `<button data-action="resume-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-800/50 transition" title="재개"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg></button>`
                                : `<button data-action="pause-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-100 dark:hover:bg-yellow-800/50 transition" title="정지"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg></button>`
                            }
                            <button data-action="stop-individual" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-md bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-800/50 transition" title="종료"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                            <button data-action="edit-individual-start-time" data-record-id="${rec.id}" data-current-start-time="${rec.startTime || ''}" class="w-7 h-7 flex items-center justify-center rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-800/50 transition" title="시작시간 수정"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-3.5 h-3.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></button>
                        </div>
                    </div>`;
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const pausesJson = JSON.stringify(representativeRecord.pauses || []);
            const totalPauseMinutes = calcTotalPauseMinutes(representativeRecord.pauses);
            const pauseDisplay = totalPauseMinutes > 0 ? `<span class="text-[10px] text-gray-500 font-normal ml-1">(전체휴식: ${formatDuration(totalPauseMinutes)})</span>` : '';

            card.innerHTML = `
                <div class="px-4 py-3 ${headerColor} border-b flex justify-between items-start shrink-0">
                    <div>
                        <h3 class="font-bold text-lg ${titleColor} tracking-tight">${task}</h3>
                        <div class="text-[11px] ${isPaused ? 'text-yellow-700 dark:text-yellow-500' : 'text-blue-600 dark:text-blue-400'} mt-1 font-bold group-time-display cursor-pointer" data-action="edit-group-start-time" data-group-id="${firstRecord.groupId}" data-current-start-time="${earliestStartTime || ''}" title="그룹 시작시간 수정">
                            시작: ${formatTimeTo24H(earliestStartTime)}
                            <span class="ongoing-duration ml-1 font-extrabold" data-start-time="${earliestStartTime || ''}" data-status="${isOngoing ? 'ongoing' : 'paused'}" data-pauses-json='${pausesJson}'></span>
                            ${pauseDisplay}
                        </div>
                    </div>
                    <span class="px-2 py-1 ${isPaused ? 'bg-yellow-100 dark:bg-yellow-900/50 text-yellow-700 dark:text-yellow-300' : 'bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'} text-xs font-bold rounded-full shadow-sm">${groupRecords.length}명 참여</span>
                </div>
                ${membersHtml}
                <div class="p-3 bg-white dark:bg-gray-800 border-t border-gray-100 dark:border-gray-700 flex gap-2 shrink-0 card-actions">
                    <button data-task="${task}" class="${isPaused ? 'resume-work-group-btn bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-800/60' : 'pause-work-group-btn bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-800/60'} flex-1 py-2 font-bold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm">${isPaused ? '▶ 전체재개' : '⏸ 전체정지'}</button>
                    <button data-task="${task}" class="stop-work-group-btn flex-1 py-2 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/60 font-bold text-sm rounded-xl transition flex justify-center items-center gap-1 shadow-sm">⏹ 전체종료</button>
                </div>
            `;
        } else {
            card.className = `${mobileVisibilityClass} flex-col justify-center items-center min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-400 dark:hover:border-blue-500 transition-all group`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;
            card.innerHTML = `
                <div class="w-14 h-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full shadow-sm flex items-center justify-center text-gray-400 group-hover:text-blue-500 dark:group-hover:text-blue-400 group-hover:bg-blue-50 dark:group-hover:bg-blue-900/30 group-hover:border-blue-200 dark:group-hover:border-blue-800 group-hover:scale-110 transition-all mb-4 text-2xl font-light">+</div>
                <h3 class="font-bold text-lg text-gray-600 dark:text-gray-300 group-hover:text-blue-700 dark:group-hover:text-blue-400 transition-colors">${task} 시작</h3>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">클릭하여 인원 선택</p>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    otherTaskCard.className = `flex flex-col justify-center items-center min-h-[280px] bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 transition-all group`;
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `
        <div class="w-14 h-14 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-full shadow-sm flex items-center justify-center text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:bg-gray-100 dark:group-hover:bg-gray-600 group-hover:scale-110 transition-all mb-4 text-xl">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </div>
        <h3 class="font-bold text-lg text-gray-600 dark:text-gray-300">기타 업무</h3>
        <p class="text-xs text-gray-400 dark:text-gray-500 mt-2 font-medium">새로운 업무 만들기</p>
    `;
    presetGrid.appendChild(otherTaskCard);
    presetTaskContainer.appendChild(presetGrid);
    teamStatusBoard.appendChild(presetTaskContainer);

    // --- 전체 팀원 현황 (하단) ---
    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container';
    if (isMobileMemberViewExpanded) allMembersContainer.classList.add('mobile-expanded');
    
    allMembersContainer.innerHTML = `
        <div class="flex justify-between items-center border-b border-gray-200 dark:border-gray-700 pb-3 mb-6 mt-10">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <span class="text-xl">🧑‍🤝‍🧑</span> 전체 팀원 현황
                <span class="text-xs font-normal text-gray-400 dark:text-gray-500 hidden md:inline ml-2">(클릭하여 근태 설정/수정)</span>
            </h3>
            <button id="toggle-all-members-mobile" class="md:hidden bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 font-bold text-xs py-1.5 px-3 rounded-lg transition shadow-sm">${isMobileMemberViewExpanded ? '간략히' : '전체보기'}</button>
        </div>`;

    const ongoingMembers = new Set(ongoingRecords.filter(r => r.status === 'ongoing').map(r => r.member));
    const pausedMembers = new Set(ongoingRecords.filter(r => r.status === 'paused').map(r => r.member));
    const workingMembersMap = new Map(ongoingRecords.map(r => [r.member, r.task]));
    
    const dailyLeaves = Array.isArray(appState.dailyOnLeaveMembers) ? appState.dailyOnLeaveMembers : (appState.dailyOnLeaveMembers ? Object.values(appState.dailyOnLeaveMembers) : []);
    const dateLeaves = Array.isArray(appState.dateBasedOnLeaveMembers) ? appState.dateBasedOnLeaveMembers : [];
    const combinedOnLeaveMembers = [...dailyLeaves, ...dateLeaves];
    const onLeaveStatusMap = new Map(combinedOnLeaveMembers.filter(item => !(item.type === '외출' && item.endTime)).map(item => [item.member, item]));

    const orderedTeamGroups = [
        teamGroups.find(g => g.name === '관리'), teamGroups.find(g => g.name === '공통파트'), teamGroups.find(g => g.name === '담당파트'), teamGroups.find(g => g.name === '제작파트')
    ].filter(Boolean);

    orderedTeamGroups.forEach(group => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'mb-6';
        groupContainer.innerHTML = `<div class="flex items-center gap-2 mb-3 hidden md:flex"><h4 class="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">${group.name}</h4><div class="h-px bg-gray-200 dark:bg-gray-700 flex-grow"></div></div>`;
        const groupGrid = document.createElement('div');
        groupGrid.className = 'flex flex-wrap gap-2.5';
        
        [...new Set(group.members)].forEach(member => {
            const card = document.createElement('button');
            const leaveInfo = onLeaveStatusMap.get(member);
            const isOnLeave = !!leaveInfo;
            const isWorking = ongoingMembers.has(member) || pausedMembers.has(member);
            
            const attendance = appState.dailyAttendance?.[member];
            const isClockedIn = attendance && attendance.status === 'active';
            const isReturned = attendance && attendance.status === 'returned';
            
            const isSelf = (member === currentUserName);
            const visibilityClass = (isSelf || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
            
            card.className = `p-2 rounded-xl border text-center transition-all min-h-[76px] ${visibilityClass} ${isSelf ? 'w-full md:w-[110px]' : 'w-[110px]'} flex-col justify-center shadow-sm`;
            card.dataset.memberName = member;

            if (isOnLeave) {
                card.dataset.action = 'member-toggle-leave'; 
                card.dataset.leaveType = leaveInfo.type; 
                card.dataset.startTime = leaveInfo.startTime || ''; 
                card.dataset.startDate = leaveInfo.startDate || ''; 
                card.dataset.endTime = leaveInfo.endTime || ''; 
                card.dataset.endDate = leaveInfo.endDate || '';
                
                card.classList.add('bg-gray-100', 'dark:bg-gray-700', 'border-gray-300', 'dark:border-gray-600', 'text-gray-500', 'dark:text-gray-400');
                if (currentUserRole === 'admin' || isSelf) {
                    card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500', 'hover:bg-blue-50', 'dark:hover:bg-blue-900/30');
                } else {
                    card.classList.add('cursor-not-allowed');
                }
                
                const displayLabel = getLeaveDisplayLabel(member, leaveInfo);
                let detailText = leaveInfo.startTime ? formatTimeTo24H(leaveInfo.startTime) + (leaveInfo.endTime ? ` - ${formatTimeTo24H(leaveInfo.endTime)}` : (leaveInfo.type === '외출' ? ' ~' : '')) : (leaveInfo.startDate ? leaveInfo.startDate.substring(5) + (leaveInfo.endDate && leaveInfo.endDate !== leaveInfo.startDate ? ` ~ ${leaveInfo.endDate.substring(5)}` : '') : '');
                
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-0.5">${member}</div><div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded inline-block">${displayLabel}</div>${detailText ? `<div class="text-[10px] mt-1 text-gray-400 dark:text-gray-500">${detailText}</div>` : ''}`;
            } else if (isWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.classList.add('opacity-80', 'cursor-not-allowed', ongoingMembers.has(member) ? 'bg-red-50 dark:bg-red-900/20' : 'bg-yellow-50 dark:bg-yellow-900/20', ongoingMembers.has(member) ? 'border-red-200 dark:border-red-800' : 'border-yellow-200 dark:border-yellow-800');
                card.innerHTML = `<div class="font-extrabold text-sm ${ongoingMembers.has(member) ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'} mb-1">${member}</div><div class="text-[10px] font-bold ${ongoingMembers.has(member) ? 'text-red-500 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate px-1" title="${workingMembersMap.get(member)}">${ongoingMembers.has(member) ? workingMembersMap.get(member) : '휴식 중'}</div>`;
            } else if (isClockedIn) {
                card.dataset.action = 'member-toggle-leave';
                if (currentUserRole === 'admin' || isSelf) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed', 'opacity-70');
                card.classList.add('bg-green-50', 'dark:bg-green-900/20', 'border-green-200', 'dark:border-green-800');
                card.innerHTML = `<div class="font-extrabold text-sm text-green-700 dark:text-green-400 mb-1">${member}</div><div class="text-[11px] font-bold text-green-600 dark:text-green-500">대기 중</div>`;
            } else if (isReturned) {
                card.dataset.action = 'member-toggle-leave';
                if (currentUserRole === 'admin' || isSelf) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed', 'opacity-60');
                card.classList.add('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-1">${member}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">퇴근 완료</div>`;
            } else {
                card.dataset.action = 'member-toggle-leave';
                card.classList.add('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700', 'text-gray-400', 'dark:text-gray-500', 'opacity-60');
                 if (currentUserRole === 'admin' || isSelf) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed');
                card.innerHTML = `<div class="font-extrabold text-sm mb-1">${member}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">출근 전</div>`;
            }
            groupGrid.appendChild(card);
        });
        groupContainer.appendChild(groupGrid);
        allMembersContainer.appendChild(groupContainer);
    });

    const activePartTimers = (appState.partTimers || []).filter(pt => ongoingMembers.has(pt.name) || onLeaveStatusMap.has(pt.name) || appState.dailyAttendance?.[pt.name]);
    if (activePartTimers.length > 0) {
        const albaContainer = document.createElement('div'); albaContainer.className = 'mb-6'; 
        albaContainer.innerHTML = `<div class="flex items-center gap-2 mb-3 hidden md:flex"><h4 class="text-sm font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider">알바</h4><div class="h-px bg-gray-200 dark:bg-gray-700 flex-grow"></div></div>`;
        const albaGrid = document.createElement('div'); albaGrid.className = 'flex flex-wrap gap-2.5';
        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             const isSelfAlba = (pt.name === currentUserName);
             const visibilityClassAlba = (isSelfAlba || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
             card.className = `p-2 rounded-xl border text-center transition-all min-h-[76px] ${visibilityClassAlba} ${isSelfAlba ? 'w-full md:w-[110px]' : 'w-[110px]'} flex-col justify-center shadow-sm`;
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = workingMembersMap.has(pt.name) || pausedMembers.has(pt.name);
             const albaAttendance = appState.dailyAttendance?.[pt.name];
             const isAlbaClockedIn = albaAttendance && albaAttendance.status === 'active';
             const isAlbaReturned = albaAttendance && albaAttendance.status === 'returned';

            card.dataset.memberName = pt.name;
            if (isAlbaOnLeave) {
                card.dataset.action = 'member-toggle-leave'; card.dataset.leaveType = albaLeaveInfo.type; card.dataset.startTime = albaLeaveInfo.startTime || ''; card.dataset.startDate = albaLeaveInfo.startDate || ''; card.dataset.endTime = albaLeaveInfo.endTime || ''; card.dataset.endDate = albaLeaveInfo.endDate || '';
                card.classList.add('bg-gray-100', 'dark:bg-gray-700', 'border-gray-300', 'dark:border-gray-600', 'text-gray-500', 'dark:text-gray-400');
                if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed');
                const displayLabel = getLeaveDisplayLabel(pt.name, albaLeaveInfo);
                let detailText = albaLeaveInfo.startTime ? formatTimeTo24H(albaLeaveInfo.startTime) + (albaLeaveInfo.endTime ? ` - ${formatTimeTo24H(albaLeaveInfo.endTime)}` : (albaLeaveInfo.type === '외출' ? ' ~' : '')) : (albaLeaveInfo.startDate ? albaLeaveInfo.startDate.substring(5) + (albaLeaveInfo.endDate && albaLeaveInfo.endDate !== albaLeaveInfo.startDate ? ` ~ ${albaLeaveInfo.endDate.substring(5)}` : '') : '');
                card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-0.5">${pt.name}</div><div class="text-[11px] font-bold text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded inline-block">${displayLabel}</div>${detailText ? `<div class="text-[10px] mt-1 text-gray-400 dark:text-gray-500">${detailText}</div>` : ''}`;
            } else if (isAlbaWorking) {
                card.dataset.action = 'member-toggle-leave';
                card.classList.add('opacity-80', 'cursor-not-allowed', ongoingMembers.has(pt.name) ? 'bg-red-50 dark:bg-red-900/20' : 'bg-yellow-50 dark:bg-yellow-900/20', ongoingMembers.has(pt.name) ? 'border-red-200 dark:border-red-800' : 'border-yellow-200 dark:border-yellow-800');
                card.innerHTML = `<div class="font-extrabold text-sm ${ongoingMembers.has(pt.name) ? 'text-red-700 dark:text-red-400' : 'text-yellow-700 dark:text-yellow-400'} mb-1">${pt.name}</div><div class="text-[10px] font-bold ${ongoingMembers.has(pt.name) ? 'text-red-500 dark:text-red-500' : 'text-yellow-600 dark:text-yellow-500'} truncate px-1">${ongoingMembers.has(pt.name) ? workingMembersMap.get(pt.name) : '휴식 중'}</div>`;
            } else if (isAlbaClockedIn) {
                 card.dataset.action = 'member-toggle-leave';
                 if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed', 'opacity-70');
                 card.classList.add('bg-green-50', 'dark:bg-green-900/20', 'border-green-200', 'dark:border-green-800');
                 card.innerHTML = `<div class="font-extrabold text-sm text-green-700 dark:text-green-400 mb-1">${pt.name}</div><div class="text-[11px] font-bold text-green-600 dark:text-green-500">대기 중</div>`;
            } else if (isAlbaReturned) {
                 card.dataset.action = 'member-toggle-leave';
                 if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed', 'opacity-60');
                 card.classList.add('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
                 card.innerHTML = `<div class="font-extrabold text-sm text-gray-600 dark:text-gray-300 mb-1">${pt.name}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">퇴근 완료</div>`;
            } else {
                 card.dataset.action = 'member-toggle-leave';
                 card.classList.add('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700', 'text-gray-400', 'dark:text-gray-500', 'opacity-60');
                 if (currentUserRole === 'admin' || isSelfAlba) card.classList.add('cursor-pointer', 'hover:border-blue-400', 'dark:hover:border-blue-500'); else card.classList.add('cursor-not-allowed');
                 card.innerHTML = `<div class="font-extrabold text-sm mb-1">${pt.name}</div><div class="text-[11px] font-medium text-gray-400 dark:text-gray-500">출근 전</div>`;
            }
             albaGrid.appendChild(card);
        });
        albaContainer.appendChild(albaGrid); allMembersContainer.appendChild(albaContainer);
    }
    teamStatusBoard.appendChild(allMembersContainer);

    renderAttendanceToggle(appState);
};

// 4. 완료된 업무 렌더링 (다크 모드 적용)
export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = '';

    const allRecords = appState.workRecords || [];
    const completedRecords = allRecords.filter(r => r.status === 'completed');

    if (completedRecords.length === 0) {
        workLogBody.innerHTML = `<div class="text-center py-10 text-gray-400 dark:text-gray-500 text-sm font-medium">오늘 완료된 업무가 없습니다.</div>`;
        return;
    }

    // 최신 완료순 정렬
    completedRecords.sort((a, b) => (b.endTime || '').localeCompare(a.endTime || ''));

    completedRecords.forEach(record => {
        const item = document.createElement('div');
        item.className = 'bg-white dark:bg-gray-800 p-3.5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm mb-2.5 hover:border-blue-300 dark:hover:border-blue-500 transition-colors relative group';
        
        const pauseMin = calcTotalPauseMinutes(record.pauses);
        const pauseText = pauseMin > 0 ? `<span class="text-[10px] text-gray-400 dark:text-gray-500 ml-1 font-normal">(휴:${formatDuration(pauseMin)} 포함)</span>` : '';
        
        item.innerHTML = `
            <div class="flex justify-between items-center mb-1.5">
                <span class="font-extrabold text-sm text-gray-800 dark:text-gray-200">${record.task}</span>
                <span class="text-[11px] font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 px-2 py-0.5 rounded-md shadow-sm">${formatDuration(record.duration)}</span>
            </div>
            <div class="flex justify-between items-center text-xs text-gray-500 dark:text-gray-400 font-medium">
                <div class="flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full"></span>
                    ${record.member}
                </div>
                <div>${formatTimeTo24H(record.startTime)} ~ ${formatTimeTo24H(record.endTime)}${pauseText}</div>
            </div>
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-white/95 dark:bg-gray-800/95 backdrop-blur px-1.5 py-1 rounded-md shadow-sm border border-gray-100 dark:border-gray-700 flex gap-3">
                <button data-action="edit" data-record-id="${record.id}" class="text-[11px] text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 font-bold tracking-wide">수정</button>
                <div class="w-px bg-gray-200 dark:bg-gray-600"></div>
                <button data-action="delete" data-record-id="${record.id}" class="text-[11px] text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 font-bold tracking-wide">삭제</button>
            </div>
        `;
        workLogBody.appendChild(item);
    });
};