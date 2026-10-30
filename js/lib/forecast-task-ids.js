// === js/lib/forecast-task-ids.js ===
// 업무 예상(ui-history-prediction.js)이 쓰는 시스템 업무 기본값 — 업무 이름 대신 고정 id 로 적고,
// 쓸 때 설정(cfg)의 지금 이름으로 바꾼다(업무 id 2단계 4단계, 2026-10-30).
// 왜: 코드에 '국내배송' 같은 이름을 적어 두면 설정·관리에서 이름을 바꿨을 때 업무 예상이 조용히 그 업무를 못 찾는다.
// 규칙: 이름이 그대로면(또는 taskIdNames 가 없거나 비면) 모든 값이 예전 이름 표와 똑같다 — tests/forecast-task-ids.test.js 가 확인.
// ⚠️ 관리자 설정값(simTimeTaskDeps·simAutoModes 등 이름 칸)은 여기서 다루지 않는다 — 부르는 쪽이 설정을 먼저 보고, 없을 때만 이 기본값.
// ※ 순수 모듈(DOM·Firebase 없음).

import { TASK, SYSTEM_TASKS, taskNameOf, isTask } from './task-ids.js?v=202610301845';

/** 업무 예상의 기존 10개. id 는 화면 칸(sim-qty-<id>)용 짧은 이름, taskId 는 업무 id.
 *  자동값 규칙: ai=국내배송 예측 / incoming=입고일정 / china-linked=그날 도착 패킹의 샘플검수 장수(없으면 중국제작 입고량×검수비율)
 *               cadence=빈도형 / last7=지난 7회 업무량 평균 */
export const LEGACY_SIM_TASKS = Object.freeze([
    { id: 'domestic', taskId: TASK.domestic, auto: 'ai' },
    { id: 'china',    taskId: TASK.china,    auto: 'incoming' },
    { id: 'sample',   taskId: TASK.sample,   auto: 'china-linked' },
    { id: 'direct',   taskId: TASK.direct,   auto: 'cadence' },
    { id: 'ably',     taskId: TASK.ably,     auto: 'cadence' },
    // 채우기도 빈도형으로 본다 — 요일 하나로는 안 잡히지만(월·화·수 중심),
    // '마지막 진행 후 며칠째'를 함께 보면 잡힌다(어제 했으면 75%, 이틀 쉬면 10%, 사흘 쉬면 86%).
    { id: 'fill',     taskId: TASK.fill,     auto: 'cadence' },
    // 아래 넷도 매일 하는 업무가 아니다 — 빈도형으로 본다(표본이 모자라면 안에서 지난 7회 평균으로 물러난다)
    { id: 'return',   taskId: TASK.return,   auto: 'cadence' },
    { id: 'full',     taskId: TASK.full,     auto: 'cadence' },
    { id: 'other',    taskId: TASK.other,    auto: 'cadence' },
    { id: 'localprod',taskId: TASK.localprod, auto: 'cadence' }
].map(Object.freeze));

/** 기존 10개 — key·label 은 cfg 의 지금 이름(새 객체 배열) */
export const legacySimTasksOf = (cfg) => LEGACY_SIM_TASKS.map(t => {
    const n = taskNameOf(t.taskId, cfg);
    return { ...t, key: n, label: n };
});

/** 업무 id 배열 → 지금 이름 배열 */
export const namesOf = (ids, cfg) => ids.map(id => taskNameOf(id, cfg));

/** 시스템 업무 id → 기본 이름(부분일치 판단용) */
const DEFAULT_NAME_OF = Object.freeze(Object.fromEntries(Object.entries(SYSTEM_TASKS).map(([n, id]) => [id, n])));

// ── 시간형 업무 목록에서 빼는 것 ──────────────────────────────────────
// 근태로 이미 가용 인원에서 빠지는 항목 · 시뮬레이션 대상이 아닌 항목.
// 업무(매장근무·교육)는 id 로 지금 이름을 얻고, 근태 글자(출장·연차·휴직·결근)는 업무가 아니라 그대로 둔다.
export const TIME_TASK_EXCLUDE_IDS = Object.freeze([TASK.store, TASK.training]);
export const TIME_TASK_EXCLUDE_LEAVE = Object.freeze(['출장', '연차', '휴직', '결근']);
export const timeTaskExcludeOf = (cfg) => new Set([...namesOf(TIME_TASK_EXCLUDE_IDS, cfg), ...TIME_TASK_EXCLUDE_LEAVE]);

// ── 기본 목록(설정이 배열이 아니면 쓰는 값) — 업무 id ────────────────────────
/** 늘 보여야 하는 주요 업무(simAlwaysShowTasks 기본값) */
export const DEFAULT_SIM_ALWAYS_TASKS = Object.freeze([TASK.domestic, TASK.direct, TASK.ably, TASK.china]);
/** 기본 0명으로 두는 업무(simTimeTasksZero 기본값) */
export const DEFAULT_SIM_ZERO_TASKS = Object.freeze([TASK.cleaning, TASK.angle]);
/** 업무 예상에서 빼는 업무(forecastExcludedTasks 기본값) */
export const DEFAULT_FORECAST_EXCLUDED_TASKS = Object.freeze([TASK.admin]);
/** '다음날 상차'를 만드는 출고 업무(simLoadoutSources 기본값) */
export const DEFAULT_LOADOUT_SOURCES = Object.freeze([TASK.direct, TASK.ably]);
/** '전날 준비 → 다음 근무일 출고' 인 담당 업무(simTimeTaskDepsNextDay 기본값) */
export const DEFAULT_TIME_TASK_DEPS_NEXTDAY = Object.freeze([TASK.directPrep]);

// ── 자동 추정 방식(simAutoModes 기본값) ─────────────────────────────
/** { 업무 id: [모드, 연동 업무 id] } — 'incoming-boxes:<중국제작 지금 이름>' 처럼 쓴다 */
export const DEFAULT_SIM_AUTO_MODES = Object.freeze({ [TASK.loadunload]: Object.freeze(['incoming-boxes', TASK.china]) });
/** 업무 이름의 기본 추정 방식 문자열. 기본값이 없으면 '' */
export function defaultAutoModeOf(key, cfg) {
    for (const [id, [mode, argId]] of Object.entries(DEFAULT_SIM_AUTO_MODES)) {
        if (isTask(key, id, cfg)) return `${mode}:${taskNameOf(argId, cfg)}`;
    }
    return '';
}

// ── 물량 업무와 묶인 담당 업무(simTimeTaskDeps 기본값) ────────────────────
/** { 담당 업무 id: [물량 업무 id] } */
export const DEFAULT_TIME_TASK_DEPS = Object.freeze({
    [TASK.chinaOwner]: Object.freeze([TASK.china]),
    [TASK.directPrep]: Object.freeze([TASK.direct, TASK.ably])
});
/** 담당 업무 이름 → 묶인 물량 업무 지금 이름 배열(새 배열). 기본 표에 없으면 이름에 기존 10개의 이름이 들어간 경우를 잇는다.
 *  ⚠️ 부분일치는 기존 10개로만, **기본 이름 기준으로만** 본다(이름을 바꿔도 'OO 사전작업' 같은 기존 담당 업무 연결이 그대로).
 *     목록 전체를 대상으로 하면 새로 편입된 업무에 우연히 이름이 걸려, 그 업무 물량이 0인 날 시간이 통째로 사라진다. */
export function defaultTimeTaskDepsOf(taskKey, cfg) {
    for (const [id, deps] of Object.entries(DEFAULT_TIME_TASK_DEPS)) {
        if (isTask(taskKey, id, cfg)) return namesOf(deps, cfg);
    }
    const key = String(taskKey == null ? '' : taskKey);
    const hit = LEGACY_SIM_TASKS.find(t => {
        const base = DEFAULT_NAME_OF[t.taskId];
        return key !== base && key !== taskNameOf(t.taskId, cfg) && key.includes(base);
    });
    return hit ? [taskNameOf(hit.taskId, cfg)] : [];
}

/** 기본값으로 '다음 근무일' 담당 업무인가 */
export const isDefaultNextDayDep = (taskKey, cfg) => DEFAULT_TIME_TASK_DEPS_NEXTDAY.some(id => isTask(taskKey, id, cfg));

// ── 선행 업무(simPrecursorTasks 기본값) ────────────────────────────
/** { 물량 업무 id: [선행 업무 id] } */
export const DEFAULT_SIM_PRECURSORS = Object.freeze({
    [TASK.direct]: Object.freeze([TASK.directPrep]),
    [TASK.ably]: Object.freeze([TASK.directPrep])
});
/** 지금 이름 키·값의 선행 업무 표(새 객체) */
export function defaultPrecursorMapOf(cfg) {
    const out = {};
    Object.entries(DEFAULT_SIM_PRECURSORS).forEach(([q, pres]) => { out[taskNameOf(q, cfg)] = namesOf(pres, cfg); });
    return out;
}

/** 전송값을 쓰는 업무(직진·에이블리)의 업무 id — 그 밖은 '' (js/lib/ship-transmit.js 소스 표 키) */
export const transmitTaskIdOf = (taskKey, cfg) =>
    isTask(taskKey, TASK.direct, cfg) ? TASK.direct : (isTask(taskKey, TASK.ably, cfg) ? TASK.ably : '');
