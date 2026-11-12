// === js/ship.js ===
// 플랫폼 출고(ship.html) 화면 — 옛 출고자동화통합.exe(직진배송·에이블리 1·2단계)의 웹판(2026-11-10).
//
// 흐름: 파일 칸에 끌어다 놓기·선택(여러 개를 한꺼번에 놓으면 js/lib/ship-assign.js 가 머리글로 칸을 정함)
//       → [만들기] → js/lib/ship-*.js 로 계산·파일 만들기(이 브라우저 안에서만) → 결과 저장(js/lib/save-file.js — 폴더 한 번 고르기·안 되면 다운로드)
//       → 2단계는 공용 설정 '전송 켬'일 때만 로케이션 실적·봉 수를 Firestore 에(js/ship-store.js).
// 2026-11-12 화면 개선: 흐름 표시줄(js/lib/ship-flow.js) · 결과 카드·노란 경고(js/lib/ship-summary.js) · 칸 접기 ·
//   같은 묶음 재실행 확인(js/lib/ship-made.js, localStorage) · exe 결과와 비교하기(js/lib/ship-compare.js) ·
//   같은 날 여러 묶음 합산(js/lib/ship-batch.js — 전송 전 미리보기로 같은 묶음·고친 전표를 묻고, 결과 카드에서 묶음 빼기).
//   진행 기록 문장은 그대로 두고(시험 tools/ship-check.py 가 기댄다) 새 정보는 화면 요소로 보여 준다.
// 지킬 것
//   · 엑셀 행 내용(상품코드·상품명·수량)은 화면 진행 기록에만 쓴다 — 콘솔·Firestore 로그에 남기지 않는다(콘솔은 오류 코드만).
//   · 직진배송출고리스트 원본은 이 PC 의 IndexedDB 에만 기억한다(js/lib/ship-file-store.js) — 서버·Storage 금지.
//   · 전송이 꺼져 있으면(transmit false, 병행 초기) Firestore 쓰기 함수를 아예 부르지 않는다 — 기록은 옛 exe 가 한다.
//   · 라이브러리는 이 페이지에서만 CDN 지연 로드: SheetJS 0.20.3(ESM — 다른 화면의 전역 XLSX 0.18.5 와 섞이지 않게)·JSZip 3.10.2·ExcelJS 4.4.0.
// 권한: 입장은 js/page-gate.js(ship.platform). 설정 저장·전송은 규칙이 막는다. 전송 켜기(transmit)는 관리자만.
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202611121346';
import { emulatorEnabled } from './firebase-emulator.js?v=202611121346';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202611121346';
import { memberNameFor } from './app-shell-data.js?v=202611121346';
import { friendlyFirebaseError } from './utils.js?v=202611121346';
import { resolve, can } from './lib/perm.js?v=202611121346';
import { readBook } from './lib/ship-read.js?v=202611121346';
import { zikjinStep1, zikjinStep2, TEMPLATE_SHEETS } from './lib/ship-zikjin.js?v=202611121346';
import { ablyStep1, ablyStep2, readAblyRequest } from './lib/ship-ably.js?v=202611121346';
import { zikjinListBytes, ablyBulkBytes, stockXlsBytes } from './lib/ship-write.js?v=202611121346';
import { pickingBytes } from './lib/ship-picking.js?v=202611121346';
import { kstDay, baseDateWarning, targetArea, STOCK_OUT_MSG } from './lib/ship-core.js?v=202611121346';
import { peekBook, classifyPeek, assignFiles, routeFiles, SLOTS, KIND, KIND_LABEL } from './lib/ship-assign.js?v=202611121346';
import { openShipStore, fileRecord, isFileRecord, describeRecord, sizeText, savedText, KEY_TEMPLATE, KEY_OUT_DIR } from './lib/ship-file-store.js?v=202611121346';
import { createSaver, mimeOf } from './lib/save-file.js?v=202611121346';
import { normalizeSettings, validateEdit, settingsWrite, parseLimit, activeRuleCount, MAX_RULES } from './lib/ship-settings.js?v=202611121346';
import { flowState, foldState, daysAgo, TEMPLATE_OLD_DAYS } from './lib/ship-flow.js?v=202611121346';
import { summarizeRun, fileSummary, SUMMARY_MAX_BYTES } from './lib/ship-summary.js?v=202611121346';
import { madeKey, loadMade, findMade, recordMade, madeConfirmText, MADE_STORE_KEY } from './lib/ship-made.js?v=202611121346';
import { gridOf, comparePairs } from './lib/ship-compare.js?v=202611121346';
import { batchKeyOf, codeTotals, freshKey, sha256Hex, LEGACY } from './lib/ship-batch.js?v=202611121346';
import { loadSettings, saveSettings, sendBatch, previewBatches, removeBatch } from './ship-store.js?v=202611121346';

const $ = (id) => document.getElementById(id);
const APP_BASE = 'artifacts/team-work-logger-v2';
const LIB = {
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs',
    cptable: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/cpexcel.full.mjs',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.2/jszip.min.js',
    exceljs: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
};
const ABLY_TEMPLATE_URL = 'assets/ship/엑셀_대량_입고_양식.xlsx';
const TAB_LABEL = { zikjin: '직진배송', ably: '에이블리' };
const SOURCE_LABEL = { ZG: '직진 일반', ZGF: '직진 즉시출고', AB: '에이블리 일반', ABF: '에이블리 즉시출고' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tick = () => new Promise(r => setTimeout(r, 30));
const fmt = (n) => Number(n || 0).toLocaleString('ko-KR');
const PHASES = ['읽는 중', '계산 중', '저장 중', '전송 중'];
const RECENT_TRANSMIT_MS = 7 * 86400000;   // 전송을 켠(설정 저장) 지 이만큼 안이면 'exe 로 또 보내지 마세요'
const OVERLAP_ASK = 0.5;                    // 이만큼 겹치면 '고친 전표인가요?'

// 칸 설명 — id 는 js/lib/ship-assign.js SLOTS 와 같다. short = 접힌 줄(#sp-fold)에 쓰는 짧은 이름
const SLOT_META = {
    zikjin: {
        1: [{ id: 'request', title: 'GPM 출고요청', short: '출고요청', req: true, hint: "이름에 '직진배송'이 든 시트를 모두 읽습니다" }],
        2: [
            { id: 'admin', title: '이지어드민 출고전표', short: '출고전표', req: true, hint: '1단계 파일을 이지어드민에 올린 뒤 받은 전표' },
            { id: 'template', title: '직진배송출고리스트 원본', short: '원본', req: true, hint: '한 번 넣으면 이 PC 가 기억합니다' },
            { id: 'request', title: '출고요청', short: '출고요청', req: false, hint: '1단계에서 자동 · 신상 코드 복구·일반/즉시출고 구분(없으면 전송·봉 수 안 함)' },
        ],
    },
    ably: {
        1: [{ id: 'request', title: '도착보장출고요청', short: '출고요청', req: true, hint: '2행 머리글 · 어드민상품코드 기준으로 합칩니다' }],
        2: [
            { id: 'admin', title: '이지어드민 출고전표', short: '출고전표', req: true, hint: '실제 출고 수량' },
            { id: 'request', title: '도착보장출고요청', short: '출고요청', req: true, hint: '1단계에서 자동 · SKU 매핑' },
            { id: 'template', title: '대량입고 양식', short: '대량입고 양식', req: false, hint: '앱에 들어 있음 — 다른 양식을 쓸 때만 넣으세요' },
        ],
    },
};
const STEP_DESC = {
    zikjin: {
        1: '출고요청 → 재고출고용_YYMMDD.xls(이지어드민 업로드용). 끝나면 출고요청이 2단계 칸에 저절로 들어갑니다.',
        2: '출고전표 + 원본(+ 출고요청) → 직진배송출고리스트_YYMMDD.xlsx + ZG_피킹작업지시서_YYMMDD.xlsx',
    },
    ably: {
        1: '도착보장출고요청 → 에이블리_재고출고용_YYMMDD.xls(이지어드민 업로드용). 끝나면 2단계 칸에 저절로 들어갑니다.',
        2: '출고전표 + 도착보장출고요청(+ 양식) → 에이블리_대량입고_YYMMDD.xlsx + AB_피킹작업지시서_YYMMDD.xlsx',
    },
};
const STEP2_LABEL = { zikjin: '2단계 · 출고리스트', ably: '2단계 · 대량입고' };

const emptyFiles = () => ({ 1: { request: null }, 2: { admin: null, template: null, request: null } });
const emptySession = () => ({ step1Result: null, step1For: null, step1Req: null, step2For: null });
const S = {
    db: null, auth: null, user: null, isAdmin: false, canShip: false,
    settings: normalizeSettings(null), settingsRead: false,
    tab: 'zikjin', step: { zikjin: 1, ably: 1 },
    files: { zikjin: emptyFiles(), ably: emptyFiles() },   // 파일 = { name, bytes: Uint8Array, size, from: 'drop'|'step1'|'pc'|'app', savedAt?, summary?, hash? }
    base: { zikjin: '', ably: '' }, limitText: { zikjin: '', ably: '' },
    busy: false, results: [], store: null, saver: null, pickSlot: null,
    // 2026-11-12 화면 개선
    session: { zikjin: emptySession(), ably: emptySession() },   // 흐름 표시용 — 이번에(새로고침 전) 마친 단계
    last: null,          // 결과 카드 { tab, step, failed, summary, warns, transmit: { source, packDay, key, today } | null }
    recog: '', phase: '', phases: [], why: '',
    foldOpen: false, advOpen: false,
    runLog: null, runWarns: [],
    cmp: { left: [], right: [], side: 'left' },
};

// ── 작은 도우미 ────────────────────────────────────────────
let toastTimer = null;
function toast(msg, ms = 3000) {
    const el = $('pd-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}
function setLoading(on, text) {
    $('pd-loading').style.display = on ? 'flex' : 'none';
    if (text) $('pd-loading-text').textContent = text;
}
/** 진행 기록 한 줄(화면 글상자에만) */
function logLine(s) {
    const el = $('sp-log');
    el.value += (el.value ? '\n' : '') + String(s);
    el.scrollTop = el.scrollHeight;
    if (S.runLog) S.runLog.push(String(s));
}
function setBusy(on, text = '처리 중…') {
    S.busy = on;
    $('sp-busy').hidden = !on;
    $('sp-busy-text').textContent = text;
    $('sp-run').disabled = on;
    document.querySelectorAll('#sp-slots button, #sp-tabs button, #sp-steps button, #sp-settings-btn, #sp-folder, #sp-pick-many, #sp-fold button, #sp-batches button, #sp-compare button')
        .forEach(b => { b.disabled = on; });
    renderWhy();
}
const errText = (e) => (e && e.code ? friendlyFirebaseError(e) : String((e && e.message) || e || '알 수 없는 오류'));
const transmitOn = () => S.settingsRead && S.settings.transmit === true && S.canShip;

// ── 라이브러리(CDN 지연 로드) ───────────────────────────────
function loadScript(src, globalName) {
    return new Promise((ok, no) => {
        if (window[globalName]) return ok(window[globalName]);
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => (window[globalName] ? ok(window[globalName]) : no(new Error(`${globalName} 없음`)));
        s.onerror = () => no(new Error(`${globalName} 를 불러오지 못했습니다(인터넷 연결 확인)`));
        document.head.appendChild(s);
    });
}
let libsP = null;
function loadLibs() {
    if (libsP) return libsP;
    libsP = (async () => {
        const [X, cp] = await Promise.all([import(LIB.xlsx), import(LIB.cptable)]);
        if (typeof X.set_cptable === 'function') X.set_cptable(cp);
        const JSZip = await loadScript(LIB.jszip, 'JSZip');
        const ExcelJS = await loadScript(LIB.exceljs, 'ExcelJS');
        return { X, JSZip, ExcelJS };
    })().catch((e) => { libsP = null; throw e; });
    return libsP;
}

// ── 로그인 게이트(products.js 와 같은 틀) ───────────────────
const GATE_ID = 'sp-auth-gate';
const GATE_STYLE = `position:fixed; inset:var(--as-h,0px) 0 0 0; z-index:2147483600; background:var(--c-bg,#F5F6F8);
    display:flex; overflow-y:auto; font-family:var(--font-sans,'SUIT','Noto Sans KR','Malgun Gothic',sans-serif); color:var(--c-text,#23272E); text-align:center;`;
const removeGate = () => { $(GATE_ID)?.remove(); document.documentElement.style.overflow = ''; };
function showGate(html) {
    removeGate();
    const el = document.createElement('div');
    el.id = GATE_ID;
    el.style.cssText = GATE_STYLE;
    el.innerHTML = `<div style="margin:auto; display:flex; flex-direction:column; align-items:center; gap:10px; padding:24px; width:100%; box-sizing:border-box;">${html}</div>`;
    document.body.appendChild(el);
    document.documentElement.style.overflow = 'hidden';
    return el;
}
function showLogin(auth) {
    const inStyle = 'padding:11px 12px; border:1px solid var(--c-line-strong,#D6DAE0); border-radius:10px; font-size:15px; font-family:inherit; background:var(--c-surface,#FFFFFF); color:var(--c-text,#23272E);';
    const el = showGate(`
        <div style="font-size:17px; font-weight:600;">로그인이 필요합니다</div>
        <div style="font-size:12.5px; color:var(--c-text-2,#646B75);">업무관리와 같은 계정입니다.</div>
        <form id="sp-login-form" style="display:flex; flex-direction:column; gap:8px; width:100%; max-width:300px; margin-top:6px;">
            <input id="sp-email" type="email" autocomplete="username" placeholder="이메일" style="${inStyle}">
            <input id="sp-pw" type="password" autocomplete="current-password" placeholder="비밀번호" style="${inStyle}">
            <button type="submit" id="sp-login-btn" style="padding:12px; border:0; border-radius:999px; background:var(--c-accent,#2F62C9); color:#fff; font-size:15px; font-weight:600; font-family:inherit; cursor:pointer;">로그인</button>
            <div id="sp-login-err" style="font-size:12px; color:var(--c-risk-text,#A0525C); min-height:16px;"></div>
        </form>
        <a href="index.html" style="font-size:12.5px; color:var(--c-accent-deep,#1E4699);">업무관리 열기</a>`);
    el.querySelector('#sp-login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = el.querySelector('#sp-login-btn'), err = el.querySelector('#sp-login-err');
        btn.disabled = true; btn.textContent = '로그인 중…'; err.textContent = '';
        try {
            await signInWithEmailAndPassword(auth, el.querySelector('#sp-email').value.trim(), el.querySelector('#sp-pw').value);
        } catch (e2) {
            const code = e2 && e2.code ? e2.code : '';
            err.textContent = ['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found'].includes(code)
                ? '이메일 또는 비밀번호가 잘못되었습니다.' : `로그인 오류: ${code || '알 수 없음'}`;
            btn.disabled = false; btn.textContent = '로그인';
        }
    });
}

// ── 화면 그리기 ────────────────────────────────────────────
function fileLine(f, slotId) {
    if (!f) {
        if (S.tab === 'ably' && S.step.ably === 2 && slotId === 'template') return '<span class="sp-empty">기본 양식(앱에 들어 있음)을 씁니다</span>';
        return '<span class="sp-empty">여기에 끌어다 놓거나 [파일 선택]</span>';
    }
    return `<b>${esc(f.name)}</b>`;
}
function fileMeta(f) {
    if (!f) return '';
    const from = { step1: '1단계에서 자동으로 넣음', pc: '이 PC 가 기억한 파일', app: '앱 기본 양식' }[f.from] || '';
    const parts = [sizeText(f.size)];
    if (f.from === 'pc' && f.savedAt) parts.push(`${savedText(f.savedAt)} 넣음`);
    if (from) parts.push(from);
    return parts.join(' · ');
}

function renderSlots() {
    const tab = S.tab, step = S.step[tab];
    const box = $('sp-slots');
    box.innerHTML = SLOT_META[tab][step].map(m => {
        const f = S.files[tab][step][m.id];
        const forget = (tab === 'zikjin' && m.id === 'template' && f && f.from === 'pc')
            ? '<button class="d-btn d-btn-sm" data-sp="forget">이 PC 에서 잊기</button>' : '';
        return `<div class="sp-slot${f ? ' is-filled' : ''}" data-slot="${m.id}">
            <div class="sp-slot-head"><span class="sp-slot-title">${esc(m.title)}</span>
                <span class="sp-slot-tag${m.req ? ' req' : ''}">${m.req ? '필수' : '선택'}</span></div>
            <div class="sp-slot-file">${fileLine(f, m.id)}</div>
            <div class="sp-slot-meta">${esc(f ? fileMeta(f) : m.hint)}</div>
            ${f && f.summary ? `<div class="sp-slot-sum">${esc(f.summary)}</div>` : ''}
            <div class="sp-slot-btns">
                <button class="d-btn d-btn-sm" data-sp="pick">파일 선택</button>
                ${f ? '<button class="d-btn d-btn-sm" data-sp="clear">빼기</button>' : ''}
                ${forget}
            </div>
        </div>`;
    }).join('');
    if (S.busy) box.querySelectorAll('button').forEach(b => { b.disabled = true; });
}

/** 칸이 모두 찼거나 기본값이면 접고(#sp-fold), 원본이 오래됐으면 노란 안내 */
function renderFold() {
    const tab = S.tab, step = S.step[tab];
    const slots = SLOT_META[tab][step].map(m => {
        const f = S.files[tab][step][m.id];
        return {
            title: m.short, file: !!f,
            isDefault: !f && tab === 'ably' && step === 2 && m.id === 'template',
            ageDays: f && f.from === 'pc' && f.savedAt ? daysAgo(f.savedAt) : null,
        };
    });
    const st = foldState(slots);
    const fold = st.fold && !S.foldOpen;
    $('sp-slots').hidden = fold;
    $('sp-drop-hint').hidden = fold;
    $('sp-fold').hidden = !fold;
    $('sp-fold-text').textContent = st.text;
    const t = tab === 'zikjin' && step === 2 ? S.files.zikjin[2].template : null;
    const age = t && t.from === 'pc' && t.savedAt ? daysAgo(t.savedAt) : null;
    const old = $('sp-tmpl-old');
    old.hidden = !(age !== null && age >= TEMPLATE_OLD_DAYS);
    old.textContent = old.hidden ? '' : `직진배송출고리스트 원본을 넣은 지 ${age}일 지났습니다 — 새 상품이 많이 들어왔으면 최신 원본을 넣어 주세요(마스터에서 못 찾은 상품은 출고리스트에서 빠집니다).`;
}

function renderOpts() {
    const tab = S.tab, step = S.step[tab];
    const box = $('sp-opts');
    if (step !== 2) { box.innerHTML = ''; return; }
    const setLimit = tab === 'zikjin' ? S.settings.zikjinLimit : S.settings.ablyLimit;
    if (!S.base[tab]) S.base[tab] = kstDay().yymmdd;
    if (!S.limitText[tab]) S.limitText[tab] = String(setLimit);
    const rules = tab === 'zikjin' ? activeRuleCount(S.settings.specialRules) : 0;
    const differs = String(S.base[tab]).trim() !== kstDay().yymmdd || String(S.limitText[tab]).trim() !== String(setLimit);
    box.innerHTML = `<details id="sp-adv" class="sp-adv"${(S.advOpen || differs) ? ' open' : ''}>
        <summary>고급 — 패키지명 ${esc(S.base[tab])} · 봉투당 ${esc(S.limitText[tab])}개${differs ? ' <span class="pd-pill warn">오늘·공용값과 다름</span>' : ''}</summary>
        <div class="sp-adv-body">
        <label class="sp-field">패키지명 베이스
            <input id="sp-base" class="pd-in num" value="${esc(S.base[tab])}" maxlength="12" inputmode="numeric">
            <small>오늘 ${esc(kstDay().yymmdd)} · YYMMDD</small></label>
        <label class="sp-field">봉투당 최대 수량
            <input id="sp-limit" class="pd-in num" value="${esc(S.limitText[tab])}" maxlength="4" inputmode="numeric">
            <small>공용 설정 ${setLimit}${tab === 'zikjin' ? ` · 지정상품 규칙 ${rules ? `${rules}개 켬` : '꺼짐'}` : ''}</small></label>
        </div></details>`;
    $('sp-adv').addEventListener('toggle', (e) => { S.advOpen = e.target.open; });
    $('sp-base').addEventListener('input', (e) => { S.base[tab] = e.target.value; });
    $('sp-limit').addEventListener('input', (e) => { S.limitText[tab] = e.target.value; });
}

function renderTransmit() {
    const el = $('sp-transmit');
    let cls = 'info', text;
    if (!S.settingsRead) { cls = 'warn'; text = '공용 설정을 읽지 못했습니다 — 기본값(봉투 30·25, 지정상품 꺼짐, 전송 끔)으로 만듭니다.'; }
    else if (!S.settings.transmit) text = '병행 중 — 로케이션 실적·봉 수 기록은 지금처럼 exe 가 합니다. 이 화면은 파일만 만듭니다(전송 꺼짐).';
    else text = '전송 켬 — 2단계를 마치면 로케이션 관리에 실제 출고 수량과 봉 수를 보냅니다. 같은 건을 exe 로 또 보내지 마세요.';
    if (!S.canShip) { cls = 'warn'; text += ' · 이 계정은 「플랫폼 출고」 권한이 없어 설정 저장·전송이 막힙니다.'; }
    el.className = `pd-alert ${cls}${transmitOn() ? ' sp-chip' : ''}`;   // 전송 켬은 작은 칩(글자 그대로)
    el.textContent = text;
}

function renderFolder() {
    const s = S.saver;
    const b = $('sp-folder');
    if (!s || !s.supportsFolder()) { b.textContent = '다운로드로 저장'; b.title = '이 브라우저는 폴더에 바로 쓸 수 없어 다운로드로 받습니다'; return; }
    b.textContent = s.folderName ? `저장 폴더: ${s.folderName}` : (s.mode === 'download' ? '저장 폴더 고르기(지금은 다운로드)' : '저장 폴더 고르기');
    b.title = '결과 파일을 저장할 폴더 — 한 번 고르면 다음부터 묻지 않습니다';
}

/** 흐름 표시줄 · 다음 할 일 */
function renderFlow() {
    const tab = S.tab, step = S.step[tab], ss = S.session[tab];
    const req2 = S.files[tab][2].request;
    const step1Result = req2 && req2.from === 'step1' && req2 === ss.step1Req ? ss.step1Result : null;
    const f = flowState({
        tab, step, step1Result,
        step1Done: !!step1Result && !!S.files[tab][1].request && S.files[tab][1].request === ss.step1For,
        step2Done: !!S.files[tab][2].admin && S.files[tab][2].admin === ss.step2For,
        missing: missingOf(tab, step), hasAdmin: !!S.files[tab][2].admin,
    });
    $('sp-flow').innerHTML = f.steps.map(s => `<li class="sp-flow-step is-${s.state}" data-state="${s.state}" data-flow="${s.id}">
        <span class="sp-flow-mark">${s.state === 'done' ? '✓' : esc(s.mark)}</span>
        <span class="sp-flow-label">${esc(s.label)}${s.outside ? ' <small>(웹 밖)</small>' : ''}</span></li>`).join('');
    $('sp-next').textContent = f.next;
}

/** 출고요청 이름에 '즉시출고' → 띠 */
function renderQuick() {
    const tab = S.tab, step = S.step[tab];
    const f = S.files[tab][step].request;
    const el = $('sp-quick');
    const on = !!f && targetArea(f.name) === 'fast';
    el.hidden = !on;
    el.textContent = on ? `즉시출고 묶음입니다 — 출고요청 파일 이름에 '즉시출고'가 있어 로케이션·봉 수에는 즉시출고(${tab === 'zikjin' ? 'ZGF' : 'ABF'})로 들어갑니다.` : '';
}

/** 큰 상자 자리 — 인식 결과 · 처리 중 단계 */
function renderIntake() {
    const on = !!(S.recog || S.phase);
    $('sp-intake-default').hidden = on;
    $('sp-intake-status').hidden = !on;
    $('sp-recog').textContent = S.recog;
    const idx = S.phases.indexOf(S.phase);
    $('sp-phase').innerHTML = S.phase ? S.phases.map((p, i) => `<li class="${i < idx ? 'is-done' : i === idx ? 'is-now' : ''}">${esc(p)}</li>`).join('') : '';
}
function setPhase(p) { S.phase = p; renderIntake(); }

/** 저절로 시작하지 않은 이유 + [만들기] 강조 */
function renderWhy() {
    const el = $('sp-run-why');
    if (!el) return;
    el.textContent = S.why && !S.busy ? `저절로 시작하지 않았습니다 — ${S.why} [만들기]를 눌러 주세요.` : '';
    $('sp-run').classList.toggle('is-attention', !!S.why && !S.busy);
}

function render() {
    const tab = S.tab, step = S.step[tab];
    document.querySelectorAll('#sp-tabs .d-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    document.querySelectorAll('#sp-steps .d-seg-btn').forEach(b => b.classList.toggle('is-on', Number(b.dataset.step) === step));
    $('sp-step2-btn').textContent = STEP2_LABEL[tab];
    $('sp-now').textContent = `${TAB_LABEL[tab]} · ${step === 1 ? '1단계 · 재고출고용' : STEP2_LABEL[tab]}`;
    $('sp-step-desc').textContent = STEP_DESC[tab][step];
    $('sp-step-note').textContent = '';
    $('sp-run').textContent = `${TAB_LABEL[tab]} ${step}단계 만들기`;
    document.title = `플랫폼 출고 — ${TAB_LABEL[tab]}`;
    renderSlots();
    renderFold();
    renderOpts();
    renderTransmit();
    renderFolder();
    renderFlow();
    renderQuick();
    renderIntake();
    renderWhy();
    renderResultCard();
}

// ── 해시(#tab=zikjin|ably&step=1|2) ─────────────────────────
function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const tab = p.get('tab') === 'ably' ? 'ably' : 'zikjin';
    S.tab = tab;
    const st = Number(p.get('step'));
    if (st === 1 || st === 2) S.step[tab] = st;
}
const writeHash = () => { history.replaceState(null, '', `#tab=${S.tab}&step=${S.step[S.tab]}`); };
/** 탭·단계를 바꿀 때 — 접기·이유·인식 표시를 처음처럼 */
const resetView = () => { S.foldOpen = false; S.why = ''; S.recog = ''; };

// ── 파일 넣기 ──────────────────────────────────────────────
async function fileOf(file, from = 'drop') {
    const buf = new Uint8Array(await file.arrayBuffer());
    return { name: file.name, bytes: buf, size: buf.byteLength, from };
}

/** 원본(직진 2단계 template)은 이 PC 에 기억한다 */
async function rememberTemplate(f) {
    if (!S.store) return;
    try {
        const rec = fileRecord(f.name, f.bytes);
        await S.store.put(KEY_TEMPLATE, rec);
        f.from = 'pc';
        f.savedAt = rec.savedAt;
        logLine(`  원본을 이 PC 에 기억했습니다: ${describeRecord(rec)}`);
    } catch (e) {
        console.warn('[플랫폼 출고] 원본 기억 실패:', (e && e.name) || 'unknown');
        logLine('  ⚠ 원본을 이 PC 에 기억하지 못했습니다(브라우저 저장공간) — 이번에는 그대로 씁니다.');
    }
}

/** 출고요청·출고전표 칸 요약(한 번 읽기, 3MB 넘으면·원본 양식은 건너뜀) — 화면에만 */
async function summarizeSlot(tab, slot, f) {
    if (!f || slot === 'template' || f.size > SUMMARY_MAX_BYTES) return;
    try {
        const { X } = await loadLibs();
        const s = fileSummary(readBook(X, f.bytes, f.name), { tab, slot });
        if (s) f.summary = s.text;
    } catch (_) { /* 요약은 없어도 된다 */ }
}

async function putSlot(tab, step, slot, f) {
    S.files[tab][step][slot] = f;
    if (f) await summarizeSlot(tab, slot, f);
    if (tab === 'zikjin' && step === 2 && slot === 'template' && f) await rememberTemplate(f);
}

/** 칸 하나에 직접 넣기(선택·칸에 놓기) — 모양이 다르면 안내만 하고 넣는다 */
async function dropOnSlot(slot, fileList) {
    const tab = S.tab, step = S.step[tab];
    const file = fileList[0];
    if (!file || S.busy) return;
    S.why = '';
    setBusy(true, '파일 종류를 보는 중…');   // 읽는 동안 다른 놓기(저절로 시작)가 끼어들지 않게
    try {
        const f = await fileOf(file);
        const want = SLOTS[tab][step][slot];
        try {
            const { X } = await loadLibs();
            const kind = classifyPeek(peekBook(X, f.bytes, f.name));
            if (kind === KIND.STOCK_OUT) {   // 1단계 결과를 출고전표 칸에 — 넣지 않는다
                logLine(`✗ '${f.name}' — ${STOCK_OUT_MSG}`);
                toast(STOCK_OUT_MSG, 5000);
                return;
            }
            if (kind !== want) logLine(`⚠ '${f.name}' 은 ${KIND_LABEL[kind]} 처럼 보입니다(이 칸은 ${KIND_LABEL[want]}). 맞는지 확인하세요.`);
        } catch (e) {
            logLine(`⚠ '${f.name}' 앞부분을 읽지 못했습니다: ${errText(e)}`);
        }
        await putSlot(tab, step, slot, f);
    } catch (e) {
        logLine(`✗ 파일을 넣지 못했습니다: ${errText(e)}`);
    } finally {
        setBusy(false);
        render();
    }
}

/** 1단계를 마치고 2단계(출고전표)를 기다리는 탭 */
const pendingTabs = () => ({
    zikjin: !!(S.files.zikjin[2].request && S.files.zikjin[2].request.from === 'step1' && !S.files.zikjin[2].admin),
    ably: !!(S.files.ably[2].request && S.files.ably[2].request.from === 'step1' && !S.files.ably[2].admin),
});
const missingOf = (tab, step) => SLOT_META[tab][step].filter(m => m.req && !S.files[tab][step][m.id]).map(m => m.title);

// ── 같은 묶음 재실행 확인(이 PC localStorage) ──────────────────
function madeState() {
    try { return loadMade(localStorage.getItem(MADE_STORE_KEY)); } catch (_) { return loadMade(null); }
}
async function hashOf(f) {
    if (!f) return '';
    if (!f.hash) f.hash = await sha256Hex(f.bytes);
    return f.hash;
}
/** 이 단계·파일의 묶음 표시 키(주 파일 = 1단계 출고요청 · 2단계 출고전표) */
async function madeKeyOf(tab, step, files) {
    const main = step === 1 ? files.request : files.admin;
    return madeKey(tab, step, await hashOf(main), await hashOf(files.request));
}
function saveMade(k, tab, step) {
    try { localStorage.setItem(MADE_STORE_KEY, JSON.stringify(recordMade(madeState(), { k, tab, step }))); }
    catch (_) { /* 저장공간이 막혀도 만들기는 된다 */ }
}

/**
 * 여러 파일을 한꺼번에(또는 칸 밖에 하나) — 머리글로 직진·에이블리와 단계를 알아보고(ship-assign.routeFiles)
 * 그 탭·단계로 옮겨 칸을 채운 뒤, 필요한 파일이 다 있으면 저절로 [만들기](2026-11-12).
 * 저장 폴더를 아직 안 골랐거나 권한을 물어야 하면(끌어다 놓기는 클릭이 아니라 브라우저가 묻지 못함) 시작하지 않고 버튼을 누르게 한다.
 * 오늘 이미 만든 묶음이면(ship-made) 묻지 않고 멈춘다(이유 표시).
 */
async function dropMany(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    let autoRun = false;
    S.why = '';
    setBusy(true, '파일 종류를 보는 중…');
    try {
        const { X } = await loadLibs();
        const judged = [];
        for (const file of files) {
            const f = await fileOf(file);
            let kind = 'unknown';
            try { kind = classifyPeek(peekBook(X, f.bytes, f.name)); } catch (_) { /* 알 수 없음 */ }
            judged.push({ ...f, kind });
        }
        const route = routeFiles(judged, { tab: S.tab, pending: pendingTabs() });
        if (route.error) {
            logLine('✗ ' + route.error);
            toast(route.error, 5000);
            return;
        }
        const moved = route.step !== null && (route.tab !== S.tab || route.step !== S.step[S.tab]);
        if (route.step !== null) {
            S.tab = route.tab;
            S.step[route.tab] = route.step;
            writeHash();
            S.recog = `${TAB_LABEL[route.tab]} ${route.step}단계로 인식했습니다`;
        }
        if (moved) S.foldOpen = false;
        const tab = S.tab, step = S.step[tab];
        if (moved) logLine(`→ ${TAB_LABEL[tab]} ${step}단계로 옮겼습니다(올린 파일로 알아봄).`);
        if (route.note) logLine('⚠ ' + route.note);
        const { assign, notes } = assignFiles(judged, tab, step);
        for (const [slot, f] of Object.entries(assign)) {
            const { kind, ...file } = f;
            await putSlot(tab, step, slot, file);
            logLine(`✓ '${file.name}' → ${SLOT_META[tab][step].find(m => m.id === slot).title}`);
        }
        // 1단계로 갈 때 같이 넣은 양식(원본)은 2단계 칸에 — '1단계에 쓰지 않습니다' 안내는 뺀다
        let rest = notes;
        if (step === 1) {
            const tmplKind = SLOTS[tab][2].template;
            const tmpl = judged.find(f => f.kind === tmplKind);
            if (tmpl) {
                const { kind, ...file } = tmpl;
                await putSlot(tab, 2, 'template', file);
                logLine(`✓ '${file.name}' → 2단계 ${SLOT_META[tab][2].find(m => m.id === 'template').title}`);
                rest = notes.filter(n => !n.startsWith(`'${tmpl.name}'`));
            }
        }
        rest.forEach(n => logLine('⚠ ' + n));
        if (rest.length) toast(rest[0], 5000);
        else if (route.note) toast(route.note, 5000);
        // 저절로 시작하는 것은 '이번에 그 단계의 주 파일(1단계 출고요청 · 2단계 출고전표)을 넣었고, 판단이 확실할 때'만.
        //   탭을 추정했거나(route.note) 안내가 있었거나(파일 둘·모르는 파일) 패키지명 날짜가 오늘이 아니면 [만들기]를 누르게 한다.
        const trigger = SLOTS[tab][step][step === 1 ? 'request' : 'admin'];
        const gotTrigger = route.step !== null && judged.some(f => f.kind === trigger && Object.values(assign).includes(f));
        if (gotTrigger) {
            const missing = missingOf(tab, step);
            const stale = step === 2 && S.base[tab] && S.base[tab].trim() !== kstDay().yymmdd;
            let why = '';
            let made = null;
            if (!missing.length && !route.note && !rest.length && !stale) {
                try { made = findMade(madeState(), await madeKeyOf(tab, step, S.files[tab][step])); } catch (_) { made = null; }
            }
            if (missing.length) logLine(`  더 넣을 파일: ${missing.join(', ')}`);
            else if (route.note || rest.length) why = '위 안내를 확인한 뒤';
            else if (stale) why = `패키지명 베이스(${S.base[tab].trim()})가 오늘 날짜가 아니라 확인한 뒤`;
            else if (made) why = `${made.at} 에 이미 만든 묶음이라 확인한 뒤`;
            else if (!(await S.saver.ready())) why = '저장 폴더 확인이 필요해';
            else autoRun = true;
            if (why) {
                logLine(`  파일이 다 들어왔습니다 — ${why} [만들기]를 눌러 주세요(저절로 시작하지 않았습니다).`);
                if (!rest.length && !route.note) toast('파일이 다 들어왔습니다 — [만들기]를 눌러 주세요', 5000);
                S.why = why;
            }
        }
    } catch (e) {
        logLine(`✗ 파일을 넣지 못했습니다: ${errText(e)}`);
    } finally {
        setBusy(false);
        render();
    }
    if (autoRun) {
        logLine(`  필요한 파일이 다 있어 ${TAB_LABEL[S.tab]} ${S.step[S.tab]}단계를 바로 시작합니다.`);
        await run({ auto: true });
    } else if (!S.busy) {
        $('sp-run').focus();
    }
}

function bindDrop() {
    const area = $('sp-drop');
    const cmp = $('sp-compare');
    const isFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    area.addEventListener('dragover', (e) => {
        if (!isFiles(e) || S.busy) return;
        e.preventDefault();
        const slot = e.target.closest('.sp-slot');
        area.classList.toggle('is-over', !slot);
        document.querySelectorAll('.sp-slot').forEach(s => s.classList.toggle('is-over', s === slot));
    });
    area.addEventListener('dragleave', (e) => {
        if (!area.contains(e.relatedTarget)) {
            area.classList.remove('is-over');
            document.querySelectorAll('.sp-slot').forEach(s => s.classList.remove('is-over'));
        }
    });
    area.addEventListener('drop', (e) => {
        if (!isFiles(e) || S.busy) return;
        e.preventDefault();
        area.classList.remove('is-over');
        document.querySelectorAll('.sp-slot').forEach(s => s.classList.remove('is-over'));
        const files = e.dataTransfer.files;
        const slot = e.target.closest('.sp-slot');
        if (slot && files.length === 1) dropOnSlot(slot.dataset.slot, files);
        else dropMany(files);
    });
    // 칸 밖(페이지 아무 곳 — 위쪽 큰 상자 포함)에 놓으면 알아보고 진행. 브라우저가 파일을 열지 않게
    //   단 'exe 결과와 비교하기'(#sp-compare) 안에 놓은 것은 비교 칸으로(출고 파일로 보내지 않음)
    const intake = $('sp-intake');
    window.addEventListener('dragover', (e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        intake.classList.toggle('is-over', !S.busy && !area.contains(e.target) && !cmp.contains(e.target));
    });
    window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) intake.classList.remove('is-over'); });
    window.addEventListener('drop', (e) => {
        intake.classList.remove('is-over');
        if (!isFiles(e) || area.contains(e.target)) return;
        e.preventDefault();               // 바쁠 때도 브라우저가 파일을 열지 않게 막기는 한다
        if (cmp.contains(e.target)) return;   // 비교 칸이 받는다(bindCompare)
        if (S.busy) { toast('처리 중입니다 — 끝난 뒤 다시 넣어 주세요.'); return; }
        dropMany(e.dataTransfer.files);
    });
    // [파일 고르기](여러 개) — 놓기와 같이 알아보고 진행
    $('sp-pick-many').addEventListener('click', () => {
        if (S.busy) return;
        const inp = $('sp-files-input');
        inp.value = '';
        inp.click();
    });
    $('sp-files-input').addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length && !S.busy) dropMany(files);
    });

    $('sp-slots').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-sp]');
        if (!b || S.busy) return;
        const slot = b.closest('.sp-slot').dataset.slot;
        const tab = S.tab, step = S.step[tab];
        if (b.dataset.sp === 'pick') {
            S.pickSlot = slot;
            const inp = $('sp-file-input');
            inp.value = '';
            inp.click();
        } else if (b.dataset.sp === 'clear') {
            S.files[tab][step][slot] = null;
            S.why = '';
            render();
        } else if (b.dataset.sp === 'forget') {
            if (!confirm('이 PC 에 기억한 직진배송출고리스트 원본을 지울까요?\n(다음 2단계에서 다시 넣어야 합니다)')) return;
            try { if (S.store) await S.store.del(KEY_TEMPLATE); } catch (_) { /* 무시 */ }
            S.files.zikjin[2].template = null;
            logLine('이 PC 에 기억한 원본을 지웠습니다.');
            render();
        }
    });
    $('sp-file-input').addEventListener('change', (e) => {
        const files = e.target.files;
        if (files && files.length && S.pickSlot) dropOnSlot(S.pickSlot, files);
    });
    $('sp-fold-open').addEventListener('click', () => { if (S.busy) return; S.foldOpen = true; render(); });
}

// ── 결과 저장 ──────────────────────────────────────────────
async function saveOut(name, bytes) {
    const res = await S.saver.save(name, bytes, mimeOf(name));
    S.results.push({ name, bytes });
    logLine(`  저장: ${name}${res.how === 'folder' ? ` → 폴더 '${res.folder}'` : ' → 다운로드'}`);
    renderResults();
    renderFolder();
}
function renderResults() {
    $('sp-results').innerHTML = S.results.map((r, i) => `<div class="sp-result"><span class="pd-pill ok">완료</span><b>${esc(r.name)}</b>
        <span class="pd-mute">${esc(sizeText(r.bytes.byteLength))}</span>
        <button class="d-btn d-btn-sm" data-again="${i}">받기</button></div>`).join('');
    renderResultCard();
}
function bindResults() {
    $('sp-results').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-again]');
        if (!b) return;
        const r = S.results[Number(b.dataset.again)];
        if (!r) return;
        const url = URL.createObjectURL(new Blob([r.bytes], { type: mimeOf(r.name) }));
        const a = document.createElement('a');
        a.href = url; a.download = r.name; a.style.display = 'none';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
}

// ── 결과 카드 ──────────────────────────────────────────────
const hhmm = (iso) => (typeof iso === 'string' && iso.length >= 16 ? iso.slice(11, 16) : '');
const recentTransmit = () => {
    const ms = Date.parse(S.settings.updatedAt);
    return Number.isFinite(ms) && Date.now() - ms <= RECENT_TRANSMIT_MS;
};
function renderResultCard() {
    const card = $('sp-result-card');
    const L = S.last;
    card.hidden = !L && !S.results.length;
    const title = $('sp-result-title');
    if (!L) { title.textContent = S.results.length ? '만든 파일' : ''; title.className = 'sp-result-title'; }
    else if (L.failed) { title.textContent = `✗ ${TAB_LABEL[L.tab]} ${L.step}단계 실패 — 아래 진행 기록을 확인하세요`; title.className = 'sp-result-title is-fail'; }
    else { title.textContent = L.summary.title; title.className = 'sp-result-title is-ok'; }
    // exe 로 또 보내지 마세요(전송 켬 · 켠 지 7일 안)
    const exe = $('sp-result-exe');
    exe.hidden = !(L && !L.failed && L.step === 2 && L.transmit && L.transmit.key && transmitOn() && recentTransmit());
    exe.textContent = exe.hidden ? '' : '전송 켬 — 이 묶음은 이 화면이 로케이션 관리·봉 수에 보냈습니다. exe 로 또 보내지 마세요(두 번 들어갑니다).';
    // 노란 경고
    const warns = L && !L.failed ? [...L.summary.warns, ...L.warns] : [];
    const w = $('sp-warn');
    w.hidden = !warns.length;
    w.innerHTML = warns.length ? `<b>확인할 것</b><ul>${warns.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
    renderBatches();
    renderCompareFiles();
}

/** 오늘 보낸 묶음(전송 켬일 때만) */
function renderBatches() {
    const box = $('sp-batches');
    const T = S.last && !S.last.failed && S.last.transmit;
    if (!T || !transmitOn() || !Array.isArray(T.today)) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    const rows = T.today.map(t => {
        const mine = t.key === T.key;
        const who = t.key === LEGACY ? 'exe·옛 방식 몫' : (hhmm(t.at) || '시각 없음');
        const btn = t.key === LEGACY ? '' : `<button class="d-btn d-btn-sm" data-rm="${esc(t.key)}"${S.busy ? ' disabled' : ''}>묶음 빼기</button>`;
        return `<tr${mine ? ' class="is-mine"' : ''}><td>${esc(who)}${mine ? ' <span class="pd-pill accent">이번 묶음</span>' : ''}</td>
            <td class="n">${t.k ? fmt(t.k) : '-'}</td><td class="n">${fmt(t.q)}</td><td class="n">${t.n === null || t.n === undefined ? '-' : fmt(t.n)}</td><td class="x">${btn}</td></tr>`;
    }).join('');
    box.innerHTML = `<div class="pd-row"><b>오늘 보낸 묶음 — ${esc(SOURCE_LABEL[T.source] || T.source)}</b><div class="pd-grow"></div>
        <span class="pd-note">같은 날 여러 묶음은 더해서 로케이션 관리·봉 수에 들어갑니다.</span></div>
        ${T.today.length ? `<table class="sp-bat-t"><thead><tr><th>보낸 시각</th><th class="n">품목</th><th class="n">수량</th><th class="n">봉</th><th></th></tr></thead><tbody>${rows}</tbody></table>`
            : '<div class="pd-note">오늘 보낸 묶음이 없습니다.</div>'}`;
}

async function refreshBatches(T, rows, now = new Date()) {
    try {
        const pv = await previewBatches(S.db, { rows, source: T.source, key: T.key, packDay: T.packDay }, { enabled: true, now });
        T.today = pv.today;
    } catch (e) {
        console.warn('[플랫폼 출고] 묶음 목록 읽기 실패:', (e && e.code) || (e && e.name) || 'unknown');
        T.today = null;
    }
}

function bindBatches() {
    $('sp-batches').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-rm]');
        if (!b || S.busy || !S.last || !S.last.transmit) return;
        const T = S.last.transmit;
        const t = (T.today || []).find(x => x.key === b.dataset.rm);
        if (!t || !transmitOn()) return;
        if (T.day8 && T.day8 !== kstDay().ymd8) {   // 자정이 지났다 — 로케이션에는 오늘 행만 남아 그날 몫을 뺄 수 없다
            toast('보낸 날이 지나 이 묶음을 뺄 수 없습니다 — 로케이션 관리에서 직접 확인하세요.', 6000);
            logLine(`  ⚠ 묶음 빼기 안 함: 보낸 날(${T.day8})이 지났습니다 — 로케이션에는 오늘 행만 남습니다.`);
            return;
        }
        const what =`${hhmm(t.at) || '오늘'} 에 보낸 묶음(품목 ${fmt(t.k)} · 수량 ${fmt(t.q)}${t.n !== null && t.n !== undefined ? ` · ${fmt(t.n)}봉` : ''})`;
        if (!confirm(`${what}을 오늘 실적에서 뺄까요?\n로케이션 관리·봉 수에서 이 묶음 몫만 빠집니다(다른 묶음은 그대로). 만든 파일은 지우지 않습니다.`)) return;
        setBusy(true, '묶음 빼는 중…');
        try {
            const r = await removeBatch(S.db, { source: T.source, key: t.key, packDay: T.packDay, day8: T.day8 || null }, { enabled: true, now: new Date() });
            if (r.notFound) {
                logLine(`  ⚠ 묶음 빼기 안 함: ${what} — 로케이션에서 이 묶음 몫을 찾지 못했습니다(exe 가 오늘 다시 보내 묶음 내역이 지워짐). 봉 수도 그대로 두었습니다.`);
                toast('로케이션에서 이 묶음 몫을 찾지 못해 빼지 않았습니다 — 진행 기록을 확인하세요', 6000);
            } else {
                logLine(`  묶음 빼기: ${what} — 로케이션 ${fmt(r.location.removed)}개${r.packs ? ` · 봉 ${fmt(r.packs.removed)}봉` : ''} 뺌`);
                toast('묶음을 뺐습니다');
            }
            await refreshBatches(T, []);
        } catch (e2) {
            console.warn('[플랫폼 출고] 묶음 빼기 실패:', (e2 && e2.code) || (e2 && e2.name) || 'unknown');
            logLine(`  ⚠ 묶음 빼기 실패: ${errText(e2)}`);
            toast('묶음을 빼지 못했습니다 — 진행 기록을 확인하세요', 5000);
        } finally {
            setBusy(false);
            render();
        }
    });
}

// ── exe 결과와 비교하기 ─────────────────────────────────────
function renderCompareFiles() {
    for (const side of ['left', 'right']) {
        $(`sp-cmp-${side}`).innerHTML = S.cmp[side].length
            ? S.cmp[side].map((f, i) => `<div class="sp-cmp-file"><span>${esc(f.name)}</span><button class="d-btn d-btn-sm" data-cmp="del" data-side="${side}" data-i="${i}">빼기</button></div>`).join('')
            : `<div class="pd-note">${side === 'left' ? 'exe 가 만든 파일을 놓으세요' : '이번 결과가 저절로 들어갑니다'}</div>`;
    }
}
async function addCompareFiles(side, fileList) {
    for (const file of [...fileList]) S.cmp[side].push(await fileOf(file, 'drop'));
    $('sp-cmp-out').innerHTML = '';
    renderCompareFiles();
}
async function runCompare() {
    const out = $('sp-cmp-out');
    if (!S.cmp.left.length || !S.cmp.right.length) { out.innerHTML = '<div class="pd-alert warn">양쪽에 파일을 넣어 주세요.</div>'; return; }
    out.innerHTML = '<div class="pd-note">비교하는 중…</div>';
    let res;
    try {
        const { X } = await loadLibs();
        const g = (f) => ({ name: f.name, grid: gridOf(X, f.bytes) });
        res = comparePairs(S.cmp.left.map(g), S.cmp.right.map(g));
    } catch (e) {
        console.warn('[플랫폼 출고] 비교 실패:', (e && e.name) || 'Error');
        out.innerHTML = `<div class="pd-alert risk">읽지 못한 파일이 있습니다: ${esc(errText(e))}</div>`;
        return;
    }
    const same = res.length > 0 && res.every(r => !r.missing && !r.bad.length);
    const head = same
        ? `<div class="pd-alert info"><b>차이 없음</b> — 짝 ${res.length}개 모두 칸 값이 같습니다(의도된 차이 제외).</div>`
        : `<div class="pd-alert warn"><b>차이 있음</b> — 아래 위치를 엑셀에서 직접 열어 보세요.</div>`;
    const body = res.map(r => {
        let s;
        if (r.missing) s = `짝 없음(${r.missing === 'right' ? 'exe' : '웹'} 쪽에만 있음)`;
        else if (!r.bad.length) s = '차이 없음';
        else s = `그 밖의 차이 ${r.bad.length}곳`;
        const good = r.good.length ? ` · 의도된 차이 ${r.good.length}곳(정수 표기·앞자리 0 — 웹판이 고친 것)` : '';
        return `<div class="sp-cmp-pair"><b>${esc(r.key)}</b> — ${esc(s)}${esc(good)}${r.lines.length ? `<ul>${r.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>` : ''}</div>`;
    }).join('');
    out.innerHTML = head + body;
}
function bindCompare() {
    const cmp = $('sp-compare');
    cmp.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-cmp]');
        if (!b || S.busy) return;
        const act = b.dataset.cmp;
        if (act === 'pick') {
            S.cmp.side = b.dataset.side;
            const inp = $('sp-cmp-input');
            inp.value = '';
            inp.click();
        } else if (act === 'del') {
            S.cmp[b.dataset.side].splice(Number(b.dataset.i), 1);
            $('sp-cmp-out').innerHTML = '';
            renderCompareFiles();
        } else if (act === 'swap') {
            [S.cmp.left, S.cmp.right] = [S.cmp.right, S.cmp.left];
            $('sp-cmp-out').innerHTML = '';
            renderCompareFiles();
        } else if (act === 'run') {
            runCompare();
        }
    });
    $('sp-cmp-input').addEventListener('change', (e) => { if (e.target.files && e.target.files.length) addCompareFiles(S.cmp.side, e.target.files); });
    const isFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    cmp.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
    cmp.addEventListener('drop', (e) => {
        if (!isFiles(e)) return;
        e.preventDefault();
        const col = e.target.closest('[data-side]');
        addCompareFiles(col ? col.dataset.side : 'left', e.dataTransfer.files);
    });
}

// ── 전송(2단계 끝) ──────────────────────────────────────────
/**
 * 이번 묶음을 어떻게 보낼지 — 미리보기(읽기만)로 오늘 같은 묶음·많이 겹치는 묶음을 찾아 묻는다.
 * @returns {Promise<{ key, mode, drop }>}
 */
async function planBatch(location, packs, now, madeOk) {
    const key = await batchKeyOf(location.source, location.rows);
    const batch = { key, mode: 'add', drop: [] };
    let pv = null;
    try {
        pv = await previewBatches(S.db, { rows: location.rows, source: location.source, key, packDay: packs ? packs.day : null }, { enabled: true, now });
    } catch (e) {
        console.warn('[플랫폼 출고] 묶음 미리보기 실패:', (e && e.code) || (e && e.name) || 'unknown');
        logLine('  ⚠ 오늘 보낸 묶음을 미리 읽지 못했습니다 — 새 묶음으로 더합니다(같은 묶음이 이미 있으면 막힙니다).');
        return batch;
    }
    const atOf = (k) => hhmm((pv.today.find(x => x.key === k) || {}).at);
    const MIXED_WARN = 'exe 가 오늘 기록을 덮어쓴 흔적이 있습니다(exe 와 섞임) — 같은 전표를 두 번 보내지 않았는지 로케이션 관리에서 확인하세요.';
    if (pv.lost) {
        // 봉 수에는 이 묶음이 있는데 로케이션 행에는 옛 몫('_')만 — exe 가 오늘 다시 보내며 묶음 내역을 지웠다.
        //   옛 몫에서 이번 몫만 빼는 것은 '이번 묶음이 옛 몫 안에 다 들어 있고(담김) exe 가 같은 소스를 덮어쓴 흔적(mixed)이 없을 때'만.
        //   하나라도 어긋나면 이 묶음 몫을 가릴 수 없다 — 보내지 않는다(트랜잭션 안에서도 같은 검사)
        if (!pv.legacyHolds || pv.mixed) {
            if (pv.mixed) S.runWarns.push(MIXED_WARN);
            return { skip: 'exe 가 같은 소스를 덮어써 이 묶음 몫을 가릴 수 없음 — 보내지 않습니다(로케이션 관리에서 확인)' };
        }
        const at = atOf(key);
        if (!confirm(`${at ? `${at} 에` : '오늘'} 보낸 묶음과 내용이 같지만, exe 기록과 섞여 로케이션에서 이 묶음 몫을 찾을 수 없습니다`
            + `(exe 가 오늘 다시 보내 묶음 내역이 지워짐).\n\n`
            + '확인 = 이번 묶음 몫만 옛 기록에서 빼고 다시 넣습니다(오늘 다른 묶음·exe 몫은 그대로)\n'
            + '취소 = 보내지 않기(만든 파일은 그대로)')) return null;
        batch.mode = 'replace';
        batch.subtractLegacy = true;   // '_' 통째가 아니라 이번 묶음 코드별 수량만 뺀다
        S.runWarns.push('exe 기록과 섞여 이번 묶음 몫을 옛 기록(묶음 내역 없는 몫)에서 코드별로 빼고 다시 넣었습니다 — 오늘 다른 묶음·exe 몫은 그대로입니다.');
        return batch;
    }
    if (pv.sameKey) {
        const at = atOf(key);
        // [만들기]에서 '이미 만든 묶음 — 이 묶음 몫만 다시 바꿉니다'에 확인했으면 다시 묻지 않는다
        const ok = madeOk || confirm(`${at ? `${at} 에` : '오늘'} 보낸 묶음과 내용이 같습니다.\n\n`
            + '확인 = 다시 보내기(그 묶음을 이번 것으로 바꿈 — 두 번 더해지지 않음)\n'
            + '취소 = 보내지 않기(만든 파일은 그대로)');
        if (ok) batch.mode = 'replace';
        else if (confirm('같은 물건을 정말 한 번 더 내보냈나요?\n\n'
            + '확인 = 새 묶음으로 한 번 더 더하기(로케이션 수량·봉 수가 늘어남)\n'
            + '취소 = 보내지 않기')) batch.key = freshKey(key, pv.today.map(t => t.key));
        else return null;
    } else {
        const o = pv.overlaps.find(x => x.share >= OVERLAP_ASK);
        if (o) {
            const who = o.key === LEGACY ? '오늘 exe(또는 옛 방식)가 보낸 몫' : `${atOf(o.key) ? `${atOf(o.key)} 에` : '오늘'} 보낸 묶음`;
            if (confirm(`${who}과 ${Math.round(o.share * 100)}% 겹칩니다 — 고친 전표인가요?\n\n`
                + '확인 = 고친 전표(그 묶음을 빼고 이번 것으로 바꿈)\n'
                + '취소 = 다른 묶음(따로 더함)')) batch.drop = [o.key];
        }
    }
    if (pv.legacy > 0 && !batch.drop.includes(LEGACY)) {
        // '_' 는 exe 가 보낸 몫이거나, exe 가 다시 보내며 묶음 내역이 지워진 웹 묶음이다 — 어느 쪽인지 화면이 가릴 수 없다
        S.runWarns.push(`로케이션에 묶음 내역이 없는 몫 ${fmt(pv.legacy)}개(exe 가 보냈거나, exe 가 다시 보내며 웹 묶음 내역을 지운 것)가 있어 이번 묶음은 따로 더했습니다`
            + ' — 이번 전표를 이미 exe 로 보냈다면 두 번 들어갔으니 로케이션 관리에서 확인하세요(이 몫은 [묶음 빼기]로 뺄 수 없음).');
        logLine(`  ⚠ 오늘 exe 기록과 섞임(묶음 내역 없는 몫 ${fmt(pv.legacy)}개) — 이번 묶음은 따로 더합니다.`);
    }
    if (pv.mixed) S.runWarns.push(MIXED_WARN);   // 옛 몫 경고와 따로 — 둘 다 해당하면 둘 다
    return batch;
}

async function transmit(location, packs, now, madeOk = false) {
    if (!S.settings.transmit) {
        logLine('ℹ 병행 중 — 로케이션 실적·봉 수 기록은 exe 가 합니다(웹판 전송 꺼짐, 쓰지 않음).');
        return null;
    }
    if (!S.canShip) {
        logLine('⚠ 「플랫폼 출고」 권한이 없어 로케이션 전송·봉 수 기록을 하지 않았습니다 — 만든 파일은 정상입니다.');
        return null;
    }
    let T = null;
    let batch = null;
    if (location && location.source) {
        setBusy(true, '로케이션 전송 중…');
        setPhase('전송 중');
        logLine(`  [로케이션 전송] 소스: ${location.source} / 날짜: ${kstDay(now).ymd8}`);
        try {
            batch = await planBatch(location, packs, now, madeOk);
        } catch (e) {   // 묶음 키를 못 만들면(브라우저 암호 기능 없음) 보내지 않는다 — 덮어쓰기로 돌아가지 않게
            console.warn('[플랫폼 출고] 묶음 키 실패:', (e && e.name) || 'unknown');
            logLine(`  ⚠ 로케이션 전송 실패 — 만든 파일은 정상입니다: ${errText(e)}`);
            return null;
        }
        if (!batch || batch.skip) {   // 확인창에서 '보내지 않기' · 또는 이 묶음 몫을 가릴 수 없어 멈춤
            const why = batch && batch.skip ? batch.skip : '확인창에서 보내지 않기';
            logLine(`  ⚠ 로케이션 전송·봉 수 기록을 하지 않았습니다(${why}) — 만든 파일은 정상입니다.`);
            S.runWarns.push(`이번 묶음은 로케이션 관리·봉 수에 보내지 않았습니다(${why}). 만든 파일은 정상입니다.`);
            const T0 = { source: location.source, packDay: packs ? packs.day : null, key: null, day8: kstDay(now).ymd8, today: null };
            await refreshBatches(T0, location.rows, now);
            return T0;
        }
        T = { source: location.source, packDay: packs ? packs.day : null, key: batch.key, day8: kstDay(now).ymd8, today: null };
        // 로케이션 먼저, 성공했을 때만 봉 수(js/lib/ship-tx.js sendBatchWith — 한쪽만 들어가지 않게)
        const tot = codeTotals(location.rows);
        const s = await sendBatch(S.db, { rows: location.rows, source: location.source, packs, batch,
            q: [...tot.values()].reduce((a, b) => a + b, 0), k: tot.size }, { enabled: true, now });
        if (s.locationError) {
            const e = s.locationError;
            console.warn('[플랫폼 출고] 로케이션 전송 실패:', (e && e.code) || (e && e.name) || 'unknown');
            logLine(`  ⚠ 로케이션 전송 실패 — 만든 파일은 정상입니다: ${errText(e)}`);
            if (s.packsSkipped) logLine('  ⚠ 봉 수 기록도 하지 않았습니다(로케이션과 어긋나지 않게).');
        } else {
            const r = s.location;
            logLine(`  ✓ 로케이션 전송 완료 (오늘 합본 ${r.total}건, 이번 소스 ${r.thisSource}건, 문서 ${r.chunks}개${r.deleted ? `, 옛 문서 ${r.deleted}개 정리` : ''})`);
        }
        if (s.packs) {
            const r = s.packs;
            logLine(`  봉 수 기록: ${r.day} ${r.source} ${r.count}봉 (그날 ${r.channel === 'zikjin' ? '직진' : '에이블리'} 합계 ${r.total}봉)`);
            if (r.mixed && !S.runWarns.some(w => w.includes('exe'))) S.runWarns.push('봉 수 기록에 exe 가 쓴 몫이 섞여 있습니다(exe 와 섞임) — 같은 전표를 두 번 보내지 않았는지 확인하세요.');
        } else if (s.packsError) {
            const e = s.packsError;
            console.warn('[플랫폼 출고] 봉 수 기록 실패:', (e && e.code) || (e && e.name) || 'unknown');
            logLine(`  ⚠ 봉 수 기록 실패 — 만든 파일은 정상입니다: ${errText(e)}`);
        }
    } else {
        logLine('  ⚠ 로케이션 전송 건너뜀: 출고요청 파일이 없어 일반/즉시출고를 구분할 수 없음');
    }
    if (T) await refreshBatches(T, location.rows, now);
    return T;
}

// ── 실행 ───────────────────────────────────────────────────
async function ablyTemplateFile() {
    const f = S.files.ably[2].template;
    if (f) return f;
    const res = await fetch(ABLY_TEMPLATE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`앱 기본 대량입고 양식을 받지 못했습니다(${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { name: '엑셀_대량_입고_양식.xlsx', bytes, size: bytes.byteLength, from: 'app' };
}

async function refreshSettings() {
    try {
        S.settings = await loadSettings(S.db);
        S.settingsRead = true;
    } catch (e) {
        console.warn('[플랫폼 출고] 설정 읽기 실패:', (e && e.code) || 'unknown');
        if (!S.settingsRead) S.settings = normalizeSettings(null);   // 한 번도 못 읽었으면 기본값(전송 끔)
    }
}

/** @param {{auto?: boolean}} opts  auto = 파일을 놓아 저절로 시작(같은 묶음 확인은 dropMany 가 이미 했다 — 묻지 않는다) */
async function run(opts = {}) {
    if (S.busy) return;
    const auto = opts.auto === true;
    const tab = S.tab, step = S.step[tab];
    const f = { ...S.files[tab][step] };   // 실행 중에 칸이 바뀌어도 이번 실행은 누른 순간의 파일로
    const missing = SLOT_META[tab][step].filter(m => m.req && !f[m.id]).map(m => m.title);
    if (missing.length) { toast(`넣어야 할 파일: ${missing.join(', ')}`); return; }
    let base = '', limit = 0;
    if (step === 2) {
        base = String(S.base[tab] || '').trim();
        limit = parseLimit(S.limitText[tab]);
        if (!base) { toast('패키지명 베이스를 넣어 주세요.'); return; }
        if (limit === null) { toast('봉투당 최대 수량은 1~999 정수입니다.'); return; }
    }
    setBusy(true, '저장 폴더 확인 중…');   // 두 번 눌러도 한 번만(바쁨 표시는 클릭 권한을 쓰지 않는다)
    const now = new Date();
    S.why = '';
    S.phases = step === 2 && transmitOn() ? PHASES : PHASES.slice(0, 3);
    let ok = false;
    let summaryIn = null;
    let T = null;
    let mk = null;
    try {
        try { await S.saver.prepare(); } catch (_) { /* 못 하면 다운로드로 받는다 */ }   // 클릭 안에서 — 폴더를 한 번 묻거나 권한을 받는다
        renderFolder();
        // 같은 날 같은 묶음 — 폴더 권한을 받은 뒤에 묻는다(확인창이 클릭 권한을 쓰지 않게)
        try { mk = await madeKeyOf(tab, step, f); } catch (_) { mk = null; }
        const prev = mk ? findMade(madeState(), mk) : null;
        let madeOk = false;
        if (prev && !auto) {
            if (!confirm(madeConfirmText(prev, { step, transmit: transmitOn() }))) {
                toast('다시 만들지 않았습니다.');
                return;
            }
            madeOk = step === 2;
        }
        setBusy(true, '라이브러리 불러오는 중…');
        S.results = [];
        S.last = null;
        S.runLog = [];
        S.runWarns = [];
        renderResults();
        logLine(`===== ${TAB_LABEL[tab]} ${step}단계 시작 =====`);
        const { X, JSZip, ExcelJS } = await loadLibs();
        if (step === 2) await refreshSettings();   // 전송 켬·지정상품 규칙은 실행 직전 값으로
        renderTransmit();
        S.phases = step === 2 && transmitOn() ? PHASES : PHASES.slice(0, 3);
        setBusy(true, '파일 읽는 중…');
        setPhase('읽는 중');
        await tick();
        if (step === 1) {
            const reqBook = readBook(X, f.request.bytes, f.request.name);
            setPhase('계산 중');
            await tick();
            const r = tab === 'zikjin' ? zikjinStep1({ request: reqBook, now }) : ablyStep1({ request: reqBook, now });
            r.log.forEach(logLine);
            setPhase('저장 중');
            const x = stockXlsBytes(X, r);
            if (x.problem) throw new Error(x.problem);
            await saveOut(r.fileName, x.bytes);
            const req2 = { name: f.request.name, bytes: f.request.bytes, size: f.request.size, from: 'step1', summary: f.request.summary, hash: f.request.hash };
            S.files[tab][2].request = req2;
            S.files[tab][2].admin = null;   // 지난 묶음 출고전표가 남아 새 출고요청과 섞이지 않게(새 출고전표를 기다림)
            logLine('  → 출고요청 파일을 2단계 칸에 넣어 두었습니다.');
            Object.assign(S.session[tab], { step1Result: r.fileName, step1For: f.request, step1Req: req2 });
            summaryIn = { result: r };
        } else if (tab === 'zikjin') {
            const warn = baseDateWarning(base, now);
            if (warn) logLine(warn);
            const admin = readBook(X, f.admin.bytes, f.admin.name);
            const template = readBook(X, f.template.bytes, f.template.name, { formulas: true, sheets: TEMPLATE_SHEETS });
            setPhase('계산 중');
            await tick();
            const r = zikjinStep2({
                admin, template,
                request: f.request ? () => readBook(X, f.request.bytes, f.request.name) : null,
                requestName: f.request ? f.request.name : null,
                packageBase: base, packageLimit: limit, specialRules: S.settings.specialRules, now,
            });
            r.log.forEach(logLine);
            setBusy(true, '출고리스트 쓰는 중…');
            setPhase('저장 중');
            await tick();
            const w = await zikjinListBytes(JSZip, f.template.bytes, r);
            await saveOut(r.fileName, w.bytes);
            const p = await pickingBytes(ExcelJS, r.pickItems, 'ZG');
            if (p.bytes) await saveOut(r.pickFileName, p.bytes); else logLine(p.warning);
            T = await transmit(r.location, r.packs, now, madeOk);
            summaryIn = { result: r };
        } else {
            const warn = baseDateWarning(base, now);
            if (warn) logLine(warn);
            const tmpl = await ablyTemplateFile();
            const admin = readBook(X, f.admin.bytes, f.admin.name);
            const request = readBook(X, f.request.bytes, f.request.name);
            const template = readBook(X, tmpl.bytes, tmpl.name);
            setPhase('계산 중');
            await tick();
            const r = ablyStep2({ admin, request, template, requestName: f.request.name, packageBase: base, packageLimit: limit, now });
            r.log.forEach(logLine);
            let requestTotal = null;
            try { requestTotal = readAblyRequest(request, []).reduce((s, x) => s + x.qty, 0); } catch (_) { requestTotal = null; }
            setBusy(true, '대량입고 양식 쓰는 중…');
            setPhase('저장 중');
            await tick();
            const w = await ablyBulkBytes(JSZip, tmpl.bytes, r);
            await saveOut(r.fileName, w.bytes);
            const p = await pickingBytes(ExcelJS, r.pickItems, 'AB');
            if (p.bytes) await saveOut(r.pickFileName, p.bytes); else logLine(p.warning);
            T = await transmit(r.location, r.packs, now, madeOk);
            summaryIn = { result: r, requestTotal };
        }
        logLine(`===== 완료 =====`);
        toast(`${TAB_LABEL[tab]} ${step}단계 완료`);
        ok = true;
    } catch (e) {
        console.warn('[플랫폼 출고] 실행 실패:', (e && e.code) || (e && e.name) || 'Error');
        logLine(`✗ 실패: ${errText(e)}`);
        toast('실패 — 진행 기록을 확인하세요', 5000);
        $('sp-log-box').open = true;   // 실패하면 진행 기록을 펼친다
        if (S.runLog) S.last = { tab, step, failed: true, summary: null, warns: [], transmit: null };
    } finally {
        if (ok && summaryIn) {
            let summary;
            try {
                summary = summarizeRun({ tab, step, result: summaryIn.result, base, limit, now, requestTotal: summaryIn.requestTotal ?? null, log: S.runLog || [] });
            } catch (e) {   // 요약을 못 세도 만든 파일·전송은 그대로 — 제목만 간단히
                console.warn('[플랫폼 출고] 결과 요약 실패:', (e && e.name) || 'Error');
                summary = { title: `✅ ${TAB_LABEL[tab]} ${step}단계 완료`, warns: [] };
            }
            S.last = { tab, step, failed: false, transmit: T, warns: [...S.runWarns], summary };
            if (mk) saveMade(mk, tab, step);   // 성공했을 때만 기록
            if (step === 2) S.session[tab].step2For = f.admin;
            S.cmp.right = S.results.map(x => ({ name: x.name, bytes: x.bytes, size: x.bytes.byteLength, from: 'web' }));
            $('sp-cmp-out').innerHTML = '';
        }
        S.runLog = null;
        S.phase = '';
        S.recog = '';
        setBusy(false);
        render();
    }
}

// ── 설정(공용) ─────────────────────────────────────────────
function openSettings() {
    const st = S.settings;
    const rules = st.specialRules.length ? st.specialRules : [];
    const canSave = S.canShip;
    const body = $('sp-modal-body');
    const ruleRow = (r) => `<tr><td><input class="pd-in" data-r="name" value="${esc(r.name)}" maxlength="40" placeholder="상품명에 든 글자"></td>
        <td class="n"><input class="pd-in num" data-r="limit" value="${esc(r.limit)}" maxlength="3" inputmode="numeric"></td>
        <td class="x"><button class="d-btn d-btn-sm" data-r="del" aria-label="줄 빼기">✕</button></td></tr>`;
    body.innerHTML = `
        ${S.settingsRead ? '' : '<div class="pd-alert warn">공용 설정을 읽지 못했습니다 — 저장하면 지금 보이는 값으로 덮어씁니다.</div>'}
        <div class="pd-grid2" style="margin-top:0;">
            <label class="pd-field">직진배송 봉투당 최대 수량 <input id="sp-s-zik" class="pd-in num" value="${esc(st.zikjinLimit)}" maxlength="3" inputmode="numeric"></label>
            <label class="pd-field">에이블리 봉투당 최대 수량 <input id="sp-s-ably" class="pd-in num" value="${esc(st.ablyLimit)}" maxlength="3" inputmode="numeric"></label>
        </div>
        <div>
            <h3 class="pd-h3">직진배송 지정상품 규칙</h3>
            <p class="pd-note">상품명에 이 글자가 들어 있으면 한 줄을 이 수량씩 나눕니다(0 = 끔). 최대 ${MAX_RULES}개.</p>
            <table class="sp-rules"><thead><tr><th>상품명에 든 글자</th><th>한 번에 최대</th><th></th></tr></thead>
                <tbody id="sp-s-rules">${rules.map(ruleRow).join('')}</tbody></table>
            <button id="sp-s-add" class="d-btn d-btn-sm" style="margin-top:8px;">줄 추가</button>
        </div>
        <label class="sp-check"><input type="checkbox" id="sp-s-transmit" ${st.transmit ? 'checked' : ''} ${S.isAdmin ? '' : 'disabled'}>
            <span><b>로케이션 실적·봉 수 전송 켬</b><br><span class="pd-note">2단계를 마치면 로케이션 관리(ZikjinData)에 실제 출고 수량을, 비품 예측(봉 수)에 봉 수를 씁니다.
            같은 날 여러 묶음은 묶음마다 더합니다. 병행 기간에는 끄고(exe 가 기록) exe 를 멈출 때 켭니다. ${S.isAdmin ? '' : '<b>관리자만 바꿀 수 있습니다.</b>'}</span></span></label>
        <div id="sp-s-err" class="pd-alert risk" hidden></div>
        <div class="pd-actions" style="margin-top:0;">
            <span class="pd-note">${st.updatedAt ? `마지막 저장 ${esc(savedText(st.updatedAt) || st.updatedAt)}` : '아직 저장한 적 없음(기본값)'}</span>
            <div class="pd-grow"></div>
            <button id="sp-s-save" class="d-btn d-btn-primary" ${canSave ? '' : 'disabled title="「플랫폼 출고」 권한이 필요합니다"'}>저장(모두에게 적용)</button>
        </div>`;
    const tbody = $('sp-s-rules');
    $('sp-s-add').addEventListener('click', () => {
        if (tbody.children.length >= MAX_RULES) { toast(`최대 ${MAX_RULES}개입니다.`); return; }
        tbody.insertAdjacentHTML('beforeend', ruleRow({ name: '', limit: 0 }));
    });
    tbody.addEventListener('click', (e) => { const b = e.target.closest('button[data-r="del"]'); if (b) b.closest('tr').remove(); });
    $('sp-s-save').addEventListener('click', async () => {
        const edit = {
            zikjinLimit: $('sp-s-zik').value, ablyLimit: $('sp-s-ably').value,
            specialRules: [...tbody.querySelectorAll('tr')].map(tr => ({ name: tr.querySelector('[data-r="name"]').value, limit: tr.querySelector('[data-r="limit"]').value })),
        };
        const { value, errors } = validateEdit(edit);
        const err = $('sp-s-err');
        if (errors.length) { err.hidden = false; err.textContent = errors.join(' '); return; }
        err.hidden = true;
        const btn = $('sp-s-save');
        btn.disabled = true; btn.textContent = '저장 중…';
        try {
            const fields = settingsWrite(value, { isAdmin: S.isAdmin, transmit: $('sp-s-transmit').checked, before: S.settings, nowIso: new Date().toISOString() });
            await saveSettings(S.db, fields);
            await refreshSettings();
            S.limitText = { zikjin: '', ably: '' };   // 공용 값으로 다시 채운다
            closeSettings();
            render();
            toast('설정을 저장했습니다(모두에게 적용)');
        } catch (e) {
            console.warn('[플랫폼 출고] 설정 저장 실패:', (e && e.code) || 'unknown');
            err.hidden = false;
            err.textContent = e && e.code === 'permission-denied'
                ? '저장 권한이 없습니다 — 「플랫폼 출고」 권한(전송 켜기는 관리자)이 필요하거나 규칙이 아직 게시되지 않았습니다.'
                : `저장하지 못했습니다: ${errText(e)}`;
            btn.disabled = false; btn.textContent = '저장(모두에게 적용)';
        }
    });
    $('sp-modal').classList.remove('hidden');
}
function closeSettings() { $('sp-modal').classList.add('hidden'); }

// ── 시작 ───────────────────────────────────────────────────
async function checkPerm(user) {
    const snap = await getDocFromServer(doc(S.db, APP_BASE + '/config/mainConfig'));
    const cfg = snap.exists() ? snap.data() : {};
    const memberName = memberNameFor(cfg.memberEmails, user.email);
    if (memberName && S.auth.currentUser && S.auth.currentUser.uid === user.uid) setShellContext({ signedIn: true, uid: user.uid, memberName });
    const r = resolve(cfg, user.email);
    return { isAdmin: r.isAdmin, canShip: can(r, 'ship.platform') };
}

async function restoreFromPc() {
    try {
        S.store = await openShipStore();
    } catch (e) {
        console.warn('[플랫폼 출고] 이 PC 저장소 열기 실패:', (e && e.name) || 'unknown');
        S.store = null;
    }
    S.saver = createSaver({ win: window, remember: S.store, key: KEY_OUT_DIR });
    await S.saver.restore();
    if (!S.store) return;
    try {
        const rec = await S.store.get(KEY_TEMPLATE);
        if (isFileRecord(rec)) {
            S.files.zikjin[2].template = { name: rec.name, bytes: new Uint8Array(rec.bytes), size: rec.size, from: 'pc', savedAt: rec.savedAt };
        }
    } catch (e) {
        console.warn('[플랫폼 출고] 기억한 원본 읽기 실패:', (e && e.name) || 'unknown');
    }
}

let startedUid = null;
async function start(user) {
    startedUid = user.uid;
    S.user = user;
    setLoading(true, '권한 확인 중…');
    try { Object.assign(S, await checkPerm(user)); }
    catch (e) { console.warn('[플랫폼 출고] 권한 확인 실패:', (e && e.code) || 'unknown'); S.isAdmin = false; S.canShip = false; }
    await refreshSettings();
    await restoreFromPc();
    readHash();
    $('pd-app').style.display = 'block';
    setLoading(false);

    $('sp-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('.d-seg-btn'); if (!b || S.busy) return;
        S.tab = b.dataset.tab; resetView(); writeHash(); render();
    });
    $('sp-steps').addEventListener('click', (e) => {
        const b = e.target.closest('.d-seg-btn'); if (!b || S.busy) return;
        S.step[S.tab] = Number(b.dataset.step); resetView(); writeHash(); render();
    });
    window.addEventListener('hashchange', () => { if (S.busy) return; readHash(); resetView(); render(); });
    $('sp-run').addEventListener('click', () => run());
    $('sp-log-clear').addEventListener('click', () => { $('sp-log').value = ''; });
    $('sp-settings-btn').addEventListener('click', () => { if (!S.busy) openSettings(); });
    $('sp-modal-close').addEventListener('click', closeSettings);
    $('sp-folder').addEventListener('click', async () => {
        if (S.busy) return;
        if (!S.saver.supportsFolder()) { toast('이 브라우저는 폴더에 바로 쓸 수 없어 다운로드로 받습니다.'); return; }
        const ok = await S.saver.chooseFolder();
        renderFolder();
        if (ok) toast(`저장 폴더: ${S.saver.folderName}`);
    });
    bindDrop();
    bindResults();
    bindBatches();
    bindCompare();
    render();
}

// 처리 중에 떠나면 만들던 파일이 사라진다
window.addEventListener('beforeunload', (e) => {
    if (!S.busy || leaveAlreadyConfirmed()) return;
    e.preventDefault();
    e.returnValue = '';
});
onBeforeLeave(() => !S.busy || confirm('파일을 만드는 중입니다. 지금 나가면 만들던 결과가 사라집니다. 나갈까요?'));

const { db, auth } = initializeFirebase();
S.db = db; S.auth = auth;
// 🧪 ?emu=1 인데 에뮬레이터 연결이 안 됐으면(띠가 없으면) 운영으로 붙을 위험 — 멈춘다
const emuBad = emulatorEnabled() && !document.getElementById('emulator-banner');
if (!db || !auth || emuBad) {
    setLoading(false);
    showGate(`<div style="font-size:16px; font-weight:600;">${emuBad ? '에뮬레이터 연결 실패 — 창을 닫으세요(운영 데이터 보호)' : 'Firebase 초기화 실패 — 새로고침해 보세요'}</div>`);
} else {
    onAuthStateChanged(auth, (user) => {
        if (startedUid && (!user || user.uid !== startedUid)) { location.reload(); return; }
        if (!user) { setShellContext({ signedIn: false }); setLoading(false); showLogin(auth); return; }
        setShellContext({ signedIn: true, uid: user.uid });
        removeGate();
        if (!startedUid) start(user);
    });
}
