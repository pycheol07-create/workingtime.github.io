// === ui-history-attendance.js (근태 이력 렌더링 담당) ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, calculateDateDifference } from './utils.js';

/**
 * 근태 이력 - 일별 상세 렌더링
 * (ui-history.js -> ui-history-attendance.js)
 */
export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    const data = allHistoryData.find(d => d.id === dateKey);

    // ✅ [수정] 엑셀 다운로드 버튼 제거 (상단으로 이동됨)
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

    const leaveEntries = data.onLeaveMembers;
    // 1. 정렬 (이름 -> 시작시간/날짜 -> 유형)
    leaveEntries.sort((a, b) => {
        if (a.member !== b.member) return (a.member || '').localeCompare(b.member || '');
        if ((a.startTime || a.startDate) !== (b.startTime || b.startDate)) {
             return (a.startTime || a.startDate || '').localeCompare(b.startTime || b.startDate || '');
        }
        return (a.type || '').localeCompare(b.type || '');
    });


    // 2. 근태 기록을 멤버별로 그룹화 (원본 인덱스 포함)
    const groupedEntries = new Map();
    leaveEntries.forEach((entry, index) => {
        const member = entry.member || 'N/A';
        if (!groupedEntries.has(member)) {
            groupedEntries.set(member, []);
        }
        groupedEntries.get(member).push({ ...entry, originalIndex: index });
    });

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

    // 3. 그룹화된 데이터를 기반으로 테이블 생성
    let isFirstMemberGroup = true; 

    groupedEntries.forEach((entries, member) => {
        const memberEntryCount = entries.length;

        entries.forEach((entry, entryIndex) => {
            // 4. 상세 시간/기간 텍스트 계산
            let detailText = '-';
            if (entry.startTime) {
                detailText = formatTimeTo24H(entry.startTime);
                
                if (entry.type === '외출') {
                    if (entry.endTime) {
                        detailText += ` ~ ${formatTimeTo24H(entry.endTime)}`;
                    } else {
                        detailText += ' ~';
                    }
                }

            } else if (entry.startDate) {
                detailText = entry.startDate;
                if (entry.endDate && entry.endDate !== entry.startDate) {
                    detailText += ` ~ ${entry.endDate}`;
                }
            }

            const isFirstRowOfGroup = (entryIndex === 0);
            const rowClass = `bg-white hover:bg-gray-50 ${isFirstRowOfGroup && !isFirstMemberGroup ? 'border-t' : ''}`;

            html += `<tr class="${rowClass}">`;
            
            if (isFirstRowOfGroup) {
                html += `<td class="px-6 py-4 font-medium text-gray-900 align-top" rowspan="${memberEntryCount}">${member}</td>`;
            }

            html += `
                <td class="px-6 py-4">${entry.type}</td>
                <td class="px-6 py-4">${detailText}</td>
                <td class="px-6 py-4 text-right space-x-2">
                    <button data-action="edit-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="font-medium text-blue-500 hover:underline">수정</button>
                    <button data-action="delete-attendance" data-date-key="${dateKey}" data-index="${entry.originalIndex}" class="font-medium text-red-500 hover:underline">삭제</button>
                </td>
            </tr>
            `;
        });
        
        isFirstMemberGroup = false; 
    });

    html += `
                </tbody>
            </table>
        </div>
    `;

    view.innerHTML = html;
};

/**
 * 주별/월별 근태 요약 렌더링 (공통 헬퍼)
 * (ui-history.js -> ui-history-attendance.js)
 * ✅ [수정] 테이블 포맷 변경 (이름, 지각, 외출, 조퇴, 결근, 연차, 출장, 총 횟수, 총 결근일수, 총 연차일수)
 */
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey) => {
    
    const data = aggregationMap[periodKey];
    if (!data) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">${periodKey} 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    // 1. 멤버별 데이터 집계
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

        // 타입별 카운트 증가
        if (summary[member].counts.hasOwnProperty(type)) {
            summary[member].counts[type] += 1;
        } else if (type) {
            // 정의되지 않은 타입(예: 커스텀)이 있다면 추가
            summary[member].counts[type] = (summary[member].counts[type] || 0) + 1;
        }
        
        summary[member].totalCount += 1;

        // 일수 계산
        if (type === '결근') {
            const days = calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            summary[member].totalAbsenceDays += days;
        } else if (type === '연차') {
            const days = calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
            summary[member].totalLeaveDays += days;
        }
    });

    // 2. HTML 테이블 생성
    let html = `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                <h3 class="text-xl font-bold mb-4 text-gray-800">${periodKey} 근태 요약</h3>
                <div class="overflow-x-auto">
                    <table class="w-full text-sm text-left text-gray-600 border border-gray-200">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100">
                            <tr>
                                <th scope="col" class="px-4 py-3 border-b sticky left-0 bg-gray-100 z-10">이름</th>
                                <th scope="col" class="px-4 py-3 border-b text-center">지각</th>
                                <th scope="col" class="px-4 py-3 border-b text-center">외출</th>
                                <th scope="col" class="px-4 py-3 border-b text-center">조퇴</th>
                                <th scope="col" class="px-4 py-3 border-b text-center">결근</th>
                                <th scope="col" class="px-4 py-3 border-b text-center">연차</th>
                                <th scope="col" class="px-4 py-3 border-b text-center">출장</th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-indigo-600">총 횟수</th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-red-600">총 결근일수</th>
                                <th scope="col" class="px-4 py-3 border-b text-center font-bold text-blue-600">총 연차일수</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-200">`;

    if (Object.keys(summary).length === 0) {
         html += `<tr><td colspan="10" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    } else {
        // 멤버 이름순 정렬
        Object.values(summary).sort((a, b) => a.member.localeCompare(b.member)).forEach(item => {
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

    // 2. 공통 헬퍼 함수로 렌더링 위임
    renderAggregatedAttendanceSummary(view, weeklyData, selectedWeekKey);
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

    // 2. 공통 헬퍼 함수로 렌더링 위임
    renderAggregatedAttendanceSummary(view, monthlyData, selectedMonthKey);
};