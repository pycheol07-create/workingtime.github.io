// === js/ui-history-prediction.js ===
// 설명: '실적 예측' 탭(매출/배송 AI 차트) + '업무 예상' 탭(오늘·내일 자동 예측 + 업무량 시뮬레이션).
//  - renderPredictionTab: 실적 예측 탭 (차트/KPI)
//  - renderForecastTab: 업무 예상 탭 (시뮬레이션·요약 카드)

import { predictFutureTrends } from './analysis-logic.js?v=202609041043';
import { REVENUE_CHANNELS, channelScope } from './revenue-channels.js?v=202609041043';
import * as State from './state.js?v=202609041043';
import { getTodayDateString, getRegularMembersForCount, showToast } from './utils.js?v=202609041043';
import { getIncomingQtyByDateFromCache } from './widget-incoming-schedule.js?v=202609041043';
import { getPlannedQuantitiesForDate, getPlannedTimeTasksForDate, getPlannedExcludeMinutesForDate,
         fetchPlannedData, savePlannedQuantities } from './history-data-manager.js?v=202609041043';

/** 해당 날짜·작업의 예정 물량(수동 입력값). 없으면 null → 자동 추정값으로 폴백.
 *  0도 '0으로 하기로 한 값'이므로 그대로 인정한다(키가 아예 없을 때만 자동값). */
const getPlanned = (dateStr, taskKey) => {
    const p = getPlannedQuantitiesForDate(dateStr) || {};
    if (!Object.prototype.hasOwnProperty.call(p, taskKey)) return null;
    const v = Number(p[taskKey]);
    return Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
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
// 자동값 규칙: ai=국내배송 예측 / incoming=입고일정 / china-linked=중국제작 입고량×검수비율
//              last7=지난 7회 업무량 평균
// 어느 경우든 '예정 물량'에 수기 입력값이 있으면 그 값이 최우선이다.
const SIM_TASKS = [
    { id: 'domestic', key: '국내배송', label: '국내배송', auto: 'ai' },
    { id: 'china',    key: '중국제작', label: '중국제작', auto: 'incoming' },
    { id: 'sample',   key: '샘플검수', label: '샘플검수', auto: 'china-linked' },
    { id: 'direct',   key: '직진배송', label: '직진배송', auto: 'cadence' },
    { id: 'ably',     key: '에이블리배송', label: '에이블리배송', auto: 'cadence' },
    // 채우기는 요일이나 주기가 아니라 재고 상황에 따라 하는 업무다.
    // 요일·주기 판정은 '그날은 0' 처럼 딱 떨어지게 잡아 실제와 어긋나므로 쓰지 않고,
    // 진행 빈도만 반영한다(기간 총량이 맞는 쪽으로).
    { id: 'fill',     key: '채우기',   label: '채우기',   auto: 'cadence', skip: ['weekday', 'interval'] },
    { id: 'return',   key: '교환반품', label: '교환반품', auto: 'last7' },
    { id: 'full',     key: '전량검수', label: '전량검수', auto: 'last7' },
    { id: 'other',    key: '국내기타', label: '국내기타', auto: 'last7' },
    { id: 'localprod',key: '국내제작', label: '국내제작', auto: 'last7' }
];
// 입력 칸을 성격별로 묶어 보여준다(10개를 한 덩어리로 늘어놓으면 읽기 어렵다).
const SIM_GROUPS = [
    { label: '출고',      ids: ['domestic', 'direct', 'ably'] },
    { label: '입고 · 제작', ids: ['china', 'sample', 'localprod'] },
    { label: '그 외 작업',  ids: ['fill', 'return', 'full', 'other'] }
];

// ⏳ '시간으로 잡는 업무' — 처리량(개수)이 없고 얼마나 오래 붙어 있었나로만 남는 업무.
//    UPH를 낼 수 없으므로 수량 대신 '투입시간(분)'으로 넣고, 그 시간을 총 소요시간에 더한다.
//    목록을 코드에 박지 않고, 실제 업무 기록에서 '자주·오래 하는 순서'로 뽑는다.
//    (관리자 설정에 simTimeTasks 배열이 있으면 그 목록을 그대로 쓴다)
let SIM_TIME_TASKS = [];

const TIME_TASK_MAX = 6;              // 화면에 세울 최대 항목 수
const TIME_TASK_MIN_AVG_MIN = 10;     // 근무일 1일 평균 10분 미만이면 뺀다(잡음 제거)
// 근태로 이미 가용 인원에서 빠지는 항목 · 시뮬레이션 대상이 아닌 항목
const TIME_TASK_EXCLUDE = new Set(['매장근무', '출장', '연차', '휴직', '결근', '교육']);

/** 업무 기록에서 시간형 업무 후보를 뽑는다 — 수량으로 잡히는 업무는 제외(그쪽은 UPH로 계산). */
const buildTimeTaskList = (historyData, appConfig, windowDays = 56) => {
    const manual = appConfig?.simTimeTasks;
    const qtyKeys = new Set([
        ...SIM_TASKS.map(t => t.key),
        ...(appConfig?.quantityTaskTypes || [])
    ]);

    const toEntry = (key, i) => ({ id: `tt${i}`, key, label: key });
    if (Array.isArray(manual) && manual.length > 0) {
        return manual.filter(k => k && !qtyKeys.has(k)).slice(0, TIME_TASK_MAX).map(toEntry);
    }

    const today = getTodayDateString();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffStr = ymd(cutoff);
    const days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id >= cutoffStr && d.id <= today)
        .filter(d => (d.workRecords || []).length > 0);
    if (days.length === 0) return [];

    // 업무별 총 투입시간 · 진행 일수
    const agg = new Map();
    days.forEach(d => {
        const seen = new Set();
        (d.workRecords || []).forEach(r => {
            const key = r && r.task;
            if (!key || qtyKeys.has(key) || TIME_TASK_EXCLUDE.has(key)) return;
            const cur = agg.get(key) || { minutes: 0, days: 0 };
            cur.minutes += Number(r.duration) || 0;
            if (!seen.has(key)) { cur.days += 1; seen.add(key); }
            agg.set(key, cur);
        });
    });

    return [...agg.entries()]
        .map(([key, v]) => ({ key, avg: v.minutes / days.length, days: v.days, minutes: v.minutes }))
        .filter(x => x.avg >= TIME_TASK_MIN_AVG_MIN)
        .sort((a, b) => b.minutes - a.minutes)      // 오래 걸리는 업무부터
        .slice(0, TIME_TASK_MAX)
        .map((x, i) => toEntry(x.key, i));
};

/** 시간형 업무 목록 갱신. 목록이 바뀌면 true (입력칸을 다시 그려야 한다) */
const refreshTimeTasks = () => {
    const next = buildTimeTaskList(State.allHistoryData, State.appConfig);
    const sig = (arr) => arr.map(t => t.key).join('|');
    if (sig(next) === sig(SIM_TIME_TASKS)) return false;
    SIM_TIME_TASKS = next;
    return true;
};

/** 저장해 둔 시간형 업무 값(수기). 없으면 null → 실적 평균으로 폴백 */
const getPlannedTime = (dateStr, taskKey) => {
    const m = getPlannedTimeTasksForDate(dateStr) || {};
    if (!Object.prototype.hasOwnProperty.call(m, taskKey)) return null;
    const e = m[taskKey] || {};
    const minutes = Math.round(Number(e.minutes));
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return { minutes, workers: Math.max(1, Math.round(Number(e.workers) || 1)) };
};

const LEAVE_OFF_TYPES = new Set(['연차', '결근', '휴직', '출장', '매장근무']);
const UTILIZATION = 0.8;
// 업무 제외시간 입력 단위(분)
const EXCLUDE_STEP_MIN = 10;

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

/** 샘플검수 비율 = 최근 4주에서 중국제작 > 0 인 날들의 (Σ샘플검수 ÷ Σ중국제작).
 *  중국제작 입고가 있는 날에만 샘플검수가 생기므로, 그 비율로 입고량에서 역산한다. */
const computeSampleRatio = (historyData) => {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 28);
    const cutoffStr = ymd(cutoff);
    const recent = (historyData || []).filter(d => typeof d.id === 'string' && d.id >= cutoffStr);
    let chinaSum = 0, sampleSum = 0;
    recent.forEach(d => {
        const china = Number(d.taskQuantities?.['중국제작']) || 0;
        if (china > 0) {
            chinaSum += china;
            sampleSum += Number(d.taskQuantities?.['샘플검수']) || 0;
        }
    });
    return chinaSum > 0 ? sampleSum / chinaSum : 0;
};

/** ⏳ 시간형 업무의 실적 통계 — 최근 4주(근무 기록이 있는 날)의 실제 투입시간.
 *   avgMinutes : 근무일 1일 평균 투입시간(인분). 일이 없던 날의 0도 포함해 평균낸다
 *                — 매일 하는 일이 아니어도 기간 총량이 맞도록.
 *   workers    : 그 업무를 한 날의 평균 투입 인원(동시에 몇 명이 붙는지)
 *   maxMinutes : 가장 많이 쓴 날 (편차를 알려주기 위한 참고값)
 */
const computeTimeTaskStats = (historyData, taskKey, windowDays = 28, dayFilter = null) => {
    const today = getTodayDateString();
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - windowDays);
    const cutoffStr = ymd(cutoff);
    let days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id >= cutoffStr && d.id <= today)
        .filter(d => (d.workRecords || []).length > 0);
    // 연동 업무가 있는 날에만 생기는 업무는 그런 날만 모아 평균을 낸다
    // (전체 근무일로 나누면 '입고 있는 날'의 실제 소요보다 훨씬 작게 나온다)
    if (typeof dayFilter === 'function') days = days.filter(dayFilter);
    if (days.length === 0) return null;

    let sumMin = 0, hitDays = 0, maxMin = 0, workerSum = 0, perPersonSum = 0;
    days.forEach(d => {
        let m = 0;
        const members = new Set();
        (d.workRecords || []).forEach(r => {
            if (!r || r.task !== taskKey) return;
            m += Number(r.duration) || 0;
            if (r.member) members.add(r.member);
        });
        sumMin += m;
        if (m > 0) {
            const n = Math.max(1, members.size);
            hitDays++; maxMin = Math.max(maxMin, m / n); workerSum += n;
            perPersonSum += m / n;               // 그날 '1인이 쓴 시간'
        }
    });

    if (hitDays === 0) return { avgMinutes: 0, teamMinutes: 0, workers: 1, hitDays: 0, sampleDays: days.length, maxMinutes: 0 };
    const r10 = (x) => Math.round(x / 10) * 10;
    return {
        // 입력 단위는 '1인 기준' — 여러 명이 나눠 한 날도 한 사람이 쓴 시간으로 환산한다
        avgMinutes: r10(perPersonSum / days.length),
        teamMinutes: r10(sumMin / days.length),       // 참고: 팀 전체 합계(인분)
        workers: Math.max(1, Math.round(workerSum / hitDays)),
        hitDays, sampleDays: days.length,
        maxMinutes: Math.round(maxMin)
    };
};

/** 대상일의 시간형 업무 값 — 저장한 수기값 › 실적 평균 */
/** 🔗 물량 업무와 묶인 담당 업무 — 그 물량이 있는 날에만 생긴다.
 *  (중국제작 입고가 없으면 '중국제작(담당)'도 없고, 직진·에이블리 출고가 없으면 사전작업도 없다)
 *  관리자 설정 simTimeTaskDeps 로 덮어쓸 수 있고, 없으면 업무명에 물량 업무명이 들어간 경우를 자동으로 잇는다.
 */
const DEFAULT_TIME_TASK_DEPS = {
    '중국제작(담당)': ['중국제작'],
    '직진배송 사전작업': ['직진배송', '에이블리배송']
};

const timeTaskDeps = (taskKey) => {
    const cfg = State.appConfig?.simTimeTaskDeps;
    if (cfg && Array.isArray(cfg[taskKey])) return cfg[taskKey];
    if (DEFAULT_TIME_TASK_DEPS[taskKey]) return DEFAULT_TIME_TASK_DEPS[taskKey];
    // 이름에 물량 업무명이 들어 있으면 그 업무와 묶는다 (예: 'OO 사전작업', 'OO(담당)')
    const hit = SIM_TASKS.find(t => taskKey !== t.key && taskKey.includes(t.key));
    return hit ? [hit.key] : [];
};

/** 대상일의 담당 업무 값 — 저장값 › (연동 물량이 있을 때만) 실적 평균
 *  qtyLookup: 연동 물량을 어디서 볼지. 기본은 자동 추정값, 화면에서는 지금 입력된 값. */
const autoTimeValueFor = (dateStr, t, historyData, qtyLookup = null) => {
    const saved = getPlannedTime(dateStr, t.key);
    if (saved) return { ...saved, source: 'planned-time' };

    const deps = timeTaskDeps(t.key);
    const lookup = qtyLookup || ((key) => {
        const task = SIM_TASKS.find(x => x.key === key);
        return task ? autoQtyFor(dateStr, task, historyData) : 0;
    });

    let dayFilter = null;
    if (deps.length > 0) {
        const hasDep = deps.some(k => (Number(lookup(k)) || 0) > 0);
        if (!hasDep) {
            return { minutes: 0, workers: 1, source: 'record-avg',
                     detail: `${deps.join(' · ')} 물량이 없는 날이라 0으로 둡니다.` };
        }
        dayFilter = (d) => deps.some(k => (Number(d.taskQuantities?.[k]) || 0) > 0);
    }

    const st = computeTimeTaskStats(historyData, t.key, 28, dayFilter);
    if (!st) return { minutes: 0, workers: 1, source: 'record-avg', detail: '최근 4주 기록 없음' };
    // 시간·인원 모두 1명 기준 — 여러 명이 붙는 업무는 화면에서 동시 인원을 올린다
    return {
        minutes: st.avgMinutes, workers: 1, source: 'record-avg',
        detail: (deps.length > 0 ? `${deps.join(' · ')} 있는 날 기준 · ` : '')
              + `${st.sampleDays}일 중 ${st.hitDays}일 진행 · 1인 기준 평균 ${st.avgMinutes}분`
              + ` (가장 많은 날 ${Math.round(st.maxMinutes)}분)`
              + ` · 실적은 평균 ${st.workers}명이 하루 ${st.teamMinutes}분(팀 합계)`
              + ` — 인원을 올리면 각자 이 시간만큼 더 들어갑니다`
    };
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

/** 🗓️ '언제 하는 업무인가' 분석 — 매일 하지 않는 업무의 예상치를 바로잡는다.
 *
 *  기존 방식(지난 7회 평균)은 '발생한 날'만 골라 평균을 낸 뒤 그 값을 매일 넣었다.
 *  3일에 한 번 하는 업무라면 예상 총량이 3배가 된다.
 *  그래서 얼마나 자주·어느 요일에 했는지를 같이 본다.
 *
 *  모집단은 '근무 기록이 있는 날'만 쓴다. 휴무일을 미발생으로 세면 빈도가 낮게 나온다.
 */
const analyzeCadence = (historyData, taskKey, windowWorkDays = 56) => {
    const today = getTodayDateString();
    const days = (historyData || [])
        .filter(d => d && typeof d.id === 'string' && d.id <= today)
        .filter(d => (d.workRecords || []).length > 0)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, windowWorkDays)
        .sort((a, b) => a.id.localeCompare(b.id));      // 오래된 → 최신

    const byWd = Array.from({ length: 7 }, () => ({ total: 0, hit: 0, sum: 0 }));
    const hitDates = [];
    let hits = 0, sum = 0;

    days.forEach(d => {
        const wd = new Date(d.id + 'T00:00:00').getDay();
        if (isNaN(wd)) return;
        byWd[wd].total++;
        const q = Number(d.taskQuantities?.[taskKey]) || 0;
        if (q > 0) {
            byWd[wd].hit++; byWd[wd].sum += q;
            hits++; sum += q;
            hitDates.push(d.id);
        }
    });

    if (hits === 0) return null;
    const avgQty = Math.round(sum / hits);
    const overallP = days.length > 0 ? hits / days.length : 0;

    // 발생 간격은 '근무일' 기준으로 센다.
    // 달력 날짜로 세면 주말이 낀 구간만 2일씩 길어져, 규칙적으로 하는 업무도
    // 불규칙해 보인다(3근무일 주기가 3·3·5일로 흩어진다).
    const hitIdx = [];
    days.forEach((d, i) => { if ((Number(d.taskQuantities?.[taskKey]) || 0) > 0) hitIdx.push(i); });
    const gaps = [];
    for (let i = 1; i < hitIdx.length; i++) gaps.push(hitIdx[i] - hitIdx[i - 1]);
    const sorted = [...gaps].sort((x, y) => x - y);
    const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    // 간격이 고른가 — 절반 이상이 가운데값 ±1 안에 들면 규칙적으로 본다
    const nearMedian = gaps.filter(g => Math.abs(g - medianGap) <= 1).length;
    const regular = gaps.length >= 3 && nearMedian / gaps.length >= 0.6 && medianGap >= 2;

    return {
        days, hits, avgQty, overallP, byWd, hitDates, hitIdx,
        lastDate: hitDates[hitDates.length - 1] || null,
        medianGap, regular, sampleDays: days.length
    };
};

/** 마지막 진행일부터 대상일까지 '근무일'이 몇 번 지났는지.
 *  과거 구간은 실제 근무 기록으로 세고, 오늘 이후는 평일(월~금)로 어림한다.
 *  (앞으로의 휴무일은 알 수 없으므로) */
const workdaysBetween = (c, dateStr) => {
    const idx = c.days.findIndex(d => d.id === c.lastDate);
    if (idx < 0) return null;

    const inList = c.days.findIndex(d => d.id === dateStr);
    if (inList >= 0) return inList - idx;               // 대상일이 과거 근무일이면 그대로

    const lastKnown = c.days[c.days.length - 1];
    if (!lastKnown || dateStr <= lastKnown.id) return null;

    let n = (c.days.length - 1) - idx;                  // 마지막 진행일 → 마지막 기록일
    const cur = new Date(lastKnown.id + 'T00:00:00');
    const end = new Date(dateStr + 'T00:00:00');
    if (isNaN(cur.getTime()) || isNaN(end.getTime())) return null;
    while (cur < end) {
        cur.setDate(cur.getDate() + 1);
        const w = cur.getDay();
        if (w !== 0 && w !== 6) n++;                    // 주말은 세지 않는다
    }
    return n;
};

/** 위 분석을 바탕으로 대상일의 예상 물량을 낸다.
 *  반환 { value, source, detail } — source 는 배지 문구에 그대로 쓰인다.
 */
const cadenceValueFor = (historyData, taskKey, dateStr, skip = []) => {
    const c = analyzeCadence(historyData, taskKey);
    // 표본이 적으면 예전 방식이 그나마 안전하다
    if (!c || c.hits < 3) {
        return { value: computeLast7Avg(historyData, taskKey), source: 'last7' };
    }

    const wd = new Date(dateStr + 'T00:00:00').getDay();
    const w = (!isNaN(wd) && c.byWd[wd]) ? c.byWd[wd] : null;
    const WD_NAME = ['일', '월', '화', '수', '목', '금', '토'];

    // ① 거의 매일 하는 업무 — 예전과 같게 둔다
    if (c.overallP >= 0.85) {
        return { value: c.avgQty, source: 'last7', detail: '거의 매일 진행' };
    }

    // ② 특정 요일에 몰려 있는가 (그 요일 표본이 3일 이상일 때만 판단)
    if (!skip.includes('weekday') && w && w.total >= 3) {
        const pw = w.hit / w.total;
        if (pw >= 0.7) {
            const wdAvg = w.hit >= 2 ? Math.round(w.sum / w.hit) : c.avgQty;
            return { value: wdAvg, source: 'cadence-weekday',
                     detail: `${WD_NAME[wd]}요일엔 ${w.hit}/${w.total}회 진행` };
        }
        // 전체적으로 자주 하는 업무인데 이 요일만 유독 안 한다면 0 으로 둔다.
        // 원래 드문 업무까지 0 으로 만들면 어느 날에도 잡히지 않아 아예 사라진다.
        if (pw <= 0.2 && c.overallP >= 0.3) {
            return { value: 0, source: 'cadence-weekday',
                     detail: `${WD_NAME[wd]}요일엔 ${w.hit}/${w.total}회만 진행` };
        }
    }

    // ③ 며칠에 한 번씩 규칙적으로 하는가
    if (!skip.includes('interval') && c.regular && c.lastDate) {
        const elapsed = workdaysBetween(c, dateStr);
        // 주기의 '박자'를 맞춰 본다. 마지막 진행일로부터 주기의 배수가 되는 날만 차례다.
        // (elapsed >= medianGap 으로 판단하면 그 뒤로 며칠이든 계속 차례가 되어,
        //  3일 주기인데 이틀 연속 가득 잡히는 일이 생긴다)
        // 너무 먼 날짜는 박자가 어긋나므로 아래 ④(빈도 반영)로 넘긴다.
        if (elapsed != null && elapsed > 0 && elapsed <= c.medianGap * 3) {
            const due = (elapsed % c.medianGap) === 0;
            return { value: due ? c.avgQty : 0, source: 'cadence-interval',
                     detail: `평균 ${c.medianGap}근무일에 한 번 · 마지막 진행 ${c.lastDate}`
                           + ` (그 뒤 ${elapsed}근무일째)` };
        }
    }

    // ④ 그 외 — 발생 빈도만큼 나눠 담는다(기간 총량이 맞도록)
    // 요일 판정을 끈 업무는 요일별 확률도 쓰지 않는다(전체 빈도로만 본다)
    const p = (!skip.includes('weekday') && w && w.total >= 3) ? (w.hit / w.total) : c.overallP;
    return { value: Math.round(c.avgQty * p), source: 'cadence-rate',
             detail: `근무일 ${c.sampleDays}일 중 ${c.hits}일 진행 (${Math.round(p * 100)}%)` };
};

/** 미래 날짜의 국내배송 AI 예측값. 과거이면 실측치 사용. */
const getAIPredictedDomestic = (historyData, dateStr) => {
    const today = getTodayDateString();
    const tD = new Date(today + 'T00:00:00');
    const xD = new Date(dateStr + 'T00:00:00');
    if (isNaN(xD.getTime()) || isNaN(tD.getTime())) return 0;
    const diff = Math.round((xD - tD) / 86400000);

    // 과거: 실측값 그대로
    if (diff < 0) {
        const day = (historyData || []).find(d => d.id === dateStr);
        return Number(day?.taskQuantities?.['국내배송']) || 0;
    }
    if (diff > 30) return 0; // 너무 먼 미래는 신뢰도 낮음

    // ⚠️ 반드시 일반배송(카페24) 스코프로 예측해야 delivery가 '국내배송' 물량이 된다.
    //    스코프를 생략하면 전 채널 물량 합계가 나와 시뮬레이션 값이 부풀려진다.
    const result = predictFutureTrends(historyData, Math.max(14, diff || 1), channelScope('cafe24'));

    if (diff === 0) {
        // 오늘: 이미 입력된 실측이 있으면 그 값, 없으면 실적 예측의 '오늘 예측값'.
        // (예전엔 실측만 봐서, 물량 입력 전인 오전에는 항상 0 → 칸이 비어 있었다)
        const day = (historyData || []).find(d => d.id === dateStr);
        const actual = Number(day?.taskQuantities?.['국내배송']) || 0;
        if (actual > 0) return actual;
        const todayPred = result?.prediction?.today?.predictedDel;
        if (todayPred > 0) return Math.round(todayPred);
        return computeLast7Avg(historyData, '국내배송');
    }

    const predicted = result?.prediction?.delivery?.[diff - 1];
    if (predicted > 0) return Math.round(predicted);

    // 예측 불가(이력 7일 미만 등) → 최근 실적 평균으로라도 채운다
    return computeLast7Avg(historyData, '국내배송');
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

/** 대상일이 오늘일 때, '오늘 처리량 입력'에 이미 들어간 실측값. 없으면 null.
 *  오늘 데이터는 daily_data가 allHistoryData의 오늘 항목으로 합쳐져 있다. */
const todayActualQty = (historyData, dateStr, taskKey) => {
    if (dateStr !== getTodayDateString()) return null;
    const day = (historyData || []).find(d => d.id === dateStr);
    const v = Number(day?.taskQuantities?.[taskKey]) || 0;
    return v > 0 ? Math.round(v) : null;
};

/** 한 업무의 대상일 값과 그 출처.
 *  ⭐ 우선순위
 *    1. 오늘 처리량 입력(실측)     — 대상일이 오늘일 때만. 실제로 처리한 값이므로 예정보다 우선.
 *    2. 예정 물량(수기 입력)      — 업무 기록 및 관리 > 예정 물량 / 이 화면의 '작업량 저장'
 *    3. 업무별 자동 추정값         — AI 예측 / 입고일정 / 중국제작 연동 / 지난 7회 평균
 *  반환: { value, source }  (source는 배지 표시에 그대로 쓴다)
 */
const autoValueFor = (dateStr, task, historyData) => {
    // 실측이 잡히면 예정 물량을 저장해 뒀더라도 실측이 이긴다
    const actual = todayActualQty(historyData, dateStr, task.key);
    if (actual != null) return { value: actual, source: 'actual' };

    const planned = getPlanned(dateStr, task.key);
    if (planned != null) return { value: planned, source: 'planned' };

    switch (task.auto) {
        case 'ai':       return { value: getAIPredictedDomestic(historyData, dateStr), source: 'ai' };
        case 'incoming': return { value: getIncomingChinaForDate(dateStr), source: 'incoming' };
        case 'china-linked': {
            // 샘플검수는 중국제작 입고가 있는 날에만 발생한다.
            // 그 날의 중국제작 수량(예정 물량 > 입고일정)에 최근 검수비율을 곱해 산출.
            const china = getPlanned(dateStr, '중국제작') ?? getIncomingChinaForDate(dateStr);
            const v = (china > 0) ? Math.round(computeSampleRatio(historyData) * china) : 0;
            return { value: v, source: 'china-linked' };   // 입고 없는 날은 0(빈칸)
        }
        case 'cadence':  return cadenceValueFor(historyData, task.key, dateStr, task.skip || []);
        default:         return { value: computeLast7Avg(historyData, task.key), source: 'last7' };
    }
};

/** 값만 필요한 곳에서 쓰는 짧은 형태 */
const autoQtyFor = (dateStr, task, historyData) => autoValueFor(dateStr, task, historyData).value;

// 사람이 직접 넣은 값(예정물량·오늘 실측)만 색 배지로 눈에 띄게 하고,
// 자동으로 채워진 값은 조용한 회색 글씨로 둔다 — 10칸이 배지로 뒤덮이지 않도록.
const SOURCE_BADGE = {
    planned:  { text: '예정물량', muted: false, cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
                tip: '예정 물량(또는 이 화면의 작업량 저장)에 직접 넣은 값입니다. 오늘 실측이 없을 때 적용됩니다.' },
    actual:   { text: '오늘 실측', muted: false, cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
                tip: '오늘 처리량 입력에 들어간 실제 값입니다. 저장해 둔 예정 물량이 있어도 이 값이 먼저 적용됩니다.' },
    ai:       { text: 'AI 예측',    muted: true, tip: '국내배송 AI 추세 예측값' },
    incoming: { text: '입고일정',    muted: true, tip: '대시보드 입고일정에서 도착일 기준 자동 반영' },
    last7:    { text: '지난 7회 평균', muted: true, tip: '이 업무가 발생한 최근 7일의 업무량 평균' },
    'cadence-weekday':  { text: '요일 패턴', muted: true,
                tip: '이 업무를 주로 하는 요일인지 보고 넣습니다. 잘 안 하는 요일은 0으로 둡니다.' },
    'cadence-interval': { text: '주기 반영', muted: true,
                tip: '며칠에 한 번씩 하는지를 보고, 마지막 진행일 기준으로 이번 차례인 날에만 넣습니다.' },
    'cadence-rate':     { text: '빈도 반영', muted: true,
                tip: '매일 하는 업무가 아니라, 진행 빈도만큼 나눠 담습니다. 기간 전체 총량이 맞도록 한 값입니다.' },
    'china-linked': { text: '중국제작 연동', muted: true,
                tip: '중국제작 입고가 있는 날만 자동 입력됩니다. (그 날 입고량 × 최근 4주 검수비율)' }
};

/** 값의 출처를 항목 아래에 표시 */
const markSourceBadge = (task, source, detail = '') => {
    const el = document.getElementById(`sim-src-${task.id}`);
    if (!el) return;
    const b = SOURCE_BADGE[source] || SOURCE_BADGE.last7;
    const base = 'w-[84px] shrink-0 text-center text-[11px] truncate';   // 줄 레이아웃 유지
    el.className = b.muted
        ? `${base} font-medium text-gray-400 dark:text-gray-500`
        : `${base} font-bold rounded-md ${b.cls}`;
    el.textContent = b.text;
    // 왜 그 값이 나왔는지(예: '월요일엔 7/8회 진행')를 함께 보여준다.
    // 0 이 들어간 칸을 보고 고장으로 오해하지 않도록 근거가 필요하다.
    el.title = detail ? `${b.tip}

${detail}` : b.tip;
};

/** 작업량 입력 칸을 SIM_TASKS로부터 만든다.
 *  성격별(출고 / 입고·제작 / 그 외)로 구획을 나눠 한눈에 구분되게 한다. */
/** 작업량 입력 목록 — 카드 대신 '한 줄에 한 업무'인 표 형태로 촘촘하게 세운다.
 *  (카드 10여 개가 격자로 흩어져 있으면 어느 업무가 얼마인지 훑기 어렵다)
 *  줄 구성:  업무명 ........ [입력] 개 · 값 출처
 */
const renderSimTaskInputs = () => {
    const host = document.getElementById('sim-task-list');
    if (!host) return;
    const sig = SIM_TIME_TASKS.map(t => t.key).join('|');
    if (host.dataset.built === 'true' && host.dataset.timeSig === sig) return;
    host.dataset.built = 'true';
    host.dataset.timeSig = sig;

    const ROW = `flex items-center gap-2.5 px-3 py-2 border-b border-gray-100 dark:border-gray-700/60 last:border-b-0
                 transition hover:bg-gray-50 dark:hover:bg-gray-900/30
                 focus-within:bg-indigo-50/50 dark:focus-within:bg-indigo-900/20`;
    const NUM = `w-24 bg-transparent border-0 border-b border-transparent p-0 text-right text-[17px] leading-tight font-extrabold tabular-nums
                 text-gray-900 dark:text-white placeholder:text-gray-300 dark:placeholder:text-gray-600
                 focus:outline-none focus:ring-0 focus:border-indigo-400`;

    const row = (t) => `
        <div id="sim-row-${t.id}" data-row-id="${t.id}" class="pred-sim-row ${ROW}">
            <span class="flex-1 min-w-0 truncate text-sm font-bold text-gray-700 dark:text-gray-200" title="${t.label}">${t.label}</span>
            <input id="sim-qty-${t.id}" type="number" min="0" placeholder="0" inputmode="numeric" class="${NUM}">
            <span class="w-4 text-[11px] text-gray-400 dark:text-gray-500">개</span>
            <span id="sim-src-${t.id}" class="w-[84px] shrink-0 text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 truncate">지난 7회 평균</span>
        </div>`;

    const timeRow = (t) => `
        <div id="sim-row-t-${t.id}" data-row-id="t-${t.id}" class="pred-sim-row ${ROW}">
            <span class="flex-1 min-w-0 truncate text-sm font-bold text-gray-700 dark:text-gray-200" title="${t.label} — 시간은 1인 기준입니다">${t.label}</span>
            <label class="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap"
                   title="이 업무를 하는 인원. 각자 자기 몫을 따로 하는 업무라, 인원이 늘면 그 인원만큼 시간(인시)이 더해집니다. 2명 × 280분이면 총 560분이 들어가고, 각자는 280분씩 붙어 있습니다.">동시
                <input id="sim-workers-${t.id}" type="number" min="1" step="1" value="1"
                       class="w-8 bg-transparent border-0 border-b border-gray-200 dark:border-gray-600 p-0 text-center tabular-nums
                              text-[12px] font-bold text-gray-600 dark:text-gray-200 focus:outline-none focus:ring-0">명</label>
            <input id="sim-time-${t.id}" type="number" min="0" step="10" placeholder="0" inputmode="numeric" class="${NUM}">
            <span class="w-4 text-[11px] text-gray-400 dark:text-gray-500">분</span>
            <span id="sim-src-t-${t.id}" class="w-[84px] shrink-0 text-center text-[11px] font-semibold text-gray-400 dark:text-gray-500 truncate">지난 4주 평균</span>
        </div>`;

    const block = (title, sub, rowsHtml, tone = '') => `
        <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800/40">
            <div class="flex items-baseline gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-900/40 border-b border-gray-200 dark:border-gray-700">
                <span class="text-[11px] font-extrabold tracking-wider ${tone || 'text-gray-500 dark:text-gray-400'}">${title}</span>
                ${sub ? `<span class="text-[11px] text-gray-400 dark:text-gray-500 truncate">${sub}</span>` : ''}
            </div>
            ${rowsHtml}
        </div>`;

    const qtyBlocks = SIM_GROUPS.map(g => block(
        g.label, '',
        g.ids.map(id => SIM_TASKS.find(t => t.id === id)).filter(Boolean).map(row).join('')
    )).join('');

    const timeBlock = SIM_TIME_TASKS.length > 0
        ? block('담당 · 시간 업무', '처리량이 없는 업무 — 1인 기준 투입시간(분)', SIM_TIME_TASKS.map(timeRow).join(''),
                'text-indigo-500 dark:text-indigo-300')
        : '';

    // 데스크톱에서는 2열로 세워 세로 길이를 줄인다(항목이 많아 한 줄씩이면 화면을 넘긴다)
    host.className = 'grid grid-cols-1 lg:grid-cols-2 gap-3 items-start';
    host.innerHTML = qtyBlocks + timeBlock;
};

/** 시간형 업무 입력칸 채우기 */
const setTimeInputs = (t, { minutes, workers }) => {
    const mEl = document.getElementById(`sim-time-${t.id}`);
    if (mEl) mEl.value = (minutes == null || minutes === 0) ? '' : Math.round(minutes);
    const wEl = document.getElementById(`sim-workers-${t.id}`);
    if (wEl) wEl.value = Math.max(1, Math.round(workers || 1));
};

const markTimeSourceBadge = (t, source, detail = '') => {
    const el = document.getElementById(`sim-src-t-${t.id}`);
    if (!el) return;
    const saved = source === 'planned-time';
    const base = 'w-[84px] shrink-0 text-center text-[11px] truncate';
    el.className = saved
        ? `${base} font-bold rounded-md bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300`
        : `${base} font-medium text-gray-400 dark:text-gray-500`;
    el.textContent = saved ? '저장값' : '지난 4주 평균';
    const tip = saved
        ? '이 날짜에 직접 저장해 둔 투입시간입니다. 실적 평균보다 먼저 적용됩니다.'
        : '최근 4주 업무 기록의 실제 투입시간을 근무일 1일 평균으로 낸 값입니다.';
    el.title = detail ? `${tip}

${detail}` : tip;
};

// ───────────────────────────────────────────────────────────
// 시뮬레이션 UI 핸들러
// ───────────────────────────────────────────────────────────
const autoFillSimInputs = (dateStr) => {
    if (!dateStr) return;
    const data = State.allHistoryData;
    const config = State.appConfig;

    // 업무 이력이 늦게 도착하면 시간형 업무 목록도 그때 정해진다 — 바뀌었으면 입력칸을 다시 그린다
    if (refreshTimeTasks()) renderSimTaskInputs();

    // 모든 업무가 기본 등록 — 예정 물량이 있으면 그 값, 없으면 업무별 자동값
    SIM_TASKS.forEach(t => {
        const { value, source, detail } = autoValueFor(dateStr, t, data);
        setQty(t.id, value);
        markSourceBadge(t, source, detail);
    });

    // 시간으로 잡는 업무(개인담당업무 등) — 저장값 › 실적 평균
    SIM_TIME_TASKS.forEach(t => {
        const v = autoTimeValueFor(dateStr, t, data);
        setTimeInputs(t, v);
        markTimeSourceBadge(t, v.source, v.detail);
    });

    // 가용 인원
    const staffInfo = computeAvailableStaff(dateStr, config, State.persistentLeaveSchedule, data);
    const elStaff = document.getElementById('sim-staff-fulltime');
    if (elStaff) elStaff.value = staffInfo.available;
    // 이 날짜에 저장해 둔 업무 제외시간이 있으면 그 값으로 (없으면 비운다)
    const exEl = document.getElementById('sim-exclude-min');
    if (exEl) {
        const savedEx = getPlannedExcludeMinutesForDate(dateStr);
        exEl.value = (savedEx != null && savedEx > 0) ? savedEx : '';
    }
    paintExcludeHint();

    renderLeaveInfo(staffInfo);
    paintStaffTotal();
};

/** 제외시간 옆 안내 문구 ('1시간 20분 차감') */
const paintExcludeHint = () => {
    const hint = document.getElementById('sim-exclude-hint');
    if (!hint) return;
    const m = readExcludeMinutes();
    const saved = getPlannedExcludeMinutesForDate(document.getElementById('sim-target-date')?.value);
    hint.textContent = m > 0 ? `${fmtMin(m)} 차감${saved != null && saved === m ? ' · 저장됨' : ''}` : '10분 단위';
};

/** 휴무자 명단 — 이름과 종류를 한 덩어리(칩)로 묶어 줄바꿈이 이름 사이를 끊지 않게 한다.
 *  (예전에는 "이승운(휴직)"이 "이 / 승운 / (휴직)"처럼 글자 단위로 쪼개져 읽을 수 없었다) */
const renderLeaveInfo = (staffInfo) => {
    const el = document.getElementById('sim-on-leave-info');
    if (!el) return;
    const tail = `<span class="whitespace-nowrap">총 ${staffInfo.total}명 중 <strong class="text-gray-700 dark:text-gray-200">${staffInfo.available}명 가용</strong></span>`;

    if (!staffInfo.onLeaveList || staffInfo.onLeaveList.length === 0) {
        el.innerHTML = `<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="whitespace-nowrap text-[11px] font-bold text-gray-600 dark:text-gray-300">📅 등록된 휴무 없음</span>
            ${tail}
        </div>`;
        return;
    }

    const chips = staffInfo.onLeaveList.map(e => `
        <span class="inline-flex items-center gap-1 whitespace-nowrap px-1.5 py-0.5 rounded-md
                     bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
            <span class="font-bold text-gray-600 dark:text-gray-300">${e.member}</span>
            <span class="text-gray-400 dark:text-gray-500">${e.type}</span>
        </span>`).join('');

    el.innerHTML = `<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="whitespace-nowrap text-[11px] font-bold text-gray-600 dark:text-gray-300">📅 휴무 ${staffInfo.onLeaveList.length}명</span>
        ${chips}
        ${tail}
    </div>`;
};

/** 정직원 + 알바 합계 표시 */
const paintStaffTotal = () => {
    const el = document.getElementById('sim-staff-total');
    if (!el) return;
    const f = Number(document.getElementById('sim-staff-fulltime')?.value) || 0;
    const p = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
    el.textContent = Math.round(f + p).toLocaleString();
};

const readSimInputs = () => {
    const tasks = {};
    SIM_TASKS.forEach(t => {
        const el = document.getElementById(`sim-qty-${t.id}`);
        tasks[t.key] = Number(el?.value) || 0;
    });
    const timeTasks = {};
    SIM_TIME_TASKS.forEach(t => {
        timeTasks[t.key] = {
            minutes: Math.max(0, Math.round(Number(document.getElementById(`sim-time-${t.id}`)?.value) || 0)),
            workers: Math.max(1, Math.round(Number(document.getElementById(`sim-workers-${t.id}`)?.value) || 1))
        };
    });
    const staffFulltime = Number(document.getElementById('sim-staff-fulltime')?.value) || 0;
    const staffPart = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
    return { tasks, timeTasks, staffFulltime, staffPart, excludeMinutes: readExcludeMinutes() };
};

/** ⏱ 업무 제외시간 — 그날 업무 외의 일(회의·행사·정리 등)로 빠지는 시간(1인 기준, 10분 단위) */
const readExcludeMinutes = () => {
    const raw = Number(document.getElementById('sim-exclude-min')?.value) || 0;
    if (raw <= 0) return 0;
    return Math.round(raw / EXCLUDE_STEP_MIN) * EXCLUDE_STEP_MIN;   // 10분 단위로 맞춤
};

const simulateOneDay = (dateStr, inputs, taskUPH, config) => {
    const stdHours = config?.standardDailyWorkHours || { weekday: 8, weekend: 4 };
    const weekend = isWeekendDate(dateStr);
    const dailyHours = weekend ? (Number(stdHours.weekend) || 4) : (Number(stdHours.weekday) || 8);

    // 업무 제외시간을 빼고 남는 '실제 업무에 쓸 수 있는 시간'(1인 기준)
    // 제외시간이 하루 업무시간을 다 먹으면 필요 인원이 0으로 나와 오히려 오해를 부른다.
    // 최소 30분은 남겨 두고 계산한다(그만큼 인원이 폭증하는 결과로 보이도록).
    const excludeMinutes = Math.min(
        Math.max(0, Math.round(Number(inputs.excludeMinutes) || 0)),
        Math.max(0, Math.round((dailyHours - 0.5) * 60))
    );
    const excludeHours = excludeMinutes / 60;
    const netDailyHours = Math.max(0.5, dailyHours - excludeHours);

    const availableTotal = Math.round(inputs.staffFulltime + inputs.staffPart);

    // ① 수량으로 잡는 업무 — 물량 ÷ UPH = 인시
    const taskTimes = {};
    let qtyHours = 0;
    SIM_TASKS.forEach(t => {
        const qty = inputs.tasks[t.key] || 0;
        const uph = taskUPH[t.key] || 0;
        const hours = (qty > 0 && uph > 0) ? qty / uph : 0;
        taskTimes[t.key] = { qty, uph, hours, elapsed: 0 };
        qtyHours += hours;
    });

    // ② 시간으로 잡는 업무 — 실적에서 온 '실제로 붙어 있던 시간'이라 가동률로 다시 깎지 않는다
    const timeTaskTimes = {};
    let timeElapsedFloor = 0, timeHours = 0;
    SIM_TIME_TASKS.forEach(t => {
        const e = (inputs.timeTasks || {})[t.key] || {};
        const minutes = Math.max(0, Math.round(Number(e.minutes) || 0));
        const workers = Math.max(1, Math.round(Number(e.workers) || 1));
        // 입력은 '1인 기준 시간' — 인시는 인원만큼 늘고, 실제로 흐르는 시간은 1인 시간 그대로다
        const elapsed = minutes / 60;             // 담당자가 붙어 있는 시간
        const hours = elapsed * workers;          // 인시(사람×시간)
        timeTaskTimes[t.key] = { minutes, workers, hours, elapsed };
        timeHours += hours;
        timeElapsedFloor = Math.max(timeElapsedFloor, elapsed);
    });

    const totalHours = qtyHours + timeHours;

    // ③ 담당 업무에 묶이는 인력 — 그 시간 동안 이 사람들은 다른 업무를 할 수 없다.
    //    묶이는 양을 인원(FTE)으로 환산해 가용 인원에서 뺀 뒤, 나머지로 물량 업무를 계산한다.
    //    (예전에는 담당 업무 시간에도 전체 인원이 물량 업무를 하는 것으로 계산돼 시간이 짧게 나왔다)
    const tiedFTE = netDailyHours > 0 ? timeHours / netDailyHours : 0;
    const qtyStaff = Math.max(0, availableTotal - tiedFTE);
    const qtyRate = qtyStaff * UTILIZATION;                 // 물량 업무에 붙는 팀의 시간당 처리 인시
    const staffShortForQty = qtyHours > 0 && qtyRate <= 0;  // 담당 업무가 인원을 다 먹은 경우
    const qtyElapsed = qtyRate > 0 ? qtyHours / qtyRate : 0;
    Object.keys(taskTimes).forEach(k => {
        taskTimes[k].elapsed = qtyRate > 0 ? taskTimes[k].hours / qtyRate : 0;
    });

    // ④ 필요 인원 — 물량 업무는 가동률을 감안하고, 담당 업무는 실제 시간 그대로 더한다
    const rawRequiredFTE = netDailyHours > 0
        ? (qtyHours / UTILIZATION + timeHours) / netDailyHours
        : 0;
    const requiredFTE = Math.round(rawRequiredFTE);
    const gap = availableTotal - requiredFTE;

    // ⑤ 시간 관점
    //  - totalHours   : 총 소요시간 = 모든 업무의 인시 합계
    //  - elapsedHours : 실 소요시간 = 물량 업무를 남은 인원으로 끝내는 시간과,
    //                   담당자가 담당 업무에 붙어 있는 시간 중 더 긴 쪽
    //  - slackHours   : 다 끝내고 남는 시간(+) / 정규 시간을 넘기는 시간(-)
    const elapsedHours = Math.max(qtyElapsed, timeElapsedFloor);
    const elapsedCappedByTimeTask = timeElapsedFloor > qtyElapsed && timeElapsedFloor > 0;
    const capacityHours = availableTotal * netDailyHours * UTILIZATION;   // 그날 처리 가능한 인시
    const slackHours = netDailyHours - elapsedHours;

    return {
        date: dateStr, weekend, dailyHours, netDailyHours, excludeMinutes,
        taskTimes, timeTaskTimes, qtyHours, timeHours, totalHours,
        tiedFTE, qtyStaff, staffShortForQty, qtyElapsed,
        elapsedHours, elapsedCappedByTimeTask, capacityHours, slackHours,
        rawRequiredFTE, requiredFTE, availableTotal, gap
    };
};

const runSimulation = ({ silent = false } = {}) => {
    const dateEl = document.getElementById('sim-target-date');
    const modeEl = document.getElementById('sim-mode');
    if (!dateEl?.value) {
        if (!silent) alert('대상일을 선택해주세요.');
        else showResultPlaceholder();
        return;
    }
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
            autoTasks[t.key] = autoQtyFor(d, t, State.allHistoryData);
        });
        const autoTimeTasks = {};
        SIM_TIME_TASKS.forEach(t => {
            const v = autoTimeValueFor(d, t, State.allHistoryData);
            autoTimeTasks[t.key] = { minutes: v.minutes, workers: v.workers };
        });
        const staffInfo = computeAvailableStaff(d, cfg, State.persistentLeaveSchedule, State.allHistoryData);
        const dayInputs = { tasks: autoTasks, timeTasks: autoTimeTasks,
                            staffFulltime: staffInfo.available, staffPart: baseInputs.staffPart,
                            excludeMinutes: getPlannedExcludeMinutesForDate(d) ?? baseInputs.excludeMinutes };
        return simulateOneDay(d, dayInputs, taskUPH, cfg);
    });

    renderSimResult(results, taskUPH, mode);
};

// ───────────────────────────────────────────────────────────
// 결과 렌더
// ───────────────────────────────────────────────────────────
// 과부족 표현은 색 배지(GAP_TONE)로 통일했다. 아이콘/글자색 헬퍼는 더 쓰지 않는다.
const gapText  = g => g > 1 ? `${Math.round(g)}명 여유` : (g < -1 ? `${Math.abs(Math.round(g))}명 부족` : '적정');
const fmtH     = h => `${(h || 0).toFixed(1)}h`;
/** 2.5 → '2시간 30분' (시간은 분 단위까지 봐야 감이 온다) */
const fmtHM = (h) => {
    const total = Math.round(Math.abs(h || 0) * 60);
    const sign = (h || 0) < 0 ? '-' : '';
    const hh = Math.floor(total / 60), mm = total % 60;
    if (hh === 0) return `${sign}${mm}분`;
    return mm === 0 ? `${sign}${hh}시간` : `${sign}${hh}시간 ${mm}분`;
};
/** 제외시간 표기: 90 → '1시간 30분' */
const fmtMin = (m) => fmtHM((Number(m) || 0) / 60);

/** 결과칸이 비어 있을 때 자리 안내 (오른쪽 칸이 휑하지 않도록) */
const resultPlaceholder = () => `
    <section class="rounded-2xl border border-dashed border-gray-300 dark:border-gray-600 bg-white/60 dark:bg-gray-800/30
                    p-8 text-center text-gray-400 dark:text-gray-500">
        <div class="text-2xl mb-2">📊</div>
        <p class="text-[11px] leading-relaxed">왼쪽에서 값을 고친 뒤 <b>시뮬레이션 실행</b>을 누르면<br>여기에 결과가 나옵니다.</p>
    </section>`;

const showResultPlaceholder = () => {
    const el = document.getElementById('sim-result-container');
    if (el) el.innerHTML = resultPlaceholder();
};

const renderSimResult = (results, taskUPH, mode) => {
    const container = document.getElementById('sim-result-container');
    if (!container) return;

    const cardOpen = (title, sub) => `
        <section class="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
            <header class="px-4 md:px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex flex-col md:flex-row md:items-center justify-between gap-1.5">
                <h4 class="text-sm font-extrabold text-gray-800 dark:text-white">${title}</h4>
                <div class="text-[11px] text-gray-400 dark:text-gray-500">${sub}</div>
            </header>`;

    if (mode === 'single') {
        const r = results[0];
        const tone = GAP_TONE(r.gap);
        const rows = SIM_TASKS.map(t => {
            const v = r.taskTimes[t.key];
            if (!v || v.qty <= 0) return '';
            // 소요시간이 긴 업무가 눈에 띄도록 막대를 함께 그린다.
            const w = r.totalHours > 0 ? Math.max(2, Math.round(v.hours / r.totalHours * 100)) : 0;
            return `<tr class="border-t border-gray-100 dark:border-gray-700/60">
                <td class="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">${t.label}</td>
                <td class="py-2 px-3 text-right tabular-nums">${v.qty.toLocaleString()}</td>
                <td class="py-2 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${v.uph > 0 ? v.uph.toFixed(1) : '<span class="text-gray-300 dark:text-gray-600">기준 없음</span>'}</td>
                <td class="py-2 px-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <div class="hidden sm:block w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                            <div class="h-full bg-indigo-400 dark:bg-indigo-500 rounded-full" style="width:${w}%"></div>
                        </div>
                        <span class="font-bold tabular-nums text-gray-800 dark:text-gray-100">${v.uph > 0 ? fmtH(v.hours) : '—'}</span>
                    </div>
                </td>
                <td class="py-2 px-3 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-300"
                    title="물량 업무에 투입되는 ${r.qtyStaff.toFixed(1)}명이 이 업무에만 붙었을 때 걸리는 시간${r.timeHours > 0 ? ` (가용 ${r.availableTotal}명 − 담당 업무에 묶인 ${r.tiedFTE.toFixed(1)}명)` : ''}">${(v.uph > 0 && r.qtyStaff > 0) ? fmtHM(v.elapsed) : '—'}</td>
            </tr>`;
        }).filter(Boolean).join('');

        // ⏳ 시간으로 잡는 업무 — 수량·UPH 칸은 비우고 시간만 보여준다
        const timeRows = SIM_TIME_TASKS.map(t => {
            const v = r.timeTaskTimes?.[t.key];
            if (!v || v.minutes <= 0) return '';
            const w = r.totalHours > 0 ? Math.max(2, Math.round(v.hours / r.totalHours * 100)) : 0;
            return `<tr class="border-t border-gray-100 dark:border-gray-700/60 bg-indigo-50/30 dark:bg-indigo-900/10">
                <td class="py-2 px-3 font-medium text-gray-700 dark:text-gray-200">${t.label}
                    <span class="ml-1 text-[10px] font-bold text-indigo-500 dark:text-indigo-300">시간형</span></td>
                <td class="py-2 px-3 text-right tabular-nums text-gray-400 dark:text-gray-600">1인 ${v.minutes}분</td>
                <td class="py-2 px-3 text-right tabular-nums text-gray-400 dark:text-gray-600">담당 ${v.workers}명</td>
                <td class="py-2 px-3 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <div class="hidden sm:block w-16 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                            <div class="h-full bg-indigo-300 dark:bg-indigo-600 rounded-full" style="width:${w}%"></div>
                        </div>
                        <span class="font-bold tabular-nums text-gray-800 dark:text-gray-100">${fmtH(v.hours)}</span>
                    </div>
                </td>
                <td class="py-2 px-3 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-300"
                    title="담당 ${v.workers}명이 각자 ${v.minutes}분씩 (인시 합계 ${fmtH(v.hours)})">${fmtHM(v.elapsed)}</td>
            </tr>`;
        }).filter(Boolean).join('');

        const stat = (label, value, sub, cls) => `
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 p-3">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">${label}</div>
                <div class="text-2xl font-black mt-1 ${cls || 'text-gray-900 dark:text-white'}">${value}</div>
                <div class="text-[10px] text-gray-400 dark:text-gray-500 mt-1">${sub}</div>
            </div>`;

        // ⏱ 시간 결과 — 다 끝내고 남는 시간(+) / 정규 시간을 넘기는 시간(-)
        const slackPositive = r.slackHours >= 0;
        const slackCls = r.availableTotal <= 0 ? 'text-gray-400'
            : (slackPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400');
        const slackLabel = r.availableTotal <= 0 ? '—'
            : (slackPositive ? `${fmtHM(r.slackHours)} 남음` : `${fmtHM(Math.abs(r.slackHours))} 초과`);

        container.innerHTML = `
        ${cardOpen(`${dayLabel(r.date)}${r.weekend ? ' <span class="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded ml-1">주말</span>' : ''}`,
                   `기준 UPH 최근 4주 평균 · 1일 ${r.dailyHours}h${r.excludeMinutes > 0 ? ` − 제외 ${fmtMin(r.excludeMinutes)} = ${fmtHM(r.netDailyHours)}` : ''} · 가동률 ${(UTILIZATION*100)|0}%`)}
            <div class="p-4 md:p-5 space-y-4">
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    ${stat('필요 인원', `${r.requiredFTE}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span>`,
                           r.timeHours > 0
                             ? `(물량 ${fmtH(r.qtyHours)} ÷ ${UTILIZATION} + 담당 ${fmtH(r.timeHours)}) ÷ ${fmtHM(r.netDailyHours)}`
                             : `${fmtH(r.totalHours)} ÷ ${fmtHM(r.netDailyHours)} ÷ ${UTILIZATION}`)}
                    ${stat('가용 인원', `${r.availableTotal}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span>`, '정직원 + 알바')}
                    <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 p-3 flex flex-col justify-center">
                        <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">결과</div>
                        <div class="mt-1"><span class="text-lg font-extrabold px-3 py-1 rounded-full ${tone.chip}">${gapText(r.gap)}</span></div>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    ${stat('총 소요시간', fmtHM(r.totalHours), '모든 업무의 인시(사람×시간) 합계')}
                    ${stat('실 소요시간', r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—',
                           r.availableTotal <= 0 ? '가용 인원을 입력하세요'
                             : (r.elapsedCappedByTimeTask
                                 ? `담당 업무가 끝나는 시간 (물량 업무는 ${r.qtyStaff.toFixed(1)}명이 ${fmtHM(r.qtyElapsed)})`
                                 : `물량 업무에 투입되는 ${r.qtyStaff.toFixed(1)}명이 함께 할 때 걸리는 시간`),
                           'text-indigo-600 dark:text-indigo-300')}
                    ${stat(slackPositive ? '남는 시간' : '초과 시간', slackLabel,
                           `업무시간 ${fmtHM(r.netDailyHours)} 기준${r.excludeMinutes > 0 ? ` (제외 ${fmtMin(r.excludeMinutes)} 반영)` : ''}`,
                           slackCls)}
                </div>

                ${r.timeHours > 0 ? `<p class="text-[11px] text-gray-500 dark:text-gray-400 -mt-1 leading-relaxed">
                    ⏳ 담당 업무 ${fmtHM(r.timeHours)}에 <b>${r.tiedFTE.toFixed(1)}명</b>이 묶여,
                    물량 업무에는 <b>${r.qtyStaff.toFixed(1)}명</b>이 투입되는 것으로 계산했습니다
                    (물량 업무 ${r.staffShortForQty ? '계산 불가' : fmtHM(r.qtyElapsed)}).
                    ${r.elapsedCappedByTimeTask ? '실 소요시간은 <b>담당 업무 시간</b>에 걸려 있습니다 — 인원을 더 넣어도 그보다 빨리 끝나지 않습니다.' : ''}
                    ${r.staffShortForQty ? '<span class="text-rose-600 dark:text-rose-400 font-bold">담당 업무가 가용 인원을 모두 차지해 물량 업무를 할 사람이 없습니다.</span>' : ''}
                </p>` : ''}

                <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                                <tr>
                                    <th class="py-2.5 px-3 text-left font-bold">작업</th>
                                    <th class="py-2.5 px-3 text-right font-bold">수량 (개)</th>
                                    <th class="py-2.5 px-3 text-right font-bold">기준 UPH</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="이 업무에 들어가는 인시(사람×시간) 합계입니다.">총 소요시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="실제로 흘러가는 시간입니다. 물량 업무는 담당 업무에 묶인 인원을 뺀 '투입 인원' 기준, 담당 업무는 그 업무의 동시 인원 기준입니다.">실 소요시간</th>
                                </tr>
                            </thead>
                            <tbody>${(rows + timeRows) || '<tr><td colspan="5" class="py-6 text-center text-gray-400">입력된 작업량이 없습니다.</td></tr>'}</tbody>
                            <tfoot class="bg-gray-50 dark:bg-gray-900/40 font-extrabold text-gray-800 dark:text-gray-100">
                                <tr class="border-t border-gray-200 dark:border-gray-700">
                                    <td class="py-2.5 px-3" colspan="3">합계</td>
                                    <td class="py-2.5 px-3 text-right tabular-nums">${fmtH(r.totalHours)}</td>
                                    <td class="py-2.5 px-3 text-right tabular-nums text-indigo-600 dark:text-indigo-300">${r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—'}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>
            </div>
        </section>`;
    } else {
        const trows = results.map(r => {
            const tone = GAP_TONE(r.gap);
            return `
            <tr class="border-t border-gray-100 dark:border-gray-700/60 ${r.weekend ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}">
                <td class="py-2.5 px-3 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">${dayLabel(r.date)}${r.weekend ? ' <span class="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1 rounded">주말</span>' : ''}</td>
                <td class="py-2.5 px-3 text-right tabular-nums text-gray-500 dark:text-gray-400">${fmtH(r.totalHours)}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-300">${r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—'}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold ${r.availableTotal <= 0 ? 'text-gray-400' : (r.slackHours >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}">${r.availableTotal > 0 ? (r.slackHours >= 0 ? `+${fmtHM(r.slackHours)}` : `-${fmtHM(Math.abs(r.slackHours))}`) : '—'}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold">${r.requiredFTE}</td>
                <td class="py-2.5 px-3 text-right tabular-nums font-bold">${r.availableTotal}</td>
                <td class="py-2.5 px-3 text-right"><span class="text-[11px] font-extrabold px-2 py-1 rounded-full ${tone.chip}">${gapText(r.gap)}</span></td>
            </tr>`;
        }).join('');
        const sumRequired = results.reduce((s, r) => s + r.requiredFTE, 0);
        const sumAvail    = results.reduce((s, r) => s + r.availableTotal, 0);
        const shortageDays = results.filter(r => r.gap < -1).length;
        const surplusDays  = results.filter(r => r.gap > 1).length;
        const partN = Number(document.getElementById('sim-staff-parttimer')?.value) || 0;
        const exclM = results[0]?.excludeMinutes || 0;
        const sumHours = results.reduce((s, r) => s + r.totalHours, 0);

        const mini = (label, value, cls) => `
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30 p-2.5 text-center">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">${label}</div>
                <div class="text-base font-black mt-0.5 ${cls || 'text-gray-900 dark:text-white'}">${value}</div>
            </div>`;

        container.innerHTML = `
        ${cardOpen('7일치 일괄 시뮬레이션', `대상일 외 6일은 자동값 사용 · 알바 ${partN}명 동일 적용${exclM > 0 ? ` · 업무 제외시간 ${fmtMin(exclM)} 반영` : ''}`)}
            <div class="p-4 md:p-5 space-y-4">
                <div class="grid grid-cols-[repeat(2,minmax(0,1fr))] md:grid-cols-[repeat(4,minmax(0,1fr))] gap-2.5">
                    ${mini('합계 필요', `${sumRequired}<span class="text-[11px] font-bold text-gray-400 ml-0.5">명·일</span>`)}
                    ${mini('합계 가용', `${sumAvail}<span class="text-[11px] font-bold text-gray-400 ml-0.5">명·일</span>`)}
                    ${mini('부족 일수', `${shortageDays}<span class="text-[11px] font-bold text-gray-400 ml-0.5">일</span>`, 'text-rose-600 dark:text-rose-400')}
                    ${mini('여유 일수', `${surplusDays}<span class="text-[11px] font-bold text-gray-400 ml-0.5">일</span>`, 'text-emerald-600 dark:text-emerald-400')}
                    ${mini('합계 총 소요시간', fmtHM(sumHours))}
                    ${mini('초과 예상 일수', `${results.filter(r => r.availableTotal > 0 && r.slackHours < 0).length}<span class="text-[11px] font-bold text-gray-400 ml-0.5">일</span>`, 'text-rose-600 dark:text-rose-400')}
                </div>
                <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-sm">
                            <thead class="text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/40">
                                <tr>
                                    <th class="py-2.5 px-3 text-left font-bold">일자</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="인시(사람×시간) 합계">총 소요시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="실제로 흘러가는 시간 — 담당 업무에 묶인 인원을 뺀 인원으로 물량 업무를 끝내는 시간과, 담당 업무가 끝나는 시간 중 더 긴 쪽">실 소요시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold" title="정규 업무시간 대비 남는(+) / 초과(-) 시간">남는 시간</th>
                                    <th class="py-2.5 px-3 text-right font-bold">필요</th>
                                    <th class="py-2.5 px-3 text-right font-bold">가용</th>
                                    <th class="py-2.5 px-3 text-right font-bold">결과</th>
                                </tr>
                            </thead>
                            <tbody>${trows}</tbody>
                        </table>
                    </div>
                </div>
            </div>
        </section>`;
    }
};

// ───────────────────────────────────────────────────────────
// 업무 예상 — 오늘·내일 자동 요약 예측
// ───────────────────────────────────────────────────────────
/** 대상일의 자동 추정 입력값(DOM 미의존). AI 국내배송 + 7일평균 + 입고일정 중국제작 + 휴무 반영 가용인원. */
const computeAutoInputsForDate = (dateStr, excludeMinutes = 0) => {
    const data = State.allHistoryData;
    const cfg = State.appConfig;
    // 그 날짜에 저장해 둔 제외시간이 있으면 그 값이 우선
    const savedEx = getPlannedExcludeMinutesForDate(dateStr);
    if (savedEx != null) excludeMinutes = savedEx;
    // 우선순위: 예정 물량(수기 입력) > 업무별 자동값
    const tasks = {};
    SIM_TASKS.forEach(t => { tasks[t.key] = autoQtyFor(dateStr, t, data); });
    const timeTasks = {};
    SIM_TIME_TASKS.forEach(t => {
        const v = autoTimeValueFor(dateStr, t, data);
        timeTasks[t.key] = { minutes: v.minutes, workers: v.workers };
    });
    const staffInfo = computeAvailableStaff(dateStr, cfg, State.persistentLeaveSchedule, data);
    return { tasks, timeTasks, staffFulltime: staffInfo.available, staffPart: 0, excludeMinutes, staffInfo };
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

// 인원 과부족 톤 — 색은 상태 배지와 막대에만 쓴다.
// 카드 테두리까지 물들이면 화면 전체가 색으로 뒤덮여 오히려 읽기 어렵다.
const GAP_TONE = (g) => g > 1
    ? { chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', bar: 'bg-emerald-500' }
    : (g < -1
        ? { chip: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300', bar: 'bg-rose-500' }
        : { chip: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', bar: 'bg-amber-500' });

const forecastCardHtml = (label, r, inputs, simLinked = false) => {
    const gap = r.gap;
    const tone = GAP_TONE(gap);
    const china = inputs.tasks['중국제작'] || 0;
    const staffN = Math.round(inputs.staffInfo ? inputs.staffInfo.available : r.availableTotal);
    // 필요 대비 가용을 막대로 — 숫자만 보는 것보다 한눈에 들어온다.
    const pct = r.requiredFTE > 0 ? Math.min(100, Math.round(staffN / r.requiredFTE * 100)) : 100;

    return `
    <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 md:p-5 shadow-sm">
        <div class="flex items-start justify-between gap-2 mb-4">
            <div class="min-w-0">
                <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-base font-extrabold text-gray-900 dark:text-white">${label}</span>
                    ${r.weekend ? '<span class="text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 px-1.5 py-0.5 rounded">주말</span>' : ''}
                    ${simLinked ? '<span class="text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 px-1.5 py-0.5 rounded" title="아래 상세 시뮬레이션에 입력한 값이 그대로 반영된 결과입니다.">시뮬레이션 반영</span>' : ''}
                </div>
                <div class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">${dayLabel(r.date)}</div>
            </div>
            <span class="text-[11px] font-extrabold px-2.5 py-1 rounded-full shrink-0 ${tone.chip}">${gapText(gap)}</span>
        </div>

        <div class="flex items-end gap-4 mb-3">
            <div>
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">필요</div>
                <div class="text-3xl font-black leading-none text-gray-900 dark:text-white mt-1">${r.requiredFTE}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span></div>
            </div>
            <div class="text-gray-200 dark:text-gray-700 text-2xl font-light leading-none pb-1">/</div>
            <div>
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500 tracking-wide">가용</div>
                <div class="text-3xl font-black leading-none text-gray-900 dark:text-white mt-1">${staffN}<span class="text-sm font-bold text-gray-400 ml-0.5">명</span></div>
            </div>
        </div>

        <div class="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden mb-3">
            <div class="h-full ${tone.bar} rounded-full transition-all" style="width:${pct}%"></div>
        </div>

        <div class="grid grid-cols-3 gap-2 mb-3">
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-700 px-2 py-1.5">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">총 소요시간</div>
                <div class="text-[14px] font-extrabold text-gray-800 dark:text-gray-100 mt-0.5 tabular-nums">${fmtHM(r.totalHours)}</div>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-700 px-2 py-1.5"
                 title="실제로 흘러가는 시간 — 물량 업무는 담당 업무에 묶인 인원(${r.tiedFTE.toFixed(1)}명)을 뺀 ${r.qtyStaff.toFixed(1)}명 기준이고, 담당 업무가 더 오래 걸리면 그 시간을 씁니다">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">실 소요시간</div>
                <div class="text-[14px] font-extrabold text-indigo-600 dark:text-indigo-300 mt-0.5 tabular-nums">${r.availableTotal > 0 ? fmtHM(r.elapsedHours) : '—'}</div>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-700 px-2 py-1.5"
                 title="업무시간 ${fmtHM(r.netDailyHours)} 안에서 다 끝내고 남는 시간(초과면 −)">
                <div class="text-[10px] font-bold text-gray-400 dark:text-gray-500">${r.slackHours >= 0 ? '남는 시간' : '초과 시간'}</div>
                <div class="text-[14px] font-extrabold mt-0.5 tabular-nums ${r.availableTotal <= 0 ? 'text-gray-400' : (r.slackHours >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')}">${r.availableTotal > 0 ? fmtHM(Math.abs(r.slackHours)) : '—'}</div>
            </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
            <span>1일 ${r.dailyHours}h${r.excludeMinutes > 0 ? ` − 제외 ${fmtMin(r.excludeMinutes)}` : ''} · 가동률 ${(UTILIZATION*100)|0}%</span>
            ${r.timeHours > 0 ? `<span class="text-gray-300 dark:text-gray-600">·</span><span title="처리량이 없는 담당 업무의 예상 투입시간(실적 평균)">🗂 담당 업무 ${fmtHM(r.timeHours)}</span>` : ''}
            ${china > 0 ? `<span class="w-full"></span><span class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded-full">🚚 중국제작 입고 ${china.toLocaleString()}개</span>` : ''}
        </div>
    </div>`;
};

/** 🔗 상세 시뮬레이션에서 지금 입력해 둔 값. 대상일이 오늘/내일이면 위 요약 카드도 이 값으로 계산한다.
 *  (상세에서 숫자를 바꿨는데 상단 카드가 자동값 그대로면 두 숫자가 어긋나 보인다) */
let simOverride = null;   // { date, tasks, staffFulltime, staffPart, excludeMinutes }

const captureSimOverride = () => {
    const dateStr = document.getElementById('sim-target-date')?.value;
    if (!dateStr) { simOverride = null; return; }
    const { tasks, timeTasks, staffFulltime, staffPart, excludeMinutes } = readSimInputs();
    simOverride = { date: dateStr, tasks, timeTasks, staffFulltime, staffPart, excludeMinutes };
};

/** 요약 카드 한 장에 쓸 입력값 — 시뮬레이션 대상일과 같은 날이면 그 입력을 그대로 쓴다. */
const inputsForSummaryDate = (dateStr) => {
    const excl = simOverride ? simOverride.excludeMinutes : readExcludeMinutes();
    if (!simOverride || simOverride.date !== dateStr) {
        return { inputs: computeAutoInputsForDate(dateStr, excl || 0), linked: false };
    }
    const staffInfo = computeAvailableStaff(dateStr, State.appConfig, State.persistentLeaveSchedule, State.allHistoryData);
    const total = Math.round(simOverride.staffFulltime + simOverride.staffPart);
    return {
        inputs: {
            tasks: simOverride.tasks,
            timeTasks: simOverride.timeTasks,
            staffFulltime: simOverride.staffFulltime,
            staffPart: simOverride.staffPart,
            excludeMinutes: simOverride.excludeMinutes,
            staffInfo: { ...staffInfo, available: total }
        },
        linked: true
    };
};

/** 오늘·내일 예측 2개 카드 렌더 (상세 시뮬레이션 입력이 있으면 그 값 반영) */
const renderForecastSummary = () => {
    const el = document.getElementById('forecast-summary-cards');
    if (!el) return;
    const taskUPH = computeTaskUPHs(State.allHistoryData);
    const cfg = State.appConfig;
    const today = getTodayDateString();
    const days = [{ label: '오늘', date: today }, { label: '내일', date: addDays(today, 1) }];
    el.innerHTML = days.map(({ label, date }) => {
        const { inputs, linked } = inputsForSummaryDate(date);
        const r = simulateOneDay(date, inputs, taskUPH, cfg);
        return forecastCardHtml(label, r, inputs, linked);
    }).join('');

    // 대상일이 오늘·내일이 아니면 안내 (카드는 자동값 그대로임을 알 수 있게)
    const note = document.getElementById('forecast-summary-note');
    if (note) {
        const d = simOverride?.date;
        note.textContent = (d && d !== today && d !== addDays(today, 1))
            ? `상세 시뮬레이션 대상일(${d})은 오늘·내일이 아니어서 위 카드에는 반영되지 않습니다.`
            : '';
    }
};

// ───────────────────────────────────────────────────────────
// 💾 작업량 수기 저장 — 예정 물량(plannedData)에 그대로 저장한다.
//    저장한 값은 우선순위 1순위라, '자동값'으로 지우기 전까지 계속 유지된다.
// ───────────────────────────────────────────────────────────
/** 이 날짜에 저장돼 있는(수기) 작업량 목록 */
const savedSimEntries = (dateStr) => {
    const saved = getPlannedQuantitiesForDate(dateStr) || {};
    const qty = SIM_TASKS
        .filter(t => Object.prototype.hasOwnProperty.call(saved, t.key) && Number.isFinite(Number(saved[t.key])))
        .map(t => ({ task: t, value: Math.round(Number(saved[t.key])), kind: 'qty' }));
    const time = SIM_TIME_TASKS
        .map(t => ({ t, v: getPlannedTime(dateStr, t.key) }))
        .filter(x => x.v)
        .map(x => ({ task: x.t, value: x.v.minutes, kind: 'time' }));
    const ex = getPlannedExcludeMinutesForDate(dateStr);
    const extra = (ex != null && ex > 0)
        ? [{ task: { label: '업무 제외시간' }, value: ex, kind: 'time' }]
        : [];
    return [...qty, ...time, ...extra];
};

/** 저장 목록 한 줄 표기 — 시간형은 '분'으로 */
const savedEntryText = (e) => e.kind === 'time'
    ? `${e.task.label} ${e.value}분`
    : `${e.task.label} ${e.value > 0 ? e.value.toLocaleString() : '0'}`;

const updateSavedInfo = (dateStr) => {
    const el = document.getElementById('sim-saved-info');
    if (!el) return;
    if (!dateStr) { el.textContent = ''; return; }
    const entries = savedSimEntries(dateStr);
    if (entries.length === 0) {
        el.innerHTML = `<span class="text-gray-400 dark:text-gray-500">저장된 수기 값 없음 — 자동값으로 계산 중</span>`;
        return;
    }
    const list = entries.map(savedEntryText).join(', ');
    el.innerHTML = `<span class="text-amber-700 dark:text-amber-400 font-bold">💾 저장됨 ${entries.length}개</span>
        <span class="text-gray-400 dark:text-gray-500">— ${list} · '자동값'을 누르기 전까지 유지되며, 오늘 실측이 잡히면 실측이 우선합니다.</span>`;
};

const saveSimQuantities = async () => {
    const dateStr = document.getElementById('sim-target-date')?.value;
    if (!dateStr) { alert('대상일을 선택해주세요.'); return; }
    if (dateStr < getTodayDateString()) {
        showToast('지난 날짜의 작업량은 저장할 수 없습니다. (예정 물량은 오늘 이후만 보관합니다)', true);
        return;
    }
    const { tasks, timeTasks } = readSimInputs();
    // 이 화면에 없는 업무(예: 해외배송)의 예정 물량은 건드리지 않는다
    const merged = { ...(getPlannedQuantitiesForDate(dateStr) || {}) };
    // 0과 빈칸(=0)도 '그렇게 하기로 한 값'으로 그대로 저장한다.
    // 실측으로 채워진 값도 그대로 저장한다 — 실측이 예정 물량보다 우선이라,
    // 나중에 실적이 더 쌓이면 그 값이 자동으로 앞선다(저장값에 갇히지 않는다).
    SIM_TASKS.forEach(t => {
        merged[t.key] = Math.max(0, Math.round(Number(tasks[t.key]) || 0));
    });

    const btn = document.getElementById('sim-save-btn');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); }
    // 시간형 업무도 0(=안 함)까지 그대로 저장한다
    const mergedTime = { ...(getPlannedTimeTasksForDate(dateStr) || {}) };
    SIM_TIME_TASKS.forEach(t => {
        const e = timeTasks[t.key] || {};
        mergedTime[t.key] = { minutes: Math.max(0, Math.round(Number(e.minutes) || 0)),
                              workers: Math.max(1, Math.round(Number(e.workers) || 1)) };
    });

    const excl = readExcludeMinutes();
    const ok = await savePlannedQuantities(dateStr, merged,
        { keepZeros: true, timeTasks: mergedTime, excludeMinutes: excl > 0 ? excl : -1 });
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); }
    if (!ok) return;

    autoFillSimInputs(dateStr);       // 배지를 '예정물량'으로 갱신
    updateSavedInfo(dateStr);
    simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
    renderForecastSummary();
};

/** '자동값' — 저장해 둔 수기 값이 있으면 지울지 먼저 묻고, 지운 뒤 자동값으로 되돌린다. */
const handleAutoFillClick = async () => {
    const dateStr = document.getElementById('sim-target-date')?.value;
    if (!dateStr) return;
    const entries = savedSimEntries(dateStr);
    if (entries.length > 0) {
        const list = entries.map(e => ` · ${savedEntryText(e)}`).join('\n');
        const msg = `${dateStr}에 저장된 수기 작업량 ${entries.length}개를 삭제하고 자동값으로 되돌립니다.

${list}

삭제한 값은 되돌릴 수 없습니다. 계속할까요?`;
        if (!confirm(msg)) return;
        const rest = { ...(getPlannedQuantitiesForDate(dateStr) || {}) };
        SIM_TASKS.forEach(t => delete rest[t.key]);
        const restTime = { ...(getPlannedTimeTasksForDate(dateStr) || {}) };
        SIM_TIME_TASKS.forEach(t => delete restTime[t.key]);
        const ok = await savePlannedQuantities(dateStr, rest, { keepZeros: true, timeTasks: restTime, excludeMinutes: -1 });
        if (!ok) return;
    }
    autoFillSimInputs(dateStr);
    updateSavedInfo(dateStr);
    simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
    renderForecastSummary();
};

/** '업무 예상' 탭 진입 시 호출: 시뮬레이션 리스너 결합 + 오늘/내일 요약 + 상세 자동값 채움 */
export const renderForecastTab = () => {
    refreshTimeTasks();          // 실적에서 시간형 업무 목록을 뽑는다(바뀌면 입력칸을 다시 그림)
    renderSimTaskInputs();
    setupSimulationListeners();

    const dateEl = document.getElementById('sim-target-date');
    if (dateEl && !dateEl.value) dateEl.value = getTodayDateString();
    autoFillSimInputs(dateEl?.value);
    updateSavedInfo(dateEl?.value);
    simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
    renderForecastSummary();
    runSimulation({ silent: true });      // 오른쪽 결과칸을 자동값 기준으로 미리 채워 둔다

    // 예정 물량이 아직 안 실렸으면 로드 후 다시 채움(캐시라 대부분 즉시)
    fetchPlannedData().then(() => {
        const d = document.getElementById('sim-target-date')?.value;
        autoFillSimInputs(d);
        updateSavedInfo(d);
        simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
        renderForecastSummary();
        runSimulation({ silent: true });
    }).catch(() => {});

    const rBtn = document.getElementById('forecast-refresh-btn');
    if (rBtn && !rBtn.dataset.bound) {
        rBtn.dataset.bound = 'true';
        rBtn.addEventListener('click', () => {
            const d = document.getElementById('sim-target-date')?.value;
            autoFillSimInputs(d);
            updateSavedInfo(d);
            simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
            renderForecastSummary();
            runSimulation({ silent: true });
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
        dateEl.addEventListener('change', () => {
            autoFillSimInputs(dateEl.value);
            updateSavedInfo(dateEl.value);
            simOverride = null;   // 자동값으로 다시 채웠으므로 카드도 자동값 기준
            renderForecastSummary();
            runSimulation({ silent: true });
        });
    }
    document.getElementById('sim-autofill-btn')?.addEventListener('click', handleAutoFillClick);
    document.getElementById('sim-save-btn')?.addEventListener('click', saveSimQuantities);
    runBtn.addEventListener('click', () => runSimulation());

    // 값을 바꾸면 상단 요약 카드도 같은 값으로 다시 계산한다(입력이 잦으므로 살짝 미뤄서).
    let syncTimer = null;
    const syncSummary = () => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => { captureSimOverride(); renderForecastSummary(); }, 200);
    };
    ['sim-task-list', 'sim-staff-fulltime', 'sim-staff-parttimer', 'sim-exclude-min'].forEach(id => {
        const el = document.getElementById(id);
        el?.addEventListener('input', syncSummary);
        el?.addEventListener('change', syncSummary);
    });
    ['sim-staff-fulltime', 'sim-staff-parttimer'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', paintStaffTotal);
    });

    // 업무 제외시간은 10분 단위로 스냅하고, 옆에 '1시간 20분'처럼 풀어서 보여준다.
    const exclEl = document.getElementById('sim-exclude-min');
    exclEl?.addEventListener('input', paintExcludeHint);
    exclEl?.addEventListener('change', () => {
        const m = readExcludeMinutes();
        if (exclEl.value !== '') exclEl.value = m > 0 ? m : '';
        paintExcludeHint();
    });
    paintExcludeHint();

    // 중국제작 수량을 직접 고치면 샘플검수도 그 비율로 다시 계산한다.
    // 단, 예정 물량에 샘플검수를 수기로 넣어둔 날은 그 값을 덮지 않는다.
    // 입력칸은 JS가 다시 만들 수 있으므로 목록 컨테이너에 위임해서 듣는다.
    document.getElementById('sim-task-list')?.addEventListener('input', (e) => {
        if (!e.target.matches('#sim-qty-china')) return;
        const dateStr = document.getElementById('sim-target-date')?.value;
        if (!dateStr) return;
        if (todayActualQty(State.allHistoryData, dateStr, '샘플검수') != null) return;
        if (getPlanned(dateStr, '샘플검수') != null) return;
        const china = Number(e.target.value) || 0;
        const sampleTask = SIM_TASKS.find(t => t.id === 'sample');
        setQty('sample', china > 0 ? Math.round(computeSampleRatio(State.allHistoryData) * china) : 0);
        if (sampleTask) markSourceBadge(sampleTask, 'china-linked');
    });

    // 물량을 직접 고치면, 그 물량에 묶인 담당 업무(중국제작(담당)·직진배송 사전작업 등)도 다시 잡는다.
    // 물량이 0이 되면 그 담당 업무도 0이 된다.
    document.getElementById('sim-task-list')?.addEventListener('input', (e) => {
        const m = /^sim-qty-(.+)$/.exec(e.target?.id || '');
        if (!m) return;
        const changed = SIM_TASKS.find(t => t.id === m[1]);
        const dateStr = document.getElementById('sim-target-date')?.value;
        if (!changed || !dateStr) return;

        const lookup = (key) => {
            const t2 = SIM_TASKS.find(x => x.key === key);
            const el = t2 ? document.getElementById(`sim-qty-${t2.id}`) : null;
            return el ? (Number(el.value) || 0) : 0;
        };
        SIM_TIME_TASKS.forEach(t => {
            if (!timeTaskDeps(t.key).includes(changed.key)) return;
            if (getPlannedTime(dateStr, t.key)) return;      // 저장해 둔 값은 건드리지 않는다
            const v = autoTimeValueFor(dateStr, t, State.allHistoryData, lookup);
            setTimeInputs(t, v);
                markTimeSourceBadge(t, v.source, v.detail);
        });
    });

    document.getElementById('sim-reset-btn')?.addEventListener('click', () => {
        // 모든 수량/인원 입력 초기화 (업무 목록은 항상 기본 등록이므로 숨기지 않음)
        // ※ 저장해 둔 수기 값은 지우지 않는다(그건 '자동값' 버튼의 역할).
        SIM_TASKS.forEach(t => setQty(t.id, ''));
        SIM_TIME_TASKS.forEach(t => setTimeInputs(t, { minutes: 0, workers: 1 }));
        ['sim-staff-fulltime','sim-staff-parttimer','sim-exclude-min'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        showResultPlaceholder();
        paintStaffTotal();
        simOverride = null;              // 요약 카드는 자동값 기준으로 되돌린다
        renderForecastSummary();
    });

    // 초기 자동 채우기
    autoFillSimInputs(dateEl?.value);
    updateSavedInfo(dateEl?.value);
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

// 💡 배송량은 "건 / 장"으로 함께 표시한다. (장 = 상품수, 건 = 주문건수)
//
// 건수 환산 계수(건당 상품수)는 고정값 1.2가 아니라 **선택한 채널의 실제 기록**에서 구한다.
//   계수 = Σ배송량(장) ÷ Σ주문건수(건)   ← 최근 이력 중 둘 다 입력된 날만 사용
// 채널마다 건당 상품수가 다르므로(일반배송 ~1.2, 직진/도착보장은 다름) 채널별로 계산해야 맞다.
// 주문건수 기록이 아직 없는 채널·기간은 예전과 동일하게 1.2로 폴백한다.
const DEFAULT_ITEMS_PER_ORDER = 1.2;
let itemsPerOrder = DEFAULT_ITEMS_PER_ORDER;
// 직진배송·도착보장은 건수 개념이 없어 장수만 표시한다(전체도 섞이므로 장수만).
let showDeliveryCases = true;

const computeItemsPerOrder = (historyData, scope) => {
    let sumDel = 0, sumOrd = 0;
    (historyData || []).forEach(d => {
        const del = scope.deliveryOf(d);
        const ord = scope.orderCountOf(d);
        if (del > 0 && ord > 0) { sumDel += del; sumOrd += ord; }
    });
    if (sumOrd <= 0) return DEFAULT_ITEMS_PER_ORDER;
    const ratio = sumDel / sumOrd;
    // 비정상값(입력 실수 등) 방어 — 1건당 0.5~10장 범위를 벗어나면 기본값 사용
    return (ratio >= 0.5 && ratio <= 10) ? ratio : DEFAULT_ITEMS_PER_ORDER;
};

/** 장 → "N건 / M장" (건수 개념이 있는 채널만 병기, 그 외는 "M장") */
const formatDelivery = (val) => {
    const v = Math.round(Number(val) || 0);
    if (!showDeliveryCases) return `${v.toLocaleString()}장`;
    if (v <= 0) return '0건 / 0장';
    const cases = Math.round(v / (itemsPerOrder || DEFAULT_ITEMS_PER_ORDER));
    return `${cases.toLocaleString()}건 / ${v.toLocaleString()}장`;
};

/** 장 수를 건수로만 환산 (범위 표기용) */
const toCases = (val) => Math.round((Number(val) || 0) / (itemsPerOrder || DEFAULT_ITEMS_PER_ORDER));

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

    // 배송량의 "건" 환산 계수도 선택한 채널 기준으로 갱신 (채널마다 건당 상품수가 다름)
    itemsPerOrder = computeItemsPerOrder(historyData, scope);
    showDeliveryCases = scope.showDeliveryCases !== false;

    // 주문건수는 세 채널 모두 유효하므로 항상 표시한다.
    // 다만 풀필먼트 채널(직진배송·도착보장)은 '그날 보낸 장수'와 '그날 잡히는 주문건수'가
    // 서로 다른 시점의 값이라 둘을 연결해 보면 안 된다는 안내를 띄운다.
    ['pred-card-tomorrow-ord', 'pred-card-avg-ord', 'pred-today-ord-block'].forEach(id => {
        document.getElementById(id)?.classList.remove('hidden');
    });
    const noteEl = document.getElementById('pred-fulfillment-note');
    if (noteEl) {
        const isFulfillment = scope.fulfillment === true && predChannelId !== 'all';
        noteEl.classList.toggle('hidden', !isFulfillment);
        if (isFulfillment) {
            noteEl.innerHTML = `ℹ️ <b>${scope.label}</b>은 풀필먼트(채널 창고로 선입고 후 판매) 방식입니다. `
                + `배송량(장)은 <b>우리가 그날 보낸 수량</b>, 매출·주문건수는 <b>그날 채널에서 수집된 판매 실적</b>이라 `
                + `서로 다른 시점의 값입니다. 두 값을 곱하거나 나눠 비교하지 말고 <b>각각 따로</b> 보세요.`;
        }
    }

    const result = predictFutureTrends(historyData, daysToPredict, scope);

    // 차트 제목에 현재 기준 표시
    const scopeSuffix = predChannelId === 'all' ? '(전체 합계)' : `(${scope.label})`;
    const revScopeEl = document.getElementById('pred-chart-rev-scope');
    const delScopeEl = document.getElementById('pred-chart-del-scope');
    if (revScopeEl) revScopeEl.textContent = scopeSuffix;
    if (delScopeEl) {
        const base = predChannelId === 'all' ? '전체 합계' : scope.deliverySource;
        if (showDeliveryCases) {
            delScopeEl.textContent = `(${base} · 건당 ${itemsPerOrder.toFixed(2)}장 기준)`;
            delScopeEl.title = itemsPerOrder === DEFAULT_ITEMS_PER_ORDER
                ? '주문건수 기록이 없어 기본값 1.2장/건으로 환산했습니다.'
                : '실제 기록(Σ배송량 ÷ Σ주문건수)에서 계산한 건당 상품수입니다.';
        } else {
            delScopeEl.textContent = `(${base} · 장수 기준)`;
            delScopeEl.title = '이 채널은 주문 건수 개념이 없어 장수(상품수)로만 표시합니다.';
        }
    }

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
            const rangeTxt = showDeliveryCases
                ? `(최소 ${toCases(minDel).toLocaleString()}건 ~ 최대 ${toCases(maxDel).toLocaleString()}건)`
                : `(최소 ${minDel.toLocaleString()}장 ~ 최대 ${maxDel.toLocaleString()}장)`;
            elTomDel.innerHTML = `${formatDelivery(tomorrow.delivery)} <span class="text-[11px] text-gray-500 font-normal ml-1 mt-1 block md:inline">${rangeTxt}</span>`;
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