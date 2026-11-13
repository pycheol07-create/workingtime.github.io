// === js/lib/ship-activity.js ===
// 플랫폼 출고 — 여러 자리 같이 보기(2026-11-13). 순수 모듈(DOM/Firebase 없음). 테스트: tests/ship-activity.test.js
//   누가 지금 만들고 있는지·오늘 마지막으로 무엇을 만들었는지를 다른 PC 도 보게 하고,
//   다른 PC 가 오늘 이미 만든 묶음을 또 만들려 하면 확인창(js/lib/ship-made.js 와 같은 묶음 키)을 띄우게 한다.
//
// 문서: artifacts/team-work-logger-v2/persistent_data/shipActivity (쓰기는 js/ship-store.js 트랜잭션, 읽기 = 등록 직원)
//   { day:'YYYY-MM-DD'(한국 날짜), runs:{ [runId]: { by, tab, step, pkg, k, start, beat, end, ok } } }
//     by    = 직원 이름(앱 등록 이름, 없으면 '이름 없음') · tab = 'zikjin'|'ably' · step = 1|2
//     pkg   = 패키지명 앞부분(2단계만, 예 ZG261113) · k = ship-made madeKey(파일 해시 앞부분 — 상품 정보 없음)
//     start·beat·end = ms(클라이언트 시계). end 0 = 진행 중. ok = 성공 true / 실패 false / 진행 중 null
//   날짜가 바뀌면 통째로 새로 쓴다. 최대 RUNS_MAX 개(오래된 것부터 지움).

import { kstDay } from './ship-core.js?v=202611131345';
import { kstHHMM } from './ship-made.js?v=202611131345';

export const ACTIVITY_PATH = ['artifacts', 'team-work-logger-v2', 'persistent_data', 'shipActivity'];
export const RUNS_MAX = 40;
export const BEAT_MS = 60 * 1000;          // 진행 중이면 이 간격으로 beat 만 고친다(필드 경로 한 칸 — js/ship-store.js beatActivity)
export const STALE_MS = 3 * 60 * 1000;     // beat 가 이보다 오래되면(창을 닫았거나 멈춤) 진행 중으로 보지 않는다
const TAB_LABEL = { zikjin: '직진배송', ably: '에이블리' };

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : '');

/** 새 실행 id — 이 PC·이 실행만 구분(사람 정보 없음) */
export function newRunId(rand = Math.random, now = Date.now()) {
    return 'r' + now.toString(36) + Math.floor(rand() * 1e8).toString(36);
}

/** 한 실행 칸 정리 → 올바르지 않으면 null */
function cleanRun(id, r) {
    if (!r || typeof r !== 'object') return null;
    if (r.tab !== 'zikjin' && r.tab !== 'ably') return null;
    if (r.step !== 1 && r.step !== 2) return null;
    const start = num(r.start);
    if (!start) return null;
    return {
        id, by: str(r.by) || '이름 없음', tab: r.tab, step: r.step, pkg: str(r.pkg, 24), k: str(r.k, 80),
        start, beat: num(r.beat) || start, end: num(r.end), ok: r.ok === true ? true : (r.ok === false ? false : null),
    };
}

/** 문서 값 → 오늘 실행 목록(시작 순). 다른 날 문서면 [] */
export function normalizeActivity(raw, now = new Date()) {
    const day = kstDay(now).ymd10;
    if (!raw || typeof raw !== 'object' || raw.day !== day || !raw.runs || typeof raw.runs !== 'object') return [];
    return Object.entries(raw.runs).map(([id, r]) => cleanRun(id, r)).filter(Boolean).sort((a, b) => a.start - b.start);
}

/** 진행 중인 남의 실행(내 실행 id 는 뺌, beat 가 STALE_MS 안) — 늦게 시작한 것이 먼저 */
export function activeOthers(runs, mine = [], now = Date.now()) {
    const my = new Set(mine);
    return (runs || []).filter(r => !r.end && !my.has(r.id) && now - r.beat < STALE_MS).sort((a, b) => b.start - a.start);
}

/** 오늘 마지막으로 끝난 실행(성공·실패 모두) 또는 null */
export function lastDone(runs) {
    let best = null;
    for (const r of runs || []) if (r.end && (!best || r.end > best.end)) best = r;
    return best;
}

/** 오늘 같은 묶음(k) — 다른 자리가 성공한 실행(가장 늦은 것) → { at:'HH:MM', by },
 *  없으면 다른 자리가 지금 만드는 중인 실행 → { at: 시작 'HH:MM', by, busy: true }, 둘 다 없으면 null(내 실행 id 는 뺌) */
export function findSharedMade(runs, k, mine = [], now = Date.now()) {
    if (!k) return null;
    const my = new Set(mine);
    let best = null;
    for (const r of runs || []) if (r.k === k && r.ok === true && r.end && !my.has(r.id) && (!best || r.end > best.end)) best = r;
    if (best) return { at: kstHHMM(new Date(best.end)), by: best.by };
    const live = activeOthers(runs, mine, now).find(r => r.k === k);
    return live ? { at: kstHHMM(new Date(live.start)), by: live.by, busy: true } : null;
}

const what = (r) => `${TAB_LABEL[r.tab]} ${r.step}단계${r.pkg ? ` ${r.pkg}` : ''}`;

/** 머리 안내 줄 → { tone:'busy'|'done'|'fail', text } 또는 null(오늘 기록 없음) */
export function activityBanner(runs, mine = [], now = Date.now()) {
    const act = activeOthers(runs, mine, now);
    if (act.length) {
        const r = act[0];
        const more = act.length > 1 ? ` 외 ${act.length - 1}건` : '';
        return { tone: 'busy', text: `${r.by} 님이 ${what(r)} 만드는 중 (${kstHHMM(new Date(r.start))} 시작)${more}` };
    }
    const d = lastDone(runs);
    if (!d) return null;
    const total = (runs || []).filter(r => r.end && r.ok === true).length;
    return d.ok === true
        ? { tone: 'done', text: `오늘 마지막 작업: ${d.by} 님 · ${what(d)} · ${kstHHMM(new Date(d.end))} 완료 (오늘 완료 ${total}건)` }
        : { tone: 'fail', text: `오늘 마지막 작업: ${d.by} 님 · ${what(d)} · ${kstHHMM(new Date(d.end))} 실패 (오늘 완료 ${total}건)` };
}

/**
 * 트랜잭션 안에서 쓸 새 문서 값 — 지금 문서(raw)에 실행 하나를 넣거나 고친다.
 *   patch = { id, ...바꿀 칸 }. 날짜가 바뀌었으면 오늘 것만 새로. 없던 실행에 start 가 없으면 넣지 않는다(끝 기록만 늦게 온 경우).
 *   RUNS_MAX 를 넘으면 오래 시작한 것부터 지운다(진행 중인 것은 남김).
 */
export function applyRunPatch(raw, patch, now = new Date()) {
    const day = kstDay(now).ymd10;
    const cur = raw && typeof raw === 'object' && raw.day === day && raw.runs && typeof raw.runs === 'object' ? raw.runs : {};
    const runs = {};
    for (const [id, r] of Object.entries(cur)) { const c = cleanRun(id, r); if (c) { const { id: _, ...v } = c; runs[id] = v; } }
    const { id, ...fields } = patch || {};
    if (!id) return { day, runs };
    const merged = { ...(runs[id] || {}), ...fields };
    const c = cleanRun(id, merged);
    if (c) { const { id: _, ...v } = c; runs[id] = v; }
    const ids = Object.keys(runs);
    if (ids.length > RUNS_MAX) {
        const drop = ids.filter(x => x !== id).sort((a, b) => (runs[a].end ? 0 : 1) - (runs[b].end ? 0 : 1) || runs[a].start - runs[b].start)
            .slice(0, ids.length - RUNS_MAX);
        drop.forEach(x => { delete runs[x]; });
    }
    return { day, runs };
}
