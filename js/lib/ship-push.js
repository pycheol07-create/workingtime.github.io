// === js/lib/ship-push.js ===
// 플랫폼 출고 웹판 전송 — 트랜잭션 안에서 '무엇을 쓰고 지울지'만 정한다(쓰기는 js/ship-store.js).
//   ZikjinData: 트랜잭션 안에서 읽은 CHUNK 들 + 이번 소스 행 → ship-merge.mergeRows → CHUNK 문서 · 지울 CHUNK
//   zabPacks:   트랜잭션 안에서 읽은 문서 → ship-merge.buildPackPatch → 필드 경로 갱신(있으면) / 새 문서(없으면)
// batch 인자를 주면(웹판, 2026-11-12) 같은 날 여러 묶음을 더한다 — ship-batch.mergeRowsBatched · packBatchPatch.
//   batch 없이 부르면 Python 판(firestore_sync.py)과 같은 값(exe 호환판 — 비교 시험용).
// 다른 점: 트랜잭션이라 두 PC 가 동시에 보내도 한쪽이 지워지지 않는다.
// 순수 모듈. 테스트: tests/ship-push.test.js

import { mergeRows, chunkDocs, rowsFromChunks, buildPackPatch, packPatchForSdk, packDaysFromData, PACK_CHANNEL_BY_SOURCE } from './ship-merge.js?v=202611121547';
import { mergeRowsBatched, packBatchPatch } from './ship-batch.js?v=202611121547';
import { kstDay } from './ship-core.js?v=202611121547';

export const CHUNK_RE = /^CHUNK_(\d{1,4})$/;
export const TX_WRITE_MAX = 500;   // Firestore 트랜잭션 한 번의 쓰기 한도
// 봉 수 문서에서 한 번에 지울 90일 지난 날짜 수 — 규칙(firestore.rules zabPacks)이 10개까지만 받는다.
//   더 많으면 오래된 것부터 10개만 지우고 나머지는 다음 기록 때(Python 판은 한 번에 다 지운다 — 남은 날은 예측에 안 쓰여 무해)
export const PACK_REMOVE_MAX = 10;
export const READ_MARGIN = 3;     // 아는 CHUNK 뒤로 더 읽어 둘 개수 — 그 사이 다른 PC 가 새 CHUNK 를 만들면 트랜잭션이 다시 돈다

/**
 * 트랜잭션 안에서 읽을 CHUNK id — 먼저 쿼리로 안 id + CHUNK_0 부터 (가장 큰 번호 + READ_MARGIN) 까지.
 * (Firestore 트랜잭션은 쿼리를 못 읽는다 → 문서로 읽어 둬야 다른 PC 의 쓰기와 충돌을 잡는다)
 */
export function chunkIdsToRead(knownIds, margin = READ_MARGIN) {
    let max = -1;
    for (const id of knownIds || []) {
        const m = CHUNK_RE.exec(String(id));
        if (m) max = Math.max(max, Number(m[1]));
    }
    const out = [];
    for (let i = 0; i <= max + margin; i++) out.push(`CHUNK_${i}`);
    return out;
}

/**
 * ZikjinData 쓰기 계획.
 * @param {Array<{id: string, exists: boolean, dataStr?: string}>} snaps  트랜잭션 안에서 읽은 문서(chunkIdsToRead 순서)
 * @param {Array<[string, string, number]>} newRows  [상품코드, 상품명, 수량] — ship-zikjin/ably 의 location.rows
 * @param {string} sourceId  ZG·ZGF·AB·ABF
 * @param {Date} now
 * @returns {{ docs: Array<{id, dataStr}>, deleteIds: string[], total: number, thisSource: number, sessionDate: string }}
 */
export function planChunkWrite(snaps, newRows, sourceId, now = new Date(), batch = null) {
    if (!PACK_CHANNEL_BY_SOURCE[sourceId]) throw new Error(`알 수 없는 소스 ${sourceId}`);
    const live = (snaps || []).filter(s => s && s.exists && CHUNK_RE.test(String(s.id)));
    const existing = rowsFromChunks(live.map(s => (typeof s.dataStr === 'string' ? s.dataStr : '')));
    const sessionDate = kstDay(now).ymd8;   // Python 판 datetime.now() — 이 PC(한국시간) 오늘
    // batch 가 있으면 묶음별 합(js/lib/ship-batch.js — 웹판), 없으면 exe 호환판(덮어씀)
    const b = batch ? mergeRowsBatched(existing, newRows, sourceId, sessionDate, batch) : null;
    const merged = b ? b.rows : mergeRows(existing, newRows, sourceId, sessionDate);
    const docs = chunkDocs(merged);
    const keep = new Set(docs.map(d => d.id));
    const deleteIds = live.map(s => s.id).filter(id => !keep.has(id));
    if (docs.length + deleteIds.length > TX_WRITE_MAX) {
        throw new Error(`한 번에 쓸 문서가 너무 많습니다(${docs.length + deleteIds.length}개 > ${TX_WRITE_MAX}).`);
    }
    const thisSource = merged.filter(r => r._q && Object.prototype.hasOwnProperty.call(r._q, sourceId)).length;
    const out = { docs, deleteIds, total: merged.length, thisSource, sessionDate };
    if (b) Object.assign(out, { keys: b.keys, legacy: b.legacy, mixed: b.mixed, removed: b.removed, added: b.added });
    return out;
}

/**
 * zabPacks 쓰기 계획.
 * @param {{ exists: boolean, data?: object }} snap  트랜잭션 안에서 읽은 문서
 * @param {{ source: string, day: string, count: number }} packs  ship-zikjin/ably 의 packs
 * @returns {{ mode: 'update'|'set', updates: Array<[string[], any]>, removes: string[][], setData: object|null, total, count, day, channel }}
 *   update: 필드 경로(조각 배열)마다 값 · removes 는 deleteField 로 지울 경로(90일 지난 날)
 *   set:    문서가 없을 때 통째로(최상위 칸은 days 하나)
 */
export function planPackWrite(snap, packs, now = new Date(), batch = null) {
    const { source, day, count } = packs || {};
    if (!PACK_CHANNEL_BY_SOURCE[source]) throw new Error(`알 수 없는 소스 ${source}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error(`날짜 모양이 틀렸습니다(${day}).`);
    const existing = snap && snap.exists ? packDaysFromData(snap.data || {}) : {};
    if (batch) return planPackBatchWrite(snap, existing, packs, now, batch);
    const p = buildPackPatch(existing, day, source, count, now);
    const sdk = packPatchForSdk(p, source, day);
    const base = { total: p.total, count: p.count, day, channel: p.channel, updatedAt: p.updatedAt };
    if (snap && snap.exists) return { ...base, mode: 'update', updates: sdk.set, removes: sdk.remove.slice(0, PACK_REMOVE_MAX), setData: null };
    return {
        ...base, mode: 'set', updates: [], removes: [],
        setData: { days: { [day]: { [p.channel]: p.total, src: { [source]: p.count }, updatedAt: p.updatedAt } } },
    };
}

/** 묶음별 봉 수(웹판) — 그 날 그 소스의 bat 를 통째로 바꾸고 src = Σ bat.n, 채널 합·90일 정리는 exe 호환판 그대로.
 *  batch = { key: string|null, mode?: 'add'|'replace', drop?: string[], q, k } (key null = 빼기만)
 *  빼기만인데 지울 것이 없으면 mode 'none'(쓰지 않음) */
function planPackBatchWrite(snap, existing, packs, now, batch) {
    const { source, day, count } = packs;
    const data = snap && snap.exists ? (snap.data || {}) : {};
    const days = data && typeof data.days === 'object' && data.days ? data.days : {};
    const key = batch.key === undefined ? null : batch.key;
    const pb = packBatchPatch(days[day], day, source, key, { n: count, q: batch.q, k: batch.k }, now,
        { mode: batch.mode || 'add', drop: batch.drop || [] });
    const p = buildPackPatch(existing, day, source, pb.count, now);
    const sdk = packPatchForSdk(p, source, day);
    const base = { total: p.total, count: p.count, day, channel: p.channel, updatedAt: p.updatedAt, mixed: pb.mixed, removed: pb.removed, batches: pb.bat };
    if (key === null && !pb.removed) return { ...base, mode: 'none', updates: [], removes: [], setData: null };
    if (snap && snap.exists) {
        return { ...base, mode: 'update', updates: [...sdk.set, [['days', day, 'bat', source], pb.bat]], removes: sdk.remove.slice(0, PACK_REMOVE_MAX), setData: null };
    }
    return {
        ...base, mode: 'set', updates: [], removes: [],
        setData: { days: { [day]: { [p.channel]: p.total, src: { [source]: p.count }, bat: { [source]: pb.bat }, updatedAt: p.updatedAt } } },
    };
}
