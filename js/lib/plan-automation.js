// === js/lib/plan-automation.js ===
// 운영 계획 v2 D3 — 자동화 로드맵(순위·절감·분기 배치). 카탈로그는 plan-auto-catalog.js.
//   입력: 월 요약(OpsMonthly schema 1 — js/lib/plan-monthly.js monthlySummaryOf 모양) 배열 — 쓰는 칸은 ym, tasks{taskId:{q,min,days}} 뿐.
//   월 기록 시간 = 최근 recent(3)개월(tasks 가 있는 끝난 달) 평균, 그 달에 없는 업무는 0분.
//   절감(분/월) = 월 기록 시간 × saveRate × (1 − covered)
//   점수 = 절감 ÷ 난이도 × (선행 모두 충족 1 / 아니면 0.5)
//   분기 배치: 점수 큰 순 분기당 perQuarter(2)개. 절감 0(기록 없음)은 배치하지 않는다(quarter null).
//   itemDraft = OpsPlanItems kind 'auto' 초안 { kind, title≤80, role, year, quarter, due, kpi{metric, task, from, target}, src }.
//   문장은 '제안' 말투, 업무명·시간만(금액·직원 이름·거래처 실명 없음).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-automation.test.js

import { AUTO_CATALOG } from './plan-auto-catalog.js?v=202611131345';
import { taskNameOf } from './task-ids.js?v=202611131345';

export const AUTO_LEVELS = Object.freeze({ recent: 3, perQuarter: 2, quarters: 4, unmetFactor: 0.5, titleMax: 80 });

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const pad = (n) => String(n).padStart(2, '0');

/** 분기 목록 — from(YYYY-MM-DD 또는 YYYY-MM)이 속한 분기부터 n개 [{key:'YYYY-Qn', label, year, start, end}] */
export function quarterList(from, n = AUTO_LEVELS.quarters) {
    const y0 = Number(String(from).slice(0, 4)), q0 = Math.floor((Number(String(from).slice(5, 7)) - 1) / 3);
    return Array.from({ length: n }, (_, i) => {
        const q = (q0 + i) % 4, y = y0 + Math.floor((q0 + i) / 4);
        const sm = q * 3 + 1, em = sm + 2;
        return {
            key: `${y}-Q${q + 1}`, label: `${y} ${q + 1}분기`, year: y,
            start: `${y}-${pad(sm)}-01`, end: `${y}-${pad(em)}-${pad(new Date(y, em, 0).getDate())}`
        };
    });
}

/** 최근 끝난 달 n개(tasks 칸이 있는 것, ym 순) */
export function recentMonths(months, n = AUTO_LEVELS.recent) {
    return (months || []).filter(m => m && /^\d{4}-\d{2}$/.test(String(m.ym)) && isObj(m.tasks))
        .slice().sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0)).slice(-n);
}

/** 업무 id → 월 평균 기록 시간(분) — 최근 n개월 평균(없는 달 0분) */
export function monthlyTaskMinutes(months, n = AUTO_LEVELS.recent) {
    const list = recentMonths(months, n);
    const out = {};
    if (!list.length) return out;
    list.forEach(m => Object.entries(m.tasks).forEach(([id, t]) => { out[id] = (out[id] || 0) + num(t && t.min); }));
    Object.keys(out).forEach(id => { out[id] = r1(out[id] / list.length); });
    return out;
}

const hours = (min) => r1(min / 60);
const clip = (s, max) => (s.length <= max ? s : s.slice(0, max - 1) + '…');

/**
 * 자동화 로드맵.
 * @param {object[]} months OpsMonthly 문서 배열(끝난 달)
 * @param {object} opts { from(계획 시작일 YYYY-MM-DD — 없으면 마지막 달 다음 달 1일), quarters, perQuarter, recent,
 *                        prereqMet {prereqKey: bool}, cfg(taskIdNames·taskAliases — 업무 이름 표시), catalog }
 * @returns {{ quarters, months:number, items:object[] }}
 */
export function buildAutomationRoadmap(months, opts = {}) {
    const L = AUTO_LEVELS;
    const recent = opts.recent || L.recent;
    const used = recentMonths(months, recent);
    const from = opts.from || nextMonthStart(used.length ? used[used.length - 1].ym : null);
    const qs = from ? quarterList(from, opts.quarters || L.quarters) : [];
    const per = opts.perQuarter || L.perQuarter;
    const met = isObj(opts.prereqMet) ? opts.prereqMet : {};
    const mins = monthlyTaskMinutes(used, recent);
    const nameOf = (id) => taskNameOf(id, opts.cfg) || id;

    const items = (opts.catalog || AUTO_CATALOG).map(c => {
        const monthlyMin = r1(c.tasks.reduce((s, id) => s + num(mins[id]), 0));
        const saveMin = r1(monthlyMin * num(c.saveRate) * (1 - Math.min(1, Math.max(0, num(c.covered)))));
        const prereq = (c.prereq || []).map(p => ({ key: p.key, text: p.text, met: Object.prototype.hasOwnProperty.call(met, p.key) ? !!met[p.key] : !!p.met }));
        const prereqMet = prereq.every(p => p.met);
        const score = r1(saveMin / Math.max(1, num(c.difficulty) || 1) * (prereqMet ? 1 : L.unmetFactor));
        return {
            key: c.key, title: c.title, tasks: c.tasks.slice(), existing: c.existing || null,
            monthlyMin, saveMin, difficulty: c.difficulty, prereq, prereqMet, score,
            quarter: null, status: c.status, role: c.role || 'admin'
        };
    });

    items.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1));
    let slot = 0;
    items.forEach(it => {
        if (it.saveMin <= 0) return;
        const q = qs[Math.floor(slot / per)];
        slot++;
        if (q) { it.quarter = q.key; it.quarterLabel = q.label; it.due = q.end; it.year = q.year; }
    });

    items.forEach(it => {
        const names = it.tasks.map(nameOf).join('·');
        const unmet = it.prereq.filter(p => !p.met).map(p => p.text);
        it.note = it.monthlyMin > 0
            ? `${names} 업무 기록이 월 약 ${hours(it.monthlyMin)}시간입니다. '${it.title}'로 월 약 ${hours(it.saveMin)}시간을 줄이는 것을 제안합니다.`
                + (unmet.length ? ` 먼저 확인할 것: ${unmet.join(', ')}.` : '')
            : `${names} 업무 기록이 아직 없어 절감을 어림하지 못합니다. 기록이 쌓인 뒤 다시 보는 것을 제안합니다.`;
        it.itemDraft = {
            kind: 'auto',
            title: clip(`${it.title} 추진 제안`, L.titleMax),
            role: it.role,
            year: it.year != null ? it.year : null,
            quarter: it.quarter,
            due: it.due || null,
            kpi: { metric: 'taskMinutesPerMonth', task: it.tasks[0], from: it.monthlyMin, target: r1(Math.max(0, it.monthlyMin - it.saveMin)) },
            src: { rule: 'automation', catalogKey: it.key }
        };
    });
    return { quarters: qs, months: used.length, items };
}

function nextMonthStart(ym) {
    if (!ym) return null;
    const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7));
    return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}
