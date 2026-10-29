// === js/products-store.js ===
// 상품 관리 — 데이터 읽기·브라우저 저장(IndexedDB)·읽기 횟수. 2026-10-13. 설계: 상품DB_설계_v2.md 1·2장
//
// 읽는 것(로그인 전원): ProductCatalog/META → rev 가 바뀐 버킷 Bxx 만 · ProductNotes 변경분 · ProductLoc/META → 바뀌면 Lxx
//   평소 열기 = META 1 + 메모 1 + LOC META 1 = 3회. 그날 처음·업로드 뒤에만 버킷·LOC 를 더 받는다.
// 브라우저 저장: IndexedDB 'ggsing-products' — **기본정보·메모·위치만**. 원가는 저장하지 않는다(products-cost.js 메모리만).
// onSnapshot 은 쓰지 않는다(전부 getDoc). [새로고침] = 같은 흐름 한 번 더.
// 읽기 횟수: window.__productReads = { total, by: {종류: 수} } — 콘솔에서 확인용(값은 찍지 않는다).
import {
    doc, getDoc, getDocs, collection, query, where, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { catalogBucketIds, CATALOG_BUCKETS } from './lib/product-bucket.js?v=202610291119';
import { parseCatalogJson } from './lib/product-excel-rows.js?v=202610291119';

const IDB_NAME = 'ggsing-products';
const IDB_VER = 1;
const SCHEMA = 2;                       // 바뀌면 저장소를 통째로 비운다
const STORES = ['chunks', 'notes', 'loc', 'kv'];

/** 페이지 전체가 같이 쓰는 상태 (products.js 가 db·auth·user·isAdmin 을 채운다) */
export const S = {
    db: null, auth: null, user: null, email: '', isAdmin: false,
    meta: null,                          // ProductCatalog/META 데이터
    products: new Map(),                 // pid → 상품 객체(ver, bid 포함)
    owner: new Map(),                    // 상품코드(S) → pid
    notes: new Map(),                    // pid → { inspect, pack, at(ms), by, h }
    loc: null,                           // { l, r, s } | null
    locMeta: null,                       // ProductLoc/META | null
    loadedAt: 0,
};

// ── 읽기 횟수 ─────────────────────────────────────────────
window.__productReads = { total: 0, by: {} };
export function countRead(kind, n = 1) {
    const r = window.__productReads;
    r.total += n;
    r.by[kind] = (r.by[kind] || 0) + n;
    console.log(`[products] 읽기 ${kind} +${n} (누적 ${r.total})`);
}

// ── IndexedDB (없거나 막혀도 동작 — 그땐 매번 받는다) ──────────
let idbP = null;
function idb() {
    if (idbP) return idbP;
    idbP = new Promise((resolve) => {
        try {
            const req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = () => { for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s); };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
        } catch (e) { resolve(null); }
    });
    return idbP;
}
function idbReq(store, mode, fn) {
    return idb().then(db => new Promise((resolve) => {
        if (!db) return resolve(undefined);
        try {
            const tx = db.transaction(store, mode);
            const r = fn(tx.objectStore(store));
            tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
            tx.onerror = () => resolve(undefined);
            tx.onabort = () => resolve(undefined);
        } catch (e) { resolve(undefined); }
    }));
}
export const idbGet = (store, key) => idbReq(store, 'readonly', s => s.get(key));
export const idbPut = (store, key, val) => idbReq(store, 'readwrite', s => s.put(val, key));
const idbClear = (store) => idbReq(store, 'readwrite', s => s.clear());
function idbAll(store) {
    return idb().then(db => new Promise((resolve) => {
        if (!db) return resolve([]);
        try {
            const out = [];
            const req = db.transaction(store, 'readonly').objectStore(store).openCursor();
            req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
            req.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
    }));
}

async function ensureSchema() {
    const v = await idbGet('kv', 'schema');
    if (v === SCHEMA) return;
    for (const s of STORES) await idbClear(s);
    await idbPut('kv', 'schema', SCHEMA);
}

const tsMs = (v) => (v && typeof v.toMillis === 'function') ? v.toMillis() : (typeof v === 'number' ? v : 0);

// ── 기본정보 ─────────────────────────────────────────────
/** META 1회 → rev 가 바뀐 버킷만 받는다. force 면 버킷도 전부 다시 받는다. */
export async function loadCatalog({ force = false } = {}) {
    const ms = await getDoc(doc(S.db, 'ProductCatalog', 'META'));
    countRead('META');
    S.meta = ms.exists() ? ms.data() : null;
    S.products = new Map();
    S.owner = new Map();
    if (!S.meta) return;
    const n = Number(S.meta.n) || CATALOG_BUCKETS;
    const ids = catalogBucketIds(n);
    const chunks = await Promise.all(ids.map(async (bid) => {
        const rev = Number(S.meta.chunks?.[bid]?.rev) || 0;
        if (!rev) return [bid, {}];                       // 한 번도 쓴 적 없는 버킷 — 읽지 않는다
        const cached = force ? null : await idbGet('chunks', bid);
        if (cached && cached.rev === rev && cached.p) return [bid, cached.p];
        const snap = await getDoc(doc(S.db, 'ProductCatalog', bid));
        countRead('버킷');
        const p = snap.exists() ? (snap.data().p || {}) : {};
        await idbPut('chunks', bid, { rev, p });
        return [bid, p];
    }));
    for (const [bid, p] of chunks) {
        for (const [pid, json] of Object.entries(p)) {
            const obj = parseCatalogJson(json);
            if (!obj) continue;
            obj.bid = bid;
            S.products.set(pid, obj);
            for (const o of obj.o) S.owner.set(o[0], pid);
        }
    }
}

/** 저장(업로드·편집) 직후 내 화면에 바로 반영 — 다음 새로고침 때 그 버킷만 다시 받는다 */
export function applyLocalProduct(pid, obj) {
    const old = S.products.get(pid);
    if (old) for (const o of old.o) if (S.owner.get(o[0]) === pid) S.owner.delete(o[0]);
    S.products.set(pid, obj);
    for (const o of obj.o) S.owner.set(o[0], pid);
}

// ── 메모 ─────────────────────────────────────────────────
/** 변경분 질의: at >= 마지막으로 본 시각(같은 시각 누락 방지). 0건이어도 읽기 1회 */
export async function loadNotes() {
    if (!S.notes.size) for (const [pid, v] of await idbAll('notes')) S.notes.set(pid, v);
    const since = Number(await idbGet('kv', 'notesSince')) || 0;
    const col = collection(S.db, 'ProductNotes');
    const snap = await getDocs(since ? query(col, where('at', '>=', Timestamp.fromMillis(since))) : col);
    countRead('메모', Math.max(1, snap.size));
    let max = since;
    for (const d of snap.docs) {
        const x = d.data();
        const note = { inspect: x.inspect || '', pack: x.pack || '', at: tsMs(x.at), by: x.by || '', h: noteHistory(x.h) };
        S.notes.set(d.id, note);
        await idbPut('notes', d.id, note);
        if (note.at > max) max = note.at;
    }
    if (max > since) await idbPut('kv', 'notesSince', max);
}

/** 직전 기록 h → 화면·IndexedDB 용(at 을 ms 로) */
export const noteHistory = (h) => (Array.isArray(h) ? h : []).map(e => ({ inspect: (e && e.inspect) || '', pack: (e && e.pack) || '', at: tsMs(e && e.at), by: (e && e.by) || '' }));

export async function putLocalNote(pid, note) {
    S.notes.set(pid, note);
    await idbPut('notes', pid, note);
}

// ── 위치·재고 요약 (채우기자동화가 평일 아침에 씀) ──────────────
export async function loadLoc() {
    const ms = await getDoc(doc(S.db, 'ProductLoc', 'META'));
    countRead('LOC META');
    S.locMeta = ms.exists() ? ms.data() : null;
    if (!S.locMeta || !S.locMeta.rev) { S.loc = null; return; }
    const cached = await idbGet('loc', 'cur');
    if (cached && cached.rev === S.locMeta.rev && cached.data) { S.loc = cached.data; return; }
    const n = Number(S.locMeta.n) || 1;
    const merged = { l: {}, r: {}, s: {} };
    let consistent = true;
    for (let i = 0; i < n; i++) {
        const snap = await getDoc(doc(S.db, 'ProductLoc', 'L' + String(i).padStart(2, '0')));
        countRead('LOC');
        if (!snap.exists()) { consistent = false; continue; }
        const d = snap.data();
        if (d.rev !== S.locMeta.rev) consistent = false;       // 쓰는 도중 — 화면엔 쓰되 저장하지 않는다
        try {
            const x = JSON.parse(d.data || '{}');
            for (const k of ['l', 'r', 's']) Object.assign(merged[k], x[k] || {});
        } catch (e) { consistent = false; }
    }
    S.loc = merged;
    if (consistent) await idbPut('loc', 'cur', { rev: S.locMeta.rev, data: merged });
}

/** 전체 불러오기 — 메모·위치 실패는 화면을 막지 않는다(경고만) */
export async function loadAll({ force = false } = {}) {
    await ensureSchema();
    const results = await Promise.allSettled([loadCatalog({ force }), loadNotes(), loadLoc()]);
    S.loadedAt = Date.now();
    const names = ['기본정보', '메모', '위치'];
    const fails = results.map((r, i) => r.status === 'rejected' ? `${names[i]}(${(r.reason && r.reason.code) || '오류'})` : '').filter(Boolean);
    if (results[0].status === 'rejected') throw results[0].reason;
    return fails;
}

// ── 조회 도우미 ───────────────────────────────────────────
/** 상품코드(S) 하나의 위치 → { spots: [[자리, 대분류, 수량, 칸수]], reserve: [수량, 위치]|null, stock: [정상, 출고예정]|null } */
export function locOf(scode) {
    const L = S.loc;
    if (!L) return { spots: [], reserve: null, stock: null };
    return { spots: L.l[scode] || [], reserve: L.r[scode] || null, stock: L.s[scode] || null };
}

/** 상품 전체(옵션 합) 위치 요약 → { spots: n, qty: 합, first: 자리|null } */
export function locSummary(p) {
    let spots = 0, qty = 0, first = null;
    for (const o of p.o) {
        if (o[4]) continue;
        for (const s of locOf(o[0]).spots) {
            spots++;
            const q = Number(s[2]);
            if (Number.isFinite(q)) qty += q;
            if (!first) first = s[0];
        }
    }
    return { spots, qty, first };
}

export const fmtDateTime = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
export { tsMs };
