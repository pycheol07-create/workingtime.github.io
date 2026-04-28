// === js/history-daily-renderer.js ===
import * as State from './state.js';
import { 
    formatDuration, isWeekday, calcTotalPauseMinutes, formatTimeTo24H, getTodayDateString
} from './utils.js';
import { getDiffHtmlForMetric } from './ui-history-reports-logic.js';

export const renderHistoryDetail = (dateKey, previousDayData = null) => {
    const view = document.getElementById('history-daily-view');
    if (!view) return;
    
    view.innerHTML = '<div class="text-center text-gray-500 py-10">데이터 로딩 중...</div>';

    const data = State.allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-red-500 py-10">해당 날짜의 데이터를 찾을 수 없습니다.</div>';
        return;
    }

    const records = data.workRecords || [];
    const quantities = data.taskQuantities || {};
    const partTimersFromHistory = data.partTimers || [];

    const wageMap = { ...State.appConfig.memberWages };
    partTimersFromHistory.forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });
    
    const attendanceMap = data.dailyAttendance || {};
    const isToday = (dateKey === getTodayDateString());
    
    const systemAccounts = new Set((State.appConfig.systemAccounts || []).map(s => s.trim()));
    let validMemberNames = new Set();

    if (isToday) {
        (State.appConfig.teamGroups || []).forEach(g => {
            g.members.forEach(m => validMemberNames.add(m.trim()));
        });
        (State.appState.partTimers || []).forEach(p => {
            if (p.name) validMemberNames.add(p.name.trim());
        });
    } else {
        (State.appConfig.teamGroups || []).forEach(g => {
            g.members.forEach(m => validMemberNames.add(m.trim()));
        });
        partTimersFromHistory.forEach(p => {
            if (p.name) validMemberNames.add(p.name.trim());
        });
    }

    const clockedInMembers = new Set(
        Object.keys(attendanceMap).filter(rawName => {
            const member = rawName.trim();
            if (!member) return false;
            if (systemAccounts.has(member)) return false;
            if (!validMemberNames.has(member)) return false;
            const status = attendanceMap[rawName].status;
            return status === 'active' || status === 'returned';
        })
    );
    
    if (Object.keys(attendanceMap).length === 0 && records.length > 0) {
         records.forEach(r => {
             const mName = r.member ? r.member.trim() : '';
             if (mName && validMemberNames.has(mName) && !systemAccounts.has(mName)) {
                 clockedInMembers.add(mName);
             }
         });
    }

    const activeMembersCount = clockedInMembers.size;
    const totalSumDuration = records.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
    const totalQuantity = Object.values(quantities).reduce((sum, q) => sum + (Number(q) || 0), 0);

    const taskDurations = records.reduce((acc, rec) => { acc[rec.task] = (acc[rec.task] || 0) + (Number(rec.duration) || 0); return acc; }, {});
    const taskPauses = records.reduce((acc, rec) => {
        acc[rec.task] = (acc[rec.task] || 0) + calcTotalPauseMinutes(rec.pauses);
        return acc;
    }, {});
    const taskCosts = records.reduce((acc, rec) => {
        const wage = wageMap[rec.member] || 0;
        const cost = ((Number(rec.duration) || 0) / 60) * wage;
        acc[rec.task] = (acc[rec.task] || 0) + cost;
        return acc;
    }, {});

    const taskMetrics = {};
    const allTaskKeys = new Set([...Object.keys(taskDurations), ...Object.keys(quantities)]);
    
    allTaskKeys.forEach(task => {
        const duration = taskDurations[task] || 0;
        const cost = taskCosts[task] || 0;
        const qty = Number(quantities[task]) || 0;
        const pauseDuration = taskPauses[task] || 0;

        taskMetrics[task] = {
            duration: duration,
            pauseDuration: pauseDuration,
            cost: cost,
            quantity: qty,
            avgThroughput: duration > 0 ? (qty / duration) : 0,
            avgCostPerItem: qty > 0 ? (cost / qty) : 0
        };
    });

    let prevTaskMetrics = {};
    const currentIndex = State.allHistoryData.findIndex(d => d.id === dateKey);

    allTaskKeys.forEach(task => {
        for (let i = currentIndex + 1; i < State.allHistoryData.length; i++) {
            const recentDay = State.allHistoryData[i];
            if (!recentDay) continue;

            const recentRecords = recentDay.workRecords || [];
            const recentQuantities = recentDay.taskQuantities || {};
            const taskRecords = recentRecords.filter(r => r.task === task);
            const duration = taskRecords.reduce((sum, r) => sum + (Number(r.duration) || 0), 0);
            const qty = Number(recentQuantities[task]) || 0;

            if (duration > 0 || qty > 0) {
                const cost = taskRecords.reduce((sum, r) => {
                    const wage = wageMap[r.member] || 0;
                    return sum + ((Number(r.duration) || 0) / 60) * wage;
                }, 0);
                
                prevTaskMetrics[task] = {
                    date: recentDay.id, 
                    duration: duration,
                    cost: cost,
                    quantity: qty,
                    avgThroughput: duration > 0 ? (qty / duration) : 0,
                    avgCostPerItem: qty > 0 ? (cost / qty) : 0
                };
                break; 
            }
        }
    });

    const avgThroughput = totalSumDuration > 0 ? (totalQuantity / totalSumDuration).toFixed(2) : '0.00';

    let nonWorkHtml = '';
    const standardHoursSettings = State.appConfig.standardDailyWorkHours || { weekday: 8, weekend: 4 };
    const standardHours = isWeekday(dateKey) ? (standardHoursSettings.weekday || 8) : (standardHoursSettings.weekend || 4);

    if (activeMembersCount > 0 || totalSumDuration > 0) {
        const totalPotentialMinutes = activeMembersCount * standardHours * 60;
        const nonWorkMinutes = Math.max(0, totalPotentialMinutes - totalSumDuration);
        const percentage = totalPotentialMinutes > 0 ? (nonWorkMinutes / totalPotentialMinutes * 100).toFixed(1) : 0;
        
        const titleText = isWeekday(dateKey) ? `총 비업무시간` : `총 비업무시간 (주말)`;
        const subText = isWeekday(dateKey) ? `(추정치, ${percentage}%)` : `(주말 ${standardHours}H 기준, ${percentage}%)`;

        nonWorkHtml = `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center flex-1 min-w-[120px] depth-panel transition-colors">
                <h4 class="text-sm font-bold text-gray-500 dark:text-gray-400">${titleText}</h4>
                <p class="text-xl font-extrabold text-gray-800 dark:text-white mt-1">${formatDuration(nonWorkMinutes)}</p>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">${subText}</p>
            </div>`;
    } else {
         const titleText = isWeekday(dateKey) ? '총 비업무시간' : '총 비업무시간 (주말)';
         nonWorkHtml = `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center flex-1 min-w-[120px] flex flex-col justify-center items-center depth-panel transition-colors">
                 <h4 class="text-sm font-bold text-gray-500 dark:text-gray-400">${titleText}</h4>
                 <p class="text-lg font-extrabold text-gray-400 dark:text-gray-500 mt-1">${isWeekday(dateKey) ? '데이터 없음' : '주말 근무 없음'}</p>
            </div>`;
    }

    let html = `
    <div class="mb-6 pb-4 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800 dark:text-white">${dateKey}</h3>
      <div class="flex gap-2">
        <button class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-1.5 px-4 rounded-lg text-sm transition shadow-sm"
                data-action="open-history-quantity-modal" data-date-key="${dateKey}">처리량 수정</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-bold py-1.5 px-4 rounded-lg text-sm transition shadow-sm"
                data-action="request-history-deletion" data-date-key="${dateKey}">삭제</button>
      </div>
    </div>
    
    <div class="flex flex-wrap gap-4 mb-6">
      <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center flex-1 min-w-[120px] depth-panel transition-colors">
        <h4 class="text-sm font-bold text-gray-500 dark:text-gray-400">근무 인원 (출근 기준)</h4> 
        <p class="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">${activeMembersCount} <span class="text-lg text-gray-500">명</span></p>
      </div>
      <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center flex-1 min-w-[120px] depth-panel transition-colors">
        <h4 class="text-sm font-bold text-gray-500 dark:text-gray-400">총합 시간</h4>
        <p class="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">${formatDuration(totalSumDuration)}</p>
      </div>
      ${nonWorkHtml}
      <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center flex-1 min-w-[150px] depth-panel transition-colors">
        <h4 class="text-sm font-bold text-gray-500 dark:text-gray-400">총 처리량</h4>
        <p class="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">${totalQuantity} <span class="text-lg text-gray-500">개</span></p>
      </div>
      <div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm text-center flex-1 min-w-[150px] depth-panel transition-colors">
        <h4 class="text-sm font-bold text-gray-500 dark:text-gray-400">분당 평균 처리량</h4>
        <p class="text-2xl font-extrabold text-gray-800 dark:text-white mt-1">${avgThroughput} <span class="text-lg text-gray-500">개/분</span></p>
      </div>
    </div>
  `;

    html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;

    // 업무별 처리량 카드
    html += `<div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <h4 class="text-lg font-bold mb-4 text-gray-800 dark:text-gray-200">업무별 처리량</h4>
                <div class="space-y-2 max-h-48 overflow-y-auto pr-2">`;
    let hasQuantities = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasQuantities = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('quantity', metrics.quantity, prevMetric?.quantity);
            const dateSpan = prevMetric ? `<span class="text-[10px] text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';

            html += `<div class="flex justify-between items-center text-sm border-b border-gray-100 dark:border-gray-700 pb-2">
                 <span class="font-bold text-gray-700 dark:text-gray-300">${task}</span>
                 <span class="font-medium text-gray-900 dark:text-white">${metrics.quantity} 개 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasQuantities) html += `<p class="text-gray-400 dark:text-gray-500 text-sm text-center py-2">입력된 처리량이 없습니다.</p>`;
    html += `</div></div>`;

    // 업무별 분당 처리량 카드
    html += `<div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <h4 class="text-lg font-bold mb-4 text-gray-800 dark:text-gray-200">업무별 분당 처리량</h4>
                <div class="space-y-2 max-h-48 overflow-y-auto pr-2">`;
    let hasThroughput = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasThroughput = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevMetric?.avgThroughput);
            const dateSpan = prevMetric ? `<span class="text-[10px] text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';
            
            html += `<div class="flex justify-between items-center text-sm border-b border-gray-100 dark:border-gray-700 pb-2">
                 <span class="font-bold text-gray-700 dark:text-gray-300">${task}</span>
                 <span class="font-medium text-gray-900 dark:text-white">${metrics.avgThroughput.toFixed(2)} 개/분 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasThroughput) html += `<p class="text-gray-400 dark:text-gray-500 text-sm text-center py-2">입력된 처리량이 없습니다.</p>`;
    html += `</div></div>`;

    // 업무별 개당 처리비용 카드
    html += `<div class="bg-white dark:bg-gray-800 p-5 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors">
                <h4 class="text-lg font-bold mb-4 text-gray-800 dark:text-gray-200">업무별 개당 처리비용</h4>
                <div class="space-y-2 max-h-48 overflow-y-auto pr-2">`;
    let hasCostPerItem = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasCostPerItem = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevMetric?.avgCostPerItem);
            const dateSpan = prevMetric ? `<span class="text-[10px] text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';

            html += `<div class="flex justify-between items-center text-sm border-b border-gray-100 dark:border-gray-700 pb-2">
                 <span class="font-bold text-gray-700 dark:text-gray-300">${task}</span>
                 <span class="font-medium text-gray-900 dark:text-white">${metrics.avgCostPerItem.toFixed(0)} 원/개 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasCostPerItem) html += `<p class="text-gray-400 dark:text-gray-500 text-sm text-center py-2">처리량이 없어 계산 불가.</p>`;
    html += `</div></div>`;
    html += `</div>`;

    // 하단 업무별 시간 비중 (프로그레스 바)
    html += `<div class="bg-white dark:bg-gray-800 p-6 rounded-2xl border border-gray-100 dark:border-gray-700 shadow-sm depth-panel transition-colors mt-6">
                <div class="flex justify-between items-center mb-5">
                    <h4 class="text-lg font-bold text-gray-800 dark:text-gray-200">업무별 시간 비중</h4>
                    <button class="text-xs bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 text-indigo-600 dark:text-indigo-400 font-bold py-1.5 px-3 rounded-lg transition"
                            data-action="open-record-manager" data-date-key="${dateKey}">
                        기록 관리
                    </button>
                </div>
                <div class="space-y-4">`;
    
    const tasksWithTime = Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.duration > 0)
        .sort(([, a], [, b]) => b.duration - a.duration);

    if (tasksWithTime.length > 0) {
        tasksWithTime.forEach(([task, metrics]) => {
            const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('duration', metrics.duration, prevMetric?.duration);
            const dateSpan = prevMetric ? `<span class="text-[10px] text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';
            const pauseText = metrics.pauseDuration > 0 ? ` <span class="text-[11px] text-gray-400 dark:text-gray-500 ml-2">(휴: ${formatDuration(metrics.pauseDuration)})</span>` : '';

            html += `
            <div>
              <div class="flex justify-between items-center mb-1.5 text-sm">
                <span class="font-bold text-gray-700 dark:text-gray-300">${task}</span>
                <div class="text-gray-800 dark:text-gray-200 font-medium">
                    <span>${formatDuration(metrics.duration)} (${percentage}%) ${diffHtml} ${dateSpan}</span>
                    ${pauseText}
                </div>
              </div>
              <div class="w-full bg-gray-100 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
                <div class="bg-blue-500 h-2.5 rounded-full transition-all" style="width: ${percentage}%"></div>
              </div>
            </div>`;
        });
    } else {
        html += `<p class="text-gray-400 dark:text-gray-500 text-sm text-center py-4">기록된 업무 시간이 없습니다.</p>`;
    }
    html += `</div></div>`;

    view.innerHTML = html;
};