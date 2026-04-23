// === js/ui-history-reports-logic.js ===

import { formatDuration, isWeekday, getWeekOfYear, getTodayDateString } from './utils.js';
import { appConfig } from './state.js';

// ================== [ 1. 헬퍼 함수 ] ==================

export const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = Number(current) || 0;

    if (previous === null || typeof previous === 'undefined') {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return '';
    }
    
    const prevValue = Number(previous) || 0;

    if (prevValue === 0) {
        if (currValue === 0) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
        
        const sign = '↑';
        let colorClass = 'text-green-600';
        if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'coqPercentage', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost'].includes(metric)) {
             colorClass = 'text-red-600';
        }
        
        let diffStr = '';
        if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
            diffStr = formatDuration(Math.abs(currValue));
        } else if (['workDays', 'directDeliveryCount', 'avgStaff', 'avgCostPerItem', 'quantity', 'totalQuantity', 'totalCost', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost', 'unitMargin'].includes(metric)) {
            diffStr = Math.round(Math.abs(currValue)).toLocaleString();
        } else if (['availableFTE', 'workedFTE', 'requiredFTE', 'qualityFTE'].includes(metric)) {
            diffStr = Math.abs(currValue).toFixed(1) + ' FTE';
        } else if (metric === 'avgDailyStaff') {
            diffStr = Math.abs(currValue).toFixed(1) + ' 명';
        } else {
            diffStr = Math.abs(currValue).toFixed(1);
        }
        return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: 0">
                    ${sign} ${diffStr}
                </span>`;
    }

    const diff = currValue - prevValue;
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;

    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';

    let colorClass = 'text-gray-500';
    if (['workDays', 'directDeliveryCount', 'avgThroughput', 'quantity', 'avgStaff', 'avgDailyStaff', 'totalQuantity', 'efficiencyRatio', 'utilizationRate', 'qualityRatio', 'oee', 'qualityFTE', 'unitMargin'].includes(metric)) {
        colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
    }
    else if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'coqPercentage', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost'].includes(metric)) {
        colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
    }

    let diffStr = '';
    let prevStr = '';

    if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    } else if (['workDays', 'directDeliveryCount', 'avgStaff', 'avgCostPerItem', 'quantity', 'totalQuantity', 'totalCost', 'totalLossCost', 'availabilityLossCost', 'performanceLossCost', 'qualityLossCost', 'unitTotalCost', 'unitMargin'].includes(metric)) {
        diffStr = Math.round(Math.abs(diff)).toLocaleString();
        prevStr = Math.round(prevValue).toLocaleString();
    } else if (['availableFTE', 'workedFTE', 'requiredFTE', 'qualityFTE'].includes(metric)) {
        diffStr = Math.abs(diff).toFixed(1) + ' FTE';
        prevStr = prevValue.toFixed(1) + ' FTE';
    } else if (metric === 'avgDailyStaff') {
        diffStr = Math.abs(diff).toFixed(1);
        prevStr = prevValue.toFixed(1);
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
        const duration = Number(r.duration) || 0;
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
        const duration = Number(r.duration) || 0;
        const wage = wageMap[r.member] || 0;
        const cost = (duration / 60) * wage;
        const part = memberToPartMap.get(r.member) || '알바';

        // Part Summary
        if (!partSummary[part]) partSummary[part] = { duration: 0, cost: 0, members: new Set() };
        partSummary[part].duration += duration;
        partSummary[part].cost += cost;
        partSummary[part].members.add(r.member);

        // Member Summary
        if (!memberSummary[r.member]) memberSummary[r.member] = { duration: 0, cost: 0, tasks: new Set(), part: part };
        memberSummary[r.member].duration += duration;
        memberSummary[r.member].cost += cost;
        memberSummary[r.member].tasks.add(r.task);

        // Task Summary
        if (!taskSummary[r.task]) {
            taskSummary[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0, uniqueDays: new Set() };
        }
        taskSummary[r.task].duration += duration;
        taskSummary[r.task].cost += cost;
        taskSummary[r.task].members.add(r.member);
        taskSummary[r.task].recordCount += 1;
        
        const recordDate = r.date || data.id;
        if (recordDate) {
            taskSummary[r.task].uniqueDays.add(recordDate);
        }
    });

    const allTaskKeys = new Set([...Object.keys(taskSummary), ...Object.keys(quantities)]);
    allTaskKeys.forEach(task => {
        if (!taskSummary[task]) {
            taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0, uniqueDays: new Set() };
        }
        const summary = taskSummary[task];
        const qty = Number(quantities[task]) || 0;

        summary.quantity = qty;
        summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
        summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
        summary.avgStaff = summary.members.size;
        summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
        summary.efficiency = summary.avgStaff > 0 ? (summary.avgThroughput / summary.avgStaff) : 0;
        
        summary.workDays = summary.uniqueDays.size;
    });

    return { partSummary, memberSummary, taskSummary };
};

export const aggregateDaysToSingleData = (daysData, id) => {
    const aggregated = {
        id: id,
        workRecords: [],
        taskQuantities: {},
        onLeaveMembers: [],
        partTimers: [],
        management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 }
    };

    const partTimerNames = new Set();

    daysData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            aggregated.workRecords.push({ ...r, date: day.id });
        });
        
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

        const m = day.management || {};
        aggregated.management.revenue += (Number(m.revenue) || 0);
        aggregated.management.orderCount += (Number(m.orderCount) || 0);
        aggregated.management.inventoryQty += (Number(m.inventoryQty) || 0);
        aggregated.management.inventoryAmt += (Number(m.inventoryAmt) || 0);
    });

    return aggregated;
};

// ✅ [수정] 시뮬레이션 및 벤치마크용 표준 속도 산출 (상위 20개 데이터의 평균)
export const calculateStandardThroughputs = (allHistoryData) => {
    const todayKey = getTodayDateString();
    
    const sortedHistory = [...allHistoryData].sort((a, b) => a.id.localeCompare(b.id));
    const taskDailySpeeds = {};

    sortedHistory.forEach(day => {
        if (day.id === todayKey) return;

        const records = day.workRecords || [];
        const quantities = day.taskQuantities || {};
        const dailyTaskStats = {};

        records.forEach(r => {
            const duration = Number(r.duration) || 0;
            if (r.task && duration > 0) {
                if (!dailyTaskStats[r.task]) dailyTaskStats[r.task] = { duration: 0, quantity: 0 };
                dailyTaskStats[r.task].duration += duration;
            }
        });

        Object.entries(quantities).forEach(([task, qty]) => {
            const q = Number(qty) || 0;
            if (q > 0) {
                if (!dailyTaskStats[task]) dailyTaskStats[task] = { duration: 0, quantity: 0 };
                dailyTaskStats[task].quantity += q;
            }
        });

        Object.entries(dailyTaskStats).forEach(([task, stats]) => {
            // duration이 10분 이상일 때만 유효한 속도로 인정 (기존 로직 유지)
            if (stats.duration >= 10 && stats.quantity > 0) {
                const speed = stats.quantity / stats.duration;
                if (!taskDailySpeeds[task]) taskDailySpeeds[task] = [];
                taskDailySpeeds[task].push(speed);
            }
        });
    });

    const standards = {};
    Object.keys(taskDailySpeeds).forEach(task => {
        const speeds = taskDailySpeeds[task];
        
        // 🌟 내림차순 정렬 후 상위 20개 데이터 추출
        speeds.sort((a, b) => b - a);
        const top20 = speeds.slice(0, 20);
        
        if (top20.length > 0) {
            const avgTop = top20.reduce((a, b) => a + b, 0) / top20.length;
            standards[task] = avgTop;
        } else {
            standards[task] = 0;
        }
    });
    return standards;
};

// ✅ [추가] 업무 리포트 통계용 표준 속도 산출 (선택된 기간의 평균값 산출)
export const calculatePeriodThroughputs = (daysData) => {
    const taskDailySpeeds = {};

    daysData.forEach(day => {
        const records = day.workRecords || [];
        const quantities = day.taskQuantities || {};
        const dailyTaskStats = {};

        records.forEach(r => {
            const duration = Number(r.duration) || 0;
            if (r.task && duration > 0) {
                if (!dailyTaskStats[r.task]) dailyTaskStats[r.task] = { duration: 0, quantity: 0 };
                dailyTaskStats[r.task].duration += duration;
            }
        });

        Object.entries(quantities).forEach(([task, qty]) => {
            const q = Number(qty) || 0;
            if (q > 0) {
                if (!dailyTaskStats[task]) dailyTaskStats[task] = { duration: 0, quantity: 0 };
                dailyTaskStats[task].quantity += q;
            }
        });

        Object.entries(dailyTaskStats).forEach(([task, stats]) => {
            // 리포트용이므로 조건 제약을 최소화하거나 동일하게 적용
            if (stats.duration > 0 && stats.quantity > 0) {
                const speed = stats.quantity / stats.duration;
                if (!taskDailySpeeds[task]) taskDailySpeeds[task] = [];
                taskDailySpeeds[task].push(speed);
            }
        });
    });

    const periodStandards = {};
    Object.keys(taskDailySpeeds).forEach(task => {
        const speeds = taskDailySpeeds[task];
        if (speeds.length > 0) {
            // 🌟 해당 기간 내의 모든 속도 데이터를 기반으로 평균 산출
            const avgPeriod = speeds.reduce((a, b) => a + b, 0) / speeds.length;
            periodStandards[task] = avgPeriod;
        } else {
            periodStandards[task] = 0;
        }
    });
    return periodStandards;
};

export const calculateAverageStaffing = (allHistoryData) => {
    if (!allHistoryData) return {};
    const taskDailyStaff = {};

    allHistoryData.forEach(day => {
        (day.workRecords || []).forEach(r => {
            if (r.task && r.member) {
                if (!taskDailyStaff[r.task]) taskDailyStaff[r.task] = {};
                if (!taskDailyStaff[r.task][day.id]) {
                    taskDailyStaff[r.task][day.id] = new Set();
                }
                taskDailyStaff[r.task][day.id].add(r.member);
            }
        });
    });

    const avgStaffMap = {};
    Object.keys(taskDailyStaff).forEach(task => {
        const dayEntries = Object.values(taskDailyStaff[task]);
        const totalDays = dayEntries.length;
        if (totalDays > 0) {
            const totalStaffSum = dayEntries.reduce((sum, daySet) => sum + daySet.size, 0);
            avgStaffMap[task] = totalStaffSum / totalDays;
        }
    });
    return avgStaffMap;
};

export const calculateBenchmarkOEE = (allHistoryData, appConfig) => {
    if (!allHistoryData || allHistoryData.length === 0) return null;
    const recentData = [...allHistoryData].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30);
    if (recentData.length === 0) return null;

    let totalOEE = 0;
    let validDays = 0;
    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    recentData.forEach(day => {
        const wageMap = { ...(appConfig.memberWages || {}) };
        (day.partTimers || []).forEach(pt => { if (pt && pt.name && !wageMap[pt.name]) wageMap[pt.name] = pt.wage || 0; });
        const dayAggr = calculateReportAggregations(day, appConfig, wageMap, new Map());
        const productivity = calculateAdvancedProductivity([day], dayAggr, standardThroughputs, appConfig, wageMap);
        if (productivity.oee > 0) {
            totalOEE += productivity.oee;
            validDays++;
        }
    });

    return validDays > 0 ? (totalOEE / validDays) : null;
};

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

export const analyzeRevenueWorkloadTrend = (currentRevenue, prevRevenue, currentWorkload, prevWorkload) => {
    if (!currentRevenue || !prevRevenue || !currentWorkload || !prevWorkload) return null;
    const revenueChangeRate = ((currentRevenue - prevRevenue) / prevRevenue) * 100;
    const workloadChangeRate = ((currentWorkload - prevWorkload) / prevWorkload) * 100;
    const gap = workloadChangeRate - revenueChangeRate;
    let diagnosis = '';
    let colorClass = '';
    if (gap > 10) {
        diagnosis = '⚠️ 수익성 경고: 매출 대비 업무량 급증'; colorClass = 'text-red-600';
    } else if (gap > 5) {
        diagnosis = '📉 효율 저하: 업무량이 매출보다 더 빠르게 증가 중'; colorClass = 'text-orange-600';
    } else if (gap < -10) {
        diagnosis = '🚀 수익성 대폭 개선: 매출 급증에도 업무량은 안정적'; colorClass = 'text-blue-600';
    } else if (gap < -5) {
        diagnosis = '📈 효율 개선: 매출 증가폭이 업무량 증가폭을 상회'; colorClass = 'text-green-600';
    } else {
        diagnosis = '✅ 균형 성장: 매출과 업무량이 비례하여 증가'; colorClass = 'text-gray-800';
    }
    return { revenueChangeRate, workloadChangeRate, gap, diagnosis, colorClass };
};

export const analyzeUnitCost = (data, appConfig, wageMap, totalRevenue = 0) => {
    const costCalcTasks = new Set(appConfig.costCalcTasks || []);
    const fixedMaterialCost = Number(appConfig.fixedMaterialCost) || 0;
    const fixedShippingCost = Number(appConfig.fixedShippingCost) || 0;
    const fixedDirectDeliveryCost = Number(appConfig.fixedDirectDeliveryCost) || 0;

    let targetLaborCost = 0;
    let maxTaskQuantity = 0;
    
    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};

    records.forEach(r => {
        if (costCalcTasks.has(r.task)) {
            const duration = Number(r.duration) || 0;
            const wage = wageMap[r.member] || 0;
            targetLaborCost += (duration / 60) * wage;
        }
    });

    costCalcTasks.forEach(task => {
        const qty = Number(quantities[task]) || 0;
        if (qty > maxTaskQuantity) maxTaskQuantity = qty;
    });

    const perItemLaborCost = maxTaskQuantity > 0 ? (targetLaborCost / maxTaskQuantity) : 0;

    const directDeliveryRecords = records.filter(r => r.task === '직진배송');
    const uniqueDates = new Set();
    
    directDeliveryRecords.forEach(r => {
        const d = r.date || data.id;
        if (d) uniqueDates.add(d);
    });
    
    const directDeliveryCount = uniqueDates.size;
    const totalDirectCost = directDeliveryCount * fixedDirectDeliveryCost;
    const perItemDirectCost = maxTaskQuantity > 0 ? (totalDirectCost / maxTaskQuantity) : 0;

    const totalUnitCost = perItemLaborCost + fixedMaterialCost + fixedShippingCost + perItemDirectCost;

    let salesCount = Number(data.management?.orderCount) || 0;
    if (salesCount === 0) salesCount = maxTaskQuantity;

    let revenuePerItem = 0;
    let margin = 0;
    let marginRate = 0;

    if (salesCount > 0 && totalRevenue > 0) {
        revenuePerItem = totalRevenue / salesCount;
        margin = revenuePerItem - totalUnitCost;
        marginRate = (margin / revenuePerItem) * 100;
    }

    return {
        targetTasks: Array.from(costCalcTasks),
        baseQuantity: salesCount,
        costs: {
            labor: perItemLaborCost,
            material: fixedMaterialCost,
            shipping: fixedShippingCost,
            directDelivery: perItemDirectCost, 
            directDeliveryCount: directDeliveryCount, 
            total: totalUnitCost
        },
        profit: {
            revenuePerItem,
            margin,
            marginRate
        },
        isValid: costCalcTasks.size > 0 && (salesCount > 0 || maxTaskQuantity > 0)
    };
};

export const calculateAdvancedProductivity = (daysData, currentDataAggr, standardThroughputs, appConfig, wageMap) => {
    let totalStandardAvailableMinutes = 0;
    let totalActualWorkedMinutes = 0;
    let totalStandardMinutesNeeded = 0;
    let totalQualityCost = 0;
    let totalActualCost = 0;
    let totalActiveStaffSum = 0;
    let workingDaysCount = 0;

    const qualityTasksStr = new Set(appConfig.qualityCostTasks || []);
    const qualityLossTasks = [];

    daysData.forEach(day => {
        if (day.workRecords && day.workRecords.length > 0) {
            workingDaysCount++;
            const kpis = calculateReportKPIs(day, appConfig, wageMap);
            const activeStaff = kpis.activeMembersCount;

            if (activeStaff > 0) {
                totalActiveStaffSum += activeStaff;
                totalActualWorkedMinutes += kpis.totalDuration;
                totalActualCost += kpis.totalCost;
                totalQualityCost += kpis.totalQualityCost;

                const standardHours = appConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 };
                const hoursPerPerson = isWeekday(day.id) ? (standardHours.weekday || 8) : (standardHours.weekend || 4);
                totalStandardAvailableMinutes += (activeStaff * hoursPerPerson * 60);
            }
        }
    });

    const taskPerformanceLosses = [];

    Object.entries(currentDataAggr.taskSummary).forEach(([task, summary]) => {
        const actualQty = summary.quantity || 0;
        const stdSpeed = standardThroughputs[task];
        
        let standardMinutes = 0;
        if (actualQty > 0 && stdSpeed > 0) {
            standardMinutes = (actualQty / stdSpeed);
            totalStandardMinutesNeeded += standardMinutes;
        } else if (summary.duration > 0) {
            standardMinutes = summary.duration;
            totalStandardMinutesNeeded += summary.duration;
        }

        if (stdSpeed > 0 && summary.duration > standardMinutes) {
             taskPerformanceLosses.push({
                 task: task,
                 lossMinutes: summary.duration - standardMinutes,
                 actualSpeed: (summary.avgThroughput || 0).toFixed(2),
                 stdSpeed: stdSpeed.toFixed(2)
             });
        }

        if (qualityTasksStr.has(task) && summary.cost > 0) {
            qualityLossTasks.push({ task: task, cost: summary.cost });
        }
    });

    const utilizationRate = totalStandardAvailableMinutes > 0 ? (totalActualWorkedMinutes / totalStandardAvailableMinutes) * 100 : 0;
    const efficiencyRatio = totalActualWorkedMinutes > 0 ? (totalStandardMinutesNeeded / totalActualWorkedMinutes) * 100 : 0;
    const qualityRatio = totalActualCost > 0 ? ((totalActualCost - totalQualityCost) / totalActualCost) * 100 : 100;
    const oee = (utilizationRate / 100) * (efficiencyRatio / 100) * (qualityRatio / 100) * 100;

    const avgActiveStaff = workingDaysCount > 0 ? totalActiveStaffSum / workingDaysCount : 0;
    const availableFTE = avgActiveStaff;
    const workedFTE = availableFTE * (utilizationRate / 100);
    const requiredFTE = workedFTE * (efficiencyRatio / 100);
    const qualityFTE = requiredFTE * (qualityRatio / 100);

    const avgCostPerMinute = totalActualWorkedMinutes > 0 ? totalActualCost / totalActualWorkedMinutes : 0;
    const availabilityLossMinutes = Math.max(0, totalStandardAvailableMinutes - totalActualWorkedMinutes);
    const performanceLossMinutes = Math.max(0, totalActualWorkedMinutes - totalStandardMinutesNeeded);
    const availabilityLossCost = availabilityLossMinutes * avgCostPerMinute;
    const performanceLossCost = performanceLossMinutes * avgCostPerMinute;
    const qualityLossCost = totalQualityCost;
    const totalLossCost = availabilityLossCost + performanceLossCost + qualityLossCost;

    const topPerformanceLossTasks = taskPerformanceLosses.sort((a, b) => b.lossMinutes - a.lossMinutes).slice(0, 3);
    const topQualityLossTasks = qualityLossTasks.sort((a, b) => b.cost - a.cost).slice(0, 3);

    return {
        utilizationRate, efficiencyRatio, qualityRatio, oee,
        availableFTE, workedFTE, requiredFTE, qualityFTE,
        totalLossCost, availabilityLossCost, performanceLossCost, qualityLossCost,
        totalStandardAvailableMinutes, totalActualWorkedMinutes, totalStandardMinutesNeeded,
        topPerformanceLossTasks, topQualityLossTasks, avgCostPerMinute
    };
};

export const PRODUCTIVITY_METRIC_DESCRIPTIONS = {
    utilizationRate: {
        title: "시간 활용률 (Availability)",
        desc: "표준 근무 시간(평일 8H, 주말 4H) 대비 실제 업무 수행 시간의 비율입니다. 낮으면 대기 시간이 많았음을, 100% 초과는 야근/특근이 발생했음을 의미합니다."
    },
    efficiencyRatio: {
        title: "업무 효율성 (Performance)",
        desc: "표준 속도 대비 실제 작업 속도의 비율입니다. 100%보다 높으면 표준보다 빠르게, 낮으면 느리게 작업했음을 의미합니다."
    },
    qualityRatio: {
        title: "품질 효율 (Quality)",
        desc: "전체 투입된 노력 중 재작업(COQ)을 제외한 유효한 성과의 비율입니다. (100% - COQ비율)과 유사합니다."
    },
    oee: {
        title: "종합 생산 효율 (OEE)",
        desc: "시간 활용률 × 업무 효율성 × 품질 효율. 팀의 전반적인 생산성 수준을 나타내는 최종 지표입니다."
    },
    availableFTE: {
        title: "총 투입 인력",
        desc: "기간 내 실제로 출근하여 근무한 연인원의 평균입니다."
    },
    workedFTE: {
        title: "실제 작업 인력",
        desc: "출근한 인원 중 실제로 업무를 수행하고 있던 시간만을 인원수로 환산한 값입니다."
    },
    requiredFTE: {
        title: "표준 필요 인력",
        desc: "실제 수행한 업무량을 우리 팀의 표준 속도로 처리했을 때 필요한 이론적인 인원수입니다."
    },
    qualityFTE: {
        title: "최종 유효 인력",
        desc: "재작업 등으로 낭비된 인력을 제외하고, 최종적으로 가치 있는 성과를 낸 실질 인력 규모입니다."
    }
};

export const generateProductivityDiagnosis = (metrics, prevMetrics, benchmarkOEE = null) => {
    if (!metrics) return null;
    const { utilizationRate, efficiencyRatio, qualityRatio, oee } = metrics;
    
    let diagnosis = { icon: '✅', title: '최적 상태 유지', desc: '업무 시간과 속도 모두 적절한 균형을 유지하고 있습니다.', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };
    const isOverloaded = utilizationRate >= 100;
    const isUnderloaded = utilizationRate <= 80;
    const isFast = efficiencyRatio >= 110;
    const isSlow = efficiencyRatio <= 90;

    if (isOverloaded && isFast) {
        diagnosis = { icon: '🔥', title: '극한 과부하 (Burnout 위험)', desc: '절대적인 시간이 부족한 와중에도 매우 빠르게 일하고 있습니다. 인원 충원이 시급합니다.', color: 'text-red-700', bg: 'bg-red-50 border-red-200' };
    } else if (isOverloaded && isSlow) {
        diagnosis = { icon: '💦', title: '비효율적 과로', desc: '장시간 근무하고 있지만 실제 처리 속도는 느립니다. 업무 프로세스 점검이나 교육이 필요합니다.', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' };
    } else if (isOverloaded) {
         diagnosis = { icon: '⏰', title: '시간 부족 (과부하)', desc: '표준 근무 시간을 초과하여 업무를 수행했습니다. 업무량 조절이 필요합니다.', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' };
    } else if (isUnderloaded && isFast) {
        diagnosis = { icon: '⚡', title: '유휴 인력 발생 (고숙련)', desc: '업무를 빨리 끝내고 남는 시간이 많습니다. 더 많은 업무를 배정하거나 인원을 효율화할 수 있습니다.', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else if (isUnderloaded && isSlow) {
        diagnosis = { icon: '⚠️', title: '생산성 저하', desc: '시간적 여유가 있음에도 업무 속도가 느립니다. 동기 부여나 집중 근무 관리가 필요해 보입니다.', color: 'text-gray-700', bg: 'bg-gray-100 border-gray-300' };
    } else if (isUnderloaded) {
         diagnosis = { icon: '☕', title: '시간 여유', desc: '표준 근무 시간 대비 실제 업무 수행 시간이 적습니다. (대기 시간 발생)', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' };
    } else if (isFast) {
         diagnosis = { icon: '🚀', title: '고효율 상태', desc: '적절한 근무 시간 내에서 표준보다 빠르게 성과를 내고 있습니다.', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else if (isSlow) {
         diagnosis = { icon: '🐢', title: '속도 개선 필요', desc: '근무 시간은 적절하나 표준 속도보다 다소 느립니다.', color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' };
    }

    let comments = [];
    if (utilizationRate >= 105) comments.push(`팀원들이 표준 근무 시간보다 <strong>약 ${(utilizationRate - 100).toFixed(0)}% 더 많이</strong> 일했습니다. 지속적인 초과 근무는 피로 누적을 유발할 수 있습니다.`);
    else if (utilizationRate <= 75) comments.push(`근무 시간 중 <strong>약 ${(100 - utilizationRate).toFixed(0)}%가 대기 시간</strong> 등으로 활용되지 못했습니다. 업무 배분 효율화가 필요해 보입니다.`);
    else comments.push(`근무 시간 활용률은 <strong>${utilizationRate.toFixed(0)}%</strong>로 적정 수준을 유지했습니다.`);

    if (efficiencyRatio >= 115) comments.push(`표준 속도보다 <strong>${(efficiencyRatio - 100).toFixed(0)}% 더 빠르게</strong> 업무를 처리하며 뛰어난 숙련도를 보였습니다.`);
    else if (efficiencyRatio <= 85) comments.push(`표준 대비 <strong>속도가 다소 저하(${(100 - efficiencyRatio).toFixed(0)}% 느림)</strong>되었습니다. 병목 현상이 있었는지 확인이 필요합니다.`);

    if (qualityRatio < 95) comments.push(`재작업 등으로 인한 <strong>품질 손실이 약 ${(100 - qualityRatio).toFixed(1)}%</strong> 발생했습니다. 오류 감소를 위한 노력이 필요합니다.`);

    if (oee >= 85) comments.push(`종합적으로 <strong>매우 우수한 생산성(OEE ${oee.toFixed(0)}%)</strong>을 기록했습니다. 👏`);
    else if (oee <= 60) comments.push(`전반적인 생산성 지표가 낮습니다. <strong>가장 큰 손실 요인(${utilizationRate < 80 ? '대기시간' : (efficiencyRatio < 90 ? '속도저하' : '품질이슈')})</strong>부터 개선하는 것이 좋습니다.`);

    if (benchmarkOEE !== null && benchmarkOEE > 0) {
        const diff = oee - benchmarkOEE;
        if (diff >= 5) {
            comments.push(`📉 최근 30일 평균 OEE(${benchmarkOEE.toFixed(0)}%)보다 <strong>${diff.toFixed(0)}%p 더 높은</strong> 우수한 성과입니다!`);
        } else if (diff <= -5) {
             comments.push(`📉 최근 30일 평균 OEE(${benchmarkOEE.toFixed(0)}%)에 비해 <strong>${Math.abs(diff).toFixed(0)}%p 낮습니다.</strong> 원인 파악이 필요합니다.`);
        } else {
             comments.push(`평소 수준(최근 30일 평균 ${benchmarkOEE.toFixed(0)}%)의 생산성을 유지했습니다.`);
        }
    }

    return {
        diagnosis,
        commentHtml: comments.join('<br>')
    };
};