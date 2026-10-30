// === js/lib/task-config-sync.js ===
// 업무 관리 개편(2026-10-30) — 업무를 만들고 지우고 이름을 바꾸는 곳은 '업무 등록 관리'(taskGroups) 하나뿐이고,
// 다른 칸(고정 업무·처리량·위젯 연결·상단 위젯·원가·예측 설정)은 등록된 업무에서 고르기만 한다.
// 여기서는 업무를 지웠을 때 화면에 없는 칸(예측 설정 등)과 그 업무에만 연결돼 있던 커스텀 위젯을 같이 정리하고,
// 위젯 추가 창·중복 표시에 쓰는 계산을 한다. 이름 변경은 js/lib/task-ids.js applyTaskRenames 가 맡는다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/task-config-sync.test.js
import { TASK_NAME_ARRAY_FIELDS, TASK_NAME_MAP_FIELDS } from './task-ids.js?v=202610301657';

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

/** 지운 업무를 이름 칸에서 뺀다 + 연결이 모두 지운 업무였던 커스텀 위젯을 상단 위젯 목록에서 뺀다.
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

    // 위젯 — 저장 전 연결이 1개 이상이고 모두 지운 업무였으며, 지금 연결이 없는 커스텀 위젯만 뺀다.
    //   처음부터 연결이 없던 커스텀·기본 위젯(domestic-invoice 등)은 남긴다.
    const beforeMap = isObj(b.quantityToDashboardMap) ? b.quantityToDashboardMap : {};
    const nowMap = isObj(c.quantityToDashboardMap) ? c.quantityToDashboardMap : {};
    const nowLinked = new Set(Object.values(nowMap));
    const customs = isObj(c.dashboardCustomItems) ? c.dashboardCustomItems : {};
    const ids = new Set([...(Array.isArray(c.dashboardItems) ? c.dashboardItems : []), ...Object.keys(customs)]);
    const drop = [];
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

/** 커스텀 위젯 제목이 옛 업무 이름과 정확히(앞뒤 공백만 무시) 같으면 새 이름으로. 기본 위젯은 건드리지 않는다.
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

/** 업무 → 상단 위젯 수량 항목 추가 계획(설정·관리 '상단 위젯' 탭 [+ 업무 수량 위젯 추가]).
 *  defs: 위젯 정의 전체(기본 + 커스텀), map: quantityToDashboardMap. makeId: 새 커스텀 id 를 만드는 함수.
 *  → { id, newDef, dashboardItems, quantityTaskTypes, map } 또는 { error } (입력은 바꾸지 않는다)
 *  같은 제목의 수량 위젯이 있고 아무 업무도 연결 안 됐으면 그 위젯을 쓴다(예: 기본 '중국제작'). */
export function planTaskWidget({ dashboardItems = [], defs = {}, quantityTaskTypes = [], map = {} } = {}, taskName, makeId) {
    const name = String(taskName == null ? '' : taskName).trim();
    if (!name) return { error: '업무를 고르세요.' };
    const k = norm(name);
    const titleOf = (id) => (defs[id] && defs[id].title) || id;
    const linkedKey = Object.keys(map || {}).find(t => norm(t) === k && map[t]);
    if (linkedKey) return { error: `이미 '${titleOf(map[linkedKey])}' 위젯에 연결됨` };

    const linkedIds = new Set(Object.values(map || {}).filter(Boolean));
    const same = Object.keys(defs || {}).filter(id => defs[id] && defs[id].isQuantity && norm(defs[id].title) === k);
    let id = same.find(x => !linkedIds.has(x)) || '';
    let newDef = null;
    if (!id) {
        if (same.length) return { error: '같은 이름 위젯이 다른 업무에 연결됨 — 처리량 탭에서 묶으세요' };
        id = makeId();
        newDef = { title: name, isQuantity: true };
    }
    const items = (dashboardItems || []).slice();
    if (!items.includes(id)) items.push(id);
    const qty = (quantityTaskTypes || []).slice();
    if (!qty.some(t => norm(t) === k)) qty.push(name);
    return { id, newDef, dashboardItems: items, quantityTaskTypes: qty, map: { ...(map || {}), [name]: id } };
}

/** 위젯 추가 창 선택지 — 이미 위젯에 연결된 업무는 linkedTitle(그 위젯 제목), 아니면 ''. */
export function widgetTaskChoices(taskNames, map, defs) {
    const m = isObj(map) ? map : {};
    const d = isObj(defs) ? defs : {};
    return (taskNames || []).map(name => {
        const key = Object.keys(m).find(t => norm(t) === norm(name) && m[t]);
        return { name, linkedTitle: key ? ((d[m[key]] && d[m[key]].title) || m[key]) : '' };
    });
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
