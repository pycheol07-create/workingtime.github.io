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
// 규칙: firestore.rules 의 ship.platform 블록. ⚠️ 전송(transmit)이 꺼져 있으면 부르는 쪽(js/ship.js)이 이 함수들을 부르지 않는다
//   — ship-tx 도 enabled !== true 면 멈춘다(두 겹).
import { doc, getDoc, getDocs, collection, runTransaction, setDoc, updateDoc, onSnapshot, Timestamp, FieldPath, deleteField }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { pushLocationWith, recordPacksWith, previewBatchesWith, removeBatchWith, sendBatchWith } from './lib/ship-tx.js?v=202611131354';
import { SETTINGS_PATH, normalizeSettings } from './lib/ship-settings.js?v=202611131354';
import { ACTIVITY_PATH, applyRunPatch } from './lib/ship-activity.js?v=202611131354';

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

/** 구독 → 해제 함수. onData(문서 값 또는 null), onError(코드) */
export function watchActivity(db, onData, onError) {
    return onSnapshot(activityRef(db), (snap) => onData(snap.exists() ? snap.data() : null),
        (e) => { if (onError) onError((e && e.code) || 'unknown'); });
}
