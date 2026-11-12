// === js/lib/csv-safe.js ===
// CSV 로 내보낼 때 수식 주입 막기. 엑셀은 = + - @ (와 탭·CR)로 시작하는 칸을 수식으로 읽는다
//   → 직원이 적은 메모·상품명 등이 '=HYPERLINK(...)' 같은 수식으로 열리지 않게 앞에 ' 를 붙인다.
// 숫자 칸(t:'n')과 숫자 모양 글자('-3', '+1.5', '1,200', '-10%')는 그대로 둔다 — 음수가 글자로 바뀌지 않게.
// xlsx 로 낼 때는 쓰지 않는다(글자 칸은 수식으로 읽히지 않는다).

const DANGER = /^[=+\-@\t\r]/;
const NUMERIC = /^[+-]?\d[\d,]*(\.\d+)?%?$/;
const DASH_ONLY = /^-+$/;   // 빈 값 자리표시 '-' 는 수식이 아니다

/** 값 하나 — 글자이고 위험한 첫 글자면 ' 를 붙인다. 글자가 아니면 그대로 */
export function csvSafeText(v) {
    if (typeof v !== 'string') return v;
    if (!DANGER.test(v) || NUMERIC.test(v) || DASH_ONLY.test(v)) return v;
    return "'" + v;
}

/** SheetJS 시트(json_to_sheet 결과)의 글자 칸을 그 자리에서 고친다. 같은 시트를 돌려준다 */
export function csvSafeSheet(ws) {
    for (const key of Object.keys(ws || {})) {
        if (key[0] === '!') continue;            // !ref·!cols 등 시트 정보
        const cell = ws[key];
        if (!cell || cell.t !== 's') continue;   // 글자 칸만
        const v = csvSafeText(cell.v);
        if (v !== cell.v) {
            cell.v = v;
            if (typeof cell.w === 'string') cell.w = csvSafeText(cell.w);
        }
    }
    return ws;
}

/** 통합문서의 모든 시트에 csvSafeSheet. format 이 'csv' 가 아니면 아무것도 안 한다(xlsx 는 해당 없음) */
export function csvSafeBook(wb, format = 'csv') {
    if (format !== 'csv' || !wb || !wb.Sheets) return wb;
    Object.values(wb.Sheets).forEach(csvSafeSheet);
    return wb;
}
