// === js/ui-history-staffing.js ===
import * as State from './state.js?v=202609082342';
import { overallUph } from './task-throughput.js?v=202609082342';
import { getStaffingOutlook } from './ui-history-prediction.js?v=202609082342';
import { fetchPlannedData } from './history-data-manager.js?v=202609082342';
import { getTodayDateString } from './utils.js?v=202609082342';

let staffingChartInstance = null;

// 표준 처리량 바스켓: 출고성 + 채우기
// (검수·교환반품·상.하차·재고/앵글/상품재작업·오류 등 비-출고 작업은 제외)
//
// ⚠️ 이 목록이 코드에 박혀 있어서 '에이블리배송'이 빠진 채로 오래 돌았다.
//    빠진 업무의 물량은 수요에서 통째로 사라져 필요 인원이 실제보다 적게 나온다.
//    그래서 관리자 설정(appConfig.staffingBasketTasks)으로 덮어쓸 수 있게 열어 둔다.
const DEFAULT_STAFFING_TASKS = [
    '국내배송', '중국제작', '직진배송', '에이블리배송', '해외배송', '택배포장', '티니', '채우기'
];

/** 이 기간의 수요 바스켓. 설정에 목록이 있으면 그걸 쓰고, 없으면 기본값. */
const staffingBasketOf = (appConfig) => {
    const custom = appConfig && appConfig.staffingBasketTasks;
    const list = (Array.isArray(custom) && custom.length > 0) ? custom : DEFAULT_STAFFING_TASKS;
    return new Set(list.map(t => String(t).trim()).filter(Boolean));
};

export function renderStaffingTab(filteredData, appConfig) {
    // 앞날 전망은 선택 기간과 무관하다(예정 물량 기반) — 위쪽 분석이 비어도 그린다.
    renderStaffingOutlook();
    // 예정 물량이 아직 안 실렸으면 불러온 뒤 한 번 더 (대부분 캐시라 즉시)
    fetchPlannedData().then(() => renderStaffingOutlook()).catch(() => {});

    if (!filteredData || filteredData.length === 0) return;

    const totalDays = filteredData.length;
    const stdHours = (appConfig && appConfig.standardDailyWorkHours) || { weekday: 8, weekend: 4 };
    const utilization = (appConfig && typeof appConfig.utilizationRate === 'number') ? appConfig.utilizationRate : 0.8;
    const basket = staffingBasketOf(appConfig);

    // ── 1단계: 기간 전체 종합 UPH 산출 (대시보드 종합 UPH와 동일한 정의) ──
    // 분모에는 전체 작업시간을 모두 포함해 검수·교환반품·재작업 등 지원 작업까지 반영합니다.
    // 계산은 js/task-throughput.js 로 모았습니다(같은 값을 재는 코드가 여러 벌이지 않도록).
    const overallUPH = overallUph(filteredData);

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
            if (basket.has(task)) dayBasketQty += (Number(q) || 0);
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
        // 실제로 물량이 잡힌 업무만 추려 보여 준다 — 빠진 업무가 있으면 여기서 바로 눈에 띈다
        const counted = [...basket].filter(t => filteredData.some(d => (Number(d.taskQuantities?.[t]) || 0) > 0));
        const basketLabel = counted.length > 0 ? counted.join(' · ') : '해당 물량 없음';
        const meta = `<span class="block mt-1 text-gray-400 dark:text-gray-500">기준 UPH ${overallUPH.toFixed(1)}개/시 (= 종합 UPH) · 가동률 ${Math.round(utilization * 100)}% · 수요 바스켓: ${basketLabel}</span>`;
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

// ═══════════════════════════════════════════════════════════
// 📅 앞으로의 인원 수급 — 저장해 둔 예정 물량으로 '모자랄 날'을 미리 본다.
//
// 이 탭의 위쪽은 전부 '지나간 기간의 평균'이라, 정작 필요한
// "다음 주 화요일에 사람이 모자란다"를 알려주지 못했다.
// 예정 물량은 이미 저장되고 있으니(업무 예상의 작업량 저장 · 예정 물량 입력)
// 업무 예상과 같은 계산으로 앞날을 돌려 보여 준다.
// ═══════════════════════════════════════════════════════════

const OUTLOOK_DAYS = 10;

const fmtDay = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return dateStr;
    const w = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()];
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} (${w})`;
};

const outlookRow = (r, maxNeed, todayStr) => {
    const short = r.gap < 0;
    const barPct = maxNeed > 0 ? Math.min(100, Math.round(r.requiredFTE / maxNeed * 100)) : 0;
    const availPct = maxNeed > 0 ? Math.min(100, Math.round(r.available / maxNeed * 100)) : 0;
    const tone = short ? 'text-rose-600 dark:text-rose-400'
        : (r.gap > 2 ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-500 dark:text-gray-400');
    const gapText = r.gap === 0 ? '적정' : (r.gap > 0 ? `+${r.gap}명 여유` : `${Math.abs(r.gap)}명 부족`);

    return `
    <tr class="border-t border-gray-100 dark:border-gray-700/60 ${short ? 'bg-rose-50/50 dark:bg-rose-900/10' : ''}
               hover:bg-gray-50 dark:hover:bg-gray-900/30 cursor-pointer staffing-outlook-row" data-date="${r.date}"
        title="누르면 업무 예상에서 이 날짜를 자세히 볼 수 있습니다">
        <td class="py-2 px-3 whitespace-nowrap font-medium text-gray-700 dark:text-gray-200">
            ${fmtDay(r.date)}${r.date === todayStr ? '<span class="ml-1 text-[10px] font-bold text-indigo-500">오늘</span>' : ''}
        </td>
        <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400 whitespace-nowrap">
            ${r.totalHours.toFixed(1)}<span class="text-[10px] ml-0.5">인시</span>
        </td>
        <td class="py-2 px-3">
            <div class="relative h-4 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden min-w-[90px]">
                <div class="absolute inset-y-0 left-0 ${short ? 'bg-rose-400' : 'bg-indigo-400'} opacity-80" style="width:${barPct}%"></div>
                <div class="absolute inset-y-0 border-r-2 border-gray-700 dark:border-gray-200" style="left:${availPct}%" title="가용 ${r.available}명"></div>
            </div>
        </td>
        <td class="py-2 px-3 text-right tabular-nums font-bold text-gray-800 dark:text-gray-100 whitespace-nowrap">${r.requiredFTE}명</td>
        <td class="py-2 px-3 text-right tabular-nums text-gray-600 dark:text-gray-300 whitespace-nowrap">
            ${r.available}명${r.onLeave > 0 ? `<span class="text-[10px] text-gray-400 ml-1">(휴무 ${r.onLeave})</span>` : ''}
        </td>
        <td class="py-2 px-3 text-right whitespace-nowrap font-bold ${tone}">${gapText}</td>
        <td class="py-2 px-2 text-center">
            <span class="text-[10px] font-bold px-1.5 py-0.5 rounded ${r.hasPlanned
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                : 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'}"
                  title="${r.hasPlanned ? '저장해 둔 예정 물량으로 계산했습니다' : '예정 물량이 없어 실적 기반 자동 추정으로 계산했습니다'}">${r.hasPlanned ? '예정' : '추정'}</span>
        </td>
    </tr>`;
};

export function renderStaffingOutlook() {
    const host = document.getElementById('staffing-outlook');
    if (!host) return;

    let rows = [];
    try { rows = getStaffingOutlook(OUTLOOK_DAYS) || []; }
    catch (e) { console.error('[staffing-outlook] 실패:', e); }

    if (rows.length === 0) {
        host.innerHTML = '';
        return;
    }

    const todayStr = getTodayDateString();
    const maxNeed = Math.max(...rows.map(r => Math.max(r.requiredFTE, r.available)), 1);
    const shortDays = rows.filter(r => r.gap < 0);
    const worst = shortDays.reduce((a, b) => (a && a.gap <= b.gap ? a : b), null);
    const plannedCount = rows.filter(r => r.hasPlanned).length;

    const headline = shortDays.length === 0
        ? `<span class="text-emerald-600 dark:text-emerald-400 font-bold">${rows.length}근무일 모두 인원이 충분합니다.</span>`
        : `<span class="text-rose-600 dark:text-rose-400 font-bold">${rows.length}근무일 중 ${shortDays.length}일 부족</span>`
          + (worst ? ` <span class="text-gray-500 dark:text-gray-400">— 가장 모자란 날 ${fmtDay(worst.date)} <b>${Math.abs(worst.gap)}명</b></span>` : '');

    host.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 depth-panel overflow-hidden">
        <div class="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 class="text-sm md:text-md font-bold text-gray-800 dark:text-white">📅 앞으로 ${rows.length}근무일 인원 수급</h4>
            <span class="text-[11px] text-gray-400 dark:text-gray-500">
                저장해 둔 예정 물량 ${plannedCount}일 · 나머지는 실적 기반 추정 · 업무 예상과 같은 계산
            </span>
        </div>
        <div class="px-5 py-3 text-xs md:text-sm border-b border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/20">${headline}</div>
        <div class="overflow-x-auto">
            <table class="w-full text-sm">
                <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                    <tr>
                        <th class="py-2.5 px-3 text-left font-bold">날짜</th>
                        <th class="py-2.5 px-3 text-right font-bold" title="그날 모든 업무의 인시 합계">작업량</th>
                        <th class="py-2.5 px-3 text-left font-bold w-[24%]">필요 대비 가용</th>
                        <th class="py-2.5 px-3 text-right font-bold">필요</th>
                        <th class="py-2.5 px-3 text-right font-bold">가용</th>
                        <th class="py-2.5 px-3 text-right font-bold">과부족</th>
                        <th class="py-2.5 px-2 text-center font-bold" title="예정 = 저장해 둔 물량 / 추정 = 실적 기반 자동값">근거</th>
                    </tr>
                </thead>
                <tbody>${rows.map(r => outlookRow(r, maxNeed, todayStr)).join('')}</tbody>
            </table>
        </div>
        <p class="px-5 py-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500 border-t border-gray-100 dark:border-gray-700">
            · 막대는 <b>필요 인원</b>, 세로선은 <b>가용 인원</b>입니다. 막대가 선을 넘으면 그날 사람이 모자랍니다.<br>
            · <b class="text-gray-500 dark:text-gray-300">추정</b>인 날은 예정 물량을 아직 넣지 않아 과거 실적으로 어림한 값입니다 —
              물량을 알고 있다면 <b>업무 예상 › 계획</b>에서 넣어 두면 이 표가 정확해집니다.<br>
            · 줄을 누르면 업무 예상에서 그 날짜를 자세히 볼 수 있습니다.
        </p>
    </div>`;

    // 줄 클릭 → 업무 예상 탭에서 그 날짜 열기
    if (!host.dataset.bound) {
        host.dataset.bound = 'true';
        host.addEventListener('click', (e) => {
            const row = e.target.closest('.staffing-outlook-row');
            if (!row || !row.dataset.date) return;
            document.querySelector('[data-main-tab="forecast"]')?.click();
            setTimeout(() => {
                const el = document.getElementById('sim-target-date');
                if (!el) return;
                el.value = row.dataset.date;
                el.dispatchEvent(new Event('change', { bubbles: true }));
            }, 500);
        });
    }
}
