// === js/lib/mibal-send.js ===
// 미발계산기(기존, js/china-stock-goods.js sendMibal) 미발전송 — 보낼 합계와 확인창 문구. 순수 함수(DOM/Firebase 없음).
// tests/mibal-send.test.js 가 본다.
//
// 예전엔 표에 보이는 행(검색·열 필터 뒤 filteredData)만 더해 보냈고 확인창도 없었다(같은 날 덮어쓸 때만 물음).
// 지금은 선택한 출고일의 전체 행(tableData)을 더해 보내고, 보내기 전에 늘 확인창을 띄운다.
//
// 2026-10-20: 보낼 값을 Σ부족수량 → Σmin(부족수량, 도착수량) 으로 바꿨다(기록 basis 'min').
// 입고분으로도 못 내보내는 주문(도착수량을 넘는 몫)은 그날 국내배송에 더하지 않는다 — 업무 예상(mibal-forecast.js)이 이 값을 쓴다.
// 화면의 '총 미발수량' 카드(sum-mibal)는 현장이 보는 숫자라 그대로 Σ부족수량이다.

const shortOf = (d) => parseInt(d && d.shortage) || 0;     // 행의 부족수량(미발) — 화면 합계(sum-mibal)와 같은 규칙
const sendOf = (d) => Math.min(shortOf(d), Math.max(parseInt(d && d.arrivalQty) || 0, 0));   // 보낼 값 — 도착수량을 넘는 몫은 뺌

/** MIBAL_HISTORY 기록의 basis — 'min' = Σmin(부족, 도착). 이 값이 없는 옛 기록은 Σ부족(sum). */
export const MIBAL_SEND_BASIS = 'min';

/** { total: 전체 행 Σmin(부족,도착)(보낼 값), visible: 표에 보이는 행의 같은 합, rawTotal: 전체 행 Σ부족수량 } */
export function mibalSendSummary(tableData, filteredData) {
    const sum = (rows, f) => (rows || []).reduce((s, d) => s + f(d), 0);
    return { total: sum(tableData, sendOf), visible: sum(filteredData, sendOf), rawTotal: sum(tableData, shortOf) };
}

/**
 * 미발전송 확인창 문구.
 * dates: 선택한 출고일 목록, total/visible/rawTotal: mibalSendSummary 결과(rawTotal 생략 = total), filtersOn: 검색어·열 필터가 켜졌는지,
 * dupes: 오늘 이미 보낸 기록이 있는 출고일 목록, today: 전송날짜(YYYY-MM-DD)
 */
export function mibalSendConfirmText({ dates = [], total = 0, visible = 0, rawTotal = total, filtersOn = false, dupes = [], today = '' } = {}) {
    const lines = [
        `미발전송 — 출고일 ${dates.length}건 (${dates.join(', ')})`,
        `미발수량 ${total}(으)로 출고일마다 기록합니다.`,
    ];
    if (rawTotal !== total) lines.push(`부족수량 합 ${rawTotal} 중 도착수량을 넘는 몫을 빼고 ${total} 을 보냅니다(업무 예상 국내배송 가산 기준).`);
    if (filtersOn) lines.push('', `※ 검색·필터가 켜져 있습니다. 표에 보이는 합계 ${visible}이 아니라 전체 ${total}로 보냅니다.`);
    if (dupes.length) lines.push('', `※ 오늘(${today}) 이미 보낸 출고일 ${dupes.length}건(${dupes.join(', ')})은 덮어씀.`);
    lines.push('', '보낼까요?');
    return lines.join('\n');
}
