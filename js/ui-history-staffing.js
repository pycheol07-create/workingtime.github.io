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

    // ── 1단계: 기간 전체 종합 UPH 산출 (대시보드 종합 UPH와 동일한 정의) ──
    // 분모에는 전체 작업시간을 모두 포함해 검수·교환반품·재작업 등 지원 작업까지 반영합니다.
    let sumAllQty = 0;
    let sumAllMinutes = 0;
    filteredData.forEach(day => {
        Object.values(day.taskQuantities || {}).forEach(q => { sumAllQty += (Number(q) || 0); });
        (day.workRecords || []).forEach(r => { sumAllMinutes += (r.duration || 0); });
    });
    const overallUPH = (sumAllMinutes > 0) ? (sumAllQty / (sumAllMinutes / 60)) : 0;

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

        // 필요 FTE = 바스켓 수요 ÷ 종합 UPH ÷ 1일 표준시간 ÷ 가동률
        if (overallUPH > 0 && dailyHours > 0 && utilization > 0) {
            const requiredHours = dayBasketQty / overallUPH;
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
    document.getElementById('staff-required').textContent = (overallUPH > 0) ? `${avgRequired.toFixed(1)} 명 / 일` : '— 명 / 일';
    document.getElementById('staff-total-loss').textContent = Math.round(totalLossMinutes).toLocaleString();

    const commentEl = document.getElementById('staff-fte-comment');
    if (commentEl) {
        const meta = `<span class="block mt-1 text-gray-400 dark:text-gray-500">기준 UPH ${overallUPH.toFixed(1)}개/시 (= 종합 UPH) · 가동률 ${Math.round(utilization * 100)}% · 수요 바스켓: 출고성+채우기</span>`;
        if (overallUPH <= 0) {
            commentEl.innerHTML = `📉 선택 기간에 종합 UPH 산출용 데이터가 부족해 필요 인원을 계산할 수 없습니다.`;
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

    // ── 차월 목표 매출 → 필요 인원 시뮬레이터 ──
    // 동작: 목표 매출 ÷ 가정 영업일 22 → 일평균 목표 매출. 현재 일평균 매출 대비
    // 스케일링 비율(target/현재)을 현재 평균 출근 인원에 곱해 필요 인원 산출.
    // 추가 알바 = max(0, 필요 인원 − 현재 평균 출근).
    const simBtn = document.getElementById('staffing-sim-btn');
    const simInput = document.getElementById('staffing-sim-input');
    const simResult = document.getElementById('staffing-sim-result');
    if (simBtn && simInput && simResult) {
        // 이전 클릭 리스너 제거를 위해 노드 교체 (renderStaffingTab 재호출 시 중복 바인딩 방지)
        const freshBtn = simBtn.cloneNode(true);
        simBtn.parentNode.replaceChild(freshBtn, simBtn);
        freshBtn.addEventListener('click', () => {
            const target = Number(simInput.value);
            if (!target || target <= 0) {
                simResult.innerHTML = '<div class="mt-3 pt-3 border-t border-white/30 text-yellow-100">목표 매출(원)을 입력해주세요.</div>';
                return;
            }
            const totalRev = filteredData.reduce((s, d) => s + (Number(d.management && d.management.revenue) || 0), 0);
            const revDays = filteredData.filter(d => Number(d.management && d.management.revenue) > 0).length;
            if (totalRev <= 0 || revDays === 0 || avgActual <= 0) {
                simResult.innerHTML = '<div class="mt-3 pt-3 border-t border-white/30 text-yellow-100">현재 기간 매출/출근 데이터가 부족해 예측할 수 없습니다.</div>';
                return;
            }
            const dailyRev = totalRev / revDays;
            const workingDays = 22; // 가정: 월 영업일 22일
            const targetDailyRev = target / workingDays;
            const scale = targetDailyRev / dailyRev;
            const requiredHeadcount = avgActual * scale;
            const additionalAlba = Math.max(0, requiredHeadcount - avgActual);
            const KRW = n => Math.round(n).toLocaleString();

            simResult.innerHTML = `
                <div class="mt-3 pt-3 border-t border-white/30 text-sm space-y-1">
                    <div>현재 일평균 매출: <strong>${KRW(dailyRev)}원</strong> <span class="text-[11px] text-indigo-100/80">(${revDays}일 기준)</span></div>
                    <div>목표 일평균 매출: <strong>${KRW(targetDailyRev)}원</strong> <span class="text-[11px] text-indigo-100/80">(월 22일 가정)</span></div>
                    <div>스케일링 비율: <strong>${scale.toFixed(2)}배</strong></div>
                    <div>필요 일평균 인원: <strong>${requiredHeadcount.toFixed(1)}명</strong> <span class="text-[11px] text-indigo-100/80">(현재 ${avgActual.toFixed(1)}명 기준 선형)</span></div>
                    <div class="pt-1 text-yellow-100 font-bold">→ 추가 필요 알바: <strong>${additionalAlba.toFixed(1)}명</strong></div>
                </div>
            `;
        });
    }
}