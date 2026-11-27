// === js/ops-insp-store.js ===
// 운영 리포트 '통계' 탭 '검수' 장·팀 결산 '검수 이력' 장의 읽기(2026-11-27). 계산은 js/lib/ops-insp.js buildInspReport(순수).
//   product_history(상품별 샘플검수 이력, 컬렉션 통째) — 10분 캐시(장을 다시 펼치거나 기간을 바꿔도 다시 읽지 않음).
//   total_inspection_logs(전량검수 기록) — 기간(date from~to) 쿼리 + limit INSP_LOG_MAX, 기간마다 10분 캐시. 상한에 차면 truncated(화면 '일부만').
//   실패한 읽기는 캐시에 남기지 않는다(다음에 다시 읽음). 같은 화면에서 검수를 저장하면(product-history-changed) 캐시를 비운다.
//   통계 탭은 장을 펼칠 때만 부른다(카드는 그 전까지 '펼치면 계산').
// ⚠️ 기록에는 검수자(inspector)가 있다 — 넘기기만 하고 콘솔·로그에 내용을 찍지 않는다(오류는 code 만).

import { getDocs, collection, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { INSP_LOG_MAX } from './lib/ops-insp.js?v=fe78bbb6adc1-f4bf8003';

const BASE = ['artifacts', 'team-work-logger-v2'];
const TTL = 10 * 60 * 1000;

let docsCache = null;           // { at, promise }
const logCache = new Map();     // 'from|to' → { at, promise }

const codeOf = (e) => (e && e.code) || (e && e.name) || 'error';
const isDenied = (e) => codeOf(e) === 'permission-denied';

/** 캐시 비우기 — [새로 읽기]·검수 저장 뒤 */
export function invalidateInspData() { docsCache = null; logCache.clear(); }
if (typeof document !== 'undefined') document.addEventListener('product-history-changed', invalidateInspData);

function loadDocs(db) {
    if (docsCache && Date.now() - docsCache.at < TTL) return docsCache.promise;
    const promise = (async () => {
        await null;
        try {
            const snap = await getDocs(collection(db, 'product_history'));
            const out = [];
            snap.forEach(d => out.push({ id: d.id, ...d.data() }));
            return { docs: out, ok: true, denied: false };
        } catch (e) {
            console.warn('검수 이력(product_history) 읽기 실패:', codeOf(e));
            if (docsCache && docsCache.promise === promise) docsCache = null;
            return { docs: [], ok: false, denied: isDenied(e) };
        }
    })();
    docsCache = { at: Date.now(), promise };
    return promise;
}

function loadLogs(db, from, to) {
    const key = `${from}|${to}`;
    const c = logCache.get(key);
    if (c && Date.now() - c.at < TTL) return c.promise;
    const promise = (async () => {
        await null;
        try {
            const ref = collection(db, ...BASE, 'total_inspection_logs');
            const snap = await getDocs(query(ref, where('date', '>=', from), where('date', '<=', to), orderBy('date', 'desc'), limit(INSP_LOG_MAX)));
            const out = [];
            snap.forEach(d => out.push({ id: d.id, ...d.data() }));
            return { logs: out, truncated: out.length >= INSP_LOG_MAX, ok: true, denied: false };
        } catch (e) {
            console.warn('전량검수 기록 기간 읽기 실패:', codeOf(e));
            const cur = logCache.get(key);
            if (cur && cur.promise === promise) logCache.delete(key);
            return { logs: [], truncated: false, ok: false, denied: isDenied(e) };
        }
    })();
    logCache.set(key, { at: Date.now(), promise });
    if (logCache.size > 12) logCache.delete(logCache.keys().next().value);
    return promise;
}

/**
 * 기간(from~to, 'YYYY-MM-DD') 검수 자료 — buildInspReport 에 넘길 모양.
 * @returns {Promise<{ productDocs:object[], totalLogs:object[], truncated:boolean, ok:{docs:boolean, logs:boolean}, denied:boolean }>}
 *   ok.docs false = 샘플 이력을 못 읽음(화면은 오류) · ok.logs false = 전량 기록을 못 읽음(샘플만 보이고 안내)
 */
export async function loadInspData(db, { from, to }) {
    const [d, l] = await Promise.all([loadDocs(db), loadLogs(db, from, to)]);
    return {
        productDocs: d.docs, totalLogs: l.logs, truncated: l.truncated,
        ok: { docs: d.ok, logs: l.ok }, denied: d.denied || l.denied
    };
}
