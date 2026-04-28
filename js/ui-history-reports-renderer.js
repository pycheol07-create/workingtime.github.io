// === js/ui-history-reports-renderer.js ===
import { formatDuration, calculateDateDifference } from './utils.js';
import { getDiffHtmlForMetric, createTableRow, PRODUCTIVITY_METRIC_DESCRIPTIONS, generateProductivityDiagnosis } from './ui-history-reports-logic.js';
import { context } from './state.js';

const getSortIcon = (currentKey, currentDir, targetKey) => {
    if (currentKey !== targetKey) return '<span class="text-gray-300 dark:text-gray-600 text-[10px] ml-1 opacity-0 group-hover:opacity-50">↕</span>';
    return currentDir === 'asc' 
        ? '<span class="text-blue-600 dark:text-blue-400 text-[10px] ml-1">▲</span>' 
        : '<span class="text-blue-600 dark:text-blue-400 text-[10px] ml-1">▼</span>';
};

const getFilterDropdown = (target, key, currentFilterValue, options = []) => {
    const dropdownId = `${target}-${key}`;
    const isActive = context.activeFilterDropdown === dropdownId;
    const hasValue = currentFilterValue && currentFilterValue !== '';
    const iconColorClass = hasValue ? 'text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-400' : 'text-gray-400 dark:text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700';

    let inputHtml = '';
    if (options && options.length > 0) {
        const optionsHtml = options.map(opt => 
            `<option value="${opt}" ${currentFilterValue === opt ? 'selected' : ''}>${opt}</option>`
        ).join('');
        inputHtml = `<select class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none cursor-pointer" data-filter-target="${target}" data-filter-key="${key}"><option value="">(전체)</option>${optionsHtml}</select>`;
    } else {
        inputHtml = `<input type="text" class="w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-white rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" placeholder="검색..." value="${currentFilterValue || ''}" data-filter-target="${target}" data-filter-key="${key}" autocomplete="off">`;
    }

    return `
        <div class="relative inline-block ml-1 filter-container">
            <button type="button" class="filter-icon-btn p-1 rounded transition ${iconColorClass}" data-dropdown-id="${dropdownId}" title="필터">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.293.707l-2 2A1 1 0 018 17v-5.586L3.293 6.707A1 1 0 013 6V3z" clip-rule="evenodd" /></svg>
            </button>
            <div class="filter-dropdown absolute top-full right-0 mt-2 w-56 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-[60] p-3 ${isActive ? 'block' : 'hidden'} text-left cursor-default">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-2 flex justify-between items-center">
                    <span>필터 조건</span>
                    ${hasValue ? `<button class="text-[10px] text-red-500 dark:text-red-400 hover:underline" onclick="const i=this.closest('.filter-dropdown').querySelector('input,select'); i.value=''; i.dispatchEvent(new Event('input', {bubbles:true}));">지우기</button>` : ''}
                </div>
                ${inputHtml}
            </div>
        </div>
    `;
};

const _generateKPIHTML = (tKPIs, pKPIs) => {
    return `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center mb-6">
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">총 업무 시간</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${formatDuration(tKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', tKPIs.totalDuration, pKPIs.totalDuration)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">총 인건비</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${Math.round(tKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', tKPIs.totalCost, pKPIs.totalCost)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">총 처리량</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${tKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', tKPIs.totalQuantity, pKPIs.totalQuantity)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">분당 처리량</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${tKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', tKPIs.overallAvgThroughput, pKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">개당 처리비용</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${tKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', tKPIs.overallAvgCostPerItem, pKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">평균 근무 인원</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${Number(tKPIs.activeMembersCount).toFixed(1).replace(/\.0$/, '')} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', tKPIs.activeMembersCount, pKPIs.activeMembersCount)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">비업무 시간</div>
                <div class="text-xl font-extrabold text-gray-800 dark:text-white">${formatDuration(tKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', tKPIs.nonWorkMinutes, pKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border-2 border-red-200 dark:border-red-900/50 shadow-sm cursor-pointer hover:bg-red-50 dark:hover:bg-red-900/20 depth-panel transition-colors" data-action="show-coq-modal">
                <div class="text-xs text-red-600 dark:text-red-400 font-bold mb-1">COQ 비율 (총 ${Math.round(tKPIs.totalQualityCost).toLocaleString()}원) ⓘ</div>
                <div class="text-xl font-extrabold text-red-600 dark:text-red-500">${tKPIs.coqPercentage.toFixed(1)} %</div>
                ${getDiffHtmlForMetric('coqPercentage', tKPIs.coqPercentage, pKPIs.coqPercentage)}
            </div>
        </div>
    `;
};

const _renderTooltip = (metricKey) => {
    const info = PRODUCTIVITY_METRIC_DESCRIPTIONS[metricKey];
    if (!info) return '';
    return `<span class="group relative ml-1 inline-block cursor-help text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="w-4 h-4 inline">
          <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />
        </svg>
        <span class="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 text-xs rounded p-2 absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 break-keep leading-tight text-center shadow-lg" data-html2canvas-ignore="true">
            <strong class="block mb-1 text-yellow-300 dark:text-yellow-600">${info.title}</strong>
            ${info.desc}
            <svg class="absolute text-gray-800 dark:text-gray-100 h-2 w-full left-0 top-full" x="0px" y="0px" viewBox="0 0 255 255" xml:space="preserve"><polygon class="fill-current" points="0,0 127.5,127.5 255,0"/></svg>
        </span>
    </span>`;
};

const _generateProductivityAnalysisHTML = (tMetrics, pMetrics, periodText, benchmarkOEE) => {
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

    let benchmarkHtml = '';
    if (benchmarkOEE) {
        const diff = oee - benchmarkOEE;
        const sign = diff > 0 ? '+' : '';
        const color = diff > 0 ? 'text-green-600 dark:text-green-400' : (diff < 0 ? 'text-red-500 dark:text-red-400' : 'text-gray-500 dark:text-gray-400');
        benchmarkHtml = `<div class="text-xs text-right mt-1 ${color} font-bold" title="최근 30일 평균 OEE: ${benchmarkOEE.toFixed(0)}%">(vs 30일 평균: ${sign}${diff.toFixed(0)}%p)</div>`;
    }

    return `
        <div class="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6">
            <h3 class="text-xl font-bold mb-6 text-gray-800 dark:text-white flex items-center">
                📊 생산성 심층 분석 (Advanced)
            </h3>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8 mb-6">
                <div class="space-y-5">
                    <h4 class="font-bold text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700 pb-2">1️⃣ 3단계 효율 분석 (OEE)</h4>
                    
                    <div>
                        <div class="flex justify-between text-sm mb-1.5 items-center">
                            <span class="text-gray-600 dark:text-gray-400 flex items-center font-bold">① 시간 활용률${_renderTooltip('utilizationRate')}</span>
                            <span class="font-bold text-gray-800 dark:text-gray-200">${utilizationRate.toFixed(0)}% ${getDiffHtmlForMetric('utilizationRate', utilizationRate, prev.utilizationRate)}</span>
                        </div>
                        <div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                            <div class="h-2.5 rounded-full transition-all ${utilizationRate >= 100 ? 'bg-red-400' : 'bg-blue-500'}" style="width: ${Math.min(utilizationRate, 100)}%"></div>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between text-sm mb-1.5 items-center">
                            <span class="text-gray-600 dark:text-gray-400 flex items-center font-bold">② 업무 효율성${_renderTooltip('efficiencyRatio')}</span>
                            <span class="font-bold text-gray-800 dark:text-gray-200">${efficiencyRatio.toFixed(0)}% ${getDiffHtmlForMetric('efficiencyRatio', efficiencyRatio, prev.efficiencyRatio)}</span>
                        </div>
                        <div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                            <div class="h-2.5 rounded-full transition-all ${efficiencyRatio >= 110 ? 'bg-blue-500' : (efficiencyRatio <= 90 ? 'bg-red-400' : 'bg-green-500')}" style="width: ${Math.min(efficiencyRatio, 100)}%"></div>
                        </div>
                    </div>

                    <div>
                        <div class="flex justify-between text-sm mb-1.5 items-center">
                            <span class="text-gray-600 dark:text-gray-400 flex items-center font-bold">③ 품질 효율${_renderTooltip('qualityRatio')}</span>
                            <span class="font-bold text-gray-800 dark:text-gray-200">${qualityRatio.toFixed(1)}% ${getDiffHtmlForMetric('qualityRatio', qualityRatio, prev.qualityRatio)}</span>
                        </div>
                        <div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                            <div class="h-2.5 rounded-full transition-all bg-green-500" style="width: ${qualityRatio}%"></div>
                        </div>
                    </div>

                    <div class="p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl shadow-sm">
                        <div class="flex justify-between items-center">
                            <span class="font-bold text-indigo-800 dark:text-indigo-400 flex items-center">종합 생산 효율 (OEE)${_renderTooltip('oee')}</span>
                            <span class="text-2xl font-extrabold text-indigo-600 dark:text-indigo-500">${oee.toFixed(0)}%</span>
                        </div>
                        ${benchmarkHtml}
                    </div>
                </div>

                <div class="space-y-4">
                    <h4 class="font-bold text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700 pb-2">2️⃣ 유효 인력(FTE) 분석</h4>
                    <div class="space-y-3 pt-2">
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600 dark:text-gray-400 text-sm flex items-center font-bold">총 투입 인력${_renderTooltip('availableFTE')}</span>
                            <span class="font-extrabold text-gray-800 dark:text-white">${availableFTE.toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-red-500 dark:text-red-400 text-xs pl-6 font-bold">↳ 유휴 인력 손실</span>
                            <span class="text-red-500 dark:text-red-400 text-xs font-bold">-${(availableFTE - workedFTE).toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center">
                            <span class="text-gray-600 dark:text-gray-400 text-sm flex items-center font-bold">실제 작업 인력${_renderTooltip('workedFTE')}</span>
                            <span class="font-extrabold text-gray-700 dark:text-gray-200">${workedFTE.toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center">
                             <span class="${efficiencyRatio >= 100 ? 'text-blue-500 dark:text-blue-400' : 'text-red-500 dark:text-red-400'} text-xs pl-6 font-bold">↳ 속도 ${efficiencyRatio >= 100 ? '초과 달성' : '저하 손실'}</span>
                             <span class="${efficiencyRatio >= 100 ? 'text-blue-500 dark:text-blue-400' : 'text-red-500 dark:text-red-400'} text-xs font-bold">${efficiencyRatio >= 100 ? '+' : ''}${(requiredFTE - workedFTE).toFixed(1)} 명</span>
                        </div>
                         <div class="flex justify-between items-center">
                            <span class="text-red-500 dark:text-red-400 text-xs pl-6 font-bold">↳ 품질(재작업) 손실</span>
                            <span class="text-red-500 dark:text-red-400 text-xs font-bold">-${(requiredFTE - qualityFTE).toFixed(1)} 명</span>
                        </div>
                        <div class="flex justify-between items-center pt-3 border-t border-gray-100 dark:border-gray-700 mt-1">
                            <span class="font-bold text-blue-700 dark:text-blue-400 flex items-center">최종 유효 인력${_renderTooltip('qualityFTE')}</span>
                            <span class="text-2xl font-extrabold text-blue-600 dark:text-blue-500">${qualityFTE.toFixed(1)} 명</span>
                        </div>
                    </div>
                </div>

                <div class="space-y-6">
                    <div>
                        <h4 class="font-bold text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-700 pb-2 mb-4">3️⃣ 인건비 손실 분석</h4>
                        <div class="bg-red-50 dark:bg-red-900/20 p-4 rounded-xl border border-red-100 dark:border-red-900/50 text-center mb-4 shadow-sm">
                            <div class="text-sm text-red-700 dark:text-red-400 mb-1 font-bold">총 추정 손실액</div>
                            <div class="text-3xl font-black text-red-600 dark:text-red-500 mb-1">${Math.round(totalLossCost).toLocaleString()}<span class="text-lg font-bold">원</span></div>
                            <div class="text-xs text-red-500/80 dark:text-red-400/80 font-bold">전체 인건비의 약 ${(totalLossCost / (tMetrics.kpis.totalCost || 1) * 100).toFixed(1)}%</div>
                        </div>
                        <div class="space-y-2 text-sm px-2 font-medium text-gray-600 dark:text-gray-300">
                            <div class="flex justify-between"><span>• 대기 시간 손실</span><span class="font-bold text-gray-800 dark:text-white">${Math.round(availabilityLossCost).toLocaleString()} 원</span></div>
                            
                            <details class="group">
                                <summary class="flex justify-between cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors">
                                    <span class="flex items-center">
                                        • 속도 저하 손실
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 ml-1 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </span>
                                    <span class="font-bold text-gray-800 dark:text-white">${Math.round(performanceLossCost).toLocaleString()} 원</span>
                                </summary>
                                <div class="pl-4 pt-1 text-xs text-gray-500 dark:text-gray-400 space-y-1.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600 rounded-lg p-2.5 mt-2 shadow-inner">
                                    ${(topPerformanceLossTasks || []).map(t => 
                                        `<div class="flex justify-between items-center"><span>- ${t.task} <span class="opacity-70">(${Math.round(t.lossMinutes)}분 지연)</span></span><span class="text-red-500 dark:text-red-400 font-bold">약 -${Math.round(t.lossMinutes * avgCostPerMinute).toLocaleString()}원</span></div>`
                                    ).join('') || '<div class="text-center opacity-70">주요 지연 업무 없음</div>'}
                                </div>
                            </details>

                            <details class="group">
                                <summary class="flex justify-between cursor-pointer hover:text-gray-900 dark:hover:text-white transition-colors">
                                     <span class="flex items-center">
                                        • 품질(COQ) 손실
                                         <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 ml-1 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                                        </svg>
                                    </span>
                                    <span class="font-bold text-gray-800 dark:text-white">${Math.round(qualityLossCost).toLocaleString()} 원</span>
                                </summary>
                                <div class="pl-4 pt-1 text-xs text-gray-500 dark:text-gray-400 space-y-1.5 bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600 rounded-lg p-2.5 mt-2 shadow-inner">
                                     ${(topQualityLossTasks || []).map(t => 
                                        `<div class="flex justify-between items-center"><span>- ${t.task}</span><span class="text-red-500 dark:text-red-400 font-bold">-${Math.round(t.cost).toLocaleString()}원</span></div>`
                                    ).join('') || '<div class="text-center opacity-70">품질 이슈 없음</div>'}
                                </div>
                            </details>
                        </div>
                    </div>
                </div>
            </div>

            <div class="border-t border-gray-100 dark:border-gray-700 pt-6 mt-4 flex flex-col md:flex-row gap-6">
                 <div class="md:w-1/3">
                    <div class="p-6 rounded-xl border ${diagnosis.bg} h-full flex flex-col justify-center text-center md:text-left shadow-sm">
                        <div class="text-xl font-black ${diagnosis.color} mb-3 flex items-center justify-center md:justify-start tracking-tight">
                            <span class="mr-2 text-3xl">${diagnosis.icon}</span> ${diagnosis.title}
                        </div>
                        <p class="text-sm ${diagnosis.color} font-medium opacity-90 leading-relaxed break-keep">
                            ${diagnosis.desc}
                        </p>
                    </div>
                </div>
                <div class="md:w-2/3 bg-gray-50 dark:bg-gray-700/50 p-6 rounded-xl border border-gray-200 dark:border-gray-600 shadow-sm">
                    <h4 class="font-bold text-gray-800 dark:text-white mb-3 flex items-center text-base">
                        🤖 AI 종합 분석 코멘트
                    </h4>
                    <div class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed space-y-2 font-medium break-keep">
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
            <div class="mb-6 p-5 bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-xl shadow-sm">
                <h4 class="font-bold text-gray-800 dark:text-gray-200 mb-4">📉 전월 대비 트렌드 분석</h4>
                <div class="flex items-center justify-around text-center mb-4">
                    <div>
                        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">매출액 변화</div>
                        <div class="text-xl font-extrabold ${revenueChangeRate >= 0 ? 'text-blue-600 dark:text-blue-400' : 'text-red-600 dark:text-red-400'}">
                            ${revSign}${revenueChangeRate.toFixed(1)}%
                        </div>
                        <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-1 font-medium">${Number(prevRevenue).toLocaleString()}원 →</div>
                    </div>
                    <div class="text-gray-300 dark:text-gray-600 font-light text-2xl">vs</div>
                    <div>
                        <div class="text-xs font-bold text-gray-500 dark:text-gray-400 mb-1">업무량(공수) 변화</div>
                         <div class="text-xl font-extrabold ${workloadChangeRate <= revenueChangeRate ? 'text-green-600 dark:text-green-400' : 'text-orange-600 dark:text-orange-400'}">
                            ${workSign}${workloadChangeRate.toFixed(1)}%
                        </div>
                    </div>
                </div>
                <div class="pt-3 border-t border-gray-200 dark:border-gray-600 text-center font-bold ${colorClass}">
                    ${diagnosis}
                </div>
            </div>
        `;
    }

    if (revenueAnalysisData) {
        const { staffNeededPerUnitIncrease, formattedUnit, actualMinutesPerPerson } = revenueAnalysisData;
        const actualHoursPerPerson = (actualMinutesPerPerson / 60).toFixed(1);

        analysisResultHtml += `
            <div class="p-5 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/50 rounded-xl shadow-sm">
                <h4 class="font-bold text-indigo-800 dark:text-indigo-300 mb-3 flex items-center">
                    📊 실적 기반 인원 예측 모델
                </h4>
                <p class="text-gray-800 dark:text-gray-200 text-sm leading-relaxed font-medium break-keep">
                    이번 달의 실제 업무 패턴을 유지한다고 가정할 때,<br>
                    매출액이 <strong>${formattedUnit} 증가</strong>할 때마다
                    약 <strong class="text-indigo-600 dark:text-indigo-400 text-lg">${staffNeededPerUnitIncrease.toFixed(1)}명</strong>의 추가 인원 투입이 필요할 것으로 예상됩니다.
                </p>
                 <p class="text-[11px] text-indigo-500 dark:text-indigo-400/80 mt-3 font-medium">
                    * 산출 근거: 이번 달 우리 팀 실질 평균 근무시간 (약 <strong>${actualHoursPerPerson}시간</strong>/인) 기준
                </p>
            </div>
        `;
    } else if (currentRevenue > 0 && !revenueAnalysisData) {
         analysisResultHtml += `<div class="mt-4 text-sm font-bold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-lg text-center">⚠️ 예측 분석을 위한 업무 데이터가 충분하지 않습니다.</div>`;
    }

    return `
        <div class="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6">
            <h3 class="text-xl font-bold mb-6 text-gray-800 dark:text-white flex items-center">
                💰 매출액 연동 분석 (Beta)
            </h3>
            <div class="flex flex-wrap items-end gap-4 mb-6 bg-gray-50 dark:bg-gray-700/30 p-4 rounded-xl border border-gray-100 dark:border-gray-600">
                <div>
                    <label for="report-monthly-revenue-input" class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1.5 uppercase tracking-wide">이 달의 확정 매출액</label>
                    <div class="flex items-center shadow-sm rounded-md">
                        <input type="text" id="report-monthly-revenue-input" value="${currentRevenue ? Number(currentRevenue).toLocaleString() : ''}" placeholder="예: 150,000,000"
                               class="p-2.5 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-white rounded-l-md focus:ring-indigo-500 focus:border-indigo-500 w-48 text-right font-extrabold outline-none transition-colors"
                               onkeyup="this.value=this.value.replace(/[^0-9]/g,'').replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',');">
                        <span class="p-2.5 bg-gray-100 dark:bg-gray-600 border border-l-0 border-gray-300 dark:border-gray-600 rounded-r-md text-gray-600 dark:text-gray-300 font-bold">원</span>
                    </div>
                </div>
                <button id="report-apply-revenue-btn" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-md font-bold transition shadow-md border border-indigo-700">
                    분석 적용
                </button>
            </div>
            ${analysisResultHtml}
        </div>
    `;
};

const _generateInsightsHTML = (tAggr, pAggr, appConfig, periodText) => {
    let html = `
        <div class="bg-white dark:bg-gray-800 p-6 md:p-8 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6">
            <h3 class="text-xl font-bold mb-6 text-gray-800 dark:text-white">💡 주요 업무 심층 분석</h3>
            <div class="space-y-6">
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
                    coqHtml = `<p class="text-[11px] text-gray-500 dark:text-gray-400 mt-2 ml-6 font-medium">↳ <strong class="text-gray-600 dark:text-gray-300">참고:</strong> 동기간 <strong class="text-gray-600 dark:text-gray-300">COQ 업무(${coqHtml})</strong>도 함께 증가했습니다.</p>`;
                }

                insightsA += `
                    <div class="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800/50 rounded-xl shadow-sm mb-3">
                        <h4 class="font-bold text-yellow-800 dark:text-yellow-400 flex items-center text-base">
                            <span class="mr-1">📉</span> '${taskName}' - 인원 투입 대비 효율 저하
                        </h4>
                        <p class="text-sm text-gray-700 dark:text-gray-300 mt-1.5 ml-6 font-medium break-keep leading-relaxed">
                            투입 인원은 증가했으나(${p.avgStaff.toFixed(1)}명 → <span class="font-bold">${d.avgStaff.toFixed(1)}명</span>),
                            인당 처리 효율은 오히려 감소했습니다(${p.efficiency.toFixed(2)} → <span class="font-bold">${d.efficiency.toFixed(2)}</span>).
                        </p>
                        ${coqHtml}
                    </div>`;
            }
            else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl shadow-sm mb-3">
                        <h4 class="font-bold text-green-800 dark:text-green-400 flex items-center text-base">
                            <span class="mr-1">📈</span> '${taskName}' - 인원 투입 시너지 발생
                        </h4>
                        <p class="text-sm text-gray-700 dark:text-gray-300 mt-1.5 ml-6 font-medium break-keep leading-relaxed">
                            인원을 더 투입함에 따라(${p.avgStaff.toFixed(1)}명 → <span class="font-bold">${d.avgStaff.toFixed(1)}명</span>)
                            인당 처리 효율까지 함께 증가했습니다(${p.efficiency.toFixed(2)} → <span class="font-bold">${d.efficiency.toFixed(2)}</span>).
                        </p>
                    </div>`;
            }
        }
    });
    if (!insightsA) insightsA = `<p class="text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl text-center">인원 변동에 따른 유의미한 효율 변화가 감지되지 않았습니다.</p>`;
    html += `<div class="bg-white dark:bg-gray-800"><h5 class="font-bold mb-3 text-gray-800 dark:text-gray-200 text-base">A. 인원 투입 효과 분석</h5>${insightsA}</div>`;

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
                <div class="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50 rounded-xl shadow-sm">
                    <div class="text-sm text-gray-800 dark:text-gray-200 font-medium break-keep leading-relaxed">
                        현재 <strong>'${worst.name}'</strong> 업무가 <strong>'${best.name}'</strong>보다 약 <strong class="text-blue-600 dark:text-blue-400 text-base">${factor.toFixed(1)}배</strong> 더 많은 리소스(시간/인원)가 투입되고 있습니다.
                    </div>
                    <div class="text-[11px] text-gray-500 dark:text-gray-400 mt-2 font-bold bg-white dark:bg-gray-800/50 inline-block px-2 py-1 rounded">
                        (인당 분당 처리량 기준: ${best.name} ${best.efficiency.toFixed(2)} vs ${worst.name} ${worst.efficiency.toFixed(2)})
                    </div>
                </div>`;
        } else {
             insightsB = `<p class="text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl text-center">업무 간 현격한 효율 차이는 발견되지 않았습니다.</p>`;
        }
    } else {
        insightsB = `<p class="text-sm font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50 p-4 rounded-xl text-center">데이터가 부족하여 비교할 수 없습니다.</p>`;
    }
    html += `<div class="mt-6 pt-6 border-t border-gray-100 dark:border-gray-700"><h5 class="font-bold mb-3 text-gray-800 dark:text-gray-200 text-base">B. 업무별 리소스 투입 강도 비교</h5>${insightsB}</div>`;

    html += `</div></div>`;
    return html;
};

const th = (target, key, label, filterValue, options=[], width='') => {
    const sortState = context.reportSortState?.[target] || { key: '', dir: 'asc' };
    return `
        <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors select-none group ${width}" data-sort-target="${target}" data-sort-key="${key}">
            <div class="flex items-center justify-between min-w-[100px]">
                <span class="flex items-center font-bold">${label} ${getSortIcon(sortState.key, sortState.dir, key)}</span>
                ${getFilterDropdown(target, key, filterValue, options)}
            </div>
        </th>`;
};

const _generateTablesHTML = (tAggr, pAggr, periodText, sortState, memberToPartMap, attendanceData, standardThroughputs = {}) => {
    let html = '';
    const filterState = context.reportFilterState || {};

    // 1. 파트별 요약
    let partData = Object.keys(tAggr.partSummary).map(part => ({
        partName: part, ...tAggr.partSummary[part], p: pAggr.partSummary[part] || {}
    }));
    const allPartNames = [...new Set(partData.map(d => d.partName))].sort();
    if (filterState.partSummary?.partName) partData = partData.filter(d => d.partName === filterState.partSummary.partName);
    const pSort = sortState.partSummary || { key: 'partName', dir: 'asc' };
    partData.sort((a, b) => {
        let vA = a[pSort.key] ?? 0, vB = b[pSort.key] ?? 0;
        if(pSort.key==='members') { vA=a.members.size; vB=b.members.size; }
        if (typeof vA === 'string') return vA.localeCompare(vB) * (pSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (pSort.dir === 'asc' ? 1 : -1);
    });

    html += `<div class="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6"><h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">🏢 파트별 요약</h3><div class="overflow-x-auto max-h-[60vh] border border-gray-200 dark:border-gray-700 rounded-xl"><table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
        <thead class="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800/80 sticky top-0 border-b border-gray-200 dark:border-gray-700"><tr>
            ${th('partSummary', 'partName', '파트', filterState.partSummary?.partName, allPartNames)}
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="partSummary" data-sort-key="duration">총 업무시간 ${getSortIcon(pSort.key, pSort.dir, 'duration')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="partSummary" data-sort-key="cost">총 인건비 ${getSortIcon(pSort.key, pSort.dir, 'cost')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="partSummary" data-sort-key="members">참여 인원 ${getSortIcon(pSort.key, pSort.dir, 'members')}</th>
        </tr></thead><tbody class="divide-y divide-gray-100 dark:divide-gray-700">`;
    partData.forEach(d => {
        html += createTableRow([{content: d.partName, class: "font-bold text-gray-900 dark:text-white"}, { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, d.p.duration), class: "font-medium" }, { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, d.p.cost), class: "font-medium" }, { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, d.p.members?.size), class: "font-medium" }], "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors");
    });
    if(partData.length === 0) html += `<tr><td colspan="4" class="text-center py-6 text-gray-400 font-medium">데이터 없음</td></tr>`;
    html += `</tbody></table></div></div>`;


    // 2. 인원별 상세
    let memberData = Object.keys(tAggr.memberSummary).map(m => ({
        memberName: m, part: memberToPartMap.get(m) || '알바', ...tAggr.memberSummary[m], p: pAggr.memberSummary[m] || {}
    }));
    const allMemberNames = [...new Set(memberData.map(d => d.memberName))].sort();
    const allMemberParts = [...new Set(memberData.map(d => d.part))].sort();
    if (filterState.memberSummary?.memberName) memberData = memberData.filter(d => d.memberName === filterState.memberSummary.memberName);
    if (filterState.memberSummary?.part) memberData = memberData.filter(d => d.part === filterState.memberSummary.part);
    const mSort = sortState.memberSummary || { key: 'memberName', dir: 'asc' };
    memberData.sort((a, b) => {
        let vA = a[mSort.key] ?? 0, vB = b[mSort.key] ?? 0;
        if(mSort.key==='taskCount') { vA=a.tasks.size; vB=b.tasks.size; }
        if (typeof vA === 'string') return vA.localeCompare(vB) * (mSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (mSort.dir === 'asc' ? 1 : -1);
    });

    html += `<div class="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6"><h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">🧑‍🤝‍🧑 인원별 상세</h3><div class="overflow-x-auto max-h-[60vh] border border-gray-200 dark:border-gray-700 rounded-xl"><table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
        <thead class="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800/80 sticky top-0 border-b border-gray-200 dark:border-gray-700"><tr>
            ${th('memberSummary', 'memberName', '이름', filterState.memberSummary?.memberName, allMemberNames)}
            ${th('memberSummary', 'part', '파트', filterState.memberSummary?.part, allMemberParts)}
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="memberSummary" data-sort-key="duration">총 업무시간 ${getSortIcon(mSort.key, mSort.dir, 'duration')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="memberSummary" data-sort-key="cost">총 인건비 ${getSortIcon(mSort.key, mSort.dir, 'cost')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="memberSummary" data-sort-key="taskCount">수행 업무 수 ${getSortIcon(mSort.key, mSort.dir, 'taskCount')}</th>
            <th class="px-4 py-3 font-bold">수행 업무</th>
        </tr></thead><tbody class="divide-y divide-gray-100 dark:divide-gray-700">`;
    memberData.forEach(d => {
        html += createTableRow([{content: d.memberName, class: "font-bold text-gray-900 dark:text-white"}, d.part, { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, d.p.duration), class: "font-medium" }, { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, d.p.cost), class: "font-medium" }, { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, d.p.tasks?.size), class: "font-medium text-center" }, { content: Array.from(d.tasks).join(', '), class: "text-[11px] break-words" }], "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors");
    });
    if(memberData.length === 0) html += `<tr><td colspan="6" class="text-center py-6 text-gray-400 font-medium">데이터 없음</td></tr>`;
    html += `</tbody></table></div></div>`;


    // 3. 업무별 상세
    let taskData = Object.keys(tAggr.taskSummary).map(t => ({
        taskName: t, ...tAggr.taskSummary[t], p: pAggr.taskSummary[t] || {}
    }));
    const allTaskNames = [...new Set(taskData.map(d => d.taskName))].sort();
    if (filterState.taskSummary?.taskName) taskData = taskData.filter(d => d.taskName === filterState.taskSummary.taskName);
    const tSort = sortState.taskSummary || { key: 'taskName', dir: 'asc' };
    taskData.sort((a, b) => {
        let vA = a[tSort.key] ?? 0, vB = b[tSort.key] ?? 0;
        if (typeof vA === 'string') return vA.localeCompare(vB) * (tSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (tSort.dir === 'asc' ? 1 : -1);
    });

    html += `<div class="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6"><h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white flex items-baseline gap-2">📑 업무별 상세 <span class="text-sm font-medium text-gray-500 dark:text-gray-400">(증감율은 이전 ${periodText} 대비)</span></h3><div class="overflow-x-auto max-h-[70vh] border border-gray-200 dark:border-gray-700 rounded-xl"><table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
        <thead class="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800/80 sticky top-0 border-b border-gray-200 dark:border-gray-700 whitespace-nowrap"><tr>
            ${th('taskSummary', 'taskName', '업무', filterState.taskSummary?.taskName, allTaskNames)}
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="duration">총 시간 ${getSortIcon(tSort.key, tSort.dir, 'duration')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="cost">총 인건비 ${getSortIcon(tSort.key, tSort.dir, 'cost')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="quantity">총 처리량 ${getSortIcon(tSort.key, tSort.dir, 'quantity')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="workDays">진행 일수 ${getSortIcon(tSort.key, tSort.dir, 'workDays')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="avgThroughput">분당 처리량 ${getSortIcon(tSort.key, tSort.dir, 'avgThroughput')}</th>
            <th class="px-4 py-3 font-bold">기간 평균 속도</th> 
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="avgCostPerItem">개당 처리비용 ${getSortIcon(tSort.key, tSort.dir, 'avgCostPerItem')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="avgDailyStaff">평균 투입인원 ${getSortIcon(tSort.key, tSort.dir, 'avgDailyStaff')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="avgStaff">총 인원 ${getSortIcon(tSort.key, tSort.dir, 'avgStaff')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold" data-sort-target="taskSummary" data-sort-key="avgTime">평균 시간 ${getSortIcon(tSort.key, tSort.dir, 'avgTime')}</th>
            <th class="px-4 py-3 cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700 font-bold text-indigo-600 dark:text-indigo-400" data-sort-target="taskSummary" data-sort-key="efficiency">인당 효율 ${getSortIcon(tSort.key, tSort.dir, 'efficiency')}</th>
        </tr></thead><tbody class="divide-y divide-gray-100 dark:divide-gray-700">`;
    
    taskData.forEach(d => {
        const stdSpeed = standardThroughputs[d.taskName] || 0;
        const avgDailyStaff = d.avgDailyStaff || 0;
        html += createTableRow([
            { content: d.taskName, class: "font-bold text-gray-900 dark:text-white whitespace-nowrap" }, 
            { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, d.p.duration), class: "font-medium whitespace-nowrap" }, 
            { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, d.p.cost), class: "font-medium whitespace-nowrap" }, 
            { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, d.p.quantity), class: "font-medium whitespace-nowrap" }, 
            { content: (d.workDays || 0) > 0 ? `${d.workDays}일` : '-', diff: getDiffHtmlForMetric('workDays', d.workDays, d.p.workDays), class: "text-center font-medium" },
            { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, d.p.avgThroughput), class: "font-medium" }, 
            { content: stdSpeed > 0 ? stdSpeed.toFixed(2) : '-', class: "text-indigo-600 dark:text-indigo-400 font-mono font-bold bg-indigo-50 dark:bg-indigo-900/20 text-center" },
            { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, d.p.avgCostPerItem), class: "font-medium whitespace-nowrap" }, 
            { content: avgDailyStaff.toFixed(1), diff: getDiffHtmlForMetric('avgDailyStaff', avgDailyStaff, d.p.avgDailyStaff), class: "text-center font-medium" },
            { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, d.p.avgStaff), class: "text-center font-medium" }, 
            { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, d.p.avgTime), class: "font-medium whitespace-nowrap" }, 
            { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, d.p.efficiency), class: "font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-900/10 text-center" }
        ], "bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors");
    });
    if(taskData.length === 0) html += `<tr><td colspan="12" class="text-center py-6 text-gray-400 font-medium">데이터 없음</td></tr>`;
    html += `</tbody></table></div></div>`;


    // 4. 근태 현황
    let attDataList = [];
    const attSummaryMap = {};
    (attendanceData || []).forEach(entry => {
        if (!attSummaryMap[entry.member]) {
            attSummaryMap[entry.member] = {
                member: entry.member, counts: { '지각': 0, '외출': 0, '조퇴': 0, '결근': 0, '연차': 0, '출장': 0 },
                totalCount: 0, totalLeaveDays: 0, totalAbsenceDays: 0
            };
        }
        const rec = attSummaryMap[entry.member];
        const type = entry.type;
        if (rec.counts.hasOwnProperty(type)) rec.counts[type]++;
        else if (type) rec.counts[type] = (rec.counts[type] || 0) + 1;
        if (type !== '연차') rec.totalCount++;
        if (type === '연차') rec.totalLeaveDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
        else if (type === '결근') rec.totalAbsenceDays += calculateDateDifference(entry.startDate, entry.endDate || entry.startDate);
    });
    attDataList = Object.values(attSummaryMap);
    const allAttMembers = [...new Set(attDataList.map(d => d.member))].sort();
    if (filterState.attendanceSummary?.member) attDataList = attDataList.filter(d => d.member === filterState.attendanceSummary.member);

    const aSort = sortState.attendanceSummary || { key: 'member', dir: 'asc' };
    attDataList.sort((a, b) => {
        let vA = 0, vB = 0;
        if (aSort.key === 'member') { vA = a.member; vB = b.member; }
        else if (['totalCount', 'totalLeaveDays', 'totalAbsenceDays'].includes(aSort.key)) { vA = a[aSort.key]; vB = b[aSort.key]; }
        else { vA = a.counts[aSort.key] || 0; vB = b.counts[aSort.key] || 0; }
        if (typeof vA === 'string') return vA.localeCompare(vB) * (aSort.dir === 'asc' ? 1 : -1);
        return (vA - vB) * (aSort.dir === 'asc' ? 1 : -1);
    });

    html += `<div class="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mb-6"><h3 class="text-xl font-bold mb-4 text-gray-800 dark:text-white">⏱️ 근태 현황</h3><div class="overflow-x-auto max-h-[60vh] border border-gray-200 dark:border-gray-700 rounded-xl">`;

    if (attDataList.length === 0) {
        html += `<p class="text-sm text-gray-400 dark:text-gray-500 font-medium text-center py-6">데이터 없음</p>`;
    } else {
        const th_att = (key, label, width='') => th('attendanceSummary', key, label, (key==='member'?filterState.attendanceSummary?.member:null), (key==='member'?allAttMembers:[]), width);
        html += `
        <table class="w-full text-sm text-left text-gray-600 dark:text-gray-300">
            <thead class="text-xs text-gray-700 dark:text-gray-300 uppercase bg-gray-50 dark:bg-gray-800/80 sticky top-0 border-b border-gray-200 dark:border-gray-700">
                <tr>
                    ${th_att('member', '이름', 'sticky left-0 bg-gray-50 dark:bg-gray-800/90 z-10')}
                    ${th_att('지각', '지각')}
                    ${th_att('외출', '외출')}
                    ${th_att('조퇴', '조퇴')}
                    ${th_att('결근', '결근')}
                    ${th_att('연차', '연차')}
                    ${th_att('출장', '출장')}
                    ${th_att('totalCount', '총 횟수')}
                    ${th_att('totalAbsenceDays', '총 결근일')}
                    ${th_att('totalLeaveDays', '총 연차일')}
                </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-gray-700">
        `;
        attDataList.forEach(item => {
            const cell = (k, color='text-gray-400 dark:text-gray-500') => `<td class="px-4 py-3 text-center ${item.counts[k]>0 ? 'text-gray-800 dark:text-white font-bold' : color}">${item.counts[k]||0}</td>`;
            html += `
                <tr class="bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                    <td class="px-4 py-3 font-bold text-gray-900 dark:text-white sticky left-0 bg-white dark:bg-gray-800 shadow-[1px_0_2px_rgba(0,0,0,0.05)] dark:shadow-[1px_0_2px_rgba(255,255,255,0.05)] z-10">${item.member}</td>
                    ${cell('지각', 'text-gray-300 dark:text-gray-600')}
                    ${cell('외출', 'text-gray-300 dark:text-gray-600')}
                    ${cell('조퇴', 'text-gray-300 dark:text-gray-600')}
                    <td class="px-4 py-3 text-center ${item.counts['결근']>0?'text-red-600 dark:text-red-400 font-extrabold':'text-gray-300 dark:text-gray-600'}">${item.counts['결근']||0}</td>
                    <td class="px-4 py-3 text-center ${item.counts['연차']>0?'text-blue-600 dark:text-blue-400 font-extrabold':'text-gray-300 dark:text-gray-600'}">${item.counts['연차']||0}</td>
                    ${cell('출장', 'text-gray-300 dark:text-gray-600')}
                    <td class="px-4 py-3 text-center font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 border-l border-gray-100 dark:border-gray-700">${item.totalCount}</td>
                    <td class="px-4 py-3 text-center font-bold text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20">${item.totalAbsenceDays}</td>
                    <td class="px-4 py-3 text-center font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-r border-gray-100 dark:border-gray-700">${item.totalLeaveDays}</td>
                </tr>
            `;
        });
        html += `</tbody></table>`;
    }
    html += `</div></div>`;

    return html;
};

export const renderGenericReport = (targetId, title, tData, tMetrics, pMetrics, appConfig, sortState, periodText, prevRevenue = 0, benchmarkOEE = null, standardThroughputs = {}) => {
    const view = document.getElementById(targetId);
    if (!view) return;

    const currentRevenue = tData.revenue || 0;
    
    const headerHtml = `
        <div class="flex justify-between items-center mb-6 border-b border-gray-200 dark:border-gray-700 pb-4">
            <h2 class="text-2xl font-bold text-gray-800 dark:text-white">${title}</h2>
            <div class="flex gap-2" data-html2canvas-ignore="true">
                <button id="report-download-btn" class="bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 border border-gray-300 dark:border-gray-600 font-bold py-1.5 px-4 rounded-lg text-sm flex items-center gap-1.5 transition shadow-sm">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-500 dark:text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    다운로드
                </button>
            </div>
        </div>
    `;

    let html = `<div class="space-y-6">${headerHtml}`;
    html += _generateKPIHTML(tMetrics.kpis, pMetrics.kpis);
    html += _generateProductivityAnalysisHTML(tMetrics, pMetrics, periodText, benchmarkOEE);
    html += _generateRevenueAnalysisHTML(periodText, tMetrics.revenueAnalysis, tMetrics.revenueTrend, currentRevenue, prevRevenue);
    html += _generateInsightsHTML(tMetrics.aggr, pMetrics.aggr, appConfig, periodText);
    html += _generateTablesHTML(tMetrics.aggr, pMetrics.aggr, periodText, sortState, tData.memberToPartMap, tData.raw.onLeaveMembers, standardThroughputs);
    html += `</div>`;

    view.innerHTML = html;
};