// === js/ui-history-prediction.js ===
// 설명: '실적 예측' 탭(매출/배송 AI 차트) + '업무 예상' 탭(오늘·내일 자동 예측 + 업무량 시뮬레이션).
//  - renderPredictionTab: 실적 예측 탭 (차트/KPI)
//  - renderForecastTab: 업무 예상 탭 (시뮬레이션·요약 카드)

import { predictFutureTrends } from './analysis-logic.js';
import { REVENUE_CHANNELS, channelScope } from './revenue-channels.js';
import * as State from './state.js';
import { getTodayDateString, getRegularMembersForCount } from './utils.js';
import { getIncomingQtyByDateFromCache } from './widget-incoming-schedule.js';
import { getPlannedQuantitiesForDate, fetchPlannedData } from './history-data-manager.js';

/** 해당 날짜·작업의 예정 물량(수동 입력값). 없으면 null → 자동 추정값으로 폴백. */
const getPlanned = (dateStr, taskKey) => {
    const p = getPlannedQuantitiesForDate(dateStr) || {};
    const v = Number(p[taskKey]);
    return v > 0 ? Math.round(v) : null;
};

/** 대상일(YYYY-MM-DD)에 도착 예정인 입고 수량 = 중국제작 자동값. 캐시에 없으면 0. */
const getIncomingChinaForDate = (dateStr) => {
    if (!dateStr) return 0;
    const map = getIncomingQtyByDateFromCache();
    return Math.round(Number(map[dateStr]) || 0);
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 상수/헬퍼
// ───────────────────────────────────────────────────────────
// 모든 업무를 기본 등록으로 둔다('+ 추가 선택' 폐지).
// 자동값 규칙: ai=국내배송 예측 / incoming=입고일정 / last7=지난 7회 업무량 평균
// 어느 경우든 '예정 물량'에 수기 입력값이 있으면 그 값이 최우선이다.
const SIM_TASKS = [
    { id: 'domestic', key: '국내배송', label: '국내배송', auto: 'ai' },
    { id: 'china',    key: '중국제작', label: '중국제작', auto: 'incoming' },
    { id: 'sample',   key: '샘플검수', label: '샘플검수', auto: 'last7' },
    { id: 'direct',   key: '직진배송', label: '직진배송', auto: 'last7' },
    { id: 'ably',     key: '에이블리배송', label: '에이블리배송', auto: 'last7' },
    { id: 'fill',     key: '채우기',   label: '채우기',   auto: 'last7' },
    { id: 'return',   key: '교환반품', label: '교환반품', auto: 'last7' },
    { id: 'full',     key: '전량검수', label: '전량검수', auto: 'last7' },
    { id: 'other',    key: '국내기타', label: '국내기타', auto: 'last7' },
    { id: 'localprod',key: '국내제작', label: '국내제작', auto: 'last7' }
];
const LEAVE_OFF_TYPES = new Set(['연차', '결근', '휴직', '출장', '매장근무']);
const UTILIZATION = 0.8;

// 로컬 컴포넌트 기반 YYYY-MM-DD (toISOString은 UTC라 KST에서 하루씩 밀림)
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const addDays = (dateStr, n) => {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return ymd(d);
};
const isWeekendDate = (dateStr) => {
    const dow = new Date(dateStr + 'T00:00:00').getDay();
    return dow === 0 || dow === 6;
};
const dayLabel = (dateStr) => {
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const d = new Date(dateStr + 'T00:00:00');
    return isNaN(d.getTime()) ? dateStr : `${dateStr} (${days[d.getDay()]})`;
};

/** 작업별 최근 4주 UPH = Σ 처리량 ÷ (Σ 그 작업 투입시간/60) */
const computeTaskUPHs = (historyData) => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
    const cutoffStr = ymd(cutoff);
    const recent = (historyData || []).filter(d => typeof d.id === 'string' && d.id >= cutoffStr);
    const uph = {};
    SIM_TASKS.forEach(t => {
        let dur = 0, qty = 0;
        recent.forEach(d => {
            (d.workRecords || []).forEach(r => {
                if (r && r.task === t.key) dur += (r.duration || 0);
            });
            qty += Number(d.taskQuantities?.[t.key]) || 0;
        });
        uph[t.key] = dur > 0 ? qty / (dur / 60) : 0;
    });
    return uph;
};

/** 지난 7회 업무량 평균 — 그 업무가 실제로 발생한 최근 7일(물량 > 0)의 평균.
 *  달력 기준 7일이 아니라 '발생 횟수' 기준이라, 매일 잡히지 않는 업무
 *  (전량검수·국내제작·교환반품 등)도 항상 대표값을 얻을 수 있다.
 *  오늘 이후(미래) 날짜는 실적이 아니므로 제외한다. */
const computeLast7Avg = (historyData, taskKey, occurrences = 7) => {
    const today = getTodayDateString();
    const valued = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id <= today)
        .filter(d => Number(d.taskQuantities?.[taskKey]) > 0)
        .sort((a, b) => b.id.localeCompare(a.id))   // 최신순
        .slice(0, occurrences);

    if (valued.length === 0) return 0;
    const sum = valued.reduce((s, d) => s + (Number(d.taskQuantities[taskKey]) || 0), 0);
    return Math.round(sum / valued.length);
};

/** 미래 날짜의 국내배송 AI 예측값. 과거이면 실측치 사용. */
const getAIPredictedDomestic = (historyData, dateStr) => {
    const today = getTodayDateString();
    const tD = new Date(today + 'T00:00:00');
    const xD = new Date(dateStr + 'T00:00:00');
    if (isNaN(xD.getTime()) || isNaN(tD.getTime())) return 0;
    const diff = Math.round((xD - tD) / 86400000);
    if (diff <= 0) {
        // 오늘 또는 과거 → 실측값
        const day = (historyData || []).find(d => d.id === dateStr);
        return Number(day?.taskQuantities?.['국내배송']) || 0;
    }
    if (diff > 30) return 0; // 너무 먼 미래는 신뢰도 낮음
    // ⚠️ 반드시 일반배송(카페24) 스코프로 예측해야 delivery가 '국내배송' 물량이 된다.
    //    스코프를 생략하면 전 채널 물량 합계가 나와 시뮬레이션 값이 부풀려진다.
    const result = predictFutureTrends(historyData, Math.max(14, diff), channelScope('cafe24'));
    if (!result || !result.prediction || !Array.isArray(result.prediction.delivery)) return 0;
    return Math.round(result.prediction.delivery[diff - 1] || 0);
};

/** 가용 인원 = 전체 정직원 − 해당일 휴무자(persistentLeave + 그날 onLeaveMembers)
 *  - 중복 멤버 제거(Set)
 *  - 프로그램 전용 ID 등 인원 산정 제외 명단(headcountExcludedMembers) 빼고 계산
 */
const computeAvailableStaff = (dateStr, appConfig, persistentLeave, historyData) => {
    // 대상일 기준 재직 인원만 (그 날짜 이전에 퇴사 예정인 사람은 총원에서 제외)
    const allStaff = getRegularMembersForCount(appConfig, dateStr); // Set
    const onLeave = new Map();

    (persistentLeave?.onLeaveMembers || []).forEach(e => {
        if (!e || !e.member || !e.startDate || !LEAVE_OFF_TYPES.has(e.type)) return;
        const end = e.endDate || e.startDate;
        if (dateStr >= e.startDate && dateStr <= end) onLeave.set(e.member, e.type);
    });

    const dayData = (historyData || []).find(d => d.id === dateStr);
    if (dayData && Array.isArray(dayData.onLeaveMembers)) {
        dayData.onLeaveMembers.forEach(e => {
            if (e && e.member && LEAVE_OFF_TYPES.has(e.type) && !onLeave.has(e.member)) {
                onLeave.set(e.member, e.type);
            }
        });
    }

    // 휴무 명단 중 정직원 카운트 대상에 들어있는 사람만 유효
    const onLeaveList = Array.from(onLeave.entries())
        .filter(([m]) => allStaff.has(m))
        .map(([m, t]) => ({ member: m, type: t }));
    let available = 0;
    allStaff.forEach(m => { if (!onLeave.has(m)) available++; });
    return { available, total: allStaff.size, onLeaveList };
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 UI 헬퍼
// ───────────────────────────────────────────────────────────
const setQty = (id, val) => {
    const el = document.getElementById(`sim-qty-${id}`);
    if (!el) return;
    el.value = (val == null || val === 0 || val === '') ? '' : val;
};

/** 한 업무의 대상일 자동값.
 *  ⭐ 우선순위: 업무 기록 및 관리의 '예정 물량' 수기 입력값 > 업무별 자동 추정값
 *  → 예정 물량에 값을 넣으면 시뮬레이션도 즉시 그 값으로 계산된다.
 */
const autoValueFor = (dateStr, task, historyData) => {
    const planned = getPlanned(dateStr, task.key);
    if (planned != null) return planned;

    switch (task.auto) {
        case 'ai':       return getAIPredictedDomestic(historyData, dateStr);
        case 'incoming': return getIncomingChinaForDate(dateStr);
        default:         return computeLast7Avg(historyData, task.key);
    }
};

/** 해당 업무의 대상일 값이 예정 물량(수기 입력)에서 온 것인지 여부 — UI 배지 표시용 */
const isPlannedValue = (dateStr, task) => getPlanned(dateStr, task.key) != null;

const AUTO_BADGE = {
    ai:       { text: 'AI 예측',   cls: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300', tip: '국내배송 AI 추세 예측값' },
    incoming: { text: '입고일정',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',       tip: '대시보드 입고일정에서 도착일 기준 자동 반영' },
    last7:    { text: '지난7회평균', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',        tip: '이 업무가 발생한 최근 7일의 업무량 평균' }
};
const PLANNED_BADGE = {
    text: '예정물량', cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    tip: '업무 기록 및 관리 > 예정 물량에 직접 입력한 값입니다. 자동값보다 우선 적용됩니다.'
};

/** 값의 출처를 행 옆 배지로 표시 (예정물량 수기입력이면 강조) */
const markSourceBadge = (task, fromPlanned) => {
    const el = document.getElementById(`sim-src-${task.id}`);
    if (!el) return;
    const b = fromPlanned ? PLANNED_BADGE : (AUTO_BADGE[task.auto] || AUTO_BADGE.last7);
    el.className = `text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 ${b.cls}`;
    el.textContent = b.text;
    el.title = b.tip;
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 UI 핸들러
// ───────────────────────────────────────────────────────────
const autoFillSimInputs = (dateStr) => {
    if (!dateStr) return;
    const data = State.allHistoryData;
    const config = State.appConfig;

    // 모든 업무가 기본 등록 — 예정 물량이 있으면 그 값, 없으면 업무별 자동값
    SIM_TASKS.forEach(t => {
        setQty(t.id, autoValueFor(dateStr, t, data));
        markSourceBadge(t, isPlannedValue(dateStr, t));
    });

    // 가용 인원
    const staffInfo = computeAvailableStaff(dateStr, config, State.persistentLeaveSchedule, data);
    const elStaff = document.getElementById('sim-staff-fulltime');
    if (elStaff) elStaff.value = staffInfo.available;
    const elLeaveInfo = document.getElementById('sim-on-leave-info');
    if (elLeaveInfo) {
        if (staffInfo.onLeaveList.length > 0) {
            const tags = staffInfo.onLeaveList.map(e => `${e.member}<span class="text-gray-400">(${e.type})</span>`).join(', ');
            elLeaveInfo.innerHTML = `📅 휴무 ${staffInfo.onLeaveList.length}명: ${tags} — 총 ${staffInfo.total}명 중 <strong>${staffInfo.available}명 가용</strong>`;
        } else {
            elLeaveInfo.innerHTML = `📅 등록된 휴무 없음 — 전체 <strong>${staffInfo.total}명 가용</strong>`;
        }
    }
};

const readSimInputs = () => {
    const tasks = {};
    SIM_TASKS.forEach(t => {
        const el = document.getElementById(`sim-qty-${t.id}`);
        tasks[t.key] = Number(el?.value) || 0;
    });
    const staffFulltime = Number(document.getElementById('sim-staff-fulltime')?.value) || 0;
    const staffPart = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
    return { tasks, staffFulltime, staffPart };
};

const simulateOneDay = (dateStr, inputs, taskUPH, config) => {
    const stdHours = config?.standardDailyWorkHours || { weekday: 8, weekend: 4 };
    const weekend = isWeekendDate(dateStr);
    const dailyHours = weekend ? (Number(stdHours.weekend) || 4) : (Number(stdHours.weekday) || 8);

    const taskTimes = {};
    let totalHours = 0;
    SIM_TASKS.forEach(t => {
        const qty = inputs.tasks[t.key] || 0;
        const uph = taskUPH[t.key] || 0;
        const hours = (qty > 0 && uph > 0) ? qty / uph : 0;
        taskTimes[t.key] = { qty, uph, hours };
        totalHours += hours;
    });

    // 필요·가용 인원은 정수로 반올림해 표시·비교 (소수점 없이)
    const rawRequiredFTE = (dailyHours > 0 && UTILIZATION > 0) ? totalHours / dailyHours / UTILIZATION : 0;
    const requiredFTE = Math.round(rawRequiredFTE);
    const availableTotal = Math.round(inputs.staffFulltime + inputs.staffPart);
    const gap = availableTotal - requiredFTE;

    return { date: dateStr, weekend, dailyHours, taskTimes, totalHours, rawRequiredFTE, requiredFTE, availableTotal, gap };
};

const runSimulation = () => {
    const dateEl = document.getElementById('sim-target-date');
    const modeEl = document.getElementById('sim-mode');
    if (!dateEl?.value) { alert('대상일을 선택해주세요.'); return; }
    const baseDate = dateEl.value;
    const mode = modeEl?.value || 'single';

    const baseInputs = readSimInputs();
    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const cfg = State.appConfig;

    const dates = mode === 'batch7'
        ? Array.from({ length: 7 }, (_, i) => addDays(baseDate, i))
        : [baseDate];

    const results = dates.map((d, i) => {
        if (mode === 'single' || i === 0) {
            return simulateOneDay(d, baseInputs, taskUPH, cfg);
        }
        // batch 모드의 2일차 이후: 날짜별 자동값(예정 물량 우선) 사용
        const autoTasks = {};
        SIM_TASKS.forEach(t => {
            autoTasks[t.key] = autoValueFor(d, t, State.allHistoryData);
        });
        const staffInfo = computeAvailableStaff(d, cfg, State.persistentLeaveSchedule, State.allHistoryData);
        const dayInputs = { tasks: autoTasks, staffFulltime: staffInfo.available, staffPart: baseInputs.staffPart };
        return simulateOneDay(d, dayInputs, taskUPH, cfg);
    });

    renderSimResult(results, taskUPH, mode);
};

// ───────────────────────────────────────────────────────────
// 결과 렌더
// ───────────────────────────────────────────────────────────
const gapColor = g => g > 1 ? 'text-green-600 dark:text-green-400' : (g < -1 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400');
const gapIcon  = g => g > 1 ? '✅' : (g < -1 ? '⚠️' : '⚖️');
const gapText  = g => g > 1 ? `${Math.round(g)}명 여유` : (g < -1 ? `${Math.abs(Math.round(g))}명 부족` : '적정');
const fmtH     = h => `${(h || 0).toFixed(1)}h`;

const renderSimResult = (results, taskUPH, mode) => {
    const container = document.getElementById('sim-result-container');
    if (!container) return;

    if (mode === 'single') {
        const r = results[0];
        const rows = SIM_TASKS.map(t => {
            const v = r.taskTimes[t.key];
            if (!v || v.qty <= 0) return '';
            return `<tr class="border-b border-gray-100 dark:border-gray-700">
                <td class="py-1.5 px-2">${t.label}</td>
                <td class="py-1.5 px-2 text-right">${v.qty.toLocaleString()}</td>
                <td class="py-1.5 px-2 text-right">${v.uph > 0 ? v.uph.toFixed(1) : '<span class="text-gray-400">기준 없음</span>'}</td>
                <td class="py-1.5 px-2 text-right font-semibold">${v.uph > 0 ? fmtH(v.hours) : '—'}</td>
            </tr>`;
        }).filter(Boolean).join('');

        container.innerHTML = `
        <div class="bg-white dark:bg-gray-800 p-4 md:p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 depth-panel">
            <div class="flex flex-col md:flex-row md:items-center justify-between mb-3 gap-2">
                <h4 class="text-md font-bold text-gray-800 dark:text-white">🎯 시뮬레이션 결과 — ${dayLabel(r.date)}${r.weekend ? ' <span class="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded ml-1">주말</span>' : ''}</h4>
                <div class="text-[11px] text-gray-500 dark:text-gray-400">기준 UPH: 최근 4주 평균 · 가동률 ${(UTILIZATION*100)|0}% · 1일 ${r.dailyHours}h</div>
            </div>
            <div class="overflow-x-auto mb-4">
                <table class="w-full text-sm">
                    <thead class="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th class="py-2 px-2 text-left">작업</th>
                            <th class="py-2 px-2 text-right">수량 (개)</th>
                            <th class="py-2 px-2 text-right">기준 UPH (개/시)</th>
                            <th class="py-2 px-2 text-right">예상 소요시간</th>
                        </tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="4" class="py-4 text-center text-gray-400">입력된 작업량이 없습니다.</td></tr>'}</tbody>
                    <tfoot class="font-bold bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <td class="py-2 px-2" colspan="3">합계</td>
                            <td class="py-2 px-2 text-right">${fmtH(r.totalHours)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            <div class="grid grid-cols-3 gap-3">
                <div class="bg-blue-50 dark:bg-blue-900/30 p-3 rounded-lg">
                    <div class="text-[10px] text-blue-700 dark:text-blue-400 font-bold uppercase">필요 인원</div>
                    <div class="text-xl md:text-2xl font-black text-blue-700 dark:text-blue-400 mt-1">${r.requiredFTE}<span class="text-sm font-bold ml-0.5">명</span></div>
                    <div class="text-[10px] text-blue-600/70 dark:text-blue-300/70 mt-1">${fmtH(r.totalHours)} ÷ ${r.dailyHours}h ÷ ${UTILIZATION}</div>
                </div>
                <div class="bg-indigo-50 dark:bg-indigo-900/30 p-3 rounded-lg">
                    <div class="text-[10px] text-indigo-700 dark:text-indigo-400 font-bold uppercase">가용 인원</div>
                    <div class="text-xl md:text-2xl font-black text-indigo-700 dark:text-indigo-400 mt-1">${r.availableTotal}<span class="text-sm font-bold ml-0.5">명</span></div>
                    <div class="text-[10px] text-indigo-600/70 dark:text-indigo-300/70 mt-1">정직원 + 알바</div>
                </div>
                <div class="p-3 rounded-lg border-2 ${r.gap > 1 ? 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/30' : (r.gap < -1 ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30' : 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30')}">
                    <div class="text-[10px] font-bold uppercase ${gapColor(r.gap)}">${gapIcon(r.gap)} 결과</div>
                    <div class="text-xl md:text-2xl font-black ${gapColor(r.gap)} mt-1">${gapText(r.gap)}</div>
                </div>
            </div>
        </div>`;
    } else {
        const trows = results.map(r => `
            <tr class="border-b border-gray-100 dark:border-gray-700 ${r.weekend ? 'bg-amber-50/50 dark:bg-amber-900/10' : ''}">
                <td class="py-2 px-2 font-medium">${dayLabel(r.date)}${r.weekend ? ' <span class="text-[10px] bg-amber-100 text-amber-700 px-1 rounded">주말</span>' : ''}</td>
                <td class="py-2 px-2 text-right">${fmtH(r.totalHours)}</td>
                <td class="py-2 px-2 text-right">${r.requiredFTE}명</td>
                <td class="py-2 px-2 text-right">${r.availableTotal}명</td>
                <td class="py-2 px-2 text-right font-bold ${gapColor(r.gap)}">${gapIcon(r.gap)} ${gapText(r.gap)}</td>
            </tr>`).join('');
        const sumRequired = results.reduce((s, r) => s + r.requiredFTE, 0);
        const sumAvail    = results.reduce((s, r) => s + r.availableTotal, 0);
        const shortageDays = results.filter(r => r.gap < -1).length;
        const surplusDays  = results.filter(r => r.gap > 1).length;

        container.innerHTML = `
        <div class="bg-white dark:bg-gray-800 p-4 md:p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 depth-panel">
            <div class="flex flex-col md:flex-row md:items-center justify-between mb-3 gap-2">
                <h4 class="text-md font-bold text-gray-800 dark:text-white">🎯 7일치 일괄 시뮬레이션</h4>
                <div class="text-[11px] text-gray-500 dark:text-gray-400">대상일 외 6일은 자동값 사용 · 알바 ${results[0].availableTotal - (results[0].availableTotal - (Number(document.getElementById('sim-staff-parttimer')?.value)||0))}명 동일 적용</div>
            </div>
            <div class="overflow-x-auto mb-3">
                <table class="w-full text-sm">
                    <thead class="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700/50">
                        <tr>
                            <th class="py-2 px-2 text-left">일자</th>
                            <th class="py-2 px-2 text-right">총 소요</th>
                            <th class="py-2 px-2 text-right">필요</th>
                            <th class="py-2 px-2 text-right">가용</th>
                            <th class="py-2 px-2 text-right">결과</th>
                        </tr>
                    </thead>
                    <tbody>${trows}</tbody>
                </table>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <div class="bg-blue-50 dark:bg-blue-900/30 p-2 rounded text-center">
                    <div class="text-[10px] text-blue-700 dark:text-blue-400 font-bold">합계 필요</div>
                    <div class="text-sm font-bold text-blue-700 dark:text-blue-400">${sumRequired}명·일</div>
                </div>
                <div class="bg-indigo-50 dark:bg-indigo-900/30 p-2 rounded text-center">
                    <div class="text-[10px] text-indigo-700 dark:text-indigo-400 font-bold">합계 가용</div>
                    <div class="text-sm font-bold text-indigo-700 dark:text-indigo-400">${sumAvail}명·일</div>
                </div>
                <div class="bg-red-50 dark:bg-red-900/30 p-2 rounded text-center">
                    <div class="text-[10px] text-red-700 dark:text-red-400 font-bold">⚠️ 부족 일수</div>
                    <div class="text-sm font-bold text-red-700 dark:text-red-400">${shortageDays}일</div>
                </div>
                <div class="bg-green-50 dark:bg-green-900/30 p-2 rounded text-center">
                    <div class="text-[10px] text-green-700 dark:text-green-400 font-bold">✅ 여유 일수</div>
                    <div class="text-sm font-bold text-green-700 dark:text-green-400">${surplusDays}일</div>
                </div>
            </div>
        </div>`;
    }
};

// ───────────────────────────────────────────────────────────
// 업무 예상 — 오늘·내일 자동 요약 예측
// ───────────────────────────────────────────────────────────
/** 대상일의 자동 추정 입력값(DOM 미의존). AI 국내배송 + 7일평균 + 입고일정 중국제작 + 휴무 반영 가용인원. */
const computeAutoInputsForDate = (dateStr) => {
    const data = State.allHistoryData;
    const cfg = State.appConfig;
    // 우선순위: 예정 물량(수기 입력) > 업무별 자동값
    const tasks = {};
    SIM_TASKS.forEach(t => { tasks[t.key] = autoValueFor(dateStr, t, data); });
    const staffInfo = computeAvailableStaff(dateStr, cfg, State.persistentLeaveSchedule, data);
    return { tasks, staffFulltime: staffInfo.available, staffPart: 0, staffInfo };
};

/** 📅 예정 물량 입력 화면 프리필용 — 해당 날짜의 자동 추정 물량(예정 수기값은 제외).
 *  시뮬레이션이 쓰는 것과 완전히 같은 계산(지난 7회 평균 등)을 사용하므로,
 *  예정 물량 화면과 시뮬레이션의 기본값이 항상 일치한다.
 */
export const getAutoQuantitiesForDate = (dateStr) => {
    const data = State.allHistoryData;
    const out = {};
    SIM_TASKS.forEach(t => {
        let v;
        if (t.auto === 'ai') v = getAIPredictedDomestic(data, dateStr);
        else if (t.auto === 'incoming') v = getIncomingChinaForDate(dateStr);
        else v = computeLast7Avg(data, t.key);
        if (v > 0) out[t.key] = Math.round(v);
    });
    return out;
};

const forecastCardHtml = (label, r, inputs) => {
    const gap = r.gap;
    const toneBox = gap > 1 ? 'border-green-200 dark:border-green-800 bg-green-50/60 dark:bg-green-900/20'
        : (gap < -1 ? 'border-red-200 dark:border-red-800 bg-red-50/60 dark:bg-red-900/20'
        : 'border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/20');
    const china = inputs.tasks['중국제작'] || 0;
    const chinaChip = china > 0
        ? `<span class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">🚚 중국제작 입고 ${china.toLocaleString()}개</span>`
        : '';
    const staffN = inputs.staffInfo ? inputs.staffInfo.available : r.availableTotal;
    return `
    <div class="rounded-xl border ${toneBox} p-4 md:p-5 shadow-sm depth-panel">
        <div class="flex items-center justify-between mb-3 gap-2">
            <div class="flex items-center gap-2 min-w-0">
                <span class="text-sm font-black text-gray-800 dark:text-white shrink-0">${label}</span>
                <span class="text-xs text-gray-500 dark:text-gray-400 truncate">${dayLabel(r.date)}</span>
                ${r.weekend ? '<span class="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">주말</span>' : ''}
            </div>
            <span class="text-xs font-bold ${gapColor(gap)} shrink-0">${gapIcon(gap)} ${gapText(gap)}</span>
        </div>
        <div class="grid grid-cols-2 gap-3 mb-3">
            <div class="bg-white/70 dark:bg-gray-800/60 rounded-lg p-3 text-center border border-gray-100 dark:border-gray-700">
                <div class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">필요 인원</div>
                <div class="text-2xl font-black text-gray-900 dark:text-white mt-0.5">${r.requiredFTE}<span class="text-xs font-bold ml-0.5">명</span></div>
            </div>
            <div class="bg-white/70 dark:bg-gray-800/60 rounded-lg p-3 text-center border border-gray-100 dark:border-gray-700">
                <div class="text-[10px] font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wide">가용 인원</div>
                <div class="text-2xl font-black text-gray-900 dark:text-white mt-0.5">${Math.round(staffN)}<span class="text-xs font-bold ml-0.5">명</span></div>
            </div>
        </div>
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[11px] text-gray-500 dark:text-gray-400">
            <span>총 소요 <b class="text-gray-700 dark:text-gray-200">${fmtH(r.totalHours)}</b></span>
            <span class="text-gray-300 dark:text-gray-600">·</span>
            <span>1일 ${r.dailyHours}h · 가동률 ${(UTILIZATION*100)|0}%</span>
            ${chinaChip ? `<span class="w-full"></span>${chinaChip}` : ''}
        </div>
    </div>`;
};

/** 오늘·내일 자동 예측 2개 카드 렌더 */
const renderForecastSummary = () => {
    const el = document.getElementById('forecast-summary-cards');
    if (!el) return;
    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const cfg = State.appConfig;
    const today = getTodayDateString();
    const days = [{ label: '오늘', date: today }, { label: '내일', date: addDays(today, 1) }];
    el.innerHTML = days.map(({ label, date }) => {
        const inputs = computeAutoInputsForDate(date);
        const r = simulateOneDay(date, inputs, taskUPH, cfg);
        return forecastCardHtml(label, r, inputs);
    }).join('');
};

/** '업무 예상' 탭 진입 시 호출: 시뮬레이션 리스너 결합 + 오늘/내일 요약 + 상세 자동값 채움 */
export const renderForecastTab = () => {
    setupSimulationListeners();

    const dateEl = document.getElementById('sim-target-date');
    if (dateEl && !dateEl.value) dateEl.value = getTodayDateString();
    autoFillSimInputs(dateEl?.value);
    renderForecastSummary();

    // 예정 물량이 아직 안 실렸으면 로드 후 다시 채움(캐시라 대부분 즉시)
    fetchPlannedData().then(() => {
        autoFillSimInputs(document.getElementById('sim-target-date')?.value);
        renderForecastSummary();
    }).catch(() => {});

    const rBtn = document.getElementById('forecast-refresh-btn');
    if (rBtn && !rBtn.dataset.bound) {
        rBtn.dataset.bound = 'true';
        rBtn.addEventListener('click', () => {
            autoFillSimInputs(document.getElementById('sim-target-date')?.value);
            renderForecastSummary();
        });
    }
};

const setupSimulationListeners = () => {
    const runBtn = document.getElementById('sim-run-btn');
    if (!runBtn) return; // panel not in DOM yet
    if (runBtn.dataset.simSetup === 'true') return; // already wired
    runBtn.dataset.simSetup = 'true';

    const dateEl = document.getElementById('sim-target-date');
    if (dateEl) {
        if (!dateEl.value) {
            // 기본값: 오늘 (요약 카드에서 오늘·내일을 함께 보여주므로 상세는 오늘 기준)
            dateEl.value = getTodayDateString();
        }
        dateEl.addEventListener('change', () => autoFillSimInputs(dateEl.value));
    }
    document.getElementById('sim-autofill-btn')?.addEventListener('click', () => autoFillSimInputs(dateEl?.value));
    runBtn.addEventListener('click', runSimulation);

    document.getElementById('sim-reset-btn')?.addEventListener('click', () => {
        // 모든 수량/인원 입력 초기화 (업무 목록은 항상 기본 등록이므로 숨기지 않음)
        SIM_TASKS.forEach(t => setQty(t.id, ''));
        ['sim-staff-fulltime','sim-staff-parttimer'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const resEl = document.getElementById('sim-result-container');
        if (resEl) resEl.innerHTML = '';
    });

    // 초기 자동 채우기
    autoFillSimInputs(dateEl?.value);
};

const predictionCharts = {
    revenue: null,
    delivery: null
};

// ───────────────────────────────────────────────────────────
// 🔀 채널 선택 — 실적 예측 전체(KPI·오늘 진행률·차트)를 한 채널 기준으로 계산한다.
//   '전체'는 총계(모든 채널 합), 개별 채널은 그 채널의 매출·주문건수·배송량만 사용.
//   예) 일반배송(카페24) = 국내배송 물량 + 카페24 매출/주문건
// ───────────────────────────────────────────────────────────
let predChannelId = 'all';
const predScope = () => channelScope(predChannelId === 'all' ? null : predChannelId);

const renderChannelTabs = (historyData) => {
    const host = document.getElementById('pred-channel-tabs');
    const note = document.getElementById('pred-channel-note');
    if (!host) return;

    const opts = [{ id: 'all', label: '전체' }, ...REVENUE_CHANNELS.map(c => ({ id: c.id, label: c.label }))];
    host.innerHTML = opts.map(o => {
        const on = o.id === predChannelId;
        return `<button type="button" data-pred-channel="${o.id}"
            class="px-3 py-1.5 border-r border-gray-200 dark:border-gray-600 last:border-r-0 ${on
                ? 'bg-indigo-600 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'}">${o.label}</button>`;
    }).join('');

    const sc = predScope();
    if (note) {
        note.textContent = predChannelId === 'all'
            ? `매출·주문건수는 전체 합계, 배송량은 ${sc.deliverySource} 합계 기준`
            : `매출·주문건수는 ${sc.label}, 배송량은 ${sc.deliverySource} 물량 기준`;
    }

    if (host.dataset.bound !== 'true') {
        host.dataset.bound = 'true';
        host.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-pred-channel]');
            if (!btn) return;
            predChannelId = btn.dataset.predChannel;
            renderPredictionTab(State.allHistoryData);
        });
    }
};

// 💡 장(상품수)을 건수(주문건수)로 변환하여 "건 / 장" 포맷으로 반환하는 헬퍼 함수 (1.2 기준)
// 배송량은 '장(상품수)' 그대로 표시한다.
// 예전에는 ÷1.2로 건수를 추정해 병기했지만, 이제 주문 건수를 채널별로 직접 입력받으므로
// 추정치를 함께 보여주면 실제 주문건수 카드와 값이 달라 혼동만 준다.
const formatDelivery = (val) => `${Math.round(Number(val) || 0).toLocaleString()}장`;

export const renderPredictionTab = (historyData, daysToPredict = 14) => {
    // (업무량 시뮬레이션은 '업무 예상' 탭(renderForecastTab)으로 이동됨)
    const revenueCtx = document.getElementById('chart-prediction-revenue');
    const deliveryCtx = document.getElementById('chart-prediction-delivery');

    if (!revenueCtx || !deliveryCtx) return;

    const selectEl = document.getElementById('prediction-days-select');
    if (selectEl) {
        daysToPredict = parseInt(selectEl.value, 10);
    }

    // 🔀 선택된 채널 기준으로 매출·주문건수·배송량을 모두 계산한다.
    const scope = predScope();
    renderChannelTabs(historyData);

    const result = predictFutureTrends(historyData, daysToPredict, scope);

    // 차트 제목에 현재 기준 표시
    const scopeSuffix = predChannelId === 'all' ? '(전체 합계)' : `(${scope.label})`;
    const revScopeEl = document.getElementById('pred-chart-rev-scope');
    const delScopeEl = document.getElementById('pred-chart-del-scope');
    if (revScopeEl) revScopeEl.textContent = scopeSuffix;
    if (delScopeEl) delScopeEl.textContent = predChannelId === 'all' ? '(전체 합계)' : `(${scope.deliverySource})`;

    if (!result) {
        renderNoData(revenueCtx, "데이터가 부족하여 예측할 수 없습니다.");
        renderNoData(deliveryCtx, "데이터가 부족하여 예측할 수 없습니다.");
        updateKPICards(null, null, daysToPredict);
        return;
    }

    const { historical, prediction, trend } = result;

    const splitIndex = historical.labels.length;
    const allLabels = [...historical.labels, ...prediction.labels];

    // ✨ 범위(range) 데이터를 함께 넘겨주어 신뢰 구간을 그리도록 수정
    renderChart('revenue', revenueCtx, allLabels, historical.revenue, prediction.revenue, prediction.rangeRevenue, splitIndex, '매출 (원)', 'rgb(79, 70, 229)');
    renderChart('delivery', deliveryCtx, allLabels, historical.delivery, prediction.delivery, prediction.rangeDelivery, splitIndex, '배송량 (장)', 'rgb(16, 185, 129)');

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

    const elTodayEstOrd = document.getElementById('pred-today-est-ord');
    const elTodayActOrd = document.getElementById('pred-today-act-ord');
    const elTodayOrdBar = document.getElementById('pred-today-ord-bar');
    const elErrorText = document.getElementById('pred-error-rate-text');

    // Tomorrow & Period UI
    const elTomRev = document.getElementById('pred-tomorrow-revenue');
    const elTomDel = document.getElementById('pred-tomorrow-delivery');
    const elTomOrd = document.getElementById('pred-tomorrow-ordercount');
    const elPerAvgRev = document.getElementById('pred-period-avg-revenue');
    const elPerAvgDel = document.getElementById('pred-period-avg-delivery');
    const elPerAvgOrd = document.getElementById('pred-period-avg-ordercount');
    const elPeriodLabel = document.getElementById('pred-period-label');
    const elRevTrend = document.getElementById('pred-revenue-trend');
    const elDelTrend = document.getElementById('pred-delivery-trend');
    const elOrdTrend = document.getElementById('pred-ordercount-trend');

    if (!prediction) {
        [elTomRev, elTomDel, elTomOrd, elPerAvgRev, elPerAvgDel, elPerAvgOrd]
            .forEach(el => { if (el) el.textContent = '-'; });
        return;
    }

    const { today, tomorrow, revenue, delivery, orderCount } = prediction;

    // 1. 당일 실적 추적 모니터링 업데이트
    if (today) {
        if (elTodayEstRev) elTodayEstRev.textContent = today.predictedRev.toLocaleString();
        if (elTodayActRev) elTodayActRev.textContent = today.actualRev.toLocaleString();
        if (elTodayRevBar) {
            const revPct = today.predictedRev > 0 ? Math.min(100, (today.actualRev / today.predictedRev) * 100) : 0;
            elTodayRevBar.style.width = `${revPct}%`;
        }

        if (elTodayEstDel) elTodayEstDel.textContent = formatDelivery(today.predictedDel);
        if (elTodayActDel) elTodayActDel.textContent = formatDelivery(today.actualDel);
        if (elTodayDelBar) {
            const delPct = today.predictedDel > 0 ? Math.min(100, (today.actualDel / today.predictedDel) * 100) : 0;
            elTodayDelBar.style.width = `${delPct}%`;
        }

        if (elTodayEstOrd) elTodayEstOrd.textContent = `${(today.predictedOrd || 0).toLocaleString()}건`;
        if (elTodayActOrd) elTodayActOrd.textContent = `${(today.actualOrd || 0).toLocaleString()}건`;
        if (elTodayOrdBar) {
            const ordPct = today.predictedOrd > 0 ? Math.min(100, (today.actualOrd / today.predictedOrd) * 100) : 0;
            elTodayOrdBar.style.width = `${ordPct}%`;
        }

        if (elErrorText) {
            const revFactorPct = ((today.errorFactorRev - 1) * 100).toFixed(1);
            const delFactorPct = ((today.errorFactorDel - 1) * 100).toFixed(1);
            const revColor = revFactorPct >= 0 ? 'text-red-500' : 'text-blue-500';
            const delColor = delFactorPct >= 0 ? 'text-red-500' : 'text-blue-500';
            
            elErrorText.innerHTML = `최근 14일 오차율을 분석하여 예측치에 <br/>매출 <strong class="${revColor}">${revFactorPct > 0 ? '+'+revFactorPct : revFactorPct}%</strong>, 배송 <strong class="${delColor}">${delFactorPct > 0 ? '+'+delFactorPct : delFactorPct}%</strong> 자동 보정 반영됨.`;
        }
    }

    // 2. 내일 예측 및 기간 평균 업데이트 (✨ 범위 텍스트 추가됨)
    const avgRev = revenue.reduce((a,b)=>a+b,0) / revenue.length;
    const avgDel = delivery.reduce((a,b)=>a+b,0) / delivery.length;
    const ordSeries = orderCount || [];
    const avgOrd = ordSeries.length ? ordSeries.reduce((a,b)=>a+b,0) / ordSeries.length : 0;

    if (elTomRev) {
        if (tomorrow.revenue > 0) {
            const minRev = prediction.rangeRevenue[0].min;
            const maxRev = prediction.rangeRevenue[0].max;
            elTomRev.innerHTML = `${tomorrow.revenue.toLocaleString()} <span class="text-[11px] text-gray-500 font-normal ml-1">(최소 ${minRev.toLocaleString()} ~ 최대 ${maxRev.toLocaleString()})</span>`;
        } else {
            elTomRev.textContent = '휴무(0)';
        }
    }
    
    if (elTomDel) {
        if (tomorrow.delivery > 0) {
            const minDel = prediction.rangeDelivery[0].min;
            const maxDel = prediction.rangeDelivery[0].max;
            elTomDel.innerHTML = `${formatDelivery(tomorrow.delivery)} <span class="text-[11px] text-gray-500 font-normal ml-1 mt-1 block md:inline">(최소 ${minDel.toLocaleString()} ~ 최대 ${maxDel.toLocaleString()}장)</span>`;
        } else {
            elTomDel.textContent = '휴무(0)';
        }
    }
    
    if (elTomOrd) {
        if (tomorrow.orderCount > 0) {
            const r = (prediction.rangeOrderCount && prediction.rangeOrderCount[0]) || { min: 0, max: 0 };
            elTomOrd.innerHTML = `${tomorrow.orderCount.toLocaleString()}건 <span class="text-[11px] text-gray-500 font-normal ml-1">(최소 ${r.min.toLocaleString()} ~ 최대 ${r.max.toLocaleString()})</span>`;
        } else {
            elTomOrd.textContent = '휴무(0)';
        }
    }

    if (elPerAvgRev) elPerAvgRev.textContent = Math.round(avgRev).toLocaleString();
    if (elPerAvgDel) elPerAvgDel.textContent = formatDelivery(avgDel);
    if (elPerAvgOrd) elPerAvgOrd.textContent = `${Math.round(avgOrd).toLocaleString()}건`;
    if (elPeriodLabel) elPeriodLabel.textContent = `향후 ${daysToPredict}일 기준`;

    // 3. 장기 추세 안내 텍스트
    if (elRevTrend && trend) {
        const factor = trend.revenueFactor;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '📈'; trendText = `최근 매출 꾸준한 상승세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📉'; trendText = `최근 매출 하락세 주의`; color = 'text-blue-500'; }
        elRevTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }

    if (elOrdTrend && trend) {
        const factor = trend.orderCountFactor || 1;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '🧾📈'; trendText = `최근 주문건수 증가 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '🧾📉'; trendText = `최근 주문건수 감소 추세`; color = 'text-blue-500'; }
        elOrdTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }

    if (elDelTrend && trend) {
        const factor = trend.deliveryFactor;
        let trendIcon = '➡️', trendText = '보합세 유지 중', color = 'text-blue-500';
        if (factor > 1.05) { trendIcon = '📦📈'; trendText = `최근 배송량 증가 추세`; color = 'text-red-500'; }
        else if (factor < 0.95) { trendIcon = '📦📉'; trendText = `최근 배송량 감소 추세`; color = 'text-blue-500'; }
        elDelTrend.innerHTML = `${trendIcon} <span class="${color} font-bold">${trendText}</span>`;
    }
};

// ✨ 신뢰 구간 범위를 포함하여 렌더링하도록 수정
const renderChart = (key, ctx, labels, histData, predData, predRangeData, splitIndex, label, color) => {
    if (predictionCharts[key]) {
        predictionCharts[key].destroy();
    }

    // 1. 과거 실적 데이터
    const historicalDataset = histData.map((v, i) => i < splitIndex ? v : null);
    
    // 2. 예측 평균 데이터 (선이 이어지도록 스플릿 인덱스 처리)
    const predictionDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predData[i - splitIndex];
        return null;
    });

    // 3. 예측 최대치 데이터 (신뢰 구간의 상단)
    const predictionMaxDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predRangeData[i - splitIndex]?.max || predData[i - splitIndex];
        return null;
    });

    // 4. 예측 최소치 데이터 (신뢰 구간의 하단)
    const predictionMinDataset = labels.map((_, i) => {
        if (i === splitIndex - 1) return histData[splitIndex - 1]; 
        if (i >= splitIndex) return predRangeData[i - splitIndex]?.min || predData[i - splitIndex];
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
                    label: '예측 최대치',
                    data: predictionMaxDataset,
                    borderColor: 'transparent',
                    backgroundColor: color.replace(')', ', 0.15)').replace('rgb', 'rgba'), // 옅은 색상 영역
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.3,
                    fill: '+1' // 🔥 하단(최소치) 라인까지 영역을 색칠함 (신뢰 구간 형성)
                },
                {
                    label: '예측 최소치',
                    data: predictionMinDataset,
                    borderColor: 'transparent',
                    backgroundColor: 'transparent',
                    borderWidth: 0,
                    pointRadius: 0,
                    pointHoverRadius: 0,
                    tension: 0.3,
                    fill: false
                },
                {
                    label: '예측 평균 (AI)',
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
                    labels: { 
                        boxWidth: 12, 
                        usePointStyle: true,
                        // ✨ 범례가 지저분해지지 않도록 최대치/최소치 항목은 숨김
                        filter: function(item) {
                            return !item.text.includes('최대치') && !item.text.includes('최소치');
                        }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) label += ': ';
                            if (context.parsed.y !== null) {
                                const val = Math.round(context.parsed.y);
                                if (key === 'delivery') {
                                    const cases = Math.round(val / 1.2);
                                    label += `${cases.toLocaleString()}건 / ${val.toLocaleString()}장`;
                                } else {
                                    label += val.toLocaleString();
                                }
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