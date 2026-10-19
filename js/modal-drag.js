// === js/modal-drag.js ===
// 가운데 뜨는 팝업 창(어두운 바탕 + 패널 하나)을 머리줄로 끌어 옮긴다. (단독 ES 모듈 — 다른 모듈을 import 하지 않는다)
// PC 마우스 + 창 폭 768px 이상에서만 켠다(터치·펜·휴대폰은 꺼짐). 위치는 기억하지 않는다 — 닫히면 가운데로 되돌린다.
//
// 판정 규칙(findDialog)
//   1) 누른 요소에서 위로 올라가며 가장 가까운 '오버레이 후보' 하나를 고른다
//      — class 에 fixed+inset-0 / modal-overlay / overlay, 또는 inline style.position = fixed
//   2) 그 후보만 계산 스타일로 확인한다: position fixed · display flex/grid · justify-content center ·
//      화면을 덮음(coversViewport) · 요소 자식이 정확히 1개(= 패널)
//   3) 패널은 계산 position 이 static/relative 이고 화면 전체 크기가 아니어야 한다(isFullPanel)
// 핸들(pickHandle): [data-drag-handle] → 패널 첫 자식(머리줄 규칙) → 위쪽 160px 안의 제목(h1~h4)
// 제외: id 가 EXCLUDED_IDS 에 있거나, 오버레이·패널에 data-drag="off" 가 있는 창.
//   #history-modal 은 index 에 자체 끌기(js/listeners-history.js)가 있고 history.html 에서는 화면 본체라 뺀다.
//
// 이동은 transform 이 아니라 position:relative + left/top 으로 한다
//   — 계산기 효율 분석 창의 slide-up 애니메이션(transform)이 inline transform 을 덮어쓰고,
//     transform 은 안쪽 fixed 팝업(milestone 창 등)의 기준 상자를 바꾸기 때문이다. transform 으로 바꾸지 말 것.
//
// ※ DOM 에 속성을 붙이지 않는다(setAttribute · dataset · classList 추가 · role 쓰기 금지 — tests/modal-drag.test.js 가 검사).
//   업무마감봇이 div[role=dialog] · [data-act] · #confirm-end-shift-btn 선택자로 화면을 읽는다.
//   이 스크립트가 바꾸는 것은 패널의 inline position/left/top 과 핸들의 inline cursor 뿐이다. 나머지 상태는 WeakMap/Map 에만 둔다.
//   (끄는 동안만 패널 inline transition 을 none 으로, html 의 user-select 를 none 으로 두고 놓으면 원래 값으로 되돌린다
//    — 검수 관리 창처럼 transition-all 이 걸린 패널이 마우스를 늦게 따라오지 않게)

const MIN_WIDTH = 768;      // 이보다 좁으면 끄기
const DRAG_START_PX = 4;    // 이만큼 움직여야 끌기 시작(그 전에는 보통 클릭)
const KEEP_PX = 120;        // 좌우로 핸들이 최소 이만큼은 보이게
const HEADING_TOP_PX = 160; // 제목 핸들은 패널 위쪽 이 범위 안에 있을 때만

const EXCLUDED_IDS = new Set(['login-modal', 'history-modal', 'scan-lock-overlay', 'mobile-gate', 'loading-overlay']);
const HEADER_SEL = 'header, h1, h2, h3, h4, [role=heading], .modal-header, .pd-modal-head';
const NO_DRAG_SEL = 'button, a[href], input, select, textarea, label, summary, option, canvas, video, iframe, '
    + '[contenteditable]:not([contenteditable=false]), [role=button], [role=tab], [role=link], [role=slider], '
    + '[role=checkbox], [draggable=true], .drag-handle, [data-no-drag]';
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEMPLATE']);

// ───────── 순수 함수(node 테스트 대상) ─────────

// 핸들 시작 위치(startRect)에서 dx, dy 만큼 옮길 때 화면 안에 남도록 자른다.
// 가로: 핸들이 최소 keep px 보이게 / 세로: 핸들 전체가 화면 안에(핸들이 화면보다 크면 위쪽 끝을 지킨다)
export function clampDelta(startRect, view, dx, dy, keep = KEEP_PX) {
    const { left, top, width: w, height: h } = startRect;
    const { vw, vh } = view;
    const cx = Math.min(Math.max(dx, keep - (left + w)), vw - keep - left);
    const cy = Math.max(Math.min(dy, vh - h - top), -top);
    return { dx: cx, dy: cy };
}

// 오버레이가 화면을 덮는가 — 위쪽은 보지 않는다(공통 상단바 아래에서 시작하는 오버레이 허용)
export function coversViewport(rect, vw, vh) {
    return rect.left <= 1 && rect.right >= vw - 1 && rect.bottom >= vh - 1 && rect.height >= vh * 0.5;
}

// 패널이 화면 전체 크기인가(검수 전체화면 · 휴대폰 history 등) — 가로·세로 모두 가득일 때만
export function isFullPanel(rect, vw, vh) {
    return rect.width >= vw - 4 && rect.height >= vh - 4;
}

// ───────── 브라우저 쪽 ─────────

function viewSize() {
    const de = document.documentElement;
    return { vw: de.clientWidth, vh: de.clientHeight };
}

function isOff(el) {
    return !!el && el.getAttribute && el.getAttribute('data-drag') === 'off';
}

function elementChildren(el) {
    return Array.from(el.children).filter(c => !SKIP_TAGS.has(c.tagName));
}

function isCandidate(el) {
    const cl = el.classList;
    if (cl && ((cl.contains('fixed') && cl.contains('inset-0')) || cl.contains('modal-overlay') || cl.contains('overlay'))) return true;
    return !!el.style && el.style.position === 'fixed';
}

// 오버레이가 '가운데 정렬 flex/grid' 인가(초기화 판단에도 쓴다)
function isCenteredOverlayStyle(cs) {
    return cs.position === 'fixed'
        && (cs.display === 'flex' || cs.display === 'grid')
        && String(cs.justifyContent).indexOf('center') !== -1;
}

// target(+이벤트) → { overlay, panel } 또는 null
function findDialog(target, ev) {
    if (ev && typeof ev.composedPath === 'function') {
        const path = ev.composedPath();
        if (path.length && path[0] !== ev.target) return null;   // shadow DOM 안(앱 셸 메뉴 등)
    }
    let el = target && target.nodeType === 1 ? target : (target && target.parentElement);
    let overlay = null;
    while (el && el !== document.documentElement && el !== document.body) {
        if (isCandidate(el)) { overlay = el; break; }
        el = el.parentElement;
    }
    if (!overlay) return null;
    if (EXCLUDED_IDS.has(overlay.id) || isOff(overlay)) return null;

    const cs = getComputedStyle(overlay);
    if (!isCenteredOverlayStyle(cs)) return null;
    const { vw, vh } = viewSize();
    if (!coversViewport(overlay.getBoundingClientRect(), vw, vh)) return null;
    const kids = elementChildren(overlay);
    if (kids.length !== 1) return null;

    const panel = kids[0];
    if (!panel.contains(target) || isOff(panel)) return null;
    const pp = getComputedStyle(panel).position;
    if (pp !== 'static' && pp !== 'relative') return null;
    if (isFullPanel(panel.getBoundingClientRect(), vw, vh)) return null;
    return { overlay, panel };
}

// 패널 → 핸들 요소 또는 null
function pickHandle(panel) {
    const marked = panel.querySelector('[data-drag-handle]');
    if (marked) return marked;

    let first = null;
    for (const c of elementChildren(panel)) {
        const cs = getComputedStyle(c);
        if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
        first = c;
        break;
    }
    if (first) {
        if (first.matches(HEADER_SEL)) return first;
        const fcs = getComputedStyle(first);
        if ((fcs.display === 'flex' || fcs.display === 'inline-flex') && fcs.flexDirection.indexOf('row') === 0) return first;
        if (first.offsetHeight <= 96 && !first.querySelector('input, select, textarea')) return first;
    }

    const h = panel.querySelector('h1, h2, h3, h4');
    if (h && h.getBoundingClientRect().top - panel.getBoundingClientRect().top <= HEADING_TOP_PX) return h;
    return null;
}

// target 부터 handle 까지(handle 포함)에 버튼·입력칸 등이 있으면 끌지 않는다
function isNoDragTarget(target, handle) {
    let el = target && target.nodeType === 1 ? target : (target && target.parentElement);
    while (el) {
        if (el.matches(NO_DRAG_SEL)) return true;
        if (el === handle) return false;
        el = el.parentElement;
    }
    return true;   // handle 밖
}

function init() {
    const origStyle = new WeakMap();   // panel → 처음 옮기기 전 inline position/left/top
    const moved = new Map();           // panel → overlay (옮겨진 창)
    const cursorSet = new Set();       // 커서를 move 로 바꾼 핸들
    let pending = null;                // 누른 뒤 ~ 놓을 때까지
    let rafId = 0;

    const preventSelect = (e) => e.preventDefault();

    // ── 닫히면 원위치 ──
    const observer = new MutationObserver((records) => {
        const classChanged = new Set();
        for (const r of records) {
            if (r.type === 'attributes' && r.attributeName === 'class' && moved.has(r.target)) classChanged.add(r.target);
        }
        for (const [panel, overlay] of Array.from(moved)) {
            // 오버레이는 그대로 두고 안쪽 패널만 새로 그리는 창(china 숫자 패드 등) — 옛 패널은 정리만 한다
            const replaced = !panel.isConnected || panel.parentNode !== overlay;
            if (replaced || classChanged.has(panel) || shouldReset(overlay)) reset(panel);
        }
    });

    function shouldReset(overlay) {
        if (!overlay.isConnected || overlay.classList.contains('hidden')) return true;
        const cs = getComputedStyle(overlay);
        if (cs.display === 'none' || cs.visibility === 'hidden') return true;
        return !isCenteredOverlayStyle(cs);
    }

    function observeAll() {
        observer.disconnect();
        for (const [panel, overlay] of moved) {
            observer.observe(overlay, { attributes: true, attributeFilter: ['class', 'style'], childList: true });   // childList: 패널 갈아끼우기
            if (overlay.parentNode) observer.observe(overlay.parentNode, { childList: true });   // 오버레이째 지우는 동적 창
            observer.observe(panel, { attributes: true, attributeFilter: ['class'] });          // style 은 우리가 쓰므로 제외
        }
    }

    // 끄는 도중에 창이 닫히면(ESC 등) 남은 pointermove·rAF·놓기가 옛 left/top 을 다시 쓰지 않게 끌기를 버린다(applyPos 하지 않음)
    function cancelPending(p) {
        pending = null;
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        document.removeEventListener('selectstart', preventSelect, true);
        if (p.dragging) {
            try { p.handle.releasePointerCapture(p.id); } catch (err) { /* 이미 풀림 */ }
            document.documentElement.style.userSelect = p.prevUserSelect;
            p.panel.style.transition = p.prevTransition;
        }
    }

    function reset(panel) {
        if (pending && pending.panel === panel) cancelPending(pending);
        const o = origStyle.get(panel);
        if (o) {
            panel.style.position = o.position;
            panel.style.left = o.left;
            panel.style.top = o.top;
            origStyle.delete(panel);
        }
        moved.delete(panel);
        if (moved.size === 0) observer.disconnect();
        else observeAll();
    }

    function resetAll() {
        for (const panel of Array.from(moved.keys())) reset(panel);
    }

    function endPending() {
        if (!pending) return;
        const p = pending;
        pending = null;
        document.removeEventListener('selectstart', preventSelect, true);
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; applyPos(p); }
        if (p.dragging) {
            try { p.handle.releasePointerCapture(p.id); } catch (err) { /* 이미 풀림 */ }
            document.documentElement.style.userSelect = p.prevUserSelect;
            p.panel.style.transition = p.prevTransition;
            suppressNextClick();
        }
    }

    // 끌다가 어두운 바탕에서 놓을 때 '바깥 클릭 = 닫기' 가 실행되지 않게 다음 클릭 1회를 막는다(300ms 안)
    function suppressNextClick() {
        const t0 = performance.now();
        const onClick = (e) => {
            window.removeEventListener('click', onClick, true);
            if (performance.now() - t0 > 300) return;
            e.stopImmediatePropagation();
            e.preventDefault();
        };
        window.addEventListener('click', onClick, true);
        setTimeout(() => window.removeEventListener('click', onClick, true), 350);
    }

    function applyPos(p) {
        p.panel.style.left = (p.base.x + p.dx) + 'px';
        p.panel.style.top = (p.base.y + p.dy) + 'px';
    }

    document.addEventListener('pointerdown', (e) => {
        if (pending) endPending();
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        if (window.innerWidth < MIN_WIDTH) return;
        const d = findDialog(e.target, e);
        if (!d) return;
        const handle = pickHandle(d.panel);
        if (!handle || isNoDragTarget(e.target, handle)) return;
        // 기준값은 지금 inline left/top 에서 읽는다(앱이 style 을 덮어써도 튀지 않게)
        const base = { x: parseFloat(d.panel.style.left) || 0, y: parseFloat(d.panel.style.top) || 0 };
        pending = {
            panel: d.panel, overlay: d.overlay, handle, id: e.pointerId,
            px: e.clientX, py: e.clientY, base, rect: handle.getBoundingClientRect(),
            dx: 0, dy: 0, dragging: false, prevUserSelect: '', prevTransition: ''
        };
        document.addEventListener('selectstart', preventSelect, true);
    }, true);

    window.addEventListener('pointermove', (e) => {
        const p = pending;
        if (!p || e.pointerId !== p.id) return;
        const rawX = e.clientX - p.px, rawY = e.clientY - p.py;
        if (!p.dragging) {
            if (Math.hypot(rawX, rawY) <= DRAG_START_PX) return;
            const pos = getComputedStyle(p.panel).position;
            if (pos !== 'static' && pos !== 'relative') { endPending(); return; }
            if (!origStyle.has(p.panel)) {
                origStyle.set(p.panel, { position: p.panel.style.position, left: p.panel.style.left, top: p.panel.style.top });
            }
            if (pos === 'static') p.panel.style.position = 'relative';
            p.dragging = true;
            try { p.handle.setPointerCapture(p.id); } catch (err) { /* 무시 */ }
            const sel = window.getSelection && window.getSelection();
            if (sel) sel.removeAllRanges();
            p.prevUserSelect = document.documentElement.style.userSelect;
            document.documentElement.style.userSelect = 'none';
            p.prevTransition = p.panel.style.transition;
            p.panel.style.transition = 'none';
            moved.set(p.panel, p.overlay);
            observeAll();
        }
        const c = clampDelta(p.rect, viewSize(), rawX, rawY);
        p.dx = c.dx; p.dy = c.dy;
        if (!rafId) {
            rafId = requestAnimationFrame(() => { rafId = 0; if (pending === p) applyPos(p); });
        }
    }, true);

    window.addEventListener('pointerup', (e) => { if (pending && e.pointerId === pending.id) endPending(); }, true);
    window.addEventListener('pointercancel', (e) => { if (pending && e.pointerId === pending.id) endPending(); }, true);

    // ── 커서 표시 ──
    document.addEventListener('mouseover', (e) => {
        if (window.innerWidth < MIN_WIDTH) return;
        const d = findDialog(e.target, e);
        if (!d) return;
        const handle = pickHandle(d.panel);
        if (!handle || cursorSet.has(handle) || handle.style.cursor) return;
        handle.style.cursor = 'move';
        for (const h of Array.from(cursorSet)) if (!h.isConnected) cursorSet.delete(h);   // 다시 만든 창의 옛 핸들 정리
        cursorSet.add(handle);
    }, { passive: true });

    // ── 창 크기 변경: 옮긴 창은 전부 가운데로, 좁아지면 커서도 되돌림 ──
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
        if (resizeRaf) return;
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            if (pending) endPending();
            resetAll();
            const narrow = window.innerWidth < MIN_WIDTH;
            for (const h of Array.from(cursorSet)) {
                if (narrow || !h.isConnected) {
                    if (h.style.cursor === 'move') h.style.cursor = '';
                    cursorSet.delete(h);
                }
            }
        });
    });
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') init();
