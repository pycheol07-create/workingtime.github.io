// === js/lib/plan-confidence.js ===
// 운영 계획 v2 D1 — 신뢰도 v2(주간·월간·연간). 결과 = { level:'high'|'mid'|'low', label, reasons[], nextUpgrade:{when, need}|null }
//   주간: 높음 = 실측 오차 ≤ 10% & 기록률 ≥ 90% / 보통 = 오차 ≤ 20%, 또는 (오차 없음 & 예정 물량 입력 ≥ 60%) / 낮음.
//   월간: 높음 = 전년 같은 달(운영일 ≥ 15) + 확정 2회 이상 평균 오차 ≤ 10% / 보통 = 전년 같은 달 + 기록률 ≥ 90%, 또는 확정 2회 이상 오차 ≤ 20% / 낮음.
//   연간: 높음 = 24개월 기록 + 지난 연간 오차 ≤ 15% / 보통 = 13개월 + 전년 같은 달 9개월 이상 / 낮음.
//   실측 오차: 주간 = 업무 예상 스냅샷(자동 저장·확정)의 최근 14근무일 시간 오차, 월간 = 확정본 대비 필요 인원 오차(plan-compare).
//   문장에 금액·이름 없음.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-monthly.test.js

import { offDayOf, addDaysStr } from './plan-week.js?v=202611100906';

export const CONF_LABEL = Object.freeze({ high: '높음', mid: '보통', low: '낮음' });
export const CONF_RULES = Object.freeze({
    week: { highErr: 10, midErr: 20, record: 0.9, planned: 0.6 },
    month: { highErr: 10, midErr: 20, record: 0.9, priorDays: 15, confirms: 2 },
    year: { highMonths: 24, midMonths: 13, highErr: 15, priorMonths: 9 }
});
const fin = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (v) => `${Math.round(v * 100)}%`;
const out = (level, reasons, nextUpgrade) => ({ level, label: CONF_LABEL[level], reasons, nextUpgrade });

/** 기록률 — 최근 weeks 주 가능한 업무일(주말·공휴일 제외) 중 처리량 기록이 있는 운영일 비율(0~1). 가능일이 없으면 null. */
export function recordRateOf(days, today, { weeks = 8, holidayNameOf = null } = {}) {
    const from = addDaysStr(today, -7 * weeks);
    const op = new Set((days || []).filter(d => d && typeof d.id === 'string' && d.id >= from && d.id < today
        && Object.values(d.taskQuantities || {}).some(v => Number(v) > 0)).map(d => d.id));
    let possible = 0, hit = 0;
    for (let i = 1; i <= 7 * weeks; i++) {
        const d = addDaysStr(today, -i);
        const o = offDayOf(d, holidayNameOf);
        if (o.weekend || o.holiday) continue;
        possible++;
        if (op.has(d)) hit++;
    }
    return possible ? Math.min(1, hit / possible) : null;
}

/** 주간 — errPct = 실측 오차 절댓값(%), recordRate 0~1, plannedRatio 0~1 */
export function weekConfidence({ errPct = null, recordRate = null, plannedRatio = null } = {}) {
    const R = CONF_RULES.week;
    const e = fin(errPct), r = fin(recordRate), p = fin(plannedRatio);
    const reasons = [
        e == null ? '실측 오차 없음(업무 예상 › 정확도 자료가 없음)' : `실측 오차 ${Math.round(e)}%`,
        r == null ? '기록률 모름' : `최근 8주 기록률 ${pct(r)}`,
        p == null ? '' : `예정 물량 입력 ${pct(p)}`
    ].filter(Boolean);
    if (e != null && e <= R.highErr && r != null && r >= R.record) return out('high', reasons, null);
    const mid = (e != null && e <= R.midErr) || (e == null && p != null && p >= R.planned);
    if (mid) return out('mid', reasons, { when: '확정 스냅샷이 쌓이면', need: `실측 오차 ${R.highErr}% 이하 + 기록률 ${pct(R.record)} 이상` });
    return out('low', reasons, e == null
        ? { when: '다음 주 전에', need: `예정 물량을 업무일 ${pct(R.planned)} 이상 넣기(업무 예상 › 계획) 또는 계획 확정으로 오차 쌓기` }
        : { when: '오차가 줄면', need: `실측 오차 ${R.midErr}% 이하` });
}

/** 월간 — priorSameMonthDays = 작년 같은 달 운영일, recordRate 0~1, confirmedErrs = 지난 확정본들의 필요 인원 오차(절댓값 %) */
export function monthConfidence({ priorSameMonthDays = 0, recordRate = null, confirmedErrs = [] } = {}) {
    const R = CONF_RULES.month;
    const prior = (fin(priorSameMonthDays) || 0) >= R.priorDays;
    const r = fin(recordRate);
    const errs = (confirmedErrs || []).map(fin).filter(v => v != null);
    const avg = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
    const reasons = [
        prior ? '작년 같은 달 기록 있음' : `작년 같은 달 기록 없음(운영일 ${fin(priorSameMonthDays) || 0}일 < ${R.priorDays})`,
        r == null ? '기록률 모름' : `최근 8주 기록률 ${pct(r)}`,
        errs.length ? `확정 ${errs.length}회 평균 오차 ${Math.round(avg)}%` : '확정본 대비 오차 없음'
    ];
    if (prior && errs.length >= R.confirms && avg <= R.highErr) return out('high', reasons, null);
    if ((prior && r != null && r >= R.record) || (errs.length >= R.confirms && avg <= R.midErr)) {
        return out('mid', reasons, { when: '확정이 쌓이면', need: `월간 계획 ${R.confirms}회 이상 확정 + 평균 오차 ${R.highErr}% 이하${prior ? '' : ' + 작년 같은 달 기록'}` });
    }
    return out('low', reasons, prior
        ? { when: '기록이 쌓이면', need: `기록률 ${pct(R.record)} 이상 또는 월간 계획 ${R.confirms}회 확정(오차 ${R.midErr}% 이하)` }
        : { when: '1년치 기록이 쌓이면', need: `작년 같은 달(운영일 ${R.priorDays}일 이상) + 기록률 ${pct(R.record)} 이상` });
}

/** 연간 — months = 기록이 있는 달 수(월 요약 + 메모리), priorSameMonths = 계획 해의 달 중 작년 같은 달 기록이 있는 수, lastYearErr = 지난 연간 확정 대비 오차(%) */
export function yearConfidence({ months = 0, priorSameMonths = 0, lastYearErr = null } = {}) {
    const R = CONF_RULES.year;
    const m = fin(months) || 0, p = fin(priorSameMonths) || 0, e = fin(lastYearErr);
    const reasons = [`기록 ${m}개월`, `작년 같은 달 ${p}개월`, e == null ? '지난 연간 계획 대비 오차 없음' : `지난 연간 오차 ${Math.round(e)}%`];
    if (m >= R.highMonths && e != null && e <= R.highErr) return out('high', reasons, null);
    if (m >= R.midMonths && p >= R.priorMonths) return out('mid', reasons, { when: '2년치 기록 + 연간 확정 뒤', need: `기록 ${R.highMonths}개월 + 지난 연간 오차 ${R.highErr}% 이하` });
    return out('low', reasons, { when: `기록 ${R.midMonths}개월이 되면`, need: `기록 ${R.midMonths}개월 이상 + 작년 같은 달 ${R.priorMonths}개월 이상` });
}

/**
 * 전년 대비 성장(같은 달 짝) — perMonth = { 'YYYY-MM': { opDays, qty } }. 두 달 모두 운영일 ≥ minDays 인 짝이 minPairs 이상일 때만.
 * @returns {{ ratio, pairs }|null} ratio = Σ(최근 12개월 각 달 하루 평균) ÷ Σ(그 1년 전 같은 달 하루 평균)
 */
export function yoyGrowth(perMonth, { minDays = 15, minPairs = 6 } = {}) {
    const M = perMonth || {};
    let a = 0, b = 0, pairs = 0;
    // 가장 최근 12개월만 '올해' 쪽으로 본다(2년 전 ↔ 3년 전 짝이 섞이지 않게)
    Object.keys(M).sort().slice(-12).forEach(ym => {
        const [y, m] = ym.split('-');
        const prev = M[`${Number(y) - 1}-${m}`];
        const cur = M[ym];
        if (!prev || !cur || cur.opDays < minDays || prev.opDays < minDays || !(prev.qty > 0)) return;
        a += cur.qty / cur.opDays; b += prev.qty / prev.opDays; pairs++;
    });
    return pairs >= minPairs && b > 0 ? { ratio: a / b, pairs } : null;
}
