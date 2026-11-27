// === js/sup-names-store.js ===
// 공급처상품명(GIP) 읽기 — 여러 화면이 같이 쓰는 저장소. 2026-11-27 (1단계: 상품 관리)
//
// 읽는 것(로그인 직원, 규칙 isMember): ProductSupName/META 1회 + 필요한 문서 Sxx 만(getDoc, onSnapshot 없음).
//   loadAll(db)        META + 문서 전부(n 개, 지금은 1~2개)
//   loadFor(db, codes) META + 그 코드들이 든 문서만
//   reset()            받아 둔 것을 비운다 — 다음 load* 때 META 부터 다시 읽는다([새로고침])
// 이 페이지가 떠 있는 동안 메모리에만 둔다(IndexedDB·localStorage 에 저장하지 않음). 한 번 받은 문서는 다시 안 받는다.
// 실패(권한·네트워크·문서 없음)하면 빈 결과 — 화면은 빈칸. 오류는 console 에 코드만.
// 값 모양·문서 번호 규칙은 js/lib/sup-names.js (쓰는 쪽 앱\공급처상품명\수집.py).
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { SUP_COLLECTION, shardId, shardsFor, parseShard, metaN, lookup } from './lib/sup-names.js?v=dec9187a136b-1d6082e2';

const names = new Map();          // 코드 → 이름 (받은 문서들 합)
const shardP = new Map();         // 문서 번호 → Promise (받는 중·받음)
let metaP = null;
let meta = null;
let gen = 0;                      // reset() 때마다 +1 — 그 전에 시작한 읽기의 결과는 버린다

const warn = (what, e) => console.warn(`[sup-names] ${what} 실패:`, (e && e.code) || (e && e.name) || 'unknown');

function loadMeta(db, onRead) {
    if (!metaP) {
        const g = gen;
        metaP = getDoc(doc(db, SUP_COLLECTION, 'META')).then((s) => {
            if (onRead) onRead('공급처상품명 META');
            const m = s.exists() ? s.data() : null;
            if (g === gen) meta = m;
            return m;
        }).catch((e) => { warn('META 읽기', e); if (g === gen) metaP = null; return null; });   // 다음에 다시 시도
    }
    return metaP;
}

function loadShard(db, i, onRead) {
    if (!shardP.has(i)) {
        const g = gen;
        const p = getDoc(doc(db, SUP_COLLECTION, shardId(i))).then((s) => {
            if (onRead) onRead('공급처상품명');
            if (g === gen && s.exists()) for (const [k, v] of parseShard(s.data().data)) names.set(k, v);
        }).catch((e) => { warn('문서 읽기', e); if (g === gen) shardP.delete(i); });
        shardP.set(i, p);
    }
    return shardP.get(i);
}

/** META + 문서 전부 → Map(코드 → 이름). 실패하면 그때까지 받은 것(없으면 빈 Map) */
export async function loadAll(db, { onRead } = {}) {
    if (!db) return names;
    const n = metaN(await loadMeta(db, onRead));
    if (n) await Promise.all(Array.from({ length: n }, (_, i) => loadShard(db, i, onRead)));
    return names;
}

/** META + codes 가 든 문서만 → Map(코드 → 이름) */
export async function loadFor(db, codes, { onRead } = {}) {
    if (!db) return names;
    const n = metaN(await loadMeta(db, onRead));
    if (n) await Promise.all(shardsFor(codes, n).map(i => loadShard(db, i, onRead)));
    return names;
}

/** 받아 둔 것에서 찾기(읽기 없음) — 없거나 아직 안 받았으면 '' */
export const supNameOf = (code) => lookup(names, code);
/** 받아 둔 META(없으면 null) — 기준 시각 표시용 */
export const supNamesMeta = () => meta;

/** 받아 둔 것을 비운다(받는 중인 것은 끝나도 버린다) — 다음 loadAll·loadFor 때 META 부터 다시 */
export function reset() {
    gen++;
    names.clear();
    shardP.clear();
    metaP = null;
    meta = null;
}
