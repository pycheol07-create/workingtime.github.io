// === js/ui-history-prediction.js ===
// 설명: '실적 예측' 탭의 UI 렌더링 및 차트 제어를 담당합니다.

import { predictFutureTrends } from './analysis-logic.js';

// 차트 인스턴스를 저장하여 중복 생성을 방지합니다.
const predictionCharts = {
    revenue: null,
    delivery: null
};

/**
 * 실적 예측 탭 렌더링 메인 함수
 * @param {Array} historyData - 전체 이력 데이터
 * @param {number} daysToPredict - 예측할 미래 일수 (기본 14일)
 */
export const renderPredictionTab = (historyData, daysToPredict = 14) => {
    const revenueCtx = document.getElementById('chart-prediction-revenue');
    const deliveryCtx = document.getElementById('chart-prediction-delivery');

    if (!revenueCtx || !deliveryCtx) return;

    // 예측 기간 선택 (selectbox에서 값을 읽어옴, 기본값 파라미터 덮어쓰기)
    const selectEl = document.getElementById('prediction-days-select');
    if (selectEl) {
        daysToPredict = parseInt(selectEl.value, 10);
    }

    // 1. 데이터 분석 및 예측 실행
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

    // 3. 차트 렌더링
    renderChart('revenue', revenueCtx, allLabels, historical.revenue, prediction.revenue, splitIndex, '매출 (원)', 'rgb(79, 70, 229)'); 
    renderChart('delivery', deliveryCtx, allLabels, historical.delivery, prediction.delivery, splitIndex, '배송량 (건)', 'rgb(16, 185, 129)'); 

    // 4. KPI 카드 업데이트
    updateKPICards(prediction, trend, daysToPredict);

    // 기간 변경 시 즉시 재렌더링을 위한 이벤트 리스너 부착 (최초 1회만 등록)
    if (selectEl && !selectEl.dataset.listenerAttached) {
        selectEl.dataset.listenerAttached = 'true';
        selectEl.addEventListener('change', () => {
            renderPredictionTab(historyData); // 다시 호출
        });
    }
};

/**
 * KPI 카드 수치 업데이트 함수
 */
const updateKPICards = (prediction, trend, daysToPredict) => {
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
        if (elRevTrend) elRevTrend.textContent = '데이터 부족';
        if (elDelTrend) elDelTrend.textContent = '데이터 부족';
        return;
    }

    // 1. 내일 예측값 추출
    const tomRev = prediction.tomorrow.revenue;
    const tomDel = prediction.tomorrow.delivery;

    // 2. 선택 기간 평균 계산
    const avgRev = prediction.revenue.reduce((a,b)=>a+b,0) / prediction.revenue.length;
    const avgDel = prediction.delivery.reduce((a,b)=>a+b,0) / prediction.delivery.length;

    // UI 업데이트
    if (elTomRev) elTomRev.textContent = tomRev > 0 ? tomRev.toLocaleString() : '휴무 예상(0)';
    if (elTomDel) elTomDel.textContent = tomDel > 0 ? tomDel.toLocaleString() : '휴무 예상(0)';
    
    if (elPerAvgRev) elPerAvgRev.textContent = Math.round(avgRev).toLocaleString();
    if (elPerAvgDel) elPerAvgDel.textContent = Math.round(avgDel).toLocaleString();
    if (elPeriodLabel) elPeriodLabel.textContent = `향후 ${daysToPredict}일 기준`;

    // 3. 추세 텍스트 (Factor: 1.0은 100% 동일, 1.1은 10% 성장)
    if (elRevTrend && trend) {
        const factor = trend.revenueFactor;
        let trendIcon = '➡️', trendText = '최근 한달과 비슷한 보합세', color = 'text-blue-500';
        
        if (factor > 1.05) { trendIcon = '📈'; trendText = `최근 한달 대비 매출 상승 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📉'; trendText = `최근 한달 대비 매출 하락 추세`; color = 'text-blue-500'; }
        
        elRevTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }

    if (elDelTrend && trend) {
        const factor = trend.deliveryFactor;
        let trendIcon = '➡️', trendText = '최근 한달과 비슷한 보합세', color = 'text-blue-500';
        
        if (factor > 1.05) { trendIcon = '📦📈'; trendText = `최근 배송량 뚜렷한 증가 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📦📉'; trendText = `최근 배송량 감소 추세`; color = 'text-blue-500'; }
        
        elDelTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }
};

/**
 * Chart.js 차트 생성 헬퍼
 */
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