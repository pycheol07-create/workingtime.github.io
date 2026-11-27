// === js/supplies-ledger-store.js — 비품 입출고 원장·재고 읽기·쓰기(2026-11-26 비품관리 앱 기준 전환 1단계) ===
// 계산은 js/lib/supplies-ledger.js(순수), 검사는 firestore.rules(suppliesLedger·suppliesStock 블록).
// 쓰기는 늘 한 트랜잭션: 비품마다 [기록 만들기 + 재고 문서 바꾸기]. 규칙이 둘이 맞는지(before·after·lastEntry) 본다.
// 같은 묶음(batchId)을 두 번 보내면 — 기록 id 가 같아 이미 있으면 그 묶음은 '이미 저장됨' 으로 끝낸다(중복 저장 없음).
import { doc, getDoc, getDocFromServer, collection, getDocs, query, where, orderBy, limit, startAfter, runTransaction, serverTimestamp, Timestamp, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { planBatch, planCount, planRevert, splitLines } from './lib/supplies-ledger.js?v=44c94c8b86ad-92d65f68';

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

/**
 * 기록 id 들이 서버에 있나 — 있는 id 의 Set. 서버에서 못 읽으면 예외(캐시로 답하지 않는다 — 연결이 없을 때 캐시는 '없음' 으로 보여
 * 들어간 기록을 '안 들어감' 으로 잘못 알고 새 묶음으로 두 번 저장하게 된다). 연결 오류 뒤 '들어갔나' 확인용(js/supplies-io.js).
 */
export async function ledgerEntriesOnServer(db, ids) {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))];
    const snaps = await Promise.all(list.map(id => getDocFromServer(ledgerRef(db, id))));
    return new Set(list.filter((id, k) => snaps[k].exists()));
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
        // 같은 묶음을 다시 보낸 것(연결이 끊겨 결과를 몰랐던 경우)이면 미리 검사를 건너뛴다 — 이미 빠진 재고로 '재고 부족' 이 나지 않게.
        //   실제 저장 여부는 아래 덩어리마다 트랜잭션이 기록 id 로 판정한다
        const first = splitLines(lines)[0] || [];
        const firstId = first.length ? String(first[0].itemId) : '';
        // 서버에서만 본다 — 연결이 없을 때 캐시(빈 사본)로 '없음' 을 믿으면 이미 빠진 재고로 미리 검사해 '재고 부족' 이 난다
        if (firstId && (await getDocFromServer(ledgerRef(db, `${batchId}-0-${firstId}`))).exists()) throw { skipPre: true };
        const now = {};
        const ss = await Promise.all(allIds.map(id => getDoc(stockRef(db, id))));
        ss.forEach((s, k) => { now[allIds[k]] = s.exists() ? (Number(s.data().qty) || 0) : 0; });
        const whole = planBatch(lines, dir, now, batchId);
        if (!whole.ok) return { parts: [{ ok: false, errors: whole.errors }] };
    } catch (e) {
        if (!(e && e.skipPre)) return { parts: [{ ok: false, errors: [{ itemId: '', reason: 'write', code: e && e.code }] }] };
    }
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

// ───────── 공유 누적 칸(2026-11-27, 휴대폰 입·출고 js/supplies-io.js) ─────────
// suppliesIoCart/{dir}-{itemId} — 모양·계산은 js/lib/supplies-io.js(slotOf·pressSlot), 검사는 firestore.rules suppliesIoCart 블록.
// 칸 문서는 지우지 않는다 — 빈 칸 = qty 0 (+ sent 전송 묶음 id 또는 cleared). 누가 비웠는지 다른 화면이 안다.
export const CART_COLL = 'suppliesIoCart';
const cartRef = (db, dir, itemId) => doc(db, ...BASE, CART_COLL, `${dir}-${itemId}`);
const who = (me) => ({ byEmail: String(me.email || '').toLowerCase(), by: String(me.name || '').slice(0, 40), at: serverTimestamp() });
const slotData = (s) => (s.exists() ? s.data() : null);

/** 칸 전체 구독 — onData(docs: {id, data}[], snap), onErr(e). 돌려주는 함수로 끊는다 */
export function watchCart(db, onData, onErr) {
    // includeMetadataChanges — 캐시로 먼저 받은 뒤 서버와 맞춰졌다는 것(fromCache false)도 알려 받으려고
    return onSnapshot(collection(db, ...BASE, CART_COLL), { includeMetadataChanges: true }, (qs) => onData(qs.docs.map(d => ({ id: d.id, data: d.data() })), qs), onErr);
}

/**
 * 단위 단추 한 번 — 트랜잭션으로 칸을 다시 읽고 compute(칸 data 또는 null, 지금 재고) → { counts, qty, why } 를 쓴다.
 * 동시에 눌러도 트랜잭션이 다시 돌아 잃지 않는다. 출고는 재고 문서도 같이 읽는다(재고 검사는 compute 가).
 * @returns {Promise<{ ok:boolean, why?:string, qty?:number }>}
 */
export async function cartPress(db, dir, itemId, me, compute) {
    return runTransaction(db, async (tx) => {
        const s = await tx.get(cartRef(db, dir, itemId));
        let now = 0;
        if (dir === 'out') { const st = await tx.get(stockRef(db, itemId)); now = st.exists() ? (Number(st.data().qty) || 0) : 0; }
        const d = slotData(s);
        const r = compute(d, now);
        if (r.why) return { ok: false, why: r.why };
        tx.set(cartRef(db, dir, itemId), { dir, itemId, counts: r.counts, qty: r.qty, rev: (d ? Number(d.rev) || 0 : 0) + 1, ...who(me) });
        return { ok: true, qty: r.qty };
    });
}

/**
 * [이 칸 비우기] — 빈 칸(qty 0, cleared)으로. 이미 비었으면 { ok:true, already:true }.
 * seenRev = 화면이 본 rev — 그사이 누가 더 눌렀으면(rev 다름) 쓰지 않고 { ok:false, reason:'moved', qty, rev } (다시 확인받는다).
 * 스위치가 꺼져 있어도 된다(규칙도 비우기만 허용) — 다시 켰을 때 옛 칸이 전송되지 않게.
 */
export async function cartClear(db, dir, itemId, me, seenRev) {
    return runTransaction(db, async (tx) => {
        const s = await tx.get(cartRef(db, dir, itemId));
        const d = slotData(s);
        if (!d || !(Number(d.qty) > 0)) return { ok: true, already: true };
        if (seenRev != null && (Number(d.rev) || 0) !== seenRev) return { ok: false, reason: 'moved', qty: Number(d.qty) || 0, rev: Number(d.rev) || 0 };
        tx.set(cartRef(db, dir, itemId), { dir, itemId, counts: {}, qty: 0, rev: (Number(d.rev) || 0) + 1, cleared: true, ...who(me) });
        return { ok: true };
    });
}

/**
 * [전송] — 고른 비품 칸 하나만. 한 트랜잭션에서 칸을 다시 읽고 → 원장 기록·재고 → 칸 비움(qty 0, sent = 묶음 id).
 * 다른 사람이 먼저 보냈으면 칸이 비어 { ok:false, reason:'empty' } — 두 번 들어가지 않는다. 기록 id = `${batchId}-0-${itemId}`(commitLines 와 같은 모양).
 * seenRev = 화면이 본 rev — 그사이 누가 더 눌렀으면 쓰지 않고 { ok:false, reason:'moved', qty, rev }(전송 단추에 보인 수량 = 원장 수량이 되게).
 * 연결이 끊겨 결과를 모르면 예외 — 부른 쪽이 ledgerEntryOnServer(cartEntryId(batchId, itemId)) 로 원장 기록이 있는지 본다
 * (칸의 sent 는 그 뒤 누름이 칸을 다시 쓰면 사라지므로 판정에 쓰지 않는다).
 * @returns {Promise<{ ok:boolean, reason?:string, errors?:object[], qty?:number, rev?:number, entry?:object }>}
 */
export const cartEntryId = (batchId, itemId) => `${batchId}-0-${itemId}`;
export async function cartSend(db, dir, itemId, me, batchId, seenRev) {
    const bid = `${batchId}-0`;
    return runTransaction(db, async (tx) => {
        const s = await tx.get(cartRef(db, dir, itemId));
        const d = slotData(s);
        const qty = d && Number.isInteger(d.qty) ? d.qty : 0;
        if (qty <= 0) return { ok: false, reason: 'empty', byEmail: d ? String(d.byEmail || '') : '', sent: d ? String(d.sent || '') : '' };
        if (seenRev != null && (Number(d.rev) || 0) !== seenRev) return { ok: false, reason: 'moved', qty, rev: Number(d.rev) || 0 };
        const st = await tx.get(stockRef(db, itemId));
        const now = st.exists() ? (Number(st.data().qty) || 0) : 0;
        const plan = planBatch([{ itemId, qty }], dir, { [itemId]: now }, bid);
        if (!plan.ok) return { ok: false, reason: 'plan', errors: plan.errors };
        const e = plan.entries[0];
        writeEntry(tx, db, e, me, { batchId: bid });
        writeStock(tx, db, e, st.exists() ? (Number(st.data().rev) || 0) : 0);
        tx.set(cartRef(db, dir, itemId), { dir, itemId, counts: {}, qty: 0, rev: (Number(d.rev) || 0) + 1, sent: bid, ...who(me) });
        return { ok: true, qty, entry: e };
    });
}

/** 원장 기록 하나를 서버에서(캐시 아님) — 연결 오류 뒤 '전송됐나' 확인용. 없으면 null, 못 읽으면 예외 */
export async function ledgerEntryOnServer(db, id) {
    const s = await getDocFromServer(ledgerRef(db, id));
    return s.exists() ? s.data() : null;
}
