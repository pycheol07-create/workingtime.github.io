// 🔖 화면 상태 기억
// -----------------------------------------------------------------
// 새로고침(F5)해도 보고 있던 탭·항목·날짜로 그대로 돌아오게 한다.
//
// 왜 필요한가: history.html 은 처음 뜰 때 '로우데이터 → 일별 → 첫 날짜 → 대시보드'
// 순서로 고정 클릭하며 화면을 깨운다. 그래서 무엇을 보고 있었든 항상 대시보드로
// 돌아가 버렸다. 그 준비 과정은 그대로 두고, 마지막에 기억해 둔 자리로 되돌린다.
//
// 저장 위치는 sessionStorage — 이 창에서만, 창을 닫으면 사라진다.
// 1c(2026-10-16): 데이터 관리(history.html)는 주소 뒤 해시(js/hash-state.js)에도 적는다 — 해시가 있으면 그것이 먼저다.
//   #tab=메인탭&sub=업무기록 서브탭&gran=일주월년&date=날짜&fview=업무 예상 화면. 옛 #forecast · #forecast-today 도 읽는다.
//   ⚠️ 해시 없이 열면(업무예상알림 봇) 예전과 똑같이 sessionStorage 로만 복원한다.

import { readHash, writeHash, onHashNav } from './hash-state.js?v=202610230833';
import { TREELESS_MAINS, TREELESS_SUBS, sectionIdFor } from './history-sections.js?v=202610230833';
import * as State from './state.js?v=202610230833';

const KEY = 'viewstate:' + (location.pathname.split('/').pop() || 'index');
// 대시보드(index)의 모바일 데이터 관리 모달도 saveView 를 부른다 — 해시는 history.html 에서만 쓴다
const IS_HISTORY_PAGE = (location.pathname.split('/').pop() || '') === 'history.html';

const HASH_TO_VIEW = { tab: 'main', sub: 'sub', gran: 'gran', date: 'dateKey', fview: 'fview' };
/** 해시 → 화면 상태({ main, sub, gran, dateKey, fview }). tab 이 없으면 null. */
function viewFromHash(h) {
    if (!h || !h.tab) return null;
    const v = {};
    for (const [hk, vk] of Object.entries(HASH_TO_VIEW)) if (h[hk]) v[vk] = h[hk];
    return v;
}

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
const hashView = IS_HISTORY_PAGE ? viewFromHash(readHash()) : null;
const initialView = hashView || readView();

// 초기화 클릭이 기억을 덮어쓰지 못하게 하는 잠금.
// 복원이 끝나면 풀린다.
let saveLocked = true;

export function unlockViewSaving() {
    saveLocked = false;
}

// 안전장치: 복원 단계까지 못 갔더라도 언젠가는 다시 기억하기 시작해야 한다.
// (초기화가 중간에 실패하면 잠금이 영원히 안 풀려 아무것도 기억하지 못한다)
// 해시 이동도 같이 풀어 준다(복원이 끝내 안 불리면 기다리던 이동을 여기서 적용).
setTimeout(() => { unlockViewSaving(); finishRestore(); }, 15000);

export function saveView(patch) {
    if (saveLocked) return;
    const next = { ...(readView() || {}), ...patch, at: Date.now() };
    try {
        sessionStorage.setItem(KEY, JSON.stringify(next));
    } catch (e) { /* 못 저장해도 동작에는 지장 없다 */ }
    if (IS_HISTORY_PAGE) writeHash(hashFromView(next), { replace: true });
}

// 화면 상태 → 해시. 지금 화면에 의미 있는 것만(다른 탭의 서브탭·날짜를 끌고 다니지 않게).
function hashFromView(v) {
    if (!v || !v.main) return {};
    const o = { tab: v.main };
    if (v.main === 'rawdata' && v.sub) o.sub = v.sub;
    if (v.main === 'forecast' && v.fview) o.fview = v.fview;
    if (!isTreeless(v)) {
        if (v.gran && v.gran !== 'day') o.gran = v.gran;
        if (v.dateKey) o.date = v.dateKey;
    }
    return o;
}

export function clearView() {
    try { sessionStorage.removeItem(KEY); } catch (e) { }
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

// 날짜 트리를 쓰지 않는 화면들 — 여기서는 날짜를 복원할 것이 없다 (목록은 js/history-sections.js — 물량 추세 예측 포함, H1)
const isTreeless = (v) => TREELESS_MAINS.includes(v.main) || (v.main === 'rawdata' && TREELESS_SUBS.includes(v.sub));

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
        if (!target.classList.contains('is-on')) target.click();
        await wait(350);
        if (sel()?.classList.contains('is-on')) return true;
    }
    return false;
}

// 데이터관리(history.html) 화면을 기억해 둔 자리로 되돌린다.
// 초기 렌더링이 끝난 뒤에 부른다.
export async function restoreHistoryView() {
    // 지금 저장소가 아니라, 화면이 뜨기 전에 붙잡아 둔 값을 쓴다.
    // 주소 뒤 해시(대시보드 '오늘 진행' 띠·Ctrl+K·공유한 주소)가 있으면 그것이 기억해 둔 자리보다 먼저다.
    // 화면이 뜨는 동안 해시가 또 바뀌었으면(사용자가 Ctrl+K 로 고름) 그것이 가장 먼저다.
    const pend = takePending();
    const v = pend || initialView;
    // 14개 화면에 없는 탭(낡은 주소 #tab=work 등)은 복원하지 않는다 → history.html 이 '요약' 을 연다
    if (!v || !v.main || !sectionIdFor(v.main, v.sub)) {
        unlockViewSaving();
        finishRestore();
        return false;          // history.html 이 대시보드 탭을 누른다(그 클릭이 저장소·주소를 맞춘다)
    }

    await applyView(v, { resetGran: !!pend });

    // 여기서부터는 사용자의 진짜 클릭이므로 다시 기억하기 시작한다
    unlockViewSaving();
    // 출처(해시·저장소)와 상관없이 실제로 열린 자리로 저장소·주소를 맞춘다(옛 #forecast-today 도 새 형식으로 바뀐다)
    syncToScreen();
    finishRestore();
    return true;
}

// 지금 화면에 실제로 열린 자리 — 탭 상태는 State.context, 업무 예상 화면·날짜는 화면에서 읽는다.
function currentView() {
    const c = State.context || {};
    const fb = [...document.querySelectorAll('.forecast-view-btn')].find(b => b.classList.contains('bg-indigo-600'));
    const db = document.querySelector('.history-date-btn.is-on');
    return {
        main: c.activeHistoryView || undefined,
        sub: c.activeMainHistoryTab || undefined,
        gran: c.globalGranularity || undefined,
        dateKey: (db && db.dataset.key) || undefined,
        fview: (fb && fb.dataset.fview) || undefined
    };
}
function syncToScreen() {
    if (!IS_HISTORY_PAGE) return;
    const cur = currentView();
    if (cur.main) saveView(cur);   // 없는 값은 undefined 로 덮어 옛 기억이 섞이지 않게
}

// 같은 화면 안에서 해시가 바뀌면(Ctrl+K 빠른 이동·뒤로가기) 그 자리로 다시 맞춘다.
// 모듈이 뜰 때 바로 건다. 처음 복원이 끝나기 전에 온 이동은 표시만 해 두었다가 복원 때(또는 끝난 뒤) 적용한다
// — 복원이 사용자가 고른 해시를 덮지 않게.
let restoreDone = false;
let pendingHash = null;
// tab 이 없거나 모르는 탭인 주소(뒤로가기·낡은 주소)는 첫 화면(요약)
const viewForNav = (h) => { const v = viewFromHash(h); return v && sectionIdFor(v.main, v.sub) ? v : { main: 'dashboard' }; };
function takePending() {
    const h = pendingHash; pendingHash = null;
    return h ? viewForNav(h) : null;
}
function navTo(v) {
    applyView(v, { resetGran: true }).catch(e => console.error('화면 이동 실패:', e));
}
function finishRestore() {
    if (restoreDone) return;
    restoreDone = true;
    const v = takePending();
    if (v) navTo(v);
}
if (IS_HISTORY_PAGE) {
    onHashNav((h) => {
        if (!restoreDone) { pendingHash = h; return; }
        navTo(viewForNav(h));
    });
}

// 화면 상태 v 로 탭·날짜를 차례로 누른다(처음 복원·해시 이동 공용).
// resetGran: 해시 이동 — 해시에 gran 이 없으면 '일' 이다(처음 복원은 화면이 이미 '일' 로 떠 있다).
async function applyView(v, { resetGran = false } = {}) {
    // 1) 기간 단위 — 날짜 목록이 이 단위로 다시 그려진다
    const gran = v.gran || (resetGran && !isTreeless(v) ? 'day' : '');
    if (gran && (gran !== 'day' || resetGran)) {
        document.querySelector(`.history-gran-btn[data-granularity="${esc(gran)}"]`)?.click();
        await wait(250);
    }

    // 2·3) 화면(좌측 레일 항목) — 메인탭과 업무 기록 서브탭을 한 번에 연다(UI 2단계 H2, js/history-sections.js).
    //    날짜보다 먼저 연다. 날짜 클릭은 '지금 어느 화면인지' 를 보고 그릴 것을 정하기 때문이다.
    //    #tab=rawdata 처럼 서브탭이 없으면 지금 서브탭(처음이면 업무 이력).
    const sid = sectionIdFor(v.main, v.sub, State.context && State.context.activeMainHistoryTab);
    if (sid) document.querySelector(`#history-section-nav .pn-item[data-pn-id="${esc(sid)}"]`)?.click();
    await wait(300);

    // 3-1) 업무 예상의 세 화면(오늘 현황 / 계획 / 정확도) — 탭이 열리며 기본 화면을 그린 뒤에 누른다
    if (v.main === 'forecast' && v.fview) {
        await wait(150);
        document.querySelector(`.forecast-view-btn[data-fview="${esc(v.fview)}"]`)?.click();
    }

    // 4) 날짜는 맨 마지막에.
    //    앞의 단계들이 날짜 목록을 다시 그리며 선택을 되돌리기 때문이다.
    if (v.dateKey && !isTreeless(v)) await selectDate(v.dateKey);
}
