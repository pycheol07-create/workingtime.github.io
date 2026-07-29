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

export const REVENUE_CHANNELS = [
    { id: 'cafe24',  label: '일반배송(카페24)', shortLabel: '일반배송', color: '#4f46e5',
      field: 'revenueCafe24',  orderField: 'orderCountCafe24' },
    { id: 'direct',  label: '직진배송',         shortLabel: '직진배송', color: '#a855f7',
      field: 'revenueDirect',  orderField: 'orderCountDirect' },
    { id: 'arrival', label: '도착보장',         shortLabel: '도착보장', color: '#0ea5e9',
      field: 'revenueArrival', orderField: 'orderCountArrival' }
];

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
