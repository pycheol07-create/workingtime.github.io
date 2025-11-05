// === ui-history-reports.js (리포트 메인 파일 - 최종) ===

import { getWeekOfYear } from './utils.js';

// 1. 계산/집계 로직 import
import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData
} from './ui-history-reports-logic.js';

// 2. HTML 렌더링 로직 import
import {
    renderGenericReport
} from './ui-history-reports-renderer.js';


/**
 * [공통] 리포트 데이터 준비 헬퍼
 * ( wageMap, memberToPartMap 생성 )
 */
const _prepareReportData = (currentDaysData, previousDaysData, appConfig) => {
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

/**
 * 일별 리포트 렌더링
 */
export const renderReportDaily = (dateKey, allHistoryData, appConfig, context) => {
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

    const { wageMap, memberToPartMap } = _prepareReportData([data], [previousDayData].filter(Boolean), appConfig);

    const todayKPIs = calculateReportKPIs(data, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(data, appConfig, wageMap, memberToPartMap);
    
    const prevKPIs = calculateReportKPIs(previousDayData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(previousDayData, appConfig, wageMap, memberToPartMap);
    
    const sortState = context.reportSortState || {};

    renderGenericReport(
        'report-daily-view',
        `${dateKey} 업무 리포트 (이전 기록 대비)`,
        { raw: data, memberToPartMap: memberToPartMap }, // tData
        { kpis: todayKPIs, aggr: todayAggr }, // tMetrics
        { kpis: prevKPIs, aggr: prevAggr }, // pMetrics
        appConfig,
        sortState,
        '기록'
    );
};

/**
 * 주별 리포트 렌더링
 */
export const renderReportWeekly = (weekKey, allHistoryData, appConfig, context) => { 
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
    
    const sortState = context.reportSortState || {};
    
    // 주간 KPI 수정 (비업무 시간 -> 0, 근무 인원 -> 평균)
    todayKPIs.nonWorkMinutes = 0; 
    prevKPIs.nonWorkMinutes = 0;
    todayKPIs.activeMembersCount = todayKPIs.activeMembersCount / (currentWeekDays.length || 1);
    prevKPIs.activeMembersCount = prevKPIs.activeMembersCount / (prevWeekDays.length || 1);

    renderGenericReport(
        'report-weekly-view',
        `${weekKey} 주별 업무 리포트 (이전 주 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap }, // tData
        { kpis: todayKPIs, aggr: todayAggr }, // tMetrics
        { kpis: prevKPIs, aggr: prevAggr }, // pMetrics
        appConfig,
        sortState,
        '주'
    );
};

/**
 * 월별 리포트 렌더링
 */
export const renderReportMonthly = (monthKey, allHistoryData, appConfig, context) => { 
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
    
    const sortState = context.reportSortState || {};

    // 월간 KPI 수정 (비업무 시간 -> 0, 근무 인원 -> 평균)
    todayKPIs.nonWorkMinutes = 0; 
    prevKPIs.nonWorkMinutes = 0;
    todayKPIs.activeMembersCount = todayKPIs.activeMembersCount / (currentMonthDays.length || 1);
    prevKPIs.activeMembersCount = prevKPIs.activeMembersCount / (prevMonthDays.length || 1);

    renderGenericReport(
        'report-monthly-view',
        `${monthKey} 월별 업무 리포트 (이전 월 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap }, // tData
        { kpis: todayKPIs, aggr: todayAggr }, // tMetrics
        { kpis: prevKPIs, aggr: prevAggr }, // pMetrics
        appConfig,
        sortState,
        '월'
    );
};

/**
 * 연간 리포트 렌더링
 */
export const renderReportYearly = (yearKey, allHistoryData, appConfig, context) => { 
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
    
    const sortState = context.reportSortState || {};

    // 연간 KPI 수정 (비업무 시간 -> 0, 근무 인원 -> 평균)
    todayKPIs.nonWorkMinutes = 0; 
    prevKPIs.nonWorkMinutes = 0;
    todayKPIs.activeMembersCount = todayKPIs.activeMembersCount / (currentYearDays.length || 1);
    prevKPIs.activeMembersCount = prevKPIs.activeMembersCount / (prevYearDays.length || 1);

    renderGenericReport(
        'report-yearly-view',
        `${yearKey} 연간 업무 리포트 (이전 연도 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap }, // tData
        { kpis: todayKPIs, aggr: todayAggr }, // tMetrics
        { kpis: prevKPIs, aggr: prevAggr }, // pMetrics
        appConfig,
        sortState,
        '연도'
    );
};