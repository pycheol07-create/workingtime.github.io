// js/lib/my-work.js
//
// 대시보드 맨 위 '내 업무' 줄(UX 개선 1~3번, 2026-10-16)이 쓰는 순수 계산.
//   - myWorkState   : 지금 내 상태(출근 전 / 대기 / 업무 중 / 휴식 / 퇴근 / 근태)와 진행 중 기록
//   - recentTasksFor: 내가 최근 한 업무 3~5개(오늘 기록 → 지난 이력 순, 중복 없이)
//
// 화면·Firestore 에 손대지 않는다 — 입력은 appState 조각과 이력 배열뿐이다(tests/my-work.test.js).
// 근태 판정 규칙은 ui-main-board.js 의 팀원 카드와 같다:
//   외출은 endTime 이 있으면 이미 복귀, 지각은 이벤트성 기록이라 '근태 중' 이 아니다.

/** 지금 근태 중인 기록(외출 복귀·지각 제외). 없으면 null. */
export const currentLeaveOf = (member, dailyLeaves = [], dateLeaves = []) => {
    const all = [...(Array.isArray(dailyLeaves) ? dailyLeaves : []), ...(Array.isArray(dateLeaves) ? dateLeaves : [])];
    return all.find(l => l && l.member === member && !(l.type === '외출' && l.endTime) && l.type !== '지각') || null;
};

/**
 * 내 상태.
 * @returns {{ state: 'none'|'before'|'idle'|'working'|'paused'|'returned'|'leave',
 *             record: object|null, leave: object|null }}
 *   none     — 로그인 전(이름 없음)
 *   before   — 출근 기록 없음
 *   idle     — 출근, 진행 중 업무 없음
 *   working  — 진행 중(ongoing) 기록 있음
 *   paused   — 휴식(paused) 기록 있음
 *   returned — 퇴근 완료
 *   leave    — 근태(연차·외출 등) 중
 * 진행 기록이 근태보다 앞선다(팀원 현황판은 근태를 먼저 보지만, 여기서는 [휴식][종료] 를 보여 줘야 한다).
 */
export const myWorkState = (member, appState = {}) => {
    if (!member) return { state: 'none', record: null, leave: null };
    const recs = Array.isArray(appState.workRecords) ? appState.workRecords : [];
    const ongoing = recs.find(r => r && r.member === member && r.status === 'ongoing');
    const paused = recs.find(r => r && r.member === member && r.status === 'paused');
    const leave = currentLeaveOf(member, appState.dailyOnLeaveMembers, appState.dateBasedOnLeaveMembers);
    if (ongoing) return { state: 'working', record: ongoing, leave };
    if (paused) return { state: 'paused', record: paused, leave };
    if (leave) return { state: 'leave', record: null, leave };
    const st = appState.dailyAttendance?.[member]?.status;
    if (st === 'active') return { state: 'idle', record: null, leave: null };
    if (st === 'returned') return { state: 'returned', record: null, leave: null };
    return { state: 'before', record: null, leave: null };
};

/**
 * 내가 최근 한 업무(중복 없이 최근 것부터 최대 limit 개).
 * @param {string} member
 * @param {Array} todayRecords  오늘 workRecords (상태 무관 — 진행 중도 '최근 한 업무' 다)
 * @param {Array} historyDays   [{ id:'YYYY-MM-DD', workRecords:[...] }] (순서 무관 — 날짜 내림차순으로 다시 정렬)
 * @param {object} [opt]
 * @param {number} [opt.limit=5]
 * @param {string} [opt.today]  이 날짜(오늘)의 이력 행은 건너뛴다 — 오늘 기록은 todayRecords 가 최신이다
 * @param {(task:string)=>boolean} [opt.isValid]  지금도 있는 업무만 남길 때(관리자가 지운 업무 제외)
 */
export const recentTasksFor = (member, todayRecords = [], historyDays = [], opt = {}) => {
    const limit = Math.max(0, opt.limit == null ? 5 : opt.limit);
    const isValid = typeof opt.isValid === 'function' ? opt.isValid : () => true;
    const out = [];
    const seen = new Set();
    const take = (task) => {
        if (!task || seen.has(task) || !isValid(task)) return;
        seen.add(task);
        out.push(task);
    };
    // 같은 날 안에서는 시작시각이 늦은 것이 더 최근이다
    const byLatest = (a, b) => String(b.startTime || '').localeCompare(String(a.startTime || ''));
    const mine = (recs) => (Array.isArray(recs) ? recs : []).filter(r => r && r.member === member && r.task);

    mine(todayRecords).sort(byLatest).forEach(r => take(r.task));
    if (out.length >= limit) return out.slice(0, limit);

    const days = (Array.isArray(historyDays) ? historyDays : [])
        .filter(d => d && d.id && d.id !== opt.today)
        .sort((a, b) => String(b.id).localeCompare(String(a.id)));
    for (const d of days) {
        mine(d.workRecords).sort(byLatest).forEach(r => take(r.task));
        if (out.length >= limit) break;
    }
    return out.slice(0, limit);
};
