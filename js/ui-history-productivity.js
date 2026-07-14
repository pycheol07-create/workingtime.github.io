// === js/ui-history-productivity.js ===
import * as State from './state.js';

let productivityChartInstance = null;

export function renderProductivityTab(filteredData, appConfig) {
    const taskTypes = ['국내배송', '중국제작', '직진배송'];
    
    // 각 파트별 유니크 작업자 집계를 위해 Set 객체 추가
    const summary = {
        '종합': { duration: 0, qty: 0, members: new Set() },
        '국내배송': { duration: 0, qty: 0, members: new Set() },
        '중국제작': { duration: 0, qty: 0, members: new Set() },
        '직진배송': { duration: 0, qty: 0, members: new Set() }
    };

    const wageMap = { ...(appConfig.memberWages || {}) };
    let nonWorkDurationMin = 0;
    let nonWorkActualMin = 0; // 추가: 인당 비업무시간
    let nonWorkCost = 0;

    filteredData.forEach(day => {
        let dayTotalWork = 0;
        
        (day.workRecords || []).forEach(r => {
            dayTotalWork += (r.duration || 0);
            
            const matchedType = taskTypes.find(t => (r.taskType && r.taskType.includes(t)) || (r.task && r.task.includes(t)));
            if (matchedType) {
                summary[matchedType].duration += (r.duration || 0);
                if (r.member) summary[matchedType].members.add(r.member);
            }
            summary['종합'].duration += (r.duration || 0);
            if (r.member) summary['종합'].members.add(r.member);
        });

        Object.entries(day.taskQuantities || {}).forEach(([taskKey, qty]) => {
            const numQty = Number(qty) || 0;
            const matchedType = taskTypes.find(t => taskKey.includes(t));
            if (matchedType) {
                summary[matchedType].qty += numQty;
            }
            summary['종합'].qty += numQty;
        });

        const uniqueMembers = new Set((day.workRecords || []).map(r => r.member));
        const potentialMinutes = uniqueMembers.size * 480;
        
        if (potentialMinutes > dayTotalWork) {
            const loss = potentialMinutes - dayTotalWork;
            nonWorkDurationMin += loss;
            // 누수시간도 인원수로 나누어 실제 누수 평균 도출
            nonWorkActualMin += uniqueMembers.size > 0 ? (loss / uniqueMembers.size) : 0;
            nonWorkCost += (loss / 60) * 10000; 
        }
    });

    // 국내배송은 한 주문에 평균 1.3개 상품이 포함되므로 "개" + "건(=개/1.3)" 병기
    const DOMESTIC_ITEMS_PER_ORDER = 1.3;

    const setProductivityText = (typeId, data, showCases = false) => {
        const mins = data.duration;
        const hours = mins / 60;

        const upm = mins > 0 ? (data.qty / mins) : 0;
        const uph = hours > 0 ? (data.qty / hours) : 0;
        const upd = uph * 8;

        const upmEl = document.getElementById(`prod-upm-${typeId}`);
        const uphEl = document.getElementById(`prod-uph-${typeId}`);
        const updEl = document.getElementById(`prod-upd-${typeId}`);

        // 단일 값 포맷터: "X 개" + 옵션 (Y 건)
        const fmt = (val, digits) => {
            if (val <= 0) return '0';
            const itemText = digits === 0
                ? Math.round(val).toLocaleString()
                : val.toFixed(digits);
            let html = `${itemText} 개`;
            if (showCases) {
                const cases = val / DOMESTIC_ITEMS_PER_ORDER;
                const caseText = digits === 0
                    ? Math.round(cases).toLocaleString()
                    : cases.toFixed(digits);
                html += ` <span class="text-[10px] text-gray-400 font-normal">(${caseText} 건)</span>`;
            }
            return html;
        };

        if (upmEl) upmEl.innerHTML = fmt(upm, 2);
        if (uphEl) uphEl.innerHTML = fmt(uph, 1);
        if (updEl) updEl.innerHTML = fmt(upd, 0);
    };

    setProductivityText('general',  summary['종합']);
    setProductivityText('domestic', summary['국내배송'], true); // 건수 병기
    setProductivityText('china',    summary['중국제작']);
    setProductivityText('direct',   summary['직진배송']);

    const ctx = document.getElementById('chart-productivity-efficiency');
    if (ctx) {
        if (productivityChartInstance) productivityChartInstance.destroy();

        const colors = { '국내배송': '#10b981', '중국제작': '#ef4444', '직진배송': '#a855f7' };
        const datasets = taskTypes.map(type => {
            const hours = summary[type].duration / 60;
            // 실제 평균 소요시간 계산
            const actualHours = summary[type].members.size > 0 ? hours / summary[type].members.size : 0;
            
            return {
                label: type,
                data: [{ 
                    x: parseFloat(hours.toFixed(1)), 
                    y: summary[type].qty, 
                    r: hours > 0 ? 15 : 0, 
                    actualX: parseFloat(actualHours.toFixed(1)) 
                }],
                backgroundColor: colors[type] || '#3b82f6'
            };
        });

        productivityChartInstance = new Chart(ctx, {
            type: 'bubble',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: '총 투입 시간 (Hours)', font: { weight: 'bold' } }, beginAtZero: true },
                    y: { title: { display: true, text: '총 생산량 (개수)', font: { weight: 'bold' } }, beginAtZero: true }
                },
                plugins: { 
                    tooltip: { 
                        callbacks: { 
                            // 툴팁에서 총 투입 시간과 함께 실제(인당) 소요시간을 괄호 안에 출력
                            label: (ctx) => `${ctx.dataset.label}: 총 투입 ${ctx.raw.x}h (인당 실제소요 ${ctx.raw.actualX}h), ${ctx.raw.y}개 생산` 
                        } 
                    } 
                }
            }
        });
    }

    const tbody = document.getElementById('prod-coq-table-body');
    if (tbody) {
        const totalDurationGeneral = summary['종합'].duration;
        const actualDurationGeneral = summary['종합'].members.size > 0 ? totalDurationGeneral / summary['종합'].members.size : 0;

        tbody.innerHTML = `
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">⏳ 대기 및 비업무 시간 누수</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                    <div class="font-bold text-gray-800 dark:text-gray-200">총 합산 ${Math.round(nonWorkDurationMin).toLocaleString()} 분</div>
                    <div class="text-xs text-blue-500 font-bold">실제 평균 ${Math.round(nonWorkActualMin).toLocaleString()} 분</div>
                </td>
                <td class="px-4 py-3 text-right text-red-500 font-bold font-mono">-${Math.round(nonWorkCost).toLocaleString()} 원</td>
            </tr>
            <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <td class="px-4 py-3 font-medium text-gray-700 dark:text-gray-300">📦 불량 검수 및 조정 Overhead</td>
                <td class="px-4 py-3 text-right text-gray-600 dark:text-gray-400 font-mono">
                    <div class="font-bold text-gray-800 dark:text-gray-200">총 합산 ${Math.round(totalDurationGeneral * 0.05)} 분</div>
                    <div class="text-xs text-blue-500 font-bold">실제 평균 ${Math.round(actualDurationGeneral * 0.05)} 분</div>
                </td>
                <td class="px-4 py-3 text-right text-red-500 font-bold font-mono">-${Math.round((totalDurationGeneral * 0.05 / 60) * 11000).toLocaleString()} 원</td>
            </tr>
        `;
    }

    renderFillErrorAnalysis();
}

// ============================================================
// 🧯 채우기 → 오류 영향 분석
// "채우기가 진행된 날"을 0일차로 두고, 다음 채우기 전까지 경과일수별 평균 오류량을 집계.
// 채우기 이후 시간이 지날수록 오류가 늘어나는 경향이 있는지 확인하기 위한 이벤트 스터디.
// 기간 선택과 무관하게 항상 State.allHistoryData 전체 이력을 사용한다(구간 개수를 충분히 확보하기 위함).
// ============================================================
let fillErrorChartInstance = null;

function computeFillErrorAnalysis(allHistoryData) {
    const sortedDays = [...(allHistoryData || [])]
        .filter(d => d && typeof d.id === 'string')
        .sort((a, b) => a.id.localeCompare(b.id));

    const hasErrorQtyData = sortedDays.some(d => Number(d.taskQuantities?.['오류']) > 0);

    const errorValueOf = (day) => {
        if (hasErrorQtyData) return Number(day.taskQuantities?.['오류']) || 0;
        return (day.workRecords || []).filter(r => r.task === '오류').reduce((s, r) => s + (Number(r.duration) || 0), 0);
    };

    const fillHappenedOn = (day) => {
        if ((Number(day.taskQuantities?.['채우기']) || 0) > 0) return true;
        return (day.workRecords || []).some(r => r.task === '채우기' && (Number(r.duration) || 0) > 0);
    };

    const fillEventIndices = [];
    sortedDays.forEach((day, idx) => { if (fillHappenedOn(day)) fillEventIndices.push(idx); });

    const metricLabel = hasErrorQtyData ? '개' : '분';
    if (fillEventIndices.length < 2) {
        return { insufficientData: true, metricLabel };
    }

    // offset(채우기 이후 경과일, 기록 있는 날 기준 순번) → 오류값 목록
    const offsetBuckets = {};
    const pairs = []; // 상관계수 계산용
    const intervalLengths = [];

    for (let k = 0; k < fillEventIndices.length; k++) {
        const startIdx = fillEventIndices[k];
        const endIdx = (k + 1 < fillEventIndices.length) ? fillEventIndices[k + 1] : sortedDays.length;
        intervalLengths.push(endIdx - startIdx);
        for (let j = startIdx; j < endIdx; j++) {
            const offset = j - startIdx;
            const errVal = errorValueOf(sortedDays[j]);
            if (!offsetBuckets[offset]) offsetBuckets[offset] = [];
            offsetBuckets[offset].push(errVal);
            pairs.push({ offset, errVal });
        }
    }

    // 피어슨 상관계수 (경과일수 vs 오류량) — 채우기 이후 시간이 지날수록 오류가 느는 경향인지 요약
    const n = pairs.length;
    const meanOffset = pairs.reduce((s, p) => s + p.offset, 0) / n;
    const meanErr = pairs.reduce((s, p) => s + p.errVal, 0) / n;
    let cov = 0, varOffset = 0, varErr = 0;
    pairs.forEach(p => {
        cov += (p.offset - meanOffset) * (p.errVal - meanErr);
        varOffset += (p.offset - meanOffset) ** 2;
        varErr += (p.errVal - meanErr) ** 2;
    });
    const correlation = (varOffset > 0 && varErr > 0) ? (cov / Math.sqrt(varOffset * varErr)) : null;

    // 표본이 너무 적은 경과일(마지막 구간들)은 노이즈가 크므로 최소 표본 수 미만은 차트에서 제외
    const MIN_SAMPLES = 2;
    const MAX_OFFSET = 21; // 3주 이상은 표본이 지나치게 희소해 상한
    const offsetLabels = [];
    const offsetAverages = [];
    const offsetCounts = [];
    Object.keys(offsetBuckets).map(Number).sort((a, b) => a - b).forEach(offset => {
        if (offset > MAX_OFFSET) return;
        const vals = offsetBuckets[offset];
        if (vals.length < MIN_SAMPLES) return;
        offsetLabels.push(offset === 0 ? '채우기 당일' : `+${offset}일`);
        offsetAverages.push(vals.reduce((a, b) => a + b, 0) / vals.length);
        offsetCounts.push(vals.length);
    });

    const avgIntervalLength = intervalLengths.reduce((a, b) => a + b, 0) / intervalLengths.length;

    return {
        insufficientData: false,
        metricLabel,
        fillEventCount: fillEventIndices.length,
        avgIntervalLength,
        correlation,
        offsetLabels, offsetAverages, offsetCounts
    };
}

function renderFillErrorAnalysis() {
    const canvas = document.getElementById('chart-fill-error');
    const summaryEl = document.getElementById('fill-error-summary');
    const emptyEl = document.getElementById('fill-error-empty');
    if (!canvas) return;

    const result = computeFillErrorAnalysis(State.allHistoryData);

    if (fillErrorChartInstance) { fillErrorChartInstance.destroy(); fillErrorChartInstance = null; }

    if (result.insufficientData) {
        canvas.classList.add('hidden');
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (summaryEl) summaryEl.textContent = '';
        return;
    }
    canvas.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');

    if (summaryEl) {
        let corrText = '상관계수 계산 불가';
        if (result.correlation !== null) {
            const r = result.correlation;
            const trend = r > 0.15 ? '양의 상관 (시간 지날수록 오류 증가 경향)' : r < -0.15 ? '음의 상관' : '뚜렷한 경향 없음';
            corrText = `상관계수 r=${r.toFixed(2)} (${trend})`;
        }
        summaryEl.textContent = `채우기 ${result.fillEventCount}회 · 평균 주기 ${result.avgIntervalLength.toFixed(1)}일 · ${corrText}`;
    }

    fillErrorChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: result.offsetLabels,
            datasets: [{
                label: `평균 오류량 (${result.metricLabel})`,
                data: result.offsetAverages,
                backgroundColor: '#ef4444',
                borderRadius: 4,
                maxBarThickness: 32
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        afterLabel: (ctx) => `표본 ${result.offsetCounts[ctx.dataIndex]}일`
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: '채우기 이후 경과일' }, grid: { display: false } },
                y: { title: { display: true, text: `평균 오류량 (${result.metricLabel})` }, beginAtZero: true, grid: { borderDash: [4, 4] } }
            }
        }
    });
}