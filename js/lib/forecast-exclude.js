// === js/lib/forecast-exclude.js ===
// 업무 예상에서 '계산 제외'로 둔 업무·관리자 인원 처리 (순수 함수 · DOM·Firebase 미의존)
//
// 설정 forecastExcludedTasks(업무)는 예상 계산에는 넣지 않지만
// 화면에서 지우지는 않는다 — 실제로 쓴 시간·참고값은 '계산 제외' 표시로 따로 보여 준다.
// 계산에서 빼는 쪽(스냅샷·실적 지우기)은 forecast-accuracy.js excludeTasksForAccuracy.
// '관리자 개별업무'는 시간 대신 인원만 정한다(계획 화면, 날짜별 plannedAdminWorkers) — 그만큼 가용 인원에서 뺀다.

import { TASK } from './task-ids.js?v=202610301817';

const 이름 = (v) => String(v == null ? '' : v).trim();

/** 관리자 개별업무의 업무 id — 지금 이름은 부르는 쪽이 taskNameOf(ADMIN_TASK_ID, cfg) 로 얻는다(업무 id 2단계) */
export const ADMIN_TASK_ID = TASK.admin;
export const DEFAULT_ADMIN_WORKERS = 1;

/** 관리자 인원 입력값 → 정수 0~20. 비었거나 잘못되면 null */
export function normalizeAdminWorkers(v) {
    if (v == null || (typeof v === 'string' && v.trim() === '')) return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 20) return null;
    return n;
}

/**
 * 가용 인원에서 관리자 인원 n 명을 뺀다.
 * excludedCount 는 실제로 뺀 인원 — 가용보다 많이 적어도 가용까지만 센다.
 *
 * @param {number} available 그날 출근 인원(휴무 뺀 것)
 * @param {number} n 관리자 인원
 * @returns {{ available: number, excludedCount: number }}
 */
export function applyAdminWorkers(available, n) {
    const a = Math.max(0, Number(available) || 0);
    const k = Math.max(0, Number(n) || 0);
    return { available: Math.max(0, a - k), excludedCount: Math.min(k, a) };
}

/**
 * 오늘 진행 — 제외 업무의 '계산 제외' 줄. 진행률·계획 합계에는 넣지 않고 목록 맨 아래에만 붙인다.
 *
 * @param {{byTask: Map}} progress computeDayProgress 결과(제외 업무가 들어 있는 전체 기록으로 만든 것)
 * @param {Set<string>} excluded 제외 업무(지금 이름)
 * @param {(name:string)=>string} canon 기록 업무명 → 지금 이름(별칭). 없으면 그대로
 * @returns 줄 배열 — buildProgressRows 줄과 같은 모양 + excluded:true, 쓴 시간 큰 순
 */
export function buildExcludedProgressRows(progress, excluded, canon = (k) => k) {
    if (!excluded || excluded.size === 0 || !progress || !progress.byTask) return [];
    const by = new Map();
    progress.byTask.forEach((e, name) => {
        const key = canon(name);
        if (!excluded.has(key)) return;
        const r = by.get(key) || { spentMin: 0, working: 0, paused: 0, done: 0, members: new Set() };
        r.spentMin += Number(e.spentMin) || 0;
        r.working += e.working || 0; r.paused += e.paused || 0; r.done += e.done || 0;
        (e.members || []).forEach(m => r.members.add(m));
        by.set(key, r);
    });
    return [...by.entries()]
        .map(([key, r]) => ({
            key, label: key, kind: 'time', planHours: 0,
            spentHours: r.spentMin / 60, working: r.working, paused: r.paused, done: r.done,
            status: r.working > 0 ? 'working' : (r.paused > 0 ? 'paused' : 'ended'),
            extra: false, noBaseline: false, excluded: true, members: [...r.members]
        }))
        .filter(r => r.spentHours > 0 || r.working > 0 || r.paused > 0)
        .sort((a, b) => b.spentHours - a.spentHours);
}

/**
 * 정확도 — 제외 업무에 실제로 쓴 시간(인시)을 업무별로 모은다. 요약·합계·오차에는 넣지 않는 참고 줄.
 *
 * @param {Array} days 비교한 날의 하루치 문서({ workRecords[] }, 업무명은 지금 이름)
 * @param {Iterable<string>} names 제외 업무
 * @returns {Array<{key, hours, days}>} 실제 시간 큰 순, 시간 0 인 업무는 뺀다
 */
export function excludedActualByTask(days, names) {
    const drop = new Set([...(names || [])].map(이름).filter(Boolean));
    if (drop.size === 0) return [];
    const agg = new Map();
    (Array.isArray(days) ? days : []).forEach(d => {
        const seen = new Set();
        (d?.workRecords || []).forEach(r => {
            const k = 이름(r?.task);
            if (!drop.has(k)) return;
            const m = Number(r?.duration);
            if (!(Number.isFinite(m) && m > 0)) return;
            const e = agg.get(k) || { key: k, hours: 0, days: 0 };
            e.hours += m / 60;
            if (!seen.has(k)) { e.days++; seen.add(k); }
            agg.set(k, e);
        });
    });
    return [...agg.values()].filter(e => e.hours > 0).sort((a, b) => b.hours - a.hours);
}
