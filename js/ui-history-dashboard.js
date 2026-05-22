// === js/ui-history-dashboard.js ===
import * as State from './state.js';

let dashboardChartInstance = null;

export function renderDashboardTab(filteredData, appConfig) {
    if (!filteredData || filteredData.length === 0) {
        document.getElementById('ai-dashboard-comment').textContent = "조회된 기간에 이력 데이터가 없습니다.";
        document.getElementById('kpi-total-time').innerHTML = `0<span class="text-lg font-medium text-gray-500 ml-1">시간</span>`;
        document.getElementById('kpi-total-cost').innerHTML = `0<span class="text-lg font-medium text-gray-500 ml-1">원</span>`;
        document.getElementById('kpi-avg-uph').innerHTML = `0.0<span class="text-lg font-medium text-blue-400 ml-1">개/시</span>`;
        document.getElementById('kpi-total-oee').innerHTML = `0<span class="text-lg font-medium text-green-400 ml-1">%</span>`;
        if (dashboardChartInstance) dashboardChartInstance.destroy();
        return;
    }

    // 1. 데이터 집계 계산
    let totalDurationMin = 0;
    let totalCost = 0;
    let totalQty = 0;
    const trendLabels = [];
    const uphTrendData = [];
    const timeTrendData = [];

    // 시급 맵(Wage Map) 구성
    const wageMap = { ...(appConfig.memberWages || {}) };

    // 날짜 오름차순(과거->최신) 정렬 후 계산
    const sortedData = [...filteredData].sort((a, b) => a.id.localeCompare(b.id));

    sortedData.forEach(day => {
        const dateStr = day.id.substring(5); // 'MM-DD'
        trendLabels.push(dateStr);
        
        let dayDuration = 0;
        let dayCost = 0;
        let dayQty = 0;

        // 하루 총 근무시간 및 비용 합산
        (day.workRecords || []).forEach(r => {
            dayDuration += (r.duration || 0);
            const wage = wageMap[r.member] || 0;
            dayCost += ((r.duration || 0) / 60) * wage;
        });

        // 하루 총 처리량 합산
        Object.values(day.taskQuantities || {}).forEach(q => {
            dayQty += (Number(q) || 0);
        });

        totalDurationMin += dayDuration;
        totalCost += dayCost;
        totalQty += dayQty;

        // 해당 일자의 UPH (분당 개수 * 60)
        const dayUph = dayDuration > 0 ? (dayQty / (dayDuration / 60)) : 0;
        uphTrendData.push(parseFloat(dayUph.toFixed(1)));
        timeTrendData.push(parseFloat((dayDuration / 60).toFixed(1)));
    });

    const totalHours = totalDurationMin / 60;
    const avgUph = totalHours > 0 ? (totalQty / totalHours) : 0;
    
    // 임시 OEE 계산 로직 (수량과 목표 UPH 기반으로 추정, 향후 고도화 가능)
    const TARGET_UPH = 200; // 기준이 되는 표준 생산성
    const oee = Math.min(100, Math.max(0, (avgUph / TARGET_UPH) * 100)); 

    // 2. 대시보드 KPI 카드 업데이트
    document.getElementById('kpi-total-time').innerHTML = `${Math.round(totalHours).toLocaleString()}<span class="text-lg font-medium text-gray-500 ml-1">시간</span>`;
    document.getElementById('kpi-total-cost').innerHTML = `${Math.round(totalCost).toLocaleString()}<span class="text-lg font-medium text-gray-500 ml-1">원</span>`;
    document.getElementById('kpi-avg-uph').innerHTML = `${avgUph.toFixed(1)}<span class="text-lg font-medium text-blue-400 ml-1">개/시</span>`;
    document.getElementById('kpi-total-oee').innerHTML = `${oee.toFixed(1)}<span class="text-lg font-medium text-green-400 ml-1">%</span>`;

    // 3. AI 현황 진단 코멘트 업데이트
    const aiCommentEl = document.getElementById('ai-dashboard-comment');
    if (oee < 60) {
        aiCommentEl.innerHTML = `⚠️ <strong class="text-red-600">생산 효율 경고:</strong> 기준치 대비 생산성이 저하되었습니다. 병목 구간 확인이 필요합니다.`;
    } else if (oee >= 90) {
        aiCommentEl.innerHTML = `🔥 <strong class="text-blue-600">최상 컨디션:</strong> 목표치를 초과 달성 중입니다. 훌륭한 팀워크입니다!`;
    } else {
        aiCommentEl.innerHTML = `✅ <strong class="text-green-600">안정적 운영:</strong> 전반적으로 안정적인 처리 속도를 유지하고 있습니다.`;
    }

    // 4. Chart.js 추세 그래프 그리기
    const ctx = document.getElementById('chart-dashboard-trend');
    if (!ctx) return;
    
    if (dashboardChartInstance) {
        dashboardChartInstance.destroy(); // 기존 그래프 삭제 후 다시 그림 (중복 렌더링 방지)
    }

    dashboardChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: trendLabels,
            datasets: [
                {
                    label: '종합 UPH (생산성)',
                    data: uphTrendData,
                    borderColor: '#2563eb', // blue-600
                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                    type: 'line',
                    fill: true,
                    tension: 0.3,
                    yAxisID: 'y'
                },
                {
                    label: '투입 인력 시간 (Hours)',
                    data: timeTrendData,
                    backgroundColor: '#cbd5e1', // slate-300
                    type: 'bar',
                    borderRadius: 4,
                    yAxisID: 'y1'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'top', labels: { usePointStyle: true, font: { family: "'Inter', sans-serif", weight: 'bold' } } }
            },
            scales: {
                y: { 
                    type: 'linear', display: true, position: 'left', 
                    title: { display: true, text: 'UPH (개/시간)', color: '#2563eb', font: { weight: 'bold' } },
                    grid: { borderDash: [5, 5] }
                },
                y1: { 
                    type: 'linear', display: true, position: 'right', 
                    title: { display: true, text: '시간(h)', color: '#64748b', font: { weight: 'bold' } },
                    grid: { drawOnChartArea: false } 
                }
            }
        }
    });
}