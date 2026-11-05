// === js/ui-history-reports.js ===
import { buildMemberHourlyWageMap, getTodayDateString } from './utils.js?v=202611051422';
import { aliasHistoryView } from './lib/task-alias-view.js?v=202611051422';
import { baselineSpeeds, previousPeriodOf, periodDaysOf, lastDayIdOf } from './lib/ops-metrics.js?v=202611051422';

import {
    calculateReportKPIs,
    calculateReportAggregations,
    aggregateDaysToSingleData,
    analyzeRevenueBasedStaffing,
    analyzeRevenueWorkloadTrend,
    calculateAdvancedProductivity,
    calculateBenchmarkOEE,
    calculateAverageStaffing
} from './ui-history-reports-logic.js?v=202611051422';

import {
    renderGenericReport
} from './ui-history-reports-renderer.js?v=202611051422';


const _prepareReportData = (currentDaysData, previousDaysData, appConfig) => {
    const wageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)
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

/** 평상시 기준 속도(이력 전체, 기간 끝 날짜까지, 오늘 제외) — 효율·필요 인원·업무 표 '평상시 속도' 열의 기준
 *  (운영 지표 표준, js/lib/ops-metrics.js). 예전엔 그 기간의 속도를 기준으로 써서 효율이 구조상 100% 근처였다.
 *  until 을 기간 끝으로 둬 옛 기간에 그 뒤 시점의 속도가 섞이지 않게 한다. */
const _baselineSpeeds = (allHistoryData, until) => baselineSpeeds(allHistoryData, { skipDate: getTodayDateString(), until });

/** 인원·비업무 시간 칸을 운영 지표 표준 값으로 — 투입 인원 = 출근 인원 평균, 비업무 = 재실시간 − 업무 기록.
 *  옛 값(명부 − 휴가, 명부 × 8시간 − 기록)은 rosterMembersCount 로 참고만 남긴다. */
const _applyOpsStaff = (kpis, staffing) => {
    kpis.rosterMembersCount = staffing.rosterAvg;
    kpis.activeMembersCount = staffing.availableFTE;
    kpis.nonWorkMinutes = staffing.availabilityLossMinutes;
};

/** 그리기 모드 — opts.only 를 주면 그걸 쓰고 State.context.reportOnly 에 기억한다(정렬·필터 때 opts 없이 다시 불러도 같은 모드).
 *  'tables' = 상세 표만(운영 리포트 생산성 탭 '상세 표'), null = 전체 리포트. */
const _reportOnly = (context, opts) => {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'only')) context.reportOnly = opts.only || null;
    return context.reportOnly || null;
};

export const renderReportDaily = (dateKey, allHistoryData, appConfig, context, opts = {}) => {
    const only = _reportOnly(context, opts);
    allHistoryData = aliasHistoryView(allHistoryData, appConfig);   // 🆔 옛 이름 기록도 지금 이름으로 합쳐 본다(읽기 전용 사본 — js/lib/task-alias-view.js)
    const view = document.getElementById('report-daily-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">일별 리포트 집계 중...</div>';

    context.currentReportParams = { dateKey, allHistoryData, appConfig };

    const data = allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-gray-500">데이터 없음</div>';
        return;
    }

    // 전기 = 직전 운영일(업무·출근 기록이 있는 날). 예전엔 목록 바로 앞 문서였다(빈 주말 문서일 수 있었다).
    const previousDayData = previousPeriodOf('day', dateKey, allHistoryData).days[0] || null;

    const { wageMap, memberToPartMap } = _prepareReportData([data], [previousDayData].filter(Boolean), appConfig);

    const todayKPIs = calculateReportKPIs(data, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(data, appConfig, wageMap, memberToPartMap);

    const prevKPIs = calculateReportKPIs(previousDayData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(previousDayData, appConfig, wageMap, memberToPartMap);

    const todayAvgStaff = calculateAverageStaffing([data]);
    const prevAvgStaff = previousDayData ? calculateAverageStaffing([previousDayData]) : {};

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const speeds = _baselineSpeeds(allHistoryData, dateKey);
    const todayStaffing = calculateAdvancedProductivity([data], todayAggr, speeds, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity([previousDayData].filter(Boolean), prevAggr, speeds, appConfig, wageMap);
    _applyOpsStaff(todayKPIs, todayStaffing);
    _applyOpsStaff(prevKPIs, prevStaffing);

    const benchmarkOEE = only === 'tables' ? null : calculateBenchmarkOEE(allHistoryData, appConfig);   // 상세 표만이면 안 쓴다

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'daily',
        title: `${dateKey} 업무 리포트`,
        tData: { raw: data, memberToPartMap },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs: speeds // 렌더러 업무 표 '평상시 속도' 열
    };

    renderGenericReport(
        'report-daily-view',
        `${dateKey} 업무 리포트 (이전 기록 대비)`,
        { raw: data, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '기록',
        0,
        benchmarkOEE,
        speeds,
        { only }
    );
};

export const renderReportWeekly = (weekKey, allHistoryData, appConfig, context, opts = {}) => {
    const only = _reportOnly(context, opts);
    allHistoryData = aliasHistoryView(allHistoryData, appConfig);   // 🆔 옛 이름 기록도 지금 이름으로 합쳐 본다(읽기 전용 사본 — js/lib/task-alias-view.js)
    const view = document.getElementById('report-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 리포트 집계 중...</div>';

    context.currentReportParams = { weekKey, allHistoryData, appConfig };

    const currentWeekDays = periodDaysOf('week', weekKey, allHistoryData);
    // 전기 = 직전 같은 단위 달력 기간(운영 지표 표준). 예전엔 목록에서 바로 앞 기간 키였다(빈 기간을 건너뛰었다).
    const { key: prevWeekKey, days: prevWeekDays } = previousPeriodOf('week', weekKey, allHistoryData);

    const { wageMap, memberToPartMap } = _prepareReportData(currentWeekDays, prevWeekDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentWeekDays, weekKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevWeekDays, prevWeekKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    const todayAvgStaff = calculateAverageStaffing(currentWeekDays);
    const prevAvgStaff = calculateAverageStaffing(prevWeekDays);

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const speeds = _baselineSpeeds(allHistoryData, lastDayIdOf(currentWeekDays));
    const todayStaffing = calculateAdvancedProductivity(currentWeekDays, todayAggr, speeds, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevWeekDays, prevAggr, speeds, appConfig, wageMap);
    _applyOpsStaff(todayKPIs, todayStaffing);
    _applyOpsStaff(prevKPIs, prevStaffing);
    
    const benchmarkOEE = only === 'tables' ? null : calculateBenchmarkOEE(allHistoryData, appConfig);   // 상세 표만이면 안 쓴다

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'weekly',
        title: `${weekKey} 주별 업무 리포트`,
        tData: { raw: todayData, memberToPartMap },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs: speeds
    };

    renderGenericReport(
        'report-weekly-view',
        `${weekKey} 주별 업무 리포트 (이전 주 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '주',
        0,
        benchmarkOEE,
        speeds,
        { only }
    );
};

export const renderReportMonthly = (monthKey, allHistoryData, appConfig, context, opts = {}) => {
    const only = _reportOnly(context, opts);
    allHistoryData = aliasHistoryView(allHistoryData, appConfig);   // 🆔 옛 이름 기록도 지금 이름으로 합쳐 본다(읽기 전용 사본 — js/lib/task-alias-view.js)
    const view = document.getElementById('report-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 리포트 집계 중...</div>';

    context.currentReportParams = { monthKey, allHistoryData, appConfig };

    const currentMonthDays = periodDaysOf('month', monthKey, allHistoryData);
    // 전기 = 직전 같은 단위 달력 기간(운영 지표 표준). 예전엔 목록에서 바로 앞 기간 키였다(빈 기간을 건너뛰었다).
    const { key: prevMonthKey, days: prevMonthDays } = previousPeriodOf('month', monthKey, allHistoryData);

    const { wageMap, memberToPartMap } = _prepareReportData(currentMonthDays, prevMonthDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentMonthDays, monthKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevMonthDays, prevMonthKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    const todayAvgStaff = calculateAverageStaffing(currentMonthDays);
    const prevAvgStaff = calculateAverageStaffing(prevMonthDays);

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const speeds = _baselineSpeeds(allHistoryData, lastDayIdOf(currentMonthDays));
    const todayStaffing = calculateAdvancedProductivity(currentMonthDays, todayAggr, speeds, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevMonthDays, prevAggr, speeds, appConfig, wageMap);
    _applyOpsStaff(todayKPIs, todayStaffing);
    _applyOpsStaff(prevKPIs, prevStaffing);

    // 매출 = 그 달 경영지표 채널 합계(revenueTotalOf). 예전 context.monthlyRevenues 는 어디서도 채우지 않아 늘 0 이었다.
    const currentRevenue = todayData.management.revenue || 0;
    const prevRevenue = prevMonthKey ? (prevData.management.revenue || 0) : 0;

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
    
    const benchmarkOEE = only === 'tables' ? null : calculateBenchmarkOEE(allHistoryData, appConfig);   // 상세 표만이면 안 쓴다

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'monthly',
        title: `${monthKey} 월별 업무 리포트`,
        tData: { raw: todayData, memberToPartMap, revenue: currentRevenue },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, revenueAnalysis, revenueTrend: revenueTrendAnalysis },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs: speeds
    };

    renderGenericReport(
        'report-monthly-view',
        `${monthKey} 월별 업무 리포트 (이전 월 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap, revenue: currentRevenue },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing, revenueAnalysis: revenueAnalysis, revenueTrend: revenueTrendAnalysis },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '월',
        prevRevenue,
        benchmarkOEE,
        speeds,
        { only }
    );
};

export const renderReportYearly = (yearKey, allHistoryData, appConfig, context, opts = {}) => {
    const only = _reportOnly(context, opts);
    allHistoryData = aliasHistoryView(allHistoryData, appConfig);   // 🆔 옛 이름 기록도 지금 이름으로 합쳐 본다(읽기 전용 사본 — js/lib/task-alias-view.js)
    const view = document.getElementById('report-yearly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">연간 리포트 집계 중...</div>';

    context.currentReportParams = { yearKey, allHistoryData, appConfig };

    const currentYearDays = periodDaysOf('year', yearKey, allHistoryData);
    // 전기 = 직전 같은 단위 달력 기간(운영 지표 표준). 예전엔 목록에서 바로 앞 기간 키였다(빈 기간을 건너뛰었다).
    const { key: prevYearKey, days: prevYearDays } = previousPeriodOf('year', yearKey, allHistoryData);

    const { wageMap, memberToPartMap } = _prepareReportData(currentYearDays, prevYearDays, appConfig);

    const todayData = aggregateDaysToSingleData(currentYearDays, yearKey);
    const todayKPIs = calculateReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = calculateReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    const prevData = aggregateDaysToSingleData(prevYearDays, prevYearKey);
    const prevKPIs = calculateReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = calculateReportAggregations(prevData, appConfig, wageMap, memberToPartMap);

    const todayAvgStaff = calculateAverageStaffing(currentYearDays);
    const prevAvgStaff = calculateAverageStaffing(prevYearDays);

    Object.keys(todayAggr.taskSummary).forEach(t => {
        todayAggr.taskSummary[t].avgDailyStaff = todayAvgStaff[t] || 0;
    });
    Object.keys(prevAggr.taskSummary).forEach(t => {
        prevAggr.taskSummary[t].avgDailyStaff = prevAvgStaff[t] || 0;
    });

    const speeds = _baselineSpeeds(allHistoryData, lastDayIdOf(currentYearDays));
    const todayStaffing = calculateAdvancedProductivity(currentYearDays, todayAggr, speeds, appConfig, wageMap);
    const prevStaffing = calculateAdvancedProductivity(prevYearDays, prevAggr, speeds, appConfig, wageMap);
    _applyOpsStaff(todayKPIs, todayStaffing);
    _applyOpsStaff(prevKPIs, prevStaffing);

    const sortState = context.reportSortState || {};

    context.lastReportData = {
        type: 'yearly',
        title: `${yearKey} 연간 업무 리포트`,
        tData: { raw: todayData, memberToPartMap },
        tMetrics: { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        pMetrics: { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        standardThroughputs: speeds
    };

    renderGenericReport(
        'report-yearly-view',
        `${yearKey} 연간 업무 리포트 (이전 연도 대비)`,
        { raw: todayData, memberToPartMap: memberToPartMap },
        { kpis: todayKPIs, aggr: todayAggr, staffing: todayStaffing },
        { kpis: prevKPIs, aggr: prevAggr, staffing: prevStaffing },
        appConfig,
        sortState,
        '연도',
        0,
        null,
        speeds,
        { only }
    );
};