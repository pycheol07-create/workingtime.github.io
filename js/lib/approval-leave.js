// === js/lib/approval-leave.js ===
// 근태사유서 → 팀원 카드 근태(2026-11-12) — 순수 함수. DOM·Firebase·state.js 를 import 하지 않는다(tests/approval-leave.test.js).
//   제출(·수정)하면 사유서의 근태를 메인앱 예약 근태와 같은 모양으로 걸어 둔다. 그 시각이 되면 열려 있는 메인앱이
//   js/leave-auto-apply.js(dueLeaveCuts)로 적용한다 — 여기서는 '어떤 기록이 있어야 하나'만 계산한다(쓰기는 js/approval.js).
//     지각·조퇴·외출 → daily_data/{발생일}.onLeaveMembers  { id:'daily-…', member, type, startTime, endTime:null, apKey, apSig, planEnd? }
//     날짜 근태(결근 등, isPersistentLeaveType) → persistent_data/leaveSchedule  { id:'leave-…', member, type, startDate, endDate, apKey, apSig }
//   apKey = 'ap' + SHA-256(기안서 id) 앞 16자리 — 근태 문서는 직원 전원이 읽으므로 기안서 id 를 그대로 넣지 않는다. 사유·내용도 넣지 않는다.
//   apSig = 걸 때의 값(시각 근태 {member,type,startTime,planEnd,at} · 날짜 근태 {member,type,startDate,endDate,at}, at = 건 시각 ms).
// 맞추기 규칙(다시 돌려도 결과가 같다)
//   · 건드리는 것은 apKey 가 같고 지금 값이 apSig 와 같은 기록뿐(= 기안서가 건 그대로). 근태 설정 [수정 저장]·달력(leave-ops upsertById)·
//     데이터 관리처럼 apKey 를 남긴 채 값을 고치는 경로가 있어(2026-11-12 리뷰) apKey 만으로는 '사람이 손대지 않았다'고 볼 수 없다.
//     값이 바뀐(또는 apSig 가 없는) 기록은 사람이 맡은 것으로 보고 지우지도, 같은 기안서로 새로 넣지도 않는다.
//   · 결재 대기·승인 → 있어야 한다 / 반려·회수·삭제 → 없어야 한다 / 수정 → 옛 기록을 지우고 새 값으로.
//   · 시각 근태 중 이미 시작된 기록(지난 날짜·시각이 지남)은 지우거나 바꾸지 않는다(끊긴 업무 기록은 되살릴 수 없다 — 사용자 결정 D-4).
//     날짜 근태는 업무를 끊지 않으므로 지난 날짜여도 지운다(2026-11-12 리뷰).
//   · 지난 날의 지각·조퇴·외출은 새로 넣지 않는다(D-5). 지각은 미래에 넣지 않는다(도착 시각이라). '기타' 는 어떤 근태인지 몰라 넣지 않는다.
//   · 외출 종료 시각은 endTime 이 아니라 planEnd 에 둔다 — endTime 은 [복귀] 때만 채운다(넣으면 '예정' 표시·근태 수정 창이 깨진다, D-6).
//   · 같은 근태가 이미 있으면(지각·조퇴 = 같은 사람·종류, 외출 = 시간이 겹침, 날짜 근태 = 그날 같은 사람 아무 날짜 근태) 새로 넣지 않는다.
//
// 근태 종류 이름('지각')을 여기서 쓰는 이유: 시각 근태 중 지각만 '도착 시각'이라 규칙이 다르다 — js/lib/leave-timing.js·attendance-guard.js 와
//   같은 근거의 고정 예외. 외출·조퇴는 leave-timing.js SCHEDULED_LEAVE_TYPES, 날짜 근태 판정은 부르는 쪽이 state.js isPersistentLeaveType 을 넘긴다.

import { SCHEDULED_LEAVE_TYPES } from './leave-timing.js?v=202611130950';
import { findDailyLeaveDup } from './attendance-guard.js?v=202611130950';
import { normalizeClock } from './clock-in-out.js?v=202611130950';
import { END_SUFFIX } from './approval-logic.js?v=202611130950';

const 지각 = '지각';
const 외출 = '외출';
/** 미래 시각 근태를 미리 넣는 한도(일) — 그보다 먼 날은 넣지 않고 안내만 */
export const FUTURE_DAYS_MAX = 31;

/** SHA-256 16진수 → 연결 키 'ap' + 앞 16자리 */
export const apKeyFrom = (hex) => 'ap' + String(hex || '').toLowerCase().replace(/[^0-9a-f]/g, '').slice(0, 16);

const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const addDays = (day, n) => {
    const t = Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) + n * 86400000;
    return new Date(t).toISOString().slice(0, 10);
};

/** 양식에서 근태 칸 찾기 — 발생일(prefill 'day')·구분(prefill 'tardyKind' select)·시각(prefill 'tardyTime'). id 로 찾지 않는다(운영 양식은 저장본). */
export function leaveFieldsOf(form) {
    const fields = (form && Array.isArray(form.fields)) ? form.fields : [];
    const day = fields.find(f => f && f.prefill === 'day' && f.type === 'date');
    const kind = fields.find(f => f && f.prefill === 'tardyKind' && f.type === 'select');
    const time = fields.find(f => f && f.prefill === 'tardyTime' && f.type === 'time') || null;
    return day && kind ? { day, kind, time } : null;
}

/**
 * 기안서 값 → 걸어 둘 근태.
 *   null = 근태사유서가 아니거나 구분이 근태 종류가 아님('기타' 포함).
 *   { store: null, why } = 근태인데 값이 모자라 넣을 수 없음(안내용).
 *   { store: 'daily', day, type, member, startTime, planEnd } | { store: 'schedule', day, type, member }
 * @param {{isPersistent:(t:string)=>boolean, otherType?:string}} opt state.js 의 isPersistentLeaveType·OTHER_LEAVE_TYPE
 */
export function leaveIntentOf(form, values, member, { isPersistent, otherType } = {}) {
    const lf = leaveFieldsOf(form);
    if (!lf) return null;
    const v = values && typeof values === 'object' ? values : {};
    const type = String(v[lf.kind.key] == null ? '' : v[lf.kind.key]).trim();
    if (!type || type === otherType) return null;
    const timed = type === 지각 || SCHEDULED_LEAVE_TYPES.includes(type);
    const dated = !timed && typeof isPersistent === 'function' && isPersistent(type);
    if (!timed && !dated) return null;
    const day = String(v[lf.day.key] == null ? '' : v[lf.day.key]).trim();
    if (!isDay(day)) return { store: null, why: '발생일이 없어 근태 카드에 넣지 않았습니다.' };
    if (!member) return { store: null, why: '작성자 이름이 없어 근태 카드에 넣지 않았습니다.' };
    if (dated) return { store: 'schedule', day, type, member };
    const startTime = lf.time ? normalizeClock(v[lf.time.key]) : null;
    if (!startTime) return { store: null, why: '발생 시각이 없어 근태 카드에 넣지 않았습니다.' };
    const planEnd = type === 외출 && lf.time ? normalizeClock(v[lf.time.key + END_SUFFIX]) : null;
    return { store: 'daily', day, type, member, startTime, planEnd: planEnd || null };
}

/** daily_data 에 넣을 근태 — 날짜·종류 조건(D-5)을 거친 뒤. → { want, note } (want = null 이면 '있으면 안 됨') */
export function dailyWant(intent, today) {
    if (!intent || intent.store !== 'daily') return { want: null, note: '' };
    if (intent.day < today) return { want: null, note: '지난 날짜의 지각·조퇴·외출은 근태 카드에 넣지 않습니다 — 필요하면 데이터 관리에서 고치세요.' };
    if (intent.type === 지각 && intent.day > today) return { want: null, note: '지각은 미리 넣지 않습니다 — 그날 출근 기록으로 잡힙니다.' };
    if (intent.day > addDays(today, FUTURE_DAYS_MAX)) return { want: null, note: `${FUTURE_DAYS_MAX}일보다 먼 날의 근태는 미리 넣지 않습니다 — 가까워지면 근태 설정에서 넣어 주세요.` };
    return { want: intent, note: '' };
}

// 외출 — 같은 사람 외출과 시간이 겹치나(끝이 없으면 하루 끝까지로 본다)
const 끝 = (e) => normalizeClock(e.endTime) || normalizeClock(e.planEnd) || '24:00';
function outingOverlap(list, want) {
    const s = want.startTime, e = want.planEnd || '24:00';
    return list.find(x => x && x.member === want.member && x.type === 외출 && normalizeClock(x.startTime)
        && normalizeClock(x.startTime) < e && s < 끝(x)) || null;
}

/**
 * daily_data/{day}.onLeaveMembers 맞추기.
 * @param {Array} list 서버 목록
 * @param {object|null} want dailyWant 의 want(이 날에 있어야 할 기록) | null
 * @param {{apKey:string, day:string, today:string, now:string, idMs:number}} ctx  now = 'HH:MM'(한국시간)
 * @returns {{next:Array, changed:boolean, notes:string[], added:object|null, removed:number}}
 */
export function planDailySync(list, want, { apKey, day, today, now, idMs } = {}) {
    const src = Array.isArray(list) ? list : [];
    const notes = [];
    const started = dailyStarted(day, today, now);
    const same = (e) => !!want && e.member === want.member && e.type === want.type
        && normalizeClock(e.startTime) === want.startTime && (normalizeClock(e.planEnd) || null) === (want.planEnd || null);
    const next = [];
    let held = false, removed = 0, keptStarted = false, keptHand = false;
    src.forEach(e => {
        if (!e || !apKey || e.apKey !== apKey) { next.push(e); return; }
        if (same(e)) { held = true; next.push(e); return; }
        if (!untouchedDaily(e)) { keptHand = true; held = held || !!want; next.push(e); return; }   // 사람이 고친 기록
        if (started(e)) { keptStarted = true; held = held || !!want; next.push(e); return; }
        removed++;
    });
    if (keptHand) notes.push('근태 카드에서 고친 근태는 그대로 둡니다.');
    if (keptStarted) notes.push('이미 적용된 근태는 그대로 둡니다 — 바꾸려면 근태 설정에서 고치세요.');
    let added = null;
    if (want && !held && apKey && want.day === day && day >= today) {
        const dup = want.type === 외출 ? outingOverlap(next, want) : findDailyLeaveDup(next, want);
        if (dup) notes.push(`그날 이미 ${want.type} 기록이 있어 근태 카드에 새로 넣지 않았습니다.`);
        else {
            const planEnd = want.planEnd || null;
            added = { id: `daily-${idMs}`, member: want.member, type: want.type, startTime: want.startTime, endTime: null, apKey,
                apSig: { member: want.member, type: want.type, startTime: want.startTime, planEnd, at: idMs },
                ...(planEnd ? { planEnd } : {}) };
            next.push(added);
        }
    }
    return { next, changed: removed > 0 || !!added, notes, added, removed };
}

// 시각 근태가 이미 시작됐나(지난 날·지각·시각이 지남) — 시작된 것은 지우지 않는다(D-4)
const dailyStarted = (day, today, now) => {
    const 지금 = normalizeClock(now) || '00:00';
    return (e) => day < today
        || (day === today && (e.type === 지각 || !normalizeClock(e.startTime) || normalizeClock(e.startTime) <= 지금));
};
/** 기안서가 건 값 그대로인가(시각 근태) — apSig 와 사람·종류·시각·예정 복귀가 같다. apSig 가 없으면 아니다 */
export function untouchedDaily(e) {
    const s = e && e.apSig;
    return !!s && typeof s === 'object' && e.member === s.member && e.type === s.type
        && normalizeClock(e.startTime) === s.startTime && (normalizeClock(e.planEnd) || null) === (s.planEnd || null);
}
/** 기안서가 건 값 그대로인가(날짜 근태) — apSig 와 사람·종류·시작일·종료일이 같다 */
export function untouchedSchedule(e) {
    const s = e && e.apSig;
    return !!s && typeof s === 'object' && e.member === s.member && e.type === s.type
        && e.startDate === s.startDate && (e.endDate || e.startDate) === s.endDate;
}

/**
 * persistent_data/leaveSchedule.onLeaveMembers 맞추기(날짜 근태 — 하루짜리, startDate = endDate = 발생일).
 * @param {object|null} want leaveIntentOf 의 schedule 결과 | null
 * @param {{apKey:string, today:string, idMs:number, isPersistent:(t:string)=>boolean}} ctx
 */
export function planScheduleSync(list, want, { apKey, today, idMs, isPersistent } = {}) {
    const src = Array.isArray(list) ? list : [];
    const w = want && want.store === 'schedule' ? want : null;
    const notes = [];
    // 날짜 근태는 업무를 끊지 않으므로 '이미 시작됨'을 따지지 않는다 — 기안서가 건 그대로면 지난 날짜여도 지운다(2026-11-12 리뷰)
    const same = (e) => !!w && e.member === w.member && e.type === w.type && e.startDate === w.day && (e.endDate || e.startDate) === w.day;
    const next = [];
    let held = false, removed = 0, keptHand = false;
    src.forEach(e => {
        if (!e || !apKey || e.apKey !== apKey) { next.push(e); return; }
        if (same(e)) { held = true; next.push(e); return; }
        if (!untouchedSchedule(e)) { keptHand = true; held = held || !!w; next.push(e); return; }   // 사람이 고친 기록
        removed++;
    });
    if (keptHand) notes.push('근태 화면에서 고친 날짜 근태는 그대로 둡니다.');
    let added = null;
    if (w && !held && apKey) {
        const covers = (e) => e && e.member === w.member && typeof isPersistent === 'function' && isPersistent(e.type)
            && typeof e.startDate === 'string' && e.startDate <= w.day && w.day <= (e.endDate || e.startDate);
        if (next.some(covers)) notes.push('그날 이미 날짜 근태가 있어 근태 일정에 새로 넣지 않았습니다.');
        else {
            added = { id: `leave-${idMs}`, member: w.member, type: w.type, startDate: w.day, endDate: w.day, apKey,
                apSig: { member: w.member, type: w.type, startDate: w.day, endDate: w.day, at: idMs } };
            next.push(added);
        }
    }
    return { next, changed: removed > 0 || !!added, notes, added, removed };
}

/**
 * 다시 맞추기(2026-11-12 리뷰) — 걸려 있으면 안 되는 기안서(반려·회수·삭제 등)의 기록을 뺀다. 넣지는 않는다.
 *   반려 뒤 빼기가 실패했거나, 메인앱 자동저장이 옛 목록으로 되살린 기록을 기안서 화면을 열 때 다시 치운다.
 *   drop(apKey, entry) 이 true 이고 기안서가 건 값 그대로(apSig)인 기록만. 시각 근태(day 를 줌)는 이미 시작된 것을 그대로 둔다.
 *   몇 번을 돌려도 결과가 같다(지울 것이 없으면 changed false).
 * @param {{drop:(key:string, e:object)=>boolean, day?:string, today?:string, now?:string}} opt  day 가 없으면 날짜 근태 목록
 */
export function planCleanup(list, { drop, day, today, now } = {}) {
    const src = Array.isArray(list) ? list : [];
    const daily = !!day;
    const started = daily ? dailyStarted(day, today, now) : () => false;
    let removed = 0;
    const next = src.filter(e => {
        if (!e || typeof e.apKey !== 'string' || !e.apKey || typeof drop !== 'function' || !drop(e.apKey, e)) return true;
        if (!(daily ? untouchedDaily(e) : untouchedSchedule(e))) return true;
        if (started(e)) return true;
        removed++;
        return false;
    });
    return { next, changed: removed > 0, removed };
}

/**
 * 다시 맞추기에서 뺄 기록인가(planCleanup 의 drop). 어느 경우든 목록을 읽기 전(before = 읽은 시각 − 여유)에 건 기록만 —
 *   목록을 읽는 사이 작성자가 재제출·새로 제출해 건 기록을 옛 상태(반려·임시저장·목록에 없음)로 보고 지우지 않게(2026-11-12 재리뷰).
 * @param {{staleKeys:Set<string>, visible:Set<string>, orphanOk:boolean, me:string, before:number}} o
 *   staleKeys = 걸려 있으면 안 되는 문서의 키, visible = 이 화면이 아는 문서 전부의 키, orphanOk = 목록에 없는 내 문서 기록도 정리
 */
export function tidyDrop({ staleKeys, visible, orphanOk, me, before } = {}) {
    return (k, e) => {
        const at = Number(e && e.apSig && e.apSig.at);
        if (!(at > 0 && at < Number(before))) return false;
        if (staleKeys && staleKeys.has(k)) return true;
        return !!orphanOk && !!me && e.member === me && !(visible && visible.has(k));
    };
}

/** 오늘 지난 시각의 외출·조퇴를 넣으면 메인앱이 그 시각으로 업무를 끊는다 — 확인창 문구(아니면 '') */
export function pastCutWarning(intent, today, now) {
    const 지금 = normalizeClock(now);
    if (!intent || intent.store !== 'daily' || intent.day !== today || !SCHEDULED_LEAVE_TYPES.includes(intent.type) || !지금) return '';
    if (intent.startTime > 지금) return '';
    return `${intent.type} 시각(${intent.startTime})이 이미 지났습니다 — 제출하면 근태 카드에 바로 들어가고, 그 전부터 하던 업무가 ${intent.startTime} 로 끝납니다.`;
}

/** 넣은 기록 안내 한 줄 — r = planDailySync·planScheduleSync 결과, day = 그 기록의 날짜 */
export function addedText(r, day, today, now) {
    if (!r || !r.added) return '';
    const a = r.added;
    if (a.startDate) return `근태 일정에 ${a.startDate} ${a.type} 을(를) 넣었습니다.`;
    const 지금 = normalizeClock(now) || '00:00';
    const when = a.startTime + (a.planEnd ? `~${a.planEnd}` : '');
    const dayText = day === today ? '' : `${day} `;
    return a.type !== 지각 && (day > today || (day === today && a.startTime > 지금))
        ? `근태 카드에 ${dayText}${when} ${a.type} 예정으로 넣었습니다(그 시각에 자동 적용).`
        : `근태 카드에 ${dayText}${when} ${a.type} 을(를) 넣었습니다.`;
}
