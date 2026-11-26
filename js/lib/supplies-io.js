// === js/lib/supplies-io.js — 휴대폰 비품 입·출고 화면 계산(순수, node 시험 tests/supplies-io.test.js) ===
// 비품관리 앱 기준 전환 3단계(2026-11-26). 화면은 supplies-io.html · js/supplies-io.js.
//   비품 고르기(이름·초성·바코드 검색) → 단위 단추로 수량 쌓기(카드) → [출고]/[입고]로 목록에 넣기 → [저장 및 전송] 한 번(commitLines)
// 저장은 js/supplies-ledger-store.js commitLines 가 비품 MAX_TX_ITEMS 개씩 나눠 보낸다(덩어리 i 의 기록 id = `${batchId}-${i}-${itemId}`).
//   같은 batchId 를 다시 쓰는 것은 '보낸 줄 그대로' 다시 보낼 때만(planSend) — 줄을 고치면 새 batchId.
// ⚠️ 비품 문서(persistent_data/supplies)에는 단가·업체 같은 칸이 있다 — 화면은 safeItems 로 아래 칸만 남기고 나머지는 버린다.

import { unitButtons, toBaseQty, normalizeItemUnits, MAX_UNIT_QTY } from './supplies-units.js?v=38146ad5b84d-33598b26';
import { splitLines, MAX_QTY } from './supplies-ledger.js?v=44c94c8b86ad-92d65f68';
import { score } from '../hangul-search.js?v=081b2de73c15-baed8498';

export const SAFE_FIELDS = ['id', 'name', 'unit', 'barcodes', 'units', 'noSingleOut', 'favorite'];
export const MAX_DESC = 200;
export const SESSION_KEY = 'suppliesIo.v1';

const str = (v) => (v == null ? '' : String(v)).trim();
const idSafe = (s) => /^[A-Za-z0-9_-]{1,80}$/.test(String(s || ''));
/** 천 단위 쉼표(기기 언어 설정과 상관없이 같은 글자) */
export const fmt = (n) => String(Math.trunc(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const baseUnit = (it) => str(it && it.unit) || '개';

/** 비품 문서 items → 화면에 쓸 칸만(SAFE_FIELDS). id 가 없거나 이상한 것은 뺀다 */
export function safeItems(items) {
    const out = [];
    for (const it of Array.isArray(items) ? items : []) {
        if (!it || !idSafe(it.id)) continue;
        const n = normalizeItemUnits(it);
        out.push({ id: String(it.id), name: str(it.name) || '(이름 없음)', unit: baseUnit(it),
            barcodes: n.barcodes, units: n.units, noSingleOut: n.noSingleOut, favorite: n.favorite });
    }
    return out;
}

/** 바코드처럼 보이는 글자(영문·숫자·_- 4~40자, 숫자 하나 이상) — 모르는 바코드 안내에 쓴다 */
export const looksLikeBarcode = (q) => /^[A-Za-z0-9_-]{4,40}$/.test(str(q)) && /\d/.test(str(q));

/** 한글 입력 상태에서 스캐너가 친 것 같은 글자(한글 + 숫자·영문, 4자 이상) — 바꿔 맞추지 않고 '한/영 키 확인' 안내만 한다 */
export const hangulBarcodeHint = (q) => { const t = str(q); return t.length >= 4 && /[ㄱ-ㅎㅏ-ㅣ가-힣]/.test(t) && /[0-9A-Za-z]/.test(t); };

export const BURST_GAP_MS = 60;   // 스캐너 글자 사이 간격 상한(사람 손은 보통 이보다 느리다)
/**
 * 찾기 칸 밖에서 받은 키 묶음(keys = [{ key, t }], Enter 직전까지) → 스캐너 입력이면 { code, ime }, 아니면 null.
 * 4자 이상이고 글자 사이가 모두 BURST_GAP_MS 이하일 때만. ime = 한글 입력 중이라 글자 대신 'Process' 가 온 것(안내만).
 */
export function burstCode(keys, enterAt) {
    const k = Array.isArray(keys) ? keys : [];
    if (k.length < 4) return null;
    for (let i = 1; i < k.length; i++) if (k[i].t - k[i - 1].t > BURST_GAP_MS) return null;
    if (enterAt != null && enterAt - k[k.length - 1].t > BURST_GAP_MS) return null;
    const ime = k.some(x => x.key === 'Process' || x.key.length !== 1);
    return { code: ime ? '' : k.map(x => x.key).join(''), ime };
}

/** 검색 — 이름 일부·초성(ㄱ~ㅎ 만 쳤을 때)·바코드 일부. 점수순, 같으면 원래 순서. 빈 검색어는 [] */
export function searchItems(items, q, max = 20) {
    const nq = str(q);
    if (!nq) return [];
    return (Array.isArray(items) ? items : [])
        .map((it, i) => ({ it, i, s: score(nq, it.name, it.barcodes || []) }))
        .filter(x => x.s > 0)
        .sort((a, b) => (b.s - a.s) || (a.i - b.i))
        .slice(0, max)
        .map(x => x.it);
}

/** 자주 쓰는 비품(favorite) — 이름순 */
export const favoriteItems = (items) => (Array.isArray(items) ? items : []).filter(it => it && it.favorite === true)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));

/**
 * 카드 계산 — counts = { [단위 qty]: 누른 횟수 }. 지금 방향의 단위 단추(unitButtons)에 있는 단위만 센다.
 * @returns {{ buttons:{name,qty,base,n}[], parts:{name,qty,n}[], total:number|null, text:string, desc:string }}
 *   total = 기본 단위 합(넘치면 null), text = '1박스×2 + 1묶음×1 = 1,100장', desc = '1박스×2 + 1묶음×1'(목록 구성 글)
 */
export function cardSummary(it, counts, dir) {
    const c = counts || {};
    const buttons = unitButtons(it, dir).map(u => ({ ...u, n: Math.max(0, Math.trunc(Number(c[u.qty]) || 0)) }));
    const parts = buttons.filter(u => u.n > 0).sort((a, b) => b.qty - a.qty).map(u => ({ name: u.name, qty: u.qty, n: u.n }));
    let total = 0;
    for (const p of parts) {
        const v = toBaseQty({ qty: p.qty }, p.n);
        if (v == null) { total = null; break; }
        total += v;
    }
    if (total != null && total > MAX_QTY) total = null;
    const desc = parts.map(p => `1${p.name}×${p.n}`).join(' + ');
    const text = parts.length ? `${desc} = ${total == null ? '너무 많음' : fmt(total) + baseUnit(it)}` : '';
    return { buttons, parts, total, text, desc };
}

/** 단위 단추 한 번 누름 — 새 counts(한 단위 누적이 MAX_UNIT_QTY 를 넘으면 그대로) */
export function pressUnit(counts, qty) {
    const c = { ...(counts || {}) };
    const n = (Number(c[qty]) || 0) + 1;
    if (Number(qty) * n > MAX_UNIT_QTY) return c;
    c[qty] = n;
    return c;
}

/** 목록에 이미 넣은 이 비품 수량 */
export const listQtyOf = (list, itemId) => (Array.isArray(list) ? list : []).filter(l => l.itemId === itemId).reduce((s, l) => s + (Number(l.qty) || 0), 0);

/** 저장 후 재고 = 지금 재고 ± (목록 수량 + 카드 수량). 출고면 뺀다 */
export function projected(stockNow, listQty, cardQty, dir) {
    const s = Number(stockNow) || 0, d = (Number(listQty) || 0) + (Number(cardQty) || 0);
    return dir === 'in' ? s + d : s - d;
}

/** 카드의 [출고]/[입고] 단추를 켤 수 있나 — 이유 글(켤 수 있으면 '') */
export function cardBlockReason(sum, stockNow, listQty, dir) {
    if (!sum || !sum.parts.length) return '단위 단추를 눌러 수량을 넣으세요';
    if (sum.total == null) return '수량이 너무 많습니다';
    if ((Number(listQty) || 0) + sum.total > MAX_QTY) return '수량이 너무 많습니다';
    if (dir === 'out' && projected(stockNow, listQty, sum.total, dir) < 0) return '재고보다 많이 출고할 수 없습니다';
    return '';
}

/** 목록에 넣기 — 같은 비품은 합치고 구성 글은 ' + ' 로 이어 붙인다(새 배열) */
export function addLine(list, line) {
    const src = Array.isArray(list) ? list : [];
    const at = src.findIndex(l => l.itemId === line.itemId);
    if (at < 0) return [...src, { itemId: line.itemId, qty: line.qty, desc: String(line.desc || '').slice(0, MAX_DESC) }];
    const old = src[at];
    const desc = [old.desc, line.desc].filter(Boolean).join(' + ').slice(0, MAX_DESC);
    return src.map((l, i) => (i === at ? { itemId: l.itemId, qty: l.qty + line.qty, desc } : l));
}

export const removeLine = (list, itemId) => (Array.isArray(list) ? list : []).filter(l => l.itemId !== itemId);

/** 목록 모양 열쇠(방향 + 줄 순서·수량) — 같은 줄 그대로인지 볼 때 */
export const listKey = (dir, list) => `${dir}|` + (Array.isArray(list) ? list : []).map(l => `${l.itemId}:${l.qty}`).join(',');

/**
 * 보낼 것 정하기. pending = 앞서 결과를 모르는 전송 { dir, batchId, lines, remainKey } — 있으면(같은 방향) 그때 보낸 줄 전체를
 * 같은 batchId 로 다시 보낸다(저장된 덩어리는 '이미 저장됨', 확인 못 한 덩어리는 한 번만 들어감). 없으면 지금 목록을 새 batchId 로.
 * 지금 목록이 그때 남긴 목록과 달라도(세션에서 불러오며 모르는 비품이 빠진 경우 등) 같은 묶음으로 보낸다 —
 * 화면은 pending 이 있는 동안 목록 넣기·빼기·방향 바꾸기를 막는다(js/supplies-io.js). 새 batchId 로 보내면 두 번 들어갈 수 있다.
 */
export function planSend(dir, list, pending, newId) {
    if (pending && pending.dir === dir && typeof pending.batchId === 'string' && Array.isArray(pending.lines) && pending.lines.length) {
        return { batchId: pending.batchId, lines: pending.lines.map(l => ({ itemId: l.itemId, qty: l.qty })), reused: true };
    }
    return { batchId: newId(), lines: (Array.isArray(list) ? list : []).map(l => ({ itemId: l.itemId, qty: l.qty })), reused: false };
}

/** 보낸 줄의 기록 id — { itemId: id } (commitLines 의 덩어리 나누기와 같은 규칙) */
export function entryIdsFor(lines, batchId) {
    const out = {};
    splitLines(lines).forEach((chunk, i) => chunk.forEach(l => { out[String(l.itemId)] = `${batchId}-${i}-${l.itemId}`; }));
    return out;
}

/** 결과가 ok 가 아닌 덩어리의 기록 id(연결 오류 뒤 서버에서 하나씩 확인할 것) */
export function idsToCheck(lines, parts, batchId) {
    const ps = Array.isArray(parts) ? parts : [];
    const out = [];
    splitLines(lines).forEach((chunk, i) => {
        if (ps[i] && ps[i].ok) return;
        for (const l of chunk) { const id = `${batchId}-${i}-${l.itemId}`; if (!out.includes(id)) out.push(id); }
    });
    return out;
}

/**
 * commitLines 결과 읽기. parts[i] = 덩어리 i 결과(앞 덩어리가 실패하면 뒤는 없음 — 안 보냄).
 * found = 실패 뒤 다시 읽어 '있다'고 확인한 기록 id 들(Set, 없으면 null) — 있는 덩어리는 저장된 것으로 본다(트랜잭션이라 덩어리 단위).
 * @returns {{ allOk, saved:string[], failed:string[], errors:object[], uncertain:boolean, already:boolean }}
 *   uncertain = 연결 오류(write)로 끝나 저장됐는지 모르는 덩어리가 있다(found 로 확인 못 함)
 */
export function readResult(lines, parts, batchId, found = null) {
    const chunks = splitLines(lines);
    const ps = Array.isArray(parts) ? parts : [];
    const ids = entryIdsFor(lines, batchId);
    const saved = [], failed = [], errors = [];
    let uncertain = false, already = false;
    chunks.forEach((chunk, i) => {
        const items = [...new Set(chunk.map(l => String(l.itemId)))];
        const p = ps[i];
        const ok = !!(p && p.ok) || (!!found && items.every(id => found.has(ids[id])));
        if (ok) { saved.push(...items); if (p && p.already) already = true; return; }
        failed.push(...items);
        if (p && Array.isArray(p.errors)) {
            errors.push(...p.errors);
            if (p.errors.some(e => e && e.reason === 'write')) uncertain = true;
        }
    });
    // 보내기 전 검사 실패(결과 1개 — 덩어리 0 자리)는 위에서 덩어리 0 의 오류로 들어가고, 뒤 덩어리는 결과가 없어 '안 됨'이 된다
    if (found) uncertain = false;
    return { allOk: failed.length === 0 && chunks.length > 0, saved, failed, errors, uncertain, already };
}

/** 실패 뒤 다음 상태 — 남길 목록과 다음 전송 때 쓸 pending('changed' 면 pending 없음 = 새 batchId) */
export function afterFailure(dir, list, sent, res) {
    const keep = (Array.isArray(list) ? list : []).filter(l => res.failed.includes(l.itemId));
    const changed = res.errors.some(e => e && e.reason === 'changed');
    const pending = changed || !res.uncertain ? null
        : { dir, batchId: sent.batchId, lines: sent.lines.map(l => ({ itemId: l.itemId, qty: l.qty })), remainKey: listKey(dir, keep) };
    return { list: keep, pending };
}

/** sessionStorage 에 둘 글(비품 id·수량·구성 글, 전송 대기 묶음 id) */
export const toSession = (dir, list, pending) => JSON.stringify({ v: 1, dir, list: (list || []).map(l => ({ itemId: l.itemId, qty: l.qty, desc: l.desc || '' })), pending: pending || null });

const okLine = (l) => l && idSafe(l.itemId) && Number.isInteger(l.qty) && l.qty > 0 && l.qty <= MAX_QTY;

/** sessionStorage 글 → { dir, list, pending, dropped } — knownIds(지금 비품 id Set)에 없는 줄은 빼고 dropped 로 센다 */
export function fromSession(raw, knownIds) {
    let d = null;
    try { d = JSON.parse(raw || 'null'); } catch (_) { d = null; }
    if (!d || d.v !== 1) return { dir: 'out', list: [], pending: null, dropped: 0 };
    const dir = d.dir === 'in' ? 'in' : 'out';
    let dropped = 0;
    const list = [];
    for (const l of Array.isArray(d.list) ? d.list : []) {
        if (!okLine(l) || (knownIds && !knownIds.has(l.itemId)) || list.some(x => x.itemId === l.itemId)) { dropped++; continue; }
        list.push({ itemId: l.itemId, qty: l.qty, desc: typeof l.desc === 'string' ? l.desc.slice(0, MAX_DESC) : '' });
    }
    const p = d.pending;
    const pending = p && p.dir === dir && /^[A-Za-z0-9_-]{1,60}$/.test(String(p.batchId || '')) && Array.isArray(p.lines) && p.lines.length && p.lines.every(okLine)
        && typeof p.remainKey === 'string' ? { dir, batchId: p.batchId, lines: p.lines.map(l => ({ itemId: l.itemId, qty: l.qty })), remainKey: p.remainKey } : null;
    return { dir, list, pending, dropped };
}
