// === js/lib/plan-monthly.js ===
// 운영 계획 v2 D1 — 월 요약(OpsMonthly/{YYYY-MM}) 만들기·다시 만들기 판정. 13개월 넘는 비교(전년 같은 달·2년 성장)를 원본 없이 하기 위해.
//   모양은 scratchpad opsmonthly_contract.md 와 firestore.rules OpsMonthly 블록이 기준이다(칸을 바꾸면 SCHEMA 를 올리고 둘 다 고칠 것).
//   ⚠️ 금액·직원 이름 없음 — 매출·인건비·재고금액은 넣지 않는다(주문 '건수'만), 사람은 수·시간으로만. 업무는 업무 id(task-ids) 키.
//   손실(분)·기록 품질은 운영 리포트와 같은 계산(ops-metrics periodMetrics·staffing, ops-view-model notes 와 같은 조건).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-monthly.test.js

import { periodMetrics } from './ops-metrics.js?v=202611100845';
import { systemIdOfName, taskIdOf } from './task-ids.js?v=202611100845';
import { attendedMembers } from '../attendance-stats.js?v=202611100845';
import { orderCountTotalOf } from '../revenue-channels.js?v=202611100845';
import { offDayOf } from './plan-week.js?v=202611100845';
import { CAP_MINUTES } from './task-owner.js?v=202611100845';
import { isOffLeaveType } from '../state.js?v=202611100845';

// schema 2(2026-11-05 리뷰): srcTo = 기록 있는 실제 마지막 날 · 휴무 = 기간형 근태 사람·일(당일형 제외, 근태 일정 펼침은 직접) · UPH 분자·분모 같은 기준 · qtyDays 추가
// schema 3(D2): 휴무에서 '일하는 근태'(재택·출장·외근·매장근무 — state.js WORKING_LEAVE_TYPES) 제외 · incoming·plannedDays 연결
// schema 4(D2 리뷰): incoming 은 그 달 전체 원본이 생길 때까지 null 고정(위젯 캐시는 최근·앞으로만이라 과소 집계)
export const MONTHLY_SCHEMA = 4;
/** 달이 끝난 뒤 며칠 동안은 지난달 요약을 열 때마다 다시 만든다(늦게 들어온 기록 반영 — 바뀐 값이 있을 때만 쓴다) */
export const MONTHLY_REFRESH_DAYS = 7;
export const MONTHLY_TASK_LIMIT = 60;
/** 저장 칸(규칙 hasOnly 와 같은 목록) */
export const MONTHLY_KEYS = Object.freeze(['v', 'schema', 'ym', 'calDays', 'workdays', 'opDays', 'qtyDays', 'qty', 'workMin', 'procMin', 'uph', 'headAvg',
    'leaveDays', 'partDays', 'partHours', 'orderCount', 'loss', 'notes', 'tasks', 'incoming', 'srcDocs', 'srcTo', 'builtAt', 'builtBy']);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const arr = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
const qtyOf = (d) => Object.values((d && d.taskQuantities) || {}).reduce((t, v) => t + (num(v) > 0 ? num(v) : 0), 0);
const isOp = (d) => !!d && (arr(d.workRecords).length > 0 || qtyOf(d) > 0);

/** 'YYYY-MM' 의 달력 날짜 목록 */
export function monthDates(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return Array.from({ length: last }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}
/** 'YYYY-MM' n 달 이동 */
export function shiftYm(ym, n) {
    const [y, m] = String(ym).split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
/** 오늘 기준 끝난 달 n 개(오래된 것부터) — 이번 달은 넣지 않는다(진행 중). 날짜 모양이 틀리면 [] */
export function finishedMonths(today, n = 13) {
    const m = /^(\d{4}-\d{2})/.exec(String(today || ''));
    if (!m) return [];
    return Array.from({ length: n }, (_, i) => shiftYm(m[1], -(n - i)));
}

/** 업무 이름(지금 이름) → 업무 id. 시스템 업무는 고정 id, 그 밖은 설정 taskIdNames. 없으면 '' */
export const taskKeyOf = (name, cfg) => systemIdOfName(name, cfg) || taskIdOf(name, cfg && cfg.taskIdNames) || '';

/**
 * 월 요약 한 벌(builtAt·builtBy 는 저장하는 쪽이 붙인다).
 * @param {Array}  days  그 달 하루 문서(지금 이름 사본 — aliasHistoryView). 다른 달 문서가 섞여도 ym 으로 거른다
 * @param {object} cfg   appConfig(업무 id·처리량 업무·품질 업무·시스템 계정·명부)
 * @param {object} opts  { ym, speeds(평상시 속도 — 성과 손실), holidayNameOf, plannedDays(예정 물량을 넣은 날 수 — 모르면 null), incoming({boxes,qty,days} — 모르면 null),
 *                        scheduleLeave(근태 일정 기간 기록 [{member,type,startDate,endDate}] — 읽기만, 두 경로가 같은 기준으로 펼친다) }
 *   휴무(leaveDays) = 그날 휴무 근태(state.js isOffLeaveType — 당일형·일하는 근태 제외)인 사람 수의 합(한 사람 하루 1번).
 *     하루 문서의 onLeaveMembers 중 근태 일정에서 펼친 사본(__fromSchedule)은 빼고, scheduleLeave 를 여기서 직접 펼친다
 *     — 메모리(펼친 사본이 섞임)로 만들든 원본(사본 없음)으로 만들든 같은 값이 나오게.
 */
export function monthlySummaryOf(days, cfg, { ym, speeds = null, holidayNameOf = null, plannedDays = null, incoming = null, scheduleLeave = [] } = {}) {
    const c = cfg || {};
    const list = (days || []).filter(d => d && typeof d.id === 'string' && d.id.startsWith(ym + '-'));
    const ops = list.filter(isOp);
    const dates = monthDates(ym);
    const workdays = dates.filter(id => { const o = offDayOf(id, holidayNameOf); return !o.weekend && !o.holiday; }).length;
    const qtySet = new Set(c.quantityTaskTypes || []);
    let qty = 0, qtyProc = 0, workMin = 0, procMin = 0, heads = 0, leaveDays = 0, partDays = 0, partMin = 0, orderCount = 0, qtyDays = 0;
    let missingQty = 0, capped = 0, unlinkedMin = 0;
    const tasks = {};
    ops.forEach(d => {
        const q = d.taskQuantities || {};
        qty += qtyOf(d);
        if (qtyOf(d) > 0) qtyDays++;
        // UPH 는 그날 처리량·시간이 둘 다 있는 업무만(plan-year quarterUph 와 같은 기준)
        const withMin = new Set(arr(d.workRecords).filter(r => r && r.task && num(r.duration) > 0).map(r => r.task));
        Object.entries(q).forEach(([name, v]) => { if (num(v) > 0 && withMin.has(name)) qtyProc += num(v); });
        heads += attendedMembers(d, c).size;
        const pts = new Set(arr(d.partTimers).map(p => p && p.name).filter(Boolean));
        partDays += pts.size;
        orderCount += num(orderCountTotalOf(d.management || {}));
        const seenTask = new Set();
        let missing = false;
        arr(d.workRecords).forEach(r => {
            if (!r) return;
            const raw = num(r.duration);
            if (raw <= 0) return;
            if (raw > CAP_MINUTES) capped++;
            const m = Math.min(raw, CAP_MINUTES);
            workMin += m;
            if (r.task && num(q[r.task]) > 0) procMin += m;
            if (r.task && qtySet.has(r.task) && !(num(q[r.task]) > 0)) missing = true;
            if (pts.has(r.member)) partMin += m;
            const id = r.task ? taskKeyOf(r.task, c) : '';
            if (!id) { unlinkedMin += m; return; }
            const t = tasks[id] || (tasks[id] = { q: 0, min: 0, days: 0 });
            t.min += m;
            if (!seenTask.has(id)) { seenTask.add(id); t.days++; }
        });
        Object.entries(q).forEach(([name, v]) => {
            if (!(num(v) > 0)) return;
            const id = taskKeyOf(name, c);
            if (!id) return;
            const t = tasks[id] || (tasks[id] = { q: 0, min: 0, days: 0 });
            t.q += num(v);
            if (!seenTask.has(id)) { seenTask.add(id); t.days++; }
        });
        if (missing) missingQty++;
    });
    // 휴무 — 사람 단위(하루 1번), 기간형 근태만. 펼친 사본은 빼고 근태 일정을 같은 기준으로 펼친다.
    const sched = arr(scheduleLeave).filter(e => e && e.member && e.startDate && isOffLeaveType(e.type));
    dates.forEach(id => {
        const who = new Set();
        const d = list.find(x => x.id === id);
        if (d) arr(d.onLeaveMembers).forEach(e => { if (e && e.member && !e.__fromSchedule && isOffLeaveType(e.type)) who.add(e.member); });
        sched.forEach(e => { if (id >= e.startDate && id <= (e.endDate || e.startDate)) who.add(e.member); });
        leaveDays += who.size;
    });
    const pm = ops.length ? periodMetrics(ops, c, { speeds }) : null;
    const st = pm ? pm.staffing : null;
    // 업무가 많으면 시간 큰 순 60 개까지(나머지는 unlinked 처럼 합계에만)
    const keep = Object.entries(tasks).sort((a, b) => b[1].min - a[1].min || (a[0] < b[0] ? -1 : 1));
    keep.slice(MONTHLY_TASK_LIMIT).forEach(([, t]) => { unlinkedMin += t.min; });
    const T = Object.fromEntries(keep.slice(0, MONTHLY_TASK_LIMIT).map(([id, t]) => [id, { q: Math.round(t.q), min: Math.round(t.min), days: t.days }]));
    return {
        v: 1, schema: MONTHLY_SCHEMA, ym,
        calDays: dates.length, workdays, opDays: ops.length, qtyDays,
        qty: Math.round(qty), workMin: Math.round(workMin), procMin: Math.round(procMin),
        uph: procMin > 0 && qtyProc > 0 ? r1(qtyProc / (procMin / 60)) : null,
        headAvg: ops.length ? r1(heads / ops.length) : null,
        leaveDays, partDays, partHours: r1(partMin / 60), orderCount: Math.round(orderCount),
        loss: pm ? { avail: Math.round(pm.availabilityLossMinutes), perf: Math.round(pm.performanceLossMinutes), quality: Math.round(pm.qualityLossMinutes) } : { avail: 0, perf: 0, quality: 0 },
        notes: {
            missingQty, stdHours: st ? st.stdHourDays : 0, estimated: st ? st.estimatedDays : 0, capped,
            offRoster: st ? Math.round(st.offRosterMinutes) : 0, unlinkedMin: Math.round(unlinkedMin),
            plannedDays: plannedDays == null ? null : Math.max(0, Math.round(num(plannedDays)))
        },
        tasks: T,
        incoming: incoming ? { boxes: Math.round(num(incoming.boxes)), qty: Math.round(num(incoming.qty)), days: Math.round(num(incoming.days)) } : null,
        srcDocs: ops.length,   // 기록(업무·처리량)이 있는 하루 문서 수
        srcTo: ops.length ? ops.map(d => d.id).sort().slice(-1)[0] : null   // 기록이 있는 실제 마지막 날
    };
}

/**
 * 다시 만들어야 하나 — 이번 달·미래는 만들지 않는다(진행 중). 없음·옛 schema 면 true.
 *   달이 끝난 뒤 MONTHLY_REFRESH_DAYS(7)일 동안은 늘 true(늦게 들어온 기록 반영) — 쓰는 쪽(ops-monthly-store)이 값이 같으면 쓰지 않는다.
 */
export function needRebuild(doc, { ym, today, schema = MONTHLY_SCHEMA } = {}) {
    if (!ym || !today || ym >= String(today).slice(0, 7)) return false;
    if (!doc) return true;
    if (!(num(doc.schema) >= schema)) return true;
    const last = monthDates(ym).slice(-1)[0];
    const d = new Date(`${last}T00:00:00`);
    d.setDate(d.getDate() + MONTHLY_REFRESH_DAYS);
    const until = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return String(today) <= until;
}

/** 저장된 요약과 새 요약이 같은가(builtAt·builtBy 빼고) — 같으면 쓰지 않는다 */
export function sameSummary(a, b) {
    if (!a || !b) return false;
    const strip = (o) => { const x = { ...o }; delete x.builtAt; delete x.builtBy; return x; };
    const canon = (v) => (v && typeof v === 'object' && !Array.isArray(v)
        ? Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {}) : v);
    return JSON.stringify(canon(strip(a))) === JSON.stringify(canon(strip(b)));
}
