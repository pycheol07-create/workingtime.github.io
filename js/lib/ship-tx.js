// === js/lib/ship-tx.js ===
// 플랫폼 출고 전송의 트랜잭션 연결 — Firestore 함수를 넘겨받아(fs) 계획(ship-push.js)대로 읽고 쓴다.
//   화면은 js/ship-store.js 가 진짜 SDK(firebasejs 10.12.2)를 넘긴다. node 시험은 가짜 fs 를 넘긴다(tests/ship-tx.test.js).
//   fs = { doc, getDocs, collection, runTransaction, Timestamp, FieldPath, deleteField }
// 전송이 꺼져 있으면(enabled !== true) 아무것도 읽거나 쓰지 않고 멈춘다(부르는 쪽 js/ship.js 도 안 부른다 — 두 겹).
// 행 내용은 로그에 남기지 않는다 — 건수만 돌려준다.

import { chunkIdsToRead, planChunkWrite, planPackWrite } from './ship-push.js?v=202611111506';
import { PACKS_DOC_PATH } from './ship-merge.js?v=202611111506';

export const COLLECTION = 'ZikjinData';
const mustEnable = (enabled) => { if (enabled !== true) throw new Error('전송이 꺼져 있습니다.'); };

/** 로케이션 실적 합치기 → { total, thisSource, chunks, deleted } */
export async function pushLocationWith(fs, db, rows, sourceId, { enabled, now = new Date() } = {}) {
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
        const plan = planChunkWrite(snaps, rows, sourceId, now);
        for (const d of plan.docs) tx.set(fs.doc(db, COLLECTION, d.id), { dataStr: d.dataStr, updatedAt: at });
        for (const id of plan.deleteIds) tx.delete(fs.doc(db, COLLECTION, id));
        return { total: plan.total, thisSource: plan.thisSource, chunks: plan.docs.length, deleted: plan.deleteIds.length };
    });
}

/** 봉 수 기록 → { day, source, count, total, channel } */
export async function recordPacksWith(fs, db, packs, { enabled, now = new Date() } = {}) {
    mustEnable(enabled);
    const ref = fs.doc(db, ...PACKS_DOC_PATH.split('/'));
    return fs.runTransaction(db, async (tx) => {
        const s = await tx.get(ref);
        const plan = planPackWrite({ exists: s.exists(), data: s.exists() ? s.data() : null }, packs, now);
        if (plan.mode === 'set') {
            tx.set(ref, plan.setData);
        } else {
            const args = [];
            for (const [path, v] of plan.updates) args.push(new fs.FieldPath(...path), v);
            for (const path of plan.removes) args.push(new fs.FieldPath(...path), fs.deleteField());
            tx.update(ref, ...args);
        }
        return { day: plan.day, source: packs.source, count: plan.count, total: plan.total, channel: plan.channel };
    });
}
