// === js/lib/supplies-ledger.js — 비품 입출고 원장 계산(순수, node 시험 tests/supplies-ledger.test.js) ===
// 비품관리 앱 기준 전환 1단계(2026-11-26, 설계: 메모리 supplies-app-main-plan).
//
// 저장 구조(js/supplies-ledger-store.js 가 한 트랜잭션으로 쓴다, firestore.rules 가 검사):
//   artifacts/team-work-logger-v2/suppliesLedger/{기록id}  — 한 건 한 문서, 만들기만(고치기·지우기 없음)
//       { itemId, kind, qty, before, after, byEmail, by, at(서버 시각), batchId?, ref? }
//       kind: 'in'(입고, qty>0) · 'out'(출고, qty<0) · 'count'(실사 — 센 수량으로 맞춤) · 'revert'(되돌림 — 원 기록의 반대)
//       qty = 재고 변화량(부호 있음, 기본 단위 정수), after = before + qty ≥ 0
//   artifacts/team-work-logger-v2/suppliesStock/{itemId}   — 비품 하나 재고
//       { qty, rev, lastEntry, updatedAt }  — 기록을 만들 때 같이 바뀐다(lastEntry = 그 기록 id)
//
// 기록 id 는 화면이 정한다(같은 묶음을 두 번 보내도 한 번만 들어가게):
//   묶음 저장 = `${batchId}-${덩어리번호}-${itemId}` · 실사 = `ct-${batchId}-${itemId}` · 되돌림 = `rv-${원 기록 id}`(한 기록은 한 번만 되돌림)
//   ⚠️ 같은 batchId 를 다시 쓰는 것은 '같은 줄 그대로' 다시 보낼 때만. 줄을 고쳤으면 새 batchId(js/supplies-ledger-store.js 가 일부만 있으면 멈춤).
//   'rv-'·'ct-' 로 시작하는 id 는 되돌림·실사만 쓴다(규칙도 막음).
// 한 트랜잭션에 담는 비품 수는 MAX_TX_ITEMS 까지 — 보안 규칙 문서 확인 횟수(운영 트랜잭션당 20): 비품당 4 + 설정 1 → 3개면 13(넉넉히).
//   에뮬레이터는 이 한도를 운영처럼 막지 않으므로 게시 뒤 운영에서 한 번 확인할 것. 넘으면 나눠 보낸다(splitLines).

export const KINDS = ['in', 'out', 'count', 'revert'];
export const MAX_TX_ITEMS = 3;
export const MAX_QTY = 1000000;

const isInt = (v) => Number.isInteger(v);
/** 비품·기록 id 모양(규칙 supEntryShapeOk 의 itemId 와 같은 식) — 화면 전환 창도 이걸 쓴다(js/supplies.js) */
export const ITEM_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const idSafe = (s) => ITEM_ID_RE.test(String(s || ''));

/**
 * 입고·출고 묶음 → 저장할 기록·재고. lines = [{ itemId, qty>0 }], dir = 'in'|'out', stockNow = { itemId: 지금 재고(없으면 0) }
 * 같은 비품 줄은 합친다. 출고로 재고가 0 밑이면 그 비품을 errors 에 넣고 ok=false(아무것도 쓰지 않는다).
 * @returns {{ ok:boolean, errors:{itemId,reason,need?,have?}[], entries:{id,itemId,kind,qty,before,after}[], stock:Object<string,number> }}
 */
export function planBatch(lines, dir, stockNow, batchId) {
    const errors = [];
    if (!['in', 'out'].includes(dir)) return { ok: false, errors: [{ itemId: '', reason: 'dir' }], entries: [], stock: {} };
    if (!idSafe(batchId)) return { ok: false, errors: [{ itemId: '', reason: 'batchId' }], entries: [], stock: {} };
    const sum = new Map();
    for (const l of Array.isArray(lines) ? lines : []) {
        const id = String(l && l.itemId || '');
        const q = Number(l && l.qty);
        if (!idSafe(id)) { errors.push({ itemId: id, reason: 'itemId' }); continue; }
        if (!isInt(q) || q <= 0 || q > MAX_QTY) { errors.push({ itemId: id, reason: 'qty' }); continue; }
        sum.set(id, (sum.get(id) || 0) + q);
    }
    const entries = [], stock = {};
    for (const [itemId, q] of sum) {
        const before = Number((stockNow || {})[itemId]) || 0;
        const qty = dir === 'in' ? q : -q;
        const after = before + qty;
        if (after < 0) { errors.push({ itemId, reason: 'short', need: q, have: before }); continue; }
        entries.push({ id: `${batchId}-${itemId}`, itemId, kind: dir, qty, before, after });
        stock[itemId] = after;
    }
    if (!sum.size && !errors.length) errors.push({ itemId: '', reason: 'empty' });
    return errors.length ? { ok: false, errors, entries: [], stock: {} } : { ok: true, errors, entries, stock };
}

/** 실사 — 센 수량으로 맞춘다. 같으면 null(기록 없음) */
export function planCount(itemId, counted, stockNow, batchId) {
    // 빈칸·공백·null 은 0 이 아니라 '입력 없음'(Number('') === 0 이라 그대로 두면 재고가 0 으로 맞춰진다)
    if (!(typeof counted === 'number' || /^\s*\d+\s*$/.test(String(counted == null ? '' : counted)))) return { ok: false, reason: 'input' };
    const c = Number(counted);
    if (!idSafe(itemId) || !idSafe(batchId) || !isInt(c) || c < 0 || c > MAX_QTY) return { ok: false, reason: 'input' };
    const before = Number(stockNow) || 0;
    if (c === before) return { ok: true, entry: null };
    return { ok: true, entry: { id: `ct-${batchId}-${itemId}`, itemId, kind: 'count', qty: c - before, before, after: c } };
}

/** 되돌림 — 원 기록의 반대. 되돌리면 0 밑이 되면 거절. 되돌림을 다시 되돌리지는 않는다 */
export function planRevert(orig, stockNow) {
    if (!orig || !idSafe(orig.id) || !idSafe(orig.itemId) || !isInt(orig.qty) || orig.qty === 0) return { ok: false, reason: 'input' };
    if (orig.kind === 'revert') return { ok: false, reason: 'revert-of-revert' };
    const before = Number(stockNow) || 0;
    const qty = -orig.qty, after = before + qty;
    if (after < 0) return { ok: false, reason: 'short', need: -qty, have: before };
    return { ok: true, entry: { id: `rv-${orig.id}`, itemId: orig.itemId, kind: 'revert', qty, before, after, ref: orig.id } };
}

/** 묶음을 MAX_TX_ITEMS 비품씩 나눈다(같은 비품은 한 묶음 안에) */
export function splitLines(lines, size = MAX_TX_ITEMS) {
    const order = [], by = new Map();
    for (const l of Array.isArray(lines) ? lines : []) {
        const id = String(l && l.itemId || '');
        if (!by.has(id)) { by.set(id, []); order.push(id); }
        by.get(id).push(l);
    }
    const out = [];
    for (let i = 0; i < order.length; i += size) out.push(order.slice(i, i + size).flatMap(id => by.get(id)));
    return out;
}

/** 저장 실패 이유 → 화면 글 */
export function ledgerErrorText(e, nameOf = (id) => id) {
    switch (e && e.reason) {
        case 'short': return `${nameOf(e.itemId)}: 재고가 모자랍니다(필요 ${e.need} · 지금 ${e.have})`;
        case 'qty': return `${nameOf(e.itemId)}: 수량이 올바르지 않습니다`;
        case 'itemId': return '비품을 알아보지 못했습니다';
        case 'empty': return '저장할 것이 없습니다';
        case 'revert-of-revert': return '되돌린 기록은 다시 되돌리지 않습니다';
        case 'changed': return '이 묶음은 일부만 저장돼 있습니다 — 저장된 것을 확인한 뒤 남은 것만 새로 보내세요';
        case 'input': return '수량을 숫자로 넣으세요';
        default: return '저장하지 못했습니다';
    }
}
