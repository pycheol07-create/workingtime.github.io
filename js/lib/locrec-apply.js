// === js/lib/locrec-apply.js ===
// 변경 추천 [처리함] → 데이터 리스트(Locations ZONE_* 문서) 상품 칸을 추천대로 옮기는 계획 · 되돌리기 계획 · 하루 표시(locRecMove)
// · 오늘 재고 올리기 전 충돌 찾기. 순수 모듈(DOM·Firebase 없음) — node --test 대상(tests/locrec-apply.test.js).
// 쓰기(트랜잭션)는 js/locrec-store.js, 표시는 js/location.js(데이터 리스트·도면) 가 한다. 설계 2026-10-29(architect, 사용자 결정 반영).
//
//   옮기는 칸   PRODUCT_FIELDS(code·name·option·stock·stock2f·rawDataStr) — 자리 칸(dong·pos·category·angleSize·reserved*·preAssigned*·codeTag*·assignedAt)은 안 건드림
//               옛 형식 rawData(맵)는 cleanRaw 를 거쳐 rawDataStr 로 바꾸고 양쪽 rawData 는 지운다(opts.del = deleteField()).
//   비운 자리   EMPTY_PRODUCT — 오늘 재고 올리기(location.js updateDatabaseA daily 초기화)와 같은 값
//   ezAt        서버(로케이션추천\재고기록.py)가 이지어드민 재고를 쓴 표시(ms) — 상품 칸과 함께 옮긴다. 출발 상품에 없으면 도착 칸에서 지우고,
//               비운 자리에서도 지운다(있을 때만 — 없으면 칸을 안 씀). 화면·rec_loc 이 비축 0 을 rawData 옛값으로 메우지 않게 하는 표시라
//               상품을 따라가야 한다(2026-11-05).
//   하루 표시   자리 맵 안 locRecMove {day:'YYYYMMDD'(KST), at:ms, role:'in'|'out', code, peer:상대 자리 id, recKey}
//               화면은 day === 오늘(KST) 일 때만 보인다(자정 DB 쓰기 없음). 맞바꾸기는 두 자리 모두 in.
//   marks 기록  locRecWork/marks.marks[recKey].applied = {v:1, at:ms, day, moves:[{code,src,dst}], skipped:[{code,src,dst}]} — 코드·자리 id 만
//               대신 자리로 처리하면 alt = {to}. 도착 자리가 막혀 못 하면 {state:'blocked', by, at, block:{loc, reason}}(2026-11-12)
// ⚠️ 돌려주는 실패 정보·문구에는 상품코드·자리 id 만 — 상품명·rawDataStr·공급처 값을 넣지 않는다(로그·alert 로 나간다).
// import 는 같은 lib 의 sensitive-cols.js(cleanRaw)·multi-loc.js(normLocId)·refill-view.js(dayKey·fmtHM·keyMs, KST)·loc-recommend.js(isEtcLocObj·kstMidnight) 만.

import { cleanRaw } from './sensitive-cols.js?v=202611131354';
import { normLocId } from './multi-loc.js?v=202611131354';
import { dayKey, fmtHM, tsMs, keyMs } from './refill-view.js?v=202611131354';
import { isEtcLocObj, kstMidnight } from './loc-recommend.js?v=202611131354';

export const PRODUCT_FIELDS = ['code', 'name', 'option', 'stock', 'stock2f', 'rawDataStr'];
export const EMPTY_PRODUCT = Object.freeze({ code: '', name: '', option: '', stock: '0', stock2f: '0', rawDataStr: '{}' });
/** 칸 지우기 표시 — 쓰는 쪽(store)이 opts.del 로 deleteField() 를 주지 않으면 이 값이 들어간다(시험용) */
export const DEL = Symbol.for('locrec.delete');
export const APPLIED_V = 1;
export const LIST_MAX = 10;     // 요약·경고 문구에 보여 줄 줄 수

const str = (v) => (v == null ? '' : String(v));

/** 자리 id → ZONE 문서 id (location.js getZoneDocId 와 같은 식 — 앞 6글자) */
export function zoneDocIdOf(locId) {
    if (!locId) return 'ZONE_ETC';
    const clean = locId.toString().trim().toUpperCase();
    const prefix = clean.length >= 6 ? clean.substring(0, 6) : clean;
    return 'ZONE_' + prefix;
}

const isSlot = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** 자리에 든 상품코드(빈 자리면 '') — code===id 는 빈 자리(location.js hasContent 와 같은 기준) */
export function codeAt(slot, id) {
    if (!isSlot(slot)) return '';
    const c = str(slot.code).trim();
    if (!c || c === str(id).trim()) return '';
    return c;
}
/** 빈 자리 — 코드 없음(또는 code===id) · 상품명 없음 */
export function isEmptySlot(slot, id) {
    return !codeAt(slot, id) && !str(slot && slot.name).trim();
}
/** 기타·비축 자리(피킹용 아님) — loc-recommend isEtcLocObj + location.js isEtcLocation 의 '비축…' id */
export function isEtcSlot(slot, id) {
    return isEtcLocObj({ ...(slot || {}), id }) || /^비축/.test(str(id).trim());
}
/** 오늘(KST) 유효한 코드태그(당일지정·선지정) — codeTagAt 이 오늘 0시 전이면 빈 것(normalizeLocs 와 같은 기준), 시각이 없으면 유효로 본다 */
export function tagToday(slot, nowMs) {
    if (!slot || !str(slot.codeTag).trim()) return false;
    const at = Number(slot.codeTagAt) || 0;
    return !(at && at < kstMidnight(nowMs));
}

/** 지정된 빈 자리 — 상품은 아직 없지만 선지정·당일지정(오늘 유효한 codeTag — 당일지정은 예약과 함께 codeTag 를 남긴다)·선지정 표시(preAssigned)가 걸렸거나,
 *  오늘 변경 추천 [처리함]으로 상품이 들어오기로 한 자리(locRecMove role 'in'). 데이터 리스트 '빈칸' 엑셀에서 뺀다(2026-11-03 사용자 요청 —
 *  빈칸으로 내보내면 다른 상품을 또 넣는다). 상품이 있는 자리는 false(빈칸이 아니므로 이 판정과 무관). */
export function isDesignatedEmpty(slot, id, nowMs, todayKey) {
    if (!isEmptySlot(slot, id)) return false;
    if (tagToday(slot, nowMs)) return true;
    if (slot.preAssigned === true) return true;     // reserved 만 남은 칸은 하루 지나도 남을 수 있어 보지 않는다(당일지정은 codeTag 로)
    const m = slot.locRecMove;
    return !!(m && typeof m === 'object' && m.role === 'in' && todayKey && str(m.day) === str(todayKey));
}

/** 추천 행 → 이동 목록 [{code, src, dst}] — 모양이 틀리면 null.
 *  single·back(뒤로 보내기 — 빈 자리로 옮기는 것은 단독과 같다) [{code, from→to}] · swap [{code, from→from2},{code2, from2→from}] ·
 *  pair [{code, from→to},{code2, from2→to2}] */
export function movesOf(row) {
    if (!row || typeof row !== 'object') return null;
    const m = (c, s, d) => ({ code: str(c).trim(), src: str(s).trim(), dst: str(d).trim() });
    const type = row.type || 'single';
    let list;
    if (type === 'swap') {
        if (!row.code2) return null;
        list = [m(row.code, row.from, row.from2), m(row.code2, row.from2, row.from)];
        // 행 to=from2, to2=from (loc-recommend.js swap 행) — 어긋나면 모양이 틀린 것
        if ((row.to && str(row.to).trim() !== list[0].dst) || (row.to2 && str(row.to2).trim() !== list[1].dst)) return null;
    } else if (type === 'pair') {
        if (!row.code2) return null;
        list = [m(row.code, row.from, row.to), m(row.code2, row.from2, row.to2)];
    } else if (type === 'single' || type === 'back') {
        list = [m(row.code, row.from, row.to)];
    } else return null;
    if (list.some(x => !x.code || !x.src || !x.dst || x.src === x.dst)) return null;
    if (type === 'pair') {
        const ids = [list[0].src, list[0].dst, list[1].src, list[1].dst].map(normLocId);
        if (new Set(ids).size !== 4) return null;     // 같은 자리를 두 번 쓰는 페어는 받지 않는다
    }
    return list;
}

/** 읽어야 할 ZONE 문서 id 목록(정확 키 문서 + normLocId 대체 문서) */
export function docIdsFor(ids) {
    const out = new Set();
    (ids || []).forEach(id => { if (!id) return; out.add(zoneDocIdOf(id)); out.add(zoneDocIdOf(normLocId(id))); });
    return [...out];
}
export function docIdsForRow(row) {
    const mv = movesOf(row) || [];
    return docIdsFor(mv.flatMap(x => [x.src, x.dst]));
}
export function docIdsForApplied(applied) {
    const mv = (applied && Array.isArray(applied.moves)) ? applied.moves : [];
    return docIdsFor(mv.flatMap(x => [x && x.src, x && x.dst]));
}

/** 자리 찾기 — ZONE 문서 정확 키 → 없으면 normLocId 로 읽은 문서 전체에서. 2개 이상 맞으면 ambiguous.
 *  @param {Object<string, object|null>} docs  {docId: 문서 데이터}
 *  @returns {{ok:true, docId, id, slot} | {ok:false, reason:'noSlot'|'ambiguous', loc}} */
export function resolveSlot(docs, id) {
    const did = zoneDocIdOf(id);
    const d = docs && docs[did];
    if (d && isSlot(d[id])) return { ok: true, docId: did, id, slot: d[id] };
    const n = normLocId(id);
    const hits = [];
    Object.entries(docs || {}).forEach(([docId, data]) => {
        if (!isSlot(data)) return;
        Object.keys(data).forEach(k => { if (isSlot(data[k]) && normLocId(k) === n) hits.push({ ok: true, docId, id: k, slot: data[k] }); });
    });
    if (hits.length === 1) return hits[0];
    return { ok: false, reason: hits.length ? 'ambiguous' : 'noSlot', loc: str(id) };
}

/** 상품 칸 사본(옛 rawData 맵은 cleanRaw 후 문자열로) */
export function productOf(slot) {
    const s = slot || {};
    const v = (x, dflt) => (x == null ? dflt : String(x));
    let raw;
    if (typeof s.rawDataStr === 'string' && s.rawDataStr) raw = s.rawDataStr;
    else if (isSlot(s.rawData)) raw = JSON.stringify(cleanRaw(s.rawData).out);
    else raw = '{}';
    return { code: v(s.code, ''), name: v(s.name, ''), option: v(s.option, ''), stock: v(s.stock, '0'), stock2f: v(s.stock2f, '0'), rawDataStr: raw };
}

const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });

/**
 * 이동 목록을 지금 자리 값에 적용한 쓰기 → {docId: {locId: patch}}.
 *   처음 값 스냅샷에서 한꺼번에 계산(맞바꾸기는 자연히 서로 바뀜). 출발은 비우고(다른 이동의 도착이면 그 상품), 도착은 출발 상품.
 *   markOf(id, role, peer) → locRecMove 값(없으면 칸을 안 씀), DEL 이면 지움.
 */
function buildWrites(resolved, nowMs, del, markOf) {
    const writes = {};
    const put = (r, patch) => { (writes[r.docId] = writes[r.docId] || {})[r.id] = patch; };
    const dstIds = new Set(resolved.map(x => x.dst.id));
    const base = (r) => {
        const p = {};
        if (r.slot && r.slot.rawData !== undefined) p.rawData = del;        // 옛 rawData 맵 칸은 지운다
        p.updatedAt = new Date(nowMs);
        return p;
    };
    const hasEz = (s) => !!s && s.ezAt != null;
    resolved.forEach(x => {
        if (dstIds.has(x.src.id)) return;                                     // 맞바꾸기 — 아래에서 도착으로 채운다
        const mk = markOf(x.src.id, 'out', x.dst.id);
        put(x.src, { ...base(x.src), ...EMPTY_PRODUCT, ...(hasEz(x.src.slot) ? { ezAt: del } : {}),
                     ...(mk === undefined ? {} : { locRecMove: mk }) });
    });
    resolved.forEach(x => {
        const mk = markOf(x.dst.id, 'in', x.src.id);
        const ez = hasEz(x.src.slot) ? { ezAt: x.src.slot.ezAt } : (hasEz(x.dst.slot) ? { ezAt: del } : {});
        put(x.dst, { ...base(x.dst), ...productOf(x.src.slot), ...ez, ...(mk === undefined ? {} : { locRecMove: mk }) });
    });
    return writes;
}

/**
 * [처리함] 계획 — 트랜잭션 안에서 읽은 ZONE 문서(docs)로 판정.
 * @param {object} row       추천 행(type, recKey, code, from, to, code2?, from2?, to2?)
 * @param {Object} docs      {docId: 문서 데이터|null} — docIdsForRow(row) 를 읽은 것
 * @param {number} nowMs
 * @param {{del?: any}} [opts]
 * @returns {{ok:false, reason, loc?, code?, other?} |
 *           {ok:true, writes, applied|null, moves, skipped, allSkipped:boolean}}
 */
export function planApply(row, docs, nowMs, opts = {}) {
    const del = 'del' in opts ? opts.del : DEL;
    const mv = movesOf(row);
    if (!mv) return fail('badRow');
    const isSwap = row.type === 'swap';
    const rs = [];
    for (const m of mv) {
        const src = resolveSlot(docs, m.src);
        if (!src.ok) return fail(src.reason, { loc: m.src, code: m.code });
        const dst = resolveSlot(docs, m.dst);
        if (!dst.ok) return fail(dst.reason, { loc: m.dst, code: m.code });
        rs.push({ code: m.code, src, dst });
    }
    // 이미 반영(도착에 그 코드) — 쓰지 않는다. 맞바꾸기는 둘 다이거나 아니거나
    const done = rs.map(x => codeAt(x.dst.slot, x.dst.id) === x.code);
    if (isSwap && done[0] !== done[1]) return fail('swapPartial', { loc: rs[0].src.id, code: rs[0].code });
    const todo = rs.filter((x, i) => !done[i]);
    const skipped = rs.filter((x, i) => done[i]).map(x => ({ code: x.code, src: x.src.id, dst: x.dst.id }));
    for (const x of todo) {
        const s = x.src.slot, sId = x.src.id;
        if (codeAt(s, sId) !== x.code) return fail('srcMissing', { loc: sId, code: x.code, other: codeAt(s, sId) });
        if (isEtcSlot(s, sId)) return fail('srcEtc', { loc: sId, code: x.code });
        if (s.preAssigned) return fail('srcPre', { loc: sId, code: x.code });
        const d = x.dst.slot, dId = x.dst.id;
        // 오늘 변경 추천으로 다른 상품을 넣은 자리 — 옛 판으로 처리한 뒤 새 판의 같은 자리 추천(표시만 하면 안 됨)
        const lm = d && d.locRecMove;
        if (!isSwap && lm && typeof lm === 'object' && lm.role === 'in' && str(lm.day) === dayKey(nowMs)
            && codeAt(d, dId) && str(lm.code) === codeAt(d, dId)) {
            return fail('dstMovedToday', { loc: dId, code: x.code, other: codeAt(d, dId) });
        }
        if (!isSwap && !isEmptySlot(d, dId)) return fail('dstUsed', { loc: dId, code: x.code, other: codeAt(d, dId) });
        if (d.preAssigned) return fail('dstPre', { loc: dId, code: x.code });
        if (d.reserved) return fail('dstReserved', { loc: dId, code: x.code });
        if (tagToday(d, nowMs)) return fail('dstTag', { loc: dId, code: x.code });
        if (isEtcSlot(d, dId)) return fail('dstEtc', { loc: dId, code: x.code });
    }
    if (!todo.length) return { ok: true, writes: {}, applied: null, moves: [], skipped, allSkipped: true };
    const day = dayKey(nowMs);
    const recKey = str(row.recKey);
    const codeOfMove = new Map(todo.map(x => [x.dst.id, x.code]));
    const srcCode = new Map(todo.map(x => [x.src.id, x.code]));
    const writes = buildWrites(todo, nowMs, del, (id, role, peer) => ({
        day, at: nowMs, role, code: role === 'in' ? codeOfMove.get(id) : srcCode.get(id), peer, recKey
    }));
    const moves = todo.map(x => ({ code: x.code, src: x.src.id, dst: x.dst.id }));
    return { ok: true, writes, moves, skipped, allSkipped: false,
             applied: { v: APPLIED_V, at: nowMs, day, moves, skipped } };
}

/**
 * [되돌리기] 계획 — 반영한 그날(KST) + 지금이 '옮긴 뒤' 모양일 때만 자리까지 원복.
 *   모양: 도착마다 그 코드 · 비운 자리(다른 이동의 도착이 아닌 출발)는 비어 있고 선지정·예약·오늘 태그 없음.
 *   locRecMove 는 이 추천(recKey)이 쓴 것만 지운다.
 *   opts.lastDataMs(INFO_CONFIG.lastDataUpdate)가 applied.at 보다 늦으면 'uploaded' — 반영 뒤 오늘 재고를 올렸다(엑셀이 이동을 인정했을 수 있다).
 *   업로드는 값이 같은 자리를 건너뛰어 자리 updatedAt 으로는 못 잡는다.
 * @returns {{ok:false, reason:'noApplied'|'otherDay'|'uploaded'|'changed'|'noSlot'|'ambiguous', loc?, code?} | {ok:true, writes, nothing?:true}}
 */
export function planUndo(applied, docs, nowMs, opts = {}) {
    const del = 'del' in opts ? opts.del : DEL;
    const recKey = 'recKey' in opts ? str(opts.recKey) : null;
    if (!applied || typeof applied !== 'object' || !Array.isArray(applied.moves)) return fail('noApplied');
    if (str(applied.day) !== dayKey(nowMs)) return fail('otherDay');
    const upMs = tsMs(opts.lastDataMs);
    if (upMs && upMs > (Number(applied.at) || 0)) return fail('uploaded');
    const mv = applied.moves.filter(m => m && m.code && m.src && m.dst);
    if (!mv.length) return { ok: true, writes: {}, nothing: true };
    const rs = [];
    for (const m of mv) {
        const src = resolveSlot(docs, str(m.src));
        if (!src.ok) return fail(src.reason, { loc: str(m.src), code: str(m.code) });
        const dst = resolveSlot(docs, str(m.dst));
        if (!dst.ok) return fail(dst.reason, { loc: str(m.dst), code: str(m.code) });
        rs.push({ code: str(m.code), src, dst });
    }
    const dstIds = new Set(rs.map(x => x.dst.id));
    for (const x of rs) {
        if (codeAt(x.dst.slot, x.dst.id) !== x.code) return fail('changed', { loc: x.dst.id, code: x.code });
        if (!dstIds.has(x.src.id)) {
            const s = x.src.slot;
            if (!isEmptySlot(s, x.src.id) || s.preAssigned || s.reserved || tagToday(s, nowMs)) return fail('changed', { loc: x.src.id, code: x.code });
        }
    }
    // 거꾸로 — 지금 도착에 있는 상품 칸을 출발로
    const back = rs.map(x => ({ code: x.code, src: x.dst, dst: x.src }));
    const mine = (id) => {
        const r = rs.find(x => x.src.id === id) || rs.find(x => x.dst.id === id);
        const slot = r ? (r.src.id === id ? r.src.slot : r.dst.slot) : null;
        const lm = slot && slot.locRecMove;
        if (!lm) return undefined;
        return recKey === null || str(lm.recKey) === recKey ? del : undefined;
    };
    const writes = buildWrites(back, nowMs, del, (id) => mine(id));
    return { ok: true, writes };
}

/**
 * 되돌리기 못 해 '표시만 지우기' — 그 추천(recKey)이 쓴 locRecMove 만 지우는 쓰기. 상품 칸은 안 건드린다.
 *   찾는 자리 = applied.moves 의 출발·도착(못 찾는 자리는 건너뜀).
 * @returns {{docId: {locId: {locRecMove: del}}}}
 */
export function planClearMoves(applied, docs, recKey, opts = {}) {
    const del = 'del' in opts ? opts.del : DEL;
    const writes = {};
    const mv = (applied && Array.isArray(applied.moves)) ? applied.moves : [];
    const ids = new Set(mv.flatMap(m => [m && m.src, m && m.dst]).filter(Boolean).map(str));
    ids.forEach(id => {
        const r = resolveSlot(docs, id);
        if (!r.ok) return;
        const lm = r.slot.locRecMove;
        if (!lm || typeof lm !== 'object' || str(lm.recKey) !== str(recKey)) return;
        (writes[r.docId] = writes[r.docId] || {})[r.id] = { locRecMove: del };
    });
    return writes;
}

/** [되돌리기] 확인 문구 — 'S1 B→A' (거꾸로 옮기는 방향, 코드·자리 id 만) */
export function undoConfirmText(applied) {
    const mv = (applied && Array.isArray(applied.moves)) ? applied.moves : [];
    const what = mv.map(m => `${str(m.code)} ${str(m.dst)}→${str(m.src)}`).join(', ');
    return `'처리함' 표시를 지우고 데이터 리스트 자리도 되돌립니다.${what ? `\n${what}` : ''}\n\n계속할까요?`;
}

const REASON = {
    badRow: () => '추천 모양이 맞지 않음',
    noSlot: (f) => `자리 ${f.loc} 를 데이터 리스트에서 찾지 못함`,
    ambiguous: (f) => `자리 ${f.loc} 가 데이터 리스트에 여러 개`,
    srcMissing: (f) => `${f.loc} 에 ${f.code} 가 없음${f.other ? `(지금 ${f.other})` : ''}`,
    srcEtc: (f) => `현재 자리 ${f.loc} 가 기타·비축 자리`,
    srcPre: (f) => `현재 자리 ${f.loc} 가 선지정`,
    dstUsed: (f) => `옮길 자리 ${f.loc} 가 사용 중${f.other ? `(${f.other})` : ''}`,
    dstMovedToday: (f) => `옮길 자리 ${f.loc} 는 오늘 변경 추천으로 ${f.other} 를 넣은 자리 — [지금 재고로 다시 만들기] 뒤 다시 보세요`,
    dstPre: (f) => `옮길 자리 ${f.loc} 가 선지정`,
    dstReserved: (f) => `옮길 자리 ${f.loc} 가 예약 중`,
    dstTag: (f) => `옮길 자리 ${f.loc} 에 오늘 지정 표시`,
    dstEtc: (f) => `옮길 자리 ${f.loc} 가 기타·비축 자리`,
    swapPartial: () => '맞바꾸기 한쪽만 바뀌어 있음',
    noApplied: () => '반영 기록 없음',
    otherDay: () => '반영한 날이 지남',
    uploaded: () => '반영 뒤 오늘 재고가 올라옴',
    changed: (f) => `${f.loc} 가 그 뒤에 바뀜`
};
/** 실패 → 짧은 이유(상품코드·자리 id 만) */
export function reasonText(f) {
    const fn = f && REASON[f.reason];
    return fn ? fn(f) : '알 수 없는 이유';
}

/** 반영 못 한 건을 '처리함 표시만' 해도 되는가 — 오늘 변경 추천으로 다른 상품을 넣은 자리(dstMovedToday)는 표시만 하면
 *  그 추천이 처리된 것처럼 보여 묻지 않는다(다시 만든 뒤 다시 보게) */
export function markOnlyOk(f) {
    return !!f && f.reason !== 'dstMovedToday';
}

// ── 도착 자리 막힘 · 대신 자리 (2026-11-12) ──────────────────────────────────
//   [처리함]이 도착 자리 문제로 실패하면 화면(js/locrec-store.js)이 지금 자리로 대신 자리(loc-recommend.js pickAltTarget, 단독만)를 묻고,
//   없거나 거절하면 marks[recKey] = {state:'blocked', by, at, block:{loc, reason}} — 그 추천은 그날 숨기고(locrec-view.js rowState),
//   서버는 그날 판에서 그 자리를 빈 자리 후보에서 뺀다(로케이션추천\판정.block_slots). 대신 자리로 처리하면 marks 에 alt:{to}.
/** 도착 자리 문제(대신 자리·막힘 대상) — 사용 중·오늘 다른 상품·선지정·예약·당일지정 */
export const DST_BLOCK_REASONS = Object.freeze(['dstUsed', 'dstMovedToday', 'dstPre', 'dstReserved', 'dstTag']);
export const BLOCKED_STATE = 'blocked';
/** [처리함] 성공 뒤 한 줄 안내 */
export const EZ_REMIND_TEXT = '이지어드민 로케이션도 바꿔야 다음 엑셀에서 안 돌아갑니다';

/** 도착 자리 문제로 실패했나 */
export function dstBlocked(f) {
    return !!f && DST_BLOCK_REASONS.includes(f.reason);
}
/** 대신 자리를 찾아볼 수 있나 — 도착 자리 문제 + 단독(페어·맞바꾸기·뒤로 보내기는 막힘만) */
export function altOk(f, row) {
    return dstBlocked(f) && !!row && (row.type || 'single') === 'single';
}
/** 대신 자리로 바꾼 행 — to(·toDong·toPos·toSize)만 바꾼다. recKey 는 그대로(같은 표시 칸에 쓴다) */
export function altRow(row, alt) {
    const out = { ...row, to: str(alt && alt.to) };
    if (alt && alt.toDong != null) out.toDong = str(alt.toDong);
    if (alt && alt.toPos != null) out.toPos = str(alt.toPos);
    if (alt && str(alt.toSize)) out.toSize = str(alt.toSize); else delete out.toSize;
    return out;
}
/** 막힘 표시에 남길 block 칸 — 자리 id·이유 코드만(상품명 없음). 막힌 자리는 실패한 도착(f.loc), 없으면 행의 to */
export function blockOf(f, row) {
    return { loc: str((f && f.loc) || (row && row.to)).trim(), reason: str(f && f.reason) };
}
const sizeTxt = (s) => (str(s).trim() ? `(${str(s).trim()})` : '');
/** 대신 자리 확인 문구 */
export function altConfirmText(f, row, alt) {
    return `${reasonText(f)}.\n\n대신 ${str(alt.to)}${sizeTxt(alt.toSize)} 로 처리할까요?\n${str(row && row.code)} ${str(row && row.from)}→${str(alt.to)}`
        + ` · 데이터 리스트도 이 자리로 바뀝니다(오늘 안에는 [되돌리기]로 되돌릴 수 있습니다)`;
}
/** 대신 자리 상태별 한 줄 — declined(있었지만 거절)는 없음 · none(계산했지만 없음) · noCtx(이 화면은 자리 목록이 없어 계산 못 함 — 대시보드) ·
 *  notSingle(페어·맞바꾸기·뒤로 보내기는 대신 자리를 찾지 않음). 옛 호출(true/false)은 declined/none */
export const ALT_STATE_TEXT = Object.freeze({
    declined: '',
    none: '대신 쓸 빈 자리도 없습니다.',
    noCtx: '대신 자리는 로케이션관리 화면에서 찾을 수 있습니다(이 화면은 자리 목록이 없어 계산하지 못합니다).',
    notSingle: '대신 자리는 단독 추천만 찾습니다.'
});
const altStateLine = (s) => {
    const k = s === true ? 'declined' : s === false || s == null ? 'none' : String(s);
    return ALT_STATE_TEXT[k] == null ? ALT_STATE_TEXT.none : ALT_STATE_TEXT[k];
};
/** 막힘 확인 문구 — 대신 자리가 없거나 거절했을 때. altState: declined | none | noCtx | notSingle */
export function blockConfirmText(f, altState) {
    const line = altStateLine(altState);
    return `${reasonText(f)}.\n${line ? `${line}\n` : ''}\n이 추천을 '자리 막힘'으로 오늘 숨길까요?\n`
        + `데이터 리스트는 바꾸지 않고, 이 자리는 오늘 다시 만드는 추천에서 뺍니다.`;
}

/** 한 줄 실패 확인 문구 — '표시만'은 이미 손으로 옮긴 경우에만(막힘과 헷갈리지 않게) */
export function applyFailText(f) {
    return `데이터 리스트에 반영하지 못했습니다(${reasonText(f)}).\n\n이미 손으로 옮겨 두었다면 데이터 리스트는 그대로 두고 '처리함' 표시만 남길까요?\n(아니면 [취소])`;
}
/** [전체 처리함] 대신 자리 확인 — list [{code, from, to(대신)}] */
export function bulkAltText(list, max = LIST_MAX) {
    const l = list || [];
    const lines = l.slice(0, max).map(x => `· ${str(x.code)} ${str(x.from)}→${str(x.to)}`);
    if (l.length > max) lines.push(`… 외 ${l.length - max}건`);
    return `옮길 자리를 쓸 수 없는 ${l.length}건은 대신 쓸 빈 자리가 있습니다.\n${lines.join('\n')}\n\n이 자리로 처리할까요?`;
}
/** [전체 처리함] 막힘 확인 — fails [{code, reason, loc}]. altState 'noCtx' 면 대시보드 안내 한 줄을 붙인다 */
export function bulkBlockText(fails, max = LIST_MAX, altState = '') {
    const l = fails || [];
    const lines = l.slice(0, max).map(f => `· ${str(f.code)} — ${reasonText(f)}`);
    if (l.length > max) lines.push(`… 외 ${l.length - max}건`);
    const note = altState === 'noCtx' ? `\n${ALT_STATE_TEXT.noCtx}` : '';
    return `옮길 자리를 쓸 수 없는 ${l.length}건:\n${lines.join('\n')}${note}\n\n'자리 막힘'으로 오늘 숨길까요? (데이터 리스트는 바꾸지 않습니다)`;
}
/** 되돌리기 실패 확인 문구 */
export function undoFailText(f) {
    if (f && f.reason === 'otherDay') return '반영한 날이 지나 데이터 리스트 자리는 되돌리지 않습니다.\n처리함 표시만 지울까요?';
    return `데이터 리스트가 이미 바뀌어 자리는 되돌리지 않습니다(${reasonText(f)}).\n처리함 표시만 지울까요?`;
}
/** [전체 처리함] 끝 요약 — okN = 실제로 자리를 옮긴 건, doneN = 이미 처리됨(다른 사람이 표시·이미 그 자리), fails: [{code, reason…}]
 *  markN = 그중 '처리함 표시만' 할 수 있는 건(markOnlyOk) — 생략하면 fails 에서 센다. 0 이면 묻지 않고 요약만 */
export function bulkSummaryText(okN, fails, max = LIST_MAX, doneN = 0, markN) {
    const list = fails || [];
    const mN = markN == null ? list.filter(markOnlyOk).length : markN;
    const head = `${okN}건 데이터 리스트에 반영${doneN ? `, 이미 처리됨 ${doneN}건` : ''}, ${list.length}건 못 함.`;
    if (!list.length) return head;
    const lines = list.slice(0, max).map(f => `· ${f.code || ''} — ${reasonText(f)}`);
    if (list.length > max) lines.push(`… 외 ${list.length - max}건`);
    if (!mN) return `${head}\n${lines.join('\n')}`;
    return `${head}\n${lines.join('\n')}\n\n이미 손으로 옮겨 둔 것이라면 못 한 ${mN}건도 '처리함' 표시만 남길까요?\n(데이터 리스트는 그대로 · 아니면 [취소])`;
}

/** 하루 표시 — 데이터 리스트 배지·도면 표시용. null | {kind:'in'|'out'|'mismatch', text, title} */
export function moveBadge(loc, todayKey) {
    const m = loc && loc.locRecMove;
    if (!m || typeof m !== 'object' || str(m.day) !== str(todayKey) || !todayKey) return null;
    const hm = fmtHM(Number(m.at) || 0);
    const peer = str(m.peer), code = str(m.code);
    const here = codeAt(loc, loc.id);
    if (m.role === 'in') {
        if (here !== code) return { kind: 'mismatch', text: '추천변경·엑셀 다름', title: `${hm} 변경 추천으로 ${peer}에서 ${code} 를 옮겼지만 지금 자료(엑셀)는 다릅니다` };
        return { kind: 'in', text: '추천변경', title: `${hm} 변경 추천으로 ${peer}에서 옮김` };
    }
    if (m.role === 'out') {
        if (code && here === code) return { kind: 'mismatch', text: '추천변경·엑셀 다름', title: `${hm} 변경 추천으로 ${code} 를 ${peer}(으)로 옮겼지만 지금 자료(엑셀)에는 아직 이 자리입니다` };
        return { kind: 'out', text: `→${peer}`, title: `${hm} 변경 추천으로 ${code} 를 ${peer}(으)로 옮김` };
    }
    return null;
}

/** 엑셀 한 줄 → {loc, code} (location.js updateDatabaseA 와 같은 규칙: '자리(…S코드)' 괄호 · 2F- 줄은 저장 안 함) */
function excelLocCode(row) {
    const raw = str(row && row['로케이션']).trim();
    if (!raw || raw.toUpperCase().startsWith('2F-')) return null;
    let loc = raw, code = '';
    if (raw.includes('(')) {
        loc = raw.split('(')[0].trim();
        const af = raw.substring(raw.indexOf('('));
        const si = af.indexOf('S');
        if (si !== -1) code = af.substring(si).trim();
    }
    if (!code) code = str(row['상품코드']).trim();
    return loc ? { loc, code } : null;
}

export const RECENT_MOVE_DAYS = 7;     // 엑셀 경고에서 보는 [처리함] 반영 기간(오늘 포함)

/**
 * 최근 [처리함] 반영 이동 — marks 의 applied(state done)에서 applied.day 가 오늘부터 days 일 안(오늘 포함)인 것.
 *   → [{recKey, code, src, dst, day, at}] (at 오름차순). 코드·자리 id 만.
 */
export function recentAppliedMoves(marks, todayKey, days = RECENT_MOVE_DAYS) {
    const out = [];
    if (!/^\d{8}$/.test(str(todayKey))) return out;
    const lo = dayKey(keyMs(str(todayKey)) - (Math.max(1, days) - 1) * 24 * 3600 * 1000);
    Object.entries(marks || {}).forEach(([recKey, m]) => {
        const a = m && m.state === 'done' && m.applied && typeof m.applied === 'object' ? m.applied : null;
        if (!a || !Array.isArray(a.moves)) return;
        const day = str(a.day);
        if (!/^\d{8}$/.test(day) || day < lo || day > str(todayKey)) return;
        a.moves.forEach(x => {
            const code = str(x && x.code).trim(), src = str(x && x.src).trim(), dst = str(x && x.dst).trim();
            if (code && src && dst) out.push({ recKey, code, src, dst, day, at: Number(a.at) || 0 });
        });
    });
    return out.sort((a, b) => a.at - b.at);
}

/**
 * 오늘 재고 올리기 전 충돌 — 오늘 locRecMove 가 있는 자리와 엑셀을 비교.
 *   in 자리에 엑셀 코드가 locRecMove.code 와 다름 · out 자리에 엑셀이 그 코드를 아직 둠 → 충돌(recKey 단위로 한 줄).
 *   recentMoves(recentAppliedMoves — 최근 7일 [처리함] 반영, 2026-11-12): 코드마다 가장 늦은 이동이 지금 자리 목록에도 그대로인데(dst 에 그 코드)
 *   엑셀은 dst 에 그 코드가 없고 그 코드의 옛 출발 자리(최근 이동들의 src)에 두면 충돌 — 이지어드민 로케이션을 아직 안 바꾼 것.
 *   오늘 locRecMove 로 이미 잡은 코드는 다시 세지 않는다. 업로드를 막지는 않는다(확인창만).
 * @param {object[]} rows   엑셀 행
 * @param {object[]} locs   지금 자리 목록(originalData — id, code, locRecMove)
 * @param {string} todayKey
 * @param {{recKey, code, src, dst, at}[]} [recentMoves]
 * @returns {{recKey, code, from, to}[]}
 */
export function uploadMoveConflicts(rows, locs, todayKey, recentMoves = []) {
    const excel = new Map();             // 자리 id(정확) → 코드 — 같은 자리는 마지막 줄(업로드와 같음)
    (rows || []).forEach(r => { const x = excelLocCode(r); if (x) excel.set(x.loc, x.code); });
    const out = [], seen = new Set();
    (locs || []).forEach(l => {
        const m = l && l.locRecMove;
        if (!m || typeof m !== 'object' || str(m.day) !== str(todayKey) || !todayKey) return;
        const id = str(l.id), code = str(m.code), peer = str(m.peer);
        const ex = excel.get(id) || '';
        let hit = null;
        if (m.role === 'in' && ex !== code) hit = { from: peer, to: id };
        else if (m.role === 'out' && code && ex === code) hit = { from: id, to: peer };
        if (!hit) return;
        const k = `${str(m.recKey)}|${code}`;
        if (seen.has(k)) return;
        seen.add(k);
        out.push({ recKey: str(m.recKey), code, ...hit });
    });
    const recent = Array.isArray(recentMoves) ? recentMoves : [];
    if (!recent.length) return out;
    const doneCodes = new Set(out.map(x => x.code));
    const excelAt = new Map();           // 코드 → 엑셀에 있는 자리들
    excel.forEach((c, loc) => { if (!c) return; if (!excelAt.has(c)) excelAt.set(c, new Set()); excelAt.get(c).add(loc); });
    const nowCode = new Map();           // 자리 id → 지금 코드
    (locs || []).forEach(l => { if (l && l.id != null) nowCode.set(str(l.id), codeAt(l, l.id)); });
    const byCode = new Map();            // 코드 → 이동들(at 순)
    recent.forEach(x => {
        const c = str(x && x.code).trim();
        if (!c) return;
        if (!byCode.has(c)) byCode.set(c, []);
        byCode.get(c).push(x);
    });
    byCode.forEach((list, code) => {
        if (doneCodes.has(code)) return;
        const last = list.slice().sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0))[list.length - 1];
        const dst = str(last.dst).trim();
        if (nowCode.get(dst) !== code) return;                  // 지금 자리 목록에서도 이미 다른 데로 갔다(엑셀·되돌리기) — 안 본다
        const at = excelAt.get(code) || new Set();
        if (at.has(dst)) return;                                // 엑셀도 새 자리 — 반영됨
        const old = list.map(x => str(x.src).trim()).reverse().find(s => at.has(s));
        if (!old) return;                                       // 엑셀이 옛 자리에도 안 둠(다른 데로 옮김·품절) — 경고하지 않는다
        out.push({ recKey: str(last.recKey), code, from: old, to: dst, recent: true });
    });
    return out;
}

/** 충돌 확인 문구 — 업로드를 막지 않는다(계속하면 엑셀대로) */
export function uploadConflictText(list, max = LIST_MAX) {
    const n = new Set((list || []).map(x => `${x.recKey}|${x.code}`)).size;
    const lines = (list || []).slice(0, max).map(x => `· ${x.code} ${x.from}→${x.to}`);
    if ((list || []).length > max) lines.push(`… 외 ${list.length - max}줄`);
    return `이지어드민 로케이션에 아직 반영 안 된 이동 ${n}건 — 변경 추천 [처리함]으로 옮겼는데 이 엑셀에서는 옛 자리입니다.\n`
        + `계속하면 데이터 리스트가 엑셀대로(옛 자리로) 돌아갑니다.\n\n${lines.join('\n')}\n\n계속할까요?`;
}
