// === js/lib/calc-pack-map.js ===
// 통합계산기 [패킹 불러오기] — 패킹 문서 읽기 · 계산기 칸으로 옮기기(순수 함수, 브라우저·Firebase 없음).
//   tests/calc-pack-map.test.js 가 본다. calculator/index.html 의 모듈이 window.CalcPackMap 에 붙이고
//   calculator/PackPicker.js·CustomsCalculator.js·WarehouseFeeCalculator.js(Babel)가 쓴다. calculator/calc-packings.js 는 import 한다.
//
// 문서 integrations/calcPackings 는 시트 「패킹.송금관리」 바인딩 Apps Script(입고위젯_apps_script.gs)가 쓴다:
//   { v: 1, rowsJson: '[{label, entryDate, boxes, pieces, amtMake, amtBuy, feeMake, feeBuy, cbm, portDate,
//                       customsEta, arriveDate, storageRate, lateTaxRate, status}]', count, updatedAt, ok, error, failedAt }
//   날짜는 'YYYY-MM-DD'(시트 시간대) 또는 null. 숫자는 숫자 또는 null. lateTaxRate 는 비율(0.03 = 3%).
//   목록: 항목 '패킹리스트' 줄 중 상태 '미입고' + 상태가 빈 최근 30일(일자 기준). 최대 100줄.
// 사용자 결정(2026-11-17): 통관비는 박스기준, 수수료는 넣지 않는다. 금액은 제작+사입(수수료 제외).

export const PACKS_VERSION = 1;
export const STALE_MS = 3 * 60 * 60 * 1000;        // 시트 기준 시각이 이보다 오래되면 노란 경고

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ymdOrNull = (v) => (typeof v === 'string' && YMD.test(v) ? v : null);
const strOf = (v) => (typeof v === 'string' ? v.trim() : '');
// 계산기 칸에 넣을 글자 — 부동소수 찌꺼기(3.0000000000000004)를 지운다
const numText = (n, digits = 6) => String(Number(n.toFixed(digits)));

/** 한 줄을 정해진 모양으로 — 모르는 칸은 버린다. 객체가 아니면 null */
export function normPack(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    return {
        label: strOf(r.label),
        entryDate: ymdOrNull(r.entryDate),
        boxes: numOrNull(r.boxes),
        pieces: numOrNull(r.pieces),
        amtMake: numOrNull(r.amtMake),
        amtBuy: numOrNull(r.amtBuy),
        feeMake: numOrNull(r.feeMake),
        feeBuy: numOrNull(r.feeBuy),
        cbm: numOrNull(r.cbm),
        portDate: ymdOrNull(r.portDate),
        customsEta: ymdOrNull(r.customsEta),
        arriveDate: ymdOrNull(r.arriveDate),
        storageRate: numOrNull(r.storageRate),
        lateTaxRate: numOrNull(r.lateTaxRate),
        status: strOf(r.status),
    };
}

/**
 * 문서(또는 rowsJson 글자) → { ok, packs, error }
 *   문서를 넘기면 v 가 PACKS_VERSION 과 같아야 한다(모양이 바뀐 새 문서를 옛 화면이 잘못 읽지 않게).
 *   글자만 넘기면 v 는 보지 않는다.
 */
export function parsePacks(input) {
    let raw = input;
    if (input && typeof input === 'object') {
        if (input.v !== PACKS_VERSION) return { ok: false, packs: [], error: 'version' };
        raw = input.rowsJson;
    }
    if (typeof raw !== 'string' || !raw) return { ok: false, packs: [], error: 'empty' };
    let arr;
    try { arr = JSON.parse(raw); } catch (e) { return { ok: false, packs: [], error: 'json' }; }
    if (!Array.isArray(arr)) return { ok: false, packs: [], error: 'json' };
    const packs = arr.map(normPack).filter(Boolean);
    return { ok: true, packs, error: null };
}

/** 상품 금액 USD = 제작 + 사입(수수료 제외). 둘 다 없으면 null */
export function goodsUsd(pack) {
    const a = numOrNull(pack && pack.amtMake), b = numOrNull(pack && pack.amtBuy);
    if (a === null && b === null) return null;
    return (a || 0) + (b || 0);
}

/** 'YYYY-MM-DD' → 'M/D' (없으면 '') */
export function shortYmd(ymd) {
    if (!ymdOrNull(ymd)) return '';
    return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

/** 화면 이름 — 라벨(11/14-1)이 없으면 '일자 M/D' */
export function packName(pack) {
    if (pack && pack.label) return pack.label;
    const d = shortYmd(pack && pack.entryDate);
    return d ? `일자 ${d}` : '이름 없음';
}

/** 목록 순서 — 입항일 빠른 순, 입항일 미정은 뒤. 같으면 일자 순 → 라벨 순 */
export function sortForPicker(packs) {
    const key = (p) => p.portDate || '9999-99-99';
    return (packs || []).slice().sort((a, b) => {
        if (key(a) !== key(b)) return key(a) < key(b) ? -1 : 1;
        const ea = a.entryDate || '', eb = b.entryDate || '';
        if (ea !== eb) return ea < eb ? -1 : 1;
        return a.label < b.label ? -1 : a.label > b.label ? 1 : 0;
    });
}

const fmtInt = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
const fmtUsd = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
const fmtCbm = (n) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(n);

/** 목록 두 줄 — line1 '라벨 · 박스 N · N ea · $N', line2 '입항 M/D · 통관예정 미정 · CBM 미정' */
export function packLines(pack) {
    const usd = goodsUsd(pack);
    const line1 = [
        packName(pack),
        `박스 ${pack.boxes !== null ? fmtInt(pack.boxes) : '미정'}`,
        `${pack.pieces !== null ? fmtInt(pack.pieces) : '미정'} ea`,
        usd !== null ? `$${fmtUsd(usd)}` : '$ 미정',
    ].join(' · ');
    const line2 = [
        `입항 ${shortYmd(pack.portDate) || '미정'}`,
        `통관예정 ${shortYmd(pack.customsEta) || '미정'}`,
        `CBM ${pack.cbm !== null ? fmtCbm(pack.cbm) : '미정'}`,
    ].join(' · ');
    return { line1, line2 };
}

/** 시트 기준 시각 표시 — 오늘이면 'HH:MM', 아니면 'M/D HH:MM'. stale = 3시간 넘음 */
export function sheetTimeView(updatedAtMs, nowMs) {
    if (typeof updatedAtMs !== 'number' || !Number.isFinite(updatedAtMs)) return { text: '알 수 없음', stale: true };
    const d = new Date(updatedAtMs), n = new Date(nowMs);
    const p2 = (x) => String(x).padStart(2, '0');
    const hm = `${p2(d.getHours())}:${p2(d.getMinutes())}`;
    const sameDay = d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
    return { text: sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`, stale: nowMs - updatedAtMs > STALE_MS };
}

/**
 * 통관비 계산기(박스기준)로 — { fields, mode: 'box', changed[], missing[], reset[] }
 *   reset = 못 채워 처음 값으로 돌릴 formData 키(앞서 고른 패킹 값이 남지 않게 — 화면이 초기값·logis 평균으로 되돌린다).
 *   fields 키 = CustomsCalculator formData 키(boxQuantity · totalProductPrice · weightPerBox). 값은 글자.
 *   박스당 무게 = cbm × settings.common.cbmWeightDivisor ÷ boxes
 *     (계산기 CBM = 총 박스 × 박스당 무게 ÷ cbmWeightDivisor 이므로 계산기 CBM 이 시트 CBM 과 같아진다).
 *   cbm·boxes 가 없으면 박스당 무게는 그대로(missing). 수수료는 넣지 않는다.
 */
export function toCustoms(pack, settings) {
    const fields = {}, changed = ['계산 기준(박스기준)'], missing = [], reset = [];
    const boxes = numOrNull(pack && pack.boxes);
    const okBoxes = boxes !== null && boxes > 0;
    if (okBoxes) { fields.boxQuantity = numText(boxes); changed.push('총 박스 수량'); }
    else { missing.push('총 박스 수량'); reset.push('boxQuantity'); }

    const usd = goodsUsd(pack);
    if (usd !== null && usd > 0) { fields.totalProductPrice = numText(usd, 2); changed.push('총 상품 금액'); }
    else { missing.push('총 상품 금액'); reset.push('totalProductPrice'); }

    const cbm = numOrNull(pack && pack.cbm);
    const div = numOrNull(settings && settings.common && settings.common.cbmWeightDivisor);
    if (cbm !== null && cbm > 0 && okBoxes && div !== null && div > 0) {
        fields.weightPerBox = numText((cbm * div) / boxes);
        changed.push('박스당 무게(CBM 환산)');
    } else {
        missing.push('박스당 무게');
        reset.push('weightPerBox');
    }
    missing.push('운송 형태', '컨테이너 비용', '관세', '환율');
    return { fields, mode: 'box', changed, missing, reset };
}

/**
 * 창고료·가산세 계산기(상품금액 기준)로 — { fields, mode: 'amount', changed[], missing[], reset[] }
 *   reset = 못 채워 처음 값으로 돌릴 formData 키(날짜는 오늘, 창고료 단가·가산세율은 설정값 — 화면이 처리). 수동 박스·CBM 은 fields 에 '' 로 온다.
 *   fields 키 = WarehouseFeeCalculator formData 키 + 수동입력(useManualBoxCbm · manualBoxes · manualCbm).
 *   박스·CBM 수동입력은 늘 켠다(값이 없으면 빈칸 = 자동 산출). 통관일·창고료 단가·가산세율은 값이 있을 때만 바꾼다.
 *   무료보관일수는 건드리지 않는다. settings 는 지금 쓰지 않는다(toCustoms 와 부르는 모양을 같게).
 */
export function toWarehouse(pack, settings) {
    const fields = {}, changed = ['계산 기준(상품금액)'], missing = [], reset = [];
    const usd = goodsUsd(pack);
    if (usd !== null && usd > 0) { fields.totalAmountUSD = numText(usd, 2); changed.push('상품금액'); }
    else { missing.push('상품금액'); reset.push('totalAmountUSD'); }

    const pieces = numOrNull(pack && pack.pieces);
    if (pieces !== null && pieces > 0) { fields.quantity = numText(pieces); changed.push('상품수량'); }
    else { missing.push('상품수량'); reset.push('quantity'); }

    fields.useManualBoxCbm = true;
    const boxes = numOrNull(pack && pack.boxes);
    if (boxes !== null && boxes > 0) { fields.manualBoxes = numText(boxes); changed.push('실제 박스수량'); }
    else { fields.manualBoxes = ''; missing.push('실제 박스수량'); }
    const cbm = numOrNull(pack && pack.cbm);
    if (cbm !== null && cbm > 0) { fields.manualCbm = numText(cbm); changed.push('실제 CBM'); }
    else { fields.manualCbm = ''; missing.push('실제 CBM'); }

    const port = ymdOrNull(pack && pack.portDate);
    if (port) { fields.arrivalDate = port; changed.push('입항일'); } else { missing.push('입항일'); reset.push('arrivalDate'); }
    const eta = ymdOrNull(pack && pack.customsEta);
    if (eta) { fields.clearanceDate = eta; changed.push('통관일'); } else { missing.push('통관일'); reset.push('clearanceDate'); }

    const rate = numOrNull(pack && pack.storageRate);
    if (rate !== null && rate >= 0) { fields.warehouseRate = numText(rate); changed.push('창고료 단가'); }
    else { missing.push('창고료 단가'); reset.push('warehouseRate'); }
    const late = numOrNull(pack && pack.lateTaxRate);
    if (late !== null && late >= 0) { fields.surchargeRate = numText(late * 100); changed.push('가산세율'); }
    else { missing.push('가산세율'); reset.push('surchargeRate'); }

    missing.push('관세율');
    return { fields, mode: 'amount', changed, missing, reset };
}
