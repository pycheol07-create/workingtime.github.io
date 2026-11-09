// === js/lib/plan-budget.js ===
// 운영 계획 확장-2 — 돈: 기간 인건비 예측(정규·연장·알바) · 매출·인건비율·건당 원가 · 부족 메우기 수단 비용 비교 · 채용 역산 · 시나리오 5개 · 금액 과제(M13·M14).
// ⚠️ 금액은 관리자만(canMoney). canMoney 가 false 면 숫자를 하나도 만들지 않고 { locked:true } 만 돌려준다(모델 단계 — buildOpsModel 원칙).
//   직원 이름은 받아도(시급표 키) 결과에 담지 않는다. OpsPlan(금액 금지)에는 쓰지 않는다 — 저장은 adminPrivate/opsPlanBudget(관리자만).
//
// 정의
//   정규 = 그 기간 재직 정직원 월 기본급 합 × 기간 비율(주간 = 달력 일수 ÷ 30.4, 월간 = 1) — 시급 = 월 기본급 ÷ 209(utils buildMemberHourlyWageMap 규칙).
//   평소(비교 기준)도 같은 정의 — 최근 8주 '월급 기준 인건비'(재직 정규 월급 합 × 56 ÷ 30.4 + 그 기간 알바 기록 비용, salaryBasisLabor) ÷ 운영일.
//   연장 = 연장 시간 × 정직원 평균 시급 × 할증(기본 1.5, 근로기준법 제56조). 알바 = 알바 인일 × 알바 시급 × 표준 근무시간.
//   매출(예측) = 최근 8주 운영일 하루 평균 매출(경영 지표, revenueTotalOf) × 업무일 × 물량 배율(주간 1 · 월간 추세 × 계절). 매출이 없으면 인건비율 null.
//   건당 원가(예측) = 평소 건당 인건비 × (예측 인건비 ÷ 평소 같은 일수 인건비) ÷ 물량 배율 + 자재·배송·직진(평소 그대로) — ops-metrics unitCost 정의를 평소값에서 늘려 쓴다.
//   수단 비교: 같은 부족 인시를 선처리(0원, 기존 인원 시간)·연장(할증)·알바(시급)·정규 채용(월비용 ÷ 209, 준비 = 채용 + 교육 주)으로.
//   채용 제안: 지난달 실제 · 이번 달(지금까지) · 다음 달 예측 모두 부족 ≥ 0.8명(3달 연속) + 월간 신뢰도 '보통' 이상. 시작 역산일 = 다음 달 첫날 − (채용 + 교육 주) × 7, 지났으면 '채용 늦음'.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-budget.test.js — 숫자는 가짜.

import { fillMix } from './plan-week.js?v=202611091002';

export const COST_DEFAULTS = Object.freeze({
    tempHourly: null,          // 알바 시급 — 사람이 넣는다(없으면 알바 금액 null)
    overtimePremium: 1.5,      // 연장 할증(근로기준법 제56조 — 회사 규정이 다르면 설정에서)
    regularMonthlyBase: null,  // 정규 1인 월비용 기준 — 화면이 시급표 평균으로 제안, 저장은 사람이 확인 후
    hireLeadWeeks: 4,
    trainWeeksDefault: 2,
    trainWeeksByTask: Object.freeze({}),
    unitCostTarget: null
});
export const MONTH_DAYS = 30.4;
export const SALARY_HOURS = 209;
export const HIRE_RULE = Object.freeze({ shortFte: 0.8, months: 3 });
export const BUDGET_KEEP = 24;

const fin = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const num = (v) => fin(v) || 0;
const round = (v) => (v == null ? null : Math.round(v));
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** 비용 설정 정리(adminPrivate/opsPlanCost) — 숫자 칸·범위만. trainWeeksByTask 는 {업무: 주}. */
export function costSettingsOf(doc) {
    const o = doc || {};
    const out = { ...COST_DEFAULTS, trainWeeksByTask: {} };
    const take = (k, lo, hi) => { const v = fin(o[k]); if (v != null && v >= lo && v <= hi) out[k] = v; };
    take('tempHourly', 0, 1e6); take('overtimePremium', 1, 5); take('regularMonthlyBase', 0, 1e9);
    take('hireLeadWeeks', 0, 52); take('trainWeeksDefault', 0, 52); take('unitCostTarget', 0, 1e7);
    Object.entries((o.trainWeeksByTask && typeof o.trainWeeksByTask === 'object') ? o.trainWeeksByTask : {}).forEach(([k, v]) => {
        const w = fin(v);
        if (k && w != null && w >= 0 && w <= 52 && Object.keys(out.trainWeeksByTask).length < 50) out.trainWeeksByTask[String(k).slice(0, 60)] = w;
    });
    return out;
}

/** 시급표(월 기본급, 이름 키)에서 제안 정규 월비용 = 재직자 월 기본급 평균. 이름은 돌려주지 않는다. */
export function suggestRegularBase(memberWages, names) {
    const v = (names || []).map(n => num(memberWages && memberWages[n])).filter(x => x > 0);
    return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/** 평소값(관리자 운영 리포트 모델, canCost) → 하루 매출·하루 인건비·건당 원가 구성 */
/** 월급 기준 인건비(평소 비교용) = 재직 정규 월 기본급 합 × (달력 일수 ÷ 30.4) + 그 기간 알바 기록 비용. 이름 없이 숫자만. */
export function salaryBasisLabor({ monthlyBases = [], calendarDays = 0, partTimerCost = 0 } = {}) {
    return monthlyBases.reduce((a, b) => a + num(b), 0) * (num(calendarDays) / MONTH_DAYS) + num(partTimerCost);
}

/** 알바 기록 비용 — 그날 등록 알바(day.partTimers[{name, wage(시급)}])의 업무 기록 시간 × 시급. 이름은 메모리에서만. */
export function partTimerCostOf(days) {
    let sum = 0;
    (days || []).forEach(d => {
        const pts = Array.isArray(d && d.partTimers) ? d.partTimers : (d && d.partTimers && typeof d.partTimers === 'object' ? Object.values(d.partTimers) : []);
        const wage = new Map(pts.filter(p => p && p.name).map(p => [p.name, num(p.wage)]));
        (Array.isArray(d && d.workRecords) ? d.workRecords : []).forEach(r => {
            if (r && wage.has(r.member)) sum += Math.min(num(r.duration), 720) / 60 * wage.get(r.member);
        });
    });
    return sum;
}

/** 평소값 — salaryLabor(월급 기준 인건비, 최근 8주)를 주면 하루 인건비를 그 정의로(예측과 같은 정의). 없으면 null(건당 원가 비교를 하지 않음). */
export function costBaseOf(model, { salaryLabor = null } = {}) {
    if (!model || !model.meta || model.meta.empty || !model.costs || model.costs.locked) return null;
    const C = model.costs, op = num(model.meta.operatingDays);
    const u = C.unitCost;
    return {
        opDays: op,
        revenuePerDay: op > 0 && num(C.revenue) > 0 ? C.revenue / op : null,
        laborPerDay: op > 0 && num(salaryLabor) > 0 ? salaryLabor / op : null,
        laborRatio: num(C.revenue) > 0 && num(salaryLabor) > 0 ? salaryLabor / C.revenue : null,
        unit: u ? { total: num(u.total), labor: num(u.labor), material: num(u.material), shipping: num(u.shipping), directDelivery: num(u.directDelivery) } : null,
        lossTasks: (model.tasks || []).filter(t => num(t.lossCost) > 0).sort((a, b) => b.lossCost - a.lossCost).slice(0, 3)
            .map(t => ({ task: t.task, lossCost: t.lossCost, lossMinutes: t.lossMinutes }))
    };
}

/** 인건비(정규·연장·알바) — fill = fillMix 합계 {overtime, temp, tempPeople}. */
export function laborOf({ calendarDays, months = null, monthlyBases = [], avgHourly = null, fill = {}, cost, stdHours = 8, extraRegular = 0 }) {
    // 채용 시나리오인데 정규 1인 월비용을 모르면 정규·합계를 모른다(0 으로 두지 않는다)
    const hireUnknown = extraRegular > 0 && cost.regularMonthlyBase == null;
    const regularMonthly = monthlyBases.reduce((a, b) => a + num(b), 0) + extraRegular * num(cost.regularMonthlyBase);
    const factor = months != null ? num(months) : num(calendarDays) / MONTH_DAYS;   // 월간 = 1(한 달 월급), 주간 = 일수 비례
    const regular = hireUnknown ? null : regularMonthly * factor;
    const overtime = avgHourly != null ? num(fill.overtime) * avgHourly * num(cost.overtimePremium) : null;
    const temp = cost.tempHourly != null ? num(fill.tempPeople) * cost.tempHourly * num(stdHours) : (num(fill.tempPeople) > 0 ? null : 0);
    const total = regular != null && overtime != null && temp != null ? regular + overtime + temp : null;
    return { regular: round(regular), overtime: round(overtime), temp: round(temp), total: round(total) };
}

/** 시나리오용 날짜 행 — 필요 × qtyFactor, 공급 + extra. dayRowOf 와 같은 부족·여유 규칙. */
export function scenarioDays(days, { qtyFactor = 1, extraSupply = 0 } = {}) {
    return (days || []).map(d => {
        if (!d || !d.workday || !d.hasRow) return { ...d, workday: !!(d && d.workday), shortHours: 0, spareHours: 0 };
        const raw = num(d.reqFTE) * qtyFactor;
        const supply = num(d.supplyFTE) + extraSupply;
        const hpp = num(d.hoursPerPerson) || 8;
        const gap = supply - Math.round(raw);
        return {
            ...d, reqFTE: raw, supplyFTE: supply, gap,
            shortHours: gap < 0 ? Math.max(0, raw - supply) * hpp : 0,
            spareHours: gap >= 0 ? Math.max(0, supply - raw) * hpp : 0,
            prepHours: num(d.prepHours) * qtyFactor
        };
    });
}
const staffFillRate = (days) => {
    const v = (days || []).filter(d => d && d.workday && d.hasRow && num(d.reqFTE) > 0).map(d => Math.min(1, num(d.supplyFTE) / num(d.reqFTE)));
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};
/** 주(월~일)마다 fillMix(연장 주 한도가 주마다) */
function fillByWeek(days, settings) {
    const groups = new Map();
    days.forEach(d => {
        const w = new Date(`${d.date}T00:00:00`).getDay();
        const mon = addDays(d.date, -((w + 6) % 7));
        if (!groups.has(mon)) groups.set(mon, []);
        groups.get(mon).push(d);
    });
    const t = { need: 0, prep: 0, overtime: 0, temp: 0, tempPeople: 0 };
    groups.forEach(list => { const f = fillMix(list, settings).totals; Object.keys(t).forEach(k => { t[k] += num(f[k]); }); });
    return t;
}

/**
 * 예산 모델(관리자만).
 * @param {object} p
 * @param {boolean} p.canMoney        관리자인가 — false 면 { locked:true } 만
 * @param {string}  p.horizon         'week' | 'month'
 * @param {object}  p.plan            주간 buildWeekPlan / 월간 buildMonthPlan 결과(days·fillTotals·meta)
 * @param {object}  p.cost            costSettingsOf(adminPrivate/opsPlanCost)
 * @param {object}  p.settings        plan-week planSettingsOf(연장 하루·주 한도·표준시간·알바 준비 일)
 * @param {Array}   p.monthlyBases    그 기간 재직 정직원 월 기본급 목록(숫자만 — 이름 없이 넘긴다)
 * @param {number}  p.avgHourly       정직원 평균 시급
 * @param {object}  p.base            costBaseOf(최근 8주 관리자 모델)
 * @param {number}  [p.qtyFactor]     물량 배율(주간 1, 월간 추세 × 계절)
 * @param {Array}   [p.pastShortFte]  [지난달 실제, 이번 달 지금까지] 부족 인원(명, 일평균 — 채용 판단)
 * @param {string}  p.today
 */
export function buildBudget(p = {}) {
    if (!p.canMoney) return { locked: true };
    const plan = p.plan || {};
    const cost = p.cost || costSettingsOf(null);
    const S = p.settings || {};
    const std = num(S.stdHours) || 8;
    const qf = num(p.qtyFactor) > 0 ? num(p.qtyFactor) : 1;
    const days = plan.days || [];
    const work = days.filter(d => d && d.workday && d.hasRow);
    const calendarDays = days.length;
    const avgHourly = fin(p.avgHourly);
    const base = p.base || null;

    const fill0 = plan.fillTotals || {};
    const fill = { overtime: num(fill0.overtime), temp: num(fill0.temp), tempPeople: num(fill0.tempPeople), prep: num(fill0.prep), need: num(fill0.need) };
    const months = p.horizon === 'month' ? 1 : null;
    const labor = laborOf({ calendarDays, months, monthlyBases: p.monthlyBases, avgHourly, fill, cost, stdHours: std });

    const revenueOf = (k) => (base && base.revenuePerDay != null ? base.revenuePerDay * work.length * k : null);
    const unitCostOf = (laborTotal, k) => {
        if (!base || !base.unit || laborTotal == null || !(base.laborPerDay > 0) || !work.length) return null;
        const scale = laborTotal / (base.laborPerDay * work.length);
        const u = base.unit;
        return u.labor * scale / k + u.material + u.shipping + u.directDelivery;
    };
    const revenue = revenueOf(qf);
    const ratio = revenue > 0 && labor.total != null ? labor.total / revenue : null;
    const unitCost = unitCostOf(labor.total, qf);

    // ── 수단 비교(같은 부족 인시) ──
    const H = fill.need;
    const hireWeeksOf = (task) => num(cost.hireLeadWeeks) + num(task && cost.trainWeeksByTask && cost.trainWeeksByTask[task] != null ? cost.trainWeeksByTask[task] : cost.trainWeeksDefault);
    const means = [
        { key: 'prep', label: '선처리(전날 여유 인원)', perHour: 0, cost: 0, leadDays: 0, note: `가능한 만큼 ${Math.round(fill.prep * 10) / 10}시간 — 기존 인원 시간이라 추가 비용 없음` },
        { key: 'overtime', label: '연장', perHour: avgHourly != null ? avgHourly * num(cost.overtimePremium) : null, leadDays: 0, note: `평균 시급 × 할증 ${num(cost.overtimePremium)}` },
        { key: 'temp', label: '알바', perHour: cost.tempHourly, leadDays: num(S.tempLeadDays) || 3, note: '알바 시급' },
        { key: 'regular', label: '정규 채용', perHour: cost.regularMonthlyBase != null ? cost.regularMonthlyBase / SALARY_HOURS : null, leadDays: hireWeeksOf(null) * 7, note: `월비용 ÷ ${SALARY_HOURS}시간 · 준비 = 채용 ${num(cost.hireLeadWeeks)}주 + 교육 ${num(cost.trainWeeksDefault)}주` }
    ].map(m => ({ ...m, cost: m.key === 'prep' ? 0 : (m.perHour != null ? round(m.perHour * H) : null), perHour: m.perHour != null ? round(m.perHour) : null }))
        .sort((a, b) => (a.cost == null ? 1 : 0) - (b.cost == null ? 1 : 0) || (a.cost || 0) - (b.cost || 0) || a.leadDays - b.leadDays);

    // ── 채용 역산(월간·신뢰도 보통 이상) ──
    let hire = null;
    const risks = [];
    const conf = plan.meta && plan.meta.confidence;
    if (p.horizon === 'month' && plan.meta) {
        const shortNext = work.length ? work.reduce((s, d) => s + Math.max(0, num(d.reqFTE) - num(d.supplyFTE)), 0) / work.length : 0;
        const past = (p.pastShortFte || []).map(num);
        const months = [...past, shortNext];
        const enough = conf && (conf.level === 'mid' || conf.level === 'high');
        const consecutive = months.length >= HIRE_RULE.months && months.slice(-HIRE_RULE.months).every(v => v >= HIRE_RULE.shortFte);
        const weeks = hireWeeksOf(null);
        const startBy = addDays(plan.meta.from, -weeks * 7);
        hire = {
            suggest: !!(enough && consecutive), confidenceOk: !!enough, months: months.map(v => Math.round(v * 10) / 10),
            shortNext: Math.round(shortNext * 10) / 10, startBy, weeks, late: !!(p.today && startBy < p.today)
        };
        if (hire.suggest && hire.late) risks.push({ key: 'hireLate', title: '채용 늦음', text: `3달 연속 부족(≥ ${HIRE_RULE.shortFte}명)인데 채용 시작 역산일(${startBy})이 지났습니다 — 그동안은 연장·알바로 메워야 합니다.` });
    }

    // ── 시나리오 5개 ──
    const scen = (key, label, { qtyFactor = 1, extraSupply = 0, otForTemp = false } = {}) => {
        const sd = scenarioDays(days, { qtyFactor, extraSupply });
        let f = fillByWeek(sd, S);
        if (otForTemp) f = { ...f, overtime: f.overtime + f.temp, temp: 0, tempPeople: 0 };
        const lb = laborOf({ calendarDays, months, monthlyBases: p.monthlyBases, avgHourly, fill: f, cost, stdHours: std, extraRegular: extraSupply });
        const k = qf * qtyFactor;
        const rev = revenueOf(k);
        const otPerPerson = otForTemp && work.length ? f.overtime / Math.max(1, work.reduce((s, d) => s + num(d.supplyFTE), 0) / work.length) / Math.max(1, Math.ceil(calendarDays / 7)) : null;
        return {
            key, label, fillRate: staffFillRate(sd), need: Math.round(f.need * 10) / 10,
            labor: lb.total, ratio: rev > 0 && lb.total != null ? lb.total / rev : null, unitCost: round(unitCostOf(lb.total, k)),
            warn: otForTemp && otPerPerson != null && otPerPerson > num(S.overtimeWeeklyMax || 12) ? '1인 주 연장 법정 한도(12시간)를 넘을 수 있습니다' : ''
        };
    };
    const scenarios = [
        scen('base', '기본'),
        scen('qtyUp', '물량 +10%', { qtyFactor: 1.1 }),
        scen('qtyDown', '물량 −10%', { qtyFactor: 0.9 }),
        scen('hire1', '정규 1명 채용', { extraSupply: 1 }),
        scen('otForTemp', '알바 대신 연장', { otForTemp: true })
    ];

    // ── 금액 과제(관리자 화면만 — OpsPlan 에 저장하지 않는다) ──
    const actions = [];
    if (unitCost != null && base && base.unit && base.unit.total > 0) {
        const pct = (unitCost - base.unit.total) / base.unit.total * 100;
        if (pct >= 10) actions.push({ rule: 'M13', title: `건당 원가가 평소보다 ${Math.round(pct)}% 높을 것으로 보입니다 — 원가 항목(인건비·자재·배송)을 점검해 보세요` });
    }
    if (p.horizon === 'month' && base) base.lossTasks.forEach((t, i) => actions.push({ rule: 'M14', title: `손실 금액 ${i + 1}위: ${t.task} — 평상시 속도보다 더 걸린 시간을 줄이는 개선을 우선 검토해 보세요` }));

    return {
        locked: false, horizon: p.horizon, calendarDays, workdays: work.length,
        labor, revenue: round(revenue), ratio, unitCost: round(unitCost),
        unitCostBase: base && base.unit ? round(base.unit.total) : null, unitCostTarget: cost.unitCostTarget,
        means, hire, risks, scenarios, actions,
        missing: [cost.tempHourly == null && fill.tempPeople > 0 ? '알바 시급' : '', avgHourly == null ? '정직원 시급표' : '', cost.regularMonthlyBase == null ? '정규 1인 월비용' : '', revenue == null ? '매출(경영 지표)' : ''].filter(Boolean)
    };
}

/**
 * 연간 예산(관리자만, 확장-3) — 달마다 정규(월급 합 1배) + 부족 시간 × 메우는 시간당 비용(알바 시급, 없으면 연장), 매출 = 평소 하루 × 업무일 × 월 지수 × 성장.
 *   Y7: 인건비 증가율(내년 합 ÷ 최근 12개월 월급 기준 인건비) − 물량 증가율 > 10%p → 생산성 목표 과제.
 * @param {object} p { canMoney, plan(buildYearPlan), monthlyBases, avgHourly, cost, base(costBaseOf), salaryLabor12(최근 12개월 월급 기준 인건비) }
 */
export function buildYearBudget(p = {}) {
    if (!p.canMoney) return { locked: true };
    const plan = p.plan || {};
    const cost = p.cost || costSettingsOf(null);
    const base = p.base || null;
    const reg = (p.monthlyBases || []).reduce((a, b) => a + num(b), 0);
    const avgHourly = fin(p.avgHourly);
    const fillHourly = cost.tempHourly != null ? cost.tempHourly : (avgHourly != null ? avgHourly * num(cost.overtimePremium) : null);
    const growth = num(plan.meta && plan.meta.growthUsed) || 1;
    const months = (plan.months || []).map(m => {
        if (m.reqFTE == null) return { month: m.month, labor: null, revenue: null, ratio: null };
        const shortH = Math.max(0, num(m.reqFTE) - num(m.supplyFTE)) * num(m.hoursPerPerson || 8) * num(m.workdays);
        const fillCost = shortH > 0 ? (fillHourly != null ? shortH * fillHourly : null) : 0;
        const labor = fillCost == null ? null : reg + fillCost;
        const revenue = base && base.revenuePerDay != null ? base.revenuePerDay * num(m.workdays) * (m.index != null ? m.index : 1) * growth : null;
        return { month: m.month, labor: round(labor), revenue: round(revenue), ratio: labor != null && revenue > 0 ? labor / revenue : null, shortHours: Math.round(shortH) };
    });
    const sum = (k) => (months.every(m => m[k] != null) && months.length ? months.reduce((a, m) => a + m[k], 0) : null);
    const labor = sum('labor'), revenue = sum('revenue');
    const actions = [];
    const prev = fin(p.salaryLabor12);
    let laborGrowth = null;
    if (labor != null && prev > 0) {
        laborGrowth = labor / prev - 1;
        const qtyGrowth = growth - 1;
        if ((laborGrowth - qtyGrowth) * 100 > 10) actions.push({ rule: 'Y7', title: `인건비가 물량보다 ${Math.round((laborGrowth - qtyGrowth) * 100)}%p 더 늘 것으로 보입니다 — 생산성(UPH) 목표를 세워 보세요` });
    }
    return {
        locked: false, horizon: 'year', months, fillHourly,   // 부족 메우기 시간당(알바 시급, 없으면 연장 시급) — 시뮬레이터가 같은 값을 쓴다
        labor: { total: labor, regular: round(reg * 12), overtime: null, temp: labor != null ? round(labor - reg * 12) : null },
        revenue, ratio: labor != null && revenue > 0 ? labor / revenue : null, unitCost: null, laborGrowth,
        scenarios: [], means: [], hire: null, risks: [], actions,
        missing: [avgHourly == null && cost.tempHourly == null ? '알바 시급·정직원 시급표' : '', revenue == null ? '매출(경영 지표)' : ''].filter(Boolean)
    };
}

/** 예산 문서에 넣을 한 건(adminPrivate/opsPlanBudget.plans[planId]) — 숫자만, 이름 없음 */
export function budgetEntryOf(b, savedAtMs) {
    if (!b || b.locked) return null;
    return {
        labor: b.labor.total, regular: b.labor.regular, overtime: b.labor.overtime, temp: b.labor.temp,
        revenue: b.revenue, ratio: b.ratio, unitCost: b.unitCost, savedAt: savedAtMs || null,
        scenarios: b.scenarios.map(s => ({ key: s.key, fillRate: s.fillRate, labor: s.labor, ratio: s.ratio, unitCost: s.unitCost }))
    };
}

/** 예산 map 정리 — 새 건을 넣고 최근 24개(savedAt 늦은 순)만 남긴다 */
export function trimBudgetPlans(plans, planId, entry, keep = BUDGET_KEEP) {
    const all = { ...(plans || {}), [planId]: entry };
    const keys = Object.keys(all).sort((a, b) => num(all[b] && all[b].savedAt) - num(all[a] && all[a].savedAt) || (a < b ? 1 : -1));
    return Object.fromEntries(keys.slice(0, keep).map(k => [k, all[k]]));
}
