// === js/lib/cal-reminder.js ===
// 업무 캘린더 일정의 미리 알림 — 순수 함수(화면·Firestore 없음).
//   화면(js/widget-calendar.js)은 알림 시각(at)을 계산해 일정 문서에 저장만 하고,
//   이 PC 예약작업(앱\캘린더알림\알림.py)이 at 이 된 알림을 앱 알림(종)·슬랙으로 보낸다.
//
// 일정 문서에 더하는 칸:
//   uid          일정 고유값 — 시작일이 바뀌어 문서 ID 가 바뀌어도 그대로(서버 발송 기록 키)
//   reminders    [{ rid, rel, at }]  rel = 보기 코드, at = 한국시간 'YYYY-MM-DD HH:mm'(글자 순서 = 시간 순서)
//   remindTo     { mode: 'me'|'team'|'pick', names: [...] }  team 은 서버가 보낼 때 재직자로 푼다
//   remindHours  알림 시각을 시간 단위로 묶은 목록 ['YYYY-MM-DD HH', …] — 서버가 '지금 근처 몇 시간'만
//                array-contains-any 로 조회한다(먼 날 알림이 걸린 일정을 5분마다 읽지 않게). 알림이 없으면 칸을 뺀다.
//   remindLastAt 가장 늦은 at(참고용)
//
// 시각 계산은 한국시간 +9 고정(js/lib/kst-time.js 와 같은 생각) — PC 시간대 설정과 상관없다.

export const MAX_REMINDERS = 5;

// needTime: 일정에 시간이 있어야 고를 수 있는 보기
export const REL_OPTIONS = [
    { rel: 'B0',        label: '정시',            needTime: true },
    { rel: 'B10',       label: '10분 전',         needTime: true },
    { rel: 'B30',       label: '30분 전',         needTime: true },
    { rel: 'B60',       label: '1시간 전',        needTime: true },
    { rel: 'D0@09:00',  label: '당일 오전 9시' },
    { rel: 'D-1@17:00', label: '전날 오후 5시' },
    { rel: 'D-1@09:00', label: '전날 오전 9시' },
    { rel: 'ABS',       label: '날짜·시각 직접 지정' }
];

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const p2 = (n) => String(n).padStart(2, '0');
const AT_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;

// 'YYYY-MM-DD HH:mm' ↔ 시간대 없는 ms(UTC 로 셈만 한다)
function toMs(at) {
    const m = AT_RE.exec(String(at || '').trim());
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) : NaN;
}
function fromMs(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 'YYYY-MM-DDTHH:mm'(datetime-local) 또는 'YYYY-MM-DD HH:mm' → 'YYYY-MM-DD HH:mm'. 아니면 '' */
export function normalizeAt(s) {
    const ms = toMs(s);
    return Number.isFinite(ms) ? fromMs(ms) : '';
}

/** 지금 한국시간 'YYYY-MM-DD HH:mm' */
export function nowKst(nowMs = Date.now()) {
    return fromMs(nowMs + KST_OFFSET_MS);
}

export const relOption = (rel) => REL_OPTIONS.find(o => o.rel === rel) || null;

/** 보기 코드로 알림 시각 계산. ABS·알 수 없는 코드·시간이 필요한데 없으면 '' */
export function computeAt(rel, date, time) {
    const dm = DATE_RE.exec(String(date || ''));
    if (!dm) return '';
    const day0 = Date.UTC(+dm[1], +dm[2] - 1, +dm[3]);
    let m = /^B(\d+)$/.exec(rel || '');
    if (m) {
        const tm = TIME_RE.exec(String(time || ''));
        if (!tm) return '';
        return fromMs(day0 + ((+tm[1]) * 60 + (+tm[2]) - (+m[1])) * 60000);
    }
    m = /^D(-?\d+)@(\d{2}):(\d{2})$/.exec(rel || '');
    if (m) return fromMs(day0 + (+m[1]) * 86400000 + ((+m[2]) * 60 + (+m[3])) * 60000);
    return '';
}

let seq = 0;
/** 짧은 고유값(prefix_랜덤) */
export function newId(prefix) {
    seq = (seq + 1) % 1296;
    return `${prefix}_${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}${seq.toString(36)}`;
}

/** 일정이 끝난 시각 — 시간 있는 하루 일정은 시작 시각, 아니면 종료일 23:59(서버 규칙.py event_over 와 같다) */
export function eventOverAt(ev) {
    const date = ev?.date || '';
    let end = ev?.endDate || date;
    if (end < date) end = date;
    if (ev?.time && end === date) return `${date} ${ev.time}`;
    return end ? `${end} 23:59` : '';
}

/** reminders → remindHours (중복 없이, 시간순) */
export function remindHoursOf(reminders) {
    return [...new Set((reminders || []).map(r => String(r.at || '').slice(0, 13)).filter(h => h.length === 13))].sort();
}

/**
 * 모달 줄 → 저장할 reminders.
 *   rows: [{ rid?, rel, abs? }]  abs = ABS 줄의 입력값(datetime-local)
 *   ev:   { date, endDate, time }  일정 시작일·종료일·시간
 *   prev: 저장돼 있던 reminders — 이미 지난 옛 줄(rid·at 같음)은 그대로 둔다
 * 새로 넣었거나 시각이 바뀐 줄이 이미 지난 시각이거나 일정이 끝난 뒤(eventOverAt)면 오류. 같은 시각은 하나만 남긴다.
 * 이미 지난 옛 줄은 다시 계산할 수 없어도(시간을 지움 등) 그대로 둔다 — 지난 알림 때문에 수정이 막히지 않게.
 * @returns {{ reminders, remindLastAt, remindHours, errors: string[] }}
 */
export function buildReminders(rows, ev, prev = [], now = nowKst()) {
    const errors = [];
    const prevAt = new Map((prev || []).map(r => [r.rid, r.at]));
    const over = eventOverAt(ev);
    const out = [];
    const seen = new Set();
    for (const row of rows || []) {
        const opt = relOption(row.rel);
        if (!opt) continue;
        let at;
        if (opt.rel === 'ABS') {
            at = normalizeAt(row.abs);
            if (!at) { errors.push('직접 지정한 알림의 날짜·시각을 넣어주세요.'); continue; }
        } else {
            at = computeAt(opt.rel, ev.date, ev.time);
            const old = row.rid ? prevAt.get(row.rid) : '';
            if (!at && old && old <= now) at = old;   // 이미 지난 옛 줄 — 그대로 둔다
            if (!at) {
                errors.push(`'${opt.label}' 알림은 일정 시간이 있어야 합니다. 시간을 넣거나 알림을 바꾸세요.`);
                continue;
            }
        }
        const rid = row.rid || newId('r');
        const unchanged = row.rid && prevAt.get(row.rid) === at;
        if (!unchanged && at <= now) {
            errors.push(`알림 시각 ${shortAt(at)} 은 이미 지났습니다.`);
            continue;
        }
        if (!unchanged && over && at > over) {
            errors.push(`알림 시각 ${shortAt(at)} 이 일정${ev.time && (ev.endDate || ev.date) === ev.date ? ' 시작' : '이 끝난'} 뒤입니다.`);
            continue;
        }
        if (seen.has(at)) continue;
        seen.add(at);
        out.push({ rid, rel: opt.rel, at });
    }
    if (out.length > MAX_REMINDERS) errors.push(`알림은 ${MAX_REMINDERS}개까지 걸 수 있습니다.`);
    out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return { reminders: out, remindLastAt: out.length ? out[out.length - 1].at : '', remindHours: remindHoursOf(out), errors };
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
/** 'YYYY-MM-DD HH:mm' → '11/05(수) 13:30' */
export function shortAt(at) {
    const ms = toMs(at);
    if (!Number.isFinite(ms)) return String(at || '');
    const d = new Date(ms);
    return `${d.getUTCMonth() + 1}/${p2(d.getUTCDate())}(${DOW[d.getUTCDay()]}) ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 받는 사람 한 줄 — 화면·슬랙 공용(이름은 넣지 않는다) */
export function recipientsLabel(remindTo) {
    const mode = remindTo?.mode || 'me';
    if (mode === 'team') return '팀 전체';
    if (mode === 'pick') return `지정 ${(remindTo?.names || []).length}명`;
    return '등록자 본인';
}

/** 일정에 걸린 알림 요약(마우스 올림 글) — 알림이 없으면 '' */
export function reminderSummary(ev, now = nowKst()) {
    const list = Array.isArray(ev?.reminders) ? ev.reminders : [];
    if (!list.length) return '';
    const left = list.filter(r => r.at > now).length;
    const parts = [`알림 ${list.length}개`];
    if (left < list.length) parts.push(left ? `남은 ${left}개` : '모두 지남');
    parts.push(recipientsLabel(ev.remindTo));
    return parts.join(' · ');
}

/** 저장 직전 받는 사람 정리 — me 는 지금 사용자, pick 은 고른 이름(중복 제거), team 은 빈 목록 */
export function buildRemindTo(mode, picked, currentUser) {
    if (mode === 'team') return { mode: 'team', names: [] };
    if (mode === 'pick') return { mode: 'pick', names: [...new Set((picked || []).filter(Boolean))] };
    return { mode: 'me', names: currentUser ? [currentUser] : [] };
}
