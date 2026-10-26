// === js/lib/milestone-tasks.js ===
// 운영 마일스톤의 '영향 업무'(affectedTasks)를 지금 이름으로 맞춘다(업무 id 3단계 후속, 2026-10-21).
// 왜: 마일스톤은 업무 이름을 그대로 저장하고, 기록과는 이름 '포함' 여부로 맞춘다.
//     업무 이름을 바꾸면 옛 이름 필터가 새 이름 기록을(또는 반대로) 못 잡는다.
// 규칙: 필터·기록 이름을 둘 다 canonical(지금 이름)로 바꾼 뒤 — 정확히 같으면 맞음, 아니면 기존처럼 포함 여부.
//       별칭이 없으면 aliasTaskName 이 이름을 그대로 돌려주므로 기존 동작(name.includes(t))과 똑같다.
// 저장된 마일스톤은 고치지 않는다 — 편집 화면에서 저장할 때 지금 이름으로 저장된다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/milestone-tasks.test.js

import { aliasTaskName } from './task-alias-view.js?v=202610261142';

/** 마일스톤 업무 필터 → 지금 이름 목록. 비었거나 배열이 아니면 [].
 *  바뀐 이름이 없으면 원본 배열 그대로(중복 제거도 하지 않음 — 기존 동작 유지), 바뀌었으면 중복 제거한 새 배열. */
export function milestoneTaskFilter(tasks, cfg) {
    if (!Array.isArray(tasks) || tasks.length === 0) return [];
    const mapped = tasks.map(t => aliasTaskName(t, cfg));
    if (mapped.every((t, i) => t === tasks[i])) return tasks;
    return [...new Set(mapped)];
}

/** 기록 이름(업무명·물량 키) name 이 필터 이름 t 에 해당하는가. 지금 이름 정확 일치 우선, 아니면 포함 여부. */
export function milestoneTaskMatch(name, t, cfg) {
    if (!name || typeof name !== 'string' || typeof t !== 'string') return false;
    const a = aliasTaskName(name, cfg);
    const b = aliasTaskName(t, cfg);
    return a === b || a.includes(b);
}

/** 화면·결산 보고용 마일스톤 사본 — affectedTasks 만 지금 이름으로. 바뀐 것이 없으면 원본 그대로. */
export function milestoneView(m, cfg) {
    if (!m || !Array.isArray(m.affectedTasks)) return m;
    const tasks = milestoneTaskFilter(m.affectedTasks, cfg);
    return tasks === m.affectedTasks || (tasks.length === 0 && m.affectedTasks.length === 0) ? m : { ...m, affectedTasks: tasks };
}
