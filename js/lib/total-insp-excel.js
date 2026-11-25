// === js/lib/total-insp-excel.js ===
// 전량검수 [엑셀 업로드](2026-11-20 사용자 요청) — 순수 함수(DOM·Firestore 없음, node --test 대상).
//   엑셀 머리글은 '상품코드', '수량' 두 칸. 상품코드(옵션 상품코드 또는 바코드)로 상품 DB 에서 상품명·옵션·로케이션을 채우고,
//   수량은 검수수량(칸 이름 totalStock)으로 넣는다. 넣기(트랜잭션)는 js/total-inspection-logic.js addItems.
import { findCandidates, totalItemOf } from './insp-manual.js?v=202611251358';
import { totalKey } from './total-insp.js?v=202611251358';

const str = (v) => (v == null ? '' : String(v));
const squash = (v) => str(v).replace(/\s/g, '');

/** 숫자 칸 → 양의 정수(쉼표·공백 허용). 아니면 NaN */
export function qtyOf(v) {
    if (typeof v === 'number') return Number.isInteger(v) && v > 0 ? v : NaN;
    const s = str(v).replace(/[,\s]/g, '');
    if (!/^\d+$/.test(s)) return NaN;
    const n = Number(s);
    return n > 0 ? n : NaN;
}

/** 엑셀 숫자로 읽힌 상품코드(예: 8801234567890)는 지수 표기 없이 글자로 */
export function codeOf(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? (Number.isInteger(v) ? v.toFixed(0) : String(v)) : '';
    return str(v).trim();
}

/**
 * 시트 행(2차원 배열, XLSX.utils.sheet_to_json(ws, { header: 1 })) → 줄 목록.
 * 머리글은 위에서 10줄 안에서 '상품코드'·'수량' 이 둘 다 있는 첫 줄(띄어쓰기 무시). 빈 줄은 건너뛴다.
 * 같은 상품코드가 여러 줄이면 수량을 더한다(lines 에 그 줄 번호들).
 * @returns {{ ok: true, rows: Array<{code, qty, lines:number[]}>, errors: Array<{line, code, message}> } | { ok: false, message }}
 *   line = 엑셀 줄 번호(1부터). base = 시트 사용 범위의 첫 줄(0부터, ws['!ref'] — 위쪽 빈 줄을 빼고 저장된 파일)
 */
export function parseSheetRows(aoa, base = 0) {
    const off = Math.max(0, Number(base) || 0);
    const rows = Array.isArray(aoa) ? aoa : [];
    let h = -1, ci = -1, qi = -1;
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
        const cells = (Array.isArray(rows[r]) ? rows[r] : []).map(squash);
        const c = cells.indexOf('상품코드'), q = cells.indexOf('수량');
        if (c !== -1 && q !== -1) { h = r; ci = c; qi = q; break; }
    }
    if (h === -1) return { ok: false, message: "머리글 '상품코드', '수량' 을 찾지 못했습니다(첫 줄에 두 칸 이름을 적어 주세요)." };
    const byCode = new Map();
    const errors = [];
    for (let r = h + 1; r < rows.length; r++) {
        const row = Array.isArray(rows[r]) ? rows[r] : [];
        const code = codeOf(row[ci]);
        const rawQty = row[qi];
        if (!code && (rawQty == null || str(rawQty).trim() === '')) continue;   // 빈 줄
        const line = off + r + 1;
        if (!code) { errors.push({ line, code: '', message: '상품코드 없음' }); continue; }
        const qty = qtyOf(rawQty);
        if (!Number.isFinite(qty)) { errors.push({ line, code, message: '수량이 1 이상 정수가 아님' }); continue; }
        const key = code.toUpperCase();
        const cur = byCode.get(key);
        if (cur) { cur.qty += qty; cur.lines.push(line); }
        else byCode.set(key, { code, qty, lines: [line] });
    }
    return { ok: true, rows: [...byCode.values()], errors };
}

/**
 * 상품코드 → 상품 DB 의 한 옵션. 옵션 상품코드 또는 바코드가 딱 한 옵션에 맞을 때만(여러 옵션에 걸리거나 못 찾으면 missing).
 * @param rows parseSheetRows 의 rows
 * @param products 상품 DB(Map 또는 [[pid, 상품]]) — js/products-store.js S.products
 * @returns {{ matches: Array<{ row, cand, opt }>, missing: Array<{code, lines, message}> }}
 */
export function matchRows(rows, products) {
    const matches = [];
    const missing = [];
    (Array.isArray(rows) ? rows : []).forEach(r => {
        const found = findCandidates(products, r.code, { limit: 0 }).items.filter(c => c.match === 'option' || c.match === 'barcode');
        const hits = [];
        found.forEach(c => c.pre.forEach(code => {
            const o = c.opts.find(x => x && x.code === code);
            if (o) hits.push({ cand: c, opt: o });
        }));
        if (!hits.length) { missing.push({ code: r.code, lines: r.lines, message: '상품 DB 에 없는 상품코드' }); return; }
        if (hits.length > 1) { missing.push({ code: r.code, lines: r.lines, message: `여러 옵션에 걸림(${hits.length}개)` }); return; }
        matches.push({ row: r, ...hits[0] });
    });
    return { matches, missing };
}

/**
 * 찾은 옵션 → 진행 목록에 넣을 상품. 상품명은 historyNames[i](이력 문서 이름 — 개별 추가와 같은 규칙)가 있으면 그것.
 * 같은 상품(상품명+옵션 = 목록 키)으로 풀린 줄은 하나로 합치고 수량을 더한다(옵션코드·바코드를 섞어 적은 경우 — 수량이 사라지지 않게).
 * @returns {{ items: Array<item>, missing }} item = totalItemOf 모양 + totalStock(수량) + origin 'excel' + lines
 */
export function buildItems(matches, { historyNames = [], locOf = () => null } = {}) {
    const byKey = new Map();
    const missing = [];
    (Array.isArray(matches) ? matches : []).forEach((m, i) => {
        const it = totalItemOf(m.cand, m.opt, { loc: locOf(m.opt.code), historyName: historyNames[i] || '' });
        if (!it) { missing.push({ code: m.row.code, lines: m.row.lines, message: '상품명 없음' }); return; }
        const key = totalKey(it.name, it.option);
        const cur = byKey.get(key);
        if (cur) { cur.totalStock += m.row.qty; cur.lines = [...cur.lines, ...m.row.lines]; }
        else byKey.set(key, { ...it, totalStock: m.row.qty, origin: 'excel', lines: [...m.row.lines] });
    });
    return { items: [...byKey.values()], missing };
}

/** 이력 이름 없이 한 번에(시험·단순 호출용) — matchRows + buildItems */
export function resolveRows(rows, products, locOf = () => null) {
    const a = matchRows(rows, products);
    const b = buildItems(a.matches, { locOf });
    return { items: b.items, missing: [...a.missing, ...b.missing] };
}

/** 확인 창에 보일 줄 — '엑셀 23줄 중 20개 넣기 · 못 넣음 3줄' + 못 넣은 줄 몇 개 */
export function summaryLines({ items = [], missing = [], errors = [] } = {}, max = 8) {
    const bad = [
        ...errors.map(e => `${e.line}줄${e.code ? ` (${e.code})` : ''}: ${e.message}`),
        ...missing.map(m => `${m.lines.join('·')}줄 (${m.code}): ${m.message}`),
    ];
    const head = `넣을 상품 ${items.length}개 · 수량 합 ${items.reduce((s, it) => s + (Number(it.totalStock) || 0), 0).toLocaleString()}`
        + (bad.length ? ` · 못 넣는 줄 ${bad.length}개` : '');
    return { head, bad: bad.slice(0, max), more: Math.max(0, bad.length - max) };
}
