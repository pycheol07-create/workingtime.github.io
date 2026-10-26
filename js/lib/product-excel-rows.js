// === js/lib/product-excel-rows.js ===
// 상품 관리 — 엑셀(기본정보 / 원가) 행 → 검증 → 상품 단위 변경 목록. 2026-10-13. 설계: 상품DB_설계_v2.md 3장
//
// 흐름: SheetJS 가 읽은 2차원 배열(aoa, 모든 칸 문자열) → findHeader → readRows → diffCatalog / diffCost
//       → 상품(품목코드) 하나 = 미리보기 한 줄 = 반영 단위. 반영은 js/products-write.js 가 버킷별 트랜잭션으로 한다.
// 열 이름은 **우리 양식 고정**(사용자 결정 D1, 2026-10-13) + 흔한 별칭 몇 개. 열 순서는 상관없다.
// 공통 규칙: 빈 칸 = 바꾸지 않음, 하이픈(-) 한 글자 = 지움. 머리글은 위 10행 안에서 찾는다(위 안내 행은 건너뜀).
// 머리글 바로 아래 '※' 로 시작하는 행(양식의 열 설명 행)은 건너뛴다.
//
// 🔒 기본정보 파일에서 원가·공급처 열(FORBIDDEN_RE)은 **읽지 않는다** — '무시한 열' 로만 보여 준다.
//    기본정보는 직원 전원이 읽는 문서(ProductCatalog)로 들어가기 때문이다. 테스트가 이것을 고정한다.
//
// 순수 모듈(DOM/Firebase 의존 없음). ⚠️ 원가 값을 console 에 찍지 말 것.
import { isValidCode, utf8Length } from './product-bucket.js?v=202610261518';
import { parseNum, parseDate, normalizePrice, samePrice, cellToText } from './product-price.js?v=202610261518';
import { REASON_LABEL } from './product-price-text.js?v=202610261518';

export const HEADER_SCAN_ROWS = 10;
export const MAX_ROWS = 60000;                 // 이지어드민 상품정보 엑셀(옵션 1행씩) 4만 6천여 행을 한 번에
export const BUCKET_LIMIT = 700000;            // 버킷 문서 하나 안전선(1 MiB 한도의 약 2/3)
export const GONE_CONFIRM_RATIO = 0.10;        // 사라짐이 기존(활성)의 10% 넘으면 건수 입력 요구
export const NAME_MAX = 200, TEXT_MAX = 100, MEMO_MAX = 500;
export const CLEAR = '-';

// ─────────────────────────────────────────────────────────────
// 열 정의
// ─────────────────────────────────────────────────────────────

/** 기본정보 파일 열. level: p = 상품(품목) 수준, o = 옵션 수준 */
export const CATALOG_COLS = [
    { key: 'pid', name: '품목코드', aliases: ['대표상품코드', '품목번호'], level: 'p', required: true,
      desc: '※ 필수. 이지어드민 품목코드(예 594198). 같은 품목의 옵션 행마다 같은 값' },
    { key: 'scode', name: '상품코드', aliases: ['어드민상품코드', '옵션상품코드', '옵션코드'], level: 'o', required: true,
      desc: '※ 필수. 옵션 하나의 코드(예 S594199). 파일 안에서 겹치면 오류' },
    { key: 'code2', name: '자체상품코드', aliases: ['자체품번', '자체코드'], level: 'p', desc: '※ 화면에 크게 보이는 코드' },
    { key: 'name', name: '상품명', aliases: ['품명'], level: 'p', desc: '※ 새 품목이면 필수. 200자 이하' },
    { key: 'optName', name: '옵션명', aliases: ['옵션', '옵션정보'], level: 'o', desc: '※ 예: 블랙 / M' },
    { key: 'barcode', name: '바코드', aliases: ['바코드번호'], level: 'o', desc: '※ 셀 서식을 텍스트로(앞자리 0·1.23E+12 방지)' },
    { key: 'price', name: '판매가', aliases: ['판매가격'], level: 'p', desc: '※ 숫자. 원·쉼표는 빼고 읽음' },
    { key: 'cat', name: '카테고리', aliases: ['분류', '상품분류'], level: 'p', desc: '※ 예: 상의' },
    { key: 'brand', name: '브랜드', aliases: [], level: 'p', desc: '※' },
    { key: 'status', name: '상태', aliases: ['판매상태', '상품상태'], level: 'p', desc: '※ 원문 그대로(예: 판매중)' },
    { key: 'regDate', name: '등록일', aliases: ['등록일자', '상품등록일'], level: 'p', desc: '※ 2026-10-13 형식' },
    { key: 'optStatus', name: '옵션상태', aliases: ['옵션판매상태'], level: 'o', desc: '※ 원문 그대로' },
];

/** 원가 파일 열 (관리자 전용 파일) */
export const COST_COLS = [
    { key: 'pid', name: '품목코드', aliases: ['대표상품코드', '품목번호'], required: true, desc: '※ 필수. 기본정보에 있는 품목코드' },
    { key: 'scode', name: '상품코드', aliases: ['어드민상품코드', '옵션상품코드', '옵션코드'],
      desc: '※ 비우면 상품 기본 단가 행, 넣으면 그 옵션만 개별 단가' },
    { key: 'code2', name: '자체상품코드', aliases: ['자체품번'], desc: '※ 참고용(기본정보와 다르면 경고)' },
    { key: 'name', name: '상품명', aliases: ['품명'], desc: '※ 참고용(읽지 않음)' },
    { key: 'optName', name: '옵션명', aliases: ['옵션'], desc: '※ 참고용(읽지 않음)' },
    { key: 'cny', name: '단가_위안', aliases: ['위안', '단가위안', '원가위안'], desc: '※ 숫자. 위안·달러 중 하나만 넣어도 됨' },
    { key: 'usd', name: '단가_달러', aliases: ['달러', '단가달러', '원가달러'], desc: '※ 숫자' },
    { key: 'rate', name: '환율', aliases: ['환율위안'], desc: '※ 1달러당 위안(예 7.20). 비우면 화면의 기본 환율' },
    { key: 'rateDate', name: '환율기준일', aliases: ['기준일'], desc: '※ 2026-10-13 형식. 비우면 화면의 기준일' },
    { key: 'krw', name: '원가_원화', aliases: ['원화', '원화원가', '원가원화'], desc: '※ 0 이상 정수(원). 상품 행 = 기본값, 옵션 행 = 그 옵션만' },
    { key: 'sup', name: '공급처코드', aliases: ['공급처'], desc: '※ 공급처 대장의 코드(예 SUP-001). 대장에 먼저 등록' },
    { key: 'moq', name: 'MOQ', aliases: ['최소주문', '최소주문수량'], desc: '※ 0 이상 정수' },
    { key: 'leadDays', name: '제작기간_일', aliases: ['제작기간', '제작기간일'], desc: '※ 0 이상 정수(일)' },
    { key: 'memo', name: '원가메모', aliases: ['메모'], desc: '※ 500자 이하' },
];

/** 기본정보 파일에서 절대 읽지 않는 열(원가·공급처) — 정규화한 머리글에 이 글자가 있으면 무시 */
//   추가항목2·비축창고재고 = 이지어드민 상품 엑셀에서 위안·달러 단가를 적어 두는 칸(이름과 다르게 씀)
export const FORBIDDEN_RE = /원가|매입|공급|orgprice|cost|supplier|supply|위안|달러|환율|단가|마진|margin|추가항목2|비축창고/i;

/**
 * SheetJS 시트 → 2차원 글자 배열. 서식 글자(w) 대신 셀 원시값으로(cellToText) — 숫자 바코드 지수표기·날짜 서식 문제를 피한다.
 * XLSX = SheetJS 전역(utils.decode_range·encode_cell·SSF). 읽기는 XLSX.read(buf, {type:'array', cellNF:true}) — dense 금지, cellNF 필수(날짜 판정).
 */
export function sheetToAoa(ws, XLSX, { date1904 = false } = {}) {
    if (!ws || !ws['!ref']) return [];
    const R = XLSX.utils.decode_range(ws['!ref']);
    const out = [];
    for (let r = R.s.r; r <= R.e.r; r++) {
        const row = [];
        for (let c = R.s.c; c <= R.e.c; c++) row.push(cellToText(ws[XLSX.utils.encode_cell({ r, c })], XLSX.SSF, date1904));
        out.push(row);
    }
    return out;
}

export const normHeader = (h) => String(h ?? '').replace(/[\s_()\[\]·.\-/]/g, '').toLowerCase();
export const cellStr = (v) => (v === null || v === undefined) ? '' : String(v).trim();

/**
 * 머리글 찾기. aoa 의 위 HEADER_SCAN_ROWS 행 안에서 필수 키 열(첫 열 정의)의 이름·별칭이 있는 첫 행.
 * → { row, map: {key: colIdx}, ignored: [머리글], forbidden: [머리글], dupes: [머리글], missing: [표준 이름] } | null
 */
export function findHeader(aoa, cols, { forbid = false } = {}) {
    const key = cols[0];
    const keyNames = new Set([key.name, ...key.aliases].map(normHeader));
    const lookup = new Map();
    for (const c of cols) for (const n of [c.name, ...c.aliases]) if (!lookup.has(normHeader(n))) lookup.set(normHeader(n), c.key);
    const limit = Math.min(HEADER_SCAN_ROWS, aoa.length);
    for (let r = 0; r < limit; r++) {
        const row = aoa[r] || [];
        if (!row.some(h => keyNames.has(normHeader(h)))) continue;
        const map = {}, ignored = [], forbidden = [], dupes = [];
        row.forEach((h, i) => {
            const raw = cellStr(h);
            if (!raw) return;
            const n = normHeader(raw);
            if (forbid && FORBIDDEN_RE.test(n)) { forbidden.push(raw); return; }   // 원가·공급처 열 — 읽지 않음
            const k = lookup.get(n);
            if (!k) { ignored.push(raw); return; }
            if (k in map) { dupes.push(raw); return; }
            map[k] = i;
        });
        const missing = cols.filter(c => c.required && !(c.key in map)).map(c => c.name);
        return { row: r, map, ignored, forbidden, dupes, missing };
    }
    return null;
}

/**
 * 머리글 아래 행 → [{ r: 엑셀 행 번호(1부터), v: {key: 문자열} }]. 빈 행·'※' 설명 행은 건너뜀.
 * 머리글이 없거나 필수 열이 없으면 fileErrors 에 넣는다.
 */
export function readRows(aoa, cols, opts = {}) {
    const fileErrors = [];
    const header = findHeader(aoa, cols, opts);
    if (!header) {
        fileErrors.push(`위 ${HEADER_SCAN_ROWS}행 안에서 '${cols[0].name}' 머리글을 찾지 못했습니다 — 양식을 내려받아 열 이름을 맞춰 주세요`);
        return { header: null, rows: [], fileErrors, skipped: 0 };
    }
    if (header.missing.length) fileErrors.push(`필수 열이 없습니다: ${header.missing.join(', ')}`);
    if (aoa.length - header.row - 1 > MAX_ROWS) fileErrors.push(`행이 ${MAX_ROWS.toLocaleString()}개를 넘습니다 — 나눠서 올려 주세요`);
    const rows = [];
    let skipped = 0;
    const keyIdx = header.map[cols[0].key];
    for (let r = header.row + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        if (!row.some(c => cellStr(c) !== '')) continue;
        const first = cellStr(row[keyIdx]);
        if (first.startsWith('※') || cellStr(row.find(c => cellStr(c) !== '')).startsWith('※')) { skipped++; continue; }
        const v = {};
        for (const [k, i] of Object.entries(header.map)) v[k] = cellStr(row[i]);
        rows.push({ r: r + 1, v });
    }
    return { header, rows, fileErrors, skipped };
}

// ─────────────────────────────────────────────────────────────
// 기본정보
// ─────────────────────────────────────────────────────────────

const P_FIELDS = ['code2', 'name', 'brand', 'cat', 'price', 'status', 'regDate'];
const O_FIELDS = ['optName', 'barcode', 'optStatus'];        // 옵션 배열 [scode, optName, barcode, optStatus, gone]
export const FIELD_LABEL = {
    code2: '자체상품코드', name: '상품명', brand: '브랜드', cat: '카테고리', price: '판매가', status: '상태',
    regDate: '등록일', gone: '사라짐', optName: '옵션명', barcode: '바코드', optStatus: '옵션상태', opt: '옵션',
    base: '기본 단가', sup: '공급처', moq: 'MOQ', leadDays: '제작기간', memo: '원가메모', krw: '원화 원가', okrw: '원화'
};

/** 빈 상품 */
export const emptyProduct = () => ({ code2: '', name: '', brand: '', cat: '', price: null, status: '', regDate: '', gone: 0, goneAt: null, o: [] });

/** 상품 JSON — 키 순서 고정(같은 값이면 같은 문자열). 옵션은 [scode, optName, barcode, optStatus, gone] */
export function catalogJson(p) {
    return JSON.stringify({
        ver: p.ver | 0, at: p.at || 0, by: p.by || '', src: p.src || '', add: p.add || 0,
        code2: p.code2 || '', name: p.name || '', brand: p.brand || '', cat: p.cat || '',
        price: (p.price === null || p.price === undefined) ? null : Number(p.price),
        status: p.status || '', regDate: p.regDate || '', gone: p.gone ? 1 : 0, goneAt: p.goneAt || null,
        o: (p.o || []).map(x => [String(x[0]), x[1] || '', x[2] || '', x[3] || '', x[4] ? 1 : 0])
    });
}

export function parseCatalogJson(s) {
    try {
        const p = JSON.parse(s);
        if (!p || typeof p !== 'object') return null;
        if (!Array.isArray(p.o)) p.o = [];
        return p;
    } catch (e) { return null; }
}

/** 필드 하나의 새 값 (빈칸 = 그대로, '-' = 지움). → { value, error, warning } */
function fieldValue(key, raw, before) {
    if (raw === '') return { value: before };
    if (raw === CLEAR) {
        if (key === 'name') return { value: before, error: '상품명은 지울 수 없음' };
        return { value: key === 'price' ? null : '' };
    }
    switch (key) {
        case 'name':
            if (raw.length > NAME_MAX) return { value: before, error: `상품명 ${NAME_MAX}자 초과` };
            return { value: raw };
        case 'optName':
            if (raw.length > NAME_MAX) return { value: before, error: `옵션명 ${NAME_MAX}자 초과` };
            return { value: raw };
        case 'price': {
            const n = parseNum(raw);
            if (n === null) return { value: before };
            if (!Number.isFinite(n) || n < 0) return { value: before, error: '판매가가 숫자가 아님' };
            return { value: n };
        }
        case 'barcode':
            if (/e\+?\d+$/i.test(raw) && /^\d(\.\d+)?e/i.test(raw)) return { value: before, error: '바코드가 1.23E+12 꼴로 깨짐 — 셀 서식을 텍스트로 바꿔 다시 저장' };
            if (raw.length > TEXT_MAX) return { value: before, error: '바코드가 너무 김' };
            return { value: raw, warning: (/^\d+$/.test(raw) && raw.length < 13) ? '바코드 13자리 미만 — 앞자리 0 이 빠졌는지 확인' : undefined };
        case 'regDate':
            return { value: parseDate(raw) || raw.slice(0, 20) };
        default:
            if (raw.length > TEXT_MAX) return { value: before, error: `${FIELD_LABEL[key] || key} ${TEXT_MAX}자 초과` };
            return { value: raw };
    }
}

/**
 * 행 목록 → 품목 단위 묶음 Map(pid → { pid, rows, pv: {key: 문자열}, opts: [{r, scode, v}], errors, warnings })
 *  opts.regDate = 'min' : 옵션마다 등록일이 다르면 경고 없이 가장 이른 날짜(이지어드민 상품 엑셀). 기본은 첫 값 + 경고
 */
export function groupCatalogRows(rows, { regDate = 'first' } = {}) {
    const products = new Map();
    const sRows = new Map();                       // scode → [{pid, r}]
    for (const { r, v } of rows) {
        const pid = v.pid || '';
        let g = products.get(pid);
        if (!g) {
            g = { pid, rows: [], pv: {}, pvRow: {}, opts: [], errors: [], warnings: [] };
            products.set(pid, g);
            if (!pid) g.errors.push(`${r}행: 품목코드가 비어 있음`);
            else if (!isValidCode(pid)) g.errors.push(`${r}행: 품목코드 모양이 이상함(영문·숫자·_- 40자 이하)`);
        }
        g.rows.push(r);
        for (const c of CATALOG_COLS) {
            if (c.level !== 'p' || c.key === 'pid' || !(c.key in v)) continue;
            const val = v[c.key];
            if (val === '') continue;
            if (!(c.key in g.pv)) { g.pv[c.key] = val; g.pvRow[c.key] = r; }
            else if (c.key === 'regDate' && regDate === 'min') {
                if ((parseDate(val) || val) < (parseDate(g.pv[c.key]) || g.pv[c.key])) { g.pv[c.key] = val; g.pvRow[c.key] = r; }
            }
            else if (g.pv[c.key] !== val && !g.warnings.some(w => w.includes(`'${FIELD_LABEL[c.key]}'`))) {
                g.warnings.push(`'${FIELD_LABEL[c.key]}' 값이 행마다 다름 — ${g.pvRow[c.key]}행 값 사용`);
            }
        }
        const scode = v.scode || '';
        if (!scode) { g.errors.push(`${r}행: 상품코드가 비어 있음`); continue; }
        if (!isValidCode(scode)) { g.errors.push(`${r}행: 상품코드 모양이 이상함`); continue; }
        const ov = {};
        for (const k of O_FIELDS) if (k in v) ov[k] = v[k];
        g.opts.push({ r, scode, v: ov });
        if (!sRows.has(scode)) sRows.set(scode, []);
        sRows.get(scode).push({ pid, r });
    }
    for (const [scode, list] of sRows) {
        if (list.length < 2) continue;
        const where = list.map(x => x.r).join('·');
        for (const { pid } of list) {
            const g = products.get(pid);
            const msg = `상품코드 ${scode} 가 파일 안에 여러 번(${where}행)`;
            if (!g.errors.includes(msg)) g.errors.push(msg);
        }
    }
    return products;
}

/** 상품 하나 전 → 후 변경 목록 (화면 편집도 쓴다) */
export function diffProduct(pid, cur, next) {
    const changes = [];
    const b = cur || emptyProduct();
    for (const k of [...P_FIELDS, 'gone']) {
        const x = k === 'gone' ? (b.gone ? 1 : 0) : (b[k] ?? (k === 'price' ? null : ''));
        const y = k === 'gone' ? (next.gone ? 1 : 0) : (next[k] ?? (k === 'price' ? null : ''));
        if (x !== y) changes.push({ pid, opt: null, field: k, before: cur ? x : null, after: y });
    }
    const bo = new Map((b.o || []).map(o => [o[0], o]));
    for (const o of next.o) {
        const p = bo.get(o[0]);
        if (!p) { changes.push({ pid, opt: o[0], field: 'opt', before: null, after: o[1] || '(새 옵션)' }); continue; }
        O_FIELDS.forEach((k, i) => { if ((p[i + 1] || '') !== (o[i + 1] || '')) changes.push({ pid, opt: o[0], field: k, before: p[i + 1] || '', after: o[i + 1] || '' }); });
        if ((p[4] ? 1 : 0) !== (o[4] ? 1 : 0)) changes.push({ pid, opt: o[0], field: 'gone', before: p[4] ? 1 : 0, after: o[4] ? 1 : 0 });
    }
    return changes;
}

/**
 * 기본정보 비교.
 *  file     : groupCatalogRows 결과
 *  existing : Map(pid → 현재 상품 객체(ver 포함))
 *  opts     : { fullList: '이 파일이 전체 목록' 체크, now: ms }
 * → { entries: [{ pid, status, expectVer, next, changes, errors, warnings, rows }], counts, goneRatio, needGoneConfirm }
 *   status: new | changed | same | revived | gone | error
 */
export function diffCatalog(file, existing, { fullList = true, now = Date.now() } = {}) {
    const owner = new Map();                                   // 기존 scode → pid
    for (const [pid, p] of existing) for (const o of p.o || []) owner.set(o[0], pid);
    const entries = [];
    for (const g of file.values()) {
        const cur = existing.get(g.pid) || null;
        const errors = [...g.errors], warnings = [...g.warnings];
        const next = cur ? { ...cur, o: (cur.o || []).map(o => o.slice()) } : emptyProduct();
        for (const k of P_FIELDS) {
            if (!(k in g.pv)) continue;
            const r = fieldValue(k, g.pv[k], next[k]);
            if (r.error) errors.push(`${g.pvRow[k]}행: ${r.error}`);
            if (r.warning) warnings.push(r.warning);
            next[k] = r.value;
        }
        let revived = false;
        if (cur && cur.gone) { next.gone = 0; next.goneAt = null; revived = true; }
        const om = new Map(next.o.map(o => [o[0], o]));
        const inFile = new Set();
        for (const fo of g.opts) {
            inFile.add(fo.scode);
            const own = owner.get(fo.scode);
            if (own !== undefined && own !== g.pid) { errors.push(`${fo.r}행: 상품코드 ${fo.scode} 는 이미 다른 품목(${own})에 있음`); continue; }
            let o = om.get(fo.scode);
            if (!o) { o = [fo.scode, '', '', '', 0]; next.o.push(o); om.set(fo.scode, o); }
            else if (o[4]) { o[4] = 0; revived = true; }
            O_FIELDS.forEach((k, i) => {
                if (!(k in fo.v)) return;
                const r = fieldValue(k, fo.v[k], o[i + 1]);
                if (r.error) errors.push(`${fo.r}행: ${r.error}`);
                if (r.warning && !warnings.includes(r.warning)) warnings.push(r.warning);
                o[i + 1] = r.value || '';
            });
        }
        let goneOpts = 0;
        if (fullList) for (const o of next.o) if (!inFile.has(o[0]) && !o[4]) { o[4] = 1; goneOpts++; }   // 파일에 없는 옵션 → 사라짐
        if (!cur && !next.name) errors.push('새 품목인데 상품명이 없음');
        const changes = errors.length ? [] : diffProduct(g.pid, cur, next);
        let status;
        if (errors.length) status = 'error';
        else if (!cur) status = 'new';
        else if (revived) status = 'revived';
        else if (changes.length) status = 'changed';
        else status = 'same';
        entries.push({ pid: g.pid, status, expectVer: cur ? (cur.ver | 0) : 0, next, changes, errors, warnings, rows: g.rows,
            goneOpts: errors.length ? 0 : goneOpts });
    }
    let active = 0, activeOpts = 0;
    for (const p of existing.values()) if (!p.gone) { active++; activeOpts += (p.o || []).filter(o => !o[4]).length; }
    if (fullList) {
        for (const [pid, cur] of existing) {
            if (file.has(pid) || cur.gone) continue;
            const next = { ...cur, gone: 1, goneAt: now, o: (cur.o || []).map(o => o.slice()) };
            entries.push({ pid, status: 'gone', expectVer: cur.ver | 0, next, changes: [{ pid, opt: null, field: 'gone', before: 0, after: 1 }],
                errors: [], warnings: [], rows: [], goneOpts: (cur.o || []).filter(o => !o[4]).length });
        }
    }
    const counts = countStatus(entries);
    const goneOptCount = entries.reduce((a, e) => a + (e.goneOpts || 0), 0);
    const goneRatio = active ? counts.gone / active : 0;
    const goneOptRatio = activeOpts ? goneOptCount / activeOpts : 0;
    return { entries, counts, goneRatio, goneOptCount, goneOptRatio,
        needGoneConfirm: goneRatio > GONE_CONFIRM_RATIO || goneOptRatio > GONE_CONFIRM_RATIO };
}

/** 선택한 것 중 사라질 상품·옵션 수 (사라지는 상품의 활성 옵션 포함) — 건수 확인 입력용 */
export function goneSelected(entries, checked) {
    let products = 0, options = 0;
    for (const e of entries) {
        if (!checked.has(e.pid)) continue;
        if (e.status === 'gone') products++;
        options += e.goneOpts || 0;
    }
    return { products, options };
}

export function countStatus(entries) {
    const c = { new: 0, changed: 0, same: 0, revived: 0, gone: 0, error: 0, warn: 0, check: 0, total: entries.length };
    for (const e of entries) {
        c[e.status] = (c[e.status] || 0) + 1;
        if (e.warnings.length && e.status !== 'error') c.warn++;
        if (e.checks && e.checks.length && e.status !== 'error') c.check++;
    }
    return c;
}

/** 미리보기 기본 체크 — 새로·변경·다시 나타남·사라짐(경고 포함). 동일·오류는 해제 */
export const defaultChecked = (e) => ['new', 'changed', 'revived', 'gone'].includes(e.status);

// ─────────────────────────────────────────────────────────────
// 버킷 크기
// ─────────────────────────────────────────────────────────────

/** 버킷 문서 크기 추정(Firestore 규칙: 필드 이름 바이트+1, 문자열 바이트+1, 문서 이름·기타 여유 200B) */
export function bucketDocBytes(pMap) {
    let n = 200 + 2;                                // 문서 이름·schema·at 여유 + 'p'
    for (const [k, v] of Object.entries(pMap)) n += utf8Length(k) + 1 + utf8Length(v) + 1;
    return n;
}

/**
 * 반영 후 버킷별 바이트. buckets: {Bxx: {pid: json}}, writes: [{bid, pid, json}]
 * → { bytes: {Bxx: n}, over: [Bxx…] }
 */
export function bucketSizesAfter(buckets, writes, limit = BUCKET_LIMIT) {
    const merged = {};
    for (const [bid, p] of Object.entries(buckets || {})) merged[bid] = { ...p };
    for (const w of writes) { (merged[w.bid] ||= {})[w.pid] = w.json; }
    const bytes = {}, over = [];
    for (const [bid, p] of Object.entries(merged)) {
        bytes[bid] = bucketDocBytes(p);
        if (bytes[bid] > limit) over.push(bid);
    }
    return { bytes, over: over.sort() };
}

// ─────────────────────────────────────────────────────────────
// 원가
// ─────────────────────────────────────────────────────────────

/** 공급처코드 정규화 — NFC, 앞뒤 공백 제거, 연속 공백 하나로 */
export const normSup = (s) => String(s ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
/**
 * 공급처코드 허용 모양 — 1~40자, 제어문자 없음, '__x__' 아님(Firestore 예약), '-' 한 글자 아님(지움 표시).
 * 한글·공백·하이픈·영숫자 허용(이지어드민 공급처 값을 그대로 코드로 씀). SUP-001 도 통과.
 * 대장 맵 키로 쓰므로 쓰기는 반드시 FieldPath('s', 코드).
 */
export function isSupCode(s) {
    const n = normSup(s);
    return n.length >= 1 && n.length <= 40 && !/[\u0000-\u001f\u007f]/.test(n) && !/^__.*__$/.test(n) && n !== CLEAR;
}

/** 원가 JSON — 키 순서 고정. krw = 기본 원화 원가(정수|null), ok = 옵션별 원화 {scode: 정수} */
export function costJson(c) {
    const o = {}, ok = {};
    for (const k of Object.keys(c.o || {}).sort()) o[k] = priceObj(c.o[k]);
    for (const k of Object.keys(c.ok || {}).sort()) ok[k] = c.ok[k];
    return JSON.stringify({
        ver: c.ver | 0, at: c.at || 0, by: c.by || '',
        base: c.base ? priceObj(c.base) : null, krw: c.krw ?? null,
        sup: c.sup || '', moq: c.moq ?? null, leadDays: c.leadDays ?? null, memo: c.memo || '', o, ok
    });
}
const priceObj = (p) => ({ cny: p.cny, usd: p.usd, rate: p.rate, rateDate: p.rateDate || null, src: p.src || '' });

export function parseCostJson(s) {
    try {
        const c = JSON.parse(s);
        if (!c || typeof c !== 'object') return null;
        if (!c.o || typeof c.o !== 'object') c.o = {};
        if (c.krw === undefined) c.krw = null;                         // 옛 JSON(원화 칸 없음)
        if (!c.ok || typeof c.ok !== 'object') c.ok = {};
        return c;
    } catch (e) { return null; }
}

export const emptyCost = () => ({ base: null, krw: null, sup: '', moq: null, leadDays: null, memo: '', o: {}, ok: {} });

function intField(raw, label) {
    if (raw === '') return { keep: true };
    if (raw === CLEAR) return { value: null };
    const n = parseNum(raw);
    if (n === null) return { keep: true };
    if (!Number.isInteger(n) || n < 0) return { error: `${label}가 0 이상 정수가 아님` };
    return { value: n };
}

/** 원가 행의 단가 칸 → { keep } | { clear } | { price, warnings } | { error } */
function priceCells(v, defaults) {
    const raw = [v.cny || '', v.usd || '', v.rate || ''];
    if (raw.every(x => x === '')) return { keep: true };
    if (raw[0] === CLEAR || raw[1] === CLEAR) return { clear: true };
    const rd = v.rateDate ? parseDate(v.rateDate) : null;
    if (v.rateDate && !rd) return { error: '환율기준일을 읽지 못함' };
    const r = normalizePrice({ cny: parseNum(raw[0]), usd: parseNum(raw[1]), rate: parseNum(raw[2]), rateDate: rd }, defaults);
    if (r.errors.length) return { error: r.errors.join(', ') };
    return { price: r.price, warnings: r.warnings };
}

/**
 * 원가 비교.
 *  rows     : readRows(aoa, COST_COLS).rows
 *  catalog  : Map(pid → 상품 객체)   — 없는 품목코드 = 오류
 *  costs    : Map(pid → 원가 객체(ver 포함))
 *  ledger   : Set(공급처코드)
 *  defaults : { rate, rateDate }     — 업로드 화면의 기본 환율·기준일
 * → { entries: [{ pid, status, expectVer, next, changes, errors, warnings, infos, rows }], counts }
 */
export function diffCost(rows, { catalog, costs, ledger, defaults = {} }) {
    const groups = new Map();
    for (const row of rows) {
        const pid = row.v.pid || '';
        if (!groups.has(pid)) groups.set(pid, []);
        groups.get(pid).push(row);
    }
    const entries = [];
    for (const [pid, list] of groups) {
        const errors = [], warnings = [], infos = [];
        const prod = catalog.get(pid);
        if (!pid) errors.push(`${list[0].r}행: 품목코드가 비어 있음`);
        else if (!isValidCode(pid)) errors.push(`${list[0].r}행: 품목코드 모양이 이상함`);
        else if (!prod) errors.push(`품목코드 ${pid} 가 기본정보에 없음 — 기본정보를 먼저 올려 주세요`);
        const seen = new Map();
        for (const { r, v } of list) {
            const k = v.scode || '';
            if (seen.has(k)) errors.push(`${k ? '상품코드 ' + k : '상품 기본 행'}이 여러 번(${seen.get(k)}·${r}행)`);
            else seen.set(k, r);
        }
        const cur = costs.get(pid) || null;
        const next = cur ? { ...cur, base: cur.base ? { ...cur.base } : null, krw: cur.krw ?? null, o: { ...(cur.o || {}) }, ok: { ...(cur.ok || {}) } } : emptyCost();
        const optOwner = new Set((prod && prod.o || []).map(o => o[0]));
        if (!errors.length) {
            for (const { r, v } of list) {
                if (v.code2 && prod && prod.code2 && v.code2 !== prod.code2) warnings.push(`${r}행: 자체상품코드가 기본정보(${prod.code2})와 다름`);
                const pc = priceCells(v, defaults);
                if (pc.error) { errors.push(`${r}행: ${pc.error}`); continue; }
                if (pc.warnings) pc.warnings.forEach(w => warnings.push(`${r}행: ${w}`));
                if (!v.scode) {
                    if (pc.clear) next.base = null;
                    else if (pc.price) next.base = pc.price;
                    if (v.krw !== undefined) {
                        const f = intField(v.krw, '원화 원가');
                        if (f.error) errors.push(`${r}행: ${f.error}`);
                        else if (!f.keep) next.krw = f.value;
                    }
                    if (v.sup !== undefined && v.sup !== '') {
                        const sup = normSup(v.sup);
                        if (v.sup === CLEAR) next.sup = '';
                        else if (!isSupCode(sup)) errors.push(`${r}행: 공급처코드 모양이 이상함(1~40자)`);
                        else if (!ledger.has(sup)) errors.push(`${r}행: 공급처가 대장에 없음 — 먼저 등록`);   // 🔒 공급처 값은 메시지에 넣지 않음(결과 엑셀로 나감)
                        else next.sup = sup;
                    }
                    for (const [key, label] of [['moq', 'MOQ'], ['leadDays', '제작기간']]) {
                        if (v[key] === undefined) continue;
                        const f = intField(v[key], label);
                        if (f.error) errors.push(`${r}행: ${f.error}`);
                        else if (!f.keep) next[key] = f.value;
                    }
                    if (v.memo !== undefined && v.memo !== '') {
                        if (v.memo === CLEAR) next.memo = '';
                        else if (v.memo.length > MEMO_MAX) errors.push(`${r}행: 원가메모 ${MEMO_MAX}자 초과`);
                        else next.memo = v.memo;
                    }
                } else {
                    if (!optOwner.has(v.scode)) { errors.push(`${r}행: 상품코드 ${v.scode} 가 이 품목의 옵션이 아님`); continue; }
                    if (['sup', 'moq', 'leadDays', 'memo'].some(k => v[k])) warnings.push(`${r}행: 옵션 행의 공급처·MOQ·제작기간·메모는 무시`);
                    if (pc.clear) delete next.o[v.scode];
                    else if (pc.price) next.o[v.scode] = pc.price;
                    if (v.krw !== undefined) {
                        const f = intField(v.krw, '원화 원가');
                        if (f.error) errors.push(`${r}행: ${f.error}`);
                        else if (!f.keep) { if (f.value === null) delete next.ok[v.scode]; else next.ok[v.scode] = f.value; }
                    }
                }
            }
        }
        // 옵션 원화가 기본 원화와 같으면 저장하지 않는다
        for (const [s, k] of Object.entries(next.ok)) {
            if (next.krw !== null && next.krw !== undefined && k === next.krw) { delete next.ok[s]; infos.push(`${s}: 원화가 기본값과 같아 개별 저장 안 함`); }
        }
        // 옵션 개별값이 기본값과 같으면 저장하지 않는다(상속 유지)
        for (const [s, p] of Object.entries(next.o)) {
            if (next.base && samePrice(p, next.base)) { delete next.o[s]; infos.push(`${s}: 기본값과 같아 개별 저장 안 함`); }
        }
        const changes = errors.length ? [] : diffCostObj(pid, cur, next);
        const status = errors.length ? 'error' : !cur ? (changes.length ? 'new' : 'same') : changes.length ? 'changed' : 'same';
        entries.push({ pid, status, expectVer: cur ? (cur.ver | 0) : 0, next, changes, errors, warnings, infos, rows: list.map(x => x.r) });
    }
    return { entries, counts: countStatus(entries) };
}

/** 빈 문자열·null·undefined 만 같은 '없음'. 0 은 값이다 */
const blankToNull = (v) => (v === '' || v === undefined || v === null) ? null : v;

export function diffCostObj(pid, cur, next) {
    const b = cur || emptyCost();
    const changes = [];
    if (!samePrice(b.base, next.base)) changes.push({ pid, opt: null, field: 'base', before: b.base || null, after: next.base || null });
    for (const k of ['krw', 'sup', 'moq', 'leadDays', 'memo']) {
        const x = b[k] ?? null, y = next[k] ?? null;
        if (blankToNull(x) !== blankToNull(y)) changes.push({ pid, opt: null, field: k, before: x, after: y });
    }
    const keys = new Set([...Object.keys(b.o || {}), ...Object.keys(next.o || {})]);
    for (const s of [...keys].sort()) {
        const x = (b.o || {})[s] || null, y = (next.o || {})[s] || null;
        if (!samePrice(x, y)) changes.push({ pid, opt: s, field: 'opt', before: x, after: y });
    }
    const okeys = new Set([...Object.keys(b.ok || {}), ...Object.keys(next.ok || {})]);
    for (const s of [...okeys].sort()) {
        const x = (b.ok || {})[s] ?? null, y = (next.ok || {})[s] ?? null;
        if (x !== y) changes.push({ pid, opt: s, field: 'okrw', before: x, after: y });
    }
    return changes;
}

// ─────────────────────────────────────────────────────────────
// 양식 · 내보내기 · 결과
// ─────────────────────────────────────────────────────────────

/** 빈 양식(머리글만). withDesc 면 머리글 아래 '※' 설명 행 1줄(읽을 때 건너뜀) */
export function templateAoa(kind, withDesc = false) {
    const cols = kind === 'cost' ? COST_COLS : CATALOG_COLS;
    const aoa = [cols.map(c => c.name)];
    if (withDesc) aoa.push(cols.map(c => c.desc || '※'));
    return aoa;
}

/** 현재 기본정보 → 양식 모양 aoa (옵션 1개 = 1행). 사라진 것은 includeGone 일 때만 */
export function catalogExportAoa(products, { includeGone = false } = {}) {
    const aoa = [CATALOG_COLS.map(c => c.name)];
    for (const [pid, p] of products) {
        if (p.gone && !includeGone) continue;
        const opts = (p.o || []).filter(o => includeGone || !o[4]);
        const base = [pid, null, p.code2 || '', p.name || '', null, null, p.price ?? '', p.cat || '', p.brand || '', p.status || '', p.regDate || '', null];
        for (const o of (opts.length ? opts : [[ '', '', '', '', 0 ]])) {
            const row = base.slice();
            row[1] = o[0]; row[4] = o[1] || ''; row[5] = o[2] || ''; row[11] = o[3] || '';
            aoa.push(row);
        }
    }
    return aoa;
}

/** 현재 원가 → 원가 양식 aoa. 맨 위에 경고 행(머리글 찾기에서 건너뜀). 관리자 화면에서만 부른다 */
export function costExportAoa(products, costs) {
    const head = COST_COLS.map(c => c.name);
    const aoa = [['※ 관리자 전용 — 원가 원본 파일입니다. AI·메신저·메일로 보내지 마세요.'], head];
    const pr = (p) => p ? [p.cny, p.usd, p.rate, p.rateDate || ''] : ['', '', '', ''];
    for (const [pid, p] of products) {
        if (p.gone) continue;
        const c = costs.get(pid) || emptyCost();
        aoa.push([pid, '', p.code2 || '', p.name || '', '', ...pr(c.base), c.krw ?? '', c.sup || '', c.moq ?? '', c.leadDays ?? '', c.memo || '']);
        for (const o of p.o || []) {
            if (o[4]) continue;
            const own = c.o && c.o[o[0]];
            aoa.push([pid, o[0], p.code2 || '', p.name || '', o[1] || '', ...pr(own), (c.ok && c.ok[o[0]]) ?? '', '', '', '', '']);
        }
    }
    return aoa;
}

export const STATUS_LABEL = { new: '새로', changed: '변경', same: '동일', revived: '다시 나타남', gone: '사라짐', error: '오류' };

/** 결과 엑셀 aoa — 값(원가) 없이 품목코드·판정·반영 결과·사유만. '확인 필요' 는 사유 라벨만(단가 원문·숫자 없음) */
export function resultAoa(entries, results) {
    const aoa = [['품목코드', '판정', '반영', '변경 수', '오류·경고', '확인 필요']];
    for (const e of entries) {
        const r = results.get(e.pid) || '반영 안 함';
        aoa.push([e.pid, STATUS_LABEL[e.status] || e.status, r, e.changes.length, [...e.errors, ...e.warnings].join(' / '),
            (e.checks || []).map(x => REASON_LABEL[x] || x).join(', ')]);
    }
    return aoa;
}
