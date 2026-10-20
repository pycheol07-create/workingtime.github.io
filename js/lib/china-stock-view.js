// === js/lib/china-stock-view.js ===
// 미발계산기(기존 js/china-stock-goods.js · 신규 js/china-mibal2.js) 화면 보조 — 순수 함수(DOM/Firebase 없음).
// tests/china-stock-view.test.js 가 본다.

/** 출고일 목록 하나의 비교용 키 */
export function dateListKey(list) {
    return JSON.stringify(Array.isArray(list) ? list : []);
}

/**
 * 출고일 저장(saveDatesQuiet)에서 CONFIG 에 merge 로 쓸 내용 — 마지막으로 쓴(또는 읽은) 값과 다른 목록만 넣는다.
 * 입고 스캔마다 applyDates 가 불려도 같은 값을 다시 쓰지 않고, 오래 열린 탭이 한쪽(미발/위치)만 바꿔도
 * 다른 쪽을 옛 값으로 되돌리지 않게 한다.
 * last = { mibalKey, locKey } → { patch: { savedDatesMibal?, savedDatesLoc? } | null, mibalKey, locKey }
 */
export function datesPatch(savedDatesMibal, savedDatesLoc, last = {}) {
    const mibalKey = dateListKey(savedDatesMibal), locKey = dateListKey(savedDatesLoc);
    const patch = {};
    if (mibalKey !== last.mibalKey) patch.savedDatesMibal = JSON.parse(mibalKey);
    if (locKey !== last.locKey) patch.savedDatesLoc = JSON.parse(locKey);
    return { patch: Object.keys(patch).length ? patch : null, mibalKey, locKey };
}

/**
 * 표가 비었을 때 문구 — 출고일 미선택 / 선택했지만 도착 상품 없음 / 검색·필터로 다 걸러짐.
 * locToday(위치지정모드 '당일입고지정')에서 검색·열 필터가 없는데 비면 = 비축창고 입고분 0건.
 */
export function emptyTableText({ savedCount = 0, tableCount = 0, filtersOn = false, locToday = false } = {}) {
    if (!savedCount) return '출고일을 선택하세요.';
    if (!tableCount) return '선택한 출고일에 도착한 상품이 없습니다.';
    if (locToday && !filtersOn) return '비축창고로 들어갈 상품이 없습니다.';
    return '검색·필터에 맞는 상품이 없습니다.';
}

/**
 * 정렬 표시. sortKey 가 지금 정렬 key 이면 { mark: '▲'|'▼', aria: 'ascending'|'descending' },
 * 아니면 { mark: '', aria: 'none' }. dir 은 'asc' | 'desc'.
 */
export function sortMark(sortKey, current = {}) {
    const key = current.key, dir = current.direction || current.dir;
    if (!sortKey || sortKey !== key) return { mark: '', aria: 'none' };
    return dir === 'desc' ? { mark: '▼', aria: 'descending' } : { mark: '▲', aria: 'ascending' };
}
