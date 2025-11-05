// === ui-history-reports.js (업무 리포트 렌더링 담당) ===

import { formatDuration, isWeekday, getWeekOfYear } from './utils.js';

// ================== [ 헬퍼 함수 ] ==================
// (getDiffHtmlForMetric 헬퍼 함수)
export const getDiffHtmlForMetric = (metric, current, previous) => {
    const currValue = current || 0;
    const prevValue = previous || 0;

    if (prevValue === 0) {
        if (currValue > 0) return `<span class="text-xs text-gray-400 ml-1" title="이전 기록 없음">(new)</span>`;
        return ''; // 둘 다 0
    }
    
    const diff = currValue - prevValue;
    if (Math.abs(diff) < 0.001) return `<span class="text-xs text-gray-400 ml-1">(-)</span>`;
    
    const percent = (diff / prevValue) * 100;
    const sign = diff > 0 ? '↑' : '↓';
    
    let colorClass = 'text-gray-500';
    if (['avgThroughput', 'quantity', 'avgStaff', 'totalQuantity'].includes(metric)) {
        colorClass = diff > 0 ? 'text-green-600' : 'text-red-600';
    } 
    else if (['avgCostPerItem', 'duration', 'totalDuration', 'totalCost', 'nonWorkTime', 'activeMembersCount'].includes(metric)) {
        colorClass = diff > 0 ? 'text-red-600' : 'text-green-600';
    }
    
    let diffStr = '';
    let prevStr = '';
    if (metric === 'avgTime' || metric === 'duration' || metric === 'totalDuration' || metric === 'nonWorkTime') {
        diffStr = formatDuration(Math.abs(diff));
        prevStr = formatDuration(prevValue);
    } else if (metric === 'avgStaff' || metric === 'avgCostPerItem' || metric === 'quantity' || metric === 'totalQuantity' || metric === 'totalCost' || metric === 'overallAvgCostPerItem' || metric === 'activeMembersCount') {
        diffStr = Math.round(Math.abs(diff)).toLocaleString();
        prevStr = Math.round(prevValue).toLocaleString();
    } else { // avgThroughput, overallAvgThroughput
        diffStr = Math.abs(diff).toFixed(2);
        prevStr = prevValue.toFixed(2);
    }

    return `<span class="text-xs ${colorClass} ml-1 font-mono" title="이전: ${prevStr}">
                ${sign} ${diffStr} (${percent.toFixed(0)}%)
            </span>`;
};

/**
 * 헬퍼: 테이블 행 생성 (증감율 표시 + 정렬 기능 지원)
 */
const createTableRow = (columns, isHeader = false, sortState = null) => {
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


/**
 * 헬퍼: 일별 리포트용 KPI 계산
 */
const _calculateDailyReportKPIs = (data, appConfig, wageMap) => {
    if (!data) {
        return {
            totalDuration: 0, totalCost: 0, totalQuantity: 0,
            overallAvgThroughput: 0, overallAvgCostPerItem: 0,
            activeMembersCount: 0, nonWorkMinutes: 0, totalQualityCost: 0
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
        const duration = r.duration || 0;
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

    const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
    const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
    const activeRegularMembers = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length;
    const activePartTimers = partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;
    const activeMembersCount = activeRegularMembers + activePartTimers;

    let nonWorkMinutes = 0;
    if (data.id && isWeekday(data.id)) { 
        const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간 기준
        nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalDuration);
    }
    
    return {
        totalDuration, totalCost, totalQuantity,
        overallAvgThroughput, overallAvgCostPerItem,
        activeMembersCount, nonWorkMinutes, totalQualityCost
    };
};

/**
 * 헬퍼: 일별 리포트용 상세 집계 계산
 */
const _calculateDailyReportAggregations = (data, appConfig, wageMap, memberToPartMap) => {
    const records = data?.workRecords || [];
    const quantities = data?.taskQuantities || {};
    
    const partSummary = {};
    const memberSummary = {};
    const taskSummary = {};

    records.forEach(r => {
        if (!r || !r.task) return;
        const duration = r.duration || 0;
        const wage = wageMap[r.member] || 0;
        const cost = (duration / 60) * wage;
        const part = memberToPartMap.get(r.member) || '알바';

        if (!partSummary[part]) partSummary[part] = { duration: 0, cost: 0, members: new Set() };
        partSummary[part].duration += duration;
        partSummary[part].cost += cost;
        partSummary[part].members.add(r.member);

        if (!memberSummary[r.member]) memberSummary[r.member] = { duration: 0, cost: 0, tasks: new Set(), part: part };
        memberSummary[r.member].duration += duration;
        memberSummary[r.member].cost += cost;
        memberSummary[r.member].tasks.add(r.task);

        if (!taskSummary[r.task]) taskSummary[r.task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
        taskSummary[r.task].duration += duration;
        taskSummary[r.task].cost += cost;
        taskSummary[r.task].members.add(r.member);
        taskSummary[r.task].recordCount += 1;
    });

    const allTaskKeys = new Set([...Object.keys(taskSummary), ...Object.keys(quantities)]);
    allTaskKeys.forEach(task => {
        if (!taskSummary[task]) {
            taskSummary[task] = { duration: 0, cost: 0, members: new Set(), recordCount: 0 };
        }
        const summary = taskSummary[task];
        const qty = Number(quantities[task]) || 0;
        
        summary.quantity = qty;
        summary.avgThroughput = summary.duration > 0 ? (qty / summary.duration) : 0;
        summary.avgCostPerItem = qty > 0 ? (summary.cost / qty) : 0;
        summary.avgStaff = summary.members.size;
        summary.avgTime = (summary.recordCount > 0) ? (summary.duration / summary.recordCount) : 0;
        summary.efficiency = summary.avgStaff > 0 ? (summary.avgThroughput / summary.avgStaff) : 0;
    });
    
    return { partSummary, memberSummary, taskSummary };
};

/**
 * 헬퍼: 여러 날의 데이터를 하나로 집계 (주/월/연간용)
 */
const _aggregateDaysToSingleData = (daysData, id) => {
    const aggregated = {
        id: id,
        workRecords: [],
        taskQuantities: {},
        onLeaveMembers: [], 
        partTimers: [] 
    };

    const partTimerNames = new Set();
    
    daysData.forEach(day => {
        (day.workRecords || []).forEach(r => aggregated.workRecords.push(r));
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
    });
    
    return aggregated;
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

    // --- 1. Map 생성 ---
    const wageMap = { ...(appConfig.memberWages || {}) };
    (data.partTimers || []).forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });
    if (previousDayData) {
        (previousDayData.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });
    }

    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        group.members.forEach(member => {
            memberToPartMap.set(member, group.name);
        });
    });

    // --- 2. 오늘 KPI 및 집계 계산 ---
    const todayKPIs = _calculateDailyReportKPIs(data, appConfig, wageMap);
    const todayAggr = _calculateDailyReportAggregations(data, appConfig, wageMap, memberToPartMap);
    
    // --- 3. 이전 날짜 KPI 및 집계 계산 ---
    const prevKPIs = _calculateDailyReportKPIs(previousDayData, appConfig, wageMap);
    const prevAggr = _calculateDailyReportAggregations(previousDayData, appConfig, wageMap, memberToPartMap);
    
    // --- 4. 정렬 상태 가져오기 ---
    const sortState = context.reportSortState || {};
    const partSort = sortState.partSummary || { key: 'partName', dir: 'asc' };
    const memberSort = sortState.memberSummary || { key: 'memberName', dir: 'asc' };
    const taskSort = sortState.taskSummary || { key: 'taskName', dir: 'asc' };

    // --- 5. HTML 렌더링 ---
    let html = `<div class="space-y-6">`;
    html += `<h2 class="text-2xl font-bold text-gray-800">${dateKey} 업무 리포트 (이전 기록 대비)</h2>`;
    
    // 5a. KPI 요약
    html += `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', todayKPIs.totalDuration, prevKPIs.totalDuration)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 인건비</div>
                <div class="text-xl font-bold">${Math.round(todayKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalCost, prevKPIs.totalCost)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', todayKPIs.totalQuantity, prevKPIs.totalQuantity)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">분당 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', todayKPIs.overallAvgThroughput, prevKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">개당 처리비용</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', todayKPIs.overallAvgCostPerItem, prevKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">근무 인원</div>
                <div class="text-xl font-bold">${todayKPIs.activeMembersCount} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', todayKPIs.activeMembersCount, prevKPIs.activeMembersCount)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">비업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', todayKPIs.nonWorkMinutes, prevKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm border-2 border-red-200 cursor-pointer hover:bg-red-50 transition" data-action="show-coq-modal">
                <div class="text-xs text-red-600 font-semibold">총 품질 비용 (COQ) ⓘ</div>
                <div class="text-xl font-bold text-red-600">${Math.round(todayKPIs.totalQualityCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalQualityCost, prevKPIs.totalQualityCost)}
            </div>
        </div>
    `;
    
    // ================== [ ✨ 1. AI Insights 수정 (keyTasks -> allTaskNames) ✨ ] ==================
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 분석 (Beta)</h3>
            <div class="space-y-4">
    `;

    // ⛔️ [삭제] const keyTasks = appConfig.keyTasks || [];
    // ✅ [추가] 오늘 또는 이전에 데이터가 있었던 모든 업무 목록
    const allTaskNames = new Set([...Object.keys(todayAggr.taskSummary), ...Object.keys(prevAggr.taskSummary)]);
    let insightsA = ''; // Part A insights
    
    // ✅ [수정] keyTasks.forEach -> allTaskNames.forEach
    allTaskNames.forEach(taskName => {
        const d = todayAggr.taskSummary[taskName];
        const p = prevAggr.taskSummary[taskName];

        if (d && p) { // (로직 동일: 비교를 위해 이틀치 데이터가 모두 있어야 함)
            const speedDiff = d.avgThroughput - p.avgThroughput;
            const effDiff = d.efficiency - p.efficiency;
            const staffDiff = d.avgStaff - p.avgStaff;

            if ((speedDiff > 0.1 || staffDiff > 0) && effDiff < -0.1) {
                
                let coqHtml = '';
                const coqTasks = appConfig.qualityCostTasks || [];
                const coqInsights = [];
                
                coqTasks.forEach(coqTaskName => {
                    const d_coq = todayAggr.taskSummary[coqTaskName];
                    const p_coq = prevAggr.taskSummary[coqTaskName];
                    const coqDuration = d_coq?.duration || 0;
                    const prevCoqDuration = p_coq?.duration || 0;
                    
                    if (coqDuration > 0 && coqDuration > (prevCoqDuration * 1.1)) { 
                        coqInsights.push(`'${coqTaskName}' (${formatDuration(prevCoqDuration)} → ${formatDuration(coqDuration)})`);
                    }
                });

                if (coqInsights.length > 0) {
                    coqHtml = `
                        <p class="text-xs text-gray-600 mt-1">
                            <strong class="text-red-600">⚠️ 연관 분석:</strong> 이 효율 저하는 <strong>품질 비용(COQ) 업무 (${coqInsights.join(', ')})</strong>의 증가와 동시에 발생했습니다.
                        </p>
                    `;
                }

                insightsA += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h4 class="font-semibold text-yellow-800">${taskName} - 📉 효율 저하 감지</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            이전 기록 대비 <strong>총 속도(분당 ${p.avgThroughput.toFixed(2)} → ${d.avgThroughput.toFixed(2)})</strong>는 ${speedDiff > 0 ? '증가' : '유지/감소'}했으나, 
                            <strong>1인당 효율( ${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>은 <strong class="text-red-600">감소</strong>했습니다.
                            (투입 인원: ${p.avgStaff}명 → ${d.avgStaff}명)
                        </p>
                        <p class="text-xs text-gray-600 mt-1">
                            <strong>분석:</strong> ${staffDiff > 0 ? '인원을 더 투입했지만' : '인원은 비슷했지만'}, 1인당 생산성이 떨어졌습니다. 작업 공간, 동선, 대기 인원 등을 점검할 필요가 있습니다.
                        </p>
                        ${coqHtml}
                    </div>
                `;
            } else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <h4 class="font-semibold text-green-800">${taskName} - 📈 효율 증가</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            <strong>인원(${p.avgStaff}명 → ${d.avgStaff}명)</strong>을 더 투입했음에도 <strong>1인당 효율(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>이 <strong class="text-green-600">증가(또는 유지)</strong>되었습니다. 긍정적인 신호입니다.
                        </p>
                    </div>
                `;
            }
        }
    });

    if (insightsA === '') {
        // ✅ [수정] 텍스트 변경 ("주요 업무" -> "업무")
        insightsA = `<p class="text-sm text-gray-500">비교(이전/오늘) 데이터가 있는 업무가 없어 인원 효율성(수확 체감) 분석을 건너뜁니다.</p>`;
    }
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">A. 투입 인원 효율성 (수확 체감)</h5>${insightsA}</div>`;

    // Part B (Difficulty Comparison)
    let insightsB = '';
    // ✅ [수정] keyTasks -> Object.keys(todayAggr.taskSummary)
    const efficiencyTasks = Object.keys(todayAggr.taskSummary)
        .map(taskName => ({ name: taskName, ...todayAggr.taskSummary[taskName] })) 
        .filter(d => d && d.efficiency > 0) 
        .sort((a, b) => b.efficiency - a.efficiency); 

    if (efficiencyTasks.length >= 2) {
        const mostEfficient = efficiencyTasks[0];
        const leastEfficient = efficiencyTasks[efficiencyTasks.length - 1];
        const comparisonFactor = (mostEfficient.efficiency / leastEfficient.efficiency);

        insightsB = `
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p class="text-sm text-gray-700">
                    오늘 가장 효율이 높았던 업무는 <strong>'${mostEfficient.name}'</strong> (효율: ${mostEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                <p class="text-sm text-gray-700 mt-1">
                    반면, 가장 효율이 낮았던(손이 많이 간) 업무는 <strong>'${leastEfficient.name}'</strong> (효율: ${leastEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                ${comparisonFactor > 1.1 ? 
                `<p class="text-xs text-gray-600 mt-1">
                    <strong>분석:</strong> '${mostEfficient.name}' 대비 '${leastEfficient.name}' 업무는 약 <strong>${comparisonFactor.toFixed(1)}배</strong> 더 많은 인력/시간이 소요(난이도가 높음)된 것으로 보입니다.
                </p>` : ''}
            </div>
        `;
    } else {
        // ✅ [수정] 텍스트 변경 ("주요 업무" -> "업무")
        insightsB = `<p class="text-sm text-gray-500">업무가 1개만 기록되었거나 효율(처리량/시간/인원) 데이터가 부족하여 난이도 비교를 건너뜁니다.</p>`;
    }
    
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">B. 업무 난이도 비교 (오늘 기준)</h5>${insightsB}</div>`;
    
    html += `</div></div>`; 
    // ================== [ ✨ 수정 끝 ✨ ] ==================


    // 5c. 파트별 요약
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">파트별 요약</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-part">
                    <thead>${createTableRow([
                        { content: '파트', sortKey: 'partName' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '참여 인원 (명)', sortKey: 'members' }
                    ], true, partSort)}</thead>
                    <tbody>
    `;
    const allParts = new Set([...Object.keys(todayAggr.partSummary), ...Object.keys(prevAggr.partSummary)]);
    const sortedParts = Array.from(allParts).sort((a, b) => {
        const d1 = todayAggr.partSummary[a] || { duration: 0, cost: 0, members: new Set() };
        const d2 = todayAggr.partSummary[b] || { duration: 0, cost: 0, members: new Set() };
        let v1, v2;
        if (partSort.key === 'partName') { v1 = a; v2 = b; }
        else if (partSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (partSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (partSort.key === 'members') { v1 = d1.members.size; v2 = d2.members.size; }
        
        if (typeof v1 === 'string') return v1.localeCompare(v2) * (partSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    });
    
    if (sortedParts.length > 0) {
        sortedParts.forEach(part => {
            const d = todayAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            const p = prevAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            html += createTableRow([
                part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, p.members.size) }
            ]);
        });
    } else {
        html += `<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    // 5d. 인원별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">인원별 상세</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-member">
                    <thead>${createTableRow([
                        { content: '이름', sortKey: 'memberName' },
                        { content: '파트', sortKey: 'part' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '수행 업무 수', sortKey: 'taskCount' },
                        { content: '수행 업무', sortKey: null } 
                    ], true, memberSort)}</thead>
                    <tbody>
    `;
    const allMembers = new Set([...Object.keys(todayAggr.memberSummary), ...Object.keys(prevAggr.memberSummary)]);
    const sortedMembers = Array.from(allMembers).sort((a, b) => {
        const d1 = todayAggr.memberSummary[a] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(a) || '알바' };
        const d2 = todayAggr.memberSummary[b] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(b) || '알바' };
        let v1, v2;
        if (memberSort.key === 'memberName') { v1 = a; v2 = b; }
        else if (memberSort.key === 'part') { v1 = d1.part; v2 = d2.part; }
        else if (memberSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (memberSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (memberSort.key === 'taskCount') { v1 = d1.tasks.size; v2 = d2.tasks.size; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (memberSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (memberSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedMembers.length > 0) {
        sortedMembers.forEach(member => {
            const d = todayAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(member) || '알바' };
            const p = prevAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set() };
            const tasksStr = Array.from(d.tasks).join(', ');
            html += createTableRow([
                member,
                d.part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, p.tasks.size) },
                { content: tasksStr, class: "text-xs" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="6" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5e. 업무별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">업무별 상세 (증감율은 이전 리포트일 대비)</h3>
            <div class="overflow-x-auto max-h-[70vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-task">
                    <thead>${createTableRow([
                        { content: '업무', sortKey: 'taskName' },
                        { content: '총 시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '총 처리량', sortKey: 'quantity' },
                        { content: '분당 처리량(Avg)', sortKey: 'avgThroughput' },
                        { content: '개당 처리비용(Avg)', sortKey: 'avgCostPerItem' },
                        { content: '총 참여인원', sortKey: 'avgStaff' },
                        { content: '평균 처리시간(건)', sortKey: 'avgTime' },
                        { content: '인당 분당 처리량(효율)', sortKey: 'efficiency', title: '개념: (총 처리량) / (총 시간) / (총 참여인원) \n계산: (분당 처리량) / (총 참여인원) \n*지표가 높을수록 투입 인원 대비 효율이 높음*' }
                    ], true, taskSort)}</thead>
                    <tbody>
    `;
    // ⛔️ [삭제] const allTasks = new Set([...Object.keys(todayAggr.taskSummary), ...Object.keys(prevAggr.taskSummary)]);
    // ✅ [수정] allTaskNames는 위에서 이미 정의됨 (insightsA)
    const sortedTasks = Array.from(allTaskNames).sort((a, b) => { // ✅ allTasks -> allTaskNames
        const d1 = todayAggr.taskSummary[a] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        const d2 = todayAggr.taskSummary[b] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        let v1, v2;
        if (taskSort.key === 'taskName') { v1 = a; v2 = b; }
        else { v1 = d1[taskSort.key]; v2 = d2[taskSort.key]; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (taskSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (taskSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const d = todayAggr.taskSummary[task]; 
            const p = prevAggr.taskSummary[task] || null;
            if (!d || (d.duration === 0 && d.quantity === 0)) return; 

            html += createTableRow([
                { content: task, class: "font-medium text-gray-900" },
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p?.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p?.cost) },
                { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, p?.quantity) },
                { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, p?.avgThroughput) },
                { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, p?.avgCostPerItem) },
                { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, p?.avgStaff) },
                { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, p?.avgTime) },
                { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, p?.efficiency), class: "font-bold" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="9" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5f. 근태 현황
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">근태 현황</h3>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto">
    `;
    
    const attendanceSummary = (data.onLeaveMembers || []).reduce((acc, entry) => {
        const member = entry.member;
        const type = entry.type;
        if (!acc[member]) acc[member] = { member: member, counts: {} };
        if (!acc[member].counts[type]) acc[member].counts[type] = 0;
        
        if (entry.startDate) { 
             acc[member].counts[type] += 1; // '일'
        } else { 
             acc[member].counts[type] += 1; // '회'
        }
        return acc;
    }, {});

    if (Object.keys(attendanceSummary).length === 0) {
         html += `<p class="text-sm text-gray-500 text-center">데이터 없음</p>`;
    } else {
        Object.values(attendanceSummary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
            const typesHtml = Object.entries(item.counts)
                .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
                .map(([type, count]) => {
                    const unit = (['연차', '출장', '결근'].includes(type)) ? '일' : '회';
                    return `<div class="flex justify-between text-sm text-gray-700 pl-4">
                                <span>${type}</span>
                                <span class="text-right font-medium">${count}${unit}</span>
                            </div>`;
                }).join('');

             html += `
                <div class="border-t pt-2 first:border-t-0">
                    <div class="flex justify-between text-md mb-1">
                        <span class="font-semibold text-gray-900">${item.member}</span>
                    </div>
                    <div class="space-y-0.5">
                        ${typesHtml}
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`; 


    html += `</div>`; 
    view.innerHTML = html;
};

/**
 * 주별 리포트 렌더링
 */
export const renderReportWeekly = (weekKey, allHistoryData, appConfig, context) => { 
    const view = document.getElementById('report-weekly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">주별 리포트 집계 중...</div>';

    context.currentReportParams = { weekKey, allHistoryData, appConfig };
    
    // --- 1. 주간 데이터 집계 ---
    const currentWeekDays = allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === weekKey);
    
    const sortedWeeks = Array.from(new Set(allHistoryData.map(d => getWeekOfYear(new Date(d.id + "T00:00:00"))))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedWeeks.indexOf(weekKey);
    const prevWeekKey = (currentIndex > -1 && currentIndex + 1 < sortedWeeks.length) ? sortedWeeks[currentIndex + 1] : null;

    const prevWeekDays = prevWeekKey ? allHistoryData.filter(d => getWeekOfYear(new Date(d.id + "T00:00:00")) === prevWeekKey) : [];

    const wageMap = { ...(appConfig.memberWages || {}) };
    [...currentWeekDays, ...prevWeekDays].forEach(day => {
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

    // --- 2. KPI 및 집계 계산 ---
    const todayData = _aggregateDaysToSingleData(currentWeekDays, weekKey);
    const todayKPIs = _calculateDailyReportKPIs(todayData, appConfig, wageMap); 
    const todayAggr = _calculateDailyReportAggregations(todayData, appConfig, wageMap, memberToPartMap); 

    // --- 3. 이전 주 KPI 및 집계 계산 ---
    const prevData = _aggregateDaysToSingleData(prevWeekDays, prevWeekKey);
    const prevKPIs = _calculateDailyReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = _calculateDailyReportAggregations(prevData, appConfig, wageMap, memberToPartMap);
    
    // --- 4. 정렬 상태 가져오기 ---
    const sortState = context.reportSortState || {};
    const partSort = sortState.partSummary || { key: 'partName', dir: 'asc' };
    const memberSort = sortState.memberSummary || { key: 'memberName', dir: 'asc' };
    const taskSort = sortState.taskSummary || { key: 'taskName', dir: 'asc' };

    // --- 5. HTML 렌더링 ---
    let html = `<div class="space-y-6">`;
    html += `<h2 class="text-2xl font-bold text-gray-800">${weekKey} 주별 업무 리포트 (이전 주 대비)</h2>`;
    
    // 5a. KPI 요약
    html += `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', todayKPIs.totalDuration, prevKPIs.totalDuration)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 인건비</div>
                <div class="text-xl font-bold">${Math.round(todayKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalCost, prevKPIs.totalCost)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', todayKPIs.totalQuantity, prevKPIs.totalQuantity)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">분당 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', todayKPIs.overallAvgThroughput, prevKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">개당 처리비용</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', todayKPIs.overallAvgCostPerItem, prevKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 근무 인원(일/Avg)</div>
                <div class="text-xl font-bold">${(todayKPIs.activeMembersCount / (currentWeekDays.length || 1)).toFixed(1)} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', (todayKPIs.activeMembersCount / (currentWeekDays.length || 1)), (prevKPIs.activeMembersCount / (prevWeekDays.length || 1)))}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 비업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', todayKPIs.nonWorkMinutes, prevKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm border-2 border-red-200 cursor-pointer hover:bg-red-50 transition" data-action="show-coq-modal">
                <div class="text-xs text-red-600 font-semibold">총 품질 비용 (COQ) ⓘ</div>
                <div class="text-xl font-bold text-red-600">${Math.round(todayKPIs.totalQualityCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalQualityCost, prevKPIs.totalQualityCost)}
            </div>
        </div>
    `;
    
    // ================== [ ✨ 2. AI Insights 수정 (keyTasks -> allTaskNames) ✨ ] ==================
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 분석 (Beta)</h3>
            <div class="space-y-4">
    `;

    // ⛔️ [삭제] const keyTasks = appConfig.keyTasks || [];
    // ✅ [추가]
    const allTaskNames = new Set([...Object.keys(todayAggr.taskSummary), ...Object.keys(prevAggr.taskSummary)]);
    let insightsA = ''; 
    
    // ✅ [수정] keyTasks.forEach -> allTaskNames.forEach
    allTaskNames.forEach(taskName => {
        const d = todayAggr.taskSummary[taskName];
        const p = prevAggr.taskSummary[taskName];

        if (d && p) { 
            const speedDiff = d.avgThroughput - p.avgThroughput;
            const effDiff = d.efficiency - p.efficiency;
            const staffDiff = d.avgStaff - p.avgStaff;

            if ((speedDiff > 0.1 || staffDiff > 0) && effDiff < -0.1) {
                
                let coqHtml = '';
                const coqTasks = appConfig.qualityCostTasks || [];
                const coqInsights = [];
                
                coqTasks.forEach(coqTaskName => {
                    const d_coq = todayAggr.taskSummary[coqTaskName];
                    const p_coq = prevAggr.taskSummary[coqTaskName];
                    const coqDuration = d_coq?.duration || 0;
                    const prevCoqDuration = p_coq?.duration || 0;
                    
                    if (coqDuration > 0 && coqDuration > (prevCoqDuration * 1.1)) { 
                        coqInsights.push(`'${coqTaskName}' (${formatDuration(prevCoqDuration)} → ${formatDuration(coqDuration)})`);
                    }
                });

                if (coqInsights.length > 0) {
                    coqHtml = `
                        <p class="text-xs text-gray-600 mt-1">
                            <strong class="text-red-600">⚠️ 연관 분석:</strong> 이 효율 저하는 <strong>품질 비용(COQ) 업무 (${coqInsights.join(', ')})</strong>의 증가와 동시에 발생했습니다.
                        </p>
                    `;
                }

                insightsA += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h4 class="font-semibold text-yellow-800">${taskName} - 📉 효율 저하 감지</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            이전 주 대비 <strong>총 속도(분당 ${p.avgThroughput.toFixed(2)} → ${d.avgThroughput.toFixed(2)})</strong>는 ${speedDiff > 0 ? '증가' : '유지/감소'}했으나, 
                            <strong>1인당 효율( ${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>은 <strong class="text-red-600">감소</strong>했습니다.
                            (평균 투입 인원: ${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)
                        </p>
                        <p class="text-xs text-gray-600 mt-1">
                            <strong>분석:</strong> ${staffDiff > 0 ? '인원을 더 투입했지만' : '인원은 비슷했지만'}, 1인당 생산성이 떨어졌습니다.
                        </p>
                        ${coqHtml}
                    </div>
                `;
            } else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <h4 class="font-semibold text-green-800">${taskName} - 📈 효율 증가</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            <strong>인원(${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)</strong>을 더 투입했음에도 <strong>1인당 효율(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>이 <strong class="text-green-600">증가(또는 유지)</strong>되었습니다.
                        </p>
                    </div>
                `;
            }
        }
    });

    if (insightsA === '') {
        // ✅ [수정] 텍스트 변경
        insightsA = `<p class="text-sm text-gray-500">비교(이전 주/이번 주) 데이터가 있는 업무가 없어 인원 효율성(수확 체감) 분석을 건너뜁니다.</p>`;
    }
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">A. 투입 인원 효율성 (수확 체감)</h5>${insightsA}</div>`;

    // Part B (Difficulty Comparison)
    let insightsB = '';
    // ✅ [수정] keyTasks -> Object.keys(todayAggr.taskSummary)
    const efficiencyTasks = Object.keys(todayAggr.taskSummary)
        .map(taskName => ({ name: taskName, ...todayAggr.taskSummary[taskName] })) 
        .filter(d => d && d.efficiency > 0) 
        .sort((a, b) => b.efficiency - a.efficiency); 

    if (efficiencyTasks.length >= 2) {
        const mostEfficient = efficiencyTasks[0];
        const leastEfficient = efficiencyTasks[efficiencyTasks.length - 1];
        const comparisonFactor = (mostEfficient.efficiency / leastEfficient.efficiency);

        insightsB = `
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p class="text-sm text-gray-700">
                    이번 주 가장 효율이 높았던 업무는 <strong>'${mostEfficient.name}'</strong> (효율: ${mostEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                <p class="text-sm text-gray-700 mt-1">
                    반면, 가장 효율이 낮았던(손이 많이 간) 업무는 <strong>'${leastEfficient.name}'</strong> (효율: ${leastEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                ${comparisonFactor > 1.1 ? 
                `<p class="text-xs text-gray-600 mt-1">
                    <strong>분석:</strong> '${mostEfficient.name}' 대비 '${leastEfficient.name}' 업무는 약 <strong>${comparisonFactor.toFixed(1)}배</strong> 더 많은 인력/시간이 소요(난이도가 높음)된 것으로 보입니다.
                </p>` : ''}
            </div>
        `;
    } else {
        // ✅ [수정] 텍스트 변경
        insightsB = `<p class="text-sm text-gray-500">업무가 1개만 기록되었거나 효율(처리량/시간/인원) 데이터가 부족하여 난이도 비교를 건너뜁니다.</p>`;
    }
    
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">B. 업무 난이도 비교 (이번 주 기준)</h5>${insightsB}</div>`;
    
    html += `</div></div>`;
    // ================== [ ✨ 수정 끝 ✨ ] ==================


    // 5c. 파트별 요약
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">파트별 요약</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-part">
                    <thead>${createTableRow([
                        { content: '파트', sortKey: 'partName' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '참여 인원 (명)', sortKey: 'members' }
                    ], true, partSort)}</thead>
                    <tbody>
    `;
    const allParts = new Set([...Object.keys(todayAggr.partSummary), ...Object.keys(prevAggr.partSummary)]);
    const sortedParts = Array.from(allParts).sort((a, b) => {
        const d1 = todayAggr.partSummary[a] || { duration: 0, cost: 0, members: new Set() };
        const d2 = prevAggr.partSummary[b] || { duration: 0, cost: 0, members: new Set() };
        let v1, v2;
        if (partSort.key === 'partName') { v1 = a; v2 = b; }
        else if (partSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (partSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (partSort.key === 'members') { v1 = d1.members.size; v2 = d2.members.size; }
        
        if (typeof v1 === 'string') return v1.localeCompare(v2) * (partSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    });
    
    if (sortedParts.length > 0) {
        sortedParts.forEach(part => {
            const d = todayAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            const p = prevAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            html += createTableRow([
                part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, p.members.size) }
            ]);
        });
    } else {
        html += `<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    // 5d. 인원별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">인원별 상세</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-member">
                    <thead>${createTableRow([
                        { content: '이름', sortKey: 'memberName' },
                        { content: '파트', sortKey: 'part' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '수행 업무 수', sortKey: 'taskCount' },
                        { content: '수행 업무', sortKey: null } 
                    ], true, memberSort)}</thead>
                    <tbody>
    `;
    const allMembers = new Set([...Object.keys(todayAggr.memberSummary), ...Object.keys(prevAggr.memberSummary)]);
    const sortedMembers = Array.from(allMembers).sort((a, b) => {
        const d1 = todayAggr.memberSummary[a] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(a) || '알바' };
        const d2 = prevAggr.memberSummary[b] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(b) || '알바' };
        let v1, v2;
        if (memberSort.key === 'memberName') { v1 = a; v2 = b; }
        else if (memberSort.key === 'part') { v1 = d1.part; v2 = d2.part; }
        else if (memberSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (memberSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (memberSort.key === 'taskCount') { v1 = d1.tasks.size; v2 = d2.tasks.size; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (memberSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (memberSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedMembers.length > 0) {
        sortedMembers.forEach(member => {
            const d = todayAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(member) || '알바' };
            const p = prevAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set() };
            const tasksStr = Array.from(d.tasks).join(', ');
            html += createTableRow([
                member,
                d.part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, p.tasks.size) },
                { content: tasksStr, class: "text-xs" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="6" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5e. 업무별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">업무별 상세 (증감율은 이전 주 대비)</h3>
            <div class="overflow-x-auto max-h-[70vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-task">
                    <thead>${createTableRow([
                        { content: '업무', sortKey: 'taskName' },
                        { content: '총 시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '총 처리량', sortKey: 'quantity' },
                        { content: '분당 처리량(Avg)', sortKey: 'avgThroughput' },
                        { content: '개당 처리비용(Avg)', sortKey: 'avgCostPerItem' },
                        { content: '총 참여인원', sortKey: 'avgStaff' },
                        { content: '평균 처리시간(건)', sortKey: 'avgTime' },
                        { content: '인당 분당 처리량(효율)', sortKey: 'efficiency', title: '개념: (총 처리량) / (총 시간) / (총 참여인원) \n계산: (분당 처리량) / (총 참여인원) \n*지표가 높을수록 투입 인원 대비 효율이 높음*' }
                    ], true, taskSort)}</thead>
                    <tbody>
    `;
    // ✅ [수정] allTaskNames는 위에서 이미 정의됨
    const sortedTasks = Array.from(allTaskNames).sort((a, b) => {
        const d1 = todayAggr.taskSummary[a] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        const d2 = prevAggr.taskSummary[b] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        let v1, v2;
        if (taskSort.key === 'taskName') { v1 = a; v2 = b; }
        else { v1 = d1[taskSort.key]; v2 = d2[taskSort.key]; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (taskSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (taskSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const d = todayAggr.taskSummary[task];
            const p = prevAggr.taskSummary[task] || null; 
            if (!d || (d.duration === 0 && d.quantity === 0)) return;

            html += createTableRow([
                { content: task, class: "font-medium text-gray-900" },
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p?.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p?.cost) },
                { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, p?.quantity) },
                { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, p?.avgThroughput) },
                { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, p?.avgCostPerItem) },
                { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, p?.avgStaff) },
                { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, p?.avgTime) },
                { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, p?.efficiency), class: "font-bold" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="9" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5f. 근태 현황
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">근태 현황 (주간 총계)</h3>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto">
    `;
    
    const attendanceSummary = (todayData.onLeaveMembers || []).reduce((acc, entry) => {
        const member = entry.member;
        const type = entry.type;
        if (!acc[member]) acc[member] = { member: member, counts: {} };
        if (!acc[member].counts[type]) acc[member].counts[type] = 0;
        
        if (entry.startDate) { 
             acc[member].counts[type] += 1; // '일'
        } else { 
             acc[member].counts[type] += 1; // '회'
        }
        return acc;
    }, {});

    if (Object.keys(attendanceSummary).length === 0) {
         html += `<p class="text-sm text-gray-500 text-center">데이터 없음</p>`;
    } else {
        Object.values(attendanceSummary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
            const typesHtml = Object.entries(item.counts)
                .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
                .map(([type, count]) => {
                    const unit = (['연차', '출장', '결근'].includes(type)) ? '일' : '회';
                    return `<div class="flex justify-between text-sm text-gray-700 pl-4">
                                <span>${type}</span>
                                <span class="text-right font-medium">${count}${unit}</span>
                            </div>`;
                }).join('');

             html += `
                <div class="border-t pt-2 first:border-t-0">
                    <div class="flex justify-between text-md mb-1">
                        <span class="font-semibold text-gray-900">${item.member}</span>
                    </div>
                    <div class="space-y-0.5">
                        ${typesHtml}
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`;


    html += `</div>`; 
    view.innerHTML = html;
};

// ================== [ ✨ 3. 월별 리포트 수정 ✨ ] ==================
/**
 * 월별 리포트 렌더링 (구현)
 */
export const renderReportMonthly = (monthKey, allHistoryData, appConfig, context) => { 
    const view = document.getElementById('report-monthly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">월별 리포트 집계 중...</div>';

    context.currentReportParams = { monthKey, allHistoryData, appConfig };
    
    // --- 1. 월간 데이터 집계 ---
    const currentMonthDays = allHistoryData.filter(d => d.id.substring(0, 7) === monthKey);
    
    const sortedMonths = Array.from(new Set(allHistoryData.map(d => d.id.substring(0, 7)))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedMonths.indexOf(monthKey);
    const prevMonthKey = (currentIndex > -1 && currentIndex + 1 < sortedMonths.length) ? sortedMonths[currentIndex + 1] : null;

    const prevMonthDays = prevMonthKey ? allHistoryData.filter(d => d.id.substring(0, 7) === prevMonthKey) : [];

    // 1d. WageMap 생성
    const wageMap = { ...(appConfig.memberWages || {}) };
    [...currentMonthDays, ...prevMonthDays].forEach(day => {
        (day.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });
    });

    // 1e. 파트 Map 생성
    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        group.members.forEach(member => {
            memberToPartMap.set(member, group.name);
        });
    });

    // --- 2. KPI 및 집계 계산 ---
    const todayData = _aggregateDaysToSingleData(currentMonthDays, monthKey);
    const todayKPIs = _calculateDailyReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = _calculateDailyReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    // --- 3. 이전 월 KPI 및 집계 계산 ---
    const prevData = _aggregateDaysToSingleData(prevMonthDays, prevMonthKey);
    const prevKPIs = _calculateDailyReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = _calculateDailyReportAggregations(prevData, appConfig, wageMap, memberToPartMap);
    
    // --- 4. 정렬 상태 가져오기 ---
    const sortState = context.reportSortState || {};
    const partSort = sortState.partSummary || { key: 'partName', dir: 'asc' };
    const memberSort = sortState.memberSummary || { key: 'memberName', dir: 'asc' };
    const taskSort = sortState.taskSummary || { key: 'taskName', dir: 'asc' };

    // --- 5. HTML 렌더링 ---
    let html = `<div class="space-y-6">`;
    html += `<h2 class="text-2xl font-bold text-gray-800">${monthKey} 월별 업무 리포트 (이전 월 대비)</h2>`;
    
    // 5a. KPI 요약
    html += `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', todayKPIs.totalDuration, prevKPIs.totalDuration)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 인건비</div>
                <div class="text-xl font-bold">${Math.round(todayKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalCost, prevKPIs.totalCost)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', todayKPIs.totalQuantity, prevKPIs.totalQuantity)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">분당 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', todayKPIs.overallAvgThroughput, prevKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">개당 처리비용</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', todayKPIs.overallAvgCostPerItem, prevKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 근무 인원(일/Avg)</div>
                <div class="text-xl font-bold">${(todayKPIs.activeMembersCount / (currentMonthDays.length || 1)).toFixed(1)} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', (todayKPIs.activeMembersCount / (currentMonthDays.length || 1)), (prevKPIs.activeMembersCount / (prevMonthDays.length || 1)))}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 비업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', todayKPIs.nonWorkMinutes, prevKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm border-2 border-red-200 cursor-pointer hover:bg-red-50 transition" data-action="show-coq-modal">
                <div class="text-xs text-red-600 font-semibold">총 품질 비용 (COQ) ⓘ</div>
                <div class="text-xl font-bold text-red-600">${Math.round(todayKPIs.totalQualityCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalQualityCost, prevKPIs.totalQualityCost)}
            </div>
        </div>
    `;
    
    // 5b. 주요 업무 분석 (AI Insights)
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 분석 (Beta)</h3>
            <div class="space-y-4">
    `;

    // ✅ [수정]
    const allTaskNames = new Set([...Object.keys(todayAggr.taskSummary), ...Object.keys(prevAggr.taskSummary)]);
    let insightsA = ''; 
    
    allTaskNames.forEach(taskName => {
        const d = todayAggr.taskSummary[taskName];
        const p = prevAggr.taskSummary[taskName];

        if (d && p) { 
            const speedDiff = d.avgThroughput - p.avgThroughput;
            const effDiff = d.efficiency - p.efficiency;
            const staffDiff = d.avgStaff - p.avgStaff;

            if ((speedDiff > 0.1 || staffDiff > 0) && effDiff < -0.1) {
                
                let coqHtml = '';
                const coqTasks = appConfig.qualityCostTasks || [];
                const coqInsights = [];
                
                coqTasks.forEach(coqTaskName => {
                    const d_coq = todayAggr.taskSummary[coqTaskName];
                    const p_coq = prevAggr.taskSummary[coqTaskName];
                    const coqDuration = d_coq?.duration || 0;
                    const prevCoqDuration = p_coq?.duration || 0;
                    
                    if (coqDuration > 0 && coqDuration > (prevCoqDuration * 1.1)) { 
                        coqInsights.push(`'${coqTaskName}' (${formatDuration(prevCoqDuration)} → ${formatDuration(coqDuration)})`);
                    }
                });

                if (coqInsights.length > 0) {
                    coqHtml = `
                        <p class="text-xs text-gray-600 mt-1">
                            <strong class="text-red-600">⚠️ 연관 분석:</strong> 이 효율 저하는 <strong>품질 비용(COQ) 업무 (${coqInsights.join(', ')})</strong>의 증가와 동시에 발생했습니다.
                        </p>
                    `;
                }

                insightsA += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h4 class="font-semibold text-yellow-800">${taskName} - 📉 효율 저하 감지</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            이전 월 대비 <strong>총 속도(분당 ${p.avgThroughput.toFixed(2)} → ${d.avgThroughput.toFixed(2)})</strong>는 ${speedDiff > 0 ? '증가' : '유지/감소'}했으나, 
                            <strong>1인당 효율( ${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>은 <strong class="text-red-600">감소</strong>했습니다.
                            (평균 투입 인원: ${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)
                        </p>
                        <p class="text-xs text-gray-600 mt-1">
                            <strong>분석:</strong> ${staffDiff > 0 ? '인원을 더 투입했지만' : '인원은 비슷했지만'}, 1인당 생산성이 떨어졌습니다.
                        </p>
                        ${coqHtml}
                    </div>
                `;
            } else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <h4 class="font-semibold text-green-800">${taskName} - 📈 효율 증가</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            <strong>인원(${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)</strong>을 더 투입했음에도 <strong>1인당 효율(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>이 <strong class="text-green-600">증가(또는 유지)</strong>되었습니다.
                        </p>
                    </div>
                `;
            }
        }
    });

    if (insightsA === '') {
        // ✅ [수정] 텍스트 변경
        insightsA = `<p class="text-sm text-gray-500">비교(이전 월/이번 월) 데이터가 있는 업무가 없어 인원 효율성(수확 체감) 분석을 건너뜁니다.</p>`;
    }
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">A. 투입 인원 효율성 (수확 체감)</h5>${insightsA}</div>`;

    // Part B (Difficulty Comparison)
    let insightsB = '';
    // ✅ [수정]
    const efficiencyTasks = Object.keys(todayAggr.taskSummary)
        .map(taskName => ({ name: taskName, ...todayAggr.taskSummary[taskName] })) 
        .filter(d => d && d.efficiency > 0) 
        .sort((a, b) => b.efficiency - a.efficiency); 

    if (efficiencyTasks.length >= 2) {
        const mostEfficient = efficiencyTasks[0];
        const leastEfficient = efficiencyTasks[efficiencyTasks.length - 1];
        const comparisonFactor = (mostEfficient.efficiency / leastEfficient.efficiency);

        insightsB = `
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p class="text-sm text-gray-700">
                    이번 월 가장 효율이 높았던 업무는 <strong>'${mostEfficient.name}'</strong> (효율: ${mostEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                <p class="text-sm text-gray-700 mt-1">
                    반면, 가장 효율이 낮았던(손이 많이 간) 업무는 <strong>'${leastEfficient.name}'</strong> (효율: ${leastEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                ${comparisonFactor > 1.1 ? 
                `<p class="text-xs text-gray-600 mt-1">
                    <strong>분석:</strong> '${mostEfficient.name}' 대비 '${leastEfficient.name}' 업무는 약 <strong>${comparisonFactor.toFixed(1)}배</strong> 더 많은 인력/시간이 소요(난이도가 높음)된 것으로 보입니다.
                </p>` : ''}
            </div>
        `;
    } else {
        // ✅ [수정] 텍스트 변경
        insightsB = `<p class="text-sm text-gray-500">업무가 1개만 기록되었거나 효율(처리량/시간/인원) 데이터가 부족하여 난이도 비교를 건너뜁니다.</p>`;
    }
    
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">B. 업무 난이도 비교 (이번 월 기준)</h5>${insightsB}</div>`;
    
    html += `</div></div>`;

    // 5c. 파트별 요약
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">파트별 요약</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-part">
                    <thead>${createTableRow([
                        { content: '파트', sortKey: 'partName' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '참여 인원 (명)', sortKey: 'members' }
                    ], true, partSort)}</thead>
                    <tbody>
    `;
    const allParts = new Set([...Object.keys(todayAggr.partSummary), ...Object.keys(prevAggr.partSummary)]);
    const sortedParts = Array.from(allParts).sort((a, b) => {
        const d1 = todayAggr.partSummary[a] || { duration: 0, cost: 0, members: new Set() };
        const d2 = prevAggr.partSummary[b] || { duration: 0, cost: 0, members: new Set() };
        let v1, v2;
        if (partSort.key === 'partName') { v1 = a; v2 = b; }
        else if (partSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (partSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (partSort.key === 'members') { v1 = d1.members.size; v2 = d2.members.size; }
        
        if (typeof v1 === 'string') return v1.localeCompare(v2) * (partSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    });
    
    if (sortedParts.length > 0) {
        sortedParts.forEach(part => {
            const d = todayAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            const p = prevAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            html += createTableRow([
                part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, p.members.size) }
            ]);
        });
    } else {
        html += `<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    // 5d. 인원별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">인원별 상세</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-member">
                    <thead>${createTableRow([
                        { content: '이름', sortKey: 'memberName' },
                        { content: '파트', sortKey: 'part' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '수행 업무 수', sortKey: 'taskCount' },
                        { content: '수행 업무', sortKey: null } 
                    ], true, memberSort)}</thead>
                    <tbody>
    `;
    const allMembers = new Set([...Object.keys(todayAggr.memberSummary), ...Object.keys(prevAggr.memberSummary)]);
    const sortedMembers = Array.from(allMembers).sort((a, b) => {
        const d1 = todayAggr.memberSummary[a] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(a) || '알바' };
        const d2 = prevAggr.memberSummary[b] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(b) || '알바' };
        let v1, v2;
        if (memberSort.key === 'memberName') { v1 = a; v2 = b; }
        else if (memberSort.key === 'part') { v1 = d1.part; v2 = d2.part; }
        else if (memberSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (memberSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (memberSort.key === 'taskCount') { v1 = d1.tasks.size; v2 = d2.tasks.size; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (memberSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (memberSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedMembers.length > 0) {
        sortedMembers.forEach(member => {
            const d = todayAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(member) || '알바' };
            const p = prevAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set() };
            const tasksStr = Array.from(d.tasks).join(', ');
            html += createTableRow([
                member,
                d.part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, p.tasks.size) },
                { content: tasksStr, class: "text-xs" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="6" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5e. 업무별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">업무별 상세 (증감율은 이전 월 대비)</h3>
            <div class="overflow-x-auto max-h-[70vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-task">
                    <thead>${createTableRow([
                        { content: '업무', sortKey: 'taskName' },
                        { content: '총 시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '총 처리량', sortKey: 'quantity' },
                        { content: '분당 처리량(Avg)', sortKey: 'avgThroughput' },
                        { content: '개당 처리비용(Avg)', sortKey: 'avgCostPerItem' },
                        { content: '총 참여인원', sortKey: 'avgStaff' },
                        { content: '평균 처리시간(건)', sortKey: 'avgTime' },
                        { content: '인당 분당 처리량(효율)', sortKey: 'efficiency', title: '개념: (총 처리량) / (총 시간) / (총 참여인원) \n계산: (분당 처리량) / (총 참여인원) \n*지표가 높을수록 투입 인원 대비 효율이 높음*' }
                    ], true, taskSort)}</thead>
                    <tbody>
    `;
    // ✅ [수정] allTaskNames는 위에서 이미 정의됨
    const sortedTasks = Array.from(allTaskNames).sort((a, b) => {
        const d1 = todayAggr.taskSummary[a] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        const d2 = prevAggr.taskSummary[b] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        let v1, v2;
        if (taskSort.key === 'taskName') { v1 = a; v2 = b; }
        else { v1 = d1[taskSort.key]; v2 = d2[taskSort.key]; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (partSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const d = todayAggr.taskSummary[task];
            const p = prevAggr.taskSummary[task] || null; 
            if (!d || (d.duration === 0 && d.quantity === 0)) return;

            html += createTableRow([
                { content: task, class: "font-medium text-gray-900" },
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p?.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p?.cost) },
                { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, p?.quantity) },
                { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, p?.avgThroughput) },
                { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, p?.avgCostPerItem) },
                { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, p?.avgStaff) },
                { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, p?.avgTime) },
                { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, p?.efficiency), class: "font-bold" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="9" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5f. 근태 현황
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">근태 현황 (월간 총계)</h3>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto">
    `;
    
    const attendanceSummary = (todayData.onLeaveMembers || []).reduce((acc, entry) => {
        const member = entry.member;
        const type = entry.type;
        if (!acc[member]) acc[member] = { member: member, counts: {} };
        if (!acc[member].counts[type]) acc[member].counts[type] = 0;
        
        if (entry.startDate) { 
             acc[member].counts[type] += 1; // '일'
        } else { 
             acc[member].counts[type] += 1; // '회'
        }
        return acc;
    }, {});

    if (Object.keys(attendanceSummary).length === 0) {
         html += `<p class="text-sm text-gray-500 text-center">데이터 없음</p>`;
    } else {
        Object.values(attendanceSummary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
            const typesHtml = Object.entries(item.counts)
                .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
                .map(([type, count]) => {
                    const unit = (['연차', '출장', '결근'].includes(type)) ? '일' : '회';
                    return `<div class="flex justify-between text-sm text-gray-700 pl-4">
                                <span>${type}</span>
                                <span class="text-right font-medium">${count}${unit}</span>
                            </div>`;
                }).join('');

             html += `
                <div class="border-t pt-2 first:border-t-0">
                    <div class="flex justify-between text-md mb-1">
                        <span class="font-semibold text-gray-900">${item.member}</span>
                    </div>
                    <div class="space-y-0.5">
                        ${typesHtml}
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`;


    html += `</div>`; 
    view.innerHTML = html;
};

// ================== [ ✨ 4. 연간 리포트 수정 ✨ ] ==================
/**
 * 연간 리포트 렌더링 (구현)
 */
export const renderReportYearly = (yearKey, allHistoryData, appConfig, context) => { 
    const view = document.getElementById('report-yearly-view');
    if (!view) return;
    view.innerHTML = '<div class="text-center text-gray-500">연간 리포트 집계 중...</div>';

    context.currentReportParams = { yearKey, allHistoryData, appConfig };
    
    // --- 1. 연간 데이터 집계 ---
    const currentYearDays = allHistoryData.filter(d => d.id.substring(0, 4) === yearKey);
    
    const sortedYears = Array.from(new Set(allHistoryData.map(d => d.id.substring(0, 4)))).sort((a, b) => b.localeCompare(a));
    const currentIndex = sortedYears.indexOf(yearKey);
    const prevYearKey = (currentIndex > -1 && currentIndex + 1 < sortedYears.length) ? sortedYears[currentIndex + 1] : null;

    const prevYearDays = prevYearKey ? allHistoryData.filter(d => d.id.substring(0, 4) === prevYearKey) : [];

    // 1d. WageMap 생성
    const wageMap = { ...(appConfig.memberWages || {}) };
    [...currentYearDays, ...prevYearDays].forEach(day => {
        (day.partTimers || []).forEach(pt => {
            if (pt && pt.name && !wageMap[pt.name]) {
                wageMap[pt.name] = pt.wage || 0;
            }
        });
    });

    // 1e. 파트 Map 생성
    const memberToPartMap = new Map();
    (appConfig.teamGroups || []).forEach(group => {
        group.members.forEach(member => {
            memberToPartMap.set(member, group.name);
        });
    });

    // --- 2. KPI 및 집계 계산 ---
    const todayData = _aggregateDaysToSingleData(currentYearDays, yearKey);
    const todayKPIs = _calculateDailyReportKPIs(todayData, appConfig, wageMap);
    const todayAggr = _calculateDailyReportAggregations(todayData, appConfig, wageMap, memberToPartMap);

    // --- 3. 이전 연도 KPI 및 집계 계산 ---
    const prevData = _aggregateDaysToSingleData(prevYearDays, prevYearKey);
    const prevKPIs = _calculateDailyReportKPIs(prevData, appConfig, wageMap);
    const prevAggr = _calculateDailyReportAggregations(prevData, appConfig, wageMap, memberToPartMap);
    
    // --- 4. 정렬 상태 가져오기 ---
    const sortState = context.reportSortState || {};
    const partSort = sortState.partSummary || { key: 'partName', dir: 'asc' };
    const memberSort = sortState.memberSummary || { key: 'memberName', dir: 'asc' };
    const taskSort = sortState.taskSummary || { key: 'taskName', dir: 'asc' };

    // --- 5. HTML 렌더링 ---
    let html = `<div class="space-y-6">`;
    html += `<h2 class="text-2xl font-bold text-gray-800">${yearKey} 연간 업무 리포트 (이전 연도 대비)</h2>`;
    
    // 5a. KPI 요약
    html += `
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.totalDuration)}</div>
                ${getDiffHtmlForMetric('totalDuration', todayKPIs.totalDuration, prevKPIs.totalDuration)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 인건비</div>
                <div class="text-xl font-bold">${Math.round(todayKPIs.totalCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalCost, prevKPIs.totalCost)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.totalQuantity.toLocaleString()} 개</div>
                ${getDiffHtmlForMetric('totalQuantity', todayKPIs.totalQuantity, prevKPIs.totalQuantity)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">분당 처리량</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgThroughput.toFixed(2)} 개/분</div>
                ${getDiffHtmlForMetric('overallAvgThroughput', todayKPIs.overallAvgThroughput, prevKPIs.overallAvgThroughput)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">개당 처리비용</div>
                <div class="text-xl font-bold">${todayKPIs.overallAvgCostPerItem.toFixed(0)} 원/개</div>
                ${getDiffHtmlForMetric('overallAvgCostPerItem', todayKPIs.overallAvgCostPerItem, prevKPIs.overallAvgCostPerItem)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 근무 인원(일/Avg)</div>
                <div class="text-xl font-bold">${(todayKPIs.activeMembersCount / (currentYearDays.length || 1)).toFixed(1)} 명</div>
                ${getDiffHtmlForMetric('activeMembersCount', (todayKPIs.activeMembersCount / (currentYearDays.length || 1)), (prevKPIs.activeMembersCount / (prevYearDays.length || 1)))}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm">
                <div class="text-xs text-gray-500">총 비업무 시간</div>
                <div class="text-xl font-bold">${formatDuration(todayKPIs.nonWorkMinutes)}</div>
                ${getDiffHtmlForMetric('nonWorkTime', todayKPIs.nonWorkMinutes, prevKPIs.nonWorkMinutes)}
            </div>
            <div class="bg-white p-3 rounded-lg shadow-sm border-2 border-red-200 cursor-pointer hover:bg-red-50 transition" data-action="show-coq-modal">
                <div class="text-xs text-red-600 font-semibold">총 품질 비용 (COQ) ⓘ</div>
                <div class="text-xl font-bold text-red-600">${Math.round(todayKPIs.totalQualityCost).toLocaleString()} 원</div>
                ${getDiffHtmlForMetric('totalCost', todayKPIs.totalQualityCost, prevKPIs.totalQualityCost)}
            </div>
        </div>
    `;
    
    // 5b. 주요 업무 분석 (AI Insights)
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">💡 주요 업무 분석 (Beta)</h3>
            <div class="space-y-4">
    `;

    // ✅ [수정]
    const allTaskNames = new Set([...Object.keys(todayAggr.taskSummary), ...Object.keys(prevAggr.taskSummary)]);
    let insightsA = ''; 
    
    allTaskNames.forEach(taskName => {
        const d = todayAggr.taskSummary[taskName];
        const p = prevAggr.taskSummary[taskName];

        if (d && p) { 
            const speedDiff = d.avgThroughput - p.avgThroughput;
            const effDiff = d.efficiency - p.efficiency;
            const staffDiff = d.avgStaff - p.avgStaff;

            if ((speedDiff > 0.1 || staffDiff > 0) && effDiff < -0.1) {
                
                let coqHtml = '';
                const coqTasks = appConfig.qualityCostTasks || [];
                const coqInsights = [];
                
                coqTasks.forEach(coqTaskName => {
                    const d_coq = todayAggr.taskSummary[coqTaskName];
                    const p_coq = prevAggr.taskSummary[coqTaskName];
                    const coqDuration = d_coq?.duration || 0;
                    const prevCoqDuration = p_coq?.duration || 0;
                    
                    if (coqDuration > 0 && coqDuration > (prevCoqDuration * 1.1)) { 
                        coqInsights.push(`'${coqTaskName}' (${formatDuration(prevCoqDuration)} → ${formatDuration(coqDuration)})`);
                    }
                });

                if (coqInsights.length > 0) {
                    coqHtml = `
                        <p class="text-xs text-gray-600 mt-1">
                            <strong class="text-red-600">⚠️ 연관 분석:</strong> 이 효율 저하는 <strong>품질 비용(COQ) 업무 (${coqInsights.join(', ')})</strong>의 증가와 동시에 발생했습니다.
                        </p>
                    `;
                }

                insightsA += `
                    <div class="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <h4 class="font-semibold text-yellow-800">${taskName} - 📉 효율 저하 감지</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            이전 연도 대비 <strong>총 속도(분당 ${p.avgThroughput.toFixed(2)} → ${d.avgThroughput.toFixed(2)})</strong>는 ${speedDiff > 0 ? '증가' : '유지/감소'}했으나, 
                            <strong>1인당 효율( ${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>은 <strong class="text-red-600">감소</strong>했습니다.
                            (평균 투입 인원: ${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)
                        </p>
                        <p class="text-xs text-gray-600 mt-1">
                            <strong>분석:</strong> ${staffDiff > 0 ? '인원을 더 투입했지만' : '인원은 비슷했지만'}, 1인당 생산성이 떨어졌습니다.
                        </p>
                        ${coqHtml}
                    </div>
                `;
            } else if (staffDiff > 0 && effDiff > 0.1) {
                 insightsA += `
                    <div class="p-3 bg-green-50 border border-green-200 rounded-lg">
                        <h4 class="font-semibold text-green-800">${taskName} - 📈 효율 증가</h4>
                        <p class="text-sm text-gray-700 mt-1">
                            <strong>인원(${p.avgStaff.toFixed(1)}명 → ${d.avgStaff.toFixed(1)}명)</strong>을 더 투입했음에도 <strong>1인당 효율(${p.efficiency.toFixed(2)} → ${d.efficiency.toFixed(2)})</strong>이 <strong class="text-green-600">증가(또는 유지)</strong>되었습니다.
                        </p>
                    </div>
                `;
            }
        }
    });

    if (insightsA === '') {
        // ✅ [수정] 텍스트 변경
        insightsA = `<p class="text-sm text-gray-500">비교(이전 연도/올해) 데이터가 있는 업무가 없어 인원 효율성(수확 체감) 분석을 건너뜁니다.</p>`;
    }
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">A. 투입 인원 효율성 (수확 체감)</h5>${insightsA}</div>`;

    // Part B (Difficulty Comparison)
    let insightsB = '';
    // ✅ [수정]
    const efficiencyTasks = Object.keys(todayAggr.taskSummary)
        .map(taskName => ({ name: taskName, ...todayAggr.taskSummary[taskName] })) 
        .filter(d => d && d.efficiency > 0) 
        .sort((a, b) => b.efficiency - a.efficiency); 

    if (efficiencyTasks.length >= 2) {
        const mostEfficient = efficiencyTasks[0];
        const leastEfficient = efficiencyTasks[efficiencyTasks.length - 1];
        const comparisonFactor = (mostEfficient.efficiency / leastEfficient.efficiency);

        insightsB = `
            <div class="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p class="text-sm text-gray-700">
                    올해 가장 효율이 높았던 업무는 <strong>'${mostEfficient.name}'</strong> (효율: ${mostEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                <p class="text-sm text-gray-700 mt-1">
                    반면, 가장 효율이 낮았던(손이 많이 간) 업무는 <strong>'${leastEfficient.name}'</strong> (효율: ${leastEfficient.efficiency.toFixed(2)}) 입니다.
                </p>
                ${comparisonFactor > 1.1 ? 
                `<p class="text-xs text-gray-600 mt-1">
                    <strong>분석:</strong> '${mostEfficient.name}' 대비 '${leastEfficient.name}' 업무는 약 <strong>${comparisonFactor.toFixed(1)}배</strong> 더 많은 인력/시간이 소요(난이도가 높음)된 것으로 보입니다.
                </p>` : ''}
            </div>
        `;
    } else {
        // ✅ [수정] 텍스트 변경
        insightsB = `<p class="text-sm text-gray-500">업무가 1개만 기록되었거나 효율(처리량/시간/인원) 데이터가 부족하여 난이도 비교를 건너뜁니다.</p>`;
    }
    
    html += `<div><h5 class="font-semibold mb-2 text-gray-600">B. 업무 난이도 비교 (올해 기준)</h5>${insightsB}</div>`;
    
    html += `</div></div>`;

    // 5c. 파트별 요약
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">파트별 요약</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-part">
                    <thead>${createTableRow([
                        { content: '파트', sortKey: 'partName' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '참여 인원 (명)', sortKey: 'members' }
                    ], true, partSort)}</thead>
                    <tbody>
    `;
    const allParts = new Set([...Object.keys(todayAggr.partSummary), ...Object.keys(prevAggr.partSummary)]);
    const sortedParts = Array.from(allParts).sort((a, b) => {
        const d1 = todayAggr.partSummary[a] || { duration: 0, cost: 0, members: new Set() };
        const d2 = prevAggr.partSummary[b] || { duration: 0, cost: 0, members: new Set() };
        let v1, v2;
        if (partSort.key === 'partName') { v1 = a; v2 = b; }
        else if (partSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (partSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (partSort.key === 'members') { v1 = d1.members.size; v2 = d2.members.size; }
        
        if (typeof v1 === 'string') return v1.localeCompare(v2) * (partSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    });
    
    if (sortedParts.length > 0) {
        sortedParts.forEach(part => {
            const d = todayAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            const p = prevAggr.partSummary[part] || { duration: 0, cost: 0, members: new Set() };
            html += createTableRow([
                part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.members.size, diff: getDiffHtmlForMetric('activeMembersCount', d.members.size, p.members.size) }
            ]);
        });
    } else {
        html += `<tr><td colspan="4" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;
    
    // 5d. 인원별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">인원별 상세</h3>
            <div class="overflow-x-auto max-h-[60vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-member">
                    <thead>${createTableRow([
                        { content: '이름', sortKey: 'memberName' },
                        { content: '파트', sortKey: 'part' },
                        { content: '총 업무시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '수행 업무 수', sortKey: 'taskCount' },
                        { content: '수행 업무', sortKey: null } 
                    ], true, memberSort)}</thead>
                    <tbody>
    `;
    const allMembers = new Set([...Object.keys(todayAggr.memberSummary), ...Object.keys(prevAggr.memberSummary)]);
    const sortedMembers = Array.from(allMembers).sort((a, b) => {
        const d1 = todayAggr.memberSummary[a] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(a) || '알바' };
        const d2 = prevAggr.memberSummary[b] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(b) || '알바' };
        let v1, v2;
        if (memberSort.key === 'memberName') { v1 = a; v2 = b; }
        else if (memberSort.key === 'part') { v1 = d1.part; v2 = d2.part; }
        else if (memberSort.key === 'duration') { v1 = d1.duration; v2 = d2.duration; }
        else if (memberSort.key === 'cost') { v1 = d1.cost; v2 = d2.cost; }
        else if (memberSort.key === 'taskCount') { v1 = d1.tasks.size; v2 = d2.tasks.size; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (memberSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (memberSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedMembers.length > 0) {
        sortedMembers.forEach(member => {
            const d = todayAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set(), part: memberToPartMap.get(member) || '알바' };
            const p = prevAggr.memberSummary[member] || { duration: 0, cost: 0, tasks: new Set() };
            const tasksStr = Array.from(d.tasks).join(', ');
            html += createTableRow([
                member,
                d.part,
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p.cost) },
                { content: d.tasks.size, diff: getDiffHtmlForMetric('quantity', d.tasks.size, p.tasks.size) },
                { content: tasksStr, class: "text-xs" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="6" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5e. 업무별 상세
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">업무별 상세 (증감율은 이전 연도 대비)</h3>
            <div class="overflow-x-auto max-h-[70vh]">
                <table class="w-full text-sm text-left text-gray-600" id="report-table-task">
                    <thead>${createTableRow([
                        { content: '업무', sortKey: 'taskName' },
                        { content: '총 시간', sortKey: 'duration' },
                        { content: '총 인건비', sortKey: 'cost' },
                        { content: '총 처리량', sortKey: 'quantity' },
                        { content: '분당 처리량(Avg)', sortKey: 'avgThroughput' },
                        { content: '개당 처리비용(Avg)', sortKey: 'avgCostPerItem' },
                        { content: '총 참여인원', sortKey: 'avgStaff' },
                        { content: '평균 처리시간(건)', sortKey: 'avgTime' },
                        { content: '인당 분당 처리량(효율)', sortKey: 'efficiency', title: '개념: (총 처리량) / (총 시간) / (총 참여인원) \n계산: (분당 처리량) / (총 참여인원) \n*지표가 높을수록 투입 인원 대비 효율이 높음*' }
                    ], true, taskSort)}</thead>
                    <tbody>
    `;
    // ✅ [수정] allTaskNames는 위에서 이미 정의됨
    const sortedTasks = Array.from(allTaskNames).sort((a, b) => {
        const d1 = todayAggr.taskSummary[a] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        const d2 = prevAggr.taskSummary[b] || { duration: 0, cost: 0, members: new Set(), recordCount: 0, quantity: 0, avgThroughput: 0, avgCostPerItem: 0, avgStaff: 0, avgTime: 0, efficiency: 0 };
        let v1, v2;
        if (taskSort.key === 'taskName') { v1 = a; v2 = b; }
        else { v1 = d1[taskSort.key]; v2 = d2[taskSort.key]; }

        if (typeof v1 === 'string') return v1.localeCompare(v2) * (partSort.dir === 'asc' ? 1 : -1);
        return (v1 - v2) * (partSort.dir === 'asc' ? 1 : -1);
    });

    if (sortedTasks.length > 0) {
        sortedTasks.forEach(task => {
            const d = todayAggr.taskSummary[task];
            const p = prevAggr.taskSummary[task] || null; 
            if (!d || (d.duration === 0 && d.quantity === 0)) return;

            html += createTableRow([
                { content: task, class: "font-medium text-gray-900" },
                { content: formatDuration(d.duration), diff: getDiffHtmlForMetric('duration', d.duration, p?.duration) },
                { content: `${Math.round(d.cost).toLocaleString()} 원`, diff: getDiffHtmlForMetric('totalCost', d.cost, p?.cost) },
                { content: d.quantity.toLocaleString(), diff: getDiffHtmlForMetric('quantity', d.quantity, p?.quantity) },
                { content: d.avgThroughput.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.avgThroughput, p?.avgThroughput) },
                { content: `${Math.round(d.avgCostPerItem).toLocaleString()} 원`, diff: getDiffHtmlForMetric('avgCostPerItem', d.avgCostPerItem, p?.avgCostPerItem) },
                { content: d.avgStaff.toLocaleString(), diff: getDiffHtmlForMetric('avgStaff', d.avgStaff, p?.avgStaff) },
                { content: formatDuration(d.avgTime), diff: getDiffHtmlForMetric('avgTime', d.avgTime, p?.avgTime) },
                { content: d.efficiency.toFixed(2), diff: getDiffHtmlForMetric('avgThroughput', d.efficiency, p?.efficiency), class: "font-bold" } 
            ]);
        });
    } else {
        html += `<tr><td colspan="9" class="text-center py-4 text-gray-500">데이터 없음</td></tr>`;
    }
    html += `</tbody></table></div></div>`;

    // 5f. 근태 현황
    html += `
        <div class="bg-white p-4 rounded-lg shadow-sm">
            <h3 class="text-lg font-semibold mb-3 text-gray-700">근태 현황 (연간 총계)</h3>
            <div class="space-y-3 max-h-[60vh] overflow-y-auto">
    `;
    
    const attendanceSummary = (todayData.onLeaveMembers || []).reduce((acc, entry) => {
        const member = entry.member;
        const type = entry.type;
        if (!acc[member]) acc[member] = { member: member, counts: {} };
        if (!acc[member].counts[type]) acc[member].counts[type] = 0;
        
        if (entry.startDate) { 
             acc[member].counts[type] += 1; // '일'
        } else { 
             acc[member].counts[type] += 1; // '회'
        }
        return acc;
    }, {});

    if (Object.keys(attendanceSummary).length === 0) {
         html += `<p class="text-sm text-gray-500 text-center">데이터 없음</p>`;
    } else {
        Object.values(attendanceSummary).sort((a,b) => a.member.localeCompare(b.member)).forEach(item => {
            const typesHtml = Object.entries(item.counts)
                .sort(([typeA], [typeB]) => typeA.localeCompare(typeB))
                .map(([type, count]) => {
                    const unit = (['연차', '출장', '결근'].includes(type)) ? '일' : '회';
                    return `<div class="flex justify-between text-sm text-gray-700 pl-4">
                                <span>${type}</span>
                                <span class="text-right font-medium">${count}${unit}</span>
                            </div>`;
                }).join('');

             html += `
                <div class="border-t pt-2 first:border-t-0">
                    <div class="flex justify-between text-md mb-1">
                        <span class="font-semibold text-gray-900">${item.member}</span>
                    </div>
                    <div class="space-y-0.5">
                        ${typesHtml}
                    </div>
                </div>`;
        });
    }
    html += `</div></div>`;


    html += `</div>`; 
    view.innerHTML = html;
};