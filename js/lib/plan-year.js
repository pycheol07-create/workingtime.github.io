// === js/lib/plan-year.js ===
// 운영 계획 확장-3 — 연간 계획서(내년 1~12월). 1년치 기록으로 어림한 참고용.
//   신뢰도 v2(plan-confidence yearConfidence): 기록 개월 수(월 요약 + 메모리)·작년 같은 달·지난 연간 오차 — 고정 '낮음' 없앰(v2 D1).
//   성장: 같은 달 짝(전년 대비)이 6개 이상이면 yoyGrowth(정식), 그 전에는 growthOf('추정').
//   p.monthlies(월 요약 OpsMonthly, 13개월 넘는 달)가 있으면 메모리에 없는 달의 운영일·처리량을 채운다.
//   월 지수 = 그 달(최근 12개월 중 같은 달) 하루 평균 처리량 ÷ 12개월 평균. 운영일 < 15 인 달은 '빈 달'(지수 없음 → 1 로 계산, 표시는 '—').
//   성장률 = 최근 3개월 하루 평균 ÷ 가장 오래된 3개월 하루 평균('추정' — 같은 달 비교 아님, 0.7~1.5 로 자름).
//   처리 속도 추세 = 분기(최근 12개월을 3개월씩 4개)별 가중 UPH(처리량 ÷ 처리량 업무 시간).
//   월별 필요 인원 = 평소 하루 수요(분, 평상시 속도 — ops-metrics demandMinutes) × 월 지수 × 성장 ÷ 60 ÷ (표준시간 × 가동률) — 월간 계획과 같은 식.
//   공급 = 지금 재직 정규 수 − 월별 예상 휴무(작년 같은 달 휴무 비율, 없으면 평균). 퇴사 예정은 반영하지 못한다(문구).
//   운영일(최근 12개월) < 240 이면 월별 숫자를 만들지 않는다(insufficient) — "1년치 기록 부족 — 연간은 참고용, 기록 유지"(Y6).
//   과제 Y1 성수기(지수 ≥ 1.15) · Y2 비수기(≤ 0.85) · Y3 최대 필요 > 명부 + 1 이 3개월 이상 · Y4 분기 UPH −10% · Y5 성장률 ≥ +15% · Y6 기록 부족.
//     (Y7 인건비 증가율 − 물량 증가율 > 10%p 는 관리자 금액 — plan-budget buildYearBudget)
//   금액·직원 이름 없음.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-year.test.js

import { offDayOf, addDaysStr } from './plan-week.js?v=202611102106';
import { demandMinutes } from './ops-metrics.js?v=202611102106';
import { dailyTaskStats } from '../task-throughput.js?v=202611102106';
import { yearConfidence, yoyGrowth } from './plan-confidence.js?v=202611102106';

export const YEAR_LEVELS = Object.freeze({
    minMonthDays: 15, minOpDays: 240, peak: 1.15, offpeak: 0.85, growthMin: 0.7, growthMax: 1.5,
    uphDrop: -10, growthAlert: 15, overRoster: 1, overMonths: 3, peakLeadWeeks: 6
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const qtyOf = (d) => Object.values((d && d.taskQuantities) || {}).reduce((t, v) => t + (Number(v) > 0 ? Number(v) : 0), 0);
const isOp = (d) => !!d && ((Array.isArray(d.workRecords) && d.workRecords.length > 0) || qtyOf(d) > 0);
const ymOf = (id) => String(id).slice(0, 7);

/** 최근 12개월(오늘 제외) 운영일(처리량 > 0) */
export function yearDays(allDays, today) {
    const from = addDaysStr(today, -365);
    return (allDays || []).filter(d => d && typeof d.id === 'string' && d.id >= from && d.id < today && isOp(d) && qtyOf(d) > 0);
}

/** 월 지수 { 1..12: { days, perDay, index|null } } — 같은 달 번호끼리(최근 12개월이라 달마다 한 번) */
export function monthIndex(days, L = YEAR_LEVELS) {
    const by = {};
    days.forEach(d => {
        const m = Number(d.id.slice(5, 7));
        const s = by[m] || (by[m] = { days: 0, qty: 0 });
        s.days++; s.qty += qtyOf(d);
    });
    const out = {};
    for (let m = 1; m <= 12; m++) {
        const s = by[m] || { days: 0, qty: 0 };
        out[m] = { days: s.days, perDay: s.days ? s.qty / s.days : null, index: null };
    }
    const full = Object.values(out).filter(x => x.days >= L.minMonthDays && x.perDay != null);
    const avg = full.length ? full.reduce((a, x) => a + x.perDay, 0) / full.length : null;
    Object.values(out).forEach(x => { if (avg > 0 && x.days >= L.minMonthDays) x.index = r2(x.perDay / avg); });
    return out;
}

/** 성장률 — 최근 3개월 하루 평균 ÷ 가장 오래된 3개월(달 단위, 기록 있는 달만). 못 내면 null. */
export function growthOf(days) {
    const by = new Map();
    days.forEach(d => { const k = ymOf(d.id); const s = by.get(k) || { n: 0, q: 0 }; s.n++; s.q += qtyOf(d); by.set(k, s); });
    const keys = [...by.keys()].sort();
    if (keys.length < 6) return null;
    const per = (ks) => { const n = ks.reduce((a, k) => a + by.get(k).n, 0); return n ? ks.reduce((a, k) => a + by.get(k).q, 0) / n : null; };
    const old = per(keys.slice(0, 3)), rec = per(keys.slice(-3));
    return old > 0 && rec != null ? rec / old : null;
}

/** 분기(최근 12개월 → 3개월씩 4개)별 가중 UPH = 처리량 ÷ (처리량 있는 업무 시간 ÷ 60) */
export function quarterUph(days, today) {
    const out = [];
    for (let q = 3; q >= 0; q--) {
        const to = addDaysStr(today, -q * 91), from = addDaysStr(today, -(q + 1) * 91);
        let qty = 0, min = 0;
        days.filter(d => d.id >= from && d.id < to).forEach(d => {
            Object.values(dailyTaskStats(d)).forEach(s => { if (s.qty > 0 && s.minutes > 0) { qty += s.qty; min += s.minutes; } });
        });
        out.push({ from, to: addDaysStr(to, -1), uph: min > 0 ? r1(qty / (min / 60)) : null });
    }
    return out;
}

/** 내년 각 달 업무일 수(주말·공휴일 제외) */
export function workdaysOfMonth(ym, holidayNameOf) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    let n = 0;
    for (let d = 1; d <= last; d++) {
        const id = `${ym}-${String(d).padStart(2, '0')}`;
        const o = offDayOf(id, holidayNameOf);
        if (!o.weekend && !o.holiday) n++;
    }
    return n;
}

/**
 * 연간 계획서.
 * @param {object} p
 * @param {Array}  p.allDays     지금 이름 사본 이력
 * @param {string} p.today
 * @param {object} p.speeds      평상시 속도(개/분)
 * @param {number} [p.utilization] 가동률 0~1
 * @param {object} [p.cfg]       표준 근무시간
 * @param {number} p.roster      지금 재직 정규 수(이름 없이 수만)
 * @param {object} [p.leaveRate] { 1..12: 하루 휴무 비율(0~1) } — 작년 같은 달, 없으면 평균
 * @param {Function} [p.holidayNameOf]
 * @param {number} [p.leadWeeks] 성수기 준비 기간(주) — 관리자 비용 설정(채용 + 교육), 없으면 6
 * @param {Array}  [p.monthlies]  월 요약(OpsMonthly) 목록 [{ym, qtyDays, qty}] — 메모리에 없는 달을 채운다
 * @param {number} [p.lastYearErr] 지난 연간 확정 대비 오차(%) — 신뢰도 v2
 * @param {number} [p.year]       어림할 해(기본 내년) — 분기 계획서가 올해 분기를 볼 때
 */
export function buildYearPlan(p = {}) {
    const L = YEAR_LEVELS;
    const today = p.today;
    const year = Number(p.year) > 0 ? Number(p.year) : Number(String(today).slice(0, 4)) + 1;
    const key = String(year);
    const days = yearDays(p.allDays, today);
    const opDays = days.length;
    const insufficient = opDays < L.minOpDays;
    const idx = monthIndex(days);
    // 달별 운영일·처리량 — 메모리(최근 이력) 우선, 없는 달은 월 요약으로
    const perMonth = {};
    (p.allDays || []).filter(d => d && typeof d.id === 'string' && d.id < today && isOp(d) && qtyOf(d) > 0).forEach(d => {
        const k = ymOf(d.id); const s = perMonth[k] || (perMonth[k] = { opDays: 0, qty: 0 }); s.opDays++; s.qty += qtyOf(d);
    });
    // 메모리는 '처리량 > 0 인 운영일'로 센다 → 요약도 같은 기준(qtyDays, 옛 schema 1 은 opDays)
    (p.monthlies || []).forEach(m => { if (m && m.ym && !perMonth[m.ym] && m.ym < String(today).slice(0, 7)) perMonth[m.ym] = { opDays: num(m.qtyDays != null ? m.qtyDays : m.opDays), qty: num(m.qty) }; });
    const curYm = String(today).slice(0, 7);
    const fullMonths = Object.entries(perMonth).filter(([k, v]) => k < curYm && v.opDays >= L.minMonthDays);
    const yoy = yoyGrowth(perMonth);
    const gRaw = yoy ? yoy.ratio : growthOf(days);
    const growthKind = yoy ? 'yoy' : (gRaw == null ? null : 'estimate');
    const lastYear = String(year - 1);
    const priorSameMonths = fullMonths.filter(([k]) => k.startsWith(lastYear + '-')).length;
    const confidence = { ...yearConfidence({ months: fullMonths.length, priorSameMonths, lastYearErr: p.lastYearErr }), opDays, possibleDays: null };
    const growth = gRaw == null ? 1 : Math.min(L.growthMax, Math.max(L.growthMin, gRaw));
    const qUph = quarterUph(days, today);
    const util = num(p.utilization) > 0 ? num(p.utilization) : 0.8;
    const std = num(p.cfg && p.cfg.standardDailyWorkHours && p.cfg.standardDailyWorkHours.weekday) || 8;
    const baseMin = opDays ? days.reduce((a, d) => a + demandMinutes(d, p.speeds), 0) / opDays : 0;
    const roster = Math.max(0, Math.round(num(p.roster)));
    const rates = p.leaveRate || {};
    const rateVals = Object.values(rates).map(num).filter(v => v >= 0);
    const avgRate = rateVals.length ? rateVals.reduce((a, b) => a + b, 0) / rateVals.length : 0;

    const months = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const ym = `${year}-${String(m).padStart(2, '0')}`;
        const wd = workdaysOfMonth(ym, p.holidayNameOf);
        const ix = idx[m].index;
        const rate = rates[m] != null ? num(rates[m]) : avgRate;
        if (insufficient) return { month: ym, m, workdays: wd, index: null, empty: idx[m].index == null, reqFTE: null, supplyFTE: null, gap: null, hoursPerPerson: std };
        const req = baseMin * (ix != null ? ix : 1) * growth / 60 / (std * util);
        const supply = Math.max(0, Math.round(roster * (1 - rate) * 10) / 10);
        return {
            month: ym, m, workdays: wd, index: ix, empty: ix == null,
            reqFTE: r1(req), supplyFTE: supply, gap: r1(supply - req), hoursPerPerson: std,
            peak: ix != null && ix >= L.peak, offpeak: ix != null && ix <= L.offpeak
        };
    });

    // ── 과제 Y ──
    const acts = [];
    const lead = num(p.leadWeeks) > 0 ? num(p.leadWeeks) : L.peakLeadWeeks;
    const push = (a) => acts.push({ ...a, key: `opsplan:${key}:${a.rule}:${a.target}`, score: r1(a.hours || 0) });
    if (insufficient) {
        push({ rule: 'Y6', target: 'data', hours: 1, due: null, role: '각 파트 담당',
            title: '1년치 기록 부족 — 연간 계획은 참고용입니다. 업무·처리량 기록을 빠짐없이 유지해 주세요',
            basis: `최근 12개월 운영일 ${opDays}일(기준 ${L.minOpDays}일)`, effect: '내년에는 달별 계획을 낼 수 있습니다' });
    } else {
        months.filter(x => x.peak).forEach(x => push({
            rule: 'Y1', target: x.month, hours: Math.max(0, -x.gap) * x.workdays * std + x.workdays, due: addDaysStr(`${x.month}-01`, -lead * 7), role: '관리자',
            title: `${x.m}월 성수기(지수 ${x.index}) — ${lead}주 전부터 채용·교육 준비를 검토해 보세요`,
            basis: `필요 ${x.reqFTE}명 / 공급 ${x.supplyFTE}명(어림)`, effect: '성수기 전에 사람과 숙련을 준비합니다' }));
        months.filter(x => x.offpeak).forEach(x => push({
            rule: 'Y2', target: x.month, hours: x.workdays, due: `${x.month}-01`, role: '팀장',
            title: `${x.m}월 비수기(지수 ${x.index}) — 연차 사용·설비 점검·교육을 권합니다`,
            basis: `여유 어림 ${r1(Math.max(0, x.gap))}명`, effect: '바쁜 달의 휴가·교육 부담이 줄어듭니다' }));
        const over = months.filter(x => x.reqFTE != null && x.reqFTE > roster + L.overRoster);
        if (over.length >= L.overMonths) push({
            rule: 'Y3', target: 'roster', hours: over.reduce((a, x) => a + (x.reqFTE - roster) * x.workdays * std, 0), due: `${key}-01-01`, role: '관리자',
            title: `필요 인원이 명부보다 1명 넘게 많은 달이 ${over.length}개월 — 정규 인원과 알바 비중을 검토해 보세요`,
            basis: `${over.map(x => `${x.m}월`).join('·')} · 신뢰도 낮음(검토 말투)`, effect: '반복 부족을 고정 인력으로 메울지 판단합니다' });
        for (let i = 1; i < qUph.length; i++) {
            const a = qUph[i - 1].uph, b = qUph[i].uph;
            if (a > 0 && b != null && (b - a) / a * 100 <= L.uphDrop) {
                push({ rule: 'Y4', target: qUph[i].from, hours: 10, due: `${key}-01-01`, role: '팀장',
                    title: `분기 처리 속도가 ${Math.round((b - a) / a * -100)}% 떨어졌습니다 — 공정·로케이션 개선 과제를 검토해 보세요`,
                    basis: `분기 UPH ${a} → ${b}`, effect: '처리 속도를 되찾습니다' });
                break;
            }
        }
        if (gRaw != null && (gRaw - 1) * 100 >= L.growthAlert) push({
            rule: 'Y5', target: 'growth', hours: 10, due: `${key}-01-01`, role: '관리자',
            title: `물량이 ${Math.round((gRaw - 1) * 100)}% 늘고 있습니다${growthKind === 'yoy' ? '(전년 같은 달 대비)' : '(추정)'} — 작업대·포장 용량을 점검해 보세요`,
            basis: growthKind === 'yoy' ? `같은 달 짝 ${yoy.pairs}개 하루 평균 비교` : '최근 3개월 ÷ 가장 오래된 3개월 하루 평균(같은 달 비교 아님)', effect: '용량 부족으로 막히는 일을 막습니다' });
    }
    const actions = acts.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, 10);

    const known = months.filter(x => x.reqFTE != null);
    const summary = insufficient
        ? [`최근 12개월 운영일 ${opDays}일 — 1년치 기록 부족(기준 ${L.minOpDays}일). 연간은 참고용입니다. 기록을 유지해 주세요.`]
        : [
            `${key}년 월별 필요 인원 ${r1(Math.min(...known.map(x => x.reqFTE)))}~${r1(Math.max(...known.map(x => x.reqFTE)))}명(어림) · 지금 명부 ${roster}명.`,
            `성수기 ${months.filter(x => x.peak).map(x => `${x.m}월`).join('·') || '없음'} · 비수기 ${months.filter(x => x.offpeak).map(x => `${x.m}월`).join('·') || '없음'} · 성장 ${gRaw == null ? '추정 불가' : `${r1((gRaw - 1) * 100)}%${growthKind === 'yoy' ? '(전년 대비)' : '(추정)'}`}.`,
            `신뢰도 ${confidence.label} — ${confidence.reasons.join(' · ')}. 퇴사 예정은 반영하지 못합니다.`
        ];
    return {
        meta: {
            horizon: 'year', key, from: `${key}-01-01`, to: `${key}-12-31`, today, opDays, insufficient,
            confidence, monthsKnown: fullMonths.length, priorSameMonths,
            growth: gRaw == null ? null : r2(gRaw), growthKind, growthUsed: r2(growth), quarters: qUph, roster,
            basis: [
                `기록 ${fullMonths.length}개월 기준(월 요약 포함)·참고용 — 신뢰도 ${confidence.label}`,
                '필요 = 평소 하루 수요 × 월 지수 × 성장 ÷ (표준시간 × 가동률) — 월간 계획과 같은 식',
                '공급 = 지금 재직 정규 − 작년 같은 달 휴무 비율(퇴사 예정 반영 안 됨)',
                `월 지수: 운영일 ${L.minMonthDays}일 미만 달은 빈 달(지수 1 로 계산)`
            ]
        },
        summary, months, actions,
        days: [], fillTotals: { need: 0, prep: 0, overtime: 0, temp: 0, tempPeople: 0 }
    };
}
