// === js/lib/mibal-send.js ===
// 미발계산기(기존, js/china-stock-goods.js sendMibal) 미발전송 — 보낼 합계와 확인창 문구. 순수 함수(DOM/Firebase 없음).
// tests/mibal-send.test.js 가 본다.
//
// 예전엔 표에 보이는 행(검색·열 필터 뒤 filteredData)만 더해 보냈고 확인창도 없었다(같은 날 덮어쓸 때만 물음).
// 지금은 선택한 출고일의 전체 행(tableData)을 더해 보내고, 보내기 전에 늘 확인창을 띄운다.

const shortOf = (d) => parseInt(d && d.shortage) || 0;     // 행의 부족수량(미발) — 화면 합계(sum-mibal)와 같은 규칙

/** { total: 전체 행 합계(보낼 값), visible: 표에 보이는 행 합계 } */
export function mibalSendSummary(tableData, filteredData) {
    const sum = (rows) => (rows || []).reduce((s, d) => s + shortOf(d), 0);
    return { total: sum(tableData), visible: sum(filteredData) };
}

/**
 * 미발전송 확인창 문구.
 * dates: 선택한 출고일 목록, total/visible: mibalSendSummary 결과, filtersOn: 검색어·열 필터가 켜졌는지,
 * dupes: 오늘 이미 보낸 기록이 있는 출고일 목록, today: 전송날짜(YYYY-MM-DD)
 */
export function mibalSendConfirmText({ dates = [], total = 0, visible = 0, filtersOn = false, dupes = [], today = '' } = {}) {
    const lines = [
        `미발전송 — 출고일 ${dates.length}건 (${dates.join(', ')})`,
        `미발수량 ${total}(으)로 출고일마다 기록합니다.`,
    ];
    if (filtersOn) lines.push('', `※ 검색·필터가 켜져 있습니다. 표에 보이는 합계 ${visible}이 아니라 전체 ${total}로 보냅니다.`);
    if (dupes.length) lines.push('', `※ 오늘(${today}) 이미 보낸 출고일 ${dupes.length}건(${dupes.join(', ')})은 덮어씀.`);
    lines.push('', '보낼까요?');
    return lines.join('\n');
}
