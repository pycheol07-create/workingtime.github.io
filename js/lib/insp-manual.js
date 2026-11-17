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
