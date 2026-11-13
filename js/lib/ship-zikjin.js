// === js/lib/ship-zikjin.js ===
// 직진배송 1·2단계 계산 — Python 판(앱\플랫폼출고자동화\직진배송_자동화.py step1_generate_inventory_outbound ·
// step2_generate_outbound_list 빠른 모드)에서 옮겼다. 파일 쓰기·Firestore 는 하지 않는다(결과 객체 + 로그 줄).
//   입력 '책'은 ship-read.readBook 결과.
//   쓰기: ship-write.zikjinListBytes(시트1·2·3 행 — 양식은 앱 Storage ship/templates/zikjin.xlsx) · ship-picking(ZG) · ship-write.stockXlsBytes(1단계).
// 풀 모드는 없앴다(2026-11-10 사용자 결정).
// 2026-11-12 직진배송출고리스트 원본(마스터 약 2만 행)을 없앴다(사용자 결정 — 에이블리와 같은 방식):
//   SKU번호·상품명·옵션은 출고요청에서, 상품바코드번호는 출고전표의 바코드(없으면 상품코드)에서, 검품방식은 '스탠다드' 고정, 시즌·공장상품명은 빈칸.
//   그래서 2단계에 출고요청이 꼭 있어야 한다. 옛 방식과 같은 입력이면 수량·바코드·봉 구성이 같은지 tests/ship-zikjin-compare.test.js 가 본다.

import {
    pyStr, pyStrip, pyTruthy, strip, orEmpty, toInt, isFraction, cleanProductName, sortedBy,
    zikjinSource, packDay, countPacks, checkLimit, splitAndName, overBags, kstDay, fileNames, looksLikeStockOut, STOCK_OUT_MSG,
} from './ship-core.js?v=202611131354';
import { headerColumns } from './ship-read.js?v=202611131354';

export const DATA_START_ROW = 8;   // 지그재그양식서: 머리글 7행, 자료 8행부터
export const TEMPLATE_SHEETS = ['지그재그양식서', '재고로그조회리스트', '패키지번호'];
export const INSPECTION_METHOD = '스탠다드';
const ADMIN_REQUIRED = ['상품코드', '바코드', '상품명', '옵션', '로케이션', '수량'];

const fmtN = (n) => n.toLocaleString('en-US');
const listStr = (a) => '[' + a.map(x => `'${x}'`).join(', ') + ']';

/**
 * 1단계: 출고요청(시트 이름에 '직진배송' 이 든 시트 전부) → 재고출고용 행 [상품코드, 수량] (코드순).
 * @returns {{ items: Array<[string, number]>, aoa: any[][], sheetName: string, fileName: string, log: string[] }}
 */
export function zikjinStep1({ request, now = new Date() }) {
    const log = [];
    const targets = request.sheetNames.filter(s => s.includes('직진배송'));
    log.push(`  전체 시트: ${listStr(request.sheetNames)}`);
    if (!targets.length) throw new Error(`'직진배송'이 포함된 시트가 없습니다.\n파일 내 시트: ${listStr(request.sheetNames)}`);
    log.push(`  처리 대상 시트 (${targets.length}개): ${listStr(targets)}`);

    const merged = new Map();
    let fracCount = 0, totalRows = 0, totalSkipped = 0;
    const duplicates = [];
    targets.forEach((name, idx) => {
        const ws = request.sheet(name);
        log.push(`  [${idx + 1}/${targets.length}] '${name}' (행수: ${ws.maxRow})`);
        const h = headerColumns(ws, 1);
        const missing = ['상품코드', '수량'].filter(k => !h.has(k));
        if (missing.length) {
            log.push(`    ⚠ 컬럼 누락으로 스킵 (누락: ${listStr(missing)}, 발견된 헤더: ${listStr([...h.keys()])})`);
            return;
        }
        const codeCol = h.get('상품코드'), qtyCol = h.get('수량');
        let added = 0, skipped = 0;
        for (let r = 2; r <= ws.maxRow; r++) {
            const code = ws.cell(r, codeCol), qtyRaw = ws.cell(r, qtyCol);
            if (!pyTruthy(code) || qtyRaw === null || qtyRaw === '') { skipped++; continue; }
            const qty = toInt(qtyRaw);
            if (isFraction(qtyRaw)) fracCount++;
            if (qty <= 0) { skipped++; continue; }
            const c = strip(code);
            if (merged.has(c)) {
                duplicates.push([c, merged.get(c), qty, name]);
                merged.set(c, merged.get(c) + qty);
            } else {
                merged.set(c, qty);
            }
            added++;
        }
        log.push(`    → 유효 ${added}건 (스킵 ${skipped}건)`);
        totalRows += added;
        totalSkipped += skipped;
    });
    if (fracCount) log.push(`  소수점 수량 ${fracCount}건 → 행별 버림 처리`);
    if (duplicates.length) {
        log.push(`  ⚠ 동일 상품코드 자동 합산: ${duplicates.length}건`);
        for (const [c, prev, add, src] of duplicates.slice(0, 5)) log.push(`    ${c}: ${prev} + ${add} = ${prev + add} (추가 출처: ${src})`);
        if (duplicates.length > 5) log.push(`    ... 외 ${duplicates.length - 5}건`);
    }
    log.push(`  최종 통합: ${merged.size}건 (원본 행 수 합 ${totalRows}, 스킵 ${totalSkipped})`);
    let total = 0;
    for (const q of merged.values()) total += q;
    log.push(`  총 출고 수량: ${fmtN(total)}개`);
    if (!merged.size) throw new Error('처리할 유효한 데이터가 없습니다.');

    const items = sortedBy([...merged], x => x[0]);
    return {
        items,
        aoa: [['상품코드', '수량'], ...items.map(([c, q]) => [c, q])],
        sheetName: '재고출고용',
        fileName: fileNames(kstDay(now).yymmdd).zikjinStock,
        log,
    };
}

// 출고요청 상품명·옵션 열 — 머리글이 정확히 이것일 때만(앞뒤 공백·줄바꿈만 무시, 2026-11-12 리뷰·사용자 답).
//   '포함' 으로 찾지 않는다. '공장'·'코드' 가 든 머리글은 고르지 않는다. 맞는 열이 없으면 출고전표의 상품명·옵션을 쓴다.
export const REQ_NAME_HEADS = Object.freeze(['상품명']);
export const REQ_OPTION_HEADS = Object.freeze(['옵션', '옵션정보']);
const pickExact = (heads, wanted) => heads.find(x => wanted.includes(x.raw) && !/공장|코드/.test(x.raw)) || null;

/** SKU번호 칸 — 숫자처럼 보이는 글자('100000033')는 숫자로(옛 원본 마스터의 SKU 칸이 숫자였다). 앞자리 0·15자리 넘는 것은 글자 그대로 */
export function skuCell(v) {
    if (typeof v !== 'string') return v;
    const s = pyStrip(v);
    return /^[1-9]\d{0,14}$/.test(s) ? Number(s) : s;
}

/**
 * 출고요청 → 상품코드별 { sku, name, option, hasName, hasOption } (2026-11-12 — 옛 원본 마스터 대신).
 *   시트: 파일 순서대로 전부. 1행 머리글에 '상품코드'와 'SKU' 가 든 열이 있는 시트만(옛 브릿지와 같은 머리글 읽기 — headerColumns).
 *   같은 코드가 여러 줄(여러 시트)이면 **마지막 줄**(옛 브릿지 map.set 덮어쓰기와 같음). SKU 가 빈 줄은 건너뜀.
 *   상품명·옵션 열은 REQ_NAME_HEADS·REQ_OPTION_HEADS 와 정확히 같을 때만(없으면 출고전표 값).
 * @returns {Map<string, object>}
 */
export function readZikjinRequestInfo(book, log = []) {
    const names = [...book.sheetNames];
    const map = new Map();
    const used = [];
    let conflicts = 0;
    for (const sn of names) {
        const ws = book.sheet(sn);
        const hdr = headerColumns(ws, 1);
        const codeCol = hdr.get('상품코드');
        let skuHead = null;
        for (const [h] of hdr) if (h.toUpperCase().includes('SKU')) { skuHead = h; break; }
        if (!codeCol || !skuHead) continue;
        const skuCol = hdr.get(skuHead);
        const heads = [];
        for (let c = 1; c <= ws.maxCol; c++) {
            const v = ws.cell(1, c);
            if (v !== null && v !== undefined && v !== '' && c !== codeCol && c !== skuCol) heads.push({ raw: pyStrip(pyStr(v)), c });
        }
        const name = pickExact(heads, REQ_NAME_HEADS);
        const opt = pickExact(heads.filter(x => x !== name), REQ_OPTION_HEADS);
        let n = 0;
        for (let r = 2; r <= ws.maxRow; r++) {
            const cv = ws.cell(r, codeCol), sv = ws.cell(r, skuCol);
            if (!pyTruthy(cv) || !pyTruthy(sv)) continue;
            const k = strip(cv);
            if (map.has(k) && strip(map.get(k).sku) !== strip(sv)) conflicts++;
            map.set(k, {
                sku: skuCell(sv),
                name: name ? ws.cell(r, name.c) : null,
                option: opt ? ws.cell(r, opt.c) : null,
                hasName: !!name, hasOption: !!opt,
            });
            n++;
        }
        used.push(`'${sn}' ${fmtN(n)}줄 (SKU '${skuHead}' · 상품명 ${name ? `'${name.raw}'` : '없음 → 전표'} · 옵션 ${opt ? `'${opt.raw}'` : '없음 → 전표'})`);
    }
    if (!used.length) {
        throw new Error("출고요청에 '상품코드'와 SKU번호 열이 함께 있는 시트가 없습니다 — 출고리스트의 SKU번호를 채울 수 없습니다.\n"
            + `파일 내 시트: ${listStr(names)}`);
    }
    log.push(`  출고요청 SKU·상품명·옵션: ${fmtN(map.size)}건 — ${used.join(' / ')}`);
    if (conflicts) log.push(`  ⚠ 같은 상품코드에 SKU번호가 다른 줄 ${fmtN(conflicts)}건 — 마지막 줄 SKU번호를 씁니다(옛 방식과 같음)`);
    return map;
}

/**
 * 2단계: 어드민 출고전표 + 출고요청 → 시트1·2·3 행, 피킹 항목, 로케이션 전송 행, 봉 수.
 *   (2026-11-12 원본 없앰) SKU번호·상품명·옵션 = 출고요청, 상품바코드번호 = 출고전표 바코드(상품코드와 다르면 바코드, 없으면 상품코드),
 *   검품방식 '스탠다드', 시즌·공장상품명 빈칸. 출고요청에 없는 상품코드는 출고리스트에서 빠진다(로케이션 전송에는 들어감).
 * @param {object} p
 * @param {object} p.admin      어드민 출고전표 책(활성 시트, 1행 머리글)
 * @param {object} p.request    출고요청 책(필수)
 * @param {string|null} p.requestName  출고요청 파일 이름(일반 'ZG' / 즉시출고 'ZGF'). 없으면 봉 수·로케이션 전송 안 함
 * @param {string} p.packageBase  패키지명 앞부분 — 그대로 '<앞부분>-NN'. 화면은 접두를 붙여 넘긴다(ZG261113 — ship-core.packageNameBase), exe 비교 시험은 YYMMDD
 * @param {number} p.packageLimit 봉투당 한도
 * @param {Array<{name,limit}>} p.specialRules 지정상품 규칙(limit 0 은 꺼짐)
 */
export function zikjinStep2({ admin, request = null, requestName = null, packageBase, packageLimit, specialRules = [], now = new Date() }) {
    const log = [];
    const limit = checkLimit(packageLimit);
    const base = pyStrip(String(packageBase ?? ''));
    if (!base) throw new Error('패키지명 베이스를 입력해주세요.');

    // (a) 어드민 출고전표
    const adm = admin.active();
    log.push(`  시트: '${adm.name}', 행 수: ${adm.maxRow}`);
    const headers = headerColumns(adm, 1);
    if (looksLikeStockOut(adm.name, headers.keys())) throw new Error(STOCK_OUT_MSG);   // 웹판에서 더함 — 누락 열 오류보다 알아듣기 쉽게
    const missing = ADMIN_REQUIRED.filter(h => !headers.has(h));
    if (missing.length) throw new Error(`어드민 전표 필수 컬럼 누락: ${listStr(missing)}\n발견된 헤더: ${listStr([...headers.keys()])}`);
    const adminData = [];
    let fixedCodes = 0;
    for (let r = 2; r <= adm.maxRow; r++) {
        const row = {};
        for (const h of ADMIN_REQUIRED) row[h] = adm.cell(r, headers.get(h));
        if (!pyTruthy(row['상품코드'])) continue;
        row['원본상품코드'] = strip(row['상품코드']);   // 1단계로 올린 코드 — 로케이션 전송은 이 코드로
        if (pyTruthy(row['바코드']) && strip(row['상품코드']) !== strip(row['바코드'])) {
            row['상품코드'] = strip(row['바코드']);
            fixedCodes++;
        }
        row['수량'] = toInt(row['수량']);
        if (row['수량'] <= 0) continue;
        adminData.push(row);
    }
    const adminTotal = adminData.reduce((s, d) => s + d['수량'], 0);
    log.push(`  유효 출고 항목: ${adminData.length}건`);
    log.push(`  총 출고 수량: ${fmtN(adminTotal)}개`);
    if (fixedCodes) log.push(`  바코드 불일치 자동 보정: ${fixedCodes}건`);

    // (b) 출고요청은 꼭 있어야 한다(SKU번호·상품명·옵션) — 전표 검사(1단계 결과를 넣었나 등) 뒤에 본다
    if (!request) throw new Error('출고요청 파일이 없습니다 — 출고리스트의 SKU번호·상품명·옵션을 출고요청에서 가져옵니다.');

    // (c) 시트2 재고로그조회리스트 — 2행부터 새로 (G·H 수식 — G 는 시트1 D:H 에서 입고예정수량을 찾는다)
    log.push(`  재고로그조회리스트: 신규 ${adminData.length}건`);
    const sheet2 = adminData.map((d, k) => {
        const i = k + 2;
        return [d['상품코드'], d['바코드'], d['상품명'], d['옵션'], d['로케이션'], d['수량'],
            { f: `VLOOKUP(A${i},지그재그양식서!D:H,5,FALSE)` }, { f: `IF(A${i}=B${i},"같음","다름")` }];
    });

    // (d) 출고요청 — 상품코드 → SKU번호·상품명·옵션 (옛 원본 마스터 대신)
    const book = typeof request === 'function' ? request() : request;
    const infoByCode = readZikjinRequestInfo(book, log);

    // (e) 패키지 행 — 1단계로 올린 코드(보정 전)로 찾고, 없으면 보정한 코드(바코드)로
    let pkg = [];
    const notFound = [];
    let nameFromAdmin = 0, optionFromAdmin = 0;
    for (const d of adminData) {
        const code = strip(d['상품코드']);
        const info = infoByCode.get(d['원본상품코드']) || infoByCode.get(code);
        if (!info) { notFound.push(d['원본상품코드']); continue; }
        let nameRaw = info.name;
        if (!pyTruthy(nameRaw)) { nameRaw = d['상품명']; nameFromAdmin++; }
        let option = info.option;
        if (!info.hasOption) { option = d['옵션']; optionFromAdmin++; }
        pkg.push({
            sku: info.sku,
            name: cleanProductName(nameRaw),
            name_raw: nameRaw,
            option,
            qty: d['수량'],
            location: orEmpty(d['로케이션']),
            admin_code: code,                     // 상품바코드번호(D) — 전표 바코드(상품코드와 다르면 바코드)
        });
    }
    if (nameFromAdmin) log.push(`  ℹ 출고요청에 상품명이 없어 출고전표 상품명을 쓴 줄: ${fmtN(nameFromAdmin)}건`);
    if (optionFromAdmin) log.push(`  ℹ 출고요청에 옵션 열이 없어 출고전표 옵션을 쓴 줄: ${fmtN(optionFromAdmin)}건`);
    if (notFound.length) {
        log.push(`  ⚠ 출고요청에서 못 찾은 상품코드(SKU번호 없음): ${notFound.length}건 — 출고리스트에서 빠집니다 (예: ${notFound.slice(0, 5).join(', ')})`);
    }
    pkg = sortedBy(pkg, r => pyStr(r.location));
    const pkgTotal = pkg.reduce((s, r) => s + r.qty, 0);
    if (adminTotal !== pkgTotal) log.push(`  ⚠ 수량 합계 불일치: 어드민=${adminTotal}, 패키지=${pkgTotal}`);
    else log.push(`  ✓ 수량 합계 검증: ${fmtN(adminTotal)}개 일치`);

    // (f) 지정상품 규칙(반복 분할) — 지금 설정은 모두 0 이라 꺼져 있다
    const active = (specialRules || []).filter(r => pyStrip(String(r && r.name != null ? r.name : '')) && toInt(r.limit) > 0);
    if (active.length) {
        log.push(`  지정상품 규칙 적용 (${active.length}개)`);
        let splitCount = 0;
        for (let i = 0; i < pkg.length; i++) {
            const row = pkg[i];
            for (const rule of active) {
                const rname = pyStrip(String(rule.name));
                const rlimit = toInt(rule.limit);
                if (pyStr(row.name_raw).includes(rname) || pyStr(row.name).includes(rname)) {
                    if (row.qty > rlimit) {
                        const nr = { ...row, qty: row.qty - rlimit };
                        row.qty = rlimit;
                        pkg.push(nr);
                        splitCount++;
                    }
                    break;
                }
            }
        }
        if (splitCount) log.push(`    ${splitCount}건 분할 완료`);
    }

    // (f-2)(g) 봉투 한도 분할 + 패키지명
    const sp = splitAndName(pkg, base, limit);
    if (sp.bigSplit) log.push(`  봉투당 한도(${limit}) 초과 상품 분할: ${sp.bigSplit}개 상품 → 총 ${sp.rows.length}봉 분량`);
    pkg = sp.rows;
    log.push(`  패키지명 부여 (베이스: ${base}, 봉투당 한도: ${limit})`);
    log.push(`  생성된 패키지 수: ${sp.counter}개`);
    const over = overBags(pkg, limit);
    if (over.length) {
        log.push(`  ⚠⚠ 한도(${limit}) 초과 봉 발견 — 분할 버그 가능성:`);
        for (const [p, q] of over.slice(0, 5)) log.push(`    ${p}: ${q}개`);
    }

    // (h) 시트3 패키지번호 — 분할된 봉 순서 그대로
    log.push(`  패키지번호: 신규 ${pkg.length}건`);
    const sheet3 = pkg.map(r => [r.sku, r.package, r.name, r.option, r.qty]);

    // (i) 시트1 — 8행 아래는 비운 양식에 봉마다 1행(패키지명순). A 패키지명 · B 검품방식 · C SKU번호 · D 상품바코드번호 ·
    //     E 상품명 · F 옵션정보 · G 시즌(빈칸) · H 입고예정수량 · I 공장상품명(빈칸) · J 로케이션. 글자는 '=' 로 시작해도 글자(ship-write.cellXml)
    const sorted = sortedBy(pkg, r => pyStr(r.package));
    const sheet1 = sorted.map(pr => [pr.package, INSPECTION_METHOD, pr.sku, pr.admin_code, pr.name_raw, pr.option,
        null, pr.qty, null, pr.location]);
    log.push(`  지그재그양식서: ${sorted.length}행 작성 완료 (각 봉별 1행)`);

    // (k) 피킹 항목(ZG)
    const pickItems = pkg.map(pr => ({ ...pr, code: pyTruthy(pr.admin_code) ? pr.admin_code : '', pick_name: pyTruthy(pr.name) ? pr.name : '' }));

    // (l) 봉 수 · (m) 로케이션 전송 행 — 마스터에 없는 상품도 실제로 나갔으므로 전표 전부
    const source = zikjinSource(requestName);
    let packs = null;
    if (source === null) log.push('  ⚠ 봉 수 기록 건너뜀: 출고요청 파일이 없어 일반/즉시출고를 구분할 수 없음');
    else packs = { source, day: packDay(base, now), count: countPacks(pkg) };
    const location = {
        source,
        rows: adminData.map(d => [d['원본상품코드'], orEmpty(d['상품명']), d['수량']]),
    };

    const names = fileNames(kstDay(now).yymmdd);
    return {
        sheet1, sheet2, sheet3, pkgRows: pkg, pickItems, packs, location,
        packageCount: sp.counter,
        fileName: names.zikjinList, pickFileName: names.zikjinPick,
        log,
    };
}
