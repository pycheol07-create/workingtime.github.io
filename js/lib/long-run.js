// === js/lib/long-run.js — 오래 켜진 업무 찾기(순수, node 시험 tests/long-run.test.js) ===
// 대시보드 '내 업무' 위 경고(js/long-run-warn.js)가 쓴다(2026-11-26 앱 점검 — '종료' 를 안 눌러 기록이 쌓이던 일 예방).
// 진행 중(ongoing)인 내 기록만 본다. 휴식(paused) 중인 기록은 일부러 멈춘 것이라 뺀다.
// 걸린 시간 = 지금 − 시작 − 휴식(끝난 휴식 + 아직 안 끝난 휴식은 지금까지).

export const LONG_RUN_MIN = 360;                 // 6시간
export const SNOOZE_MS = 3 * 60 * 60 * 1000;     // [계속 진행 중] → 3시간 동안 다시 안 띄움

/** 'HH:MM' → 분(못 읽으면 null) */
export function hhmmToMin(s) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(s == null ? '' : s));
    if (!m) return null;
    const h = Number(m[1]), mi = Number(m[2]);
    return (h > 23 || mi > 59) ? null : h * 60 + mi;
}

/** 휴식 합(분) — 끝이 없거나 지금보다 늦으면 지금까지만 */
export function pauseMinutesUntil(pauses, nowMin) {
    let sum = 0;
    for (const p of Array.isArray(pauses) ? pauses : []) {
        const s = hhmmToMin(p && p.start);
        if (s == null || s >= nowMin) continue;
        let e = hhmmToMin(p && p.end);
        if (e == null || e > nowMin) e = nowMin;
        if (e > s) sum += e - s;
    }
    return sum;
}

/**
 * @param {Array} records   오늘 workRecords
 * @param {string} me       내 이름(대시보드 currentUser)
 * @param {string} nowHHMM  지금 'HH:MM'
 * @param {{thresholdMin?:number, snoozed?:Object<string,number>, nowMs?:number}} o  snoozed = {기록id: 다시 띄울 시각(ms)}
 * @returns {{id:string, task:string, startTime:string, minutes:number}[]}  오래된 순
 */
export function longRunning(records, me, nowHHMM, o = {}) {
    const { thresholdMin = LONG_RUN_MIN, snoozed = {}, nowMs = Date.now() } = o;
    const now = hhmmToMin(nowHHMM);
    if (now == null || !me) return [];
    const out = [];
    for (const r of Array.isArray(records) ? records : []) {
        if (!r || r.member !== me || r.status !== 'ongoing' || r.id == null) continue;
        const s = hhmmToMin(r.startTime);
        if (s == null || s > now) continue;
        const minutes = Math.max(0, now - s - pauseMinutesUntil(r.pauses, now));
        const id = String(r.id);
        if (minutes < thresholdMin) continue;
        if (Number(snoozed[id]) > nowMs) continue;
        out.push({ id, task: String(r.task || ''), startTime: String(r.startTime), minutes });
    }
    return out.sort((a, b) => b.minutes - a.minutes);
}

/** 미룸 표에서 지난 것 빼기(저장 크기 유지) */
export function pruneSnoozed(snoozed, nowMs) {
    const out = {};
    for (const [k, v] of Object.entries(snoozed || {})) if (Number(v) > nowMs) out[k] = Number(v);
    return out;
}
