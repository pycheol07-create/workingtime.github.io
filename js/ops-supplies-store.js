// === js/ops-supplies-store.js ===
// 운영 리포트 '비품' 탭·팀 결산 '비품' 장의 읽기(2026-11-27). 계산은 js/lib/ops-supplies.js(순수).
//   한 벌 문서(비품 목록·스위치·재고·발주·예측)는 한 번 읽어 10분 캐시, 원장은 기간(한국 날짜)마다 날짜 범위 쿼리 + limit 으로 10분 캐시.
//   탭을 다시 열거나 같은 기간을 다시 그려도 다시 읽지 않는다. [새로 읽기]는 invalidateSuppliesData().
//   읽기 규칙은 등록 직원 읽기(artifacts/**)지만 화면은 데이터 관리 권한(data.analysis)일 때만 부른다(통계 탭 js/ui-ops-supplies.js·결산).
//   못 읽은 문서는 ok.<이름> = false — 권한 거부(permission-denied)면 denied = true(화면은 '권한 없음'만).
//   하나라도 못 읽은 회차는 캐시에 남기지 않는다(다음에 다시 읽음 — 스위치를 못 읽은 채 10분 '못 읽음' 이 남지 않게).
//   원장은 켜짐이거나 켠 적이 있으면(liveAt — 다시 끈 경우 그 기간은 원장으로 센다, js/lib/ops-supplies.js ledgerWindow) 읽는다.
// ⚠️ 비품 목록 문서에는 공급처 이름·연락처·단가가 같이 있다 — 이 파일은 넘기기만 하고 콘솔·로그에 내용을 찍지 않는다(오류는 code 만).

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { loadLedger, loadStock } from './supplies-ledger-store.js?v=bd8190f12a34-0854dfa3';
import { kstRangeMs, LEDGER_MAX } from './lib/ops-supplies.js?v=f5cbd8a554cf-1a2dc6de';
import { atMs } from './lib/supplies-mode.js?v=5f016d6adc90-90c9a625';

const BASE = ['artifacts', 'team-work-logger-v2'];
const TTL = 10 * 60 * 1000;

let baseCache = null;            // { at, promise }
const ledgerCache = new Map();   // 'from|to' → { at, promise }

const codeOf = (e) => (e && e.code) || (e && e.name) || 'error';
const denied = (e) => codeOf(e) === 'permission-denied';

/** 캐시 비우기 — 다음 읽기에서 서버에서 다시 */
export function invalidateSuppliesData() { baseCache = null; ledgerCache.clear(); }

async function readDoc(db, ...path) {
    const s = await getDoc(doc(db, ...BASE, ...path));
    return s.exists() ? s.data() : null;
}

function loadBase(db) {
    if (baseCache && Date.now() - baseCache.at < TTL) return baseCache.promise;
    const promise = (async () => {
        const out = { items: [], settings: null, stock: {}, ordersDoc: null, forecastDoc: null,
            ok: { items: false, settings: false, stock: false, orders: false, forecast: false }, denied: false };
        const tasks = [
            readDoc(db, 'persistent_data', 'supplies').then(d => { out.items = d && Array.isArray(d.items) ? d.items : []; out.ok.items = true; }),
            readDoc(db, 'persistent_data', 'suppliesSettings').then(d => { out.settings = d; out.ok.settings = true; }),
            loadStock(db).then(s => { out.stock = s; out.ok.stock = true; }),
            readDoc(db, 'persistent_data', 'suppliesOrders').then(d => { out.ordersDoc = d || { orders: {} }; out.ok.orders = true; }),
            readDoc(db, 'integrations', 'suppliesForecast').then(d => { out.forecastDoc = d; out.ok.forecast = true; })
        ];
        const res = await Promise.allSettled(tasks);
        res.forEach(r => { if (r.status === 'rejected' && denied(r.reason)) out.denied = true; });
        const bad = res.filter(r => r.status === 'rejected').map(r => codeOf(r.reason));
        if (bad.length) console.warn('비품 리포트 문서 일부를 못 읽음:', bad.join(','));
        return out;
    })();
    baseCache = { at: Date.now(), promise };
    // 실패(통째로)했거나 일부를 못 읽은 회차는 캐시에 남기지 않는다
    const drop = () => { if (baseCache && baseCache.promise === promise) baseCache = null; };
    promise.then(out => { if (Object.values(out.ok).some(v => !v)) drop(); }, drop);
    return promise;
}

function loadRange(db, from, to) {
    const key = `${from}|${to}`;
    const c = ledgerCache.get(key);
    if (c && Date.now() - c.at < TTL) return c.promise;
    const r = kstRangeMs(from, to);
    const promise = (async () => {
        if (!r) return { ledger: [], full: false, ok: false, denied: false };
        try {
            const list = await loadLedger(db, { sinceMs: r.startMs, untilMs: r.endMs, max: LEDGER_MAX });
            return { ledger: list, full: !!list.full, ok: true, denied: false };
        } catch (e) {
            console.warn('비품 원장 기간 읽기 실패:', codeOf(e));
            if (ledgerCache.get(key) && ledgerCache.get(key).promise === promise) ledgerCache.delete(key);   // 실패는 캐시에 남기지 않음
            return { ledger: [], full: false, ok: false, denied: denied(e) };
        }
    })();
    ledgerCache.set(key, { at: Date.now(), promise });
    if (ledgerCache.size > 12) ledgerCache.delete(ledgerCache.keys().next().value);   // 오래된 기간부터 버림
    return promise;
}

/**
 * 기간(한국 날짜 from~to) 비품 리포트 자료 — buildSuppliesReport 에 그대로 넘길 모양.
 * 켠 적이 없으면(꺼짐·liveAt 없음) 원장은 읽지 않는다. 스위치를 못 읽으면 원장도 읽지 않는다(ok.ledger false — 사용·입고 '못 읽음').
 * @returns {Promise<{ items, settings, stock, ordersDoc, forecastDoc, ledger, ledgerFull, ok, denied }>}
 */
export async function loadSuppliesReportData(db, { from, to }) {
    const b = await loadBase(db);
    const everOn = !!(b.settings && (b.settings.ledgerLive === true || Number.isFinite(atMs(b.settings.liveAt))));
    const l = !b.ok.settings ? { ledger: [], full: false, ok: false, denied: false }
        : everOn ? await loadRange(db, from, to) : { ledger: [], full: false, ok: true, denied: false };
    return {
        items: b.items, settings: b.settings, stock: b.stock, ordersDoc: b.ordersDoc, forecastDoc: b.forecastDoc,
        ledger: l.ledger, ledgerFull: l.full,
        ok: { ...b.ok, ledger: l.ok },
        denied: b.denied || l.denied
    };
}
