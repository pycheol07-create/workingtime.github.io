// === js/admin-automation.js ===
// 관리자 페이지 '자동화 상태' 탭 — 읽기 전용.
//
// 자동화감시(앱\자동화감시\감시.py --기록)가 10분마다 쓰는 adminPrivate/automationStatus 를 보여 준다.
// 이 모듈은 **쓰지 않는다.** adminPrivate 는 규칙상 관리자만 읽는다(비관리자는 permission-denied).
//
// ★ 탭을 처음 열 때만 구독한다(읽기량 절약). 그 뒤 다른 탭으로 가도 구독은 유지하고, 다시 구독하지 않는다.
// ★ 화면은 state 기준이다 — ok 필드로 판단하지 않는다.
//   감시자는 off(판정 시간 아님)도 ok=true 로 쓴다. ok 로 칠하면 '쉼' 과 '정상' 이 구분되지 않는다.
// ⚠️ onSnapshot 만으로는 'N분 전' 이 흐르지 않는다(문서가 안 바뀌면 콜백이 없다) → 1분마다 다시 그린다.
// 원문 문자열은 전부 textContent 로 넣는다(innerHTML 에 원문 금지).

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const SECTION_ID = 'section-automation';
const 문서경로 = ['adminPrivate', 'automationStatus'];

const 감시_경고_분 = 30;          // 감시 마지막 확인이 이보다 오래되면 빨강
const 클라우드_경고_분 = 120;     // 클라우드 확인이 이보다 오래되면 노랑

// 정렬 순서: 문제 → 정상 → 쉼
const 정렬순서 = ['fail', 'late', 'unknown', 'disabled', 'running', 'ok', 'off'];

const 배지 = {
    ok:       { 글: '정상',   색: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300' },
    running:  { 글: '실행 중', 색: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300' },
    off:      { 글: '쉼',     색: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
    disabled: { 글: '꺼짐',   색: 'bg-gray-200 text-gray-700 dark:bg-gray-600 dark:text-gray-200' },
    late:     { 글: '지연',   색: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300' },
    fail:     { 글: '실패',   색: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300' },
    unknown:  { 글: '모름',   색: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
};

let 시작됨 = false;
let unsub = null;
let 타이머 = null;
// { 상태: 'loading'|'data'|'missing'|'denied'|'error', 데이터, 오류코드 }
let 현재 = { 상태: 'loading' };

/** Firestore Timestamp | ISO 문자열 | Date → ms (못 읽으면 null) */
const 밀리초 = (v) => {
    if (!v) return null;
    try {
        if (typeof v.toMillis === 'function') return v.toMillis();
        if (typeof v.seconds === 'number') return v.seconds * 1000;
        const t = new Date(v).getTime();
        return Number.isFinite(t) ? t : null;
    } catch (e) { return null; }
};

/** 지난 분(음수는 0 — 쓰는 PC 와 보는 PC 의 시계가 다를 수 있다) */
const 경과분 = (ms) => (ms == null ? null : Math.max(0, (Date.now() - ms) / 60000));

const 전표기 = (분) => {
    if (분 == null) return '-';
    if (분 < 1) return '방금';
    if (분 < 60) return `${Math.floor(분)}분 전`;
    if (분 < 60 * 24) return `${Math.floor(분 / 60)}시간 전`;
    return `${Math.floor(분 / 60 / 24)}일 전`;
};

const 시각표기 = (ms) => {
    if (ms == null) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const 주기표기 = (min) => {
    const n = Number(min);
    if (min == null || !Number.isFinite(n) || n <= 0) return '-';
    if (n >= 60 && n % 60 === 0) return `${n / 60}시간마다`;
    return `${n}분마다`;
};

const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = String(text);
    return e;
};

const 안내 = (box, 글, 색 = 'text-gray-500 dark:text-gray-400') => {
    box.replaceChildren(el('p', `text-sm ${색} p-4`, 글));
};

function 머리그리기(head) {
    head.replaceChildren();
    if (현재.상태 !== 'data') return;
    const d = 현재.데이터 || {};

    const 감시ms = 밀리초(d.updatedAt);
    const 감시분 = 경과분(감시ms);
    const 감시줄 = el('div', 'text-sm font-semibold');
    if (감시분 == null) {
        감시줄.className += ' text-red-600 dark:text-red-400';
        감시줄.textContent = '감시 마지막 확인 시각 없음 — PC·감시가 멈췄을 수 있음';
    } else if (감시분 > 감시_경고_분) {
        감시줄.className += ' text-red-600 dark:text-red-400';
        감시줄.textContent = `감시 마지막 확인 ${전표기(감시분)} — PC·감시가 멈췄을 수 있음`;
    } else {
        감시줄.className += ' text-gray-700 dark:text-gray-300';
        감시줄.textContent = `감시 마지막 확인 ${전표기(감시분)}`;
    }
    if (감시ms != null) 감시줄.title = 시각표기(감시ms);
    head.appendChild(감시줄);

    if (d.cloudCheckedAt) {
        const 클ms = 밀리초(d.cloudCheckedAt);
        const 클분 = 경과분(클ms);
        const 클줄 = el('div', 'text-sm mt-1');
        if (클분 != null && 클분 > 클라우드_경고_분) {
            클줄.className += ' text-yellow-700 dark:text-yellow-400 font-semibold';
        } else {
            클줄.className += ' text-gray-500 dark:text-gray-400';
        }
        클줄.textContent = `클라우드 확인 ${전표기(클분)}`;
        if (클ms != null) 클줄.title = 시각표기(클ms);
        head.appendChild(클줄);
    }
}

function 표그리기(body) {
    if (현재.상태 === 'loading') { 안내(body, '불러오는 중…'); return; }
    if (현재.상태 === 'denied') {
        안내(body, '볼 권한이 없습니다. 자동화 상태는 관리자 계정만 볼 수 있습니다(권한 관리에서 관리자인지 확인).', 'text-red-600 dark:text-red-400');
        return;
    }
    if (현재.상태 === 'missing') {
        안내(body, '아직 기록이 없습니다. 자동화감시(앱\\자동화감시)의 --기록 이 한 번도 돌지 않았을 수 있습니다.');
        return;
    }
    if (현재.상태 === 'error') {
        안내(body, `불러오지 못했습니다 (${현재.오류코드 || '알 수 없는 오류'}). 새로고침해 보세요.`, 'text-red-600 dark:text-red-400');
        return;
    }

    const items = (현재.데이터 && 현재.데이터.items) || {};
    const 행들 = Object.keys(items).map((key) => {
        const it = items[key] || {};
        const state = 배지[it.state] ? it.state : 'unknown';
        return { key, it, state };
    });
    if (행들.length === 0) { 안내(body, '감시 대상 항목이 없습니다.'); return; }

    행들.sort((a, b) => {
        const d = 정렬순서.indexOf(a.state) - 정렬순서.indexOf(b.state);
        if (d !== 0) return d;
        const c = (b.it.critical ? 1 : 0) - (a.it.critical ? 1 : 0);
        if (c !== 0) return c;
        return String(a.it.name || a.key).localeCompare(String(b.it.name || b.key), 'ko');
    });

    const wrap = el('div', 'overflow-x-auto w-full');
    const table = el('table', 'w-full text-sm text-left');
    const thead = el('thead', 'text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700');
    const htr = el('tr');
    ['이름', '상태', '마지막 성공', '기준', '사유'].forEach((h) => htr.appendChild(el('th', 'px-3 py-2 font-semibold whitespace-nowrap', h)));
    thead.appendChild(htr);
    table.appendChild(thead);

    const tbody = el('tbody', 'divide-y divide-gray-100 dark:divide-gray-700');
    행들.forEach(({ key, it, state }) => {
        const tr = el('tr', 'hover:bg-gray-50 dark:hover:bg-gray-700/40');

        const tdName = el('td', 'px-3 py-2 font-medium text-gray-800 dark:text-gray-200 whitespace-nowrap');
        if (it.critical) {
            const star = el('span', 'text-yellow-500 mr-1', '★');
            star.title = '즉시알림 대상';
            tdName.appendChild(star);
        }
        tdName.appendChild(document.createTextNode(String(it.name || key)));
        tr.appendChild(tdName);

        const tdState = el('td', 'px-3 py-2 whitespace-nowrap');
        const b = 배지[state];
        const 주의 = state === 'ok' && String(it.msg || '').includes('주의');
        tdState.appendChild(el('span', `inline-block px-2 py-0.5 rounded-full text-xs font-bold ${b.색}`, 주의 ? `${b.글}·주의` : b.글));
        tr.appendChild(tdState);

        const okMs = 밀리초(it.lastOkAt);
        const tdOk = el('td', 'px-3 py-2 whitespace-nowrap text-gray-700 dark:text-gray-300', 전표기(경과분(okMs)));
        if (okMs != null) tdOk.title = 시각표기(okMs);
        tr.appendChild(tdOk);

        tr.appendChild(el('td', 'px-3 py-2 whitespace-nowrap text-gray-500 dark:text-gray-400', 주기표기(it.expectEveryMin)));
        tr.appendChild(el('td', 'px-3 py-2 text-gray-600 dark:text-gray-400 break-all', it.msg || ''));

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    body.replaceChildren(wrap);
}

function 그리기() {
    const head = document.getElementById('automation-status-head');
    const body = document.getElementById('automation-status-body');
    if (head) 머리그리기(head);
    if (body) 표그리기(body);
}

function 구독(db) {
    if (unsub) return;
    try {
        unsub = onSnapshot(doc(db, ...문서경로), (snap) => {
            현재 = snap.exists() ? { 상태: 'data', 데이터: snap.data() || {} } : { 상태: 'missing' };
            그리기();
        }, (e) => {
            const code = (e && e.code) || '';
            console.warn('[자동화 상태] 구독 실패:', code || e);
            현재 = code === 'permission-denied' ? { 상태: 'denied' } : { 상태: 'error', 오류코드: code };
            // 오류가 나면 SDK 가 리스너를 끊는다. 다음에 다시 열 수 있게 비운다.
            unsub = null;
            시작됨 = false;
            그리기();
        });
    } catch (e) {
        console.warn('[자동화 상태] 구독을 시작하지 못했습니다:', e);
        현재 = { 상태: 'error', 오류코드: (e && e.code) || '' };
        시작됨 = false;
        그리기();
    }
}

function 시작() {
    if (시작됨) return;
    // 비관리자는 admin.js 가 #admin-content 를 '접근 권한 없음' 으로 바꿔 이 섹션이 없다 → 구독하지 않는다.
    if (!document.getElementById(SECTION_ID)) return;
    시작됨 = true;
    현재 = { 상태: 'loading' };
    그리기();

    let app;
    try {
        app = getApp();   // admin.js 가 initializeFirebase 로 이미 만든 앱을 쓴다(두 번 만들면 duplicate-app)
    } catch (e) {
        console.warn('[자동화 상태] Firebase 앱이 아직 없습니다:', e);
        현재 = { 상태: 'error', 오류코드: 'no-app' };
        시작됨 = false;
        그리기();
        return;
    }
    const db = getFirestore(app);
    const auth = getAuth(app);

    // 로그인 확인 전에 탭을 누르면 permission-denied 로 끝나므로, 로그인된 뒤에 한 번만 구독한다.
    if (auth.currentUser) { 구독(db); }
    else {
        const off = onAuthStateChanged(auth, (user) => {
            if (!user) return;
            off();
            구독(db);
        });
    }

    if (!타이머) {
        타이머 = setInterval(그리기, 60000);
        // 탭이 백그라운드면 타이머가 늦춰진다. 돌아올 때 즉시 맞춘다.
        document.addEventListener('visibilitychange', () => { if (!document.hidden) 그리기(); });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll(`.admin-tab-btn[data-target="${SECTION_ID}"]`).forEach((btn) => {
        btn.addEventListener('click', 시작);
    });
    const mobileSelect = document.getElementById('mobile-tab-select');
    if (mobileSelect) {
        mobileSelect.addEventListener('change', (e) => { if (e.target.value === SECTION_ID) 시작(); });
    }
});
