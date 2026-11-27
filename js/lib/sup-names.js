// === js/lib/sup-names.js ===
// 공급처상품명(GIP) — 문서 번호·문서 풀기·찾기. 2026-11-27 (1단계)
//
// 쓰는 쪽: 앱\공급처상품명\수집.py (GIP product_master → Firestore ProductSupName, 매일 06:20)
//   ProductSupName/META = { schema:1, rev, at, n, counts:{codes, kept, skipped, empty}, lastSeenDay }
//   ProductSupName/S00..S{n-1} = { rev, data: "<JSON {names:[…], m:{코드: names 번호}}>" }
//   문서 번호 = fnv1a32(코드) % n — product-bucket.js 의 fnv1a32 를 그대로 쓴다(수집.py 에 같은 함수).
// 값은 GIP 값 전부(빈칸만 뺌 — 영문·숫자 품번·한글 설명 포함, 사용자 결정 2026-11-27). 수집기가 줄바꿈·제어문자를
// 공백으로 바꾸고 120자에서 자른다. 업체 이름이 섞일 수 있다 — 화면에는 반드시 escape 해서 넣을 것.
// (박스 확인이 글자를 공급처상품명으로 알아보는 규칙은 js/lib/box-check.js 가 GGS…-… 모양만 따로 본다.)
// 계약 시험: tests/sup-names.test.js ↔ 공급처상품명\tests\test_수집.py (같은 사례 tests/fixtures/sup-names-case.json)
//
// 순수 모듈(DOM/Firebase 의존 없음). 브라우저와 node --test 가 함께 쓴다.
import { fnv1a32 } from './product-bucket.js?v=842897a6efab-a72f5a26';

export const SUP_COLLECTION = 'ProductSupName';
export const SUP_MAX_SHARDS = 16;
/** 수집.py NAME_RE 와 같다(빈칸 아님·제어문자 없음·120자 이하) — 아니면 문서에 있어도 보이지 않는다 */
export const SUP_NAME_RE = /^(?=.*\S)[^\x00-\x1f\x7f]{1,120}$/;
const SUP_CODE_RE = /^S[0-9]{1,30}$/;

export const shardOf = (code, n) => fnv1a32(String(code)) % n;
export const shardId = (i) => 'S' + String(i).padStart(2, '0');

/** META → 문서 수 n(1~16 정수). 틀리면 0 */
export function metaN(meta) {
    const n = Number(meta && meta.n);
    return Number.isInteger(n) && n >= 1 && n <= SUP_MAX_SHARDS ? n : 0;
}

/** 코드 목록 → 읽어야 할 문서 번호(중복 없이, 오름차순) */
export function shardsFor(codes, n) {
    const set = new Set();
    for (const c of codes || []) if (typeof c === 'string' && c) set.add(shardOf(c, n));
    return [...set].sort((a, b) => a - b);
}

/** data 문자열 → Map(코드 → 이름). 모양이 틀린 항목은 버린다(깨진 JSON 이면 빈 Map) */
export function parseShard(data) {
    const out = new Map();
    let d;
    try { d = JSON.parse(data || '{}'); } catch (e) { return out; }
    const names = d && d.names, m = d && d.m;
    if (!Array.isArray(names) || !m || typeof m !== 'object' || Array.isArray(m)) return out;
    for (const [code, i] of Object.entries(m)) {
        if (!Number.isInteger(i) || i < 0 || i >= names.length) continue;
        const nm = names[i];
        if (typeof nm === 'string' && SUP_CODE_RE.test(code) && SUP_NAME_RE.test(nm)) out.set(code, nm);
    }
    return out;
}

/** Map 에서 찾기 — 없으면 '' */
export function lookup(map, code) {
    if (!map || typeof code !== 'string' || !code) return '';
    return map.get(code) || '';
}
