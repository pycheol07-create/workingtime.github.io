// === js/app-shell-data.js ===
// 공통 상단바(js/app-shell.js)가 쓰는 고정 데이터와 경로 계산. 순수 모듈(의존은 lib 상수 mibal2-mode.js 하나, 테스트: tests/app-shell.test.js).
import { MIBAL2_MENU_NAME } from './lib/mibal2-mode.js?v=202610291532';

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
// 'named-window' 로 되돌릴 때만 쓴다 — 예전 대시보드는 '데이터 관리' 를 새 탭으로 열었다(지금은 같은 탭 goTo, js/listeners-history.js).
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
    'admin':             { file: 'admin.html',             title: '설정·관리' },
    'location':          { file: 'location.html',          title: '로케이션 관리' },
    'products':          { file: 'products.html',          title: '상품 관리' },
    'china-stock-goods': { file: 'china-stock-goods.html', title: '중국제작 부족수량 관리' },
    'china-mibal2':      { file: 'china-mibal2.html',      title: MIBAL2_MENU_NAME },
    'scan':              { file: 'scan.html',              title: '입고 스캐너' },
    'manual':            { file: 'manual.html',            title: '업무 매뉴얼' },
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

// ── Ctrl+K 빠른 이동(1d)의 화면 안 목적지 ──
// 부모 화면(파일)이 그 사람 메뉴에 보일 때만 붙는다(buildDestinations). 해시는 js/hash-state.js 형식(탭 이름만).
// 탭 이름·값은 각 화면 코드 기준: 데이터 관리 14개 화면(js/history-sections.js — 이름은 좌측 레일과 같게, 해시는 예전 tab/sub 형식)·업무 예상 3화면,
// admin.html(.admin-tab-btn data-target 의 section- 뒤), location.html(#tab-btn-*), products.html(#pd-tabs — 기존 해시 그대로),
// calculator/app.js(tabs id), china-stock-goods.html(머리줄 모드 세그먼트 #csg-mode-nav — 해시 tab=mibal|location). adminOnly 는 관리자에게만(상품 관리의 원가·공급처 화면).
const S = (label, hash, keywords = [], extra = {}) => ({ label, hash, keywords, ...extra });
export const SUB_DESTINATIONS = {
    'history.html': [
        // 분석
        S('요약', 'tab=dashboard', ['종합 인사이트', '인사이트']),
        S('생산성', 'tab=productivity', ['생산성 및 효율성', '효율']),
        S('인력 적정성', 'tab=staffing', ['인력 운영', '인력']),
        // 예측·계획
        S('업무 예상', 'tab=forecast', ['예상', '예측']),
        S('업무 예상 · 오늘 현황', 'tab=forecast&fview=today', ['오늘 현황', '진행']),
        S('업무 예상 · 계획', 'tab=forecast&fview=plan', ['계획']),
        S('업무 예상 · 정확도', 'tab=forecast&fview=accuracy', ['정확도']),
        S('물량 추세 예측', 'tab=prediction', ['실적 예측', '예측', '추세']),
        // 기록
        S('업무 이력', 'tab=rawdata&sub=work', ['업무 기록', '로우데이터', '기록']),
        S('근태 이력', 'tab=rawdata&sub=attendance', ['근태']),
        S('검수 이력', 'tab=rawdata&sub=inspection', ['검수']),
        S('연차 관리', 'tab=rawdata&sub=leave', ['연차']),
        // 보고
        S('업무 리포트', 'tab=rawdata&sub=report', ['리포트']),
        S('개인 리포트', 'tab=rawdata&sub=personal', ['리포트']),
        S('경영 지표', 'tab=rawdata&sub=management', ['경영']),
        S('팀 결산', 'tab=settlement', ['팀 결산 보고', '결산']),
        S('운영 마일스톤', 'tab=milestones', ['마일스톤'])
    ],
    'admin.html': [
        // 관리자 좌측 메뉴(admin.html 그룹 5개)와 같은 순서
        // 사람·권한
        S('팀원 관리', 'tab=team'),
        S('권한 관리', 'tab=permission'),
        // 메인 화면 구성
        S('메뉴 관리', 'tab=menu'),
        S('위젯 관리', 'tab=widget'),
        S('고정 업무', 'tab=keytask'),
        // 업무·집계
        S('업무 등록 관리', 'tab=task'),
        S('집계/위젯 연동', 'tab=quantity'),
        S('원가/손익 분석', 'tab=cost'),
        // 자동화
        S('자동화 상태', 'tab=automation'),
        // 기타
        S('기본 설정', 'tab=setting')
    ],
    'location.html': [
        S('로케이션 대시보드', 'tab=locdash', ['대시보드']),
        S('데이터 리스트', 'tab=list', ['리스트']),
        S('도면', 'tab=map', ['지도'])
    ],
    'china-stock-goods.html': [
        S('미발계산', 'tab=mibal', ['미발', '미발계산기', '부족수량', '부족수량 관리']),
        S('위치지정', 'tab=location', ['위치', '위치지정모드'])
    ],
    'products.html': [
        S('상품 목록', '', ['상품']),
        S('변경 이력', 'log'),
        S('공급처 대장', 'sup', [], { adminOnly: true }),
        S('단가 변경 이력', 'costlog', [], { adminOnly: true })
    ],
    'calculator/index.html': [
        S('수입가 계산기', 'tab=import', ['수입']),
        S('통관비 계산기', 'tab=customs', ['통관']),
        S('선적 계산기', 'tab=shipping', ['선적', '배송']),
        S('창고료&가산세 계산기', 'tab=warehouse', ['창고'])
    ]
};

const fileOfRel = (rel) => String(rel || '').split('#')[0].split('?')[0];

/** 빠른 이동 결과 목록 — '홈' + 보이는 메뉴(대시보드·업무 마감 제외) + 그 메뉴 화면의 하위 목적지.
 *  groups 는 resolveMenuGroups 결과({category, items:[{name, link}]}). role 이 'admin' 이 아니면 adminOnly 를 뺀다.
 *  돌려주는 url 은 앱 기준 상대경로. */
export const buildDestinations = (groups, role) => {
    const out = [{ kind: 'home', label: '홈', parent: '', keywords: ['대시보드', '메인'], url: HOME_FILE }];
    const parents = new Map();   // 파일 → 메뉴 이름(처음 것)
    for (const g of (groups || [])) {
        for (const i of ((g && g.items) || [])) {
            if (!i || !i.name || !i.link || i.name === '업무 마감') continue;
            if (i.link === HOME_FILE) continue;   // '대시보드' = 위의 '홈'
            out.push({ kind: 'menu', label: i.name, parent: g.category || '', keywords: [], url: i.link });
            const f = fileOfRel(i.link);
            if (!i.link.includes('#') && !parents.has(f)) parents.set(f, i.name);
        }
    }
    for (const [file, parentName] of parents) {
        for (const d of (SUB_DESTINATIONS[file] || [])) {
            if (d.adminOnly && role !== 'admin') continue;
            out.push({ kind: 'sub', label: d.label, parent: parentName, keywords: d.keywords || [],
                       url: file + (d.hash ? '#' + d.hash : ''), adminOnly: !!d.adminOnly });
        }
    }
    return out;
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
