// === js/ui-history-staffing.js ===
import * as State from './state.js';

let staffingChartInstance = null;

// 표준 처리량 바스켓: 출고성 + 채우기
// (검수·교환반품·상.하차·재고/앵글/상품재작업·오류 등 비-출고 작업은 제외)
const STAFFING_THROUGHPUT_TASKS = new Set([
    '국내배송', '중국제작', '직진배송', '해외배송', '택배포장', '티니', '채우기'
]);

export function renderStaffingTab(filteredData, appConfig) {
    if (!filteredData || filteredData.length === 0) return;

    const totalDays = filteredData.length;
    const stdHours = (appConfig && appConfig.standardDailyWorkHours) || { weekday: 8, weekend: 4 };
    const utilization = (appConfig && typeof appConfig.utilizationRate === 'number') ? appConfig.utilizationRate : 0.8;

    // ── 1단계: 기간 전체에서 바스켓 기준 실측 UPH 산출 ──
    let sumBasketQty = 0;
    let sumBasketMinutes = 0;
    filteredData.forEach(day => {
        Object.entries(day.taskQuantities || {}).forEach(([task, q]) => {
            if (STAFFING_THROUGHPUT_TASKS.has(task)) sumBasketQty += (Number(q) || 0);
        });
        (day.workRecords || []).forEach(r => {
            if (r && r.task && STAFFING_THROUGHPUT_TASKS.has(r.task)) {
                sumBasketMinutes += (r.duration || 0);
            }
        });
    });
    const basketUPH = (sumBasketMinutes > 0) ? (sumBasketQty / (sumBasketMinutes / 60)) : 0;

    // ── 2단계: 일별 필요 FTE 계산 ──
    let sumActualStaff = 0;
    let sumRequiredStaff = 0;
    let totalLossMinutes = 0;
    let totalWorkMinutes = 0;

    filteredData.forEach(day => {
        const uniqueWorkers = new Set((day.workRecords || []).map(r => r.member));
        sumActualStaff += uniqueWorkers.size;

        let dayWorkTime = 0;
        let dayBasketQty = 0;
        (day.workRecords || []).forEach(r => { dayWorkTime += (r.duration || 0); });
        Object.entries(day.taskQuantities || {}).forEach(([task, q]) => {
            if (STAFFING_THROUGHPUT_TASKS.has(task)) dayBasketQty += (Number(q) || 0);
        });

        totalWorkMinutes += dayWorkTime;

        // 주중/주말에 따른 1인 표준 근무시간 (주말 단축근무 반영)
        const dateObj = day.id ? new Date(day.id + 'T00:00:00') : null;
        const dow = dateObj && !isNaN(dateObj.getTime()) ? dateObj.getDay() : 1;
        const dailyHours = (dow === 0 || dow === 6) ? (Number(stdHours.weekend) || 4) : (Number(stdHours.weekday) || 8);

        // 필요 FTE = 바스켓 수량 ÷ UPH ÷ 1일 표준시간 ÷ 가동률
        if (basketUPH > 0 && dailyHours > 0 && utilization > 0) {
            const requiredHours = dayBasketQty / basketUPH;
            sumRequiredStaff += requiredHours / dailyHours / utilization;
        }

        // 근태/대기 명목 손실 (해당일 표준시간 기준)
        const potential = uniqueWorkers.size * (dailyHours * 60);
        if (potential > dayWorkTime) totalLossMinutes += (potential - dayWorkTime);
    });

    const avgActual = sumActualStaff / totalDays;
    const avgRequired = sumRequiredStaff / totalDays;

    // UI 반영
    document.getElementById('staff-actual').textContent = `${avgActual.toFixed(1)} 명 / 일`;
    document.getElementById('staff-required').textContent = (basketUPH > 0) ? `${avgRequired.toFixed(1)} 명 / 일` : '— 명 / 일';
    document.getElementById('staff-total-loss').textContent = Math.round(totalLossMinutes).toLocaleString();

    const commentEl = document.getElementById('staff-fte-comment');
    if (commentEl) {
        const meta = `<span class="block mt-1 text-gray-400 dark:text-gray-500">기준 UPH ${basketUPH.toFixed(1)}개/시 · 가동률 ${Math.round(utilization * 100)}% · 바스켓: 출고성+채우기</span>`;
        if (basketUPH <= 0) {
            commentEl.innerHTML = `📉 선택 기간에 표준 UPH 산출용 작업 데이터(출고성·채우기)가 부족해 필요 인원을 계산할 수 없습니다.`;
        } else {
            const diff = avgActual - avgRequired;
            if (diff > 0.8) {
                commentEl.innerHTML = `⚠️ 현재 업무량 대비 <strong class="text-amber-500">${diff.toFixed(1)}명 과원</strong> 상태입니다. 작업 속도 조정이나 인력 재배치가 권장됩니다.${meta}`;
            } else if (diff < -0.8) {
                commentEl.innerHTML = `🔥 업무 과부하! 표준 속도 대비 <strong class="text-red-500">${Math.abs(diff).toFixed(1)}명 부족</strong> 상태입니다. 추가 파트타이머 소집이 필요합니다.${meta}`;
            } else {
                commentEl.innerHTML = `✅ 투입 인원과 표준 요구량이 일치하는 <strong class="text-green-500">최적화된 인력 구조</strong>입니다.${meta}`;
            }
        }
    }

    // 도넛 차트 구성 (정상 업무 시간 vs 손실 시간 비율)
    const ctx = document.getElementById('chart-staffing-loss');
    if (ctx) {
        if (staffingChartInstance) staffingChartInstance.destroy();

        staffingChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: ['생산 업무 시간', '근태 손실/대기'],
                datasets: [{
                    data: [totalWorkMinutes, totalLossMinutes],
                    backgroundColor: ['#3b82f6', '#f87171'],
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
            }
        });
    }
}