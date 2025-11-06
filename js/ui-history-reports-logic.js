// === js/ui-history-reports-logic.js ===

import { formatDuration, isWeekday, getWeekOfYear } from './utils.js';

// ================== [ 1. 헬퍼 함수 ] ==================

/**
 * 헬퍼: 증감율 HTML 생성
 */
export const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = current || 0;
    const prevValue = previous || 0;

    if (prevValue === 0) {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return '';
    }

    const diff = currValue - prevValue;
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;

    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';

    let colorClass = 'text-gray-500';
    if (['avgThroughput', 'quantity', 'avgStaff', 'totalQuantity', 'efficiencyRatio'].includes(metric)) {
        colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
    }
    else if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'activeMembersCount', 'coqPercentage', 'theoreticalRequiredStaff'].includes(metric)) {
        colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
    }

    let diffStr = '';
    let prevStr = '';
    if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    } else if (metric === 'avgStaff' || metric === 'avgCostPerItem' || metric === 'quantity' || metric === 'totalQuantity' || metric === 'totalCost' || metric === 'overallAvgCostPerItem') {
        diffStr = Math.round(Math.abs(diff)).toLocaleString();
        prevStr = Math.round(prevValue).toLocaleString();
    } else {
        diffStr = Math.abs(diff).toFixed(1);
        prevStr = prevValue.toFixed(1);
    }

    return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                ${sign} ${diffStr} (${percent.toFixed(0)}%)
            </span>`;
};

/**
 * 헬퍼: 테이블 행 생성 (증감율 표시 + 정렬 기능 지원)
 */
export const createTableRow = (columns, isHeader = false, sortState = null) => {
    const cellTag = isHeader ? 'th' : 'td';
    const rowClass = isHeader ? 'text-xs text-gray-700 uppercase bg-gray-100 sticky top-0' : 'bg-white border-b hover:bg-gray-50';

    let cellsHtml = columns.map((col, index) => {
        if (!isHeader) {
            const alignClass = (index > 0) ? 'text-right' : 'text-left';
            if (typeof col === 'object' && col !== null) {
                return `<${cellTag} class="px-4 py-2 ${alignClass} ${col.class || ''}">
                            <div>${col.content}</div>
                            ${col.diff || ''}
                        </${cellTag}>`;
            }
            return `<${cellTag} class="px-4 py-2 ${alignClass}">${col}</${cellTag}>`;
        }

        const alignClass = (index > 0) ? 'text-right' : 'text-left';
        const sortable = col.sortKey ? 'sortable-header' : '';
        const dataSortKey = col.sortKey ? `data-sort-key="${col.sortKey}"` : '';
        const title = col.title ? `title="${col.title}"` : '';

        let sortIcon = '';
        if (col.sortKey) {
            let iconChar = '↕';
            let iconClass = 'sort-icon';
            if (sortState && col.sortKey === sortState.key) {
                if (sortState.dir === 'asc') {
                    iconChar = '▲';
                    iconClass += ' sorted-asc';
                } else if (sortState.dir === 'desc') {
                    iconChar = '▼';
                    iconClass += ' sorted-desc';
                }
            }
            sortIcon = `<span class="${iconClass}">${iconChar}</span>`;
        }

        return `<${cellTag} scope="col" class="px-4 py-2 ${alignClass} ${sortable}" ${dataSortKey} ${title}>
                    ${col.content}
                    ${sortIcon}
                </${cellTag}>`;

    }).join('');

    return `<tr class="${rowClass}">${cellsHtml}</tr>`;
};


// ================== [ 2. 계산/집계 로직 ] ==================

/**
 * 헬퍼: 일별 리포트용 KPI 계산
 */
export const calculateReportKPIs = (data, appConfig, wageMap) => {
    if (!data) {
        return {
            totalDuration: 0, totalCost: 0, totalQuantity: 0,
            overallAvgThroughput: 0, overallAvgCostPerItem: 0,
            activeMembersCount: 0, nonWorkMinutes: 0, totalQualityCost: 0,
            coqPercentage: 0
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
    const coqPercentage = (totalCost > 0) ? (totalQualityCost / totalCost) * 100 : 0;

    const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
    const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
    const activeRegularMembers = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length;
    const activePartTimers = partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;
    const activeMembersCount = activeRegularMembers + activePartTimers;

    let nonWorkMinutes = 0;
    // (일별 데이터일 때만 비업무 시간 계산)
    if (data.id && data.id.length === 10 && isWeekday(data.id)) {
        const totalPotentialMinutes = activeMembersCount * 8 * 60;
        nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalDuration);
    }

    return {
        totalDuration, totalCost, totalQuantity,
        overallAvgThroughput, overallAvgCostPerItem,
        activeMembersCount, nonWorkMinutes, totalQualityCost,
        coqPercentage
    };
};

/**
 * 헬퍼: 일별 리포트용 상세 집계 계산
 */
export const calculateReportAggregations = (data, appConfig, wageMap, memberToPartMap) => {
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
        summary.efficiency = summary.avgStaff > 0 ? (summary.avgThroughput / summary.avgStaff) : 0;
    });

    return { partSummary, memberSummary, taskSummary };
};

/**
 * 헬퍼: 여러 날의 데이터를 하나로 집계 (주/월/연간용)
 */
export const aggregateDaysToSingleData = (daysData, id) => {
    const aggregated = {
        id: id,
        workRecords: [],
        taskQuantities: {},
        onLeaveMembers: [],
        partTimers: []
    };

    const partTimerNames = new Set();

    daysData.forEach(day => {
        (day.workRecords || []).forEach(r => aggregated.workRecords.push(r));
        (day.onLeaveMembers || []).forEach(o => aggregated.onLeaveMembers.push(o));

        (day.partTimers || []).forEach(p => {
            if (p && p.name && !partTimerNames.has(p.name)) {
                aggregated.partTimers.push(p);
                partTimerNames.add(p.name);
            }
        });

        Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
            aggregated.taskQuantities[task] = (aggregated.taskQuantities[task] || 0) + (Number(qty) || 0);
        });
    });

    return aggregated;
};

// ================== [ 3. ✨ 신규 분석 로직 ] ==================

/**
 * ✨ 헬퍼: 전체 이력 기반 표준 처리속도 계산
 */
export const calculateStandardThroughputs = (allHistoryData) => {
    const totals = {};
    allHistoryData.forEach(day => {
        const records = day.workRecords || [];
        const quantities = day.taskQuantities || {};

        // Duration 합산
        records.forEach(r => {
            if (r.task && r.duration > 0) {
                if (!totals[r.task]) totals[r.task] = { duration: 0, quantity: 0 };
                totals[r.task].duration += r.duration;
            }
        });

        // Quantity 합산
        Object.entries(quantities).forEach(([task, qty]) => {
            const q = Number(qty) || 0;
            if (q > 0) {
                if (!totals[task]) totals[task] = { duration: 0, quantity: 0 };
                totals[task].quantity += q;
            }
        });
    });

    const standards = {};
    Object.keys(totals).forEach(task => {
        const t = totals[task];
        // 유의미한 데이터가 있는 경우만 표준으로 설정 (예: 누적 60분 이상)
        if (t.duration > 60 && t.quantity > 0) {
            standards[task] = t.quantity / t.duration; // (개/분)
        }
    });
    return standards;
};

/**
 * ✨ 헬퍼: 적정 인원 분석 (표준 공수 기반)
 */
export const analyzeStaffingEfficiency = (currentDataAggr, standardThroughputs, actualTotalDuration, actualActiveStaff) => {
    let totalStandardMinutesNeeded = 0;

    // 현재 기간의 각 업무별 실제 처리량을 '표준 속도'로 나누어 '표준 필요 시간' 계산
    Object.entries(currentDataAggr.taskSummary).forEach(([task, summary]) => {
        const actualQty = summary.quantity || 0;
        const stdSpeed = standardThroughputs[task];

        if (actualQty > 0 && stdSpeed > 0) {
            const standardMinutes = actualQty / stdSpeed;
            totalStandardMinutesNeeded += standardMinutes;
        } else if (summary.duration > 0) {
            // 표준 속도가 없는 업무(시간만 기록되는 업무 등)는 실제 투입 시간을 그대로 필요 시간으로 인정
            totalStandardMinutesNeeded += summary.duration;
        }
    });

    const efficiencyRatio = actualTotalDuration > 0 ? (totalStandardMinutesNeeded / actualTotalDuration) * 100 : 0;
    const theoreticalRequiredStaff = actualActiveStaff * (efficiencyRatio / 100);

    return {
        totalStandardMinutesNeeded,
        theoreticalRequiredStaff,
        efficiencyRatio
    };
};

/**
 * ✨ 헬퍼: 매출액 기반 업무량 및 적정 인원 예측 분석
 * @param {number} revenue 입력된 월 매출액
 * @param {number} totalStandardMinutesNeeded 해당 월의 총 표준 필요 업무 시간 (분)
 * @param {object} appConfig 앱 설정 (기준 단위, 표준 근무시간 등)
 */
export const analyzeRevenueBasedStaffing = (revenue, totalStandardMinutesNeeded, appConfig) => {
    if (!revenue || revenue <= 0 || !totalStandardMinutesNeeded || totalStandardMinutesNeeded <= 0) {
        return null;
    }

    const revenueUnit = appConfig.revenueIncrementUnit || 10000000; // 예: 1,000만원
    const monthlyWorkMinutes = (appConfig.standardMonthlyWorkHours || 209) * 60; // 월 표준 근무 분

    // 1. 매출 1원당 필요한 표준 업무 시간 (분/원)
    const minutesPerRevenue = totalStandardMinutesNeeded / revenue;

    // 2. 기준 단위(예: 1천만원) 매출 증가 시 필요한 추가 업무 시간 (분)
    const minutesPerUnitIncrease = minutesPerRevenue * revenueUnit;

    // 3. 기준 단위 매출 증가 시 필요한 추가 인원 (명)
    // = (추가 필요한 분) / (1명이 한 달에 일하는 분)
    const staffNeededPerUnitIncrease = minutesPerUnitIncrease / monthlyWorkMinutes;

    return {
        minutesPerRevenue,
        staffNeededPerUnitIncrease,
        revenueUnit,
        formattedUnit: (revenueUnit / 10000000 >= 1) ? `${revenueUnit / 10000000}천만원` : `${revenueUnit.toLocaleString()}원`
    };
};