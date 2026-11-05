// === js/lib/plan-sim.js ===
// 운영 계획 확장-3 — 시뮬레이터(순수 산식, 계획을 다시 계산하지 않는다). 지금 보고 있는 주간·월간·연간 계획 결과를 base 로.
//   필요' = 필요 × (1 + 물량%) ÷ (1 + 속도%) · 공급' = 공급 + 인원(명) · 충족률 = 평균 min(1, 공급'/필요')
//   OEE(근사) = 기본 OEE × (가동 비율 변화) × (1 + 속도%) — 가동 비율 = min(1, 필요/공급). 100% 상한. '근사'라고 화면에 적는다.
//   인건비(관리자만) = 기본 인건비 + 인원 × 1인 기간 비용 + (메울 시간 변화) × 메우는 시간당 비용. 매출 = 기본 × (1 + 물량%). 관리자가 아니면 null.
//   범위: 인원 −3~+3 · 물량 −30~+30% · 속도 −20~+20%.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-year.test.js

export const SIM_RANGE = Object.freeze({ staffDelta: [-3, 3], qtyPct: [-30, 30], speedPct: [-20, 20] });
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number(v) || 0));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;

/** 계획 결과 → 시뮬레이터 기본 행 [{req, supply, hours(그 행 1인 시간 — 주·월은 하루, 연간은 한 달)}] */
export function simRowsOf(plan) {
    if (!plan) return [];
    if (plan.meta && plan.meta.horizon === 'year') {
        return (plan.months || []).filter(m => m.reqFTE != null && m.supplyFTE != null)
            .map(m => ({ req: num(m.reqFTE), supply: num(m.supplyFTE), hours: num(m.hoursPerPerson || 8) * num(m.workdays) }));
    }
    return (plan.days || []).filter(d => d && d.workday && d.hasRow)
        .map(d => ({ req: num(d.reqFTE), supply: num(d.supplyFTE), hours: num(d.hoursPerPerson || 8) }));
}

function evalRows(rows, { staffDelta = 0, qtyPct = 0, speedPct = 0 }) {
    const f = (1 + qtyPct / 100) / (1 + speedPct / 100);
    let fill = 0, n = 0, req = 0, short = 0, use = 0, use0 = 0;
    rows.forEach(r => {
        const q = r.req * f, s = Math.max(0, r.supply + staffDelta);
        if (q > 0) { fill += Math.min(1, s / q); n++; }
        req += q;
        short += Math.max(0, q - s) * r.hours;
        use += s > 0 ? Math.min(1, q / s) : 0;
        use0 += r.supply > 0 ? Math.min(1, r.req / r.supply) : 0;
    });
    return { fillRate: n ? fill / n : null, reqFTE: rows.length ? req / rows.length : null, shortHours: short, useRatio: rows.length && use0 > 0 ? use / use0 : 1 };
}

/**
 * @param {object} base { rows: simRowsOf(plan), oee(%, 지금 평소), money?: { canMoney, laborBase, perPersonCost(1인 그 기간 비용), fillHourly(메우는 시간당 비용), revenueBase } }
 * @param {object} lever { staffDelta, qtyPct, speedPct }
 * @returns {{ lever, fillRate, reqFTE, shortHours, oee, laborCost|null, laborRatio|null, base:{...같은 칸} }}
 */
export function simulate(base, lever = {}) {
    const L = {
        staffDelta: Math.round(clamp(lever.staffDelta, SIM_RANGE.staffDelta)),
        qtyPct: clamp(lever.qtyPct, SIM_RANGE.qtyPct),
        speedPct: clamp(lever.speedPct, SIM_RANGE.speedPct)
    };
    const rows = (base && base.rows) || [];
    const b0 = evalRows(rows, {});
    const b1 = evalRows(rows, L);
    const oee0 = base && base.oee != null ? num(base.oee) : null;
    const oee1 = oee0 == null ? null : Math.min(100, oee0 * b1.useRatio * (1 + L.speedPct / 100));
    const M = (base && base.money) || {};
    const money = !!M.canMoney && M.laborBase != null;
    const cost = (ev, lv) => (money ? num(M.laborBase) + lv.staffDelta * num(M.perPersonCost) + (ev.shortHours - b0.shortHours) * num(M.fillHourly) : null);
    const rev = (lv) => (money && num(M.revenueBase) > 0 ? num(M.revenueBase) * (1 + lv.qtyPct / 100) : null);
    const ratio = (c, r) => (c != null && r > 0 ? c / r : null);
    const c0 = cost(b0, { staffDelta: 0 }), c1 = cost(b1, L);
    const out = (ev, oee, c, r) => ({
        fillRate: ev.fillRate, reqFTE: ev.reqFTE == null ? null : r1(ev.reqFTE), shortHours: r1(ev.shortHours), oee: oee == null ? null : r1(oee),
        laborCost: money ? Math.round(c) : null, laborRatio: money ? ratio(c, r) : null
    });
    return { lever: L, ...out(b1, oee1, c1, rev(L)), base: out(b0, oee0, c0, rev({ qtyPct: 0 })) };
}
