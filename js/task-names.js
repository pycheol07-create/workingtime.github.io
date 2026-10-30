// === js/task-names.js ===
// 화면 파일용 시스템 업무 이름 — 코드에 업무 이름을 적지 않고 고정 id(TASK.xxx)로 지금 이름을 얻는다(업무 id 2단계, 2026-10-30).
// 왜: 설정·관리에서 업무 이름을 바꾸면 코드 속 '샘플검수' 같은 글자 비교가 조용히 안 맞게 된다.
// lib(순수 모듈)는 cfg 를 인자로 받는 task-ids.js · task-alias-view.js 를 직접 쓰고, js/ 화면 파일은 이것(State.appConfig 묶음)을 쓴다.
import * as State from './state.js?v=202610301817';
import { TASK, SYSTEM_TASKS, taskNameOf, isTask } from './lib/task-ids.js?v=202610301817';
import { taskQtyOf } from './lib/task-alias-view.js?v=202610301817';

export { TASK };

/** 시스템 업무 id → 지금 이름 */
export const tName = (id) => taskNameOf(id, State.appConfig);
/** 이름(옛 이름 포함)이 그 시스템 업무인가 */
export const isT = (name, id) => isTask(name, id, State.appConfig);
/** 이름 키 맵(taskQuantities 등)에서 그 업무 값 — 지금 이름 칸 먼저, 없으면 옛 이름 칸 */
export const tQty = (map, id) => taskQtyOf(map, id, State.appConfig);

const DEFAULT_NAME_OF = Object.freeze(Object.fromEntries(Object.entries(SYSTEM_TASKS).map(([n, id]) => [id, n])));
/** 분석 화면의 부분일치 묶음 — 그 업무(옛 이름 포함)이거나, 이름에 **기본 이름**이 들어 있으면 true
 *  (예: '국내배송 포장' → 국내배송 묶음). 이름을 바꿔도 예전 부분일치 묶음이 그대로 간다. 업무 id 2단계. */
export const isTLike = (name, id) => {
    if (!name) return false;
    if (isT(name, id)) return true;
    const base = DEFAULT_NAME_OF[id];
    return !!base && String(name).includes(base);
};
