// === js/lib/planned-fields.js ===
// 예정 물량 입력창 자동 저장 — 칸 하나를 '무엇으로 저장할지' 정하는 순수 함수(브라우저·Firebase 없음).
// tests/planned-fields.test.js 가 본다. DOM·Firestore 는 js/planned-autosave.js.
//
// 0·빈칸 규칙(2026-10-23 결정 — 업무 예상 '작업량 저장'의 keepZeros 와 같은 뜻):
//   0 이상 정수 → plannedQuantities.<업무> = 값  (0 = 그 날 그 업무는 0 으로 확정 — 업무 예상이 0 을 그대로 쓴다)
//   빈칸        → 그 업무 키를 지운다(다음에 열면 자동 추정값이 다시 깔린다)
// 비교 기준(lastSaved)은 **저장값**이다 — 칸에 보이는 자동 추정값이 아니다. 키가 없으면 null.
//   그래서 자동 추정값을 그대로 다시 치면 그 값으로 고정 저장된다.
// 숫자 검사는 처리량 칸과 같다(lib/qty-input.js parseQtyInput — 0 이상 정수만).

import { parseQtyInput } from './qty-input.js?v=202610301140';

/** 저장값 정리 — 0 이상 숫자는 그 값, 없음·음수·숫자 아님은 null(= 키 없음). */
export const normPlanned = (v) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
};

/** 칸 하나 → { ok:false } | { ok:true, changed, value }.
 *  value: 저장할 수(0 이상) 또는 null(빈칸 — 키 삭제). lastSaved: 마지막 저장값(키 없으면 null/undefined). */
export const plannedFieldOp = (raw, badInput, lastSaved) => {
    const r = parseQtyInput(raw, badInput);
    if (!r.ok) return { ok: false };
    const blank = String(raw == null ? '' : raw).trim() === '';
    const value = blank ? null : r.value;
    const changed = value !== normPlanned(lastSaved);
    return { ok: true, changed, value };
};

/** Firestore setDoc(merge) 에 넘길 칸. ops = [{ task, value }], del = deleteField() 결과.
 *  업무 이름은 중첩 객체의 키로만 쓴다 — 점 경로 문자열('plannedQuantities.상.하차')이 아니므로 점이 쪼개지지 않는다. */
export const plannedMergePayload = (ops, del) => {
    const pq = {};
    (ops || []).forEach(({ task, value }) => { pq[task] = value == null ? del : value; });
    return { plannedQuantities: pq };
};

/** 예정 물량 문서 전체 교체(setDoc)용 칸 — 서버 값을 **합친 뒤에** 만든다(js/history-data-manager.js savePlannedQuantities).
 *  local:  이 저장이 정한 값 + 넘기지 않은 항목의 캐시값 { quantities, timeTasks, excludeMinutes, adminWorkers, snapshot }
 *  server: 방금 서버에서 읽은 문서 데이터. 문서가 없거나 못 읽었으면 null(→ local 그대로)
 *  given:  이 저장이 직접 넘긴 항목 { timeTasks, excludeMinutes, adminWorkers } — 넘긴 항목만 서버 값으로 덮지 않는다
 *  norm:   { time, admin } — 서버 값 정리 함수
 *  넘기지 않은 항목은 서버 문서가 정본이다 — 키가 **없는 것**도 '비어 있음'(다른 PC 가 지운 값이 캐시에서 되살아나지 않게).
 *  스냅샷만은 서버에 있을 때만 바꾼다(없으면 캐시값 유지). 돌려준 칸을 Firestore 와 로컬 사본에 똑같이 쓴다. */
export const buildPlannedDoc = (local, server, given, norm) => {
    let { quantities, timeTasks, excludeMinutes, adminWorkers, snapshot } = local;
    if (server) {
        if (server.forecastSnapshot) snapshot = server.forecastSnapshot;
        if (!given.timeTasks) timeTasks = norm.time(server.plannedTimeTasks);
        if (!given.excludeMinutes) {
            const ex = server.plannedExcludeMinutes == null ? NaN : Number(server.plannedExcludeMinutes);
            excludeMinutes = Number.isFinite(ex) && ex >= 0 ? Math.round(ex) : null;
        }
        if (!given.adminWorkers) adminWorkers = norm.admin(server.plannedAdminWorkers);
    }
    const out = { plannedQuantities: quantities, plannedTimeTasks: timeTasks };
    if (excludeMinutes != null) out.plannedExcludeMinutes = excludeMinutes;
    if (adminWorkers != null) out.plannedAdminWorkers = adminWorkers;
    if (snapshot) out.forecastSnapshot = snapshot;
    return out;
};

/** 로컬 사본(State.plannedData 의 한 항목)에 같은 변경을 반영한 새 항목. 다른 칸(forecastSnapshot 등)은 그대로. */
export const applyPlannedOps = (rec, dateStr, ops) => {
    const base = rec ? { ...rec } : { id: dateStr };
    const pq = { ...(base.plannedQuantities || {}) };
    (ops || []).forEach(({ task, value }) => {
        if (value == null) delete pq[task];
        else pq[task] = value;
    });
    base.plannedQuantities = pq;
    return base;
};
