// === js/lib/forecast-correct-snap.js ===
// 설명: 업무 예상 보정 2단계 — 그날 계획 스냅샷을 얼릴 때 '보정 계획'(correctPlan 결과)을 같은 스냅샷의 corrected 칸에 같이 얼린다.
//       2주 동안 기본 계획과 나란히 쌓아 비교만 한다. 화면 계획·필요 인원·슬랙 알림(__forecastForDate)은 이 값을 쓰지 않는다.
//
//  규칙
//    · 기본 스냅샷은 이 계산 때문에 절대 실패하지 않는다 — 무슨 일이 있어도 throw 하지 않고, 실패면 corrected = null.
//    · corrected·correctedNotes 는 **항상 칸으로 쓴다(null·빈 배열이어도)** — 스냅샷 저장이 setDoc merge 라
//      칸을 빼면 다시 확정해도 옛 값이 남는다(history-data-manager.js saveForecastSnapshot).
//      byTask·notes 는 배열이라 merge 때도 통째로 바뀐다.
//    · 입력은 정확도 화면과 같은 순서로 맞춘다: 스냅샷(기준 포함) = aliasSnapshot → excludeTasksForAccuracy,
//      이력 = 지금 이름(호출하는 쪽이 이력() 을 넘김) → 제외 업무 뺌. 대상일 이전 **그리고** 오늘(ctx.today) 이전만 —
//      내일 이후를 확정할 때 오늘의 덜 찬 실적이 들어가지 않게.
//    · correctedNotes: 'snap-fetch-failed'(지난 스냅샷을 못 읽음) · 'calc-failed'(계산 중 예외). 정상이면 [].
//
//  순수 모듈(DOM·State·Firebase 없음). 테스트: tests/forecast-correct-snap.test.js

import { correctPlan } from './forecast-correct.js?v=202610301817';
import { excludeTasksForAccuracy } from '../forecast-accuracy.js?v=202610301817';
import { aliasSnapshot } from './task-alias-view.js?v=202610301817';

export const NOTE_SNAP_FETCH_FAILED = 'snap-fetch-failed';
export const NOTE_CALC_FAILED = 'calc-failed';

/** 지난 스냅샷을 읽을 범위 — target 기준 lookbackDays 일 전 ~ 전날. 'YYYY-MM-DD' 가 아니면 null. */
export function correctSnapRange(target, lookbackDays = 70) {
    if (typeof target !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
    const d = new Date(`${target}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    const shift = (n) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() - n); return x.toISOString().slice(0, 10); };
    return { from: shift(lookbackDays), to: shift(1) };
}

/** correctPlan 입력 만들기.
 *  ctx: { target, today('YYYY-MM-DD', 선택 — 이 날 이후 이력은 뺀다), history(지금 이름), snapshots{날짜:원본 스냅샷},
 *         cfg(별칭 설정), excluded(Set·배열), sources{업무:출처} } */
export function correctInputOf(snapshot, ctx) {
    const c = ctx || {};
    const excluded = new Set([...(c.excluded || [])]);
    const target = c.target;
    const today = typeof c.today === 'string' && c.today ? c.today : null;
    const 정리 = (s) => excludeTasksForAccuracy(aliasSnapshot(s, c.cfg), null, excluded).snap;
    const snapshots = {};
    Object.entries(c.snapshots && typeof c.snapshots === 'object' ? c.snapshots : {}).forEach(([id, s]) => {
        if (s && typeof s === 'object' && id < target) snapshots[id] = 정리(s);
    });
    const history = (Array.isArray(c.history) ? c.history : [])
        .filter(d => d && typeof d.id === 'string' && d.id < target && (!today || d.id < today))
        .map(d => excludeTasksForAccuracy(null, d, excluded).day);
    const b = 정리(snapshot) || {};
    const base = { tasks: b.tasks || {}, timeTasks: b.timeTasks || {}, uph: b.uph || {}, totalHours: b.totalHours };
    return { target, history, snapshots, base, sources: c.sources || {}, excluded };
}

/** Firestore 에 그대로 넣을 수 있게 — undefined 칸을 없애고 NaN·Infinity 는 null 로. */
const 저장형 = (v) => JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isFinite(x) ? null : x)));

/** 스냅샷에 corrected·correctedNotes 를 붙인 사본. snapshot 이 없으면 그대로 돌려준다.
 *  ctx: correctInputOf 의 ctx + { snapFetchFailed, getSources() } — getSources 는 이 함수의 try 안에서 부른다
 *  (출처를 구하다 예외가 나도 기본 스냅샷은 그대로 나간다). onError(e) 는 실패 때 한 번(로그용). */
export function withCorrected(snapshot, ctx) {
    if (!snapshot || typeof snapshot !== 'object') return snapshot;
    const c = ctx || {};
    let corrected = null;
    let notes = [];
    if (c.snapFetchFailed) {
        notes = [NOTE_SNAP_FETCH_FAILED];
    } else {
        try {
            const sources = typeof c.getSources === 'function' ? (c.getSources() || {}) : (c.sources || {});
            corrected = 저장형(correctPlan(correctInputOf(snapshot, { ...c, sources })));
        } catch (e) {
            corrected = null;
            notes = [NOTE_CALC_FAILED];
            try { if (typeof c.onError === 'function') c.onError(e); } catch (_) { /* 로그 실패는 무시 */ }
        }
    }
    return { ...snapshot, corrected, correctedNotes: notes };
}
