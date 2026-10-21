// === js/locdash-layout.js ===
// 설명: 로케이션관리 '대시보드' 탭 패널 배치 편집(순서·폭·높이). location.js 와 독립.
//
//  - 배치는 이 PC·브라우저 localStorage('locdash.layout')에만 둔다. Firestore 에 쓰지 않는다.
//  - 패널 안쪽(id 칸)은 location.js 가 innerHTML 로 다시 그린다 — 여기서는 바깥 칸(.dash-cell)의
//    순서·style 과 칸의 마지막 자식인 덮개(.dash-edit-overlay)만 만진다.
//  - #view-locdash 의 display·class 는 건드리지 않는다(location.js 가 탭 표시 판정에 쓴다).
//  - 규칙(정리·칸 수·높이 단위)은 js/lib/dash-layout.js.
import {
    PANELS, GRID_COLS, MIN_W, GAP, ROW_UNIT,
    defaultLayout, normalizeLayout, sameLayout, effectiveSpan, rowSpan, snapH, moveItem, placeItems,
    loadLayout, saveLayout, STORAGE_KEY,
} from './lib/dash-layout.js?v=202610210917';

const DRAG_START_PX = 4;      // 이만큼 움직여야 끌기 시작(그냥 누른 것과 구분)
const AUTO_SCROLL_EDGE = 40;  // 스크롤 상자 위·아래 이 안쪽이면 자동 스크롤
const AUTO_SCROLL_STEP = 12;
const HEIGHT_LOCK_PX = 8;     // 손잡이를 세로로 이만큼 끌어야 높이 고정

const grid = document.getElementById('dash-grid');
const scroller = grid ? grid.closest('.dash-container') : null;
const btnEdit = document.getElementById('dash-layout-edit');
const editbar = document.getElementById('dash-layout-editbar');
const btnReset = document.getElementById('dash-layout-reset');
const btnCancel = document.getElementById('dash-layout-cancel');
const btnDone = document.getElementById('dash-layout-done');
const msgEl = document.getElementById('dash-layout-msg');
const mobileMq = window.matchMedia('(max-width: 768px)');

/** window.localStorage 참조 자체가 던지는 브라우저도 있다 */
const getStorage = () => {
    try { return window.localStorage; } catch (e) { return null; }
};

let layout = defaultLayout();
let editing = false;
let snapshot = null;          // 편집 시작 때 배치(취소용)
let drag = null;              // 끌기 상태
let rafId = 0;

const cellOf = (id) => grid.querySelector(`.dash-cell[data-panel="${id}"]`);
const itemOf = (id) => layout.items.find(it => it.id === id);

const showMsg = (text) => {
    if (!msgEl) return;
    msgEl.textContent = text || '';
    msgEl.hidden = !text;
};

/** 편집 중 배지: '구역별 사용률 · 8칸 · 높이 자동' */
const updateLabels = () => {
    for (const it of layout.items) {
        const cell = cellOf(it.id);
        const label = cell && cell.querySelector('.dash-edit-label');
        if (!label) continue;
        const name = PANELS[it.id] ? PANELS[it.id].label : it.id;
        label.textContent = `${name} · ${it.w}칸 · ${it.h ? `높이 ${it.h}px` : '높이 자동'}`;
    }
};

/** 칸 높이 → 줄 수, 상자 폭 → 보이는 칸 수 → 위치(placeItems). 탭이 숨겨져 폭 0 이면 건드리지 않는다(측정값 저장 안 함) */
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

/** 칸 높이 → 줄 수, 상자 폭 → 보이는 칸 수 → 위치(placeItems). 탭이 숨겨져 폭 0 이면 건드리지 않는다(측정값 저장 안 함) */
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

/** 배치를 화면에 적용. reorderDom=false 면 순서는 style.order 로만(끌기 중 — DOM 을 옮기면 포인터 캡처가 풀린다) */
const applyLayout = (reorderDom = true) => {
    if (!grid) return;
    // DOM 순서가 이미 같으면 옮기지 않는다(옮기면 그 사이 클릭·더블클릭이 끊긴다)
    const domOrder = [...grid.querySelectorAll(':scope > .dash-cell')].map(c => c.dataset.panel).join(',');
    const needMove = reorderDom && domOrder !== layout.items.map(it => it.id).join(',');
    layout.items.forEach((it, idx) => {
        const cell = cellOf(it.id);
        if (!cell) return;
        if (reorderDom) {
            if (needMove) grid.appendChild(cell);
            cell.style.order = '';
        } else {
            cell.style.order = String(idx);
        }
        cell.dataset.w = String(it.w);
        if (it.h) {
            cell.style.height = `${it.h}px`;
            cell.classList.add('has-h');
        } else {
            // 늘린 칸(is-stretched)의 높이는 measure 가 정한다 — 여기서 지우면 매번 줄었다 늘었다 한다
            if (cell.classList.contains('has-h') || !cell.classList.contains('is-stretched')) cell.style.height = '';
            cell.classList.remove('has-h');
        }
    });
    updateLabels();
    measure();             // 바로 한 번(깜빡임 방지) + 다음 프레임에 높이 다시
    scheduleMeasure();
};

const notifyChanged = () => {
    document.dispatchEvent(new CustomEvent('locdash:layout'));
};

// ── 편집 모드 ──────────────────────────────────────────────
const setEditingUi = (on) => {
    grid.classList.toggle('is-editing', on);
    grid.querySelectorAll('.dash-edit-overlay').forEach(ov => { ov.hidden = !on; });
    if (btnEdit) btnEdit.hidden = on;
    if (editbar) editbar.hidden = !on;
};

const startEdit = () => {
    if (editing || mobileMq.matches) return;
    editing = true;
    snapshot = normalizeLayout(layout);
    showMsg('');
    updateLabels();
    setEditingUi(true);
};

const endDrag = (restore) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    stopAutoScroll();
    if (d.cell) d.cell.classList.remove('dash-dragging');
    if (!d.started) return;            // 그냥 누른 것(클릭·더블클릭) — 바뀐 것 없음
    if (restore) layout = d.startLayout;
    applyLayout(true);
    if (!sameLayout(layout, d.startLayout)) notifyChanged();
};

/** 완료: 저장(기본과 같으면 키 삭제). 저장 실패해도 화면엔 적용 */
const finishEdit = () => {
    if (!editing) return;
    endDrag(false);
    editing = false;
    setEditingUi(false);
    const r = saveLayout(getStorage(), layout);
    showMsg(r.ok ? '' : '이 브라우저에 저장하지 못했습니다(이번 화면에서만 적용)');
    snapshot = null;
};

const cancelEdit = () => {
    if (!editing) return;
    endDrag(true);
    editing = false;
    setEditingUi(false);
    const changed = snapshot && !sameLayout(layout, snapshot);
    if (snapshot) layout = snapshot;
    snapshot = null;
    applyLayout(true);
    if (changed) notifyChanged();
};

const resetLayout = () => {
    if (!editing) return;
    if (!window.confirm('기본 배치로 되돌릴까요?\n(\'완료\'를 눌러야 저장됩니다)')) return;
    const changed = !sameLayout(layout, defaultLayout());
    layout = defaultLayout();
    applyLayout(true);
    if (changed) notifyChanged();
};

// ── 끌기: 덮개 = 순서, 손잡이 = 폭·높이 ──────────────────────
let scrollTimer = 0;
const stopAutoScroll = () => {
    if (scrollTimer) cancelAnimationFrame(scrollTimer);
    scrollTimer = 0;
};
const autoScrollTick = () => {
    scrollTimer = 0;
    if (!drag || drag.mode !== 'move' || !drag.started || !scroller) return;
    const r = scroller.getBoundingClientRect();
    let dy = 0;
    if (drag.lastY < r.top + AUTO_SCROLL_EDGE) dy = -AUTO_SCROLL_STEP;
    else if (drag.lastY > r.bottom - AUTO_SCROLL_EDGE) dy = AUTO_SCROLL_STEP;
    if (!dy) return;
    const before = scroller.scrollTop;
    scroller.scrollTop += dy;
    if (scroller.scrollTop !== before) {
        moveTo(drag.lastX, drag.lastY);
        scrollTimer = requestAnimationFrame(autoScrollTick);
    }
};

/** 포인터 아래 칸을 찾아 그 앞/뒤로 옮긴다(넓은 칸은 위·아래 절반, 좁은 칸은 왼·오른 절반) */
const moveTo = (x, y) => {
    const gridW = grid.clientWidth || 1;
    for (const it of layout.items) {
        if (it.id === drag.id) continue;
        const cell = cellOf(it.id);
        if (!cell) continue;
        const r = cell.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
        const wide = r.width > gridW * 0.75;
        const after = wide ? (y > r.top + r.height / 2) : (x > r.left + r.width / 2);
        const next = moveItem(layout, drag.id, it.id, after);
        if (!sameLayout(next, layout)) {
            layout = next;
            applyLayout(false);
        }
        return;
    }
};

const onOverlayDown = (e) => {
    if (!editing || drag || e.button !== 0) return;
    const ov = e.currentTarget;
    const cell = ov.closest('.dash-cell');
    if (!cell) return;
    const id = cell.dataset.panel;
    const it = itemOf(id);
    if (!it) return;
    e.preventDefault();
    const isHandle = !!(e.target && e.target.closest && e.target.closest('.dash-edit-handle'));
    const gridW = grid.clientWidth;
    drag = {
        mode: isHandle ? 'resize' : 'move',
        id, cell, ov, pointerId: e.pointerId,
        x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY,
        started: false,
        startLayout: normalizeLayout(layout),
        w0: it.w, h0: it.h, cellH0: cell.getBoundingClientRect().height,
        colStep: (gridW - (GRID_COLS - 1) * GAP) / GRID_COLS + GAP,
        heightTouched: false,
    };
    try { ov.setPointerCapture(e.pointerId); } catch (err) { /* 캡처 못 해도 끌기는 동작 */ }
};

const onOverlayMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    const dx = e.clientX - drag.x0;
    const dy = e.clientY - drag.y0;
    if (!drag.started) {
        if (Math.abs(dx) < DRAG_START_PX && Math.abs(dy) < DRAG_START_PX) return;
        drag.started = true;
        if (drag.mode === 'move') drag.cell.classList.add('dash-dragging');
    }
    if (drag.mode === 'move') {
        moveTo(e.clientX, e.clientY);
        if (!scrollTimer) scrollTimer = requestAnimationFrame(autoScrollTick);
        return;
    }
    // 크기: 폭은 칸 단위, 높이는 세로로 움직였을 때만 고정 높이로
    const it = itemOf(drag.id);
    if (!it) return;
    let w = drag.w0;
    if (drag.colStep > 0) w = Math.round(drag.w0 + dx / drag.colStep);
    w = Math.min(GRID_COLS, Math.max(MIN_W, w));
    // 높이는 '세로로 끈 것' 일 때만 고정(폭만 바꾸다 세로로 조금 흔들린 것은 무시)
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) >= HEIGHT_LOCK_PX) drag.heightTouched = true;
    const h = drag.heightTouched ? snapH(Math.max(1, drag.cellH0 + dy)) : drag.h0;
    if (w !== it.w || h !== it.h) {
        layout = { v: layout.v, items: layout.items.map(x => (x.id === drag.id ? { ...x, w, h } : x)) };
        applyLayout(false);
    }
};

const onOverlayUp = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    endDrag(false);
};

/** 손잡이 더블클릭 = 높이 자동. 포인터 캡처 때문에 dblclick 대상이 덮개가 되므로 좌표로 손잡이 위인지 본다 */
const onOverlayDblClick = (e) => {
    if (!editing) return;
    const handle = e.currentTarget.querySelector('.dash-edit-handle');
    if (!handle) return;
    const hr = handle.getBoundingClientRect();
    const pad = 4;
    if (e.clientX < hr.left - pad || e.clientX > hr.right + pad || e.clientY < hr.top - pad || e.clientY > hr.bottom + pad) return;
    const cell = e.currentTarget.closest('.dash-cell');
    const it = cell && itemOf(cell.dataset.panel);
    if (!it || !it.h) return;
    layout = { v: layout.v, items: layout.items.map(x => (x.id === it.id ? { ...x, h: 0 } : x)) };
    applyLayout(true);
    notifyChanged();
};

/** 편집 중 덮개 아래 내용(정렬·KPI 이동 등)이 눌리지 않게 — 덮개가 막지만 키보드 클릭까지 한 번 더 */
const blockClick = (e) => { e.preventDefault(); e.stopPropagation(); };

// ── 시작 ──────────────────────────────────────────────
const init = () => {
    if (!grid) return;
    const r = loadLayout(getStorage());
    layout = r.layout;
    applyLayout(true);

    grid.querySelectorAll('.dash-edit-overlay').forEach(ov => {
        ov.addEventListener('pointerdown', onOverlayDown);
        ov.addEventListener('pointermove', onOverlayMove);
        ov.addEventListener('pointerup', onOverlayUp);
        ov.addEventListener('pointercancel', onOverlayUp);
        ov.addEventListener('lostpointercapture', onOverlayUp);
        ov.addEventListener('click', blockClick);
        ov.addEventListener('dblclick', onOverlayDblClick);
    });
    grid.addEventListener('click', (e) => { if (editing) blockClick(e); }, true);

    if (btnEdit) btnEdit.addEventListener('click', startEdit);
    if (btnDone) btnDone.addEventListener('click', finishEdit);
    if (btnCancel) btnCancel.addEventListener('click', cancelEdit);
    if (btnReset) btnReset.addEventListener('click', resetLayout);

    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !drag) return;
        e.stopPropagation();
        endDrag(true);          // Esc = 끌기 시작 때 배치로
    }, true);

    // 좁아져 모바일 화면이 되면 편집 자동 완료(저장)
    const onMq = () => { if (mobileMq.matches) finishEdit(); };
    if (mobileMq.addEventListener) mobileMq.addEventListener('change', onMq);
    else if (mobileMq.addListener) mobileMq.addListener(onMq);

    // 다른 길(__dashGoToList 등)로 대시보드가 숨겨져도 편집은 끝내고 저장
    const view = document.getElementById('view-locdash');
    if (view && window.MutationObserver) {
        new MutationObserver(() => {
            if (editing && view.style.display === 'none') finishEdit();
        }).observe(view, { attributes: true, attributeFilter: ['style'] });
    }

    // 다른 탭에서 배치를 바꾸면 반영(편집 중이면 무시)
    window.addEventListener('storage', (e) => {
        if (e.key !== STORAGE_KEY && e.key !== null) return;
        if (editing) return;
        const next = loadLayout(getStorage()).layout;
        if (sameLayout(next, layout)) return;
        layout = next;
        applyLayout(true);
        notifyChanged();
    });

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

    window.__dashLayoutFinishIfEditing = finishEdit;

    // 권한 판정(js/page-gate.js)이 나오면 숨긴 칸이 생길 수 있다 — 다시 맞춘다
    window.addEventListener('perm:ready', () => requestAnimationFrame(scheduleMeasure));
};

init();
