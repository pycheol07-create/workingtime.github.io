// === js/products-write.js ===
// 상품 관리 — 버킷 + META + 이력 트랜잭션(기본정보·원가 공용), 메모 저장, 공급처 대장. 2026-10-13. 설계: 상품DB_설계(v1) 3장, v2 3-4·3-5
//
// 버킷 쓰기 방식(④): 트랜잭션 안에서 버킷 문서를 읽고 → 상품마다 '열 때 본 ver' 와 지금 ver 를 비교 →
//   같은 것만 FieldPath('p', 품목코드) 칸을 update(다른 상품 칸은 건드리지 않는다), 다른 것은 '충돌' 로 빼서 돌려준다.
//   기본정보는 같은 트랜잭션에서 ProductCatalog/META 의 chunks.Bxx.rev 를 +1 → 다른 화면은 그 버킷만 다시 받는다.
//   이력(…Log)은 같은 트랜잭션에서 추가만(변경 1,000건·품목 1,000개 단위로 쪼갬). by = 소문자 이메일, at = 서버시각(규칙 검사).
// 숫자 품목코드(594198)는 문자열 경로 'p.594198' 로 쓰지 않는다 — 반드시 FieldPath.
// ⚠️ 원가 값을 console 에 찍지 말 것.
import {
    doc, collection, runTransaction, FieldPath, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { catalogJson, parseCatalogJson, costJson, parseCostJson } from './lib/product-excel-rows.js?v=202610191226';

const LOG_MAX = 1000;

const clean = (v) => (v === undefined ? null : v);
/** 변경 목록 → 이력 문서 여러 개(각각 changes ≤1000, pids ≤1000) */
export function splitLog(changes, pidsAll) {
    const docs = [];
    if (!changes.length) {
        for (let i = 0; i < pidsAll.length; i += LOG_MAX) docs.push({ pids: pidsAll.slice(i, i + LOG_MAX), changes: [] });
        return docs.length ? docs : [{ pids: [], changes: [] }];
    }
    for (let i = 0; i < changes.length; i += LOG_MAX) {
        const part = changes.slice(i, i + LOG_MAX).map(c => ({ pid: c.pid, opt: clean(c.opt), field: c.field, before: clean(c.before), after: clean(c.after) }));
        docs.push({ pids: [...new Set(part.map(c => c.pid))], changes: part });
    }
    return docs;
}

const KINDS = {
    catalog: { coll: 'ProductCatalog', log: 'ProductCatalogLog', meta: true, ser: catalogJson, parse: parseCatalogJson },
    cost: { coll: 'adminProductCost', log: 'adminProductCostLog', meta: false, ser: costJson, parse: parseCostJson },
};

/**
 * 버킷 하나 쓰기.
 *  kind  : 'catalog' | 'cost'
 *  items : [{ pid, expectVer, next, changes }]   next = ver·at·by 를 뺀 새 값
 *  opts  : { email, logKind: 'excel'|'excel-init'|'ui', batchId, counts, src }
 * → { ok: [{pid, obj}], conflict: [{pid, cur}] }   (cur = 지금 서버 값, 없으면 null)
 */
export async function writeBucket(db, kind, bid, items, { email, logKind, batchId = '', counts = null, src = 'excel' }) {
    const K = KINDS[kind];
    const bref = doc(db, K.coll, bid);
    const mref = K.meta ? doc(db, K.coll, 'META') : null;
    let result;
    await runTransaction(db, async (tx) => {
        const bs = await tx.get(bref);
        const ms = mref ? await tx.get(mref) : null;
        const ok = [], conflict = [], fields = [], changes = [];
        const now = Date.now();
        for (const it of items) {
            const curStr = bs.exists() ? bs.get(new FieldPath('p', it.pid)) : undefined;
            const cur = curStr ? K.parse(curStr) : null;
            if (((cur && cur.ver) | 0) !== (it.expectVer | 0)) { conflict.push({ pid: it.pid, cur }); continue; }
            const obj = { ...it.next, ver: (it.expectVer | 0) + 1, at: now, by: email };
            if (kind === 'catalog') { obj.src = src; obj.add = (cur && cur.add) || it.next.add || now; }
            delete obj.bid;
            fields.push([it.pid, K.ser(obj)]);
            ok.push({ pid: it.pid, obj });
            for (const c of it.changes || []) changes.push(c);
        }
        result = { ok, conflict };
        if (!ok.length) return;
        if (bs.exists()) {
            const args = [];
            for (const [pid, json] of fields) args.push(new FieldPath('p', pid), json);
            args.push(kind === 'catalog' ? 'at' : 'updatedAt', serverTimestamp());
            tx.update(bref, ...args);
        } else {
            const base = { p: Object.fromEntries(fields) };
            if (kind === 'catalog') Object.assign(base, { schema: 2, at: serverTimestamp() });
            else base.updatedAt = serverTimestamp();
            tx.set(bref, base);
        }
        if (mref) {
            const rev = (ms.exists() ? (Number(ms.get(new FieldPath('chunks', bid, 'rev'))) || 0) : 0) + 1;
            if (ms.exists()) tx.update(mref, new FieldPath('chunks', bid, 'rev'), rev, new FieldPath('chunks', bid, 'at'), serverTimestamp());
            else tx.set(mref, { schema: 2, n: 16, chunks: { [bid]: { rev, at: serverTimestamp() } } });
        }
        const lk = (kind === 'catalog' && !bs.exists() && logKind === 'excel') ? 'excel-init' : logKind;
        const logs = lk === 'excel-init' ? splitLog([], ok.map(x => x.pid)) : splitLog(changes, ok.map(x => x.pid));
        for (const l of logs) {
            tx.set(doc(collection(db, K.log)), { at: serverTimestamp(), by: email, kind: lk, batchId, pids: l.pids, changes: l.changes, counts: counts || null });
        }
    });
    return result;
}

/** 기본정보 업로드가 끝나면 META 에 요약(전체 수·마지막 업로드) — 버킷 rev 와 따로(쓰기 1) */
export async function writeCatalogSummary(db, { email, batchId, counts, total }) {
    await updateDoc(doc(db, 'ProductCatalog', 'META'), {
        lastUpload: { at: serverTimestamp(), by: email, batchId, counts }, total
    });
}

// ── 메모 ─────────────────────────────────────────────────
export class NoteConflict extends Error {
    constructor(cur) { super('다른 사람이 먼저 고쳤습니다'); this.cur = cur; }
}
/** 메모 저장 — 열 때 본 at(ms) 과 지금 at 이 다르면 NoteConflict. 직전 값 5개 보관(h, 규칙이 위조·삭제 검사) */
export async function saveNote(db, pid, { inspect, pack }, loadedAt, email, { force = false } = {}) {
    const ref = doc(db, 'ProductNotes', pid);
    let saved;
    await runTransaction(db, async (tx) => {
        const s = await tx.get(ref);
        const cur = s.exists() ? s.data() : null;
        const curAt = cur && cur.at && cur.at.toMillis ? cur.at.toMillis() : 0;
        if (!force && curAt !== (loadedAt || 0)) {
            throw new NoteConflict(cur ? { inspect: cur.inspect || '', pack: cur.pack || '', at: curAt, by: cur.by || '' } : null);
        }
        // 직전 기록 h — 규칙(firestore.rules ProductNotes)이 모양을 정확히 검사한다:
        //   새 문서 = [] / 기존 문서 = [지금 값(inspect·pack·at(Timestamp 그대로)·by)] + 기존 h, 앞 5개
        const h = cur
            ? [{ inspect: cur.inspect ?? '', pack: cur.pack ?? '', at: cur.at ?? null, by: cur.by ?? '' }, ...(Array.isArray(cur.h) ? cur.h : [])].slice(0, 5)
            : [];
        tx.set(ref, { inspect, pack, at: serverTimestamp(), by: email, h });
        saved = { inspect, pack, by: email, h };
    });
    return saved;
}

// ── 공급처 대장 (관리자) ───────────────────────────────────
/** 새 공급처 — nextNo 를 트랜잭션으로 올려 SUP-001 형식. → 새 코드 */
export async function addSupplier(db, entry, email) {
    const ref = doc(db, 'adminSuppliers', 'LEDGER');
    let code;
    await runTransaction(db, async (tx) => {
        const s = await tx.get(ref);
        let no = s.exists() ? (Number(s.get('nextNo')) || 1) : 1;
        const have = (s.exists() && s.get('s')) || {};
        // 그 번호가 이미 대장에 있으면(이지어드민 자동 등록 값이 'SUP-003' 꼴인 경우 등) 덮어쓰지 않고 건너뛴다
        while (Object.prototype.hasOwnProperty.call(have, 'SUP-' + String(no).padStart(3, '0'))) no++;
        code = 'SUP-' + String(no).padStart(3, '0');
        const val = { ...entry, active: true, at: Date.now(), by: email };
        if (s.exists()) tx.update(ref, new FieldPath('s', code), val, 'nextNo', no + 1);
        else tx.set(ref, { nextNo: no + 1, s: { [code]: val } });
    });
    return code;
}
/**
 * 이지어드민 원가 업로드 — 대장에 없는 공급처코드를 이름 빈칸으로 한 번에 등록(트랜잭션 1회). nextNo 는 건드리지 않는다.
 * 코드는 이지어드민 공급처 값 그대로(한글·공백·하이픈) → 쓰기는 반드시 FieldPath('s', 코드). → 새로 등록한 코드 배열
 */
export async function ensureSuppliers(db, codes, email) {
    const ref = doc(db, 'adminSuppliers', 'LEDGER');
    let added = [];
    await runTransaction(db, async (tx) => {
        const s = await tx.get(ref);
        const have = (s.exists() && s.get('s')) || {};
        added = [...new Set(codes)].filter(c => c && !Object.prototype.hasOwnProperty.call(have, c));
        if (!added.length) return;
        const at = Date.now();
        const val = () => ({ name: '', contact: '', phone: '', memo: '', active: true, auto: 1, at, by: email });
        if (s.exists()) {
            const args = [];
            for (const c of added) args.push(new FieldPath('s', c), val());
            tx.update(ref, ...args);
        } else {
            tx.set(ref, { nextNo: 1, s: Object.fromEntries(added.map(c => [c, val()])) });
        }
    });
    return added;
}
export async function updateSupplier(db, code, entry, email) {
    await updateDoc(doc(db, 'adminSuppliers', 'LEDGER'), new FieldPath('s', code), { ...entry, at: Date.now(), by: email });
}
