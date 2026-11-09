// === js/lib/plan-month.js ===
// 운영 계획 MVP-2 — 월간 계획서(다음 달 1일~말일).
//   수요(하루): 업무별 요일 평균(최근 8주 운영일·처리량 > 0인 날, 그 요일 날 수로 나눈 평균) × 추세(trendFactor, 0.7~1.3) × 계절 비율.
//     계절 비율 = 작년 다음 달 하루 평균 처리량 ÷ 작년 이번 달 하루 평균(두 달 모두 운영일 ≥ 15일일 때만, 0.7~1.4 로 자름, 아니면 1).
//     필요 인원 = Σ(물량 ÷ 평상시 속도, 속도 모르는 업무는 평균 투입 분) ÷ 60 ÷ (표준 근무시간 × 가동률) — ops-metrics demandMinutes 와 같은 식.
//   공급: 그날 업무 예상 가용 인원(재직 − 휴무 − 관리자 개별업무, 수만 — UI 가 넘김). 주말·공휴일 제외.
//   메우기: plan-week fillMix 를 주(월~일)마다 따로 — 연장 주 12시간 상한이 주마다 다시 시작한다.
//   과제 M 규칙: M1 부족 → 알바 인일 계획 · M2 물량 ±10% · M3 휴가 몰림 주 · M4 평소보다 15% 이상 느린 업무 상위 3 ·
//     M5 담당 변경 뒤 UPH −10%(업무 이름만) · M6 가용 손실 > 15% · M7 품질 업무 시간 +20% · M8~M12 기록 품질.
//     M13·M14(금액)는 돈 단계, M15(마일스톤 효과, data.reports)는 TODO — 아직 없다.
//   금액·직원 이름 없음(담당 변경도 업무 이름·날짜·% 만).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-month.test.js

import { addDaysStr, dowOf, offDayOf, fillMix, planSettingsOf } from './plan-week.js?v=202611091042';
import { leaveThresholdOf } from './plan-risks.js?v=202611091042';
import { dailyTaskStats } from '../task-throughput.js?v=202611091042';
import { taskListOf, ownerByPeriod, detectOwnerChanges, compareAround, pctChange } from './task-owner.js?v=202611091042';
import { monthConfidence } from './plan-confidence.js?v=202611091042';

export const MONTH_LEVELS = Object.freeze({
    weeks: 8, seasonMinDays: 15, seasonMin: 0.7, seasonMax: 1.4, trendMin: 0.7, trendMax: 1.3,
    qtyShift: 10, slowEff: 85, ownerDrop: -10, utilLow: 85, qualityUp: 20, confOpRatio: 0.9, actionLimit: 10
});
const CONF_FACTOR = { high: 1, mid: 0.7, low: 0.4 };
const NOTE_RULE = { missingQty: 'M8', stdHours: 'M9', estimated: 'M10', capped: 'M11', offRoster: 'M12' };

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const clip = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const fmt = (id) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(id || ''));
    return m ? `${Number(m[2])}/${Number(m[3])}(${dowOf(id)})` : String(id || '');
};
const ymOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const qtyOfDay = (d) => Object.values((d && d.taskQuantities) || {}).reduce((t, v) => t + (Number(v) > 0 ? Number(v) : 0), 0);
const isOpDay = (d) => !!d && ((Array.isArray(d.workRecords) && d.workRecords.length > 0) || qtyOfDay(d) > 0);

/** 다음 달 = 오늘이 속한 달의 다음 달 1일 ~ 말일. */
export function nextMonthRange(todayStr) {
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(String(todayStr || ''));
    if (!m) return { key: null, from: null, to: null, dates: [] };
    let y = Number(m[1]), mo = Number(m[2]) + 1;
    if (mo > 12) { y++; mo = 1; }
    const last = new Date(y, mo, 0).getDate();
    const key = ymOf(y, mo);
    const dates = Array.from({ length: last }, (_, i) => `${key}-${String(i + 1).padStart(2, '0')}`);
    return { key, from: dates[0], to: dates[last - 1], dates };
}

/** 한 달(YYYY-MM)의 운영일 수·하루 평균 처리량(처리량 > 0 인 운영일) */
export function monthDailyQty(history, ym) {
    const ds = (history || []).filter(d => d && typeof d.id === 'string' && d.id.startsWith(ym + '-') && isOpDay(d) && qtyOfDay(d) > 0);
    const qty = ds.reduce((t, d) => t + qtyOfDay(d), 0);
    return { days: ds.length, perDay: ds.length ? qty / ds.length : null };
}

/** 계절 비율 — 작년 다음 달 ÷ 작년 이번 달(두 달 운영일 ≥ 15일), 0.7~1.4. 못 내면 { ratio:1, used:false }. */
export function seasonalRatio(history, todayStr, L = MONTH_LEVELS) {
    const m = /^(\d{4})-(\d{2})/.exec(String(todayStr || ''));
    if (!m) return { ratio: 1, used: false, raw: null };
    const y = Number(m[1]) - 1, mo = Number(m[2]);
    const thisYm = ymOf(y, mo);
    const nextYm = mo === 12 ? ymOf(y + 1, 1) : ymOf(y, mo + 1);
    const a = monthDailyQty(history, thisYm), b = monthDailyQty(history, nextYm);
    if (a.days < L.seasonMinDays || b.days < L.seasonMinDays || !(a.perDay > 0)) return { ratio: 1, used: false, raw: null, thisDays: a.days, nextDays: b.days };
    const raw = b.perDay / a.perDay;
    return { ratio: clip(raw, L.seasonMin, L.seasonMax), used: true, raw, thisDays: a.days, nextDays: b.days };
}

/** 업무별 요일 평균 — 최근 n주(오늘 제외) 운영일·처리량 > 0 인 날. { byDow:{0..6:{n, tasks:{업무:{qty, minutes}}}}, opDays } */
export function dowProfile(history, todayStr, weeks = MONTH_LEVELS.weeks) {
    const from = addDaysStr(todayStr, -7 * weeks);
    const ds = (history || []).filter(d => d && typeof d.id === 'string' && d.id >= from && d.id < todayStr && isOpDay(d) && qtyOfDay(d) > 0);
    const byDow = {};
    ds.forEach(d => {
        const w = new Date(`${d.id}T00:00:00`).getDay();
        const slot = byDow[w] || (byDow[w] = { n: 0, tasks: {} });
        slot.n++;
        Object.entries(dailyTaskStats(d)).forEach(([task, s]) => {
            const t = slot.tasks[task] || (slot.tasks[task] = { qty: 0, minutes: 0 });
            t.qty += num(s.qty);
            t.minutes += num(s.minutes);
        });
    });
    Object.values(byDow).forEach(slot => Object.values(slot.tasks).forEach(t => { t.qty /= slot.n; t.minutes /= slot.n; }));
    return { byDow, opDays: ds.length };
}

/** 하루 수요(분·처리량·선처리 분) — 업무별 평균 × factor. 속도(개/분)가 있으면 물량 ÷ 속도, 없으면 평균 투입 분. */
export function dayDemandOf(slot, speeds, factor, prepSet) {
    let minutes = 0, qty = 0, prep = 0;
    Object.entries((slot && slot.tasks) || {}).forEach(([task, t]) => {
        const spd = num(speeds && speeds[task]);
        const q = num(t.qty) * factor;
        const m = q > 0 && spd > 0 ? q / spd : num(t.minutes) * factor;
        minutes += m;
        qty += q;
        if (prepSet && prepSet.has(task)) prep += m;
    });
    return { minutes, qty, prepMinutes: prep };
}

/** 담당 변경 뒤 속도가 떨어진 업무 — 최근 n주 안의 변경, 변경 뒤 UPH 가 앞보다 ≤ −10%(표본 충분할 때). 이름은 담지 않는다. */
export function ownerDropsOf(history, { today, weeks = MONTH_LEVELS.weeks, excludeTasks = [], dropPct = MONTH_LEVELS.ownerDrop } = {}) {
    const days = (history || []).filter(d => d && typeof d.id === 'string' && d.id < today);
    const since = addDaysStr(today, -7 * weeks);
    const out = [];
    taskListOf(days, { exclude: excludeTasks }).forEach(task => {
        const hasQty = days.some(d => num(d.taskQuantities && d.taskQuantities[task]) > 0);
        if (!hasQty) return;
        const rows = ownerByPeriod(days, task, { gran: 'week' });
        const det = detectOwnerChanges(rows, { hold: 2, today });
        det.changes.filter(c => c.date >= since).forEach((c, i, arr) => {
            const cmp = compareAround(days, task, c, { gran: 'week', qtyTask: true, today, nextDate: arr[i + 1] ? arr[i + 1].date : null });
            const pct = pctChange(cmp.before.uph, cmp.after.uph);
            if (!cmp.lowSample && pct != null && pct <= dropPct) out.push({ task, date: c.date, pct: r1(pct) });
        });
    });
    return out.sort((a, b) => a.pct - b.pct);
}

/** 주(월~일) 묶음 — 날짜 순 행을 주 시작 월요일로 */
function weekChunks(days) {
    const map = new Map();
    days.forEach(d => {
        const w = new Date(`${d.date}T00:00:00`).getDay();
        const mon = addDaysStr(d.date, -((w + 6) % 7));
        if (!map.has(mon)) map.set(mon, []);
        map.get(mon).push(d);
    });
    return [...map.entries()].map(([mon, list]) => ({ mon, list }));
}

/**
 * 월간 계획서.
 * @param {object} input
 * @param {string} input.today
 * @param {Array}  input.history     지금 이름으로 합친 이력(aliasHistoryView)
 * @param {object} input.speeds      평상시 속도(개/분, baselineSpeeds)
 * @param {object} [input.cfg]       appConfig — 표준시간·가동률·opsPlan 설정
 * @param {number} [input.utilization] 가동률(0~1, normalizedUtilization)
 * @param {number} [input.trendFactor] predictFutureTrends trend.deliveryFactor — 0.7~1.3 로 자름, 없으면 1
 * @param {Function} input.supplyOf  (date) → { available, onLeave, roster } | null  (수만)
 * @param {Function} [input.holidayNameOf]
 * @param {Array}  [input.prepNames]
 * @param {object} [input.recentModel] 최근 4주 운영 리포트 모델 · [input.prevModel] 그 앞 4주
 * @param {number} [input.baseQtyPerDay] 최근 8주 하루 평균 처리량(M2 비교)
 * @param {Array}  [input.ownerDrops] ownerDropsOf 결과(M5)
 * @param {Array}  [input.confirmedErrs] 지난 월간 확정본 대비 필요 인원 오차(절댓값 %) — 신뢰도 v2
 */
export function buildMonthPlan(input = {}) {
    const L = MONTH_LEVELS;
    const today = input.today;
    const S = planSettingsOf(input.cfg);
    const range = input.range && input.range.dates ? input.range : nextMonthRange(today);
    const util = num(input.utilization) > 0 ? num(input.utilization) : 0.8;
    const trend = clip(num(input.trendFactor) > 0 ? num(input.trendFactor) : 1, L.trendMin, L.trendMax);
    const season = input.season || seasonalRatio(input.history, today);
    const factor = trend * season.ratio;
    const prof = input.profile || dowProfile(input.history, today);
    const prepSet = new Set(input.prepNames || []);
    const stdOf = (date) => {
        const std = (input.cfg && input.cfg.standardDailyWorkHours) || { weekday: 8, weekend: 4 };
        const w = new Date(`${date}T00:00:00`).getDay();
        return (w === 0 || w === 6) ? (num(std.weekend) || 4) : (num(std.weekday) || 8);
    };

    const days0 = range.dates.map(date => {
        const off = offDayOf(date, input.holidayNameOf);
        const base = {
            date, dow: dowOf(date), weekend: off.weekend, holiday: off.holiday, holidayName: off.holidayName,
            workday: !(off.weekend || off.holiday), hasRow: false, hasPlanned: false,
            demandHours: 0, qty: 0, reqFTE: 0, supplyFTE: 0, gap: 0, fillRate: null, leaveCount: 0, rosterCount: 0,
            hoursPerPerson: stdOf(date), shortHours: 0, spareHours: 0, prepHours: 0, recommend: 0, spareFTE: 0
        };
        if (!base.workday) return base;
        const slot = prof.byDow[new Date(`${date}T00:00:00`).getDay()];
        const sup = typeof input.supplyOf === 'function' ? input.supplyOf(date) : null;
        if (!slot || !sup) return base;
        const dm = dayDemandOf(slot, input.speeds, factor, prepSet);
        const hpp = base.hoursPerPerson;
        const raw = dm.minutes / 60 / (hpp * util);
        const supply = Math.max(0, Math.round(num(sup.available)));
        const gap = supply - Math.round(raw);
        const recommend = Math.max(0, Math.min(supply, Math.ceil(raw - 1e-9)));
        return {
            ...base, hasRow: true,
            demandHours: r1(dm.minutes / 60), qty: Math.round(dm.qty),
            reqFTE: r1(raw), supplyFTE: supply, gap, fillRate: raw > 0 ? Math.min(1, supply / raw) : 1,
            leaveCount: Math.max(0, Math.round(num(sup.onLeave))), rosterCount: Math.max(0, Math.round(num(sup.roster))),
            shortHours: gap < 0 ? r1(Math.max(0, raw - supply) * hpp) : 0,
            spareHours: gap >= 0 ? r1(Math.max(0, supply - raw) * hpp) : 0,
            prepHours: r1(dm.prepMinutes / 60 / util),
            recommend, spareFTE: Math.max(0, supply - recommend), rawReq: raw
        };
    });

    // 메우기 — 주마다(연장 주 12시간이 주마다 다시)
    const fillByDate = new Map();
    const weeks = weekChunks(days0).map(({ mon, list }) => {
        const f = fillMix(list, S);
        list.forEach((d, i) => fillByDate.set(d.date, f.days[i]));
        const wd = list.filter(d => d.workday && d.hasRow);
        const avg = (k) => (wd.length ? r1(wd.reduce((t, d) => t + num(d[k]), 0) / wd.length) : null);
        return {
            from: list[0].date, to: list[list.length - 1].date, mon, workdays: wd.length,
            reqAvg: avg('reqFTE'), supplyAvg: avg('supplyFTE'),
            shortDays: wd.filter(d => d.gap < 0).length, need: f.totals.need,
            fill: { prep: f.totals.prep, overtime: f.totals.overtime, temp: f.totals.temp, tempPeople: f.totals.tempPeople },
            leaveCrowd: wd.filter(d => d.leaveCount >= leaveThresholdOf(d.rosterCount)).map(d => d.date)
        };
    });
    const days = days0.map(d => {
        const f = fillByDate.get(d.date) || { prep: 0, overtime: 0, overtimePerPerson: 0, temp: 0, tempPeople: 0, spareLeft: d.spareHours };
        let x = d;
        const used = d.workday && d.hasRow ? Math.max(0, d.spareHours - num(f.spareLeft)) : 0;
        if (used > 0) {
            const rec = Math.min(d.supplyFTE, Math.ceil(d.rawReq + used / d.hoursPerPerson - 1e-9));
            x = { ...d, recommend: rec, spareFTE: Math.max(0, d.supplyFTE - rec), spareHours: num(f.spareLeft) };
        }
        const { rawReq, ...rest } = x;
        return { ...rest, prepGiven: r1(used), fill: { prep: f.prep, overtime: f.overtime, overtimePerPerson: f.overtimePerPerson, temp: f.temp, tempPeople: f.tempPeople } };
    });
    const work = days.filter(d => d.workday && d.hasRow);
    const sumW = (k) => r1(weeks.reduce((t, w) => t + num(w.fill[k]), 0));
    const fillTotals = {
        need: r1(weeks.reduce((t, w) => t + num(w.need), 0)), prep: sumW('prep'), overtime: sumW('overtime'), temp: sumW('temp'),
        tempPeople: weeks.reduce((t, w) => t + num(w.fill.tempPeople), 0), leadDays: { prep: 0, overtime: 0, temp: S.tempLeadDays }
    };
    // 신뢰도 — 최근 n주 '가능한 업무일'(주말·공휴일 뺀 날) 중 기록 있는 운영일 비율 ≥ 90% + 계절 비율 사용 → 보통
    let possible = 0;
    for (let i = 1; i <= 7 * L.weeks; i++) {
        const d = addDaysStr(today, -i);
        const o = offDayOf(d, input.holidayNameOf);
        if (!o.weekend && !o.holiday) possible++;
    }
    const opRatio = possible > 0 ? prof.opDays / possible : 0;
    // 신뢰도 v2(plan-confidence) — 작년 같은 달(계절 비율의 '다음 달' 운영일)·기록률·확정 대비 오차
    const confidence = { ...monthConfidence({ priorSameMonthDays: season.nextDays || 0, recordRate: possible > 0 ? Math.min(1, opRatio) : null, confirmedErrs: input.confirmedErrs || [] }) };
    Object.assign(confidence, { opDays: prof.opDays, possibleDays: possible, opRatio: r1(opRatio * 100) / 100, seasonUsed: !!season.used });

    // ── 과제 M ──
    const cf = CONF_FACTOR[confidence.level] || 0.4;
    const urg = (due) => {
        if (!due || !today) return 0.6;
        const n = (Date.parse(`${due}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86400000;
        return n <= 3 ? 1 : n <= 7 ? 0.8 : 0.6;
    };
    const acts = [];
    const push = (a) => acts.push({ ...a, hours: r1(Math.max(0, a.hours)), score: r1(Math.max(0, a.hours) * cf * urg(a.due)), key: `opsplan:${range.key}:${a.rule}:${a.target}` });
    const monthHours = work.reduce((t, d) => t + d.demandHours, 0);
    const workHours = work.reduce((t, d) => t + d.supplyFTE * d.hoursPerPerson, 0);
    if (fillTotals.need > 0) push({   // M1
        rule: 'M1', target: 'temp', hours: fillTotals.need, due: addDaysStr(range.from, -S.tempLeadDays), role: '관리자',
        title: `다음 달 부족 ${r1(fillTotals.need)}시간 — 알바 ${fillTotals.tempPeople}인일 계획(선처리·연장으로 메운 뒤)을 검토해 보세요`,
        basis: `부족한 업무일 ${work.filter(d => d.gap < 0).length}일 · 선처리 ${fillTotals.prep}h · 연장 ${fillTotals.overtime}h(주 12시간 상한) · 알바 ${fillTotals.temp}h`,
        effect: '미리 사람을 구해 두면 당일 부족을 막습니다'
    });
    const fQty = work.length ? work.reduce((t, d) => t + d.qty, 0) / work.length : null;
    const bQty = num(input.baseQtyPerDay) > 0 ? num(input.baseQtyPerDay) : null;
    if (fQty != null && bQty != null) {   // M2
        const pct = ((fQty - bQty) / bQty) * 100;
        if (Math.abs(pct) >= L.qtyShift) push({
            rule: 'M2', target: 'qty', hours: monthHours * Math.abs(pct) / 100, due: addDaysStr(range.from, -7), role: '관리자',
            title: `다음 달 물량이 평소보다 ${Math.round(Math.abs(pct))}% ${pct > 0 ? '많을' : '적을'} 것으로 보입니다 — 인원·휴가 계획을 맞춰 보세요`,
            basis: `예측 하루 ${Math.round(fQty).toLocaleString()}개 / 최근 8주 하루 ${Math.round(bQty).toLocaleString()}개 (추세 ${r1(trend)} · 계절 ${r1(season.ratio)})`,
            effect: pct > 0 ? '물량이 몰리기 전에 인원을 준비합니다' : '남는 인원을 교육·정리에 미리 배치합니다'
        });
    }
    weeks.filter(w => w.leaveCrowd.length).forEach(w => push({   // M3
        rule: 'M3', target: w.mon, hours: w.leaveCrowd.length * 8, due: addDaysStr(w.from, -7), role: '팀장',
        title: `${fmt(w.from)} 주 휴가 몰림(${w.leaveCrowd.map(fmt).join('·')}) — 다른 주로 나눌 수 있는지 검토해 보세요`,
        basis: '휴무가 명부 20% 또는 2명 이상인 날', effect: '그 주 공급 인원이 늘어 부족이 줄어듭니다'
    }));
    const rm = input.recentModel;
    const recentOp = rm && rm.meta ? num(rm.meta.operatingDays) : 0;
    const scale = recentOp > 0 ? work.length / recentOp : 1;
    if (rm && Array.isArray(rm.tasks)) {   // M4
        rm.tasks.filter(t => t.isQty && t.efficiency != null && t.efficiency <= L.slowEff && t.lossMinutes > 0)
            .sort((a, b) => b.lossMinutes - a.lossMinutes).slice(0, 3).forEach(t => push({
                rule: 'M4', target: t.task, hours: (t.lossMinutes / 60) * scale, due: range.from, role: '팀장',
                title: `${t.task} 속도가 평소보다 ${Math.round(100 - t.efficiency)}% 느립니다 — 원인 점검·교육을 검토해 보세요`,
                basis: `최근 4주 UPH ${r1(num(t.uph))} / 평상시 ${r1(num(t.stdUph))}`, effect: '평상시 속도로 돌아오면 그만큼 시간이 남습니다'
            }));
    }
    (input.ownerDrops || []).slice(0, 3).forEach(o => push({   // M5 — 이름 없이 업무명만
        rule: 'M5', target: o.task, hours: monthHours * 0.02, due: range.from, role: '팀장',
        title: `${o.task} 담당이 바뀐 뒤(${fmt(o.date)} 주부터) 속도가 ${Math.abs(o.pct)}% 떨어졌습니다 — 인수인계를 점검해 보세요`,
        basis: '담당 변경 전후 4주 UPH 비교(표본 충분)', effect: '인수인계 빈틈을 메우면 속도가 돌아옵니다'
    }));
    const u = rm && rm.productivity ? rm.productivity.utilization : null;
    if (u != null && u < L.utilLow) push({   // M6
        rule: 'M6', target: 'util', hours: workHours * (L.utilLow - u) / 100, due: range.from, role: '팀장',
        title: `가용 손실 ${Math.round(100 - u)}%(업무 기록 없는 재실 시간) — 대기·기록 누락 원인을 점검해 보세요`,
        basis: `최근 4주 가동률 ${r1(u)}%(기준 ${L.utilLow}%)`, effect: '기록 없는 시간이 줄면 필요 인원이 정확해지고 대기가 줄어듭니다'
    });
    const qm = (m) => (m && m.costs && m.costs.loss && m.meta && m.meta.operatingDays > 0 ? m.costs.loss.quality.minutes / m.meta.operatingDays : null);
    const qNow = qm(rm), qPrev = qm(input.prevModel);
    if (qNow != null && qPrev != null && qPrev > 0 && (qNow - qPrev) / qPrev * 100 >= L.qualityUp) push({   // M7
        rule: 'M7', target: 'quality', hours: (qNow - qPrev) / 60 * work.length, due: range.from, role: '팀장',
        title: `품질 업무(검수·오류 처리 등) 시간이 ${Math.round((qNow - qPrev) / qPrev * 100)}% 늘었습니다 — 오류 원인을 점검해 보세요`,
        basis: `하루 평균 ${r1(qNow / 60)}시간 / 그 앞 4주 ${r1(qPrev / 60)}시간`, effect: '오류가 줄면 재작업 시간이 남습니다'
    });
    ((rm && rm.notes) || []).forEach(n => {   // M8~M12
        const rule = NOTE_RULE[n.code];
        if (!rule) return;
        push({
            rule, target: n.code, hours: Math.max(1, num(n.n)) * 0.5, due: range.from, role: '각 파트 담당',
            title: `기록 품질: ${String(n.text || '').replace(/\s*—.*$/, '')} — 빠짐없이 넣도록 안내해 보세요`,
            basis: '최근 4주 운영 리포트 데이터 주의', effect: '계획·필요 인원 숫자가 정확해집니다'
        });
    });
    // TODO(M15): 마일스톤 효과(data.reports) — 순수 계산 함수가 아직 없어 이번 단계에서 뺐다.
    const uniq = new Map();
    acts.forEach(a => { const p = uniq.get(a.key); if (!p || a.score > p.score) uniq.set(a.key, a); });
    const actions = [...uniq.values()].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, L.actionLimit);

    const shortWeeks = weeks.filter(w => w.shortDays > 0);
    const summary = [];
    if (!work.length) summary.push(`다음 달(${range.key}) 계산할 업무일이 없습니다 — 최근 8주 기록이 모자랄 수 있습니다.`);
    else {
        summary.push(`다음 달(${range.key}) 업무일 ${work.length}일 · 하루 필요 평균 ${r1(work.reduce((t, d) => t + d.reqFTE, 0) / work.length)}명 / 공급 평균 ${r1(work.reduce((t, d) => t + d.supplyFTE, 0) / work.length)}명.`);
        summary.push(fillTotals.need > 0
            ? `부족한 주 ${shortWeeks.length}개 · 부족 ${r1(fillTotals.need)}시간 — 선처리 ${fillTotals.prep}h · 연장 ${fillTotals.overtime}h · 알바 ${fillTotals.tempPeople}인일을 검토해 보세요.`
            : '부족한 주가 없습니다 — 여유 인원은 교육·정리에 돌리는 것을 권합니다.');
    }
    summary.push(`신뢰도 ${confidence.label} — 최근 8주 운영일 ${prof.opDays}일 · 계절 비율 ${season.used ? `사용(${r1(season.ratio)})` : '없음(작년 기록 부족)'}.`);

    return {
        meta: {
            horizon: 'month', key: range.key, from: range.from, to: range.to, today, confidence,
            trendFactor: r1(trend), season: { ratio: r1(season.ratio), used: !!season.used },
            settings: { overtimeDailyMax: S.overtimeDailyMax, overtimeWeeklyMax: S.overtimeWeeklyMax, tempLeadDays: S.tempLeadDays, stdHours: S.stdHours },
            basis: [
                '수요 = 업무별 요일 평균(최근 8주 운영일) × 추세 × 계절 비율 — 업무 예상(일 단위)과 다른 어림',
                `추세 ${r1(trend)}(물량 추세 예측, 0.7~1.3) · 계절 ${season.used ? r1(season.ratio) : '1(작년 기록 부족)'}`,
                '공급 = 재직 인원 − 그날 휴무 − 관리자 개별업무 인원',
                `메우기: 주마다 선처리 → 연장(1인 하루 ${S.overtimeDailyMax}시간·주 ${S.overtimeWeeklyMax}시간) → 알바(1인일 ${S.stdHours}시간)`
            ]
        },
        summary: summary.slice(0, 3),
        days, weeks, fillTotals, actions
    };
}
