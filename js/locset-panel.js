// === js/locset-panel.js ===
// 로케이션관리 환경설정 '추천·채우기' 탭 (2026-10-27 — 옛 '추천·입고' 탭 + 관리자 페이지 '채우기 설정' 탭(옛 js/admin-refill.js)을 합침).
// location.js 가 initLocSetPanel({ db, auth }) 로 부른다(Firebase 를 여기서 초기화하지 않는다 — 두 번 만들면 duplicate-app).
//
// ① 변경 추천 설정 — [변경 추천 설정 저장] = window.saveLocRecSettings (js/lib/location-guard-map.js 가 location.settings 로 감싼다)
//    · 동선 기준: Locations/INFO_CONFIG.recommendPriorities (구역 순위·동/위치 순서·제외 구역). 화면 입고대기 추천 자리도 이 기준을 쓴다.
//    · 추천 양: Locations/INFO_CONFIG.locRecSettings { maxRows, weeklyMoves, minGain, updatedAt } — 범위는 js/lib/locrec-settings.js LIMITS.
//      서버 앱\로케이션추천 이 다음 추천(06:40 또는 [지금 재고로 다시 만들기])부터 쓴다. 규칙: INFO_CONFIG 새 키는 location.settings(규칙 변경 없음).
//      저장하는 사람 이메일은 넣지 않는다(INFO_CONFIG 는 직원 누구나 읽는다).
//    · 서버가 정하는 값(하루 출고 기준·재고 빼기·판정 기준·점수 비율·페어 기준)은 integrations/locRecLatest.settings 를 읽기 전용으로.
// ② 채우기 설정 — adminPrivate/refillSettings { enabled, days(0=월…6=일), skipHolidays, updatedAt, updatedBy(이메일 소문자) }.
//    adminPrivate 는 관리자만 읽고 쓴다. 관리자가 아니면 integrations/refillLatest.schedule('마지막 지시서 기준' 사본)을 잠근 채 보여 준다.
//    앱\채우기자동화\채우기.py 가 매일 아침 이 문서를 읽는다(규칙.py parse_settings).
//    ⚠️ 이름·범위를 바꾸면 채우기자동화\규칙.py parse_settings 도 바꿀 것(값이 이상하면 그쪽은 기본값을 쓴다).
//    pct·minQty 는 2026-10-14 부터 쓰지 않는다(문서에 남은 옛 값은 merge 저장이라 그대로 남지만 무해).
// ③ 계산 방식 안내 — 숫자는 locRecLatest.settings 로 채운다(js/lib/locrec-settings.js guideLines).
//
// 탭을 열 때마다 읽는다(getDoc). 저장 안 한 변경은 ①·② 를 따로 센다 — 다른 탭으로 가거나 창을 닫거나 페이지를 떠날 때 묻는다.
// 원문 문자열은 textContent 로만 넣는다.

import { doc, getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202610301315';
import { canFeature, currentPerm } from './feature-gate.js?v=202610301315';
import { KEYS, LIMITS, FIELD_TEXT, normalize, sameValues, serverRows, sourceText, guideLines } from './lib/locrec-settings.js?v=202610301315';

const PANE = 'recommend';
const INFO_PATH = ['Locations', 'INFO_CONFIG'];
const LATEST_PATH = ['artifacts', 'team-work-logger-v2', 'integrations', 'locRecLatest'];
const REFILL_LATEST_PATH = ['artifacts', 'team-work-logger-v2', 'integrations', 'refillLatest'];
const REFILL_PATH = ['adminPrivate', 'refillSettings'];
const 채우기기본값 = Object.freeze({ enabled: true, days: [0, 1, 2, 3, 4], skipHolidays: true });
const ALPHABETS = ['★', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];
const 기본우선순위 = Object.freeze({
    zones: { 0: ['★'], 1: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], 2: ['Z'], 3: ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'] },
    dongs: ['★', '1', '2', '3', '4', '5', '6'], poses: ['★', '2', '3', '4', '1', '5'], excludeCombos: []
});

const $ = (id) => document.getElementById(id);
const isAdmin = () => !!(currentPerm() && currentPerm().isAdmin);
const canSettings = () => canFeature('location.settings');

let db = null;
let auth = null;
let 추천바뀜 = false;
let 채우기바뀜 = false;
let 추천불러옴 = false;
let 채우기불러옴 = false;
let 채우기관리자 = false;    // 지금 채우기 칸이 관리자 문서(adminPrivate)를 보여 주는가
let 읽는중 = 0;             // 탭을 빠르게 다시 열면 늦게 온 옛 응답을 버린다
let 서버값 = null;          // locRecLatest.settings

function 상태(id, 글, 종류 = 'info') {
    const box = $(id);
    if (!box) return;
    box.dataset.tone = 종류;
    box.textContent = 글;
}

const 바뀐글 = () => [추천바뀜 ? '변경 추천 설정' : '', 채우기바뀜 ? '채우기 설정' : ''].filter(Boolean).join('·');
const 떠남확인 = () => !(추천바뀜 || 채우기바뀜)
    || confirm(`${바뀐글()}에 저장하지 않은 변경이 있습니다.\n저장하지 않고 떠날까요? (바꾼 값은 버립니다)`);
const 지금보임 = () => {
    const m = $('settings-modal');
    const p = document.querySelector(`#settings-modal [data-set-pane="${PANE}"]`);
    return !!(m && p && m.style.display !== 'none' && m.style.display !== '' && p.classList.contains('is-on'));
};

// ── ① 동선 기준(구역 퍼즐·동/위치 줄세우기·제외 구역) — 끌기는 location.js 의 handleDrag*·handleDrop 을 쓴다 ──
function 블록(text, cls, 끌기) {
    const b = document.createElement('div');
    b.className = cls;
    b.textContent = text;
    b.draggable = 끌기;
    if (끌기) { b.ondragstart = window.handleDragStart; b.ondragend = window.handleDragEnd; }
    return b;
}

function 우선순위그리기(p) {
    const src = p && typeof p === 'object' ? p : 기본우선순위;
    const zones = src.zones || {};
    const 끌기 = canSettings();
    for (let i = 0; i <= 3; i++) { const el = $(`lrs-pz-${i}`); if (el) el.replaceChildren(); }
    const none = $('lrs-pz-none');
    if (none) none.replaceChildren();
    ALPHABETS.forEach(a => {
        let rank = -1;
        for (let i = 0; i <= 3; i++) { if (Array.isArray(zones[i]) && zones[i].includes(a)) { rank = i; break; } }
        const target = rank >= 0 ? $(`lrs-pz-${rank}`) : none;
        if (target) target.appendChild(블록(a, 'puzzle-block', 끌기));
    });
    const 줄 = (id, items, defaults) => {
        const box = $(id);
        if (!box) return;
        box.replaceChildren();
        // 저장된 순서에 ★ 가 없으면 맨 앞에(예전 화면·서버 입력.priorities_of 와 같게) — 기본값과 합치며 ★ 가 꼴찌로 가지 않게
        let saved = Array.isArray(items) ? items.map(String) : [];
        if (saved.length && !saved.includes('★')) saved = ['★', ...saved];
        [...new Set([...saved, ...defaults])]
            .forEach(x => box.appendChild(블록(x, 'puzzle-sort-block', 끌기)));
    };
    줄('lrs-sort-dongs', src.dongs, ['★', '1', '2', '3', '4', '5', '6']);
    줄('lrs-sort-poses', src.poses, ['★', '1', '2', '3', '4', '5']);
    const ex = $('lrs-exclude-input');
    if (ex) { ex.value = (Array.isArray(src.excludeCombos) ? src.excludeCombos : []).join(', '); ex.disabled = !끌기; }
    제외미리보기();
}

function 제외목록() {
    const ex = $('lrs-exclude-input');
    return ex ? ex.value.split(',').map(s => s.trim().toUpperCase()).filter(Boolean) : [];
}

function 제외미리보기() {
    const box = $('lrs-exclude-preview');
    if (!box) return;
    const list = 제외목록();
    box.replaceChildren(...(list.length ? list : ['제외 항목 없음']).map(t => {
        const s = document.createElement('span');
        s.className = list.length ? 'lrs-chip' : 'lrs-muted';
        s.textContent = t;
        return s;
    }));
}

function 우선순위읽기() {
    const zones = {};
    for (let i = 0; i <= 3; i++) {
        const el = $(`lrs-pz-${i}`);
        zones[i] = el ? [...el.querySelectorAll('.puzzle-block')].map(b => b.textContent.trim()) : [];
    }
    const 줄 = (id) => [...(($(id) && $(id).querySelectorAll('.puzzle-sort-block')) || [])].map(b => b.textContent.trim());
    return { zones, dongs: 줄('lrs-sort-dongs'), poses: 줄('lrs-sort-poses'), excludeCombos: 제외목록() };
}

// ── ① 추천 양 ──
function 추천양그리기(value) {
    const 고침 = canSettings();
    for (const k of KEYS) {
        const el = $(`lrs-${k}`);
        if (!el) continue;
        el.value = value[k] == null ? '' : String(value[k]);
        el.disabled = !고침;
        el.min = String(LIMITS[k].min);
        el.max = String(LIMITS[k].max);
        el.step = LIMITS[k].int ? '1' : '0.1';
        const help = $(`lrs-${k}-help`);
        if (help) {
            const 지금 = 서버값 && 서버값[k] != null ? `지금 서버 값 ${서버값[k]}${sourceText(서버값, k) ? `(${sourceText(서버값, k)})` : ''} · ` : '';
            help.textContent = `${FIELD_TEXT[k].help} ${지금}${LIMITS[k].min}~${LIMITS[k].max}${LIMITS[k].int ? ' 정수' : ''}`;
        }
    }
}

const 추천양읽기 = () => Object.fromEntries(KEYS.map(k => [k, $(`lrs-${k}`) ? $(`lrs-${k}`).value : '']));

function 서버값그리기(s) {
    const box = $('lrs-server');
    if (!box) return;
    const rows = serverRows(s);
    if (!rows.length) {
        const p = document.createElement('div');
        p.className = 'lrs-muted';
        p.textContent = '아직 서버 기록이 없습니다(다음 추천 뒤에 보입니다).';
        box.replaceChildren(p);
        return;
    }
    box.replaceChildren(...rows.flatMap(r => {
        const dt = document.createElement('dt'); dt.textContent = r.label;
        const dd = document.createElement('dd'); dd.textContent = r.value;
        return [dt, dd];
    }));
}

function 안내그리기(s) {
    const g = guideLines(s);
    const fill = (id, lines) => {
        const ul = $(id);
        if (!ul) return;
        ul.replaceChildren(...lines.map(t => { const li = document.createElement('li'); li.textContent = t; return li; }));
    };
    fill('lrs-guide-refill', g.refill);
    fill('lrs-guide-locrec', g.locrec);
}

// 저장 버튼 — 불러오기 전·실패 때는 끈다(눌러도 반응이 없지 않게)
function 저장버튼(켬) {
    const btn = $('lrs-save-btn');
    if (btn) btn.disabled = !켬;
}

// 동선 기준 블록 순서 서명 — 끌었다 제자리에 놓으면 같으므로 변경으로 치지 않는다
let 끌기기준 = '';
const 끌기서명 = () => { const p = 우선순위읽기(); return JSON.stringify([p.zones, p.dongs, p.poses]); };

async function 추천불러오기(n) {
    상태('lrs-status', '불러오는 중…');
    추천불러옴 = false;
    저장버튼(false);
    const [info, latest] = await Promise.allSettled([getDoc(doc(db, ...INFO_PATH)), getDoc(doc(db, ...LATEST_PATH))]);
    if (n !== 읽는중) return;
    서버값 = latest.status === 'fulfilled' && latest.value.exists() ? ((latest.value.data() || {}).settings || null) : null;
    서버값그리기(서버값);
    안내그리기(서버값);
    if (info.status !== 'fulfilled') {
        const code = (info.reason && info.reason.code) || '';
        console.warn('[추천·채우기] 설정 불러오기 실패:', code || info.reason);
        상태('lrs-status', `설정을 불러오지 못해 저장할 수 없습니다 (${code || '알 수 없는 오류'}) — 새로고침해 보세요.`, 'error');
        return;
    }
    const conf = info.value.exists() ? (info.value.data() || {}) : {};
    const fb = 서버값 ? { maxRows: 서버값.maxRows, weeklyMoves: 서버값.weeklyMoves, minGain: 서버값.minGain } : undefined;
    const saved = conf.locRecSettings && typeof conf.locRecSettings === 'object' ? conf.locRecSettings : null;
    const { value, errors } = normalize(saved || fb || {}, fb);
    추천양그리기(value);
    우선순위그리기(conf.recommendPriorities || window.recommendPriorities);
    끌기기준 = 끌기서명();
    추천불러옴 = true;
    추천바뀜 = false;
    저장버튼(true);
    if (latest.status !== 'fulfilled') console.warn('[추천·채우기] 서버 기록 읽기 실패:', (latest.reason && latest.reason.code) || latest.reason);
    if (saved && errors.length) 상태('lrs-status', `저장된 값 중 ${errors.map(e => FIELD_TEXT[e.key].label).join('·')} 이(가) 이상해 서버 값을 보여 줍니다. 확인 후 저장하세요.`, 'warn');
    else if (!canSettings()) 상태('lrs-status', '보기만 할 수 있습니다(바꾸려면 로케이션 설정 권한이 필요합니다).');
    else 상태('lrs-status', saved ? '저장된 설정입니다.' : '아직 앱에서 저장한 값이 없어 서버 값을 보여 줍니다.');
}

window.saveLocRecSettings = async function () {
    if (!db || !추천불러옴) {
        상태('lrs-status', '설정을 불러오지 못해 저장할 수 없습니다 — 새로고침해 보세요.', 'error');
        return;
    }
    const { value, errors, ok } = normalize(추천양읽기());
    if (!ok) { 상태('lrs-status', errors.map(e => e.text).join(' / '), 'error'); return; }
    const pr = 우선순위읽기();
    const btn = $('lrs-save-btn');
    if (btn) btn.disabled = true;
    상태('lrs-status', '저장 중…');
    try {
        await setDoc(doc(db, ...INFO_PATH), {
            locRecSettings: { ...value, updatedAt: serverTimestamp() },
            recommendPriorities: pr
        }, { merge: true });
        window.recommendPriorities = pr;     // 화면 입고대기 추천(calcIncomingRecommend)이 바로 쓰게(구독도 곧 같은 값을 준다)
        추천바뀜 = false;
        끌기기준 = 끌기서명();
        추천양그리기(value);
        상태('lrs-status', '저장했습니다 — 다음 추천(06:40 또는 [지금 재고로 다시 만들기])부터 반영됩니다. 동선 기준은 입고대기 추천 자리에 바로 반영됩니다.', 'ok');
    } catch (e) {
        const code = (e && e.code) || '';
        console.warn('[추천·채우기] 변경 추천 설정 저장 실패:', code || e);
        상태('lrs-status', code === 'permission-denied'
            ? '저장 권한이 없습니다(로케이션 설정 권한이 필요합니다).'
            : `저장하지 못했습니다 (${code || '알 수 없는 오류'}).`, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
};

// ── ② 채우기 설정 ──
const 정수 = (v, lo, hi) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi);

/** 저장된 문서 → 화면 값. 이상한 칸은 기본값(규칙.py parse_settings 와 같은 기준). → { 값, 이상: [칸이름] } */
function 정리(d) {
    const 값 = { ...채우기기본값, days: [...채우기기본값.days] };
    const 이상 = [];
    if (typeof d.enabled === 'boolean') 값.enabled = d.enabled; else 이상.push('사용');
    if (typeof d.skipHolidays === 'boolean') 값.skipHolidays = d.skipHolidays; else 이상.push('공휴일 제외');
    if (Array.isArray(d.days) && d.days.length > 0 && d.days.every((x) => 정수(x, 0, 6))) {
        값.days = [...new Set(d.days)].sort((a, b) => a - b);
    } else 이상.push('요일');
    return { 값, 이상 };
}

const 채우기입력들 = () => [$('refill-enabled'), $('refill-skip-holidays'), ...document.querySelectorAll('.refill-day')].filter(Boolean);

function 채우기화면에(s, 고침) {
    $('refill-enabled').checked = !!s.enabled;
    $('refill-skip-holidays').checked = !!s.skipHolidays;
    document.querySelectorAll('.refill-day').forEach((cb) => { cb.checked = s.days.includes(Number(cb.value)); });
    채우기입력들().forEach((el) => { el.disabled = !고침; });
    const btn = $('refill-save-btn');
    if (btn) { btn.hidden = !고침; btn.disabled = !고침; }
}

function 채우기화면에서() {
    return {
        enabled: $('refill-enabled').checked,
        days: [...document.querySelectorAll('.refill-day')].filter((cb) => cb.checked).map((cb) => Number(cb.value)).sort((a, b) => a - b),
        skipHolidays: $('refill-skip-holidays').checked,
    };
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

function 채우기메타(d) {
    const box = $('refill-meta');
    if (!box) return;
    const t = 시각표기(d && d.updatedAt);
    box.textContent = t ? `마지막 저장 ${t}${d.updatedBy ? ` · ${d.updatedBy}` : ''}` : '';
}

async function 채우기불러오기(n) {
    채우기불러옴 = false;
    채우기관리자 = isAdmin();
    상태('refill-status', '불러오는 중…');
    try {
        if (채우기관리자) {
            const snap = await getDoc(doc(db, ...REFILL_PATH));
            if (n !== 읽는중) return;
            if (snap.exists()) {
                const d = snap.data() || {};
                const { 값, 이상 } = 정리(d);
                채우기화면에(값, true);
                채우기메타(d);
                if (이상.length) 상태('refill-status', `저장된 값 중 ${이상.join('·')} 이(가) 이상해 기본값을 보여 줍니다. 확인 후 저장하세요.`, 'warn');
                else 상태('refill-status', '저장된 설정입니다. 바꾼 뒤 [채우기 설정 저장]을 누르면 다음 지시서부터 적용됩니다.');
            } else {
                채우기화면에(채우기기본값, true);
                채우기메타(null);
                상태('refill-status', '아직 저장된 설정이 없어 기본값을 보여 줍니다(자동화도 이 기본값을 씁니다). [채우기 설정 저장]을 누르면 문서가 생깁니다.', 'warn');
            }
        } else {
            // 관리자가 아니면 adminPrivate 를 못 읽는다 — 마지막 지시서를 만들 때 서버가 남긴 사본을 보여 준다(바꾸지 못함)
            const snap = await getDoc(doc(db, ...REFILL_LATEST_PATH));
            if (n !== 읽는중) return;
            const sch = snap.exists() ? (snap.data() || {}).schedule : null;
            채우기화면에(sch && typeof sch === 'object' ? 정리(sch).값 : 채우기기본값, false);
            채우기메타(null);
            상태('refill-status', sch && typeof sch === 'object'
                ? '마지막 지시서 기준입니다. 채우기 설정은 관리자만 바꿀 수 있습니다.'
                : '아직 지시서 기록이 없어 기본값을 보여 줍니다. 채우기 설정은 관리자만 바꿀 수 있습니다.');
        }
        채우기불러옴 = true;
        채우기바뀜 = false;
    } catch (e) {
        if (n !== 읽는중) return;
        const code = (e && e.code) || '';
        console.warn('[추천·채우기] 채우기 설정 불러오기 실패:', code || e);
        채우기화면에(채우기기본값, false);
        상태('refill-status', code === 'permission-denied'
            ? '볼 권한이 없습니다. 채우기 설정은 관리자 계정만 볼 수 있습니다(권한 관리에서 관리자인지 확인).'
            : `불러오지 못했습니다 (${code || '알 수 없는 오류'}). 새로고침해 보세요.`, 'error');
    }
}

async function 채우기저장() {
    if (!db || !채우기불러옴 || !채우기관리자) return;
    const s = 채우기화면에서();
    if (s.days.length === 0) { 상태('refill-status', '요일을 하나 이상 고르세요. 보내지 않으려면 \'지시서 보내기\' 를 끄세요.', 'error'); return; }
    const btn = $('refill-save-btn');
    if (btn) btn.disabled = true;
    상태('refill-status', '저장 중…');
    try {
        const email = String((auth && auth.currentUser && auth.currentUser.email) || '').toLowerCase();
        await setDoc(doc(db, ...REFILL_PATH), {
            enabled: s.enabled, days: s.days, skipHolidays: s.skipHolidays,
            updatedAt: serverTimestamp(), updatedBy: email,
        }, { merge: true });
        채우기바뀜 = false;
        상태('refill-status', '저장했습니다 — 다음 지시서부터 적용됩니다.', 'ok');
        채우기메타({ updatedAt: { toMillis: () => Date.now() }, updatedBy: email });
    } catch (e) {
        const code = (e && e.code) || '';
        console.warn('[추천·채우기] 채우기 설정 저장 실패:', code || e);
        상태('refill-status', code === 'permission-denied'
            ? '저장 권한이 없습니다(관리자 계정만 저장할 수 있습니다).'
            : `저장하지 못했습니다 (${code || '알 수 없는 오류'}).`, 'error');
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ── 열기·떠나기 ──
function 불러오기() {
    if (!db) return;
    const n = ++읽는중;
    if (!auth || !auth.currentUser) { 상태('lrs-status', '로그인 후 다시 열어 주세요.', 'warn'); return; }
    추천불러오기(n).catch((e) => console.warn('[추천·채우기] 불러오기 오류:', e));
    채우기불러오기(n);
}

function 버림() { 추천바뀜 = false; 채우기바뀜 = false; }

export function initLocSetPanel({ db: _db, auth: _auth }) {
    db = _db;
    auth = _auth;
    const pane = document.querySelector(`#settings-modal [data-set-pane="${PANE}"]`);
    if (!pane || !db) return;

    // 탭 전환 — 이 탭에 저장 안 한 변경이 있으면 떠나기 전에 묻고, 이 탭으로 오면 새로 읽는다
    const origSwitch = window.switchLocSettingsTab;
    if (typeof origSwitch === 'function') {
        window.switchLocSettingsTab = (tab) => {
            const 여기있음 = 지금보임();
            if (tab !== PANE && 여기있음) {
                if (!떠남확인()) return;
                버림();
            }
            origSwitch(tab);
            if (tab === PANE && !(여기있음 && (추천바뀜 || 채우기바뀜))) 불러오기();
        };
    }
    // 창 닫기(닫기 버튼·바깥 누르기·ESC — ESC 는 modal-esc.js 가 닫기 버튼을 누른다)
    const origClose = window.closeSettingsModal;
    if (typeof origClose === 'function') {
        window.closeSettingsModal = (e) => {
            const 닫힘 = !e || (e.target && e.target.id === 'settings-modal');
            if (닫힘 && 지금보임()) {
                if (!떠남확인()) return;
                버림();
            }
            return origClose(e);
        };
    }

    // 바뀜 표시 — 입력칸·체크·제외 구역은 input/change, 퍼즐은 끌어 놓기(drop)·끝(dragend)
    const sec1 = $('lrs-locrec');
    if (sec1) {
        ['input', 'change'].forEach(ev => sec1.addEventListener(ev, (e) => {
            if (!추천불러옴) return;
            if (e.target && e.target.id === 'lrs-exclude-input') 제외미리보기();
            추천바뀜 = true;
        }));
        // 끌기 — 놓은 뒤 순서가 불러온(또는 저장한) 때와 달라졌을 때만 변경으로 친다
        ['drop', 'dragend'].forEach(ev => sec1.addEventListener(ev, () => {
            if (추천불러옴 && 끌기서명() !== 끌기기준) 추천바뀜 = true;
        }));
    }
    const sec2 = $('lrs-refill');
    if (sec2) sec2.addEventListener('change', (e) => {
        if (채우기불러옴 && 채우기관리자 && e.target && e.target.matches && e.target.matches('input')) 채우기바뀜 = true;
    });
    const saveRec = $('lrs-save-btn');
    if (saveRec) saveRec.addEventListener('click', () => window.saveLocRecSettings());   // 감싼(권한 확인) 함수를 부른다
    const saveRefill = $('refill-save-btn');
    if (saveRefill) saveRefill.addEventListener('click', 채우기저장);

    // 새로고침·탭 닫기 — 공통 상단바에서 이미 물었으면 다시 묻지 않는다
    window.addEventListener('beforeunload', (e) => {
        if (!(추천바뀜 || 채우기바뀜) || leaveAlreadyConfirmed()) return;
        e.preventDefault();
        e.returnValue = '';
    });
    // 공통 상단바 메뉴·홈 — 동기 confirm 만
    onBeforeLeave(() => 떠남확인());
}
