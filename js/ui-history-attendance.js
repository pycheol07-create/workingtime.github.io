// === js/ui-history-attendance.js ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, calculateDateDifference } from './utils.js';
import { context, LEAVE_TYPES } from './state.js';

/**
 * 헬퍼: 정렬 아이콘 생성
 */
const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

/**
 * 헬퍼: 필터 드롭다운 UI 생성 (엑셀 스타일)
 */
const getFilterDropdown = (mode, key, currentFilterValue, options = []) => {
    const dropdownId = `${mode}-${key}`; // 예: daily-member
    const isActive = context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    
    // 필터 아이콘 색상
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50' : 'text-gray-400 hover:bg-gray-200';

    let inputHtml = '';
    if (options.length > 0) {
        // 셀렉트 박스
        const optionsHtml = options.map(opt => 
            `<option value="${opt}" ${currentFilterValue === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        
        inputHtml = `
            <select class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    data-filter-target="${mode}" data-filter-key="${key}">
                <option value="">(전체)</option>
                ${optionsHtml}
            </select>`;
    } else {
        // 텍스트 입력
        inputHtml = `
            <input type="text" class="w-full p-2 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                   placeholder="검색어 입력..." 
                   value="${currentFilterValue || ''}"
                   data-filter-target="${mode}" data-filter-key="${key}"
                   autocomplete="off">`;
    }

    // ✅ 드롭다운에 z-index 60 적용하여 테이블 헤더 위로 올라오게 함
    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" />
                </svg>
            </button>
            
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white border border-gray-200 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} cursor-default text-left">
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
 * 근태 이력 - 일별 상세 렌더링
 */
export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    const data = allHistoryData.find(d => d.id === dateKey);

    let html = `
        <div class="mb-4 pb-2 border-b flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">${dateKey} 근태 현황</h3>
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

    // --- 1. 필터링 및 정렬 로직 ---
    let leaveEntries = [...data.onLeaveMembers];
    
    // ✅ 안전한 참조 (state가 아직 초기화 안 됐을 경우 대비)
    const filterState = context.attendanceFilterState?.daily || { member: '', type: '' };
    const sortState = context.attendanceSortState?.daily || { key: 'member', dir: 'asc' };

    // 1-1. 필터링
    if (filterState.member) {
        const term = filterState.member.toLowerCase();
        leaveEntries = leaveEntries.filter(e => (e.member || '').toLowerCase().includes(term));
    }
    if (filterState.type) {
        const term = filterState.type; 
        leaveEntries = leaveEntries.filter(e => e.type === term);
    }

    // 1-2. 정렬
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
        
        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    // --- 2. 테이블 헤더 생성 ---
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm min-h-[400px]">
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none group relative" data-sort-target="daily" data-sort-key="member">
                            <div class="flex items-center justify-between">
                                <span class="flex items-center">이름 ${getSortIcon(sortState.key, sortState.dir, 'member')}</span>
                                ${getFilterDropdown('daily', 'member', filterState.member)}
                            </div>
                        </th>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none group relative" data-sort-target="daily" data-sort-key="type">
                            <div class="flex items-center justify-between">
                                <span class="flex items-center">유형 ${getSortIcon(sortState.key, sortState.dir, 'type')}</span>
                                ${getFilterDropdown('daily', 'type', filterState.type, LEAVE_TYPES)}
                            </div>
                        </th>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none group" data-sort-target="daily" data-sort-key="time">
                            <div class="flex items-center">
                                시간 / 기간 ${getSortIcon(sortState.key, sortState.dir, 'time')}
                            </div>
                        </th>
                        <th scope="col" class="px-6 py-3 text-right">관리</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
    `;

    if (leaveEntries.length === 0) {
        html += `<tr><td colspan="4" class="px-6 py-8 text-center text-gray-500">조건에 맞는 기록이 없습니다.</td></tr>`;
        html += `</tbody></table></div>`;
        view.innerHTML = html;
        return;
    }

    // --- 3. 테이블 바디 생성 ---
    const isGroupedView = (sortState.key === 'member');

    if (isGroupedView) {
        const groupedEntries = new Map();
        leaveEntries.forEach((entry) => {
            const originalIndex = data.onLeaveMembers.indexOf(entry);
            const member = entry.member || 'N/A';
            if (!groupedEntries.has(member)) groupedEntries.set(member, []);
            groupedEntries.get(member).push({ ...entry, originalIndex });
        });

        let isFirstMemberGroup = true; 
        groupedEntries.forEach((entries, member) => {
            const memberEntryCount = entries.length;
            entries.forEach((entry, entryIndex) => {
                const detailText = _formatDetailText(entry);
                const isFirstRowOfGroup = (entryIndex === 0);
                const rowClass = `bg-white hover:bg-gray-50 ${isFirstRowOfGroup && !isFirstMemberGroup ? 'border-t' : ''}`;

                html += `<tr class="${rowClass}">`;
                if (isFirstRowOfGroup) {
                    html += `<td class="px-6 py-4 font-medium text-gray-900 align-top border-r border-gray-50" rowspan="${memberEntryCount}">${member}</td>`;
                }
                html += `
                    <td class="px-6 py-4">
                        <span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">${entry.type}</span>
                    </td>
                    <td class="px-6 py-4 text-gray-500 font-mono text-xs">${detailText}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">수정</button>
                        <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">삭제</button>
                    </td>
                </tr>`;
            });
            isFirstMemberGroup = false; 
        });

    } else {
        leaveEntries.forEach((entry) => {
            const originalIndex = data.onLeaveMembers.indexOf(entry);
            const detailText = _formatDetailText(entry);
            
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-6 py-4 font-medium text-gray-900">${entry.member}</td>
                    <td class="px-6 py-4">
                        <span class="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700">${entry.type}</span>
                    </td>
                    <td class="px-6 py-4 text-gray-500 font-mono text-xs">${detailText}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${originalIndex}" class="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline">수정</button>
                        <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${originalIndex}" class="text-xs font-medium text-red-500 hover:text-red-700 hover:underline">삭제</button>
                    </td>
                </tr>`;
        });
    }

    html += `</tbody></table></div>`;
    view.innerHTML = html;
};

// 헬퍼: 상세 텍스트 포맷팅
const _formatDetailText = (entry) => {
    if (entry.startTime) {
        let text = formatTimeTo24H(entry.startTime);
        if (entry.type === '외출') {
            text += entry.endTime ? ` ~ ${formatTimeTo24H(entry.endTime)}` : ' ~';
        } else if (entry.endTime) {
            text += ` ~ ${formatTimeTo24H(entry.endTime)}`;
        }
        return text;
    } else if (entry.startDate) {
        let text = entry.startDate;
        if (entry.endDate && entry.endDate !== entry.startDate) {
            text += ` ~ ${entry.endDate}`;
        }
        return text;
    }
    return '-';
};

/**
 * 주별/월별 근태 요약 렌더링
 */
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey, mode) => {
    const data = aggregationMap[periodKey];
    if (!data) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">${periodKey} 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    const sortState = context.attendanceSortState?.[mode] || { key: 'member', dir: 'asc' };
    const filterState = context.attendanceFilterState?.[mode] || { member: '' };

    // 1. 집계
    let summary = [];
    const memberMap = {};

    data.leaveEntries.forEach(entry => {
        const member = entry.member;
        if (!memberMap[member]) {
            memberMap[member] = {
                member: member,
                counts: { '지각': 0, '외출': 0, '조퇴': 0, '결근': 0, '연차': 0, '출장': 0 },
                totalCount: 0,
                totalAbsenceDays: 0,
                totalLeaveDays: 0
            };
        }
        const rec = memberMap[member];
        const type = entry.type;
        if (rec.counts.hasOwnProperty(type)) {
            rec.counts[type] += 1;
        } else if (type) {
            rec.counts[type] = (rec.counts[type] || 0) + 1;
        }
        rec.totalCount += 1;
        if (type === '결근') {
            rec.totalAbsenceDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        } else if (type === '연차') {
            rec.totalLeaveDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        }
    });
    summary = Object.values(memberMap);

    // 2. 필터링
    if (filterState.member) {
        const term = filterState.member.toLowerCase();
        summary = summary.filter(item => item.member.toLowerCase().includes(term));
    }

    // 3. 정렬
    summary.sort((a, b) => {
        let valA = 0, valB = 0;
        const k = sortState.key;
        if (k === 'member') { valA = a.member; valB = b.member; }
        else if (k === 'totalCount') { valA = a.totalCount; valB = b.totalCount; }
        else if (k === 'totalAbsenceDays') { valA = a.totalAbsenceDays; valB = b.totalAbsenceDays; }
        else if (k === 'totalLeaveDays') { valA = a.totalLeaveDays; valB = b.totalLeaveDays; }
        else { valA = a.counts[k] || 0; valB = b.counts[k] || 0; }

        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });

    // 4. HTML 생성
    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6 min-h-[400px]">
                <h3 class="text-xl font-bold mb-4 text-gray-800">${periodKey} 근태 요약</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                            <tr>
                                <th scope="col" class="px-4 py-3 border-b sticky left-0 bg-gray-100 z-10 cursor-pointer hover:bg-gray-200 select-none group" 
                                    data-sort-target="${mode}" data-sort-key="member">
                                    <div class="flex items-center justify-between min-w-[100px]">
                                        <span class="flex items-center">이름 ${getSortIcon(sortState.key, sortState.dir, 'member')}</span>
                                        ${getFilterDropdown(mode, 'member', filterState.member)}
                                    </div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="지각">
                                    <div class="flex items-center justify-center">지각 ${getSortIcon(sortState.key, sortState.dir, '지각')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="외출">
                                    <div class="flex items-center justify-center">외출 ${getSortIcon(sortState.key, sortState.dir, '외출')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="조퇴">
                                    <div class="flex items-center justify-center">조퇴 ${getSortIcon(sortState.key, sortState.dir, '조퇴')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="결근">
                                    <div class="flex items-center justify-center">결근 ${getSortIcon(sortState.key, sortState.dir, '결근')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="연차">
                                    <div class="flex items-center justify-center">연차 ${getSortIcon(sortState.key, sortState.dir, '연차')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="출장">
                                    <div class="flex items-center justify-center">출장 ${getSortIcon(sortState.key, sortState.dir, '출장')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-indigo-600 cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="totalCount">
                                    <div class="flex items-center justify-center">총 횟수 ${getSortIcon(sortState.key, sortState.dir, 'totalCount')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-red-600 cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="totalAbsenceDays">
                                    <div class="flex items-center justify-center">총 결근일수 ${getSortIcon(sortState.key, sortState.dir, 'totalAbsenceDays')}</div>
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-blue-600 cursor-pointer hover:bg-gray-200 select-none group" data-sort-target="${mode}" data-sort-key="totalLeaveDays">
                                    <div class="flex items-center justify-center">총 연차일수 ${getSortIcon(sortState.key, sortState.dir, 'totalLeaveDays')}</div>
                                </th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">`;

    if (summary.length === 0) {
         html += `<tr><td colspan="10" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    } else {
        summary.forEach(item => {
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white shadow-sm">${item.member}</td>
                    <td class="px-4 py-3 text-center ${item.counts['지각'] > 0 ? 'text-red-500 font-semibold' : 'text-gray-300'}">${item.counts['지각']}</td>
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

    html += `       </tbody>
                </table>
            </div>
        </div>`;

    viewElement.innerHTML = html;
};

export const renderAttendanceWeeklyHistory = (selectedWeekKey, allHistoryData) => {
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

    renderAggregatedAttendanceSummary(view, weeklyData, selectedWeekKey, 'weekly');
};

export const renderAttendanceMonthlyHistory = (selectedMonthKey, allHistoryData) => {
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

    renderAggregatedAttendanceSummary(view, monthlyData, selectedMonthKey, 'monthly');
};