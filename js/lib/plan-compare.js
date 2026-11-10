// === js/lib/plan-compare.js ===
// 운영 계획 MVP-2 — 계획 확정본(OpsPlan/{week|month}_{periodKey}) 만들기와 '계획 대비 실적'.
//   확정본 모양(firestore.rules OpsPlan 블록이 같은 칸만 받는다):
//     { v:1, horizon, periodKey, version, confirmedAt, confirmedBy, basis[], targets{}, days[{date, reqFTE, supplyFTE, gap, fill{prep,overtime,temp}}],
//       fillTotals{need,prep,overtime,temp,tempPeople}, actions[{key,id,text,due,role,score}], risks[{id,title,score}], agenda{}, done{} }
//   confirmedAt·confirmedBy 는 저장하는 쪽(js/ops-plan-store.js)이 서버 시각·로그인 이메일로 붙인다.
//   금액·직원 이름 칸은 만들지 않는다(입력에 있어도 골라 담지 않음 — 시험이 JSON 으로 확인).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-month.test.js

import { finishedMonths } from './plan-monthly.js?v=202611101512';

// actions·risks 10 — 규칙이 항목 칸을 하나씩 보는데 20개면 규칙 계산 한도에 걸린다(firestore.rules OpsPlan, 에뮬레이터 실측). 과제·리스크는 점수 순 앞 10개.
export const CONFIRM_LIMITS = Object.freeze({ actions: 10, risks: 10, days: 31, basis: 10, done: 40, text: 300 });
export const DOC_KEYS = Object.freeze(['v', 'horizon', 'periodKey', 'version', 'confirmedAt', 'confirmedBy', 'basis', 'targets',
    'days', 'fillTotals', 'actions', 'risks', 'agenda', 'done', 'doneAt', 'doneBy', 'assignCounts', 'months', 'objectives', 'kpiWeekly', 'staffing']);
/** 배치 초안 합계(업무별 인일·인시) 상한 — 업무 이름 키, 값은 {n, h} 만(이름 없음) */
export const ASSIGN_LIMIT = 40;

const fin = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
const str = (v, n = CONFIRM_LIMITS.text) => String(v == null ? '' : v).slice(0, n);
const numOr0 = (v) => fin(v) || 0;

/** 문서 id — week_YYYY-MM-DD(주 시작 월요일) · month_YYYY-MM. 모양이 틀리면 null. */
export function planDocId(horizon, periodKey) {
    if (horizon === 'week' && /^\d{4}-\d{2}-\d{2}$/.test(periodKey || '')) return `week_${periodKey}`;
    if (horizon === 'month' && /^\d{4}-\d{2}$/.test(periodKey || '')) return `month_${periodKey}`;
    if (horizon === 'year' && /^\d{4}$/.test(periodKey || '')) return `year_${periodKey}`;   // 확장-3
    if (horizon === 'quarter' && /^\d{4}-Q[1-4]$/.test(periodKey || '')) return `quarter_${periodKey}`;   // v2 D2
    return null;
}

/**
 * 계획(주간 buildWeekPlan / 월간 buildMonthPlan 결과) → 확정본 본문(version·confirmedAt·confirmedBy 빼고).
 * 업무일 행만 담는다(31개 이하).
 */
export function confirmDocOf(plan, { horizon, periodKey, targets = {}, assignCounts = null } = {}) {
    const p = plan || {};
    const L = CONFIRM_LIMITS;
    const days = (p.days || []).filter(d => d && d.workday && d.hasRow).slice(0, L.days).map(d => ({
        date: str(d.date, 10), reqFTE: r1(numOr0(d.reqFTE)), supplyFTE: numOr0(d.supplyFTE), gap: numOr0(d.gap),
        fill: { prep: r1(numOr0(d.fill && d.fill.prep)), overtime: r1(numOr0(d.fill && d.fill.overtime)), temp: numOr0(d.fill && d.fill.tempPeople) }
    }));
    const t = p.fillTotals || {};
    const tg = {};
    ['qtyPerDay', 'uph', 'oee', 'fillRate', 'effPct'].forEach(k => { const v = fin(targets[k]); if (v != null) tg[k] = v; });
    const agenda = (p.meeting && p.meeting.decisions) ? {
        decisions: p.meeting.decisions.slice(0, 10).map(d => ({ key: str(d.key, 80), text: str(d.text), due: d.due ? str(d.due, 10) : null }))
    } : {};
    return {
        v: 1, horizon, periodKey,
        basis: (p.meta && Array.isArray(p.meta.basis) ? p.meta.basis : []).slice(0, L.basis).map(b => str(b)),
        targets: tg,
        days,
        fillTotals: { need: r1(numOr0(t.need)), prep: r1(numOr0(t.prep)), overtime: r1(numOr0(t.overtime)), temp: r1(numOr0(t.temp)), tempPeople: numOr0(t.tempPeople) },
        // 분기(v2 D2)는 핵심 과제(initiatives)를 과제 칸으로
        actions: (p.actions || (p.initiatives || []).map(i => ({ key: i.key, rule: i.kind, title: i.title, due: i.due, role: i.role, score: 0 }))).slice(0, L.actions).map(a => ({
            key: str(a.key, 120), id: str(a.rule, 8), text: str(a.title), due: a.due ? str(a.due, 10) : null, role: str(a.role, 20), score: r1(numOr0(a.score))
        })),
        risks: (p.risks || []).slice(0, L.risks).map(r => ({ id: str(r.key, 80), title: str(r.title, 120), score: numOr0(r.score) })),
        agenda,
        done: {},
        ...(assignCounts ? { assignCounts: cleanAssignCounts(assignCounts) } : {}),
        // 연간(확장-3) — 달 12개(수만): 지수·필요·공급·차이
        // 분기(v2 D2) — 목표·주별 볼 숫자·월별 인력(수만)
        ...(horizon === 'quarter' ? {
            objectives: (p.objectives || []).slice(0, 5).map(o => ({ metric: str(o.metric, 20), target: fin(o.target), current: fin(o.current), source: str(o.source, 12) })),
            kpiWeekly: (p.kpiWeekly || []).slice(0, 5).map(k => ({ metric: str(k.metric, 20), label: str(k.label, 40) })),
            staffing: (p.staffing || []).slice(0, 3).map(s => ({ month: str(s.month, 7), reqFTE: fin(s.reqFTE), supplyFTE: fin(s.supplyFTE), gap: fin(s.gap), hireStartBy: s.hireStartBy ? str(s.hireStartBy, 10) : null }))
        } : {}),
        ...(horizon === 'year' ? { months: (p.months || []).slice(0, 12).map(m => ({ month: str(m.month, 7), index: fin(m.index), reqFTE: fin(m.reqFTE), supplyFTE: fin(m.supplyFTE), gap: fin(m.gap) })) } : {})
    };
}

/** 배치 합계 정리 — { 업무: {n, h} } 만, 40개까지. (plan-skills redactForOutput·plan-assign sumAssignCounts 결과를 받는다) */
export function cleanAssignCounts(ac) {
    const out = {};
    Object.entries(ac || {}).slice(0, ASSIGN_LIMIT).forEach(([k, v]) => {
        out[str(k, 60)] = { n: numOr0(v && v.n) | 0, h: r1(numOr0(v && v.h)) };
    });
    return out;
}

/** 완료 체크 맵 — 이 확정본 과제 key 만, true 만, 40개까지. */
export function cleanDone(done, actions) {
    const keys = new Set((actions || []).map(a => a && a.key).filter(Boolean));
    const out = {};
    Object.entries(done || {}).forEach(([k, v]) => { if (v === true && keys.has(k) && Object.keys(out).length < CONFIRM_LIMITS.done) out[k] = true; });
    return out;
}

/**
 * 계획 대비 실적.
 * @param {object} confirmed 확정본(confirmDocOf 모양)
 * @param {Array}  staffDays 실제 — 운영 리포트 모델 staffDays [{date, attended, required, qty, recordMinutes}]
 * @returns {{rows, summary}} rows: 확정본 날짜별 {date, planReq, planSupply, planGap, actualAttended, actualRequired, qty, uph, fillRate, reqErrPct, supplyErrPct, recorded}
 *   recorded = 처리량이 있고 실제 필요 인원을 계산한 날(운영 리포트 부족·여유 일자와 같은 조건) — 아니면 평균에서 뺀다.
 *   UPH = 그날 처리량 ÷ 업무 기록 시간(운영 리포트 추세 차트와 같은 식).
 */
export function planVsActual(confirmed, staffDays) {
    const byDate = new Map((staffDays || []).filter(d => d && d.date).map(d => [d.date, d]));
    const rows = ((confirmed && confirmed.days) || []).map(p => {
        const a = byDate.get(p.date);
        const planReq = numOr0(p.reqFTE), planSupply = numOr0(p.supplyFTE);
        if (!a || !(numOr0(a.qty) > 0) || !(numOr0(a.required) > 0)) return { date: p.date, planReq, planSupply, planGap: numOr0(p.gap), recorded: false };
        const att = numOr0(a.attended), req = fin(a.required);
        const uph = numOr0(a.recordMinutes) > 0 && numOr0(a.qty) > 0 ? a.qty / (a.recordMinutes / 60) : null;
        return {
            date: p.date, planReq, planSupply, planGap: numOr0(p.gap), recorded: true,
            actualAttended: att, actualRequired: req != null ? r1(req) : null, qty: numOr0(a.qty), uph: r1(uph),
            fillRate: req > 0 ? Math.min(1, att / req) : null,
            reqErrPct: req != null && planReq > 0 ? r1(((req - planReq) / planReq) * 100) : null,
            supplyErrPct: planSupply > 0 ? r1(((att - planSupply) / planSupply) * 100) : null
        };
    });
    const rec = rows.filter(r => r.recorded);
    const avg = (k) => { const v = rec.map(r => r[k]).filter(x => x != null); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const avgAbs = (k) => { const v = rec.map(r => r[k]).filter(x => x != null).map(Math.abs); return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null; };
    const fr = rec.map(r => r.fillRate).filter(x => x != null);
    const actions = (confirmed && confirmed.actions) || [];
    const done = cleanDone(confirmed && confirmed.done, actions);
    return {
        rows,
        summary: {
            planDays: rows.length, recordedDays: rec.length,
            reqErrPct: avg('reqErrPct'), reqAbsErrPct: avgAbs('reqErrPct'),
            supplyErrPct: avg('supplyErrPct'),
            fillRate: fr.length ? fr.reduce((a, b) => a + b, 0) / fr.length : null,
            planShortDays: rows.filter(r => r.planGap < 0).length,
            actualShortDays: rec.filter(r => r.actualRequired != null && r.actualAttended - r.actualRequired < -0.5).length,
            qty: rec.reduce((t, r) => t + (r.qty || 0), 0),
            actionsTotal: actions.length, actionsDone: Object.keys(done).length,
            version: numOr0(confirmed && confirmed.version)
        }
    };
}

// 월간 신뢰도에 넣을 '지난 확정본 대비 필요 인원 오차' 기준 — 최근 끝난 6개월, 기록일 max(5, 계획일 × 0.5)
export const MONTH_ERR_RULES = Object.freeze({ months: 6, minDays: 5, minRatio: 0.5 });
// 첫 확정 가능 달(month_2026-12) — 이전 달은 문서가 없으므로 읽지 않는다
export const MONTH_CONFIRM_FIRST = '2026-12';

/** 읽을 지난 월간 확정본의 달(YYYY-MM, 오래된 달부터) */
export const monthConfirmYms = (today) => finishedMonths(today, MONTH_ERR_RULES.months).filter(ym => ym >= MONTH_CONFIRM_FIRST);

/**
 * 묶음 읽기(Promise.allSettled) 결과 정리.
 * @returns {{docs: object, failed: number, recompute: boolean}} docs = { 'YYYY-MM': 문서|null }(실패한 달은 없음), recompute = 다시 계산할 이유가 있나
 */
export function monthConfirmsOf(yms, results) {
    const docs = {};
    let failed = 0;
    (results || []).forEach((r, i) => { if (r.status === 'fulfilled') docs[yms[i]] = r.value; else failed++; });
    return { docs, failed, recompute: failed > 0 || Object.values(docs).some(Boolean) };
}

/**
 * 지난 월간 확정본들의 필요 인원 오차(절댓값 %) — plan-confidence monthConfidence 의 confirmedErrs.
 * 그 달이 시작하기 전에 확정한 계획만 센다(사후 확정은 오차가 작게 나오므로 제외, 확정 시각이 없어도 제외).
 * @param {object}   docs        { 'YYYY-MM': 확정본|null }
 * @param {Function} staffDaysOf (ym) → 그 달 staffDays. 무거운 계산이라 조건을 통과한 달만 부른다.
 * @returns {number[]} 오래된 달부터
 */
export function monthErrsOf(docs, staffDaysOf, { today } = {}) {
    const R = MONTH_ERR_RULES;
    const errs = [];
    finishedMonths(today, R.months).forEach(ym => {
        const doc = docs && docs[ym];
        if (!doc || doc.horizon !== 'month' || doc.periodKey !== ym) return;
        const at = doc.confirmedAt && typeof doc.confirmedAt.toMillis === 'function' ? doc.confirmedAt.toMillis() : null;
        const [y, mo] = ym.split('-').map(Number);
        if (at == null || !(at < new Date(y, mo - 1, 1).getTime())) return;
        const planDays = Array.isArray(doc.days) ? doc.days.length : 0;
        const need = Math.max(R.minDays, Math.ceil(planDays * R.minRatio));
        if (planDays < need) return;   // 기록이 다 있어도 모자란다
        const { rows, summary } = planVsActual(doc, staffDaysOf(ym));
        if (rows.filter(r => r.recorded && r.reqErrPct != null).length < need) return;   // 계획 필요 인원 0인 날은 오차가 없어 안 센다
        const e = fin(summary.reqAbsErrPct);
        if (e != null) errs.push(e);
    });
    return errs;
}
