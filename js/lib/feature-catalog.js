// === js/lib/feature-catalog.js ===
// 권한 기능 카탈로그 — 권한을 메뉴 '이름'이 아니라 바뀌지 않는 기능 ID 로 다룬다(권한 개편, 2026-10-19).
// 저장(mainConfig perm*)·규칙(hasFeature)·화면 코드는 모두 id 만 본다. label 은 표시용이라 바꿔도 권한이 안 끊긴다.
//
// 메뉴와의 관계(설계 2.3 A안): 메뉴 표(js/menu-catalog.js MENU_TARGETS)·하위 목적지(js/app-shell-data.js SUB_DESTINATIONS)는
//   그대로 두고, 여기서 menu·page·sub 로 **참조**한다. 1:1 인지는 tests/feature-catalog.test.js 가 지킨다.
// ※ 순수 모듈(의존은 같은 lib 의 상수 파일 mibal2-mode.js 하나). 관리자 페이지·대시보드·셸·(다음 단계) 페이지 가드가 같이 쓴다.
//
// 항목 형식
//   id        바뀌지 않는 키
//   label     표시 이름
//   group     관리 화면 묶음(FEATURE_GROUPS)
//   kind      'page'(파일 입장) | 'action'(대시보드 사이드바 동작 버튼) | 'sub'(페이지 안 하위 화면) | 'func'(페이지 안 기능)
//   page      page: 이 파일 입장 / action·sub·func: 소속 파일
//   menu      page·action: 메뉴 이름(MENU_TARGETS) — 옛 권한(memberMenuAccess) 변환·action 연결용
//   menuAliases  page: 예전 기본 메뉴 이름. 저장된 dashboardMenu·memberMenuAccess 의 옛 이름도 같은 기능으로 잇고,
//             같은 링크의 메뉴는 보이는 이름만 menu 로 바꾼다(menu-catalog.js withBuiltinMenus). 저장 값은 그대로 둔다.
//   sub       sub: SUB_DESTINATIONS 의 hash 목록
//   danger    0 | 1 | 2 (2 = 되돌리기 어려움 — 덮어쓰기·삭제·마감)
//   rule      'yes' | 'partial' | 'no' — Firestore 규칙으로도 막는가(관리 화면 표시용. 규칙은 4·7단계에서 게시)
//   grantable false = 관리자 전용(역할·예외로 줘도 무시)
//   legacyAdminOnly  옛 ADMIN_ONLY_* 범위 — 옛 권한을 끌어올 때 일반 직원에게 주지 않는다(예전에도 화면이 막고 있었다)

import { MIBAL2_LIVE, MIBAL2_MENU_NAME, MIBAL2_TRIAL_MENU_NAME } from './mibal2-mode.js?v=202610291402';

export const FEATURE_GROUPS = [
    { id: 'dash',       label: '대시보드' },
    { id: 'data',       label: '데이터 관리' },
    { id: 'location',   label: '로케이션 관리' },
    { id: 'china',      label: '중국제작 부족수량 관리' },
    { id: 'scan',       label: '입고 스캐너' },
    { id: 'products',   label: '상품 관리' },
    { id: 'supplies',   label: '비품 관리' },
    { id: 'worktime',   label: '출퇴근 기록표' },
    { id: 'calculator', label: '통합 계산기' },
    { id: 'manual',     label: '업무 매뉴얼' },
    { id: 'admin',      label: '관리자' }
];

const F = (id, label, group, kind, page, extra = {}) => ({
    id, label, group, kind, page,
    menu: null, sub: [], danger: 0, rule: 'no', grantable: true, legacyAdminOnly: false,
    ...extra
});

export const FEATURES = [
    // 대시보드 — index.html 입장 자체는 막지 않는다(로그인 화면이 여기 있다). dash.view 는 사이드바 '대시보드' 항목이다.
    F('dash.view',     '대시보드',            'dash', 'page',   'index.html', { menu: '대시보드' }),
    F('dash.quantity', '오늘 처리량 입력',    'dash', 'action', 'index.html', { menu: '오늘 처리량 입력', danger: 1 }),
    F('dash.leave',    '내 연차관리',         'dash', 'action', 'index.html', { menu: '내 연차관리' }),
    F('dash.endShift', '업무 마감',           'dash', 'action', 'index.html', { menu: '업무 마감', danger: 2, legacyAdminOnly: true }),

    // 데이터 관리(history.html) — 옛 권한에서는 관리자 전용이었다(app.js 가 버튼을 숨겼다)
    F('data.view',     '데이터 관리 입장',    'data', 'page', 'history.html', { menu: '데이터 관리', legacyAdminOnly: true }),
    F('data.analysis', '요약·생산성·인력',     'data', 'sub',  'history.html', { legacyAdminOnly: true,
        sub: ['tab=dashboard', 'tab=productivity', 'tab=staffing'] }),
    F('data.forecast', '업무 예상·물량 추세',  'data', 'sub',  'history.html', { legacyAdminOnly: true,
        sub: ['tab=forecast', 'tab=forecast&fview=today', 'tab=forecast&fview=plan', 'tab=forecast&fview=accuracy', 'tab=prediction'] }),
    F('data.records',  '업무·근태·검수·연차 이력 보기', 'data', 'sub', 'history.html', { legacyAdminOnly: true,
        sub: ['tab=rawdata&sub=work', 'tab=rawdata&sub=attendance', 'tab=rawdata&sub=inspection', 'tab=rawdata&sub=leave'] }),
    F('data.reports',  '리포트·경영 지표·결산·마일스톤', 'data', 'sub', 'history.html', { legacyAdminOnly: true, danger: 1,
        sub: ['tab=rawdata&sub=report', 'tab=rawdata&sub=personal', 'tab=rawdata&sub=management', 'tab=settlement', 'tab=milestones'] }),
    F('data.editRecords',    '이력 기록 추가·수정·삭제', 'data', 'func', 'history.html', { legacyAdminOnly: true, danger: 2 }),
    F('data.editAttendance', '출퇴근·근태 수정',         'data', 'func', 'history.html', { legacyAdminOnly: true, danger: 2 }),

    // 로케이션 관리
    F('location.view',       '로케이션 관리 입장',  'location', 'page', 'location.html', { menu: '로케이션 관리' }),
    F('location.refill',     '채우기 지시서(보기·체크·다시 만들기)', 'location', 'func', 'location.html', { danger: 1, rule: 'yes' }),
    F('location.locrec',     '변경 추천(보기·처리 표시·데이터 리스트 반영)', 'location', 'func', 'location.html', { danger: 1, rule: 'yes' }),
    F('location.upload',     '오늘 재고·영구 데이터 업로드',         'location', 'func', 'location.html', { danger: 2, rule: 'yes' }),
    F('location.dataUpload', '직진·주간·주문 분석 업로드, 분석 초기화', 'location', 'func', 'location.html', { danger: 2, rule: 'yes' }),
    F('location.incoming',   '입고 시트 동기화·반영',               'location', 'func', 'location.html', { danger: 1, rule: 'yes' }),
    F('location.bulkEdit',   '일괄 수정·개별 추가·선택 삭제',         'location', 'func', 'location.html', { danger: 2, rule: 'yes' }),
    F('location.settings',   '환경설정(추천·채우기 설정·열·툴팁·시트 주소·2층 용량)', 'location', 'func', 'location.html', { danger: 1, rule: 'yes' }),
    F('location.preassign',  '선지정·해제(모두 해제 포함)',          'location', 'func', 'location.html', { danger: 1, rule: 'partial' }),

    // 그 밖의 페이지
    F('china.mibal',     '중국제작 부족수량 관리',   'china',      'page', 'china-stock-goods.html', { menu: '중국제작 부족수량 관리', danger: 1,
        menuAliases: ['중국제작 미발계산기'] }),   // 화면 용어 변경 2026-10-20 — 기존 계산기 페이지 안 제목은 그대로
    // 신규 단독 운영(live, js/lib/mibal2-mode.js) 때는 이름에서 '시험' 을 뺀다 — 예전 이름은 menuAliases 로 그대로 잇는다
    F('china.mibal2',    MIBAL2_MENU_NAME, 'china', 'page', 'china-mibal2.html', { menu: MIBAL2_MENU_NAME,
        menuAliases: MIBAL2_LIVE ? ['미발계산기(신규·시험)', MIBAL2_TRIAL_MENU_NAME] : ['미발계산기(신규·시험)'] }),
    F('scan.view',       '입고 스캐너',           'scan',       'page', 'scan.html',              { menu: '입고 스캐너', danger: 1 }),
    F('products.view',   '상품 관리',             'products',   'page', 'products.html',          { menu: '상품 관리' }),
    F('supplies.view',   '비품 관리',             'supplies',   'page', 'supplies.html',          { menu: '비품 관리' }),
    F('worktime.view',   '출퇴근 기록표',         'worktime',   'page', 'worktime.html',          { menu: '출퇴근 기록표' }),
    F('calculator.view', '통합 계산기',           'calculator', 'page', 'calculator/index.html',  { menu: '통합 계산기' }),
    F('manual.view',     '업무 매뉴얼',           'manual',     'page', 'manual.html',            { menu: '업무 매뉴얼',
        menuAliases: ['업무 매뉴얼 및 도구'] }),   // 화면 이름 변경 2026-10-21('도구' 기능 삭제) — 저장된 dashboardMenu·memberMenuAccess 의 옛 이름은 그대로

    // 관리자 페이지 — 역할로 나눠 주지 않는다(mainConfig·adminPrivate 규칙이 isAdmin 이다)
    F('admin.view',      '설정·관리',             'admin',      'page', 'admin.html',             { menu: '설정·관리', grantable: false,
        menuAliases: ['관리자 페이지'] })   // 화면 이름 변경 2026-10-21 — 저장된 dashboardMenu·memberMenuAccess 의 옛 이름은 그대로
];

// 대시보드 사이드바의 '동작' 메뉴 이름(menu-catalog.js MENU_TARGETS kind 'action' 과 같아야 한다 — 테스트가 지킨다).
// 이 이름의 메뉴는 링크와 상관없이 **이름으로** 기능에 잇는다(셸도 이 이름이면 링크 대신 ACTION_LINKS 로 간다).
export const ACTION_MENU_NAMES = ['대시보드', '오늘 처리량 입력', '데이터 관리', '내 연차관리', '업무 마감'];

export const FEATURE_BY_ID = Object.fromEntries(FEATURES.map(f => [f.id, f]));
export const ALL_FEATURE_IDS = FEATURES.map(f => f.id);
export const GRANTABLE_IDS = FEATURES.filter(f => f.grantable).map(f => f.id);

/** 예전 기본 메뉴 이름(menuAliases)이고 같은 페이지로 가는 메뉴면 지금 이름, 아니면 null. page = 링크 경로(linkPath). */
export const renamedMenuName = (name, page) => {
    const f = FEATURES.find(x => x.kind === 'page' && x.page === page && Array.isArray(x.menuAliases) && x.menuAliases.includes(name));
    return f ? f.menu : null;
};

export const isFeatureId = (id) => Object.prototype.hasOwnProperty.call(FEATURE_BY_ID, id);
export const featureLabel = (id) => (FEATURE_BY_ID[id] ? FEATURE_BY_ID[id].label : String(id));

/** 페이지 파일 → 그 파일 입장 기능 id(없으면 null). */
export const pageFeatureOf = (file) => {
    const f = FEATURES.find(x => x.kind === 'page' && x.page === file);
    return f ? f.id : null;
};

/** 페이지 입장 기능에 딸린 sub·func 기능 id 들(옛 권한 변환 때 '들어가면 다 할 수 있었다'를 옮긴다). */
export const childFeaturesOf = (pageId) => {
    const p = FEATURE_BY_ID[pageId];
    if (!p || p.kind !== 'page') return [];
    return FEATURES.filter(f => (f.kind === 'sub' || f.kind === 'func') && f.page === p.page).map(f => f.id);
};

// 역할 프리셋(설계 5.1 — 0단계 점검 결과로 확정, 2026-10-19). roleId 는 영문 고정, 이름은 관리 화면에서 바꿀 수 있다.
// 0단계: 재직 일반 9명 전원이 대시보드·중국제작 미발계산기를, 8명이 내 연차관리를 가졌고 매뉴얼·계산기는 0명이었다.
//   → 기본 직원은 '지금 다 가진 것'으로 잡았다(옛 권한에서 넘어올 때 예외가 가장 적고, 아무것도 새로 열리지 않게).
// bot 은 업무예상알림 프로필이 관리자라 지금은 쓰지 않지만 목록에는 남긴다(사용자 결정 8).
const LOCATION_ALL = FEATURES.filter(f => f.group === 'location').map(f => f.id);
const BASIC = ['dash.view', 'dash.leave', 'china.mibal'];
export const PRESET_ROLES = {
    basic:    { name: '기본 직원',         order: 1, features: [...BASIC] },
    refill:   { name: '채우기 담당',       order: 2, features: [...BASIC, 'location.refill'] },
    location: { name: '로케이션 담당',     order: 3, features: [...BASIC, 'dash.quantity', ...LOCATION_ALL] },
    inbound:  { name: '입고·중국 담당',    order: 4, features: [...BASIC, 'scan.view', 'products.view', 'supplies.view'] },
    bot:      { name: '자동화(시스템 계정)', order: 5, features: ['data.view', 'data.forecast'] }
};
export const DEFAULT_ROLE_ID = 'basic';

// 대시보드 '채우기' 업무 카드에서 지시서 창을 열 때 쓰는 업무 이름(6단계). 관리자가 업무 이름을 바꾸면 버튼이 사라진다.
export const REFILL_TASK = '채우기';
// 대시보드 '로케이션 동선관리' 업무 카드의 [변경추천] 버튼(js/locrec-dash.js) — 같은 방식. 업무를 시작해도 창은 저절로 열지 않는다.
export const LOCREC_TASK = '로케이션 동선관리';
