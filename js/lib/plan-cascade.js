// === js/lib/plan-cascade.js ===
// 운영 계획 v2 D4 — 목표 연결: 연간 목표 → 분기·월 나누기(월 지수 가중) + 실적 합산(운영일 가중).
//   처리량(하루, qtyPerDay)은 물량이라 달마다 월 지수만큼 다르게: 달 목표 = 연 목표 × 지수(m) ÷ (업무일 가중 평균 지수).
//     → 업무일 가중 평균으로 다시 합치면 연 목표로 돌아온다(왕복 ±1%, 반올림 오차만).
//   비율 지표(UPH·OEE·충족률·효율)는 달마다 같게(연 목표 그대로) — 계절과 무관하게 지켜야 할 수준.
//   분기 = 그 분기 세 달의 업무일 가중 평균. 실적 = 월 요약(운영일 가중) — 처리량 = qty ÷ qtyDays, UPH = 요약 uph.
//   금액 없음.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-items.test.js

import { GOAL_METRICS } from './plan-yeardoc.js?v=202611101659';

export const VOLUME_METRICS = Object.freeze(['qtyPerDay']);
const r2 = (v) => Math.round(v * 100) / 100;
const mk = (m) => `m${String(m).padStart(2, '0')}`;
const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

/** 가중 평균 Σ v·w ÷ Σ w (값 없는 칸은 뺀다) */
export function weighted(values, weights) {
    let a = 0, b = 0;
    Object.keys(values || {}).forEach(k => {
        const v = fin(values[k]), w = fin(weights && weights[k]);
        if (v == null || !(w > 0)) return;
        a += v * w; b += w;
    });
    return b > 0 ? a / b : null;
}

/**
 * 연 목표 하나 → { year, q1..q4, m01..m12 }
 * @param {number} yearTarget  @param {string} metric
 * @param {object} index  { 1..12: 월 지수 } (없으면 1)  @param {object} workdays { 1..12: 업무일 }
 */
export function cascadeYear(yearTarget, metric, index = {}, workdays = {}) {
    const y = fin(yearTarget);
    if (y == null) return null;
    const out = { year: r2(y) };
    const ix = (m) => (fin(index[m]) > 0 ? Number(index[m]) : 1);
    const wd = (m) => (fin(workdays[m]) > 0 ? Number(workdays[m]) : 21);
    const volume = VOLUME_METRICS.includes(metric);
    const norm = volume ? weighted(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, ix(i + 1)])), Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, wd(i + 1)]))) : 1;
    for (let m = 1; m <= 12; m++) out[mk(m)] = r2(volume ? y * ix(m) / norm : y);
    for (let q = 1; q <= 4; q++) {
        const ms = [q * 3 - 2, q * 3 - 1, q * 3];
        out[`q${q}`] = r2(weighted(Object.fromEntries(ms.map(m => [m, out[mk(m)]])), Object.fromEntries(ms.map(m => [m, wd(m)]))));
    }
    return out;
}

/** 나눈 값을 다시 연으로(업무일 가중) — 왕복 확인용 */
export const rollUpYear = (row, workdays = {}) => weighted(
    Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, row && row[mk(i + 1)]])),
    Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, fin(workdays[i + 1]) > 0 ? workdays[i + 1] : 21])));

/** 목표 연결 문서 kpis 만들기 — mode auto 면 연 목표에서 나누고, manual 이면 사람이 넣은 칸을 그대로(빈 칸만 나눈 값으로) */
export function buildGoalKpis(yearTargets, { mode = 'auto', manual = {}, index = {}, workdays = {} } = {}) {
    const kpis = {};
    GOAL_METRICS.forEach(m => {
        const auto = cascadeYear(yearTargets && yearTargets[m], m, index, workdays);
        if (!auto && !(manual && manual[m])) return;
        const row = { ...(auto || {}) };
        if (mode === 'manual' && manual && manual[m]) Object.entries(manual[m]).forEach(([k, v]) => { if (fin(v) != null) row[k] = Number(v); });
        kpis[m] = row;
    });
    return kpis;
}

/**
 * 실적 — 월 요약(끝난 달)에서 지표별 { m01..m12, q1..q4, year } (운영일 가중). year = 그 해(YYYY).
 * 처리량(하루) = qty ÷ qtyDays(없으면 opDays), UPH = 요약 uph. 그 밖 지표는 월 요약에 없어 null.
 */
export function actualsOf(monthlies, year) {
    const out = {};
    const pick = (m, metric) => {
        const days = fin(m.qtyDays) || fin(m.opDays);
        if (metric === 'qtyPerDay') return days > 0 ? m.qty / days : null;
        if (metric === 'uph') return fin(m.uph);
        return null;
    };
    ['qtyPerDay', 'uph'].forEach(metric => {
        const row = {}, w = {};
        (monthlies || []).filter(m => m && String(m.ym).startsWith(`${year}-`)).forEach(m => {
            const k = Number(m.ym.slice(5, 7));
            const v = pick(m, metric);
            if (v == null) return;
            row[mk(k)] = r2(v);
            w[mk(k)] = fin(m.opDays) || 0;
        });
        for (let q = 1; q <= 4; q++) {
            const ks = [q * 3 - 2, q * 3 - 1, q * 3].map(mk).filter(k => row[k] != null);
            const v = weighted(Object.fromEntries(ks.map(k => [k, row[k]])), w);
            if (v != null) row[`q${q}`] = r2(v);
        }
        const all = Object.keys(row).filter(k => k.startsWith('m'));
        const y = weighted(Object.fromEntries(all.map(k => [k, row[k]])), w);
        if (y != null) row.year = r2(y);
        out[metric] = row;
    });
    return out;
}
