// === js/lib/cal-daily-leave.js ===
// 업무 캘린더에 '당일 근태'(외출·조퇴·지각)를 그리기 위한 순수 함수(2026-11-20).
//   기간형 근태(연차 등)는 persistent_data/leaveSchedule 에 있어 원래부터 달력에 나왔지만,
//   당일 근태는 그날 daily_data(마감 뒤에는 history/{날짜})의 onLeaveMembers 에만 있어 빠져 있었다.
//   오늘 것은 실시간 값(appState.dailyOnLeaveMembers), 지난 날짜는 history 문서에서 읽는다(읽기만).

const pad = (n) => String(n).padStart(2, '0');
const ymdOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 시각 꼴만 남긴다('9:05' → '09:05'). 꼴이 아니면 '' */
function clock(v) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(v || '').trim());
    return m ? `${pad(Number(m[1]))}:${m[2]}` : '';
}

/** 달력 한 줄 이름 — '홍길동 외출 13:00~14:30' · '홍길동 조퇴 16:00' · '홍길동 지각 09:12' */
export function dailyLeaveLabel(l) {
    const st = clock(l.startTime), et = clock(l.endTime);
    const time = st ? (et ? `${st}~${et}` : st) : '';
    return `${l.member} ${l.type}${time ? ' ' + time : ''}`;
}

/**
 * 날짜별 onLeaveMembers → 달력 구간 목록(하루짜리, 읽기 전용).
 * @param {Object<string, Array>} byDate  { 'YYYY-MM-DD': onLeaveMembers[] }
 * @param {string[]} types  당일 근태 종류(state.TIME_BASED_LEAVE_TYPES)
 * @param {{today?:string, now?:string}} [opt]  오늘 날짜·지금 시각 — 오늘의 늦은 외출·조퇴는 '예정'으로 표시
 */
export function dailyLeaveRanges(byDate, types, opt = {}) {
    const out = [];
    const seen = new Set();
    Object.keys(byDate || {}).sort().forEach(date => {
        const list = Array.isArray(byDate[date]) ? byDate[date] : [];
        list.forEach((l, i) => {
            if (!l || !l.member || !types.includes(l.type)) return;
            const label = dailyLeaveLabel(l);
            const key = date + '|' + label;
            if (seen.has(key)) return;   // 같은 날 같은 줄이 두 번 저장돼 있으면 한 번만
            seen.add(key);
            const st = clock(l.startTime);
            const planned = date === opt.today && opt.now && st && st > opt.now && l.type !== '지각';
            out.push({
                kind: 'dleave',
                id: `dl-${date}-${l.id || i}`,
                label,
                sub: planned ? '당일 근태 예정(근태 설정에서 고침)' : '당일 근태(근태 설정에서 고침)',
                start: date, end: date, editable: false
            });
        });
    });
    return out;
}

/**
 * 보고 있는 달에 필요한 '지난 날짜' 범위 — 달 앞뒤 7일(달력 격자의 앞뒤 칸)까지, 어제까지만.
 * 오늘·미래는 history 에 없으므로 읽지 않는다. 읽을 날이 없으면 null.
 */
export function pastRangeForMonth(monthDate, today) {
    const from = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1 - 7);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0 + 7);
    const t = new Date(today + 'T00:00:00');
    t.setDate(t.getDate() - 1);
    const to = end < t ? end : t;
    const f = ymdOf(from), e = ymdOf(to);
    return f <= e ? { from: f, to: e } : null;
}
