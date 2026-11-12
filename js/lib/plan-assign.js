// === js/lib/plan-assign.js ===
// 운영 계획 확장-1 — 하루 배치 초안(탐욕). 그날 할 수 있는 사람이 적은 업무부터(가능 이상 인원 → 경험 이상 인원 → 필요 인시 큰 순) —
//   한 사람만 할 수 있는 작은 업무가 큰 업무에 사람을 뺏겨 비지 않게. 업무 안에서는 숙련도가 높은 사람(숙련 > 가능 > 경험, 같으면 그 업무 시간 많은 순)을
//   1인 가용 시간이 다 찰 때까지 붙인다. 경험이 없는 사람은 붙이지 않는다 — 못 채운 시간은 unmet(미충족)으로 보고.
// ⚠️ 이름은 메모리에서만(byTask). 저장·인쇄는 counts·unmet 만 — js/lib/plan-skills.js redactForOutput 을 지난다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-skills.test.js

import { LEVEL_RANK } from './plan-skills.js?v=202611121504';

const r1 = (v) => Math.round(v * 10) / 10;

/**
 * @param {object} dayDemand { 업무: 사람 시간(인시) } — 주간 계획서 taskHours(업무 예상과 같은 단위)
 * @param {object} matrix    plan-skills skillMatrix 결과
 * @param {Array}  available 그날 출근 가능한 사람 이름(휴무 뺀 재직자 — 메모리)
 * @param {object} opts      { hoursPerPerson = 8 }
 * @returns {{ byTask:{업무:[이름]}, counts:{업무:{n, h}}, unmet:{업무:인시}, idleHours, idleCount }}
 */
export function draftAssignment(dayDemand, matrix, available, { hoursPerPerson = 8 } = {}) {
    const hpp = Number(hoursPerPerson) > 0 ? Number(hoursPerPerson) : 8;
    const left = new Map((available || []).filter(Boolean).map(n => [n, hpp]));
    const byTask = {}, counts = {}, unmet = {};
    const skillOf = new Map(((matrix && matrix.tasks) || []).map(t => [t.task, t.people]));
    const avail = [...left.keys()];
    const countOf = (task, min) => { const ppl = skillOf.get(task) || {}; return avail.filter(n => ppl[n] && LEVEL_RANK[ppl[n].level] >= min).length; };
    const order = Object.entries(dayDemand || {}).filter(([, h]) => Number(h) > 0)
        .map(([task, h]) => ({ task, h: Number(h), capable: countOf(task, LEVEL_RANK.able), any: countOf(task, LEVEL_RANK.exp) }))
        .sort((a, b) => a.capable - b.capable || a.any - b.any || b.h - a.h || (a.task < b.task ? -1 : 1))
        .map(x => [x.task, x.h]);
    order.forEach(([task, h0]) => {
        let need = Number(h0);
        const ppl = skillOf.get(task) || {};
        const cands = [...left.keys()].filter(n => ppl[n] && LEVEL_RANK[ppl[n].level] >= LEVEL_RANK.exp)
            .sort((a, b) => LEVEL_RANK[ppl[b].level] - LEVEL_RANK[ppl[a].level] || ppl[b].hours - ppl[a].hours || (a < b ? -1 : 1));
        const got = [];
        let used = 0;
        for (const n of cands) {
            if (need <= 1e-9) break;
            const cap = left.get(n);
            if (!(cap > 1e-9)) continue;
            const take = Math.min(cap, need);
            left.set(n, cap - take);
            need -= take;
            used += take;
            got.push(n);
        }
        byTask[task] = got;
        counts[task] = { n: got.length, h: r1(used) };
        if (need > 1e-9) unmet[task] = r1(need);
    });
    let idleHours = 0, idleCount = 0;
    left.forEach(v => { idleHours += v; if (v >= hpp - 1e-9) idleCount++; });
    return { byTask, counts, unmet, idleHours: r1(idleHours), idleCount };
}

/** 여러 날 배치 → 업무별 합계 { 업무: {n: 인일, h: 인시} } (확정본 assignCounts — 이름 없음) */
export function sumAssignCounts(drafts) {
    const out = {};
    (drafts || []).forEach(d => Object.entries((d && d.counts) || {}).forEach(([task, c]) => {
        const o = out[task] || (out[task] = { n: 0, h: 0 });
        o.n += (c && c.n) | 0;
        o.h = r1(o.h + (Number(c && c.h) || 0));
    }));
    return out;
}
