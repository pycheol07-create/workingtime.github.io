// === js/ui-history-prediction.js ===
// 설명: '실적 예측' 탭의 UI 렌더링 및 차트 제어를 담당합니다.

import { predictFutureTrends } from './analysis-logic.js';

const predictionCharts = {
    revenue: null,
    delivery: null
};

export const renderPredictionTab = (historyData, daysToPredict = 14) => {
    const revenueCtx = document.getElementById('chart-prediction-revenue');
    const deliveryCtx = document.getElementById('chart-prediction-delivery');

    if (!revenueCtx || !deliveryCtx) return;

    const selectEl = document.getElementById('prediction-days-select');
    if (selectEl) {
        daysToPredict = parseInt(selectEl.value, 10);
    }

    const result = predictFutureTrends(historyData, daysToPredict);

    if (!result) {
        renderNoData(revenueCtx, "데이터가 부족하여 예측할 수 없습니다.");
        renderNoData(deliveryCtx, "데이터가 부족하여 예측할 수 없습니다.");
        updateKPICards(null, null, daysToPredict);
        return;
    }

    const { historical, prediction, trend } = result;

    const splitIndex = historical.labels.length;
    const allLabels = [...historical.labels, ...prediction.labels];

    renderChart('revenue', revenueCtx, allLabels, historical.revenue, prediction.revenue, splitIndex, '매출 (원)', 'rgb(79, 70, 229)'); 
    renderChart('delivery', deliveryCtx, allLabels, historical.delivery, prediction.delivery, splitIndex, '배송량 (건)', 'rgb(16, 185, 129)'); 

    updateKPICards(prediction, trend, daysToPredict);

    if (selectEl && !selectEl.dataset.listenerAttached) {
        selectEl.dataset.listenerAttached = 'true';
        selectEl.addEventListener('change', () => {
            renderPredictionTab(historyData); 
        });
    }
};

const updateKPICards = (prediction, trend, daysToPredict) => {
    // Today Monitoring UI
    const elTodayEstRev = document.getElementById('pred-today-est-rev');
    const elTodayActRev = document.getElementById('pred-today-act-rev');
    const elTodayRevBar = document.getElementById('pred-today-rev-bar');
    
    const elTodayEstDel = document.getElementById('pred-today-est-del');
    const elTodayActDel = document.getElementById('pred-today-act-del');
    const elTodayDelBar = document.getElementById('pred-today-del-bar');
    const elErrorText = document.getElementById('pred-error-rate-text');

    // Tomorrow & Period UI
    const elTomRev = document.getElementById('pred-tomorrow-revenue');
    const elTomDel = document.getElementById('pred-tomorrow-delivery');
    const elPerAvgRev = document.getElementById('pred-period-avg-revenue');
    const elPerAvgDel = document.getElementById('pred-period-avg-delivery');
    const elPeriodLabel = document.getElementById('pred-period-label');
    const elRevTrend = document.getElementById('pred-revenue-trend');
    const elDelTrend = document.getElementById('pred-delivery-trend');

    if (!prediction) {
        if (elTomRev) elTomRev.textContent = '-';
        if (elTomDel) elTomDel.textContent = '-';
        if (elPerAvgRev) elPerAvgRev.textContent = '-';
        if (elPerAvgDel) elPerAvgDel.textContent = '-';
        return;
    }

    const { today, tomorrow, revenue, delivery } = prediction;

    // 1. 당일 실적 추적 모니터링 업데이트
    if (today) {
        if (elTodayEstRev) elTodayEstRev.textContent = today.predictedRev.toLocaleString();
        if (elTodayActRev) elTodayActRev.textContent = today.actualRev.toLocaleString();
        if (elTodayRevBar) {
            const revPct = today.predictedRev > 0 ? Math.min(100, (today.actualRev / today.predictedRev) * 100) : 0;
            elTodayRevBar.style.width = `${revPct}%`;
        }

        if (elTodayEstDel) elTodayEstDel.textContent = today.predictedDel.toLocaleString();
        if (elTodayActDel) elTodayActDel.textContent = today.actualDel.toLocaleString();
        if (elTodayDelBar) {
            const delPct = today.predictedDel > 0 ? Math.min(100, (today.actualDel / today.predictedDel) * 100) : 0;
            elTodayDelBar.style.width = `${delPct}%`;
        }

        // 오차 보정률 텍스트 출력
        if (elErrorText) {
            const revFactorPct = ((today.errorFactorRev - 1) * 100).toFixed(1);
            const delFactorPct = ((today.errorFactorDel - 1) * 100).toFixed(1);
            const revColor = revFactorPct >= 0 ? 'text-red-500' : 'text-blue-500';
            const delColor = delFactorPct >= 0 ? 'text-red-500' : 'text-blue-500';
            
            elErrorText.innerHTML = `최근 14일 오차율을 분석하여 예측치에 <br/>매출 <strong class="${revColor}">${revFactorPct > 0 ? '+'+revFactorPct : revFactorPct}%</strong>, 배송 <strong class="${delColor}">${delFactorPct > 0 ? '+'+delFactorPct : delFactorPct}%</strong> 자동 보정 반영됨.`;
        }
    }

    // 2. 내일 예측 및 기간 평균 업데이트
    const avgRev = revenue.reduce((a,b)=>a+b,0) / revenue.length;
    const avgDel = delivery.reduce((a,b)=>a+b,0) / delivery.length;

    if (elTomRev) elTomRev.textContent = tomorrow.revenue > 0 ? tomorrow.revenue.toLocaleString() : '휴무(0)';
    if (elTomDel) elTomDel.textContent = tomorrow.delivery > 0 ? tomorrow.delivery.toLocaleString() : '휴무(0)';
    
    if (elPerAvgRev) elPerAvgRev.textContent = Math.round(avgRev).toLocaleString();
    if (elPerAvgDel) elPerAvgDel.textContent = Math.round(avgDel).toLocaleString();
    if (elPeriodLabel) elPeriodLabel.textContent = `향후 ${daysToPredict}일 기준`;

    // 3. 장기 추세 안내 텍스트
    if (elRevTrend && trend) {
        const factor = trend.revenueFactor;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '📈'; trendText = `최근 매출 꾸준한 상승세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📉'; trendText = `최근 매출 하락세 주의`; color = 'text-blue-500'; }
        elRevTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }

    if (elDelTrend && trend) {
        const factor = trend.deliveryFactor;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '📦📈'; trendText = `최근 배송량 증가 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📦📉'; trendText = `최근 배송량 감소 추세`; color = 'text-blue-500'; }
        elDelTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }
};

const renderChart = (key, ctx, labels, histData, predData, splitIndex, label, color) => {
    if (predictionCharts[key]) {
        predictionCharts[key].destroy();
    }

    const historicalDataset = histData.map((v, i) => i < splitIndex ? v : null);
    
    // 선이 이어지도록 예측 데이터의 시작점에 과거 마지막 데이터를 넣음
    const predictionDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predData[i - splitIndex];
        return null;
    });

    predictionCharts[key] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: '실적 (과거)',
                    data: historicalDataset,
                    borderColor: color,
                    backgroundColor: color.replace(')', ', 0.1)').replace('rgb', 'rgba'),
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3,
                    fill: true
                },
                {
                    label: '예측 (AI)',
                    data: predictionDataset,
                    borderColor: '#f59e0b', 
                    borderWidth: 2,
                    borderDash: [5, 5], 
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    tension: 0.3,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    position: 'top',
                    align: 'end',
                    labels: { boxWidth: 12, usePointStyle: true }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                label += Math.round(context.parsed.y).toLocaleString();
                            }
                            return label;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 10, font: { size: 10 } }
                },
                y: {
                    beginAtZero: true,
                    grid: { borderDash: [2, 2] },
                    ticks: { font: { size: 10 } }
                }
            }
        }
    });
};

const renderNoData = (ctx, msg) => {
    const context = ctx.getContext('2d');
    context.clearRect(0, 0, ctx.width, ctx.height);
    context.font = "14px 'Noto Sans KR'";
    context.fillStyle = "#9ca3af";
    context.textAlign = "center";
    context.fillText(msg, ctx.width / 2, ctx.height / 2);
};