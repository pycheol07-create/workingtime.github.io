// === js/lib/task-config-sync.js ===
// 업무 관리 개편(2026-10-30) — 업무를 만들고 지우고 이름을 바꾸는 곳은 '업무 등록 관리'(taskGroups) 하나뿐이고,
// 다른 칸(고정 업무·처리량·위젯 연결·상단 위젯·원가·예측 설정)은 등록된 업무에서 고르기만 한다.
// 여기서는 업무를 지웠을 때 화면에 없는 칸(예측 설정 등)과 그 업무에만 연결돼 있던 커스텀 위젯을 같이 정리하고,
// 위젯 추가 창·중복 표시에 쓰는 계산을 한다. 이름 변경은 js/lib/task-ids.js applyTaskRenames 가 맡는다.
// 업무 수량 위젯(추가 1b, 2026-10-30): 상단 위젯 항목 id = 'task-<업무id>'. 제목은 taskIdNames(지금 이름), 숫자는 그 업무 처리량.
//   예전 '처리량 → 위젯 연결'(quantityToDashboardMap)은 불러올 때 migrateDashboardTaskItems 로 이 모양으로 옮기고(메모리),
//   관리자 저장 때 옛 버전 탭용 사본(withTaskWidgetCompat)만 같이 쓴다. 사본 삭제는 업무 id 7단계.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/task-config-sync.test.js
import { TASK_NAME_ARRAY_FIELDS, TASK_NAME_MAP_FIELDS, canonicalTaskName, taskIdOf, taskNameOf, taskNamesOf } from './task-ids.js?v=202610301845';

/** 업무 수량 위젯 id 앞머리 — DOM id·querySelector 에 쓰이므로 콜론 대신 하이픈 */
export const TASK_WIDGET_PREFIX = 'task-';
/** 업무 id → 위젯 항목 id */
export const taskWidgetId = (taskId) => TASK_WIDGET_PREFIX + taskId;
/** 위젯 항목 id → 업무 id(업무 위젯이 아니면 '') */
export const taskIdOfWidget = (widgetId) =>
    (typeof widgetId === 'string' && widgetId.startsWith(TASK_WIDGET_PREFIX)) ? widgetId.slice(TASK_WIDGET_PREFIX.length) : '';
/** 기본 수량 위젯(js/ui.js·js/admin-ui.js DASHBOARD_ITEM_DEFINITIONS 의 isQuantity) — 정의는 남기고 추가 목록에서만 숨긴다 */
export const BUILTIN_QUANTITY_WIDGETS = Object.freeze(['domestic-invoice', 'china-production', 'direct-delivery']);

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
// 빈 배열이 '기본값·자동' 을 뜻하는 칸 — 걸러서 비게 되면 그대로 둔다(keptEmpty).
//   staffingBasketTasks 길이 0 → 기본 묶음(ui-history-staffing.js), simTimeTasks 길이 0 → 자동 뽑기(ui-history-prediction.js).
//   맵 값 배열(simTimeTaskDeps·simPrecursorTasks)도 같다. 그 밖의 칸(품질비용·simTimeTasksZero 등)은 빈 배열 = '없음' 이라 비워 저장한다.
const KEEP_WHEN_EMPTY = new Set(['staffingBasketTasks', 'simTimeTasks', 'simTimeTaskDeps', 'simPrecursorTasks']);

/** 지운 업무의 이름을 같은 저장에서 다른 업무가 가져간 것 — deletedTasks 는 이 경우 지운 것으로 보지 않는다
 *  (그 이름의 숨은 설정은 가져간 업무가 이어받는다). 저장 확인창에 알리는 용도. → [{ name, id }] (id = 지운 업무) */
export function takenDeletedNames(beforeCfg, newCfg) {
    const was = isObj(beforeCfg && beforeCfg.taskIdNames) ? beforeCfg.taskIdNames : {};
    const now = isObj(newCfg && newCfg.taskIdNames) ? newCfg.taskIdNames : null;
    if (!now) return [];
    const nowNames = new Set(Object.values(now).map(norm));
    return Object.entries(was).filter(([id, name]) => !(id in now) && nowNames.has(norm(name))).map(([id, name]) => ({ name, id }));
}

/** 지운 업무 — 저장 전 taskIdNames 에 있던 id 가 지금 없는 것. 지금 이름(대소문자·공백 무시)과 같으면 뺀다(같은 이름으로 다시 만든 경우).
 *  aliasNames: 저장 전 taskAliases 중 그 id 를 가리키던 옛 이름.
 *  → [{ id, name, aliasNames }] */
export function deletedTasks(beforeCfg, newCfg) {
    const was = isObj(beforeCfg && beforeCfg.taskIdNames) ? beforeCfg.taskIdNames : {};
    const now = isObj(newCfg && newCfg.taskIdNames) ? newCfg.taskIdNames : null;
    if (!now) return [];
    const aliases = isObj(beforeCfg && beforeCfg.taskAliases) ? beforeCfg.taskAliases : {};
    const nowNames = new Set(Object.values(now).map(norm));
    const out = [];
    for (const [id, name] of Object.entries(was)) {
        if (id in now || nowNames.has(norm(name))) continue;
        out.push({ id, name, aliasNames: Object.keys(aliases).filter(a => aliases[a] === id) });
    }
    return out;
}

/** 지운 업무를 이름 칸에서 뺀다 + 그 업무의 수량 위젯(task-<id>)과, 연결이 모두 지운 업무였던 옛 커스텀 위젯을 상단 위젯 목록에서 뺀다.
 *  opts.skip: 건드리지도 알리지도 않는 칸(예: forecastExcludedTasks — 과거 정확도 숫자 보존).
 *  opts.already: 앞에서 이미 뺀 칸(관리자 화면이 id 로 읽은 칸) — 건드리지 않고 fields 표시에만 쓴다(저장 전 값 기준).
 *  걸러 낸 결과가 비게 되는 배열 중 빈 배열이 '기본값'·'자동' 을 뜻하는 칸(KEEP_WHEN_EMPTY)은 그대로 두고 keptEmpty 로 알린다.
 *  → { config, fields: { 업무명: [칸이름] }, keptEmpty: [칸이름], removedWidgets: [{ id, title }] } (입력은 바꾸지 않는다) */
export function purgeDeletedTasks(cfg, beforeCfg, deleted, opts = {}) {
    const c = { ...(cfg || {}) };
    const b = beforeCfg || {};
    const fields = {};
    const keptEmpty = [];
    const removedWidgets = [];
    if (!Array.isArray(deleted) || !deleted.length) return { config: c, fields, keptEmpty, removedWidgets };
    const skip = new Set(opts.skip || []);
    const already = new Set(opts.already || []);

    // 이름(옛 이름 포함) → 지운 업무 이름. 지금 업무 이름과 같은 것은 빼고 본다(다른 업무가 쓰는 이름은 지우지 않는다).
    const current = new Set(Object.values(isObj(c.taskIdNames) ? c.taskIdNames : {}).map(norm));
    const owner = new Map();
    deleted.forEach(d => [d.name, ...(d.aliasNames || [])].forEach(n => {
        const k = norm(n);
        if (k && !current.has(k) && !owner.has(k)) owner.set(k, d.name);
    }));
    const ownerOf = (v) => (typeof v === 'string' ? owner.get(norm(v)) : undefined);
    const note = (name, f) => {
        if (!name) return;
        const list = fields[name] || (fields[name] = []);
        if (!list.includes(f)) list.push(f);
    };
    const keep = (f) => { if (!keptEmpty.includes(f)) keptEmpty.push(f); };
    // 배열 하나를 거른다 — 빈 배열이 '기본값·자동' 인 칸(KEEP_WHEN_EMPTY)이 비게 되면 원래 배열(null 반환)
    const filterList = (arr, f) => {
        const hits = arr.map(ownerOf);
        if (!hits.some(Boolean)) return arr;
        const next = arr.filter((v, i) => !hits[i]);
        if (!next.length && KEEP_WHEN_EMPTY.has(f)) { keep(f); return null; }
        hits.forEach(n => note(n, f));
        return next;
    };

    TASK_NAME_ARRAY_FIELDS.forEach(f => {
        if (skip.has(f)) return;
        if (already.has(f)) {
            if (Array.isArray(b[f])) b[f].forEach(v => note(ownerOf(v), f));
            return;
        }
        if (!Array.isArray(c[f])) return;
        const next = filterList(c[f], f);
        if (next && next !== c[f]) c[f] = next;
    });

    TASK_NAME_MAP_FIELDS.forEach(f => {
        if (skip.has(f)) return;
        if (already.has(f)) {
            if (isObj(b[f])) Object.keys(b[f]).forEach(k => note(ownerOf(k), f));
            return;
        }
        if (!isObj(c[f])) return;
        const out = {};
        let changed = false;
        for (const [k, v] of Object.entries(c[f])) {
            const keyOwner = ownerOf(k);
            if (keyOwner) { note(keyOwner, f); changed = true; continue; }          // 키가 지운 업무 → 항목 삭제
            if (f === 'simulationTaskLinks' && ownerOf(v)) { note(ownerOf(v), f); changed = true; continue; }   // 값만 지운 업무여도 삭제
            if ((f === 'simTimeTaskDeps' || f === 'simPrecursorTasks') && Array.isArray(v)) {
                const next = filterList(v, f);
                if (next && next !== v) changed = true;
                out[k] = next || v;
                continue;
            }
            out[k] = v;   // quantityToDashboardMap 값(위젯 id)·simAutoModes 값('mode:업무' 꼬리)은 그대로
        }
        if (changed) c[f] = out;
    });

    // 위젯 ① 업무 수량 위젯(task-<id>) — 지운 업무의 것은 id 로 바로 뺀다.
    const customs = isObj(c.dashboardCustomItems) ? c.dashboardCustomItems : {};
    const ids = new Set([...(Array.isArray(c.dashboardItems) ? c.dashboardItems : []), ...Object.keys(customs)]);
    const drop = [];
    const deletedName = new Map(deleted.map(d => [d.id, d.name]));
    ids.forEach(id => {
        const tid = taskIdOfWidget(id);
        if (!tid || !deletedName.has(tid)) return;
        removedWidgets.push({ id, title: deletedName.get(tid) });
        drop.push(id);
    });
    // 위젯 ② 옛 커스텀 위젯(옮기기 전 설정) — 저장 전 연결이 1개 이상이고 모두 지운 업무였으며, 지금 연결이 없는 것만 뺀다.
    //   처음부터 연결이 없던 커스텀·기본 위젯(domestic-invoice 등)은 남긴다.
    const beforeMap = isObj(b.quantityToDashboardMap) ? b.quantityToDashboardMap : {};
    const nowMap = isObj(c.quantityToDashboardMap) ? c.quantityToDashboardMap : {};
    const nowLinked = new Set(Object.values(nowMap));
    ids.forEach(id => {
        if (typeof id !== 'string' || !id.startsWith('custom-') || nowLinked.has(id)) return;
        const linked = Object.keys(beforeMap).filter(t => beforeMap[t] === id);
        if (!linked.length || !linked.every(t => ownerOf(t))) return;
        const def = customs[id] || (isObj(b.dashboardCustomItems) ? b.dashboardCustomItems[id] : null);
        removedWidgets.push({ id, title: (def && def.title) || id });
        drop.push(id);
    });
    if (drop.length) {
        if (Array.isArray(c.dashboardItems)) c.dashboardItems = c.dashboardItems.filter(id => !drop.includes(id));
        if (isObj(c.dashboardCustomItems)) {
            c.dashboardCustomItems = { ...c.dashboardCustomItems };
            drop.forEach(id => { delete c.dashboardCustomItems[id]; });
        }
    }
    return { config: c, fields, keptEmpty, removedWidgets };
}

/** 옛 커스텀 위젯(옮기기 전 설정)용 — 업무 수량 위젯(task-)은 제목을 taskIdNames 에서 읽으므로 할 일이 없다.
 *  커스텀 위젯 제목이 옛 업무 이름과 정확히(앞뒤 공백만 무시) 같으면 새 이름으로. 기본 위젯은 건드리지 않는다.
 *  renames: [{from,to}] — 한 번에 적용(A↔B 맞바꾸기 안전). 입력은 바꾸지 않는다. */
export function followWidgetTitles(customItems, renames) {
    if (!isObj(customItems) || !Array.isArray(renames) || !renames.length) return customItems;
    const to = new Map(renames.map(r => [String(r.from == null ? '' : r.from).trim(), r.to]));
    const out = {};
    let changed = false;
    for (const [id, def] of Object.entries(customItems)) {
        const t = isObj(def) && typeof def.title === 'string' ? def.title.trim() : null;
        if (id.startsWith('custom-') && t !== null && to.has(t)) { out[id] = { ...def, title: to.get(t) }; changed = true; }
        else out[id] = def;
    }
    return changed ? out : customItems;
}

/** 업무 → 상단 위젯 수량 항목 추가 계획(설정·관리 '상단 위젯' 탭 [+ 업무 수량 위젯 추가], 새 업무 창).
 *  항목 id 는 task-<업무id>. 처리량 입력 업무에 없으면 같이 넣는다(규칙 ①).
 *  → { id, dashboardItems, quantityTaskTypes } 또는 { error } (입력은 바꾸지 않는다) */
export function planTaskWidget({ dashboardItems = [], quantityTaskTypes = [], taskIdNames = {} } = {}, taskId) {
    const tid = String(taskId == null ? '' : taskId).trim();
    const name = (tid && isObj(taskIdNames)) ? taskIdNames[tid] : '';
    if (!tid || !name) return { error: '업무를 고르세요(업무 id 를 찾지 못했으면 새로고침 후 다시 해 주세요).' };
    const id = taskWidgetId(tid);
    const items = (dashboardItems || []).slice();
    if (items.includes(id)) return { error: `'${name}' 은(는) 이미 상단 위젯에 있습니다.` };
    items.push(id);
    const qty = (quantityTaskTypes || []).slice();
    if (!qty.some(t => norm(t) === norm(name))) qty.push(name);
    return { id, dashboardItems: items, quantityTaskTypes: qty };
}

/** 위젯 추가 창 선택지 — inWidget: 그 업무의 위젯(task-<id>)이 이미 목록에 있음. id 를 모르는 업무는 id ''. */
export function widgetTaskChoices(taskNames, taskIdNames, dashboardItems) {
    const items = new Set(Array.isArray(dashboardItems) ? dashboardItems : []);
    return (taskNames || []).map(name => {
        const id = taskIdOf(name, taskIdNames);
        return { name, id, inWidget: !!id && items.has(taskWidgetId(id)) };
    });
}

/** 업무 수량 위젯 정의 — taskIdNames 의 모든 업무 + 목록·사본에 있는 task- 항목(이름을 아는 것만).
 *  → { 'task-<id>': { title, isQuantity: true, taskId, taskName } }. 제목은 지금 이름이라 이름을 바꾸면 따라간다. */
export function taskWidgetDefs(cfg) {
    const c = cfg || {};
    const ids = isObj(c.taskIdNames) ? c.taskIdNames : {};
    const out = {};
    const add = (tid) => {
        const wid = taskWidgetId(tid);
        if (!tid || out[wid]) return;
        const name = ids[tid] || taskNameOf(tid, c);
        if (name) out[wid] = { title: name, isQuantity: true, taskId: tid, taskName: name };
    };
    Object.keys(ids).forEach(add);
    [...(Array.isArray(c.dashboardItems) ? c.dashboardItems : []),
     ...Object.keys(isObj(c.dashboardCustomItems) ? c.dashboardCustomItems : {})].forEach(w => add(taskIdOfWidget(w)));
    return out;
}

/** 예전 '처리량 → 위젯 연결' 설정을 업무 수량 위젯(task-<id>)으로 옮긴다. 멱등, 입력 불변(바뀐 것이 없으면 입력 그대로).
 *  taskIdNames 가 없으면(업무 id 저장 전) 옮기지 않는다.
 *  ① dashboardItems 순서대로, 수량 위젯이고 연결 업무가 있으면 그 자리를 task-<지금 이름의 id> 로(옛 이름 키도 지금 이름으로 본다).
 *     옮긴 커스텀 위젯 정의와 그 위젯을 가리키던 연결 줄은 지운다.
 *  ② 여러 업무가 묶인 위젯은 그 자리에 업무별 항목 여러 개(연결 줄 순서).
 *  ③ 연결 업무가 없는 수량 위젯(예: domestic-invoice)은 그대로.
 *     연결 업무가 모두 지운 업무이거나, 업무 목록에는 있는데 id 가 없는 업무가 섞인 위젯도 그대로 둔다(보수적으로).
 *  ④ 같은 task- 항목은 하나만. id 가 taskIdNames 에 없는 task- 항목(지운 업무)은 뺀다.
 *  ⑤ 위젯에 있는 업무가 quantityTaskTypes 에 없으면 뒤에 넣는다(규칙 ①). */
export function migrateDashboardTaskItems(cfg) {
    if (!cfg || !isObj(cfg.taskIdNames) || !Array.isArray(cfg.dashboardItems)) return cfg;
    const ids = cfg.taskIdNames;
    const map = isObj(cfg.quantityToDashboardMap) ? cfg.quantityToDashboardMap : {};
    const customs = isObj(cfg.dashboardCustomItems) ? cfg.dashboardCustomItems : {};
    const isQty = (id) => BUILTIN_QUANTITY_WIDGETS.includes(id) || (isObj(customs[id]) && customs[id].isQuantity === true);
    const linked = {};
    for (const [t, w] of Object.entries(map)) {
        if (!t || typeof w !== 'string' || !w) continue;
        (linked[w] = linked[w] || []).push(t);
    }
    const groupNames = new Set(taskNamesOf(cfg));
    const out = [];
    const seen = new Set();
    const moved = [];
    let changed = false;
    for (const id of cfg.dashboardItems) {
        const tid = taskIdOfWidget(id);
        if (tid) {
            if (seen.has(id) || !(tid in ids)) { changed = true; continue; }   // ④
            seen.add(id); out.push(id);
            continue;
        }
        const tasks = linked[id];
        if (!tasks || !isQty(id)) { out.push(id); continue; }               // ③ 연결 없음·수량 위젯 아님
        const tids = [];
        let unsure = false;
        tasks.forEach(t => {
            const cur = canonicalTaskName(t, cfg);
            const found = taskIdOf(cur, ids);
            if (found) { if (!tids.includes(found)) tids.push(found); }
            else if (groupNames.has(String(cur == null ? '' : cur).trim())) unsure = true;   // 업무는 있는데 id 가 없다
        });
        if (unsure || !tids.length) { out.push(id); continue; }              // ③ 그대로
        changed = true;
        moved.push(id);
        tids.forEach(found => {                                              // ① ②
            const w = taskWidgetId(found);
            if (!seen.has(w)) { seen.add(w); out.push(w); }
        });
    }
    // ⑤ 위젯 업무 → 처리량
    const qtyBase = Array.isArray(cfg.quantityTaskTypes) ? cfg.quantityTaskTypes : [];
    let qty = null;   // 넣을 것이 있을 때만 사본
    out.forEach(w => {
        const name = ids[taskIdOfWidget(w)];
        if (!name) return;
        if ((qty || qtyBase).some(t => norm(canonicalTaskName(t, cfg)) === norm(name))) return;
        if (!qty) qty = qtyBase.slice();
        qty.push(name);
    });
    if (!changed && !qty) return cfg;
    const res = { ...cfg, dashboardItems: out };
    if (qty) res.quantityTaskTypes = qty;
    if (moved.length) {
        res.quantityToDashboardMap = Object.fromEntries(Object.entries(map).filter(([, w]) => !moved.includes(w)));
        const nextCustoms = { ...customs };
        moved.forEach(id => { if (id.startsWith('custom-')) delete nextCustoms[id]; });
        if (isObj(cfg.dashboardCustomItems)) res.dashboardCustomItems = nextCustoms;
    }
    return res;
}

/** 관리자 저장용 옛 버전 탭 호환 사본(업무 id 7단계에서 없앤다) — 1b 이전 빌드의 대시보드·관리자 화면이 업무 수량 위젯을 그대로 보게.
 *  quantityToDashboardMap[지금 이름] = 'task-<id>', dashboardCustomItems['task-<id>'] = { title: 지금 이름, isQuantity: true }.
 *  지난 사본(task- 를 가리키는 연결·task- 정의)은 지우고 지금 목록으로 다시 만든다. 옛 위젯 연결은 그대로 둔다. 입력 불변. */
export function withTaskWidgetCompat(cfg) {
    const c = { ...(cfg || {}) };
    const ids = isObj(c.taskIdNames) ? c.taskIdNames : {};
    const map = Object.fromEntries(Object.entries(isObj(c.quantityToDashboardMap) ? c.quantityToDashboardMap : {})
        .filter(([, w]) => !taskIdOfWidget(w)));
    const customs = Object.fromEntries(Object.entries(isObj(c.dashboardCustomItems) ? c.dashboardCustomItems : {})
        .filter(([id]) => !taskIdOfWidget(id)));
    (Array.isArray(c.dashboardItems) ? c.dashboardItems : []).forEach(w => {
        const name = ids[taskIdOfWidget(w)];
        if (!name) return;
        map[name] = w;
        customs[w] = { title: name, isQuantity: true };
    });
    c.quantityToDashboardMap = map;
    c.dashboardCustomItems = customs;
    return c;
}

/** 같은 업무(앞뒤 공백만 뗀 같은 이름)가 여러 그룹에, 또는 한 그룹에 두 번 있는 것 → [{ name, groups }]
 *  groups: 나온 그룹 이름 순서대로(한 그룹에 두 번이면 두 번). */
export function duplicateTasks(taskGroups) {
    const seen = new Map();
    (taskGroups || []).forEach(g => ((g && g.tasks) || []).forEach(t => {
        const n = String(t == null ? '' : t).trim();
        if (!n) return;
        if (!seen.has(n)) seen.set(n, []);
        seen.get(n).push(String((g && g.name) || '').trim());
    }));
    return [...seen.entries()].filter(([, gs]) => gs.length > 1).map(([name, groups]) => ({ name, groups }));
}
