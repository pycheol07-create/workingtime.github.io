// === js/lib/loc-cards.js ===
// 동선 기준 '구역-동 카드' 순서(recommendPriorities.cards) — 읽기·검사·옛 칸과 바꾸기·자동 정렬. 2026-11-03.
// 순수 ESM: DOM·window·Firebase 를 쓰지 않고 import 도 없다. loc-recommend.js(서버가 node 로 읽음)가 import 한다
//   — ⚠️ 이 파일을 고치면 서버(로케이션추천)도 바로 바뀐다.
//
// 저장 모양(INFO_CONFIG.recommendPriorities):
//   { zones, dongs, poses, excludeCombos, cards: { v: 1, order: ['★-★', 'A-1', …], level: [0, 1, 1, …], rowsPerDong: 2 } }
//   카드 이름 = 자리 id 첫 글자(대문자) + '-' + 동(excludeCombos 와 같은 규칙. 동 없는 자리는 'K-').
//   level = 줄(0 부터, 같은 줄 여러 카드 가능). order 에 없는 카드 = 미지정(순위 99 — 그 자리로는 안 보냄).
//   Firestore 는 배열 안 배열을 받지 않아 order·level 두 평면 배열로 둔다.
//   zones·dongs 는 카드 저장 때 건드리지 않은 옛 값(되돌리기·검사 실패 때 옛 방식 계산용). 카드가 맞으면 계산은 카드만 본다.
// 검사(parseCards)에 걸리면 서버·lib 는 옛 방식(zones·dongs·poses)으로 계산하고 경고 한 줄을 남긴다.
// 서버 판정(로케이션추천\판정.py Where)이 같은 검사·비용식을 따로 갖고 있다 — 규칙을 바꾸면 그쪽도 같이.

const RANK_NONE = 99;
const CARD_RE = /^.-[^,]*$/;
const CARD_MAX = 40;
const U_MIN = 0.5, U_MAX = 20;

/** 자리 → 카드 이름(조합) = 첫 글자 대문자-동. excludeCombos 와 같은 규칙. */
export const comboOf = (d) => `${(d.id || '').charAt(0).toUpperCase()}-${(d.dong || '').toString().trim()}`;

const letterOf = (card) => String(card).charAt(0);
const dongOfCard = (card) => String(card).slice(2);
const byKeyAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * priorities.cards 읽기·검사.
 * @returns {{present: boolean, ok: boolean, errors: string[], rowOf?: Function, rowOfCombo?: Function, nRows?: number, U?: number,
 *            dongOrder?: string[], zoneOrder?: string[], letterRow?: Function}}
 *   present = cards 칸이 있나(없으면 ok false·errors 빈 배열 — 옛 방식, 경고 없음)
 *   rowOf(자리) / rowOfCombo(이름) = 줄(없으면 99) · nRows = 줄 수 · U = 동 1칸에 해당하는 줄 수(rowsPerDong)
 *   dongOrder = 카드 순서에서 처음 나온 동 순서(빈 동 제외) · zoneOrder = 순위 있는 글자(가장 앞 줄 → 글자순)
 *   letterRow(글자) = 그 글자 카드의 가장 앞 줄(없으면 99)
 */
export function parseCards(priorities) {
    const c = priorities && priorities.cards;
    if (c == null) return { present: false, ok: false, errors: [] };
    const errors = [];
    if (typeof c !== 'object' || Array.isArray(c)) return { present: true, ok: false, errors: ['cards 모양이 아님'] };
    if (c.v != null && c.v !== 1) errors.push('cards.v 가 1 이 아님');
    const order = c.order, level = c.level;
    if (!Array.isArray(order) || !Array.isArray(level)) return { present: true, ok: false, errors: errors.concat('order·level 이 배열이 아님') };
    if (!order.length) errors.push('카드 줄이 비었음');
    if (order.length !== level.length) errors.push('order·level 길이가 다름');
    const n = Math.min(order.length, level.length);
    for (let i = 0; i < n; i++) {
        const lv = level[i];
        if (!(typeof lv === 'number' && Number.isInteger(lv))) { errors.push('level 이 정수가 아님'); break; }
        if (i === 0 && lv !== 0) { errors.push('level 이 0 부터가 아님'); break; }
        if (i > 0 && lv < level[i - 1]) { errors.push('level 이 줄어듦'); break; }
        if (i > 0 && lv > level[i - 1] + 1) { errors.push('level 이 1 넘게 건너뜀'); break; }
    }
    const seen = new Set();
    for (const name of order) {
        if (typeof name !== 'string' || name.length > CARD_MAX || !CARD_RE.test(name)) { errors.push('카드 이름이 이상함'); break; }
        if (seen.has(name)) { errors.push('카드가 겹침'); break; }
        seen.add(name);
    }
    const ex = (priorities && Array.isArray(priorities.excludeCombos)) ? priorities.excludeCombos : [];
    if (ex.some(x => seen.has(x))) errors.push('제외 카드가 순서에 있음');
    // 줄 번호 99 는 '순위 없음'(RANK_NONE)과 겹친다 — 줄은 99 개 미만(판정.py card_rows 와 같음)
    if (level.length && Number.isInteger(level[level.length - 1]) && level[level.length - 1] >= 98) errors.push('줄이 너무 많음(99줄 이상)');
    const U = c.rowsPerDong;
    if (!(typeof U === 'number' && Number.isFinite(U) && U >= U_MIN && U <= U_MAX)) errors.push(`rowsPerDong 이 ${U_MIN}~${U_MAX} 밖`);
    if (errors.length) return { present: true, ok: false, errors };

    const rowMap = new Map(order.map((name, i) => [name, level[i]]));
    const rowOfCombo = (name) => (rowMap.has(name) ? rowMap.get(name) : RANK_NONE);
    const dongOrder = [];
    const lRow = new Map();
    order.forEach((name, i) => {
        const dg = dongOfCard(name);
        if (dg && !dongOrder.includes(dg)) dongOrder.push(dg);
        const z = letterOf(name);
        if (!lRow.has(z)) lRow.set(z, level[i]);
    });
    const zoneOrder = [...lRow.keys()].sort((a, b) => (lRow.get(a) - lRow.get(b)) || byKeyAsc(a, b));
    return {
        present: true, ok: true, errors: [],
        rowOf: (slot) => rowOfCombo(comboOf(slot || {})),
        rowOfCombo,
        nRows: level[level.length - 1] + 1,
        U,
        dongOrder, zoneOrder,
        letterRow: (z) => (lRow.has(z) ? lRow.get(z) : RANK_NONE)
    };
}

/** 이름 목록 → 줄 배열(rows: [[이름…], …]) → {order, level}. 빈 줄은 뺀다. */
function fromRows(rows) {
    const order = [], level = [];
    rows.filter(r => r && r.length).forEach((r, i) => r.forEach(name => { order.push(name); level.push(i); }));
    return { order, level };
}

const comboList = (combos, priorities) => {
    const ex = new Set((priorities && priorities.excludeCombos) || []);
    const out = [];
    (combos || []).forEach(x => {
        const name = typeof x === 'string' ? x : (x && x.combo);
        if (typeof name === 'string' && CARD_RE.test(name) && name.length <= CARD_MAX && !ex.has(name) && !out.includes(name)) out.push(name);
    });
    return out;
};

/**
 * 옛 칸(zones 등급·dongs) → 카드. 등급 순서대로, 그 안에서 dongs 순서로 한 줄씩(그 등급 글자들의 같은 동 카드), U=1.
 *   ★·A~I 처럼 한 등급 안 카드는 비용이 옛 방식과 같다(줄 = 동순위). 등급 밖 글자·dongs 에 없는 동 카드는 미지정.
 * @param {object} priorities  {zones, dongs, excludeCombos}
 * @param {Array<string|{combo}>} combos  자료에 있는 카드 이름(제외 카드는 빠진다)
 */
export function legacyToCards(priorities, combos) {
    const pr = priorities || {};
    const zones = pr.zones || {};
    const dongs = (pr.dongs || []).map(x => String(x).trim());
    const names = comboList(combos, pr);
    const gradeOf = (z) => { for (let i = 0; i <= 3; i++) if (zones[i] && zones[i].includes(z)) return i; return RANK_NONE; };
    const rows = [];
    for (let g = 0; g <= 3; g++) {
        const zl = zones[g] || [];
        dongs.forEach(dg => {
            const row = names.filter(n => gradeOf(letterOf(n)) === g && dongOfCard(n) === dg)
                .sort((a, b) => zl.indexOf(letterOf(a)) - zl.indexOf(letterOf(b)) || byKeyAsc(a, b));
            rows.push(row);
        });
    }
    return { v: 1, ...fromRows(rows), rowsPerDong: 1 };
}

/**
 * 카드 → 옛 칸 사본 {zones: {0..3}, dongs}. 글자마다 줄 범위(처음~끝 줄)를 보고 범위가 겹치는 글자끼리 같은 등급,
 * 묶음은 가장 앞 줄 순서로 등급 0, 1, 2 …(4번째 이후는 3). 묶음 안 글자는 처음 줄 → 글자순. dongs = 카드 순서에서 처음 나온 동 순서(빈 동 제외).
 * 카드가 검사에 걸리면 null.
 */
export function cardsToLegacy(cards, priorities) {
    const pc = parseCards({ ...(priorities || {}), cards });
    if (!pc.ok) return null;
    // 글자마다 줄 범위 [처음, 끝] — 범위가 겹치는 글자끼리 한 묶음(같은 등급)
    const span = new Map();
    cards.order.forEach((name, i) => {
        const z = letterOf(name), lv = cards.level[i];
        const s = span.get(z);
        if (!s) span.set(z, { z, lo: lv, hi: lv });
        else { s.lo = Math.min(s.lo, lv); s.hi = Math.max(s.hi, lv); }
    });
    const list = [...span.values()].sort((a, b) => a.lo - b.lo || byKeyAsc(a.z, b.z));
    const groups = [];
    list.forEach(s => {
        const g = groups[groups.length - 1];
        if (g && s.lo <= g.hi) { g.zs.push(s.z); g.hi = Math.max(g.hi, s.hi); }
        else groups.push({ zs: [s.z], hi: s.hi });
    });
    const zones = { 0: [], 1: [], 2: [], 3: [] };
    groups.forEach((g, i) => zones[Math.min(i, 3)].push(...g.zs));
    return { zones, dongs: pc.dongOrder.slice() };
}

/** 자동 정렬 기본 라인 배치(tools/route-compare.mjs DEFAULT_LAYOUT 과 같다): Z-1 이 맨 앞 라인 → A … I, 나머지 Z 는 별도 공간(먼 자리) */
export const CARD_LAYOUT = Object.freeze({ order: ['Z-1-', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], far: ['Z-'] });
export const AUTO_PRESETS = Object.freeze(['dong-group', 'dong-first', 'line-first', 'distance']);
const DEFAULT_DONGS = ['★', '1', '2', '3', '4', '5', '6'];

/**
 * 자동 정렬 — 카드 이름 목록 → {v, order, level, rowsPerDong}.
 *   'dong-group' ① 기존 설정 = legacyToCards(priorities) (U=1)
 *   'dong-first' ② 동 우선: ★, A-1 … I-1, A-2 … (라인 배치 순서), 먼 자리(Z) 뒤 — 카드마다 한 줄, U = 한 동에 든 라인 카드 수(최대)
 *   'line-first' ③ 라인 우선: ★, A-1 … A-4, B-1 … — 카드마다 한 줄, 먼 자리 뒤, U=1
 *   'distance'   ④ 출발점 거리 순(기본·추천): 거리 = 동순번 + 0.5·라인순번, 같은 거리 = 같은 줄, 먼 자리는 맨 뒤 한 줄, U=2
 *   동순번 = priorities.dongs 순서(없으면 ★,1~6). 라인순번 = layout.order 에서 가장 긴 접두어(카드 이름 + '-' 로 비교).
 *   ★ 글자는 라인이 아니라 라인순번 0 으로 맨 앞. dongs 에 없는 동·배치에 없는 글자(K 등) 카드는 미지정.
 * @param {Array<string|{combo}>} combos  자료에 있는 카드(제외 카드는 빠진다)
 * @param {string} preset
 * @param {{priorities?: object, layout?: {order: string[], far?: string[]}}} [opt]
 */
export function autoSort(combos, preset, { priorities, layout } = {}) {
    const pr = priorities || {};
    if (preset === 'dong-group') return legacyToCards(pr, combos);
    if (!AUTO_PRESETS.includes(preset)) throw new Error('자동 정렬 종류가 이상함: ' + preset);
    const names = comboList(combos, pr);
    const dongs = ((pr.dongs && pr.dongs.length) ? pr.dongs : DEFAULT_DONGS).map(x => String(x).trim());
    const lay = layout && Array.isArray(layout.order) && layout.order.length ? layout : CARD_LAYOUT;
    const up = (x) => String(x == null ? '' : x).toUpperCase();
    const ord = lay.order.map((p, i) => ({ p: up(p), i })).filter(x => x.p).sort((a, b) => b.p.length - a.p.length || a.i - b.i);
    const far = (Array.isArray(lay.far) ? lay.far : []).map(up).filter(Boolean);
    const info = names.map(n => {
        const s = up(n) + '-';
        const di = dongs.indexOf(dongOfCard(n));
        const hit = ord.find(x => s.startsWith(x.p));
        if (di < 0) return { n, kind: 'none' };
        if (hit) return { n, kind: 'line', li: hit.i, di };
        if (far.some(p => s.startsWith(p))) return { n, kind: 'far', di };
        if (letterOf(n) === '★') return { n, kind: 'star', di };
        return { n, kind: 'none' };
    });
    const star = info.filter(x => x.kind === 'star').sort((a, b) => a.di - b.di || byKeyAsc(a.n, b.n));
    const line = info.filter(x => x.kind === 'line');
    const farL = info.filter(x => x.kind === 'far').sort((a, b) => a.di - b.di || byKeyAsc(a.n, b.n));
    const one = (x) => [x.n];
    if (preset === 'dong-first') {
        const ls = line.slice().sort((a, b) => a.di - b.di || a.li - b.li || byKeyAsc(a.n, b.n));
        const perDong = new Map();
        ls.forEach(x => perDong.set(x.di, (perDong.get(x.di) || 0) + 1));
        const U = Math.min(U_MAX, Math.max(1, ...perDong.values()));
        return { v: 1, ...fromRows(star.map(one).concat(ls.map(one), farL.map(one))), rowsPerDong: U };
    }
    if (preset === 'line-first') {
        const ls = line.slice().sort((a, b) => a.li - b.li || a.di - b.di || byKeyAsc(a.n, b.n));
        return { v: 1, ...fromRows(star.map(one).concat(ls.map(one), farL.map(one))), rowsPerDong: 1 };
    }
    // distance — 0.5 단위라 2배 정수로 묶는다(소수 비교 오차 없음)
    const near = star.map(x => ({ n: x.n, k: 2 * x.di })).concat(line.map(x => ({ n: x.n, k: 2 * x.di + x.li })));
    const ks = [...new Set(near.map(x => x.k))].sort((a, b) => a - b);
    const rows = ks.map(k => near.filter(x => x.k === k).map(x => x.n).sort(byKeyAsc));
    rows.push(farL.map(x => x.n));
    return { v: 1, ...fromRows(rows), rowsPerDong: 2 };
}
