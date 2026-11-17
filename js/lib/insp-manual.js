// === js/lib/insp-manual.js ===
// 샘플검수 [+ 개별 추가]의 순수 함수 — import 없음(node --test 대상). 화면·저장은 js/inspection-manual.js.
//   상품 DB(ProductCatalog — js/products-store.js S.products: pid → { name, code2, gone, o: [[상품코드, 옵션명, 바코드, 옵션상태, 사라짐]] })
//   에서 후보를 찾고, 고른 옵션을 검수 대기 리스트 줄로 만든다. 원가·공급처는 다루지 않는다(supplierCode·supplierName 은 빈칸).
//   개별 줄 표시: origin 'manual' + kind(KINDS id — 샘플 / 요청확인, 2026-11-17 사용자 결정). source 칸은 제작/사입 구분이라 쓰지 않는다.

const str = (v) => (v == null ? '' : String(v));
const norm = (v) => str(v).replace(/\s/g, '').toLowerCase();
const DONE = '완료';

/** 개별 추가 유형(필수, 선택형만 — 자유 입력 칸 없음). label = 고르는 칸 이름, type = 유형 표시(대기 카드·새창·검수이력·엑셀).
 *  요청확인을 고르면 '고객 이름·연락처·주문번호·후기 원문은 적지 마세요' 안내를 보인다(js/inspection-manual.js). */
export const KINDS = Object.freeze([
    Object.freeze({ id: 'sample', label: '샘플', type: '샘플(개별)' }),
    Object.freeze({ id: 'request', label: '요청확인', type: '요청확인' }),
]);
export const isKind = (id) => KINDS.some(x => x.id === str(id));
/** 유형 표시 이름 — 모르는 값은 샘플(개별). */
export const kindLabel = (id) => (KINDS.find(x => x.id === str(id)) || KINDS[0]).type;

/** 검수이력 '유형' 칸 — 리스트 줄·검수 기록(log) 둘 다. 전량 / 샘플 / 샘플(개별) / 요청확인. */
export function inspTypeLabel(x) {
    const it = x || {};
    if (it.inspectionType === 'total') return '전량';
    if (it.origin === 'manual') return kindLabel(it.kind);
    return '샘플';
}

/** 상품 이력 문서 id — 저장(saveInspectionAndNext)과 같은 규칙(`/` → `-`). */
export const historyId = (name) => str(name).trim().replace(/\//g, '-');

/** 개별로 넣었고 아직 패킹 카드로 바뀌지 않은 줄 — 리스트·새창에서 맨 아래(묶음 마지막). */
export const isManualOnly = (it) => !!(it && it.origin === 'manual' && !str(it.packNo));

/** 같은 상품 줄인가 — 상품명은 이력 문서 id 규칙(historyId: `/`→`-`)으로 맞춰 본다. 'A/B' 와 'A-B' 는 같은 이력에 저장되므로 같은 줄. */
const sameItem = (a, b) => !!(a && b) && historyId(a.name) === historyId(b.name) && str(a.option).trim() === str(b.option).trim();

/** 상품 → 화면용 후보 { pid, name, code2, gone, opts: [{ code, option, barcode, gone }] }.
 *  옵션이 하나도 없으면 자체상품코드(없으면 품목코드)로 '옵션 없음' 한 칸을 만든다. 사라진 옵션은 뒤로. */
function candidateOf(pid, p) {
    const opts = (Array.isArray(p.o) ? p.o : []).map(o => ({
        code: str(o && o[0]).trim(), option: str(o && o[1]).trim(), barcode: str(o && o[2]).trim(), gone: !!(o && o[4]),
    })).filter(o => o.code);
    opts.sort((a, b) => Number(a.gone) - Number(b.gone));
    if (opts.length === 0) opts.push({ code: str(p.code2).trim() || str(pid), option: '', barcode: '', gone: false });
    return { pid: str(pid), name: str(p.name).trim(), code2: str(p.code2).trim(), gone: !!p.gone, opts };
}

const entriesOf = (products) => {
    if (!products) return [];
    if (typeof products.entries === 'function' && !Array.isArray(products)) return [...products.entries()];
    return Array.isArray(products) ? products : [];
};

/** 찾기. 정확히 맞는 것 먼저 — 바코드 → 옵션 상품코드 → 자체상품코드(code2)·품목코드(pid) — 그다음 상품명 부분일치(최대 limit).
 *  같은 단계 안에서는 사라진 상품이 뒤. 바코드·코드가 여러 상품에 걸리면 전부 돌려준다.
 *  products: Map(pid → 상품) 또는 [[pid, 상품]].
 *  @returns {{ items: Array<{pid,name,code2,gone,opts,match:'barcode'|'option'|'code'|'name',pre:string[]}>, more: boolean }}
 *    pre = 미리 골라 둘 옵션 상품코드(바코드·옵션코드로 찾았을 때). more = 상품명 후보가 limit 을 넘어 잘림. */
export function findCandidates(products, term, { limit = 30 } = {}) {
    const q = str(term).trim();
    if (!q) return { items: [], more: false };
    const qUp = q.toUpperCase();
    const qn = norm(q);
    const RANK = { barcode: 0, option: 1, code: 2 };
    const exact = [];
    const names = [];
    entriesOf(products).forEach(([pid, p]) => {
        if (!p || typeof p !== 'object') return;
        const c = candidateOf(pid, p);
        const byBar = c.opts.filter(o => o.barcode && o.barcode === q).map(o => o.code);
        const byOpt = c.opts.filter(o => o.code.toUpperCase() === qUp).map(o => o.code);
        let match = '';
        let pre = [];
        if (byBar.length) { match = 'barcode'; pre = byBar; }
        else if (byOpt.length) { match = 'option'; pre = byOpt; }
        else if ((c.code2 && c.code2.toUpperCase() === qUp) || c.pid.toUpperCase() === qUp) match = 'code';
        if (match) { exact.push({ ...c, match, pre }); return; }
        if (qn && norm(c.name).includes(qn)) names.push({ ...c, match: 'name', pre: [] });
    });
    exact.sort((a, b) => RANK[a.match] - RANK[b.match] || Number(a.gone) - Number(b.gone));
    // 상품명: 살아 있는 것 → 이름이 검색어로 시작하는 것 → 짧은 이름 → 가나다
    names.sort((a, b) => Number(a.gone) - Number(b.gone)
        || Number(!norm(a.name).startsWith(qn)) - Number(!norm(b.name).startsWith(qn))
        || a.name.length - b.name.length
        || a.name.localeCompare(b.name, 'ko'));
    const n = Math.max(0, Number(limit) || 0);
    return { items: [...exact, ...names.slice(0, n)], more: names.length > n };
}

/** 바로 넣기(2026-11-17) — 찾은 결과가 옵션 하나로 정해졌나. 후보가 1개뿐이고 바코드·옵션 상품코드로 맞았고 그 옵션이 1개일 때만.
 *  자체코드(code2)·품목코드(pid)·상품명은 옵션이 정해지지 않으니 null(옵션 고르기).
 *  @returns {{ ci: number, oi: number } | null} ci = items 칸, oi = 그 후보 opts 칸 */
export function quickPick(items) {
    const arr = Array.isArray(items) ? items : [];
    if (arr.length !== 1) return null;
    const c = arr[0];
    if (!c || (c.match !== 'barcode' && c.match !== 'option')) return null;
    const pre = Array.isArray(c.pre) ? c.pre : [];
    if (pre.length !== 1) return null;
    const oi = (Array.isArray(c.opts) ? c.opts : []).findIndex(o => o && o.code === pre[0]);
    return oi === -1 ? null : { ci: 0, oi };
}

// ── 옵션 칩 묶기(2026-11-17) — 옵션이 많은 상품(100개 넘음)을 색상별로 묶고 사이즈 순서로 ──────
/** 옵션이 이보다 많으면 거르기 칸·묶음별 [전체]를 보인다. */
export const MANY_OPTIONS = 12;

const up = (v) => str(v).replace(/\s/g, '').toUpperCase();
const SIZE_ONE = /^(?:\d*X{0,4}S|M|\d*X{0,4}L|FREE|F|FREESIZE|ONESIZE|OS|프리|프리사이즈|\d+(?:\.\d+)?(?:CM|MM|IN|호|SIZE)?)$/;
/** 사이즈처럼 생긴 글자인가 — XS·M·2XL·FREE·프리·95·230mm·55호, 범위 S/M·230~240 도. */
export function isSizeToken(v) {
    const u = up(v);
    if (!u) return false;
    if (SIZE_ONE.test(u)) return true;
    const parts = u.split(/[/~]/);
    return parts.length > 1 && parts.every(p => SIZE_ONE.test(p));
}

/** 옵션명 → { color, size }. 상품 DB 옵션명은 '블랙-S'(가장 흔함)·'[블랙-S]'·'블랙 / M'(엑셀 양식 예)·'[블랙] M'·'블랙, M'·
 *  '색상-블랙, 사이즈-M'(직진 형식)처럼 온다. 못 나누면 통째로 color(사이즈처럼 생겼으면 size).
 *  나누는 글자는 '-' → '/' → ',' → 공백 순으로 보고, 마지막 조각이 사이즈처럼 생긴 첫 나눔을 쓴다. 없으면 '-'·'/'·',' 의 첫 조각이 색상. */
export function splitOption(option) {
    let s = str(option).trim();
    if (!s) return { color: '', size: '' };
    if (/(?:^|,)\s*(?:색상|사이즈)\s*[-:]/.test(s)) {   // 직진 형식
        let color = '';
        const rest = [];
        s.split(',').forEach(p => {
            const t = p.trim();
            if (!t) return;
            const m = t.match(/^색상\s*[-:]\s*(.*)$/);
            if (m && !color) { color = m[1].trim(); return; }
            rest.push(t.replace(/^(?:사이즈|기장별|기장)\s*[-:]\s*/, '').trim());
        });
        return { color, size: rest.filter(Boolean).join(' ') };
    }
    const br = s.match(/^\[([^\]]*)\]\s*(.*)$/);
    if (br) {
        const rest = br[2].replace(/^[\s/,-]+/, '').trim();
        if (rest) return { color: br[1].trim(), size: rest };   // '[블랙] M'
        s = br[1].trim();                                       // '[블랙-S]' → '블랙-S'
        if (!s) return { color: '', size: '' };
    }
    if (isSizeToken(s)) return { color: '', size: s };
    let fallback = null;
    for (const sep of ['-', '/', ',', ' ']) {
        const parts = (sep === ' ' ? s.split(/\s+/) : s.split(sep)).map(t => t.trim()).filter(Boolean);
        if (parts.length < 2) continue;
        const last = parts[parts.length - 1];
        if (isSizeToken(last) && !isSizeToken(parts[0])) {
            return { color: parts.slice(0, -1).join(sep === ' ' ? ' ' : sep), size: last };
        }
        if (!fallback && sep !== ' ') {
            fallback = parts.length === 2 && isSizeToken(parts[0]) && !isSizeToken(last)
                ? { color: last, size: parts[0] }   // 'M-블랙' 처럼 사이즈가 앞
                : { color: parts[0], size: parts.slice(1).join(sep) };
        }
    }
    return fallback || { color: s, size: '' };
}

/** 사이즈 순서 열쇠 [무리, 값] — 글자 사이즈(XS<S<M<L<XL<2XL…) → FREE → 숫자 오름차순 → 나머지(원래 순서). */
export function sizeRank(size) {
    const u = up(size);
    const m = u.match(/^(\d*)(X*)(S|M|L)$/);
    // '2XL' = 숫자 + X 하나(= XXL), 'XXL' = X 개수. '2XXL'·'XM' 은 사이즈로 안 본다
    if (m && !(m[1] && m[2].length > 1) && !(m[3] === 'M' && (m[1] || m[2]))) {
        const n = m[1] ? Number(m[1]) : m[2].length;
        return [0, m[3] === 'M' ? 0 : m[3] === 'S' ? -(1 + n) : 1 + n];
    }
    if (/^(?:FREE|F|FREESIZE|ONESIZE|OS|프리|프리사이즈)$/.test(u)) return [1, 0];
    const num = u.match(/^(\d+(?:\.\d+)?)/);
    if (num) return [2, Number(num[1])];
    const first = u.split(/[/~]/)[0];
    if (first && first !== u) { const r = sizeRank(first); if (r[0] < 3) return r; }   // 범위 'S/M' 은 앞쪽으로
    return [3, 0];
}

export function compareSize(a, b) {
    const ra = sizeRank(a), rb = sizeRank(b);
    return ra[0] - rb[0] || ra[1] - rb[1];
}

/** 후보 옵션(opts) → 색상 묶음. 묶음 순서 = 처음 나온 순서, 묶음 안 = 사이즈 순서(같으면 원래 순서). 사라진 옵션은 gone 으로 따로(원래 순서).
 *  grouped = 묶음 머리를 보일 만한가(색상이 2개 이상, 또는 색상 하나에 사이즈가 있음). 아니면 칩을 옵션 이름 그대로 한 줄로.
 *  @returns {{ groups: Array<{ color, items: Array<{ oi, color, size, label }> }>, gone: Array<{ oi, color, size, label }>, grouped: boolean }}
 *    oi = opts 칸 번호(화면 고르기 열쇠 'ci:oi' 그대로), label = 묶음 안 칩 글자(사이즈, 없으면 옵션 이름) */
export function groupOptions(opts) {
    const arr = Array.isArray(opts) ? opts : [];
    const byKey = new Map();
    const groups = [];
    const gone = [];
    arr.forEach((o, oi) => {
        if (!o) return;
        const sp = splitOption(o.option);
        const it = { oi, color: sp.color, size: sp.size, label: sp.size || str(o.option).trim() || '(옵션 없음)' };
        if (o.gone) { gone.push({ ...it, label: str(o.option).trim() || '(옵션 없음)' }); return; }
        const key = norm(sp.color);
        let g = byKey.get(key);
        if (!g) { g = { color: sp.color, items: [] }; byKey.set(key, g); groups.push(g); }
        g.items.push(it);
    });
    groups.forEach(g => g.items.sort((a, b) => compareSize(a.size, b.size)));
    const grouped = groups.length > 1 || (groups.length === 1 && !!groups[0].color && groups[0].items.some(i => i.size));
    if (!grouped) groups.forEach(g => g.items.forEach(i => { i.label = str(arr[i.oi].option).trim() || '(옵션 없음)'; }));
    return { groups, gone, grouped };
}

/** 옵션 거르기 — 띄어 쓴 낱말이 모두 맞아야 한다. 낱말 하나는 색상 일부, 사이즈와 똑같음, (2자 이상) 옵션 이름 일부, (3자 이상) 상품코드 일부 중 하나.
 *  opt = { option, code }(후보 opts 한 칸). 빈 거르기는 전부 맞음. */
export function optionMatches(opt, filter) {
    const terms = str(filter).trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const o = opt || {};
    const sp = splitOption(o.option);
    const color = norm(sp.color), size = norm(sp.size), name = norm(o.option), code = norm(o.code);
    return terms.every(t => color.includes(t) || size === t || (t.length >= 2 && name.includes(t)) || (t.length >= 3 && code.includes(t)));
}

/** 위치 요약(js/products-store.js locOf 결과) → { location: '피킹1, 피킹2', reserveLocation: '비축' } */
export function locFields(loc) {
    const L = loc || {};
    const spots = Array.isArray(L.spots) ? L.spots : [];
    const pick = [...new Set(spots.map(s => str(Array.isArray(s) ? s[0] : s).trim()).filter(Boolean))];
    const reserve = Array.isArray(L.reserve) ? str(L.reserve[1]).trim() : '';
    return { location: pick.join(', '), reserveLocation: reserve };
}

/** 검수 대기 줄 공통 모양 — undefined 칸을 두지 않는다(Firestore 가 거부). */
function baseItem({ code, name, option, thickness, location, reserveLocation, kind, inDb, now }) {
    return {
        code: str(code).trim(),
        name: str(name).trim(),
        option: str(option).trim(),
        qty: 0,
        thickness: str(thickness),
        supplierCode: '',
        supplierName: '',
        location: str(location),
        reserveLocation: str(reserveLocation),
        sampleLocation: null,
        status: '대기',
        packingDate: '',
        packNo: '',
        source: '',
        origin: 'manual',
        kind: isKind(kind) ? str(kind) : 'sample',
        inDb: !!inDb,
        addedAt: str(now),
    };
}

/** 상품 DB 후보 + 고른 옵션 하나 → 검수 대기 줄.
 *  name = historyName(상품코드로 찾은 이력 문서 id)이 있으면 그것, 없으면 상품 DB 상품명 그대로.
 *  loc = locOf(옵션 상품코드), thickness = 이력 문서 두께. */
export function manualItem(cand, opt, { kind, loc, thickness, historyName, now } = {}) {
    const c = cand || {};
    const o = opt || {};
    return baseItem({
        code: o.code, name: str(historyName).trim() || c.name, option: o.option,
        thickness, ...locFields(loc), kind, inDb: true, now,
    });
}

/** 상품 DB 에 없는 상품 직접 입력 → 줄. 상품명은 필수(없으면 null), `/` → `-`(이력 문서 id 와 같게). */
export function typedItem({ name, option, code, kind, thickness, now } = {}) {
    const nm = historyId(name);
    if (!nm) return null;
    return baseItem({ code, name: nm, option, thickness, location: '', reserveLocation: '', kind, inDb: false, now });
}

/** 전량검수 개별 추가(openManualAdd target 'total') — 상품 DB 후보 + 고른 옵션 → 진행 목록에 넣을 상품.
 *  상품명 규칙은 manualItem 과 같다(historyName 이 있으면 그것). 유형·두께는 없다. 진행 문서 모양은 js/lib/total-insp.js newTotalDoc. */
export function totalItemOf(cand, opt, { loc, historyName } = {}) {
    const c = cand || {};
    const o = opt || {};
    const name = historyId(str(historyName).trim() || c.name);
    if (!name) return null;
    return { name, option: str(o.option).trim(), code: str(o.code).trim(), location: locFields(loc).location, origin: 'manual' };
}

/** 전량검수 개별 추가 — 상품 DB 에 없는 상품 직접 입력. 상품명 필수(없으면 null), `/` → `-`. */
export function typedTotalItem({ name, option, code } = {}) {
    const nm = historyId(name);
    if (!nm) return null;
    return { name: nm, option: str(option).trim(), code: str(code).trim(), location: '', origin: 'typed' };
}

/** 개별 줄을 리스트에 붙인다(원본 배열 불변). 같은 상품명+옵션이 이미 있으면(상태 상관없이) 새로 넣지 않고 그 칸을 dup 에.
 *  이번에 넣는 것끼리도 겹치면 한 번만. 붙이는 자리는 끝(개별 줄은 맨 아래).
 *  @returns {{ list, added: number[], dup: number[], open: number }} added·dup = 리스트 칸 번호, open = 먼저 열 칸(-1 없음) */
export function addToList(existing, items) {
    const list = Array.isArray(existing) ? existing.slice() : [];
    const added = [], dup = [];
    (Array.isArray(items) ? items : []).forEach(it => {
        if (!it) return;
        const at = list.findIndex(ex => sameItem(ex, it));
        if (at !== -1) { if (!added.includes(at) && !dup.includes(at)) dup.push(at); return; }
        list.push(it);
        added.push(list.length - 1);
    });
    return { list, added, dup, open: added.length ? added[0] : (dup.length ? dup[0] : -1) };
}

/** [패킹에서 만들기] 카드를 리스트에 합친다(원본 배열 불변) — js/lib/insp-packs.js mergeList 와 같은 상품명+옵션 기준에 두 가지를 더했다.
 *  상품명 비교는 historyId 규칙(`/`→`-`) — mergeList 는 글자 그대로라, 이름에 `/` 가 든 경우만 결과가 다를 수 있다.
 *  ① 같은 상품명+옵션의 개별 줄이 아직 대기(완료 아님)·패킹 전이면 그 칸을 패킹 카드로 바꾼다 — origin·kind·inDb·addedAt 은 남기고,
 *     카드에 빈 칸(두께·위치·비축·샘플위치)은 개별 줄 값으로 채운다(사용자 결정 2026-11-17).
 *  ② 새 카드는 개별 줄(패킹 전) 앞에 넣는다 — 개별 줄이 늘 맨 아래.
 *  개별 줄이 없고 이름에 `/` 가 없으면 결과는 mergeList 와 같다(시험 tests/insp-manual.test.js).
 *  @returns {{ merged, added, skipped, replaced }} */
export function mergePackCards(existing, cards) {
    const merged = Array.isArray(existing) ? existing.slice() : [];
    let added = 0, skipped = 0, replaced = 0;
    (Array.isArray(cards) ? cards : []).forEach(card => {
        if (!card) return;
        const at = merged.findIndex(ex => sameItem(ex, card));
        if (at !== -1) {
            const ex = merged[at];
            if (isManualOnly(ex) && ex.status !== DONE) {
                const next = { ...card };
                ['thickness', 'location', 'reserveLocation', 'sampleLocation'].forEach(k => {
                    if (!str(next[k]) && str(ex[k])) next[k] = ex[k];
                });
                next.origin = 'manual';
                next.kind = isKind(ex.kind) ? str(ex.kind) : 'sample';
                if ('inDb' in ex) next.inDb = !!ex.inDb;
                if (ex.addedAt) next.addedAt = str(ex.addedAt);
                merged[at] = next;
                replaced++;
            } else {
                skipped++;
            }
            return;
        }
        const firstManual = merged.findIndex(isManualOnly);
        if (firstManual === -1) merged.push(card); else merged.splice(firstManual, 0, card);
        added++;
    });
    return { merged, added, skipped, replaced };
}

/** 이력 문서 고르기 — product_history where lastCode in [...] 결과 [{ id, lastCode }] 가운데
 *  고른 옵션 상품코드와 맞는 것 먼저, 없으면 첫 문서. 없으면 ''. */
export function pickHistoryByCode(docs, preferCodes) {
    const arr = (Array.isArray(docs) ? docs : []).filter(d => d && str(d.id));
    if (!arr.length) return '';
    const pref = new Set((Array.isArray(preferCodes) ? preferCodes : []).map(c => str(c).trim()).filter(Boolean));
    const hit = arr.find(d => pref.has(str(d.lastCode).trim()));
    return str((hit || arr[0]).id);
}

/** lastCode 조회에 넣을 코드 — 고른 옵션 상품코드 → code2 → pid → 나머지 옵션 상품코드 순으로 겹침 없이 최대 30개(Firestore 'in' 한도). */
export function historyCodes(cand, selectedCodes, max = 30) {
    const c = cand || {};
    const out = [];
    const push = (v) => { const s = str(v).trim(); if (s && !out.includes(s)) out.push(s); };
    (Array.isArray(selectedCodes) ? selectedCodes : []).forEach(push);
    push(c.code2);
    push(c.pid);
    (Array.isArray(c.opts) ? c.opts : []).forEach(o => push(o && o.code));
    return out.slice(0, max);
}
