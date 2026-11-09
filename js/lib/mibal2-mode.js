// === js/lib/mibal2-mode.js ===
// 신규 부족수량관리(china-mibal2.html) 단독 운영(live) 스위치 — 순수 모듈(DOM/Firebase 없음). 2026-10-28.
//
// MIBAL2_LIVE = false 인 동안(지금)은 신규 화면이 읽기 전용(시험)이고, 기존 화면(china-stock-goods.html)이 스캐너 자료를 맡는다.
// 시작일에 이 상수를 true 로 바꿔 배포한다(앱 안 스위치·설정 문서 없음). live 여도 기존 화면은 열리고 조회만 된다(js/china-stock-goods.js OLD_READ_ONLY).
// 기존 화면을 아예 신규로 넘기는 것(china-stock-version.json oldRetired:true)은 별도 지시가 있을 때 따로 한다.
// 메뉴(js/menu-catalog.js·js/app-shell-data.js·js/lib/feature-catalog.js·js/config.js)는 이 상수만 본다.
//
// 에뮬레이터 시험 덮어쓰기: 주소가 localhost/127.0.0.1 이고 ?emu=1&live=1 일 때만 신규 화면이 live 로 돈다(tools/mibal2-live-check.py).
//   운영 주소(GitHub Pages)에서는 어떤 경우에도 덮어쓰지 않는다. tests/mibal2-readonly.test.js 가 본다.

export const MIBAL2_LIVE = true;

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * live 인가. constant 가 true 면 true. 아니면 loc(location 모양 {hostname, search})이
 * 로컬 주소 + ?emu=1&live=1 일 때만 true(에뮬레이터 시험 전용).
 */
export function liveFrom(loc, constant = MIBAL2_LIVE) {
    if (constant === true) return true;
    try {
        if (!loc || !LOCAL_HOSTS.has(String(loc.hostname || ''))) return false;
        const q = new URLSearchParams(String(loc.search || ''));
        return q.get('emu') === '1' && q.get('live') === '1';
    } catch (e) {
        return false;
    }
}

// 메뉴 이름 — live 면 신규는 '(신규)', 기존은 '(미사용)'(숨기지 않고 뒤에 보임 — js/menu-catalog.js arrangeMibal2Menu). 예전 이름은 기능 카탈로그 menuAliases 로 잇는다.
export const MIBAL2_TRIAL_MENU_NAME = '중국제작 부족수량 관리(신규·시험)';
export const MIBAL2_LIVE_MENU_NAME = '중국제작 부족수량 관리(신규)';
export const MIBAL2_MENU_NAME = MIBAL2_LIVE ? MIBAL2_LIVE_MENU_NAME : MIBAL2_TRIAL_MENU_NAME;
export const MIBAL2_OLD_PLAIN_MENU_NAME = '중국제작 부족수량 관리';
export const MIBAL2_OLD_RETIRED_MENU_NAME = '중국제작 부족수량 관리(미사용)';
export const MIBAL2_OLD_MENU_NAME = MIBAL2_LIVE ? MIBAL2_OLD_RETIRED_MENU_NAME : MIBAL2_OLD_PLAIN_MENU_NAME;

/** 이 페이지가 live 인가(브라우저 location 기준) */
export const isMibal2Live = () => liveFrom(typeof location !== 'undefined' ? location : null);
