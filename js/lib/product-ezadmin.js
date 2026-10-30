// === js/lib/product-ezadmin.js ===
// 상품 관리 — 이지어드민 '상품정보' 엑셀을 양식 변환 없이 바로 읽기. 2026-10-14. 설계: 이지어드민상품엑셀_설계.md
//
// 이지어드민 파일 = 옵션 1행씩, 머리글 16열(공급처·상품코드·로케이션·상품명·옵션·…·대표상품코드).
// 머리글 서명(EZ_SIGNATURE 7개)이 모두 있으면 이 파일로 인식한다(detectEzadmin). 업로드는 한 창에서 두 단계:
//   1) 기본정보 — 우리 양식과 같은 CATALOG_COLS + forbid(원가·공급처·추가항목2·비축창고재고 열은 읽지 않음)
//      + ezCatalogFixup(대표상품코드가 빈 행 = 단독 상품, 품목코드 = 상품코드) + 등록일은 가장 이른 날짜
//   2) 원가 — EZ_COST_COLS(대표상품코드·상품코드·옵션·추가항목2(위안)·비축창고재고(달러)·원가(원화)·공급처)
//      → diffEzCost. 글로 적힌 단가는 product-price-text.js 로 옵션별 단가, 확정 못 하면 원가메모에 원문 + '확인 필요'.
// 열 이름과 실제 뜻이 다르다(사용자 확정): 추가항목2 = 위안 단가, 비축창고재고 = 달러 단가, 원가 = 원화 원가.
// 빈 칸 = 바꾸지 않음(이지어드민 파일로 값을 지우지 않는다). 파일에 없는 옵션의 개별값은 보존.
//
// 순수 모듈(DOM/Firebase 의존 없음). ⚠️ 🔒 원가·공급처·단가 원문을 console·미리보기·결과 엑셀에 내지 말 것 —
//    경고·정보는 건수·사유 라벨만. 원문은 원가메모(관리자 전용 문서)에만 들어간다.
import { parsePriceText } from './product-price-text.js?v=202610301140';
import {
    normHeader, cellStr, HEADER_SCAN_ROWS, groupCatalogRows, isSupCode, normSup, emptyCost, diffCostObj, countStatus, MEMO_MAX
} from './product-excel-rows.js?v=202610301140';
import { isValidCode } from './product-bucket.js?v=202610301140';
import { normalizePrice, samePrice, round2, parseNum } from './product-price.js?v=202610301140';

/** 이 머리글이 한 행에 모두 있으면 이지어드민 상품 엑셀 */
export const EZ_SIGNATURE = ['대표상품코드', '상품코드', '옵션', '원가', '추가항목2', '비축창고재고', '공급처'];

/** 원가 단계에서 읽는 열 — 나머지(로케이션·정상재고·원가합·추가항목1·옵션추가항목1·공급처상품명 등)는 읽지 않는다 */
export const EZ_COST_COLS = [
    { key: 'pid', name: '대표상품코드', aliases: [], required: true },
    { key: 'scode', name: '상품코드', aliases: [], required: true },
    { key: 'optName', name: '옵션', aliases: [] },
    { key: 'cnyRaw', name: '추가항목2', aliases: [] },          // 위안 단가(¥ 글자 또는 숫자)
    { key: 'usdRaw', name: '비축창고재고', aliases: [] },       // 달러 단가(이름과 다름)
    { key: 'krw', name: '원가', aliases: [] },                  // 원화 원가(정수)
    { key: 'sup', name: '공급처', aliases: [] },
];

// 단위 검사(원화 ÷ 위안, 원화 ÷ 달러) — 이 밖이면 '달러를 위안 칸에 적은 듯' 확인 필요
export const KRW_PER_CNY_MIN = 100, KRW_PER_CNY_MAX = 700;
export const KRW_PER_USD_MIN = 700, KRW_PER_USD_MAX = 5000;

/** 원가메모 표식 — 이 뒤는 업로드 때마다 새로 단다(앞부분은 사람이 쓴 메모, 보존) */
export const MEMO_MARK = '⚑단가확인:';

/** aoa 위 HEADER_SCAN_ROWS 행 중 서명 7개가 모두 있는 행 → { row } | null */
export function detectEzadmin(aoa) {
    const want = EZ_SIGNATURE.map(normHeader);
    const limit = Math.min(HEADER_SCAN_ROWS, (aoa || []).length);
    for (let r = 0; r < limit; r++) {
        const have = new Set((aoa[r] || []).map(h => normHeader(cellStr(h))));
        if (want.every(w => have.has(w))) return { row: r };
    }
    return null;
}

// ─────────────────────────────────────────────────────────────
// 기본정보 단계 보정
// ─────────────────────────────────────────────────────────────

/**
 * readRows 결과 행 → 단독 상품 보정. → { rows(새 배열), errors: Map(pid → [메시지]) }
 *  · 대표상품코드가 비고 상품코드가 숫자뿐 → 단독 상품: 품목코드 = 상품코드(옵션 1개)
 *  · 그 코드가 파일 안 다른 행의 대표상품코드와 같으면 오류(두 품목이 한 품목코드로 섞임)
 *  · 대표상품코드가 비고 상품코드가 숫자 아님 → 그대로(groupCatalogRows 가 '품목코드 비어 있음' 오류)
 */
export function ezCatalogFixup(rows) {
    const pids = new Set();
    for (const { v } of rows) if (v.pid) pids.add(v.pid);
    const errors = new Map();
    const out = rows.map(({ r, v }) => {
        if (v.pid || !/^\d+$/.test(v.scode || '')) return { r, v };
        if (pids.has(v.scode)) {
            if (!errors.has(v.scode)) errors.set(v.scode, []);
            const msg = `${r}행: 단독 상품코드가 다른 품목의 대표상품코드와 같음`;
            errors.get(v.scode).push(msg);
        }
        return { r, v: { ...v, pid: v.scode } };
    });
    return { rows: out, errors };
}

/** 기본정보 단계: 보정 → 품목 묶기(등록일 = 가장 이른 날짜) → 보정 오류 붙이기 */
export function ezCatalogGroups(rows) {
    const fx = ezCatalogFixup(rows);
    const groups = groupCatalogRows(fx.rows, { regDate: 'min' });
    for (const [pid, msgs] of fx.errors) {
        const g = groups.get(pid);
        if (g) for (const m of msgs) if (!g.errors.includes(m)) g.errors.push(m);
    }
    return groups;
}

// ─────────────────────────────────────────────────────────────
// 원가 단계
// ─────────────────────────────────────────────────────────────

/**
 * 옵션 값들 → 기본값 + 개별값. values = [{ scode, v }] (파일 순서), same(a, b) = 같은 값인가
 * 기본값 = 가장 많은 값(동률이면 파일에서 먼저 나온 것), 개별값 = 기본값과 다른 옵션만.
 * → { base, o: { scode: v } }
 */
export function splitBaseOverrides(values, same = samePrice) {
    const kinds = [];                                   // [{ v, n }] 첫 등장 순서
    for (const x of values) {
        const k = kinds.find(k => same(k.v, x.v));
        if (k) k.n++; else kinds.push({ v: x.v, n: 1 });
    }
    if (!kinds.length) return { base: null, o: {} };
    let best = kinds[0];
    for (const k of kinds) if (k.n > best.n) best = k;
    const o = {};
    for (const x of values) if (!same(best.v, x.v)) o[x.scode] = x.v;
    return { base: best.v, o };
}

/** 새 단가의 입력 통화 값이 기존과 같으면 기존 객체 그대로(기준일·환율만 바뀐 헛'변경' 막기) */
function keepSame(nw, old) {
    if (!nw || !old || old.src !== nw.src) return nw;
    const eq = (k) => round2(nw[k]) === round2(old[k]);
    const same = nw.src === 'cny' ? eq('cny') : nw.src === 'usd' ? eq('usd') : (eq('cny') && eq('usd'));
    return same ? old : nw;
}

const oneLine = (s) => String(s).replace(/\s+/g, ' ').trim();

/** 원가메모에서 표식 블록을 뗀 앞부분 */
export function stripCheckMemo(memo) {
    const s = memo || '';
    const i = s.indexOf(MEMO_MARK);
    return i < 0 ? s : s.slice(0, i).trimEnd();
}

/**
 * 원가메모 끝에 표식 블록을 단다(있던 블록은 교체). → { memo, cut: 원문을 줄였는가 }
 * 형식: `기존메모 ⚑단가확인: 위안칸「원문」 달러칸「원문」` (한 줄)
 */
export function withCheckMemo(memo, cnyRaws, usdRaws, max = MEMO_MAX) {
    const head = stripCheckMemo(memo);
    const parts = [];
    if (cnyRaws.length) parts.push('위안칸' + cnyRaws.map(x => `「${oneLine(x)}」`).join(''));
    if (usdRaws.length) parts.push('달러칸' + usdRaws.map(x => `「${oneLine(x)}」`).join(''));
    const body = parts.join(' ');
    const lead = head ? head + ' ' + MEMO_MARK + ' ' : MEMO_MARK + ' ';
    if ((lead + body).length <= max) return { memo: (lead + body).trimEnd(), cut: false };
    const room = max - lead.length - 1;
    if (room >= 0) return { memo: lead + body.slice(0, room) + '…', cut: true };
    // 사람이 쓴 메모만으로 거의 꽉 참 — 앞부분을 줄여 표식만 단다
    const tail = ' ' + MEMO_MARK + '…';
    return { memo: head.slice(0, max - tail.length) + tail, cut: true };
}

/**
 * 품목 하나의 이지어드민 원가 행 → 새 원가 객체.
 *  list    : [{ r, v: { scode, optName, cnyRaw, usdRaw, krw, sup } }] (파일 순서)
 *  cur     : 지금 원가 객체 | null
 *  ctx     : { ledger: Set(공급처코드), defaults: { rate, rateDate } }
 * → { next, warnings, infos, checks: [사유 코드], newSup: 코드|'' }
 *  단가에 확인할 것이 있으면 base·o 는 그대로 두고 원화·공급처·메모만 바꾼다.
 */
export function buildEzCost(list, cur, { ledger = new Set(), defaults = {} } = {}) {
    const warnings = [], infos = [], checks = new Set();
    const next = cur
        ? { ...cur, base: cur.base ? { ...cur.base } : null, krw: cur.krw ?? null, o: { ...(cur.o || {}) }, ok: { ...(cur.ok || {}) } }
        : emptyCost();
    const opts = list.map(({ v }) => ({
        scode: v.scode, name: v.optName || '', cnyRaw: v.cnyRaw || '', usdRaw: v.usdRaw || '', krwRaw: v.krw || '', sup: v.sup || ''
    }));

    // ── 원화 ──
    let badKrw = 0;
    const kv = opts.map(o => {
        if (o.krwRaw === '') return null;
        const n = parseNum(o.krwRaw);
        if (n === null) return null;
        if (!Number.isInteger(n) || n < 0) { badKrw++; return null; }
        return n;
    });
    if (badKrw) warnings.push(`원화 원가가 0 이상 정수가 아닌 옵션 ${badKrw}개 — 그 옵션은 그대로 둠`);
    const given = opts.map((o, i) => ({ scode: o.scode, v: kv[i] })).filter(x => x.v !== null);
    if (given.length) {
        const nz = given.filter(x => x.v > 0);
        if (!nz.length) infos.push('원화 0 — 그대로 둠');
        else {
            const { base } = splitBaseOverrides(nz, (a, b) => a === b);
            next.krw = base;
            for (const x of given) { if (x.v === base) delete next.ok[x.scode]; else next.ok[x.scode] = x.v; }
            const zeros = given.length - nz.length;
            if (zeros) warnings.push(`원화 0 인 옵션 ${zeros}개`);
        }
    }

    // ── 단가: 칸마다 원문이 같은 옵션끼리 묶어 해석 ──
    //   bareCny   = 위안 칸이 기호 없는 숫자 하나(칸 화폐로 위안이 된 값)
    //   usdColCny = 달러 칸에서 나온 ￥(위안) 값들 — 둘이 함께면 '칸 뒤바뀜' 후보
    const got = opts.map(() => ({ cny: [], usd: [], bareCny: null, usdColCny: [] }));
    for (const [col, colCur] of [['cnyRaw', 'cny'], ['usdRaw', 'usd']]) {
        const byRaw = new Map();
        opts.forEach((o, i) => { if (!byRaw.has(o[col])) byRaw.set(o[col], []); byRaw.get(o[col]).push(i); });
        for (const [raw, idx] of byRaw) {
            const res = parsePriceText(raw, colCur, idx.map(i => opts[i].name));
            if (res.kind === 'blank') continue;
            if (res.kind === 'single' && res.def.val === 0) continue;          // 0·'¥0' = 단가 없음(빈칸과 같게)
            if (res.kind === 'check') { res.reasons.forEach(x => checks.add(x)); continue; }
            const bare = col === 'cnyRaw' && res.kind === 'single' && /^\d+(\.\d+)?$/.test(String(raw).trim());
            idx.forEach((i, j) => {
                const p = res.perOpt[j];
                got[i][p.cur].push(p.val);
                if (bare) got[i].bareCny = p.val;
                if (col === 'usdRaw' && p.cur === 'cny') got[i].usdColCny.push(p.val);
            });
        }
    }
    /** 위안 칸 기호 없는 숫자 + 달러 칸 ￥ 값 → 원화로 단위가 둘 다 맞을 때만 뒤바뀜으로 확정. → {cny, usd} | null */
    const swapFix = (g, k) => {
        if (g.bareCny === null || g.usd.length || !(k > 0)) return null;
        const yen = [...new Set(g.usdColCny.map(round2))];
        if (yen.length !== 1) return null;
        const cnyVals = new Set(g.cny.map(round2));
        if (cnyVals.size !== 2 || !cnyVals.has(round2(g.bareCny)) || !cnyVals.has(yen[0])) return null;
        const okCny = k / yen[0] >= KRW_PER_CNY_MIN && k / yen[0] <= KRW_PER_CNY_MAX;
        const okUsd = k / g.bareCny >= KRW_PER_USD_MIN && k / g.bareCny <= KRW_PER_USD_MAX;
        return okCny && okUsd ? { cny: yen[0], usd: round2(g.bareCny) } : null;
    };
    let swapped = 0;
    const prices = opts.map(() => null);
    if (!checks.size) {
        const inp = got.map((g, i) => {
            if (new Set(g.cny.map(round2)).size > 1) {
                const fx = swapFix(g, kv[i]);
                if (fx) { swapped++; return fx; }
            }
            const pick = (arr) => {
                const u = [...new Set(arr.map(round2))];
                if (u.length > 1) checks.add('COL_CONFLICT');
                return u.length ? u[0] : null;
            };
            return { cny: pick(g.cny), usd: pick(g.usd) };
        });
        const has = inp.map(x => x.cny !== null || x.usd !== null);
        if (has.some(Boolean) && !has.every(Boolean)) checks.add('PARTIAL_BLANK');
        if (!checks.size) {
            inp.forEach((x, i) => {
                if (!has[i]) return;
                const r = normalizePrice({ cny: x.cny, usd: x.usd, rate: null }, defaults);
                if (r.errors.length || !r.price) { checks.add('RATE'); return; }
                prices[i] = r.price;
                const k = kv[i];
                if (k !== null && k > 0) {
                    const bad = x.cny !== null
                        ? (k / x.cny < KRW_PER_CNY_MIN || k / x.cny > KRW_PER_CNY_MAX)
                        : (k / x.usd < KRW_PER_USD_MIN || k / x.usd > KRW_PER_USD_MAX);
                    if (bad) checks.add('UNIT_SUSPECT');
                }
            });
        }
    }

    if (swapped && !checks.size) infos.push('위안·달러 칸이 바뀌어 있어 바로잡음');

    // ── 기본값 / 개별값 ──
    if (!checks.size) {
        const vals = opts.map((o, i) => ({ scode: o.scode, v: prices[i] })).filter(x => x.v);
        if (vals.length) {
            const { base, o } = splitBaseOverrides(vals, samePrice);
            next.base = keepSame(base, cur && cur.base);
            for (const x of vals) {
                if (o[x.scode]) next.o[x.scode] = keepSame(o[x.scode], cur && cur.o && cur.o[x.scode]);
                else delete next.o[x.scode];
            }
        }
        next.memo = stripCheckMemo(next.memo);
    } else {
        const uniq = (k) => [...new Set(opts.map(o => o[k]).filter(Boolean))];
        const m = withCheckMemo(next.memo, uniq('cnyRaw'), uniq('usdRaw'));
        next.memo = m.memo;
        if (m.cut) warnings.push('원가메모가 길어 단가 원문을 줄임');
    }

    // ── 공급처 ──
    let newSup = '';
    const sv = opts.map(o => o.sup).filter(s => s !== '').map(normSup);
    if (sv.length) {
        const ok = sv.filter(isSupCode);
        if (ok.length < sv.length) warnings.push(`공급처 형식이 이상한 옵션 ${sv.length - ok.length}개 — 그 값은 쓰지 않음`);
        if (ok.length) {
            const { base } = splitBaseOverrides(ok.map((v, i) => ({ scode: String(i), v })), (a, b) => a === b);
            if (new Set(ok).size > 1) warnings.push('옵션마다 공급처가 다름 — 가장 많은 값 사용');
            next.sup = base;
            if (!ledger.has(base)) { newSup = base; infos.push('새 공급처 — 반영 때 대장에 등록'); }
        }
    }
    return { next, warnings, infos, checks: [...checks], newSup };
}

/**
 * 이지어드민 원가 비교.
 *  rows : readRows(aoa, EZ_COST_COLS).rows
 *  ctx  : { catalog: Map(pid → 상품), costs: Map(pid → 원가), ledger: Set, defaults: { rate, rateDate } }
 * → { entries: [{ pid, status, expectVer, next, changes, errors, warnings, infos, checks, newSup, rows }], counts }
 */
export function diffEzCost(rows, { catalog, costs, ledger = new Set(), defaults = {} }) {
    const fx = ezCatalogFixup(rows);
    const groups = new Map();
    for (const row of fx.rows) {
        const pid = row.v.pid || '';
        if (!groups.has(pid)) groups.set(pid, []);
        groups.get(pid).push(row);
    }
    const entries = [];
    for (const [pid, list] of groups) {
        const errors = [...(fx.errors.get(pid) || [])];
        let warnings = [], infos = [], checks = [], newSup = '';
        const prod = catalog.get(pid);
        if (!pid) errors.push(`${list[0].r}행: 품목코드(대표상품코드)가 비어 있음`);
        else if (!isValidCode(pid)) errors.push(`${list[0].r}행: 품목코드 모양이 이상함`);
        else if (!prod) errors.push(`품목코드 ${pid} 가 기본정보에 없음 — 기본정보를 먼저 올려 주세요`);
        const seen = new Map();
        const own = new Set((prod && prod.o || []).map(o => o[0]));
        for (const { r, v } of list) {
            const k = v.scode || '';
            if (!k) { errors.push(`${r}행: 상품코드가 비어 있음`); continue; }
            if (seen.has(k)) errors.push(`상품코드 ${k} 이 여러 번(${seen.get(k)}·${r}행)`);
            else seen.set(k, r);
            if (prod && !own.has(k)) errors.push(`${r}행: 상품코드 ${k} 가 이 품목의 옵션이 아님`);
        }
        const cur = costs.get(pid) || null;
        let next = cur ? { ...cur } : emptyCost();
        if (!errors.length) {
            const b = buildEzCost(list, cur, { ledger, defaults });
            ({ next, warnings, infos, checks, newSup } = b);
        }
        const changes = errors.length ? [] : diffCostObj(pid, cur, next);
        const status = errors.length ? 'error' : !cur ? (changes.length ? 'new' : 'same') : changes.length ? 'changed' : 'same';
        entries.push({ pid, status, expectVer: cur ? (cur.ver | 0) : 0, next, changes, errors, warnings, infos,
            checks: errors.length ? [] : checks, newSup: errors.length || !changes.length ? '' : newSup, rows: list.map(x => x.r) });
    }
    return { entries, counts: countStatus(entries) };
}
