// === js/app-shell-data.js ===
// 공통 상단바(js/app-shell.js)가 쓰는 고정 데이터와 경로 계산. 의존성 없는 순수 모듈(테스트: tests/app-shell.test.js).

// 대시보드 사이드바의 '동작' 메뉴(버튼이라 링크가 '#')를 다른 화면에서 누를 때 갈 곳.
// '업무 마감' 은 넣지 않는다 — 대시보드에서만 한다(menu-catalog.js SHELL_EXCLUDED_ACTIONS).
// '오늘 처리량 입력'·'내 연차관리' 는 대시보드가 주소 뒤 #open= 을 읽어 그 창을 연다(js/app.js handleOpenHash, 1b).
export const ACTION_LINKS = {
    '대시보드': 'index.html',
    '오늘 처리량 입력': 'index.html#open=quantity',
    '내 연차관리': 'index.html#open=leave',
    '데이터 관리': 'history.html'
};

// 대시보드가 주소 뒤에서 읽는 #open= 값 → 여는 창. 이 목록에 없는 값은 무시한다.
export const OPEN_TARGETS = ['quantity', 'leave', 'noti'];
/** '#open=quantity' → 'quantity'. 형식이 다르거나 목록에 없으면 null. */
export const parseOpenHash = (hash) => {
    const m = /^#open=([a-z]+)$/.exec(String(hash || ''));
    return m && OPEN_TARGETS.includes(m[1]) ? m[1] : null;
};

// ── 메뉴를 어떻게 여는가 — 한 곳에서 정한다 ──
// 'named-window' : 대시보드 사이드바와 같다(1a, 열기 방식은 그대로). 페이지마다 이름 붙은 창/새 탭.
// 'same-tab'     : 같은 탭에서 이동한다(1b, 2026-10-16~). 셸 메뉴·대시보드 사이드바 모두.
//                  되돌릴 때는 이 값만 'named-window' 로 바꾼다.
export const SHELL_OPEN_MODE = 'same-tab';

// 링크별 창 이름 — js/ui-main-dashboard.js 사이드바(EXTERNAL_LINK_META)도 이 표를 쓴다. 순서대로 첫 일치.
export const LINK_WINDOW_TARGETS = [
    { match: 'manual.html',            target: '_blank' },              // 업무 매뉴얼
    { match: 'calculator/',            target: 'calculator_window' },   // 통합 계산기
    { match: 'location.html',          target: 'location_window' },
    { match: 'supplies.html',          target: 'supplies_window' },
    { match: 'admin.html',             target: 'admin_window' },
    { match: 'worktime.html',          target: 'worktime_window' },
    { match: 'china-stock-goods.html', target: 'chinastock_window' },
    { match: 'china-mibal2.html',      target: 'chinamibal2_window' },
    { match: 'products.html',          target: 'products_window' },
    { match: 'scan.html',              target: 'scan_window' }
];
/** 사이드바와 같은 규칙의 창 이름(없으면 null). */
export const windowTargetFor = (link) => {
    if (!link) return null;
    const m = LINK_WINDOW_TARGETS.find(t => String(link).includes(t.match));
    return m ? m.target : null;
};
// 대시보드 PC 사이드바가 '데이터 관리' 를 새 탭으로 연다(js/listeners-history.js window.open(…,'_blank')) — 셸 메뉴도 같게.
const SHELL_EXTRA_TARGETS = { 'history.html': '_blank' };

/** 셸 메뉴 링크의 target — 'same-tab' 이면 null(같은 탭), 아니면 사이드바와 같은 창 이름. */
export const shellLinkTarget = (rel, mode = SHELL_OPEN_MODE) => {
    if (mode === 'same-tab' || !rel) return null;
    const file = String(rel).split('#')[0].split('?')[0];
    return windowTargetFor(rel) || SHELL_EXTRA_TARGETS[file] || null;
};

/** 대시보드 사이드바 링크의 target 값 — 'same-tab' 이면 ''(같은 탭), 아니면 이름 붙은 창(없으면 ''). */
export const sidebarLinkTarget = (link, mode = SHELL_OPEN_MODE) => {
    if (mode === 'same-tab') return '';
    return windowTargetFor(link) || '';
};

/** 로그인 이메일 → 직원 이름(mainConfig.memberEmails 역매핑, 대소문자 무시). 없으면 null.
 *  공통 상단바 개인 알림 구독에만 쓴다 — 저장·출력하지 않는다. */
export const memberNameFor = (memberEmails, email) => {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !memberEmails || typeof memberEmails !== 'object') return null;
    for (const [name, v] of Object.entries(memberEmails)) {
        if (name && typeof v === 'string' && v.trim().toLowerCase() === e) return name;
    }
    return null;
};

// <body data-shell="..."> 값 → 파일과 기본 화면 이름(메뉴에서 못 찾을 때 쓴다).
export const PAGE_DEFAULTS = {
    'index':             { file: 'index.html',             title: '대시보드' },
    'history':           { file: 'history.html',           title: '데이터 관리' },
    'admin':             { file: 'admin.html',             title: '관리자 페이지' },
    'location':          { file: 'location.html',          title: '로케이션 관리' },
    'products':          { file: 'products.html',          title: '상품 관리' },
    'china-stock-goods': { file: 'china-stock-goods.html', title: '중국제작 미발계산기' },
    'china-mibal2':      { file: 'china-mibal2.html',      title: '미발계산기(신규·시험)' },
    'scan':              { file: 'scan.html',              title: '입고 스캐너' },
    'manual':            { file: 'manual.html',            title: '업무 매뉴얼 및 도구' },
    'supplies':          { file: 'supplies.html',          title: '비품 관리' },
    'worktime':          { file: 'worktime.html',          title: '출퇴근 기록표' },
    'calculator':        { file: 'calculator/index.html',  title: '통합 계산기' }
};

export const HOME_FILE = 'index.html';

// 경로 검사용 기준 주소(앱 밖 주소를 가려낼 때만 쓴다 — 실제 주소 계산은 absUrl(rel, 진짜 BASE))
const CHECK_BASE = 'https://app.invalid/shell/';

/** 메뉴 항목 → 갈 주소(앱 기준 상대경로). 갈 곳이 없으면 null(메뉴에서 뺀다).
 *  동작 메뉴는 이름으로, 나머지는 저장된 링크로. 브라우저와 같은 URL 해석(new URL)으로 풀어서
 *  앱 폴더 안의 http(s) 주소일 때만 받는다 — 'java(탭)script:'·'\\host'·'//host' 같은 우회를 막는다. */
export const hrefForItem = (item, base = CHECK_BASE) => {
    if (!item || !item.name) return null;
    if (Object.prototype.hasOwnProperty.call(ACTION_LINKS, item.name)) return ACTION_LINKS[item.name];
    const link = String(item.link || '').trim();
    if (!link || link.startsWith('#')) return null;
    let u;
    try { u = new URL(link, base); } catch (e) { return null; }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!u.href.startsWith(base)) return null;
    const rel = u.href.slice(base.length);
    if (!rel || rel.startsWith('#') || rel.startsWith('?')) return null;
    return rel;
};

/** visibleMenuFor 결과 → 셸이 그릴 그룹(주소가 정해진 항목만). */
export const resolveMenuGroups = (groups, base = CHECK_BASE) => (Array.isArray(groups) ? groups : [])
    .map(g => ({
        category: (g && g.category) || '',
        items: ((g && g.items) || [])
            .map(i => ({ name: i && i.name, link: hrefForItem(i, base) }))
            .filter(i => i.name && i.link)
    }))
    .filter(g => g.items.length > 0);

/** 앱 기준 상대경로 → 절대 주소. base 는 앱 폴더 주소(끝이 /). */
export const absUrl = (rel, base) => new URL(rel, base).href;

/** 지금 주소가 앱 기준으로 어느 파일인지 — 'calculator/index.html' 처럼. 앱 밖이면 null.
 *  폴더 주소(…/ 로 끝남)는 index.html 로 본다(GitHub Pages 첫 화면). */
export const pageFileOf = (href, base) => {
    const u = new URL(href, base);
    const b = new URL(base);
    if (u.origin !== b.origin || !u.pathname.startsWith(b.pathname)) return null;
    let rest = decodeURIComponent(u.pathname.slice(b.pathname.length));
    if (rest === '' || rest.endsWith('/')) rest += 'index.html';
    return rest;
};

/** 화면 이름 — 메뉴에서 이 파일로 가는 첫 항목 이름(동작 메뉴의 #… 은 빼고 비교), 없으면 기본값. */
export const currentTitle = (pageId, groups, file) => {
    const def = PAGE_DEFAULTS[pageId];
    const target = file || (def && def.file);
    if (target) {
        for (const g of (groups || [])) {
            for (const i of (g.items || [])) {
                if (!i.link || i.link.includes('#')) continue;
                if (i.link.split('?')[0] === target) return i.name;
            }
        }
    }
    return def ? def.title : '';
};
