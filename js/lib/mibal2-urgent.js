// === js/lib/mibal2-urgent.js — 부족수량관리(신규) '긴급' 상품(2026-11-27 사용자 요청) ===
// 순수 함수만(시험 tests/mibal2-urgent.test.js). 화면 연결은 js/china-mibal2-urgent.js(표시·선택), 쓰기는 js/china-mibal2-live-urgent.js(live 만).
//   · 문서(계약 — 입고 스캐너도 같은 모양으로 읽는다): artifacts/team-work-logger-v2/mibal2/urgent
//       { v: 1, enabled: boolean, codes: { [상품코드]: { at: serverTimestamp, byEmail: 소문자 이메일 } }, enabledAt, enabledBy(이메일), updatedAt }
//     필요할 때만 켜서 쓰는 기능 — enabled 가 true 가 아니면 codes 가 남아 있어도 긴급 상품은 없다(화면은 긴급 기능이 없던 때와 같다).
//     켤 때 codes 는 빈 상태로, 끌 때 enabled false + codes 비움(한 번의 쓰기). 해제는 그 코드 칸 삭제(deleteField).
//   · 선택(체크칸)은 이 화면 메모리에만 — 필터로 안 보이는 행도 선택에 남는다(그 수를 따로 보인다).
//   · '선택 출고일 밖 입고' 행(r.outside)은 긴급 대상이 아니다 — 표시·선택·전체 선택·범위 어디에도 넣지 않는다(체크칸 자리는 빈 칸).

export const URGENT_DOC_PATH = 'artifacts/team-work-logger-v2/mibal2/urgent';
export const URGENT_LABEL = '긴급';          // 배지·플래그 필터 값(js/lib/mibal2-filter.js filterValueOf 'flags')
export const URGENT_WRITE_MAX = 400;         // 한 번에 지정·해제할 수 있는 상품 수(쓰기 한 번에 칸 수 — Firestore 한도보다 넉넉히 작게)
const CODE_MAX = 100;

const tsMs = (v) => (!v ? 0 : typeof v.toMillis === 'function' ? v.toMillis() : v instanceof Date ? v.getTime()
    : typeof v === 'number' ? v : (typeof v === 'object' && Number.isFinite(v.seconds)) ? v.seconds * 1000 : (new Date(v).getTime() || 0));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** 상품코드로 쓸 수 있는 글자인가(빈 글자·너무 긴 글자 제외) */
export const validCode = (c) => typeof c === 'string' && c.trim() !== '' && c === c.trim() && c.length <= CODE_MAX;

/**
 * 문서 데이터 → { enabled, codes: { 코드: { atMs, byEmail } }, count, enabledAtMs, enabledBy }.
 * 없음·모양이 다름·v 가 1 이 아님 = 꺼짐. 꺼져 있으면 codes 는 비운다.
 */
export function parseUrgent(data) {
    const off = { enabled: false, codes: {}, count: 0, enabledAtMs: 0, enabledBy: '' };
    if (!isObj(data) || data.v !== 1 || data.enabled !== true) return off;
    const codes = {};
    if (isObj(data.codes)) {
        Object.keys(data.codes).forEach(k => {
            const x = data.codes[k];
            if (!validCode(k) || !isObj(x)) return;
            codes[k] = { atMs: tsMs(x.at), byEmail: typeof x.byEmail === 'string' ? x.byEmail : '' };
        });
    }
    return { enabled: true, codes, count: Object.keys(codes).length, enabledAtMs: tsMs(data.enabledAt), enabledBy: typeof data.enabledBy === 'string' ? data.enabledBy : '' };
}

/** 이 상품이 긴급인가(꺼져 있으면 늘 false) */
export const isUrgent = (u, code) => !!(u && u.enabled && u.codes && Object.prototype.hasOwnProperty.call(u.codes, String(code)));

/** 긴급 대상 행인가 — 선택 출고일 밖 입고 행(r.outside)은 아니다 */
export const isTargetRow = (r) => !!r && !r.outside;

/** 긴급 대상 행의 코드(순서 유지) — 전체 선택·Shift 범위·선택 정리의 기준 */
export const targetCodes = (rows) => (rows || []).filter(isTargetRow).map(r => String(r.code));

/** 행마다 r.urgent(꺼져 있으면 모두 false · 출고일 밖 입고 행은 늘 false) */
export function attachUrgent(rows, u) {
    (rows || []).forEach(r => { if (r) r.urgent = isTargetRow(r) && isUrgent(u, r.code); });
    return rows;
}

/** '긴급만 보기' — 끈 상태면 모두 통과 */
export const urgentOnlyPass = (r, on) => !on || !!(r && r.urgent);

/** 겹치지 않게, 쓸 수 있는 코드만(순서 유지) */
export function uniqCodes(codes) {
    const out = [], seen = new Set();
    (codes || []).forEach(c => { c = String(c == null ? '' : c); if (validCode(c) && !seen.has(c)) { seen.add(c); out.push(c); } });
    return out;
}

/**
 * 지정(on = true)·해제(false) 때 실제로 바뀌는 코드 — 이미 긴급인 것은 지정에서, 긴급이 아닌 것은 해제에서 뺀다.
 * @returns {{ change: string[], same: number }} same = 이미 그 상태라 안 바뀌는 수
 */
export function urgentChanges(u, codes, on) {
    const all = uniqCodes(codes);
    const change = all.filter(c => (on ? !isUrgent(u, c) : isUrgent(u, c)));
    return { change, same: all.length - change.length };
}

/** 선택 수 — total 전체, hidden = 지금 표(보이는 행)에 없는 것 */
export function selectionSummary(selected, visibleCodes) {
    const vis = new Set((visibleCodes || []).map(String));
    const sel = [...(selected || [])].map(String);
    const hidden = sel.filter(c => !vis.has(c)).length;
    return { total: sel.length, visible: sel.length - hidden, hidden };
}

/** 선택 안내 글자 — 'N개 선택' · 'N개 선택(안 보이는 M개 포함)' · 없으면 '' */
export function selectionText(s) {
    if (!s || !s.total) return '';
    return s.hidden ? `${s.total}개 선택(안 보이는 ${s.hidden}개 포함)` : `${s.total}개 선택`;
}

/** 머리글 체크칸 상태 — 보이는 행 기준 'none' | 'some' | 'all'(보이는 행이 없으면 'none') */
export function headCheckState(selected, visibleCodes) {
    const vis = (visibleCodes || []).map(String);
    if (!vis.length) return 'none';
    const sel = new Set([...(selected || [])].map(String));
    const n = vis.filter(c => sel.has(c)).length;
    return n === 0 ? 'none' : n === vis.length ? 'all' : 'some';
}

/** 머리글 체크칸을 누름 — 보이는 행이 다 선택돼 있으면 보이는 행만 풀고, 아니면 보이는 행을 다 고른다(안 보이는 선택은 그대로) */
export function toggleAllVisible(selected, visibleCodes) {
    const next = new Set([...(selected || [])].map(String));
    const vis = uniqCodes(visibleCodes);
    if (headCheckState(next, vis) === 'all') vis.forEach(c => next.delete(c));
    else vis.forEach(c => next.add(c));
    return next;
}

/**
 * Shift+클릭 범위 — 보이는 순서(visibleCodes)에서 anchor 와 target 사이(양끝 포함).
 * anchor 가 지금 보이지 않으면 target 하나만.
 */
export function rangeCodes(visibleCodes, anchor, target) {
    const vis = (visibleCodes || []).map(String);
    const j = vis.indexOf(String(target));
    if (j < 0) return [];
    const i = anchor == null ? -1 : vis.indexOf(String(anchor));
    if (i < 0) return [vis[j]];
    return vis.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** 선택 정리 — 표(전체 행)에 없는 코드는 뺀다(출고일을 바꾸면 그 상품이 표에서 사라진다) */
export function pruneSelection(selected, allCodes) {
    const all = new Set((allCodes || []).map(String));
    return new Set([...(selected || [])].map(String).filter(c => all.has(c)));
}

/** 긴급 모드 끄기 확인 글 */
export const disableConfirmText = (count) => (count > 0
    ? `긴급 모드를 끕니다.\n지정한 긴급 상품 ${count}개도 모두 해제됩니다(스캐너의 긴급 표시도 사라집니다).`
    : '긴급 모드를 끕니다(지정한 긴급 상품 없음).');

/** 지정·해제 결과 안내 */
export function changeResultText(on, changed, same) {
    const verb = on ? '긴급 지정' : '긴급 해제';
    if (!changed) return on ? `이미 모두 긴급입니다${same ? `(${same}개)` : ''}` : '해제할 긴급 상품이 없습니다';
    return `${verb} ${changed}개${same ? ` · 이미 ${on ? '긴급' : '해제'} ${same}개` : ''}`;
}
