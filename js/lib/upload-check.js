// === js/lib/upload-check.js ===
// 로케이션관리 엑셀 업로드 — 덮어쓰기 전에 파일이 쓸 만한지 검사한다. 2026-10-20
//   ZG&AB 출고(ZikjinData)·주차별(WeeklyData)은 업로드하면 기존 데이터를 통째로 지우고 새로 쓴다.
//   로케이션 열만 있는 파일(=상품코드가 없음)을 올리면 전부 지워지고 0건이 남던 문제를 막는다.
//   열 규칙은 location.js 와 같다 — 코드: updateDatabaseB·setupRealtimeListenerB, 수량: _ablyQtyFromItem(옛 수동 변경 계산의 _getDemandForCode 는 2026-10-27 없앰).
//   행(row)은 smartParseToJSON 결과 — 머리글은 공백이 빠져 있고, 빈 칸은 키가 없다.
// 순수 모듈(DOM/Firebase 의존 없음).

const CODE_KEYS = ['상품코드', '어드민상품코드', '대표상품코드', '품목코드', '바코드', '상품번호'];
const DATE_COL = /^20\d{6}$/;

/** 행의 상품코드(location.js updateDatabaseB 와 같은 키 순서). 없으면 '' */
export function codeOfRowB(row) {
    if (!row) return '';
    let v;
    for (const k of CODE_KEYS) { if (row[k]) { v = row[k]; break; } }
    return v == null ? '' : v.toString().trim();
}

/** kind 별 수량 열인가 — zikjin: 수량|기간배송수량|기간발주수량|YYYYMMDD, weekly: 기간배송수량|기간발주수량 */
function isQtyKey(k, kind) {
    if (k === '기간배송수량' || k === '기간발주수량') return true;
    if (kind === 'zikjin') return k === '수량' || DATE_COL.test(k);
    return false;
}

/**
 * ZG&AB 출고·주차별 업로드 검사.
 * @param {object[]} rows
 * @param {'zikjin'|'weekly'} kind
 * @returns {{ valid: number, total: number, ok: boolean, reason: string }}
 *   valid = 상품코드가 있는 줄 수(실제로 저장되는 줄), reason = '' | 'no-code' | 'no-qty-col'
 */
export function checkUploadB(rows, kind) {
    const list = Array.isArray(rows) ? rows : [];
    const total = list.length;
    let valid = 0, hasQty = false;
    for (const row of list) {
        if (!codeOfRowB(row)) continue;
        valid++;
        if (!hasQty) hasQty = Object.keys(row).some(k => isQtyKey(k, kind));
    }
    let reason = '';
    if (valid === 0) reason = 'no-code';
    else if (!hasQty) reason = 'no-qty-col';
    return { valid, total, ok: !reason, reason };
}

// '옵션추가항목1' 만 있어도 된다 — 이 열로 새 비축 자리를 '기타'로 등록한다(location.js updateDatabaseA 옵션추가항목1 처리)
const PERM_KEYS = ['동', '위치', '칸수', '대분류', 'dong', 'pos', 'angleSize', '옵션추가항목1'];

/** '로케이션' 값(앞뒤 공백 제거). 없으면 '' */
const locOf = (row) => (row && row['로케이션'] != null ? row['로케이션'].toString().trim() : '');
/** 2층 줄('2F-…') — updateDatabaseA 는 이 줄을 저장하지 않고 옵션추가항목1 도 건너뛴다(continue) */
const is2F = (raw) => raw.toUpperCase().startsWith('2F-');

/**
 * 영구 데이터(동/위치/칸수) 업로드 검사 — 로케이션 값이 있는 줄(2F- 제외)이 있고,
 * 동·위치·칸수·대분류(또는 dong/pos/angleSize)·옵션추가항목1 가운데 하나 이상의 열이 있어야 한다.
 * @returns {{ valid: number, total: number, ok: boolean, reason: string }}
 *   valid = 실제로 반영되는 줄 수(로케이션 값이 있고 2F- 가 아닌 줄), reason = '' | 'no-location' | 'no-perm-col'
 */
export function checkPermanent(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const total = list.length;
    let valid = 0, hasCol = false;
    for (const row of list) {
        const raw = locOf(row);
        if (!raw || is2F(raw)) continue;
        valid++;
        if (!hasCol) hasCol = PERM_KEYS.some(k => k in row);
    }
    let reason = '';
    if (valid === 0) reason = 'no-location';
    else if (!hasCol) reason = 'no-perm-col';
    return { valid, total, ok: !reason, reason };
}

/**
 * 영구 데이터 업로드로 새로 생길 로케이션 id(중복 없음) — updateDatabaseA('permanent') 와 같은 규칙:
 *   '로케이션' 값은 '(' 앞까지, '2F-' 로 시작하는 줄은 통째로 건너뜀(옵션추가항목1 포함) · '옵션추가항목1' 은 쉼표로 나눈 각 위치.
 * @param {object[]} rows
 * @param {Iterable<string>} existingIds  지금 있는 로케이션 id(originalData 의 id)
 * @returns {string[]}
 */
export function newLocIds(rows, existingIds) {
    const have = new Set(existingIds || []);
    const out = new Set();
    for (const row of (Array.isArray(rows) ? rows : [])) {
        if (!row) continue;
        const raw = locOf(row);
        if (raw && is2F(raw)) continue;
        if (raw) {
            const id = raw.includes('(') ? raw.split('(')[0].trim() : raw;
            if (id && !have.has(id)) out.add(id);
        }
        const opt1 = row['옵션추가항목1'] != null ? row['옵션추가항목1'].toString().trim() : '';
        if (opt1) opt1.split(',').map(s => s.trim()).filter(Boolean).forEach(id => { if (!have.has(id)) out.add(id); });
    }
    return [...out];
}
