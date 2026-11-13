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
// 2026-11-12 화면 방식: 늘 통합으로 연다(위 자동 인식·저절로 시작 — 지금 단계·칸 안내는 숨기고 넣은 파일은 한 줄 요약).
//   머리줄 [개별 선택] › 직진배송·에이블리 = 기존 방식(고른 쪽 1·2단계 칸만, 놓으면 지금 단계 칸에만 넣고 저절로 시작 안 함 — dropLegacy),
//   그 위에 '개별 선택: … · [통합으로 돌아가기]' 띠. 방식은 화면만 바꾼다: 만들기·저장·전송·봉 수·묶음 합산·[묶음 빼기]는 같은 run()·transmit().
//   방식은 기억하지 않는다 — 예전 기억(localStorage js/lib/ship-flow.js MODE_STORE_KEY)은 열 때 지운다.
// 2026-11-12 기본 양식(직진 출고리스트·에이블리 대량입고)은 [설정] › 기본 양식에서 관리자가 올린다(Storage ship/templates/zikjin.xlsx·ably.xlsx).
//   에이블리는 앱 양식이 없거나 못 읽으면 assets 의 기본 양식을 쓴다(ABLY_TEMPLATE_URL).
// 지킬 것
//   · 엑셀 행 내용(상품코드·상품명·수량)은 화면 진행 기록에만 쓴다 — 콘솔·Firestore 로그에 남기지 않는다(콘솔은 오류 코드만).
//   · 직진배송출고리스트 원본(마스터)은 2026-11-12 에 없앴다 — 2단계는 출고요청(SKU·상품명·옵션)+전표(바코드·수량)로 만들고,
//     빈 양식은 앱 Storage ship/templates/zikjin.xlsx(관리자만 올림, storage.rules)에서 받는다. 올리기 전에 이 브라우저에서
//     머리글만 남기고 자료 행을 지운다(js/lib/ship-write.js cleanZikjinTemplate). 옛 PC 기억(IndexedDB)은 열 때 지운다.
//     임시 길(저장소 규칙 게시 전): 앱 양식을 못 읽으면 '양식 준비 중'을 띄우고 2단계에 원본(임시) 칸을 열어 옛 방식처럼 그 원본에 쓴다(ZG_TEMP_SLOT).
//   · 전송이 꺼져 있으면(transmit false, 병행 초기) Firestore 쓰기 함수를 아예 부르지 않는다 — 기록은 옛 exe 가 한다.
//   · 라이브러리는 이 페이지에서만 CDN 지연 로드: SheetJS 0.20.3(ESM — 다른 화면의 전역 XLSX 0.18.5 와 섞이지 않게)·JSZip 3.10.2·ExcelJS 4.4.0.
// 권한: 입장은 js/page-gate.js(ship.platform). 설정 저장·전송은 규칙이 막는다. 전송 켜기(transmit)는 관리자만.
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage, ref as sRef, uploadBytes, getBlob, getMetadata } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import { initializeFirebase } from './config.js?v=202611131027';
import { emulatorEnabled, connectStorageEmulatorIfEnabled } from './firebase-emulator.js?v=202611131027';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202611131027';
import { memberNameFor } from './app-shell-data.js?v=202611131027';
import { friendlyFirebaseError } from './utils.js?v=202611131027';
import { resolve, can } from './lib/perm.js?v=202611131027';
import { readBook } from './lib/ship-read.js?v=202611131027';
import { zikjinStep1, zikjinStep2 } from './lib/ship-zikjin.js?v=202611131027';
import { ablyStep1, ablyStep2, readAblyRequest } from './lib/ship-ably.js?v=202611131027';
import { zikjinListBytes, ablyBulkBytes, stockXlsBytes, cleanZikjinTemplate, zikjinTemplateProblem, cleanAblyTemplate, ablyTemplateProblem } from './lib/ship-write.js?v=202611131027';
import { pickingBytes } from './lib/ship-picking.js?v=202611131027';
import { kstDay, baseDateWarning, targetArea, STOCK_OUT_MSG, PACK_PREFIX, baseDatePart, packageNameBase } from './lib/ship-core.js?v=202611131027';
import { peekBook, classifyPeek, assignFiles, routeFiles, SLOTS, KIND, KIND_LABEL } from './lib/ship-assign.js?v=202611131027';
import { openShipStore, isFileRecord, sizeText, savedText, KEY_TEMPLATE, KEY_OUT_DIR } from './lib/ship-file-store.js?v=202611131027';
import { createSaver, mimeOf } from './lib/save-file.js?v=202611131027';
import { normalizeSettings, validateEdit, settingsWrite, parseLimit, activeRuleCount, MAX_RULES } from './lib/ship-settings.js?v=202611131027';
import { flowState, foldState, modeView, loadMode, tabForMode, MODE_STORE_KEY, MODE_LABEL } from './lib/ship-flow.js?v=202611131027';
import { summarizeRun, fileSummary, SUMMARY_MAX_BYTES } from './lib/ship-summary.js?v=202611131027';
import { madeKey, loadMade, findMade, recordMade, madeConfirmText, MADE_STORE_KEY } from './lib/ship-made.js?v=202611131027';
import { gridOf, comparePairs } from './lib/ship-compare.js?v=202611131027';
import { batchKeyOf, codeTotals, freshKey, sha256Hex, LEGACY } from './lib/ship-batch.js?v=202611131027';
import { loadSettings, saveSettings, sendBatch, previewBatches, removeBatch } from './ship-store.js?v=202611131027';

const $ = (id) => document.getElementById(id);
const APP_BASE = 'artifacts/team-work-logger-v2';
const LIB = {
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs',
    cptable: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/cpexcel.full.mjs',
    jszip: 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.2/jszip.min.js',
    exceljs: 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js',
};
// script 로 넣는 것만 SRI(받은 파일로 계산한 sha384, 버전 올릴 때 다시 계산). xlsx·cptable 은 import() 라 SRI 를 못 붙인다 — 버전 고정만.
const LIB_SRI = {
    [LIB.jszip]: 'sha384-DdGlNq+wVXAn83gXqwyeFHB7iyXy6L0rLrNzgDmhKWPjiJLg9vj6qosYmZmkMfQ+',
    [LIB.exceljs]: 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz',
};
const ABLY_TEMPLATE_URL = 'assets/ship/엑셀_대량_입고_양식.xlsx';   // 에이블리 앱 양식(ship/templates/ably.xlsx)이 없거나 못 읽을 때 쓰는 기본 양식
// 기본 양식(빈 서식) — 관리자가 [설정] › 기본 양식에서 올린다(storage.rules ship/templates). 5MB = 규칙 한도와 같게
// ★ 관리자 [양식 올리기] 스위치(직진·에이블리 같이) — 저장소 규칙(storage.rules ship/templates, 관리자만 올리기)을 게시한 뒤 true 로 바꾼다.
//   false 면 버튼을 막고 '저녁 규칙 게시 뒤 사용' 안내만(규칙 게시 전에는 운영 규칙이 이 경로를 관리자만으로 막지 못할 수 있다).
const ZG_TEMPLATE_UPLOAD_ON = true; 
const ZG_UPLOAD_OFF_TEXT = '양식 올리기는 저장소 규칙을 게시한 뒤(오늘 저녁)부터 씁니다.';
const ZG_TEMPLATE_PATH = 'ship/templates/zikjin.xlsx';
const AB_TEMPLATE_PATH = 'ship/templates/ably.xlsx';
const ZG_TEMPLATE_MAX = 5 * 1024 * 1024;
const TMPL_PATH = { zikjin: ZG_TEMPLATE_PATH, ably: AB_TEMPLATE_PATH };
const TMPL_NAME = { zikjin: '직진배송 출고리스트 양식', ably: '에이블리 대량입고 양식' };
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const ZG_TEMPLATE_MISSING = '출고리스트 양식(관리자 등록)';
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
            { id: 'admin', title: '이지어드민 출고전표', short: '출고전표', req: true, hint: '1단계 파일을 이지어드민에 올린 뒤 받은 전표 · 바코드·수량' },
            { id: 'request', title: '출고요청', short: '출고요청', req: true, hint: '1단계에서 자동 · SKU번호·상품명·옵션, 일반/즉시출고 구분' },
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
// 임시 길(2026-11-12 — 저장소 규칙 게시 전까지): 앱 양식을 못 쓰면(아직 안 올림·권한 없음·못 읽음) 직진 2단계에 원본 칸을 다시 연다.
//   넣은 원본은 옛 방식처럼 그 파일에 바로 쓴다(시트1 8행 아래는 지우고 다시 씀 — ship-write.zikjinListBytes). 계산은 새 방식 그대로
//   (SKU·상품명·옵션 = 출고요청). 이 PC 에 새로 기억하지 않는다(예전에 기억한 원본이 있으면 그것을 칸에 넣어 준다).
const ZG_TEMP_SLOT = { id: 'template', title: '직진배송출고리스트 원본(임시)', short: '원본(임시)', req: true,
    hint: '양식 준비 중 — 원본을 넣으면 그 파일의 서식에 씁니다(이 PC 안에서만, 저장·기억 안 함)' };
const zgFallback = () => S.zgTmpl.state === 'none' || S.zgTmpl.state === 'error';
/** 지금 화면의 칸 — 직진 2단계는 앱 양식을 못 쓸 때만 원본(임시) 칸이 붙는다 */
const slotsOf = (tab, step) => (tab === 'zikjin' && step === 2 && zgFallback() ? [...SLOT_META.zikjin[2], ZG_TEMP_SLOT] : SLOT_META[tab][step]);
const STEP_DESC = {
    zikjin: {
        1: '출고요청 → 재고출고용_YYMMDD.xls(이지어드민 업로드용). 끝나면 출고요청이 2단계 칸에 저절로 들어갑니다.',
        2: '출고전표 + 출고요청(+ 앱에 저장된 양식) → 직진배송출고리스트_YYMMDD.xlsx + ZG_피킹작업지시서_YYMMDD.xlsx',
    },
    ably: {
        1: '도착보장출고요청 → 에이블리_재고출고용_YYMMDD.xls(이지어드민 업로드용). 끝나면 2단계 칸에 저절로 들어갑니다.',
        2: '출고전표 + 도착보장출고요청(+ 양식) → 에이블리_대량입고_YYMMDD.xlsx + AB_피킹작업지시서_YYMMDD.xlsx',
    },
};
const STEP2_LABEL = { zikjin: '2단계 · 출고리스트', ably: '2단계 · 대량입고' };
// [exe 결과와 비교하기] 의도된 차이 이름 → 화면 글(js/lib/ship-compare.js intended·intendedAt)
const CMP_WHY = { INT_FLOAT: '정수 표기', HTML_ZERO: '앞자리 0', PACK_PREFIX: '패키지명 앞 ZG·AB', NO_MASTER: '시즌·공장상품명 빈칸(원본 없이 만들기)' };

const emptyFiles = () => ({ 1: { request: null }, 2: { admin: null, template: null, request: null } });
const emptySession = () => ({ step1Result: null, step1For: null, step1Req: null, step2For: null });
const S = {
    app: null, db: null, auth: null, storage: null, user: null, isAdmin: false, canShip: false,
    // 직진 출고리스트 양식(앱 Storage) — state: 'loading' | 'ok' | 'none'(아직 안 올림) | 'error'(못 읽음)
    zgTmpl: { state: 'loading', updated: '', size: 0, gen: '', bytes: null, bytesGen: '', err: '' },
    // 에이블리 대량입고 양식(앱 Storage, 2026-11-12) — 같은 state. 'ok' 가 아니면 assets 기본 양식을 쓴다
    abTmpl: { state: 'loading', updated: '', size: 0, gen: '', bytes: null, bytesGen: '', err: '' },
    tmplPick: null,   // [설정] › 기본 양식에서 고른 쪽('zikjin'|'ably') — 파일 고르기 창이 돌아올 때
    settings: normalizeSettings(null), settingsRead: false,
    // 화면 방식(2026-11-12) — 'auto' 통합(기본) · 'zikjin'·'ably' 기존 방식. 화면만 바꾸고 만들기·전송은 같은 코드(js/lib/ship-flow.js modeView)
    mode: 'auto',
    tab: 'zikjin', step: { zikjin: 1, ably: 1 },
    files: { zikjin: emptyFiles(), ably: emptyFiles() },   // 파일 = { name, bytes: Uint8Array, size, from: 'drop'|'step1'|'pc'|'app', savedAt?, summary?, hash? }
    base: { zikjin: '', ably: '' }, limitText: { zikjin: '', ably: '' },
    busy: false, results: [], store: null, saver: null, pickSlot: null,
    // 2026-11-12 화면 개선
    session: { zikjin: emptySession(), ably: emptySession() },   // 흐름 표시용 — 이번에(새로고침 전) 마친 단계
    last: null,          // 결과 카드 { tab, step, failed, summary, warns, transmit: { source, packDay, key, today } | null }
    recog: '', phase: '', phases: [], why: '',
    foldOpen: false, advOpen: false, optsKey: '',
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
    document.querySelectorAll('#sp-slots button, #sp-tabs button, #sp-steps button, #sp-settings-btn, #sp-folder, #sp-pick-many, #sp-fold button, #sp-batches button, #sp-compare button, #sp-pick-mode, #sp-mode-menu button, #sp-mode-back, #sp-s-tmpl button')
        .forEach(b => { b.disabled = on; });
    if (on) closeModeMenu();
    if (!on) renderTemplateRows();   // 설정 창 양식 칸 — 잠금(올리기 꺼짐)·관리자 여부는 다시 그려서 맞춘다
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
        if (LIB_SRI[src]) { s.integrity = LIB_SRI[src]; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer'; }
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
        if (S.tab === 'ably' && S.step.ably === 2 && slotId === 'template') {
            return S.abTmpl.state === 'ok'
                ? '<span class="sp-empty">앱에 올린 양식(관리자 등록)을 씁니다</span>'
                : '<span class="sp-empty">기본 양식(앱에 들어 있음)을 씁니다</span>';
        }
        return '<span class="sp-empty">여기에 끌어다 놓거나 [파일 선택]</span>';
    }
    return `<b>${esc(f.name)}</b>`;
}
function fileMeta(f) {
    if (!f) return '';
    const from = { step1: '1단계에서 자동으로 넣음', app: '앱 기본 양식', pc: '이 PC 가 예전에 기억한 원본(임시로 씀)' }[f.from] || '';
    const parts = [sizeText(f.size)];
    if (from) parts.push(from);
    return parts.join(' · ');
}

function renderSlots() {
    const tab = S.tab, step = S.step[tab];
    const box = $('sp-slots');
    box.innerHTML = slotsOf(tab, step).map(m => {
        const f = S.files[tab][step][m.id];
        return `<div class="sp-slot${f ? ' is-filled' : ''}" data-slot="${esc(m.id)}">
            <div class="sp-slot-head"><span class="sp-slot-title">${esc(m.title)}</span>
                <span class="sp-slot-tag${m.req ? ' req' : ''}">${m.req ? '필수' : '선택'}</span></div>
            <div class="sp-slot-file">${fileLine(f, m.id)}</div>
            <div class="sp-slot-meta">${esc(f ? fileMeta(f) : m.hint)}</div>
            ${f && f.summary ? `<div class="sp-slot-sum">${esc(f.summary)}</div>` : ''}
            <div class="sp-slot-btns">
                <button class="d-btn d-btn-sm" data-sp="pick">파일 선택</button>
                ${f ? '<button class="d-btn d-btn-sm" data-sp="clear">빼기</button>' : ''}
            </div>
        </div>`;
    }).join('');
    if (S.busy) box.querySelectorAll('button').forEach(b => { b.disabled = true; });
}

/** 칸이 모두 찼거나 기본값이면 접는다(#sp-fold) */
function renderFold() {
    const tab = S.tab, step = S.step[tab];
    const slots = slotsOf(tab, step).map(m => {
        const f = S.files[tab][step][m.id];
        return {
            title: m.short, file: !!f,
            isDefault: !f && tab === 'ably' && step === 2 && m.id === 'template',
        };
    });
    const st = foldState(slots);
    const auto = modeView(S.mode).auto;
    // 통합은 칸을 늘 한 줄 요약으로 접는다(직접 보려면 [칸 보기]) — 칸·안내는 기존 방식 화면의 것
    const fold = (st.fold || auto) && !S.foldOpen;
    $('sp-slots').hidden = fold;
    $('sp-drop-hint').hidden = fold || auto;
    $('sp-fold-open').textContent = auto ? '칸 보기' : '펼치기';
    $('sp-fold').hidden = !fold;
    $('sp-fold-text').textContent = st.text;
}

/**
 * 직진 2단계 출고리스트 양식(앱 Storage) 상태 한 줄(#sp-zg-tmpl) — 직진 2단계에서만. 올리기·다시 확인은 [설정] › 기본 양식(2026-11-12).
 *   준비 중이면 원본(임시)이 필요하다 — 통합은 '같이 놓아 주세요', 개별 선택은 '원본(임시) 칸에'
 */
function renderZgTemplate() {
    const el = $('sp-zg-tmpl');
    const T = S.zgTmpl;
    const show = S.tab === 'zikjin' && S.step.zikjin === 2;
    el.hidden = !show;
    if (!show) { el.textContent = ''; return; }
    const auto = modeView(S.mode).auto;
    let cls = 'info', text;
    if (T.state === 'loading') text = '출고리스트 양식: 확인하는 중…';
    else if (T.state === 'ok') text = `출고리스트 양식: 앱에 저장됨${T.updated ? `(${savedText(T.updated)} 올림)` : ''}`;
    else {
        cls = 'warn';
        const why = T.state === 'none' ? '아직 앱에 없음' : (T.code === 'storage/unauthorized' ? '앱 저장소 설정 전' : '읽지 못함');
        // 통합은 위 다음 할 일(#sp-next)이 '원본도 같이 놓아 주세요'를 말한다 — 여기는 상태만
        text = auto ? `출고리스트 양식 준비 중(${why}) — 원본(임시)이 필요합니다.`
            : `출고리스트 양식 준비 중(${why}) — '원본(임시)' 칸에 직진배송출고리스트 원본을 넣어 주세요(이 PC 안에서만 쓰고 저장하지 않음).`;
    }
    el.className = `pd-alert ${cls} sp-zg-tmpl`;
    el.textContent = text;
}

/** 통합 큰 상자 아래 안내 — 직진 양식 준비 중이면 2단계 때 원본을 같이 놓아야 한다 */
function renderIntakeNote() {
    const el = $('sp-intake-note');
    const on = modeView(S.mode).auto && zgFallback();
    el.hidden = !on;
    el.textContent = on ? '직진배송 출고리스트 양식 준비 중 — 직진 2단계(출고전표를 놓을 때) 직진배송출고리스트 원본 파일도 같이 놓아 주세요(이 PC 안에서만 쓰고 저장하지 않음).' : '';
}

/** 설정 창 › 기본 양식 칸(#sp-s-tmpl, 창이 열려 있을 때만) — 관리자만 올리기, 직원은 상태만 */
function templateStateText(kind) {
    const T = kind === 'ably' ? S.abTmpl : S.zgTmpl;
    if (T.state === 'loading') return { warn: false, text: '확인하는 중…' };
    if (T.state === 'ok') return { warn: false, text: `앱에 저장됨${T.updated ? `(${savedText(T.updated)} 올림)` : ''} · ${sizeText(T.size)}` };
    const unauth = T.code === 'storage/unauthorized';
    if (kind === 'ably') {
        const why = T.state === 'none' ? '올린 양식 없음' : (unauth ? '앱 저장소 설정 전' : `읽지 못함: ${T.err}`);
        return { warn: T.state === 'error' && !unauth, text: `앱에 들어 있는 기본 양식을 씁니다(${why}).` };
    }
    const why = T.state === 'none' ? '아직 앱에 없음' : (unauth ? '앱 저장소 설정 전' : `읽지 못함: ${T.err}`);
    return { warn: true, text: `양식 준비 중(${why}) — 그동안은 2단계 때 직진배송출고리스트 원본을 같이 넣어야 합니다.` };
}
function renderTemplateRows() {
    const box = $('sp-s-tmpl');
    if (!box) return;
    box.innerHTML = ['zikjin', 'ably'].map(kind => {
        const T = kind === 'ably' ? S.abTmpl : S.zgTmpl;
        const st = templateStateText(kind);
        let btns = `<button class="d-btn d-btn-sm" data-tmpl="reload" data-kind="${kind}"${S.busy ? ' disabled' : ''}>다시 확인</button>`;
        if (S.isAdmin) {
            const label = T.state === 'ok' ? '다시 올리기' : '양식 올리기';
            btns += ZG_TEMPLATE_UPLOAD_ON
                ? ` <button class="d-btn d-btn-sm" data-tmpl="upload" data-kind="${kind}"${S.busy ? ' disabled' : ''}>${esc(label)}</button>`
                : ` <button class="d-btn d-btn-sm" data-tmpl="upload" data-kind="${kind}" disabled title="${esc(ZG_UPLOAD_OFF_TEXT)}">${esc(label)}</button>`;
        }
        return `<div class="sp-tmpl-row" data-kind="${kind}"><b>${esc(TMPL_NAME[kind])}</b>
            <span class="sp-tmpl-state${st.warn ? ' is-warn' : ''}">${esc(st.text)}</span>
            <span class="sp-tmpl-btns">${btns}</span></div>`;
    }).join('') + (S.isAdmin && !ZG_TEMPLATE_UPLOAD_ON ? `<div class="pd-note">${esc(ZG_UPLOAD_OFF_TEXT)}</div>` : '')
        + (S.isAdmin ? '' : '<div class="pd-note">양식은 관리자만 올립니다 — 양식이 바뀌었으면 관리자에게 알려 주세요.</div>');
}

/** 고급(2단계 패키지명 베이스·봉투당 수량) — 단계와 상관없이 늘 보인다(2026-11-13).
 *  통합에서 아직 파일을 안 넣었으면 어느 플랫폼인지 몰라 두 쪽(ZG·AB)을 다 보이고, 알아본 뒤(또는 개별 선택)엔 그 쪽만.
 *  칸에는 날짜(YYMMDD)를 넣고, 접두(ZG·AB)는 [만들기] 때 run() 이 붙여 계산에 넘긴다(ship-core.packageNameBase — 칸에 접두를 넣어도 한 번만). */
function optsTabs() {
    return modeView(S.mode).auto && !autoHasWork() ? ['zikjin', 'ably'] : [S.tab];
}
function renderOpts() {
    const box = $('sp-opts');
    const tabs = optsTabs();
    S.optsKey = tabs.join(',');
    const today = kstDay().yymmdd;
    const setLimitOf = (t) => (t === 'zikjin' ? S.settings.zikjinLimit : S.settings.ablyLimit);
    for (const t of tabs) {
        if (!S.base[t]) S.base[t] = today;
        if (!S.limitText[t]) S.limitText[t] = String(setLimitOf(t));
    }
    const differsOf = (t) => baseDatePart(S.base[t]) !== today || String(S.limitText[t]).trim() !== String(setLimitOf(t));
    const differs = tabs.some(differsOf);
    const names = tabs.map(t => packageNameBase(t, S.base[t])).join(' / ');
    const limits = tabs.map(t => String(S.limitText[t]).trim()).join('·');
    const fields = tabs.map(t => {
        const rules = t === 'zikjin' ? activeRuleCount(S.settings.specialRules) : 0;
        const head = tabs.length > 1 ? `<b class="sp-adv-tab">${esc(TAB_LABEL[t])}</b>` : '';
        return `<div class="sp-adv-row" data-tab="${t}">${head}
        <label class="sp-field">패키지명 베이스
            <span class="sp-base-wrap"><span class="sp-base-pre">${esc(PACK_PREFIX[t])}</span>
            <input class="pd-in num" data-opt="base" data-tab="${t}" value="${esc(baseDatePart(S.base[t]))}" maxlength="12" inputmode="numeric"></span>
            <small>오늘 ${esc(today)} · YYMMDD — 패키지명 <span data-opt-name="${t}">${esc(packageNameBase(t, S.base[t]))}</span>-01 부터</small></label>
        <label class="sp-field">봉투당 최대 수량
            <input class="pd-in num" data-opt="limit" data-tab="${t}" value="${esc(S.limitText[t])}" maxlength="4" inputmode="numeric">
            <small>공용 설정 ${esc(setLimitOf(t))}${esc(t === 'zikjin' ? ` · 지정상품 규칙 ${rules ? `${rules}개 켬` : '꺼짐'}` : '')}</small></label>
        </div>`;
    }).join('');
    box.innerHTML = `<details id="sp-adv" class="sp-adv"${(S.advOpen || differs) ? ' open' : ''}>
        <summary>고급 — 패키지명 ${esc(names)} · 봉투당 ${esc(limits)}개${differs ? ' <span class="pd-pill warn">오늘·공용값과 다름</span>' : ''} <span class="sp-adv-edit">바꾸기</span></summary>
        <div class="sp-adv-body">${fields}</div></details>`;
    $('sp-adv').addEventListener('toggle', (e) => { S.advOpen = e.target.open; });
    box.querySelectorAll('input[data-opt]').forEach(inp => inp.addEventListener('input', (e) => {
        const t = e.target.dataset.tab;
        if (e.target.dataset.opt === 'base') {
            S.base[t] = e.target.value;
            const nm = box.querySelector(`[data-opt-name="${t}"]`);
            if (nm) nm.textContent = packageNameBase(t, S.base[t]);
        } else S.limitText[t] = e.target.value;
    }));
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
        // 통합은 '위 상자에 놓기' 말투(칸·탭 이름 없이). 직진 양식 준비 중이면 원본을 같이 놓으라고
        auto: modeView(S.mode).auto, needTemp: tab === 'zikjin' && zgFallback() && !S.files.zikjin[2].template,
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
    renderAutoIdle();
}

/** 통합에서 아직 아무 파일도 안 넣었으면 큰 상자만 보인다(흐름·칸·[만들기] 숨김) */
function autoHasWork() {
    const tab = S.tab, step = S.step[tab];
    const put = Object.values(S.files[tab][step] || {}).some(f => f && f.from !== 'app' && f.from !== 'pc');
    return put || !!(S.recog || S.phase || S.why || S.busy);
}
/** 지금 칸 그대로 이 단계를 이번에 마쳤나(통합은 그때 [만들기]를 숨긴다 — 다시 만들려면 파일을 다시 놓거나 [칸 보기]) */
function stepDoneNow() {
    const tab = S.tab, step = S.step[tab], ss = S.session[tab];
    const main = step === 1 ? S.files[tab][1].request : S.files[tab][2].admin;
    return !!main && main === (step === 1 ? ss.step1For : ss.step2For);
}
function renderAutoIdle() {
    const card = document.querySelector('.sp-main-card');
    if (!card) return;
    const auto = modeView(S.mode).auto;
    card.classList.toggle('is-auto', auto);
    card.classList.toggle('is-auto-idle', auto && !autoHasWork());
    if (S.optsKey !== optsTabs().join(',')) renderOpts();   // 파일을 넣어 플랫폼을 알아봤다(두 쪽 → 그 쪽) · 다시 비었다
    // 통합: [만들기]는 저절로 시작하지 않았을 때만(이유 있음·파일 모자람·아직 안 만듦). 방금 마친 단계면 숨김
    card.classList.toggle('is-auto-done', auto && !S.busy && !S.why && stepDoneNow() && !S.foldOpen);
}
function setPhase(p) { S.phase = p; renderIntake(); }

/** 저절로 시작하지 않은 이유 + [만들기] 강조 */
function renderWhy() {
    const el = $('sp-run-why');
    if (!el) return;
    el.textContent = S.why && !S.busy ? `저절로 시작하지 않았습니다 — ${S.why} [만들기]를 눌러 주세요.` : '';
    $('sp-run').classList.toggle('is-attention', !!S.why && !S.busy);
}

/** 화면 방식 — 통합이면 큰 상자(지금 단계·칸 안내는 CSS is-auto 로 숨김), 개별 선택이면 띠 + 고른 쪽 단계 고르기만(펼쳐 둠) */
function renderMode() {
    const v = modeView(S.mode);
    document.querySelector('.sp-main-card').classList.toggle('is-legacy', !v.auto);
    $('sp-intake').hidden = !v.showIntake;
    const manual = document.querySelector('details.sp-manual');
    if (!v.auto) manual.open = true;
    $('sp-mode-bar').hidden = v.auto;
    $('sp-mode-name').textContent = v.auto ? '' : MODE_LABEL[v.mode];
    const pick = $('sp-pick-mode');
    pick.classList.toggle('is-on', !v.auto);
    pick.textContent = v.auto ? '개별 선택' : `개별 선택: ${MODE_LABEL[v.mode]}`;
    document.querySelectorAll('#sp-mode-menu .sp-mode-item').forEach(b => {
        b.classList.toggle('is-on', b.dataset.mode === v.mode);
        if (b.dataset.mode === 'auto') b.hidden = v.auto;   // 통합으로 돌아가기는 개별 선택 중일 때만
    });
    $('sp-drop-hint').textContent = '여기(또는 칸)에 파일을 놓으면 지금 단계 칸에 넣기만 합니다(저절로 시작하지 않음). 다 넣고 [만들기]를 누르세요.';
}

/** [개별 선택] 작은 메뉴 */
function openModeMenu() {
    if (S.busy) return;
    $('sp-mode-menu').hidden = false;
    $('sp-pick-mode').setAttribute('aria-expanded', 'true');
    const first = document.querySelector('#sp-mode-menu .sp-mode-item:not([hidden])');
    if (first) first.focus();
}
function closeModeMenu() {
    const m = $('sp-mode-menu');
    if (!m || m.hidden) return;
    m.hidden = true;
    $('sp-pick-mode').setAttribute('aria-expanded', 'false');
}
function bindModeMenu() {
    $('sp-pick-mode').addEventListener('click', (e) => {
        e.stopPropagation();
        if ($('sp-mode-menu').hidden) openModeMenu(); else closeModeMenu();
    });
    $('sp-mode-menu').addEventListener('click', (e) => {
        const b = e.target.closest('.sp-mode-item[data-mode]');
        if (!b || S.busy) return;
        closeModeMenu();
        setMode(b.dataset.mode);
        $('sp-pick-mode').focus();
    });
    $('sp-mode-back').addEventListener('click', () => setMode('auto'));
    document.addEventListener('click', (e) => { if (!e.target.closest('.sp-pick-wrap')) closeModeMenu(); });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || $('sp-mode-menu').hidden) return;
        closeModeMenu();
        $('sp-pick-mode').focus();
    });
}

function render() {
    renderMode();
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
    renderZgTemplate();
    renderOpts();
    renderTransmit();
    renderFolder();
    renderFlow();
    renderQuick();
    renderIntake();
    renderIntakeNote();
    renderWhy();
    renderResultCard();
    renderTemplateRows();
}

// ── 해시(#tab=zikjin|ably&step=1|2) ─────────────────────────
function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    // 기존 방식이면 탭은 고른 쪽 고정(주소의 tab 은 보지 않는다 — 단계만)
    const tab = modeView(S.mode).tab || (p.get('tab') === 'ably' ? 'ably' : 'zikjin');
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
        const want = SLOTS[tab][step][slot] || (slot === 'template' ? KIND.ZIKJIN_TEMPLATE : KIND.UNKNOWN);   // 직진 원본(임시) 칸은 SLOTS 밖
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
/** 지금 단계에 없는 필수 파일(직진 2단계: 앱 양식을 못 쓰면 원본(임시) 칸이 필수 — slotsOf, 아직 확인 중이면 '출고리스트 양식') */
const missingOf = (tab, step) => {
    const out = slotsOf(tab, step).filter(m => m.req && !S.files[tab][step][m.id]).map(m => m.title);
    if (tab === 'zikjin' && step === 2 && S.zgTmpl.state === 'loading') out.push(ZG_TEMPLATE_MISSING);
    return out;
};

/** 앱 양식을 못 쓸 때 — 놓은 파일 중 직진 원본을 2단계 원본(임시) 칸에 넣고 그 안내는 뺀다 */
async function takeZgTemp(judged, notes, tab, step) {
    if (tab !== 'zikjin' || !zgFallback()) return notes;
    const t = judged.find(f => f.kind === KIND.ZIKJIN_TEMPLATE);
    if (!t) return notes;
    const { kind, ...file } = t;
    S.files.zikjin[2].template = file;
    logLine(`✓ '${file.name}' → ${step === 2 ? '' : '2단계 '}${ZG_TEMP_SLOT.title} — 앱 양식 준비 중이라 이 파일의 서식에 씁니다`);
    return notes.filter(n => !n.startsWith(`'${t.name}'`));
}

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
    if (!modeView(S.mode).autoRoute) return dropLegacy(fileList);
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
            logLine(`✓ '${file.name}' → ${slotsOf(tab, step).find(m => m.id === slot).title}`);
        }
        // 1단계로 갈 때 같이 넣은 양식(원본)은 2단계 칸에 — '1단계에 쓰지 않습니다' 안내는 뺀다
        let rest = await takeZgTemp(judged, notes, tab, step);
        if (step === 1 && SLOTS[tab][2].template) {
            const tmplKind = SLOTS[tab][2].template;
            const tmpl = judged.find(f => f.kind === tmplKind);
            if (tmpl) {
                const { kind, ...file } = tmpl;
                await putSlot(tab, 2, 'template', file);
                logLine(`✓ '${file.name}' → 2단계 ${SLOT_META[tab][2].find(m => m.id === 'template').title}`);
                rest = rest.filter(n => !n.startsWith(`'${tmpl.name}'`));
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
            const stale = step === 2 && S.base[tab] && baseDatePart(S.base[tab]) !== kstDay().yymmdd;   // 앞 ZG·AB 는 떼고 날짜만
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

/**
 * 기존 방식(직진·에이블리 따로) — 2026.11.12c 합치기 전(c018fd1)과 같다: 머리글로 '지금 탭·단계' 칸만 정해 넣고,
 * 탭·단계를 옮기지 않고 저절로 시작하지 않는다. 다른 쪽 파일은 경고만(ship-assign.assignFiles screen 안내).
 */
async function dropLegacy(fileList) {
    const tab = S.tab, step = S.step[tab];
    const files = [...fileList];
    if (!files.length) return;
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
        const { assign, notes: notes0 } = assignFiles(judged, tab, step, { screen: true });
        for (const [slot, f] of Object.entries(assign)) {
            const { kind, ...file } = f;
            await putSlot(tab, step, slot, file);
            logLine(`✓ '${file.name}' → ${slotsOf(tab, step).find(m => m.id === slot).title}`);
        }
        const notes = await takeZgTemp(judged, notes0, tab, step);
        notes.forEach(n => logLine('⚠ ' + n));
        if (notes.length) toast(notes[0], 6000);
        const missing = missingOf(tab, step);
        if (Object.keys(assign).length || notes.length < notes0.length) logLine(missing.length ? `  더 넣을 파일: ${missing.join(', ')}` : '  파일이 다 들어왔습니다 — [만들기]를 눌러 주세요.');
    } catch (e) {
        logLine(`✗ 파일을 넣지 못했습니다: ${errText(e)}`);
    } finally {
        setBusy(false);
        render();
    }
    if (!S.busy) $('sp-run').focus();
}

/** 화면 방식 바꾸기([개별 선택] › 직진배송·에이블리 · [통합으로 돌아가기]) — 기억하지 않는다(다시 열면 통합) */
function setMode(mode) {
    if (S.busy) return;
    S.mode = loadMode(mode);
    S.tab = tabForMode(S.mode, S.tab);
    resetView();
    writeHash();
    render();
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
        }
    });
    // 기본 양식 — [설정] › 기본 양식의 [양식 올리기](관리자) · [다시 확인] (설정 창 본문은 열 때마다 새로 그려서 위임으로 받는다)
    $('sp-modal-body').addEventListener('click', async (e) => {
        const b = e.target.closest('button[data-tmpl]');
        if (!b || S.busy) return;
        const kind = b.dataset.kind === 'ably' ? 'ably' : 'zikjin';
        if (b.dataset.tmpl === 'reload') {
            b.disabled = true;
            await refreshTemplate(kind);
            render();
            return;
        }
        if (!S.isAdmin) return;
        if (!ZG_TEMPLATE_UPLOAD_ON) { toast(ZG_UPLOAD_OFF_TEXT, 5000); return; }
        S.tmplPick = kind;
        const inp = $('sp-tmpl-input');
        inp.value = '';
        inp.click();
    });
    $('sp-tmpl-input').addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file || S.busy) return;
        if (S.tmplPick === 'ably') uploadAbTemplate(file);
        else if (S.tmplPick === 'zikjin') uploadZgTemplate(file);
        S.tmplPick = null;
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
        const why = [...new Set(r.good.map(g => CMP_WHY[g.why] || g.why))].join('·');
        const good = r.good.length ? ` · 의도된 차이 ${r.good.length}곳(${why})` : '';
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
/** 에이블리 2단계 양식 — 칸에 넣은 것 → 앱에 올린 양식(ship/templates/ably.xlsx) → 앱에 들어 있는 기본 양식(assets) 순 */
async function ablyTemplateFile() {
    const f = S.files.ably[2].template;
    if (f) return f;
    const app = await ablyAppTemplate();
    if (app) return app;
    const res = await fetch(ABLY_TEMPLATE_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`앱 기본 대량입고 양식을 받지 못했습니다(${res.status}).`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { name: '엑셀_대량_입고_양식.xlsx', bytes, size: bytes.byteLength, from: 'app' };
}

// ── 직진 출고리스트 양식(앱 Storage ship/templates/zikjin.xlsx) ─────────────
// Storage — 처음 쓸 때 만든다(에뮬레이터면 먼저 붙인다. 연결 실패면 던져서 운영으로 안 간다 — approval.js 와 같음)
const storage = () => {
    if (!S.storage) {
        const st = getStorage(S.app); connectStorageEmulatorIfEnabled(st);
        st.maxOperationRetryTime = 8000;   // 양식 읽기가 사내망에서 막혀도 2분씩 기다리지 않게(기본값 2분) — 넘으면 임시 길·기본 양식으로
        S.storage = st;
    }
    return S.storage;
};
const storageErrText = (e) => {
    const c = (e && e.code) || '';
    if (c === 'storage/unauthorized') return '권한이 없습니다(읽기는 등록 직원, 올리기는 관리자 · 저장소 규칙이 아직 게시되지 않았을 수 있음)';
    if (c === 'storage/retry-limit-exceeded' || c === 'storage/unknown') return '연결에 실패했습니다(인터넷 · 저장소 설정 확인)';
    return c || String((e && e.message) || e || '알 수 없는 오류');
};

/** 양식 정보만 다시 읽기(내용은 실행할 때 받는다) — kind 'zikjin' | 'ably' */
const refreshZgTemplate = () => refreshTemplate('zikjin');
async function refreshTemplate(kind) {
    const T = kind === 'ably' ? S.abTmpl : S.zgTmpl;
    try {
        const m = await getMetadata(sRef(storage(), TMPL_PATH[kind]));
        const gen = String(m.generation || m.updated || '');
        if (T.badGen && T.badGen === gen) return;   // 받아 보니 검사에 걸린 그 양식 — 새로 올리기 전까지 '준비 중'(state error) 그대로
        Object.assign(T, { state: 'ok', updated: m.updated || '', size: Number(m.size) || 0, gen, err: '', code: '' });
    } catch (e) {
        if (e && e.code === 'storage/object-not-found') Object.assign(T, { state: 'none', err: '', code: e.code });
        else {
            console.warn('[플랫폼 출고] 양식 정보 읽기 실패:', (e && e.code) || (e && e.name) || 'unknown');
            Object.assign(T, { state: 'error', err: storageErrText(e), code: (e && e.code) || '' });
        }
    }
}

/** 실행할 때 — 양식 내용(바뀌었으면 새로 받음) */
async function zgTemplateBytes() {
    await refreshZgTemplate();
    const T = S.zgTmpl;
    if (T.state === 'none') throw new Error('직진배송 출고리스트 양식이 앱에 없습니다 — 관리자에게 양식 등록을 요청해 주세요.');
    if (T.state !== 'ok') throw new Error(`출고리스트 양식을 읽지 못했습니다: ${T.err}`);
    if (T.bytes && T.bytesGen === T.gen) return T.bytes;
    let blob;
    try { blob = await getBlob(sRef(storage(), ZG_TEMPLATE_PATH)); }
    catch (e) {
        console.warn('[플랫폼 출고] 양식 받기 실패:', (e && e.code) || (e && e.name) || 'unknown');
        throw new Error(`출고리스트 양식을 받지 못했습니다: ${storageErrText(e)}`);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // 받은 양식을 한 번 더 본다(올릴 때와 같은 검사) — 걸리면 쓰지 않고 '양식 준비 중'(원본(임시) 칸)으로
    const { JSZip } = await loadLibs();
    const problem = await zikjinTemplateProblem(JSZip, bytes);
    if (problem) {
        console.warn('[플랫폼 출고] 앱 양식 검사 걸림');
        Object.assign(T, { state: 'error', err: `앱 양식에 문제가 있어 쓰지 않습니다(${problem})`, code: 'bad-template', bytes: null, bytesGen: '', badGen: T.gen });
        throw new Error(`앱에 저장된 출고리스트 양식을 쓰지 않았습니다 — ${problem} 그동안은 ${ZG_TEMP_SLOT.title} 칸에 원본을 넣고 다시 [만들기]를 눌러 주세요.`);
    }
    T.bytes = bytes;
    T.bytesGen = T.gen;
    return T.bytes;
}

/** 관리자 — 원본(또는 빈 양식)을 머리글만 남겨 앱에 올리기. 지운 행 수를 보여 주고 확인받는다 */
async function uploadZgTemplate(file) {
    if (!S.isAdmin) return;
    if (!ZG_TEMPLATE_UPLOAD_ON) { toast(ZG_UPLOAD_OFF_TEXT, 5000); return; }
    setBusy(true, '양식 정리 중…');
    try {
        const { JSZip } = await loadLibs();
        const src = new Uint8Array(await file.arrayBuffer());
        const c = await cleanZikjinTemplate(JSZip, src);
        if (c.bytes.byteLength > ZG_TEMPLATE_MAX) throw new Error(`정리한 양식이 ${sizeText(c.bytes.byteLength)} 로 너무 큽니다(최대 ${sizeText(ZG_TEMPLATE_MAX)}).`);
        const gone = Object.entries(c.dropped).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${fmt(n)}행`);
        const msg = `'${file.name}' 을 직진배송 출고리스트 양식으로 앱에 올립니다.\n\n`
            + `머리글(지그재그양식서 1~7행 · 다른 두 시트 1행)만 남기고 자료를 지웠습니다: ${gone.length ? gone.join(' · ') : '지운 행 없음'}\n`
            + (c.cleared.length ? `값을 모두 비운 다른 시트: ${c.cleared.join(', ')}\n` : '')
            + `정리한 양식 ${sizeText(c.bytes.byteLength)} — 원래 파일은 올리지 않습니다.\n\n`
            + (S.zgTmpl.state === 'ok' ? '지금 양식을 이것으로 바꿉니다. ' : '')
            + '모든 직원이 이 양식으로 출고리스트를 만듭니다. 올릴까요?';
        if (!confirm(msg)) { toast('양식을 올리지 않았습니다.'); return; }
        setBusy(true, '양식 올리는 중…');
        await uploadBytes(sRef(storage(), ZG_TEMPLATE_PATH), c.bytes, { contentType: XLSX_TYPE });
        S.zgTmpl.badGen = '';
        await refreshZgTemplate();
        if (S.zgTmpl.state === 'ok') { S.zgTmpl.bytes = c.bytes; S.zgTmpl.bytesGen = S.zgTmpl.gen; }
        logLine(`✓ 직진배송 출고리스트 양식을 앱에 올렸습니다(${sizeText(c.bytes.byteLength)}, 자료 행 지움: ${gone.length ? gone.join(' · ') : '없음'}).`);
        toast('양식을 올렸습니다(모든 직원에게 적용)');
    } catch (e) {
        console.warn('[플랫폼 출고] 양식 올리기 실패:', (e && e.code) || (e && e.name) || 'Error');
        const t = e && e.code ? storageErrText(e) : errText(e);
        logLine(`✗ 양식을 올리지 못했습니다: ${t}`);
        toast(`양식을 올리지 못했습니다 — ${t}`, 6000);
    } finally {
        setBusy(false);
        render();
    }
}

// ── 에이블리 대량입고 양식(앱 Storage ship/templates/ably.xlsx, 2026-11-12) ─────────────
/**
 * 실행할 때 — 앱에 올린 양식(바뀌었으면 새로 받음, 받을 때도 올릴 때와 같은 검사). 못 쓰면 null(→ assets 기본 양식).
 *   저장소 규칙 게시 전(권한 없음)·아직 안 올림은 조용히 기본 양식으로, 그 밖의 실패·검사 걸림은 진행 기록에 한 줄.
 */
async function ablyAppTemplate() {
    // 저장소 규칙 게시 전에는 앱 양식을 쓰지 않는다(그 전 규칙은 로그인만 하면 누구나 올릴 수 있음) — 늘 앱 기본(assets) 양식
    if (!ZG_TEMPLATE_UPLOAD_ON) return null;
    await refreshTemplate('ably');
    const T = S.abTmpl;
    if (T.state !== 'ok') {
        if (T.state === 'error' && T.code !== 'storage/unauthorized') logLine(`  ⚠ 앱에 올린 대량입고 양식을 쓰지 못해 앱 기본 양식을 씁니다: ${T.err}`);
        return null;
    }
    if (!(T.bytes && T.bytesGen === T.gen)) {
        let blob;
        try { blob = await getBlob(sRef(storage(), AB_TEMPLATE_PATH)); }
        catch (e) {
            console.warn('[플랫폼 출고] 에이블리 양식 받기 실패:', (e && e.code) || (e && e.name) || 'unknown');
            logLine(`  ⚠ 앱에 올린 대량입고 양식을 받지 못해 앱 기본 양식을 씁니다: ${storageErrText(e)}`);
            return null;
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const { X, JSZip } = await loadLibs();
        const problem = await ablyTemplateProblem(JSZip, X, bytes);
        if (problem) {
            console.warn('[플랫폼 출고] 에이블리 앱 양식 검사 걸림');
            Object.assign(T, { state: 'error', err: `앱 양식에 문제가 있어 쓰지 않습니다(${problem})`, code: 'bad-template', bytes: null, bytesGen: '', badGen: T.gen });
            logLine(`  ⚠ 앱에 올린 대량입고 양식에 문제가 있어 앱 기본 양식을 씁니다 — ${problem}`);
            return null;
        }
        T.bytes = bytes;
        T.bytesGen = T.gen;
    }
    logLine('  대량입고 양식: 앱에 올린 양식(관리자 등록)');
    return { name: 'ably.xlsx', bytes: T.bytes, size: T.bytes.byteLength, from: 'app' };
}

/** 관리자 — 새 에이블리 대량입고 양식을 머리글만 남겨 앱에 올리기. 지운 행 수를 보여 주고 확인받는다 */
async function uploadAbTemplate(file) {
    if (!S.isAdmin) return;
    if (!ZG_TEMPLATE_UPLOAD_ON) { toast(ZG_UPLOAD_OFF_TEXT, 5000); return; }
    setBusy(true, '양식 정리 중…');
    try {
        const { X, JSZip } = await loadLibs();
        const src = new Uint8Array(await file.arrayBuffer());
        const c = await cleanAblyTemplate(JSZip, X, src);
        if (c.bytes.byteLength > ZG_TEMPLATE_MAX) throw new Error(`정리한 양식이 ${sizeText(c.bytes.byteLength)} 로 너무 큽니다(최대 ${sizeText(ZG_TEMPLATE_MAX)}).`);
        const gone = Object.entries(c.dropped).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${fmt(n)}행`);
        const msg = `'${file.name}' 을 에이블리 대량입고 양식으로 앱에 올립니다.\n\n`
            + `머리글(대량입고 시트 '${c.sheet}' 1~5행)만 남기고 자료를 지웠습니다: ${gone.length ? gone.join(' · ') : '지운 행 없음'}\n`
            + (c.cleared.length ? `값을 모두 비운 다른 시트: ${c.cleared.join(', ')}\n` : '')
            + `정리한 양식 ${sizeText(c.bytes.byteLength)} — 원래 파일은 올리지 않습니다.\n\n`
            + (S.abTmpl.state === 'ok' ? '지금 양식을 이것으로 바꿉니다. ' : '')
            + '모든 직원이 이 양식으로 대량입고 파일을 만듭니다. 올릴까요?';
        if (!confirm(msg)) { toast('양식을 올리지 않았습니다.'); return; }
        setBusy(true, '양식 올리는 중…');
        await uploadBytes(sRef(storage(), AB_TEMPLATE_PATH), c.bytes, { contentType: XLSX_TYPE });
        S.abTmpl.badGen = '';
        await refreshTemplate('ably');
        if (S.abTmpl.state === 'ok') { S.abTmpl.bytes = c.bytes; S.abTmpl.bytesGen = S.abTmpl.gen; }
        logLine(`✓ 에이블리 대량입고 양식을 앱에 올렸습니다(${sizeText(c.bytes.byteLength)}, 자료 행 지움: ${gone.length ? gone.join(' · ') : '없음'}).`);
        toast('양식을 올렸습니다(모든 직원에게 적용)');
    } catch (e) {
        console.warn('[플랫폼 출고] 에이블리 양식 올리기 실패:', (e && e.code) || (e && e.name) || 'Error');
        const t = e && e.code ? storageErrText(e) : errText(e);
        logLine(`✗ 양식을 올리지 못했습니다: ${t}`);
        toast(`양식을 올리지 못했습니다 — ${t}`, 6000);
    } finally {
        setBusy(false);
        render();
    }
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
    const missing = missingOf(tab, step);
    if (missing.length) {
        toast(missing.includes(ZG_TEMPLATE_MISSING) && missing.length === 1
            ? '출고리스트 양식을 아직 확인하는 중입니다 — 잠시 뒤 다시 눌러 주세요.'
            : `넣어야 할 파일: ${missing.join(', ')}`, 5000);
        return;
    }
    let base = '', limit = 0;
    if (step === 2) {
        base = String(S.base[tab] || '').trim();
        limit = parseLimit(S.limitText[tab]);
        if (!baseDatePart(base)) { toast('패키지명 베이스를 넣어 주세요.'); return; }
        if (limit === null) { toast('봉투당 최대 수량은 1~999 정수입니다.'); return; }
        // 패키지명 앞에 플랫폼 접두(ZG·AB, 2026-11-13). 계산(zikjinStep2·ablyStep2)은 받은 앞부분 그대로 쓰므로 exe 와 같은 계산을 그대로 두고
        //   여기서만 붙인다(칸에 이미 접두가 있으면 한 번만). 날짜를 읽는 packDay·baseDateWarning 은 접두를 떼고 읽는다.
        base = packageNameBase(tab, base);
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
            // 앱 양식(빈 서식)에 출고요청·전표 값을 쓴다. 앱 양식을 못 쓰면(규칙 게시 전 등) 넣은 원본(임시)에 — 옛 방식과 같은 쓰기
            await refreshZgTemplate();
            let tmplBytes = null;
            if (S.zgTmpl.state === 'ok') {
                try { tmplBytes = await zgTemplateBytes(); }
                catch (e) { if (!(S.zgTmpl.code === 'bad-template' && f.template)) throw e; logLine(`  ⚠ ${S.zgTmpl.err}`); }
            }
            if (tmplBytes) { /* 앱 양식 */ }
            else if (f.template) {
                tmplBytes = f.template.bytes;
                logLine(`  ℹ 앱 양식 준비 중 — 넣은 원본(임시) '${f.template.name}' 의 서식에 씁니다(상품 자료는 쓰지 않고 8행 아래를 새로 씀).`);
            } else throw new Error(`출고리스트 양식을 쓸 수 없습니다 — ${ZG_TEMP_SLOT.title} 칸에 원본을 넣고 다시 해 주세요.`);
            const admin = readBook(X, f.admin.bytes, f.admin.name);
            const request = readBook(X, f.request.bytes, f.request.name);
            setPhase('계산 중');
            await tick();
            const r = zikjinStep2({
                admin, request, requestName: f.request.name,
                packageBase: base, packageLimit: limit, specialRules: S.settings.specialRules, now,
            });
            r.log.forEach(logLine);
            setBusy(true, '출고리스트 쓰는 중…');
            setPhase('저장 중');
            await tick();
            const w = await zikjinListBytes(JSZip, tmplBytes, r);
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
            <p class="pd-note">상품명에 이 글자가 들어 있으면 한 줄을 이 수량씩 나눕니다(0 = 끔). 최대 ${esc(MAX_RULES)}개.</p>
            <table class="sp-rules"><thead><tr><th>상품명에 든 글자</th><th>한 번에 최대</th><th></th></tr></thead>
                <tbody id="sp-s-rules">${rules.map(ruleRow).join('')}</tbody></table>
            <button id="sp-s-add" class="d-btn d-btn-sm" style="margin-top:8px;">줄 추가</button>
        </div>
        <div>
            <h3 class="pd-h3">기본 양식</h3>
            <p class="pd-note">모든 직원이 같이 쓰는 빈 양식입니다. 카카오스타일·에이블리 양식이 바뀌었을 때만 관리자가 새로 올립니다.
                올리기 전에 이 PC 에서 머리글만 남기고 자료 행을 지우며, 원래 파일은 올리지 않습니다. 양식은 올리는 즉시 적용됩니다(아래 [저장]과 따로).</p>
            <div id="sp-s-tmpl" class="sp-tmpl-list"></div>
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
    renderTemplateRows();
    $('sp-modal').classList.remove('hidden');
    // 양식 상태는 열 때 한 번 다시 확인(정보만 — 내용은 받지 않음)
    Promise.all([refreshTemplate('zikjin'), refreshTemplate('ably')]).then(() => { if (!S.busy) render(); });
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
    // 옛 방식(2026-11-10~12)이 이 PC 에 기억해 둔 직진배송출고리스트 원본 — 앱 양식을 쓸 수 있으면 지운다(상품 자료가 PC 에 남지 않게).
    //   앱 양식 준비 중(임시 길)이면 지우지 않고 원본(임시) 칸에 넣어 준다(새로 기억하지는 않는다). 그래서 refreshZgTemplate 뒤에 부른다.
    try {
        const rec = await S.store.get(KEY_TEMPLATE);
        if (rec && S.zgTmpl.state === 'ok') await S.store.del(KEY_TEMPLATE);
        else if (isFileRecord(rec) && zgFallback()) {
            S.files.zikjin[2].template = { name: rec.name, bytes: new Uint8Array(rec.bytes), size: rec.size, from: 'pc', savedAt: rec.savedAt };
        }
    } catch (e) {
        console.warn('[플랫폼 출고] 옛 원본 기억 지우기 실패:', (e && e.name) || 'unknown');
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
    // 직진 양식 먼저 — restoreFromPc 가 옛 원본 기억을 지울지(앱 양식 있음) 임시 칸에 넣을지 정한다. 에이블리 양식은 정보만(빈 칸 안내·설정 창)
    await Promise.all([refreshZgTemplate(), refreshTemplate('ably')]);
    await restoreFromPc();
    // 늘 통합으로 연다(2026-11-12 사용자 요청) — 예전에 이 PC 가 기억해 둔 방식은 지운다
    S.mode = 'auto';
    try { localStorage.removeItem(MODE_STORE_KEY); } catch (_) { /* 저장공간이 막혀도 통합으로 연다 */ }
    readHash();
    $('pd-app').style.display = 'block';
    setLoading(false);

    bindModeMenu();
    $('sp-tabs').addEventListener('click', (e) => {
        const b = e.target.closest('.d-seg-btn'); if (!b || S.busy) return;
        if (!modeView(S.mode).showTabs) return;   // 기존 방식은 탭 고정(숨김)
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

const { app, db, auth } = initializeFirebase();
S.app = app; S.db = db; S.auth = auth;
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
