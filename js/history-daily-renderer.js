// === js/history-daily-renderer.js ===
// 설명: 이력 보기의 '일별 상세' 탭 화면을 렌더링하는 모듈입니다.

import * as State from './state.js';
import { 
    formatDuration, isWeekday, calcTotalPauseMinutes, formatTimeTo24H, getTodayDateString
} from './utils.js';
import { getDiffHtmlForMetric } from './ui-history-reports-logic.js';

/**
 * 일별 상세 화면 렌더링 (KPI 카드 및 업무별 진행바 등)
 */
export const renderHistoryDetail = (dateKey, previousDayData = null) => {
    const view = document.getElementById('history-daily-view');
    if (!view) return;
    
    view.innerHTML = '<div class="text-center text-gray-500">데이터 로딩 중...</div>';

    const data = State.allHistoryData.find(d => d.id === dateKey);
    if (!data) {
        view.innerHTML = '<div class="text-center text-red-500">해당 날짜의 데이터를 찾을 수 없습니다.</div>';
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

        nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]">
                        <h4 class="text-sm font-semibold text-gray-500">${titleText}</h4>
                        <p class="text-xl font-bold text-gray-700">${formatDuration(nonWorkMinutes)}</p>
                        <p class="text-xs text-gray-500 mt-1">${subText}</p>
                       </div>`;
    } else {
         const titleText = isWeekday(dateKey) ? '총 비업무시간' : '총 비업무시간 (주말)';
         nonWorkHtml = `<div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px] flex flex-col justify-center items-center">
                         <h4 class="text-sm font-semibold text-gray-500">${titleText}</h4>
                         <p class="text-lg font-bold text-gray-400">${isWeekday(dateKey) ? '데이터 없음' : '주말 근무 없음'}</p>
                        </div>`;
    }

    let html = `
    <div class="mb-6 pb-4 border-b flex justify-between items-center">
      <h3 class="text-2xl font-bold text-gray-800">${dateKey}</h3>
      <div>
        <button class="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-1 px-3 rounded-md text-sm"
                data-action="open-history-quantity-modal" data-date-key="${dateKey}">처리량 수정</button>
        <button class="bg-red-600 hover:bg-red-700 text-white font-semibold py-1 px-3 rounded-md text-sm ml-2"
                data-action="request-history-deletion" data-date-key="${dateKey}">삭제</button>
      </div>
    </div>
    <div class="flex flex-wrap gap-4 mb-6">
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]">
        <h4 class="text-sm font-semibold text-gray-500">근무 인원 (출근 기준)</h4> 
        <p class="text-2xl font-bold text-gray-800">${activeMembersCount} 명</p>
      </div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[120px]"><h4 class="text-sm font-semibold text-gray-500">총합 시간</h4><p class="text-2xl font-bold text-gray-800">${formatDuration(totalSumDuration)}</p></div>
      ${nonWorkHtml}
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">총 처리량</h4><p class="text-2xl font-bold text-gray-800">${totalQuantity} 개</p></div>
      <div class="bg-white p-4 rounded-lg shadow-sm text-center flex-1 min-w-[150px]"><h4 class="text-sm font-semibold text-gray-500">분당 평균 처리량</h4><p class="text-2xl font-bold text-gray-800">${avgThroughput} 개/분</p></div>
    </div>
  `;

    html += `<div class="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">`;

    // 업무별 처리량 카드
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasQuantities = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasQuantities = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('quantity', metrics.quantity, prevMetric?.quantity);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';

            html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.quantity} 개 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasQuantities) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    html += `</div></div>`;

    // 업무별 분당 처리량 카드
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 분당 처리량</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasThroughput = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasThroughput = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgThroughput', metrics.avgThroughput, prevMetric?.avgThroughput);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';
            
            html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgThroughput.toFixed(2)} 개/분 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasThroughput) html += `<p class="text-gray-500 text-sm">입력된 처리량이 없습니다.</p>`;
    html += `</div></div>`;

    // 업무별 개당 처리비용 카드
    html += `<div class="bg-white p-4 rounded-lg shadow-sm"><h4 class="text-lg font-bold mb-3 text-gray-700">업무별 개당 처리비용</h4><div class="space-y-2 max-h-48 overflow-y-auto">`;
    let hasCostPerItem = false;
    Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.quantity > 0)
        .sort(([a], [b]) => a.localeCompare(b))
        .forEach(([task, metrics]) => {
            hasCostPerItem = true;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('avgCostPerItem', metrics.avgCostPerItem, prevMetric?.avgCostPerItem);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';

            html += `<div class="flex justify-between items-center text-sm border-b pb-1">
                 <span class="font-semibold text-gray-600">${task}</span>
                 <span>${metrics.avgCostPerItem.toFixed(0)} 원/개 ${diffHtml} ${dateSpan}</span>
               </div>`;
        });
    if (!hasCostPerItem) html += `<p class="text-gray-500 text-sm">처리량이 없어 계산 불가.</p>`;
    html += `</div></div>`;
    html += `</div>`;

    // 하단 업무별 시간 비중
    html += `<div class="bg-white p-4 rounded-lg shadow-sm">
                <div class="flex justify-between items-center mb-3">
                    <h4 class="text-lg font-bold text-gray-700">업무별 시간 비중</h4>
                    <button class="text-xs bg-indigo-100 hover:bg-indigo-200 text-indigo-700 font-semibold py-1 px-2 rounded transition"
                            data-action="open-record-manager" data-date-key="${dateKey}">
                        기록 관리
                    </button>
                </div>
                <div class="space-y-3">`;
    
    const tasksWithTime = Object.entries(taskMetrics)
        .filter(([, metrics]) => metrics.duration > 0)
        .sort(([, a], [, b]) => b.duration - a.duration);

    if (tasksWithTime.length > 0) {
        tasksWithTime.forEach(([task, metrics]) => {
            const percentage = totalSumDuration > 0 ? (metrics.duration / totalSumDuration * 100).toFixed(1) : 0;
            const prevMetric = prevTaskMetrics[task] || null;
            const diffHtml = getDiffHtmlForMetric('duration', metrics.duration, prevMetric?.duration);
            const dateSpan = prevMetric ? `<span class="text-xs text-gray-400 ml-1" title="비교 대상">${prevMetric.date}</span>` : '';
            const pauseText = metrics.pauseDuration > 0 ? ` <span class="text-xs text-gray-400 ml-2">(휴: ${formatDuration(metrics.pauseDuration)})</span>` : '';

            html += `
            <div>
              <div class="flex justify-between items-center mb-1 text-sm">
                <span class="font-semibold text-gray-600">${task}</span>
                <div>
                    <span>${formatDuration(metrics.duration)} (${percentage}%) ${diffHtml} ${dateSpan}</span>
                    ${pauseText}
                </div>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2.5"><div class="bg-blue-600 h-2.5 rounded-full" style="width: ${percentage}%"></div></div>
            </div>`;
        });
    } else {
        html += `<p class="text-gray-500 text-sm">기록된 업무 시간이 없습니다.</p>`;
    }
    html += `</div></div>`;

    // ✅ [신규] 특이사항(메모) 섹션 추가
    const note = data.dailyNote || '';
    html += `
        <div class="mt-6 bg-white p-4 rounded-lg shadow-sm border border-gray-200">
            <h4 class="text-lg font-bold text-gray-700 mb-2">📝 당일 특이사항</h4>
            <textarea id="history-daily-note-input" class="w-full p-3 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none" rows="3" placeholder="특이사항을 입력하세요...">${note}</textarea>
            <div class="flex justify-end mt-2">
                <button id="history-daily-note-save-btn" data-date-key="${dateKey}" class="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition shadow-md">
                    저장
                </button>
            </div>
        </div>
    `;

    view.innerHTML = html;
};