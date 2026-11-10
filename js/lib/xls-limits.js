// === js/lib/xls-limits.js ===
// Excel 97-2003(.xls, SheetJS bookType 'biff8') 받기 — 한계 검사와 쓰기 한 벌(2026-11-10 사용자 요청: 신규 부족수량관리 받기는 전부 .xls).
// biff8 한계: 시트당 행 65,536 · 열 256 · 시트 이름 31자 · 셀 글자 32,767자. 넘으면 SheetJS 가 잘라 쓰거나 깨진 파일이 될 수 있어
// 넘을 때만 안내하고 받지 않는다. 검사(biff8Problem)는 순수 함수, 쓰기(writeXls)는 넘겨받은 XLSX 로만 한다(DOM 없음).

export const BIFF8 = Object.freeze({ rows: 65536, cols: 256, sheetName: 31, cellChars: 32767 });

/**
 * @param {Array<{name: string, aoa: any[][]}>} sheets
 * @returns {string} 넘는 것이 있으면 안내 문구, 없으면 ''
 */
export function biff8Problem(sheets) {
    for (const s of sheets || []) {
        const name = String((s && s.name) || '');
        if (name.length > BIFF8.sheetName) return `시트 이름이 ${BIFF8.sheetName}자를 넘습니다(${name.length}자)`;
        const aoa = (s && Array.isArray(s.aoa)) ? s.aoa : [];
        if (aoa.length > BIFF8.rows) return `'${name}' 시트의 줄이 ${aoa.length.toLocaleString()}개라 .xls 한도(${BIFF8.rows.toLocaleString()}줄)를 넘습니다`;
        for (let i = 0; i < aoa.length; i++) {
            const row = Array.isArray(aoa[i]) ? aoa[i] : [];
            if (row.length > BIFF8.cols) return `'${name}' 시트의 칸이 ${row.length}개라 .xls 한도(${BIFF8.cols}칸)를 넘습니다`;
            for (const v of row) {
                if (typeof v === 'string' && v.length > BIFF8.cellChars) return `'${name}' 시트 ${i + 1}번째 줄에 ${BIFF8.cellChars.toLocaleString()}자를 넘는 칸이 있습니다`;
            }
        }
    }
    return '';
}

/** 시트들 → biff8 바이트(Uint8Array/ArrayBuffer). 한계를 넘으면 { problem } */
export function xlsBytes(X, sheets) {
    const problem = biff8Problem(sheets);
    if (problem) return { problem };
    const wb = X.utils.book_new();
    sheets.forEach(s => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(s.aoa), s.name));
    return { bytes: X.write(wb, { bookType: 'biff8', type: 'array' }) };
}

/** 내려받기(writeFile) — 한계를 넘으면 쓰지 않고 안내 문구를 돌려준다(부른 쪽이 alert). 받았으면 '' */
export function writeXls(X, sheets, filename) {
    const problem = biff8Problem(sheets);
    if (problem) return `${problem} — 받지 않았습니다. 검색·거르기로 줄을 줄이거나 관리자에게 알려 주세요.`;
    const wb = X.utils.book_new();
    sheets.forEach(s => X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(s.aoa), s.name));
    X.writeFile(wb, filename, { bookType: 'biff8' });
    return '';
}
