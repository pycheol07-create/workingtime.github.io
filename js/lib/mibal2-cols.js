// === js/lib/mibal2-cols.js ===
// 부족수량관리(신규) 표 [칸 설정] — 각자 PC 에서 보고 싶은 열만(2026-11-10 사용자 요청, 예전 [간단히]/[전체 항목] 대신). 순수 함수만(시험 tests/mibal2-cols.test.js).
//   · 열 순서는 china-mibal2.html thead 그대로(COLS 순서 = thead 순서 — 바꾸면 둘 다). 순서 바꾸기는 없다.
//   · 기본값 = 예전 '간단히'. 꼭 보여야 하는 열(REQUIRED)은 끌 수 없다.
//   · 저장은 그 PC 브라우저(localStorage COLS_PICK_KEY) — 서버에 저장하지 않는다. 못 읽으면 기본값.
//   · 예전 보기(localStorage 'mibal2.cols' = 'simple'|'full')만 있으면 한 번 옮긴다(full → 모두).
//   · 저장값 { v:1, on:[켠 열], seen:[저장 때 알던 열] }(2026-11-26 박스 열부터 seen). 읽을 때 seen 에 없는 새 열이 DEFAULT_ON 에 있으면
//     한 번 켜고 다시 저장한다 — 끈 뒤에는 seen 에 들어 있어 다시 켜지지 않는다. seen 이 없는 옛 저장값은 '박스 열 이전'(SEEN_BEFORE_BOX).

export const COLS_PICK_KEY = 'mibal2.colPick';   // 화면 이름(mibal2) 포함
export const LEGACY_COLS_KEY = 'mibal2.cols';

// thead 순서. key = th data-sort(No·플래그는 'no'·'flags' — js/china-mibal2.js colKey 와 같다)
export const COLS = ['no', 'code', 'name', 'option', 'box', 'loc', 'cap', 'arr', 'conf', 'inDiff', 'stock', 'bstock', 'pstock', 'recv', 'inv', 'out',
    'short', 'mibal', 'unres', 'room', 'third', 'pick', 'resv', 'refill', 'old', 'diff', 'flags'];
// 예전 '간단히'(No·코드·상품명·피킹로케이션·적재량·도착·입고확인·차이(도착−입고)·총재고·미발수량·남는 부족수량·피킹 적재·비축 적재·플래그)
//   + 옵션(2026-11-23) + 박스(2026-11-26 사용자 결정: 기본으로 켬 — 패킹 파일 SHEET1 E열 BOX(옵션별, 11-27), js/lib/pack-boxes.js)
export const DEFAULT_ON = ['no', 'code', 'name', 'option', 'box', 'loc', 'cap', 'arr', 'conf', 'inDiff', 'stock', 'mibal', 'unres', 'pick', 'resv', 'flags'];
// seen 이 없는 옛 저장값(v:1)이 알던 열 — 박스 열(2026-11-26) 앞의 COLS
export const SEEN_BEFORE_BOX = COLS.filter(k => k !== 'box');
// 끌 수 없는 열 — 상품을 알아보는 코드·상품명·옵션, 입고확인(칸을 눌러 고친다)
//   옵션은 2026-11-23 상품명 칸에서 나눴다(사용자 요청) — 예전에 저장한 칸 설정에도 보이게 필수로 둔다
export const REQUIRED = ['code', 'name', 'option', 'conf'];
// 단독 운영(live)에서는 값이 없어 늘 숨기는 비교 열(js/china-mibal2-live.js decorate) — 목록에도 넣지 않는다
export const LIVE_HIDDEN = ['old', 'diff'];

/** live 에서 늘 숨기는 비교 열(LIVE_HIDDEN) 숨김 CSS — 번호는 COLS 에서 만든다(열을 넣어도 따라감) */
export const liveHiddenCss = () => `.list-table tr:not(.detail-row) > :is(${LIVE_HIDDEN.map(k => `:nth-child(${COLS.indexOf(k) + 1})`).join(', ')}) { display: none; }`;

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
 * @returns {{ on: string[], migrated: boolean }} migrated = 예전 값에서 옮겼거나 새 열을 켰다(새 모양으로 저장할 것)
 */
export function colsFromStorage(raw, legacy) {
    if (raw != null) {
        try {
            const v = JSON.parse(raw);
            if (v && v.v === 1 && Array.isArray(v.on)) {
                const hasSeen = Array.isArray(v.seen);
                const seen = new Set(hasSeen ? v.seen.map(String) : SEEN_BEFORE_BOX);
                const fresh = DEFAULT_ON.filter(k => !seen.has(k));   // 저장 뒤 생긴 기본 켜짐 열 — 한 번만 켠다
                return { on: normalizeOn([...v.on, ...fresh]), migrated: !hasSeen || fresh.length > 0 };
            }
        } catch (e) { /* 아래 기본값 */ }
        return { on: normalizeOn(DEFAULT_ON), migrated: false };
    }
    if (legacy === 'full') return { on: normalizeOn(COLS), migrated: true };
    if (legacy === 'simple') return { on: normalizeOn(DEFAULT_ON), migrated: true };
    return { on: normalizeOn(DEFAULT_ON), migrated: false };
}

export const serializeCols = (on) => JSON.stringify({ v: 1, on: normalizeOn(on), seen: COLS });

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
