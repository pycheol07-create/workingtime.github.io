// === js/lib/history-delete-text.js ===
// 데이터 관리 '날짜 삭제' 확인창 문구 — 무엇을(대상) 몇 건(countText) 지우는지. (2026-10-20, 데이터관리 개선 8번)
//   문구 형식: '다음을 삭제합니다: YYYY-MM-DD · 대상 (건수)' — 대상마다 받침이 달라 조사(을/를)를 붙이지 않는다.
//
//   지우는 범위는 listeners-history.js 의 [예, 삭제합니다] 와 같아야 한다(탭별로 지우는 필드):
//     work/report → workRecords·taskQuantities(·partTimers·confirmedZeroTasks)
//     attendance  → onLeaveMembers      management → management      inspection → inspectionList
//   · 근태 목록에는 leaveSchedule 에서 펼쳐 넣은 사본(__fromSchedule)이 섞여 있다. 삭제가 지우지 않으므로 세지 않는다.
//   · 경영 지표의 시각 값(fxAt 등 …At)은 지표가 아니라서 세지 않는다.
// 순수 모듈(DOM/Firebase 의존 없음).

const TARGETS = {
    work: '업무 이력(처리량 포함)',
    report: '업무 이력(처리량 포함)',
    attendance: '근태 이력',
    management: '경영 지표',
    inspection: '검수 이력',
};

const asList = (v) => (Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []));
const positive = (v) => Number.isFinite(Number(v)) && Number(v) > 0;

/** 이력 한 날(entry)과 탭으로 확인창 문구 조각을 만든다. entry 가 없으면 0건으로 센다.
 *  @returns {{ target: string, countText: string }} */
export function deletionSummary(entry, tab) {
    const day = entry || {};
    const t = TARGETS[tab] ? tab : null;
    if (!t) return { target: '모든 데이터', countText: '' };

    if (t === 'work' || t === 'report') {
        const records = asList(day.workRecords).filter(Boolean).length;
        const qtys = Object.values(day.taskQuantities || {}).filter(positive).length;
        return { target: TARGETS[t], countText: `기록 ${records}건 · 처리량 ${qtys}종` };
    }
    if (t === 'attendance') {
        const names = new Set(asList(day.onLeaveMembers)
            .filter(e => e && !e.__fromSchedule && e.member)
            .map(e => e.member));
        return { target: TARGETS[t], countText: `휴무 ${names.size}명` };
    }
    if (t === 'management') {
        const m = day.management && typeof day.management === 'object' ? day.management : {};
        const cells = Object.entries(m)
            .filter(([k, v]) => !/At$/.test(k) && typeof v !== 'boolean' && v !== '' && v != null && Number(v) !== 0 && Number.isFinite(Number(v)))
            .length;
        return { target: TARGETS[t], countText: `지표 ${cells}칸` };
    }
    // inspection
    return { target: TARGETS[t], countText: `검수 ${asList(day.inspectionList).filter(Boolean).length}건` };
}

/** 확인 문구에서 날짜 뒤에 붙는 부분: ' · 대상 (건수)'. 건수가 없으면 ' · 대상'. */
export function deletionDetail({ target, countText } = {}) {
    return ` · ${target || '모든 데이터'}${countText ? ` (${countText})` : ''}`;
}
