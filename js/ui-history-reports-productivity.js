// === js/ui-history-reports-productivity.js ===
import { isWeekday, getTodayDateString, toDateString, buildMemberHourlyWageMap } from './utils.js?v=202611051401';
import { getAsArray } from './ui-history-reports-utils.js?v=202611051401';
import { calculateReportKPIs, calculateReportAggregations, calculateStandardThroughputs } from './ui-history-reports-calculations.js?v=202611051401';
import { TASK, isT } from './task-names.js?v=202611051401';
import { unitCost, periodMetrics, benchmarkOEE, baselineSpeeds, OEE_LEVELS, OVERLOAD_UTIL, overloadUtilOf } from './lib/ops-metrics.js?v=202611051401';

/** 🎯 최근 운영일 30일의 하루 OEE 평균 — 운영 지표 표준(js/lib/ops-metrics.js benchmarkOEE, 평상시 속도 기준). */
export const calculateBenchmarkOEE = (allHistoryData, appConfig) => {
    if (!allHistoryData || allHistoryData.length === 0) return null;
    const skipDate = getTodayDateString();
    return benchmarkOEE(allHistoryData, appConfig, { speeds: baselineSpeeds(allHistoryData, { skipDate }), skipDate });
};

/** 옛 벤치마크(그 기간 bestDays 속도·명부 인원 기준) — 비교 도구 전용. TODO(운영 리포트 2단계·비교표 승인 뒤): 지운다. */
export const calculateBenchmarkOEEOld = (allHistoryData, appConfig) => {
    if (!allHistoryData || allHistoryData.length === 0) return null;
    const recentData = [...allHistoryData].sort((a, b) => b.id.localeCompare(a.id)).slice(0, 30);
    if (recentData.length === 0) return null;

    let totalOEE = 0;
    let validDays = 0;
    const standardThroughputs = calculateStandardThroughputs(allHistoryData);

    recentData.forEach(day => {
        const wageMap = buildMemberHourlyWageMap(appConfig.memberWages); // 월기본급 → 시급(÷209)
        getAsArray(day.partTimers).forEach(pt => { if (pt && pt.name && !wageMap[pt.name]) wageMap[pt.name] = pt.wage || 0; });
        const dayAggr = calculateReportAggregations(day, appConfig, wageMap, new Map());
        const productivity = calculateAdvancedProductivityOld([day], dayAggr, standardThroughputs, appConfig, wageMap);
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
    const revenueUnit = 10000000; // 매출 1천만원 증가당 필요 인원 (관리자 설정 칸 삭제 2026-10-14 — 고정값)
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
        diagnosis = '수익성 경고: 매출 대비 업무량 급증'; colorClass = 'text-red-600';
    } else if (gap > 5) {
        diagnosis = '효율 저하: 업무량이 매출보다 더 빠르게 증가 중'; colorClass = 'text-orange-600';
    } else if (gap < -10) {
        diagnosis = '수익성 대폭 개선: 매출 급증에도 업무량은 안정적'; colorClass = 'text-blue-600';
    } else if (gap < -5) {
        diagnosis = '효율 개선: 매출 증가폭이 업무량 증가폭을 상회'; colorClass = 'text-green-600';
    } else {
        diagnosis = '균형 성장: 매출과 업무량이 비례하여 증가'; colorClass = 'text-gray-800';
    }
    return { revenueChangeRate, workloadChangeRate, gap, diagnosis, colorClass };
};

/** 건당 출고원가 — js/lib/ops-metrics.js unitCost 로 옮겼다(같은 함수). 옛 이름으로도 부른다. */
export const analyzeUnitCost = unitCost;

/**
 * 가동률·효율·품질·OEE·필요 인원·손실 — 운영 지표 표준(js/lib/ops-metrics.js periodMetrics)으로 계산한다(운영 리포트 1단계).
 * standardThroughputs 는 **평상시 속도**(baselineSpeeds — 전체 이력, 오늘 제외)를 넘길 것.
 *   예전엔 그 기간의 속도(calculatePeriodThroughputs)를 넘겨 효율이 구조상 100% 근처였다.
 * currentDataAggr 는 쓰지 않는다(옛 호출 모양 그대로 두려고 받기만 한다). 반환 칸 이름은 예전과 같다.
 */
export const calculateAdvancedProductivity = (daysData, currentDataAggr, standardThroughputs, appConfig, wageMap) =>
    periodMetrics(daysData, appConfig, { speeds: standardThroughputs || {}, wageMap });

/** 옛 계산(명부 인원 × 표준시간, 넘겨받은 속도) — 비교 도구 전용. TODO(운영 리포트 2단계·비교표 승인 뒤): 지운다. */
export const calculateAdvancedProductivityOld = (daysData, currentDataAggr, standardThroughputs, appConfig, wageMap) => {
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
        const workRecords = getAsArray(day.workRecords);
        if (workRecords.length > 0) {
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
        desc: "출근해 있던 시간(출퇴근 기록, 점심 제외 · 퇴근 기록이 없으면 표준 근무시간) 중 업무 기록이 있는 시간의 비율입니다. 낮으면 대기·미기록 시간이 많았다는 뜻입니다."
    },
    efficiencyRatio: {
        title: "업무 효율성 (Performance)",
        desc: "평상시 속도(이력 전체, 기간 끝 날짜까지의 평균)로 처리했다면 걸렸을 시간 ÷ 실제 걸린 시간입니다. 평소 속도 = 100% — 높으면 평소보다 빠르게, 낮으면 느리게 작업했음을 의미합니다(OEE 에는 100%까지만 반영)."
    },
    qualityRatio: {
        title: "품질 효율 (Quality)",
        desc: "전체 투입된 노력 중 재작업(COQ)을 제외한 유효한 성과의 비율입니다. (100% - COQ비율)과 유사합니다."
    },
    oee: {
        title: "종합 생산 효율 (OEE)",
        desc: "시간 활용률 × 업무 효율성 × 품질 효율. 활용률·효율성은 각각 100%까지만 반영합니다(평소보다 빠른 몫은 OEE 를 올리지 않음). 2026-11-05부터 새 기준이라 그 전 리포트·결산 PDF 와 다를 수 있습니다."
    },
    availableFTE: {
        title: "총 투입 인력",
        desc: "기간 내 운영일마다 실제로 출근한 인원(출근 기록, 없으면 업무 기록)의 평균입니다."
    },
    workedFTE: {
        title: "실제 작업 인력",
        desc: "출근한 인원 중 실제로 업무를 수행하고 있던 시간만을 인원수로 환산한 값입니다(총 투입 인력 × 시간 활용률)."
    },
    requiredFTE: {
        title: "표준 필요 인력",
        desc: "실제 처리한 물량을 평상시 속도로 처리하는 데 필요한 시간 ÷ (1인 재실시간 × 가동률 설정) — 인력 화면의 필요 인원과 같은 값으로, 총 투입(출근) 인력과 비교합니다."
    },
    qualityFTE: {
        title: "최종 유효 인력",
        desc: "실작업 인력 × 업무 효율성(= 평상시 속도로 했을 때 필요한 실작업 인력)에서 재작업 등 품질 손실을 뺀, 최종적으로 가치 있는 성과를 낸 실질 인력 규모입니다."
    }
};

export const generateProductivityDiagnosis = (metrics, prevMetrics, benchmarkOEE = null) => {
    if (!metrics) return null;
    const { utilizationRate, efficiencyRatio, qualityRatio, oee } = metrics;
    
    let diagnosis = { title: '최적 상태 유지', desc: '업무 시간과 속도 모두 적절한 균형을 유지하고 있습니다.', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };
    // 과부하 = 명부 안 사람의 가동률(손실 계산의 기록 분 ÷ 재실 분)이 OVERLOAD_UTIL(95%) 이상 — 여유 시간이 거의 없음
    const loadUtil = overloadUtilOf(metrics);
    const isOverloaded = loadUtil >= OVERLOAD_UTIL;
    const isUnderloaded = utilizationRate <= 80;
    const isFast = efficiencyRatio >= 110;
    const isSlow = efficiencyRatio <= 90;

    if (isOverloaded && isFast) {
        diagnosis = { title: '극한 과부하 (Burnout 위험)', desc: '절대적인 시간이 부족한 와중에도 매우 빠르게 일하고 있습니다. 인원 충원이 시급합니다.', color: 'text-red-700', bg: 'bg-red-50 border-red-200' };
    } else if (isOverloaded && isSlow) {
        diagnosis = { title: '비효율적 과로', desc: '장시간 근무하고 있지만 실제 처리 속도는 느립니다. 업무 프로세스 점검이나 교육이 필요합니다.', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' };
    } else if (isOverloaded) {
         diagnosis = { title: '시간 부족 (과부하)', desc: '출근해 있던 시간이 거의 모두 업무로 채워져 여유 시간이 거의 없습니다. 업무량 조절 필요.', color: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' };
    } else if (isUnderloaded && isFast) {
        diagnosis = { title: '유휴 인력 발생 (고숙련)', desc: '업무를 빨리 끝내고 남는 시간이 많습니다. 인원 효율화 가능.', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else if (isUnderloaded && isSlow) {
        diagnosis = { title: '생산성 저하', desc: '시간적 여유가 있음에도 업무 속도가 느립니다.', color: 'text-gray-700', bg: 'bg-gray-100 border-gray-300' };
    } else if (isUnderloaded) {
         diagnosis = { title: '시간 여유', desc: '표준 시간 대비 실제 업무 수행 시간이 적습니다.', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' };
    } else if (isFast) {
         diagnosis = { title: '고효율 상태', desc: '적절한 시간 내에서 표준보다 빠르게 성과를 냅니다.', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else if (isSlow) {
         diagnosis = { title: '속도 개선 필요', desc: '시간은 적절하나 다소 느립니다.', color: 'text-yellow-600', bg: 'bg-yellow-50 border-yellow-200' };
    }

    let comments = [];
    if (isOverloaded) comments.push(`출근해 있던 시간의 <strong>${loadUtil.toFixed(0)}%를 업무에 썼습니다</strong> — 여유 시간이 거의 없었습니다.`);
    else if (utilizationRate <= 75) comments.push(`근무 시간 중 <strong>약 ${(100 - utilizationRate).toFixed(0)}%가 대기 시간</strong> 등으로 활용되지 못했습니다.`);
    else comments.push(`근무 시간 활용률은 <strong>${utilizationRate.toFixed(0)}%</strong>로 적정 수준입니다.`);

    if (efficiencyRatio >= 115) comments.push(`표준 속도보다 <strong>${(efficiencyRatio - 100).toFixed(0)}% 더 빠르게</strong> 처리했습니다.`);
    else if (efficiencyRatio <= 85) comments.push(`표준 대비 <strong>속도가 다소 저하(${(100 - efficiencyRatio).toFixed(0)}% 느림)</strong>되었습니다.`);

    if (qualityRatio < 95) comments.push(`재작업 등으로 인한 <strong>품질 손실이 약 ${(100 - qualityRatio).toFixed(1)}%</strong> 발생했습니다.`);

    if (oee >= OEE_LEVELS.good) comments.push(`종합적으로 <strong>매우 우수한 생산성(OEE ${oee.toFixed(0)}%)</strong>을 기록했습니다.`);
    else if (oee < OEE_LEVELS.warn) comments.push(`전반적인 생산성 지표가 낮습니다. 원인 분석이 필요합니다.`);

    if (benchmarkOEE !== null && benchmarkOEE > 0) {
        const diff = oee - benchmarkOEE;
        if (diff >= 5) comments.push(`최근 30일 평균 OEE(${benchmarkOEE.toFixed(0)}%)보다 <strong>${diff.toFixed(0)}%p 더 높은</strong> 우수한 성과입니다!`);
        else if (diff <= -5) comments.push(`최근 30일 평균 OEE(${benchmarkOEE.toFixed(0)}%)에 비해 <strong>${Math.abs(diff).toFixed(0)}%p 낮습니다.</strong>`);
        else comments.push(`평소 수준(최근 30일 평균 ${benchmarkOEE.toFixed(0)}%)을 유지했습니다.`);
    }

    return { diagnosis, commentHtml: comments.join('<br>') };
};

