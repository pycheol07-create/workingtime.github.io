// === js/lib/locrec-apply.js ===
// 변경 추천 [처리함] → 데이터 리스트(Locations ZONE_* 문서) 상품 칸을 추천대로 옮기는 계획 · 되돌리기 계획 · 하루 표시(locRecMove)
// · 오늘 재고 올리기 전 충돌 찾기. 순수 모듈(DOM·Firebase 없음) — node --test 대상(tests/locrec-apply.test.js).
// 쓰기(트랜잭션)는 js/locrec-store.js, 표시는 js/location.js(데이터 리스트·도면) 가 한다. 설계 2026-10-29(architect, 사용자 결정 반영).
//
//   옮기는 칸   PRODUCT_FIELDS(code·name·option·stock·stock2f·rawDataStr) — 자리 칸(dong·pos·category·angleSize·reserved*·preAssigned*·codeTag*·assignedAt)은 안 건드림
//               옛 형식 rawData(맵)는 cleanRaw 를 거쳐 rawDataStr 로 바꾸고 양쪽 rawData 는 지운다(opts.del = deleteField()).
//   비운 자리   EMPTY_PRODUCT — 오늘 재고 올리기(location.js updateDatabaseA daily 초기화)와 같은 값
//   하루 표시   자리 맵 안 locRecMove {day:'YYYYMMDD'(KST), at:ms, role:'in'|'out', code, peer:상대 자리 id, recKey}
//               화면은 day === 오늘(KST) 일 때만 보인다(자정 DB 쓰기 없음). 맞바꾸기는 두 자리 모두 in.
//   marks 기록  locRecWork/marks.marks[recKey].applied = {v:1, at:ms, day, moves:[{code,src,dst}], skipped:[{code,src,dst}]} — 코드·자리 id 만
// ⚠️ 돌려주는 실패 정보·문구에는 상품코드·자리 id 만 — 상품명·rawDataStr·공급처 값을 넣지 않는다(로그·alert 로 나간다).
// import 는 같은 lib 의 sensitive-cols.js(cleanRaw)·multi-loc.js(normLocId)·refill-view.js(dayKey·fmtHM, KST)·loc-recommend.js(isEtcLocObj·kstMidnight) 만.

import { cleanRaw } from './sensitive-cols.js?v=202610291119';
import { normLocId } from './multi-loc.js?v=202610291119';
import { dayKey, fmtHM, tsMs } from './refill-view.js?v=202610291119';
import { isEtcLocObj, kstMidnight } from './loc-recommend.js?v=202610291119';

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

/** 추천 행 → 이동 목록 [{code, src, dst}] — 모양이 틀리면 null.
 *  single [{code, from→to}] · swap [{code, from→from2},{code2, from2→from}] · pair [{code, from→to},{code2, from2→to2}] */
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
    } else if (type === 'single') {
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
    resolved.forEach(x => {
        if (dstIds.has(x.src.id)) return;                                     // 맞바꾸기 — 아래에서 도착으로 채운다
        const mk = markOf(x.src.id, 'out', x.dst.id);
        put(x.src, { ...base(x.src), ...EMPTY_PRODUCT, ...(mk === undefined ? {} : { locRecMove: mk }) });
    });
    resolved.forEach(x => {
        const mk = markOf(x.dst.id, 'in', x.src.id);
        put(x.dst, { ...base(x.dst), ...productOf(x.src.slot), ...(mk === undefined ? {} : { locRecMove: mk }) });
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

/** 한 줄 실패 확인 문구 */
export function applyFailText(f) {
    return `데이터 리스트에 반영하지 못했습니다(${reasonText(f)}).\n처리함 표시만 할까요?`;
}
/** 되돌리기 실패 확인 문구 */
export function undoFailText(f) {
    if (f && f.reason === 'otherDay') return '반영한 날이 지나 데이터 리스트 자리는 되돌리지 않습니다.\n처리함 표시만 지울까요?';
    return `데이터 리스트가 이미 바뀌어 자리는 되돌리지 않습니다(${reasonText(f)}).\n처리함 표시만 지울까요?`;
}
/** [전체 처리함] 끝 요약 — okN = 실제로 자리를 옮긴 건, doneN = 이미 처리됨(다른 사람이 표시·이미 그 자리), fails: [{code, reason…}] */
export function bulkSummaryText(okN, fails, max = LIST_MAX, doneN = 0) {
    const list = fails || [];
    const head = `${okN}건 데이터 리스트에 반영${doneN ? `, 이미 처리됨 ${doneN}건` : ''}, ${list.length}건 못 함.`;
    if (!list.length) return head;
    const lines = list.slice(0, max).map(f => `· ${f.code || ''} — ${reasonText(f)}`);
    if (list.length > max) lines.push(`… 외 ${list.length - max}건`);
    return `${head}\n${lines.join('\n')}\n\n못 한 ${list.length}건도 처리함 표시만 할까요?`;
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

/**
 * 오늘 재고 올리기 전 충돌 — 오늘 locRecMove 가 있는 자리와 엑셀을 비교.
 *   in 자리에 엑셀 코드가 locRecMove.code 와 다름 · out 자리에 엑셀이 그 코드를 아직 둠 → 충돌(recKey 단위로 한 줄).
 * @param {object[]} rows   엑셀 행
 * @param {object[]} locs   지금 자리 목록(originalData — id, locRecMove)
 * @returns {{recKey, code, from, to}[]}
 */
export function uploadMoveConflicts(rows, locs, todayKey) {
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
    return out;
}

/** 충돌 확인 문구 */
export function uploadConflictText(list, max = LIST_MAX) {
    const n = new Set((list || []).map(x => x.recKey)).size;
    const lines = (list || []).slice(0, max).map(x => `· ${x.code} ${x.from}→${x.to}`);
    if ((list || []).length > max) lines.push(`… 외 ${list.length - max}줄`);
    return `오늘 변경 추천으로 옮긴 ${n}건이 이 엑셀에서는 옛 자리입니다(이지어드민 로케이션을 아직 안 바꾼 것 같습니다).\n`
        + `계속하면 데이터 리스트가 엑셀대로 돌아갑니다.\n\n${lines.join('\n')}\n\n계속할까요?`;
}
