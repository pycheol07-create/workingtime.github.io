// === js/lib/forecast-correct-apply.js ===
// 설명: 업무 예상 '보정 계획' 켜기(2026-11-05) — correctPlan 결과(js/lib/forecast-correct.js)를
//       시뮬레이션 입력(simulateOneDay 의 inputs·taskUPH)에 되돌려 넣는다. 화면 계획·필요 인원·운영 계획·슬랙 훅이 같은 값을 쓴다.
//
//  규칙
//    · 물량 업무(kind 'plan', 수량 > 0 · UPH > 0): 수량은 그대로, UPH ÷ 배율 — 소요시간 = 기본 × 배율.
//    · 시간 업무(kind 'plan', 투입시간 > 0 · 인원 > 0): 투입시간(분) × 배율. 인원은 그대로.
//    · 가끔 하는 계획 업무(kind 'prob', fromPlan): 배율 = h ÷ 기본 계획 시간(0 이면 그 업무는 0시간 —
//      물량 업무는 수량을 0 으로, 시간 업무는 투입시간을 0 으로).
//    · 계획 밖 반복 업무(kind 'prob', fromPlan 아님): extraHours{업무: h} 로 따로 더한다.
//    · 돌발 여유(reserveHours): extraHours['_reserve'].
//    · manualKeys(사람이 정한 값 — 예정 물량·저장한 시간·오늘 실적·화면에서 고친 칸·'진행 시' 물량): 배율 1, 추가 시간 없음.
//    · opts.noExtraKeys(자료가 물량을 정한 업무 — noExtraKeysOf): 계획 밖 반복 업무 시간을 더하지 않는다
//      (자료가 '그날 0' 이라고 정했는데 확률로 시간을 붙이면 안 된다). 배율은 그대로 건다.
//    · c 가 없거나 비어 있으면 입력을 그대로(복사본) 돌려준다.
//
//  순수 모듈(DOM·State·Firebase 없음). 입력 객체는 고치지 않는다. 테스트: tests/forecast-correct-apply.test.js

export const RESERVE_KEY = '_reserve';

const 수 = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const 양수 = (v) => { const n = 수(v); return n > 0 ? n : 0; };
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * @param {object} inputs     simulateOneDay 입력 { tasks{업무:수량}, timeTasks{업무:{minutes,workers}}, … }
 * @param {object} taskUPH    { 업무: UPH }
 * @param {object} c          correctPlan 결과 { byTask, reserveHours, … }
 * @param {Iterable<string>} manualKeys 사람이 정한 업무
 * @param {object} [opts]   { noExtraKeys: Iterable<string> } — 계획 밖 반복 업무 시간을 더하지 않을 업무
 * @returns {{ inputs, taskUPH, factors:{업무:{kind, m, p, fromPlan}}, extra:{업무:시간}, extraP:{업무:확률}, reserveHours, zeroed:string[] }}
 *   inputs 는 원래 칸 + extraHours(추가 시간이 있을 때만). factors 는 배율을 실제로 건 업무만(배율 1 도 포함).
 */
export function correctedInputs(inputs, taskUPH, c, manualKeys, opts = {}) {
    const src = inputs || {};
    const manual = new Set([...(manualKeys || [])]);
    const noExtra = new Set([...((opts && opts.noExtraKeys) || [])]);
    const tasks = { ...(src.tasks || {}) };
    const timeTasks = {};
    Object.entries(src.timeTasks || {}).forEach(([k, v]) => { timeTasks[k] = { ...(v || {}) }; });
    const uph = { ...(taskUPH || {}) };
    const factors = {};
    const extra = {};
    const extraP = {};
    const zeroed = [];

    (c?.byTask || []).forEach(t => {
        const k = t && t.k;
        if (!k || manual.has(k)) return;
        const isQty = 양수(tasks[k]) > 0 && 양수(uph[k]) > 0;
        const tt = timeTasks[k];
        const isTime = !isQty && !!tt && 양수(tt.minutes) > 0 && Math.round(양수(tt.workers)) > 0;
        if (t.kind === 'plan' || t.fromPlan) {
            const base = 양수(t.base);
            if (!(base > 0) || (!isQty && !isTime)) return;
            const m = 양수(t.h) / base;
            if (isQty) {
                if (m > 0) uph[k] = uph[k] / m;
                else { tasks[k] = 0; zeroed.push(k); }
            } else {
                timeTasks[k] = { ...tt, minutes: tt.minutes * m };
                if (!(m > 0)) zeroed.push(k);
            }
            factors[k] = { kind: t.kind, m: r3(m), p: t.p ?? null, fromPlan: !!t.fromPlan };
            return;
        }
        // 계획 밖 반복 업무 — 계획에 이미 시간이 있는 업무(데이터가 어긋난 경우)에는 더하지 않는다
        if (t.kind === 'prob' && 양수(t.h) > 0 && !isQty && !isTime && !noExtra.has(k)) { extra[k] = 양수(t.h); extraP[k] = t.p ?? null; }
    });

    const reserveHours = 양수(c?.reserveHours);
    const extraHours = { ...extra };
    if (reserveHours > 0) extraHours[RESERVE_KEY] = reserveHours;
    const out = { ...src, tasks, timeTasks };
    if (Object.keys(extraHours).length > 0) out.extraHours = extraHours;
    return { inputs: out, taskUPH: uph, factors, extra, extraP, reserveHours, zeroed: zeroed.sort() };
}

/** 자료가 그날 물량을 정한 출처 — 계획 밖 반복 업무 시간을 붙이지 않는다(배율은 건다).
 *  ALWAYS: 값과 상관없이(전송값·전송 없음·채우기 지시서·공휴일 0).
 *  WHEN_ZERO: 그날 값이 0 일 때만(입고일정·입고 박스·중국제작 연동·빈도 판정 '안 하는 날'). */
export const NO_EXTRA_ALWAYS = Object.freeze(['transmit', 'transmit-none', 'refill', 'holiday-off']);
export const NO_EXTRA_WHEN_ZERO = Object.freeze(['incoming', 'incoming-boxes', 'china-linked', 'cadence-off']);

/** sources{업무: 출처} + tasks{업무: 수량} → 계획 밖 반복 업무 시간을 붙이지 않을 업무 목록 */
export function noExtraKeysOf(sources, tasks) {
    const t = tasks || {};
    return Object.entries(sources || {})
        .filter(([k, src]) => NO_EXTRA_ALWAYS.includes(src) || (NO_EXTRA_WHEN_ZERO.includes(src) && !(수(t[k]) > 0)))
        .map(([k]) => k)
        .sort();
}

/** 그날 기본 계획(입력 + 시뮬레이션 결과) → correctInputOf 가 받는 스냅샷 모양.
 *  얼리는 스냅샷(buildAutoForecastSnapshot·buildForecastSnapshot)과 같은 규칙 — UPH 는 소수 2자리, 총시간은 3자리. */
export function planBaseOf(inputs, taskUPH, r, taskKeys) {
    const uph = {};
    (taskKeys || Object.keys(taskUPH || {})).forEach(k => {
        const v = 수((taskUPH || {})[k]);
        if (v > 0) uph[k] = Number(v.toFixed(2));
    });
    return {
        tasks: { ...((inputs || {}).tasks || {}) },
        timeTasks: { ...((inputs || {}).timeTasks || {}) },
        uph,
        totalHours: Number(수(r && r.totalHours).toFixed(3))
    };
}
