// === ui-history-attendance.js (근태 이력 렌더링 담당) ===

import { formatTimeTo24H, calculateDateDifference } from './utils.js';
import { context } from './state.js'; // ✅ [신규] 상태(정렬/필터) 참조

// 헬퍼: 정렬 아이콘이 포함된 헤더 HTML 생성
const _createSortableHeader = (label, key, currentSortState, viewType) => {
    let icon = '↕';
    let activeClass = 'text-gray-300';
    
    if (currentSortState.key === key) {
        icon = currentSortState.dir === 'asc' ? '▲' : '▼';
        activeClass = 'text-blue-600';
    }

    return `<th scope="col" class="px-4 py-3 cursor-pointer hover:bg-gray-200 transition select-none sortable-attendance-header group border-b" 
                data-sort-key="${key}" data-view-type="${viewType}">
                <div class="flex items-center justify-between gap-1">
                    <span>${label}</span>
                    <span class="${activeClass} text-[10px] group-hover:text-gray-500">${icon}</span>
                </div>
            </th>`;
};

/**
 * 근태 이력 - 일별 상세 렌더링
 */
export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    const data = allHistoryData.find(d => d.id === dateKey);
    
    // 현재 상태 가져오기
    const sortState = context.attendanceSortState.daily || { key: 'member', dir: 'asc' };
    const filterState = context.attendanceFilterState.daily || { member: '', type: '' };

    // 상단 컨트롤 영역 (버튼 + 필터)
    let html = `
        <div class="mb-4 pb-2 border-b flex flex-wrap justify-between items-end gap-2">
            <div class="flex items-center gap-4">
                <h3 class="text-xl font-bold text-gray-800">${dateKey} 근태 현황</h3>
                <div class="flex items-center gap-2">
                    <input type="text" id="att-daily-filter-member" placeholder="이름 검색" value="${filterState.member}" 
                           class="text-sm border border-gray-300 rounded px-2 py-1 w-32 focus:ring-blue-500 focus:border-blue-500">
                    <select id="att-daily-filter-type" class="text-sm border border-gray-300 rounded px-2 py-1 focus:ring-blue-500 focus:border-blue-500">
                        <option value="">전체 유형</option>
                        <option value="지각" ${filterState.type === '지각' ? 'selected' : ''}>지각</option>
                        <option value="외출" ${filterState.type === '외출' ? 'selected' : ''}>외출</option>
                        <option value="조퇴" ${filterState.type === '조퇴' ? 'selected' : ''}>조퇴</option>
                        <option value="결근" ${filterState.type === '결근' ? 'selected' : ''}>결근</option>
                        <option value="연차" ${filterState.type === '연차' ? 'selected' : ''}>연차</option>
                        <option value="출장" ${filterState.type === '출장' ? 'selected' : ''}>출장</option>
                    </select>
                </div>
            </div>
            <div>
                <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm"
                        data-action="open-add-attendance-modal" data-date-key="${dateKey}">
                    수동 추가
                </button>
                <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                        data-action="request-history-deletion" data-date-key="${dateKey}">
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

    // 1. 데이터 복사 및 필터링
    let leaveEntries = [...data.onLeaveMembers];
    
    // 원본 인덱스 보존 (수정/삭제용)
    leaveEntries = leaveEntries.map((entry, idx) => ({ ...entry, originalIndex: idx }));

    if (filterState.member) {
        leaveEntries = leaveEntries.filter(e => e.member.includes(filterState.member));
    }
    if (filterState.type) {
        leaveEntries = leaveEntries.filter(e => e.type === filterState.type);
    }

    // 2. 정렬
    leaveEntries.sort((a, b) => {
        let valA = '', valB = '';
        if (sortState.key === 'member') {
            valA = a.member || ''; valB = b.member || '';
        } else if (sortState.key === 'type') {
            valA = a.type || ''; valB = b.type || '';
        } else if (sortState.key === 'time') {
            valA = a.startTime || a.startDate || '';
            valB = b.startTime || b.startDate || '';
        }
        return valA.localeCompare(valB) * (sortState.dir === 'asc' ? 1 : -1);
    });

    // 3. 테이블 렌더링
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm overflow-hidden">
            <table class="w-full text-sm text-left text-gray-600 border border-gray-200 rounded-lg">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50">
                    <tr>
                        ${_createSortableHeader('이름', 'member', sortState, 'daily')}
                        ${_createSortableHeader('유형', 'type', sortState, 'daily')}
                        ${_createSortableHeader('시간 / 기간', 'time', sortState, 'daily')}
                        <th scope="col" class="px-6 py-3 text-right border-b">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-200">
    `;

    if (leaveEntries.length === 0) {
        html += `<tr><td colspan="4" class="text-center py-8 text-gray-400">조건에 맞는 데이터가 없습니다.</td></tr>`;
    } else {
        // 정렬 기준이 '이름(member)'일 때만 그룹화(rowspan) 적용
        const enableGrouping = (sortState.key === 'member');
        let lastMember = null;
        let memberRowSpan = 0;

        // 그룹화를 위해 미리 카운트 (이름 정렬 시에만)
        const memberCounts = {};
        if (enableGrouping) {
            leaveEntries.forEach(e => { memberCounts[e.member] = (memberCounts[e.member] || 0) + 1; });
        }

        leaveEntries.forEach((entry, index) => {
            let detailText = '-';
            if (entry.startTime) {
                detailText = formatTimeTo24H(entry.startTime);
                if (entry.type === '외출') {
                    detailText += entry.endTime ? ` ~ ${formatTimeTo24H(entry.endTime)}` : ' ~';
                }
            } else if (entry.startDate) {
                detailText = entry.startDate;
                if (entry.endDate && entry.endDate !== entry.startDate) {
                    detailText += ` ~ ${entry.endDate}`;
                }
            }

            html += `<tr class="bg-white hover:bg-gray-50">`;

            // 이름 컬럼 (그룹화 로직)
            if (enableGrouping) {
                if (lastMember !== entry.member) {
                    lastMember = entry.member;
                    memberRowSpan = memberCounts[entry.member];
                    html += `<td class="px-6 py-4 font-medium text-gray-900 align-top bg-white" rowspan="${memberRowSpan}">${entry.member}</td>`;
                }
            } else {
                html += `<td class="px-6 py-4 font-medium text-gray-900">${entry.member}</td>`;
            }

            html += `
                <td class="px-6 py-4">${entry.type}</td>
                <td class="px-6 py-4 font-mono text-xs">${detailText}</td>
                <td class="px-6 py-4 text-right space-x-2">
                    <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="font-medium text-blue-500 hover:underline">수정</button>
                    <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="font-medium text-red-500 hover:underline">삭제</button>
                </td>
            </tr>`;
        });
    }

    html += `</tbody></table></div>`;
    view.innerHTML = html;
};

/**
 * 주별/월별 근태 요약 렌더링 (공통 헬퍼)
 * ✅ [수정] 정렬 및 필터 기능 추가
 */
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey, viewMode) => {
    const data = aggregationMap[periodKey];
    
    // 상태 가져오기
    const sortState = context.attendanceSortState[viewMode] || { key: 'member', dir: 'asc' };
    const filterState = context.attendanceFilterState[viewMode] || { member: '' };

    // 필터 입력창 ID 생성
    const filterInputId = `att-${viewMode}-filter-member`;

    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                <div class="flex justify-between items-end mb-4">
                    <h3 class="text-xl font-bold text-gray-800">${periodKey} 근태 요약</h3>
                    <div class="flex items-center gap-2">
                        <input type="text" id="${filterInputId}" placeholder="이름 검색" value="${filterState.member}" 
                               class="text-sm border border-gray-300 rounded px-2 py-1 w-40 focus:ring-blue-500 focus:border-blue-500">
                    </div>
                </div>
                <div class="overflow-x-auto max-h-[60vh]">
                    <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100 sticky top-0 z-20 shadow-sm">
                            <tr>
                                ${_createSortableHeader('이름', 'member', sortState, viewMode)}
                                ${_createSortableHeader('지각', '지각', sortState, viewMode)}
                                ${_createSortableHeader('외출', '외출', sortState, viewMode)}
                                ${_createSortableHeader('조퇴', '조퇴', sortState, viewMode)}
                                ${_createSortableHeader('결근', '결근', sortState, viewMode)}
                                ${_createSortableHeader('연차', '연차', sortState, viewMode)}
                                ${_createSortableHeader('출장', '출장', sortState, viewMode)}
                                ${_createSortableHeader('총 횟수', 'totalCount', sortState, viewMode)}
                                ${_createSortableHeader('총 결근일수', 'totalAbsenceDays', sortState, viewMode)}
                                ${_createSortableHeader('총 연차일수', 'totalLeaveDays', sortState, viewMode)}
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">`;

    if (!data) {
        html += `<tr><td colspan="10" class="text-center py-8 text-gray-500">데이터가 없습니다.</td></tr></tbody></table></div></div>`;
        viewElement.innerHTML = html;
        return;
    }

    // 1. 데이터 집계
    const summary = {};
    data.leaveEntries.forEach(entry => {
        const member = entry.member;
        const type = entry.type;
        if (!summary[member]) {
            summary[member] = {
                member: member,
                counts: { '지각': 0, '외출': 0, '조퇴': 0, '결근': 0, '연차': 0, '출장': 0 },
                totalCount: 0,
                totalAbsenceDays: 0,
                totalLeaveDays: 0
            };
        }
        if (summary[member].counts.hasOwnProperty(type)) {
            summary[member].counts[type] += 1;
        }
        summary[member].totalCount += 1;

        if (type === '결근') {
            summary[member].totalAbsenceDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        } else if (type === '연차') {
            summary[member].totalLeaveDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        }
    });

    // 2. 리스트 변환 및 필터링
    let summaryList = Object.values(summary);
    if (filterState.member) {
        summaryList = summaryList.filter(item => item.member.includes(filterState.member));
    }

    // 3. 정렬
    summaryList.sort((a, b) => {
        let valA, valB;
        
        if (sortState.key === 'member') {
            valA = a.member; valB = b.member;
            return valA.localeCompare(valB) * (sortState.dir === 'asc' ? 1 : -1);
        } else if (['totalCount', 'totalAbsenceDays', 'totalLeaveDays'].includes(sortState.key)) {
            valA = a[sortState.key]; valB = b[sortState.key];
        } else {
            // 카운트 컬럼 (지각, 외출 등)
            valA = a.counts[sortState.key] || 0;
            valB = b.counts[sortState.key] || 0;
        }
        
        return (valA - valB) * (sortState.dir === 'asc' ? 1 : -1);
    });

    if (summaryList.length === 0) {
         html += `<tr><td colspan="10" class="text-center py-8 text-gray-500">조건에 맞는 데이터가 없습니다.</td></tr>`;
    } else {
        summaryList.forEach(item => {
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white border-r">${item.member}</td>
                    <td class="px-4 py-3 text-center ${item.counts['지각'] > 0 ? 'text-red-500 font-bold' : 'text-gray-300'}">${item.counts['지각']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['외출'] > 0 ? 'text-gray-800' : 'text-gray-300'}">${item.counts['외출']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['조퇴'] > 0 ? 'text-gray-800' : 'text-gray-300'}">${item.counts['조퇴']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['결근'] > 0 ? 'text-red-600 font-bold' : 'text-gray-300'}">${item.counts['결근']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['연차'] > 0 ? 'text-blue-600 font-bold' : 'text-gray-300'}">${item.counts['연차']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['출장'] > 0 ? 'text-gray-800' : 'text-gray-300'}">${item.counts['출장']}</td>
                    <td class="px-4 py-3 text-center font-bold text-indigo-600 bg-indigo-50">${item.totalCount}</td>
                    <td class="px-4 py-3 text-center font-bold text-red-600 bg-red-50">${item.totalAbsenceDays}일</td>
                    <td class="px-4 py-3 text-center font-bold text-blue-600 bg-blue-50">${item.totalLeaveDays}일</td>
                </tr>`;
        });
    }

    html += `</tbody></table></div></div>`;
    viewElement.innerHTML = html;
};

/**
 * 근태 이력 - 주별 요약 렌더링
 */
export const renderAttendanceWeeklyHistory = (selectedWeekKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    const weeklyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers) return acc;
        try {
             const dateObj = new Date(day.id);
             if (isNaN(dateObj.getTime())) return acc;
             const weekKey = getWeekOfYear(dateObj);
             if (!weekKey) return acc;

            if (!acc[weekKey]) acc[weekKey] = { leaveEntries: [], dateKeys: new Set() };

            day.onLeaveMembers.forEach(entry => {
                // 기간제 근태(연차 등)가 주차 내에 포함되는지 체크
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
            });
            acc[weekKey].dateKeys.add(day.id);
        } catch (e) {}
        return acc;
    }, {});

    renderAggregatedAttendanceSummary(view, weeklyData, selectedWeekKey, 'weekly');
};

/**
 * 근태 이력 - 월별 요약 렌더링
 */
export const renderAttendanceMonthlyHistory = (selectedMonthKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    const monthlyData = (allHistoryData || []).reduce((acc, day) => {
        if (!day || !day.id || !day.onLeaveMembers || day.id.length < 7) return acc;
         try {
            const monthKey = day.id.substring(0, 7);
             if (!/^\d{4}-\d{2}$/.test(monthKey)) return acc;

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
                    acc[monthKey].leaveEntries.push({ ...entry, date: day.id });
                }
            });
            acc[monthKey].dateKeys.add(day.id);
        } catch (e) {}
        return acc;
    }, {});

    renderAggregatedAttendanceSummary(view, monthlyData, selectedMonthKey, 'monthly');
};