// === js/lib/loc-card-board.js ===
// 환경설정 '추천·채우기' 탭의 동선 기준 '구역-동 카드' 화면 상태(보드) — 순수 함수. 2026-11-03.
// 순수 ESM: DOM·window·Firebase 를 쓰지 않는다. 화면은 js/locset-panel.js 가 그린다.
//   보드 = { rows: [[카드…], …], unassigned: [카드…], exclude: [조합…], U, universe: [카드…] }
//     rows       = 줄(위가 먼저, 같은 줄 = 같은 순위). 빈 줄은 화면에서만 있고 저장 때 빠진다.
//     unassigned = 미지정 칸(순위 99 — 그 자리로는 추천하지 않음)
//     exclude    = 제외 조합 전체(= 저장값 excludeCombos). 카드인 것만 '제외 칸'에 보이고, 자료에 없는 조합은 고급 입력칸에만.
//     universe   = 자료에 있는 카드 ∪ 저장된 순서에만 있는 카드('자리 없음')
//   함수는 보드를 고치지 않고 새 보드를 돌려준다.
// 검사는 ./loc-cards.js parseCards 그대로 쓴다. 저장 때 zones·dongs 는 건드리지 않는다(boardToSave).

import { parseCards, legacyToCards } from './loc-cards.js?v=202611041616';

// 카드 이름 규칙 — loc-cards.js 의 CARD_RE·CARD_MAX 와 같다(그쪽은 내보내지 않음)
const CARD_RE = /^.-[^,]*$/;
const CARD_MAX = 40;
const isCardName = (n) => typeof n === 'string' && n.length <= CARD_MAX && CARD_RE.test(n);

const letterOf = (n) => String(n).charAt(0);
const dongOf = (n) => String(n).slice(2);

/** 카드 정렬(미지정·제외 칸 표시용): ★ 먼저 → 글자 → 동(숫자면 숫자 순, 동 없음은 뒤) */
export function cardCompare(a, b) {
    const la = letterOf(a), lb = letterOf(b);
    if (la !== lb) {
        if (la === '★') return -1;
        if (lb === '★') return 1;
        return la < lb ? -1 : 1;
    }
    const da = dongOf(a), db = dongOf(b);
    if (da === db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    const na = Number(da), nb = Number(db);
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return da < db ? -1 : 1;
}

/** 카드 글자: '★-★' → '★', 'K-' → 'K (동 없음)', 그 밖은 이름 그대로 */
export function cardLabel(name) {
    if (name === '★-★') return '★';
    if (dongOf(name) === '') return `${letterOf(name)} (동 없음)`;
    return String(name);
}

/** 쉼표 입력 → 제외 조합 목록(앞뒤 공백 빼고 대문자, 겹침 없이). 예전 화면과 같은 규칙. */
export function parseExcludeText(text) {
    const out = [];
    String(text || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        .forEach(s => { if (!out.includes(s)) out.push(s); });
    return out;
}

const clone = (b) => ({
    rows: b.rows.map(r => r.slice()), unassigned: b.unassigned.slice(), exclude: b.exclude.slice(),
    U: b.U, universe: b.universe.slice()
});

/** order·level → 줄 배열 */
function rowsOf(cards) {
    const rows = [];
    cards.order.forEach((n, i) => { const lv = cards.level[i]; (rows[lv] = rows[lv] || []).push(n); });
    return rows.map(r => r || []);
}

/** universe 에서 줄·제외에 없는 카드 = 미지정(정렬) */
function fillUnassigned(b) {
    const used = new Set([...b.rows.flat(), ...b.exclude]);
    b.unassigned = b.universe.filter(n => !used.has(n)).sort(cardCompare);
    return b;
}

/**
 * 저장값 + 자료 카드 수 → 화면 보드.
 * @param {object} priorities  INFO_CONFIG.recommendPriorities (없으면 {})
 * @param {Object<string, number>} counts  자료에 있는 카드 이름 → 칸 수
 * @returns {{mode: 'cards'|'legacy', errors: string[], board: object}}
 *   mode = 저장값 기준 지금 계산 방식. 카드 칸이 있지만 검사에 걸리면 'legacy' + errors(서버도 옛 방식으로 계산 중).
 *   옛 방식이면 legacyToCards 로 지금 설정을 카드로 바꿔 보여 준다.
 */
export function boardFrom(priorities, counts) {
    const pr = priorities && typeof priorities === 'object' ? priorities : {};
    const names = Object.keys(counts || {}).filter(isCardName);
    const exclude = parseExcludeText((Array.isArray(pr.excludeCombos) ? pr.excludeCombos : []).join(','));
    const pc = parseCards(pr);
    let cards, mode, errors = [];
    if (pc.ok) {
        cards = pr.cards; mode = 'cards';
    } else {
        mode = 'legacy'; errors = pc.errors.slice();
        cards = legacyToCards({ ...pr, excludeCombos: exclude }, names);
    }
    const rows = rowsOf(cards);
    const universe = [...new Set([...names, ...cards.order])].sort(cardCompare);
    const b = { rows, unassigned: [], exclude, U: cards.rowsPerDong, universe };
    return { mode, errors, board: fillUnassigned(b) };
}

/** 자동 정렬 결과(loc-cards autoSort) → 보드. 제외는 그대로, 나머지는 미지정. */
export function applyCards(board, cards) {
    const b = clone(board);
    const ex = new Set(b.exclude);
    b.rows = rowsOf(cards).map(r => r.filter(n => !ex.has(n)));
    b.U = cards.rowsPerDong;
    b.universe = [...new Set([...b.universe, ...cards.order])].sort(cardCompare);
    return fillUnassigned(b);
}

/** 카드가 어디 있나 → {at: 'row', i} | {at: 'none'} | {at: 'ex'} | null */
export function whereIs(board, name) {
    const i = board.rows.findIndex(r => r.includes(name));
    if (i >= 0) return { at: 'row', i };
    if (board.unassigned.includes(name)) return { at: 'none' };
    if (board.exclude.includes(name)) return { at: 'ex' };
    return null;
}

/** 제외 칸에 보일 카드(제외 조합 중 카드인 것) */
export const excludedCards = (board) => board.exclude.filter(n => board.universe.includes(n)).sort(cardCompare);

function takeOut(b, name) {
    b.rows = b.rows.map(r => r.filter(n => n !== name));
    b.unassigned = b.unassigned.filter(n => n !== name);
    b.exclude = b.exclude.filter(n => n !== name);
}

/**
 * 카드 옮기기. target = {row: i} | {row: i, insert: true}(그 자리에 새 줄을 끼워 넣음) | 'none' | 'ex'.
 * 미지정·제외 칸은 정렬 상태로 둔다.
 */
export function placeCard(board, name, target) {
    if (!whereIs(board, name)) return board;
    // 지금 있는 줄에 그대로 놓으면 바꾸지 않는다(빼고 다시 넣으면 줄 안 순서가 바뀌어 '바뀜'으로 잡힌다)
    if (target && Number.isInteger(target.row) && !target.insert && (board.rows[target.row] || []).includes(name)) return board;
    const b = clone(board);
    takeOut(b, name);
    if (target === 'none') { b.unassigned.push(name); b.unassigned.sort(cardCompare); }
    else if (target === 'ex') b.exclude.push(name);
    else if (target && Number.isInteger(target.row)) {
        const i = Math.max(0, Math.min(target.row, b.rows.length));
        if (target.insert || i === b.rows.length) b.rows.splice(i, 0, [name]);
        else b.rows[i].push(name);
    } else return board;
    return b;
}

/**
 * 고른 카드에 쓸 수 있는 버튼 → {up, down, exclude: 'add'|'remove'}.
 *   줄 카드: ↑ 윗줄(맨 윗줄이면 맨 위에 새 줄 — 혼자면 불가) · ↓ 아랫줄(맨 아랫줄이면 미지정).
 *   미지정: ↑ 맨 아랫줄(줄이 없으면 새 줄) · ↓ 불가. 제외 칸: ↑↓ 불가, [제외 풀기] → 미지정.
 */
export function cardMoves(board, name) {
    const w = whereIs(board, name);
    if (!w) return { up: false, down: false, exclude: null };
    if (w.at === 'ex') return { up: false, down: false, exclude: 'remove' };
    if (w.at === 'none') return { up: true, down: false, exclude: 'add' };
    return { up: w.i > 0 || board.rows[w.i].length > 1, down: true, exclude: 'add' };
}

/** 고른 카드를 한 칸 위·아래로(cardMoves 규칙). 못 가면 보드 그대로. */
export function moveCard(board, name, dir) {
    const w = whereIs(board, name);
    const m = cardMoves(board, name);
    if (!w || (dir === 'up' && !m.up) || (dir === 'down' && !m.down)) return board;
    if (w.at === 'none') {
        // 미지정 ↑ → 맨 아랫줄(빈 줄 포함), 줄이 없으면 새 줄
        return placeCard(board, name, { row: Math.max(0, board.rows.length - 1) });
    }
    if (dir === 'up') return w.i > 0 ? placeCard(board, name, { row: w.i - 1 }) : placeCard(board, name, { row: 0, insert: true });
    if (w.i >= board.rows.length - 1) return placeCard(board, name, 'none');
    return placeCard(board, name, { row: w.i + 1 });
}

/** [제외] / [제외 풀기] */
export function toggleExclude(board, name) {
    const w = whereIs(board, name);
    if (!w) return board;
    return placeCard(board, name, w.at === 'ex' ? 'none' : 'ex');
}

export function addRow(board) {
    const b = clone(board);
    b.rows.push([]);
    return b;
}

/** 줄 삭제 — 그 줄 카드는 미지정으로 */
export function deleteRow(board, i) {
    if (!board.rows[i]) return board;
    const b = clone(board);
    const [gone] = b.rows.splice(i, 1);
    b.unassigned.push(...gone);
    b.unassigned.sort(cardCompare);
    return b;
}

/** 줄 순서 바꾸기 dir 'up'|'down' */
export function moveRow(board, i, dir) {
    const j = dir === 'up' ? i - 1 : i + 1;
    if (!board.rows[i] || j < 0 || j >= board.rows.length) return board;
    const b = clone(board);
    [b.rows[i], b.rows[j]] = [b.rows[j], b.rows[i]];
    return b;
}

/** 고급 입력칸의 제외 목록 반영 — 새로 제외된 카드는 줄·미지정에서 빠지고, 제외에서 빠진 카드는 미지정으로 */
export function setExclude(board, list) {
    const b = clone(board);
    const next = parseExcludeText((list || []).join(','));
    b.exclude = next;
    const ex = new Set(next);
    b.rows = b.rows.map(r => r.filter(n => !ex.has(n)));
    return fillUnassigned(b);
}

export function setU(board, U) {
    const b = clone(board);
    b.U = U;
    return b;
}

/** 보드 → {order, level}(빈 줄 빼고) */
export function boardCards(board) {
    const order = [], level = [];
    board.rows.filter(r => r.length).forEach((r, i) => r.forEach(n => { order.push(n); level.push(i); }));
    return { order, level };
}

/** '바뀜' 서명 — 줄 순서·같은 줄·제외·U·위치 순서. 빈 줄·미지정 칸 정렬은 치지 않는다. */
export function boardSignature(board, poses) {
    const { order, level } = boardCards(board);
    return JSON.stringify({ order, level, ex: board.exclude.slice().sort(), U: board.U, poses: (poses || []).map(String) });
}

/** 줄 수 한도 — 줄 99 는 '순위 없음'(RANK_NONE)과 겹치므로 줄은 98 개(0~97)까지 */
export const MAX_ROWS = 98;

/**
 * 보드 → 저장할 recommendPriorities 칸 { poses, excludeCombos, cards: {v: 1, order, level, rowsPerDong} }.
 *   zones·dongs 는 넣지 않는다 — 저장(merge) 때 지금 값(카드 저장 전 옛 방식 값)이 그대로 남아 [옛 방식으로] 되돌리기의 값이 된다.
 *   (cardsToLegacy 사본은 ★ 를 따로 등급으로 떼고 카드에 없는 동을 빠뜨려 되돌리면 결과가 달라진다 — 2026-11-03 리뷰)
 * @returns {{ok: boolean, errors: string[], value?: object, unassigned: number}}
 *   unassigned = 미지정 칸 카드 수(저장은 막지 않는다 — 화면이 노란 안내)
 */
export function boardToSave(board, { poses } = {}) {
    const { order, level } = boardCards(board);
    const U = typeof board.U === 'string' ? Number(board.U) : board.U;
    const cards = { v: 1, order, level, rowsPerDong: U };
    const excludeCombos = board.exclude.slice();
    const unassigned = board.unassigned.length;
    if (!order.length) return { ok: false, errors: ['줄에 카드가 하나도 없습니다'], unassigned };
    const nRows = level[level.length - 1] + 1;
    if (nRows > MAX_ROWS) return { ok: false, errors: [`줄이 너무 많습니다(${nRows}줄 — ${MAX_ROWS}줄까지)`], unassigned };
    const pc = parseCards({ excludeCombos, cards });
    if (!pc.ok) return { ok: false, errors: pc.errors.slice(), unassigned };
    return { ok: true, errors: [], unassigned, value: { poses: (poses || []).map(String), excludeCombos, cards } };
}
