// === js/lib/plan-targets.js ===
// 운영 계획 MVP-2 — 목표(OpsPlan/targets): 기본 제안값 · 저장값 고르기 · '현재 · 목표 · 차이 · 메우는 수단' 표(차이를 시간으로).
//   칸: qtyPerDay(기준선 — 목표 아님), uph, oee(%), fillRate(인원 충족률 %), effPct(효율 %).
//   인건비율(laborRatio, %)은 확장-2(돈)에서 — 비율이라 targets 에 저장하지만 화면·차이 행은 관리자만(ctx.laborRatio 를 넘길 때만 행이 생긴다).
//   기본 목표: 최근 8주 평소값 기준 UPH +5% · OEE +3%p · 충족률 95% · 효율 유지 · 처리량은 기준선(예측 그대로).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-month.test.js

export const TARGET_FIELDS = Object.freeze(['qtyPerDay', 'uph', 'oee', 'fillRate', 'effPct', 'laborRatio']);
/** 관리자만 보는 칸 */
export const ADMIN_TARGET_FIELDS = Object.freeze(['laborRatio']);
export const HORIZONS = Object.freeze(['week', 'month', 'year']);
export const TARGET_RULES = Object.freeze({ uphUp: 0.05, oeeUpPp: 3, fillRate: 95 });
/** 저장 칸 범위(화면 입력·저장 전 검사) */
const RANGE = { qtyPerDay: [0, 1e7], uph: [0, 1e5], oee: [0, 100], fillRate: [0, 100], effPct: [0, 300], laborRatio: [0, 100] };

const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const r1 = (v) => (v == null ? null : (Math.round(v * 10) / 10) || 0);   // −0 → 0

/** 최근 8주 운영 리포트 모델(buildOpsModel) → 평소값 { qtyPerDay, uph, oee, effPct, fillRate } */
export function baselineOf(model) {
    if (!model || !model.meta || model.meta.empty) return { qtyPerDay: null, uph: null, oee: null, effPct: null, fillRate: null };
    const H = Object.fromEntries((model.headline || []).map(h => [h.key, h]));
    const S = model.staffing || {};
    const att = fin(S.attended), req = fin(S.required);
    return {
        qtyPerDay: fin(H.qty && H.qty.perDay),
        uph: fin(H.uph && H.uph.value),
        oee: fin(H.oee && H.oee.value),
        effPct: fin(model.productivity && model.productivity.efficiency),
        fillRate: att != null && req != null && req > 0 ? Math.min(100, (att / req) * 100) : null
    };
}

/** 기본 목표 제안 — 평소값에서. 평소값이 없으면 그 칸은 null(충족률만 95). */
export function defaultTargets(base) {
    const b = base || {};
    return {
        qtyPerDay: r1(fin(b.qtyPerDay)),
        uph: b.uph != null ? r1(b.uph * (1 + TARGET_RULES.uphUp)) : null,
        oee: b.oee != null ? r1(Math.min(100, b.oee + TARGET_RULES.oeeUpPp)) : null,
        fillRate: TARGET_RULES.fillRate,
        effPct: r1(fin(b.effPct)),
        laborRatio: r1(fin(b.laborRatio))          // 최근 3달 유지(관리자 화면이 넘길 때만 — 아니면 null)
    };
}

/** 한 기간 목표 칸만 깨끗이(숫자·범위) — 모르는 칸·잘못된 값은 버린다. */
export function cleanTargetSet(o) {
    const out = {};
    TARGET_FIELDS.forEach(k => {
        const v = fin(o && o[k]);
        if (v == null) return;
        const [lo, hi] = RANGE[k];
        if (v < lo || v > hi) return;
        out[k] = Math.round(v * 100) / 100;
    });
    return out;
}

/** 저장할 targets 문서 본문(updatedAt·updatedBy 는 저장하는 쪽이 붙인다) */
export function targetsDocOf(input) {
    const o = input || {};
    const out = { v: 1 };
    HORIZONS.forEach(h => { out[h] = cleanTargetSet(o[h]); });
    const ov = {};
    Object.entries((o.overrides && typeof o.overrides === 'object') ? o.overrides : {}).forEach(([k, v]) => {
        if (/^(\d{4}-\d{2}(-\d{2})?|\d{4})$/.test(k)) { const c = cleanTargetSet(v); if (Object.keys(c).length) ov[k] = c; }
    });
    out.overrides = ov;
    return out;
}

/** 이 기간에 쓸 목표 = 기본 제안 ← 저장값(horizon) ← 기간별 덮어쓰기. src 칸마다 어디서 왔는지('default'|'saved'|'override'). */
export function targetsFor(doc, horizon, periodKey, defaults) {
    const d = defaults || {};
    const saved = (doc && doc[horizon]) || {};
    const ov = (doc && doc.overrides && doc.overrides[periodKey]) || {};
    const out = {}, src = {};
    TARGET_FIELDS.forEach(k => {
        if (fin(ov[k]) != null) { out[k] = fin(ov[k]); src[k] = 'override'; }
        else if (fin(saved[k]) != null) { out[k] = fin(saved[k]); src[k] = 'saved'; }
        else { out[k] = fin(d[k]); src[k] = 'default'; }
    });
    return { targets: out, src };
}

/**
 * '현재 · 목표 · 차이 · 메우는 수단' 표. 차이를 시간(인시)으로 바꿔 보인다.
 * @param {object} cur   { qtyPerDay, uph, oee, effPct, fillRate } — 최근 8주 평소(충족률은 계획 기간 예측)
 * @param {object} tgt   targetsFor(...).targets
 * @param {object} ctx   { qty: 기간 처리량(개), workHours: 기간 출근 인원 × 하루 시간(인시), shortToTarget: 충족률 목표까지 모자란 인시 }
 * @returns [{key, label, unit, current, target, diff, hours, means, baseline?}]
 *   hours > 0 = 목표에 닿으면 아끼는(또는 더 넣어야 하는) 시간. 모르면 null.
 */
export function gapRows(cur, tgt, ctx = {}) {
    const c = cur || {}, t = tgt || {};
    const qty = fin(ctx.qty) || 0, work = fin(ctx.workHours) || 0;
    const diff = (a, b) => (a != null && b != null ? r1(b - a) : null);
    const rows = [];
    rows.push({
        key: 'qtyPerDay', label: '처리량(하루)', unit: '개', current: r1(fin(c.qtyPerDay)), target: r1(fin(t.qtyPerDay)),
        diff: null, hours: null, baseline: true, means: '기준선(목표 아님) — 예측값 그대로 계획에 씁니다'
    });
    const cu = fin(c.uph), tu = fin(t.uph);
    rows.push({
        key: 'uph', label: 'UPH', unit: '개/시', current: r1(cu), target: r1(tu), diff: diff(cu, tu),
        hours: cu > 0 && tu > 0 && qty > 0 ? r1(qty * (1 / cu - 1 / tu)) : null,
        means: '손실 큰 업무부터 원인 점검·교육, 동선·배치 개선'
    });
    const co = fin(c.oee), to = fin(t.oee);
    rows.push({
        key: 'oee', label: 'OEE', unit: '%', current: r1(co), target: r1(to), diff: diff(co, to),
        hours: co != null && to != null && work > 0 ? r1(work * (to - co) / 100) : null,
        means: '기록 없는 시간·대기 줄이기(가동률), 느린 업무 점검(효율), 재작업 줄이기(품질)'
    });
    const cf = fin(c.fillRate), tf = fin(t.fillRate);
    rows.push({
        key: 'fillRate', label: '인원 충족률', unit: '%', current: r1(cf), target: r1(tf), diff: diff(cf, tf),
        hours: fin(ctx.shortToTarget) != null ? r1(fin(ctx.shortToTarget)) : null,
        means: '선처리 → 연장 → 알바(아래 메우기 표)'
    });
    const ce = fin(c.effPct), te = fin(t.effPct);
    rows.push({
        key: 'effPct', label: '효율', unit: '%', current: r1(ce), target: r1(te), diff: diff(ce, te),
        hours: ce > 0 && te > 0 && work > 0 ? r1(work * (1 - ce / te)) : null,
        means: '평상시 속도로 — 느린 업무의 원인(인원 교체·물량 쏠림·기록 누락) 점검'
    });
    if (ctx.laborRatio) {   // 관리자만 — 인건비율(%) 행. ctx.laborRatio = { current(이 계획 예측 %) }
        const cl = fin(ctx.laborRatio.current), tl = fin(t.laborRatio);
        rows.push({
            key: 'laborRatio', label: '인건비율', unit: '%', current: r1(cl), target: r1(tl), diff: diff(cl, tl), hours: null, admin: true,
            means: '부족은 비용이 낮은 수단부터(선처리 → 연장 → 알바 → 채용, 비용·예산 표), 손실 큰 업무 개선'
        });
    }
    return rows;
}

/** 충족률 목표까지 모자란 인시 — Σ max(0, 목표 × 필요 − 공급) × 하루 시간(업무일) */
export function shortToTargetHours(days, targetPct) {
    const tp = fin(targetPct);
    if (tp == null) return null;
    let h = 0;
    (days || []).forEach(d => {
        if (!d || !d.workday || !d.hasRow) return;
        const need = (tp / 100) * (Number(d.reqFTE) || 0);
        h += Math.max(0, need - (Number(d.supplyFTE) || 0)) * (Number(d.hoursPerPerson) || 8);
    });
    return r1(h);
}
