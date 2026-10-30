// === js/lib/forecast-exclude.js ===
// 업무 예상에서 '계산 제외'로 둔 업무·사람 처리 (순수 함수 · DOM·Firebase 미의존)
//
// 설정 forecastExcludedTasks(업무)·forecastExcludedMembers(사람)은 예상 계산에는 넣지 않지만
// 화면에서 지우지는 않는다 — 실제로 쓴 시간·참고값은 '계산 제외' 표시로 따로 보여 준다.
// 계산에서 빼는 쪽(스냅샷·실적 지우기)은 forecast-accuracy.js excludeTasksForAccuracy.

const 이름 = (v) => String(v == null ? '' : v).trim();

/**
 * 가용 인원에서 제외할 사람을 뺀다.
 * excludedCount 는 **재직 중이고 그날 휴무가 아닌** 제외 인원만 센다 —
 * 휴무인 관리자를 '투입 검토' 대상으로 안내하면 안 되므로.
 *
 * @param {Set<string>} allStaff 그날 재직 인원(원본은 바꾸지 않는다)
 * @param {Iterable<string>} excludedNames 설정 forecastExcludedMembers
 * @param {{has(name):boolean}} onLeave 그날 휴무 명단(Map·Set)
 * @returns {{ staff: Set<string>, excludedCount: number }}
 */
export function splitForecastExcludedStaff(allStaff, excludedNames, onLeave) {
    const staff = new Set(allStaff || []);
    const excl = new Set();
    [...(excludedNames || [])].map(이름).filter(Boolean).forEach(m => {
        if (staff.delete(m)) excl.add(m);
    });
    let excludedCount = 0;
    excl.forEach(m => { if (!(onLeave && onLeave.has(m))) excludedCount++; });
    return { staff, excludedCount };
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
