// === js/lib/ship-ably.js ===
// 에이블리(도착보장) 1·2단계 계산 — Python 판(앱\플랫폼출고자동화\에이블리_자동화.py read_ably_request ·
// ably_step1_inventory_outbound · ably_step2_bulk_inbound)과 같은 행을 만든다. 파일 쓰기·Firestore 는 하지 않는다.
//   도착보장출고요청: 머리글 2행(줄바꿈 뺌), 자료 3행~ · 열 고정(B SKU · D 상품명 · E 옵션 · F 수량 · G 어드민코드 · H 어드민상품명 · L 로케이션)
//   대량입고 양식: 머리글 5행 7칸 + 8번째 빈칸, 6행부터 비우고 쓴다. 검품 방식 '스탠다드' 고정(바코드를 채워 보냄).
//   쓰기: ship-write.ablyBulkBytes · ship-picking(AB, 패키지 역순) · ship-write.stockXlsBytes(1단계).

import {
    pyStr, pyStrip, pyTruthy, strip, orEmpty, toInt, isFraction, cleanProductName, sortedBy,
    ablySource, packDay, countPacks, checkLimit, splitAndName, overBags, kstDay, fileNames, looksLikeStockOut, STOCK_OUT_MSG,
} from './ship-core.js?v=202611111506';
import { headerColumns } from './ship-read.js?v=202611111506';

export const REQ_HEADER_ROW = 2;
export const REQ_DATA_ROW = 3;
export const TMPL_HEADER_ROW = 5;
export const TMPL_DATA_ROW = 6;
export const TMPL_COL_COUNT = 7;
export const INSPECTION_METHOD = '스탠다드';
export const TMPL_HEADERS = ['패키지명', 'SKU번호', '상품바코드번호', '상품명', '옵션정보', '입고예정수량', '입고 검품 방식'];
const COL = { SKU: 2, NAME: 4, OPTION: 5, QTY: 6, ADMIN_CODE: 7, ADMIN_NAME: 8, LOCATION: 12 };

const fmtN = (n) => n.toLocaleString('en-US');
const listStr = (a) => '[' + a.map(x => `'${x}'`).join(', ') + ']';

/** read_ably_request — 각 행 { sku, name, option, admin_name, qty, code, location } */
export function readAblyRequest(book, log = []) {
    const ws = book.active();
    log.push(`  시트: '${ws.name}', 전체 행 수: ${ws.maxRow}`);
    const headers = headerColumns(ws, REQ_HEADER_ROW, v => pyStrip(pyStr(v).replace(/\n/g, '')));
    const missing = ['SKU번호', '입고예정수량', '어드민상품코드'].filter(h => !headers.has(h));
    if (missing.length) {
        throw new Error(`필수 컬럼 누락: ${listStr(missing)}\nR${REQ_HEADER_ROW}행에서 발견된 헤더: ${listStr([...headers.keys()])}`);
    }
    const rows = [];
    let skipped = 0, fracRows = 0;
    for (let r = REQ_DATA_ROW; r <= ws.maxRow; r++) {
        const code = ws.cell(r, COL.ADMIN_CODE), qtyRaw = ws.cell(r, COL.QTY);
        if (!pyTruthy(code) || qtyRaw === null || qtyRaw === '') { skipped++; continue; }
        const qty = toInt(qtyRaw);
        if (isFraction(qtyRaw)) fracRows++;
        if (qty <= 0) { skipped++; continue; }
        rows.push({
            sku: ws.cell(r, COL.SKU),
            name: ws.cell(r, COL.NAME),
            option: ws.cell(r, COL.OPTION),
            admin_name: ws.cell(r, COL.ADMIN_NAME),
            qty,
            code: strip(code),
            location: orEmpty(ws.cell(r, COL.LOCATION)),
        });
    }
    if (fracRows) log.push(`  소수점 수량 ${fracRows}건 → 행별 버림 처리`);
    log.push(`  유효 출고요청: ${rows.length}건 (스킵: ${skipped}건)`);
    log.push(`  총 요청 수량: ${fmtN(rows.reduce((s, x) => s + x.qty, 0))}개`);
    return rows;
}

/** 1단계: 도착보장출고요청 → 재고출고용 행 [상품코드, 수량] (같은 코드 합산, 코드순) */
export function ablyStep1({ request, now = new Date() }) {
    const log = [];
    const rows = readAblyRequest(request, log);
    if (!rows.length) throw new Error('처리할 유효한 데이터가 없습니다.');
    const merged = new Map();
    let dup = 0;
    for (const row of rows) {
        if (merged.has(row.code)) { merged.set(row.code, merged.get(row.code) + row.qty); dup++; } else merged.set(row.code, row.qty);
    }
    if (dup) log.push(`  동일 상품코드 합산: ${dup}건`);
    let total = 0;
    for (const q of merged.values()) total += q;
    log.push(`  최종 통합: ${merged.size}건 / 총 ${fmtN(total)}개`);
    const items = sortedBy([...merged], x => x[0]);
    return {
        items,
        aoa: [['상품코드', '수량'], ...items.map(([c, q]) => [c, q])],
        sheetName: '재고출고용',
        fileName: fileNames(kstDay(now).yymmdd).ablyStock,
        log,
    };
}

/** 대량입고 양식 머리글 검사 — 다르면 멈춘다(업로드에서 실패하므로) */
export function checkAblyTemplate(templateBook) {
    const ws = templateBook.active();
    const hdr = [];
    for (let c = 1; c <= TMPL_COL_COUNT; c++) hdr.push(ws.cell(TMPL_HEADER_ROW, c));
    const extra = ws.cell(TMPL_HEADER_ROW, TMPL_COL_COUNT + 1);
    const got = hdr.map(h => (pyTruthy(h) ? pyStrip(pyStr(h)) : ''));
    const extraOn = !(extra === null || extra === '');
    if (got.join('\u0000') !== TMPL_HEADERS.join('\u0000') || extraOn) {
        throw new Error(
            '대량입고 양식이 최신 에이블리 양식이 아닙니다.\n' +
            `  현재 헤더: ${listStr(hdr.map(pyStr))}` + (extraOn ? ` (+${pyStr(extra)})` : '') + '\n' +
            `  필요한 헤더: ${listStr(TMPL_HEADERS)}`);
    }
    return ws;
}

/**
 * 2단계: 어드민 출고전표(실제 출고 수량) + 도착보장출고요청(SKU 매핑) → 대량입고 행(6행부터, 7칸), 피킹 항목, 로케이션 전송 행, 봉 수.
 * @param {object} p.admin    어드민 출고전표 책(1행 머리글: 상품코드·수량 필수, 로케이션·바코드 선택)
 * @param {object} p.request  도착보장출고요청 책
 * @param {object} p.template 대량입고 양식 책(머리글 검사용)
 * @param {string} p.requestName  출고요청 파일 이름('즉시출고' 면 ABF)
 */
export function ablyStep2({ admin, request, template, requestName = '', packageBase, packageLimit, now = new Date() }) {
    const log = [];
    const limit = checkLimit(packageLimit);
    const base = pyStrip(String(packageBase ?? ''));
    if (!base) throw new Error('패키지명 베이스를 입력해주세요.');
    // 일반(AB)·즉시출고(ABF)를 파일 이름으로 가른다 — 이름이 없으면 일반으로 잘못 들어가므로 멈춘다
    if (requestName === null || requestName === undefined || !pyStrip(String(requestName))) {
        throw new Error('출고요청 파일 이름이 없습니다(일반/즉시출고를 가를 수 없음).');
    }

    // (a) 어드민 출고전표
    const adm = admin.active();
    log.push(`  전표 시트: '${adm.name}', 행 수: ${adm.maxRow}`);
    const h = headerColumns(adm, 1);
    if (looksLikeStockOut(adm.name, h.keys())) throw new Error(STOCK_OUT_MSG);   // 웹판에서 더함(Python 판은 그대로 돌았다)
    for (const need of ['상품코드', '수량']) {
        if (!h.has(need)) throw new Error(`어드민 전표에 '${need}' 컬럼이 없습니다.\n발견된 헤더: ${listStr([...h.keys()])}`);
    }
    const codeCol = h.get('상품코드'), qtyCol = h.get('수량');
    const locCol = h.get('로케이션') || null, barcodeCol = h.get('바코드') || null;
    if (!barcodeCol) log.push("  ⚠ 어드민 전표에 '바코드' 열이 없어 상품바코드번호에 상품코드를 사용합니다.");
    const adminQty = new Map(), adminLoc = new Map(), adminBarcode = new Map();
    for (let r = 2; r <= adm.maxRow; r++) {
        const code = adm.cell(r, codeCol);
        const qty = toInt(adm.cell(r, qtyCol));
        if (!pyTruthy(code) || qty <= 0) continue;
        const c = strip(code);
        adminQty.set(c, (adminQty.get(c) || 0) + qty);
        if (locCol && !adminLoc.has(c)) adminLoc.set(c, orEmpty(adm.cell(r, locCol)));
        if (barcodeCol && !adminBarcode.has(c)) {
            const bc = adm.cell(r, barcodeCol);
            if (!(bc === null || bc === '')) adminBarcode.set(c, strip(bc));
        }
    }
    let adminTotal = 0;
    for (const q of adminQty.values()) adminTotal += q;
    log.push(`  실제 출고: ${adminQty.size}건 / ${fmtN(adminTotal)}개`);

    // (b) 출고요청 매핑(코드별 첫 줄)
    const reqRows = readAblyRequest(request, log);
    const infoByCode = new Map();
    for (const row of reqRows) if (!infoByCode.has(row.code)) infoByCode.set(row.code, row);

    // (c) 실제 출고 수량 기준 행
    let items = [];
    const notFound = [];
    for (const [code, qty] of adminQty) {
        const info = infoByCode.get(code);
        if (!info) { notFound.push(code); continue; }
        const bc = adminBarcode.get(code);
        const loc = adminLoc.get(code);
        items.push({
            sku: info.sku,
            barcode: pyTruthy(bc) ? bc : code,
            name: info.name,
            option: info.option,
            admin_name: info.admin_name,
            qty,
            location: pyTruthy(loc) ? loc : info.location,
            code,
        });
    }
    if (notFound.length) log.push(`  ⚠ 출고요청에 없는 상품코드: ${notFound.length}건 (예: ${notFound.slice(0, 5).join(', ')})`);
    const matched = items.reduce((s, x) => s + x.qty, 0);
    if (matched !== adminTotal) log.push(`  ⚠ 수량 불일치: 어드민=${adminTotal}, 매칭=${matched}`);
    else log.push(`  ✓ 수량 검증: ${fmtN(adminTotal)}개 일치`);
    const reqTotal = reqRows.reduce((s, x) => s + x.qty, 0);
    if (adminTotal !== reqTotal) {
        const diff = reqTotal - adminTotal;
        log.push('');
        log.push(`  ⚠⚠ 어드민 전표(${fmtN(adminTotal)}개)와 출고요청(${fmtN(reqTotal)}개) 총량이 다릅니다 (차이 ${diff >= 0 ? '+' : ''}${fmtN(diff)}개)`);
        log.push('     · 재고 부족으로 실제 출고가 줄었다면 정상입니다.');
        log.push('     · 그게 아니라면 전표가 오래된 것일 수 있습니다 →');
        log.push('       1단계로 재고출고용 파일을 다시 만들어 이지어드민에 올린 뒤,');
        log.push('       전표를 새로 받아서 2단계를 실행하세요.');
        log.push('');
    }
    if (!items.length) throw new Error('업로드할 항목이 없습니다. (출고요청과 전표가 매칭되지 않음)');

    // (d)(e)(f) 로케이션순 → 한도 분할 → 패키지명
    items = sortedBy(items, x => pyStr(x.location));
    const sp = splitAndName(items, base, limit);
    if (sp.bigSplit) log.push(`  봉투당 한도(${limit}) 초과 분할: ${sp.bigSplit}개 상품 → 총 ${sp.rows.length}봉 분량`);
    items = sp.rows;
    log.push(`  패키지명 부여 완료 → 총 ${sp.counter}봉`);
    const over = overBags(items, limit);
    if (over.length) log.push(`  ⚠⚠ 한도 초과 봉 발견: ${JSON.stringify(over.slice(0, 5))}`);

    // (g) 양식 머리글 검사 + 패키지명순 행
    checkAblyTemplate(template);
    items = sortedBy(items, x => pyStr(x.package));
    const rows = items.map(it => [it.package, it.sku, INSPECTION_METHOD === '프로' ? null : it.barcode, it.name, it.option, it.qty, INSPECTION_METHOD]);
    log.push(`  대량입고 양식: ${rows.length}행 작성 완료`);

    // (i) 피킹 항목(AB) — 어드민 상품명 우선
    const pickItems = items.map(it => ({ ...it, pick_name: cleanProductName(pyTruthy(it.admin_name) ? it.admin_name : orEmpty(it.name)) }));

    // (j)(k) 봉 수 · 로케이션 전송 행(출고요청에 없는 코드도 실제로 나갔으므로 전표 전부)
    const source = ablySource(requestName);
    const location = {
        source,
        rows: [...adminQty].map(([code, qty]) => {
            const info = infoByCode.get(code) || {};
            const nm = pyTruthy(info.admin_name) ? info.admin_name : orEmpty(info.name);
            return [code, nm, qty];
        }),
    };
    const names = fileNames(kstDay(now).yymmdd);
    return {
        rows, pickItems, location,
        packs: { source, day: packDay(base, now), count: countPacks(items) },
        packageCount: sp.counter,
        fileName: names.ablyBulk, pickFileName: names.ablyPick,
        log,
    };
}
