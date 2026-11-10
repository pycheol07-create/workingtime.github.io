// === js/ship-store.js ===
// 플랫폼 출고 웹판의 Firestore 읽기·쓰기(2026-11-10). 진짜 SDK 를 js/lib/ship-tx.js(트랜잭션 연결)에 넘긴다.
//   무엇을 쓸지는 js/lib/ship-push.js(순수)가 정한다.
//   ZikjinData/CHUNK_n  — 로케이션 실적(옛 firestore_sync.push_shipping_data). 트랜잭션: 쿼리로 CHUNK id 를 먼저 알고,
//                         트랜잭션 안에서 다시 읽어 합친 뒤 쓰고 남는 CHUNK 를 지운다(두 PC 가 동시에 보내도 한쪽이 안 지워짐).
//   integrations/zabPacks — 봉 수(옛 record_pack_count). 트랜잭션: 읽고 필드 경로만 갱신 + 90일 지난 날 지우기, 없으면 새로.
//   persistent_data/shipPlatformSettings — 공용 설정(js/lib/ship-settings.js).
// 규칙: firestore.rules 의 ship.platform 블록. ⚠️ 전송(transmit)이 꺼져 있으면 부르는 쪽(js/ship.js)이 이 함수들을 부르지 않는다
//   — ship-tx 도 enabled !== true 면 멈춘다(두 겹).
import { doc, getDoc, getDocs, collection, runTransaction, setDoc, Timestamp, FieldPath, deleteField }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { pushLocationWith, recordPacksWith } from './lib/ship-tx.js?v=202611102106';
import { SETTINGS_PATH, normalizeSettings } from './lib/ship-settings.js?v=202611102106';

const FS = { doc, getDocs, collection, runTransaction, Timestamp, FieldPath, deleteField };
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

/** 로케이션 실적 합치기 → { total, thisSource, chunks, deleted } */
export const pushLocation = (db, rows, sourceId, opts) => pushLocationWith(FS, db, rows, sourceId, opts);

/** 봉 수 기록 → { day, source, count, total, channel } */
export const recordPacks = (db, packs, opts) => recordPacksWith(FS, db, packs, opts);
