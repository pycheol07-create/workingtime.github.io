// === js/ui-history-personal.js ===
// 설명: '개인 리포트' 탭의 데이터 집계 및 렌더링 로직을 담당합니다.

import { formatDuration, getWeekOfYear, formatTimeTo24H, calculateDateDifference, isWeekday } from './utils.js';
import { appConfig, context, LEAVE_TYPES } from './state.js';

// --- 헬퍼: 정렬 아이콘 생성 ---
const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

// --- 헬퍼: 필터 드롭다운 UI 생성 ---
const getFilterDropdown = (target, key, currentFilterValue, options = []) => {
    const dropdownId = `${target}-${key}`;
    const isActive = context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    let inputHtml = '';
    if (options && options.length > 0) {
        const optionsHtml = options.map(opt => 
            `<option value="${opt}" ${currentFilterValue === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        inputHtml = `<select class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer" data-filter-target="${target}" data-filter-key="${key}"><option value="">(전체)</option>${optionsHtml}</select>`;
    } else {
        inputHtml = `<input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="검색..." value="${currentFilterValue || ''}" data-filter-target="${target}" data-filter-key="${key}" autocomplete="off">`;
    }

    // ✅ 드롭다운 z-index 상향 조정 (테이블 헤더 위로 오게)
    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" /></svg>
            </button>
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} text-left cursor-default">
                <div class="text-xs font-bold text-gray-500 mb-2 flex justify-between items-center">
                    <span>필터 조건</span>
                    ${hasValue ? `<button class="text-[10px] text-red-500 hover:underline" onclick="const i=this.closest('.filter-dropdown').querySelector('input,select'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true}));">지우기</button>` : ''}
                </div>
                ${inputHtml}
            </div>
        </div>
    `;
};

/**
 * 1. 데이터 필터링 및 집계 함수
 */
const aggregatePersonalData = (allHistoryData, viewMode, dateKey, memberName) => {
    // 1. 기간 필터링
    const filteredDays = allHistoryData.filter(day => {
        if (!day.id) return false;
        if (viewMode === 'personal-daily') return day.id === dateKey;
        if (viewMode === 'personal-weekly') return getWeekOfYear(new Date(day.id)) === dateKey;
        if (viewMode === 'personal-monthly') return day.id.startsWith(dateKey);
        if (viewMode === 'personal-yearly') return day.id.startsWith(dateKey);
        return false;
    });

    // 2. 초기화
    const stats = {
        totalWorkMinutes: 0,
        totalWageCost: 0,
        workDaysCount: 0,
        taskStats: {}, // { taskName: { count, duration, cost } }
        attendanceCounts: {}, // { type: count }
        attendanceDays: {}, // { type: days } (연차, 결근 등 일수 집계용)
        attendanceLogs: [], 
        dailyLogs: []
    };

    // 근태 카운트 초기화
    LEAVE_TYPES.forEach(t => { stats.attendanceCounts[t] = 0; stats.attendanceDays[t] = 0; });

    // 시급 정보
    let wage = appConfig.memberWages?.[memberName] || 0;
    if (wage === 0) {
        for (let i = filteredDays.length - 1; i >= 0; i--) {
            const pt = (filteredDays[i].partTimers || []).find(p => p.name === memberName);
            if (pt && pt.wage) { wage = pt.wage; break; }
        }
        if (wage === 0) wage = appConfig.defaultPartTimerWage || 10000;
    }

    // 3. 순회 집계
    filteredDays.sort((a, b) => a.id.localeCompare(b.id)).forEach(day => {
        const date = day.id;
        let dayWorkMinutes = 0;
        const dayTasks = {};
        let dayAttendanceStatus = [];

        // A. 업무
        const myRecords = (day.workRecords || []).filter(r => r.member === memberName);
        if (myRecords.length > 0) {
            stats.workDaysCount++;
            myRecords.forEach(r => {
                const duration = Number(r.duration) || 0;
                const cost = (duration / 60) * wage;
                
                dayWorkMinutes += duration;
                stats.totalWorkMinutes += duration;
                stats.totalWageCost += cost;

                if (!stats.taskStats[r.task]) stats.taskStats[r.task] = { count: 0, duration: 0, cost: 0 };
                stats.taskStats[r.task].count++;
                stats.taskStats[r.task].duration += duration;
                stats.taskStats[r.task].cost += cost;

                dayTasks[r.task] = (dayTasks[r.task] || 0) + duration;
            });
        }

        // B. 근태
        const myLeaves = (day.onLeaveMembers || []).filter(l => l.member === memberName);
        myLeaves.forEach(leave => {
            const type = leave.type;
            
            // 횟수 집계
            stats.attendanceCounts[type] = (stats.attendanceCounts[type] || 0) + 1;

            // 일수 계산 (연차, 결근, 출장 등 기간이 있는 근태)
            if (type === '연차' || type === '결근' || type === '출장') {
                const days = calculateDateDifference(leave.startDate, leave.endDate || leave.startDate);
                stats.attendanceDays[type] = (stats.attendanceDays[type] || 0) + days;
            }

            // 로그용 텍스트
            let detail = '';
            if (leave.startTime) {
                detail = formatTimeTo24H(leave.startTime) + (leave.endTime ? ` ~ ${formatTimeTo24H(leave.endTime)}` : (type === '외출' ? ' ~' : ''));
            } else if (leave.startDate) {
                detail = leave.startDate + (leave.endDate && leave.endDate !== leave.startDate ? ` ~ ${leave.endDate}` : '');
            }
            
            stats.attendanceLogs.push({ date, type, detail });
            dayAttendanceStatus.push(type);
        });

        // C. 일별 로그
        let mainTask = '-';
        let maxDuration = -1;
        Object.entries(dayTasks).forEach(([t, d]) => {
            if (d > maxDuration) { maxDuration = d; mainTask = t; }
        });

        stats.dailyLogs.push({
            date: date,
            workTime: dayWorkMinutes,
            mainTask: mainTask !== '-' ? `${mainTask} 외` : '-',
            attendance: dayAttendanceStatus.length > 0 ? dayAttendanceStatus.join(', ') : (dayWorkMinutes > 0 ? '정상근무' : '-')
        });
    });

    return { stats, filteredDays, wage };
};

/**
 * 2. 메인 렌더링 함수
 */
export const renderPersonalReport = (targetId, viewMode, dateKey, memberName, allHistoryData) => {
    const container = document.getElementById(targetId);
    if (!container) return;

    if (!memberName) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">분석할 직원을 선택해주세요.</div>`;
        return;
    }
    if (!dateKey) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">날짜를 선택해주세요.</div>`;
        return;
    }

    const { stats, filteredDays, wage } = aggregatePersonalData(allHistoryData, viewMode, dateKey, memberName);

    if (filteredDays.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10"><p class="font-bold text-gray-700 mb-1">${memberName}님</p><p>해당 기간에 기록이 없습니다.</p></div>`;
        return;
    }

    // --- 데이터 가공 및 정렬/필터 적용 ---
    const sortState = context.personalReportSortState || {};
    const filterState = context.personalReportFilterState || {};

    // 1. 업무별 통계 배열 변환
    let taskStatsArray = Object.entries(stats.taskStats).map(([task, data]) => ({
        task,
        ...data,
        percent: stats.totalWorkMinutes > 0 ? (data.duration / stats.totalWorkMinutes) * 100 : 0,
        avgTime: data.count > 0 ? data.duration / data.count : 0
    }));
    
    // ✅ 필터 옵션 추출
    const allTaskNames = [...new Set(taskStatsArray.map(t => t.task))].sort();

    // 필터 (업무)
    if (filterState.taskStats?.task) {
        taskStatsArray = taskStatsArray.filter(t => t.task === filterState.taskStats.task);
    }
    // 정렬 (업무)
    const tsSort = sortState.taskStats || { key: 'duration', dir: 'desc' };
    taskStatsArray.sort((a, b) => {
        let vA = a[tsSort.key], vB = b[tsSort.key];
        if (typeof vA === 'string') return vA.localeCompare(vB) * (tsSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (tsSort.dir === 'asc' ? 1 : -1);
    });

    // 2. 근태 로그
    let attLogs = [...stats.attendanceLogs];
    
    // ✅ 필터 옵션 추출
    const allAttTypes = [...new Set(attLogs.map(l => l.type))].sort();

    // 필터 (근태)
    if (filterState.attendanceLogs?.type) {
        attLogs = attLogs.filter(l => l.type === filterState.attendanceLogs.type);
    }
    // 정렬 (근태)
    const alSort = sortState.attendanceLogs || { key: 'date', dir: 'asc' };
    attLogs.sort((a, b) => (a[alSort.key] > b[alSort.key] ? 1 : -1) * (alSort.dir === 'asc' ? 1 : -1));

    // 3. 일별 로그
    let dailyLogs = [...stats.dailyLogs];

    // ✅ 필터 옵션 추출
    const allDailyAttStatus = [...new Set(dailyLogs.map(l => l.attendance))].sort();
    
    // 필터 (일별)
    if (filterState.dailyLogs?.attendance) {
        dailyLogs = dailyLogs.filter(l => l.attendance === filterState.dailyLogs.attendance);
    }
    // 정렬 (일별)
    const dlSort = sortState.dailyLogs || { key: 'date', dir: 'asc' };
    dailyLogs.sort((a, b) => {
        let vA = a[dlSort.key], vB = b[dlSort.key];
        if (typeof vA === 'string') return vA.localeCompare(vB) * (dlSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (dlSort.dir === 'asc' ? 1 : -1);
    });

    // --- HTML 생성 ---
    let html = `<div class="space-y-6 animate-fade-in">`;

    // 1. 상단 요약 카드
    html += `
        <div class="flex flex-col md:flex-row justify-between items-center mb-2">
            <h3 class="text-xl font-bold text-gray-800"><span class="text-blue-600">${memberName}</span>님의 ${dateKey} 리포트</h3>
            <span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">적용 시급: ${wage.toLocaleString()}원</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">총 근무일</div><div class="text-2xl font-extrabold text-gray-800">${stats.workDaysCount}일</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">총 업무 시간</div><div class="text-2xl font-extrabold text-blue-600">${formatDuration(stats.totalWorkMinutes)}</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">예상 급여 (세전)</div><div class="text-2xl font-extrabold text-gray-800">${Math.round(stats.totalWageCost).toLocaleString()}원</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-red-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">특이 근태</div>
                <div class="text-sm font-semibold text-gray-700 truncate">${Object.entries(stats.attendanceCounts).filter(([,c])=>c>0).map(([t,c])=>`${t} ${c}`).join(', ')||'-'}</div>
            </div>
        </div>
    `;

    // 2. 업무별 상세 통계 (필터/정렬 적용)
    const th_task = (key, label, w='') => `<th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group ${w}" data-sort-target="taskStats" data-sort-key="${key}"><div class="flex items-center justify-end ${w?'justify-start':''}"><span>${label} ${getSortIcon(tsSort.key, tsSort.dir, key)}</span></div></th>`;

    html += `
        <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
            <h4 class="text-lg font-bold text-gray-800 mb-4">📊 업무별 수행 내역</h4>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                        <tr>
                            <th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="taskStats" data-sort-key="task">
                                <div class="flex items-center justify-between">
                                    <span>업무명 ${getSortIcon(tsSort.key, tsSort.dir, 'task')}</span>
                                    ${getFilterDropdown('taskStats', 'task', filterState.taskStats?.task, allTaskNames)}
                                </div>
                            </th>
                            ${th_task('count', '수행 횟수')} ${th_task('duration', '총 소요 시간')} ${th_task('percent', '비중')} ${th_task('avgTime', '평균 시간/건')}
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
                        ${taskStatsArray.length === 0 ? '<tr><td colspan="5" class="px-4 py-4 text-center text-gray-400">데이터 없음</td></tr>' : ''}
                        ${taskStatsArray.map(data => `
                            <tr class="hover:bg-gray-50">
                                <td class="px-4 py-3 font-medium text-gray-900">${data.task}</td>
                                <td class="px-4 py-3 text-right">${data.count}회</td>
                                <td class="px-4 py-3 text-right font-bold text-blue-600">${formatDuration(data.duration)}</td>
                                <td class="px-4 py-3 text-right">
                                    <div class="flex items-center justify-end gap-2">
                                        <span class="text-xs text-gray-500">${data.percent.toFixed(1)}%</span>
                                        <div class="w-16 bg-gray-200 rounded-full h-1.5"><div class="bg-blue-500 h-1.5 rounded-full" style="width: ${data.percent}%"></div></div>
                                    </div>
                                </td>
                                <td class="px-4 py-3 text-right text-gray-500">${formatDuration(data.avgTime)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // 3. ✅ [신규] 근태 요약 및 상세 기록
    if (attLogs.length > 0 || Object.values(stats.attendanceCounts).some(c=>c>0)) {
        // 요약 데이터 HTML 생성
        const summaryHtml = LEAVE_TYPES.map(type => {
            const count = stats.attendanceCounts[type] || 0;
            if (count === 0) return '';
            let text = `${type}: <strong>${count}회</strong>`;
            if (type === '연차' || type === '결근' || type === '출장') {
                text += ` <span class="text-xs text-gray-500">(${stats.attendanceDays[type]}일)</span>`;
            }
            return `<div class="bg-gray-50 rounded px-3 py-2 text-sm text-gray-700 border border-gray-200 shadow-sm">${text}</div>`;
        }).join('');

        const th_att = (key, label) => `<th class="px-4 py-2 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="attendanceLogs" data-sort-key="${key}"><div class="flex items-center"><span>${label} ${getSortIcon(alSort.key, alSort.dir, key)}</span></div></th>`;

        html += `
            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                <h4 class="text-lg font-bold text-gray-800 mb-4">📅 근태 기록</h4>
                
                <div class="flex flex-wrap gap-2 mb-4">
                    ${summaryHtml}
                </div>

                <div class="overflow-x-auto max-h-60">
                    <table class="w-full text-sm text-left text-gray-600">
                        <thead class="text-xs text-gray-700 uppercase bg-red-50 border-b border-red-100 sticky top-0">
                            <tr>
                                ${th_att('date', '날짜')}
                                <th class="px-4 py-2 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="attendanceLogs" data-sort-key="type">
                                    <div class="flex items-center justify-between">
                                        <span>유형 ${getSortIcon(alSort.key, alSort.dir, 'type')}</span>
                                        ${getFilterDropdown('attendanceLogs', 'type', filterState.attendanceLogs?.type, allAttTypes)}
                                    </div>
                                </th>
                                <th class="px-4 py-2">상세 시간/기간</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                             ${attLogs.length === 0 ? '<tr><td colspan="3" class="px-4 py-4 text-center text-gray-400">조건에 맞는 기록 없음</td></tr>' : ''}
                             ${attLogs.map(log => `
                                <tr class="hover:bg-red-50">
                                    <td class="px-4 py-2 font-medium">${log.date}</td>
                                    <td class="px-4 py-2"><span class="px-2 py-0.5 rounded text-xs font-bold ${log.type==='지각'||log.type==='결근'?'bg-red-100 text-red-700':'bg-gray-100 text-gray-700'}">${log.type}</span></td>
                                    <td class="px-4 py-2 text-gray-500">${log.detail}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // 4. 일자별 로그 (일별 뷰가 아닐 때만)
    if (viewMode !== 'personal-daily') {
        const th_daily = (key, label) => `<th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="dailyLogs" data-sort-key="${key}"><div class="flex items-center"><span>${label} ${getSortIcon(dlSort.key, dlSort.dir, key)}</span></div></th>`;
        
        html += `
            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                <h4 class="text-lg font-bold text-gray-800 mb-4">🗓️ 일자별 활동 요약</h4>
                <div class="overflow-x-auto max-h-96">
                    <table class="w-full text-sm text-left text-gray-600">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b sticky top-0">
                            <tr>
                                ${th_daily('date', '날짜')}
                                <th class="px-4 py-3 cursor-pointer hover:bg-gray-100 select-none group" data-sort-target="dailyLogs" data-sort-key="attendance">
                                    <div class="flex items-center justify-between">
                                        <span>근태 ${getSortIcon(dlSort.key, dlSort.dir, 'attendance')}</span>
                                        ${getFilterDropdown('dailyLogs', 'attendance', filterState.dailyLogs?.attendance, allDailyAttStatus)}
                                    </div>
                                </th>
                                <th class="px-4 py-3">주요 업무</th>
                                ${th_daily('workTime', '총 근무 시간')}
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                             ${dailyLogs.length === 0 ? '<tr><td colspan="4" class="px-4 py-4 text-center text-gray-400">조건에 맞는 기록 없음</td></tr>' : ''}
                             ${dailyLogs.map(log => `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-4 py-3 font-medium text-gray-900">${log.date} (${getDayOfWeek(log.date)})</td>
                                    <td class="px-4 py-3"><span class="px-2 py-1 rounded text-xs ${log.attendance==='정상근무'?'bg-green-100 text-green-700':'bg-yellow-100 text-yellow-800'}">${log.attendance}</span></td>
                                    <td class="px-4 py-3 text-gray-600">${log.mainTask}</td>
                                    <td class="px-4 py-3 text-right font-bold text-blue-600">${formatDuration(log.workTime)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;
};

function getDayOfWeek(dateStr) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[new Date(dateStr).getDay()];
}