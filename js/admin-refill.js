// === js/admin-refill.js ===
// 관리자 페이지 '채우기 설정' 탭 — adminPrivate/refillSettings 를 읽고 쓴다. (2026-10-08)
//
// 앱\채우기자동화\채우기.py 가 매일 아침 이 문서를 읽어 채우기 지시서 기준을 정한다(규칙.py parse_settings).
//   enabled(bool) · pct(정수 0~100) · minQty(정수 0~999) · days(정수 배열 0=월 … 6=일) · skipHolidays(bool)
//   · updatedAt(serverTimestamp) · updatedBy(이메일 소문자)
//   기준 = max(floor(적재량 × pct / 100), minQty) — 남는양이 이 이하이면 채운다.
// ⚠️ 이름·범위를 바꾸면 채우기자동화\규칙.py 의 parse_settings 도 바꿀 것(값이 이상하면 그쪽은 기본값을 쓴다).
// adminPrivate 는 규칙상 관리자만 읽고 쓴다(비관리자는 permission-denied) — 규칙 변경 없음.
//
// ★ '전체 저장' 대상이 아니다. 이 탭의 [저장] 버튼만 setDoc(merge) 로 쓴다.
// ★ 탭을 처음 열 때 한 번 읽는다(getDoc). 비관리자는 admin.js 가 #admin-content 를 바꿔 이 섹션이 없다.
// 원문 문자열은 textContent 로만 넣는다.

import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const SECTION_ID = 'section-refill';
const 문서경로 = ['adminPrivate', 'refillSettings'];
const 기본값 = Object.freeze({ enabled: true, pct: 30, minQty: 3, days: [0, 1, 2, 3, 4], skipHolidays: true });
const 예시적재량 = 20;

let 시작됨 = false;
let db = null;
let auth = null;
let 불러옴 = false;

const $ = (id) => document.getElementById(id);
const 입력들 = () => [$('refill-enabled'), $('refill-pct'), $('refill-minqty'), $('refill-skip-holidays'),
    ...document.querySelectorAll('.refill-day'), $('refill-save-btn')].filter(Boolean);

function 상태(글, 종류 = 'info') {
    const box = $('refill-status');
    if (!box) return;
    const 색 = {
        info: 'text-gray-500 dark:text-gray-400',
        ok: 'text-green-700 dark:text-green-400',
        warn: 'text-yellow-700 dark:text-yellow-400',
        error: 'text-red-600 dark:text-red-400',
    }[종류] || '';
    box.className = `text-sm mb-4 ${색}`;
    box.textContent = 글;
}

const 정수 = (v, lo, hi) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi);

/** 저장된 문서 → 화면 값. 이상한 칸은 기본값(규칙.py parse_settings 와 같은 기준). → { 값, 이상: [칸이름] } */
function 정리(d) {
    const 값 = { ...기본값, days: [...기본값.days] };
    const 이상 = [];
    if (typeof d.enabled === 'boolean') 값.enabled = d.enabled; else 이상.push('사용');
    if (typeof d.skipHolidays === 'boolean') 값.skipHolidays = d.skipHolidays; else 이상.push('공휴일 제외');
    if (정수(d.pct, 0, 100)) 값.pct = d.pct; else 이상.push('적재량 %');
    if (정수(d.minQty, 0, 999)) 값.minQty = d.minQty; else 이상.push('최소 개수');
    if (Array.isArray(d.days) && d.days.length > 0 && d.days.every((x) => 정수(x, 0, 6))) {
        값.days = [...new Set(d.days)].sort((a, b) => a - b);
    } else 이상.push('요일');
    return { 값, 이상 };
}

function 화면에(s) {
    $('refill-enabled').checked = !!s.enabled;
    $('refill-pct').value = String(s.pct);
    $('refill-minqty').value = String(s.minQty);
    $('refill-skip-holidays').checked = !!s.skipHolidays;
    document.querySelectorAll('.refill-day').forEach((cb) => { cb.checked = s.days.includes(Number(cb.value)); });
}

const 숫자칸 = (el) => (el.value.trim() === '' ? NaN : Number(el.value));

function 화면에서() {
    return {
        enabled: $('refill-enabled').checked,
        pct: 숫자칸($('refill-pct')),
        minQty: 숫자칸($('refill-minqty')),
        days: [...document.querySelectorAll('.refill-day')].filter((cb) => cb.checked).map((cb) => Number(cb.value)).sort((a, b) => a - b),
        skipHolidays: $('refill-skip-holidays').checked,
    };
}

/** 문제 문장 또는 null */
function 검증(s) {
    if (!정수(s.pct, 0, 100)) return '적재량 %는 0~100 사이 정수로 넣어 주세요.';
    if (!정수(s.minQty, 0, 999)) return '최소 개수는 0~999 사이 정수로 넣어 주세요.';
    if (s.days.length === 0) return '요일을 하나 이상 고르세요. 보내지 않으려면 \'지시서 보내기\' 를 끄세요.';
    return null;
}

function 예시갱신() {
    const box = $('refill-example');
    if (!box) return;
    const s = 화면에서();
    if (!(정수(s.pct, 0, 100) && 정수(s.minQty, 0, 999))) { box.textContent = ''; return; }
    const 기준 = Math.max(Math.floor((예시적재량 * s.pct) / 100), s.minQty);
    box.textContent = `예) 적재량 ${예시적재량} 이면 남는양 ${기준}개 이하일 때 채움 (비축재고가 있을 때만)`;
}

const 시각표기 = (v) => {
    try {
        const ms = v && typeof v.toMillis === 'function' ? v.toMillis() : null;
        if (ms == null) return '';
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    } catch (e) { return ''; }
};

function 메타(d) {
    const box = $('refill-meta');
    if (!box) return;
    const t = 시각표기(d && d.updatedAt);
    box.textContent = t ? `마지막 저장 ${t}${d.updatedBy ? ` · ${d.updatedBy}` : ''}` : '';
}

async function 불러오기() {
    상태('불러오는 중…');
    try {
        const snap = await getDoc(doc(db, ...문서경로));
        if (snap.exists()) {
            const d = snap.data() || {};
            const { 값, 이상 } = 정리(d);
            화면에(값);
            메타(d);
            if (이상.length) 상태(`저장된 값 중 ${이상.join('·')} 이(가) 이상해 기본값을 보여 줍니다. 확인 후 저장하세요.`, 'warn');
            else 상태('저장된 설정입니다. 바꾼 뒤 [저장] 을 누르면 다음 지시서부터 적용됩니다.');
        } else {
            화면에(기본값);
            메타(null);
            상태('아직 저장된 설정이 없어 기본값을 보여 줍니다(자동화도 이 기본값을 씁니다). [저장] 을 누르면 문서가 생깁니다.', 'warn');
        }
        불러옴 = true;
        입력들().forEach((el) => { el.disabled = false; });
        예시갱신();
    } catch (e) {
        const code = (e && e.code) || '';
        console.warn('[채우기 설정] 불러오기 실패:', code || e);
        상태(code === 'permission-denied'
            ? '볼 권한이 없습니다. 채우기 설정은 관리자 계정만 볼 수 있습니다(권한 관리에서 관리자인지 확인).'
            : `불러오지 못했습니다 (${code || '알 수 없는 오류'}). 새로고침해 보세요.`, 'error');
        시작됨 = false;   // 다음에 탭을 다시 열면 재시도
    }
}

async function 저장() {
    if (!db || !불러옴) return;
    const s = 화면에서();
    const 문제 = 검증(s);
    if (문제) { 상태(문제, 'error'); return; }
    const btn = $('refill-save-btn');
    if (btn) btn.disabled = true;
    상태('저장 중…');
    try {
        const email = String((auth && auth.currentUser && auth.currentUser.email) || '').toLowerCase();
        await setDoc(doc(db, ...문서경로), {
            enabled: s.enabled, pct: s.pct, minQty: s.minQty, days: s.days, skipHolidays: s.skipHolidays,
            updatedAt: serverTimestamp(), updatedBy: email,
        }, { merge: true });
        상태('저장했습니다 — 다음 지시서부터 적용됩니다.', 'ok');
        메타({ updatedAt: { toMillis: () => Date.now() }, updatedBy: email });
    } catch (e) {
        const code = (e && e.code) || '';
        console.warn('[채우기 설정] 저장 실패:', code || e);
        상태(code === 'permission-denied'
            ? '저장 권한이 없습니다(관리자 계정만 저장할 수 있습니다).'
            : `저장하지 못했습니다 (${code || '알 수 없는 오류'}).`, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

function 시작() {
    if (시작됨) return;
    if (!document.getElementById(SECTION_ID)) return;   // 비관리자: 섹션 없음
    시작됨 = true;
    let app;
    try {
        app = getApp();   // admin.js 가 initializeFirebase 로 이미 만든 앱(두 번 만들면 duplicate-app)
    } catch (e) {
        console.warn('[채우기 설정] Firebase 앱이 아직 없습니다:', e);
        상태('불러오지 못했습니다 (no-app). 새로고침해 보세요.', 'error');
        시작됨 = false;
        return;
    }
    db = getFirestore(app);
    auth = getAuth(app);
    // 로그인 확인 전에 읽으면 permission-denied 로 끝나므로, 로그인된 뒤에 한 번만 읽는다.
    if (auth.currentUser) { 불러오기(); }
    else {
        const off = onAuthStateChanged(auth, (user) => {
            if (!user) return;
            off();
            불러오기();
        });
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
    const section = document.getElementById(SECTION_ID);
    if (!section) return;
    section.addEventListener('input', 예시갱신);
    section.addEventListener('change', 예시갱신);
    const btn = $('refill-save-btn');
    if (btn) btn.addEventListener('click', 저장);
});
