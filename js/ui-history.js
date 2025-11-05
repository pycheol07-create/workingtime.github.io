// === ui-history.js (이력 보기 렌더링 담당) ===

import { formatTimeTo24H, formatDuration, getWeekOfYear, isWeekday } from './utils.js';
// ⛔️ [삭제] ui.js에서 헬퍼 함수 가져오기 (아래에 직접 정의)
// import { getDiffHtmlForMetric } from './ui.js';

// ================== [ ✨ 수정된 부분 1 ✨ ] ==================
// (getDiffHtmlForMetric 헬퍼 함수는 이전과 동일하게 유지합니다)
const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = current || 0;
    const prevValue = previous || 0;

    if (prevValue === 0) {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return ''; // 둘 다 0
    }
    
    const diff = currValue - prevValue;
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
    
    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';
    
    // [ ✨✨✨ 핵심 수정 ✨✨✨ ]
    // (모든 +는 green, 모든 -는 red로 통일)
    let colorClass = 'text-gray-500';
    // ✅ [수정] 효율성 지표(avgThroughput, quantity, avgStaff)는 높을수록 좋음
    if (['avgThroughput', 'quantity', 'avgStaff', 'totalQuantity'].includes(metric)) {
        colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
    } 
    // ✅ [수정] 비용 지표(avgCostPerItem, duration, totalCost, nonWorkTime)는 낮을수록 좋음
    else if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'activeMembersCount'].includes(metric)) {
        colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
    }
    
    let diffStr = '';
    let prevStr = '';
    // [ ✨ 수정 ✨ ] (포맷팅)
    if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    // [ ✨ 수정 ✨ ] (포맷팅)
    } else if (metric === 'avgStaff' || metric === 'avgCostPerItem' || metric === 'quantity' || metric === 'totalQuantity' || metric === 'totalCost' || metric === 'overallAvgCostPerItem' || metric === 'activeMembersCount') {
        diffStr = Math.round(Math.abs(diff)).toLocaleString(); // 👈 .toFixed(0) -> .toLocaleString()
        prevStr = Math.round(prevValue).toLocaleString();
    } else { // avgThroughput, overallAvgThroughput
        diffStr = Math.abs(diff).toFixed(2);
        prevStr = prevValue.toFixed(2);
    }

    return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                ${sign} ${diffStr} (${percent.toFixed(0)}%)
            </span>`;
};
// =========================================================


// ✅ [수정] renderSummaryView (ui.js -> ui-history.js)
const renderSummaryView = (mode, dataset, periodKey, wageMap = {}, previousPeriodDataset = null) => {
    const records = dataset.workRecords || [];
    const quantities = dataset.taskQuantities || {};

    // --- 1. 이전 기간(Previous) 데이터 계산 ---
    let prevTaskSummary = {};
    // ================== [ ✨ 추가된 부분 2 ✨ ] ==================
    // (이전 기간의 '총계' 계산)
    let prevTotalDuration = 0;
    let prevTotalQuantity = 0;
    let prevTotalCost = 0;
    let prevOverallAvgThroughput = 0;
    let prevOverallAvgCostPerItem = 0;
    // =========================================================

    if (previousPeriodDataset) {
        const prevRecords = previousPeriodDataset.workRecords || [];
        const prevQuantities = previousPeriodDataset.taskQuantities || {};

        // ================== [ ✨ 추가된 부분 3 ✨ ] ==================
        // (이전 기간의 '총계' 값 할당)
        prevTotalDuration = prevRecords.reduce((s, r) => s + (r.duration || 0), 0);
        prevTotalQuantity = Object.values(prevQuantities).reduce((s, q) => s + (Number(q) || 0), 0);
        prevTotalCost = prevRecords.reduce((s, r) => {
            const wage = wageMap[r.member] || 0;
            return s + ((r.duration || 0) / 60) * wage;
        }, 0);
        prevOverallAvgThroughput = prevTotalDuration > 0 ? (prevTotalQuantity / prevTotalDuration) : 0;
        prevOverallAvgCostPerItem = prevTotalQuantity > 0 ? (prevTotalCost / prevTotalQuantity) : 0;
        // =========================================================

        // 1a. 이전 기간 Reduce (업무별)
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

        // 1b. 이전 기간 Post-process (업무별)
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

    // [ ✨ 수정 ✨ ] (비교를 위해 숫자형(Num)과 문자열(Str) 분리)
    const overallAvgThroughputNum = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const overallAvgCostPerItemNum = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;

    const overallAvgThroughputStr = overallAvgThroughputNum.toFixed(2);
    const overallAvgCostPerItemStr = overallAvgCostPerItemNum.toFixed(0);

    // 2a. 현재 기간 Reduce (업무별)
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

    // 2b. 현재 기간 Post-process (업무별)
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
    
    // ================== [ ✨ 추가된 부분 4 ✨ ] ==================
    // (총계 카드에 들어갈 증감 HTML 생성)
    const durationDiff = previousPeriodDataset ? getDiffHtmlForMetric('totalDuration', totalDuration, prevTotalDuration) : '';
    const quantityDiff = previousPeriodDataset ? getDiffHtmlForMetric('totalQuantity', totalQuantity, prevTotalQuantity) : '';
    const costDiff = previousPeriodDataset ? getDiffHtmlForMetric('totalCost', totalCost, prevTotalCost) : '';
    const throughputDiff = previousPeriodDataset ? getDiffHtmlForMetric('overallAvgThroughput', overallAvgThroughputNum, prevOverallAvgThroughput) : '';
    const costPerItemDiff = previousPeriodDataset ? getDiffHtmlForMetric('overallAvgCostPerItem', overallAvgCostPerItemNum, prevOverallAvgCostPerItem) : '';
    // =========================================================

    let html = `<div id="summary-card-${periodKey}" class="bg-white p-4 rounded-lg shadow-sm mb-6 scroll-mt-4">`;
    html += `<h3 class="text-xl font-bold mb-4">${periodKey} 요약</h3>`;

    // ================== [ ✨ 수정된 부분 5 ✨ ] ==================
    // (총계 카드 HTML 구조 변경: <div>와 증감 {diff} 변수 추가)
    html += `<div class="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6 text-center">
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">총 시간</div>
            <div class="text-lg font-bold">${formatDuration(totalDuration)}</div>
            ${durationDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">총 처리량</div>
            <div class="text-lg font-bold">${totalQuantity.toLocaleString()} 개</div>
            ${quantityDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">총 인건비</div>
            <div class="text-lg font-bold">${Math.round(totalCost).toLocaleString()} 원</div>
            ${costDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">평균 처리량</div>
            <div class="text-lg font-bold">${overallAvgThroughputStr} 개/분</div>
            ${throughputDiff}
        </div>
        <div class="bg-gray-50 p-3 rounded">
            <div class="text-xs text-gray-500">평균 처리비용</div>
            <div class="text-lg font-bold">${overallAvgCostPerItemStr} 원/개</div>
            ${costPerItemDiff}
        </div>
    </div>`;
    // =========================================================

    html += `<h4 class="text-lg font-semibold mb-3 text-gray-700">업무별 평균 (
                ${previousPeriodDataset ? (mode === 'weekly' ? '전주' : '전월') + ' 대비' : '이전 데이터 없음'}
            )</h4>`;
    
    // (기존 주석 삭제됨)
    html += `<div class="overflow-x-auto max-h-[60vh]">
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

                // [ ✨ 수정 ✨ ] (테이블 증감 계산 시 getDiffHtmlForMetric을 올바르게 호출)
                const tableThroughputDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgThroughput', summary.avgThroughput, prevSummary?.avgThroughput) : '';
                const tableCostDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgCostPerItem', summary.avgCostPerItem, prevSummary?.avgCostPerItem) : '';
                const tableStaffDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgStaff', summary.avgStaff, prevSummary?.avgStaff) : '';
                const tableTimeDiff = previousPeriodDataset ? getDiffHtmlForMetric('avgTime', summary.avgTime, prevSummary?.avgTime) : '';

                html += `<tr class="bg-white border-b hover:bg-gray-50">
                           <td class="px-4 py-2 font-medium text-gray-900">${task}</td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgThroughput.toFixed(2)}</div>
                                ${tableThroughputDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgCostPerItem.toFixed(0)}</div>
                                ${tableCostDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${summary.avgStaff}</div>
                                ${tableStaffDiff}
                           </td>
                           <td class="px-4 py-2 text-right">
                                <div>${formatDuration(summary.avgTime)}</div>
                                ${tableTimeDiff}
                           </td>
                         </tr>`;
            }
        });
    }

    if (!hasTaskData) {
        html += `<tr><td colspan="5" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }

    html += `    </tbody>
               </table>
             </div>`;

    html += `</div>`;
    return html;
};

/**
 * ================== [ ✨ 수정된 함수 ✨ ] ==================
 * (선택한 '주'의 데이터만 렌더링하도록 수정)
 * @param {string} selectedWeekKey - 렌더링할 주 (예: "2025-W45")
 */
export const renderWeeklyHistory = (selectedWeekKey, allHistoryData, appConfig) => {
    const view = document.getElementById('history-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 데이터 집계 중...</div>';

    try {
        // 1. WageMap 생성 (변경 없음)
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // 2. 전체 주별 데이터 집계 (변경 없음)
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

        // 3. 렌더링 로직 수정 (선택한 주 + 이전 주 데이터 찾기)
        const sortedWeeks = Object.keys(weeklyData).sort((a,b) => b.localeCompare(a));
        
        const currentData = weeklyData[selectedWeekKey];
        if (!currentData) {
            view.innerHTML = `<div class="text-center text-gray-500">${selectedWeekKey} 주에 해당하는 데이터가 없습니다.</div>`;
            return;
        }
        
        // 이전 주 데이터 찾기
        const currentIndex = sortedWeeks.indexOf(selectedWeekKey);
        const prevWeekKey = (currentIndex > -1 && currentIndex + 1 < sortedWeeks.length) 
                            ? sortedWeeks[currentIndex + 1] 
                            : null;
        const prevData = prevWeekKey ? weeklyData[prevWeekKey] : null;
        
        // 4. 선택한 주의 데이터만 렌더링
        view.innerHTML = renderSummaryView('weekly', currentData, selectedWeekKey, combinedWageMap, prevData);

    } catch (error) {
        console.error("Error in renderWeeklyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">주별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
    }
};
// =========================================================

/**
 * ================== [ ✨ 수정된 함수 ✨ ] ==================
 * (선택한 '월'의 데이터만 렌더링하도록 수정)
 * @param {string} selectedMonthKey - 렌더링할 월 (예: "2025-10")
 */
export const renderMonthlyHistory = (selectedMonthKey, allHistoryData, appConfig) => {
    const view = document.getElementById('history-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 데이터 집계 중...</div>';

    try {
        // 1. WageMap 생성 (변경 없음)
        const historyWageMap = {};
        (allHistoryData || []).forEach(dayData => {
            (dayData.partTimers || []).forEach(pt => {
                 if (pt && pt.name && !historyWageMap[pt.name]) {
                     historyWageMap[pt.name] = pt.wage || 0;
                }
            });
        });
        const combinedWageMap = { ...historyWageMap, ...(appConfig.memberWages || {}) };

        // 2. 전체 월별 데이터 집계 (변경 없음)
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

        // 3. 렌더링 로직 수정 (선택한 월 + 이전 월 데이터 찾기)
        const sortedMonths = Object.keys(monthlyData).sort((a,b) => b.localeCompare(a));

        const currentData = monthlyData[selectedMonthKey];
        if (!currentData) {
            view.innerHTML = `<div class="text-center text-gray-500">${selectedMonthKey} 월에 해당하는 데이터가 없습니다.</div>`;
            return;
        }

        // 이전 월 데이터 찾기
        const currentIndex = sortedMonths.indexOf(selectedMonthKey);
        const prevMonthKey = (currentIndex > -1 && currentIndex + 1 < sortedMonths.length)
                             ? sortedMonths[currentIndex + 1]
                             : null;
        const prevData = prevMonthKey ? monthlyData[prevMonthKey] : null;
            
        // 4. 선택한 월의 데이터만 렌더링
        view.innerHTML = renderSummaryView('monthly', currentData, selectedMonthKey, combinedWageMap, prevData);
        
    } catch (error) {
        console.error("Error in renderMonthlyHistory:", error);
        view.innerHTML = '<div class="text-center text-red-500 p-4">월별 데이터를 표시하는 중 오류가 발생했습니다. 개발자 콘솔을 확인하세요.</div>';
    }
};
// =========================================================

/**
 * ✅ [수정] renderAttendanceDailyHistory (ui.js -> ui-history.js)
 * ✨ [수정] 개인별 그룹화 + 테두리(border-t) 로직으로 변경
 */
export const renderAttendanceDailyHistory = (dateKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">근태 기록 로딩 중...</div>';

    const data = allHistoryData.find(d => d.id === dateKey);

    // --- [ ✨ 수정된 부분 (onclick -> data-action) ✨ ] ---
    // (이 부분은 '처리량 수정' 버튼 등이 동작하도록 data-action을 사용합니다)
    let html = `
        <div class="mb-4 pb-2 border-b flex justify-between items-center">
            <h3 class="text-xl font-bold text-gray-800">${dateKey} 근태 현황</h3>
            <div>
                <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm"
                        data-action="open-add-attendance-modal" data-date-key="${dateKey}">
                    수동 추가
                </button>
                <button class="bg-green-600 hover:bg-green-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2"
                        data-action="download-attendance-excel" data-date-key="${dateKey}">
                    근태 엑셀 (전체)
                </button>
                <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2" 
                        data-action="request-history-deletion" data-date-key="${dateKey}">
                    삭제
                </button>
            </div>
        </div>
    `;
    // --- [ ✨ 수정 끝 ✨ ] ---
    

    // --- [ ✨ 수정된 부분 시작 (그룹화 + 테두리 로직) ✨ ] ---

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
    
    // [✨✨✨ 핵심 수정 ✨✨✨]
    // 첫 번째 멤버 그룹인지 확인하기 위한 플래그
    let isFirstMemberGroup = true; 

    groupedEntries.forEach((entries, member) => {
        const memberEntryCount = entries.length;

        entries.forEach((entry, entryIndex) => {
            // 4. 상세 시간/기간 텍스트 계산 (변경 없음)
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

            // [✨✨✨ 핵심 수정 ✨✨✨]
            // 각 멤버 그룹의 '첫 번째' 행인지 확인합니다.
            const isFirstRowOfGroup = (entryIndex === 0);
            
            // 첫 번째 행이면서, *전체 테이블의 첫 번째 멤버가 아니라면* 'border-t' (상단 테두리)를 추가합니다.
            const rowClass = `bg-white hover:bg-gray-50 ${isFirstRowOfGroup && !isFirstMemberGroup ? 'border-t' : ''}`;

            html += `<tr class="${rowClass}">`;
            
            // 5. 첫 번째 항목일 때만 '이름' 셀에 rowspan을 적용합니다.
            if (isFirstRowOfGroup) {
                // align-top (상단 정렬)을 추가하고, 불필요한 border 클래스를 제거합니다.
                html += `<td class="px-6 py-4 font-medium text-gray-900 align-top" rowspan="${memberEntryCount}">${member}</td>`;
            }

            // 6. 나머지 셀을 그립니다.
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
        
        // [✨✨✨ 핵심 수정 ✨✨✨]
        // 이 멤버 그룹의 렌더링이 끝났으므로, 다음 멤버는 더 이상 '첫 번째 멤버'가 아닙니다.
        isFirstMemberGroup = false; 
    });
    // --- [ ✨ 수정된 부분 끝 ✨ ] ---

    html += `
                </tbody>
            </table>
        </div>
    `;

    view.innerHTML = html;
};

/**
 * ================== [ ✨✨✨ 새 로직 적용 ✨✨✨ ] ==================
 * (주별/월별 근태 요약 렌더링을 위한 공통 헬퍼 함수)
 * (선택한 'periodKey'의 데이터만 렌더링하도록 수정)
 * (요청사항: 멤버별 그룹화)
 */
const renderAggregatedAttendanceSummary = (viewElement, aggregationMap, periodKey) => {
    
    const data = aggregationMap[periodKey];
    if (!data) {
        viewElement.innerHTML = `<div class="text-center text-gray-500">${periodKey} 기간의 근태 데이터가 없습니다.</div>`;
        return;
    }

    let html = '';
        
    // [✨✨✨ 핵심 수정 ✨✨✨]
    // 1. 근태 항목 집계 (member 기준)
    const summary = data.leaveEntries.reduce((acc, entry) => {
        const member = entry.member;
        const type = entry.type;
        
        if (!acc[member]) {
            acc[member] = { 
                member: member, 
                counts: {} // { '연차': 0, '외출': 0, ... }
            };
        }
        
        if (!acc[member].counts[type]) {
            acc[member].counts[type] = 0;
        }

        // '일' 단위와 '회' 단위를 구분하여 누적
        if (['연차', '출장', '결근'].includes(type)) {
             acc[member].counts[type] += 1; // '일'
        } 
        else if (['외출', '조퇴'].includes(type)) {
             acc[member].counts[type] += 1; // '회'
        }
        
        return acc;
    }, {});

    // 2. HTML 생성
    html += `<div class="bg-white p-4 rounded-lg shadow-sm mb-6">
                <h3 class="text-xl font-bold mb-3">${periodKey}</h3>
                <div class="space-y-3 max-h-[60vh] overflow-y-auto">`; // (max-h 추가, space-y-1 -> 3)

    if (Object.keys(summary).length === 0) {
         html += `<p class="text-sm text-gray-500">데이터 없음</p>`;
    } else {
        // 멤버 이름으로 정렬
        Object.values(summary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
            
            // 이 멤버의 근태 기록(counts)을 HTML로 변환
            const typesHtml = Object.entries(item.counts)
                .sort(([typeA], [typeB]) => typeA.localeCompare(typeB)) // 유형별로 정렬
                .map(([type, count]) => {
                    const unit = (['연차', '출장', '결근'].includes(type)) ? '일' : '회';
                    // 개별 항목 HTML
                    return `<div class="flex justify-between text-sm text-gray-700 pl-4">
                                <span>${type}</span>
                                <span class="text-right font-medium">${count}${unit}</span>
                            </div>`;
                }).join(''); // 하나의 HTML 문자열로 합침

             // 멤버별로 그룹화된 HTML 생성 (border-t로 구분)
             html += `
                <div class="border-t pt-2 first:border-t-0">
                    <div class="flex justify-between text-md mb-1">
                        <span class="font-semibold text-gray-900">${item.member}</span>
                    </div>
                    <div class="space-y-0.5">
                        ${typesHtml}
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`;
    // --- [ ✨✨✨ 수정 끝 ✨✨✨ ] ---

    viewElement.innerHTML = html;
};
// =========================================================

/**
 * ================== [ ✨ 수정된 함수 ✨ ] ==================
 * (선택한 '주'의 근태 데이터만 렌더링하도록 수정)
 * @param {string} selectedWeekKey - 렌더링할 주 (예: "2025-W45")
 */
export const renderAttendanceWeeklyHistory = (selectedWeekKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 근태 데이터 집계 중...</div>';

    // 1. 주별 데이터 집계 로직 (변경 없음)
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

    // 2. 공통 헬퍼 함수로 렌더링 위임 (선택한 키만 전달)
    renderAggregatedAttendanceSummary(view, weeklyData, selectedWeekKey);
};
// =========================================================

/**
 * ================== [ ✨ 수정된 함수 ✨ ] ==================
 * (선택한 '월'의 근태 데이터만 렌더링하도록 수정)
 * @param {string} selectedMonthKey - 렌더링할 월 (예: "2025-10")
 */
export const renderAttendanceMonthlyHistory = (selectedMonthKey, allHistoryData) => {
    const view = document.getElementById('history-attendance-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 근태 데이터 집계 중...</div>';

    // 1. 월별 데이터 집계 로직 (변경 없음)
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

    // 2. 공통 헬퍼 함수로 렌더링 위임 (선택한 키만 전달)
    renderAggregatedAttendanceSummary(view, monthlyData, selectedMonthKey);
};
// =========================================================


/**
 * [추가] 트렌드 분석용 일일 KPI 계산 헬퍼
 * (renderHistoryDetail의 계산 로직을 재사용 및 요약)
 */
function calculateDailyKPIs(dayData, appConfig) {
    const records = dayData.workRecords || [];
    const quantities = dayData.taskQuantities || {};
    const onLeaveMemberEntries = dayData.onLeaveMembers || [];
    const partTimersFromHistory = dayData.partTimers || [];

    // 1. WageMap 생성 (appConfig + 이력의 알바 정보)
    const wageMap = { ...(appConfig.memberWages || {}) };
    partTimersFromHistory.forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });

    // 2. 총 시간, 총 비용, 총 수량
    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0;
        return s + ((r.duration || 0) / 60) * wage;
    }, 0);

    // 3. KPI: 처리량, 비용
    const throughput = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const costPerItem = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;

    // 4. KPI: 비업무시간 (renderHistoryDetail 로직 재사용)
    let nonWorkTime = 0;
    if (isWeekday(dayData.id)) {
        const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
        const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
        
        const activeRegularMembers = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length;
        const activePartTimers = partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;
        const activeMembersCount = activeRegularMembers + activePartTimers;

        const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간(480분) 기준
        nonWorkTime = Math.max(0, totalPotentialMinutes - totalDuration);
    }

    return {
        throughput: parseFloat(throughput.toFixed(2)),
        costPerItem: parseFloat(costPerItem.toFixed(0)),
        nonWorkTime: parseFloat(nonWorkTime.toFixed(0))
    };
}

/**
 * ✅ [수정] renderTrendAnalysisCharts (ui.js -> ui-history.js)
 * (📈 트렌드 분석 탭의 차트를 렌더링)
 */
export const renderTrendAnalysisCharts = (allHistoryData, appConfig, trendCharts) => {
    try {
        // 1. 기존 차트가 있다면 파괴 (메모리 누수 방지)
        Object.values(trendCharts).forEach(chart => chart.destroy());
        // trendCharts = {}; // ❗[수정] trendCharts 객체를 app.js에서 관리하므로 여기서 초기화하면 안됨

        // 2. 데이터 준비 (최근 30일)
        const dataSlice = allHistoryData.slice(0, 30).reverse(); // 30일치, 시간순 (오래된 -> 최신)

        const throughputCtx = document.getElementById('kpi-chart-throughput');
        const costCtx = document.getElementById('kpi-chart-cost');
        const nonWorkCtx = document.getElementById('kpi-chart-nonwork');
        
        // 캔버스가 없으면 종료
        if (!throughputCtx || !costCtx || !nonWorkCtx) {
             console.warn("트렌드 분석: 차트 캔버스를 찾을 수 없습니다.");
             return;
        }

        if (dataSlice.length === 0) {
            // 데이터가 없을 때의 처리
            console.warn("트렌드 분석: 표시할 데이터가 없습니다.");
            [throughputCtx, costCtx, nonWorkCtx].forEach(ctx => {
                if (!ctx) return; // 혹시 모를 null 체크
                const context = ctx.getContext('2d');
                context.clearRect(0, 0, ctx.width, ctx.height);
                context.font = "16px 'Noto Sans KR'";
                context.fillStyle = "#9ca3af";
                context.textAlign = "center";
                context.fillText("표시할 데이터가 없습니다.", ctx.width / 2, ctx.height / 2);
            });
            return;
        }

        const labels = [];
        const throughputData = [];
        const costData = [];
        const nonWorkData = [];

        // 3. KPI 데이터 추출
        dataSlice.forEach(dayData => {
            labels.push(dayData.id.substring(5)); // 'MM-DD'
            const kpis = calculateDailyKPIs(dayData, appConfig);
            throughputData.push(kpis.throughput);
            costData.push(kpis.costPerItem);
            nonWorkData.push(kpis.nonWorkTime);
        });

        // 4. 차트 생성
        const chartOptions = (titleText) => ({
            responsive: true,
            maintainAspectRatio: false, // 캔버스 크기에 맞춤
            plugins: {
                legend: { display: false },
                title: { display: false, text: titleText }, // (캔버스 위 h4 태그가 제목 역할)
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
        });

        if (throughputCtx) {
            trendCharts.throughput = new Chart(throughputCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '분당 처리량',
                        data: throughputData,
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.1)',
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: chartOptions('분당 평균 처리량 (개/분)')
            });
        }

        if (costCtx) {
            trendCharts.cost = new Chart(costCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '개당 처리비용',
                        data: costData,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: chartOptions('개당 평균 처리비용 (원/개)')
            });
        }

        if (nonWorkCtx) {
            trendCharts.nonWork = new Chart(nonWorkCtx, {
                type: 'bar', // 비업무시간은 바로
                data: {
                    labels: labels,
                    datasets: [{
                        label: '총 비업무시간',
                        data: nonWorkData,
                        backgroundColor: 'rgba(75, 192, 192, 0.6)'
                    }]
                },
                options: chartOptions('총 비업무시간 (분)')
            });
        }
    } catch (e) {
        console.error("트렌드 차트 렌더링 실패:", e);
        // 오류 발생 시 캔버스 영역을 비우거나 오류 메시지 표시
    }
};

// ✅ [수정] 업무 리포트 렌더링 함수 (Placeholder -> 실제 구현)

/**
 * 헬퍼: 테이블 행 생성 (증감율 표시 지원)
 */
const createTableRow = (columns, isHeader = false) => {
    const cellTag = isHeader ? 'th' : 'td';
    // ✅ [수정] 헤더 클래스 수정 (sticky top-0 추가)
    const rowClass = isHeader ? 'text-xs text-gray-700 uppercase bg-gray-100 sticky top-0' : 'bg-white border-b hover:bg-gray-50';
    const cellClass = "px-4 py-2";

    let cellsHtml = columns.map((col, index) => {
        let alignClass = 'text-left';
        // ✅ [수정] 0번째(이름/업무) 열만 좌측 정렬, 나머지는 우측 정렬
        if (index > 0) { 
             alignClass = 'text-right';
        }
        
        // 객체로 셀 데이터가 오면 (증감율 포함)
        if (typeof col === 'object' && col !== null) {
            return `<${cellTag} class="${cellClass} ${alignClass} ${col.class || ''}">
                        <div>${col.content}</div>
                        ${col.diff || ''}
                    </${cellTag}>`;
        }
        // 문자열로 오면 (단순 텍스트)
        return `<${cellTag} class="${cellClass} ${alignClass}">${col}</${cellTag}>`;
    }).join('');
    
    return `<tr class="${rowClass}">${cellsHtml}</tr>`;
};


/**
 * 헬퍼: 일별 리포트용 KPI 계산
 */
const _calculateDailyReportKPIs = (data, appConfig, wageMap) => {
    if (!data) {
        return {
            totalDuration: 0, totalCost: 0, totalQuantity: 0,
            overallAvgThroughput: 0, overallAvgCostPerItem: 0,
            activeMembersCount: 0, nonWorkMinutes: 0, totalQualityCost: 0
        };
    }
    
    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};
    const onLeaveMemberEntries = data.onLeaveMembers || [];
    const partTimersFromHistory = data.partTimers || [];
    const qualityCostTasks = new Set(appConfig.qualityCostTasks || []);

    let totalDuration = 0;
    let totalCost = 0;
    let totalQualityCost = 0;
    
    records.forEach(r => {
        const duration = r.duration || 0;
        const cost = (duration / 60) * (wageMap[r.member] || 0);
        
        totalDuration += duration;
        totalCost += cost;
        
        if (qualityCostTasks.has(r.task)) {
            totalQualityCost += cost;
        }
    });

    const totalQuantity = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);
    const overallAvgThroughput = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const overallAvgCostPerItem = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;

    const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
    const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
    const activeRegularMembers = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length;
    const activePartTimers = partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;
    const activeMembersCount = activeRegularMembers + activePartTimers;

    let nonWorkMinutes = 0;
    if (isWeekday(data.id)) {
        const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간 기준
        nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalDuration);
    }
    
    return {
        totalDuration, totalCost, totalQuantity,
        overallAvgThroughput, overallAvgCostPerItem,
        activeMembersCount, nonWorkMinutes, totalQualityCost
    };
};

/**
 * 헬퍼: 일별 리포트용 상세 집계 계산
 */
const _calculateDailyReportAggregations = (data, appConfig, wageMap, memberToPartMap) => {
    const records = data?.workRecords || [];
    const quantities = data?.taskQuantities || {};
    
    const partSummary = {};
    const memberSummary = {};
    const taskSummary = {};

    records.forEach(r => {
        if (!r || !r.task) return;
        const duration = r.duration || 0;
        const wage = wageMap[r.member] || 0;
        const cost = (duration / 60) * wage;
        const part = memberToPartMap.get(r.member) || '알바';

        if (!partSummary[part]) partSummary[part] = { duration: 0, cost: 0, members: new Set() };
        partSummary[part].duration += duration;
        partSummary[part].cost += cost;
        partSummary[part].members.add(r.member);

        if (!memberSummary[r.member]) memberSummary[r.member] = { duration: 0, cost: 0, tasks: new Set(), part: part };
        memberSummary[r.member].duration += duration;
        memberSummary[r.member].cost += cost;
        memberSummary[r.member].tasks.add(r.task);

        if (!taskSummary[r.task]) taskSummary[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
        taskSummary[r.task].duration += duration;
        taskSummary[r.task].cost += cost;
        taskSummary[r.task].members.add(r.member);
        taskSummary[r.task].recordCount += 1;
    });

    const allTaskKeys = new Set([...Object.keys(taskSummary), ...Object.keys(quantities)]);
    allTaskKeys.forEach(task => {
        if (!taskSummary[task]) {
            taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
        }
        const summary = taskSummary[task];
        const qty = Number(quantities[task]) || 0;
        
        summary.quantity = qty;
        summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
        summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
        summary.avgStaff = summary.members.size;
        summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
        // ✅ [추가] 4번 기능 (인당 분당 처리량)
        summary.efficiency = summary.avgStaff > 0 ? (summary.avgThroughput / summary.avgStaff) : 0;
    });
    
    return { partSummary, memberSummary, taskSummary };
};


/**
 * 일별 리포트 렌더링 (실제 구현)
 */
export const renderReportDaily = (dateKey, allHistoryData, appConfig) => {
    const view = document.getElementById('report-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">일별 리포트 집계 중...</div>';

    // allHistoryData는 필터링된 데이터일 수 있습니다.
    const data = allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-gray-500">데이터 없음</div>';
        return;
    }
    
    // 증감율 비교를 위해 이전 날짜 데이터를 (필터링된) 목록에서 찾습니다.
    const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
    const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length) 
                                ? allHistoryData[currentIndex + 1] 
                                : null;

    // --- 1. Map 생성 ---
    const wageMap = { ...(appConfig.memberWages || {}) };
    (data.partTimers || []).forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });
    // 이전 날짜의 알바 정보도 wageMap에 추가 (데이터가 없을 경우 대비)
    if (previousDayData) {
        (previousDayData.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });
    }

    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        group.members.forEach(member => {
            memberToPartMap.set(member, group.name);
        });
    });

    // --- 2. 오늘 KPI 및 집계 계산 ---
    const todayKPIs = _calculateDailyReportKPIs(data, appConfig, wageMap);
    const todayAggr = _calculateDailyReportAggregations(data, appConfig, wageMap, memberToPartMap);
    
    // --- 3. 이전 날짜 KPI 및 집계 계산 ---
    const prevKPIs = _calculateDailyReportKPIs(previousDayData, appConfig, wageMap);
    const prevAggr = _calculateDailyReportAggregations(previousDayData, appConfig, wageMap, memberToPartMap);
    
    // --- 4. HTML 렌더링 ---
    let html = `<div class="space-y-6">`;
    html += `<h2 class="text-2xl font-bold text-gray-800">${dateKey} 업무 리포트 (이전 기록 대비)</h2>`;
    
    // 4a. KPI 요약 (8개, 증감율 포함)
    html += `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', todayKPIs.totalDuration, prevKPIs.totalDuration)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 인건비</div>
                <div class="text-xl font-bold">${Math.round(todayKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalCost, prevKPIs.totalCost)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', todayKPIs.totalQuantity, prevKPIs.totalQuantity)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">분당 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', todayKPIs.overallAvgThroughput, prevKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">개당 처리비용</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', todayKPIs.overallAvgCostPerItem, prevKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">근무 인원</div>
                <div class="text-xl font-bold">${todayKPIs.activeMembersCount} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', todayKPIs.activeMembersCount, prevKPIs.activeMembersCount)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">비업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', todayKPIs.nonWorkMinutes, prevKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm border-2 border-red-200 cursor-pointer hover:bg-red-50 transition" data-action="show-coq-modal">
                <div class="text-xs text-red-600 font-semibold">총 품질 비용 (COQ) ⓘ</div>
                <div class="text-xl font-bold text-red-600">${Math.round(todayKPIs.totalQualityCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalQualityCost, prevKPIs.totalQualityCost)}
            </div>
        </div>
    `;

    // 4b. 파트별 요약 (증감율 포함)
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">파트별 요약</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead>${createTableRow(['파트', '총 업무시간', '총 인건비', '참여 인원 (명)'], true)}</thead>
                    <tbody>
    `;
    const allParts = new Set([...Object.keys(todayAggr.partSummary), ...Object.keys(prevAggr.partSummary)]);
    const sortedParts = Array.from(allParts).sort();
    if (sortedParts.length > 0) {
        sortedParts.forEach(part => {
            const d = todayAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            const p = prevAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            html += createTableRow([
                part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, p.members.size) }
            ]);
        });
    } else {
        html += `<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    // 4c. 인원별 상세 (증감율, 업무 수 포함)
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">인원별 상세</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead>${createTableRow(['이름', '파트', '총 업무시간', '총 인건비', '수행 업무 수', '수행 업무'], true)}</thead>
                    <tbody>
    `;
    const allMembers = new Set([...Object.keys(todayAggr.memberSummary), ...Object.keys(prevAggr.memberSummary)]);
    const sortedMembers = Array.from(allMembers).sort();
    if (sortedMembers.length > 0) {
        sortedMembers.forEach(member => {
            const d = todayAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(member) || '알바' };
            const p = prevAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set() };
            const tasksStr = Array.from(d.tasks).join(', ');
            html += createTableRow([
                member,
                d.part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, p.tasks.size) },
                { content: tasksStr, class: "text-xs" } // Task list
            ]);
        });
    } else {
        html += `<tr><td colspan="6" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 4d. 업무별 상세 (증감율, 효율성 지표 포함)
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">업무별 상세 (증감율은 이전 리포트일 대비)</h3>
            <div class="overflow-x-auto max-h-[70vh]">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead>${createTableRow(['업무', '총 시간', '총 인건비', '총 처리량', '분당 처리량(Avg)', '개당 처리비용(Avg)', '총 참여인원', '평균 처리시간(건)', '인당 분당 처리량(효율)'], true)}</thead>
                    <tbody>
    `;
    const allTasks = new Set([...Object.keys(todayAggr.taskSummary), ...Object.keys(prevAggr.taskSummary)]);
    const sortedTasks = Array.from(allTasks).sort();
    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const d = todayAggr.taskSummary[task] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
            const p = prevAggr.taskSummary[task] || null; // Previous data (null or object)
            if (d.duration === 0 && d.quantity === 0) return; // 오늘 데이터 없으면 스킵

            // ✅ [수정] 렌더링 함수 호출 시 p 객체에서 올바른 숫자 속성을 전달
            html += createTableRow([
                { content: task, class: "font-medium text-gray-900" },
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p?.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p?.cost) },
                { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, p?.quantity) },
                { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, p?.avgThroughput) },
                { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, p?.avgCostPerItem) },
                { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, p?.avgStaff) },
                { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, p?.avgTime) },
                // ✅ [추가] 4번 기능: 효율성 지표
                { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, p?.efficiency), class: "font-bold" } // 효율성
            ]);
        });
    } else {
        html += `<tr><td colspan="9" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 4e. 근태 현황 (✅ [수정] 그룹화 로직 적용)
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">근태 현황</h3>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto">
    `;
    
    const attendanceSummary = (data.onLeaveMembers || []).reduce((acc, entry) => {
        const member = entry.member;
        const type = entry.type;
        if (!acc[member]) acc[member] = { member: member, counts: {} };
        if (!acc[member].counts[type]) acc[member].counts[type] = 0;
        
        if (entry.startDate) { // 연차, 출장, 결근
             acc[member].counts[type] += 1; // '일'
        } else { // 외출, 조퇴
             acc[member].counts[type] += 1; // '회'
        }
        return acc;
    }, {});

    if (Object.keys(attendanceSummary).length === 0) {
         html += `<p class="text-sm text-gray-500 text-center">데이터 없음</p>`;
    } else {
        Object.values(attendanceSummary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
            const typesHtml = Object.entries(item.counts)
                .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
                .map(([type, count]) => {
                    const unit = (['연차', '출장', '결근'].includes(type)) ? '일' : '회';
                    return `<div class="flex justify-between text-sm text-gray-700 pl-4">
                                <span>${type}</span>
                                <span class="text-right font-medium">${count}${unit}</span>
                            </div>`;
                }).join('');

             html += `
                <div class="border-t pt-2 first:border-t-0">
                    <div class="flex justify-between text-md mb-1">
                        <span class="font-semibold text-gray-900">${item.member}</span>
                    </div>
                    <div class="space-y-0.5">
                        ${typesHtml}
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`; // div 2개 닫기


    html += `</div>`; // .space-y-6 닫기
    view.innerHTML = html;
};

/**
 * 주별 리포트 렌더링 (Placeholder)
 */
export const renderReportWeekly = (weekKey, allHistoryData, appConfig) => {
    const view = document.getElementById('report-weekly-view');
    if (!view) return;
    view.innerHTML = `<div class="p-4">
        <h3 class="text-xl font-bold mb-4">${weekKey} 주별 리포트 (준비 중)</h3>
        <p class="text-gray-600">이곳에 ${weekKey}의 주간 업무 리포트 내용이 표시될 예정입니다.</p>
    </div>`;
};

/**
 * 월별 리포트 렌더링 (Placeholder)
 */
export const renderReportMonthly = (monthKey, allHistoryData, appConfig) => {
    const view = document.getElementById('report-monthly-view');
    if (!view) return;
    view.innerHTML = `<div class="p-4">
        <h3 class="text-xl font-bold mb-4">${monthKey} 월별 리포트 (준비 중)</h3>
        <p class="text-gray-600">이곳에 ${monthKey}의 월간 업무 리포트 내용이 표시될 예정입니다.</p>
    </div>`;
};

/**
 * 연간 리포트 렌더링 (Placeholder)
 */
export const renderReportYearly = (yearKey, allHistoryData, appConfig) => {
    const view = document.getElementById('report-yearly-view');
    if (!view) return;
    view.innerHTML = `<div class="p-4">
        <h3 class="text-xl font-bold mb-4">${yearKey} 연간 리포트 (준비 중)</h3>
        <p class="text-gray-600">이곳에 ${yearKey}의 연간 업무 리포트 내용이 표시될 예정입니다.</p>
    </div>`;
};