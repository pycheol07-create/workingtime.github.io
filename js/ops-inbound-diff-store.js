// === js/ops-inbound-diff-store.js ===
// 운영 리포트 '입고 오차' 탭·팀 결산 '입고 오차' 장의 읽기(2026-11-27). 계산은 js/lib/ops-inbound-diff.js → js/lib/inbound-diff.js.
//   ChinaStockGoods_InboundDiff 를 기간(출고일) 문서 ID 범위로 읽는다 — 범위는 부족수량관리 통계와 같은 queryRange(앞 30일 여유·묶음 ID 포함),
//   문서 ID(출고일) 오름차순으로 INBOUND_DIFF_MAX_DOCS 개까지(내림차순은 색인이 필요해 쓰지 않는다 — 하루 1건 안팎이라 1년 + 30일도 상한 안). 같은 기간은 10분 동안 다시 읽지 않는다(실패는 캐시에 남기지 않음).
//   읽기 규칙은 등록 직원. 화면은 데이터 관리 권한(data.analysis)일 때만 부른다(통계 탭·결산).
// ⚠️ 문서에는 저장자(by)가 있다 — 넘기기만 하고 콘솔·로그에 내용을 찍지 않는다(오류는 code 만).

import { getDocs, collection, query, where, limit, documentId } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { queryRange } from './lib/inbound-diff.js?v=6028b21f8c15-bb911da2';
import { INBOUND_DIFF_MAX_DOCS } from './lib/ops-inbound-diff.js?v=624ad11b88d5-b9e1dbc8';

const COLL = 'ChinaStockGoods_InboundDiff';   // js/china-mibal2-scan.js INBOUND_DIFF_COLL 와 같다
const TTL = 10 * 60 * 1000;
const cache = new Map();   // 'from|to' → { at, promise }

const codeOf = (e) => (e && e.code) || (e && e.name) || 'error';
const isDenied = (e) => !!e && (e.code === 'permission-denied' || /permission/i.test(String(e.message || '')));

/** 캐시 비우기 — [새로 읽기] */
export function invalidateInboundDiffData() { cache.clear(); }

/**
 * 기간(출고일 from~to, 'YYYY-MM-DD') 입고 오차 문서.
 * @returns {Promise<{ records:object[], full:boolean, ok:boolean, denied:boolean }>}  full = 상한만큼 찼나(기간 뒷부분이 빠졌을 수 있음)
 */
export function loadInboundDiffRange(db, { from, to }) {
    const key = `${from}|${to}`;
    const c = cache.get(key);
    if (c && Date.now() - c.at < TTL) return c.promise;
    const promise = (async () => {
        await null;   // 아래 catch 가 promise 를 보므로 한 박자 늦춘다(쿼리 만들기가 바로 던져도 안전)
        try {
            const { start, end } = queryRange(from, to);
            const cons = [];
            if (start) cons.push(where(documentId(), '>=', start));
            if (end) cons.push(where(documentId(), '<=', end));
            cons.push(limit(INBOUND_DIFF_MAX_DOCS));   // 기본 순서 = 문서 ID 오름차순
            const snap = await getDocs(query(collection(db, COLL), ...cons));
            return { records: snap.docs.map(d => d.data()), full: snap.docs.length >= INBOUND_DIFF_MAX_DOCS, ok: true, denied: false };
        } catch (e) {
            console.warn('입고 오차 기록 읽기 실패:', codeOf(e));
            const cur = cache.get(key);
            if (cur && cur.promise === promise) cache.delete(key);
            return { records: [], full: false, ok: false, denied: isDenied(e) };
        }
    })();
    cache.set(key, { at: Date.now(), promise });
    if (cache.size > 12) cache.delete(cache.keys().next().value);
    return promise;
}
