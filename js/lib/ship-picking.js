// === js/lib/ship-picking.js ===
// 피킹 작업지시서(ZG 직진 / AB 에이블리) — Python 판 generate_picking_sheet(직진배송_자동화.py)와 같은 새 엑셀.
//   패키지마다 쪽 나눔 + 머리글 반복, medium 검정 테두리(FF000000 — 알파 00 이면 일부 뷰어에서 안 보임), 머리글 채움 FFD9E2F3 굵게 11,
//   A4 가로·가로 1쪽 맞춤·여백 0.3/0.4·가운데 인쇄, A2 틀 고정, 열 너비 = 한글 폭 2 로 센 최대 길이 + 2 (8~46).
//   ZG: 6열(패키지·로케이션순) / AB: 상품코드 열 없음, 패키지 역순(안은 로케이션순).
//   쓸 수 없는 글자(제어 문자·DEL 등)가 있으면 파일을 만들지 않고 경고만(Python 판: 피킹 실패 경고, 출고 파일은 정상).
// ExcelJS 는 넘겨받은 것으로만 쓴다(브라우저 CDN · node 공용). 쓰기 결과는 1단계 시제품에서 openpyxl 판과 0차이.

import { pyStr, pyRstrip, pyTruthy, orEmpty, cleanPickName, cleanPickOption, sortedBy } from './ship-core.js?v=202611121915';

// 피킹 시트에 쓸 수 없는 글자: 제어 문자·DEL·U+FFFE/FFFF·짝 없는 서로게이트(ship-write.ILLEGAL + DEL)
export const PICK_ILLEGAL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** 표시 폭(코드 포인트가 0x7F 넘으면 2) */
export function dispLen(v) {
    let n = 0;
    for (const ch of (v === null || v === undefined ? '' : pyStr(v))) n += ch.codePointAt(0) > 0x7F ? 2 : 1;
    return n;
}

/** 표시 폭 기준 자르기 — 넘치면 '…' */
export function shorten(v, maxW) {
    const s = v === null || v === undefined ? '' : pyStr(v);
    if (dispLen(s) <= maxW) return s;
    let out = '', w = 0;
    for (const ch of s) {
        const cw = ch.codePointAt(0) > 0x7F ? 2 : 1;
        if (w + cw > maxW - 1) break;
        out += ch;
        w += cw;
    }
    return pyRstrip(out) + '…';
}

function colSpecs(prefix) {
    const name = (it) => shorten(cleanPickName(orEmpty(it.pick_name)), 44);
    const opt = (it) => shorten(cleanPickOption(orEmpty(it.option)), 40);
    if (prefix === 'AB') {
        return [
            ['패키지명', it => it.package, 'c'],
            ['상품명', name, 'l'],
            ['옵션', opt, 'l'],
            ['수량', it => it.qty, 'c'],
            ['로케이션', it => orEmpty(it.location), 'l'],
        ];
    }
    return [
        ['패키지명', it => it.package, 'c'],
        ['상품코드', it => (pyTruthy(it.code) ? it.code : orEmpty(it.barcode)), 'c'],
        ['상품명', name, 'l'],
        ['옵션', opt, 'l'],
        ['수량', it => it.qty, 'c'],
        ['로케이션', it => orEmpty(it.location), 'l'],
    ];
}

/** 순수 계산: 머리글·정렬·행·열 너비 */
export function pickingLayout(items, prefix = 'AB') {
    const specs = colSpecs(prefix);
    let ordered;
    if (prefix === 'AB') {
        ordered = sortedBy(items, x => pyStr(x.location));
        ordered = sortedBy(ordered, x => pyStr(x.package), true);
    } else {
        ordered = sortedBy(items, x => [pyStr(x.package), pyStr(x.location)]);
    }
    const headers = specs.map(s => s[0]);
    const maxLen = headers.map(dispLen);
    const rows = ordered.map(it => {
        const vals = specs.map(s => s[1](it));
        vals.forEach((v, i) => { maxLen[i] = Math.max(maxLen[i], dispLen(v)); });
        return [it.package, vals];
    });
    const widths = maxLen.map(ml => Math.max(8, Math.min(46, ml + 2)));
    let pkgCount = 0, cur = null;
    for (const [p] of rows) if (p !== cur) { cur = p; pkgCount++; }
    return { headers, aligns: specs.map(s => s[2]), rows, widths, pkgCount };
}

/** 칸 값 그대로 — 글자는 '=' 로 시작해도 글자로 쓴다(2026-11-12 보안: 상품명 등이 수식으로 열리지 않게.
 *  openpyxl 판은 '=' 로 시작하는 2자 이상 글자를 수식으로 썼다 — 의도한 차이) */
export function excelValue(v) {
    return v;
}

/** ExcelJS 통합 문서 만들기 — 쓸 수 없는 글자가 있으면 throw */
export function buildPickingWorkbook(ExcelJS, items, prefix = 'AB') {
    const lay = pickingLayout(items, prefix);
    lay.rows.forEach(([, vals], i) => vals.forEach((v, j) => {
        if (typeof v === 'string' && PICK_ILLEGAL.test(v)) {
            throw new Error(`엑셀에 쓸 수 없는 글자(제어 문자 등)가 있습니다 (${lay.headers[j]} 열, ${i + 1}번째 항목)`);
        }
    }));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('피킹작업지시서');
    const edge = { style: 'medium', color: { argb: 'FF000000' } };
    const border = { left: edge, right: edge, top: edge, bottom: edge };
    const center = { horizontal: 'center', vertical: 'middle', wrapText: false };
    const left = { horizontal: 'left', vertical: 'middle', wrapText: false };
    const writeHeader = (r) => {
        lay.headers.forEach((h, j) => {
            const c = ws.getCell(r, j + 1);
            c.value = h;
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
            c.font = { bold: true, size: 11 };
            c.border = border;
            c.alignment = center;
        });
        ws.getRow(r).height = 22;
    };
    lay.widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    let r = 1, curPkg = null;
    writeHeader(r++);
    for (const [p, vals] of lay.rows) {
        if (curPkg !== null && p !== curPkg) {
            ws.getRow(r - 1).addPageBreak(1, 16384);   // 패키지마다 새 A4 장
            writeHeader(r++);
        }
        curPkg = p;
        vals.forEach((v, j) => {
            const c = ws.getCell(r, j + 1);
            c.value = excelValue(v);
            c.border = border;
            c.alignment = lay.aligns[j] === 'c' ? center : left;
        });
        r++;
    }
    ws.pageSetup = {
        orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.5, footer: 0.5 },
    };
    ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A1' }];
    return { wb, pkgCount: lay.pkgCount };
}

/**
 * 피킹 작업지시서 → { bytes, pkgCount, warning }.
 * 쓸 수 없는 글자가 있으면 파일을 만들지 않고 bytes:null + 경고 한 줄(Python 판: '피킹작업지시서 생성 실패 (출고리스트는 정상)').
 * ExcelJS 는 이런 글자를 걸러 주지 않으므로 먼저 막는다(조용히 지우지 않는다).
 */
export async function pickingBytes(ExcelJS, items, prefix = 'AB') {
    let built;
    try {
        built = buildPickingWorkbook(ExcelJS, items, prefix);
    } catch (e) {
        const main = prefix === 'AB' ? '대량입고 양식' : '출고리스트';
        return { bytes: null, pkgCount: 0, warning: `⚠ 피킹작업지시서 생성 실패 (${main}는 정상): ${e.message}` };
    }
    const buf = await built.wb.xlsx.writeBuffer();
    return { bytes: new Uint8Array(buf), pkgCount: built.pkgCount, warning: '' };
}
