// === js/ui-history-attendance.js (근태 이력 렌더링 담당 - 정렬/필터 추가) ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, calculateDateDifference } from './utils.js';
// ✅ [신규] 상태(정렬/필터) 참조를 위해 context 임포트
import { context } from './state.js';

/**
 * 헬퍼: 정렬 아이콘 생성
 */
const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 text-[10px] ml-1">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 text-[10px] ml-1">▼</span>';
};

/**
 * 근태 이력 - 일별 상세 렌더링
 * (ui-history.js -> ui-history-attendance.js)
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

    // --- 1. 필터링 및 정렬 로직 적용 ---
    let leaveEntries = [...data.onLeaveMembers];
    const filterState = context.attendanceFilterState.daily;
    const sortState = context.attendanceSortState.daily;

    // 1-1. 필터링
    if (filterState.member) {
        const term = filterState.member.toLowerCase();
        leaveEntries = leaveEntries.filter(e => (e.member || '').toLowerCase().includes(term));
    }
    if (filterState.type) {
        const term = filterState.type.toLowerCase();
        leaveEntries = leaveEntries.filter(e => (e.type || '').toLowerCase().includes(term));
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

    // --- 2. 테이블 헤더 생성 (정렬/필터 UI 포함) ---
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <table class="w-full text-sm text-left text-gray-600">
                <thead class="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                    <tr>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none" data-sort-target="daily" data-sort-key="member">
                            이름 ${getSortIcon(sortState.key, sortState.dir, 'member')}
                        </th>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none" data-sort-target="daily" data-sort-key="type">
                            유형 ${getSortIcon(sortState.key, sortState.dir, 'type')}
                        </th>
                        <th scope="col" class="px-6 py-3 cursor-pointer hover:bg-gray-100 transition select-none" data-sort-target="daily" data-sort-key="time">
                            시간 / 기간 ${getSortIcon(sortState.key, sortState.dir, 'time')}
                        </th>
                        <th scope="col" class="px-6 py-3 text-right">관리</th>
                    </tr>
                    <tr class="bg-gray-50 border-b">
                        <th class="px-6 py-2">
                            <input type="text" class="w-full p-1 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500" 
                                   placeholder="이름 검색..." 
                                   value="${filterState.member || ''}"
                                   data-filter-target="daily" data-filter-key="member">
                        </th>
                        <th class="px-6 py-2">
                            <select class="w-full p-1 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                                    data-filter-target="daily" data-filter-key="type">
                                <option value="">전체</option>
                                <option value="연차" ${filterState.type === '연차' ? 'selected' : ''}>연차</option>
                                <option value="외출" ${filterState.type === '외출' ? 'selected' : ''}>외출</option>
                                <option value="조퇴" ${filterState.type === '조퇴' ? 'selected' : ''}>조퇴</option>
                                <option value="결근" ${filterState.type === '결근' ? 'selected' : ''}>결근</option>
                                <option value="출장" ${filterState.type === '출장' ? 'selected' : ''}>출장</option>
                            </select>
                        </th>
                        <th class="px-6 py-2"></th>
                        <th class="px-6 py-2"></th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (leaveEntries.length === 0) {
        html += `<tr><td colspan="4" class="px-6 py-8 text-center text-gray-500">조건에 맞는 기록이 없습니다.</td></tr>`;
        html += `</tbody></table></div>`;
        view.innerHTML = html;
        return;
    }

    // --- 3. 테이블 바디 생성 ---
    // ※ 주의: 이름순 정렬일 때만 'rowspan' 그룹화 적용. 그 외 정렬은 평문 리스트로 표시.
    const isGroupedView = (sortState.key === 'member');

    if (isGroupedView) {
        // 그룹화 로직 (기존 유지)
        const groupedEntries = new Map();
        leaveEntries.forEach((entry) => {
            // 원본 배열에서의 인덱스를 찾아야 삭제/수정이 정확함
            // (필터링된 배열의 인덱스가 아님)
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
                    html += `<td class="px-6 py-4 font-medium text-gray-900 align-top border-r border-gray-100" rowspan="${memberEntryCount}">${member}</td>`;
                }
                html += `
                    <td class="px-6 py-4">${entry.type}</td>
                    <td class="px-6 py-4 text-gray-600">${detailText}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="font-medium text-blue-500 hover:underline">수정</button>
                        <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="font-medium text-red-500 hover:underline">삭제</button>
                    </td>
                </tr>`;
            });
            isFirstMemberGroup = false; 
        });

    } else {
        // 평문 리스트 뷰 (이름 정렬 아닐 때)
        leaveEntries.forEach((entry) => {
            const originalIndex = data.onLeaveMembers.indexOf(entry);
            const detailText = _formatDetailText(entry);
            
            html += `
                <tr class="bg-white border-b hover:bg-gray-50 last:border-b-0">
                    <td class="px-6 py-4 font-medium text-gray-900">${entry.member}</td>
                    <td class="px-6 py-4">${entry.type}</td>
                    <td class="px-6 py-4 text-gray-600">${detailText}</td>
                    <td class="px-6 py-4 text-right space-x-2">
                        <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${originalIndex}" class="font-medium text-blue-500 hover:underline">수정</button>
                        <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${originalIndex}" class="font-medium text-red-500 hover:underline">삭제</button>
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
 * 주별/월별 근태 요약 렌더링 (공통 헬퍼)
 * (ui-history.js -> ui-history-attendance.js)
 * ✅ [수정] 정렬/필터 적용
 */
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey, mode) => {
    // mode: 'weekly' or 'monthly'
    const data = aggregationMap[periodKey];
    if (!data) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">${periodKey} 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    const sortState = context.attendanceSortState[mode];
    const filterState = context.attendanceFilterState[mode];

    // 1. 멤버별 데이터 집계
    let summary = []; // 배열로 변경 (정렬 용이)
    const memberMap = {};

    data.leaveEntries.forEach(entry => {
        const member = entry.member;
        // 필터링 (집계 전 단계에서 필터링하면 통계가 왜곡될 수 있으니, 집계 후 보여줄 때 필터링하는 게 나음.
        // 하지만 '목록 필터'라면 멤버 이름으로 필터링하는 것이 직관적.)
        
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
            const days = calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            rec.totalAbsenceDays += days;
        } else if (type === '연차') {
            const days = calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            rec.totalLeaveDays += days;
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
        
        if (k === 'member') {
            valA = a.member; valB = b.member;
        } else if (k === 'totalCount') {
            valA = a.totalCount; valB = b.totalCount;
        } else if (k === 'totalAbsenceDays') {
            valA = a.totalAbsenceDays; valB = b.totalAbsenceDays;
        } else if (k === 'totalLeaveDays') {
            valA = a.totalLeaveDays; valB = b.totalLeaveDays;
        } else {
            // 개별 타입 카운트 (지각, 외출 등)
            valA = a.counts[k] || 0; valB = b.counts[k] || 0;
        }

        if (valA < valB) return sortState.dir === 'asc' ? -1 : 1;
        if (valA > valB) return sortState.dir === 'asc' ? 1 : -1;
        return 0;
    });


    // 4. HTML 테이블 생성
    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                <h3 class="text-xl font-bold mb-4 text-gray-800">${periodKey} 근태 요약</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                            <tr>
                                <th scope="col" class="px-4 py-3 border-b sticky left-0 bg-gray-100 z-10 cursor-pointer hover:bg-gray-200 select-none" 
                                    data-sort-target="${mode}" data-sort-key="member">
                                    이름 ${getSortIcon(sortState.key, sortState.dir, 'member')}
                                </th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="지각">지각 ${getSortIcon(sortState.key, sortState.dir, '지각')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="외출">외출 ${getSortIcon(sortState.key, sortState.dir, '외출')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="조퇴">조퇴 ${getSortIcon(sortState.key, sortState.dir, '조퇴')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="결근">결근 ${getSortIcon(sortState.key, sortState.dir, '결근')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="연차">연차 ${getSortIcon(sortState.key, sortState.dir, '연차')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="출장">출장 ${getSortIcon(sortState.key, sortState.dir, '출장')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-indigo-600 cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="totalCount">총 횟수 ${getSortIcon(sortState.key, sortState.dir, 'totalCount')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-red-600 cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="totalAbsenceDays">총 결근일수 ${getSortIcon(sortState.key, sortState.dir, 'totalAbsenceDays')}</th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-blue-600 cursor-pointer hover:bg-gray-200 select-none" data-sort-target="${mode}" data-sort-key="totalLeaveDays">총 연차일수 ${getSortIcon(sortState.key, sortState.dir, 'totalLeaveDays')}</th>
                            </tr>
                            <tr class="bg-gray-50">
                                <th class="px-2 py-2 sticky left-0 bg-gray-50 z-10 border-b">
                                    <input type="text" class="w-full p-1 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500"
                                           placeholder="이름 검색..."
                                           value="${filterState.member || ''}"
                                           data-filter-target="${mode}" data-filter-key="member">
                                </th>
                                <th colspan="9" class="border-b"></th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">`;

    if (summary.length === 0) {
         html += `<tr><td colspan="10" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    } else {
        summary.forEach(item => {
            html += `
                <tr class="bg-white hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium text-gray-900 sticky left-0 bg-white">${item.member}</td>
                    <td class="px-4 py-3 text-center ${item.counts['지각'] > 0 ? 'text-red-500 font-semibold' : 'text-gray-400'}">${item.counts['지각']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['외출'] > 0 ? 'text-gray-800' : 'text-gray-400'}">${item.counts['외출']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['조퇴'] > 0 ? 'text-gray-800' : 'text-gray-400'}">${item.counts['조퇴']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['결근'] > 0 ? 'text-red-600 font-bold' : 'text-gray-400'}">${item.counts['결근']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['연차'] > 0 ? 'text-blue-600 font-bold' : 'text-gray-400'}">${item.counts['연차']}</td>
                    <td class="px-4 py-3 text-center ${item.counts['출장'] > 0 ? 'text-gray-800' : 'text-gray-400'}">${item.counts['출장']}</td>
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

/**
 * 근태 이력 - 주별 요약 렌더링
 * (ui-history.js -> ui-history-attendance.js)
 */
export const renderAttendanceWeeklyHistory = (selectedWeekKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    // 1. 주별 데이터 집계
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

    // 2. 공통 헬퍼 함수로 렌더링 위임 (mode='weekly' 추가)
    renderAggregatedAttendanceSummary(view, weeklyData, selectedWeekKey, 'weekly');
};

/**
 * 근태 이력 - 월별 요약 렌더링
 * (ui-history.js -> ui-history-attendance.js)
 */
export const renderAttendanceMonthlyHistory = (selectedMonthKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    // 1. 월별 데이터 집계
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

    // 2. 공통 헬퍼 함수로 렌더링 위임 (mode='monthly' 추가)
    renderAggregatedAttendanceSummary(view, monthlyData, selectedMonthKey, 'monthly');
};