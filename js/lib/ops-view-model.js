// === js/lib/ops-view-model.js ===
// 운영 리포트 화면 모델 — 탭 4개(요약·생산성·인력·비용)가 그릴 숫자를 한 번에 만든다(운영 리포트 내용 통합, 2026-11-05).
// 계산은 js/lib/ops-metrics.js(opsSummary·periodMetrics·partSummary)와 js/lib/task-owner.js 를 그대로 쓰고,
// 여기서는 '화면에 무엇을 어떤 모양으로 넘기나' 만 정한다. 화면은 js/ui-ops-view.js(그리기만).
//
// 금액 가리기: canCost(data.reports) 가 false 면 금액 칸(인건비·원가·손실 금액·매출)은 **모델 단계에서 null** 이다.
//   시급표·인건비 합계 같은 원재료도 모델에 담지 않는다 — 모델 통째로 분석 권한 화면에 넘겨도 금액이 새지 않게.
// 직원 이름도 모델에 담지 않는다(업무 담당 변화는 업무 이름·날짜·건수만). 이름이 필요한 화면은 task-owner.js 를 직접 부른다.
// 입력 days·prevDays·baselineDays·allDays 는 지금 이름으로 합친 사본(aliasHistoryView)을 넘길 것. 모델 모양은
// scratchpad ops_model_contract.md 와 tests/ops-view-model.test.js 가 기준이다.
// ※ 순수 모듈(DOM·Firebase 없음). 읽기만 한다. 테스트: tests/ops-view-model.test.js

import {
    opsSummary, periodMetrics, partSummary, baselineSpeeds, lastDayIdOf, previousPeriodOf, rollingBaselineOf,
    periodDaysOf, PARTS, OEE_LEVELS, OVERLOAD_UTIL, overloadUtilOf
} from './ops-metrics.js?v=202611051650';
import { taskNameOf, TASK } from './task-ids.js?v=202611051650';
import { aliasTaskName } from './task-alias-view.js?v=202611051650';
import { taskListOf, ownerByPeriod, detectOwnerChanges, CAP_MINUTES } from './task-owner.js?v=202611051650';

/** 판정 기준 — 진단 문장·부족/여유 일자가 같이 쓴다. */
export const OPS_VIEW_LEVELS = Object.freeze({
    shortGap: 0.5,        // 출근 − 필요 가 이보다 작으면(−0.5명 미만) '부족한 날'
    spareGap: 1.0,        // 출근 − 필요 가 이보다 크면(+1명 초과) '여유 있는 날'
    effGood: 95,          // 효율(%) 이 이 이상이면 평상시 수준
    effBad: 90,           // 이 이하면 느림
    utilLow: 80,          // 가동률(%) 이 이 미만이면 '기록 없는 시간 많음'
    lossMinMinutes: 30,   // 손실 상위 업무로 꼽는 최소 손실 분
    topN: 3               // 손실 상위 업무·부족/여유 일자를 몇 개까지
});

const num = (v) => Number(v) || 0;
const arr = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
const pct = (a, b) => (a != null && b != null && b > 0 ? ((a - b) / b) * 100 : null);
const pp = (a, b) => (a != null && b != null ? a - b : null);
const uphOf = (qty, minutes) => (minutes > 0 && qty > 0 ? qty / (minutes / 60) : null);
const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** 기간 하루 문서들의 첫날·마지막 날 id. */
function rangeOf(days) {
    let from = null, to = null;
    (days || []).forEach(d => {
        if (!d || typeof d.id !== 'string') return;
        if (!from || d.id < from) from = d.id;
        if (!to || d.id > to) to = d.id;
    });
    return { from, to };
}

/** 처리량 입력 업무인가(설정 quantityTaskTypes, 옛 이름 포함). */
function qtyTaskSetOf(cfg) {
    return new Set(arr(cfg && cfg.quantityTaskTypes).map(n => aliasTaskName(n, cfg)).filter(Boolean));
}

/**
 * 화면에 넘길 입력 한 벌 — 기간(단위·키)으로 days·prevDays·baselineDays 를 고른다. allDays 는 지금 이름으로 합친 사본.
 * @returns {{days, prevDays, prevKey, baselineDays, baselineLabel}}
 */
export function opsModelInputs(gran, key, allDays) {
    const days = periodDaysOf(gran, key, allDays);
    const prev = previousPeriodOf(gran, key, allDays);
    const base = rollingBaselineOf(gran, key, allDays);
    return { days, prevDays: prev.days, prevKey: prev.key, baselineDays: base.data, baselineLabel: base.description };
}

/**
 * 업무 담당 변화 요약 — 업무별 주 인원이 바뀐 지점(task-owner.js, 주 단위·2주 연속 1위). 이름은 담지 않는다.
 * ownerDays = 보통 메모리의 최근 13개월 전체(+ 이번 달). from·to 를 주면 그 기간 안의 변경을 inPeriod 로 표시.
 * @returns {{windowLabel, gran, hold, changedTasks, inPeriodTasks, items:[{task, date, inPeriod}]}}  items 는 날짜 늦은 순
 */
export function ownerChangeSummary(ownerDays, cfg, { today = null, from = null, to = null, gran = 'week', hold = 2 } = {}) {
    const days = Array.isArray(ownerDays) ? ownerDays : [];
    const tasks = taskListOf(days, { exclude: [taskNameOf(TASK.admin, cfg || {})] });
    const items = [];
    const changed = new Set(), inPeriod = new Set();
    tasks.forEach(task => {
        const rows = ownerByPeriod(days, task, { gran });
        const det = detectOwnerChanges(rows, { hold, today });
        det.changes.forEach(c => {
            const inP = !!(from && to && c.date >= from && c.date <= to);
            items.push({ task, date: c.date, inPeriod: inP });
            changed.add(task);
            if (inP) inPeriod.add(task);
        });
    });
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.task < b.task ? -1 : 1)));
    return {
        windowLabel: '최근 13개월', gran, hold,
        changedTasks: changed.size, inPeriodTasks: inPeriod.size, items
    };
}

/** 헤드라인 칸 하나. 비교값이 없으면 null. */
function headItem(key, label, unit, value, prev, base, { deltaKind = 'pct', better = 'up', locked = false, ...extra } = {}) {
    const d = deltaKind === 'pp' ? pp : pct;
    return {
        key, label, unit, value, prev, base,
        vsPrev: value == null ? null : d(value, prev),
        vsBase: value == null ? null : d(value, base),
        deltaKind, better, locked, ...extra
    };
}

/** 업무별 표 행(시간·UPH·평상시 속도·손실분·전기 대비). cost 류는 canCost 일 때만. */
function taskRows(cur, prev, speeds, qtySet, canCost) {
    const totalMin = Object.values(cur.tasks).reduce((s, t) => s + t.minutes, 0);
    return Object.entries(cur.tasks)
        .filter(([, t]) => t.minutes > 0 || t.qty > 0)
        .map(([task, t]) => {
            const spd = num(speeds && speeds[task]);           // 개/분
            const p = prev.tasks[task] || { minutes: 0, qty: 0, cost: 0 };
            const hasStd = spd > 0 && t.qty > 0;
            const stdMinutes = hasStd ? t.qty / spd : null;
            const lossMinutes = hasStd ? Math.max(0, t.minutes - stdMinutes) : 0;
            const uph = uphOf(t.qty, t.minutes);
            const prevUph = uphOf(p.qty, p.minutes);
            const perMin = t.minutes > 0 ? t.cost / t.minutes : 0;
            return {
                task,
                isQty: qtySet.has(task) || t.qty > 0,
                minutes: t.minutes,
                qty: t.qty,
                share: totalMin > 0 ? (t.minutes / totalMin) * 100 : 0,
                uph,
                stdUph: spd > 0 ? spd * 60 : null,
                efficiency: hasStd && t.minutes > 0 ? (stdMinutes / t.minutes) * 100 : null,
                lossMinutes,
                prevMinutes: p.minutes,
                prevUph,
                vsPrevMinutes: pct(t.minutes, p.minutes),
                vsPrevUph: pct(uph, prevUph),
                cost: canCost ? t.cost : null,
                lossCost: canCost ? lossMinutes * perMin : null
            };
        })
        .sort((a, b) => b.minutes - a.minutes || (a.task < b.task ? -1 : 1));
}

/** 진단 3줄 — 속도·인력·손실(기록이 없는 기간은 1줄). 문장에 금액·직원 이름을 넣지 않는다. */
function diagnosesOf(cur, prev, hasPrev, hasBaseline, lossTasks, shortDays, spareDays, empty) {
    const L = OPS_VIEW_LEVELS;
    if (empty) {
        return [{ key: 'empty', tone: 'info', text: '이 기간에 업무 기록이 없습니다.' }];
    }
    // 처리량이 하나도 없는 기간(오늘 입력 전 등) — 효율 0%·필요 0명은 '느림·여유' 가 아니라 '아직 모름'
    const noQty = !(num(cur.totalQuantity) > 0);
    // 1) 속도(효율 = 평상시 속도 대비)
    let speed;
    if (noQty) speed = { key: 'speed', tone: 'info', text: '처리량 입력 전이라 처리 속도를 비교할 수 없습니다.' };
    else if (!hasBaseline) speed = { key: 'speed', tone: 'info', text: '평상시 속도 기준이 없어 처리 속도를 비교할 수 없습니다.' };
    else {
        const eff = cur.efficiencyRatio;
        const tail = hasPrev && prev.efficiencyRatio > 0 ? ` 전기 ${Math.round(prev.efficiencyRatio)}% → 지금 ${Math.round(eff)}%.` : '';
        if (eff <= L.effBad) speed = { key: 'speed', tone: 'bad', text: `처리 속도가 평상시보다 느립니다(효율 ${Math.round(eff)}%).${tail}` };
        else if (eff < L.effGood) speed = { key: 'speed', tone: 'warn', text: `처리 속도가 평상시보다 조금 느립니다(효율 ${Math.round(eff)}%).${tail}` };
        else if (eff >= 105) speed = { key: 'speed', tone: 'good', text: `처리 속도가 평상시보다 빠릅니다(효율 ${Math.round(eff)}%).${tail}` };
        else speed = { key: 'speed', tone: 'good', text: `처리 속도가 평상시 수준입니다(효율 ${Math.round(eff)}%).${tail}` };
    }
    // 2) 인력(출근 vs 필요)
    let staff;
    const gap = cur.availableFTE - cur.requiredFTE;
    const nums = `출근 ${r1(cur.availableFTE)}명 / 필요 ${r1(cur.requiredFTE)}명`;
    if (noQty) staff = { key: 'staff', tone: 'info', text: `처리량 입력 전이라 필요 인원을 계산할 수 없습니다. 출근 ${r1(cur.availableFTE)}명.` };
    else if (!hasBaseline) staff = { key: 'staff', tone: 'info', text: `필요 인원을 계산할 수 없습니다(평상시 속도 기준 없음). 출근 ${r1(cur.availableFTE)}명.` };
    else if (!(cur.requiredFTE > 0)) staff = { key: 'staff', tone: 'info', text: `필요 인원을 계산할 수 없습니다(처리량이 있는 업무에 평상시 속도가 없음). 출근 ${r1(cur.availableFTE)}명.` };
    else if (overloadUtilOf(cur) >= OVERLOAD_UTIL) staff = { key: 'staff', tone: 'bad', text: `출근해 있던 시간이 거의 모두 업무로 채워졌습니다(여유 시간 거의 없음). ${nums}.` };
    else if (gap < -L.shortGap) staff = { key: 'staff', tone: 'bad', text: `하루 평균 ${r1(-gap)}명 부족합니다(${nums}). 부족한 날 ${shortDays}일.` };
    else if (gap > L.spareGap) staff = { key: 'staff', tone: 'warn', text: `하루 평균 ${r1(gap)}명 여유가 있습니다(${nums}). 여유 있는 날 ${spareDays}일.` };
    else staff = { key: 'staff', tone: 'good', text: `출근 인원이 필요 인원과 맞습니다(${nums}).` };
    // 3) 손실(가장 많이 늦어진 업무 → 없으면 기록 없는 시간)
    let loss;
    const top = lossTasks[0];
    if (top) loss = { key: 'loss', tone: 'warn', text: `가장 많이 늦어진 업무는 ${top.task}입니다 — 평상시 속도보다 ${r1(top.lossMinutes / 60)}시간 더 걸렸습니다.` };
    else if (cur.utilizationRate > 0 && cur.utilizationRate < L.utilLow) loss = { key: 'loss', tone: 'warn', text: `출근 후 업무 기록이 없는 시간이 ${r1(cur.availabilityLossMinutes / 60)}시간입니다(가동률 ${Math.round(cur.utilizationRate)}%).` };
    else loss = { key: 'loss', tone: 'good', text: '평상시보다 크게 늦어진 업무가 없습니다.' };
    return [speed, staff, loss];
}

/** 데이터 주의 줄 — 숫자를 믿기 전에 알아야 할 것. [{code, text, n?}] — n = 날·건 수(기록 누락 4종, 운영 계획 리스크가 씀) */
function notesOf({ cur, hasPrev, hasBase, hasBaseline, days, today, qtySet, canCost, wages }) {
    const st = cur.staffing;
    const out = [];
    if (!hasBaseline) out.push({ code: 'noBaseline', text: '평상시 속도 기준이 없어 효율·필요 인원·OEE 를 낼 수 없습니다.' });
    if (!hasPrev) out.push({ code: 'noPrev', text: '전기 기록이 없어 전기 대비를 비울 수밖에 없습니다.' });
    if (!hasBase) out.push({ code: 'noBase', text: '평소 비교 기준 기간에 기록이 없어 평소 대비를 비웠습니다.' });
    if (today && (days || []).some(d => d && d.id === today)) out.push({ code: 'today', text: '오늘은 진행 중이라 물량이 덜 찼을 수 있습니다.' });
    if (st.estimatedDays > 0) out.push({ code: 'estimated', n: st.estimatedDays, text: `출근 기록을 추정한 날 ${st.estimatedDays}일.` });
    if (st.stdHourDays > 0) out.push({ code: 'stdHours', n: st.stdHourDays, text: `퇴근 기록이 없어 표준 근무시간으로 센 날 ${st.stdHourDays}일.` });
    if (st.offRosterMinutes > 0) out.push({ code: 'offRoster', text: `명부 밖(시스템 계정 등) 업무 기록 ${r1(st.offRosterMinutes / 60)}시간 — 가동률에서 가용 = 기록으로 셉니다.` });
    let missingQtyDays = 0, capped = 0, noWageMinutes = 0;
    (days || []).forEach(d => {
        const recs = arr(d && d.workRecords);
        const q = (d && d.taskQuantities) || {};
        const missing = new Set();
        recs.forEach(r => {
            if (!r) return;
            const m = num(r.duration);
            if (m > CAP_MINUTES) capped++;
            if (r.task && qtySet.has(r.task) && m > 0 && !(num(q[r.task]) > 0)) missing.add(r.task);
            if (canCost && m > 0) {
                const name = r.member == null ? '' : String(r.member).trim();
                if (name && !(num(wages[name] != null ? wages[name] : wages[r.member]) > 0)) noWageMinutes += m;
            }
        });
        if (missing.size > 0) missingQtyDays++;
    });
    if (missingQtyDays > 0) out.push({ code: 'missingQty', n: missingQtyDays, text: `처리량 입력 업무에 시간만 있고 처리량이 없는 날 ${missingQtyDays}일 — 그 업무 속도가 낮게 나옵니다.` });
    if (capped > 0) out.push({ code: 'capped', n: capped, text: `12시간 넘는 업무 기록 ${capped}건('종료'를 안 누른 기록일 수 있음).` });
    if (canCost && noWageMinutes > 0) out.push({ code: 'noWage', text: `시급이 없는 사람의 기록 ${r1(noWageMinutes / 60)}시간 — 인건비 0 으로 셉니다.` });
    return out;
}

/**
 * 운영 리포트 화면 모델.
 * @param {object} p
 * @param {Array}  p.days          그 기간 하루 문서(지금 이름 사본)
 * @param {Array}  [p.prevDays]    전기(previousPeriodOf)
 * @param {Array}  [p.baselineDays] 평소 비교 기준(rollingBaselineOf .data)
 * @param {string} [p.baselineLabel] 평소 기준 설명(rollingBaselineOf .description)
 * @param {Array}  [p.allDays]     메모리 이력 전체 — 평상시 속도(오늘 제외·기간 끝까지)
 * @param {Array}  [p.ownerDays]   업무 담당 변화를 볼 이력(기본 allDays). false 면 계산하지 않음(owner = null)
 * @param {object} [p.cfg]         appConfig
 * @param {string} [p.today]       'YYYY-MM-DD' — 평상시 속도·담당 변화에서 뺀다
 * @param {boolean}[p.canCost]     금액을 볼 권한(data.reports). false 면 금액 칸 전부 null
 * @returns {OpsModel} 모양은 ops_model_contract.md
 */
export function buildOpsModel({
    days = [], prevDays = [], baselineDays = [], baselineLabel = '', allDays = [], ownerDays = null,
    cfg = {}, today = null, canCost = false
} = {}) {
    const list = Array.isArray(days) ? days : [];
    const L = OPS_VIEW_LEVELS;
    const speeds = baselineSpeeds(allDays, { skipDate: today, until: lastDayIdOf(list) });
    const sum = opsSummary(list, prevDays, allDays, cfg, { speeds, skipDate: today });
    const { cur, prev, wageMap } = sum;
    const base = periodMetrics(baselineDays || [], cfg, { speeds, wageMap });
    const hasPrev = prev.staffing.dayCount > 0;
    const hasBase = base.staffing.dayCount > 0;
    const hasBaseline = cur.staffing.hasBaseline;
    const empty = cur.staffing.dayCount === 0;
    const qtySet = qtyTaskSetOf(cfg);
    const { from, to } = rangeOf(list);

    const perDayQty = (m) => (m.staffing.dayCount > 0 ? m.totalQuantity / m.staffing.dayCount : null);
    const uph = (m) => uphOf(m.totalQuantity, m.totalActualWorkedMinutes);
    const unitCostOf = (m) => (m.unitCost && m.unitCost.isValid ? m.unitCost.costs.total : null);
    const oeeLevel = (v) => (v >= OEE_LEVELS.good ? 'good' : v >= OEE_LEVELS.warn ? 'warn' : 'bad');
    const P = (m, ok) => (ok ? m : null);

    // ── 인력 일자 ──
    const staffDays = cur.staffing.perDay.map(({ day, s }) => ({
        date: day.id,
        attended: s.attended.size,
        worked: s.workers.size,
        required: s.requiredFTE,
        gap: s.attended.size - s.requiredFTE,
        recordMinutes: s.recordMinutes,
        qty: Object.values(day.taskQuantities || {}).reduce((t, v) => t + num(v), 0),
        lossMinutes: s.lossMinutes,
        estimated: !!s.estimated,
        usedPresence: !!s.usedPresence
    })).sort((a, b) => (a.date < b.date ? -1 : 1));
    // 부족·여유는 처리량이 있고 필요 인원을 계산한 날만 — 처리량 입력 전인 날은 필요 인원이 '기록 시간' 으로만 잡혀 여유로 보인다
    const withReq = hasBaseline ? staffDays.filter(d => d.required > 0 && d.qty > 0) : [];
    const shortAll = withReq.filter(d => d.gap < -L.shortGap).sort((a, b) => a.gap - b.gap);
    const spareAll = withReq.filter(d => d.gap > L.spareGap).sort((a, b) => b.gap - a.gap);

    // ── 업무 표 · 손실 상위 ──
    const tasks = taskRows(cur, prev, speeds, qtySet, canCost);
    const lossTasks = tasks.filter(t => t.lossMinutes >= L.lossMinMinutes)
        .slice().sort((a, b) => b.lossMinutes - a.lossMinutes).slice(0, L.topN)
        .map(t => ({ task: t.task, lossMinutes: t.lossMinutes, uph: t.uph, stdUph: t.stdUph, efficiency: t.efficiency, lossCost: t.lossCost }));

    // ── 파트 표 ──
    const curParts = partSummary(list, cfg, PARTS);
    const prevParts = partSummary(prevDays || [], cfg, PARTS);
    const baseParts = partSummary(baselineDays || [], cfg, PARTS);
    const partRow = (id, name) => {
        const c = curParts[id], p = prevParts[id], b = baseParts[id];
        const u = uphOf(c.qty, c.duration), pu = uphOf(p.qty, p.duration), bu = uphOf(b.qty, b.duration);
        return {
            id, name, minutes: c.duration, qty: c.qty, members: c.members.size,
            uph: u, prevUph: pu, baseUph: bu, vsPrevUph: pct(u, pu), vsBaseUph: pct(u, bu)
        };
    };
    const parts = PARTS.map(id => partRow(id, taskNameOf(id, cfg))).concat([partRow('total', '전체')]);

    // ── 추세(운영일별) ──
    const trend = { ids: [], labels: [], qty: [], hours: [], uph: [], attended: [], required: [] };
    cur.staffing.perDay.slice().sort((a, b) => (a.day.id < b.day.id ? -1 : 1)).forEach(({ day, s }) => {
        const q = Object.values(day.taskQuantities || {}).reduce((t, v) => t + num(v), 0);
        trend.ids.push(day.id);
        trend.labels.push(String(day.id).slice(5));
        trend.qty.push(q);
        trend.hours.push(s.recordMinutes / 60);
        trend.uph.push(uphOf(q, s.recordMinutes));
        trend.attended.push(s.attended.size);
        trend.required.push(hasBaseline ? s.requiredFTE : null);
    });

    // ── 헤드라인 5 ──
    const headline = [
        headItem('qty', '처리량', '개', cur.totalQuantity, P(perDayQty(prev), hasPrev), P(perDayQty(base), hasBase), {
            perDay: perDayQty(cur), cmpBasis: 'perDay'
        }),
        headItem('uph', 'UPH', '개/시', uph(cur), P(uph(prev), hasPrev), P(uph(base), hasBase)),
        headItem('staff', '출근/필요', '명', cur.availableFTE, P(prev.availableFTE, hasPrev), P(base.availableFTE, hasBase), {
            better: null,
            required: hasBaseline ? cur.requiredFTE : null,
            gap: hasBaseline ? cur.availableFTE - cur.requiredFTE : null,
            prevRequired: hasPrev && hasBaseline ? prev.requiredFTE : null,
            baseRequired: hasBase && hasBaseline ? base.requiredFTE : null
        }),
        headItem('oee', 'OEE', '%', hasBaseline ? cur.oee : null, P(prev.oee, hasPrev && hasBaseline), P(base.oee, hasBase && hasBaseline), {
            deltaKind: 'pp', level: hasBaseline ? oeeLevel(cur.oee) : null
        }),
        canCost
            ? headItem('unitCost', '건당 원가', '원', unitCostOf(cur), P(unitCostOf(prev), hasPrev), P(unitCostOf(base), hasBase), { better: 'down' })
            : headItem('unitCost', '건당 원가', '원', null, null, null, { better: 'down', locked: true })
    ];
    // 처리량 비교는 하루 평균끼리(기간 길이가 달라도 맞게) — value 는 합계, perDay 가 비교 대상
    {
        const h = headline[0];
        h.vsPrev = pct(h.perDay, h.prev);
        h.vsBase = pct(h.perDay, h.base);
    }

    // ── 문제 있는 곳 ──
    let owner = null;
    if (ownerDays !== false) {
        owner = ownerChangeSummary(ownerDays || allDays, cfg, { today, from, to });
    }
    const problems = {
        lossTasks,
        shortDays: shortAll.slice(0, L.topN).map(d => ({ date: d.date, attended: d.attended, required: d.required, gap: d.gap })),
        spareDays: spareAll.slice(0, L.topN).map(d => ({ date: d.date, attended: d.attended, required: d.required, gap: d.gap })),
        shortDayCount: shortAll.length,
        spareDayCount: spareAll.length,
        ownerChangedTasks: owner ? owner.changedTasks : null,
        ownerInPeriodTasks: owner ? owner.inPeriodTasks : null
    };

    // ── 비용 ──
    const money = (v) => (canCost ? v : null);
    const uc = cur.unitCost;
    const costs = {
        locked: !canCost,
        unitCost: canCost && uc && uc.isValid ? {
            total: uc.costs.total, labor: uc.costs.labor, material: uc.costs.material,
            shipping: uc.costs.shipping, directDelivery: uc.costs.directDelivery, directDeliveryDays: uc.costs.directDeliveryCount
        } : null,
        unitCostPrev: money(hasPrev ? unitCostOf(prev) : null),
        laborPerItem: money(cur.laborCostPerItem),
        laborPerItemPrev: money(hasPrev ? prev.laborCostPerItem : null),
        totalLaborCost: money(cur.totalCost),
        revenue: money(cur.revenue),
        orders: cur.orders,
        loss: {
            availability: { minutes: cur.availabilityLossMinutes, cost: money(cur.availabilityLossCost) },
            performance: { minutes: cur.performanceLossMinutes, cost: money(cur.performanceLossCost) },
            quality: { minutes: cur.qualityLossMinutes, cost: money(cur.qualityLossCost) },
            total: {
                minutes: cur.availabilityLossMinutes + cur.performanceLossMinutes + cur.qualityLossMinutes,
                cost: money(cur.totalLossCost)
            },
            totalCostPrev: money(hasPrev ? prev.totalLossCost : null)
        }
    };
    costs.vsPrevUnitCost = canCost ? pct(costs.unitCost ? costs.unitCost.total : null, costs.unitCostPrev) : null;
    costs.vsPrevLaborPerItem = canCost ? pct(costs.laborPerItem, costs.laborPerItemPrev) : null;
    costs.loss.vsPrevTotalCost = canCost ? pct(costs.loss.total.cost, costs.loss.totalCostPrev) : null;

    // ── 생산성·인력 핵심 숫자(각 탭 머리) ──
    const productivity = {
        utilization: cur.utilizationRate, efficiency: hasBaseline ? cur.efficiencyRatio : null,
        quality: cur.qualityRatio, oee: hasBaseline ? cur.oee : null,
        prev: hasPrev ? { utilization: prev.utilizationRate, efficiency: hasBaseline ? prev.efficiencyRatio : null, quality: prev.qualityRatio, oee: hasBaseline ? prev.oee : null } : null,
        base: hasBase ? { utilization: base.utilizationRate, efficiency: hasBaseline ? base.efficiencyRatio : null, quality: base.qualityRatio, oee: hasBaseline ? base.oee : null } : null
    };
    const staffing = {
        attended: cur.availableFTE,
        worked: cur.workedFTE,
        workers: cur.staffing.avgWorked,
        required: hasBaseline ? cur.requiredFTE : null,
        requiredWork: hasBaseline ? cur.requiredWorkFTE : null,
        effective: hasBaseline ? cur.qualityFTE : null,
        gap: hasBaseline ? cur.availableFTE - cur.requiredFTE : null,
        utilizationSetting: cur.utilizationSetting,
        avgPresenceHours: cur.staffing.avgPresenceHours,
        rosterAvg: cur.rosterAvg
    };

    return {
        meta: {
            from, to, today,
            operatingDays: cur.staffing.dayCount, calendarDays: list.length,
            prevOperatingDays: prev.staffing.dayCount, baseOperatingDays: base.staffing.dayCount,
            baselineLabel: baselineLabel || '', hasPrev, hasBase, hasBaseline, canCost: !!canCost, empty
        },
        headline,
        diagnoses: diagnosesOf(cur, prev, hasPrev, hasBaseline, lossTasks, shortAll.length, spareAll.length, empty),
        problems,
        owner,
        trend,
        productivity,
        parts,
        tasks,
        staffing,
        staffDays,
        costs,
        extras: { avgWorkDays: avgWorkDaysOf(cur) },
        notes: notesOf({ cur, hasPrev, hasBase, hasBaseline, days: list, today, qtySet, canCost, wages: wageMap })
    };
}

/** 평균 근무일수 = 출근 연인원 ÷ 기간 안 출근한 고유 인원(그날 등록 알바는 뺀다 — 요약 화면 옛 정의와 같음). */
function avgWorkDaysOf(cur) {
    const seen = new Set();
    let personDays = 0;
    cur.staffing.perDay.forEach(({ day, s }) => {
        const pts = new Set(arr(day.partTimers).map(p => p && p.name).filter(Boolean));
        s.attended.forEach(n => { if (!pts.has(n)) { personDays++; seen.add(n); } });
    });
    return seen.size > 0 ? personDays / seen.size : 0;
}
