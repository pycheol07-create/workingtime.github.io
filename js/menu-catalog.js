// === js/menu-catalog.js ===
// 대시보드 메뉴 목록을 '저장된 설정 + 코드로 추가된 신규 메뉴'로 합쳐 주는 단일 창구.
//
// 왜 따로 뺐나: 저장된 dashboardMenu(파이어스토어)는 관리자가 마지막으로 저장한 시점의
// 스냅샷이라, 그 뒤에 코드로 추가된 메뉴가 들어 있지 않다. 대시보드 사이드바는
// withBuiltinMenus() 로 이를 보정하고 있었지만 관리자 페이지의 '권한 관리'는
// 저장된 목록을 그대로 써서, 신규 메뉴(중국제작 미발계산기 등)의 권한을 아예
// 선택할 수 없었다. 두 화면이 같은 목록을 보도록 여기로 모은다.
//
// ※ 의존성 없는 순수 모듈로 둘 것. 관리자 페이지(admin-ui.js)가 대시보드 전용
//    모듈(ui.js/state.js)을 끌어오지 않도록 하기 위함이다.

// 코드로 추가된 신규 메뉴 — 저장된 dashboardMenu 에 없으면 자동으로 끼워 넣는다.
// (관리자 설정을 손대지 않아도 메뉴가 바로 보이게 하기 위함)
export const BUILTIN_MENU_ITEMS = [
    { name: '비품 관리', link: 'supplies.html', category: '관리 및 조회' },
    // 로케이션 관리 바로 아래에 (비품 관리 앞)
    { name: '중국제작 미발계산기', link: 'china-stock-goods.html', category: '관리 및 조회', before: '비품 관리' },
    // before: 이 항목 바로 앞에 끼워 넣는다(없으면 맨 뒤)
    { name: '출퇴근 기록표', link: 'worktime.html', category: '관리자 메뉴', before: '업무 마감' }
];

// 메뉴에 걸 수 있는 것 — 관리자 페이지 '메뉴 관리' 의 선택 목록.
//   action : index.html 사이드바에 버튼이 이미 있어 **이름으로** 연결된다(ui-main-dashboard.js 가
//            버튼 글자로 찾는다). 이름이 한 글자라도 다르면 메뉴는 보이지만 눌러도 아무 일이 없다.
//            그래서 관리자 화면에서 고르면 이름을 자동으로 넣고 잠근다.
//   page   : 링크(html 파일)로 열린다. 이름은 자유.
// 새 html 페이지는 여기 적지 않아도 된다 — 배포.py 가 pages.json 을 만들어 목록에 자동으로 붙인다.
// 여기 적는 건 '기본 이름·아이콘' 을 정해 주고 싶을 때뿐이다.
export const MENU_TARGETS = [
    { kind: 'action', name: '대시보드',         link: 'index.html',   icon: '📊' },
    { kind: 'action', name: '오늘 처리량 입력', link: '#',            icon: '📈' },
    { kind: 'action', name: '데이터 관리',      link: 'history.html', icon: '📜' },
    { kind: 'action', name: '주말 근무 신청',   link: '#',            icon: '🗓️' },
    { kind: 'action', name: '내 연차관리',      link: '#',            icon: '🏖️' },
    { kind: 'action', name: '관리자 일정/투두', link: '#',            icon: '📅' },
    { kind: 'action', name: '업무 마감',        link: '#',            icon: '🏁' },
    { kind: 'page', name: '로케이션 관리',       link: 'location.html',          icon: '📍' },
    { kind: 'page', name: '중국제작 미발계산기', link: 'china-stock-goods.html', icon: '🧮' },
    { kind: 'page', name: '비품 관리',           link: 'supplies.html',          icon: '📦' },
    { kind: 'page', name: '출퇴근 기록표',       link: 'worktime.html',          icon: '🕘' },
    { kind: 'page', name: '업무 시트 대시보드',  link: 'sheets.html',            icon: '🗂️' },
    { kind: 'page', name: '업무 매뉴얼 및 도구', link: 'manual.html',            icon: '📖' },
    { kind: 'page', name: '관리자 페이지',       link: 'admin.html',             icon: '⚙️' },
    { kind: 'page', name: '입고 스캐너',         link: 'scan.html',              icon: '📷' }
];

export const isActionMenuName = (name) =>
    MENU_TARGETS.some(t => t.kind === 'action' && t.name === name);

// 메뉴에 걸 페이지가 아닌 것 — pages.json 에 있어도 선택 목록에 띄우지 않는다.
export const HIDDEN_MENU_PAGES = ['china-stock-migrate.html'];   // 1회용 데이터 이관 도구

// 없어진 기능 — 저장된 dashboardMenu 에 남아 있어도 메뉴에서 걷어낸다.
// (관리자 설정을 손대지 않아도 사라지도록. 눌러도 아무 일 없는 항목이 남지 않게)
export const RETIRED_MENU_ITEMS = ['운영 시뮬레이션'];

/** 저장된 메뉴에 신규 메뉴를 채우고 폐기된 메뉴를 걷어낸 목록을 돌려준다.
 *  그룹 객체와 items 배열은 새로 만들지만 항목 객체 자체는 원본과 공유한다(읽기 전용으로 쓸 것).
 *  items 가 없는 그룹은 버리지 않고 빈 배열로 정규화한다 — 그룹을 없애면
 *  그게 신규 메뉴의 목적지 카테고리일 때 엉뚱한 그룹 밑으로 붙는다. */
export const withBuiltinMenus = (dashboardMenu) => {
    const menu = (Array.isArray(dashboardMenu) ? dashboardMenu : [])
        .filter(g => g)
        .map(g => ({
            ...g,
            items: Array.isArray(g.items)
                ? g.items.filter(i => !RETIRED_MENU_ITEMS.includes(i && i.name))
                : []
        }));
    BUILTIN_MENU_ITEMS.forEach(entry => {
        const exists = menu.some(g => g.items.some(i => i && i.link && i.link.includes(entry.link)));
        if (exists) return;
        let group = menu.find(g => g.category === entry.category) || menu[menu.length - 1];
        if (!group) {
            group = { category: entry.category, items: [] };
            menu.push(group);
        }
        const item = { name: entry.name, link: entry.link };
        // before 가 지정돼 있으면 그 항목 앞에 넣는다(메뉴 순서를 코드에서 정할 수 있게)
        const at = entry.before ? group.items.findIndex(i => i && i.name === entry.before) : -1;
        if (at > -1) group.items.splice(at, 0, item);
        else group.items.push(item);
    });
    return menu;
};
