// === js/lib/plan-season.js ===
// 운영 계획 v2 D2 — 시즌 지수(묶음 × 월). 실측(월 요약 tasks — 1년치 12개 달이 모두 있을 때) > GIP 정적 지수(주문·반품) > '가정' 틀.
//   어림 = '지수 × 최근 3개월 기준선' — 기준선 = 최근 끝난 3개월 하루 평균 ÷ 그 3개월 지수 평균(계절을 걷어낸 수준), 달 m = 기준선 × 지수(m).
//   물량(처리량)이 아니라 업무 기록 시간(분)으로 센다 — 묶음마다 처리량 단위가 달라 합칠 수 없어서.
//   금액·이름 없음.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-season.test.js

import { SEASON_BUNDLES, GIP_INDEX, GIP_OBS, GIP_BAND, GIP_SOURCE, ASSUMED_INDEX, BUNDLE_SOURCE, SEASON_FRAME } from './plan-season-catalog.js?v=202611101708';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v) => Math.round(v * 100) / 100;
const mOf = (ym) => Number(String(ym).slice(5, 7));

/** 업무 id → 묶음 key(없으면 support) */
export function bundleOf(taskId) {
    const b = SEASON_BUNDLES.find(x => x.tasks.includes(taskId));
    return b ? b.key : 'support';
}

/** 월 요약 → 묶음별 달 하루 평균 분 { bundle: { ym: perDay } } (일수 = qtyDays → opDays) */
export function bundleMinutes(monthlies) {
    const out = {};
    SEASON_BUNDLES.forEach(b => { out[b.key] = {}; });
    (monthlies || []).forEach(m => {
        if (!m || !m.ym || !m.tasks) return;
        const days = num(m.opDays) || num(m.qtyDays);
        if (!(days > 0)) return;
        const sum = {};
        Object.entries(m.tasks).forEach(([id, t]) => { const k = bundleOf(id); sum[k] = (sum[k] || 0) + num(t && t.min); });
        Object.entries(sum).forEach(([k, v]) => { out[k][m.ym] = v / days; });
    });
    return out;
}

/** 실측 월 지수 — 그 묶음의 1~12월이 모두 있으면(같은 달 여러 해면 평균) { 1..12: 지수 }, 아니면 null */
export function measuredIndex(perYm) {
    const by = {};
    Object.entries(perYm || {}).forEach(([ym, v]) => { const m = mOf(ym); (by[m] || (by[m] = [])).push(v); });
    if (Object.keys(by).length < 12) return null;
    const avg = {};
    for (let m = 1; m <= 12; m++) avg[m] = by[m].reduce((a, b) => a + b, 0) / by[m].length;
    const mean = Object.values(avg).reduce((a, b) => a + b, 0) / 12;
    if (!(mean > 0)) return null;
    const out = {};
    for (let m = 1; m <= 12; m++) out[m] = r2(avg[m] / mean);
    return out;
}

/** 묶음 × 월 지수 한 칸 { index, source:'measured'|'gip'|'assumed', obs, band, label } */
export function seasonIndex(bundle, month, { measured = null } = {}) {
    if (measured && measured[month] != null) return { index: measured[month], source: 'measured', obs: null, band: null, label: '실측' };
    const src = BUNDLE_SOURCE[bundle] || 'none';
    if (src === 'order' || src === 'return') {
        return { index: GIP_INDEX[src][month], source: 'gip', obs: GIP_OBS[month], band: GIP_BAND, label: `GIP ${GIP_OBS[month]}회` };
    }
    if (src.startsWith('assumed:')) {
        const a = ASSUMED_INDEX[src.slice(8)] || {};
        return { index: a[month] != null ? a[month] : 1, source: 'assumed', obs: null, band: null, label: '가정' };
    }
    return { index: 1, source: 'assumed', obs: null, band: null, label: '가정' };
}

/** 시즌 캘린더 — 묶음 × 12개월 지수 + 시즌 틀 이름. monthlies = 월 요약(끝난 달) */
export function seasonCalendar(monthlies) {
    const per = bundleMinutes(monthlies);
    const rows = SEASON_BUNDLES.map(b => {
        const measured = measuredIndex(per[b.key]);
        const cells = Array.from({ length: 12 }, (_, i) => seasonIndex(b.key, i + 1, { measured }));
        return { key: b.key, label: b.label, cells, measuredUsed: !!measured };
    });
    const frame = Array.from({ length: 12 }, (_, i) => SEASON_FRAME.filter(f => f.months.includes(i + 1)).map(f => f.label));
    return { rows, frame, source: GIP_SOURCE, band: GIP_BAND };
}

/**
 * 묶음 하나 다음 달들 어림(분/일) — 지수 × 최근 3개월 기준선.
 * @returns {{ level, base:[ym], months:{ ym: perDay } }|null} 최근 끝난 달 3개가 없으면 null
 */
export function bundleForecast(monthlies, bundle, targetYms) {
    const per = bundleMinutes(monthlies)[bundle] || {};
    const yms = Object.keys(per).sort().slice(-3);
    if (yms.length < 3) return null;
    const measured = measuredIndex(per);
    const ix = (ym) => seasonIndex(bundle, mOf(ym), { measured }).index;
    const meanIx = yms.reduce((a, ym) => a + ix(ym), 0) / 3;
    const level = meanIx > 0 ? (yms.reduce((a, ym) => a + per[ym], 0) / 3) / meanIx : null;
    if (level == null) return null;
    return { level: Math.round(level), base: yms, months: Object.fromEntries((targetYms || []).map(ym => [ym, Math.round(level * ix(ym))])) };
}
