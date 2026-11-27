// === js/history-flyout.js ===
// 대시보드 왼쪽 메뉴 '데이터 관리'에 마우스를 올리면 2차 메뉴(데이터 관리 10개 화면)를 오른쪽에 펼친다(2026-11-26 사용자 요청).
//   목록은 js/history-sections.js SECTION_GROUPS·SECTIONS 한 벌에서 만든다(레일 마크업을 복제하지 않는다).
//   항목을 누르면 go('#tab=…[&sub=…]') — 로그인 확인·이동은 부르는 쪽(js/listeners-history.js openHistoryModalLogic)이 한다.
//   마우스가 있는 화면에서만(hover:hover · pointer:fine). 터치 화면은 예전처럼 눌러서 데이터 관리로 간다.
// ⚠️ 봇 안전: role=dialog·data-act 를 쓰지 않는다(업무마감봇 선택자). 모양 토큰은 #dash-root 것(css/dash-d.css)이라 그 안에 붙인다.
import { SECTIONS, SECTION_GROUPS, sectionIconSvg } from './history-sections.js?v=c5e89d216c58-1af66818';

const CSS = `
#history-flyout { position: fixed; z-index: 60; min-width: 190px; padding: 8px; display: none;
    background: var(--c-surface, #fff); border: 1px solid var(--c-line, #E6E8EC); border-radius: var(--r-sm, 10px);
    box-shadow: 6px 6px 18px rgba(16, 24, 40, .16); font-size: 13.5px; max-height: calc(100vh - 16px); overflow-y: auto; }
#history-flyout.is-open { display: block; }
#history-flyout .hf-group + .hf-group { margin-top: 8px; }
#history-flyout .hf-title { padding: 4px 10px 2px; font-size: 11.5px; font-weight: 600; color: var(--c-text-3, #69707A); }
#history-flyout .hf-ico { flex: none; width: 17px; height: 17px; color: var(--c-text-3, #69707A); }
#history-flyout .hf-item:hover .hf-ico, #history-flyout .hf-item:focus-visible .hf-ico { color: inherit; }
#history-flyout .hf-item { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 0; border-radius: 8px; background: transparent;
    text-align: left; font: inherit; color: var(--c-text, #23272E); cursor: pointer; white-space: nowrap; }
#history-flyout .hf-item:hover, #history-flyout .hf-item:focus-visible { background: var(--c-accent-soft, #EAF0FD); color: var(--c-accent-deep, #1E4699); outline: none; }`;

/** 화면 id → 해시('#tab=forecast' · '#tab=rawdata&sub=work') — 형식은 js/hash-state.js */
export const sectionHash = (id) => {
    const s = SECTIONS[id];
    if (!s) return '';
    return `#tab=${encodeURIComponent(s.main)}${s.sub ? `&sub=${encodeURIComponent(s.sub)}` : ''}`;
};

export function initHistoryFlyout(btn, { go } = {}) {
    if (!btn || typeof go !== 'function' || document.getElementById('history-flyout')) return null;
    const mq = window.matchMedia ? window.matchMedia('(hover: hover) and (pointer: fine)') : null;
    if (!document.getElementById('history-flyout-css')) {
        const st = document.createElement('style');
        st.id = 'history-flyout-css';
        st.textContent = CSS;
        document.head.appendChild(st);
    }
    const panel = document.createElement('nav');
    panel.id = 'history-flyout';
    panel.setAttribute('aria-label', '데이터 관리 화면');
    panel.innerHTML = SECTION_GROUPS.map(g => `<div class="hf-group"><div class="hf-title">${g.title}</div>${
        g.ids.filter(id => SECTIONS[id]).map(id => `<button type="button" class="hf-item" data-hf-id="${id}">${sectionIconSvg(id, 'hf-ico')}<span>${SECTIONS[id].label}</span></button>`).join('')
    }</div>`).join('');
    (document.getElementById('dash-root') || document.body).appendChild(panel);

    let timer = null;
    const place = () => {
        const r = btn.getBoundingClientRect();
        const side = btn.closest('aside');
        const left = side ? side.getBoundingClientRect().right : r.right;
        panel.style.left = `${Math.round(left + 6)}px`;
        panel.style.top = '0px';
        const h = panel.offsetHeight;
        panel.style.top = `${Math.round(Math.max(8, Math.min(r.top - 8, window.innerHeight - h - 8)))}px`;
    };
    const onEsc = (e) => {
        if (e.key !== 'Escape') return;
        e.stopImmediatePropagation(); e.preventDefault();
        const back = panel.contains(document.activeElement);
        close();
        if (back) btn.focus();
    };
    const open = () => {
        if (mq && !mq.matches) return;
        if (btn.offsetParent === null) return;   // 권한이 없어 숨은 단추
        clearTimeout(timer);
        if (!panel.classList.contains('is-open')) {
            panel.classList.add('is-open'); place();
            window.addEventListener('keydown', onEsc, true);
        }
        btn.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
        clearTimeout(timer);
        if (panel.classList.contains('is-open')) window.removeEventListener('keydown', onEsc, true);
        panel.classList.remove('is-open');
        btn.setAttribute('aria-expanded', 'false');
    };
    const closeSoon = () => { clearTimeout(timer); timer = setTimeout(close, 200); };
    // 키보드 초점이 단추·목록에 있으면 마우스가 스쳐 나가도 닫지 않는다
    const closeSoonByMouse = () => {
        const a = document.activeElement;
        if (a === btn || panel.contains(a)) return;
        closeSoon();
    };

    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('mouseenter', open);
    btn.addEventListener('mouseleave', closeSoonByMouse);
    btn.addEventListener('focus', open);
    panel.addEventListener('mouseenter', () => clearTimeout(timer));
    panel.addEventListener('mouseleave', closeSoonByMouse);
    panel.addEventListener('mousedown', () => clearTimeout(timer));   // 누르는 중에는 닫지 않는다(Safari 는 누른 단추에 초점을 주지 않는다)
    // 키보드: 단추에서 → 로 목록에 들어가고, 목록·단추 밖으로 초점이 나가면 닫는다
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight' && panel.classList.contains('is-open')) { e.preventDefault(); panel.querySelector('.hf-item')?.focus(); }
    });
    const onFocusOut = (e) => {
        if (panel.contains(e.relatedTarget) || e.relatedTarget === btn) return;
        if (panel.matches(':hover') || btn.matches(':hover')) return;   // 마우스가 아직 위에 있다
        closeSoon();
    };
    btn.addEventListener('blur', onFocusOut);
    panel.addEventListener('focusout', onFocusOut);
    panel.addEventListener('keydown', (e) => {
        const list = [...panel.querySelectorAll('.hf-item')];
        const i = list.indexOf(document.activeElement);
        const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (step && i >= 0) { e.preventDefault(); list[(i + step + list.length) % list.length].focus(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); close(); btn.focus(); }
    });
    panel.addEventListener('click', (e) => {
        const b = e.target.closest('.hf-item');
        if (!b) return;
        close();
        go(sectionHash(b.dataset.hfId), e);
    });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', (e) => {
        const t = e.target;
        if (t === document || t === document.documentElement || (t && t.contains && t.contains(btn))) close();
    }, true);
    return { open, close, panel };
}
