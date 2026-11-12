// === js/lib/ship-file-store.js ===
// 플랫폼 출고 — 이 PC(브라우저)에만 남기는 작은 저장소(IndexedDB).
//   결과 저장 폴더 핸들(js/lib/save-file.js)을 둔다(폴더를 한 번만 고르게).
//   KEY_TEMPLATE: 옛 '직진배송출고리스트 원본 PC 기억'(2026-11-10~11-12) 자리 — 원본을 없앤 뒤(2026-11-12) 새로 쓰지 않는다.
//     화면이 열릴 때 앱 양식(Storage)을 쓸 수 있으면 지우고, 아직 못 쓰면(저장소 규칙 게시 전 임시 길) 원본(임시) 칸에 넣어 준다(js/ship.js restoreFromPc).
//   다른 화면의 IndexedDB(상품 관리 등)와 이름을 나눠 쓴다.
// indexedDB 는 넘겨받을 수 있다(시험). 기본은 globalThis.indexedDB. 테스트: tests/ship-file-store.test.js(이름·설명) · tools/ship-check.py(실제 브라우저)

export const DB_NAME = 'ggsShipPlatform';
export const DB_VERSION = 1;
export const STORE = 'kv';
export const KEY_TEMPLATE = 'zikjinTemplate';
export const KEY_OUT_DIR = 'outDir';

const reqP = (req) => new Promise((ok, no) => { req.onsuccess = () => ok(req.result); req.onerror = () => no(req.error); });

/** 저장소 열기 → { get, put, del, close }. IndexedDB 가 없거나 막혀 있으면 예외 */
export async function openShipStore(idb = globalThis.indexedDB) {
    if (!idb || typeof idb.open !== 'function') throw new Error('이 브라우저는 IndexedDB 를 쓸 수 없습니다.');
    const open = idb.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    const db = await reqP(open);
    const tx = (mode) => db.transaction(STORE, mode).objectStore(STORE);
    return {
        get: (key) => reqP(tx('readonly').get(key)).then(v => (v === undefined ? null : v)),
        put: (key, value) => reqP(tx('readwrite').put(value, key)).then(() => true),
        del: (key) => reqP(tx('readwrite').delete(key)).then(() => true),
        close: () => db.close(),
    };
}

/** 넣은 파일 → 저장할 기록 { name, size, savedAt(ISO), bytes(ArrayBuffer 사본) } */
export function fileRecord(name, bytes, now = new Date()) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const copy = u8.slice().buffer;
    return { name: String(name || ''), size: u8.byteLength, savedAt: now.toISOString(), bytes: copy };
}

/** 저장된 기록이 쓸 만한 모양인가 */
export const isFileRecord = (r) => !!r && typeof r === 'object' && typeof r.name === 'string' && r.bytes instanceof ArrayBuffer
    && Number.isFinite(r.size) && typeof r.savedAt === 'string';

/** 바이트 수 → '1.2MB' · '820KB' */
export function sizeText(n) {
    const v = Number(n) || 0;
    if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)}MB`;
    if (v >= 1024) return `${Math.round(v / 1024)}KB`;
    return `${v}B`;
}

/** 저장 시각(ISO) → 한국시간 'M월 D일 HH:mm' */
export function savedText(iso) {
    const ms = Date.parse(iso);
    if (!Number.isFinite(ms)) return '';
    const d = new Date(ms + 9 * 3600 * 1000);
    const p2 = (x) => String(x).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}

/** 기억한 원본 한 줄 설명 — '원본.xlsx · 1.2MB · 2026-11-10 14:03 넣음' */
export const describeRecord = (r) => (isFileRecord(r) ? `${r.name} · ${sizeText(r.size)} · ${savedText(r.savedAt)} 넣음` : '');
