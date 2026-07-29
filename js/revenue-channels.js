// === js/revenue-channels.js ===
// 💰 매출 채널 정의 — 경영지표 '매출 현황'을 카페24 / 직진배송 / 도착보장 3개로 나눠 관리한다.
//
// 저장 구조 (history/{date}.management, daily_data/{date}.management)
//   revenueCafe24  : 카페24 매출
//   revenueDirect  : 직진배송 매출
//   revenueArrival : 도착보장 매출
//   revenue        : 위 3개의 합계 (기존 코드가 그대로 읽을 수 있도록 총액을 계속 유지)
//
// ⚠️ 채널 구분 이전에 입력된 과거 데이터는 revenue만 존재한다.
//    이 경우 채널별 값은 0이고 총액만 유효하므로, 총액을 쓰는 화면은 그대로 동작한다.

export const REVENUE_CHANNELS = [
    { id: 'cafe24',  field: 'revenueCafe24',  label: '카페24',   color: '#4f46e5' },
    { id: 'direct',  field: 'revenueDirect',  label: '직진배송', color: '#a855f7' },
    { id: 'arrival', field: 'revenueArrival', label: '도착보장', color: '#0ea5e9' }
];

/** 채널 합계 */
export const revenueChannelSum = (mgmt = {}) =>
    REVENUE_CHANNELS.reduce((s, c) => s + (Number(mgmt[c.field]) || 0), 0);

/** 그 날의 총 매출액 — 채널 합계가 있으면 그 값, 없으면 기존 revenue(구 데이터) */
export const revenueTotalOf = (mgmt = {}) => {
    const sum = revenueChannelSum(mgmt);
    return sum > 0 ? sum : (Number(mgmt.revenue) || 0);
};

/** 채널 구분 없이 총액만 있는 과거 데이터인지 */
export const isLegacyRevenue = (mgmt = {}) =>
    revenueChannelSum(mgmt) === 0 && (Number(mgmt.revenue) || 0) > 0;
