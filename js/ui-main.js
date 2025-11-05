// === ui-main.js (실시간 반영 수정 버전) ===

import { formatTimeTo24H, formatDuration, calcElapsedMinutes, getCurrentTime, isWeekday } from './utils.js';
// ✅ [추가] ui.js에서 공유 상수/헬퍼 가져오기
import { getAllDashboardDefinitions, taskCardStyles, taskTitleColors } from './ui.js';

/**
 * ✅ [수정] renderTaskAnalysis (실시간 반영)
 * - 완료된 업무뿐만 아니라 진행 중/일시정지 업무 시간도 포함하여 분석합니다.
 */
export const renderTaskAnalysis = (appState, appConfig) => {
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; 
    
    // [수정] 모든 유효한 업무 기록 가져오기
    const allRecords = (appState.workRecords || []).filter(r => ['completed', 'ongoing', 'paused'].includes(r.status));
    
    if (allRecords.length === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">기록된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};

    const now = getCurrentTime();
    let totalLoggedMinutes = 0;
    let totalBreakMinutes = 0;

    // [수정] 업무별 시간 집계 (실시간 반영)
    const taskAnalysis = allRecords.reduce((acc, record) => {
        if (record && record.task) {
            let duration = record.duration || 0;
            // 진행 중이거나 일시정지인 경우 실시간 계산
            if (record.status === 'ongoing' || record.status === 'paused') {
                duration = calcElapsedMinutes(record.startTime, now, record.pauses);
            }
            acc[record.task] = (acc[record.task] || 0) + duration;
            totalLoggedMinutes += duration;
        }

        // 휴식 시간 집계
        (record.pauses || []).forEach(pause => {
            if (pause.start && (pause.type === 'break' || !pause.type)) {
                const end = pause.end || now; // 진행 중인 휴식은 현재 시간까지로 계산
                const s = new Date(`1970-01-01T${pause.start}:00Z`).getTime();
                const e = new Date(`1970-01-01T${end}:00Z`).getTime();
                if (e > s) {
                    totalBreakMinutes += (e - s) / 60000;
                }
            }
        });

        return acc;
    }, {});

    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow max-h-72 overflow-y-auto pr-2">';

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

    // 개인별 통계 드롭다운 채우기
    const memberSelect = document.getElementById('analysis-member-select');
    if (memberSelect) {
        const staff = (appConfig.teamGroups || []).flatMap(g => g.members);
        const partTimers = (appState.partTimers || []).map(p => p.name);
        const allMembers = [...new Set([...staff, ...partTimers])].sort((a, b) => a.localeCompare(b));
        
        // 현재 선택된 값 유지
        const currentValue = memberSelect.value;
        let optionsHtml = '<option value="">--- 직원/알바 선택 ---</option>';
        allMembers.forEach(member => {
            const isSelected = member === currentValue ? 'selected' : '';
            optionsHtml += `<option value="${member}" ${isSelected}>${member}</option>`;
        });
        memberSelect.innerHTML = optionsHtml;
    }
};

/**
 * ✅ [수정] renderPersonalAnalysis
 * (기존 로직 유지, 이미 실시간 반영되어 있음)
 */
export const renderPersonalAnalysis = (selectedMember, appState) => {
    const container = document.getElementById('analysis-personal-stats-container');
    if (!container) return;

    if (!selectedMember) {
        container.innerHTML = `<p class="text-center text-gray-500">통계를 보려면 위에서 직원을 선택하세요.</p>`;
        return;
    }

    const memberRecords = (appState.workRecords || []).filter(
        r => r.member === selectedMember
    );

    if (memberRecords.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500">${selectedMember} 님은 오늘 업무 기록이 없습니다.</p>`;
        return;
    }

    const now = getCurrentTime(); 

    const ongoingRecord = memberRecords.find(r => r.status === 'ongoing');
    const pausedRecord = memberRecords.find(r => r.status === 'paused');
    let currentStatusHtml = '';
    
    if (ongoingRecord) {
        currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-red-600">업무 중: ${ongoingRecord.task}</span>`;
    } else if (pausedRecord) {
        currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-yellow-600">휴식 중</span>`;
    } else {
        const combinedOnLeaveMembers = [
            ...(appState.dailyOnLeaveMembers || []),
            ...(appState.dateBasedOnLeaveMembers || [])
        ];
        const leaveInfo = combinedOnLeaveMembers.find(m => m.member === selectedMember && !(m.type === '외출' && m.endTime));
        
        if (leaveInfo) {
             currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-gray-600">${leaveInfo.type} 중</span>`;
        } else {
             currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-green-600">대기 중</span>`;
        }
    }

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

    if (ongoingRecord || pausedRecord) {
        lastEffectiveEndTime = now;
    }

    let totalTimeSpanMinutes = 0;
    if (firstStartTime && lastEffectiveEndTime) {
        totalTimeSpanMinutes = calcElapsedMinutes(firstStartTime, lastEffectiveEndTime, []); 
    }

    const totalNonWorkMinutes = Math.max(0, totalTimeSpanMinutes - totalLiveMinutes);

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
            if (minutes > 0) {
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

    html += `</ul></div>`;
    container.innerHTML = html;
};

/**
 * ✅ [수정] renderRealtimeStatus
 * (기존 로직 유지)
 */
export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = [], isMobileTaskViewExpanded = false, isMobileMemberViewExpanded = false) => {
    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;

    const teamStatusBoard = document.getElementById('team-status-board');
    if (!teamStatusBoard) return;
    teamStatusBoard.innerHTML = '';

    // --- 상단: 주요 업무 카드 섹션 ---
    const presetTaskContainer = document.createElement('div');
    presetTaskContainer.className = 'mb-6';
    presetTaskContainer.innerHTML = `
        <div class="flex justify-end items-center border-b pb-2 mb-4 md:hidden">
            <button id="toggle-all-tasks-mobile" class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">
                ${isMobileTaskViewExpanded ? '간략히' : '전체보기'}
            </button>
        </div>`;

    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4';
    presetGrid.id = 'preset-task-grid';
    if (isMobileTaskViewExpanded) presetGrid.classList.add('mobile-expanded');

    const baseTasks = keyTasks.length > 0 ? keyTasks : ['국내배송', '중국제작', '직진배송', '채우기', '개인담당업무'];
    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const activeTaskNames = new Set(ongoingRecords.map(r => r.task));
    const tasksToRender = [...new Set([...baseTasks, ...activeTaskNames])];

    tasksToRender.forEach(task => {
        const card = document.createElement('div');
        const groupRecords = ongoingRecords.filter(r => r.task === task);
        const isCurrentUserWorkingOnThisTask = groupRecords.some(r => r.member === currentUserName);
        const isPaused = groupRecords.length > 0 && groupRecords.every(r => r.status === 'paused');
        const isOngoing = groupRecords.some(r => r.status === 'ongoing');

        let currentStyle = isPaused ? taskCardStyles['paused'] : (isOngoing || groupRecords.length > 0 ? taskCardStyles['ongoing'] : taskCardStyles['default']);
        const titleClass = isPaused ? currentStyle.title : (taskTitleColors[task] || taskTitleColors['default']);
        const mobileVisibilityClass = (isCurrentUserWorkingOnThisTask || isMobileTaskViewExpanded) ? 'flex' : 'hidden md:flex mobile-task-hidden';

        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 ${currentStyle.card.join(' ')} ${currentStyle.hover} cursor-pointer`;
            card.dataset.groupId = firstRecord.groupId;
            card.dataset.task = firstRecord.task;

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-64 members-list">';
            groupRecords.sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(rec => {
                const isRecPaused = rec.status === 'paused';
                const memberTextColor = isRecPaused ? 'text-yellow-800' : 'text-gray-800';
                const timeTextColor = isRecPaused ? 'text-yellow-600' : 'text-gray-500';
                const memberRowBg = isRecPaused ? 'bg-yellow-50 hover:bg-yellow-100' : 'hover:bg-gray-50';
                const pauseIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5" /></svg>`;
                const playIcon = `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M5.25 5.25l14.25 6.75-14.25 6.75V5.25z" /></svg>`;
                
                let pauseResumeButtonHtml = '';
                if (rec.status === 'ongoing') {
                    pauseResumeButtonHtml = `<button data-action="pause-individual" title="정지" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-yellow-100 hover:bg-yellow-200 text-yellow-700 transition">${pauseIcon}</button>`;
                } else if (rec.status === 'paused') {
                    pauseResumeButtonHtml = `<button data-action="resume-individual" title="재개" data-record-id="${rec.id}" class="w-7 h-7 flex items-center justify-center rounded-full bg-green-100 hover:bg-green-200 text-green-700 transition">${playIcon}</button>`;
                }
                
                membersHtml += `
                <div class="text-sm ${memberRowBg} rounded p-1 group flex justify-between items-center member-row" data-record-id="${rec.id}" data-group-id="${rec.groupId || ''}">
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
            });
            membersHtml += '</div>';

            const earliestStartTime = groupRecords.reduce((earliest, current) => ((current.startTime && (!earliest || current.startTime < earliest)) ? current.startTime : earliest), null);
            const representativeRecord = groupRecords.find(r => r.startTime === earliestStartTime) || groupRecords[0];
            const pausesJson = JSON.stringify(representativeRecord.pauses || []);
            const durationStatus = isOngoing ? 'ongoing' : 'paused';
            const stopBtnClass = `bg-red-600 hover:bg-red-700 text-white`;

            card.innerHTML = `<div class="flex flex-col h-full">
                                <div class="font-bold text-lg ${titleClass} break-keep">${firstRecord.task} ${isPaused ? ' (일시정지)' : ''}</div>
                                <div class="text-xs ${currentStyle.subtitle} my-2 cursor-pointer group-time-display" data-action="edit-group-start-time" data-group-id="${firstRecord.groupId}" data-current-start-time="${earliestStartTime || ''}">
                                    시작: ${formatTimeTo24H(earliestStartTime)} 
                                    <span class="ongoing-duration" data-start-time="${earliestStartTime || ''}" data-status="${durationStatus}" data-record-id="${representativeRecord.id || ''}" data-pauses-json='${pausesJson}'></span>
                                </div>
                                <div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">${groupRecords.length}명 참여중:</div>
                                <div class="flex-grow">${membersHtml}</div>
                                <div class="mt-3 border-t border-gray-300/60 pt-3 flex gap-2 card-actions" data-group-id="${firstRecord.groupId}" data-task="${firstRecord.task}">
                                    <button data-group-id="${firstRecord.groupId}" class="${isPaused ? 'resume-work-group-btn bg-green-500 hover:bg-green-600' : 'pause-work-group-btn bg-yellow-500 hover:bg-yellow-600'} flex-1 text-white rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center">
                                        ${isPaused ? '전체 재개' : '전체 정지'}
                                    </button>
                                    <button data-group-id="${firstRecord.groupId}" class="stop-work-group-btn ${stopBtnClass} flex-1 text-white rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center">전체 종료</button>
                                </div>
                            </div>`;
        } else {
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')} ${currentStyle.hover}`;
            card.dataset.action = 'start-task';
            card.dataset.task = task;
            card.innerHTML = `<div class="flex-grow"><div class="font-bold text-lg ${titleClass} break-keep">${task}</div><div class="text-xs ${currentStyle.subtitle} my-2">시작: 시작 전</div><div class="font-semibold ${currentStyle.subtitle} text-sm mb-1">참여 인원 (0명):</div><div class="text-xs ${currentStyle.subtitle} italic flex-grow flex items-center justify-center text-center">카드를 클릭하여 팀원 선택</div></div><div class="mt-3 border-t border-gray-300/60 pt-3 flex gap-2"><div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center opacity-50 cursor-not-allowed"><span>전체 정지</span></div><div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 rounded-md transition text-xs font-semibold py-1.5 px-1 shadow-sm text-center opacity-50 cursor-not-allowed"><span>전체 종료</span></div></div>`;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    otherTaskCard.className = `p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-all duration-200 cursor-pointer ${taskCardStyles['default'].card.join(' ')} ${taskCardStyles['default'].hover}`;
    otherTaskCard.dataset.action = 'other';
    otherTaskCard.innerHTML = `<div class="font-bold text-lg text-gray-700">기타 업무</div><svg xmlns="http://www.w3.org/2000/svg" class="h-10 w-10 text-gray-400 mt-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg><div class="text-xs text-gray-500 mt-3">새로운 업무 시작</div>`;
    presetGrid.appendChild(otherTaskCard);
    presetTaskContainer.appendChild(presetGrid);
    teamStatusBoard.appendChild(presetTaskContainer);

    // --- 하단: 전체 팀원 현황 섹션 ---
    const allMembersContainer = document.createElement('div');
    allMembersContainer.id = 'all-members-container';
    if (isMobileMemberViewExpanded) allMembersContainer.classList.add('mobile-expanded');
    allMembersContainer.innerHTML = `
        <div class="flex justify-between items-center border-b pb-2 mb-4 mt-8">
            <h3 class="text-lg font-bold text-gray-700 hidden md:block">전체 팀원 현황 (클릭하여 근태 설정/취소/수정)</h3>
            <h3 class="text-lg font-bold text-gray-700 md:hidden">팀원 현황</h3>
            <button id="toggle-all-members-mobile" class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">${isMobileMemberViewExpanded ? '간략히' : '전체보기'}</button>
        </div>`;

    const workingMembers = new Map(ongoingRecords.filter(r => r.status === 'ongoing').map(r => [r.member, r.task]));
    const pausedMembersMap = new Map(ongoingRecords.filter(r => r.status === 'paused').map(r => [r.member, r.task]));
    const combinedOnLeave = [...(appState.dailyOnLeaveMembers || []), ...(appState.dateBasedOnLeaveMembers || [])];
    const onLeaveMap = new Map(combinedOnLeave.filter(i => !(i.type === '외출' && i.endTime)).map(i => [i.member, i]));
    
    const orderedGroups = [
        teamGroups.find(g => g.name === '관리'),
        teamGroups.find(g => g.name === '공통파트'),
        teamGroups.find(g => g.name === '담당파트'),
        teamGroups.find(g => g.name === '제작파트')
    ].filter(Boolean);

    orderedGroups.forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.className = 'mb-4';
        groupEl.innerHTML = `<div class="flex items-center gap-2 mb-2 hidden md:flex"><h4 class="text-md font-semibold text-gray-600">${group.name}</h4></div>`;
        const grid = document.createElement('div');
        grid.className = 'flex flex-wrap gap-2';
        [...new Set(group.members)].forEach(member => {
            const leave = onLeaveMap.get(member);
            const isWorking = workingMembers.has(member) || pausedMembersMap.has(member);
            const isSelf = (member === currentUserName);
            const visibility = (isSelf || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
            const width = isSelf ? 'w-full md:w-28' : 'w-28';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibility} ${width} flex-col justify-center`;
            btn.dataset.memberName = member;

            if (leave) {
                btn.dataset.action = 'edit-leave-record';
                btn.dataset.leaveType = leave.type;
                btn.dataset.startTime = leave.startTime || '';
                btn.dataset.startDate = leave.startDate || '';
                btn.dataset.endTime = leave.endTime || '';
                btn.dataset.endDate = leave.endDate || '';
                btn.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500', (currentUserRole === 'admin' || isSelf) ? 'cursor-pointer hover:shadow-md' : 'cursor-not-allowed opacity-70');
                let detail = '';
                if (leave.startTime) {
                    detail = formatTimeTo24H(leave.startTime) + (leave.endTime ? ` - ${formatTimeTo24H(leave.endTime)}` : (leave.type === '외출' ? ' ~' : ''));
                } else if (leave.startDate) {
                    detail = leave.startDate.substring(5) + (leave.endDate && leave.endDate !== leave.startDate ? ` ~ ${leave.endDate.substring(5)}` : '');
                }
                btn.innerHTML = `<div class="font-semibold text-sm break-keep">${member}</div><div class="text-xs">${leave.type}</div>${detail ? `<div class="text-[10px] leading-tight mt-0.5">${detail}</div>` : ''}`;
            } else {
                btn.dataset.action = 'member-toggle-leave';
                if (workingMembers.has(member)) {
                    btn.classList.add('bg-red-50', 'border-red-200', 'opacity-70', 'cursor-not-allowed');
                    btn.innerHTML = `<div class="font-semibold text-sm text-red-800 break-keep">${member}</div><div class="text-xs text-gray-600 truncate" title="${workingMembers.get(member)}">${workingMembers.get(member)}</div>`;
                } else if (pausedMembersMap.has(member)) {
                    btn.classList.add('bg-yellow-50', 'border-yellow-200', 'opacity-70', 'cursor-not-allowed');
                    btn.innerHTML = `<div class="font-semibold text-sm text-yellow-800 break-keep">${member}</div><div class="text-xs text-yellow-600">휴식 중</div>`;
                } else {
                    btn.classList.add('bg-green-50', 'border-green-200', (currentUserRole === 'admin' || isSelf) ? 'cursor-pointer hover:shadow-md hover:ring-2 hover:ring-blue-400' : 'cursor-not-allowed opacity-70');
                    btn.innerHTML = `<div class="font-semibold text-sm text-green-800 break-keep">${member}</div><div class="text-xs text-green-600">대기 중</div>`;
                }
            }
            grid.appendChild(btn);
        });
        groupEl.appendChild(grid);
        allMembersContainer.appendChild(groupEl);
    });

    // 알바 섹션
    const activeAlbas = (appState.partTimers || []).filter(pt => workingMembers.has(pt.name) || pausedMembersMap.has(pt.name) || onLeaveMap.has(pt.name));
    if (activeAlbas.length > 0) {
        const albaEl = document.createElement('div');
        albaEl.className = 'mb-4';
        albaEl.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2 hidden md:block">알바</h4>`;
        const grid = document.createElement('div');
        grid.className = 'flex flex-wrap gap-2';
        activeAlbas.forEach(pt => {
            const leave = onLeaveMap.get(pt.name);
            const isSelf = (pt.name === currentUserName);
            const visibility = (isSelf || isMobileMemberViewExpanded) ? 'flex' : 'hidden md:flex mobile-member-hidden';
            const width = isSelf ? 'w-full md:w-28' : 'w-28';
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibility} ${width} flex-col justify-center`;
            btn.dataset.memberName = pt.name;

            if (leave) {
                btn.dataset.action = 'edit-leave-record';
                btn.dataset.leaveType = leave.type;
                btn.dataset.startTime = leave.startTime || '';
                btn.dataset.startDate = leave.startDate || '';
                btn.dataset.endTime = leave.endTime || '';
                btn.dataset.endDate = leave.endDate || '';
                btn.classList.add('bg-gray-200', 'border-gray-300', 'text-gray-500', (currentUserRole === 'admin' || isSelf) ? 'cursor-pointer hover:shadow-md' : 'cursor-not-allowed opacity-70');
                let detail = '';
                if (leave.startTime) {
                    detail = formatTimeTo24H(leave.startTime) + (leave.endTime ? ` - ${formatTimeTo24H(leave.endTime)}` : (leave.type === '외출' ? ' ~' : ''));
                } else if (leave.startDate) {
                    detail = leave.startDate.substring(5) + (leave.endDate && leave.endDate !== leave.startDate ? ` ~ ${leave.endDate.substring(5)}` : '');
                }
                btn.innerHTML = `<div class="font-semibold text-sm break-keep">${pt.name}</div><div class="text-xs">${leave.type}</div>${detail ? `<div class="text-[10px] leading-tight mt-0.5">${detail}</div>` : ''}`;
            } else {
                btn.dataset.action = 'member-toggle-leave';
                if (workingMembers.has(pt.name)) {
                    btn.classList.add('bg-red-50', 'border-red-200', 'opacity-70', 'cursor-not-allowed');
                    btn.innerHTML = `<div class="font-semibold text-sm text-red-800">${pt.name}</div><div class="text-xs text-gray-600 truncate" title="${workingMembers.get(pt.name)}">${workingMembers.get(pt.name)}</div>`;
                } else if (pausedMembersMap.has(pt.name)) {
                    btn.classList.add('bg-yellow-50', 'border-yellow-200', 'opacity-70', 'cursor-not-allowed');
                    btn.innerHTML = `<div class="font-semibold text-sm text-yellow-800">${pt.name}</div><div class="text-xs text-yellow-600">휴식 중</div>`;
                }
            }
            grid.appendChild(btn);
        });
        albaEl.appendChild(grid);
        allMembersContainer.appendChild(albaEl);
    }

    teamStatusBoard.appendChild(allMembersContainer);
};

/**
 * ✅ [수정] renderCompletedWorkLog (실시간 반영)
 * - 완료된 업무뿐만 아니라 진행 중/일시정지 업무도 리스트에 표시합니다.
 */
export const renderCompletedWorkLog = (appState) => {
    const workLogBody = document.getElementById('work-log-body');
    if (!workLogBody) return;
    workLogBody.innerHTML = '';
    
    // [수정] 완료된 업무뿐만 아니라 진행 중/휴식 중 업무도 포함
    const allRecords = (appState.workRecords || []).filter(r => ['completed', 'ongoing', 'paused'].includes(r.status));

    if (!allRecords || allRecords.length === 0) {
        workLogBody.innerHTML = `<tr><td colspan="6" class="text-center py-12 text-gray-400">기록된 업무가 없습니다.</td></tr>`;
        return;
    }

    const groupedRecords = allRecords.reduce((acc, record) => {
        if (!acc[record.task]) acc[record.task] = [];
        acc[record.task].push(record);
        return acc;
    }, {});
    const sortedTasks = Object.keys(groupedRecords).sort();

    const now = getCurrentTime();

    sortedTasks.forEach(task => {
        const groupHeaderRow = document.createElement('tr');
        groupHeaderRow.className = 'bg-gray-100';
        groupHeaderRow.innerHTML = `<th colspan="6" class="px-6 py-3 text-left text-base text-blue-700 font-bold">${task}</th>`;
        workLogBody.appendChild(groupHeaderRow);
        
        groupedRecords[task].sort((a,b) => (a.startTime || '').localeCompare(b.startTime || '')).forEach(record => {
            const row = document.createElement('tr');
            let rowBg = 'bg-white hover:bg-gray-50';
            let endTimeDisplay = formatTimeTo24H(record.endTime);
            let durationDisplay = formatDuration(record.duration);
            let actionButtons = '';

            // [수정] 상태별 표시 분기
            if (record.status === 'ongoing') {
                rowBg = 'bg-red-50 hover:bg-red-100';
                endTimeDisplay = '<span class="text-red-600 font-semibold animate-pulse">진행 중</span>';
                const currentDuration = calcElapsedMinutes(record.startTime, now, record.pauses);
                durationDisplay = `<span class="text-red-600 font-semibold">${formatDuration(currentDuration)}</span>`;
            } else if (record.status === 'paused') {
                rowBg = 'bg-yellow-50 hover:bg-yellow-100';
                endTimeDisplay = '<span class="text-yellow-600 font-semibold">휴식 중</span>';
                const currentDuration = calcElapsedMinutes(record.startTime, now, record.pauses);
                durationDisplay = `<span class="text-yellow-600 font-semibold">${formatDuration(currentDuration)}</span>`;
            } else {
                // 완료된 업무는 수정/삭제 버튼 표시
                actionButtons = `<button data-action="edit" data-record-id="${record.id}" class="font-medium text-blue-500 hover:underline mr-2">수정</button>
                                 <button data-action="delete" data-record-id="${record.id}" class="font-medium text-red-500 hover:underline">삭제</button>`;
            }

            row.className = `${rowBg} border-b border-gray-200`;
            row.innerHTML = `
                <td class="px-6 py-4 font-medium text-gray-900">${record.member || 'N/A'}</td>
                <td class="px-6 py-4">${record.task || 'N/A'}</td>
                <td class="px-6 py-4">${formatTimeTo24H(record.startTime)}</td>
                <td class="px-6 py-4">${endTimeDisplay}</td>
                <td class="px-6 py-4">${durationDisplay}</td>
                <td class="px-6 py-4 text-right">${actionButtons}</td>
            `;
            workLogBody.appendChild(row);
        });
    });
};

/**
 * ✅ [수정] renderDashboardLayout
 * (기존 로직 유지)
 */
export const renderDashboardLayout = (appConfig) => {
    const container = document.getElementById('summary-content');
    if (!container) return;

    const itemIds = appConfig.dashboardItems || [];
    const allDefinitions = getAllDashboardDefinitions(appConfig);

    container.innerHTML = '';
    let html = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) return;
        const isQuantity = def.isQuantity === true;
        html += `
            <div class="dashboard-card p-4 rounded-lg ${isQuantity ? 'dashboard-card-quantity' : ''}">
                <h4 class="text-sm font-bold uppercase tracking-wider">${def.title}</h4>
                <p id="${def.valueId}">0</p>
            </div>
        `;
    });
    container.innerHTML = html;
};

/**
 * ✅ [수정] updateSummary
 * (기존 로직 유지, workingPartTimerCount 정의 추가)
 */
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

    const combinedOnLeave = [...(appState.dailyOnLeaveMembers || []), ...(appState.dateBasedOnLeaveMembers || [])];
    const onLeaveNames = new Set(combinedOnLeave.filter(i => !(i.type === '외출' && i.endTime)).map(i => i.member));
    const onLeaveTotalCount = onLeaveNames.size;

    const ongoingMembers = new Set((appState.workRecords || []).filter(r => r.status === 'ongoing').map(r => r.member));
    const pausedMembers = new Set((appState.workRecords || []).filter(r => r.status === 'paused').map(r => r.member));

    const workingStaffCount = [...ongoingMembers].filter(m => allStaffMembers.has(m)).length;
    // [수정] 누락되었던 변수 정의 추가
    const workingPartTimerCount = [...ongoingMembers].filter(m => allPartTimers.has(m)).length;
    const totalWorkingCount = ongoingMembers.size;

    const availableStaffCount = totalStaffCount - [...onLeaveNames].filter(m => allStaffMembers.has(m)).length;
    const availablePartTimerCount = totalPartTimerCount - [...onLeaveNames].filter(m => allPartTimers.has(m)).length;
    
    const pausedStaffCount = [...pausedMembers].filter(m => allStaffMembers.has(m)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(m => allPartTimers.has(m)).length;
    
    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingTaskCount = new Set((appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused').map(r => r.task)).size;

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    const quantities = appState.taskQuantities || {};
    const map = appConfig.quantityToDashboardMap || {};
    for (const task in quantities) {
        const targetId = map[task];
        if (targetId && elements[targetId]) elements[targetId].textContent = quantities[task] || 0;
    }
};