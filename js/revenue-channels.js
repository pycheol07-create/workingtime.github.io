// === js/revenue-channels.js ===
// 💰 판매 채널 정의 — 경영지표 '매출 현황'을 일반배송(카페24) / 직진배송 / 도착보장 3개로 나눠 관리한다.
//    매출액과 주문 건수를 채널별로 각각 입력·집계하고, 업무 예측의 실적 예측도 이 구분을 그대로 쓴다.
//
// 저장 구조 (history/{date}.management, daily_data/{date}.management)
//   revenueCafe24  / orderCountCafe24   : 일반배송(카페24)
//   revenueDirect  / orderCountDirect   : 직진배송
//   revenueArrival / orderCountArrival  : 도착보장
//   revenue        / orderCount         : 위 3개의 합계
//     └ 정산·리포트·대시보드 등 기존 코드가 그대로 읽을 수 있도록 총액/총건수를 계속 유지한다.
//
// ⚠️ 채널 구분 이전에 입력된 과거 데이터는 revenue / orderCount 총액만 존재한다.
//    이 경우 채널별 값은 0이고 총액만 유효하므로, 총액을 쓰는 화면은 그대로 동작한다.

// taskKey = 그 채널의 배송량(물량)에 해당하는 업무.
//   실적 예측에서 채널 하나를 고르면 매출·주문건·배송량이 모두 그 채널 기준으로만
//   계산되도록 세 값을 한 묶음으로 정의해 둔다.
//   (예: 일반배송 = 국내배송 업무량 + 카페24 매출/주문건)
export const REVENUE_CHANNELS = [
    { id: 'cafe24',  label: '일반배송(카페24)', shortLabel: '일반배송', color: '#4f46e5',
      field: 'revenueCafe24',  orderField: 'orderCountCafe24',  taskKey: '국내배송' },
    { id: 'direct',  label: '직진배송',         shortLabel: '직진배송', color: '#a855f7',
      field: 'revenueDirect',  orderField: 'orderCountDirect',  taskKey: '직진배송' },
    { id: 'arrival', label: '도착보장',         shortLabel: '도착보장', color: '#0ea5e9',
      field: 'revenueArrival', orderField: 'orderCountArrival', taskKey: '에이블리배송' }
];

export const channelById = (id) => REVENUE_CHANNELS.find(c => c.id === id) || null;

// 채널별로 나눠 입력하는 지표들. (총합 필드 = 채널 합계)
export const CHANNEL_METRICS = [
    { key: 'revenue',    fieldOf: (c) => c.field,      totalField: 'revenue',    label: '매출액',   unit: '원' },
    { key: 'orderCount', fieldOf: (c) => c.orderField, totalField: 'orderCount', label: '주문 건수', unit: '건' }
];

const sumOf = (mgmt, pick) => REVENUE_CHANNELS.reduce((s, c) => s + (Number(mgmt[pick(c)]) || 0), 0);

/** 채널 매출 합계 */
export const revenueChannelSum = (mgmt = {}) => sumOf(mgmt, c => c.field);
/** 채널 주문건수 합계 */
export const orderCountChannelSum = (mgmt = {}) => sumOf(mgmt, c => c.orderField);

/** 그 날의 총 매출액 — 채널 합계가 있으면 그 값, 없으면 기존 revenue(구 데이터) */
export const revenueTotalOf = (mgmt = {}) => {
    const sum = revenueChannelSum(mgmt);
    return sum > 0 ? sum : (Number(mgmt.revenue) || 0);
};

/** 그 날의 총 주문 건수 — 채널 합계가 있으면 그 값, 없으면 기존 orderCount(구 데이터) */
export const orderCountTotalOf = (mgmt = {}) => {
    const sum = orderCountChannelSum(mgmt);
    return sum > 0 ? sum : (Number(mgmt.orderCount) || 0);
};

/** 채널 구분 없이 총액만 있는 과거 데이터인지 */
export const isLegacyRevenue = (mgmt = {}) =>
    revenueChannelSum(mgmt) === 0 && (Number(mgmt.revenue) || 0) > 0;

/** 채널 구분 없이 총 건수만 있는 과거 데이터인지 */
export const isLegacyOrderCount = (mgmt = {}) =>
    orderCountChannelSum(mgmt) === 0 && (Number(mgmt.orderCount) || 0) > 0;

/** 실적 예측 스코프 — id가 없으면(=전체) 총계/전 채널 물량 합으로 계산한다.
 *  하루치 데이터(day)를 받아 매출·주문건수·배송량을 같은 채널 기준으로 뽑아준다. */
export const channelScope = (id) => {
    const c = channelById(id);
    if (!c) {
        return {
            id: 'all', label: '전체', color: '#2563eb',
            revenueOf: (d) => revenueTotalOf(d?.management),
            orderCountOf: (d) => orderCountTotalOf(d?.management),
            deliveryOf: (d) => REVENUE_CHANNELS.reduce((s, ch) => s + (Number(d?.taskQuantities?.[ch.taskKey]) || 0), 0),
            deliveryLabel: '전체 배송량',
            deliverySource: REVENUE_CHANNELS.map(ch => ch.taskKey).join(' + ')
        };
    }
    return {
        id: c.id, label: c.label, color: c.color,
        revenueOf: (d) => Number(d?.management?.[c.field]) || 0,
        orderCountOf: (d) => Number(d?.management?.[c.orderField]) || 0,
        deliveryOf: (d) => Number(d?.taskQuantities?.[c.taskKey]) || 0,
        deliveryLabel: `${c.shortLabel} 배송량`,
        deliverySource: c.taskKey
    };
};
