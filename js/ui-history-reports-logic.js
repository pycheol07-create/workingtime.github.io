// === js/ui-history-reports-logic.js ===
// 설명: 업무 리포트의 데이터 집계, 분석, 비교 로직 및 공통 헬퍼 함수들을 담당합니다.

import { getWeekOfYear, calculateDateDifference } from './utils.js';

// --- 1. UI 헬퍼 함수 (Renderer에서 사용) ---

export const getDiffHtmlForMetric = (metricKey, currentVal, prevVal) => {
    if (prevVal === undefined || prevVal === null || prevVal === 0) return '<span class="text-xs text-gray-300 block mt-1">-</span>';
    
    const diff = currentVal - prevVal;
    const rate = (diff / prevVal) * 100;
    const isPositiveGood = !['overallAvgCostPerItem', 'nonWorkTime', 'coqPercentage'].includes(metricKey); // 비용, 비업무, COQ는 낮을수록 좋음
    
    let colorClass = 'text-gray-500';
    let icon = '';

    if (diff > 0) {
        // 일반적: 증가(파랑/초록), 감소(빨강). 단, 비용은 반대.
        // 여기서는 Tailwind 색상 기준: 긍정(Blue/Green), 부정(Red)
        colorClass = isPositiveGood ? 'text-blue-600' : 'text-red-600';
        icon = '▲';
    } else if (diff < 0) {
        colorClass = isPositiveGood ? 'text-red-600' : 'text-blue-600';
        icon = '▼';
    }

    return `<span class="text-xs ${colorClass} block mt-1 font-medium">${icon} ${Math.abs(rate).toFixed(1)}%</span>`;
};

export const createTableRow = (cells) => {
    const tds = cells.map(cell => {
        if (typeof cell === 'object' && cell !== null) {
            return `<td class="px-4 py-3 ${cell.class || ''}">${cell.content || ''} ${cell.diff || ''}</td>`;
        }
        return `<td class="px-4 py-3">${cell}</td>`;
    }).join('');
    return `<tr class="bg-white border-b hover:bg-gray-50 transition duration-150">${tds}</tr>`;
};

export const PRODUCTIVITY_METRIC_DESCRIPTIONS = {
    utilizationRate: { title: "시간 활용률 (Utilization)", desc: "총 투입 인원(FTE) 대비 실제 업무 기록이 있는 시간의 비율입니다. (목표: 85% 이상)" },
    efficiencyRatio: { title: "업무 효율성 (Efficiency)", desc: "표준 업무 시간 대비 실제 수행 시간의 비율입니다. 100% 미만이면 표준보다 빠르게 수행했음을 의미합니다." },
    qualityRatio: { title: "품질 효율 (Quality)", desc: "전체 업무 중 재작업(COQ)을 제외한 정상 업무의 비율입니다." },
    oee: { title: "종합 생산 효율 (OEE)", desc: "시간 활용률 × 업무 효율성 × 품질 효율을 곱한 종합 지표입니다." },
    availableFTE: { title: "총 투입 인력", desc: "해당 기간 근태 기록상 출근한 총 인원(일/시간 환산)입니다." },
    workedFTE: { title: "실제 작업 인력", desc: "업무 기록(Log)에 기반하여 실제 일을 한 시간을 인원으로 환산한 값입니다." },
    qualityFTE: { title: "최종 유효 인력", desc: "재작업 시간을 제외하고, 실질적인 성과를 낸 유효 인력입니다." }
};

// --- 2. 데이터 집계 및 분석 로직 (Core Logic) ---

// 내부 헬퍼: 특정 기간의 데이터 필터링 및 집계
const _calculatePeriodMetrics = (allHistoryData, appConfig, mode, dateKey) => {
    // 1. 기간 필터링
    let targetData = [];
    
    if (mode === 'report-daily') {
        const day = allHistoryData.find(d => d.id === dateKey);
        if (day) targetData = [day];
    } else if (mode === 'report-weekly') {
        targetData = allHistoryData.filter(d => getWeekOfYear(new Date(d.id)) === dateKey);
    } else if (mode === 'report-monthly') {
        targetData = allHistoryData.filter(d => d.id.startsWith(dateKey));
    } else if (mode === 'report-yearly') {
        targetData = allHistoryData.filter(d => d.id.startsWith(dateKey));
    }

    if (targetData.length === 0) return null;

    // 2. 집계 초기화
    const aggr = {
        partSummary: {},
        memberSummary: {},
        taskSummary: {}
    };
    const kpis = {
        totalDuration: 0,
        totalCost: 0,
        totalQuantity: 0,
        totalQualityCost: 0,
        nonWorkMinutes: 0,
        activeMembers: new Set()
    };
    
    // 멤버별 소속 매핑
    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(g => g.members.forEach(m => memberToPartMap.set(m, g.name)));

    // 3. 데이터 순회 및 집계
    targetData.forEach(day => {
        const dailyWageMap = {};
        // 알바 시급 정보
        (day.partTimers || []).forEach(pt => dailyWageMap[pt.name] = pt.wage);
        // 정직원 시급 정보 (설정값)
        Object.assign(dailyWageMap, appConfig.memberWages || {});

        // A. 업무 기록 집계
        (day.workRecords || []).forEach(record => {
            const member = record.member;
            const task = record.task;
            const duration = Number(record.duration) || 0;
            const wage = dailyWageMap[member] || appConfig.defaultPartTimerWage || 10000;
            const cost = (duration / 60) * wage;
            const part = memberToPartMap.get(member) || '알바';

            kpis.totalDuration += duration;
            kpis.totalCost += cost;
            kpis.activeMembers.add(member);

            // COQ (품질 비용)
            if ((appConfig.qualityCostTasks || []).includes(task)) {
                kpis.totalQualityCost += cost;
            }

            // 파트별
            if (!aggr.partSummary[part]) aggr.partSummary[part] = { duration: 0, cost: 0, members: new Set() };
            aggr.partSummary[part].duration += duration;
            aggr.partSummary[part].cost += cost;
            aggr.partSummary[part].members.add(member);

            // 인원별
            if (!aggr.memberSummary[member]) aggr.memberSummary[member] = { duration: 0, cost: 0, tasks: new Set() };
            aggr.memberSummary[member].duration += duration;
            aggr.memberSummary[member].cost += cost;
            aggr.memberSummary[member].tasks.add(task);

            // 업무별
            if (!aggr.taskSummary[task]) aggr.taskSummary[task] = { duration: 0, cost: 0, quantity: 0, members: new Set(), count: 0 };
            aggr.taskSummary[task].duration += duration;
            aggr.taskSummary[task].cost += cost;
            aggr.taskSummary[task].members.add(member);
            aggr.taskSummary[task].count += 1; // 레코드 수
        });

        // B. 처리량 집계
        Object.entries(day.taskQuantities || {}).forEach(([task, qty]) => {
            const quantity = Number(qty) || 0;
            kpis.totalQuantity += quantity;
            if (aggr.taskSummary[task]) {
                aggr.taskSummary[task].quantity += quantity;
            } else {
                // 업무 기록은 없지만 처리량만 있는 경우 (드물지만 처리)
                if (!aggr.taskSummary[task]) aggr.taskSummary[task] = { duration: 0, cost: 0, quantity: 0, members: new Set(), count: 0 };
                aggr.taskSummary[task].quantity += quantity;
            }
        });
        
        // C. 비업무 시간 집계 (간단 계산: 총 출근시간 - 총 업무시간 등 정교화 가능하나 여기선 로그기반으로 추정 불가시 0)
        // (기존 로직에 비업무 시간 계산이 있다면 추가)
    });

    // 4. 파생 지표 계산 (평균 등)
    const activeMembersCount = kpis.activeMembers.size || 1; // 0 방지
    
    kpis.overallAvgThroughput = kpis.totalDuration > 0 ? kpis.totalQuantity / kpis.totalDuration : 0; // 분당 처리량
    kpis.overallAvgCostPerItem = kpis.totalQuantity > 0 ? kpis.totalCost / kpis.totalQuantity : 0;
    kpis.coqPercentage = kpis.totalCost > 0 ? (kpis.totalQualityCost / kpis.totalCost) * 100 : 0;
    kpis.activeMembersCount = activeMembersCount;

    // 업무별 파생 지표
    Object.values(aggr.taskSummary).forEach(task => {
        task.avgThroughput = task.duration > 0 ? task.quantity / task.duration : 0; // 분당
        task.avgCostPerItem = task.quantity > 0 ? task.cost / task.quantity : 0;
        task.avgStaff = task.members.size;
        task.avgTime = task.count > 0 ? task.duration / task.count : 0;
        // 효율성 지표 (예시: 분당 처리량 / 투입 인원)
        task.efficiency = task.avgStaff > 0 ? task.avgThroughput / task.avgStaff : 0;
    });

    return { kpis, aggr, staffing: _calculateStaffingMetrics(kpis, targetData) };
};

// 내부 헬퍼: 인력 효율성(Staffing) 심층 분석
const _calculateStaffingMetrics = (kpis, daysData) => {
    // (간단한 추정 로직)
    const totalWorkMinutes = kpis.totalDuration;
    const totalAttendanceMinutes = daysData.length * 8 * 60 * kpis.activeMembers.size; // 예: 하루 8시간 기준
    const utilizationRate = totalAttendanceMinutes > 0 ? (totalWorkMinutes / totalAttendanceMinutes) * 100 : 0;

    return {
        utilizationRate: utilizationRate,
        efficiencyRatio: 100, // 기준 대비 효율 (여기선 임시 100)
        qualityRatio: 100 - kpis.coqPercentage,
        oee: (utilizationRate * (100 - kpis.coqPercentage)) / 100,
        availableFTE: kpis.activeMembers.size,
        workedFTE: (totalWorkMinutes / (daysData.length * 8 * 60)),
        requiredFTE: (totalWorkMinutes / (daysData.length * 8 * 60)), // 목표 효율에 따라 달라짐
        qualityFTE: ((totalWorkMinutes - (totalWorkMinutes * kpis.coqPercentage/100)) / (daysData.length * 8 * 60)),
        
        totalLossCost: 0, // 추후 구현
        availabilityLossCost: 0,
        performanceLossCost: 0,
        qualityLossCost: kpis.totalQualityCost
    };
};

// ✅ [핵심] 외부에서 호출하는 메인 데이터 생성 함수
export const generateReportData = (allHistoryData, appConfig, viewMode, dateKey) => {
    // 1. 현재 기간(Target) 계산
    let tMode = viewMode; // report-daily, report-weekly ...
    let tMetrics = _calculatePeriodMetrics(allHistoryData, appConfig, tMode, dateKey);

    if (!tMetrics) return { tMetrics: {}, pMetrics: {} }; // 데이터 없음

    // 2. 이전 기간(Previous) 계산 (증감 비교용)
    let prevDateKey = null;
    
    if (tMode === 'report-daily') {
        const d = new Date(dateKey);
        d.setDate(d.getDate() - 1);
        prevDateKey = d.toISOString().split('T')[0];
    } else if (tMode === 'report-monthly') {
        const [y, m] = dateKey.split('-');
        const d = new Date(y, m - 1 - 1, 1); // 이전 달
        prevDateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    } 
    // (주간, 연간은 로직 복잡성상 생략하거나 추가 구현 가능)

    let pMetrics = prevDateKey ? _calculatePeriodMetrics(allHistoryData, appConfig, tMode, prevDateKey) : null;
    
    // pMetrics가 없으면 0으로 채워진 더미 객체 반환
    if (!pMetrics) {
        pMetrics = { kpis: {}, aggr: { partSummary: {}, memberSummary: {}, taskSummary: {} }, staffing: {} };
    }

    // 3. 원본 데이터(Raw Data)도 일부 포함 (렌더링 시 필요할 수 있음)
    const tData = {
        raw: { 
            onLeaveMembers: allHistoryData // 전체 데이터를 넘기거나 필터링된 데이터를 넘김. 
            // 여기서는 편의상 전체 중 필터링된 날짜의 근태만 뽑아서 넘기는 게 좋음.
            // (renderer에서 tData.raw.onLeaveMembers를 사용함)
            .filter(d => {
                if(tMode==='report-daily') return d.id === dateKey;
                if(tMode==='report-monthly') return d.id.startsWith(dateKey);
                return false;
            }) 
        },
        revenue: 0, // 매출 정보가 있다면 추가
        memberToPartMap: new Map()
    };
    (appConfig.teamGroups || []).forEach(g => g.members.forEach(m => tData.memberToPartMap.set(m, g.name)));

    return { tMetrics, pMetrics, tData };
};

// --- 3. 진단 로직 ---
export const generateProductivityDiagnosis = (curr, prev, benchmarkOEE) => {
    const score = curr.oee;
    let diagnosis = { title: '', desc: '', icon: '', color: '', bg: '' };
    
    if (score >= 85) {
        diagnosis = { title: '최우수 (Excellent)', desc: '인력과 시간이 매우 효율적으로 운영되고 있습니다.', icon: '🏆', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };
    } else if (score >= 70) {
        diagnosis = { title: '양호 (Good)', desc: '전반적으로 안정적이나 일부 개선 여지가 있습니다.', icon: '✅', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' };
    } else {
        diagnosis = { title: '개선 필요 (Attention)', desc: '비효율 요소(대기, 재작업 등)가 발견되었습니다.', icon: '⚠️', color: 'text-red-700', bg: 'bg-red-50 border-red-200' };
    }

    // 코멘트 생성
    let comments = [];
    if (curr.qualityRatio < 95) comments.push(`품질 손실(COQ)이 ${curr.qualityLossCost.toLocaleString()}원으로 다소 높습니다.`);
    if (curr.utilizationRate < 80) comments.push(`유휴 시간이 발생하고 있습니다. 업무 배분 최적화가 필요합니다.`);

    return { diagnosis, commentHtml: comments.length > 0 ? comments.join('<br>') : '특별한 이슈가 없습니다.' };
};