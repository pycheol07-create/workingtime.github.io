// === js/lib/ship-tx.js ===
// 플랫폼 출고 전송의 트랜잭션 연결 — Firestore 함수를 넘겨받아(fs) 계획(ship-push.js)대로 읽고 쓴다.
//   화면은 js/ship-store.js 가 진짜 SDK(firebasejs 10.12.2)를 넘긴다. node 시험은 가짜 fs 를 넘긴다(tests/ship-tx.test.js).
//   fs = { doc, getDoc, getDocs, collection, runTransaction, Timestamp, FieldPath, deleteField }
// 전송이 꺼져 있으면(enabled !== true) 아무것도 읽거나 쓰지 않고 멈춘다(부르는 쪽 js/ship.js 도 안 부른다 — 두 겹).
//   미리보기(previewBatchesWith)는 읽기만 — 그래도 전송 켬일 때만 부른다.
// 같은 날 여러 묶음(2026-11-12): batch = { key, mode:'add'|'replace', drop:[키] } 를 주면 묶음별로 더한다(js/lib/ship-batch.js).
// 행 내용은 로그에 남기지 않는다 — 건수만 돌려준다.

import { chunkIdsToRead, planChunkWrite, planPackWrite } from './ship-push.js?v=202611131153';
import { PACKS_DOC_PATH, rowsFromChunks } from './ship-merge.js?v=202611131153';
import { previewBatches } from './ship-batch.js?v=202611131153';
import { kstDay } from './ship-core.js?v=202611131153';

export const COLLECTION = 'ZikjinData';
const mustEnable = (enabled) => { if (enabled !== true) throw new Error('전송이 꺼져 있습니다.'); };

/** 로케이션 실적 합치기 → { total, thisSource, chunks, deleted } (+ batch 면 keys·legacy·mixed·removed·added) */
export async function pushLocationWith(fs, db, rows, sourceId, { enabled, now = new Date(), batch = null } = {}) {
    mustEnable(enabled);
    const first = await fs.getDocs(fs.collection(db, COLLECTION));
    const ids = chunkIdsToRead(first.docs.map(d => d.id));
    const at = fs.Timestamp.fromMillis(now.getTime());   // 모든 CHUNK 같은 시각(ship-transmit.summarizeTransmitChunks 가 본다)
    return fs.runTransaction(db, async (tx) => {
        const snaps = [];
        for (const id of ids) {
            const s = await tx.get(fs.doc(db, COLLECTION, id));
            snaps.push({ id, exists: s.exists(), dataStr: s.exists() ? (s.data() || {}).dataStr : undefined });
        }
        const plan = planChunkWrite(snaps, rows, sourceId, now, batch);
        if (batch && batch.key === null && !plan.removed) {   // 빼기만인데 지울 것이 없다 — 쓰지 않는다(전송 시각도 그대로)
            return { total: plan.total, thisSource: plan.thisSource, chunks: 0, deleted: 0, keys: plan.keys, legacy: plan.legacy, mixed: plan.mixed, removed: 0, added: 0 };
        }
        for (const d of plan.docs) tx.set(fs.doc(db, COLLECTION, d.id), { dataStr: d.dataStr, updatedAt: at });
        for (const id of plan.deleteIds) tx.delete(fs.doc(db, COLLECTION, id));
        const out = { total: plan.total, thisSource: plan.thisSource, chunks: plan.docs.length, deleted: plan.deleteIds.length };
        if (batch) Object.assign(out, { keys: plan.keys, legacy: plan.legacy, mixed: plan.mixed, removed: plan.removed, added: plan.added });
        return out;
    });
}

/** 봉 수 기록 → { day, source, count, total, channel } (+ batch 면 mixed·removed·written)
 *  batch = { key, mode, drop, q, k } — q·k 는 이번 묶음 총수량·품목 수 */
export async function recordPacksWith(fs, db, packs, { enabled, now = new Date(), batch = null } = {}) {
    mustEnable(enabled);
    const ref = fs.doc(db, ...PACKS_DOC_PATH.split('/'));
    return fs.runTransaction(db, async (tx) => {
        const s = await tx.get(ref);
        const plan = planPackWrite({ exists: s.exists(), data: s.exists() ? s.data() : null }, packs, now, batch);
        if (plan.mode === 'set') {
            tx.set(ref, plan.setData);
        } else if (plan.mode === 'update') {
            const args = [];
            for (const [path, v] of plan.updates) args.push(new fs.FieldPath(...path), v);
            for (const path of plan.removes) args.push(new fs.FieldPath(...path), fs.deleteField());
            tx.update(ref, ...args);
        }
        const out = { day: plan.day, source: packs.source, count: plan.count, total: plan.total, channel: plan.channel };
        if (batch) Object.assign(out, { mixed: plan.mixed, removed: plan.removed, written: plan.mode !== 'none' });
        return out;
    });
}

/**
 * 한 묶음 보내기 — 로케이션 먼저, 성공했을 때만 봉 수(더하기 포함 — 한쪽만 들어가지 않게).
 *   그래야 '봉 수에만 있는 묶음 키'는 exe 가 행을 다시 써 묶음 내역이 지워진 경우에만 생긴다(previewBatches lost 판정).
 *   예외를 던지지 않는다 — 오류는 locationError·packsError 로 돌려준다.
 * @param {{ rows, source, packs: object|null, batch: {key, mode?, drop?, subtractLegacy?}, q: number, k: number }} p
 * @returns {Promise<{ location: object|null, locationError: Error|null, packs: object|null, packsError: Error|null, packsSkipped: boolean }>}
 */
export async function sendBatchWith(fs, db, { rows, source, packs = null, batch, q = 0, k = 0 }, { enabled, now = new Date() } = {}) {
    mustEnable(enabled);
    let location = null;
    try {
        location = await pushLocationWith(fs, db, rows, source, { enabled, now, batch });
    } catch (e) {
        return { location: null, locationError: e, packs: null, packsError: null, packsSkipped: !!packs };
    }
    let p = null, packsError = null;
    if (packs) {
        try { p = await recordPacksWith(fs, db, packs, { enabled, now, batch: { ...batch, q, k } }); } catch (e) { packsError = e; }
    }
    return { location, locationError: null, packs: p, packsError, packsSkipped: false };
}

/** CHUNK 행 읽기(트랜잭션 밖 — 미리보기용) */
async function readRows(fs, db) {
    const snap = await fs.getDocs(fs.collection(db, COLLECTION));
    const strs = [];
    for (const d of snap.docs) {
        const v = typeof d.data === 'function' ? (d.data() || {}) : {};
        if (/^CHUNK_\d{1,4}$/.test(String(d.id)) && typeof v.dataStr === 'string') strs.push(v.dataStr);
    }
    return rowsFromChunks(strs);
}

/**
 * 오늘 보낸 묶음 미리보기(읽기만) → { sameKey, overlaps:[{key,at,share}], today:[{key,at,n,q,k}], legacy, mixed }
 * @param {{ rows: Array, source: string, key: string, packDay: string|null }} p  rows = 이번 location.rows, packDay = packs.day
 */
export async function previewBatchesWith(fs, db, { rows, source, key, packDay = null }, { enabled, now = new Date() } = {}) {
    mustEnable(enabled);
    const existing = await readRows(fs, db);
    let dayEntry;
    if (packDay) {
        const s = await fs.getDoc(fs.doc(db, ...PACKS_DOC_PATH.split('/')));
        const data = s.exists() ? (s.data() || {}) : {};
        dayEntry = data.days && typeof data.days === 'object' ? data.days[packDay] : undefined;
    }
    return previewBatches(existing, dayEntry, { source, key, newRows: rows, day: kstDay(now).ymd8 });
}

/**
 * 묶음 빼기 — 로케이션 행(오늘)에서 그 묶음 몫을 지우고, 봉 수(packDay)에서도 지운다. 트랜잭션 두 번(문서가 다르다).
 *   day8 = 전송한 날(YYYYMMDD). 오늘(now)과 다르면 멈춘다 — 로케이션 합치기는 오늘 행만 남기므로 지난 날 몫을 뺄 수 없다.
 *   로케이션에서 뺄 몫을 못 찾으면(exe 가 행을 다시 써 묶음 내역이 지워짐) 봉 수도 지우지 않고 멈춘다(notFound) — 한쪽만 빠지지 않게.
 * @returns {{ location: object, packs: object|null, notFound: boolean }}
 */
export async function removeBatchWith(fs, db, { source, key, packDay = null, day8 = null }, { enabled, now = new Date() } = {}) {
    mustEnable(enabled);
    if (day8 !== null && String(day8) !== kstDay(now).ymd8) {
        throw new Error(`전송한 날(${day8})이 지나 이 묶음을 뺄 수 없습니다 — 로케이션에는 오늘 행만 남습니다.`);
    }
    const location = await pushLocationWith(fs, db, [], source, { enabled, now, batch: { key: null, drop: [key] } });
    if (!location.removed) return { location, packs: null, notFound: true };
    let packs = null;
    if (packDay) packs = await recordPacksWith(fs, db, { source, day: packDay, count: 0 }, { enabled, now, batch: { key: null, drop: [key] } });
    return { location, packs, notFound: false };
}
