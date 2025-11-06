// === js/ui-history-reports-logic.js ===

import { formatDuration, isWeekday, getWeekOfYear } from './utils.js';

// ================== [ 1. 헬퍼 함수 ] ==================

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
    if (['avgThroughput', 'quantity', 'avgStaff', 'totalQuantity', 'efficiencyRatio', 'utilizationRate'].includes(metric)) {
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
    const systemAccounts = new Set(appConfig.systemAccounts || []);
    const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);

    const activeRegularMembers = [...allRegularMembers].filter(name => !onLeaveMemberNames.includes(name) && !systemAccounts.has(name)).length;
    const activePartTimers = partTimersFromHistory.filter(pt => !onLeaveMemberNames.includes(pt.name)).length;

    const activeMembersCount = activeRegularMembers + activePartTimers;

    let nonWorkMinutes = 0;
    if (data.id && data.id.length === 10 && isWeekday(data.id)) {
        const standardHours = (appConfig.standardDailyWorkHours?.weekday || 8);
        const totalPotentialMinutes = activeMembersCount * standardHours * 60;
        nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalDuration);
    }

    return {
        totalDuration, totalCost, totalQuantity,
        overallAvgThroughput, overallAvgCostPerItem,
        activeMembersCount, nonWorkMinutes, totalQualityCost,
        coqPercentage
    };
};

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

export const calculateStandardThroughputs = (allHistoryData) => {
    const totals = {};
    allHistoryData.forEach(day => {
        const records = day.workRecords || [];
        const quantities = day.taskQuantities || {};

        records.forEach(r => {
            if (r.task && r.duration > 0) {
                if (!totals[r.task]) totals[r.task] = { duration: 0, quantity: 0 };
                totals[r.task].duration += r.duration;
            }
        });

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
        if (t.duration > 60 && t.quantity > 0) {
            standards[task] = t.quantity / t.duration; // (개/분)
        }
    });
    return standards;
};

export const analyzeStaffingEfficiency = (currentDataAggr, standardThroughputs, actualTotalDuration, actualActiveStaff) => {
    let totalStandardMinutesNeeded = 0;

    Object.entries(currentDataAggr.taskSummary).forEach(([task, summary]) => {
        const actualQty = summary.quantity || 0;
        const stdSpeed = standardThroughputs[task];

        if (actualQty > 0 && stdSpeed > 0) {
            const standardMinutes = actualQty / stdSpeed;
            totalStandardMinutesNeeded += standardMinutes;
        } else if (summary.duration > 0) {
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

export const calculateUtilization = (daysData, appConfig, wageMap) => {
    let totalStandardAvailableMinutes = 0;
    let totalActualWorkedMinutes = 0;

    daysData.forEach(day => {
        if (day.workRecords && day.workRecords.length > 0) {
            const kpis = calculateReportKPIs(day, appConfig, wageMap);
            const activeStaff = kpis.activeMembersCount;

            if (activeStaff > 0) {
                totalActualWorkedMinutes += kpis.totalDuration;
                const standardHours = appConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 };
                const hoursPerPerson = isWeekday(day.id) ? (standardHours.weekday || 8) : (standardHours.weekend || 4);
                totalStandardAvailableMinutes += (activeStaff * hoursPerPerson * 60);
            }
        }
    });

    const utilizationRate = totalStandardAvailableMinutes > 0
        ? (totalActualWorkedMinutes / totalStandardAvailableMinutes) * 100
        : 0;

    return {
        utilizationRate,
        totalStandardAvailableMinutes,
        totalActualWorkedMinutes
    };
};

/**
 * ✨ [수정] 매출액 기반 적정 인원 예측 (실제 근무 데이터 기반)
 */
export const analyzeRevenueBasedStaffing = (revenue, totalStandardMinutesNeeded, activeMembersCount, actualTotalDuration, appConfig) => {
    if (!revenue || revenue <= 0 || !totalStandardMinutesNeeded || totalStandardMinutesNeeded <= 0 || !actualTotalDuration || actualTotalDuration <= 0 || !activeMembersCount || activeMembersCount <= 0) {
        return null;
    }

    const revenueUnit = appConfig.revenueIncrementUnit || 10000000;
    const actualMinutesPerPerson = actualTotalDuration / activeMembersCount;
    const minutesPerRevenue = totalStandardMinutesNeeded / revenue;
    const minutesPerUnitIncrease = minutesPerRevenue * revenueUnit;
    const staffNeededPerUnitIncrease = minutesPerUnitIncrease / actualMinutesPerPerson;

    return {
        minutesPerRevenue,
        staffNeededPerUnitIncrease,
        actualMinutesPerPerson,
        revenueUnit,
        formattedUnit: (revenueUnit / 10000000 >= 1) ? `${revenueUnit / 10000000}천만원` : `${revenueUnit.toLocaleString()}원`
    };
};

/**
 * ✨ [신규] 매출액 vs 업무량 트렌드 비교 분석
 */
export const analyzeRevenueWorkloadTrend = (currentRevenue, prevRevenue, currentWorkload, prevWorkload) => {
    if (!currentRevenue || !prevRevenue || !currentWorkload || !prevWorkload) return null;

    const revenueChangeRate = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
    const workloadChangeRate = ((currentWorkload - prevWorkload) / prevWorkload) * 100;
    const gap = workloadChangeRate - revenueChangeRate;

    let diagnosis = '';
    let colorClass = '';

    if (gap > 10) {
        diagnosis = '⚠️ 수익성 경고: 매출 대비 업무량 급증';
        colorClass = 'text-red-600';
    } else if (gap > 5) {
        diagnosis = '📉 효율 저하: 업무량이 매출보다 더 빠르게 증가 중';
        colorClass = 'text-orange-600';
    } else if (gap < -10) {
        diagnosis = '🚀 수익성 대폭 개선: 매출 급증에도 업무량은 안정적';
        colorClass = 'text-blue-600';
    } else if (gap < -5) {
        diagnosis = '📈 효율 개선: 매출 증가폭이 업무량 증가폭을 상회';
        colorClass = 'text-green-600';
    } else {
        diagnosis = '✅ 균형 성장: 매출과 업무량이 비례하여 증가';
        colorClass = 'text-gray-800';
    }

    return {
        revenueChangeRate,
        workloadChangeRate,
        gap,
        diagnosis,
        colorClass
    };
};