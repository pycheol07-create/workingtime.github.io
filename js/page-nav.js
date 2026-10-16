// === js/page-nav.js ===
// 화면 안 보조 내비 — 공통 규칙 N0 (UI 2단계, 2026-10-16). 모양은 css/page-nav.css.
//   항목 5개 이하: 상단 세그먼트(.pn--seg) / 6개 이상: 데스크톱 좌측 레일, 모바일 '현재 화면 ▾' 펼침 목록(.pn--rail).
//   마크업: <nav class="pn"> [.pn-toggle > .pn-current] [.pn-collapse] .pn-list > .pn-group > (.pn-group-title, button.pn-item[data-pn-id])
// 여기서 하는 일은 켜짐 표시(is-on)·모바일 펼침·레일 접기·방향키 이동·'pn:change' 이벤트뿐이다.
// 화면 전환은 페이지의 기존 함수가 한다(onSelect 콜백) — 이 파일은 데이터를 모른다.
// ⚠️ 봇 안전(UI1단계 설계): role=dialog·data-act 를 쓰지 않는다(업무마감봇이 div[role=dialog] 마지막 것을 집는다).

const ITEM = '.pn-item';

export function initPageNav(root, { onSelect, storageKey } = {}) {
    if (!root) return null;
    const items = () => [...root.querySelectorAll(ITEM)];
    const rail = items().length >= 6;
    root.classList.add(rail ? 'pn--rail' : 'pn--seg');
    const toggle = root.querySelector('.pn-toggle');
    const current = root.querySelector('.pn-current');
    const collapse = root.querySelector('.pn-collapse');

    // 펼친 목록의 Esc 는 목록만 닫는다 — 페이지 모달 Esc(js/modal-esc.js, document 캡처)보다 먼저 받으려고 window 캡처로, 펼쳤을 때만 건다
    const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        e.stopImmediatePropagation();
        e.preventDefault();
        setOpen(false);
        if (toggle) toggle.focus();
    };
    const setOpen = (open) => {
        const was = root.classList.contains('is-open');
        root.classList.toggle('is-open', !!open);
        if (toggle) toggle.setAttribute('aria-expanded', String(!!open));
        if (!!open !== was) {
            if (open) window.addEventListener('keydown', onEsc, true);
            else window.removeEventListener('keydown', onEsc, true);
        }
    };
    const setCollapsed = (on) => {
        root.classList.toggle('is-collapsed', !!on);
        if (collapse) { collapse.setAttribute('aria-expanded', String(!on)); collapse.title = on ? '메뉴 펼치기' : '메뉴 접기'; }
        try { if (storageKey) localStorage.setItem(storageKey, on ? '1' : '0'); } catch (e) { /* 기억 못 해도 동작에는 지장 없다 */ }
    };
    try { if (storageKey && localStorage.getItem(storageKey) === '1') setCollapsed(true); } catch (e) { }

    /** 켜짐 표시만 바꾼다(화면 전환 없음). 찾은 항목을 돌려준다. */
    const setActive = (id) => {
        let on = null;
        for (const b of items()) {
            const hit = b.dataset.pnId === id;
            b.classList.toggle('is-on', hit);
            if (hit) { b.setAttribute('aria-current', 'page'); on = b; } else b.removeAttribute('aria-current');
        }
        if (current && on) current.textContent = on.dataset.pnLabel || on.textContent.trim();
        return on;
    };

    root.addEventListener('click', (e) => {
        if (e.target.closest('.pn-toggle')) { setOpen(!root.classList.contains('is-open')); return; }
        if (e.target.closest('.pn-collapse')) { setCollapsed(!root.classList.contains('is-collapsed')); return; }
        const b = e.target.closest(ITEM);
        if (!b || !root.contains(b)) return;
        const id = b.dataset.pnId;
        setActive(id);
        setOpen(false);
        root.dispatchEvent(new CustomEvent('pn:change', { detail: { id }, bubbles: true }));
        if (onSelect) onSelect(id, e);
    });

    // 방향키: 레일은 ↑↓, 세그먼트는 ←→ 로 보이는 항목 사이를 옮긴다(Enter·Space 는 버튼 기본 동작).
    root.addEventListener('keydown', (e) => {
        const keys = rail ? ['ArrowDown', 'ArrowUp'] : ['ArrowRight', 'ArrowLeft'];
        const step = e.key === keys[0] ? 1 : e.key === keys[1] ? -1 : 0;
        if (!step || !e.target.closest(ITEM)) return;
        const list = items().filter(b => b.offsetParent !== null);
        const i = list.indexOf(e.target.closest(ITEM));
        if (i < 0 || !list.length) return;
        e.preventDefault();
        list[(i + step + list.length) % list.length].focus();
    });

    // 모바일 펼침: 바깥을 누르면 닫는다
    document.addEventListener('click', (e) => {
        if (root.classList.contains('is-open') && !root.contains(e.target)) setOpen(false);
    });

    return { root, setActive, setOpen, setCollapsed };
}
