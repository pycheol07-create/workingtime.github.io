// === js/lib/task-alias-view.js ===
// 분석 화면용 '지금 이름' 보기 — 업무 이름을 바꾼 뒤에도 옛 이름 기록과 새 이름 기록을 한 업무로 합쳐 본다(업무 id 3단계, 2026-10-21).
// 왜: 과거 기록(history)은 이름이 키라, 이름을 바꾸면 분석·예측이 옛 이름과 새 이름을 서로 다른 업무로 센다.
//     기록 자체는 고치지 않는다 — 읽을 때만 사본으로 바꿔 본다.
// 규칙(대시보드 위젯 ui-main-dashboard.js 와 같음):
//   · workRecords[].task → canonicalTaskName (분·건수는 기록마다 따로라 그대로 합쳐진다)
//   · taskQuantities 등 이름 키 맵 → 같은 업무에 지금 이름 키 값이 있으면 그것, 없으면 옛 이름 값. **더하지 않는다**
//     (이름을 바꾼 날 옛 이름·새 이름 키가 둘 다 있는 것은 같은 물량이 두 번 들어간 것이기 쉽다)
//   · confirmedZeroTasks → 지금 이름으로, 중복 제거
// ⚠️ 데이터 관리 편집 화면·저장 경로에는 쓰지 않는다 — 사본을 저장하면 과거 기록 이름이 바뀐다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/task-alias-view.test.js

import { canonicalTaskName } from './task-ids.js?v=202610261518';

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// ── 별칭 문맥: 설정마다 한 번만 만든다 ─────────────────────────────
let lastCtx = null;   // { aliases, ids, sig, canon }

/** 설정의 별칭 문맥. 살아 있는 별칭(지금 있는 업무를 가리키는 옛 이름)이 없으면 null. */
function ctxOf(cfg) {
    const aliases = cfg && cfg.taskAliases;
    const ids = cfg && cfg.taskIdNames;
    if (!isObj(aliases) || !isObj(ids)) return null;
    if (lastCtx && lastCtx.aliases === aliases && lastCtx.ids === ids) return lastCtx.sig ? lastCtx : null;
    const live = Object.entries(aliases).some(([a, id]) => hasOwn(ids, id) && ids[id] !== a);
    const sig = live ? JSON.stringify([aliases, ids]) : '';
    if (live && lastCtx && lastCtx.sig === sig) {   // 내용이 같은 새 설정 객체 — 이름 표를 이어 쓴다
        lastCtx = { ...lastCtx, aliases, ids };
        return lastCtx;
    }
    const c = { taskAliases: aliases, taskIdNames: ids };
    const memo = new Map();
    const canon = (name) => {
        let v = memo.get(name);
        if (v === undefined) { v = canonicalTaskName(name, c); memo.set(name, v); }
        return v;
    };
    lastCtx = { aliases, ids, sig, canon };
    return live ? lastCtx : null;
}

/** 이름 키 맵 → 지금 이름 키 맵. 지금 이름 키가 있으면 그 값, 없으면 먼저 나온 옛 이름 값(더하지 않음).
 *  바뀐 것이 없으면 원본 그대로. */
function mapNameKeys(obj, canon) {
    if (!isObj(obj)) return obj;
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const c = canon(k);
        if (c === k) { out[c] = v; continue; }   // 지금 이름 — 옛 이름 값이 먼저 들어와 있어도 덮는다
        changed = true;
        if (!hasOwn(out, c) && !hasOwn(obj, c)) out[c] = v;
    }
    return changed ? out : obj;
}

function mapNameList(arr, canon) {
    if (!Array.isArray(arr)) return arr;
    let changed = false;
    const seen = new Set();
    const out = [];
    arr.forEach(n => {
        const c = typeof n === 'string' ? canon(n) : n;
        if (c !== n) changed = true;
        if (seen.has(c)) { changed = true; return; }
        seen.add(c);
        out.push(c);
    });
    return changed ? out : arr;
}

function convertDay(d, canon) {
    let wr = d.workRecords;
    if (Array.isArray(wr)) {
        let changed = false;
        const next = wr.map(r => {
            if (!r || typeof r.task !== 'string') return r;
            const c = canon(r.task);
            if (c === r.task) return r;
            changed = true;
            return { ...r, task: c };
        });
        if (changed) wr = next;
    }
    const tq = mapNameKeys(d.taskQuantities, canon);
    const cz = mapNameList(d.confirmedZeroTasks, canon);
    if (wr === d.workRecords && tq === d.taskQuantities && cz === d.confirmedZeroTasks) return d;
    const v = { ...d };
    if (wr !== d.workRecords) v.workRecords = wr;
    if (tq !== d.taskQuantities) v.taskQuantities = tq;
    if (cz !== d.confirmedZeroTasks) v.confirmedZeroTasks = cz;
    return v;
}

// ── 하루치 캐시 — 원본이 제자리에서 바뀌어도(기록 추가·필드 교체) 알아챈다 ─────
// 날짜 문서는 슬롯째 바뀌기도 하고(history-data-manager), 필드만 바뀌기도 한다(management·workRecords.push).
// 그래서 문서 객체 + 필드 참조 + 기록 참조·업무명 + 물량 키·값을 지문으로 남겨 비교한다.
// 이름이 바뀌어 사본으로 만든 기록은 원본 기록의 필드(status·endTime·duration·pauses 등) 값까지 남긴다
// — 원본 기록 객체를 제자리에서 고치면 사본에는 안 따라오기 때문이다.
const dayCache = new WeakMap();

/** 사본으로 만든 기록(view 쪽이 원본과 다른 객체)의 원본 필드 지문 — [순번, 키들, 값들] */
function copiedRecordPrints(d, view) {
    const src = d.workRecords, out = [];
    if (!Array.isArray(src) || view === d || view.workRecords === src) return out;
    for (let i = 0; i < src.length; i++) {
        const r = src[i];
        if (r && view.workRecords[i] !== r) {
            const keys = Object.keys(r);
            out.push([i, keys, keys.map(k => r[k])]);
        }
    }
    return out;
}
function sameCopiedRecords(prints, d) {
    const src = d.workRecords;
    for (const [i, keys, vals] of prints) {
        const r = src[i];
        const now = Object.keys(r);
        if (!sameList(keys, now)) return false;
        for (let j = 0; j < keys.length; j++) if (r[keys[j]] !== vals[j]) return false;
    }
    return true;
}

function fingerprint(d) {
    const keys = Object.keys(d);
    const wr = Array.isArray(d.workRecords) ? d.workRecords : null;
    const tq = isObj(d.taskQuantities) ? d.taskQuantities : null;
    const cz = Array.isArray(d.confirmedZeroTasks) ? d.confirmedZeroTasks : null;
    return {
        keys, vals: keys.map(k => d[k]),
        wrLen: wr ? wr.length : -1, wrItems: wr ? wr.slice() : null, wrTasks: wr ? wr.map(r => r && r.task) : null,
        tqEntries: tq ? Object.entries(tq).flat() : null,
        czItems: cz ? cz.slice() : null
    };
}
const sameList = (a, b) => {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
};
function sameFingerprint(f, d) {
    const keys = Object.keys(d);
    if (!sameList(f.keys, keys)) return false;
    for (let i = 0; i < keys.length; i++) if (f.vals[i] !== d[keys[i]]) return false;
    const wr = Array.isArray(d.workRecords) ? d.workRecords : null;
    if ((wr ? wr.length : -1) !== f.wrLen) return false;
    if (wr) {
        for (let i = 0; i < wr.length; i++) {
            if (wr[i] !== f.wrItems[i] || (wr[i] && wr[i].task) !== f.wrTasks[i]) return false;
        }
    }
    const tq = isObj(d.taskQuantities) ? d.taskQuantities : null;
    if (!sameList(f.tqEntries, tq ? Object.entries(tq).flat() : null)) return false;
    const cz = Array.isArray(d.confirmedZeroTasks) ? d.confirmedZeroTasks : null;
    return sameList(f.czItems, cz ? cz.slice() : null);
}

function dayView(d, ctx) {
    if (!d || typeof d !== 'object') return d;
    const c = dayCache.get(d);
    if (c && c.sig === ctx.sig && sameFingerprint(c.fp, d) && sameCopiedRecords(c.copied, d)) return c.view;
    const view = convertDay(d, ctx.canon);
    dayCache.set(d, { sig: ctx.sig, fp: fingerprint(d), copied: copiedRecordPrints(d, view), view });
    return view;
}

const arrCache = new WeakMap();   // 원본 배열 → { sig, tick, items(원본 날짜들), views, out }

// 같은 동기 실행 안에서는 날짜 문서 속까지 다시 훑지 않는다(예측 화면은 한 번 그릴 때 수십 번 부른다).
// 슬롯째 바꾼 날(arr[i] = 새 문서 — 오늘 동기화·'오늘 실적 없이' 계산이 이렇게 바꾼다)은 같은 실행 안에서도 잡는다.
// 문서 속을 제자리에서 고친 것(기록 push 등)은 다음 실행(마이크로태스크)부터 보인다.
let tick = 0;
let tickArmed = false;
const currentTick = () => {
    if (!tickArmed) {
        tickArmed = true;
        const bump = () => { tick++; tickArmed = false; };
        if (typeof queueMicrotask === 'function') queueMicrotask(bump); else Promise.resolve().then(bump);
    }
    return tick;
};

/**
 * 이력 배열(days)의 '지금 이름' 보기. 원본은 바꾸지 않는다.
 * 별칭이 없거나 바꿀 날이 하나도 없으면 원본 배열을 그대로 돌려준다.
 * 바꿀 날이 있으면 새 배열(바뀐 날만 사본, 나머지는 원본 객체)을 돌려주고, 다음 호출에서 아무것도 안 바뀌었으면 같은 배열을 준다.
 */
export function aliasHistoryView(days, cfg) {
    if (!Array.isArray(days) || days.length === 0) return days;
    const ctx = ctxOf(cfg);
    if (!ctx) return days;
    const now = currentTick();
    const prev = arrCache.get(days);
    if (prev && prev.sig === ctx.sig && prev.tick === now && sameList(prev.items, days)) return prev.out;

    const views = new Array(days.length);
    let any = false;
    for (let i = 0; i < days.length; i++) {
        const v = dayView(days[i], ctx);
        views[i] = v;
        if (v !== days[i]) any = true;
    }
    const out = !any ? days : (prev && prev.out !== prev.items && sameList(prev.out, views)) ? prev.out : views;
    arrCache.set(days, { sig: ctx.sig, tick: now, items: days.slice(), out });
    return out;
}

/** 하루치 문서 하나의 '지금 이름' 보기(원본 불변). */
export function aliasDayView(day, cfg) {
    const ctx = ctxOf(cfg);
    return ctx ? dayView(day, ctx) : day;
}

/** 업무 이름 키 맵(예정 물량·시간형 계획 등)의 '지금 이름' 보기. 지금 이름 우선, 더하지 않음. */
export function aliasNameMap(obj, cfg) {
    const ctx = ctxOf(cfg);
    return ctx ? mapNameKeys(obj, ctx.canon) : obj;
}

/** 계획 스냅샷(forecastSnapshot)의 업무 이름 키 칸(tasks·timeTasks·uph)을 지금 이름으로. */
export function aliasSnapshot(snap, cfg) {
    const ctx = ctxOf(cfg);
    if (!ctx || !isObj(snap)) return snap;
    const tasks = mapNameKeys(snap.tasks, ctx.canon);
    const timeTasks = mapNameKeys(snap.timeTasks, ctx.canon);
    const uph = mapNameKeys(snap.uph, ctx.canon);
    if (tasks === snap.tasks && timeTasks === snap.timeTasks && uph === snap.uph) return snap;
    return { ...snap, tasks, timeTasks, uph };
}

/** obj(이름 키 맵)에서 key 업무에 해당하는 키 — key 자신 + 지금 이름이 key 인 옛 이름 키.
 *  저장값을 지울 때 쓴다(지금 이름만 지우면 옛 이름 값이 aliasNameMap 으로 되살아난다). */
export function sameTaskKeys(obj, key, cfg) {
    if (!isObj(obj)) return [];
    const ctx = ctxOf(cfg);
    return Object.keys(obj).filter(k => k === key || (ctx && ctx.canon(k) === key));
}

/** 이름 하나를 지금 이름으로(별칭이 없으면 그대로). */
export function aliasTaskName(name, cfg) {
    const ctx = ctxOf(cfg);
    return ctx && typeof name === 'string' ? ctx.canon(name) : name;
}
