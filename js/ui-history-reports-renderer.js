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
 * [내부 헬퍼] 인력 효율성 분석 HTML 생성
 */
const _generateStaffingEfficiencyHTML = (tMetrics, pMetrics, periodText) => {
    if (!tMetrics.staffing || ['기록'].includes(periodText)) return '';

    const { theoreticalRequiredStaff, efficiencyRatio, totalStandardMinutesNeeded } = tMetrics.staffing;
    const actualStaff = tMetrics.kpis.activeMembersCount;
    const prevRequired = pMetrics?.staffing?.theoreticalRequiredStaff || 0;
    const prevEfficiency = pMetrics?.staffing?.efficiencyRatio || 0;

    if (theoreticalRequiredStaff <= 0) return '';

    let statusHtml = '';
    let textColor = '';
    let bgColor = '';
    let message = '';

    if (efficiencyRatio >= 110) {
        statusHtml = '🔥 고효율 (과부하 주의)';
        textColor = 'text-red-600';
        bgColor = 'bg-red-50 border-red-100';
        message = `팀원들이 표준 속도보다 약 <strong>${(efficiencyRatio - 100).toFixed(0)}% 더 빠르게</strong> 일했습니다. 지속될 경우 피로도 관리가 필요할 수 있습니다.`;
    } else if (efficiencyRatio <= 90) {
        statusHtml = '📉 효율 저하 (여유 인력)';
        textColor = 'text-yellow-600';
        bgColor = 'bg-yellow-50 border-yellow-100';
        message = `표준 속도 대비 약 <strong>${(100 - efficiencyRatio).toFixed(0)}% 더 많은 시간</strong>이 소요되었습니다. 업무 프로세스 점검이나 인원 재배치가 필요할 수 있습니다.`;
    } else {
        statusHtml = '✅ 적정 효율 유지';
        textColor = 'text-green-600';
        bgColor = 'bg-green-50 border-green-100';
        message = `현재 업무량 대비 인원 투입이 <strong>매우 적절</strong>하게 이루어지고 있습니다. (표준 대비 ${efficiencyRatio.toFixed(0)}% 수준)`;
    }

    return `
        <div class="bg-white p-5 rounded-lg shadow-sm">
            <h3 class="text-lg font-bold mb-4 text-gray-800 flex items-center">
                👥 인력 효율성 분석 (Beta)
                <span class="ml-2 text-xs font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded-full">과거 평균 데이터 기반</span>
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                <div class="p-4 rounded-lg border bg-gray-50 text-center">
                    <div class="text-sm text-gray-500 mb-1">실제 투입 인원 (평균)</div>
                    <div class="text-2xl font-bold text-gray-800">${actualStaff.toFixed(1)} 명</div>
                    ${getDiffHtmlForMetric('activeMembersCount', actualStaff, pMetrics.kpis.activeMembersCount)}
                </div>
                <div class="p-4 rounded-lg border bg-blue-50 border-blue-100 text-center">
                    <div class="text-sm text-blue-700 mb-1">이론적 적정 인원</div>
                    <div class="text-2xl font-bold text-blue-600">${theoreticalRequiredStaff.toFixed(1)} 명</div>
                    ${getDiffHtmlForMetric('theoreticalRequiredStaff', theoreticalRequiredStaff, prevRequired)}
                </div>
                <div class="p-4 rounded-lg border ${bgColor} text-center">
                    <div class="text-sm ${textColor} mb-1">업무 효율성 지수</div>
                    <div class="text-2xl font-bold ${textColor}">${efficiencyRatio.toFixed(0)}%</div>
                     ${getDiffHtmlForMetric('efficiencyRatio', efficiencyRatio, prevEfficiency)}
                </div>
                 <div class="p-4 rounded-lg border bg-gray-50 text-center flex flex-col justify-center">
                    <div class="text-sm text-gray-500 mb-1">분석 결과</div>
                    <div class="text-lg font-bold ${textColor}">${statusHtml}</div>
                </div>
            </div>
            <div class="text-sm text-gray-600 bg-gray-50 p-3 rounded border">
                💡 <strong>분석 코멘트:</strong> ${message}<br>
                <span class="text-xs text-gray-500 mt-1 block">(산출 근거: 이 기간의 총 업무량을 우리 팀의 과거 평균 속도로 처리했을 때 약 ${formatDuration(totalStandardMinutesNeeded)}이 필요함)</span>
            </div>
        </div>
    `;
};

/**
 * ✨ [신규] 매출액 연동 분석 HTML 생성
 */
const _generateRevenueAnalysisHTML = (periodText, revenueAnalysisData, currentRevenue) => {
    // 월간 리포트에서만 표시
    if (periodText !== '월') return '';

    let analysisResultHtml = '';
    if (revenueAnalysisData) {
        const { staffNeededPerUnitIncrease, formattedUnit } = revenueAnalysisData;
        analysisResultHtml = `
            <div class="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                <h4 class="font-semibold text-indigo-800 mb-2">📊 매출 기반 예측 모델</h4>
                <p class="text-gray-700">
                    이 달의 데이터로 분석했을 때, 매출액이 <strong>${formattedUnit} 증가</strong>할 때마다
                    약 <strong class="text-indigo-600 text-lg">${staffNeededPerUnitIncrease.toFixed(1)}명</strong>의 추가 인원 투입이 필요했습니다.
                </p>
                <p class="text-xs text-gray-500 mt-2">
                    (계산 근거: 실제 발생한 총 표준 업무량을 매출액으로 나누어 산출된 '매출 단위당 필요 공수' 기반)
                </p>
            </div>
        `;
    } else if (currentRevenue > 0) {
         analysisResultHtml = `<div class="mt-4 text-sm text-red-500">분석을 위한 데이터가 충분하지 않습니다.</div>`;
    }

    return `
        <div class="bg-white p-5 rounded-lg shadow-sm mt-6">
            <h3 class="text-lg font-bold mb-4 text-gray-800 flex items-center">
                💰 매출액 연동 분석 (Beta)
            </h3>
            <div class="flex items-center gap-4 mb-4">
                <label for="report-monthly-revenue-input" class="font-medium text-gray-700">이 달의 확정 매출액:</label>
                <div class="flex items-center">
                    <input type="number" id="report-monthly-revenue-input" value="${currentRevenue || ''}" placeholder="예: 150000000"
                           class="p-2 border border-gray-300 rounded-l-md focus:ring-indigo-500 focus:border-indigo-500 w-40 text-right">
                    <span class="p-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-gray-500">원</span>
                </div>
                <button id="report-apply-revenue-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-md font-medium transition">
                    분석 적용
                </button>
            </div>
            <p class="text-sm text-gray-500 mb-2">매출액을 입력하고 '분석 적용'을 누르면, 실제 업무량 데이터와 연동하여 예측 지표를 제공합니다.</p>
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
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 분석 (Beta)</h3>
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

            if ((speedDiff > 0.1 || staffDiff > 0) && effDiff < -0.1) {
                let coqHtml = '';
                (appConfig.qualityCostTasks || []).forEach(coqTask => {
                     const d_c = tAggr.taskSummary[coqTask]?.duration || 0;
                     const p_c = pAggr.taskSummary[coqTask]?.duration || 0;
                     if (d_c > 0 && d_c > p_c * 1.1) {
                         coqHtml += (coqHtml ? ', ' : '') + `'${coqTask}'`;
                     }
                });
                if (coqHtml) {
                    coqHtml = `<p class="text-xs text-gray-600 mt-1"><strong class="text-red-600">⚠️ 연관 분석:</strong> 이 효율 저하는 <strong>품질 비용(COQ) 업무 (${coqHtml})</strong>의 증가와 동시에 발생했습니다.</p>`;
                }

                insightsA += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h4 class="font-semibold text-yellow-800">${taskName} - 📉 효율 저하 감지</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            이전 ${periodText} 대비 <strong>총 속도(${p.avgThroughput.toFixed(2)} → ${d.avgThroughput.toFixed(2)})</strong>는 ${speedDiff > 0 ? '증가' : '유지'}했으나,
                            <strong>1인당 효율(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>은 <strong class="text-red-600">감소</strong>했습니다.
                            (투입: ${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)
                        </p>
                        ${coqHtml}
                    </div>`;
            } else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <h4 class="font-semibold text-green-800">${taskName} - 📈 효율 증가</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            <strong>인원(${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)</strong>을 더 투입했음에도 <strong>1인당 효율(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>이 <strong class="text-green-600">증가</strong>했습니다.
                        </p>
                    </div>`;
            }
        }
    });
    if (!insightsA) insightsA = `<p class="text-sm text-gray-500">비교 데이터가 부족하여 인원 효율성 분석을 건너뜁니다.</p>`;
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">A. 투입 인원 효율성 (수확 체감)</h5>${insightsA}</div>`;

    // --- B. 업무 난이도 비교 ---
    let insightsB = '';
    const effTasks = Object.keys(tAggr.taskSummary)
        .map(n => ({ name: n, ...tAggr.taskSummary[n] }))
        .filter(d => d && d.efficiency > 0)
        .sort((a, b) => b.efficiency - a.efficiency);

    if (effTasks.length >= 2) {
        const best = effTasks[0];
        const worst = effTasks[effTasks.length - 1];
        const factor = best.efficiency / worst.efficiency;
        insightsB = `
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p class="text-sm text-gray-700">최고 효율: <strong>'${best.name}'</strong> (${best.efficiency.toFixed(2)}) / 최저 효율: <strong>'${worst.name}'</strong> (${worst.efficiency.toFixed(2)})</p>
                ${factor > 1.1 ? `<p class="text-xs text-gray-600 mt-1"><strong>분석:</strong> '${worst.name}' 업무는 '${best.name}' 대비 약 <strong>${factor.toFixed(1)}배</strong> 더 많은 리소스가 투입되었습니다.</p>` : ''}
            </div>`;
    } else {
        insightsB = `<p class="text-sm text-gray-500">데이터가 부족하여 난이도 비교를 건너뜁니다.</p>`;
    }
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">B. 업무 난이도 비교 (현재 기준)</h5>${insightsB}</div>`;

    // --- C. 주요 변동성 Top 3 ---
    let insightsC = '';
    const varList = [];
    allTaskNames.forEach(task => {
        const d = tAggr.taskSummary[task], p = pAggr.taskSummary[task];
        if (d && p) {
            if (p.efficiency > 0 && d.efficiency > 0) {
                const chg = ((d.efficiency - p.efficiency) / p.efficiency) * 100;
                if (Math.abs(chg) > 10) varList.push({ task, metric: '인당 효율', change: chg, from: p.efficiency, to: d.efficiency });
            }
            if (p.avgCostPerItem > 0 && d.avgCostPerItem > 0) {
                const chg = ((d.avgCostPerItem - p.avgCostPerItem) / p.avgCostPerItem) * 100;
                if (Math.abs(chg) > 10) varList.push({ task, metric: '개당 비용', change: chg, from: p.avgCostPerItem, to: d.avgCostPerItem });
            }
        }
    });
    const top3 = varList.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 3);
    if (top3.length > 0) {
        insightsC = '<div class="space-y-2">';
        top3.forEach(item => {
            const isGood = (item.metric === '인당 효율' && item.change > 0) || (item.metric === '개당 비용' && item.change < 0);
            insightsC += `
                <div class="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <h4 class="font-semibold ${isGood ? 'text-green-700' : 'text-red-700'}">${item.change > 0 ? '📈' : '📉'} ${item.task} (${item.metric} ${item.change > 0 ? '+' : ''}${item.change.toFixed(0)}%)</h4>
                    <p class="text-sm text-gray-700 mt-1">${item.metric}: ${item.metric === '개당 비용' ? Math.round(item.from) : item.from.toFixed(2)} → ${item.metric === '개당 비용' ? Math.round(item.to) : item.to.toFixed(2)}</p>
                </div>`;
        });
        insightsC += '</div>';
    } else {
        insightsC = `<p class="text-sm text-gray-500">이전 ${periodText} 대비 10% 이상 변동한 업무가 없습니다.</p>`;
    }
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">C. 주요 변동성 Top 3 (현재 기준)</h5>${insightsC}</div>`;

    html += `</div></div>`;
    return html;
};

// ... (_generateTablesHTML 유지) ...
const _generateTablesHTML = (tAggr, pAggr, periodText, sortState, memberToPartMap, attendanceData) => {
    // ... (기존 코드 그대로 유지)
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
    html += _generateStaffingEfficiencyHTML(tMetrics, pMetrics, periodText);
    // ✨ [신규] 매출액 분석 섹션 추가
    html += _generateRevenueAnalysisHTML(periodText, tMetrics.revenueAnalysis, currentRevenue);
    html += _generateInsightsHTML(tMetrics.aggr, pMetrics.aggr, appConfig, periodText);
    html += _generateTablesHTML(tMetrics.aggr, pMetrics.aggr, periodText, sortState, tData.memberToPartMap, tData.raw.onLeaveMembers);
    html += `</div>`;

    view.innerHTML = html;
};