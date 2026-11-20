// === js/locdash-layout.js ===
// 설명: 로케이션관리 '대시보드' 탭 패널 자리 잡기(기본 배치 고정). location.js 와 독립.
//
//  - 2026-11-20 배치 편집 기능을 없앴다(사용자 요청) — 늘 기본 배치(js/lib/dash-layout.js defaultLayout)로 그린다.
//    예전에 이 브라우저에 저장해 둔 배치(localStorage 'locdash.layout')는 읽지 않고 지운다.
//  - 패널 안쪽(id 칸)은 location.js 가 innerHTML 로 다시 그린다 — 여기서는 바깥 칸(.dash-cell)의 순서·위치만 만진다.
//  - #view-locdash 의 display·class 는 건드리지 않는다(location.js 가 탭 표시 판정에 쓴다).
//  - 규칙(정리·칸 수·높이 단위)은 js/lib/dash-layout.js.
import {
    PANELS, GRID_COLS, GAP, ROW_UNIT,
    defaultLayout, effectiveSpan, rowSpan, placeItems, STORAGE_KEY,
} from './lib/dash-layout.js?v=202611201655';

const grid = document.getElementById('dash-grid');
const layout = defaultLayout();
let rafId = 0;

const cellOf = (id) => grid.querySelector(`.dash-cell[data-panel="${id}"]`);

/** 옆 칸에 맞춰 늘려도 되는 칸: 높이 고정이 아니고 안쪽이 .dash-panel 상자(늘린 높이를 min-height:100% 로 채움).
 *  위쪽 띠(.topcard — 채우기 지시서·변경 추천)는 빼다: 접힌 한 줄 띠가 옆 칸 높이만큼 늘어나면 안 된다 */
const isStretchable = (cell, it) => !it.h && !!cell.firstElementChild && cell.firstElementChild.classList.contains('dash-panel')
    && !cell.firstElementChild.classList.contains('topcard');

/**
 * 칸의 '내용 높이'. 늘린 칸은 칸 높이가 늘어난 값이라, 안쪽 패널의 자식들 바닥으로 잰다
 * (늘린 높이를 다시 재서 계속 커지는 ResizeObserver 반복을 막는다).
 */
const contentHeight = (cell, stretchable) => {
    const rect = cell.getBoundingClientRect();
    if (!stretchable) return rect.height;
    const panel = cell.firstElementChild;
    const pr = panel.getBoundingClientRect();
    let bottom = pr.top;
    for (const ch of panel.children) {
        const r = ch.getBoundingClientRect();
        if (!r.width && !r.height) continue;            // 숨긴 요소
        bottom = Math.max(bottom, r.bottom + (parseFloat(getComputedStyle(ch).marginBottom) || 0));
    }
    const cs = getComputedStyle(panel);
    return bottom - pr.top + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
};

/** 칸 높이 → 줄 수, 상자 폭 → 보이는 칸 수 → 위치(placeItems). 탭이 숨겨져 폭 0 이면 건드리지 않는다 */
const measure = () => {
    rafId = 0;
    if (!grid) return;
    const W = grid.clientWidth;
    if (!W) return;
    const rows = [];
    for (const it of layout.items) {
        const cell = cellOf(it.id);
        // 권한이 없어 숨긴 칸(js/feature-gate.js — 채우기·변경 추천)은 자리 계산에서 뺀다(빈 칸이 남지 않게)
        if (!cell || cell.dataset.permHidden === '1') continue;
        const stretch = isStretchable(cell, it);
        const h = contentHeight(cell, stretch);
        rows.push({
            cell, stretch, h,
            span: effectiveSpan(it.w, W, PANELS[it.id].minPx, GAP),
            rows: rowSpan(h, ROW_UNIT, GAP),
        });
    }
    const pos = placeItems(rows, GRID_COLS, ROW_UNIT);
    rows.forEach((r, i) => {
        const col = `${pos[i].col + 1} / span ${pos[i].span}`;
        const row = `${pos[i].row + 1} / span ${pos[i].rows}`;
        if (r.cell.dataset.col !== col) { r.cell.style.gridColumn = col; r.cell.dataset.col = col; }
        if (r.cell.dataset.row !== row) { r.cell.style.gridRow = row; r.cell.dataset.row = row; }
        // 옆 사이드 열이 더 길면 그 바닥까지 늘린다(예전 화면처럼 구역 사용률 상자가 오른쪽 두 패널 높이만큼)
        if (r.stretch && pos[i].stretchPx != null) {
            const hp = `${Math.ceil(pos[i].stretchPx)}px`;
            if (r.cell.style.height !== hp) r.cell.style.height = hp;
            r.cell.classList.add('is-stretched');
        } else if (r.cell.classList.contains('is-stretched')) {
            r.cell.classList.remove('is-stretched');
            if (!r.cell.classList.contains('has-h')) r.cell.style.height = '';
        }
    });
};
const scheduleMeasure = () => {
    if (!rafId) rafId = requestAnimationFrame(measure);
};

/** 기본 배치 순서·폭·고정 높이를 칸에 넣는다(한 번) */
const applyLayout = () => {
    const domOrder = [...grid.querySelectorAll(':scope > .dash-cell')].map(c => c.dataset.panel).join(',');
    const needMove = domOrder !== layout.items.map(it => it.id).join(',');
    layout.items.forEach((it) => {
        const cell = cellOf(it.id);
        if (!cell) return;
        if (needMove) grid.appendChild(cell);
        cell.dataset.w = String(it.w);
        if (it.h) {
            cell.style.height = `${it.h}px`;
            cell.classList.add('has-h');
        } else {
            cell.style.height = '';
            cell.classList.remove('has-h');
        }
    });
    measure();             // 바로 한 번(깜빡임 방지) + 다음 프레임에 높이 다시
    scheduleMeasure();
};

const init = () => {
    if (!grid) return;
    // 예전 배치 편집으로 저장해 둔 값은 더 쓰지 않는다
    try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* 저장소를 못 쓰는 브라우저 */ }
    applyLayout();

    // 내용이 다시 그려져 높이가 바뀌거나 상자 폭이 바뀌면(입고대기 사이드바 등) 다시 맞춤 — 콜백은 rAF 로 묶는다
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(scheduleMeasure);
        ro.observe(grid);
        // 늘린 칸은 칸 높이가 고정이라 내용이 커져도 칸 크기가 안 바뀐다 → 안쪽 패널도 본다
        grid.querySelectorAll('.dash-cell').forEach(c => {
            ro.observe(c);
            if (c.firstElementChild) ro.observe(c.firstElementChild);
        });
    } else {
        window.addEventListener('resize', scheduleMeasure);
    }

    // 권한 판정(js/page-gate.js)이 나오면 숨긴 칸이 생길 수 있다 — 다시 맞춘다
    window.addEventListener('perm:ready', () => requestAnimationFrame(scheduleMeasure));
};

init();
