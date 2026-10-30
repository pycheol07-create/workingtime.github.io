// === js/lib/insp-packs.js ===
// 샘플검수 '패킹에서 만들기'(js/inspection-packs.js)의 순수 함수 — import 는 같은 lib 의 insp-day.js·multi-loc.js 만(node --test 대상).
// 문서는 미발계산기2 수집기(미발수집_apps_script.gs)가 쓴다. 모양:
//   integrations/inspPacks { schemaVer:1, ok, error, updatedAt, asOf, keepArrivedDays, shipStaleDays,
//                            counts:{packs, items, noSup, supNotCode, nonStd, dropped, zeroQty, conflicts, badShip},
//                            badShip = 출고일 값을 읽지 못해 빠진 행 수
//                            packsJson: '{"20261015-1":{"sd","ad","eta","part","src","it":[[code,name,option,qty,sup],…]},…}' }
//   sup 은 공급처 '코드'(AA9999 모양 — 수집기가 거른 값을 그대로 씀)만 — 실명은 오지 않고, 만든 항목에도 supplierName 은 빈칸으로 둔다(CLAUDE.md 3절).
// 1장 기준은 엑셀 업로드(js/inspection-excel.js)와 같다: 공급처::색상 1장, 그 묶음의 첫 품목이 대표.
// 엑셀 한 파일 = 패킹 하나로 보고 패킹마다 따로 묶는다.

import { dayInspItems } from './insp-day.js?v=202610301845';
import { reserveLocIds, normLocId } from './multi-loc.js?v=202610301845';

export const COUNT_KEYS = ['packs', 'items', 'noSup', 'supNotCode', 'nonStd', 'dropped', 'zeroQty', 'conflicts', 'badShip'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const SUP_CODE_RE = /^[A-Z]{2}[0-9]{4}$/;   // 수집기와 같은 모양(AA9999). 아니면 웹에서도 버린다(실명이 섞여 와도 저장하지 않게)

const str = (v) => (v == null ? '' : String(v)).trim();

/** Firestore Timestamp·Date·숫자(ms)·ISO 문자열 → ms. 못 읽으면 0. */
function tsMs(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (v instanceof Date) return v.getTime() || 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000 + Math.floor((v.nanoseconds || 0) / 1e6);
    if (typeof v === 'string') { const t = Date.parse(v); return Number.isFinite(t) ? t : 0; }
    return 0;
}

/** inspPacks 문서 → { packs, updatedAtMs, counts, error, ok }. JSON 이 깨지면 빈 목록 + error. */
export function parseInspPacks(data) {
    const counts = {};
    COUNT_KEYS.forEach(k => { counts[k] = 0; });
    const out = { packs: [], updatedAtMs: 0, counts, error: '', ok: false };
    if (!data || typeof data !== 'object') { out.error = '패킹 목록이 아직 없습니다.'; return out; }
    out.updatedAtMs = tsMs(data.updatedAt);
    const c = data.counts || {};
    COUNT_KEYS.forEach(k => { counts[k] = Number(c[k]) || 0; });
    out.ok = data.ok !== false;
    if (!out.ok) { out.error = str(data.error) || '수집 실패'; return out; }
    let obj;
    try { obj = JSON.parse(data.packsJson || '{}'); } catch (e) { out.error = '패킹 목록을 읽지 못했습니다(형식 오류).'; return out; }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { out.error = '패킹 목록을 읽지 못했습니다(형식 오류).'; return out; }
    Object.keys(obj).forEach(no => {
        const p = obj[no] || {};
        const items = (Array.isArray(p.it) ? p.it : []).filter(Array.isArray).map(r => ({
            code: str(r[0]), name: str(r[1]), option: str(r[2]), qty: Number(r[3]) || 0, supCode: SUP_CODE_RE.test(str(r[4])) ? str(r[4]) : ''
        }));
        out.packs.push({
            no: str(no), shipDate: str(p.sd), arriveDate: str(p.ad), eta: str(p.eta),
            partial: !!p.part, src: str(p.src), items
        });
    });
    // 미도착 먼저, 그 안에서 출고일 최근 순(같으면 패킹번호 내림차순)
    out.packs.sort((a, b) => {
        const da = a.arriveDate ? 1 : 0, dbv = b.arriveDate ? 1 : 0;
        if (da !== dbv) return da - dbv;
        if (a.shipDate !== b.shipDate) return a.shipDate < b.shipDate ? 1 : -1;
        return a.no < b.no ? 1 : a.no > b.no ? -1 : 0;
    });
    return out;
}

/** 옵션 → 색상 키. inspection-excel.js 의 color/keyColor 규칙과 같다. */
export function colorOf(option) {
    let color = String(option == null ? '' : option).trim().replace(/\[|\]/g, '').split('-')[0].trim();
    if (!color) color = 'N/A';
    return color.replace(/\s/g, '').toLowerCase();
}

/** 1장 묶음 키 — 공급처코드::색상. 코드가 없으면 상품명으로 묶는다('::색' 하나로 뭉치지 않게). */
export function cardKey(item) {
    const sup = str(item && item.supCode);
    const head = sup ? sup.replace(/\s/g, '').toLowerCase()
                     : 'nm:' + str(item && item.name).replace(/\s/g, '').toLowerCase();
    return head + '::' + colorOf(item && item.option);
}

/** 샘플위치 매칭 키. inspection-excel.js getCleanKey 와 같다. */
export function cleanKey(name, option) {
    const cleanName = String(name || '').replace(/\(매칭금지-제작샘플\)/g, '').replace(/\s/g, '').trim().toLowerCase();
    const cleanOption = String(option || '').replace(/촬샘-/g, '').replace(/\s/g, '').trim().toLowerCase();
    return cleanName + cleanOption;
}

/** 로케이션관리 샘플 매칭 키 — '[' ']' 를 지운 뒤 cleanKey. 패킹 옵션은 [블랙-S], 로케이션 옵션은 블랙-S 일 수 있다.
 *  지난 검수 이력 매칭(sampleByKey)은 cleanKey 그대로. */
export function locSampleKey(name, option) {
    const strip = (v) => String(v || '').replace(/\[|\]/g, '');
    return cleanKey(strip(name), strip(option));
}

/** 로케이션관리 샘플 '이름+색상' 키 — 샘플은 보통 한 사이즈만 있어 옵션이 정확히 같지 않을 때 쓴다. 색상은 colorOf(촬샘- 제거). */
export function locColorKey(name, option) {
    return locSampleKey(name, '') + '::' + colorOf(String(option == null ? '' : option).replace(/촬샘-/g, ''));
}

/** 이미 검수했나 비교 키 — 상품명(product_history 문서 id 처럼 '/'→'-')+색상+패킹일. 사이즈는 보지 않는다(카드 1장 = 색상, 검수는 한 사이즈만 하므로) */
export function inspectedKey(name, option, packingDate) {
    return locColorKey(String(name == null ? '' : name).replace(/\//g, '-'), option) + '|' + str(packingDate).slice(0, 10);
}

/** product_history 문서들 [{id(상품명), logs:[{option, packingDate, date}]}] → 검수한 키 Set(inspectedKey). 사전등록 기록은 뺀다 */
export function inspectedKeysFromHistory(docs) {
    const out = new Set();
    (Array.isArray(docs) ? docs : []).forEach(d => {
        const name = str(d && d.id);
        if (!name) return;
        (Array.isArray(d.logs) ? d.logs : []).forEach(l => {
            if (!l || !str(l.packingDate) || str(l.date).includes('사전등록')) return;
            out.add(inspectedKey(name, l.option, l.packingDate));
        });
    });
    return out;
}

/** 패킹 하나 → { done: 이미 검수한 장수, total: 장수 } — 카드(buildCards) 기준. keys 가 없으면 null(아직 모름).
 *  패킹일은 카드 값(출고일 우선)과 패킹번호 앞 8자리 둘 다 본다 — 엑셀 업로드로 검수한 옛 기록은 패킹일을 파일 이름(패킹번호 날짜)에서 가져왔다. */
export function packInspected(pack, keys, today) {
    if (!(keys instanceof Set)) return null;
    const cards = buildCards([pack], null, today || '');
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(str(pack && pack.no));
    const noDay = m ? `${m[1]}-${m[2]}-${m[3]}` : '';
    const hit = (c) => keys.has(inspectedKey(c.name, c.option, c.packingDate))
        || (noDay && noDay !== c.packingDate && keys.has(inspectedKey(c.name, c.option, noDay)));
    return { done: cards.filter(hit).length, total: cards.length };
}

/** 패킹일: 출고일(YYYY-MM-DD) → 패킹번호 앞 8자리 → today */
export function packingDateOf(pack, today) {
    const sd = str(pack && pack.shipDate).slice(0, 10);
    if (DATE_RE.test(sd)) return sd;
    const m = /^(\d{4})(\d{2})(\d{2})/.exec(str(pack && pack.no));
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return str(today);
}

/** product_history 문서 → 마지막(date,time 순) 비어 있지 않은 checklist.thickness. 없으면 '' */
export function thicknessFromHistoryDoc(doc) {
    const logs = (doc && Array.isArray(doc.logs)) ? doc.logs.slice() : [];
    logs.sort((a, b) => {
        const ka = str(a && a.date) + ' ' + str(a && a.time), kb = str(b && b.date) + ' ' + str(b && b.time);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });
    let t = '';
    logs.forEach(l => {
        const v = str(l && l.checklist && l.checklist.thickness);
        if (v) t = v;
    });
    return t;
}

/** 날짜별 이력(State.allHistoryData: [{id:'YYYY-MM-DD', inspectionList:[…]}]) → 최근 값 참조표 */
export function refsFromDays(allHistoryData) {
    const refs = { thickByDoc: new Map(), sampleByKey: new Map(), sampleByName: new Map(), thickByName: new Map() };
    const days = (Array.isArray(allHistoryData) ? allHistoryData : []).filter(d => d && dayInspItems(d).length > 0);
    days.sort((a, b) => (str(a.id) < str(b.id) ? 1 : str(a.id) > str(b.id) ? -1 : 0));
    days.forEach(d => {
        dayInspItems(d).forEach(it => {
            if (!it) return;
            const name = str(it.name);
            if (!name) return;
            const sl = str(it.sampleLocation);
            if (sl) {
                const k = cleanKey(name, it.option);
                if (!refs.sampleByKey.has(k)) refs.sampleByKey.set(k, sl);
                const nk = cleanKey(name, '');
                if (!refs.sampleByName.has(nk)) refs.sampleByName.set(nk, sl);
            }
            const th = str(it.thickness);
            if (th && !refs.thickByName.has(name)) refs.thickByName.set(name, th);
        });
    });
    return refs;
}

const SAMPLE_NAME_MARK = '(매칭금지-제작샘플)';
const SAMPLE_OPT_MARK = '촬샘-';
const SAM_ID_RE = /^SAM/i;

/** 샘플 자리인가 — 이름에 '(매칭금지-제작샘플)' · 옵션에 '촬샘-' · 자리 id 가 SAM 으로 시작(china-stock-goods.js 샘플위치와 같은 기준).
 *  대분류 '기타' 만으로는 고르지 않는다 — 비축 자리(옵션추가항목1)에 일반 상품이 같은 이름으로 들어 있다. */
export function isSampleLoc(loc) {
    if (!loc) return false;
    return str(loc.name).includes(SAMPLE_NAME_MARK) || str(loc.option).includes(SAMPLE_OPT_MARK) || SAM_ID_RE.test(str(loc.id));
}

/** 로케이션관리 자리 목록([{id,name,option,category}]) → { byKey, byColor, byName } (각각 Map(키 → 자리 id)).
 *  byKey = locSampleKey(이름+옵션) · byColor = locColorKey(이름+색상) · byName = locSampleKey(이름). 모두 괄호 무시.
 *  같은 키가 여러 자리면 정렬해 ', ' 로 잇는다. */
export function samplesFromLocations(locItems) {
    const acc = { byKey: new Map(), byColor: new Map(), byName: new Map() };
    const add = (m, k, id) => { if (!m.has(k)) m.set(k, new Set()); m.get(k).add(id); };
    (Array.isArray(locItems) ? locItems : []).forEach(loc => {
        if (!isSampleLoc(loc)) return;
        const id = str(loc.id), name = str(loc.name);
        if (!id || !name) return;
        add(acc.byKey, locSampleKey(name, loc.option), id);
        add(acc.byColor, locColorKey(name, loc.option), id);
        add(acc.byName, locSampleKey(name, ''), id);
    });
    const join = (m) => { const out = new Map(); m.forEach((ids, k) => out.set(k, [...ids].sort().join(', '))); return out; };
    return { byKey: join(acc.byKey), byColor: join(acc.byColor), byName: join(acc.byName) };
}

/** 피킹용이 아닌 자리(비축·SAM·대분류 '기타') — js/location.js isEtcLocation 과 같은 기준 */
export function isReserveLoc(loc) {
    const id = str(loc && loc.id);
    return str(loc && loc.category || '피킹용') === '기타' || /^비축/.test(id) || /^SAM/i.test(id);
}

/** 로케이션관리 자리 목록([{id, code, category, opt1}]) → Map(상품코드 → {pick: 자리 id[], reserve: 자리 id[]}).
 *  pick = 그 코드가 든 피킹 자리. reserve = 다중 위치 화면과 같은 출처(reserveLocIds — 상품 행 옵션추가항목1 + 그 코드가 든 비축 칸).
 *  opt1 은 옵션추가항목1 값 하나만 받는다(엑셀 행 전체 rawData 는 공급처 열이 섞여 받지 않는다). */
export function locsByCode(locItems) {
    const all = (Array.isArray(locItems) ? locItems : []).filter(l => l && str(l.id));
    const locById = new Map(all.map(l => [normLocId(l.id), l]));
    const rowsByCode = new Map();
    all.forEach(l => {
        const code = str(l.code);
        if (!code || code === str(l.id)) return;            // 코드 칸에 자리 id 가 든 것은 빈 자리
        if (!rowsByCode.has(code)) rowsByCode.set(code, []);
        rowsByCode.get(code).push({ id: str(l.id), category: l.category, rawData: { 옵션추가항목1: str(l.opt1) } });
    });
    const out = new Map();
    rowsByCode.forEach((rows, code) => {
        const pick = [...new Set(rows.filter(l => !isReserveLoc(l)).map(l => l.id))].sort((a, b) => a.localeCompare(b));
        out.set(code, { pick, reserve: reserveLocIds(rows, locById, isReserveLoc) });
    });
    return out;
}

const getRef = (m, k) => (m && typeof m.get === 'function' && m.has(k)) ? m.get(k) : undefined;

/** 패킹 품목 → 검수 대기 항목. 항목에 undefined 필드를 두지 않는다(Firestore 가 거부). */
export function buildCards(packs, refs, today) {
    const r = refs || {};
    const out = [];
    (Array.isArray(packs) ? packs : []).forEach(pack => {
        const seen = new Set();
        const packingDate = packingDateOf(pack, today);
        (pack.items || []).forEach(it => {
            const code = str(it.code), name = str(it.name), option = str(it.option);
            if (!code && !name) return;
            const key = cardKey({ supCode: it.supCode, name, option });
            if (seen.has(key)) return;
            seen.add(key);
            const thickness = getRef(r.thickByDoc, name) || getRef(r.thickByName, name) || '';
            // 샘플위치: 로케이션관리(지금 위치) 이름+옵션 → 이름+색상 → 이름 → 지난 검수 cleanKey → 상품명 → null
            const sampleLocation = getRef(r.sampleByLoc, locSampleKey(name, option)) || getRef(r.sampleByLocColor, locColorKey(name, option))
                || getRef(r.sampleByLocName, locSampleKey(name, ''))
                || getRef(r.sampleByKey, cleanKey(name, option)) || getRef(r.sampleByName, cleanKey(name, '')) || null;
            // 로케이션(로케이션관리 지금 위치) = 이 카드의 상품코드(SKU) 하나의 자리만(같은 색 다른 사이즈 자리는 넣지 않는다).
            //   피킹은 카드에 늘 보이고, 비축은 '새창으로 보기'에서만(js/lib/insp-flow.js todoCardHtml)
            const loc = (code && getRef(r.locByCode, code)) || { pick: [], reserve: [] };
            out.push({
                code, name, option, qty: Number(it.qty) || 0,
                thickness: String(thickness),
                supplierCode: str(it.supCode),
                supplierName: '',
                location: loc.pick.join(', '),
                reserveLocation: loc.reserve.join(', '),
                sampleLocation,
                status: '대기',
                packingDate,
                packNo: str(pack.no)
            });
        });
    });
    return out;
}

const sameItem = (a, b) => a.name === b.name && a.option === b.option;

/** 기존 목록에 name+option 이 같은 항목은 뺀다(엑셀 업로드와 같은 기준). 이번에 넣은 것과도 비교한다(패킹 두 개에 같은 품목). */
export function mergeList(existing, items) {
    const merged = Array.isArray(existing) ? existing.slice() : [];
    let added = 0, skipped = 0;
    (Array.isArray(items) ? items : []).forEach(it => {
        if (merged.some(ex => ex && sameItem(ex, it))) { skipped++; return; }
        merged.push(it);
        added++;
    });
    return { merged, added, skipped };
}

/** 미리보기 장수 — 참조표 없이 buildCards 를 돌린 길이. { total, byPack: {패킹번호: 장수} } */
export function previewCount(packs) {
    const byPack = Object.create(null);
    let total = 0;
    (Array.isArray(packs) ? packs : []).forEach(p => {
        const n = buildCards([p], null, '').length;
        byPack[p.no] = n;
        total += n;
    });
    return { total, byPack };
}

/** 업무 예상 — 도착일별 샘플검수 장수(2026-10-21). '패킹에서 만들기'와 같은 기준(공급처코드::색상 1장, 같은 날 같은 상품명+옵션은 1장).
 *  도착일 = 본사도착일(ad, 전부 도착) → arrivalOf(패킹일)(입고일정 시트) → 도착예상일(eta). 셋 다 없으면 뺀다.
 *  입고일정에 같은 패킹일이 여러 날로 나뉘어 있으면(arrivalOf 가 배열) 그 날마다 이 패킹 장수를 다 센다 —
 *  어느 품목이 어느 날 오는지 알 수 없어 많게 잡는다(예전 비율 계산이 둘째 날에 또 붙던 것보다 낫다).
 *  일부만 도착한 패킹(partial)은 남은 분량이 언제 오는지 알 수 없어 뺀다.
 *  @param arrivalOf (YYYY-MM-DD 패킹일) → 도착일 YYYY-MM-DD 또는 그 배열 또는 '' (없으면 생략 가능)
 *  @returns {{[date:string]: {count:number, packs:string[]}}} */
export function sampleCardsByArrival(packs, arrivalOf) {
    const byDate = Object.create(null);
    (Array.isArray(packs) ? packs : []).forEach(p => {
        if (!p || p.partial) return;
        const pd = packingDateOf(p, '');
        let dates = [];
        if (str(p.arriveDate)) dates = [str(p.arriveDate)];
        else {
            const a = (typeof arrivalOf === 'function' && pd) ? arrivalOf(pd) : '';
            dates = (Array.isArray(a) ? a : [a]).map(str).filter(Boolean);
            if (!dates.length && str(p.eta)) dates = [str(p.eta)];
        }
        dates.filter(d => DATE_RE.test(d)).forEach(d => { (byDate[d] = byDate[d] || []).push(p); });
    });
    const out = {};
    Object.keys(byDate).forEach(d => {
        const ps = byDate[d];
        out[d] = { count: mergeList([], buildCards(ps, null, '')).added, packs: ps.map(p => p.no) };
    });
    return out;
}

/** 이 패킹의 장 가운데 지금 목록에 이미 있는 것(name+option) 개수 */
export function existingCount(pack, existing) {
    const list = Array.isArray(existing) ? existing : [];
    return buildCards([pack], null, '').filter(c => list.some(ex => ex && sameItem(ex, c))).length;
}
