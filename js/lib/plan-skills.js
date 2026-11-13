// === js/lib/plan-skills.js ===
// 운영 계획 확장-1 — 사람: 숙련도 매트릭스 · 한 사람 의존(버스 팩터) · 교육 후보 · 출력용 가리기(redactForOutput).
//
// ⚠️ 이름 정책(2026-11-05 사용자 결정): 직원 이름은 **메모리에서만** 쓴다.
//   저장(Firestore·localStorage)·인쇄·PDF·콘솔·테스트 출력에는 이름 0 — 업무별 인원 수·등급별 인원 수만.
//   밖으로 나가는 모든 경로는 redactForOutput 하나를 지난다(tests/plan-skills.test.js 가 직렬화 결과에 가짜 이름이 없는지 본다).
//   화면의 이름 열은 data.reports 권한일 때만(화면 쪽 js/ui-ops-plan-people.js). "배치 참고용 — 인사평가 아님".
//
// 숙련도(최근 window=90일, 오늘 제외): 사람 × 업무 { hours, days, uph, soloDays, level }
//   · 기록 1건은 720분까지만(task-owner CAP_MINUTES — '종료' 안 누른 기록).
//   · uph = 단독일(그날 그 업무 시간의 80% 이상을 맡은 날) UPH, 단독일 3일 미만이면 null(task-owner SOLO_SHARE·MIN_SOLO_DAYS·uphOf).
//   · 등급: able(가능) = 시간 ≥ 8 · 일수 ≥ 3. skilled(숙련) = 가능 + (수량형: UPH ≥ 팀 중앙값 × 90% / 시간형: 가능한 사람 중 시간이 중앙값 이상).
//     exp(경험 있음) = 시간 > 0. 그 밖 none.
//   · 대상 업무: 최근 8주 안에 기록이 있는 업무(관리자 개별업무 등 exclude 제외). 퇴사자(퇴사일 다음 날부터)·시스템 계정 제외, 알바는 포함(partTimer 표시).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-skills.test.js

import { taskDays, taskListOf, uphOf, qtyDaysOf, SOLO_SHARE, MIN_SOLO_DAYS, addDays } from './task-owner.js?v=202611130931';
import { isMemberActiveOn } from '../utils.js?v=202611130931';

export const SKILL_LEVELS = Object.freeze({ ableHours: 8, ableDays: 3, skilledUphRatio: 0.9, windowDays: 90, recentWeeks: 8 });
export const LEVEL_RANK = Object.freeze({ skilled: 3, able: 2, exp: 1, none: 0 });
export const LEVEL_LABEL = Object.freeze({ skilled: '숙련', able: '가능', exp: '경험', none: '—' });
export const PEOPLE_NOTE = '배치 참고용 — 인사평가 아님';

const r1 = (v) => Math.round(v * 10) / 10;
const median = (arr) => {
    const a = arr.filter(v => v != null && isFinite(v)).slice().sort((x, y) => x - y);
    if (!a.length) return null;
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const sysSet = (cfg) => new Set((cfg && cfg.systemAccounts || []).map(s => String(typeof s === 'string' ? s : (s && s.name) || '').trim()).filter(Boolean));

/**
 * 숙련도 매트릭스.
 * @param {Array} allDays 지금 이름으로 합친 이력(aliasHistoryView 사본)
 * @param {object} cfg appConfig(퇴사일·시스템 계정)
 * @param {object} opts { window=90, today, recentWeeks=8, excludeTasks=[] }
 * @returns {{ from, to, tasks:[{task, isQty, medianUph, people:{이름:{hours, days, uph, soloDays, level}}}], people:[{name, partTimer}] }}
 *   ⚠️ 이름이 들어 있다 — 메모리에서만. 밖으로 낼 때는 redactForOutput.
 */
export function skillMatrix(allDays, cfg, { window = SKILL_LEVELS.windowDays, today, recentWeeks = SKILL_LEVELS.recentWeeks, excludeTasks = [] } = {}) {
    const L = SKILL_LEVELS;
    const from = addDays(today, -window), to = addDays(today, -1);
    const days = (allDays || []).filter(d => d && typeof d.id === 'string' && d.id >= from && d.id < today);
    const recentFrom = addDays(today, -7 * recentWeeks);
    const tasks = taskListOf(days.filter(d => d.id >= recentFrom), { exclude: excludeTasks });
    const sys = sysSet(cfg);
    const okPerson = (name) => !!name && !sys.has(name) && isMemberActiveOn(name, today, cfg || {});
    const pt = new Set();
    const everyone = new Set();
    const out = tasks.map(task => {
        const list = taskDays(days, task);
        const isQty = list.some(s => s.qty > 0);
        const people = {};
        list.forEach(s => {
            Object.entries(s.byMember).forEach(([name, min]) => {
                if (!okPerson(name)) return;
                const p = people[name] || (people[name] = { minutes: 0, days: 0 });
                p.minutes += min;
                p.days++;
                if (s.partTimers && s.partTimers.has(name)) pt.add(name);
                everyone.add(name);
            });
        });
        const qd = qtyDaysOf(list);
        Object.entries(people).forEach(([name, p]) => {
            const solo = qd.filter(s => (s.byMember[name] || 0) >= SOLO_SHARE * s.minutes);
            p.soloDays = solo.length;
            p.uph = isQty && solo.length >= MIN_SOLO_DAYS ? uphOf(solo, task) : null;
            p.hours = p.minutes / 60;
        });
        const medUph = isQty ? median(Object.values(people).map(p => p.uph)) : null;
        const ableHours = Object.values(people).filter(p => p.hours >= L.ableHours && p.days >= L.ableDays).map(p => p.hours);
        const medHours = median(ableHours);
        const P = {};
        Object.entries(people).forEach(([name, p]) => {
            const able = p.hours >= L.ableHours && p.days >= L.ableDays;
            let level = p.hours > 0 ? 'exp' : 'none';
            if (able) {
                const skilled = isQty
                    ? (p.uph != null && medUph != null && p.uph >= L.skilledUphRatio * medUph)
                    : (medHours != null && p.hours >= medHours);
                level = skilled ? 'skilled' : 'able';
            }
            P[name] = { hours: r1(p.hours), days: p.days, uph: p.uph != null ? r1(p.uph) : null, soloDays: p.soloDays, level };
        });
        return { task, isQty, medianUph: medUph != null ? r1(medUph) : null, people: P };
    });
    const people = [...everyone].sort().map(name => ({ name, partTimer: pt.has(name) }));
    return { from, to, tasks: out, people };
}

/** 업무별 등급 인원 수 [{task, skilled, able, exp}] — 이름 없음 */
export function levelCounts(matrix) {
    return ((matrix && matrix.tasks) || []).map(t => {
        const c = { task: t.task, skilled: 0, able: 0, exp: 0 };
        Object.values(t.people).forEach(p => { if (c[p.level] != null) c[p.level]++; });
        return c;
    });
}

/** 그 업무를 '가능' 이상으로 하는 사람(메모리 — 이름) */
const capableOf = (t) => Object.entries(t.people).filter(([, p]) => LEVEL_RANK[p.level] >= LEVEL_RANK.able).map(([n]) => n);

/**
 * 한 사람 의존 — '가능' 이상이 ≤ 1명인 업무. leaveDaysOf(이름) → 계획 기간 휴무 일수(근태 읽기만, UI 가 넘김).
 * @returns [{task, capable, who:[이름], leaveDays}] — who 는 메모리 전용(밖으로는 redactForOutput)
 */
export function busFactor(matrix, { leaveDaysOf = null, max = 1 } = {}) {
    return ((matrix && matrix.tasks) || []).map(t => {
        const who = capableOf(t);
        if (who.length > max) return null;
        const leaveDays = typeof leaveDaysOf === 'function' ? who.reduce((s, n) => s + (Number(leaveDaysOf(n)) || 0), 0) : 0;
        return { task: t.task, capable: who.length, who, leaveDays };
    }).filter(Boolean);
}

/**
 * 교육 후보 — 그 업무 경험 시간 > 0 이지만 '가능' 미만인 사람(시간 많은 순). 없으면 같은 파트 사람:
 *   그 업무를 '가능' 이상으로 하는 사람과 같은 팀 그룹(cfg.teamGroups)에 있고 그 업무 경험이 없는 사람(다른 업무 시간 많은 순).
 * @returns [{name, hours, source:'exp'|'part'}] — 이름은 메모리 전용
 */
export function trainCandidates(matrix, task, { cfg = null, limit = 5 } = {}) {
    const t = ((matrix && matrix.tasks) || []).find(x => x.task === task);
    if (!t) return [];
    const exp = Object.entries(t.people).filter(([, p]) => p.level === 'exp')
        .sort((a, b) => b[1].hours - a[1].hours || (a[0] < b[0] ? -1 : 1))
        .map(([name, p]) => ({ name, hours: p.hours, source: 'exp' }));
    if (exp.length) return exp.slice(0, limit);
    const capable = new Set(capableOf(t));
    const groups = ((cfg && cfg.teamGroups) || []).filter(g => (g.members || []).some(m => capable.has(m)));
    const mates = new Set(groups.flatMap(g => g.members || []).filter(m => m && !capable.has(m) && !t.people[m]));
    const known = new Set(((matrix && matrix.people) || []).map(p => p.name));
    const total = (name) => matrix.tasks.reduce((s, x) => s + ((x.people[name] && x.people[name].hours) || 0), 0);
    return [...mates].filter(n => known.has(n)).map(name => ({ name, hours: 0, source: 'part', other: total(name) }))
        .sort((a, b) => b.other - a.other || (a.name < b.name ? -1 : 1)).slice(0, limit)
        .map(({ name, hours, source }) => ({ name, hours, source }));
}

/**
 * ⚠️ 밖으로 나가는 유일한 길 — 사람 섹션 모델에서 이름을 모두 빼고 수만 남긴다(저장·인쇄·과제·리스크 입력).
 * section = { levels?, bus?[{task, capable, who, leaveDays, candidates?}], assign?{date, byTask, counts, unmet, idle?} , matrix? }
 * @returns { levels:[{task, skilled, able, exp}], bus:[{task, capable, leaveDays, candidateCount}], assign:{date, counts, unmet, idleHours}|null }
 */
export function redactForOutput(section) {
    const s = section || {};
    const levels = (s.levels || (s.matrix ? levelCounts(s.matrix) : [])).map(l => ({
        task: String(l.task), skilled: l.skilled | 0, able: l.able | 0, exp: l.exp | 0
    }));
    const bus = (s.bus || []).map(b => ({
        task: String(b.task), capable: b.capable | 0, leaveDays: b.leaveDays | 0,
        candidateCount: Array.isArray(b.candidates) ? b.candidates.length : (b.candidateCount | 0)
    }));
    const a = s.assign;
    const assign = a ? {
        date: a.date || null,
        counts: Object.fromEntries(Object.entries(a.counts || {}).map(([k, v]) => [String(k), { n: (v && v.n) | 0, h: r1(Number(v && v.h) || 0) }])),
        unmet: Object.fromEntries(Object.entries(a.unmet || {}).map(([k, v]) => [String(k), r1(Number(v) || 0)])),
        idleHours: r1(Number(a.idleHours) || 0)
    } : null;
    return { levels, bus, assign };
}

/** 인쇄 직전 안전장치 — text 안에 이름(2글자 이상)이 하나라도 있으면 true.
 *  ignore(업무명·고정 문구)는 먼저 지운다(긴 것부터) — 업무명에 이름과 같은 글자가 들어 있어 인쇄가 막히는 오탐을 줄인다. */
export function namesLeak(text, names, { ignore = [] } = {}) {
    let t = String(text || '');
    [...(ignore || [])].filter(Boolean).map(String).sort((a, b) => b.length - a.length).forEach(w => { t = t.split(w).join(' '); });
    return (names || []).some(n => n && String(n).length >= 2 && t.includes(String(n)));
}
