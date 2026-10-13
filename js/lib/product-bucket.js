// === js/lib/product-bucket.js ===
// 상품 관리(products.html) — 품목코드 → 버킷(청크 문서) 번호. 2026-10-13. 설계: 상품DB_설계_v2.md 1-1
//
// bucket(품목코드) = fnv1a32(UTF-8 바이트) % n
//   · 카탈로그 ProductCatalog/B00~B15 (n = META.n, 기본 16) · 원가 adminProductCost/C00~C15 (n = 16 고정)
//   · 한 상품의 기본정보·원가는 항상 같은 번호(같은 n 일 때).
// 채우기자동화\위치요약.py 에 **같은 함수**가 있다(ProductLoc 을 n 개로 나눌 때). 바꾸면 그쪽도 바꾸고
// 양쪽 테스트의 시험 벡터(FNV_VECTORS)를 같이 고칠 것.
//
// 순수 모듈(DOM/Firebase 의존 없음). 브라우저와 node --test 가 함께 쓴다.

export const CATALOG_BUCKETS = 16;
export const COST_BUCKETS = 16;

/** 품목코드·상품코드 허용 모양 — 맵 키·FieldPath 로 쓰므로 그 밖은 업로드 오류 */
export const CODE_RE = /^[0-9A-Za-z_\-]{1,40}$/;
export const isValidCode = (s) => typeof s === 'string' && CODE_RE.test(s);

/** 문자열 → UTF-8 바이트 배열 (TextEncoder 가 없는 환경 대비 직접 구현) */
export function utf8Bytes(str) {
    const s = String(str);
    const out = [];
    for (let i = 0; i < s.length; i++) {
        let c = s.charCodeAt(i);
        if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) {
            const d = s.charCodeAt(i + 1);
            if (d >= 0xDC00 && d <= 0xDFFF) { c = 0x10000 + ((c - 0xD800) << 10) + (d - 0xDC00); i++; }
        }
        if (c < 0x80) out.push(c);
        else if (c < 0x800) out.push(0xC0 | (c >> 6), 0x80 | (c & 63));
        else if (c < 0x10000) out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        else out.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return out;
}

/** UTF-8 바이트 길이 (문서 크기 계산용) */
export function utf8Length(str) {
    const s = String(str);
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { n += 4; i++; }
        else n += 3;
    }
    return n;
}

/** FNV-1a 32비트 (UTF-8) → 0 ~ 2^32-1 */
export function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (const b of utf8Bytes(str)) {
        h ^= b;
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
}

export const bucketOf = (code, n = CATALOG_BUCKETS) => fnv1a32(code) % n;
const pad2 = (i) => String(i).padStart(2, '0');
export const catalogBucketId = (pid, n = CATALOG_BUCKETS) => 'B' + pad2(bucketOf(pid, n));
export const costBucketId = (pid) => 'C' + pad2(bucketOf(pid, COST_BUCKETS));
export const catalogBucketIds = (n = CATALOG_BUCKETS) => Array.from({ length: n }, (_, i) => 'B' + pad2(i));
export const costBucketIds = () => Array.from({ length: COST_BUCKETS }, (_, i) => 'C' + pad2(i));

/** 시험 벡터 — 채우기자동화\tests\test_위치요약.py 와 같은 값이어야 한다 */
export const FNV_VECTORS = [
    ['594198', 0xb22731fd],
    ['S594199', 0x256b79a5],
    ['', 0x811c9dc5],
    ['가', 0xcdd08b15],
    ['999999', 0x11b14a0b],
];
