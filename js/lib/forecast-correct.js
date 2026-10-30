// === js/lib/forecast-correct.js ===
// 설명: 업무 예상 '보정 계획' 계산(순수 함수) — 보정 2단계 중 1단계(계산·시험·과거 시뮬레이션). 앱 화면은 아직 안 쓴다.
//
//  왜 필요한가
//    정확도 탭의 계획 적중(절대평균)이 관리자 개별업무를 빼고도 20% 안팎이다. 남은 원인은 셋:
//      · 계획 외 유입 — 반복해서 하는 업무가 계획에 없다(예: 주 3회꼴 업무)
//      · 업무별 편향 — 계획한 업무가 늘 더/덜 걸린다(물량을 크게 잡거나, 속도를 빠르게 잡거나)
//      · 돌발 — 어쩌다 한 번 하는 업무
//    이 모듈은 기본 계획(base)을 받아 지난 실적으로 위 셋을 보정한 계획을 만든다.
//
//  규칙 (input.target 이전 자료만 쓴다 — 당일·미래 기록은 보지 않는다)
//    W = target 이전, 기록(workRecords)이 있는 최근 windowDays(40) 근무일.
//    ③ 편향 kind 'plan' — 기본 계획 시간 > 0 인 업무.
//       표본 S = W 의 최근 biasDays(20)일 중 스냅샷이 있고 그날 그 업무 계획 시간 > 0 인 날.
//       f_raw = Σ실제시간 / Σ계획시간 (계획했는데 실적이 없는 날도 0 으로 넣는다)
//       f = (n·f_raw + K) / (n + K), n < minN(3) 이면 1, [clampMin, clampMax] 로 자른다.
//       fVol = Σ실제물량 / Σ계획물량 (수량형만, 같은 방식). 시간형은 null.
//       sources[k] 가 '물량을 자료로 정한' 출처(FIXED_SOURCES)면 물량은 이미 맞다고 보고 속도 몫만 쓴다:
//         배율 = clamp(f / fVol). 그 밖에는 배율 = f.   h = base × 배율.
//    ② 확률 kind 'prob' — 기본 계획 시간 0(시간형 0명 포함)·제외 아님·W 안에서 minHits(4)일 이상 한 업무.
//       p = 그 업무가 '계획에 없던 날'(스냅샷 기준, 정확도와 같은 '계획에 올라 있음' 판정) 중 실제로 한 날 비율.
//         target 과 같은 요일 표본이 dowMin(3)일 이상이면 요일별 p 를 쓰되 전체 p 쪽으로 dowPull(2)일치 당긴다.
//         W 안 스냅샷 있는 날이 minSnapDays(10) 미만이면 '그 업무를 한 날 / W 일수' 로 대신한다(notes).
//       h = p × 하는 날 평균 시간(최근 recentHits(10)회).
//    ④ 여유 reserveHours — W 안에서 minHits 미만 한 업무(돌발)의 하루 평균 시간.
//       상한 = 기본 총시간(base.totalHours, 없으면 기본 계획 시간 합) × reserveCapRatio(10%). byTask 에는 넣지 않는다.
//
//  totalHours 와 reserveHours 를 나눈 이유
//    totalHours = byTask 의 h 합 — 계획 적중(계획한 업무만의 오차)을 볼 때 쓰는 계획 시간이다.
//    돌발 여유는 어느 업무에 붙일 수 없으므로 계획 적중에는 넣지 않고,
//    총량 오차(그날 전체 인시)를 볼 때만 totalHours + reserveHours 로 더한다.
//
//  숫자는 소수 3자리. 결과에는 업무 이름·숫자만 있다(직원 이름·기록자 없음).
//  import 는 ../forecast-accuracy.js 하나 — DOM·State·Firebase 를 쓰지 않는다(node 테스트: tests/forecast-correct.test.js).

import { planHoursByTaskOf } from '../forecast-accuracy.js?v=202610301817';

export const DEFAULTS = Object.freeze({
    K: 5,                   // 편향 당김 — 표본 n 일에 '배율 1' 을 K 일치 섞는다
    minN: 3,                // 표본이 이보다 적으면 배율 1
    clampMin: 0.6,
    clampMax: 1.6,
    windowDays: 40,         // W — 근무일 창
    biasDays: 20,           // 편향 표본은 W 의 최근 이만큼
    minHits: 4,             // 확률 업무가 되려면 W 안에서 이만큼 이상 한 날
    minSnapDays: 10,        // 이보다 스냅샷 날이 적으면 p = 한 날 / W 일수
    dowMin: 3,              // 같은 요일 표본이 이만큼 이상이면 요일별 p
    dowPull: 2,             // 요일 p 를 전체 p 쪽으로 당기는 날 수
    recentHits: 10,         // 하는 날 평균 시간 — 최근 이만큼
    reserveCapRatio: 0.1    // 여유 상한 = 기본 총시간 × 이 비율
});

/** 물량을 자료(전송·채우기 지시서·예정 입력·밀림 배수)로 정한 출처 — 물량 편향은 빼고 속도만 보정한다. */
export const FIXED_SOURCES = Object.freeze(['transmit', 'transmit-none', 'refill', 'planned', 'ai-carry', 'cadence-carry']);

const 수 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const 양수 = (v) => { const n = 수(v); return n > 0 ? n : 0; };
const r3 = (v) => (v == null || !Number.isFinite(v) ? v : Math.round(v * 1000) / 1000);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const 이름 = (v) => String(v == null ? '' : v).trim();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → 요일(0=일). 시간대와 무관하게 UTC 로 본다. */
const 요일 = (id) => new Date(`${id}T00:00:00Z`).getUTCDay();

/** 스냅샷에서 '그날 계획에 올라 있던 업무' — forecast-accuracy.js 계획된키 와 같은 기준(수량 > 0 또는 투입시간 > 0). */
const 계획된키 = (snap) => {
    const keys = new Set();
    Object.entries(snap?.tasks || {}).forEach(([k, v]) => { if (양수(v) > 0) keys.add(k); });
    Object.entries(snap?.timeTasks || {}).forEach(([k, v]) => { if (양수(v?.minutes) > 0) keys.add(k); });
    return keys;
};

/** 하루치 업무별 실제 시간(시간). 업무명 없는 기록·제외 업무는 뺀다. */
const 실적시간 = (day, excluded) => {
    const out = {};
    (day?.workRecords || []).forEach(r => {
        const m = 수(r?.duration);
        const k = 이름(r?.task);
        if (m <= 0 || !k || excluded.has(k)) return;
        out[k] = (out[k] || 0) + m / 60;
    });
    return out;
};

/** 표본 비율을 배율로 — n < minN 이면 1, 아니면 K 일치 1 을 섞고 자른다. */
const 당김 = (n, raw, o) => {
    if (n < o.minN || raw == null || !Number.isFinite(raw)) return 1;
    return clamp((n * raw + o.K) / (n + o.K), o.clampMin, o.clampMax);
};

/**
 * 보정 계획.
 *
 * @param {object} input
 *   target    'YYYY-MM-DD' — 이 날의 계획을 만든다. 이보다 앞선 날만 쓴다.
 *   history   [{ id, taskQuantities, workRecords:[{task, duration(분)}] }] — 지금 이름·제외 업무 뺀 것
 *   snapshots { 날짜: 스냅샷 } — 별칭·제외 적용된 것
 *   base      { tasks, timeTasks, uph, totalHours } — 그날 기본 계획(스냅샷 모양)
 *   sources   { 업무: 출처 } (선택) — FIXED_SOURCES 면 속도 몫만 보정
 *   excluded  Set<업무> — 결과·계산에서 뺀다(넘겨받은 자료에 남아 있어도)
 *   opts      DEFAULTS 일부 덮어쓰기
 * @returns {{ v:1, totalHours, reserveHours, byTask:Array, params, notes:string[] }}
 *   byTask: { k, kind:'plan'|'prob', base, f, fVol, n, p, h } — plan 은 p=null, prob 은 f·fVol=null
 */
export function correctPlan(input) {
    const inp = input || {};
    const o = { ...DEFAULTS, ...(inp.opts || {}) };
    const notes = [];
    const target = typeof inp.target === 'string' && DATE_RE.test(inp.target) ? inp.target : null;
    const excluded = new Set([...(inp.excluded || [])].map(이름).filter(Boolean));
    const snaps = inp.snapshots && typeof inp.snapshots === 'object' ? inp.snapshots : {};
    const sources = inp.sources && typeof inp.sources === 'object' ? inp.sources : {};
    const base = inp.base || {};
    if (!target) notes.push('target 날짜가 없거나 형식이 틀립니다 — 이력을 쓰지 않았습니다');

    // W — target 이전, 기록 있는 최근 windowDays 일(최신순)
    const W = !target ? [] : (Array.isArray(inp.history) ? inp.history : [])
        .filter(d => d && typeof d.id === 'string' && DATE_RE.test(d.id) && d.id < target)
        .filter(d => Array.isArray(d.workRecords) && d.workRecords.length > 0)
        .sort((a, b) => b.id.localeCompare(a.id))
        .slice(0, o.windowDays);
    const 시간 = new Map(W.map(d => [d.id, 실적시간(d, excluded)]));
    // target 이전 스냅샷만(키가 날짜인 것) — W 날짜에서만 꺼내 쓰므로 당일·미래는 자연히 빠진다
    const snapOf = (id) => (id < target && snaps[id]) ? snaps[id] : null;
    const 계획시간캐시 = new Map();
    const 계획시간 = (id) => {
        if (!계획시간캐시.has(id)) {
            const s = snapOf(id);
            계획시간캐시.set(id, s ? planHoursByTaskOf(s).planHoursByTask : null);
        }
        return 계획시간캐시.get(id);
    };

    const basePlan = planHoursByTaskOf(base).planHoursByTask;
    const baseTotal = 양수(base.totalHours) > 0 ? 양수(base.totalHours)
        : Object.values(basePlan).reduce((a, h) => a + 양수(h), 0);
    const byTask = [];

    // ③ 편향 — 기본 계획 시간 > 0 인 업무
    const planKeys = Object.keys(basePlan).filter(k => 양수(basePlan[k]) > 0 && !excluded.has(k)).sort();
    const biasW = W.slice(0, o.biasDays);
    planKeys.forEach(k => {
        let n = 0, sumPlanH = 0, sumActH = 0, nVol = 0, sumPlanQ = 0, sumActQ = 0;
        biasW.forEach(d => {
            const ph = 계획시간(d.id);
            if (!ph || !(양수(ph[k]) > 0)) return;
            n++;
            sumPlanH += ph[k];
            sumActH += 양수(시간.get(d.id)[k]);
            const pq = 양수(snapOf(d.id)?.tasks?.[k]);
            if (pq > 0) {
                nVol++;
                sumPlanQ += pq;
                sumActQ += 양수(d.taskQuantities?.[k]);
            }
        });
        const f = 당김(n, sumPlanH > 0 ? sumActH / sumPlanH : null, o);
        const isQty = 양수(base.tasks?.[k]) > 0;
        const fVol = isQty ? 당김(nVol, sumPlanQ > 0 ? sumActQ / sumPlanQ : null, o) : null;
        const fixed = FIXED_SOURCES.includes(sources[k]);
        const m = (fixed && fVol != null && fVol > 0) ? clamp(f / fVol, o.clampMin, o.clampMax) : f;
        byTask.push({ k, kind: 'plan', base: r3(basePlan[k]), f: r3(f), fVol: r3(fVol), n,
                      p: null, h: r3(basePlan[k] * m), ...(fixed ? { speedOnly: true } : {}) });
    });

    // 업무별로 W 안에서 한 날(실제 시간 > 0)
    const hitDays = new Map();   // k → [id…] 최신순
    W.forEach(d => {
        Object.entries(시간.get(d.id)).forEach(([k, h]) => {
            if (!(h > 0)) return;
            if (!hitDays.has(k)) hitDays.set(k, []);
            hitDays.get(k).push(d.id);
        });
    });

    // ② 확률 — 기본 계획에 없는(계획 시간 0) 반복 업무
    const planSet = new Set(planKeys);
    const snapDays = W.filter(d => snapOf(d.id));
    const 스냅샷부족 = snapDays.length < o.minSnapDays;
    const wd = target ? 요일(target) : null;
    const probKeys = [...hitDays.keys()]
        .filter(k => !planSet.has(k) && !excluded.has(k) && hitDays.get(k).length >= o.minHits).sort();
    let 대체수 = 0;
    probKeys.forEach(k => {
        const hits = new Set(hitDays.get(k));
        let p;
        const off = 스냅샷부족 ? [] : snapDays.filter(d => !계획된키(snapOf(d.id)).has(k));
        if (스냅샷부족 || off.length === 0) {
            p = W.length > 0 ? hits.size / W.length : 0;
            대체수++;
        } else {
            const pAll = off.filter(d => hits.has(d.id)).length / off.length;
            const same = off.filter(d => 요일(d.id) === wd);
            if (same.length >= o.dowMin) {
                const hitSame = same.filter(d => hits.has(d.id)).length;
                p = (hitSame + o.dowPull * pAll) / (same.length + o.dowPull);
            } else {
                p = pAll;
            }
        }
        const recent = hitDays.get(k).slice(0, o.recentHits);
        const avg = recent.reduce((a, id) => a + 양수(시간.get(id)[k]), 0) / recent.length;
        byTask.push({ k, kind: 'prob', base: 0, f: null, fVol: null, n: recent.length, p: r3(p), h: r3(p * avg) });
    });
    if (대체수 > 0) {
        notes.push(스냅샷부족
            ? `스냅샷 있는 날이 ${snapDays.length}일(${o.minSnapDays}일 미만) — 확률 업무 ${대체수}개는 '한 날 / 근무일 ${W.length}일' 로 셈`
            : `계획에 없던 날이 없어 확률 업무 ${대체수}개는 '한 날 / 근무일 ${W.length}일' 로 셈`);
    }

    // ④ 여유 — 드문 업무(minHits 미만)의 하루 평균 시간
    let rareSum = 0;
    hitDays.forEach((ids, k) => {
        if (planSet.has(k) || excluded.has(k) || ids.length >= o.minHits) return;
        ids.forEach(id => { rareSum += 양수(시간.get(id)[k]); });
    });
    const cap = baseTotal * o.reserveCapRatio;
    const rawReserve = W.length > 0 ? rareSum / W.length : 0;
    const reserveHours = Math.min(rawReserve, cap);
    if (rawReserve > cap) notes.push(`여유 ${r3(rawReserve)}시간이 상한(기본 총시간의 ${Math.round(o.reserveCapRatio * 100)}%)에 걸려 ${r3(cap)}시간`);

    if (W.length === 0 && target) notes.push('target 이전 기록이 없습니다 — 기본 계획 그대로');

    const totalHours = byTask.reduce((a, t) => a + 양수(t.h), 0);
    // 기본 계획에 올라 있지만 계획 시간이 0 인 업무(시간형 0명·기준 UPH 없음) — 보정 쪽에서도 '계획에 있던 업무'로 남겨야
    // 그 업무의 실적이 기본은 계획 업무, 보정은 계획 외로 갈려 비교가 기우는 일이 없다(toAccuracySnap 이 씀)
    const inByTask = new Set(byTask.map(t => t.k));
    const zeroPlanKeys = [...계획된키(base)].filter(k => !inByTask.has(k) && !excluded.has(k)).sort();
    return {
        v: 1,
        totalHours: r3(totalHours),
        reserveHours: r3(reserveHours),
        byTask,
        zeroPlanKeys,
        params: { ...o, target, windowCount: W.length, biasCount: biasW.length, snapDays: snapDays.length,
                  baseTotal: r3(baseTotal) },
        notes
    };
}

/** 보정 결과 → decomposeAccuracy 가 읽는 스냅샷 모양. 업무는 전부 시간형(h 시간, 1명)으로 넣는다.
 *  ⚠️ 수량형도 시간형으로 바뀌므로, 미착수 판정의 '물량만 입력한 날 예외'는 적용되지 않는다(시뮬레이션 비교용). */
export function toAccuracySnap(c) {
    const timeTasks = {};
    (c?.byTask || []).forEach(t => {
        if (양수(t.h) > 0) timeTasks[t.k] = { minutes: t.h * 60, workers: 1 };
    });
    // 계획 시간 0 인 계획 업무는 물량 1·UPH 없음으로 넣는다 — 계획된키 에는 잡히고 계획 시간은 0(기본 쪽과 같은 분류)
    const tasks = {};
    (c?.zeroPlanKeys || []).forEach(k => { if (!timeTasks[k]) tasks[k] = 1; });
    return { tasks, timeTasks, uph: {}, totalHours: 수(c?.totalHours), auto: true };
}

/** 총량 오차 = (그날 실제 인시 − planTotal) / planTotal. 실제 인시는 업무명 없는 기록도 포함(정확도 actualHours 와 같음).
 *  planTotal 이 0 이하면 null. */
export function totalErr(planTotal, day) {
    const plan = 수(planTotal);
    if (!(plan > 0)) return null;
    const actual = (day?.workRecords || []).reduce((a, r) => {
        const m = 수(r?.duration);
        return a + (m > 0 ? m / 60 : 0);
    }, 0);
    return (actual - plan) / plan;
}
