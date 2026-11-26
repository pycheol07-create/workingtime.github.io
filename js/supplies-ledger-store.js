// === js/supplies-ledger-store.js — 비품 입출고 원장·재고 읽기·쓰기(2026-11-26 비품관리 앱 기준 전환 1단계) ===
// 계산은 js/lib/supplies-ledger.js(순수), 검사는 firestore.rules(suppliesLedger·suppliesStock 블록).
// 쓰기는 늘 한 트랜잭션: 비품마다 [기록 만들기 + 재고 문서 바꾸기]. 규칙이 둘이 맞는지(before·after·lastEntry) 본다.
// 같은 묶음(batchId)을 두 번 보내면 — 기록 id 가 같아 이미 있으면 그 묶음은 '이미 저장됨' 으로 끝낸다(중복 저장 없음).
import { doc, getDoc, collection, getDocs, query, where, orderBy, limit, startAfter, runTransaction, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { planBatch, planCount, planRevert, splitLines } from './lib/supplies-ledger.js?v=1d95dd023593-77eaa88c';

const BASE = ['artifacts', 'team-work-logger-v2'];
export const LEDGER_COLL = 'suppliesLedger';
export const STOCK_COLL = 'suppliesStock';
const ledgerRef = (db, id) => doc(db, ...BASE, LEDGER_COLL, id);
const stockRef = (db, id) => doc(db, ...BASE, STOCK_COLL, id);

/** 묶음 id — 기기·시각·난수(같은 묶음을 다시 보낼 때는 같은 값을 쓴다) */
export const newBatchId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** 전체 재고 { itemId: qty } (수십 건 — 컬렉션 통째) */
export async function loadStock(db) {
    const qs = await getDocs(collection(db, ...BASE, STOCK_COLL));
    const out = {};
    qs.forEach(d => { out[d.id] = Number(d.data().qty) || 0; });
    return out;
}

/** 비품 하나 재고(문서 없으면 0) */
export async function loadStockOf(db, itemId) {
    const s = await getDoc(stockRef(db, itemId));
    return s.exists() ? (Number(s.data().qty) || 0) : 0;
}

/**
 * 최근 기록(기본 30일) — 새 것부터. 비품별로 보려면 화면에서 거른다(at 한 칸 범위+정렬이라 복합 색인 필요 없음)
 * before = 앞 결과의 .cursor(마지막 문서) — 주면 그보다 오래된 것부터(더 보기). days 를 null 로 주면 날짜 제한 없음.
 * 돌려주는 배열에 .cursor(다음 [더 보기]용, 없으면 null)·.full(max 만큼 찼나 — 더 있을 수 있음)을 붙인다.
 * (같은 트랜잭션 기록은 at 이 같다 — 값이 아니라 문서로 이어 받아야 같은 시각 기록이 빠지지 않는다)
 */
export async function loadLedger(db, { days = 30, max = 500, before = null } = {}) {
    const parts = [];
    if (days != null) parts.push(where('at', '>=', Timestamp.fromMillis(Date.now() - days * 86400000)));
    parts.push(orderBy('at', 'desc'));
    if (before) parts.push(startAfter(before));
    parts.push(limit(max));
    const qs = await getDocs(query(collection(db, ...BASE, LEDGER_COLL), ...parts));
    const out = qs.docs.map(d => ({ id: d.id, ...d.data() }));
    Object.defineProperty(out, 'cursor', { value: qs.docs.length ? qs.docs[qs.docs.length - 1] : null });
    Object.defineProperty(out, 'full', { value: qs.docs.length >= max });
    return out;
}

function writeEntry(tx, db, e, me, extra = {}) {
    tx.set(ledgerRef(db, e.id), {
        itemId: e.itemId, kind: e.kind, qty: e.qty, before: e.before, after: e.after,
        byEmail: String(me.email || '').toLowerCase(), by: String(me.name || ''), at: serverTimestamp(), ...extra
    });
}
function writeStock(tx, db, e, prevRev) {
    tx.set(stockRef(db, e.itemId), { qty: e.after, rev: (prevRev || 0) + 1, lastEntry: e.id, updatedAt: serverTimestamp() });
}

/**
 * 입고·출고 저장. lines = [{ itemId, qty }](기본 단위 수량), dir = 'in'|'out', me = { email, name }, batchId = newBatchId()
 * 비품이 MAX_TX_ITEMS 넘으면 나눠 보낸다 — 앞 묶음이 저장된 뒤 뒤 묶음이 실패할 수 있다(결과에 묶음마다 표시).
 * @returns {Promise<{ parts: { ok, already?, errors?, entries? }[] }>}
 */
export async function commitLines(db, lines, dir, me, batchId) {
    const parts = [];
    // 먼저 묶음 전체를 지금 재고로 검사 — 나눠 보내다 뒤 덩어리에서 재고 부족이 드러나 앞 덩어리만 저장되는 일을 줄인다(경쟁은 남음)
    const allIds = [...new Set((Array.isArray(lines) ? lines : []).map(l => String(l && l.itemId || '')))];
    const pre = planBatch(lines, dir, {}, batchId);   // 모양 검사(비품 id·수량)
    if (!pre.ok && pre.errors.some(e => e.reason !== 'short')) return { parts: [{ ok: false, errors: pre.errors }] };
    try {
        const now = {};
        const ss = await Promise.all(allIds.map(id => getDoc(stockRef(db, id))));
        ss.forEach((s, k) => { now[allIds[k]] = s.exists() ? (Number(s.data().qty) || 0) : 0; });
        const whole = planBatch(lines, dir, now, batchId);
        if (!whole.ok) return { parts: [{ ok: false, errors: whole.errors }] };
    } catch (e) { return { parts: [{ ok: false, errors: [{ itemId: '', reason: 'write', code: e && e.code }] }] }; }
    const chunks = splitLines(lines);
    for (let i = 0; i < chunks.length; i++) {
        const bid = `${batchId}-${i}`;   // 덩어리가 하나여도 번호를 붙인다(다시 보낼 때 덩어리 구분이 바뀌지 않게)
        const ids = [...new Set(chunks[i].map(l => String(l.itemId)))];
        try {
            const r = await runTransaction(db, async (tx) => {
                const snaps = await Promise.all(ids.map(id => tx.get(stockRef(db, id))));
                const dones = await Promise.all(ids.map(id => tx.get(ledgerRef(db, `${bid}-${id}`))));
                const n = dones.filter(d => d.exists()).length;
                if (n === ids.length) {   // 이미 저장된 덩어리 — 수량까지 같을 때만 '이미 저장됨'(같은 줄 그대로 다시 보냄)
                    const want = {};
                    chunks[i].forEach(l => { const id = String(l.itemId); want[id] = (want[id] || 0) + Number(l.qty); });
                    const same = dones.every((d, k) => Math.abs(Number(d.data().qty)) === want[ids[k]]);
                    return same ? { ok: true, already: true } : { ok: false, errors: [{ itemId: '', reason: 'changed' }] };
                }
                if (n > 0) return { ok: false, errors: [{ itemId: '', reason: 'changed' }] };   // 줄이 바뀐 채 같은 batchId — 멈춤
                const now = {}, rev = {};
                snaps.forEach((s, k) => { now[ids[k]] = s.exists() ? (Number(s.data().qty) || 0) : 0; rev[ids[k]] = s.exists() ? (Number(s.data().rev) || 0) : 0; });
                const plan = planBatch(chunks[i], dir, now, bid);
                if (!plan.ok) return { ok: false, errors: plan.errors };
                plan.entries.forEach(e => { writeEntry(tx, db, e, me, { batchId: bid }); writeStock(tx, db, e, rev[e.itemId]); });
                return { ok: true, entries: plan.entries };
            });
            parts.push(r);
            if (!r.ok) break;   // 재고 부족 등 — 뒤 묶음은 보내지 않는다
        } catch (e) {
            parts.push({ ok: false, errors: [{ itemId: '', reason: 'write', code: e && e.code }] });
            break;
        }
    }
    return { parts };
}

/** 실사 — 센 수량으로 맞춤. 같으면 기록 없이 { ok:true, entry:null } */
export async function commitCount(db, itemId, counted, me, batchId) {
    return runTransaction(db, async (tx) => {
        const s = await tx.get(stockRef(db, itemId));
        const now = s.exists() ? (Number(s.data().qty) || 0) : 0;
        const p = planCount(itemId, counted, now, batchId);
        if (!p.ok || !p.entry) return p;
        const done = await tx.get(ledgerRef(db, p.entry.id));
        if (done.exists()) return { ok: true, already: true };
        writeEntry(tx, db, p.entry, me, { batchId });
        writeStock(tx, db, p.entry, s.exists() ? (Number(s.data().rev) || 0) : 0);
        return { ok: true, entry: p.entry };
    });
}

/** 되돌림 — orig = 원 기록 { id, itemId, kind, qty }. 이미 되돌렸으면 { ok:false, reason:'already' } */
export async function commitRevert(db, orig, me) {
    return runTransaction(db, async (tx) => {
        const s = await tx.get(stockRef(db, orig.itemId));
        const now = s.exists() ? (Number(s.data().qty) || 0) : 0;
        const p = planRevert(orig, now);
        if (!p.ok) return p;
        const done = await tx.get(ledgerRef(db, p.entry.id));
        if (done.exists()) return { ok: false, reason: 'already' };
        writeEntry(tx, db, p.entry, me, { ref: orig.id });
        writeStock(tx, db, p.entry, s.exists() ? (Number(s.data().rev) || 0) : 0);
        return { ok: true, entry: p.entry };
    });
}
