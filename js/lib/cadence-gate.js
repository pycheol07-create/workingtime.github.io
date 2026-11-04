// === js/lib/cadence-gate.js ===
// 설명: 빈도 추정의 '사전작업 없음 → 다음 근무일 출고 없음' 판정(순수 함수). 2026-11-04 사용자 결정(업무 예상 개선 B).
//
//  규칙
//    전 근무일에 사전작업을 안 했으면(그날 기록이 다 적혔는데 사전작업 기록이 없음) 다음 근무일 출고는 0.
//    단, 전 근무일에 그 업무의 전송값(로케이션 전송)이 있으면 0 으로 만들지 않는다(준비 기록만 빠진 신호).
//    반례가 쌓이면 저절로 꺼진다 — 최근 '사전작업 없음 다음날' recent(20)번 중 출고한 날이 maxHits(1)번을 넘으면 끈다.
//    관찰이 minObs(5)번 미만이면 판정하지 않는다(끔).
//
//  사전작업 상태('ready'|'with'|'none')·'기록이 다 적힌 날' 판정은 부르는 쪽(ui-history-prediction.js) 기준을 그대로 받는다.
//  DOM·State·Firebase 를 쓰지 않는다(node 테스트: tests/cadence-gate.test.js).

export const GATE_DEFAULTS = Object.freeze({
    recent: 20,     // 최근 이만큼의 '사전작업 없음 다음날'만 본다
    maxHits: 1,     // 그중 출고한 날이 이만큼 이하일 때만 켠다(2번 이상이면 끔)
    minObs: 5       // 관찰이 이보다 적으면 판정 안 함
});

/** 하루의 선행 업무 상태 — 'ready'(사전작업만 하고 출고 없음) | 'with'(사전작업 + 출고) | 'none'(사전작업 없음).
 *  소요시간을 안 적은 기록도 '한 날'이다 — 기록이 있는지만 본다. */
export function precursorStateOfDay(day, preKeys, outKeys) {
    const done = (day?.workRecords || []).some(r => r && preKeys.includes(r.task));
    if (!done) return 'none';
    let out = 0;
    outKeys.forEach(k => { out += Number(day?.taskQuantities?.[k]) || 0; });
    return out > 0 ? 'with' : 'ready';
}

/** 그 날 기록이 대개 다 적혔는가 — 기록 건수가 그 이전 최근 10근무일(days 중) 건수 중앙값의 절반 이상.
 *  이전 날이 3일 미만이면 false. days 는 기록 있는 날 목록(순서 무관). */
export function looksRecorded(day, days) {
    const n = (day?.workRecords || []).length;
    if (n === 0) return false;
    const counts = (Array.isArray(days) ? days : []).filter(d => d.id < day.id)
        .sort((a, b) => a.id.localeCompare(b.id)).slice(-10)
        .map(d => (d.workRecords || []).length).sort((a, b) => a - b);
    if (counts.length < 3) return false;
    return n >= counts[Math.floor(counts.length / 2)] * 0.5;
}

/** 기록 있는 날 목록(오래된 → 최신)에서 '사전작업 없음 다음날' 관찰 — 원소 = 그날 이 업무를 출고했나.
 *  전 근무일(목록상 바로 앞 날)이 다 적힌 날일 때만 센다. today 이후 날은 물량이 덜 들어왔을 수 있어 출고가 잡혔을 때(반례)만 센다. */
export function noneNextObs(days, { taskKey, preKeys, outKeys, today = '9999-12-31' } = {}) {
    const obs = [];
    if (!Array.isArray(days) || !Array.isArray(preKeys) || preKeys.length === 0) return obs;
    for (let i = 1; i < days.length; i++) {
        if (precursorStateOfDay(days[i - 1], preKeys, outKeys || []) !== 'none') continue;
        const shipped = (Number(days[i].taskQuantities?.[taskKey]) || 0) > 0;
        if (!(shipped || days[i].id < today)) continue;
        if (!looksRecorded(days[i - 1], days)) continue;
        obs.push(shipped);
    }
    return obs;
}

/** '사전작업 없음 다음날' 관찰 목록(오래된 → 최신, 각 원소 = 그날 출고했는가)에서 최근 recent 개의 { hit, total }. */
export function noneNextStats(obs, opts = {}) {
    const o = { ...GATE_DEFAULTS, ...opts };
    const list = Array.isArray(obs) ? obs.slice(-o.recent) : [];
    return { hit: list.filter(Boolean).length, total: list.length };
}

/**
 * 대상일 출고를 0 으로 막을지.
 * @param {object} p
 *   pre                전 근무일 사전작업 상태 'ready'|'with'|'none'|null(모름)
 *   prevRecorded       전 근무일이 실제 기록이 있고 다 적힌 날인가 — 저장해 둔 예정 시간으로 낸 'none' 은 false
 *   noneStats          { hit, total } — noneNextStats 결과
 *   transmittedOnPrev  전 근무일에 이 업무 전송값(합 > 0)이 있었나
 *   opts               GATE_DEFAULTS 일부 덮어쓰기
 * @returns {{ off: boolean, reason: string }}
 *   reason: 'off' | 'pre-unknown' | 'pre-done' | 'not-recorded' | 'transmitted' | 'few-obs' | 'counterexamples'
 */
export function precursorOffGate({ pre = null, prevRecorded = false, noneStats = null, transmittedOnPrev = false, opts = {} } = {}) {
    const o = { ...GATE_DEFAULTS, ...opts };
    if (pre == null) return { off: false, reason: 'pre-unknown' };
    if (pre !== 'none') return { off: false, reason: 'pre-done' };
    if (!prevRecorded) return { off: false, reason: 'not-recorded' };
    if (transmittedOnPrev) return { off: false, reason: 'transmitted' };
    const total = Number(noneStats?.total) || 0;
    const hit = Number(noneStats?.hit) || 0;
    if (total < o.minObs) return { off: false, reason: 'few-obs' };
    if (hit > o.maxHits) return { off: false, reason: 'counterexamples' };
    return { off: true, reason: 'off' };
}
