// === ui-main.js (메인 화면 렌더링 담당, 오류 수정 버전) ===

import { formatTimeTo24H, formatDuration, calcElapsedMinutes, getCurrentTime, isWeekday } from './utils.js';
// ❗️ [수정] import 경로 변경 (ui.js -> ui-shared.js)
import { getAllDashboardDefinitions, taskCardStyles, taskTitleColors } from './ui-shared.js';

/**
 * ✅ [수정] renderTaskAnalysis (ui.js -> ui-main.js)
 */
export const renderTaskAnalysis = (appState, appConfig) => {
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; 
    
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    // ❗️ [추가] 실시간 분석을 위해 진행중/휴식중인 기록도 포함
    const now = getCurrentTime();
    const liveRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    
    let totalLoggedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0);
    
    const taskAnalysis = completedRecords.reduce((acc, record) => {
        if (record && record.task) {
            acc[record.task] = (acc[record.task] || 0) + (record.duration || 0);
        }
        return acc;
    }, {});

    // ❗️ [추가] 진행중/휴식중인 기록의 시간을 실시간으로 합산
    liveRecords.forEach(record => {
        if (record && record.task) {
            const liveDuration = calcElapsedMinutes(record.startTime, now, record.pauses);
            taskAnalysis[record.task] = (taskAnalysis[record.task] || 0) + liveDuration;
            totalLoggedMinutes += liveDuration;
        }
    });
    // ❗️ [추가 끝]

    if (totalLoggedMinutes === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">업무 기록이 없어 분석을 시작할 수 없습니다.</div>`;
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};

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
        // ❗️ [수정] 0분 이상인 항목만 범례에 표시
        if (minutes > 0.1) {
            legendHTML += `<div class="flex items-center justify-between mb-2"><div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background-color: ${color};"></span><span class="font-semibold text-gray-700">${task}</span></div><div class="text-right"><div class="text-sm font-semibold text-gray-800">${formatDuration(minutes)}</div><div class="text-xs text-gray-500">${percentage.toFixed(1)}%</div></div></div>`;
        }
    });
    legendHTML += '</div>';

    const finalGradient = `conic-gradient(${gradientParts.join(', ')})`;
    
    // ❗️ [수정] 실시간 휴식 시간 계산 (진행중/휴식중인 기록 모두 포함)
    let totalBreakMinutes = 0;
    (appState.workRecords || []).forEach(record => {
        // 1. 완료된 기록의 휴식시간
        (record.pauses || []).forEach(pause => {
            if (pause.start && pause.end && (pause.type === 'break' || !pause.type)) { 
                totalBreakMinutes += calcElapsedMinutes(pause.start, pause.end, []);
            }
        });
        
        // 2. 현재 휴식중인 기록의 휴식시간 (실시간)
        if (record.status === 'paused') {
            const lastPause = record.pauses?.[record.pauses.length - 1];
            if (lastPause && lastPause.start && !lastPause.end) {
                totalBreakMinutes += calcElapsedMinutes(lastPause.start, now, []);
            }
        }
    });
    // ❗️ [수정 끝]
    
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
 * ✅ [수정] renderPersonalAnalysis (ui.js -> ui-main.js)
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
            // ❗️ [수정] 휴식중인 기록도 calcElapsedMinutes를 사용해야 함 (기존 로직이 맞음)
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

    // ❗️ [수정] 비업무 시간 계산 시, 현재 '휴식 중'인 시간은 제외
    let currentPauseMinutes = 0;
    if (pausedRecord) {
        const lastPause = pausedRecord.pauses?.[pausedRecord.pauses.length - 1];
        if (lastPause && lastPause.start && !lastPause.end) {
            currentPauseMinutes = calcElapsedMinutes(lastPause.start, now, []);
        }
    }
    const totalNonWorkMinutes = Math.max(0, totalTimeSpanMinutes - totalLiveMinutes - currentPauseMinutes);
    // ❗️ [수정 끝]

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

    html += `
            </ul>
        </div>
    `;

    container.innerHTML = html;
};

/**
 * ✅ [수정] renderRealtimeStatus (ui.js -> ui-main.js)
 */
export const renderRealtimeStatus = (appState, teamGroups = [], keyTasks = []) => {
    const currentUserRole = appState.currentUserRole || 'user';
    const currentUserName = appState.currentUser || null;

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
    
    presetTaskContainer.innerHTML = `
        <div class="flex justify-end items-center border-b pb-2 mb-4 md:hidden">
            <button id="toggle-all-tasks-mobile" 
                    class="md:hidden bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold text-xs py-1 px-2 rounded-md transition active:scale-[0.98]">
                전체보기
            </button>
        </div>`;

    const presetGrid = document.createElement('div');
    presetGrid.className = 'grid grid-cols-1 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4';
    presetGrid.id = 'preset-task-grid';

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

        let currentStyle;
        if (isPaused) {
            currentStyle = taskCardStyles['paused'];
        } else if (isOngoing || groupRecords.length > 0) {
            currentStyle = taskCardStyles['ongoing'];
        } else {
            currentStyle = taskCardStyles['default'];
        }

        const titleClass = isPaused ? currentStyle.title : (taskTitleColors[task] || taskTitleColors['default']);

        const mobileVisibilityClass = isCurrentUserWorkingOnThisTask ? 'flex' : 'hidden md:flex mobile-task-hidden';
        
        card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 ${currentStyle.card.join(' ')}`;
        // ❗️ [수정] hover 효과는 CSS(style.css)로 이동하거나, JavaScript에서 동적으로 관리해야 함.
        // 여기서는 JS 기반 hover를 제거하여 CSS가 동작하도록 함.
        // ${currentStyle.hover} 제거


        if (groupRecords.length > 0) {
            const firstRecord = groupRecords[0];

            let membersHtml = '<div class="space-y-1 overflow-y-auto max-h-48 members-list">';
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

                // ❗️ [추가] 휴식 중인 경우, 휴식 시간 표시
                let pauseDurationHtml = '';
                if (isRecPaused) {
                    const lastPause = rec.pauses?.[rec.pauses.length - 1];
                    if (lastPause && lastPause.start && !lastPause.end) {
                        const pauseMinutes = calcElapsedMinutes(lastPause.start, getCurrentTime(), []);
                        if (pauseMinutes > 0) {
                            pauseDurationHtml = `<span class="text-xs text-yellow-600 ml-1">(${formatDuration(pauseMinutes)})</span>`;
                        }
                    }
                }
                
                membersHtml += `
                <div class="text-sm ${memberRowBg} rounded p-1 group flex justify-between items-center member-row"
                    data-record-id="${rec.id}"
                    data-group-id="${rec.groupId || ''}">

                    <span class="font-semibold ${memberTextColor} break-keep mr-1 inline-block text-left" title="${rec.member}">${rec.member}</span>
                    <span class="text-xs ${timeTextColor} flex-grow text-center">(${formatTimeTo24H(rec.startTime)}) ${isRecPaused ? `(휴식중)${pauseDurationHtml}` : ''}</span>
                    
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
            const recordIdForDuration = representativeRecord ? representativeRecord.id : groupRecords[0].id;
            const pauses = representativeRecord ? representativeRecord.pauses : [];
            const pausesJson = JSON.stringify(pauses || []);
            const durationStatus = isOngoing ? 'ongoing' : 'paused';
            const stopBtnClass = `bg-red-600 hover:bg-red-700 text-white`;

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
            card.className = `p-3 rounded-lg border ${mobileVisibilityClass} flex-col justify-between min-h-[300px] transition-all duration-200 cursor-pointer ${currentStyle.card.join(' ')}`;
            // ❗️ [수정] hover 효과 제거
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
                    <div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">인원<br>추가</span>
                    </div>
                    <div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">전체<br>정지</span>
                    </div>
                    <div class="${currentStyle.buttonBgOff} ${currentStyle.buttonTextOff} flex-1 aspect-square flex flex-col items-center justify-center rounded-lg text-xs font-semibold p-1 opacity-50 cursor-not-allowed">
                        <span class="text-center leading-tight">전체<br>종료</span>
                    </div>
                </div>
            `;
        }
        presetGrid.appendChild(card);
    });

    const otherTaskCard = document.createElement('div');
    const otherStyle = taskCardStyles['default'];
    otherTaskCard.className = `p-3 rounded-lg border flex flex-col justify-center items-center min-h-[300px] transition-all duration-200 cursor-pointer ${otherStyle.card.join(' ')}`;
    // ❗️ [수정] hover 효과 제거
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
    allMembersContainer.id = 'all-members-container';
    
    const allMembersHeader = document.createElement('div');
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
        groupHeader.className = 'flex items-center gap-2 mb-2 hidden md:flex';
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
            const isSelf = (member === currentUserName);

            const visibilityClass = isSelf ? 'flex' : 'hidden md:flex mobile-member-hidden'; 
            const widthClass = isSelf ? 'w-full md:w-28' : 'w-28'; 
            card.className = `p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClass} ${widthClass} flex-col justify-center`;
            
            card.dataset.memberName = member;
            if (isOnLeave) {
                card.dataset.action = 'edit-leave-record'; 
                card.dataset.leaveType = leaveInfo.type;
                card.dataset.startTime = leaveInfo.startTime || '';
                card.dataset.startDate = leaveInfo.startDate || '';
                card.dataset.endTime = leaveInfo.endTime || '';
                card.dataset.endDate = leaveInfo.endDate || '';
                
            } else {
                card.dataset.action = 'member-toggle-leave'; 
            }
            
            if (!isWorking) {
                if (currentUserRole === 'admin' || isSelf) {
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                } else {
                    card.classList.add('cursor-not-allowed', 'opacity-70'); 
                    card.disabled = true; // ❗️ [추가] 비활성화 시 버튼 disabled
                }
            } else {
                card.classList.add('opacity-70', 'cursor-not-allowed');
                card.disabled = true; // ❗️ [추가] 비활성화 시 버튼 disabled
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
        albaContainer.innerHTML = `<h4 class="text-md font-semibold text-gray-600 mb-2 hidden md:block">알바</h4>`;

        const albaGrid = document.createElement('div');
        albaGrid.className = 'flex flex-wrap gap-2';

        activePartTimers.forEach(pt => {
             const card = document.createElement('button');
             card.type = 'button';
             
             const isSelfAlba = (pt.name === currentUserName);

             const visibilityClassAlba = isSelfAlba ? 'flex' : 'hidden md:flex mobile-member-hidden'; 
             const widthClassAlba = isSelfAlba ? 'w-full md:w-28' : 'w-28'; 
             card.className = `relative p-1 rounded-lg border text-center transition-shadow min-h-[72px] ${visibilityClassAlba} ${widthClassAlba} flex-col justify-center`;

             const currentlyWorkingTask = workingMembers.get(pt.name);
             const isPaused = pausedMembers.has(pt.name);
             const albaLeaveInfo = onLeaveStatusMap.get(pt.name);
             const isAlbaOnLeave = !!albaLeaveInfo;
             const isAlbaWorking = currentlyWorkingTask || isPaused;

            card.dataset.memberName = pt.name;
            if (isAlbaOnLeave) {
                card.dataset.action = 'edit-leave-record';
                card.dataset.leaveType = albaLeaveInfo.type;
                card.dataset.startTime = albaLeaveInfo.startTime || '';
                card.dataset.startDate = albaLeaveInfo.startDate || '';
                card.dataset.endTime = albaLeaveInfo.endTime || '';
                card.dataset.endDate = albaLeaveInfo.endDate || '';
            } else {
                card.dataset.action = 'member-toggle-leave';
            }

             if (!isAlbaWorking) {
                 if (currentUserRole === 'admin' || isSelfAlba) {
                    card.classList.add('cursor-pointer', 'hover:shadow-md', 'hover:ring-2', 'hover:ring-blue-400');
                 } else {
                    card.classList.add('cursor-not-allowed', 'opacity-70');
                    card.disabled = true; // ❗️ [추가] 비활성화 시 버튼 disabled
                 }
             } else {
                 card.classList.add('opacity-70', 'cursor-not-allowed');
                 card.disabled = true; // ❗️ [추가] 비활성화 시 버튼 disabled
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
    
    teamStatusBoard.appendChild(allMembersContainer);
};

/**
 * ✅ [수정] renderCompletedWorkLog (ui.js -> ui-main.js)
 */
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

/**
 * ✅ [수정] renderDashboardLayout (ui.js -> ui-main.js)
 */
export const renderDashboardLayout = (appConfig) => {
    const container = document.getElementById('summary-content');
    if (!container) return;

    const itemIds = appConfig.dashboardItems || [];
    // ❗️ [삭제] quantities 변수 (appConfig.dashboardQuantities)
    const allDefinitions = getAllDashboardDefinitions(appConfig); // ❗️ [수정] ui-shared.js에서 가져옴

    container.innerHTML = '';
    let html = '';

    itemIds.forEach(id => {
        const def = allDefinitions[id];
        if (!def) {
            console.warn(`Main App: Dashboard definition not found for ID: ${id}. Skipping render.`);
            return;
        }

        let valueContent;
        const isQuantity = def.isQuantity === true;

        // ❗️ [수정] 모든 항목의 초기값을 0으로 설정
        valueContent = `<p id="${def.valueId}">0</p>`;

        html += `
            <div class="dashboard-card p-4 rounded-lg ${isQuantity ? 'dashboard-card-quantity' : ''}">
                <h4 class="text-sm font-bold uppercase tracking-wider">${def.title}</h4>
                ${valueContent}
            </div>
        `;
    });

    container.innerHTML = html;
};

/**
 * ✅ [수정] updateSummary (ui.js -> ui-main.js)
 */
export const updateSummary = (appState, appConfig) => {
    const allDefinitions = getAllDashboardDefinitions(appConfig); // ❗️ [수정] ui-shared.js에서 가져옴

    const elements = {};
    Object.keys(allDefinitions).forEach(id => {
        const def = allDefinitions[id];
        if (def && def.valueId) {
            elements[id] = document.getElementById(def.valueId);
        }
    });

    // --- (계산 로직: totalStaffCount, onLeaveTotalCount 등...은 모두 동일) ---
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


    const ongoingRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing');
    const pausedRecords = (appState.workRecords || []).filter(r => r.status === 'paused');
    
    const ongoingMembers = new Set(ongoingRecords.map(r => r.member));
    const pausedMembers = new Set(pausedRecords.map(r => r.member));

    const workingStaffCount = [...ongoingMembers].filter(member => allStaffMembers.has(member)).length;
    const workingPartTimerCount = [...ongoingMembers].filter(member => allPartTimers.has(member)).length;
    const totalWorkingCount = ongoingMembers.size;

    const availableStaffCount = totalStaffCount - [...onLeaveMemberNames].filter(member => allStaffMembers.has(member)).length;
    const availablePartTimerCount = totalPartTimerCount - [...onLeaveMemberNames].filter(member => allPartTimers.has(member)).length;
    
    const pausedStaffCount = [...pausedMembers].filter(member => allStaffMembers.has(member)).length;
    const pausedPartTimerCount = [...pausedMembers].filter(member => allPartTimers.has(member)).length;
    
    const idleStaffCount = Math.max(0, availableStaffCount - workingStaffCount - pausedStaffCount);
    const idlePartTimerCount = Math.max(0, availablePartTimerCount - workingPartTimerCount - pausedPartTimerCount);
    
    const totalIdleCount = idleStaffCount + idlePartTimerCount;

    const ongoingOrPausedRecords = (appState.workRecords || []).filter(r => r.status === 'ongoing' || r.status === 'paused');
    const ongoingTaskCount = new Set(ongoingOrPausedRecords.map(r => r.task)).size;
    // --- (계산 로직 끝) ---

    if (elements['total-staff']) elements['total-staff'].textContent = `${totalStaffCount}/${totalPartTimerCount}`;
    if (elements['leave-staff']) elements['leave-staff'].textContent = `${onLeaveTotalCount}`;
    if (elements['active-staff']) elements['active-staff'].textContent = `${availableStaffCount}/${availablePartTimerCount}`;
    if (elements['working-staff']) elements['working-staff'].textContent = `${totalWorkingCount}`;
    if (elements['idle-staff']) elements['idle-staff'].textContent = `${totalIdleCount}`;
    if (elements['ongoing-tasks']) elements['ongoing-tasks'].textContent = `${ongoingTaskCount}`;

    // total-work-time은 타이머(updateElapsedTimes)가 관리

    // --- 👇 [수정] 수량 항목 업데이트 로직 (appConfig.quantityToDashboardMap 사용) ---
    const quantitiesFromState = appState.taskQuantities || {};
    
    const taskNameToDashboardIdMap = appConfig.quantityToDashboardMap || {};

    // ❗️ [추가] 수량 항목을 0으로 초기화 (이전 값이 남아있는 것 방지)
    Object.keys(allDefinitions).forEach(id => {
        if (allDefinitions[id].isQuantity && elements[id]) {
            elements[id].textContent = '0';
        }
    });

    // 4. appState의 수량을 현황판 요소에 반영
    for (const task in quantitiesFromState) {
        const quantity = quantitiesFromState[task] || 0;
        const targetDashboardId = taskNameToDashboardIdMap[task]; 

        if (targetDashboardId && elements[targetDashboardId]) {
            // ❗️ [수정] 0 이상의 값만 표시 (음수 값 제외)
            if (quantity >= 0) {
                 elements[targetDashboardId].textContent = quantity;
            }
        }
    }
    // --- 👆 [수정 끝] ---
};