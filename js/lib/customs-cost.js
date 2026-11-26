// === js/lib/customs-cost.js ===
// 통합계산기 통관비 탭 계산식 — 순수 함수(브라우저·Firebase 없음). tests/customs-cost.test.js 가 본다.
// calculator/index.html 의 모듈이 window.CustomsCost 에 붙이고 calculator/CustomsCalculator.js(Babel)의 results 가 부르기만 한다.
// 2026-11-20 CustomsCalculator.js results useMemo 본문을 연산 순서 그대로 옮겼다(결과 모양·null 조건 같음).
//
// 물류장부 muljang/report/customs_cost.py 가 박스기준(LCL·수수료 퍼센트 0) 식을 파이썬으로 같은 순서로 다시 쓴다 —
//   이 식을 바꾸면 그쪽도 같이(계약 시험 물류장부 tests/test_customs_cost_contract.py, 같은 사례 tests/fixtures/customs-cost-cases.json).
import { parseNum, missingRateFields } from './calc-num.js?v=202611260923';

/** 통관비 탭 입력 칸 기본값 중 코드 상수(관세율·LCL·수수료 퍼센트 0 …). 평균 칸(단가·입수·무게)은 settings.customs 에서 온다 */
export const CUSTOMS_FORM_DEFAULTS = Object.freeze({
    calculationMode: 'product',
    productQuantity: '1000',
    boxQuantity: '',
    totalProductPrice: '',
    tariffRate: '8',
    tariffHs: '',
    shippingType: 'LCL',
    containerCost: '',
    commissionType: 'percentage',
    commissionValue: '0',
});

/**
 * 통관비 계산.
 *   form   : 입력 칸(글자 또는 숫자 — parseNum 규칙) { productQuantity, unitPrice, quantityPerBox, boxQuantity, totalProductPrice,
 *            weightPerBox, tariffRate, shippingType, containerCost, commissionType, commissionValue }
 *   mode   : 'product'(상품기준) | 'box'(박스기준)
 *   common : settings.common { docsFee, coFee, oceanFreightPerCbm, minCbm, cbmWeightDivisor, vatRate }
 *   rates  : { customs(고시환율), usdKrw(송금 환율), ... } — 숫자
 * → 결과 객체, 또는 null(고시환율 없음·0 / 송금 환율 없음 / 상품기준 수량·단가 0 / 박스기준 박스·금액 0)
 */
export function customsCost(form, mode, common, rates) {
    const customsRateNum = rates.customs;
    const customsRateMissing = !Number.isFinite(customsRateNum) || customsRateNum === 0;
    const remitMissingKey = missingRateFields(rates, ['usdKrw']).join(',');
    if (customsRateMissing || remitMissingKey) return null;
    const DOCS_FEE = common.docsFee;
    const CO_FEE = common.coFee;
    const OCEAN_FREIGHT_RATE_PER_CBM = common.oceanFreightPerCbm;
    const CBM_WEIGHT_DIVISOR = common.cbmWeightDivisor;
    const VAT_RATE = common.vatRate;
    const MIN_CBM = common.minCbm || 0;

    const tariffRateValue = parseNum(form.tariffRate) / 100;
    const { shippingType, containerCost, commissionType, commissionValue } = form;
    const weightPerBox = parseNum(form.weightPerBox) || 0;

    let totalBoxes;
    let totalProductPriceUSD;
    let totalWeight;
    let productQuantity = 0;
    let costPerItem = 0;
    let commissionAmountKRW = 0;

    if (mode === 'product') {
        productQuantity = parseNum(form.productQuantity) || 0;
        const unitPrice = parseNum(form.unitPrice) || 0;
        const quantityPerBox = parseNum(form.quantityPerBox) || 1;
        if (productQuantity === 0 || unitPrice === 0 || quantityPerBox === 0) return null;
        totalBoxes = Math.ceil(productQuantity / quantityPerBox);
        totalProductPriceUSD = productQuantity * unitPrice;
    } else {
        totalBoxes = parseNum(form.boxQuantity) || 0;
        totalProductPriceUSD = parseNum(form.totalProductPrice) || 0;
        if (totalBoxes === 0 || totalProductPriceUSD === 0) return null;
    }

    totalWeight = totalBoxes * weightPerBox;
    const cbm = totalWeight / CBM_WEIGHT_DIVISOR;

    let oceanFreightKRW;
    if (shippingType === 'FCL') {
        oceanFreightKRW = parseNum(containerCost) || 0;
    } else {
        const chargeableCbm = Math.max(cbm, MIN_CBM);
        oceanFreightKRW = chargeableCbm * OCEAN_FREIGHT_RATE_PER_CBM;
    }

    // 세금계산을 위해 해운비를 USD로 역산 (고시환율 사용)
    const oceanFreightUSDForTax = oceanFreightKRW / rates.customs;
    const taxableBaseUSD = totalProductPriceUSD + oceanFreightUSDForTax;

    // 과세표준(Taxable Base) 및 관/부가세 산출 (고시환율 사용)
    const taxableBaseKRW = taxableBaseUSD * rates.customs;
    const tariffAmountKRW = taxableBaseKRW * tariffRateValue;
    const vatBaseKRW = taxableBaseKRW + tariffAmountKRW;
    const vatAmountKRW = vatBaseKRW * VAT_RATE;
    const totalTaxes = tariffAmountKRW + vatAmountKRW;

    // 실제 물품대금 결제는 원-달러(송금) 환율 적용
    const totalProductPriceKRW = totalProductPriceUSD * rates.usdKrw;

    const commissionValueNum = parseNum(commissionValue) || 0;
    if (commissionType === 'percentage') {
        commissionAmountKRW = totalProductPriceKRW * (commissionValueNum / 100);
    } else if (commissionType === 'perItem' && mode === 'product' && productQuantity > 0) {
        commissionAmountKRW = commissionValueNum * productQuantity;
    }

    const totalCost = DOCS_FEE + CO_FEE + oceanFreightKRW + totalTaxes + commissionAmountKRW;

    if (mode === 'product' && productQuantity > 0) {
        costPerItem = (totalProductPriceKRW + totalCost) / productQuantity;
    }

    return {
        totalProductPriceUSD, totalProductPriceKRW, totalBoxes, totalWeight, cbm, oceanFreightKRW,
        taxableBase: taxableBaseKRW, tariffAmount: tariffAmountKRW, vatAmount: vatAmountKRW, totalTaxes,
        docsFee: DOCS_FEE, coFee: CO_FEE, commissionAmountKRW, totalCost, costPerItem,
    };
}
