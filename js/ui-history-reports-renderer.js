// === js/ui-history-reports-renderer.js ===

import { formatDuration } from './utils.js';
import { getDiffHtmlForMetric, createTableRow } from './ui-history-reports-logic.js';

/**
 * [내부 헬퍼] KPI 섹션 HTML 생성
 */
const _generateKPIHTML = (tKPIs, pKPIs) => {
    return `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(tKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', tKPIs.totalDuration, pKPIs.totalDuration)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 인건비</div>
                <div class="text-xl font-bold">${Math.round(tKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', tKPIs.totalCost, pKPIs.totalCost)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 처리량</div>
                <div class="text-xl font-bold">${tKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', tKPIs.totalQuantity, pKPIs.totalQuantity)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">분당 처리량</div>
                <div class="text-xl font-bold">${tKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', tKPIs.overallAvgThroughput, pKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">개당 처리비용</div>
                <div class="text-xl font-bold">${tKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', tKPIs.overallAvgCostPerItem, pKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">평균 근무 인원</div>
                <div class="text-xl font-bold">${Number(tKPIs.activeMembersCount).toFixed(1).replace(/\.0$/, '')} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', tKPIs.activeMembersCount, pKPIs.activeMembersCount)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">비업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(tKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', tKPIs.nonWorkMinutes, pKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm border-2 border-red-200 cursor-pointer hover:bg-red-50 transition" data-action="show-coq-modal">
                <div class="text-xs text-red-600 font-semibold">COQ 비율 (총 ${Math.round(tKPIs.totalQualityCost).toLocaleString()}원) ⓘ</div>
                <div class="text-xl font-bold text-red-600">${tKPIs.coqPercentage.toFixed(1)} %</div>
                ${getDiffHtmlForMetric('coqPercentage', tKPIs.coqPercentage, pKPIs.coqPercentage)}
            </div>
        </div>
    `;
};

/**
 * ✨ [신규] 생산성 및 인력 운용 종합 분석 HTML 생성 (매트릭스 진단 포함)
 */
const _generateProductivityAnalysisHTML = (tMetrics, pMetrics, periodText) => {
    // 주간/월간/연간 리포트에서만 표시
    if (!tMetrics.staffing || ['기록'].includes(periodText)) return '';

    const {
        theoreticalRequiredStaff, efficiencyRatio, totalStandardMinutesNeeded, // 기존 효율성 지표
        utilizationRate, totalStandardAvailableMinutes, totalActualWorkedMinutes // 신규 활용률 지표
    } = tMetrics.staffing;

    const actualStaff = tMetrics.kpis.activeMembersCount;

    // 이전 기간 데이터 (증감 표시용)
    const prevEfficiency = pMetrics?.staffing?.efficiencyRatio || 0;
    const prevUtilization = pMetrics?.staffing?.utilizationRate || 0;

    if (theoreticalRequiredStaff <= 0 && utilizationRate <= 0) return '';

    // --- 종합 진단 로직 (매트릭스) ---
    let diagnosis = { icon: '✅', title: '최적 상태 유지', desc: '업무 시간과 속도 모두 적절한 균형을 유지하고 있습니다.', color: 'text-green-700', bg: 'bg-green-50 border-green-200' };

    const isOverloaded = utilizationRate >= 100;     // 시간 부족 (야근 등)
    const isUnderloaded = utilizationRate <= 80;     // 시간 남음 (유휴)
    const isFast = efficiencyRatio >= 110;           // 속도 빠름
    const isSlow = efficiencyRatio <= 90;            // 속도 느림

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

    return `
        <div class="bg-white p-5 rounded-lg shadow-sm">
            <h3 class="text-lg font-bold mb-4 text-gray-800 flex items-center">
                📊 생산성 및 인력 운용 분석 (Beta)
            </h3>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                <div class="p-4 rounded-lg border bg-gray-50">
                     <div class="flex justify-between items-start mb-2">
                        <div class="text-sm font-semibold text-gray-700">⏰ 시간 활용률 (Utilization)</div>
                        ${getDiffHtmlForMetric('utilizationRate', utilizationRate, prevUtilization)}
                    </div>
                    <div class="text-3xl font-bold ${utilizationRate >= 100 ? 'text-red-600' : 'text-gray-800'} mb-1">
                        ${utilizationRate.toFixed(0)}%
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                        <div class="h-2.5 rounded-full ${utilizationRate >= 100 ? 'bg-red-500' : 'bg-blue-500'}" style="width: ${Math.min(utilizationRate, 100)}%"></div>
                    </div>
                    <p class="text-xs text-gray-500">
                        총 표준 가용 ${formatDuration(totalStandardAvailableMinutes)} 중<br>
                        실제 ${formatDuration(totalActualWorkedMinutes)} 업무 수행
                    </p>
                </div>

                <div class="p-4 rounded-lg border bg-gray-50">
                    <div class="flex justify-between items-start mb-2">
                        <div class="text-sm font-semibold text-gray-700">⚡ 업무 효율성 (Efficiency)</div>
                         ${getDiffHtmlForMetric('efficiencyRatio', efficiencyRatio, prevEfficiency)}
                    </div>
                    <div class="text-3xl font-bold ${efficiencyRatio >= 110 ? 'text-blue-600' : (efficiencyRatio <= 90 ? 'text-red-600' : 'text-gray-800')} mb-1">
                        ${efficiencyRatio.toFixed(0)}%
                    </div>
                     <div class="w-full bg-gray-200 rounded-full h-2.5 mb-2">
                        <div class="h-2.5 rounded-full ${efficiencyRatio >= 110 ? 'bg-blue-500' : (efficiencyRatio <= 90 ? 'bg-red-500' : 'bg-green-500')}" style="width: ${Math.min(efficiencyRatio, 100)}%"></div>
                    </div>
                    <p class="text-xs text-gray-500">
                        표준 속도 기준 ${formatDuration(totalStandardMinutesNeeded)} 분량을<br>
                        실제 ${formatDuration(tMetrics.kpis.totalDuration)} 만에 처리함
                    </p>
                </div>

                 <div class="p-4 rounded-lg border ${diagnosis.bg} flex flex-col justify-center">
                    <div class="text-lg font-bold ${diagnosis.color} mb-2 flex items-center">
                        <span class="mr-2 text-2xl">${diagnosis.icon}</span> ${diagnosis.title}
                    </div>
                    <p class="text-sm ${diagnosis.color} opacity-90">
                        ${diagnosis.desc}
                    </p>
                     <div class="mt-3 pt-3 border-t border-gray-200/50 text-xs text-gray-500">
                        이론적 적정 인원: <strong>${theoreticalRequiredStaff.toFixed(1)}명</strong> (실제 ${actualStaff.toFixed(1)}명 투입)
                    </div>
                </div>
            </div>
        </div>
    `;
};

/**
 * [내부 헬퍼] 매출액 연동 분석 HTML 생성
 */
const _generateRevenueAnalysisHTML = (periodText, revenueAnalysisData, currentRevenue) => {
    if (periodText !== '월') return '';

    let analysisResultHtml = '';
    if (revenueAnalysisData) {
        const { staffNeededPerUnitIncrease, formattedUnit } = revenueAnalysisData;
        analysisResultHtml = `
            <div class="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg animate-fade-in">
                <h4 class="font-semibold text-indigo-800 mb-2 flex items-center">
                    📊 매출 기반 인원 예측 모델
                </h4>
                <p class="text-gray-700 text-sm leading-relaxed">
                    이 달의 업무 데이터로 분석했을 때,<br>
                    매출액이 <strong>${formattedUnit} 증가</strong>할 때마다
                    약 <strong class="text-indigo-600 text-lg">${staffNeededPerUnitIncrease.toFixed(1)}명</strong>의 추가 인원 투입이 필요했습니다.
                </p>
                 <p class="text-xs text-gray-500 mt-2">
                    * 실제 수행한 업무량(표준 공수)을 기반으로 역산한 예측치입니다.
                </p>
            </div>
        `;
    } else if (currentRevenue > 0) {
         analysisResultHtml = `<div class="mt-4 text-sm text-gray-500">⚠️ 분석을 위한 업무 데이터가 충분하지 않습니다.</div>`;
    }

    return `
        <div class="bg-white p-5 rounded-lg shadow-sm mt-6">
            <h3 class="text-lg font-bold mb-4 text-gray-800 flex items-center">
                💰 매출액 연동 분석 (Beta)
            </h3>
            <div class="flex flex-wrap items-end gap-4 mb-4">
                <div>
                    <label for="report-monthly-revenue-input" class="block text-sm font-medium text-gray-700 mb-1">이 달의 확정 매출액</label>
                    <div class="flex items-center">
                        <input type="text" id="report-monthly-revenue-input" value="${currentRevenue ? currentRevenue.toLocaleString() : ''}" placeholder="예: 150,000,000"
                               class="p-2 border border-gray-300 rounded-l-md focus:ring-indigo-500 focus:border-indigo-500 w-40 text-right"
                               onkeyup="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');">
                        <span class="p-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-gray-500">원</span>
                    </div>
                </div>
                <button id="report-apply-revenue-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium transition h-[42px]">
                    분석 적용
                </button>
            </div>
            ${analysisResultHtml}
        </div>
    `;
};


/**
 * [내부 헬퍼] AI Insights 섹션 HTML 생성
 */
const _generateInsightsHTML = (tAggr, pAggr, appConfig, periodText) => {
    let html = `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 심층 분석</h3>
            <div class="space-y-4">
    `;

    const allTaskNames = new Set([...Object.keys(tAggr.taskSummary), ...Object.keys(pAggr.taskSummary)]);

    // --- A. 투입 인원 효율성 (수확 체감) ---
    let insightsA = '';
    allTaskNames.forEach(taskName => {
        const d = tAggr.taskSummary[taskName];
        const p = pAggr.taskSummary[taskName];
        if (d && p) {
            const speedDiff = d.avgThroughput - p.avgThroughput;
            const effDiff = d.efficiency - p.efficiency;
            const staffDiff = d.avgStaff - p.avgStaff;

            // 인원이 늘었는데 효율이 떨어진 경우 (수확 체감)
            if (staffDiff > 0 && effDiff < -0.1) {
                let coqHtml = '';
                (appConfig.qualityCostTasks || []).forEach(coqTask => {
                     const d_c = tAggr.taskSummary[coqTask]?.duration || 0;
                     const p_c = pAggr.taskSummary[coqTask]?.duration || 0;
                     if (d_c > 0 && d_c > p_c * 1.1) {
                         coqHtml += (coqHtml ? ', ' : '') + `'${coqTask}'`;
                     }
                });
                if (coqHtml) {
                    coqHtml = `<p class="text-xs text-gray-600 mt-1 ml-4">↳ <strong>참고:</strong> 동기간 <strong>COQ 업무(${coqHtml})</strong>도 함께 증가했습니다.</p>`;
                }

                insightsA += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h4 class="font-semibold text-yellow-800 flex items-center">
                            📉 '${taskName}' - 인원 투입 대비 효율 저하
                        </h4>
                        <p class="text-sm text-gray-700 mt-1 ml-4">
                            투입 인원은 증가했으나(${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명),
                            인당 처리 효율은 오히려 감소했습니다(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)}).
                        </p>
                        ${coqHtml}
                    </div>`;
            }
            // 인원이 늘었는데 효율도 함께 오른 경우 (시너지)
            else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <h4 class="font-semibold text-green-800 flex items-center">
                            📈 '${taskName}' - 인원 투입 시너지 발생
                        </h4>
                        <p class="text-sm text-gray-700 mt-1 ml-4">
                            인원을 더 투입함에 따라(${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)
                            인당 처리 효율까지 함께 증가했습니다(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)}).
                        </p>
                    </div>`;
            }
        }
    });
    if (!insightsA) insightsA = `<p class="text-sm text-gray-500">인원 변동에 따른 유의미한 효율 변화가 감지되지 않았습니다.</p>`;
    html += `<div><h5 class="font-semibold mb-2 text-gray-600 text-sm">A. 인원 투입 효과 분석</h5>${insightsA}</div>`;

    // --- B. 업무 난이도 비교 ---
    let insightsB = '';
    const effTasks = Object.keys(tAggr.taskSummary)
        .map(n => ({ name: n, ...tAggr.taskSummary[n] }))
        .filter(d => d && d.efficiency > 0 && d.duration > 60) // 1시간 이상 수행한 업무만
        .sort((a, b) => b.efficiency - a.efficiency);

    if (effTasks.length >= 2) {
        const best = effTasks[0];
        const worst = effTasks[effTasks.length - 1];
        const factor = best.efficiency / worst.efficiency;
        if (factor >= 1.5) {
             insightsB = `
                <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div class="text-sm text-gray-800">
                        현재 <strong>'${worst.name}'</strong> 업무가 <strong>'${best.name}'</strong>보다 약 <strong>${factor.toFixed(1)}배</strong> 더 많은 리소스(시간/인원)가 투입되고 있습니다.
                    </div>
                    <div class="text-xs text-gray-500 mt-1">
                        (인당 분당 처리량 기준: ${best.name} ${best.efficiency.toFixed(2)} vs ${worst.name} ${worst.efficiency.toFixed(2)})
                    </div>
                </div>`;
        } else {
             insightsB = `<p class="text-sm text-gray-500">업무 간 현격한 효율 차이는 발견되지 않았습니다.</p>`;
        }
    } else {
        insightsB = `<p class="text-sm text-gray-500">데이터가 부족하여 비교할 수 없습니다.</p>`;
    }
    html += `<div class="mt-4"><h5 class="font-semibold mb-2 text-gray-600 text-sm">B. 업무별 리소스 투입 강도 비교</h5>${insightsB}</div>`;

    html += `</div></div>`;
    return html;
};

/**
 * [내부 헬퍼] 모든 테이블 섹션 HTML 생성
 */
const _generateTablesHTML = (tAggr, pAggr, periodText, sortState, memberToPartMap, attendanceData) => {
    let html = '';

    // 1. 파트별 요약 테이블
    const partSort = sortState.partSummary || { key: 'partName', dir: 'asc' };
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h3 class="text-lg font-semibold mb-3 text-gray-700">파트별 요약</h3><div class="overflow-x-auto max-h-[60vh]"><table class="w-full text-sm text-left text-gray-600" id="report-table-part"><thead>${createTableRow([
        { content: '파트', sortKey: 'partName' }, { content: '총 업무시간', sortKey: 'duration' }, { content: '총 인건비', sortKey: 'cost' }, { content: '참여 인원 (명)', sortKey: 'members' }
    ], true, partSort)}</thead><tbody>`;

    const allParts = Array.from(new Set([...Object.keys(tAggr.partSummary), ...Object.keys(pAggr.partSummary)]));
    allParts.sort((a, b) => {
        const d1 = tAggr.partSummary[a] || { duration: 0, cost: 0, members: new Set() };
        const d2 = tAggr.partSummary[b] || { duration: 0, cost: 0, members: new Set() };
        let v1 = (partSort.key === 'partName') ? a : (partSort.key === 'members' ? d1.members.size : d1[partSort.key]);
        let v2 = (partSort.key === 'partName') ? b : (partSort.key === 'members' ? d2.members.size : d2[partSort.key]);
        return (typeof v1 === 'string' ? v1.localeCompare(v2) : v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    }).forEach(part => {
        const d = tAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() }, p = pAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
        html += createTableRow([part, { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) }, { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) }, { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, p.members.size) }]);
    });
    html += `</tbody></table></div></div>`;

    // 2. 인원별 상세 테이블
    const memberSort = sortState.memberSummary || { key: 'memberName', dir: 'asc' };
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h3 class="text-lg font-semibold mb-3 text-gray-700">인원별 상세</h3><div class="overflow-x-auto max-h-[60vh]"><table class="w-full text-sm text-left text-gray-600" id="report-table-member"><thead>${createTableRow([
        { content: '이름', sortKey: 'memberName' }, { content: '파트', sortKey: 'part' }, { content: '총 업무시간', sortKey: 'duration' }, { content: '총 인건비', sortKey: 'cost' }, { content: '수행 업무 수', sortKey: 'taskCount' }, { content: '수행 업무', sortKey: null }
    ], true, memberSort)}</thead><tbody>`;

    const allMembers = Array.from(new Set([...Object.keys(tAggr.memberSummary), ...Object.keys(pAggr.memberSummary)]));
    allMembers.sort((a, b) => {
        const d1 = tAggr.memberSummary[a] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(a) || '알바' };
        const d2 = tAggr.memberSummary[b] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(b) || '알바' };
        let v1 = (memberSort.key === 'memberName') ? a : (memberSort.key === 'part' ? d1.part : (memberSort.key === 'taskCount' ? d1.tasks.size : d1[memberSort.key]));
        let v2 = (memberSort.key === 'memberName') ? b : (memberSort.key === 'part' ? d2.part : (memberSort.key === 'taskCount' ? d2.tasks.size : d2[memberSort.key]));
        return (typeof v1 === 'string' ? v1.localeCompare(v2) : v1 - v2) * (memberSort.dir === 'asc' ? 1 : -1);
    }).forEach(member => {
        const d = tAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(member) || '알바' }, p = pAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set() };
        html += createTableRow([member, d.part, { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) }, { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) }, { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, p.tasks.size) }, { content: Array.from(d.tasks).join(', '), class: "text-xs" }]);
    });
    html += `</tbody></table></div></div>`;

    // 3. 업무별 상세 테이블
    const taskSort = sortState.taskSummary || { key: 'taskName', dir: 'asc' };
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h3 class="text-lg font-semibold mb-3 text-gray-700">업무별 상세 (증감율은 이전 ${periodText} 대비)</h3><div class="overflow-x-auto max-h-[70vh]"><table class="w-full text-sm text-left text-gray-600" id="report-table-task"><thead>${createTableRow([
        { content: '업무', sortKey: 'taskName' }, { content: '총 시간', sortKey: 'duration' }, { content: '총 인건비', sortKey: 'cost' }, { content: '총 처리량', sortKey: 'quantity' }, { content: '분당 처리량(Avg)', sortKey: 'avgThroughput' }, { content: '개당 처리비용(Avg)', sortKey: 'avgCostPerItem' }, { content: '총 참여인원', sortKey: 'avgStaff' }, { content: '평균 처리시간(건)', sortKey: 'avgTime' }, { content: '인당 분당 처리량(효율)', sortKey: 'efficiency', title: '계산: (분당 처리량) / (총 참여인원)' }
    ], true, taskSort)}</thead><tbody>`;

    const allTasks = Array.from(new Set([...Object.keys(tAggr.taskSummary), ...Object.keys(pAggr.taskSummary)]));
    allTasks.sort((a, b) => {
        const d1 = tAggr.taskSummary[a] || { duration: 0, cost: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        const d2 = tAggr.taskSummary[b] || { duration: 0, cost: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        let v1 = (taskSort.key === 'taskName') ? a : d1[taskSort.key];
        let v2 = (taskSort.key === 'taskName') ? b : d2[taskSort.key];
        return (typeof v1 === 'string' ? v1.localeCompare(v2) : v1 - v2) * (taskSort.dir === 'asc' ? 1 : -1);
    }).forEach(task => {
        const d = tAggr.taskSummary[task], p = pAggr.taskSummary[task] || {};
        if (!d || (d.duration === 0 && d.quantity === 0)) return;
        html += createTableRow([{ content: task, class: "font-medium text-gray-900" }, { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) }, { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) }, { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, p.quantity) }, { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, p.avgThroughput) }, { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, p.avgCostPerItem) }, { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, p.avgStaff) }, { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, p.avgTime) }, { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, p.efficiency), class: "font-bold" }]);
    });
    html += `</tbody></table></div></div>`;

    // 4. 근태 현황
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h3 class="text-lg font-semibold mb-3 text-gray-700">근태 현황</h3><div class="space-y-3 max-h-[60vh] overflow-y-auto">`;
    const attSummary = (attendanceData || []).reduce((acc, e) => {
        if (!acc[e.member]) acc[e.member] = { member: e.member, counts: {} };
        acc[e.member].counts[e.type] = (acc[e.member].counts[e.type] || 0) + 1;
        return acc;
    }, {});
    if (Object.keys(attSummary).length === 0) {
        html += `<p class="text-sm text-gray-500 text-center">데이터 없음</p>`;
    } else {
        Object.values(attSummary).sort((a, b) => a.member.localeCompare(b.member)).forEach(item => {
            const typesHtml = Object.entries(item.counts).sort().map(([t, c]) => `<div class="flex justify-between text-sm text-gray-700 pl-4"><span>${t}</span><span class="font-medium">${c}${['연차','출장','결근'].includes(t)?'일':'회'}</span></div>`).join('');
            html += `<div class="border-t pt-2 first:border-t-0"><div class="font-semibold text-gray-900 mb-1">${item.member}</div><div class="space-y-0.5">${typesHtml}</div></div>`;
        });
    }
    html += `</div></div>`;

    return html;
};

/**
 * [메인] 공통 리포트 렌더러
 */
export const renderGenericReport = (targetId, title, tData, tMetrics, pMetrics, appConfig, sortState, periodText) => {
    const view = document.getElementById(targetId);
    if (!view) return;

    // 렌더링 시점에 context에서 매출액 정보 가져오기
    const currentRevenue = tData.revenue || 0;

    let html = `<div class="space-y-6"><h2 class="text-2xl font-bold text-gray-800">${title}</h2>`;
    html += _generateKPIHTML(tMetrics.kpis, pMetrics.kpis);

    // ✨ 인력 효율성 분석 섹션 (매트릭스 진단 포함)
    html += _generateProductivityAnalysisHTML(tMetrics, pMetrics, periodText);

    // ✨ 매출액 연동 분석 섹션
    html += _generateRevenueAnalysisHTML(periodText, tMetrics.revenueAnalysis, currentRevenue);

    // 기존 AI Insights (내용 보강됨)
    html += _generateInsightsHTML(tMetrics.aggr, pMetrics.aggr, appConfig, periodText);

    html += _generateTablesHTML(tMetrics.aggr, pMetrics.aggr, periodText, sortState, tData.memberToPartMap, tData.raw.onLeaveMembers);
    html += `</div>`;

    view.innerHTML = html;
};