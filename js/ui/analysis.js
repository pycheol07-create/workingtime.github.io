// === js/ui/analysis.js ===

import { formatDuration, calcElapsedMinutes, getCurrentTime, isWeekday } from '../utils.js';

let trendCharts = {}; // 📈 차트 인스턴스 저장용 (이 파일 내에서만 사용)

// ✅ [수정] appConfig 파라미터 추가 및 로직 변경
export const renderTaskAnalysis = (appState, appConfig) => {
    // ✅ [수정] 렌더링 대상을 #analysis-task-summary-panel로 변경
    const analysisContainer = document.getElementById('analysis-task-summary-panel'); 
    if (!analysisContainer) return;
    analysisContainer.innerHTML = ''; // 이 패널만 초기화
    
    const completedRecords = (appState.workRecords || []).filter(r => r.status === 'completed');
    const totalLoggedMinutes = completedRecords.reduce((sum, record) => sum + (record.duration || 0), 0);

    if (totalLoggedMinutes === 0) {
        analysisContainer.innerHTML = `<div class="text-center text-gray-500 py-4">완료된 업무가 없어 분석을 시작할 수 없습니다.</div>`;
        // ✅ [추가] 개인별 통계 드롭다운도 비워둠
        const memberSelect = document.getElementById('analysis-member-select');
        if (memberSelect) memberSelect.innerHTML = '<option value="">--- 직원/알바 선택 ---</option>';
        return;
    }

    const taskColorsHex = {'채우기':'#3b82f6','국내배송':'#10b981','중국제작':'#8b5cf6','직진배송':'#22c55e','티니':'#ef4444','택배포장':'#f97316','해외배송':'#06b6d4','재고조사':'#d946ef','앵글정리':'#eab308','아이롱':'#6366f1','강성':'#ec4899','상.하차':'#6b7280','2층업무':'#78716c','오류':'#f43f5e','재고찾는시간':'#a855f7','검수':'#14b8a6', '개인담당업무': '#1d4ed8', '상품재작업': '#f59e0b', '매장근무': '#34d399', '출장': '#6b7280'};

    const taskAnalysis = completedRecords.reduce((acc, record) => {
        if (record && record.task) { // record 유효성 검사 추가
            acc[record.task] = (acc[record.task] || 0) + (record.duration || 0);
        }
        return acc;
    }, {});

    const sortedTasks = Object.entries(taskAnalysis).sort(([, a], [, b]) => b - a);

    let gradientParts = [];
    let cumulativePercentage = 0;
    let legendHTML = '<div class="flex-grow">';

    sortedTasks.forEach(([task, minutes]) => {
        const percentage = totalLoggedMinutes > 0 ? (minutes / totalLoggedMinutes) * 100 : 0;
        const color = taskColorsHex[task] || '#6b7280';
        if (percentage > 0) {
            gradientParts.push(`${color} ${cumulativePercentage}% ${cumulativePercentage + percentage}%`);
            cumulativePercentage += percentage;
        }
        legendHTML += `<div class="flex items-center justify-between mb-2"><div class="flex items-center"><span class="w-3 h-3 rounded-full mr-2" style="background-color: ${color};"></span><span class="font-semibold text-gray-700">${task}</span></div><div class="text-right"><div class="text-sm font-semibold text-gray-800">${formatDuration(minutes)}</div><div class="text-xs text-gray-500">${percentage.toFixed(1)}%</div></div></div>`;
    });
    legendHTML += '</div>';

    const finalGradient = `conic-gradient(${gradientParts.join(', ')})`;
    
    // ✅ [추가] 총 휴식 시간 계산
    let totalBreakMinutes = 0;
    completedRecords.forEach(record => {
        (record.pauses || []).forEach(pause => {
            // 'break' 타입이거나, 타입이 없는 구(old) 데이터도 휴식으로 간주
            if (pause.start && pause.end && (pause.type === 'break' || !pause.type)) { 
                const s = new Date(`1970-01-01T${pause.start}:00Z`).getTime();
                const e = new Date(`1970-01-01T${pause.end}:00Z`).getTime();
                if (e > s) {
                    totalBreakMinutes += (e - s) / 60000;
                }
            }
        });
    });
    
    // ✅ [수정] 렌더링 위치 변경 및 '총 휴식' 시간 추가
    analysisContainer.innerHTML = `<div class="flex flex-col md:flex-row items-center gap-6 md:gap-8">
        <div class="flex-shrink-0">
            <div class="chart" style="background: ${finalGradient};">
                <div class="chart-center">
                    <span class="text-sm text-gray-500">총 업무</span>
                    <span class="text-xl font-bold text-blue-600">${formatDuration(totalLoggedMinutes)}</span>
                    <span class="text-xs text-gray-500 mt-1">총 휴식: ${formatDuration(Math.round(totalBreakMinutes))}</span>
                </div>
            </div>
        </div>
        ${legendHTML}
    </div>`;


    // ✅ [추가] 개인별 통계 드롭다운 채우기
    const memberSelect = document.getElementById('analysis-member-select');
    if (memberSelect) {
        const staff = (appConfig.teamGroups || []).flatMap(g => g.members);
        const partTimers = (appState.partTimers || []).map(p => p.name);
        
        const allMembers = [...new Set([...staff, ...partTimers])].sort((a, b) => a.localeCompare(b));
        
        let optionsHtml = '<option value="">--- 직원/알바 선택 ---</option>';
        allMembers.forEach(member => {
            optionsHtml += `<option value="${member}">${member}</option>`;
        });
        memberSelect.innerHTML = optionsHtml;
    }
};

/**
 * ✅ [수정] 개인별 통계 렌더링 함수 (총 비업무 시간 계산 로직 변경)
 */
export const renderPersonalAnalysis = (selectedMember, appState) => {
    const container = document.getElementById('analysis-personal-stats-container');
    if (!container) return;

    if (!selectedMember) {
        container.innerHTML = `<p class="text-center text-gray-500">통계를 보려면 위에서 직원을 선택하세요.</p>`;
        return;
    }

    // 1. 선택된 직원의 모든 기록 (완료, 진행, 휴식)
    const memberRecords = (appState.workRecords || []).filter(
        r => r.member === selectedMember
    );

    if (memberRecords.length === 0) {
        container.innerHTML = `<p class="text-center text-gray-500">${selectedMember} 님은 오늘 업무 기록이 없습니다.</p>`;
        return;
    }

    const now = getCurrentTime(); // 실시간 계산을 위한 현재 시간

    // 2. 현재 상태 파악 (변경 없음)
    const ongoingRecord = memberRecords.find(r => r.status === 'ongoing');
    const pausedRecord = memberRecords.find(r => r.status === 'paused');
    let currentStatusHtml = '';

    if (ongoingRecord) {
        currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-red-600">업무 중: ${ongoingRecord.task}</span>`;
    } else if (pausedRecord) {
        currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-yellow-600">휴식 중</span>`;
    } else {
        // [수정] 근태 상태 확인 로직 추가 (renderRealtimeStatus와 유사)
        const combinedOnLeaveMembers = [
            ...(appState.dailyOnLeaveMembers || []),
            ...(appState.dateBasedOnLeaveMembers || [])
        ];
        const leaveInfo = combinedOnLeaveMembers.find(m => m.member === selectedMember && !(m.type === '외출' && m.endTime));
        
        if (leaveInfo) {
            currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-gray-600">${leaveInfo.type} 중</span>`;
        } else {
            currentStatusHtml = `<span class="ml-2 text-sm font-semibold text-green-600">대기 중</span>`;
        }
    }
    // (현재 상태 로직 끝)

    // 3. 총 업무 시간 계산 (실시간 반영 - 변경 없음)
    const taskTimes = memberRecords.reduce((acc, r) => {
        let duration = 0;
        if (r.status === 'completed') {
            duration = r.duration || 0;
        } else if (r.status === 'ongoing' || r.status === 'paused') {
            // ✅ [수정] calcElapsedMinutes가 utils.js에서 import됨
            duration = calcElapsedMinutes(r.startTime, now, r.pauses);
        }
        acc[r.task] = (acc[r.task] || 0) + duration;
        return acc;
    }, {});
    const sortedTasks = Object.entries(taskTimes).sort(([, a], [, b]) => b - a);
    const totalLiveMinutes = sortedTasks.reduce((sum, [, minutes]) => sum + minutes, 0);


    // ✅ [수정] 총 비업무 시간 계산 로직
    let firstStartTime = null;
    let lastEffectiveEndTime = null;

    memberRecords.forEach(r => {
        if (r.startTime && (!firstStartTime || r.startTime < firstStartTime)) {
            firstStartTime = r.startTime;
        }
        if (r.status === 'completed' && r.endTime) {
            if (!lastEffectiveEndTime || r.endTime > lastEffectiveEndTime) {
                lastEffectiveEndTime = r.endTime;
            }
        }
    });

    // 진행 중이거나 휴식 중인 기록이 있으면, 마지막 시간은 'now'
    if (ongoingRecord || pausedRecord) {
        lastEffectiveEndTime = now;
    }

    let totalTimeSpanMinutes = 0;
    if (firstStartTime && lastEffectiveEndTime) {
        // 첫 업무 시작부터 마지막 활동 시간까지의 총 시간(분) 계산
        // ✅ [수정] calcElapsedMinutes가 utils.js에서 import됨
        totalTimeSpanMinutes = calcElapsedMinutes(firstStartTime, lastEffectiveEndTime, []); 
    }

    // 총 비업무 시간 = (총 시간) - (총 업무 시간)
    const totalNonWorkMinutes = Math.max(0, totalTimeSpanMinutes - totalLiveMinutes);
    // ✅ [수정 끝]


    // 5. HTML 렌더링 (텍스트 및 변수명 변경)
    let html = `
        <h4 class="text-lg font-bold text-gray-800 mb-3">${selectedMember} 님 요약</h4>
        <div class="grid grid-cols-3 gap-4 mb-4 text-center">
            <div class="bg-gray-50 p-2 rounded-lg">
                <div class="text-xs text-gray-500">현재 상태</div>
                <div class="text-sm font-bold">${currentStatusHtml}</div>
            </div>
            <div class="bg-gray-50 p-2 rounded-lg">
                <div class="text-xs text-gray-500">총 업무 시간 (실시간)</div>
                <div class="text-lg font-bold text-blue-600">${formatDuration(totalLiveMinutes)}</div>
            </div>
             <div class="bg-gray-50 p-2 rounded-lg">
                
                <div class="text-xs text-gray-500">총 비업무 시간 (추정)</div>
                
                <div class="text-lg font-bold text-gray-700">${formatDuration(Math.round(totalNonWorkMinutes))}</div>
            </div>
        </div>

        <div>
            <h5 class="text-md font-semibold text-gray-700 mb-2">오늘 수행한 업무 (전체)</h5>
            <ul class="space-y-1 max-h-40 overflow-y-auto">
    `;

    if (sortedTasks.length > 0) {
        sortedTasks.forEach(([task, minutes]) => {
            if (minutes > 0) { // 0분 이상인 것만 표시
                html += `
                    <li class="text-sm flex justify-between p-1 rounded hover:bg-gray-50">
                        <span class="font-semibold">${task}</span>
                        <span class="text-gray-600">${formatDuration(minutes)}</span>
                    </li>
                `;
            }
        });
    } else {
        html += `<li class="text-sm text-gray-500">데이터 없음</li>`;
    }

    html += `
            </ul>
        </div>
    `;

    container.innerHTML = html;
};


/**
 * [추가] 트렌드 분석용 일일 KPI 계산 헬퍼
 * (renderHistoryDetail의 계산 로직을 재사용 및 요약)
 */
function calculateDailyKPIs(dayData, appConfig) {
    const records = dayData.workRecords || [];
    const quantities = dayData.taskQuantities || {};
    const onLeaveMemberEntries = dayData.onLeaveMembers || [];
    const partTimersFromHistory = dayData.partTimers || [];

    // 1. WageMap 생성 (appConfig + 이력의 알바 정보)
    const wageMap = { ...(appConfig.memberWages || {}) };
    partTimersFromHistory.forEach(pt => {
        if (pt && pt.name && !wageMap[pt.name]) {
            wageMap[pt.name] = pt.wage || 0;
        }
    });

    // 2. 총 시간, 총 비용, 총 수량
    const totalDuration = records.reduce((s, r) => s + (r.duration || 0), 0);
    const totalQuantity = Object.values(quantities).reduce((s, q) => s + (Number(q) || 0), 0);
    const totalCost = records.reduce((s, r) => {
        const wage = wageMap[r.member] || 0;
        return s + ((r.duration || 0) / 60) * wage;
    }, 0);

    // 3. KPI: 처리량, 비용
    const throughput = totalDuration > 0 ? (totalQuantity / totalDuration) : 0;
    const costPerItem = totalQuantity > 0 ? (totalCost / totalQuantity) : 0;

    // 4. KPI: 비업무시간 (renderHistoryDetail 로직 재사용)
    let nonWorkTime = 0;
    // ✅ [수정] isWeekday가 utils.js에서 import됨
    if (isWeekday(dayData.id)) {
        const allRegularMembers = new Set((appConfig.teamGroups || []).flatMap(g => g.members));
        const onLeaveMemberNames = onLeaveMemberEntries.map(entry => entry.member);
        
        const activeRegularMembers = allRegularMembers.size - onLeaveMemberNames.filter(name => allRegularMembers.has(name)).length;
        const activePartTimers = partTimersFromHistory.length - onLeaveMemberNames.filter(name => partTimersFromHistory.some(pt => pt.name === name)).length;
        const activeMembersCount = activeRegularMembers + activePartTimers;

        const totalPotentialMinutes = activeMembersCount * 8 * 60; // 8시간(480분) 기준
        nonWorkTime = Math.max(0, totalPotentialMinutes - totalDuration);
    }

    return {
        throughput: parseFloat(throughput.toFixed(2)),
        costPerItem: parseFloat(costPerItem.toFixed(0)),
        nonWorkTime: parseFloat(nonWorkTime.toFixed(0))
    };
}

/**
 * [추가] 📈 트렌드 분석 탭의 차트를 렌더링합니다.
 */
export const renderTrendAnalysisCharts = (allHistoryData, appConfig) => {
    try {
        // 1. 기존 차트가 있다면 파괴 (메모리 누수 방지)
        Object.values(trendCharts).forEach(chart => chart.destroy());
        trendCharts = {};

        // 2. 데이터 준비 (최근 30일)
        const dataSlice = allHistoryData.slice(0, 30).reverse(); // 30일치, 시간순 (오래된 -> 최신)

        const throughputCtx = document.getElementById('kpi-chart-throughput');
        const costCtx = document.getElementById('kpi-chart-cost');
        const nonWorkCtx = document.getElementById('kpi-chart-nonwork');
        
        // 캔버스가 없으면 종료
        if (!throughputCtx || !costCtx || !nonWorkCtx) {
             console.warn("트렌드 분석: 차트 캔버스를 찾을 수 없습니다.");
             return;
        }

        if (dataSlice.length === 0) {
            // 데이터가 없을 때의 처리
            console.warn("트렌드 분석: 표시할 데이터가 없습니다.");
            [throughputCtx, costCtx, nonWorkCtx].forEach(ctx => {
                if (!ctx) return; // 혹시 모를 null 체크
                const context = ctx.getContext('2d');
                context.clearRect(0, 0, ctx.width, ctx.height);
                context.font = "16px 'Noto Sans KR'";
                context.fillStyle = "#9ca3af";
                context.textAlign = "center";
                context.fillText("표시할 데이터가 없습니다.", ctx.width / 2, ctx.height / 2);
            });
            return;
        }

        const labels = [];
        const throughputData = [];
        const costData = [];
        const nonWorkData = [];

        // 3. KPI 데이터 추출
        dataSlice.forEach(dayData => {
            labels.push(dayData.id.substring(5)); // 'MM-DD'
            const kpis = calculateDailyKPIs(dayData, appConfig);
            throughputData.push(kpis.throughput);
            costData.push(kpis.costPerItem);
            nonWorkData.push(kpis.nonWorkTime);
        });

        // 4. 차트 생성 (Chart.js 라이브러리가 HTML에 로드되어 있어야 함)
        const chartOptions = (titleText) => ({
            responsive: true,
            maintainAspectRatio: false, // 캔버스 크기에 맞춤
            plugins: {
                legend: { display: false },
                title: { display: false, text: titleText }, // (캔버스 위 h4 태그가 제목 역할)
                tooltip: {
                    mode: 'index',
                    intersect: false,
                }
            },
            scales: {
                y: { 
                    beginAtZero: true,
                    ticks: {
                        font: { size: 10 }
                    }
                },
                x: {
                    ticks: {
                        font: { size: 10 }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
        });

        if (throughputCtx) {
            trendCharts.throughput = new Chart(throughputCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '분당 처리량',
                        data: throughputData,
                        borderColor: 'rgb(54, 162, 235)',
                        backgroundColor: 'rgba(54, 162, 235, 0.1)',
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: chartOptions('분당 평균 처리량 (개/분)')
            });
        }

        if (costCtx) {
            trendCharts.cost = new Chart(costCtx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '개당 처리비용',
                        data: costData,
                        borderColor: 'rgb(255, 99, 132)',
                        backgroundColor: 'rgba(255, 99, 132, 0.1)',
                        fill: true,
                        tension: 0.1
                    }]
                },
                options: chartOptions('개당 평균 처리비용 (원/개)')
            });
        }

        if (nonWorkCtx) {
            trendCharts.nonWork = new Chart(nonWorkCtx, {
                type: 'bar', // 비업무시간은 바로
                data: {
                    labels: labels,
                    datasets: [{
                        label: '총 비업무시간',
                        data: nonWorkData,
                        backgroundColor: 'rgba(75, 192, 192, 0.6)'
                    }]
                },
                options: chartOptions('총 비업무시간 (분)')
            });
        }
    } catch (e) {
        console.error("트렌드 차트 렌더링 실패:", e);
        // 오류 발생 시 캔버스 영역을 비우거나 오류 메시지 표시
    }
};