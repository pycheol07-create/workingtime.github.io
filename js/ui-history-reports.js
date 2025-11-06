// === js/ui-history-reports.js ===
import { getWeekOfYear } from './utils.js';

import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData,
    // calculateStandardThroughputs, // (삭제됨)
    calculateThroughputBenchmarks,   // ✨ (신규 추가됨)
    analyzeRevenueBasedStaffing,
    analyzeRevenueWorkloadTrend,
    calculateAdvancedProductivity
} from './ui-history-reports-logic.js';

import {
    renderGenericReport
} from './ui-history-reports-renderer.js';


const _prepareReportData = (currentDaysData, previousDaysData, appConfig) => {
    // ... (기존 코드 유지) ...
     const wageMap = { ...(appConfig.memberWages || {}) };
    [...currentDaysData, ...previousDaysData].forEach(day => {
        (day.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });
    });

    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        group.members.forEach(member => {
            memberToPartMap.set(member, group.name);
        });
    });

    return { wageMap, memberToPartMap };
};

const _calculateAverageActiveMembers = (daysData, appConfig, wageMap) => {
    // ... (기존 코드 유지) ...
    if (!daysData || daysData.length === 0) return 0;
    const workingDays = daysData.filter(d => d.workRecords && d.workRecords.length > 0);
    if (workingDays.length === 0) return 0;

    const totalActive = workingDays.reduce((sum, day) => {
        return sum + calculateReportKPIs(day, appConfig, wageMap).activeMembersCount;
    }, 0);
    return totalActive / workingDays.length;
};


export const renderReportDaily = (dateKey, allHistoryData, appConfig, context) => {
    // ... (일별 리포트는 비교 범위가 하루이므로 'Range Best'가 큰 의미가 없을 수 있지만, 일관성을 위해 유지하거나 단순화할 수 있습니다. 일단 동일 로직 적용) ...
     const view = document.getElementById('report-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">일별 리포트 집계 중...</div>';

    context.currentReportParams = { dateKey, allHistoryData, appConfig };

    const data = allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-gray-500">데이터 없음</div>';
        return;
    }

    const currentIndex = allHistoryData.findIndex(d => d.id === dateKey);
    const previousDayData = (currentIndex > -1 && currentIndex + 1 < allHistoryData.length)
                                ? allHistoryData[currentIndex + 1]
                                : null;

    const currentDays = [data];
    const { wageMap, memberToPartMap } = _prepareReportData(currentDays, [previousDayData].filter(Boolean), appConfig);

    const todayKPIs = calculateReportKPIs(data, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(data, appConfig, wageMap, memberToPartMap);

    const prevKPIs = calculateReportKPIs(previousDayData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(previousDayData, appConfig, wageMap, memberToPartMap);

    // ✨ 벤치마크 계산 (일별은 Range Best가 자기 자신이 됨)
    const benchmarks = calculateThroughputBenchmarks(allHistoryData, currentDays);
    const todayStaffing = calculateAdvancedProductivity(currentDays, todayAggr, benchmarks, appConfig, wageMap);
    // (이전 일자 staffing 계산 시에는 이전 일자 기준 벤치마크가 필요할 수 있으나, 단순화를 위해 현재 기준 사용)

    const sortState = context.reportSortState || {};

    renderGenericReport(
        'report-daily-view',
        `${dateKey} 업무 리포트 (이전 기록 대비)`,
        { raw: data, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, benchmarks: benchmarks }, // benchmarks 전달
        { kpis: prevKPIs, aggr: prevAggr },
        appConfig,
        sortState,
        '기록'
    );
};

export const renderReportWeekly = (weekKey, allHistoryData, appConfig, context) => {
    // ...
    const view = document.getElementById('report-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 리포트 집계 중...</div>';

    context.currentReportParams = { weekKey, allHistoryData, appConfig };

    const currentWeekDays = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);

    const sortedWeeks = Array.from(new Set(allHistoryData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedWeeks.indexOf(weekKey);
    const prevWeekKey = (currentIndex > -1 && currentIndex + 1 < sortedWeeks.length) ? sortedWeeks[currentIndex + 1] : null;
    const prevWeekDays = prevWeekKey ? allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === prevWeekKey) : [];

    const { wageMap, memberToPartMap } = _prepareReportData(currentWeekDays, prevWeekDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentWeekDays, weekKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevWeekDays, prevWeekKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    todayKPIs.activeMembersCount = _calculateAverageActiveMembers(currentWeekDays, appConfig, wageMap);
    prevKPIs.activeMembersCount = _calculateAverageActiveMembers(prevWeekDays, appConfig, wageMap);

    // ✨ 벤치마크 및 고급 분석
    const benchmarks = calculateThroughputBenchmarks(allHistoryData, currentWeekDays);
    const todayStaffing = calculateAdvancedProductivity(currentWeekDays, todayAggr, benchmarks, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevWeekDays, prevAggr, benchmarks, appConfig, wageMap);

    const sortState = context.reportSortState || {};

    renderGenericReport(
        'report-weekly-view',
        `${weekKey} 주별 업무 리포트 (이전 주 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, benchmarks: benchmarks },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '주'
    );
};

export const renderReportMonthly = (monthKey, allHistoryData, appConfig, context) => {
    // ...
    const view = document.getElementById('report-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 리포트 집계 중...</div>';

    context.currentReportParams = { monthKey, allHistoryData, appConfig };

    const currentMonthDays = allHistoryData.filter(d => d.id.substring(0, 7) === monthKey);

    const sortedMonths = Array.from(new Set(allHistoryData.map(d => d.id.substring(0, 7)))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedMonths.indexOf(monthKey);
    const prevMonthKey = (currentIndex > -1 && currentIndex + 1 < sortedMonths.length) ? sortedMonths[currentIndex + 1] : null;
    const prevMonthDays = prevMonthKey ? allHistoryData.filter(d => d.id.substring(0, 7) === prevMonthKey) : [];

    const { wageMap, memberToPartMap } = _prepareReportData(currentMonthDays, prevMonthDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentMonthDays, monthKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevMonthDays, prevMonthKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    todayKPIs.activeMembersCount = _calculateAverageActiveMembers(currentMonthDays, appConfig, wageMap);
    prevKPIs.activeMembersCount = _calculateAverageActiveMembers(prevMonthDays, appConfig, wageMap);

    // ✨ 벤치마크 및 고급 분석
    const benchmarks = calculateThroughputBenchmarks(allHistoryData, currentMonthDays);
    const todayStaffing = calculateAdvancedProductivity(currentMonthDays, todayAggr, benchmarks, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevMonthDays, prevAggr, benchmarks, appConfig, wageMap);

    context.monthlyRevenues = context.monthlyRevenues || {};
    const currentRevenue = context.monthlyRevenues[monthKey] || 0;
    const prevRevenue = prevMonthKey ? (context.monthlyRevenues[prevMonthKey] || 0) : 0;

    const revenueAnalysis = analyzeRevenueBasedStaffing(
        currentRevenue,
        todayStaffing.totalStandardMinutesNeeded,
        todayKPIs.activeMembersCount,
        todayKPIs.totalDuration,
        appConfig
    );

    const revenueTrendAnalysis = analyzeRevenueWorkloadTrend(
        currentRevenue,
        prevRevenue,
        todayStaffing.totalStandardMinutesNeeded,
        prevStaffing.totalStandardMinutesNeeded
    );

    const sortState = context.reportSortState || {};

    renderGenericReport(
        'report-monthly-view',
        `${monthKey} 월별 업무 리포트 (이전 월 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap, revenue: currentRevenue },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, revenueAnalysis: revenueAnalysis, revenueTrend: revenueTrendAnalysis, benchmarks: benchmarks },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '월',
        prevRevenue
    );
};

export const renderReportYearly = (yearKey, allHistoryData, appConfig, context) => {
    // ...
    const view = document.getElementById('report-yearly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">연간 리포트 집계 중...</div>';

    context.currentReportParams = { yearKey, allHistoryData, appConfig };

    const currentYearDays = allHistoryData.filter(d => d.id.substring(0, 4) === yearKey);

    const sortedYears = Array.from(new Set(allHistoryData.map(d => d.id.substring(0, 4)))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedYears.indexOf(yearKey);
    const prevYearKey = (currentIndex > -1 && currentIndex + 1 < sortedYears.length) ? sortedYears[currentIndex + 1] : null;
    const prevYearDays = prevYearKey ? allHistoryData.filter(d => d.id.substring(0, 4) === prevYearKey) : [];

    const { wageMap, memberToPartMap } = _prepareReportData(currentYearDays, prevYearDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentYearDays, yearKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevYearDays, prevYearKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    todayKPIs.activeMembersCount = _calculateAverageActiveMembers(currentYearDays, appConfig, wageMap);
    prevKPIs.activeMembersCount = _calculateAverageActiveMembers(prevYearDays, appConfig, wageMap);

    // ✨ 벤치마크 및 고급 분석
    const benchmarks = calculateThroughputBenchmarks(allHistoryData, currentYearDays);
    const todayStaffing = calculateAdvancedProductivity(currentYearDays, todayAggr, benchmarks, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevYearDays, prevAggr, benchmarks, appConfig, wageMap);

    const sortState = context.reportSortState || {};

    renderGenericReport(
        'report-yearly-view',
        `${yearKey} 연간 업무 리포트 (이전 연도 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, benchmarks: benchmarks },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '연도'
    );
};