// === js/lib/mibal2-cols.js ===
// 부족수량관리(신규) 표 [칸 설정] — 각자 PC 에서 보고 싶은 열만(2026-11-10 사용자 요청, 예전 [간단히]/[전체 항목] 대신). 순수 함수만(시험 tests/mibal2-cols.test.js).
//   · COLS = china-mibal2.html thead 의 원래 순서(바꾸면 둘 다). 화면 순서는 머리글을 끌어 바꿀 수 있다(2026-11-27) —
//     저장 COL_ORDER_KEY = { v:1, order:[열 키] }(이 PC), 정리는 normalizeOrder('no' 는 늘 맨 앞). 엑셀은 화면 순서를 따르지 않는다.
//   · 열 숨김은 칸 번호가 아니라 이름(th·td 의 data-col="키") — 순서가 바뀌어도 같은 열이 숨는다.
//   · 기본값 = 예전 '간단히'. 꼭 보여야 하는 열(REQUIRED)은 끌 수 없다.
//   · 저장은 그 PC 브라우저(localStorage COLS_PICK_KEY) — 서버에 저장하지 않는다. 못 읽으면 기본값.
//   · 예전 보기(localStorage 'mibal2.cols' = 'simple'|'full')만 있으면 한 번 옮긴다(full → 모두).
//   · 저장값 { v:1, on:[켠 열], seen:[저장 때 알던 열] }(2026-11-26 박스 열부터 seen). 읽을 때 seen 에 없는 새 열이 DEFAULT_ON 에 있으면
//     한 번 켜고 다시 저장한다 — 끈 뒤에는 seen 에 들어 있어 다시 켜지지 않는다. seen 이 없는 옛 저장값은 '박스 열 이전'(SEEN_BEFORE_BOX).

export const COLS_PICK_KEY = 'mibal2.colPick';   // 화면 이름(mibal2) 포함
export const COL_ORDER_KEY = 'mibal2.colOrder';  // 열 순서(2026-11-27) — 열 너비(mibal2.colWidths)와 따로
export const LEGACY_COLS_KEY = 'mibal2.cols';

// thead 원래 순서. key = th data-col(= data-sort, No·플래그는 'no'·'flags' — js/china-mibal2.js colKey 와 같다)
export const COLS = ['no', 'code', 'name', 'option', 'sname', 'box', 'loc', 'cap', 'arr', 'conf', 'inDiff', 'stock', 'bstock', 'pstock', 'recv', 'inv', 'out',
    'short', 'mibal', 'unres', 'room', 'third', 'pick', 'resv', 'refill', 'old', 'diff', 'flags'];
// 예전 '간단히'(No·코드·상품명·피킹로케이션·적재량·도착·입고확인·차이(도착−입고)·총재고·미발수량·남는 부족수량·피킹 적재·비축 적재·플래그)
//   + 옵션(2026-11-23) + 박스(2026-11-26 사용자 결정: 기본으로 켬 — 패킹 파일 SHEET1 E열 BOX(옵션별, 11-27), js/lib/pack-boxes.js)
//   + 공급처상품명(2026-11-27 기본 켬 — GIP 값, js/sup-names-store.js. 옛 저장값에는 seen 규칙으로 한 번 켜짐)
export const DEFAULT_ON = ['no', 'code', 'name', 'option', 'sname', 'box', 'loc', 'cap', 'arr', 'conf', 'inDiff', 'stock', 'mibal', 'unres', 'pick', 'resv', 'flags'];
// seen 이 없는 옛 저장값(v:1)이 알던 열 — 박스 열(2026-11-26) 앞의 COLS(그 뒤에 생긴 공급처상품명도 모른다)
//   seen 이 있는 저장값(박스 ~ 공급처상품명 사이 저장)은 seen 에 'sname' 이 없으므로 같은 규칙으로 한 번 켜진다
export const SEEN_BEFORE_BOX = COLS.filter(k => k !== 'box' && k !== 'sname');
// 끌 수 없는 열 — 상품을 알아보는 코드·상품명·옵션, 입고확인(칸을 눌러 고친다)
//   옵션은 2026-11-23 상품명 칸에서 나눴다(사용자 요청) — 예전에 저장한 칸 설정에도 보이게 필수로 둔다
export const REQUIRED = ['code', 'name', 'option', 'conf'];
// 단독 운영(live)에서는 값이 없어 늘 숨기는 비교 열(js/china-mibal2-live.js decorate) — 목록에도 넣지 않는다
export const LIVE_HIDDEN = ['old', 'diff'];

/** 열 이름으로 고르는 선택자 조각 — :is(th, td):is([data-col="a"], [data-col="b"]) */
const colSel = (keys) => `:is(th, td):is(${keys.map(k => `[data-col="${k}"]`).join(', ')})`;

/** live 에서 늘 숨기는 비교 열(LIVE_HIDDEN) 숨김 CSS — 열 이름(data-col)으로(순서를 바꿔도 따라감) */
export const liveHiddenCss = () => `.list-table tr:not(.detail-row) > ${colSel(LIVE_HIDDEN)} { display: none; }`;

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

/** 숨길 열 이름(COLS 순서) */
export const hiddenKeys = (on) => { const s = new Set(on); return COLS.filter(k => !s.has(k)); };

/** 숨김 CSS — 머리글·상품 행(tr.data-row) 칸만(data-col 이름으로). 펼친 상세 행·안내 줄(colspan 한 칸, tr.msg-row)은 건드리지 않는다 */
export function hiddenCss(on) {
    const ks = hiddenKeys(on);
    if (!ks.length) return '';
    return `.list-table :is(thead tr, tbody tr.data-row) > ${colSel(ks)} { display: none; }`;
}

// ── 열 순서(2026-11-27 사용자 요청 — 머리글을 끌어서, [칸 설정] ▲▼) ──

/**
 * 저장된 순서 정리 — 모르는 열·겹친 열은 빼고, 저장에 없는 열(나중에 생긴 열)은 COLS 에서 바로 앞 열 뒤에 끼운다
 * (그 열도 없으면 더 앞 열 뒤 → 결국 'no' 다음). 'no' 는 늘 맨 앞. 배열이 아니면 COLS 그대로.
 */
export function normalizeOrder(saved) {
    const seen = new Set(['no']);
    const out = ['no'];
    (Array.isArray(saved) ? saved : []).forEach(k => { k = String(k); if (COLS.includes(k) && !seen.has(k)) { seen.add(k); out.push(k); } });
    COLS.forEach((k, i) => {
        if (seen.has(k)) return;
        let j = i - 1;
        while (j > 0 && !seen.has(COLS[j])) j--;   // COLS[0] = 'no' 는 늘 있다
        out.splice(out.indexOf(COLS[j]) + 1, 0, k);
        seen.add(k);
    });
    return out;
}

/** 저장 글자 → 순서. 없음·깨짐·다른 판 = COLS */
export function orderFromStorage(raw) {
    if (raw == null) return normalizeOrder(COLS);
    try {
        const v = JSON.parse(raw);
        if (v && v.v === 1 && Array.isArray(v.order)) return normalizeOrder(v.order);
    } catch (e) { /* 아래 기본 */ }
    return normalizeOrder(COLS);
}

export const serializeOrder = (order) => JSON.stringify({ v: 1, order: normalizeOrder(order) });

/** 원래 순서(COLS)와 같은가 — [열 순서 원래대로] 단추 보이기 */
export const isDefaultOrder = (order) => normalizeOrder(order).every((k, i) => k === COLS[i]);

/**
 * key 열을 beforeKey 열 바로 앞으로(beforeKey = null 이면 맨 끝). 'no' 는 못 옮기고 'no' 앞에는 못 놓는다(그대로).
 * 모르는 열·자기 자신 앞은 그대로.
 */
export function moveCol(order, key, beforeKey) {
    const cur = normalizeOrder(order);
    if (key === 'no' || !COLS.includes(key) || key === beforeKey || beforeKey === 'no') return cur;
    if (beforeKey != null && !COLS.includes(beforeKey)) return cur;
    const rest = cur.filter(k => k !== key);
    const at = beforeKey == null ? rest.length : rest.indexOf(beforeKey);
    rest.splice(at, 0, key);
    return rest;
}

/**
 * [칸 설정] ▲(dir -1)·▼(dir +1) — 목록에 보이는 열(listed, 예: live 에서 비교 열 뺀 것) 기준으로 이웃과 자리를 바꾼다.
 * 목록 밖 열은 제자리. 'no' 는 못 옮기고 'no' 위로는 못 간다.
 */
export function stepCol(order, key, dir, listed) {
    const cur = normalizeOrder(order);
    const vis = Array.isArray(listed) ? new Set(listed) : null;
    const shown = cur.filter(k => !vis || vis.has(k));
    const i = shown.indexOf(key);
    if (key === 'no' || i < 0) return cur;
    const nb = shown[i + (dir < 0 ? -1 : 1)];
    if (nb == null || nb === 'no') return cur;
    if (dir < 0) return moveCol(cur, key, nb);
    const rest = cur.filter(k => k !== key);
    rest.splice(rest.indexOf(nb) + 1, 0, key);
    return rest;
}

/**
 * 예전 보기 이름 — 다른 동작(요약 카드·'차이 있는 행만'·색·열 너비 기억)은 이것으로 예전 그대로 고른다.
 * 기본값 열 밖의 열이 하나라도 켜져 있으면 'full', 아니면 'simple'.
 */
export const colsMode = (on) => (on.some(k => !DEFAULT_ON.includes(k)) ? 'full' : 'simple');

/** 펼친 상세 행 colspan(보이는 열 수) */
export const visibleCount = (on) => normalizeOn(on).length;
