// === js/lib/ship-zikjin.js ===
// 직진배송 1·2단계 계산 — Python 판(앱\플랫폼출고자동화\직진배송_자동화.py step1_generate_inventory_outbound ·
// step2_generate_outbound_list 빠른 모드)과 같은 행을 만든다. 파일 쓰기·Firestore 는 하지 않는다(결과 객체 + 로그 줄).
//   입력 '책'은 ship-read.readBook 결과. 출고리스트 원본은 readBook(…, { formulas: true }) 로 읽는다(Python 판도 수식 그대로 읽음).
//   쓰기: ship-write.zikjinListBytes(시트1·2·3 행) · ship-picking(ZG) · ship-write.stockXlsBytes(1단계).
// 풀 모드는 없앴다(2026-11-10 사용자 결정).

import {
    pyStr, pyStrip, pyTruthy, strip, orEmpty, toInt, isFraction, cleanProductName, sortedBy,
    zikjinSource, packDay, countPacks, checkLimit, splitAndName, overBags, kstDay, fileNames, looksLikeStockOut, STOCK_OUT_MSG,
} from './ship-core.js?v=202611120950';
import { headerColumns } from './ship-read.js?v=202611120950';

export const DATA_START_ROW = 8;   // 지그재그양식서: 머리글 7행, 자료 8행부터
export const TEMPLATE_SHEETS = ['지그재그양식서', '재고로그조회리스트', '패키지번호'];
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

/** 출고요청 → 상품코드→SKU번호 브릿지(시트 전부, 1행 머리글, 'SKU' 가 든 첫 열) */
function requestBridge(request, log) {
    const map = new Map();
    if (!request) return map;
    try {
        const book = typeof request === 'function' ? request() : request;
        for (const sn of book.sheetNames) {
            const ws = book.sheet(sn);
            const hdr = headerColumns(ws, 1);
            const codeCol = hdr.get('상품코드');
            let skuCol = null;
            for (const [h, c] of hdr) if (h.toUpperCase().includes('SKU')) { skuCol = c; break; }
            if (!codeCol || !skuCol) continue;
            for (let r = 2; r <= ws.maxRow; r++) {
                const code = ws.cell(r, codeCol), sku = ws.cell(r, skuCol);
                if (pyTruthy(code) && pyTruthy(sku)) map.set(strip(code), strip(sku));
            }
        }
        log.push(`  출고요청 브릿지(상품코드→SKU번호): ${fmtN(map.size)}건`);
    } catch (e) {
        log.push(`  ⚠ 출고요청 브릿지 로드 실패 (무시하고 계속): ${e && e.message ? e.message : e}`);
    }
    return map;
}

/**
 * 2단계: 어드민 출고전표 + 출고리스트 원본(+ 출고요청) → 시트1·2·3 행, 피킹 항목, 로케이션 전송 행, 봉 수.
 * @param {object} p
 * @param {object} p.admin      어드민 출고전표 책(활성 시트, 1행 머리글)
 * @param {object} p.template   출고리스트 원본 책(readBook formulas:true — 지그재그양식서 값만 쓴다)
 * @param {object|function|null} p.request  출고요청 책(선택 — 바코드 미등록 상품 SKU 브릿지). 함수면 불러서 쓴다(실패해도 계속)
 * @param {string|null} p.requestName  출고요청 파일 이름(일반 'ZG' / 즉시출고 'ZGF'). 없으면 봉 수·로케이션 전송 안 함
 * @param {string} p.packageBase  패키지명 베이스(YYMMDD)
 * @param {number} p.packageLimit 봉투당 한도
 * @param {Array<{name,limit}>} p.specialRules 지정상품 규칙(limit 0 은 꺼짐)
 */
export function zikjinStep2({ admin, template, request = null, requestName = null, packageBase, packageLimit, specialRules = [], now = new Date() }) {
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

    // (b) 원본 시트 확인
    for (const s of TEMPLATE_SHEETS) if (!template.sheet(s)) throw new Error(`템플릿에 '${s}' 시트가 없습니다.`);
    const sh1 = template.sheet('지그재그양식서');
    const sh2 = template.sheet('재고로그조회리스트');
    const sh3 = template.sheet('패키지번호');

    // (c) 시트2 재고로그조회리스트 — 2행부터 새로 (G·H 수식)
    log.push(`  재고로그조회리스트 초기화 (기존 ${sh2.maxRow - 1}건 → 신규 ${adminData.length}건)`);
    const sheet2 = adminData.map((d, k) => {
        const i = k + 2;
        return [d['상품코드'], d['바코드'], d['상품명'], d['옵션'], d['로케이션'], d['수량'],
            { f: `VLOOKUP(A${i},지그재그양식서!D:H,5,FALSE)` }, { f: `IF(A${i}=B${i},"같음","다름")` }];
    });

    // (d) 마스터 — 바코드(D)·SKU번호(C) 두 가지로 찾기
    const byBarcode = new Map(), bySku = new Map();
    for (let r = DATA_START_ROW; r <= sh1.maxRow; r++) {
        const skuno = sh1.cell(r, 3), barcode = sh1.cell(r, 4);
        const info = {
            sku: skuno, name: sh1.cell(r, 5), option: sh1.cell(r, 6), inspect: sh1.cell(r, 2),
            barcode_master: barcode, season: sh1.cell(r, 7), factory_name: sh1.cell(r, 9), row: r,
        };
        if (skuno !== null) {
            const s = strip(skuno);
            if (s && !bySku.has(s)) bySku.set(s, info);
        }
        if (barcode !== null) {
            const bc = strip(barcode);
            if (bc && bc !== '-') byBarcode.set(bc, info);
        }
    }
    log.push(`  마스터: 바코드 ${fmtN(byBarcode.size)}건, SKU번호 ${fmtN(bySku.size)}건`);

    // (d-2) 출고요청 브릿지
    const codeToSku = requestBridge(request, log);

    // (e) 패키지 행
    let pkg = [];
    const notFound = [];
    let recovered = 0;
    for (const d of adminData) {
        const code = strip(d['상품코드']);
        let info = byBarcode.get(code);
        if (!info) {
            const skuno = codeToSku.get(code);
            if (skuno) {
                info = bySku.get(skuno);
                if (info) recovered++;
            }
        }
        if (!info) { notFound.push(code); continue; }
        pkg.push({
            sku: info.sku,
            name: cleanProductName(info.name),
            name_raw: info.name,
            option: info.option,
            qty: d['수량'],
            location: orEmpty(d['로케이션']),
            admin_code: pyTruthy(d['상품코드']) ? strip(d['상품코드']) : '',
        });
    }
    if (recovered) log.push(`  ✓ 바코드 미등록 상품 ${recovered}건을 SKU번호로 복구 (출고요청 브릿지)`);
    if (notFound.length) {
        const hint = codeToSku.size ? '' : ' (출고요청 파일 미지정 시 복구 불가)';
        log.push(`  ⚠ 마스터에서 미발견 상품코드: ${notFound.length}건${hint} (예: ${notFound.slice(0, 5).join(', ')})`);
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
    log.push(`  패키지번호 시트 초기화 (기존 ${sh3.maxRow - 1}건 → 신규 ${pkg.length}건)`);
    const sheet3 = pkg.map(r => [r.sku, r.package, r.name, r.option, r.qty]);

    // (i) 시트1 — 8행 아래를 지우고 봉마다 1행(패키지명순)
    const sorted = sortedBy(pkg, r => pyStr(r.package));
    let barcodeRecovered = 0;
    const sheet1 = sorted.map(pr => {
        const m = bySku.get(strip(pr.sku)) || {};
        const mbc = m.barcode_master !== undefined ? m.barcode_master : null;
        const mbcS = mbc !== null ? strip(mbc) : '';
        let bc;
        if (!mbcS || mbcS === '-') {
            bc = pyTruthy(pr.admin_code) ? pr.admin_code : mbc;
            if (pyTruthy(bc) && !['', '-'].includes(strip(bc))) barcodeRecovered++;
        } else {
            bc = mbc;
        }
        const g = (k) => (m[k] !== undefined ? m[k] : null);
        return [pr.package, g('inspect'), pr.sku, bc,
            pyTruthy(g('name')) ? g('name') : pr.name_raw,
            pyTruthy(g('option')) ? g('option') : pr.option,
            g('season'), pr.qty, g('factory_name'), pr.location];
    });
    log.push(`  지그재그양식서: ${sorted.length}행 작성 완료 (각 봉별 1행)`);
    if (barcodeRecovered) log.push(`  ✓ 마스터 바코드 미등록 행 ${barcodeRecovered}건의 상품바코드번호(D)를 어드민 상품코드로 채움`);

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
