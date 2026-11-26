// === js/ship-store.js ===
// 플랫폼 출고 웹판의 Firestore 읽기·쓰기(2026-11-10). 진짜 SDK 를 js/lib/ship-tx.js(트랜잭션 연결)에 넘긴다.
//   무엇을 쓸지는 js/lib/ship-push.js(순수)가 정한다.
//   ZikjinData/CHUNK_n  — 로케이션 실적(옛 firestore_sync.push_shipping_data). 트랜잭션: 쿼리로 CHUNK id 를 먼저 알고,
//                         트랜잭션 안에서 다시 읽어 합친 뒤 쓰고 남는 CHUNK 를 지운다(두 PC 가 동시에 보내도 한쪽이 안 지워짐).
//   integrations/zabPacks — 봉 수(옛 record_pack_count). 트랜잭션: 읽고 필드 경로만 갱신 + 90일 지난 날 지우기, 없으면 새로.
//   같은 날 여러 묶음(2026-11-12): opts.batch 를 넘기면 묶음별로 더한다(js/lib/ship-batch.js). 미리보기·묶음 빼기도 여기서.
//   persistent_data/shipPlatformSettings — 공용 설정(js/lib/ship-settings.js).
//   persistent_data/shipActivity — 여러 자리 같이 보기(누가 만드는 중·오늘 만든 묶음, js/lib/ship-activity.js, 2026-11-13).
//                         전송 켬과 상관없이 쓴다(출고 숫자가 아니라 진행 표시뿐). 규칙은 범용 쓰기(등록 직원).
//   ShipMaster/meta · ShipMaster/{판}_c{n} — 직진 원본 6칸 앱 저장본(js/lib/ship-master-app.js, 2026-11-25). 전송 켬과 상관없다.
//                         규칙 firestore.rules ShipMaster 블록(읽기 등록 직원 · 쓰기 ship.platform · 비우기 관리자). 제한 시간: meta 8초,
//                         조각 받기·올리기 8초 + 조각당 2초(masterChunkTimeout) — 넘으면 'timeout' 으로 던진다.
// 규칙: firestore.rules 의 ship.platform 블록. ⚠️ 전송(transmit)이 꺼져 있으면 부르는 쪽(js/ship.js)이 이 함수들을 부르지 않는다
//   — ship-tx 도 enabled !== true 면 멈춘다(두 겹).
import { doc, getDoc, getDocs, collection, runTransaction, setDoc, updateDoc, onSnapshot, Timestamp, FieldPath, deleteField,
    query, where, limit, deleteDoc, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { pushLocationWith, recordPacksWith, previewBatchesWith, removeBatchWith, sendBatchWith } from './lib/ship-tx.js?v=202611260958';
import { SETTINGS_PATH, normalizeSettings } from './lib/ship-settings.js?v=202611260958';
import { ACTIVITY_PATH, applyRunPatch, RUN_LOG_PATH } from './lib/ship-activity.js?v=202611260958';
import { MASTER_COLLECTION, META_ID, chunkId, metaAfterUpload, metaRollback, metaReset, newVersion } from './lib/ship-master-app.js?v=202611260958';

const FS = { doc, getDoc, getDocs, collection, runTransaction, Timestamp, FieldPath, deleteField };
const settingsRef = (db) => doc(db, ...SETTINGS_PATH);

/** 공용 설정 읽기 → normalizeSettings 결과(문서 없으면 기본값, exists false). 실패는 예외 */
export async function loadSettings(db) {
    const snap = await getDoc(settingsRef(db));
    return normalizeSettings(snap.exists() ? snap.data() : null);
}

/** 공용 설정 저장(merge — transmit 칸이 없으면 그대로 둔다) */
export async function saveSettings(db, fields) {
    await setDoc(settingsRef(db), fields, { merge: true });
}

/** 로케이션 실적 합치기 → { total, thisSource, chunks, deleted } (opts.batch 면 묶음별) */
export const pushLocation = (db, rows, sourceId, opts) => pushLocationWith(FS, db, rows, sourceId, opts);

/** 봉 수 기록 → { day, source, count, total, channel } (opts.batch 면 묶음별) */
export const recordPacks = (db, packs, opts) => recordPacksWith(FS, db, packs, opts);

/** 한 묶음 보내기(로케이션 → 성공하면 봉 수) → { location, locationError, packs, packsError, packsSkipped } */
export const sendBatch = (db, p, opts) => sendBatchWith(FS, db, p, opts);

/** 오늘 보낸 묶음 미리보기(읽기만) → { sameKey, overlaps, today, legacy, mixed } */
export const previewBatches = (db, p, opts) => previewBatchesWith(FS, db, p, opts);

/** 묶음 빼기(로케이션 행 + 봉 수) → { location, packs } */
export const removeBatch = (db, p, opts) => removeBatchWith(FS, db, p, opts);

// ── 여러 자리 같이 보기(persistent_data/shipActivity) ──
const activityRef = (db) => doc(db, ...ACTIVITY_PATH);

/** 실행 하나 넣기·고치기(시작·끝) — 트랜잭션(날짜가 바뀌면 비우고, 40개 넘으면 정리) */
export async function writeActivity(db, patch) {
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(activityRef(db));
        tx.set(activityRef(db), applyRunPatch(snap.exists() ? snap.data() : null, patch, new Date()));
    });
}

/** 진행 중 표시만 고치기(읽지 않고 필드 한 칸). 문서가 없거나 날짜가 바뀌어 비워졌어도 화면은 start 없는 실행을 버린다 */
export async function beatActivity(db, runId, at) {
    await updateDoc(activityRef(db), { [`runs.${runId}.beat`]: at });
}

// ── 실행별 진행 기록(shipRunLogs/{runId}, 2026-11-25) — 모든 자리가 [기록 보기]로 읽는다. 규칙은 범용 쓰기(등록 직원) ──
/** 한 실행의 기록 쓰기(덮어쓰기) */
export async function writeRunLog(db, id, data) {
    await setDoc(doc(db, ...RUN_LOG_PATH, id), data);
}
/** 한 실행의 기록 읽기 → 문서 값 또는 null */
export async function loadRunLog(db, id) {
    const snap = await getDoc(doc(db, ...RUN_LOG_PATH, id));
    return snap.exists() ? snap.data() : null;
}
/** 보관 기간이 지난 기록 지우기(한 번에 최대 n개) → 지운 수 */
export async function pruneRunLogs(db, beforeDay, n = 20) {
    const snap = await getDocs(query(collection(db, ...RUN_LOG_PATH), where('day', '<', beforeDay), limit(n)));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    return snap.size;
}

/** 구독 → 해제 함수. onData(문서 값 또는 null), onError(코드) */
export function watchActivity(db, onData, onError) {
    return onSnapshot(activityRef(db), (snap) => onData(snap.exists() ? snap.data() : null),
        (e) => { if (onError) onError((e && e.code) || 'unknown'); });
}

// ── 직진 원본 앱 저장본(ShipMaster, 2026-11-25) ──
export const MASTER_TIMEOUT_MS = 8000;
export const MASTER_PER_CHUNK_MS = 2000;
/** 조각 n개를 받거나 올릴 때 제한 시간(ms) */
export const masterChunkTimeout = (n) => MASTER_TIMEOUT_MS + MASTER_PER_CHUNK_MS * Math.max(0, Number(n) || 0);
const metaRef = (db) => doc(db, MASTER_COLLECTION, META_ID);
/** 8초 안에 안 끝나면 code 'timeout' 오류(기다리기만 멈춘다 — 이미 보낸 쓰기는 서버에서 끝날 수 있다) */
function withTimeout(p, ms = MASTER_TIMEOUT_MS) {
    let t;
    const timer = new Promise((_, no) => { t = setTimeout(() => no(Object.assign(new Error('앱 저장본 응답이 늦습니다'), { code: 'timeout' })), ms); });
    return Promise.race([p, timer]).finally(() => clearTimeout(t));
}

/** meta 문서 값(없으면 null) — 서버에서 */
export async function loadMasterMeta(db) {
    const snap = await withTimeout(getDoc(metaRef(db)));
    return snap.exists() ? snap.data() : null;
}

/** 한 판의 조각 → base64 조각 목록(순서대로). 조각이 빠졌거나 모양이 다르면 던진다 */
export async function loadMasterVersion(db, ver) {
    const n = Number(ver && ver.chunks) || 0;
    if (!(n >= 1)) throw new Error('앱 저장본 조각 수가 없습니다.');
    const snaps = await withTimeout(Promise.all(Array.from({ length: n }, (_, i) => getDoc(doc(db, MASTER_COLLECTION, chunkId(ver.id, i))))), masterChunkTimeout(n));
    return snaps.map((s, i) => {
        const d = s.exists() ? s.data() : null;
        if (!d || d.v !== ver.id || d.i !== i || typeof d.d !== 'string') throw new Error(`앱 저장본 조각 ${i + 1}/${n} 을 읽지 못했습니다.`);
        return d.d;
    });
}

/**
 * 새 판 올리기(트랜잭션) — 안에서 meta 를 다시 읽어, 그사이 누가 같은 내용(hash)이나 같거나 새 원본(srcMs)을 올렸으면 쓰지 않는다.
 *   p = { srcMs, enc(encodeMaster 결과), name, by, byEmail }
 * @returns {Promise<{ status: 'ok', id, dropped } | { status: 'same'|'stale', id }>}
 */
export async function uploadMasterVersion(db, p) {
    return withTimeout(runTransaction(db, async (tx) => {
        const snap = await tx.get(metaRef(db));
        const raw = snap.exists() ? snap.data() : null;
        const ver = newVersion({ ...p, at: new Date() });
        const vers = raw && Array.isArray(raw.vers) ? raw.vers : [];
        if (vers.some(v => v && v.hash === ver.hash)) return { status: 'same', id: ver.id };
        if (vers.some(v => v && Number(v.srcMs) >= ver.srcMs)) return { status: 'stale', id: ver.id };
        const { meta, drop } = metaAfterUpload(raw, ver);
        p.enc.chunks.forEach((d, i) => tx.set(doc(db, MASTER_COLLECTION, chunkId(ver.id, i)), { v: ver.id, i, d }));
        for (const id of drop) tx.delete(doc(db, MASTER_COLLECTION, id));
        tx.set(metaRef(db), { ...meta, updatedAt: serverTimestamp() });
        return { status: 'ok', id: ver.id, dropped: drop.length };
    }), masterChunkTimeout(p.enc.chunks.length));
}

/** 관리자 [앱 저장본 비우기] — meta 를 빈 판으로 + 남은 판 조각 모두 지움(트랜잭션) → { status: 'ok', dropped } */
export async function resetMaster(db) {
    return withTimeout(runTransaction(db, async (tx) => {
        const snap = await tx.get(metaRef(db));
        const { meta, drop } = metaReset(snap.exists() ? snap.data() : null);
        for (const id of drop) tx.delete(doc(db, MASTER_COLLECTION, id));
        tx.set(metaRef(db), { ...meta, updatedAt: serverTimestamp() });
        return { status: 'ok', dropped: drop.length };
    }), masterChunkTimeout(40));
}

/** 옛 판으로 되돌리기(트랜잭션) — who = { name, email } */
export async function rollbackMaster(db, id, who) {
    return withTimeout(runTransaction(db, async (tx) => {
        const snap = await tx.get(metaRef(db));
        if (!snap.exists()) throw new Error('앱 저장본이 없습니다.');
        const patch = metaRollback(snap.data(), id, who);
        tx.update(metaRef(db), { ...patch, rolledAt: serverTimestamp(), updatedAt: serverTimestamp() });
        return { status: 'ok', id };
    }));
}
