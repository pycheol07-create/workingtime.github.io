// 🔖 화면 상태 기억
// -----------------------------------------------------------------
// 새로고침(F5)해도, 저장 후 자동 새로고침이 되어도
// 보고 있던 탭·항목·날짜로 그대로 돌아오게 한다.
//
// 왜 필요한가: history.html 은 처음 뜰 때 '로우데이터 → 일별 → 첫 날짜 → 대시보드'
// 순서로 고정 클릭하며 화면을 깨운다. 그래서 무엇을 보고 있었든 항상 대시보드로
// 돌아가 버렸다. 그 준비 과정은 그대로 두고, 마지막에 기억해 둔 자리로 되돌린다.
//
// 저장 위치는 sessionStorage — 이 창에서만, 창을 닫으면 사라진다.

const KEY = 'viewstate:' + (location.pathname.split('/').pop() || 'index');

export function readView() {
    try {
        return JSON.parse(sessionStorage.getItem(KEY) || 'null');
    } catch (e) {
        return null;      // 사생활 보호 모드 등에서 막히면 그냥 기억하지 않는다
    }
}

// 이 모듈이 처음 불러와지는 시점의 값을 붙잡아 둔다.
// 화면이 뜰 때 초기화 과정이 탭·날짜를 프로그램적으로 클릭하는데,
// 그 클릭도 saveView 를 부르기 때문에 기억해 둔 값이 지워져 버린다.
// (실제로 그래서 새로고침하면 늘 '업무기록및관리'로 돌아갔다)
const initialView = readView();

// 초기화 클릭이 기억을 덮어쓰지 못하게 하는 잠금.
// 복원이 끝나면 풀린다.
let saveLocked = true;

export function unlockViewSaving() {
    saveLocked = false;
}

// 안전장치: 복원 단계까지 못 갔더라도 언젠가는 다시 기억하기 시작해야 한다.
// (초기화가 중간에 실패하면 잠금이 영원히 안 풀려 아무것도 기억하지 못한다)
setTimeout(unlockViewSaving, 15000);

export function saveView(patch) {
    if (saveLocked) return;
    try {
        sessionStorage.setItem(KEY, JSON.stringify({ ...(readView() || {}), ...patch, at: Date.now() }));
    } catch (e) { /* 못 저장해도 동작에는 지장 없다 */ }
}

export function clearView() {
    try { sessionStorage.removeItem(KEY); } catch (e) { }
}

// 새로고침해서는 안 되는 화면.
// 메인 대시보드는 진행 중인 업무 타이머가 도는 작업 화면이라,
// 저장할 때마다 새로고침하면 오히려 일을 방해한다.
// (같은 저장 함수를 메인 화면과 데이터관리 창이 함께 쓰는 곳이 있다)
const NO_RELOAD_PAGES = ['index.html', ''];

export function canReload() {
    return !NO_RELOAD_PAGES.includes(location.pathname.split('/').pop() || '');
}

// 저장 직후 새로고침해서 '정말 저장됐는지' 눈으로 확인할 수 있게 한다.
// 토스트를 읽을 시간을 잠깐 준 뒤 새로고침한다.
export function reloadAfterSave(delay = 900) {
    if (!canReload()) return;
    setTimeout(() => location.reload(), delay);
}

const wait = (ms) => new Promise(r => setTimeout(r, ms));

// 조건이 참이 될 때까지 기다린다(최대 timeout). 화면이 비동기로 그려지기 때문에 필요하다.
async function until(fn, timeout = 3000, step = 60) {
    const limit = Date.now() + timeout;
    while (Date.now() < limit) {
        const got = fn();
        if (got) return got;
        await wait(step);
    }
    return null;
}

const esc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/"/g, '\\"');

// 날짜 트리를 쓰지 않는 화면들 — 여기서는 날짜를 복원할 것이 없다
const TREELESS_SUBS = ['inspection', 'leave', 'weekend'];
const TREELESS_MAINS = ['milestones', 'settlement', 'forecast'];

// 날짜를 고른다.
// 분석 탭은 열릴 때 날짜 목록을 다시 그리면서 '가장 최근 날짜'를 자동으로 눌러 버린다.
// 우리가 먼저 눌러도 그 자동 선택에 덮인다. 그래서 눌러 놓고 실제로 유지되는지
// 확인한 뒤, 밀렸으면 다시 누른다.
async function selectDate(dateKey) {
    const sel = () => document.querySelector(`.history-date-btn[data-key="${esc(dateKey)}"]`);
    const btn = await until(sel, 4000);
    if (!btn) return false;

    for (let i = 0; i < 3; i++) {
        const target = sel();
        if (!target) return false;
        if (!target.classList.contains('bg-blue-100')) target.click();
        await wait(350);
        if (sel()?.classList.contains('bg-blue-100')) return true;
    }
    return false;
}

// 데이터관리(history.html) 화면을 기억해 둔 자리로 되돌린다.
// 초기 렌더링이 끝난 뒤에 부른다.
export async function restoreHistoryView() {
    // 지금 저장소가 아니라, 화면이 뜨기 전에 붙잡아 둔 값을 쓴다
    const v = initialView;
    if (!v || !v.main) {
        unlockViewSaving();
        return false;
    }

    // 1) 기간 단위 — 날짜 목록이 이 단위로 다시 그려진다
    if (v.gran && v.gran !== 'day') {
        document.querySelector(`.history-gran-btn[data-granularity="${esc(v.gran)}"]`)?.click();
        await wait(250);
    }

    // 2) 로우데이터 안의 서브탭 (업무기록 / 근태현황 / 경영지표 …)
    //    날짜보다 먼저 눌러야 한다. 날짜 클릭은 '지금 어느 서브탭인지' 를 보고
    //    그릴 화면을 정하기 때문에, 순서가 반대면 엉뚱한 화면이 그려진다.
    if (v.main === 'rawdata' && v.sub) {
        document.querySelector(`.rawdata-sub-tab-btn[data-sub-tab="${esc(v.sub)}"]`)?.click();
        await wait(200);
    }

    // 3) 메인 탭
    document.querySelector(`[data-main-tab="${esc(v.main)}"]`)?.click();
    await wait(300);

    // 4) 날짜는 맨 마지막에.
    //    앞의 단계들이 날짜 목록을 다시 그리며 선택을 되돌리기 때문이다.
    const noTree = TREELESS_MAINS.includes(v.main)
        || (v.main === 'rawdata' && TREELESS_SUBS.includes(v.sub));
    if (v.dateKey && !noTree) await selectDate(v.dateKey);

    // 여기서부터는 사용자의 진짜 클릭이므로 다시 기억하기 시작한다
    unlockViewSaving();
    return true;
}
