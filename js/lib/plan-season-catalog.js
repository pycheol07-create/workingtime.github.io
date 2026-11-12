// === js/lib/plan-season-catalog.js ===
// 운영 계획 v2 D2 — 업종 맞춤(여성의류 쇼핑몰 물류팀) 시즌 기본 틀 + 업무 묶음 + GIP 계절 지수(정적 상수).
//   ⚠️ 건수·지수만(금액·공급처 없음). 실측(월 요약 OpsMonthly 가 1년 쌓임)이 있으면 plan-season.js 가 실측을 우선한다.
//   GIP 지수 출처: 사내 데이터 창고(GIP) 2026-11-05 조회 — 지수 = 그 달 하루 평균 ÷ 그 해 하루 평균(1~10월 기준).
//     주문 = 국내 3채널(자사몰·지그재그·에이블리) 개별 출고 수량, 반품 = 물류센터 반품·교환 입고 처리 수량.
//     1~10월 = 2025·2026 두 번 평균(obs 2), 11·12월 = 2025 한 번(obs 1). 두 해 패턴 상관 r = 0.93. 오차 범위 ±0.15 로 표시.
//     물량 자체가 2025 대비 2026 이 약 0.54배로 줄었다 → 물량이 아니라 지수만 쓰고, '지수 × 최근 3개월 기준선' 으로 어림한다.
//   직진(플랫폼 출고)은 반복성이 약해(r 0.73) 3월만, 입고는 반복이 없어(r 0.27) 2월 춘절만 '가정' 틀로 둔다.
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-season.test.js

import { TASK } from './task-ids.js?v=202611121547';

/** 업무 묶음(업무 id) — 설계 v2 '업종 맞춤'. 나머지 업무는 '지원' */
export const SEASON_BUNDLES = Object.freeze([
    { key: 'inbound', label: '입고·제작', tasks: [TASK.china, TASK.localprod, TASK.chinaOwner, TASK.sample, TASK.full, TASK.loadunload] },
    { key: 'outbound', label: '출고(국내·에이블리)', tasks: [TASK.domestic, TASK.ably] },
    { key: 'direct', label: '직진(플랫폼)', tasks: [TASK.direct, TASK.directPrep] },
    { key: 'reverse', label: '역물류', tasks: [TASK.return] },
    { key: 'stock', label: '재고·로케이션', tasks: [TASK.fill, TASK.locroute, TASK.angle] },
    { key: 'support', label: '지원', tasks: [] }
]);

export const GIP_SOURCE = 'GIP(사내 데이터 창고) 2025-01~2026-10 월별 — 2026-11-05 조회';
export const GIP_BAND = 0.15;
/** 월 지수(1~12) · obs = 관측 횟수 */
export const GIP_INDEX = Object.freeze({
    order: Object.freeze({ 1: 1.02, 2: 0.97, 3: 1.31, 4: 1.19, 5: 1.33, 6: 1.22, 7: 0.75, 8: 0.57, 9: 0.71, 10: 0.97, 11: 1.23, 12: 0.84 }),
    return: Object.freeze({ 1: 1.06, 2: 0.88, 3: 1.33, 4: 1.26, 5: 1.43, 6: 1.23, 7: 0.71, 8: 0.50, 9: 0.57, 10: 1.08, 11: 1.07, 12: 1.17 })
});
export const GIP_OBS = Object.freeze({ 1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2, 8: 2, 9: 2, 10: 2, 11: 1, 12: 1 });
/** '가정' 틀(반복성 약함) — 적힌 달만, 나머지 1 */
export const ASSUMED_INDEX = Object.freeze({
    direct: Object.freeze({ 3: 1.35 }),          // 직진 3월(두 해 1.29·1.41)
    inbound: Object.freeze({ 2: 0.1 })            // 입고 2월 춘절(거의 0)
});
/** 묶음 → 기본 지수 출처 */
export const BUNDLE_SOURCE = Object.freeze({ outbound: 'order', direct: 'assumed:direct', reverse: 'return', inbound: 'assumed:inbound', stock: 'none', support: 'none' });

/** 시즌 기본 틀(관리자가 OpsPlan/settings.season 으로 바꿀 수 있게 — D2 는 기본만) */
export const SEASON_FRAME = Object.freeze([
    { months: [1, 2], label: 'FW 시즌오프·명절', note: '반품 피크·재고 정리', peak: ['reverse'] },
    { months: [2, 3, 4], label: 'SS 신상 입고', note: '중국제작·샘플검수·전량검수·상.하차 피크', peak: ['inbound'] },
    { months: [5], label: '간절기', note: '교환·반품', peak: ['reverse'] },
    { months: [6, 7], label: '여름 세일·시즌오프', note: '출고·반품', peak: ['outbound'] },
    { months: [8, 9, 10], label: 'FW 입고', note: '중국제작·검수, 추석', peak: ['inbound'] },
    { months: [11], label: '블랙프라이데이', note: '국내·직진·에이블리 배송 피크', peak: ['outbound'] },
    { months: [12], label: '연말', note: '반품 피크, 비수기 정리(앵글정리·로케이션 동선관리·교육·청소)', peak: ['reverse', 'stock'] }
]);
