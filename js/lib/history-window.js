// === js/lib/history-window.js ===
// 이력 조회 범위(며칠 전부터)와 빈 날 채우기. (2026-10-22)
//   fillHistoryDays 는 fetchAllHistoryData 안에 있던 반복문을 그대로 옮긴 것이다 —
//   전체 이력(12개월)과 대시보드(최근 100일)가 같은 모양의 배열을 받게 한다.
// 순수 모듈(DOM/Firebase 의존 없음). 날짜는 'YYYY-MM-DD'.

/** today 에서 days 일 전 날짜. new Date('YYYY-MM-DD') 는 UTC 자정이라 UTC 로만 계산한다(하루 밀림 방지). */
export function cutoffDate(today, days) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (Number(days) || 0));
    return d.toISOString().slice(0, 10);
}

/** 이력에 문서가 없는 날에 넣는 빈 행(기존 fetchAllHistoryData 와 같은 모양). */
export const emptyHistoryDay = (id) => ({
    id, workRecords: [], taskQuantities: {}, onLeaveMembers: [], partTimers: [],
    management: { revenue: 0, orderCount: 0, inventoryQty: 0, inventoryAmt: 0 }, inspectionList: []
});

/** dataMap(Map: 날짜 → 문서) 을 minDate ~ today 하루씩 채운 배열로(최신순).
 *  minDate 가 비면 dataMap 의 가장 이른 날(없으면 today) — 기존 동작. 범위 밖 문서(미래 날짜 등)는 넣지 않는다. */
export function fillHistoryDays(dataMap, minDate, today) {
    let start = minDate;
    if (!start) {
        start = today;
        if (dataMap && dataMap.size > 0) {
            const keys = Array.from(dataMap.keys());
            keys.sort();
            start = keys[0];
        }
    }

    const out = [];
    const current = new Date(start);
    const end = new Date(today);
    while (current <= end) {
        // ⓘ current 는 new Date('YYYY-MM-DD') = UTC 자정이라 toISOString 과 짝이 맞는다.
        //    (로컬 자정으로 만든 날짜였다면 하루 밀렸을 자리 — utils.toDateString 참고)
        const dateStr = current.toISOString().slice(0, 10);
        out.push(dataMap && dataMap.has(dateStr) ? dataMap.get(dateStr) : emptyHistoryDay(dateStr));
        current.setDate(current.getDate() + 1);
    }

    out.sort((a, b) => b.id.localeCompare(a.id));
    return out;
}

/** 전체 이력 조회 시작일 — 오늘이 속한 달에서 months 달 앞의 1일(운영 계획 v2 D1: 13개월 + 이번 달).
 *  예) 2026-11-05, 13 → 2025-10-01. 달력 계산은 'YYYY-MM' 숫자로만(시간대 영향 없음). */
export function historyRangeStart(today, months = 13) {
    const y = Number(String(today).slice(0, 4)), m = Number(String(today).slice(5, 7));
    const t = y * 12 + (m - 1) - (Number(months) || 0);
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
}

/** 캐시에 넣을 이력 — 글자 수가 maxChars 를 넘으면 가장 오래된 달(13번째 달)을 빼 본다.
 *  빠진 달은 월 요약(OpsMonthly)으로 보충한다(js/ops-monthly-store.js). 그래도 넘으면 null(캐시하지 않음).
 *  @returns {{ json, trimmedFrom }|null} trimmedFrom = 캐시가 이 날짜부터만 담았음(안 뺐으면 null) */
export function cacheJsonOf(days, today, maxChars, months = 13) {
    const full = JSON.stringify(days);
    if (full.length <= maxChars) return { json: full, trimmedFrom: null };
    const from = historyRangeStart(today, months - 1);
    const cut = JSON.stringify((days || []).filter(d => d && typeof d.id === 'string' && d.id >= from));
    return cut.length <= maxChars ? { json: cut, trimmedFrom: from } : null;
}
