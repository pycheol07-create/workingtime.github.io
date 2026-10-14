// === js/lib/dash-layout.js ===
// 설명: 로케이션관리 '대시보드' 탭의 패널 배치(순서·폭·높이) 규칙만 떼어낸 순수 모듈.
//
//  배치는 그 PC·브라우저 localStorage 에만 둔다(사람마다 따로). Firestore 에 쓰지 않는다.
//  저장값은 사람이 손댈 수도, 옛 버전일 수도, 깨졌을 수도 있다 — normalizeLayout 이
//  무엇이 오든 '쓸 수 있는 배치' 로 정리한다(모르는 패널 버림, 빠진 패널은 기본값으로 끝에).
//
//  import 0개 — DOM 을 쓰지 않는다. localStorage 는 밖에서 주입받는다(가짜로 시험 가능).

export const STORAGE_KEY = 'locdash.layout';
export const LAYOUT_VERSION = 1;
export const GRID_COLS = 12;
export const MIN_W = 3;            // 최소 칸 수 (12칸 중)
export const MIN_H = 120;          // 고정 높이 최소(px)
export const MAX_H = 2000;         // 고정 높이 최대(px)
export const ROW_UNIT = 8;         // grid-auto-rows 한 줄 높이(px) — 높이는 이 단위로 맞춘다
export const GAP = 24;             // 칸 사이 간격(px) = --sp-5
export const NARROW_W = 960;       // 대시보드 상자 폭이 이보다 좁으면 모든 패널을 한 줄(12칸)로

/** 패널 목록. minPx = 이보다 좁아지면 내용이 깨지는 폭 → 보이는 칸 수를 늘려 막는다 */
export const PANELS = {
    kpi:       { label: 'KPI 띠',               minW: MIN_W, minPx: 480 },
    zone:      { label: '구역별 사용률',         minW: MIN_W, minPx: 420 },
    actions:   { label: '처리할 일',             minW: MIN_W, minPx: 280 },
    delivery:  { label: '마지막 출고 후 지난 기간', minW: MIN_W, minPx: 300 },
    insights:  { label: '인사이트',              minW: MIN_W, minPx: 520 },
    deadstock: { label: '구역·동별 데드스톡 분석', minW: MIN_W, minPx: 520 },
};

/** 기본 배치 = 지금(배치 편집 전) 화면 모양. h 0 = 내용 높이 그대로 */
export const DEFAULT_LAYOUT = Object.freeze({
    v: LAYOUT_VERSION,
    items: Object.freeze([
        Object.freeze({ id: 'kpi', w: 12, h: 0 }),
        Object.freeze({ id: 'zone', w: 8, h: 0 }),
        Object.freeze({ id: 'actions', w: 4, h: 0 }),
        Object.freeze({ id: 'delivery', w: 4, h: 0 }),
        Object.freeze({ id: 'insights', w: 12, h: 0 }),
        Object.freeze({ id: 'deadstock', w: 12, h: 0 }),
    ]),
});

/** 바꿔도 되는 기본 배치 사본 */
export const defaultLayout = () => ({ v: LAYOUT_VERSION, items: DEFAULT_LAYOUT.items.map(it => ({ ...it })) });

const defaultItem = (id) => ({ ...DEFAULT_LAYOUT.items.find(it => it.id === id) });
const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** 높이(px)를 8px 단위로 맞추고 [MIN_H, MAX_H] 안으로. 0 이하·숫자 아님 → 0(자동) */
export const snapH = (px) => {
    if (!isNum(px) || px <= 0) return 0;
    const snapped = Math.round(px / ROW_UNIT) * ROW_UNIT;
    return Math.min(MAX_H, Math.max(MIN_H, snapped));
};

const normW = (w, fallback) => {
    if (!isNum(w)) return fallback;
    return Math.min(GRID_COLS, Math.max(MIN_W, Math.round(w)));
};
const normH = (h, fallback) => {
    if (!isNum(h)) return fallback;
    return snapH(h);
};

/** 저장값(문자열 또는 객체) → 항상 쓸 수 있는 배치. 못 읽으면 기본 배치 */
export const normalizeLayout = (raw) => {
    let obj = raw;
    if (typeof raw === 'string') {
        try { obj = JSON.parse(raw); } catch (e) { return defaultLayout(); }
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return defaultLayout();
    if (obj.v !== LAYOUT_VERSION || !Array.isArray(obj.items)) return defaultLayout();

    const seen = new Set();
    const items = [];
    for (const it of obj.items) {
        if (!it || typeof it !== 'object') continue;
        const id = it.id;
        if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(PANELS, id)) continue; // 모르는 패널
        if (seen.has(id)) continue;                                                              // 중복은 첫 번째만
        seen.add(id);
        const def = defaultItem(id);
        items.push({ id, w: normW(it.w, def.w), h: normH(it.h, def.h) });
    }
    // 저장값에 없는 패널(새로 생긴 패널 포함)은 기본 설정으로 끝에
    for (const def of DEFAULT_LAYOUT.items) {
        if (!seen.has(def.id)) items.push({ ...def });
    }
    return { v: LAYOUT_VERSION, items };
};

/** 두 배치가 같은가(순서·폭·높이) */
export const sameLayout = (a, b) => {
    if (!a || !b || !Array.isArray(a.items) || !Array.isArray(b.items)) return false;
    if (a.items.length !== b.items.length) return false;
    return a.items.every((it, i) => {
        const o = b.items[i];
        return o && it.id === o.id && it.w === o.w && it.h === o.h;
    });
};

export const isDefault = (layout) => sameLayout(normalizeLayout(layout), DEFAULT_LAYOUT);

/**
 * 실제로 보일 칸 수. 저장값(w)은 바꾸지 않고, 상자가 좁으면 최소 폭(minPx)이 들어가게 늘린다.
 * containerW < NARROW_W 이면 모두 12칸(한 줄). containerW 가 0·숫자 아님(탭 숨김) → w 그대로.
 */
export const effectiveSpan = (w, containerW, minPx, gap = GAP) => {
    const base = normW(w, GRID_COLS);
    if (!isNum(containerW) || containerW <= 0) return base;
    if (containerW < NARROW_W) return GRID_COLS;
    const colUnit = (containerW - (GRID_COLS - 1) * gap) / GRID_COLS;
    if (colUnit <= 0) return GRID_COLS;
    const need = Math.ceil(((isNum(minPx) ? minPx : 0) + gap) / (colUnit + gap));
    return Math.min(GRID_COLS, Math.max(base, need));
};

/** 내용 높이(px) → grid-row-end span 수. 아래 간격(gap)까지 포함해 8px 줄 단위로 올림 */
export const rowSpan = (heightPx, unit = ROW_UNIT, gap = GAP) => {
    const h = isNum(heightPx) && heightPx > 0 ? heightPx : 0;
    return Math.max(1, Math.ceil((h + gap) / unit));
};

/**
 * 칸 위치 계산(0부터 센 열·줄). items = [{ span, rows, h?, stretch? }] (배치 순서)
 *   h = 내용 높이(px, 늘린 높이를 계산할 때만 씀) · stretch = 옆 칸에 맞춰 늘려도 되는 칸인가(높이 고정 칸은 false)
 * 결과 = [{ row, col, span, rows, stretchPx }] — 늘린 칸은 rows 가 커지고 stretchPx(늘린 높이 px)가 붙는다.
 *
 *  왜 CSS 자동 배치(grid-auto-flow)만으로 안 되나
 *    sparse 자동 배치는 '위에서부터 처음 들어갈 자리' 를 찾는다. 기본 배치에서 구역 사용률(8칸)이
 *    처리할 일(4칸)보다 짧으면 출고 경과(4칸)가 오른쪽 처리할 일 아래가 아니라 왼쪽 구역 사용률 아래로
 *    가 버린다(예전 화면 모양이 깨짐). 그래서 '사이드 열' 규칙을 둔다.
 *  규칙
 *    1) 바로 앞 칸과 같은 줄 오른쪽에 들어가면 거기. 이때 앞 칸이 이 칸보다 넓으면 앞 칸이 '기둥',
 *       이 칸은 그 기둥 오른쪽 사이드 열의 첫 칸이 된다(예: 구역 8칸 | 처리할 일 4칸).
 *    2) 앞 칸이 사이드 열 칸이고 이 칸이 앞 칸보다 좁거나 같으면 앞 칸 바로 아래에 쌓는다.
 *       단 사이드 열 두 번째 칸까지는 늘 쌓고, 그 뒤로는 기둥이 아직 아래로 이어질 때만 쌓는다.
 *       (4칸×6 · 6칸×4 처럼 폭이 같은 칸이 나란히 있으면 기둥이 없으므로 쌓지 않고 왼쪽부터 찬다)
 *    3) 그 밖에는 sparse 자동 배치와 같다(앞 칸 뒤에서부터 위→아래·왼→오른쪽으로 처음 들어가는 자리).
 *    + 사이드 열이 기둥보다 길어지면 기둥(stretch 칸)을 사이드 열 끝까지 늘린다(예전 화면처럼 바닥선을 맞춤).
 */
export const placeItems = (items, cols = GRID_COLS, unit = ROW_UNIT) => {
    const occupied = new Set();                 // 'row,col'
    const free = (row, col, span, rows) => {
        if (col < 0 || col + span > cols) return false;
        for (let r = row; r < row + rows; r++) {
            for (let c = col; c < col + span; c++) if (occupied.has(`${r},${c}`)) return false;
        }
        return true;
    };
    const mark = (row, col, span, rows) => {
        for (let r = row; r < row + rows; r++) for (let c = col; c < col + span; c++) occupied.add(`${r},${c}`);
    };
    const placed = [];   // { row, col, span, rows, h, stretch, anchor, depth, stretchPx }
    for (const it of items) {
        const span = Math.min(cols, Math.max(1, Math.round(isNum(it.span) ? it.span : cols)));
        const rows = Math.max(1, Math.round(isNum(it.rows) ? it.rows : 1));
        const prevIdx = placed.length - 1;
        const prev = prevIdx >= 0 ? placed[prevIdx] : null;
        let pos = null, anchor = null, depth = 0;
        if (prev) {
            // 1) 앞 칸 오른쪽(같은 줄)
            for (let c = prev.col + prev.span; c + span <= cols; c++) {
                if (free(prev.row, c, span, rows)) {
                    pos = { row: prev.row, col: c };
                    if (c === prev.col + prev.span && prev.span > span) { anchor = prevIdx; depth = 1; }
                    break;
                }
            }
            // 2) 사이드 열: 앞 칸 바로 아래에 쌓기
            if (!pos && prev.anchor != null && span <= prev.span) {
                const A = placed[prev.anchor];
                let r = prev.row + prev.rows;
                while (!free(r, prev.col, span, rows)) r++;
                if (prev.depth === 1 || r < A.row + A.rows) {
                    pos = { row: r, col: prev.col }; anchor = prev.anchor; depth = prev.depth + 1;
                }
            }
        }
        // 3) sparse 자동 배치
        if (!pos) {
            const startRow = prev ? prev.row : 0;
            for (let r = startRow; !pos; r++) {
                const startCol = (prev && r === prev.row) ? prev.col + prev.span : 0;
                for (let c = startCol; c + span <= cols; c++) {
                    if (free(r, c, span, rows)) { pos = { row: r, col: c }; break; }
                }
            }
        }
        mark(pos.row, pos.col, span, rows);
        const cur = { row: pos.row, col: pos.col, span, rows, h: isNum(it.h) ? it.h : null, stretch: !!it.stretch, anchor, depth, stretchPx: null };
        placed.push(cur);
        // 기둥 늘리기: 사이드 열 칸 바닥이 기둥보다 아래면 기둥을 그 줄까지
        if (anchor != null) {
            const A = placed[anchor];
            const bottom = cur.row + cur.rows;
            if (A.stretch && bottom > A.row + A.rows && free(A.row + A.rows, A.col, A.span, bottom - A.row - A.rows)) {
                mark(A.row + A.rows, A.col, A.span, bottom - A.row - A.rows);
                A.rows = bottom - A.row;
                if (cur.h != null) A.stretchPx = (cur.row - A.row) * unit + cur.h;
            }
        }
    }
    return placed.map(p => ({ row: p.row, col: p.col, span: p.span, rows: p.rows, stretchPx: p.stretchPx }));
};

/** id 패널을 targetId 앞(after=false) 또는 뒤(after=true)로 옮긴 새 배치. 못 옮기면 같은 내용의 사본 */
export const moveItem = (layout, id, targetId, after) => {
    const items = layout.items.map(it => ({ ...it }));
    const from = items.findIndex(it => it.id === id);
    if (from < 0 || id === targetId || !items.some(it => it.id === targetId)) {
        return { v: LAYOUT_VERSION, items };
    }
    const [moved] = items.splice(from, 1);
    let to = items.findIndex(it => it.id === targetId);
    if (after) to += 1;
    items.splice(to, 0, moved);
    return { v: LAYOUT_VERSION, items };
};

/** 저장소에서 읽기. 저장소 접근이 막혀 있거나 값이 깨져도 기본 배치로 (예외를 밖으로 내지 않음) */
export const loadLayout = (storage) => {
    try {
        if (!storage) return { ok: false, layout: defaultLayout() };
        const raw = storage.getItem(STORAGE_KEY);
        if (raw == null) return { ok: true, layout: defaultLayout() };
        return { ok: true, layout: normalizeLayout(raw) };
    } catch (e) {
        return { ok: false, layout: defaultLayout() };
    }
};

/** 저장. 기본 배치와 같으면 키를 지운다. 실패하면 { ok:false } (예외를 밖으로 내지 않음) */
export const saveLayout = (storage, layout) => {
    try {
        if (!storage) return { ok: false };
        const norm = normalizeLayout(layout);
        if (sameLayout(norm, DEFAULT_LAYOUT)) storage.removeItem(STORAGE_KEY);
        else storage.setItem(STORAGE_KEY, JSON.stringify(norm));
        return { ok: true };
    } catch (e) {
        return { ok: false };
    }
};
