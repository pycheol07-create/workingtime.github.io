// === js/ui-history-personal.js ===
// 설명: '개인 리포트' 탭의 데이터 집계 및 렌더링 로직을 담당합니다.

import { formatDuration, getWeekOfYear, formatTimeTo24H, calculateDateDifference, isWeekday } from './utils.js';
import { appConfig } from './state.js';

/**
 * 1. 데이터 필터링 및 집계 함수
 */
const aggregatePersonalData = (allHistoryData, viewMode, dateKey, memberName) => {
    // 1. 기간에 맞는 데이터 필터링
    const filteredDays = allHistoryData.filter(day => {
        if (!day.id) return false;
        if (viewMode === 'personal-daily') return day.id === dateKey;
        if (viewMode === 'personal-weekly') return getWeekOfYear(new Date(day.id)) === dateKey;
        if (viewMode === 'personal-monthly') return day.id.startsWith(dateKey);
        if (viewMode === 'personal-yearly') return day.id.startsWith(dateKey);
        return false;
    });

    // 2. 초기화
    const stats = {
        totalWorkMinutes: 0,
        totalWageCost: 0,
        workDaysCount: 0,
        taskStats: {}, // { taskName: { count, duration, cost } }
        attendanceCounts: { '지각': 0, '조퇴': 0, '외출': 0, '결근': 0, '연차': 0, '출장': 0 },
        attendanceLogs: [], // { date, type, detail }
        dailyLogs: [] // { date, workTime, mainTask, attendanceStatus }
    };

    // 시급 정보 가져오기 (설정 또는 이력에서 찾기)
    let wage = appConfig.memberWages?.[memberName] || 0;
    // 알바의 경우 이력에서 시급을 찾을 수도 있음 (가장 최근 데이터 기준)
    if (wage === 0) {
        for (let i = filteredDays.length - 1; i >= 0; i--) {
            const pt = (filteredDays[i].partTimers || []).find(p => p.name === memberName);
            if (pt && pt.wage) {
                wage = pt.wage;
                break;
            }
        }
        if (wage === 0) wage = appConfig.defaultPartTimerWage || 10000;
    }

    // 3. 일별 데이터 순회하며 집계
    filteredDays.sort((a, b) => a.id.localeCompare(b.id)).forEach(day => {
        const date = day.id;
        let dayWorkMinutes = 0;
        const dayTasks = {};
        let dayAttendanceStatus = [];

        // A. 업무 기록 집계
        const myRecords = (day.workRecords || []).filter(r => r.member === memberName);
        if (myRecords.length > 0) {
            stats.workDaysCount++;
            myRecords.forEach(r => {
                const duration = Number(r.duration) || 0;
                const cost = (duration / 60) * wage;
                
                dayWorkMinutes += duration;
                stats.totalWorkMinutes += duration;
                stats.totalWageCost += cost;

                if (!stats.taskStats[r.task]) {
                    stats.taskStats[r.task] = { count: 0, duration: 0, cost: 0 };
                }
                stats.taskStats[r.task].count++;
                stats.taskStats[r.task].duration += duration;
                stats.taskStats[r.task].cost += cost;

                // 일별 로그용 (가장 많이 한 업무 찾기 위해)
                dayTasks[r.task] = (dayTasks[r.task] || 0) + duration;
            });
        }

        // B. 근태 기록 집계
        const myLeaves = (day.onLeaveMembers || []).filter(l => l.member === memberName);
        myLeaves.forEach(leave => {
            const type = leave.type;
            if (stats.attendanceCounts.hasOwnProperty(type)) {
                stats.attendanceCounts[type]++;
            } else if (type) {
                stats.attendanceCounts[type] = (stats.attendanceCounts[type] || 0) + 1;
            }

            // 상세 로그용 텍스트 생성
            let detail = '';
            if (leave.startTime) {
                detail = formatTimeTo24H(leave.startTime);
                if (leave.endTime) detail += ` ~ ${formatTimeTo24H(leave.endTime)}`;
                else if (type === '외출') detail += ' ~';
            } else if (leave.startDate) {
                detail = `${leave.startDate}`;
                if (leave.endDate && leave.endDate !== leave.startDate) detail += ` ~ ${leave.endDate}`;
            }
            
            stats.attendanceLogs.push({ date, type, detail });
            dayAttendanceStatus.push(type);
        });

        // C. 일별 로그 생성 (주/월/연간 뷰용)
        let mainTask = '-';
        let maxDuration = -1;
        Object.entries(dayTasks).forEach(([t, d]) => {
            if (d > maxDuration) {
                maxDuration = d;
                mainTask = t;
            }
        });

        stats.dailyLogs.push({
            date: date,
            workTime: dayWorkMinutes,
            mainTask: mainTask !== '-' ? `${mainTask} 외` : '-', // 주 업무 표시
            attendance: dayAttendanceStatus.length > 0 ? dayAttendanceStatus.join(', ') : (dayWorkMinutes > 0 ? '정상근무' : '-')
        });
    });

    return { stats, filteredDays, wage };
};

/**
 * 2. 메인 렌더링 함수
 */
export const renderPersonalReport = (targetId, viewMode, dateKey, memberName, allHistoryData) => {
    const container = document.getElementById(targetId);
    if (!container) return;

    if (!memberName) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10 flex flex-col items-center justify-center h-full">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-gray-300 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <p>분석할 직원을 선택해주세요.</p>
        </div>`;
        return;
    }

    if (!dateKey) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">날짜를 선택해주세요.</div>`;
        return;
    }

    container.innerHTML = '<div class="text-center text-gray-500 py-10">데이터 분석 중...</div>';

    // 데이터 집계 실행
    const { stats, filteredDays, wage } = aggregatePersonalData(allHistoryData, viewMode, dateKey, memberName);

    if (filteredDays.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-500 py-10">
            <p class="text-lg font-bold text-gray-700 mb-1">${memberName}님</p>
            <p>해당 기간(${dateKey})에 기록된 데이터가 없습니다.</p>
        </div>`;
        return;
    }

    // --- HTML 생성 ---
    let html = `<div class="space-y-6 animate-fade-in">`;

    // 1. 상단 요약 카드
    html += `
        <div class="flex flex-col md:flex-row justify-between items-center mb-2">
            <h3 class="text-xl font-bold text-gray-800">
                <span class="text-blue-600">${memberName}</span>님의 ${dateKey} 리포트
            </h3>
            <span class="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">적용 시급: ${wage.toLocaleString()}원</span>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">총 근무일</div>
                <div class="text-2xl font-extrabold text-gray-800">${stats.workDaysCount}일</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">총 업무 시간</div>
                <div class="text-2xl font-extrabold text-blue-600">${formatDuration(stats.totalWorkMinutes)}</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-blue-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">예상 급여 (세전)</div>
                <div class="text-2xl font-extrabold text-gray-800">${Math.round(stats.totalWageCost).toLocaleString()}원</div>
            </div>
            <div class="bg-white p-4 rounded-xl border border-red-100 shadow-sm text-center">
                <div class="text-xs text-gray-500 mb-1">특이 근태</div>
                <div class="text-sm font-semibold text-gray-700">
                    ${Object.entries(stats.attendanceCounts)
                        .filter(([, cnt]) => cnt > 0)
                        .map(([type, cnt]) => `<span class="${type === '지각' || type === '결근' ? 'text-red-600' : 'text-gray-700'}">${type} ${cnt}</span>`)
                        .join(', ') || '<span class="text-gray-400">없음</span>'}
                </div>
            </div>
        </div>
    `;

    // 2. 업무별 상세 통계 (Task Breakdown)
    const sortedTasks = Object.entries(stats.taskStats).sort(([, a], [, b]) => b.duration - a.duration);
    
    html += `
        <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
            <h4 class="text-lg font-bold text-gray-800 mb-4">📊 업무별 수행 내역</h4>
            <div class="overflow-x-auto">
                <table class="w-full text-sm text-left text-gray-600">
                    <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                        <tr>
                            <th class="px-4 py-3">업무명</th>
                            <th class="px-4 py-3 text-right">수행 횟수</th>
                            <th class="px-4 py-3 text-right">총 소요 시간</th>
                            <th class="px-4 py-3 text-right">비중</th>
                            <th class="px-4 py-3 text-right">평균 시간/건</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100">
    `;

    if (sortedTasks.length === 0) {
        html += `<tr><td colspan="5" class="px-4 py-4 text-center text-gray-400">수행한 업무가 없습니다.</td></tr>`;
    } else {
        sortedTasks.forEach(([task, data]) => {
            const percent = stats.totalWorkMinutes > 0 ? (data.duration / stats.totalWorkMinutes) * 100 : 0;
            const avgTime = data.count > 0 ? data.duration / data.count : 0;
            
            html += `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 font-medium text-gray-900">${task}</td>
                    <td class="px-4 py-3 text-right">${data.count}회</td>
                    <td class="px-4 py-3 text-right font-bold text-blue-600">${formatDuration(data.duration)}</td>
                    <td class="px-4 py-3 text-right">
                        <div class="flex items-center justify-end gap-2">
                            <span class="text-xs text-gray-500">${percent.toFixed(1)}%</span>
                            <div class="w-16 bg-gray-200 rounded-full h-1.5">
                                <div class="bg-blue-500 h-1.5 rounded-full" style="width: ${percent}%"></div>
                            </div>
                        </div>
                    </td>
                    <td class="px-4 py-3 text-right text-gray-500">${formatDuration(avgTime)}</td>
                </tr>
            `;
        });
    }
    html += `</tbody></table></div></div>`;

    // 3. 근태 상세 로그 (Attendance Logs) - 기록이 있을 때만 표시
    if (stats.attendanceLogs.length > 0) {
        html += `
            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                <h4 class="text-lg font-bold text-gray-800 mb-4">📅 근태 상세 기록</h4>
                <div class="overflow-x-auto max-h-60">
                    <table class="w-full text-sm text-left text-gray-600">
                        <thead class="text-xs text-gray-700 uppercase bg-red-50 border-b border-red-100">
                            <tr>
                                <th class="px-4 py-2">날짜</th>
                                <th class="px-4 py-2">유형</th>
                                <th class="px-4 py-2">상세 시간/기간</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${stats.attendanceLogs.map(log => `
                                <tr class="hover:bg-red-50">
                                    <td class="px-4 py-2 font-medium">${log.date}</td>
                                    <td class="px-4 py-2">
                                        <span class="px-2 py-0.5 rounded text-xs font-bold ${log.type === '지각' || log.type === '결근' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-700'}">
                                            ${log.type}
                                        </span>
                                    </td>
                                    <td class="px-4 py-2 text-gray-500">${log.detail}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    // 4. 일자별 업무 요약 (Daily Log) - 일별 뷰가 아닐 때만 표시
    if (viewMode !== 'personal-daily') {
        html += `
            <div class="bg-white p-5 rounded-lg shadow-sm border border-gray-200">
                <h4 class="text-lg font-bold text-gray-800 mb-4">🗓️ 일자별 활동 요약</h4>
                <div class="overflow-x-auto max-h-96">
                    <table class="w-full text-sm text-left text-gray-600">
                        <thead class="text-xs text-gray-700 uppercase bg-gray-100 border-b sticky top-0">
                            <tr>
                                <th class="px-4 py-3">날짜</th>
                                <th class="px-4 py-3">근태 상태</th>
                                <th class="px-4 py-3">주요 업무</th>
                                <th class="px-4 py-3 text-right">총 근무 시간</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-gray-100">
                            ${stats.dailyLogs.map(log => `
                                <tr class="hover:bg-gray-50">
                                    <td class="px-4 py-3 font-medium text-gray-900">${log.date} (${getDayOfWeek(log.date)})</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2 py-1 rounded text-xs ${log.attendance === '정상근무' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-800'}">
                                            ${log.attendance}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-gray-600">${log.mainTask}</td>
                                    <td class="px-4 py-3 text-right font-bold text-blue-600">${formatDuration(log.workTime)}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }

    html += `</div>`;
    container.innerHTML = html;
};

// 요일 구하기 헬퍼
function getDayOfWeek(dateStr) {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    return days[new Date(dateStr).getDay()];
}