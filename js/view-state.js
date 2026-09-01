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

export function saveView(patch) {
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

// 데이터관리(history.html) 화면을 기억해 둔 자리로 되돌린다.
// 초기 렌더링이 끝난 뒤에 부른다.
export async function restoreHistoryView() {
    const v = readView();
    if (!v || !v.main) return false;

    // 1) 기간 단위 — 날짜 목록이 이 단위로 다시 그려진다
    if (v.gran && v.gran !== 'day') {
        document.querySelector(`.history-gran-btn[data-granularity="${esc(v.gran)}"]`)?.click();
        await wait(250);
    }

    // 2) 보고 있던 날짜 (목록이 다시 그려질 때까지 기다린다)
    if (v.dateKey) {
        const btn = await until(() =>
            document.querySelector(`.history-date-btn[data-key="${esc(v.dateKey)}"]`), 3000);
        if (btn && !btn.classList.contains('bg-blue-100')) {
            btn.click();
            await wait(200);
        }
    }

    // 3) 로우데이터 안의 서브탭 (업무기록 / 근태현황 / 경영지표 …)
    if (v.sub) {
        document.querySelector(`.rawdata-sub-tab-btn[data-sub-tab="${esc(v.sub)}"]`)?.click();
        await wait(150);
    }

    // 4) 메인 탭 — 마지막에 눌러야 해당 패널이 최종적으로 보인다
    document.querySelector(`[data-main-tab="${esc(v.main)}"]`)?.click();
    return true;
}
