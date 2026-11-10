// js/lib/attendance-guard.js
//
// 업무 시작 시각 ↔ 출근시각, 당일 근태(지각·조퇴·외출) 중복을 판정하는 순수 함수.
//
// 왜 순수 함수인가
//   같은 검사가 오늘 화면(listeners-form-record.js), 이력 화면(listeners-history-records.js),
//   저장 함수(history-data-manager.js), 근태 저장(listeners-form-attendance.js / app-logic.js)
//   다섯 곳에서 쓰인다. 규칙을 한 곳에 두지 않으면 한쪽만 고쳐진다.
//   DOM·Firebase 는 import 하지 않는다(tests/attendance-guard.test.js 가 node 로 돌린다).

import { normalizeClock } from './clock-in-out.js?v=202611101235';

const 분으로 = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * 업무 시작이 출근시각보다 이르면 막는다. 같으면 통과.
 * 출근시각이 없거나 형식이 틀리면 판정하지 않는다(skipped) — 출근 기록 없이 업무만 입력하는 경우가 있다.
 * @returns {{ok:boolean, skipped?:boolean, reason?:string, message?:string}}
 */
export function checkStartAfterClockIn(startTime, inTime) {
    const 출근 = normalizeClock(inTime);
    if (!출근) return { ok: true, skipped: true };
    const 시작 = normalizeClock(startTime);
    if (!시작) return { ok: true, skipped: true };
    if (분으로(시작) < 분으로(출근)) {
        return {
            ok: false,
            reason: 'start-before-in',
            message: `업무 시작(${시작})이 출근시각(${출근})보다 이릅니다.`,
        };
    }
    return { ok: true };
}

/**
 * 시작 시각을 출근시각 이후로 끌어올린다(그룹 변경·일괄 수정용 — 막지 않고 각자 출근시각으로 맞춘다).
 * 판정할 수 없으면 그대로 둔다.
 * @returns {{startTime:string, adjusted:boolean}}
 */
export function clampStartToClockIn(startTime, inTime) {
    const r = checkStartAfterClockIn(startTime, inTime);
    if (r.ok) return { startTime, adjusted: false };
    return { startTime: normalizeClock(inTime), adjusted: true };
}

/** member 의 업무기록 중 시작이 inTime 보다 이른 것(가장 이른 순). inTime 판정 불가면 []. */
export function recordsBeforeClockIn(records, member, inTime) {
    if (!normalizeClock(inTime)) return [];
    return (Array.isArray(records) ? records : [])
        .filter(r => r && r.member === member && r.startTime
            && !checkStartAfterClockIn(r.startTime, inTime).ok)
        .sort((a, b) => 분으로(normalizeClock(a.startTime)) - 분으로(normalizeClock(b.startTime)));
}

/** 지각 기준(HH:MM) — 평일 08:30, 토·일 12:00. app-logic.js 의 자동 지각과 같은 기준. */
export const TARDY_THRESHOLD_WEEKDAY = '08:30';
export const TARDY_THRESHOLD_WEEKEND = '12:00';

/** dateKey('YYYY-MM-DD') 요일 기준 지각 기준. 형식이 틀리면 평일 기준. */
export function tardyThreshold(dateKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!m) return TARDY_THRESHOLD_WEEKDAY;
    // UTC 로 요일을 구한다 — 브라우저 시간대와 무관하게 날짜 문자열의 요일
    const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
    return (dow === 0 || dow === 6) ? TARDY_THRESHOLD_WEEKEND : TARDY_THRESHOLD_WEEKDAY;
}

/** 출근시각이 지각인가(기준보다 늦으면 지각, 기준과 같으면 정시). 판정 불가면 false. */
export function isTardyClockIn(inTime, dateKey) {
    const 출근 = normalizeClock(inTime);
    if (!출근) return false;
    return 분으로(출근) > 분으로(tardyThreshold(dateKey));
}

/** member 의 지각(자동·수동 모두)을 뺀다. 입력은 바꾸지 않는다. */
export function removeTardyOf(list, member) {
    const src = Array.isArray(list) ? list : [];
    const next = src.filter(e => !(e && e.member === member && e.type === '지각'));
    return { list: next, removed: src.length - next.length };
}

// 하루 한 번만 있을 수 있는 당일 근태.
// ⚠️ attendance-check 3번(종류 하드코딩 금지)의 예외 — '하루 1건' 은 종류 목록(LEAVE_TYPES)에
//    없는 업무 규칙이고, 지각·조퇴 외에는 같은 날 여러 번이 정상(외출)이라 목록으로 뽑을 수 없다.
export const DAILY_ONCE_TYPES = ['지각', '조퇴'];
const 외출 = '외출';

/**
 * 당일 근태 중복 찾기. 지각·조퇴는 같은 사람·종류면 중복, 외출은 같은 시각까지 같아야 중복.
 * 그 외 종류는 판정하지 않는다(null).
 * @returns {object|null} 이미 있는 기록
 */
export function findDailyLeaveDup(list, { member, type, startTime } = {}) {
    const src = Array.isArray(list) ? list : [];
    if (DAILY_ONCE_TYPES.includes(type)) {
        return src.find(e => e && e.member === member && e.type === type) || null;
    }
    if (type === 외출) {
        return src.find(e => e && e.member === member && e.type === type
            && (e.startTime || '') === (startTime || '')) || null;
    }
    return null;
}

/** 수정 표시 — {editedAt:'YYYY-MM-DD HH:MM', editedBy} */
export function makeEditStamp(dateStr, timeStr, who) {
    return { editedAt: `${dateStr} ${timeStr}`, editedBy: who || '' };
}

// ── 출근 취소(2026-11-05) ──
// 잘못 누른 출근을 '출근 안 한 상태' 로 되돌린다. 저장은 app-logic.js cancelClockIn(트랜잭션)이 하고,
// 여기서는 '해도 되는가' 만 판정한다(서버 값으로 다시 부른다).
export const CLOCK_IN_CANCEL_SELF_MIN = 30;   // 본인은 출근 후 이 시간(분) 안에만. 관리자는 제한 없음

const 분값 = (hhmm) => { const t = normalizeClock(hhmm); if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/** 그 사람의 '자동 지각' 만 뺀다(수동 지각·외출·조퇴는 그대로). 입력은 바꾸지 않는다. */
export function removeAutoTardyOf(list, member) {
    const src = Array.isArray(list) ? list : [];
    const next = src.filter(e => !(e && e.member === member && e.type === '지각' && e.auto));
    return { list: next, removed: src.length - next.length };
}

/**
 * 출근 취소를 해도 되는지.
 * @param {{attendance?:{inTime?:string,status?:string}, leaves?:any[], member:string, isAdmin?:boolean, now:string,
 *          closed?:boolean, hasRecords?:boolean, hasLock?:boolean}} p
 * @returns {{ok:true} | {ok:false, reason:string, message:string}}
 */
export function checkClockInCancel(p) {
    const { attendance, leaves, member, isAdmin, now, closed, hasRecords, hasLock } = p || {};
    const no = (reason, message) => ({ ok: false, reason, message });
    if (closed) return no('closed', '오늘은 이미 업무 마감이 됐습니다. 출퇴근은 이력(근태 기록)에서 고치세요.');
    const st = attendance && attendance.status;
    if (!attendance || (st !== 'active' && st !== 'returned')) return no('not-clocked-in', `${member}님은 오늘 출근 기록이 없습니다.`);
    if (hasLock) return no('working', `${member}님은 지금 업무 중(또는 휴식 중)입니다. 업무를 먼저 종료하세요.`);
    if (hasRecords) return no('has-records', `${member}님은 오늘 업무 기록이 있어 출근을 취소할 수 없습니다. 퇴근 처리하거나 업무 기록을 먼저 지우세요.`);
    const other = (Array.isArray(leaves) ? leaves : []).filter(e => e && e.member === member && !(e.type === '지각' && e.auto));
    if (other.length) return no('has-leave', `${member}님은 오늘 근태(${[...new Set(other.map(e => e.type))].join('·')})가 있습니다. 근태를 먼저 취소하세요.`);
    if (!isAdmin) {
        const a = 분값(attendance.inTime), b = 분값(now);
        // 음수(출근 시각이 지금보다 늦게 찍힘 — 다른 PC 시계·시각 수정)도 막는다
        if (a == null || b == null || b - a < 0 || b - a > CLOCK_IN_CANCEL_SELF_MIN) {
            return no('too-late', `출근 후 ${CLOCK_IN_CANCEL_SELF_MIN}분이 지나 본인은 취소할 수 없습니다. 관리자에게 요청하세요.`);
        }
    }
    return { ok: true };
}
