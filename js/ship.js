// === js/ship.js ===
// 플랫폼 출고(ship.html) 화면 — 옛 출고자동화통합.exe(직진배송·에이블리 1·2단계)의 웹판(2026-11-10).
//
// 흐름: 파일 칸에 끌어다 놓기·선택(여러 개를 한꺼번에 놓으면 js/lib/ship-assign.js 가 머리글로 칸을 정함)
//       → [만들기] → js/lib/ship-*.js 로 계산·파일 만들기(이 브라우저 안에서만) → 결과 저장(js/lib/save-file.js — 폴더 한 번 고르기·안 되면 다운로드)
//       → 2단계는 공용 설정 '전송 켬'일 때만 로케이션 실적·봉 수를 Firestore 에(js/ship-store.js).
// 지킬 것
//   · 엑셀 행 내용(상품코드·상품명·수량)은 화면 진행 기록에만 쓴다 — 콘솔·Firestore 로그에 남기지 않는다(콘솔은 오류 코드만).
//   · 직진배송출고리스트 원본은 이 PC 의 IndexedDB 에만 기억한다(js/lib/ship-file-store.js) — 서버·Storage 금지.
//   · 전송이 꺼져 있으면(transmit false, 병행 초기) Firestore 쓰기 함수를 아예 부르지 않는다 — 기록은 옛 exe 가 한다.
//   · 라이브러리는 이 페이지에서만 CDN 지연 로드: SheetJS 0.20.3(ESM — 다른 화면의 전역 XLSX 0.18.5 와 섞이지 않게)·JSZip 3.10.2·ExcelJS 4.4.0.
// 권한: 입장은 js/page-gate.js(ship.platform). 설정 저장·전송은 규칙이 막는다. 전송 켜기(transmit)는 관리자만.
import { onAuthStateChanged, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { initializeFirebase } from './config.js?v=202611111506';
import { emulatorEnabled } from './firebase-emulator.js?v=202611111506';
import { setShellContext, onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202611111506';
import { memberNameFor } from './app-shell-data.js?v=202611111506';
import { friendlyFirebaseError } from './utils.js?v=202611111506';
import { resolve, can } from './lib/perm.js?v=202611111506';
import { readBook } from './lib/ship-read.js?v=202611111506';
import { zikjinStep1, zikjinStep2, TEMPLATE_SHEETS } from './lib/ship-zikjin.js?v=202611111506';
import { ablyStep1, ablyStep2 } from './lib/ship-ably.js?v=202611111506';
import { zikjinListBytes, ablyBulkBytes, stockXlsBytes } from './lib/ship-write.js?v=202611111506';
import { pickingBytes } from './lib/ship-picking.js?v=202611111506';
import { kstDay, baseDateWarning, STOCK_OUT_MSG } from './lib/ship-core.js?v=202611111506';
import { peekBook, classifyPeek, assignFiles, SLOTS, KIND, KIND_LABEL } from './lib/ship-assign.js?v=202611111506';
import { openShipStore, fileRecord, isFileRecord, describeRecord, sizeText, savedText, KEY_TEMPLATE, KEY_OUT_DIR } from './lib/ship-file-store.js?v=202611111506';
import { createSaver, mimeOf } from './lib/save-file.js?v=202611111506';
import { normalizeSettings, validateEdit, settingsWrite, parseLimit, activeRuleCount, MAX_RULES } from './lib/ship-settings.js?v=202611111506';
import { loadSettings, saveSettings, pushLocation, recordPacks } from './ship-store.js?v=202611111506';

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
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tick = () => new Promise(r => setTimeout(r, 30));

// 칸 설명 — id 는 js/lib/ship-assign.js SLOTS 와 같다
const SLOT_META = {
    zikjin: {
        1: [{ id: 'request', title: 'GPM 출고요청', req: true, hint: "이름에 '직진배송'이 든 시트를 모두 읽습니다" }],
        2: [
            { id: 'admin', title: '이지어드민 출고전표', req: true, hint: '1단계 파일을 이지어드민에 올린 뒤 받은 전표' },
            { id: 'template', title: '직진배송출고리스트 원본', req: true, hint: '한 번 넣으면 이 PC 가 기억합니다' },
            { id: 'request', title: '출고요청', req: false, hint: '1단계에서 자동 · 신상 코드 복구·일반/즉시출고 구분(없으면 전송·봉 수 안 함)' },
        ],
    },
    ably: {
        1: [{ id: 'request', title: '도착보장출고요청', req: true, hint: '2행 머리글 · 어드민상품코드 기준으로 합칩니다' }],
        2: [
            { id: 'admin', title: '이지어드민 출고전표', req: true, hint: '실제 출고 수량' },
            { id: 'request', title: '도착보장출고요청', req: true, hint: '1단계에서 자동 · SKU 매핑' },
            { id: 'template', title: '대량입고 양식', req: false, hint: '앱에 들어 있음 — 다른 양식을 쓸 때만 넣으세요' },
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
const S = {
    db: null, auth: null, user: null, isAdmin: false, canShip: false,
    settings: normalizeSettings(null), settingsRead: false,
    tab: 'zikjin', step: { zikjin: 1, ably: 1 },
    files: { zikjin: emptyFiles(), ably: emptyFiles() },   // 파일 = { name, bytes: Uint8Array, size, from: 'drop'|'step1'|'pc'|'app', savedAt? }
    base: { zikjin: '', ably: '' }, limitText: { zikjin: '', ably: '' },
    busy: false, results: [], store: null, saver: null, pickSlot: null,
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
}
function setBusy(on, text = '처리 중…') {
    S.busy = on;
    $('sp-busy').hidden = !on;
    $('sp-busy-text').textContent = text;
    $('sp-run').disabled = on;
    document.querySelectorAll('#sp-slots button, #sp-tabs button, #sp-steps button, #sp-settings-btn, #sp-folder').forEach(b => { b.disabled = on; });
}
const errText = (e) => (e && e.code ? friendlyFirebaseError(e) : String((e && e.message) || e || '알 수 없는 오류'));

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
            <div class="sp-slot-btns">
                <button class="d-btn d-btn-sm" data-sp="pick">파일 선택</button>
                ${f ? '<button class="d-btn d-btn-sm" data-sp="clear">빼기</button>' : ''}
                ${forget}
            </div>
        </div>`;
    }).join('');
    if (S.busy) box.querySelectorAll('button').forEach(b => { b.disabled = true; });
}

function renderOpts() {
    const tab = S.tab, step = S.step[tab];
    const box = $('sp-opts');
    if (step !== 2) { box.innerHTML = ''; return; }
    const setLimit = tab === 'zikjin' ? S.settings.zikjinLimit : S.settings.ablyLimit;
    if (!S.base[tab]) S.base[tab] = kstDay().yymmdd;
    if (!S.limitText[tab]) S.limitText[tab] = String(setLimit);
    const rules = tab === 'zikjin' ? activeRuleCount(S.settings.specialRules) : 0;
    box.innerHTML = `
        <label class="sp-field">패키지명 베이스
            <input id="sp-base" class="pd-in num" value="${esc(S.base[tab])}" maxlength="12" inputmode="numeric">
            <small>오늘 ${esc(kstDay().yymmdd)} · YYMMDD</small></label>
        <label class="sp-field">봉투당 최대 수량
            <input id="sp-limit" class="pd-in num" value="${esc(S.limitText[tab])}" maxlength="4" inputmode="numeric">
            <small>공용 설정 ${setLimit}${tab === 'zikjin' ? ` · 지정상품 규칙 ${rules ? `${rules}개 켬` : '꺼짐'}` : ''}</small></label>`;
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
    el.className = `pd-alert ${cls}`;
    el.textContent = text;
}

function renderFolder() {
    const s = S.saver;
    const b = $('sp-folder');
    if (!s || !s.supportsFolder()) { b.textContent = '다운로드로 저장'; b.title = '이 브라우저는 폴더에 바로 쓸 수 없어 다운로드로 받습니다'; return; }
    b.textContent = s.folderName ? `저장 폴더: ${s.folderName}` : (s.mode === 'download' ? '저장 폴더 고르기(지금은 다운로드)' : '저장 폴더 고르기');
    b.title = '결과 파일을 저장할 폴더 — 한 번 고르면 다음부터 묻지 않습니다';
}

function render() {
    const tab = S.tab, step = S.step[tab];
    document.querySelectorAll('#sp-tabs .d-seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.tab === tab));
    document.querySelectorAll('#sp-steps .d-seg-btn').forEach(b => b.classList.toggle('is-on', Number(b.dataset.step) === step));
    $('sp-step2-btn').textContent = STEP2_LABEL[tab];
    $('sp-step-desc').textContent = STEP_DESC[tab][step];
    $('sp-step-note').textContent = '';
    $('sp-run').textContent = `${TAB_LABEL[tab]} ${step}단계 만들기`;
    document.title = `플랫폼 출고 — ${TAB_LABEL[tab]}`;
    renderSlots();
    renderOpts();
    renderTransmit();
    renderFolder();
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

async function putSlot(tab, step, slot, f) {
    S.files[tab][step][slot] = f;
    if (tab === 'zikjin' && step === 2 && slot === 'template' && f) await rememberTemplate(f);
}

/** 칸 하나에 직접 넣기(선택·칸에 놓기) — 모양이 다르면 안내만 하고 넣는다 */
async function dropOnSlot(slot, fileList) {
    const tab = S.tab, step = S.step[tab];
    const file = fileList[0];
    if (!file) return;
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
    render();
}

/** 여러 파일을 한꺼번에 — 머리글로 칸을 정한다 */
async function dropMany(fileList) {
    const tab = S.tab, step = S.step[tab];
    const files = [...fileList];
    if (!files.length) return;
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
        const { assign, notes } = assignFiles(judged, tab, step);
        for (const [slot, f] of Object.entries(assign)) {
            const { kind, ...file } = f;
            await putSlot(tab, step, slot, file);
            logLine(`✓ '${file.name}' → ${SLOT_META[tab][step].find(m => m.id === slot).title}`);
        }
        notes.forEach(n => logLine('⚠ ' + n));
        if (notes.length) toast(notes[0], 5000);
    } catch (e) {
        logLine(`✗ 파일을 넣지 못했습니다: ${errText(e)}`);
    } finally {
        setBusy(false);
        render();
    }
}

function bindDrop() {
    const area = $('sp-drop');
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
    // 칸 밖(페이지 아무 곳)에 놓아도 브라우저가 파일을 열지 않게
    window.addEventListener('dragover', (e) => { if (isFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
        if (!isFiles(e) || area.contains(e.target)) return;
        e.preventDefault();               // 바쁠 때도 브라우저가 파일을 열지 않게 막기는 한다
        if (S.busy) { toast('처리 중입니다 — 끝난 뒤 다시 넣어 주세요.'); return; }
        dropMany(e.dataTransfer.files);
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
        <button class="d-btn d-btn-sm" data-again="${i}">다시 받기</button></div>`).join('');
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

// ── 전송(2단계 끝) ──────────────────────────────────────────
async function transmit(location, packs, now) {
    if (!S.settings.transmit) {
        logLine('ℹ 병행 중 — 로케이션 실적·봉 수 기록은 exe 가 합니다(웹판 전송 꺼짐, 쓰지 않음).');
        return;
    }
    if (!S.canShip) {
        logLine('⚠ 「플랫폼 출고」 권한이 없어 로케이션 전송·봉 수 기록을 하지 않았습니다 — 만든 파일은 정상입니다.');
        return;
    }
    if (location && location.source) {
        setBusy(true, '로케이션 전송 중…');
        logLine(`  [로케이션 전송] 소스: ${location.source} / 날짜: ${kstDay(now).ymd8}`);
        try {
            const r = await pushLocation(S.db, location.rows, location.source, { enabled: true, now });
            logLine(`  ✓ 로케이션 전송 완료 (오늘 합본 ${r.total}건, 이번 소스 ${r.thisSource}건, 문서 ${r.chunks}개${r.deleted ? `, 옛 문서 ${r.deleted}개 정리` : ''})`);
        } catch (e) {
            console.warn('[플랫폼 출고] 로케이션 전송 실패:', (e && e.code) || (e && e.name) || 'unknown');
            logLine(`  ⚠ 로케이션 전송 실패 — 만든 파일은 정상입니다: ${errText(e)}`);
        }
    } else {
        logLine('  ⚠ 로케이션 전송 건너뜀: 출고요청 파일이 없어 일반/즉시출고를 구분할 수 없음');
    }
    if (packs) {
        try {
            const r = await recordPacks(S.db, packs, { enabled: true, now });
            logLine(`  봉 수 기록: ${r.day} ${r.source} ${r.count}봉 (그날 ${r.channel === 'zikjin' ? '직진' : '에이블리'} 합계 ${r.total}봉)`);
        } catch (e) {
            console.warn('[플랫폼 출고] 봉 수 기록 실패:', (e && e.code) || (e && e.name) || 'unknown');
            logLine(`  ⚠ 봉 수 기록 실패 — 만든 파일은 정상입니다: ${errText(e)}`);
        }
    }
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

async function run() {
    if (S.busy) return;
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
    try {
        try { await S.saver.prepare(); } catch (_) { /* 못 하면 다운로드로 받는다 */ }   // 클릭 안에서 — 폴더를 한 번 묻거나 권한을 받는다
        renderFolder();
        setBusy(true, '라이브러리 불러오는 중…');
        S.results = [];
        renderResults();
        logLine(`===== ${TAB_LABEL[tab]} ${step}단계 시작 =====`);
        const { X, JSZip, ExcelJS } = await loadLibs();
        if (step === 2) await refreshSettings();   // 전송 켬·지정상품 규칙은 실행 직전 값으로
        renderTransmit();
        setBusy(true, '파일 읽는 중…');
        await tick();
        if (step === 1) {
            const r = tab === 'zikjin'
                ? zikjinStep1({ request: readBook(X, f.request.bytes, f.request.name), now })
                : ablyStep1({ request: readBook(X, f.request.bytes, f.request.name), now });
            r.log.forEach(logLine);
            const x = stockXlsBytes(X, r);
            if (x.problem) throw new Error(x.problem);
            await saveOut(r.fileName, x.bytes);
            S.files[tab][2].request = { name: f.request.name, bytes: f.request.bytes, size: f.request.size, from: 'step1' };
            logLine('  → 출고요청 파일을 2단계 칸에 넣어 두었습니다.');
        } else if (tab === 'zikjin') {
            const warn = baseDateWarning(base, now);
            if (warn) logLine(warn);
            const r = zikjinStep2({
                admin: readBook(X, f.admin.bytes, f.admin.name),
                template: readBook(X, f.template.bytes, f.template.name, { formulas: true, sheets: TEMPLATE_SHEETS }),
                request: f.request ? () => readBook(X, f.request.bytes, f.request.name) : null,
                requestName: f.request ? f.request.name : null,
                packageBase: base, packageLimit: limit, specialRules: S.settings.specialRules, now,
            });
            r.log.forEach(logLine);
            setBusy(true, '출고리스트 쓰는 중…');
            await tick();
            const w = await zikjinListBytes(JSZip, f.template.bytes, r);
            await saveOut(r.fileName, w.bytes);
            const p = await pickingBytes(ExcelJS, r.pickItems, 'ZG');
            if (p.bytes) await saveOut(r.pickFileName, p.bytes); else logLine(p.warning);
            await transmit(r.location, r.packs, now);
        } else {
            const warn = baseDateWarning(base, now);
            if (warn) logLine(warn);
            const tmpl = await ablyTemplateFile();
            const r = ablyStep2({
                admin: readBook(X, f.admin.bytes, f.admin.name),
                request: readBook(X, f.request.bytes, f.request.name),
                template: readBook(X, tmpl.bytes, tmpl.name),
                requestName: f.request.name, packageBase: base, packageLimit: limit, now,
            });
            r.log.forEach(logLine);
            setBusy(true, '대량입고 양식 쓰는 중…');
            await tick();
            const w = await ablyBulkBytes(JSZip, tmpl.bytes, r);
            await saveOut(r.fileName, w.bytes);
            const p = await pickingBytes(ExcelJS, r.pickItems, 'AB');
            if (p.bytes) await saveOut(r.pickFileName, p.bytes); else logLine(p.warning);
            await transmit(r.location, r.packs, now);
        }
        logLine(`===== 완료 =====`);
        toast(`${TAB_LABEL[tab]} ${step}단계 완료`);
    } catch (e) {
        console.warn('[플랫폼 출고] 실행 실패:', (e && e.code) || (e && e.name) || 'Error');
        logLine(`✗ 실패: ${errText(e)}`);
        toast('실패 — 진행 기록을 확인하세요', 5000);
    } finally {
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
            병행 기간에는 끄고(exe 가 기록) exe 를 멈출 때 켭니다. ${S.isAdmin ? '' : '<b>관리자만 바꿀 수 있습니다.</b>'}</span></span></label>
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
        S.tab = b.dataset.tab; writeHash(); render();
    });
    $('sp-steps').addEventListener('click', (e) => {
        const b = e.target.closest('.d-seg-btn'); if (!b || S.busy) return;
        S.step[S.tab] = Number(b.dataset.step); writeHash(); render();
    });
    window.addEventListener('hashchange', () => { if (S.busy) return; readHash(); render(); });
    $('sp-run').addEventListener('click', run);
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
