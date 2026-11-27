// === js/quick-menu.js ===
// 대시보드(index.html) 휴대폰 '퀵메뉴' (2026-11-27) — 오른쪽 아래 둥근 단추(예전 새로고침 단추 자리·모양). 새로고침은 당겨서(js/pull-refresh.js).
//   누르면 아래에서 시트가 올라와 바로가기 6개(큰 칸, 아이콘+이름). 바깥 누르기·Esc·단추 다시 누르기로 닫힌다.
//   권한: 메뉴(셸·사이드바)와 같은 판정 — lib/perm.js can + app.js 가 넣은 State.appState.perm. 없는 항목은 숨긴다.
//     페이지 바로가기는 각 페이지 page-gate 의 data-perm-page 와 같은 기능 id, 채우기는 refill-dash.js refillAllowed 그대로.
//   변경추천표는 대시보드에서 바로 연다(js/locrec-dash.js openLocRecFromDash — 대시보드 업무 카드와 같은 창).
//   (location.html?open=locrec 로 들어와도 로케이션관리에서 창이 열린다 — js/location.js)
//   검수 매니저 두 개는 권한 기능이 없다(업무 카드 버튼과 같이 로그인한 직원 모두).
// ⚠️ role="dialog"·data-act 를 쓰지 않는다 — 업무마감봇·업무예상알림이 그 선택자로 자기 확인창을 찾는다.
// ⚠️ 시트에 .fixed.inset-0 + justify-center 모양을 쓰지 않는다 — js/modal-esc.js 가 모달로 보고 ESC 로 닫으려 든다. ESC 는 여기서 처리한다.
// 색·모양은 css/dash-d.css(#quick-menu-*) — 토큰을 쓰므로 다크 모드는 html.dark 토큰을 따른다.
import * as State from './state.js?v=c7f5fc984ef9-a2ce38c0';
import { can } from './lib/perm.js?v=c1e53d91da8e-49afeea3';
import { refillAllowed, openRefillFromDash } from './refill-dash.js?v=fa20c3bb2e8b-9d529bbc';
import { locRecAllowed, openLocRecFromDash } from './locrec-dash.js?v=ff01ed3f8c28-a54bc4d0';

const BTN_ID = 'quick-menu-btn';
const SHEET_ID = 'quick-menu-sheet';
const BACK_ID = 'quick-menu-backdrop';

const has = (id) => can(State.appState && State.appState.perm, id);
const svg = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

const ICON_MENU = svg('<rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/>');
const ICON_CLOSE = svg('<path d="M6 6l12 12M18 6L6 18"/>');

// 검수 모듈은 누를 때 불러온다 — 이 파일은 ui-main-board.js 가 싣는데, 정적 import 로 잇으면 모듈 순환이 생긴다(이미 실린 모듈이라 바로 온다)
const ITEMS = [
    { key: 'supplies-io', label: '비품 입·출고', href: 'supplies-io.html', ok: () => has('supplies.view'),
      icon: svg('<path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/>') },
    { key: 'scan', label: '부족수량 스캔', sub: '입고 스캐너', href: 'scan.html', ok: () => has('scan.view'),
      icon: svg('<path d="M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 12h8"/>') },
    { key: 'refill', label: '채우기표', ok: () => refillAllowed(), run: () => openRefillFromDash({ quick: true }),
      icon: svg('<path d="M4 20h16"/><path d="M7 16V9M12 16V5M17 16v-4"/>') },
    { key: 'locrec', label: '변경추천표', ok: () => locRecAllowed(), run: () => openLocRecFromDash(),
      icon: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>') },
    { key: 'insp', label: '샘플검수 매니저', ok: () => true,
      run: () => import('./inspection-logic.js?v=6e64a569ae56-aad5f436').then(m => m.openInspectionManager()),
      icon: svg('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>') },
    { key: 'total-insp', label: '전량검수 매니저', ok: () => true,
      run: () => import('./total-inspection-logic.js?v=ac83422340da-9fc94c2e').then(m => m.openTotalInspection()),
      icon: svg('<path d="M9 3h6l1 2h3v16H5V5h3z"/><path d="M9 13l2 2 4-4"/>') }
];

const signedIn = () => !!(State.auth && State.auth.currentUser);

let btn = null, sheet = null, backdrop = null;

const isOpen = () => !!sheet && !sheet.hidden;

function renderItems() {
    const grid = sheet.querySelector('.qm-grid');
    const note = sheet.querySelector('.qm-note');
    const list = signedIn() ? ITEMS.filter(it => { try { return !!it.ok(); } catch (e) { return false; } }) : [];
    grid.innerHTML = list.map(it => {
        const inner = `<span class="qm-ico">${it.icon}</span><span class="qm-label">${it.label}</span>`
            + (it.sub ? `<span class="qm-sub">${it.sub}</span>` : '');
        return it.href
            ? `<a class="qm-item" href="${it.href}" data-qm="${it.key}">${inner}</a>`
            : `<button type="button" class="qm-item" data-qm="${it.key}">${inner}</button>`;
    }).join('');
    note.hidden = list.length > 0;
    note.textContent = signedIn() ? '쓸 수 있는 바로가기가 없습니다.' : '로그인한 뒤 쓸 수 있습니다.';
}

function open() {
    if (!sheet || isOpen()) return;
    renderItems();
    backdrop.hidden = false;
    sheet.hidden = false;
    void sheet.offsetHeight;                 // 올라오는 움직임이 보이게 한 번 그린 뒤 클래스를 붙인다
    sheet.classList.add('qm-open');
    backdrop.classList.add('qm-open');
    btn.classList.add('qm-btn-open');
    btn.setAttribute('aria-expanded', 'true');
    btn.setAttribute('aria-label', '퀵메뉴 닫기');
    btn.innerHTML = ICON_CLOSE;
    // 키보드·화면낭독기 — 첫 항목으로 초점(리뷰). 터치는 초점 표시가 거슬리지 않게 preventScroll 만
    const first = sheet.querySelector('.qm-item');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
}

function close() {
    if (!isOpen()) return;
    const hadFocus = sheet.contains(document.activeElement);
    sheet.classList.remove('qm-open');
    backdrop.classList.remove('qm-open');
    sheet.hidden = true;
    backdrop.hidden = true;
    btn.classList.remove('qm-btn-open');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-label', '퀵메뉴');
    btn.innerHTML = ICON_MENU;
    if (hadFocus) { try { btn.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }   // 닫으면 단추로 초점을 돌려놓는다
}

/** 대시보드에서 한 번 부른다(ui-main-board.js). 단추·시트는 body 에 붙는다. 휴대폰(md 미만)에서만 보인다(css/dash-d.css) */
export function setupQuickMenu() {
    if (typeof document === 'undefined' || document.getElementById(BTN_ID)) return;
    btn = document.createElement('button');
    btn.id = BTN_ID;
    btn.type = 'button';
    btn.className = 'fixed bottom-6 right-6 w-12 h-12 d-fab rounded-full z-50 md:hidden flex items-center justify-center';   // 색은 css/dash-d.css
    btn.setAttribute('aria-label', '퀵메뉴');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', SHEET_ID);
    btn.innerHTML = ICON_MENU;

    backdrop = document.createElement('div');
    backdrop.id = BACK_ID;
    backdrop.hidden = true;

    sheet = document.createElement('div');
    sheet.id = SHEET_ID;
    sheet.hidden = true;
    sheet.setAttribute('aria-label', '퀵메뉴');
    sheet.innerHTML = '<div class="qm-handle" aria-hidden="true"></div><div class="qm-title">퀵메뉴</div><div class="qm-grid"></div><p class="qm-note" hidden></p>';

    btn.addEventListener('click', () => (isOpen() ? close() : open()));
    backdrop.addEventListener('click', close);
    sheet.addEventListener('click', (e) => {
        const el = e.target.closest && e.target.closest('.qm-item');
        if (!el) return;
        const it = ITEMS.find(x => x.key === el.dataset.qm);
        close();
        if (!it || it.href) return;           // 링크는 그대로 이동
        try {
            Promise.resolve(it.run()).catch(err => console.warn('[퀵메뉴] 열지 못했습니다', it.key, err));
        } catch (err) { console.warn('[퀵메뉴] 열지 못했습니다', it.key, err); }
    });
    // Esc — 다른 창의 ESC 처리(modal-esc.js)까지 가지 않게 여기서 먹는다(열려 있을 때만)
    window.addEventListener('keydown', (e) => {
        if (!isOpen() || !(e.key === 'Escape' || e.key === 'Esc')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
    }, true);
    // 화면이 넓어지면(md 이상) 단추가 숨으므로 시트도 닫는다
    try { matchMedia('(min-width:768px)').addEventListener('change', (m) => { if (m.matches) close(); }); } catch (e) { /* 옛 브라우저 */ }

    document.body.appendChild(backdrop);
    document.body.appendChild(sheet);
    document.body.appendChild(btn);
}

export const isQuickMenuOpen = isOpen;
