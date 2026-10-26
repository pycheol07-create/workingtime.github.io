// === js/lib/task-pace.js ===
// 설명: 대시보드 '오늘 업무 처리량' 카드의 업무별 진행률·남은 시간·예상 종료 계산(순수 함수).
//
//  왜 '추정 실적' 이 필요한가
//    처리량은 업무를 **끝낼 때 한꺼번에** 들어온다(app-logic.js). 진행 중에는 입력된 물량이 0 이라
//    물량만 보면 하루 종일 0% 다. 그래서 실적 = max(입력된 처리량, 오늘 쓴 전체 인시 × 기준 속도(UPH)) 로 보고,
//    어림값이 이겨서 그 값을 보여 주면(진행 중이든 끝났든) estimated=true 로 표시한다.
//    '완료'는 입력된 처리량이 계획 이상일 때만 — 끝났는데 입력 전이면 확정이 아니므로 '멈춤'이다.
//    (입력 + 진행 중 몫을 더하지 않는 이유: 처리량을 팀 누계로 넣는 경우 진행 중 몫이 두 번 더해진다)
//
//  점심(12:30~13:30)은 '오늘 진행' 띠(forecast-progress.js projectFinish)와 같은 규칙으로 건너뛴다 —
//  skipLunch 를 같은 값으로 받아야 띠의 정시와 이 카드의 종료 예상이 어긋나지 않는다.
//
//  import 는 같은 lib 의 calc.js 뿐 — DOM·State·Firebase 를 쓰지 않는다(node 테스트: tests/task-pace.test.js).

import { addWorkMinutes, minutesOverlap, LUNCH_START_MIN, LUNCH_END_MIN } from './calc.js?v=202610261714';

/** 경과율 − 진행률 (%p) 이 이 값 미만이면 순조, 이상이면 주의, RISK 초과면 늦음 */
export const PACE_WARN_GAP = 10;
export const PACE_RISK_GAP = 25;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** a~b 사이의 작업 분(점심 겹침을 뺀다). b<a 면 음수가 나온다(남은 시간이 없다는 뜻으로 쓴다). */
export function workMinutesBetween(a, b, skipLunch) {
    const s = num(a), e = num(b);
    const lunch = skipLunch && e > s ? minutesOverlap(s, e, LUNCH_START_MIN, LUNCH_END_MIN) : 0;
    return (e - s) - lunch;
}

/** 근무시간 경과율(0~1) — 첫 업무 시작부터 정시까지 중 지금까지 흐른 몫. 시작 전·정보 없음은 0. */
export function expectedRatio({ nowMin, startMin, baseFinishMin, skipLunch } = {}) {
    if (startMin == null || baseFinishMin == null || nowMin == null) return 0;
    const total = workMinutesBetween(startMin, baseFinishMin, skipLunch);
    if (!(total > 0)) return 0;
    const done = workMinutesBetween(startMin, Math.min(num(nowMin), num(baseFinishMin)), skipLunch);
    return Math.min(1, Math.max(0, done / total));
}

/** 진행률(%)과 경과율(0~1)로 색 판정. 판정할 수 없으면 'ok'. */
export function toneFor(pct, expected) {
    if (pct == null || !Number.isFinite(pct)) return 'ok';
    const gap = num(expected) * 100 - pct;
    if (gap < PACE_WARN_GAP) return 'ok';
    if (gap <= PACE_RISK_GAP) return 'warn';
    return 'risk';
}

/** 종료 예상이 정시를 넘는 분 → 색. 띠(widget-today-progress.js tones)와 같은 단계: 0 이하 순조 · 30분 이하 주의 · 넘으면 늦음 */
export const OVER_WARN_MAX_MIN = 30;
export function toneForOver(overMin) {
    if (overMin == null || !Number.isFinite(overMin) || overMin <= 0) return 'ok';
    return overMin <= OVER_WARN_MAX_MIN ? 'warn' : 'risk';
}

/** 정시까지 남은 작업시간이 이보다 짧으면 '+N명' 대신 '정시 마감 어려움' */
export const MIN_LEFT_FOR_EXTRA_MIN = 30;

/** 업무 하나의 진행 상태.
 *  입력: planQty(계획 물량) · doneQty(입력된 처리량) · uph(1인 시간당 처리량) · working(지금 진행 인원)
 *        spentHours(오늘 그 업무에 쓴 전체 인시 — 끝난 + 진행·정지 중) · activeHours(그중 진행·정지 중인 기록 몫)
 *        nowMin · baseFinishMin(정시) · skipLunch · expected(경과율 0~1) · available(오늘 가용 인원)
 *        started(오늘 기록이 있나) · ended(기록은 있는데 진행·정지 중인 사람이 없나)
 *  실적 = max(입력된 처리량, spentHours × UPH) — 어림값이 이기면 estimated=true
 *  색: 종료 예상을 낼 수 있으면 정시 초과 분으로(늦게 시작했어도 제 속도면 순조), 못 내면 경과율 − 진행률.
 *  반환: { planQty, started, shownQty, estimated, pct, barPct, tone, remainQty, remainMin, finishMin, overMin,
 *          extraWorkers, cannotMeet, state }
 *  state: 'done'(입력된 처리량 ≥ 계획) | 'stopped'(진행·정지 중인 사람 없음 — 남았거나 처리량 입력 전)
 *         | 'noPlan' | 'noUph' | 'noWorker' | 'past' | 'ok'
 *  진행 중인데 어림값이 계획에 닿으면 remainQty 0 · 남은 0분으로 'ok'/'past' 그대로 둔다(입력 전이라 완료 아님).
 */
export function taskPace({
    planQty, doneQty, uph, working, spentHours, activeHours,
    nowMin, baseFinishMin, skipLunch, expected, available,
    started, ended
} = {}) {
    const plan = Math.max(0, num(planQty));
    const done = Math.max(0, num(doneQty));
    const rate = Math.max(0, num(uph));
    const people = Math.max(0, Math.round(num(working)));
    const active = Math.max(0, num(activeHours));
    const spent = Math.max(active, num(spentHours));     // 전체는 진행 중 몫보다 작을 수 없다
    const isStarted = started != null ? !!started : (active > 0 || done > 0);
    const isEnded = ended != null ? !!ended : (isStarted && people === 0 && active === 0);

    // 입력된 처리량과 '오늘 쓴 전체 인시 × 기준 속도' 중 큰 쪽 — 더하지 않는다(누계 입력 이중 합산 방지)
    const spentQty = rate > 0 ? Math.round(spent * rate) : 0;
    const shownQty = Math.max(done, spentQty);
    const estimated = spentQty > done;

    const pct = plan > 0 ? Math.round(shownQty / plan * 100) : null;
    const barPct = pct == null ? 0 : Math.min(100, Math.max(0, pct));
    const remainQty = Math.max(0, plan - shownQty);

    const out = {
        planQty: plan, started: isStarted,
        shownQty, estimated, pct, barPct, tone: 'ok',
        remainQty, remainMin: null, finishMin: null, overMin: null, extraWorkers: null, cannotMeet: false,
        state: 'ok'
    };

    if (!(plan > 0)) { out.state = 'noPlan'; out.remainQty = 0; return out; }
    if (done >= plan) { out.state = 'done'; return out; }

    // 종료 예상을 못 내는 경우의 색 — 미착수는 경고하지 않는다
    const byElapsed = isStarted ? toneFor(pct, expected) : 'ok';
    if (isEnded) { out.state = 'stopped'; out.tone = byElapsed; return out; }
    if (!(rate > 0)) { out.state = 'noUph'; out.tone = done > 0 ? byElapsed : 'ok'; return out; }
    if (people <= 0) { out.state = 'noWorker'; out.tone = byElapsed; return out; }

    out.remainMin = Math.round(remainQty / (rate * people) * 60);
    const finish = addWorkMinutes(num(nowMin), remainQty / (rate * people) * 60, { skipLunch: !!skipLunch });
    out.finishMin = Math.round(finish);
    if (baseFinishMin == null) { out.tone = byElapsed; return out; }

    out.overMin = Math.round(finish - num(baseFinishMin));
    out.tone = toneForOver(out.overMin);
    const leftMin = workMinutesBetween(nowMin, baseFinishMin, skipLunch);
    if (!(leftMin > 0)) { out.state = 'past'; return out; }
    if (finish - num(baseFinishMin) > 0) {
        const need = Math.ceil(remainQty / rate / (leftMin / 60));
        const avail = Math.max(0, num(available));
        if (leftMin < MIN_LEFT_FOR_EXTRA_MIN || (avail > 0 && need > avail)) out.cannotMeet = true;
        else out.extraWorkers = Math.max(0, need - people);
    }
    return out;
}

/** 여러 업무를 묶은 칸 — 합계 진행률만(종료 예상은 업무마다 달라 합치지 않는다). */
export function combinePace(paces, expected) {
    const list = (paces || []).filter(Boolean);
    const planned = list.filter(p => p.state !== 'noPlan');
    const plan = planned.reduce((a, p) => a + num(p.planQty), 0);
    const shown = planned.reduce((a, p) => a + num(p.shownQty), 0);
    const pct = plan > 0 ? Math.round(shown / plan * 100) : null;
    const anyActive = planned.some(p => p.state !== 'done' && (p.started || p.shownQty > 0));
    const allDone = planned.length > 0 && planned.every(p => p.state === 'done');
    return {
        planQty: plan, shownQty: shown, pct,
        barPct: pct == null ? 0 : Math.min(100, Math.max(0, pct)),
        estimated: planned.some(p => p.estimated),
        tone: (anyActive && !allDone) ? toneFor(pct, expected) : 'ok',
        state: plan > 0 ? (allDone ? 'done' : 'ok') : 'noPlan'
    };
}

/** 대시보드 처리량 칸 → 연결된 업무 목록.
 *  map: { 업무명: 칸id } (호출하는 쪽에서 업무명을 지금 이름으로 맞춰 넘긴다)
 *  반환: [{ id, valueId, tasks: [업무명…], kind: 'none' | 'single' | 'group' }] — 처리량 칸만, itemIds 순서대로 */
export function rowsForDashboard(itemIds, defs, quantityToDashboardMap) {
    const byId = {};
    Object.entries(quantityToDashboardMap || {}).forEach(([task, id]) => {
        if (!task || !id) return;
        (byId[id] = byId[id] || []).push(task);
    });
    const rows = [];
    (itemIds || []).forEach(id => {
        const def = defs && defs[id];
        if (!def || def.isQuantity !== true) return;
        const tasks = [...new Set(byId[id] || [])];
        rows.push({
            id, valueId: def.valueId, tasks,
            kind: tasks.length === 0 ? 'none' : tasks.length === 1 ? 'single' : 'group'
        });
    });
    return rows;
}
