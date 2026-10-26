// === js/lib/planned-prefill.js ===
// 오늘 '처리량 수정'·'오늘의 처리량 입력' 창을 열 때, 처리량이 비어 있는 업무에 미리 저장해 둔 예정 물량을 채운다(2026-10-26 사용자 결정).
// 채운 값은 [저장]을 눌러야 실제 처리량이 된다 — 창이 색·안내로 '예정값' 임을 보여 준다(ui-modals.js applyPlannedPrefill).
// 순수 함수(브라우저·Firebase 없음) — tests/planned-prefill.test.js.
//
// 채우는 조건(모두 만족):
//   · 처리량 업무 목록(quantityTaskTypes)에 있는 업무 — 부르는 쪽이 '오늘 작업 기록이 있는 업무'만 넘긴다(2026-10-26 사용자 결정:
//     아직 안 한 업무까지 채우면 그대로 저장했을 때 예정값이 실적이 되고 진행률·미입력 경고가 틀어진다). doneTasksOf 참고.
//   · 지금 처리량이 비었거나 0 (0건 확인 체크한 업무는 제외 — 사람이 0 으로 확정한 것)
//   · 예정 물량이 0 보다 큰 수 (0 으로 지정한 예정은 채울 것이 없다)
//   · 그 업무의 옛 이름 칸에 값이 없다 — canon(이름) = 지금 이름(lib/task-alias-view.js aliasTaskName). 이름을 바꾼 날 같은 물량이 두 번 들어가지 않게
//     (처리량자동입력 입력.py 의 '옛 이름 칸에 값 있음' 과 같은 기준)

const blank = (v) => v == null || v === '' || Number(v) === 0 || !Number.isFinite(Number(v));

/** 오늘 작업 기록이 있는 처리량 업무(지금 이름 기준). records = workRecords, canon = 지금 이름으로 바꾸는 함수. */
export function doneTasksOf(records, quantityTaskTypes, canon = (n) => n) {
    const done = new Set((Array.isArray(records) ? records : []).map(r => r && r.task).filter(Boolean).map(canon));
    return (Array.isArray(quantityTaskTypes) ? quantityTaskTypes : []).filter(t => done.has(t));
}

/** → { [업무]: 예정값 } — 채울 업무만. */
export function plannedPrefill(quantities, planned, confirmedZeroTasks, quantityTaskTypes, canon = (n) => n) {
    const out = {};
    const q = (quantities && typeof quantities === 'object') ? quantities : {};
    const p = (planned && typeof planned === 'object') ? planned : {};
    const zero = new Set(Array.isArray(confirmedZeroTasks) ? confirmedZeroTasks : []);
    (Array.isArray(quantityTaskTypes) ? quantityTaskTypes : []).forEach(task => {
        if (zero.has(task) || !blank(q[task])) return;
        if (Object.keys(q).some(k => k !== task && canon(k) === task && !blank(q[k]))) return;
        const n = Number(p[task]);
        if (Number.isFinite(n) && n > 0) out[task] = Math.round(n);
    });
    return out;
}
