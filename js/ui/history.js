// === js/ui/history.js ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, isWeekday } from '../utils.js';

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


// === ui.js (수정 2/3) ===
// (기존 renderSummaryView 함수를 아래 코드로 통째로 교체)

const renderSummaryView = (mode, dataset, periodKey, wageMap = {}, previousPeriodDataset = null) => {
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
    
    // ✅ [수정] 스크롤 타겟을 위한 ID 추가
    let html = `<div id="summary-card-${periodKey}" class="bg-white p-4 rounded-lg shadow-sm mb-6 scroll-mt-4">`;
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
            // 이전 주 데이터 찾기 (sortedWeeks가 내림차순 정렬이므로 index + 1이 이전 주)
            const prevWeekKey = sortedWeeks[index + 1] || null;
            const prevData = prevWeekKey ? weeklyData[prevWeekKey] : null;
            
            return renderSummaryView('weekly', currentData, weekKey, combinedWageMap, prevData);
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

        // ✅ [수정] map 콜백에서 index를 사용해 prevData 전달
        view.innerHTML = sortedMonths.map((monthKey, index) => {
            const currentData = monthlyData[monthKey];
            // 이전 월 데이터 찾기 (sortedMonths가 내림차순 정렬이므로 index + 1이 이전 월)
            const prevMonthKey = sortedMonths[index + 1] || null;
            const prevData = prevMonthKey ? monthlyData[prevMonthKey] : null;
            
            return renderSummaryView('monthly', currentData, monthKey, combinedWageMap, prevData);
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
            <div>
                <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm"
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

            // [수정] '연차', '출장', '결근'은 date-based (날짜 기반)
            if (['연차', '출장', '결근'].includes(entry.type)) {
                 // 이 entry는 하루에 하나씩 추가되므로, count가 곧 days임.
                 acc[key].count += 1;
            } 
            // [수정] '외출', '조퇴'는 time-based (시간 기반)
            else if (['외출', '조퇴'].includes(entry.type)) {
                 acc[key].count += 1;
            }
            // (기타 유형도 count)
            
            return acc;
        }, {});

        // [수정] '일' 단위와 '회' 단위 구분
        Object.values(summary).forEach(item => {
             if (['연차', '출장', '결근'].includes(item.type)) {
                 item.days = item.count; // '일' 단위
             } else {
                 item.days = 0; // '회' 단위 (days는 0으로)
             }
        });

        html += `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                    <h3 class="text-xl font-bold mb-3">${periodKey}</h3>
                    <div class="space-y-1">`;

        if (Object.keys(summary).length === 0) {
             html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
        } else {
            Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
                 html += `<div class="flex justify-between text-sm">
                            <span class="font-semibold text-gray-700">${item.member}</span>
                            <span>${item.type}</span>
                            <span class="text-right">${item.days > 0 ? `${item.days}일` : `${item.count}회`}</span>
                         </div>`;
            });
        }
        html += `</div></div>`;
    });

    viewElement.innerHTML = html;
};

export const renderAttendanceWeeklyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    // 주별 데이터 집계 로직
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

    // ✅ [수정] 공통 헬퍼 함수로 렌더링 위임 (기존 중복 로직 삭제)
    renderAggregatedAttendanceSummary(view, weeklyData);
};

export const renderAttendanceMonthlyHistory = (allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    // 월별 데이터 집계 로직
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

    // ✅ [수정] 공통 헬퍼 함수로 렌더링 위임 (기존 중복 로직 삭제)
    renderAggregatedAttendanceSummary(view, monthlyData);
};

// ✅ [추가] app.js에 있던 renderHistoryDetail 함수를 여기로 이동
/**
 * 이력 보기 모달의 '일별 상세' 탭을 렌더링합니다.
 * (app.js에서 이 함수를 import해서 사용해야 합니다.)
 */
export const renderHistoryDetail = (dateKey, previousDayData = null, allHistoryData, appConfig) => {
  const view = document.getElementById('history-daily-view');
  if (!view) return;
  view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';
  
  const data = allHistoryData.find(d => d.id === dateKey);
  if (!data) { 
      view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>'; 
      return; 
  }

  const records = data.workRecords || [];
  const quantities = data.taskQuantities || {};
  const onLeaveMemberEntries = data.onLeaveMembers || [];
  const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
  const partTimersFromHistory = data.partTimers || [];

  const wageMap = { ...appConfig.memberWages };
  partTimersFromHistory.forEach(pt => {
      if (!wageMap[pt.name]) {
          wageMap[pt.name] = pt.wage || 0;
      }
  });

  const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
  const activeMembersCount = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length
                           + partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;

  // --- 1. 현재일(Current) 데이터 계산 ---
  const totalSumDuration = records.reduce((sum, r) => sum + (r.duration || 0), 0);
  const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

  const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});
  
  const taskCosts = records.reduce((acc, rec) => {
      const wage = wageMap[rec.member] || 0;
      const cost = ((Number(rec.duration) || 0) / 60) * wage;
      acc[rec.task] = (acc[rec.task] || 0) + cost;
      return acc;
  }, {});
  
  const taskMetrics = {};
  const allTaskKeys = new Set([...Object.keys(taskDurations), ...Object.keys(quantities)]);
  allTaskKeys.forEach(task => {
      const duration = taskDurations[task] || 0;
      const cost = taskCosts[task] || 0;
      const qty = Number(quantities[task]) || 0;
      
      taskMetrics[task] = {
          duration: duration,
          cost: cost,
          quantity: qty,
          avgThroughput: duration > 0 ? (qty / duration) : 0,
          avgCostPerItem: qty > 0 ? (cost / qty) : 0
      };
  });


  // --- 2. 전일(Previous) 데이터 계산 ---
  let prevTaskMetrics = {};
  if (previousDayData) {
      const prevRecords = previousDayData.workRecords || [];
      const prevQuantities = previousDayData.taskQuantities || {};

      const prevTaskDurations = prevRecords.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (rec.duration || 0); return acc; }, {});
      
      const prevTaskCosts = prevRecords.reduce((acc, rec) => {
          const wage = wageMap[rec.member] || 0;
          const cost = ((Number(rec.duration) || 0) / 60) * wage;
          acc[rec.task] = (acc[rec.task] || 0) + cost;
          return acc;
      }, {});

      const allPrevTaskKeys = new Set([...Object.keys(prevTaskDurations), ...Object.keys(prevQuantities)]);
      allPrevTaskKeys.forEach(task => {
          const duration = prevTaskDurations[task] || 0;
          const cost = prevTaskCosts[task] || 0;
          const qty = Number(prevQuantities[task]) || 0;
          
          prevTaskMetrics[task] = {
              duration: duration,
              cost: cost,
              quantity: qty,
              avgThroughput: duration > 0 ? (qty / duration) : 0,
              avgCostPerItem: qty > 0 ? (cost / qty) : 0
          };
      });
  }

  // --- 3. HTML 렌더링 ---
  // (getDiffHtmlForMetric 함수는 이미 ui/history.js에 존재)
  
  const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

  let nonWorkHtml = '';
  // (isWeekday 함수는 app.js에서 import 해야 함)
  // -> [수정] isWeekday는 utils.js에 있습니다.
  //    ui/history.js 상단에 import { isWeekday } from '../utils.js'가 필요합니다.
  //    (일단은 app.js에서 호출한다고 가정하고 진행)
  
  // [재수정] ui.js 분리 시 utils.js import가 이미 되어있으므로
  // 이 함수는 utils.js의 isWeekday를 사용할 수 있습니다.
  
  // [최종 수정] 앗, ui/history.js 상단에 isWeekday가 import 안되어있네요.
  // 상단의 import 구문에 isWeekday를 추가해주세요.
  // import { formatTimeTo24H, formatDuration, getWeekOfYear, isWeekday } from '../utils.js';
  // (위 코드에서 isWeekday 추가됨)
  
  // (비업무 시간 계산 - utils.js의 isWeekday 사용)
  const isWeekday = (dateString) => { // 임시
       const date = new Date(dateString + 'T00:00:00');
       const day = date.getDay();
       return day >= 1 && day <= 5;
  };

  if (isWeekday(dateKey)) {
    const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간 기준
    const nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalSumDuration);
    const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes)}</p><p class="text-xs text-gray-500 mt-1">(추정치, ${percentage}%)</p></div>`;
  } else {
    nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px] flex flex-col justify-center items-center"><h4 class="text-sm font-semibold text-gray-500">총 비업무시간</h4><p class="text-lg font-bold text-gray-400">주말</p></div>`;
  }

  let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey} (전일 대비)</h3>
      <div>
        <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm" onclick="openHistoryQuantityModal('${dateKey}')">처리량 수정</button>
        <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="downloadHistoryAsExcel('${dateKey}')">엑셀 (전체)</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" onclick="requestHistoryDeletion('${dateKey}')">삭제</button>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">근무 인원</h4><p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
      ${nonWorkHtml}
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
    </div>
  `;
  
  html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;
  
  // 1. 업무별 처리량 (Quantity)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasQuantities = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0)
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasQuantities = true;
      const prevQty = prevTaskMetrics[task]?.quantity || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('quantity', metrics.quantity, prevQty) : '';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.quantity} 개 ${diffHtml}</span>
               </div>`;
    });
  if (!hasQuantities) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  // 2. 업무별 분당 처리량 (Throughput)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasThroughput = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0) // 처리량이 있는 것만 표시
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasThroughput = true;
      const prevThroughput = prevTaskMetrics[task]?.avgThroughput || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevThroughput) : '';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgThroughput.toFixed(2)} 개/분 ${diffHtml}</span>
               </div>`;
    });
  if (!hasThroughput) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
  html += `</div></div>`;

  // 3. 업무별 개당 처리비용 (CostPerItem)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
  let hasCostPerItem = false;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.quantity > 0) // 처리량이 있는 것만 표시
    .sort(([a],[b]) => a.localeCompare(b))
    .forEach(([task, metrics]) => {
      hasCostPerItem = true;
      const prevCostPerItem = prevTaskMetrics[task]?.avgCostPerItem || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevCostPerItem) : '';
      html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgCostPerItem.toFixed(0)} 원/개 ${diffHtml}</span>
               </div>`;
    });
  if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
  html += `</div></div>`;
  html += `</div>`; // grid 닫기

  // 4. 업무별 시간 비중 (Duration)
  html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 시간 비중</h4><div class="space-y-3">`;
  Object.entries(taskMetrics)
    .filter(([, metrics]) => metrics.duration > 0)
    .sort(([,a],[,b]) => b.duration - a.duration)
    .forEach(([task, metrics]) => {
      const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
      const prevDuration = prevTaskMetrics[task]?.duration || 0;
      const diffHtml = previousDayData ? getDiffHtmlForMetric('duration', metrics.duration, prevDuration) : ''; 
      
      html += `
        <div>
          <div class="flex justify-between items-center mb-1 text-sm">
            <span class="font-semibold text-gray-600">${task}</span>
            <span>${formatDuration(metrics.duration)} (${percentage}%) ${diffHtml}</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
        </div>`;
    });
  if (Object.values(taskMetrics).every(m => (m.duration || 0) <= 0)) {
    html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
  }
  html += `</div></div>`;

  view.innerHTML = html;
};