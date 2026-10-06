// [수정됨] minCbm (최소 CBM) 설정 추가
const DEFAULT_SETTINGS = {
    common: {
        docsFee: 88000,
        coFee: 43700,
        oceanFreightPerCbm: 110000,
        minCbm: 1.0, // [추가] LCL 최소 과금 CBM (보통 1.0)
        cbmWeightDivisor: 250,
        vatRate: 0.1,
    },
    import: {
        commissionRates: [
            { label: '3.5%', value: 0.035 },
            { label: '0%', value: 0 }
        ],
        customsFeeRates: [
            { label: '22%', value: 0.22 },
            { label: '29%', value: 0.29 }
        ],
        packagingOptions: [
            { label: '4호-기본', value: 0.31 },
            { label: '아우터', value: 0.46 },
            { label: '없음', value: 0 }
        ],
        labelOptions: [
            { label: '일반라벨', value: 0.03 },
            { label: '없음', value: 0 }
        ]
    },
    customs: {
        defaultUnitPrice: 10,
        defaultQuantityPerBox: 50,
        defaultWeightPerBox: 12,
        tariffRates: [
            { label: '8%', value: 8 },
            { label: '0%', value: 0 },
            { label: '13%', value: 13 }
        ],
        shippingTypes: [
            { label: 'LCL', value: 'LCL' },
            { label: 'FCL', value: 'FCL' }
        ],
        commissionTypes: [
            { label: '퍼센트(%)', value: 'percentage' },
            { label: '개당(원)', value: 'perItem' }
        ]
    },
    warehouse: {
        ratePerCBMPerDay: 1200,      // 창고료 단가 (원/CBM/일)
        freeDays: 7,                 // 무료보관일수 (일)
        surchargeRate: 0.03,         // 통관비 납부지연 기본가산세율 (3%)
        paymentDueDays: 25,          // 납부마감기한 (신고일 + N일)
        dailyInterestRate: 0.00025,  // 일 이자율 (0.025%)
    },
    shipping: {
        container20: { length: 5898, width: 2352, height: 2393 },
        container40: { length: 12032, width: 2352, height: 2393 },
        palletTypes: [
            { label: '없음', value: 'none', length: 0, width: 0, height: 0 },
            { label: '1100x1100', value: '1100x1100', length: 1100, width: 1100, height: 150 },
            { label: '1000x1200', value: '1000x1200', length: 1000, width: 1200, height: 150 },
            { label: '800x1200', value: '800x1200', length: 800, width: 1200, height: 150 },
            { label: '1140x1140', value: '1140x1140', length: 1140, width: 1140, height: 150 },
        ]
    }
};