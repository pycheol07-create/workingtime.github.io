// === js/ui-history-reports-renderer.js ===

import { formatDuration } from './utils.js';
import { getDiffHtmlForMetric, createTableRow, PRODUCTIVITY_METRIC_DESCRIPTIONS, generateProductivityDiagnosis } from './ui-history-reports-logic.js';

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
 * [내부 헬퍼] 도움말 툴팁 HTML 생성
 */
const _renderTooltip = (metricKey) => {
    const info = PRODUCTIVITY_METRIC_DESCRIPTIONS[metricKey];
    if (!info) return '';
    return `<span class="group relative ml-1 inline-block cursor-help text-gray-400 hover:text-gray-600">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 inline">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        <span class="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition bg-gray-800 text-white text-xs rounded p-2 absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 break-keep leading-tight text-center shadow-lg">
            <strong class="block mb-1 text-yellow-300">${info.title}</strong>
            ${info.desc}
            <svg class="absolute text-gray-800 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255" xml:space="preserve"><polygon class="fill-current" points="0,0 127.5,127.5 255,0"/></svg>
        </span>
    </span>`;
};

// ✅ [수정] benchmarkOEE 인자 추가 및 렌더링 로직 개선
const _generateProductivityAnalysisHTML = (tMetrics, pMetrics, periodText, benchmarkOEE) => {
    // ✨ [수정] ['기록'].includes(periodText) 제한 제거 -> 일별 리포트에서도 표시됨
    if (!tMetrics.staffing) return '';

    const {
        utilizationRate, efficiencyRatio, qualityRatio, oee,
        availableFTE, workedFTE, requiredFTE, qualityFTE,
        totalLossCost, availabilityLossCost, performanceLossCost, qualityLossCost,
        topPerformanceLossTasks, topQualityLossTasks, avgCostPerMinute
    } = tMetrics.staffing;

    const prev = pMetrics?.staffing || {};
    if (availableFTE <= 0) return '';

    const analysisResult = generateProductivityDiagnosis(tMetrics.staffing, prev, benchmarkOEE);
    if (!analysisResult) return '';
    const { diagnosis, commentHtml } = analysisResult;

    // ✨ 벤치마크 비교 HTML
    let benchmarkHtml = '';
    if (benchmarkOEE) {
        const diff = oee - benchmarkOEE;
        const sign = diff > 0 ? '+' : '';
        const color = diff > 0 ? 'text-green-600' : (diff < 0 ? 'text-red-500' : 'text-gray-500');
        benchmarkHtml = `<div class="text-xs text-right mt-1 ${color} font-medium" title="최근 30일 평균 OEE: ${benchmarkOEE.toFixed(0)}%">(vs 30일 평균: ${sign}${diff.toFixed(0)}%p)</div>`;
    }

    return `
        <div class="bg-white p-6 rounded-lg shadow-sm">
            <h3 class="text-xl font-bold mb-6 text-gray-800 flex items-center">
                📊 생산성 심층 분석 (Advanced)
            </h3>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-6">
                <div class="space-y-5">
                    <h4 class="font-bold text-gray-700 border-b pb-2">1️⃣ 3단계 효율 분석 (OEE)</h4>
                    
                    <div>
                        <div class="flex justify-between text-sm mb-1 items-center">
                            <span class="text-gray-600 flex items-center">① 시간 활용률${_renderTooltip('utilizationRate')}</span>
                            <span class="font-semibold">${utilizationRate.toFixed(0)}% ${getDiffHtmlForMetric('utilizationRate', utilizationRate, prev.utilizationRate)}</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2.5">
                            <div class="h-2.5 rounded-full ${utilizationRate >= 100 ? 'bg-red-400' : 'bg-blue-500'}" style="width: ${Math.min(utilizationRate, 100)}%"></div>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between text-sm mb-1 items-center">
                            <span class="text-gray-600 flex items-center">② 업무 효율성${_renderTooltip('efficiencyRatio')}</span>
                            <span class="font-semibold">${efficiencyRatio.toFixed(0)}% ${getDiffHtmlForMetric('efficiencyRatio', efficiencyRatio, prev.efficiencyRatio)}</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2.5">
                            <div class="h-2.5 rounded-full ${efficiencyRatio >= 110 ? 'bg-blue-500' : (efficiencyRatio <= 90 ? 'bg-red-400' : 'bg-green-500')}" style="width: ${Math.min(efficiencyRatio, 100)}%"></div>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between text-sm mb-1 items-center">
                            <span class="text-gray-600 flex items-center">③ 품질 효율${_renderTooltip('qualityRatio')}</span>
                            <span class="font-semibold">${qualityRatio.toFixed(1)}% ${getDiffHtmlForMetric('qualityRatio', qualityRatio, prev.qualityRatio)}</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2.5">
                            <div class="h-2.5 rounded-full bg-green-500" style="width: ${qualityRatio}%"></div>
                        </div>
                    </div>

                    <div class="p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-indigo-800 flex items-center">종합 생산 효율 (OEE)${_renderTooltip('oee')}</span>
                            <span class="text-2xl font-extrabold text-indigo-600">${oee.toFixed(0)}%</span>
                        </div>
                        ${benchmarkHtml}
                    </div>
                </div>

                <div class="space-y-4">
                    <h4 class="font-bold text-gray-700 border-b pb-2">2️⃣ 유효 인력(FTE) 분석</h4>
                    <div class="space-y-3 pt-2">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600 text-sm flex items-center">총 투입 인력${_renderTooltip('availableFTE')}</span>
                            <span class="font-bold text-gray-800">${availableFTE.toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-red-500 text-xs pl-6">↳ 유휴 인력 손실</span>
                            <span class="text-red-500 text-xs">-${(availableFTE - workedFTE).toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600 text-sm flex items-center">실제 작업 인력${_renderTooltip('workedFTE')}</span>
                            <span class="font-semibold text-gray-700">${workedFTE.toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center">
                             <span class="${efficiencyRatio >= 100 ? 'text-blue-500' : 'text-red-500'} text-xs pl-6">↳ 속도 ${efficiencyRatio >= 100 ? '초과 달성' : '저하 손실'}</span>
                             <span class="${efficiencyRatio >= 100 ? 'text-blue-500' : 'text-red-500'} text-xs">${efficiencyRatio >= 100 ? '+' : ''}${(requiredFTE - workedFTE).toFixed(1)} 명</span>
                        </div>
                         <div class="flex justify-between items-center">
                            <span class="text-red-500 text-xs pl-6">↳ 품질(재작업) 손실</span>
                            <span class="text-red-500 text-xs">-${(requiredFTE - qualityFTE).toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center pt-3 border-t border-gray-200">
                            <span class="font-bold text-blue-700 flex items-center">최종 유효 인력${_renderTooltip('qualityFTE')}</span>
                            <span class="text-2xl font-extrabold text-blue-600">${qualityFTE.toFixed(1)} 명</span>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div>
                        <h4 class="font-bold text-gray-700 border-b pb-2 mb-4">3️⃣ 인건비 손실 분석</h4>
                        <div class="bg-red-50 p-4 rounded-lg border border-red-100 text-center mb-3">
                            <div class="text-sm text-red-700 mb-1 font-semibold">총 추정 손실액</div>
                            <div class="text-3xl font-extrabold text-red-600 mb-1">${Math.round(totalLossCost).toLocaleString()}<span class="text-lg font-medium">원</span></div>
                            <div class="text-xs text-red-400">전체 인건비의 약 ${(totalLossCost / (tMetrics.kpis.totalCost || 1) * 100).toFixed(1)}%</div>
                        </div>
                        <div class="space-y-1 text-sm px-2">
                            <div class="flex justify-between"><span class="text-gray-500">• 대기 시간 손실</span><span>${Math.round(availabilityLossCost).toLocaleString()} 원</span></div>
                            
                            <details class="group">
                                <summary class="flex justify-between cursor-pointer hover:text-gray-700">
                                    <span class="text-gray-500 flex items-center">
                                        • 속도 저하 손실
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 ml-1 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </span>
                                    <span>${Math.round(performanceLossCost).toLocaleString()} 원</span>
                                </summary>
                                <div class="pl-4 pt-1 text-xs text-gray-600 space-y-1 bg-gray-50 rounded p-2 mt-1">
                                    ${(topPerformanceLossTasks || []).map(t => 
                                        `<div class="flex justify-between"><span>- ${t.task} (${Math.round(t.lossMinutes)}분 지연)</span><span class="text-red-400">약 -${Math.round(t.lossMinutes * avgCostPerMinute).toLocaleString()}원</span></div>`
                                    ).join('') || '<div class="text-gray-400">주요 지연 업무 없음</div>'}
                                </div>
                            </details>

                            <details class="group">
                                <summary class="flex justify-between cursor-pointer hover:text-gray-700">
                                     <span class="text-gray-500 flex items-center">
                                        • 품질(COQ) 손실
                                         <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 ml-1 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </span>
                                    <span>${Math.round(qualityLossCost).toLocaleString()} 원</span>
                                </summary>
                                <div class="pl-4 pt-1 text-xs text-gray-600 space-y-1 bg-gray-50 rounded p-2 mt-1">
                                     ${(topQualityLossTasks || []).map(t => 
                                        `<div class="flex justify-between"><span>- ${t.task}</span><span class="text-red-400">-${Math.round(t.cost).toLocaleString()}원</span></div>`
                                    ).join('') || '<div class="text-gray-400">품질 이슈 없음</div>'}
                                </div>
                            </details>
                        </div>
                    </div>
                </div>
            </div>

            <div class="border-t pt-6 mt-2 flex flex-col md:flex-row gap-6">
                 <div class="md:w-1/3">
                    <div class="p-5 rounded-lg border ${diagnosis.bg} h-full flex flex-col justify-center text-center md:text-left">
                        <div class="text-xl font-bold ${diagnosis.color} mb-2 flex items-center justify-center md:justify-start">
                            <span class="mr-2 text-3xl">${diagnosis.icon}</span> ${diagnosis.title}
                        </div>
                        <p class="text-sm ${diagnosis.color} opacity-90 leading-relaxed">
                            ${diagnosis.desc}
                        </p>
                    </div>
                </div>
                <div class="md:w-2/3 bg-gray-50 p-5 rounded-lg border border-gray-200">
                    <h4 class="font-bold text-gray-800 mb-3 flex items-center">
                        🤖 AI 종합 분석 코멘트
                    </h4>
                    <div class="text-sm text-gray-700 leading-7 space-y-2">
                        ${commentHtml}
                    </div>
                </div>
            </div>

        </div>
    `;
};

const _generateRevenueAnalysisHTML = (periodText, revenueAnalysisData, trendAnalysisData, currentRevenue, prevRevenue) => {
    if (periodText !== '월') return '';

    let analysisResultHtml = '';

    if (trendAnalysisData) {
        const { revenueChangeRate, workloadChangeRate, diagnosis, colorClass } = trendAnalysisData;
        const revSign = revenueChangeRate > 0 ? '+' : '';
        const workSign = workloadChangeRate > 0 ? '+' : '';

        analysisResultHtml += `
            <div class="mb-4 p-4 bg-gray-50 border rounded-lg">
                <h4 class="font-semibold text-gray-700 mb-3">📉 전월 대비 트렌드 분석</h4>
                <div class="flex items-center justify-around text-center mb-3">
                    <div>
                        <div class="text-xs text-gray-500">매출액 변화</div>
                        <div class="text-lg font-bold ${revenueChangeRate >= 0 ? 'text-blue-600' : 'text-red-600'}">
                            ${revSign}${revenueChangeRate.toFixed(1)}%
                        </div>
                        <div class="text-xs text-gray-400">${Number(prevRevenue).toLocaleString()}원 →</div>
                    </div>
                    <div class="text-gray-300 font-light text-2xl">vs</div>
                    <div>
                        <div class="text-xs text-gray-500">업무량(공수) 변화</div>
                         <div class="text-lg font-bold ${workloadChangeRate <= revenueChangeRate ? 'text-green-600' : 'text-orange-600'}">
                            ${workSign}${workloadChangeRate.toFixed(1)}%
                        </div>
                    </div>
                </div>
                <div class="pt-3 border-t text-center font-bold ${colorClass}">
                    ${diagnosis}
                </div>
            </div>
        `;
    }

    if (revenueAnalysisData) {
        const { staffNeededPerUnitIncrease, formattedUnit, actualMinutesPerPerson } = revenueAnalysisData;
        const actualHoursPerPerson = (actualMinutesPerPerson / 60).toFixed(1);

        analysisResultHtml += `
            <div class="p-4 bg-indigo-50 border border-indigo-100 rounded-lg">
                <h4 class="font-semibold text-indigo-800 mb-2 flex items-center">
                    📊 실적 기반 인원 예측 모델
                </h4>
                <p class="text-gray-700 text-sm leading-relaxed">
                    이번 달의 실제 업무 패턴을 유지한다고 가정할 때,<br>
                    매출액이 <strong>${formattedUnit} 증가</strong>할 때마다
                    약 <strong class="text-indigo-600 text-lg">${staffNeededPerUnitIncrease.toFixed(1)}명</strong>의 추가 인원 투입이 필요할 것으로 예상됩니다.
                </p>
                 <p class="text-xs text-indigo-400 mt-2">
                    * 산출 근거: 이번 달 우리 팀 실질 평균 근무시간 (약 <strong>${actualHoursPerPerson}시간</strong>/인) 기준
                </p>
            </div>
        `;
    } else if (currentRevenue > 0 && !revenueAnalysisData) {
         analysisResultHtml += `<div class="mt-4 text-sm text-gray-500">⚠️ 예측 분석을 위한 업무 데이터가 충분하지 않습니다.</div>`;
    }

    return `
        <div class="bg-white p-5 rounded-lg shadow-sm mt-6">
            <h3 class="text-lg font-bold mb-4 text-gray-800 flex items-center">
                💰 매출액 연동 분석 (Beta)
            </h3>
            <div class="flex flex-wrap items-end gap-4 mb-6">
                <div>
                    <label for="report-monthly-revenue-input" class="block text-sm font-medium text-gray-700 mb-1">이 달의 확정 매출액</label>
                    <div class="flex items-center">
                        <input type="text" id="report-monthly-revenue-input" value="${currentRevenue ? Number(currentRevenue).toLocaleString() : ''}" placeholder="예: 150,000,000"
                               class="p-2 border border-gray-300 rounded-l-md focus:ring-indigo-500 focus:border-indigo-500 w-40 text-right font-bold text-gray-700"
                               onkeyup="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');">
                        <span class="p-2 bg-gray-100 border border-l-0 border-gray-300 rounded-r-md text-gray-500">원</span>
                    </div>
                </div>
                <button id="report-apply-revenue-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-md font-medium transition h-[42px] shadow-sm">
                    분석 적용
                </button>
            </div>
            ${analysisResultHtml}
        </div>
    `;
};

const _generateInsightsHTML = (tAggr, pAggr, appConfig, periodText) => {
    let html = `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 심층 분석</h3>
            <div class="space-y-4">
    `;

    const allTaskNames = new Set([...Object.keys(tAggr.taskSummary), ...Object.keys(pAggr.taskSummary)]);

    let insightsA = '';
    allTaskNames.forEach(taskName => {
        const d = tAggr.taskSummary[taskName];
        const p = pAggr.taskSummary[taskName];
        if (d && p) {
            const speedDiff = d.avgThroughput - p.avgThroughput;
            const effDiff = d.efficiency - p.efficiency;
            const staffDiff = d.avgStaff - p.avgStaff;

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

    let insightsB = '';
    const effTasks = Object.keys(tAggr.taskSummary)
        .map(n => ({ name: n, ...tAggr.taskSummary[n] }))
        .filter(d => d && d.efficiency > 0 && d.duration > 60)
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

const _generateTablesHTML = (tAggr, pAggr, periodText, sortState, memberToPartMap, attendanceData) => {
    let html = '';

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

// ✅ [수정] benchmarkOEE 인자 추가
export const renderGenericReport = (targetId, title, tData, tMetrics, pMetrics, appConfig, sortState, periodText, prevRevenue = 0, benchmarkOEE = null) => {
    const view = document.getElementById(targetId);
    if (!view) return;

    const currentRevenue = tData.revenue || 0;

    let html = `<div class="space-y-6"><h2 class="text-2xl font-bold text-gray-800">${title}</h2>`;
    html += _generateKPIHTML(tMetrics.kpis, pMetrics.kpis);
    html += _generateProductivityAnalysisHTML(tMetrics, pMetrics, periodText, benchmarkOEE);
    html += _generateRevenueAnalysisHTML(periodText, tMetrics.revenueAnalysis, tMetrics.revenueTrend, currentRevenue, prevRevenue);
    html += _generateInsightsHTML(tMetrics.aggr, pMetrics.aggr, appConfig, periodText);
    html += _generateTablesHTML(tMetrics.aggr, pMetrics.aggr, periodText, sortState, tData.memberToPartMap, tData.raw.onLeaveMembers);
    html += `</div>`;

    view.innerHTML = html;
};