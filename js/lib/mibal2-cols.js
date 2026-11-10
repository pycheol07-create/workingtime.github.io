// === js/lib/mibal2-cols.js ===
// 부족수량관리(신규) 표 [칸 설정] — 각자 PC 에서 보고 싶은 열만(2026-11-10 사용자 요청, 예전 [간단히]/[전체 항목] 대신). 순수 함수만(시험 tests/mibal2-cols.test.js).
//   · 열 순서는 china-mibal2.html thead 그대로(COLS 순서 = thead 순서 — 바꾸면 둘 다). 순서 바꾸기는 없다.
//   · 기본값 = 예전 '간단히'. 꼭 보여야 하는 열(REQUIRED)은 끌 수 없다.
//   · 저장은 그 PC 브라우저(localStorage COLS_PICK_KEY) — 서버에 저장하지 않는다. 못 읽으면 기본값.
//   · 예전 보기(localStorage 'mibal2.cols' = 'simple'|'full')만 있으면 한 번 옮긴다(full → 모두).

export const COLS_PICK_KEY = 'mibal2.colPick';   // 화면 이름(mibal2) 포함
export const LEGACY_COLS_KEY = 'mibal2.cols';

// thead 순서. key = th data-sort(No·플래그는 'no'·'flags' — js/china-mibal2.js colKey 와 같다)
export const COLS = ['no', 'code', 'name', 'loc', 'cap', 'arr', 'conf', 'inDiff', 'stock', 'bstock', 'pstock', 'recv', 'inv', 'out',
    'short', 'mibal', 'unres', 'room', 'third', 'pick', 'resv', 'refill', 'old', 'diff', 'flags'];
// 예전 '간단히'(No·코드·상품명·피킹로케이션·적재량·도착·입고확인·차이(도착−입고)·총재고·미발수량·남는 부족수량·피킹 적재·비축 적재·플래그)
export const DEFAULT_ON = ['no', 'code', 'name', 'loc', 'cap', 'arr', 'conf', 'inDiff', 'stock', 'mibal', 'unres', 'pick', 'resv', 'flags'];
// 끌 수 없는 열 — 상품을 알아보는 코드·상품명, 입고확인(칸을 눌러 고친다)
export const REQUIRED = ['code', 'name', 'conf'];
// 단독 운영(live)에서는 값이 없어 늘 숨기는 비교 열(js/china-mibal2-live.js decorate) — 목록에도 넣지 않는다
export const LIVE_HIDDEN = ['old', 'diff'];

/** 고를 수 있는 열(목록 순서) */
export const pickableCols = (live) => COLS.filter(k => !(live && LIVE_HIDDEN.includes(k)));

/** 정리 — 모르는 열은 빼고, 꼭 보일 열은 넣고, thead 순서로 */
export function normalizeOn(keys) {
    const s = new Set((Array.isArray(keys) ? keys : []).map(String));
    REQUIRED.forEach(k => s.add(k));
    return COLS.filter(k => s.has(k));
}

/**
 * 저장값 → 켤 열. raw = localStorage COLS_PICK_KEY 글자(없으면 null), legacy = 예전 'mibal2.cols' 글자.
 * @returns {{ on: string[], migrated: boolean }} migrated = 예전 값에서 옮겼다(새 키로 저장할 것)
 */
export function colsFromStorage(raw, legacy) {
    if (raw != null) {
        try {
            const v = JSON.parse(raw);
            if (v && v.v === 1 && Array.isArray(v.on)) return { on: normalizeOn(v.on), migrated: false };
        } catch (e) { /* 아래 기본값 */ }
        return { on: normalizeOn(DEFAULT_ON), migrated: false };
    }
    if (legacy === 'full') return { on: normalizeOn(COLS), migrated: true };
    if (legacy === 'simple') return { on: normalizeOn(DEFAULT_ON), migrated: true };
    return { on: normalizeOn(DEFAULT_ON), migrated: false };
}

export const serializeCols = (on) => JSON.stringify({ v: 1, on: normalizeOn(on) });

/** 켜기·끄기 — 꼭 보일 열은 끌 수 없다(그대로) */
export function toggleCol(on, key, checked) {
    if (!COLS.includes(key)) return normalizeOn(on);
    if (!checked && REQUIRED.includes(key)) return normalizeOn(on);
    const s = new Set(on);
    if (checked) s.add(key); else s.delete(key);
    return normalizeOn([...s]);
}

/** 숨길 열의 nth-child 번호(1부터) */
export const hiddenIndexes = (on) => { const s = new Set(on); return COLS.map((k, i) => (s.has(k) ? 0 : i + 1)).filter(Boolean); };

/** 숨김 CSS — 머리글·상품 행(tr.data-row) 칸만. 펼친 상세 행·안내 줄(colspan 한 칸, tr.msg-row)은 건드리지 않는다 */
export function hiddenCss(on) {
    const ix = hiddenIndexes(on);
    if (!ix.length) return '';
    return `.list-table :is(thead tr, tbody tr.data-row) > :is(${ix.map(i => `:nth-child(${i})`).join(', ')}) { display: none; }`;
}

/**
 * 예전 보기 이름 — 다른 동작(요약 카드·'차이 있는 행만'·색·열 너비 기억)은 이것으로 예전 그대로 고른다.
 * 기본값 열 밖의 열이 하나라도 켜져 있으면 'full', 아니면 'simple'.
 */
export const colsMode = (on) => (on.some(k => !DEFAULT_ON.includes(k)) ? 'full' : 'simple');

/** 펼친 상세 행 colspan(보이는 열 수) */
export const visibleCount = (on) => normalizeOn(on).length;
