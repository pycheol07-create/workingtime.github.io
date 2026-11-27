// === js/lib/supplies-io.js — 휴대폰 비품 입·출고 화면 계산(순수, node 시험 tests/supplies-io.test.js) ===
// 비품관리 앱 기준 전환 3단계(2026-11-26). 화면은 supplies-io.html · js/supplies-io.js.
//   2026-11-27 공유 누적: 비품 고르기(검색·초성·바코드·자주 쓰는 것·목록 드롭다운) → 단위 단추를 누를 때마다 공유 누적 칸
//   (suppliesIoCart/{입고·출고}-{비품 id}, 모든 사람이 같은 칸을 본다)에 더함(pressSlot) → [출고 전송]/[입고 전송] = 고른 비품 칸만 원장에 쓰고 비움
//   (js/supplies-ledger-store.js cartPress·cartSend·cartClear). 칸 모양·검사는 아래 slot* 함수, 규칙 firestore.rules suppliesIoCart 블록.
//   ↓ 아래 목록·sessionStorage·planSend 함수들(addLine ~ fromSession)은 2026-11-26 '내 폰 목록' 방식 — 화면은 더 쓰지 않는다(시험만 남음, 지울지 결정 대기).
// 저장은 js/supplies-ledger-store.js commitLines 가 비품 MAX_TX_ITEMS 개씩 나눠 보낸다(덩어리 i 의 기록 id = `${batchId}-${i}-${itemId}`).
//   같은 batchId 를 다시 쓰는 것은 '보낸 줄 그대로' 다시 보낼 때만(planSend) — 줄을 고치면 새 batchId.
// ⚠️ 비품 문서(persistent_data/supplies)에는 단가·업체 같은 칸이 있다 — 화면은 safeItems 로 아래 칸만 남기고 나머지는 버린다.

import { unitButtons, toBaseQty, normalizeItemUnits, MAX_UNIT_QTY } from './supplies-units.js?v=38146ad5b84d-33598b26';
import { splitLines, MAX_QTY } from './supplies-ledger.js?v=44c94c8b86ad-92d65f68';
import { score } from '../hangul-search.js?v=081b2de73c15-baed8498';

export const SAFE_FIELDS = ['id', 'name', 'unit', 'barcodes', 'units', 'noSingleOut', 'favorite', 'category', 'code'];   // code = 비품코드(ezCode)
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
            barcodes: n.barcodes, units: n.units, noSingleOut: n.noSingleOut, favorite: n.favorite,
            category: str(it.category) || NO_CATEGORY, code: str(it.ezCode) });
    }
    return out;
}

export const NO_CATEGORY = '미분류';   // js/supplies.js 와 같은 이름

/**
 * 드롭다운 묶음 — 분류(category)별, 분류는 이름순('미분류'는 맨 뒤), 분류 안은 이름순.
 * @returns {{ category:string, items:{id,name,label}[] }[]}  label = '이름 (비품코드)' — 코드가 없으면 이름만
 */
export function dropdownGroups(items) {
    const m = new Map();
    for (const it of Array.isArray(items) ? items : []) {
        if (!it || !it.id) continue;
        const c = str(it.category) || NO_CATEGORY;
        if (!m.has(c)) m.set(c, []);
        m.get(c).push({ id: it.id, name: str(it.name), label: str(it.code) ? `${str(it.name)} (${str(it.code)})` : str(it.name) });
    }
    const ko = (a, b) => a.localeCompare(b, 'ko');
    return [...m.keys()].sort((a, b) => ((a === NO_CATEGORY) - (b === NO_CATEGORY)) || ko(a, b))
        .map(category => ({ category, items: m.get(category).sort((a, b) => ko(a.name, b.name) || ko(a.id, b.id)) }));
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

/** 음성 안내 글 — 기본 단위 합계 + 단위 이름('1100장'). 쉼표 없이(읽기 편하게) */
export const speechText = (qty, unit) => `${Math.trunc(Number(qty) || 0)}${str(unit) || '개'}`;

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

// ───────── 공유 누적 칸(2026-11-27) ─────────
// 문서 artifacts/team-work-logger-v2/suppliesIoCart/{dir}-{itemId}
//   { dir:'in'|'out', itemId, counts:{ 단위 qty(글자): 누른 횟수 }, qty(기본 단위 합, 0 = 빈 칸), rev(+1), byEmail, by(이름), at(서버 시각),
//     sent?(전송한 묶음 id — 빈 칸이 된 까닭), cleared?(true — [이 칸 비우기]로 빈 칸) }
//   빈 칸도 문서는 남긴다(지우기 금지 — 누가 전송·비웠는지 다른 화면에 알리려고). 규칙 suppliesIoCart 블록과 칸을 맞출 것.
export const STALE_SLOT_MS = 2 * 60 * 60 * 1000;   // 마지막 누름 뒤 2시간 — '오래됨' 표시만(자동 삭제 없음)
export const MAX_SLOT_UNITS = 6;                     // counts 칸 수 상한(규칙 supCountsOk 와 같다 — 단위표는 기본 단위 + 4개라 보통 5칸 이하)
export const slotId = (dir, itemId) => `${dir}-${itemId}`;

/** 단위 누른 횟수 → 기본 단위 합(넘치면 null) */
export function countsTotal(counts) {
    let t = 0;
    for (const [q, n] of Object.entries(counts || {})) {
        const v = Number(q) * Number(n);
        if (!Number.isFinite(v) || v < 0) return null;
        t += v;
    }
    return t > MAX_QTY ? null : t;
}

/** 서버 칸 문서 → 화면에 쓸 모양(이상하면 null). atMs = 서버 시각 밀리초(아직 안 정해졌으면 지금) */
export function slotOf(id, d, nowMs = Date.now()) {
    if (!d || !['in', 'out'].includes(d.dir) || !idSafe(d.itemId) || id !== slotId(d.dir, d.itemId)) return null;
    const counts = {};
    if (d.counts && typeof d.counts === 'object') {
        for (const [q, n] of Object.entries(d.counts)) {
            if (Number.isInteger(Number(q)) && Number(q) > 0 && Number.isInteger(n) && n > 0) counts[q] = n;
        }
    }
    const qty = Number.isInteger(d.qty) && d.qty > 0 ? d.qty : 0;
    const at = d.at && typeof d.at.toMillis === 'function' ? d.at.toMillis() : (typeof d.at === 'number' ? d.at : nowMs);
    return { id, dir: d.dir, itemId: d.itemId, counts: qty ? counts : {}, qty, rev: Number(d.rev) || 0,
        byEmail: str(d.byEmail).toLowerCase(), by: str(d.by), atMs: at, sent: str(d.sent), cleared: d.cleared === true };
}

/** 구성 글 '1박스×2 + 1묶음×1' — 단위 이름은 지금 비품의 단위표(없는 단위는 '500장' 처럼 수량으로) */
export function countsDesc(it, counts, dir) {
    const names = new Map(unitButtons(it, dir).map(u => [u.qty, u.name]));
    return Object.entries(counts || {}).map(([q, n]) => [Number(q), n]).filter(([, n]) => n > 0).sort((a, b) => b[0] - a[0])
        .map(([q, n]) => (names.has(q) ? `1${names.get(q)}×${n}` : `${fmt(q)}${baseUnit(it)}×${n}`)).join(' + ');
}

/**
 * 단위 단추 한 번 — 칸의 지금 counts(slot, 없으면 빈 칸)에 더한 새 값. 출고는 재고(stockNow)보다 많으면 막는다.
 * @returns {{ counts, qty, why:string }}  why 가 있으면 쓰지 않는다
 */
export function pressSlot(slot, qty, dir, stockNow) {
    const before = slot && slot.qty ? { ...slot.counts } : {};
    const next = pressUnit(before, qty);
    if (JSON.stringify(next) === JSON.stringify(before)) return { counts: before, qty: countsTotal(before) || 0, why: '수량이 너무 많습니다' };
    if (Object.keys(next).length > MAX_SLOT_UNITS) return { counts: before, qty: countsTotal(before) || 0, why: '단위가 너무 많습니다' };
    const total = countsTotal(next);
    if (total == null) return { counts: before, qty: countsTotal(before) || 0, why: '수량이 너무 많습니다' };
    if (dir === 'out' && total > (Number(stockNow) || 0)) return { counts: before, qty: countsTotal(before) || 0, why: '재고보다 많이 출고할 수 없습니다' };
    return { counts: next, qty: total, why: '' };
}

/**
 * 누적 칸 목록(이 방향, 수량 있는 칸만) — 내가 고른 비품이 맨 위, 나머지는 마지막 누름이 늦은 것부터.
 * liveAtMs = 앱 기준을 (다시) 켠 시각 — 그보다 먼저 쌓인 칸은 old(전송·이어 쌓기 막음, 비우기만).
 * @returns {{ id, itemId, qty, counts, by, byEmail, atMs, mine:boolean, selected:boolean, stale:boolean, old:boolean }[]}
 */
export const slotIsOld = (s, liveAtMs) => !!s && Number.isFinite(liveAtMs) && s.atMs < liveAtMs;
export function slotRows(slots, dir, selId, myEmail, nowMs = Date.now(), liveAtMs = NaN) {
    const me = str(myEmail).toLowerCase();
    return [...(slots || [])].filter(s => s && s.dir === dir && s.qty > 0)
        .map(s => ({ ...s, mine: !!me && s.byEmail === me, selected: s.itemId === selId, stale: nowMs - s.atMs > STALE_SLOT_MS, old: slotIsOld(s, liveAtMs) }))
        .sort((a, b) => (b.selected - a.selected) || (b.atMs - a.atMs) || a.itemId.localeCompare(b.itemId));
}

/** 다른 방향에 진행 중인 칸 수(안내 한 줄용) */
export const otherDirCount = (slots, dir) => [...(slots || [])].filter(s => s && s.dir !== dir && s.qty > 0).length;

/**
 * 칸이 바뀐 까닭(내 화면 안내용) — 수량 있던 칸이 남의 손으로 빈 칸이 됐으면 { kind:'sent'|'cleared', byEmail }, 아니면 null.
 * 이름은 화면이 byEmail → mainConfig.memberEmails 로 찾는다(칸의 by 는 쓴 사람이 적은 값이라 표시에 쓰지 않는다).
 * 내가 한 것(byEmail == 나)이면 null(내 화면은 이미 안내함).
 */
export function slotEmptiedBy(prev, next, myEmail) {
    if (!prev || !prev.qty || !next || next.qty) return null;
    if (next.byEmail && next.byEmail === str(myEmail).toLowerCase()) return null;
    return { kind: next.sent ? 'sent' : 'cleared', byEmail: next.byEmail };
}

/** '방금' · 'n분 전' · 'n시간 전' · 'M/D HH:MM' */
export function agoText(atMs, nowMs = Date.now()) {
    const d = Math.max(0, nowMs - atMs);
    if (d < 60000) return '방금';
    if (d < 3600000) return `${Math.floor(d / 60000)}분 전`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}시간 전`;
    const t = new Date(atMs), p2 = (n) => String(n).padStart(2, '0');
    return `${t.getMonth() + 1}/${t.getDate()} ${p2(t.getHours())}:${p2(t.getMinutes())}`;
}

// ───────── 전송 기록(2026-11-27) — 이 화면이 보낸 원장 기록 보기·되돌리기 ─────────
const DAY_MS = 86400000, KST_MS = 9 * 3600000;

/** 한국 날짜 0시(밀리초) — back 일 전. kstDayStartMs(now, 1) = 어제 0시 */
export const kstDayStartMs = (nowMs, back = 0) => Math.floor((nowMs + KST_MS) / DAY_MS) * DAY_MS - KST_MS - back * DAY_MS;

/** 기록 시각 글 — '오늘 14:05' · '어제 09:10' · '11/25 08:00'(한국 시각) */
export function kstTimeText(ms, nowMs = Date.now()) {
    if (!Number.isFinite(ms)) return '방금';
    const t = new Date(ms + KST_MS), p2 = (n) => String(n).padStart(2, '0');
    const hm = `${p2(t.getUTCHours())}:${p2(t.getUTCMinutes())}`;
    const today = kstDayStartMs(nowMs);
    if (ms >= today) return `오늘 ${hm}`;
    if (ms >= today - DAY_MS) return `어제 ${hm}`;
    return `${t.getUTCMonth() + 1}/${t.getUTCDate()} ${hm}`;
}

/**
 * 원장 기록(loadLedger 결과, at 은 Timestamp·밀리초) → 전송 기록 줄.
 *   보이는 것 = 입고·출고 전송 기록(kind in/out, batchId 있음 — 실사(ct-)·옛 화면 손 입력 중 batchId 없는 것은 뺌)
 *             + 그 기록을 되돌린 기록(kind revert, ref 가 위 기록). 새 것부터.
 *   reverted = 되돌림 기록이 있는 원 기록(단추 끔). mine 이면 byEmail 이 나인 것만.
 * @returns {{ id, itemId, kind, qty, atMs, byEmail, ref, reverted:boolean, canRevert:boolean }[]}
 */
export function historyRows(entries, { mine = false, myEmail = '', liveAtMs = NaN } = {}) {
    const src = Array.isArray(entries) ? entries : [];
    const msOf = (a) => (a && typeof a.toMillis === 'function' ? a.toMillis() : (typeof a === 'number' ? a : NaN));
    const isSend = (e) => e && (e.kind === 'in' || e.kind === 'out') && typeof e.batchId === 'string' && e.batchId !== '' && !String(e.id || '').startsWith('ct-');
    const sendIds = new Set(src.filter(isSend).map(e => e.id));
    const reverted = new Set(src.filter(e => e && e.kind === 'revert' && e.ref).map(e => e.ref));
    // 같은 비품에 그 기록보다 늦은 실사(kind 'count')가 있으면 되돌릴 수 없다 — 실사가 이미 그 출고·입고를 반영한 재고라
    //   되돌리면 재고가 틀어진다. 앱 기준을 (다시) 켠 시각(liveAtMs)보다 앞선 기록도 같다(켤 때 실사로 새로 셈). 2026-11-27 리뷰
    const lastCount = new Map();
    src.forEach(e => { if (e && e.kind === 'count' && e.itemId) { const t = msOf(e.at); if (Number.isFinite(t) && !(lastCount.get(e.itemId) >= t)) lastCount.set(e.itemId, t); } });
    const lockedWhy = (e) => {
        const t = msOf(e.at);
        if (Number.isFinite(liveAtMs) && Number.isFinite(t) && t < liveAtMs) return 'live';
        const c = lastCount.get(e.itemId);
        return Number.isFinite(c) && Number.isFinite(t) && c > t ? 'count' : '';
    };
    const me = str(myEmail).toLowerCase();
    return src.filter(e => isSend(e) || (e && e.kind === 'revert' && sendIds.has(e.ref)))
        .filter(e => !mine || str(e.byEmail).toLowerCase() === me)
        .map(e => ({ id: e.id, itemId: e.itemId, kind: e.kind, qty: Number(e.qty) || 0, atMs: msOf(e.at), byEmail: str(e.byEmail).toLowerCase(),
            ref: e.ref || '', reverted: reverted.has(e.id), locked: e.kind !== 'revert' && !reverted.has(e.id) ? lockedWhy(e) : '',
            canRevert: e.kind !== 'revert' && !reverted.has(e.id) && !lockedWhy(e) }))
        .sort((a, b) => ((Number.isFinite(b.atMs) ? b.atMs : Infinity) - (Number.isFinite(a.atMs) ? a.atMs : Infinity)) || String(b.id).localeCompare(String(a.id)));
}
