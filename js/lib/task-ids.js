// === js/lib/task-ids.js ===
// 업무 id — 업무 이름을 바꿔도 주요 업무·처리량·위젯 연결·원가·예측 설정이 따라가게 한다(업무 id 1단계, 2026-10-21).
// 왜: 업무에 id 가 없고 이름이 키라, 설정·관리에서 이름을 바꾸면 keyTasks 등에 옛 이름이 남아 저장이 거부되고
//     quantityToDashboardMap 은 옛 키로 남아 위젯 연동이 조용히 끊겼다.
// 저장 모양(mainConfig): taskIdNames {id: 현재이름}, taskAliases {옛이름: id}. 기존 이름 필드는 그대로 두되
//   저장 때 id 기준으로 다시 만든 사본이 된다. 과거 기록(이름 키)은 그대로 두고 canonicalTaskName 으로 합쳐 본다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/task-ids.test.js

/** 프로그램이 이 이름으로 계산하는 업무 — 이름 변경 잠금, id 고정.
 *  ui-history-prediction.js LEGACY_SIM_TASKS 의 key 를 모두 포함해야 한다(테스트가 확인).
 *  그 밖에 코드가 이름으로 계산하는 것: 오류(ui-history-productivity.js 채우기·오류 분석),
 *  중국제작(담당)(예측 DEFAULT_TIME_TASK_DEPS), 청소·앵글정리(예측 DEFAULT_SIM_ZERO_TASKS),
 *  매장근무·교육(예측 TIME_TASK_EXCLUDE). */
export const LOCKED_TASKS = Object.freeze({
    '국내배송': 'k_domestic',
    '중국제작': 'k_china',
    '샘플검수': 'k_sample',
    '직진배송': 'k_direct',
    '에이블리배송': 'k_ably',
    '채우기': 'k_fill',
    '교환반품': 'k_return',
    '전량검수': 'k_full',
    '국내기타': 'k_other',
    '국내제작': 'k_localprod',
    '상.하차': 'k_loadunload',
    '직진배송 사전작업': 'k_direct_prep',
    '오류': 'k_error',
    '중국제작(담당)': 'k_china_owner',
    '청소': 'k_cleaning',
    '앵글정리': 'k_angle',
    '매장근무': 'k_store',
    '교육': 'k_training'
});
const LOCKED_BY_ID = Object.freeze(Object.fromEntries(Object.entries(LOCKED_TASKS).map(([n, id]) => [id, n])));

/** 업무 이름이 들어가는 설정 칸. 없는 칸은 만들지 않는다. */
export const TASK_NAME_ARRAY_FIELDS = ['keyTasks', 'quantityTaskTypes', 'costCalcTasks', 'qualityCostTasks',
    'simAlwaysShowTasks', 'simTimeTasksZero', 'simLoadoutSources', 'simTimeTasks', 'simTimeTaskDepsNextDay',
    'forecastBacklogTasks', 'staffingBasketTasks'];
export const TASK_NAME_MAP_FIELDS = ['quantityToDashboardMap', 'simAutoModes', 'simulationTaskLinks',
    'simTimeTaskDeps', 'simPrecursorTasks'];

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const ID_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 잠긴 업무의 id 인가 */
export const isLockedTaskId = (id) => Object.prototype.hasOwnProperty.call(LOCKED_BY_ID, id);

/** 새 일반 업무 id — 't_' + base36 8글자. used(Set·배열) 와 겹치지 않게. */
export function newTaskId(used, rand = Math.random) {
    const taken = used instanceof Set ? used : new Set(used || []);
    for (let n = 0; n < 100; n++) {
        let s = 't_';
        for (let i = 0; i < 8; i++) s += ID_CHARS[Math.floor(rand() * 36) % 36];
        if (!taken.has(s)) return s;
    }
    throw new Error('업무 id 를 만들지 못했습니다(중복).');
}

/** taskGroups 의 업무 이름(앞뒤 공백 제거·빈 이름 제외·중복 제거, 순서 유지) */
export function taskNamesOf(cfg) {
    const out = [];
    const seen = new Set();
    ((cfg && cfg.taskGroups) || []).forEach(g => (g && g.tasks || []).forEach(t => {
        const n = String(t == null ? '' : t).trim();
        if (n && !seen.has(n)) { seen.add(n); out.push(n); }
    }));
    return out;
}

/** 이름 → id (정확히 같은 이름 먼저, 없으면 대소문자·공백 무시) */
export function taskIdOf(name, taskIdNames) {
    const ids = isObj(taskIdNames) ? taskIdNames : {};
    const n = String(name == null ? '' : name).trim();
    for (const [id, v] of Object.entries(ids)) if (v === n) return id;
    const k = norm(n);
    for (const [id, v] of Object.entries(ids)) if (norm(v) === k) return id;
    return '';
}

/** 불러온 설정에 id 를 붙인 사본(메모리 전용 — 첫 저장 때 기록된다. 여기서 쓰지 않는다).
 *  taskIdNames 없는 이름에 id 부여(잠긴 이름은 고정 id), taskGroups 에 없는 항목은 뺀다.
 *  같은 이름이 여러 그룹에 있으면 같은 id. */
export function ensureTaskIds(cfg, rand = Math.random) {
    const c = cfg || {};
    const old = isObj(c.taskIdNames) ? c.taskIdNames : {};
    const names = taskNamesOf(c);
    const nameSet = new Set(names);
    const out = {};
    // 지금 이름과 맞는 기존 id 는 그대로
    for (const [id, n] of Object.entries(old)) {
        if (nameSet.has(n) && !Object.values(out).includes(n)) out[id] = n;
    }
    const used = new Set([...Object.keys(old), ...Object.values(isObj(c.taskAliases) ? c.taskAliases : {})]);
    for (const n of names) {
        if (Object.values(out).includes(n)) continue;
        const locked = LOCKED_TASKS[n];
        const id = (locked && !(locked in out)) ? locked : newTaskId(used, rand);
        used.add(id);
        out[id] = n;
    }
    // 나중에 잠금 목록에 넣은 이름이 일반 id 로 저장돼 있으면 고정 id 로 옮긴다(별칭도 따라감) — 안 옮기면 검사가 저장을 막는다
    let aliases = c.taskAliases;
    for (const [id, n] of Object.entries(out)) {
        const locked = LOCKED_TASKS[n];
        if (!locked || locked === id || locked in out) continue;
        delete out[id];
        out[locked] = n;
        if (isObj(aliases)) aliases = Object.fromEntries(Object.entries(aliases).map(([a, v]) => [a, v === id ? locked : v]));
    }
    const res = { ...c, taskIdNames: out };
    if (isObj(aliases)) res.taskAliases = aliases;
    return res;
}

/** 관리자 화면의 업무 줄들 [{id, name}] → { taskIdNames, rowIds }.
 *  이미 아는 id(before 에 있음)는 그 줄의 이름으로, 새 줄은 같은 이름의 업무가 있으면 그 id(두 그룹에 같은 업무),
 *  잠긴 이름이면 고정 id, 아니면 줄의 id 를 쓴다. 같은 id 의 줄이 이름이 다르면 앞 줄 이름을 쓴다(검사가 거부). */
export function collectTaskIds(rows, beforeIdNames) {
    const before = isObj(beforeIdNames) ? beforeIdNames : {};
    const out = {};
    const byName = new Map();   // 앞뒤 공백만 뗀 정확히 같은 이름(대소문자만 다르면 다른 업무로 두고 검사가 '겹칩니다'로 막는다)
    const rowIds = rows.map(() => '');
    rows.forEach((r, i) => {
        const name = String(r.name == null ? '' : r.name).trim();
        if (!name || !r.id || !(r.id in before)) return;
        rowIds[i] = r.id;
        if (!(r.id in out)) { out[r.id] = name; if (!byName.has(name)) byName.set(name, r.id); }
    });
    rows.forEach((r, i) => {
        const name = String(r.name == null ? '' : r.name).trim();
        if (!name || rowIds[i]) return;
        let id = byName.get(name);
        if (!id) {
            const locked = LOCKED_TASKS[name];
            id = (locked && !(locked in out)) ? locked : r.id;
        }
        if (!id) return;
        rowIds[i] = id;
        if (!(id in out)) { out[id] = name; byName.set(name, id); }
    });
    return { taskIdNames: out, rowIds };
}

/** 이름 → 지금 이름. 별칭(옛 이름)이면 그 업무의 지금 이름, 대소문자만 다른 지금 이름도 맞춘다. 모르면 그대로. */
export function canonicalTaskName(name, cfg) {
    const c = cfg || {};
    const ids = isObj(c.taskIdNames) ? c.taskIdNames : {};
    const aliases = isObj(c.taskAliases) ? c.taskAliases : {};
    const n = String(name == null ? '' : name).trim();
    if (Object.values(ids).includes(n)) return n;
    let id = Object.prototype.hasOwnProperty.call(aliases, n) ? aliases[n] : '';
    if (!id) {
        const k = norm(n);
        const hit = Object.keys(aliases).find(a => norm(a) === k);
        if (hit) id = aliases[hit];
    }
    if (id && ids[id]) return ids[id];
    const cur = taskIdOf(n, ids);
    return cur ? ids[cur] : name;
}

/** 이름 검사 → 오류 문구 배열(비면 통과). 빈 이름, 서로 다른 업무가 같은 이름(대소문자·공백 무시),
 *  잠긴 업무 이름 변경, 같은 업무(두 그룹)인데 이름이 다른 줄을 거부한다. */
export function validateTaskNames(cfg) {
    const c = cfg || {};
    const errors = [];
    const groupNames = [];
    (c.taskGroups || []).forEach(g => (g && g.tasks || []).forEach(t => groupNames.push(String(t == null ? '' : t).trim())));
    if (groupNames.some(n => !n)) errors.push('이름이 비어 있는 업무가 있습니다.');
    const ids = isObj(c.taskIdNames) ? c.taskIdNames : null;
    if (!ids) return errors;
    const seen = new Map();
    for (const [id, n] of Object.entries(ids)) {
        const k = norm(n);
        if (!k) continue;
        if (seen.has(k)) errors.push(`'${n}' 이름이 서로 다른 업무에 겹칩니다(대소문자·앞뒤 공백 무시).`);
        else seen.set(k, id);
        if (isLockedTaskId(id) && n !== LOCKED_BY_ID[id]) {
            errors.push(`'${LOCKED_BY_ID[id]}' 은(는) 프로그램이 이 이름으로 계산하는 업무라 이름을 바꿀 수 없습니다('${n}').`);
        }
        // 고정 이름은 고정 id 만 쓸 수 있다(고정 업무를 지우고 다른 업무 이름을 그 이름으로 바꾸는 우회 차단)
        const lockedName = Object.keys(LOCKED_TASKS).find(ln => norm(ln) === k);
        if (lockedName && LOCKED_TASKS[lockedName] !== id) {
            errors.push(`'${n}' 은(는) 프로그램이 계산에 쓰는 고정 업무 이름이라 다른 업무의 이름으로 쓸 수 없습니다.`);
        }
    }
    const values = new Set(Object.values(ids));
    const stray = [...new Set(groupNames.filter(n => n && !values.has(n)))];
    stray.forEach(n => errors.push(`'${n}' — 같은 업무가 여러 그룹에 있는데 이름이 서로 다르거나, 업무 id 가 없습니다. 새로고침 후 다시 해 주세요.`));
    return errors;
}

/** 이름 변경을 이름 칸 전체에 한 번에 퍼뜨린다(A↔B 맞바꾸기 안전).
 *  newCfg.taskIdNames 와 beforeCfg.taskIdNames 를 비교해 {옛→새} 를 만든다.
 *  opts.skip: 이미 새 이름으로 모은 칸(관리자 화면이 id 로 읽은 칸) — 바꾸지 않고 renames.fields 표시에만 쓴다.
 *  → { config, renames:[{from,to,id,fields}], reused:[{name,id,prevId}] }
 *  reused: 다른 업무의 옛 이름(별칭)을 이번에 이름으로 쓴 것 — 그 별칭은 지운다(옛 기록이 이 업무로 합쳐 보인다). */
export function applyTaskRenames(newCfg, beforeCfg, opts = {}) {
    const c = { ...(newCfg || {}) };
    const b = beforeCfg || {};
    const now = isObj(c.taskIdNames) ? c.taskIdNames : null;
    if (!now) return { config: c, renames: [], reused: [] };
    const was = isObj(b.taskIdNames) ? b.taskIdNames : {};
    const skip = new Set(opts.skip || []);

    const renames = [];
    const exact = new Map();
    const loose = new Map();
    // 대소문자·공백 무시 매칭은 저장 전 이름 중 그 모양이 하나뿐일 때만(둘 이상이면 어느 업무인지 모른다)
    const normCount = new Map();
    Object.values(was).forEach(n => normCount.set(norm(n), (normCount.get(norm(n)) || 0) + 1));
    for (const [id, to] of Object.entries(now)) {
        const from = was[id];
        if (from === undefined || from === to) continue;
        renames.push({ from, to, id, fields: [] });
        exact.set(from, to);
        if (normCount.get(norm(from)) === 1) loose.set(norm(from), to);
    }
    const renameOf = (v) => {
        if (typeof v !== 'string') return undefined;
        if (exact.has(v)) return exact.get(v);
        const k = norm(v);
        return loose.has(k) ? loose.get(k) : undefined;
    };
    const mapName = (v) => { const r = renameOf(v); return r === undefined ? v : r; };
    const mapVal = (v) => Array.isArray(v) ? v.map(mapName) : mapName(v);
    // simAutoModes 값 'incoming-boxes:중국제작' 의 꼬리
    const mapMode = (v) => {
        if (typeof v !== 'string') return v;
        const i = v.indexOf(':');
        if (i < 0) return v;
        const r = renameOf(v.slice(i + 1).trim());
        return r === undefined ? v : v.slice(0, i + 1) + r;
    };
    const mapKeys = (obj, valFn) => {
        const out = {};
        const renamed = [];
        for (const [k, v] of Object.entries(obj)) {
            const nk = renameOf(k);
            if (nk === undefined) out[k] = valFn(v); else renamed.push([nk, valFn(v)]);
        }
        renamed.forEach(([k, v]) => { out[k] = v; });   // 바뀐 키가 남은 옛 키보다 우선
        return out;
    };

    if (renames.length) {
        TASK_NAME_ARRAY_FIELDS.forEach(f => {
            if (!skip.has(f) && Array.isArray(c[f])) c[f] = c[f].map(mapName);
        });
        TASK_NAME_MAP_FIELDS.forEach(f => {
            if (skip.has(f) || !isObj(c[f])) return;
            const valFn = f === 'quantityToDashboardMap' ? (v => v)
                : f === 'simAutoModes' ? mapMode
                : mapVal;
            c[f] = mapKeys(c[f], valFn);
        });
        // 확인창용 — 저장 전 설정에서 그 이름이 들어 있던 칸
        renames.forEach(r => {
            const k = norm(r.from);
            const has = (v) => typeof v === 'string' && norm(v) === k;
            TASK_NAME_ARRAY_FIELDS.forEach(f => { if (Array.isArray(b[f]) && b[f].some(has)) r.fields.push(f); });
            TASK_NAME_MAP_FIELDS.forEach(f => {
                const o = b[f];
                if (!isObj(o)) return;
                const hit = Object.entries(o).some(([key, v]) => has(key)
                    || (Array.isArray(v) ? v.some(has) : has(v))
                    || (f === 'simAutoModes' && typeof v === 'string' && v.includes(':') && has(v.slice(v.indexOf(':') + 1).trim())));
                if (hit) r.fields.push(f);
            });
        });
    }

    // 별칭: 옛 이름 → id 추가, 지금 자기 이름과 같은 것(되돌리기)·지운 업무의 것 삭제,
    //       다른 업무가 지금 쓰는 이름이면 삭제하고 reused 로 알린다
    const aliases = { ...(isObj(c.taskAliases) ? c.taskAliases : (isObj(b.taskAliases) ? b.taskAliases : {})) };
    renames.forEach(r => { aliases[r.from] = r.id; });
    const nowByNorm = new Map(Object.entries(now).map(([id, n]) => [norm(n), id]));
    const reused = [];
    for (const [a, id] of Object.entries(aliases)) {
        const holder = nowByNorm.get(norm(a));
        if (!(id in now)) { delete aliases[a]; continue; }
        if (!holder) continue;
        delete aliases[a];
        if (holder !== id) reused.push({ name: now[holder], id: holder, prevId: id });
    }
    c.taskAliases = aliases;
    return { config: c, renames, reused };
}
