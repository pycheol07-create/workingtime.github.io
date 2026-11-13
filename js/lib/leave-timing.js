// js/lib/leave-timing.js
//
// 당일 근태(외출·조퇴)의 '시각' 판정 — 예약 근태(2026-11-12).
//   근태 설정에서 외출·조퇴를 지금보다 늦은 시각으로 등록하면 그 시각이 되기 전까지는 '예정',
//   그 시각부터 '근태 중' 이다. 시각이 되면 열려 있는 아무 브라우저나 그 사람의 진행 중 업무를
//   예정 시각으로 끝낸다(js/leave-auto-apply.js — 근무시간 계산이 외출 시간을 빼지 않아 기록을 실제로 끊어야 한다).
//
// 근태 종류 이름('외출'·'조퇴'·'지각')을 여기서 직접 쓰는 이유
//   시각이 있는 근태는 이 셋뿐이고 각자 규칙이 다르다(외출은 복귀 시각이 있고, 지각은 도착 시각이라
//   근태 중이 아니다). 관리자가 늘리는 날짜 근태 목록(state.js LEAVE_TYPES)과 별개인 고정 예외라
//   attendance-guard.js DAILY_ONCE_TYPES 와 같은 근거로 이름을 쓴다. state.js 는 브라우저 상태를
//   들고 있어 이 순수 모듈(tests/leave-timing.test.js 가 node 로 돌린다)에서 import 하지 않는다.
//
// DOM·Firebase 는 import 하지 않는다.

import { normalizeClock } from './clock-in-out.js?v=202611131345';

const 외출 = '외출';
const 조퇴 = '조퇴';
const 지각 = '지각';
/** 예정 시각이 있는(시각이 되면 자동 적용되는) 근태 */
export const SCHEDULED_LEAVE_TYPES = [외출, 조퇴];

const listOf = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));

/**
 * 지금 근태 중인가.
 *   - 지각: 아니다(도착 시각 기록).
 *   - 날짜 근태·startTime 없음·형식 틀림: 그렇다(옛 동작 그대로).
 *   - 외출·조퇴: 시작 시각이 지금보다 늦으면 아니다(예정). 같으면 근태 중.
 *   - 외출: 복귀 시각(endTime)이 있고 그 시각이 지금 이전·같으면 아니다(복귀).
 *     복귀 시각 형식이 틀리면 옛 동작처럼 복귀로 본다.
 * @param {object} entry 근태 기록
 * @param {string} now   'HH:MM' (형식이 틀리면 시각을 보지 않는다 — 옛 동작)
 */
export function isLeaveActiveAt(entry, now) {
    if (!entry) return false;
    const type = entry.type;
    if (type === 지각) return false;
    if (!SCHEDULED_LEAVE_TYPES.includes(type)) return true;
    const 지금 = normalizeClock(now);
    if (type === 외출 && entry.endTime) {
        const 복귀 = normalizeClock(entry.endTime);
        if (!복귀 || !지금 || 복귀 <= 지금) return false;
    }
    const 시작 = normalizeClock(entry.startTime);
    if (!시작 || !지금) return true;
    return 시작 <= 지금;
}

/** 예정(시작 시각이 아직 안 온) 외출·조퇴인가. */
export function isLeavePendingAt(entry, now) {
    if (!entry || !SCHEDULED_LEAVE_TYPES.includes(entry.type)) return false;
    const 시작 = normalizeClock(entry.startTime);
    const 지금 = normalizeClock(now);
    if (!시작 || !지금) return false;
    if (entry.type === 외출 && entry.endTime) return false;   // 복귀 시각이 이미 있는 외출은 예정이 아니다
    return 시작 > 지금;
}

/**
 * 지금 끊어야 할 사람과 시각.
 *   지금 근태 중인 외출·조퇴마다, 그 사람의 진행 중·일시정지 기록 중 근태 시작보다 **먼저** 시작한 것이 있을 때만.
 *   (근태 시작과 같거나 뒤에 시작한 기록은 그 사람이 다시 일을 시작한 것 — 끊지 않는다.
 *    그래서 한 번 끊고 나면 다시 돌려도 빈 목록이다.)
 *   한 사람에게 해당 근태가 여러 건이면 가장 이른 시각.
 * @returns {Array<{member:string, cutTime:string}>}
 */
export function dueLeaveCuts(dailyLeaves, workRecords, now) {
    const recs = listOf(workRecords).filter(r => r && (r.status === 'ongoing' || r.status === 'paused'));
    const byMember = new Map();
    listOf(dailyLeaves).forEach(l => {
        if (!l || !l.member || !SCHEDULED_LEAVE_TYPES.includes(l.type)) return;
        const 시작 = normalizeClock(l.startTime);
        if (!시작 || !isLeaveActiveAt(l, now)) return;
        const hit = recs.some(r => r.member === l.member && normalizeClock(r.startTime) && normalizeClock(r.startTime) < 시작);
        if (!hit) return;
        const prev = byMember.get(l.member);
        if (!prev || 시작 < prev) byMember.set(l.member, 시작);
    });
    return [...byMember.entries()].map(([member, cutTime]) => ({ member, cutTime }));
}

/** 지금 근태 중인 사람 집합을 글자로(바뀌었는지 비교용). */
export function activeLeaveKey(leaves, now) {
    const names = new Set();
    listOf(leaves).forEach(l => { if (l && l.member && isLeaveActiveAt(l, now)) names.add(String(l.member)); });
    return [...names].sort().join('\u0001');
}

/**
 * 강제 종료 계획(js/app-sync.js forceEndMemberWork 가 쓴다).
 *   opt.onlyStartedBefore — 시작이 끊는 시각 이상인 기록은 건너뛴다(삭제하지 않는다).
 *     지난 시각으로 끊을 때 그 뒤에 새로 시작한 정상 기록이 0분이 되어 지워지는 것을 막는다.
 *   끄면 옛 동작: 끊는 시각보다 늦게 시작한 기록은 0분 → 삭제.
 * @param {Array} records 그 사람의 진행 중·일시정지 기록
 * @param {string} cutTime 'HH:MM'
 * @param {(start:string, end:string, pauses:Array)=>number} calcDuration
 * @returns {{ updates:Array<{rec, data}>, deletes:Array<object>, skipped:Array<object>, summaries:string[] }}
 */
export function planForceEnd(records, cutTime, calcDuration, { onlyStartedBefore = false } = {}) {
    const toMin = (hhmm) => {
        if (!hhmm || typeof hhmm !== 'string') return 0;
        const [h, m] = hhmm.split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    const out = { updates: [], deletes: [], skipped: [], summaries: [] };
    (records || []).forEach(rec => {
        const startMins = toMin(rec.startTime);
        const endMins = toMin(cutTime);
        if (onlyStartedBefore && startMins >= endMins) {
            out.skipped.push(rec);
            out.summaries.push(`${rec.task}@${rec.startTime} (끊는 시각 이후 시작 → 그대로 둠)`);
            return;
        }
        // 시작 시각이 cutTime 이후이면 0분 → 아예 삭제
        const finalEnd = endMins < startMins ? rec.startTime : cutTime;
        // 휴식은 [시작, 끊는 시각] 안으로 자른다 — 지난 시각으로 끊을 때 그 뒤의 휴식까지 빼면 근무시간이 줄거나 0분이 된다.
        //   끊는 시각 이후에 시작한 휴식은 버리고, 걸친 휴식·열린 휴식(`!p.end`)은 끊는 시각에서 닫는다.
        const lo = startMins, hi = toMin(finalEnd);
        const pauses = [];
        (Array.isArray(rec.pauses) ? rec.pauses : []).forEach(p => {
            if (!p || !p.start) return;
            const ps = toMin(p.start);
            if (ps >= hi) return;
            const pe = p.end ? Math.min(toMin(p.end), hi) : hi;
            const clipped = { ...p };
            if (ps < lo) clipped.start = rec.startTime;
            clipped.end = pe >= hi ? finalEnd : p.end;
            if (toMin(clipped.end) < toMin(clipped.start)) clipped.end = clipped.start;
            pauses.push(clipped);
        });
        const duration = calcDuration(rec.startTime, finalEnd, pauses);
        if (duration <= 0) {
            out.deletes.push(rec);
            out.summaries.push(`${rec.task}@${rec.startTime} (0분 → 삭제)`);
        } else {
            out.updates.push({ rec, data: { status: 'completed', endTime: finalEnd, duration, pauses } });
            out.summaries.push(`${rec.task}@${rec.startTime}~${finalEnd} (${duration}분)`);
        }
    });
    return out;
}
