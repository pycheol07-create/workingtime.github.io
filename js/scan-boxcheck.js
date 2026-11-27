// === js/scan-boxcheck.js — 입고 스캐너(scan.html) '박스 확인' 모드(2026-11-27 사용자 결정) ===
// 박스 라벨을 찍으면(카메라·키보드 스캐너·번호 입력) 그 박스에 아직 미발인 상품이 들었는지 크게 보여 준다.
//   · 읽기만 한다 — 입고 목록·ScanDB·입고이력에 아무것도 쓰지 않는다. 모드를 끄면 원래 입고/위치 스캔.
//   · 박스 번호 = integrations/packBoxes(패킹봇 box_sync.py) 중 고른 패킹 하나(기본 = 가장 최근, 고른 것은 이 폰 localStorage 에 기억).
//   · 미발 = ChinaStockGoods_ScanDB/{상품코드}.mibalQty > 0(입고 팝업의 미발과 같은 문서 — 다른 기기가 잡아 둔 몫(hold)은 빼지 않는다).
//     ScanDB 에는 미발 대상 상품만 있다 — 문서 없음 = 미발 0('스캐너 목록에 없음' 작게). 읽기 실패(오류·권한)만 '확인 못 함'
//     (하나라도 있으면 초록 '미발 없음' 대신 회색).
//   · 판단(박스 번호 찾기·집계·패킹 목록)은 js/lib/box-check.js·pack-boxes.js 의 순수 함수(시험 tests/box-check.test.js).
//   · 찍은 글자는 화면의 '최근 확인' 10건에만 보이고 저장하지 않는다.
//   · 라벨에 바코드가 없다(2026-11-27 사용자 사실 — 인쇄 글자·손글씨) → ① 번호 자판(이 패킹에 쓰인 앞글자 + 0~9, 후보가 하나면 강조)
//     ② [사진으로 읽기]: 스캐너 카메라 프레임(꺼져 있으면 폰 카메라 사진) → 폰 안에서 글자 인식(Tesseract.js, 누를 때만 불러옴)
//     → 이 패킹에 있는 번호만 단추로. 하나여도 자동 확정하지 않는다(손글씨 오인식). 사진은 어디에도 보내지 않는다
//     (Tesseract 는 브라우저 worker 안에서 돈다). 스크립트·worker·인식 엔진(wasm)·영문 글자 자료는 모두 우리 배포본
//     vendor/tesseract/ 에서 받는다(외부 요청 0 — 남의 서버 코드가 우리 출처(로그인 토큰이 있는 곳)에서 돌지 않게, 2026-11-27 리뷰).
//   · 긴급(2026-11-27): 부족수량관리 '긴급'(mibal2/urgent, enabled 일 때만)인 상품이 박스에 있으면 맨 위에 빨강 '긴급 N종 포함' + 음성 '긴급'.
//   · 공급처상품명(2026-11-27): 결과 줄 이름 옆에 작게 — scan.html 이 넘긴 supLoad(박스 안 코드가 든 문서만)·supName. 미발 판정과 따로,
//     기다리지 않는다(먼저 그리고 받으면 그 칸만 채움). 못 읽으면 빈칸.
//   · 공급처상품명으로 찾기(2026-11-27 사용자 요청): 입력칸·블루투스 스캐너·사진 글자에 'GGS…-…' 가 있으면 ProductSupName 을 거꾸로
//     (이름 → 상품코드들) 보고 고른 패킹에서 그 상품들이 든 박스·미발을 보인다. 자료는 처음 필요할 때 supAll(loadAll) 한 번(이 화면 동안 기억).
//     박스 번호 후보와 공급처상품명 후보가 같이 나오면 둘 다 단추로(자동 확정 없음). 판단은 js/lib/box-check.js supCandidates·supPlace.
//   · 실제 라벨에는 바코드가 없다(2026-11-27 사용자 확인 — 포대 손글씨·작은 양식 종이 손글씨). 박스 모드에선 카메라 바코드 인식을 안 쓰고
//     카메라 화면의 [📷 찍어서 읽기](#bx-shutter)로 지금 화면 한 장을 글자 인식한다(카메라가 꺼져 있으면 폰 카메라 촬영). 켤 때 인식 엔진을 미리 불러 둔다.
//     한 장에서 박스 번호와 공급처상품명(또는 款号 → 공급처상품명)이 같이 읽히면 '그 박스에 그 품번 옵션이 실제로 든' 조합만 보인다(pairCandidates).
//     못 읽으면 그 자리에서 입력 도구·자판을 펼친다.
//   · 박스 번호 QR 스티커(2026-11-27, box-qr.html — 실사용 검토 중): 'GGSBOX:<번호>' 를 카메라·손스캐너로 읽으면 그 번호로 바로 확정(후보 고르기 없음).
// scan.html 은 setupScanBoxCheck({ db, doc, getDoc, speak, camReady, grabPhoto, supLoad, supName, supAll }) 한 번 부르고, onScan 에서 isOn() 이면 check(raw) 로 넘긴다.
import { parsePackBoxes } from './lib/pack-boxes.js?v=9e13a65b0cb3-3b57fd51';
import { boxIndex, findBox, boxReport, packChoices, pickPack, scanDbRows, mapLimit,
    supIndex, looksSup, supCandidates, codeBoxes, supPlace, withoutSup, pairCandidates, pairSplit,
    padLetters, padMatches, ocrCandidates, ocrScale, enhanceGray } from './lib/box-check.js?v=9ea481795e93-c7b970d6';
import { isBoxQr, parseBoxQr } from './lib/box-qr.js?v=b6f91b6e9e93-9b7fb1d9';
import { escapeHtml as esc } from './utils.js?v=65bb3512764f-e315797c';

// 글자 인식(Tesseract.js 5.1.1) — vendor/tesseract/(npm 공식 tarball 그대로, sha256 은 vendor/tesseract/SHA256SUMS.txt).
//   worker·core·글자 자료 주소를 모두 직접 준다(안 주면 jsdelivr 에서 받는다). 주소는 이 파일 기준(js/ → ../vendor/).
const TESS_BASE = new URL('../vendor/tesseract/', import.meta.url).href;
const TESS_SRC = TESS_BASE + 'tesseract.min.js';
const TESS_SRI = 'sha384-GJqSu7vueQ9qN0E9yLPb3Wtpd7OrgK8KmYzC8T1IysG1bcvxvIO4qtYR/D3A991F';   // 같은 출처지만 파일이 바뀌면 안 돌게
const TESS_OPTS = {
    workerPath: TESS_BASE + 'worker.min.js',
    workerBlobURL: false,                     // blob 으로 감싸지 않고 이 파일을 바로 worker 로
    corePath: TESS_BASE + 'core',             // SIMD 되는 기기는 tesseract-core-simd-lstm.wasm.js, 아니면 tesseract-core-lstm.wasm.js
    langPath: TESS_BASE + 'lang',             // eng.traineddata.gz(LSTM 정수화본)
};
const TESS_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-~, ';   // 끝의 공백도 — 빼면 'BOX A3' 이 'BOXA3' 로 붙어 나온다(2026-11-27 실제 확인)
const TESS_LOAD_MS = 90000;    // 처음 불러오기(스크립트·엔진·글자 자료 수 MB) 한도
const TESS_READ_MS = 30000;    // 사진 한 장 읽기 한도
let tessWorker = null;         // Promise<worker> — 한 번 만들면 이 화면에서 계속 쓴다(실패하면 null 로 돌려 다음에 다시)
let tessReady = false;
let tessProgress = null;       // 불러오는 동안 진행률을 받을 함수(logger 는 만들 때 한 번만 정해지므로)
let ocrOverride = null;        // 시험 전용(tools/scan-boxcheck-check.py) — (canvas) => Promise<글자>

/** 시험에서만 — 글자 인식을 가짜로 바꾼다(null 이면 원래 Tesseract). 화면 코드는 부르지 않는다 */
export function setOcrEngineForTest(fn) { ocrOverride = typeof fn === 'function' ? fn : null; }

const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} 시간 초과`)), ms))]);

function loadTessScript() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = TESS_SRC; s.integrity = TESS_SRI; s.crossOrigin = 'anonymous'; s.referrerPolicy = 'no-referrer';
        s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('Tesseract 없음')));
        s.onerror = () => { s.remove(); rej(new Error('글자 인식 스크립트를 받지 못함')); };
        document.head.appendChild(s);
    });
}
function getTessWorker() {
    if (!tessWorker) {
        tessWorker = (async () => {
            const T = await loadTessScript();
            const w = await T.createWorker('eng', 1, { ...TESS_OPTS, logger: (m) => { try { if (tessProgress) tessProgress(m); } catch (e) { /* 무시 */ } } });
            // 11 = 흩어진 글자 찾기(라벨에 번호가 여기저기) · 쓰는 글자를 대문자·숫자·기호 몇 개로 제한
            await w.setParameters({ tessedit_char_whitelist: TESS_CHARS, tessedit_pageseg_mode: '11' });
            tessReady = true;
            return w;
        })();
        const mine = tessWorker;
        mine.catch(() => { if (tessWorker === mine) { tessWorker = null; tessReady = false; } });
    }
    return tessWorker;
}
/** 글자 인식 worker 를 끝낸다(박스 모드를 끌 때·시간 초과 때) — 다음에 누르면 새로 만든다(글자 자료는 브라우저 저장분에서) */
function stopOcr() {
    const p = tessWorker;
    tessWorker = null; tessReady = false; tessProgress = null;
    if (p) p.then(w => { try { w.terminate(); } catch (e) { /* 무시 */ } }, () => {});
}
/** canvas → 읽은 글자. onProg({status, progress}) = 처음 불러오는 동안 진행률 */
async function recognize(canvas, onProg) {
    if (ocrOverride) return String(await ocrOverride(canvas) || '');
    tessProgress = onProg;
    try {
        const w = await withTimeout(getTessWorker(), TESS_LOAD_MS, '글자 인식 준비');
        tessProgress = null;
        const r = await withTimeout(w.recognize(canvas), TESS_READ_MS, '글자 읽기');
        return String((r && r.data && r.data.text) || '');
    } catch (e) {
        if (e && /시간 초과/.test(e.message || '')) stopOcr();   // 멈춘 worker 를 남기지 않는다
        throw e;
    } finally { tessProgress = null; }
}

/** 사진(Blob) → 축소·흑백·대비 올린 canvas. 폰 안에서만 */
async function photoCanvas(blob) {
    let src = null, url = '';
    try {
        try { src = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
        catch (e) {
            url = URL.createObjectURL(blob);
            src = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('사진을 열지 못함')); im.src = url; });
        }
        const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
        const k = ocrScale(w0, h0);
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w0 * k)); cv.height = Math.max(1, Math.round(h0 * k));
        const g = cv.getContext('2d', { willReadFrequently: true });
        g.drawImage(src, 0, 0, cv.width, cv.height);
        const im = g.getImageData(0, 0, cv.width, cv.height);
        enhanceGray(im.data);
        g.putImageData(im, 0, 0);
        return cv;
    } finally {
        if (src && src.close) { try { src.close(); } catch (e) { /* 무시 */ } }
        if (url) URL.revokeObjectURL(url);
    }
}

const PACK_BOXES = 'artifacts/team-work-logger-v2/integrations/packBoxes';
const SCANDB = 'ChinaStockGoods_ScanDB';
const PACK_KEY = 'scanBoxPack';   // 고른 패킹No(이 폰에만) — 스캐너 반영 작업 패킹이 없을 때만 쓴다
const SETTINGS = 'artifacts/team-work-logger-v2/mibal2/settings';   // batch.ships = 지금 스캐너에 반영한 작업의 출고일(읽기만)
const HIST_MAX = 10;
const READ_LIMIT = 6;             // ScanDB 동시 읽기 수
const SAME_MS = 5000;             // 카메라가 같은 라벨을 계속 읽을 때 — 마지막으로 본 뒤 5초 안의 같은 글자는 다시 확인하지 않는다
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 저장 못 해도 이번 화면에서는 쓴다 */ } };
const hhmm = (d) => d.toTimeString().slice(0, 5);

/**
 * @param {{ db:object, doc:Function, getDoc:Function, speak?:(t:string)=>void,
 *           camReady?:()=>boolean, grabPhoto?:()=>Promise<Blob|null>, urgent?:()=>Set<string>,
 *           supLoad?:(codes:string[])=>Promise<any>, supName?:(code:string)=>string, supAll?:()=>Promise<Map<string,string>> }} o
 *   supAll = 공급처상품명 전부(js/sup-names-store.js loadAll — 코드 → 이름). 없으면 공급처상품명으로 찾기를 하지 않는다
 *   supLoad·supName = 공급처상품명(js/sup-names-store.js loadFor·supNameOf). 없으면 칸을 그리지 않는다
 *   urgent = 지금 긴급 상품코드(scan.html 이 mibal2/urgent 를 구독 — 꺼짐·못 읽음이면 빈 Set)
 *   camReady·grabPhoto = 스캐너 카메라가 켜져 있으면 지금 프레임(scan.html 수동 촬영과 같은 방법). 없으면 폰 카메라 사진 고르기
 * @returns {{ isOn:()=>boolean, setOn:(v:boolean)=>void, check:(raw:string, opt?:object)=>Promise<void>, reload:()=>Promise<void> } | null}
 */
export function setupScanBoxCheck(o) {
    const $ = (id) => document.getElementById(id);
    const panel = $('bx-panel'), tab = $('tab-box'), sel = $('bx-pack'), src = $('bx-src'), form = $('bx-form'),
        input = $('bx-input'), out = $('bx-result'), hist = $('bx-hist'), reloadBtn = $('bx-reload'),
        pad = $('bx-pad'), padHint = $('bx-pad-hint'), padBtn = $('bx-pad-toggle'), photoBtn = $('bx-photo'), photoFile = $('bx-photo-file'),
        entry = $('bx-entry'), entryBtn = $('bx-entry-toggle'), shutter = $('bx-shutter');
    if (!panel || !tab || !sel || !src || !form || !input || !out || !hist) return null;
    if (panel.dataset.wired) return null;
    panel.dataset.wired = '1';

    let on = false;
    let parsed = null;        // parsePackBoxes 결과(못 읽었으면 null)
    let loadState = 'idle';   // idle · loading · ok · fail(마지막 읽기 실패 — parsed 가 있으면 전에 읽은 것을 쓴다)
    let loadedAt = null;
    let packKey = '';
    let workShips = [];       // 스캐너 반영 작업 출고일
    let manual = false;       // 이번에 켠 동안 사람이 패킹을 직접 골랐다(그동안은 자동으로 안 바꿈)
    let newer = false;
    let idx = new Map();
    let cbox = new Map();     // 상품코드 → 이 패킹에서 든 박스들(공급처상품명으로 찾기)
    let supIdxP = null;       // Promise<supIndex | null> — 처음 필요할 때 한 번(실패·빈 자료면 다음에 다시)
    let pairCtx = null;       // { name, seq } — 공급처상품명 결과를 보는 중에 박스 번호를 넣으면 그 박스 × 그 품번으로 본다
    let seq = 0;              // 늦게 끝난 앞 확인이 새 결과를 덮지 않게
    let last = { raw: '', at: 0 };
    let photoBusy = false;
    const history = [];
    let touch = false;
    try { touch = window.matchMedia('(hover: none)').matches; } catch (e) { /* 모르면 PC 로 본다 */ }
    let padOpen = touch;      // 휴대폰은 번호 자판이 기본(PC 는 [번호 자판]으로 연다)
    // 직접 입력·사진·자판 묶음 — 박스 모드를 켤 때마다 접힘(기억 안 함). 접혀도 입력칸은 초점을 받아 키보드식 스캐너 글자를 받는다(2026-11-27 사용자 요청)
    let entryOpen = false;

    const choices = () => packChoices(parsed, workShips);
    const curPack = () => (parsed ? parsed.packs.find(p => p.key === packKey) || null : null);
    const curLabel = () => { const c = choices().find(x => x.key === packKey); return c ? c.label : ''; };

    function rebuild() {
        const p = curPack();
        idx = p && !p.err ? boxIndex([{ key: p.key, tag: '', b: p.b }]) : new Map();
        cbox = codeBoxes(idx);
        renderPad();
    }

    // ── 번호 자판 — 앞글자는 이 패킹 박스 번호에 쓰인 것만. 입력값은 위 입력칸(#bx-input) 그대로(블루투스 스캐너 입력도 같은 칸) ──
    function setPadOpen(v) {
        padOpen = !!v;
        if (pad) pad.hidden = !padOpen;
        if (padBtn) { padBtn.textContent = padOpen ? '자판 닫기' : '번호 자판'; padBtn.setAttribute('aria-pressed', padOpen ? 'true' : 'false'); }
        applyInputMode();
    }
    // 휴대폰에서 자판을 쓰는 동안·묶음이 접혀 있는 동안은 입력칸에 초점이 있어도 폰 키보드가 안 뜨게
    // (inputmode none — 블루투스 스캐너 글자는 그대로 들어온다). 펼치고 자판을 닫았을 때만 폰 키보드
    function applyInputMode() { if (touch) input.setAttribute('inputmode', (!entryOpen || padOpen) ? 'none' : 'text'); }
    function setEntryOpen(v) {
        entryOpen = !!v;
        if (entry) entry.classList.toggle('bx-collapsed', !entryOpen);
        if (entryBtn) {
            entryBtn.setAttribute('aria-expanded', entryOpen ? 'true' : 'false');
            entryBtn.textContent = entryOpen ? '⌨ 직접 입력 · 사진 · 자판 ▴ 접기' : '⌨ 직접 입력 · 사진 · 자판 ▾';
        }
        applyInputMode();
    }
    function renderPad() {
        if (!pad) return;
        const letters = padLetters(idx);
        const key = (k, label, cls) => `<button type="button" class="bx-key${cls ? ' ' + cls : ''}" data-k="${esc(k)}">${esc(label)}</button>`;
        pad.innerHTML = (letters.length ? `<div class="bx-pad-letters">${letters.map(l => key(l, l, 'bx-key-l')).join('')}</div>` : '')
            + `<div class="bx-pad-grid">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(d => key(d, d)).join('')}`
            + `${key('back', '← 한 칸', 'bx-key-f')}${key('clear', '지우기', 'bx-key-f')}${key('ok', '확인', 'bx-key-ok')}</div>`;
        updateHint();
    }
    function updateHint() {
        if (!padHint) return;
        const v = input.value.trim();
        const m = padMatches(v, idx);
        const okKey = pad ? pad.querySelector('[data-k="ok"]') : null;
        if (okKey) okKey.classList.toggle('bx-ready', !!(m.one || m.exact));
        if (!v) { padHint.innerHTML = idx.size ? '<span class="bx-hint-dim">번호를 누르세요</span>' : ''; return; }
        if (isBoxQr(v)) {
            if (okKey) okKey.classList.add('bx-ready');
            padHint.innerHTML = '<span class="bx-hint-one">박스 스티커 — [확인]</span>';
            return;
        }
        if (o.supAll && looksSup(v)) {
            if (okKey) okKey.classList.add('bx-ready');
            padHint.innerHTML = '<span class="bx-hint-one">공급처상품명으로 찾기 — [확인]</span>';
            return;
        }
        if (!m.list.length) { padHint.innerHTML = `<span class="bx-hint-warn">${esc(v.toUpperCase())} — 이 패킹에 없는 번호</span>`; return; }
        padHint.innerHTML = m.list.map(b => `<button type="button" class="bx-chip${b === m.one ? ' bx-chip-one' : b === m.exact ? ' bx-chip-exact' : ''}" data-box="${esc(b)}">${esc(b)}</button>`).join('')
            + (m.more ? `<span class="bx-hint-dim">외 ${num(m.more)}개</span>` : '')
            + (m.one ? '<span class="bx-hint-one">하나로 좁혀짐 — 누르거나 [확인]</span>' : '');
    }
    function padPress(k) {
        if (k === 'ok') { confirmInput(); return; }
        if (k === 'back') input.value = input.value.slice(0, -1);
        else if (k === 'clear') input.value = '';
        else input.value = (input.value + k).toUpperCase();
        updateHint();
    }
    function submitInput() {
        const v = input.value;
        input.value = '';
        updateHint();
        check(v, { manual: true }).finally(() => focusInput());
    }
    /**
     * [확인](자판·입력칸 Enter) — 친 글자 그대로인 번호(exact)가 있으면 그 번호, 후보가 하나로 좁혀졌으면(강조된 것) 그 번호.
     * 자판으로 칠 수 있는 짧은 모양('A'·'A1'·'12')일 때만 좁힌 번호를 쓰고, 스캐너가 넣은 긴 글자는 지금처럼 글자로 확인한다.
     */
    function confirmInput() {
        const v = input.value.trim().toUpperCase();
        const m = padMatches(v, idx);
        const typed = v.length <= 5 && /^[0-9]*[A-Z]*\d*$/.test(v);
        if (isBoxQr(v)) { submitInput(); return; }   // 박스 스티커(GGSBOX:번호)는 글자 그대로
        if (o.supAll && looksSup(v)) { submitInput(); return; }   // 공급처상품명은 글자 그대로 확인
        if (m.exact) { pickBox(m.exact); return; }
        if (typed && m.one) { pickBox(m.one); return; }
        submitInput();
    }
    function pickBox(b) {
        if (pairCtx && pairCtx.seq === seq && idx.has(b)) { pickPair(b, pairCtx.name); return; }
        input.value = '';
        updateHint();
        check(b, { manual: true, pick: b }).finally(() => focusInput());
    }
    function pickPair(box, name) {
        input.value = '';
        updateHint();
        check(`${box} ${name}`, { manual: true, pair: { box, name } }).finally(() => focusInput());
    }
    /** 못 읽었을 때 — 그 자리에서 입력 도구와 자판을 펼친다 */
    function openPadHere() {
        setEntryOpen(true);
        setPadOpen(true);
        focusInput();
    }
    function pickSup(name) {
        input.value = '';
        updateHint();
        check(name, { manual: true, sup: name }).finally(() => focusInput());
    }
    /** 공급처상품명 거꾸로 표 — 처음 부를 때 loadAll 한 번. 못 읽음·빈 자료면 null(다음에 다시) */
    function getSupIdx() {
        if (!o.supAll) return Promise.resolve(null);
        if (!supIdxP) {
            const mine = supIdxP = Promise.resolve().then(() => o.supAll()).then(m => { const si = supIndex(m); return si.size ? si : null; })
                .catch(() => null);
            mine.then(si => { if (!si && supIdxP === mine) supIdxP = null; });
        }
        return supIdxP;
    }
    function fillPacks() {
        const cs = choices();
        const pk = manual ? pickPack(cs, packKey) : pickPack(cs, lsGet(PACK_KEY), true);
        packKey = pk ? pk.key : '';
        newer = !!(pk && pk.newer);
        sel.innerHTML = cs.length ? cs.map(c => `<option value="${esc(c.key)}"${c.key === packKey ? ' selected' : ''}>${esc(c.label)}</option>`).join('')
            : '<option value="">박스 번호 자료 없음</option>';
        sel.disabled = !cs.length;
        rebuild();
        renderSrc();
    }
    function renderSrc() {
        let t;
        if (!parsed) t = loadState === 'fail' ? '박스 번호 자료를 읽지 못했습니다 — [다시 읽기]를 누르세요' : '박스 번호 자료를 읽는 중…';
        else if (!choices().length) t = '박스 번호 자료가 없습니다(패킹봇이 보낸 패킹만 박스 번호가 있음)';
        else if (curPack() && curPack().err) t = '이 패킹은 박스 번호를 읽지 못했습니다(수정본 파일) — 다른 패킹을 고르세요';
        else t = `이 패킹의 박스 ${num(idx.size)}개` + (loadedAt ? ` · ${hhmm(loadedAt)} 읽음` : '')
            + (loadState === 'fail' ? ' · 새로 읽기 실패(전에 읽은 자료)' : '');
        src.textContent = t;
        src.classList.toggle('bx-src-warn', !!(parsed && newer));
        if (parsed && newer) src.textContent += ' · 더 최근 패킹이 있습니다';
    }

    async function reload() {
        loadState = 'loading';
        if (!parsed) renderSrc();
        if (reloadBtn) reloadBtn.disabled = true;
        try {
            const [snap, st] = await Promise.all([o.getDoc(o.doc(o.db, PACK_BOXES)),
                o.getDoc(o.doc(o.db, SETTINGS)).catch(() => null)]);   // 작업 출고일은 못 읽어도 박스 확인은 된다
            parsed = parsePackBoxes(snap.exists() ? snap.data() : null);
            const b = st && st.exists() ? (st.data() || {}).batch : null;
            workShips = b && Array.isArray(b.ships) ? b.ships.map(String) : [];
            loadState = 'ok';
            loadedAt = new Date();
        } catch (e) {
            console.warn('[scan-box] 박스 번호 자료 읽기 실패', (e && e.code) || '');
            loadState = 'fail';
        } finally {
            if (reloadBtn) reloadBtn.disabled = false;
        }
        fillPacks();
    }

    function focusInput() {
        // 터치 화면은 폰 키보드가 튀어나오므로 자판을 닫았을 때는 자동으로 커서를 두지 않는다.
        // 자판이 열려 있으면(inputmode none) 커서를 둬도 키보드가 안 뜨고, 블루투스 스캐너 글자가 이 칸으로 들어온다.
        if (!touch || padOpen || !entryOpen) { try { input.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
    }

    function setOn(v) {
        on = !!v;
        document.body.classList.toggle('box-mode', on);
        tab.classList.toggle('active', on);
        tab.setAttribute('aria-pressed', on ? 'true' : 'false');
        last = { raw: '', at: 0 };
        if (!on) { seq++; stopOcr(); }   // 읽던 사진은 버리고 글자 인식 worker 도 끝낸다(메모리)
        if (on) {
            manual = false;   // 켤 때마다 스캐너 반영 작업 패킹으로 다시 고른다
            setEntryOpen(false);   // 켤 때마다 직접 입력 묶음은 접힘
            // 글자 인식 엔진을 미리(백그라운드, 실패해도 조용히) — 첫 [찍어서 읽기]가 빠르게. 끄면 stopOcr 가 끝낸다
            if (!ocrOverride && !tessReady && navigator.onLine !== false) getTessWorker().catch(() => { /* 누를 때 다시 */ });
            if (loadState !== 'loading') reload();   // 켤 때마다 새로 읽는다(문서 하나)
            focusInput();
        }
    }

    /** 결과 띠가 자판 아래로 밀려 안 보이면 박스 칸 안에서 보이게 */
    // 박스 칸(#bx-panel)만 스크롤한다 — scrollIntoView 는 페이지 전체를 밀어 카메라가 화면 밖으로 밀릴 수 있다(2026-11-27 사용자 피드백)
    function scrollResult() {
        try {
            const pr = panel.getBoundingClientRect(), r = out.getBoundingClientRect();
            if (r.top < pr.top || r.top > pr.bottom - 60) panel.scrollTop += r.top - pr.top - 6;
        } catch (e) { /* 무시 */ }
    }
    function banner(cls, say, sub, extra) {
        return `<div class="bx-banner ${cls}" role="status">${say}${sub ? `<div class="bx-sub">${sub}</div>` : ''}${extra || ''}</div>`;
    }
    function addHist(label, text, cls) {
        history.unshift({ label, text, cls, at: new Date() });
        if (history.length > HIST_MAX) history.pop();
        hist.innerHTML = history.map(x => `<li class="${esc(x.cls)}"><span class="bx-t">${esc(hhmm(x.at))}</span> <b>${esc(x.label)}</b> — ${esc(x.text)}</li>`).join('');
    }
    const supOf = (code) => { try { return o.supName ? String(o.supName(String(code || '').trim()) || '') : ''; } catch (e) { return ''; } };
    /** 공급처상품명 받기 시작(미발 읽기와 같이) — 다 받아 둔 코드면 null. 실패해도 reject 하지 않는다 */
    const supStart = (codes) => (!o.supLoad || !codes.length || codes.every(c => supOf(c))) ? null
        : Promise.resolve().then(() => o.supLoad(codes)).catch(() => null);
    /** 받은 뒤 결과 줄의 빈 칸만 채운다(그사이 다른 라벨을 찍었으면 안 채움) */
    function fillSup(p, my) {
        if (!p) return;
        p.then(() => {
            if (my !== seq) return;
            out.querySelectorAll('.bx-sup[data-code]').forEach(el => { const v = supOf(el.dataset.code); if (v && !el.textContent) el.textContent = v; });
        }).catch(() => { /* 빈칸 그대로 */ });
    }
    const ask = (say, sub, label, text) => { out.innerHTML = banner('bx-ask', `<div class="bx-say">${esc(say)}</div>`, sub ? esc(sub) : ''); addHist(label, text, 'bx-h-ask'); };

    async function readCodes(codes) {
        return mapLimit(codes, READ_LIMIT, async (code) => {
            try {
                const d = await o.getDoc(o.doc(o.db, SCANDB, String(code).trim()));
                return { code, ok: true, exists: d.exists(), data: d.exists() ? d.data() : null };
            } catch (e) {
                return { code, ok: false };
            }
        });
    }

    /** sup = { name, place(supPlace) } 이면 공급처상품명 결과(제목 = 이름 · 박스들, 줄마다 그 옵션의 박스) */
    function showHit(box, packs, raw, weak, results, sup) {
        // 긴급(mibal2/urgent, 켜져 있을 때만 — 꺼져 있으면 빈 Set 이라 예전 화면과 같다). 미발 판정과 따로
        let urgent = null;
        try { urgent = o.urgent ? o.urgent() : null; } catch (e) { urgent = null; }
        const rep = boxReport(packs, scanDbRows(results), urgent);
        const has = rep.mibalCodes > 0;
        const urg = rep.urgentCodes > 0;
        // 박스 안 상품이 전부 스캐너 목록(ScanDB)에 없으면 초록 대신 회색 — [스캐너에 반영] 전이거나 초기화 직후일 수 있다(2026-11-27 리뷰)
        const items0 = rep.packs.flatMap(p => p.items);
        const allNoDoc = !has && items0.length > 0 && items0.every(x => x.noDoc);
        const unsure = !has && (rep.unknown > 0 || allNoDoc);
        const say = has ? `미발 있음 ${num(rep.mibalCodes)}종 · ${num(rep.mibalQty)}개`
            : rep.unknown > 0 ? `확인 못 함 ${num(rep.unknown)}종`
            : allNoDoc ? '스캐너 목록에 없음 — 반영 여부 확인' : '미발 없음';
        const sub = (sup ? `옵션 ${num(sup.place.codes.length)}개`
                + (sup.place.inBox ? `(이 박스 ${num(sup.place.inPack.length)}개)`
                    : sup.place.inPack.length < sup.place.codes.length ? `(이 패킹 ${num(sup.place.inPack.length)}개)` : '') + ` · ${esc(curLabel())}`
            : `${esc(curLabel())} · 박스 안 ${num(rep.total)}종`)
            + (rep.unknown ? ` · 확인 못 함 ${num(rep.unknown)}종(${navigator.onLine === false ? '오프라인' : '읽기 실패'})` : '');
        const warn = weak ? `<div class="bx-warn">라벨 글자 '${esc(raw)}' 에서 ${esc(box)}번으로 읽었습니다 — 라벨의 박스 번호와 맞는지 확인하세요</div>` : '';
        const urgLine = urg ? `<div class="bx-urgent-top">${has ? `긴급 ${num(rep.urgentCodes)}종 포함` : `긴급 상품 있음 ${num(rep.urgentCodes)}종(미발 없음)`}</div>` : '';
        let h = banner(has ? 'bx-yes' : unsure ? 'bx-ask' : 'bx-no',
            `${urgLine}${sup ? `<div class="bx-box bx-box-sup">${esc(sup.name)}</div><div class="bx-supboxes">박스 ${esc(sup.place.boxes.join(', '))}</div>`
                : `<div class="bx-box">${esc(box)}번 박스</div>`}<div class="bx-say">${say}</div>`, sub, warn);
        const items = rep.packs.flatMap(p => p.items);
        if (items.length) {
            h += '<ul class="bx-list">' + items.map(x => {
                const right = !x.inTable ? '<span class="bx-q bx-q-unk">확인 못 함</span>'
                    : x.mibal > 0 ? `<span class="bx-q bx-q-yes">미발 ${esc(num(x.mibal))}</span>`
                    : x.noDoc ? '<span class="bx-q bx-q-nodoc">스캐너 목록에 없음</span>' : '<span class="bx-q">0</span>';
                const cls = [x.mibal > 0 ? 'bx-hit' : '', x.urgent ? 'bx-urgent' : ''].filter(Boolean).join(' ');
                const where = sup ? `<span class="bx-ibox">${esc((sup.place.byCode[x.code] || []).join(', '))}</span>` : '';
                return `<li class="${cls}">${x.urgent ? '<span class="bx-utag">긴급</span>' : ''}<span class="bx-code">${esc(x.code)}</span>${where}`
                    + `<span class="bx-name">${x.name ? esc(x.name) : ''}</span>`
                    + (o.supLoad ? `<span class="bx-sup" data-code="${esc(x.code)}">${esc(supOf(x.code))}</span>` : '') + right + '</li>';
            }).join('') + '</ul>';
        }
        out.innerHTML = h;
        if (urg || has) {
            // 음성은 한 번만(speak 가 앞 음성을 끊는다) — 긴급이 먼저
            try { if (o.speak) o.speak(urg ? (has ? '긴급 미발' : '긴급') : '미발'); } catch (e) { /* 무시 */ }
            try { navigator.vibrate(urg ? [150, 80, 150] : 150); } catch (e) { /* 무시 */ }
        }
        addHist(sup ? `${sup.name} · 박스 ${sup.place.boxes.join(', ')}` : `${box}번`, (urg ? `긴급 ${num(rep.urgentCodes)}종 · ` : '')
            + (has ? `미발 ${num(rep.mibalCodes)}종 · ${num(rep.mibalQty)}개` : rep.unknown > 0 ? `확인 못 함 ${num(rep.unknown)}종` : allNoDoc ? '스캐너 목록에 없음' : '미발 없음'),
            has || urg ? 'bx-h-yes' : unsure ? 'bx-h-ask' : 'bx-h-no');
    }

    /** 후보 단추 — boxes = [{ box, fixed }], sups = supCandidates 결과. 하나뿐이어도 사람이 눌러야 확인 */
    /** pairs = pairCandidates 결과(박스 × 품번 조합 단추, 맨 앞) · note = 아래 안내(없으면 기본) · warn = 노란 경고 줄 */
    function showChoices(say, sub, boxes, sups, histLabel, pairs = [], note = '', warn = '') {
        const fixed = boxes.some(c => c.fixed) || sups.some(c => c.fixed);
        out.innerHTML = banner('bx-ask', `<div class="bx-say">${esc(say)}</div>`,
            `${sub}${fixed ? " · '보정' = 헷갈리는 글자를 바꿔 맞춘 것" : ''}`,
            (warn ? `<div class="bx-warn">${esc(warn)}</div>` : '')
            + `<div class="bx-choices">${pairs.map(c => `<button type="button" class="bx-pick bx-pick-sup" data-pbox="${esc(c.box)}" data-pname="${esc(c.name)}">${esc(c.box)}번 · ${esc(c.name)}<small> 옵션 ${num(c.codes.length)}개</small></button>`).join('')}`
            + `${boxes.map(c => `<button type="button" class="bx-pick bx-pick-big" data-box="${esc(c.box)}">${esc(c.box)}번${c.fixed ? '<small> 보정</small>' : ''}</button>`).join('')}`
            + `${sups.map(c => `<button type="button" class="bx-pick bx-pick-sup" data-sup="${esc(c.name)}">${esc(c.name)}<small> 공급처상품명${c.fixed ? ' · 보정' : ''}</small></button>`).join('')}</div>`
            + `<div class="bx-sub">${esc(note || '없으면 다시 찍거나 자판으로 넣으세요')}</div>`);
        out.querySelectorAll('[data-pbox]').forEach(b => b.addEventListener('click', () => pickPair(b.dataset.pbox, b.dataset.pname)));
        out.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => pickBox(b.dataset.box)));
        out.querySelectorAll('[data-sup]').forEach(b => b.addEventListener('click', () => pickSup(b.dataset.sup)));
        scrollResult();
        addHist(histLabel, `후보 ${[...pairs.map(c => `${c.box}·${c.name}`), ...boxes.map(c => c.box), ...sups.map(c => c.name)].join(', ')}`, 'bx-h-ask');
    }

    /**
     * 박스 하나 × 공급처상품명 하나 — 그 박스 안의 그 품번 옵션들의 미발·긴급을 크게, 그 박스의 다른 상품은 아래 작게.
     * 그 박스에 그 품번이 없으면 경고 + 박스만·품번만 단추. photo = 사진에서 읽은 조합(라벨과 맞는지 확인 안내)
     */
    async function showPair(box, name, s, my, photo = false) {
        const si = await getSupIdx();
        if (my !== seq) return;
        if (!si) { ask('공급처상품명 자료를 읽지 못했습니다', '박스 번호로 넣어 주세요.', s, '공급처상품명 못 읽음'); return; }
        if (!idx.has(box)) { ask('이 패킹에 없는 박스 번호입니다', `${box} — 고른 패킹(${curLabel()})이 맞는지 확인하세요.`, s, '없는 박스'); return; }
        const nameCodes = si.byName.get(name) || [];
        const { main, others } = pairSplit(idx, box, nameCodes);
        if (!main.length) {
            showChoices(`${box}번 박스에는 ${name} 이(가) 없습니다`, `고른 패킹(${esc(curLabel())}) 기준`, [{ box, fixed: false }], [{ name, codes: nameCodes, fixed: false }], s, [],
                '박스만 보거나 품번만 보려면 아래 단추를 누르세요', '라벨의 박스 번호·품번을 다시 확인하세요');
            return;
        }
        out.innerHTML = banner('bx-ask', `<div class="bx-box">${esc(box)}번 박스 · ${esc(name)}</div><div class="bx-say">미발 확인 중…</div>`, '');
        scrollResult();
        const all = [...main, ...others];
        const supP = supStart(all);
        const results = await readCodes(all);
        if (my !== seq) return;
        const p = curPack();
        const place = { codes: nameCodes, inPack: main, boxes: [box], byCode: Object.fromEntries(main.map(c => [c, [box]])), inBox: true };
        showHit(box, [{ tag: '', key: p ? p.key : '', codes: main }], s, false, results.filter(r => r && main.includes(r.code)), { name, place });
        const extra = [];
        if (photo) extra.push(`<div class="bx-warn">사진에서 같이 읽은 박스 번호·품번입니다 — 라벨과 맞는지 확인하세요</div>`);
        if (others.length) {
            let urgent = null;
            try { urgent = o.urgent ? o.urgent() : null; } catch (e) { urgent = null; }
            const rep2 = boxReport([{ tag: '', key: '', codes: others }], scanDbRows(results.filter(r => r && others.includes(r.code))), urgent);
            extra.push(`<div class="bx-other-title">이 박스의 다른 상품 ${num(others.length)}종${rep2.mibalCodes ? ` · 미발 ${num(rep2.mibalCodes)}종` : ''}</div>`
                + '<ul class="bx-list bx-list-other">' + rep2.packs[0].items.map(x => `<li class="${x.mibal > 0 ? 'bx-hit' : ''}">`
                    + `${x.urgent ? '<span class="bx-utag">긴급</span>' : ''}<span class="bx-code">${esc(x.code)}</span><span class="bx-name">${x.name ? esc(x.name) : ''}</span>`
                    + (o.supLoad ? `<span class="bx-sup" data-code="${esc(x.code)}">${esc(supOf(x.code))}</span>` : '')
                    + `<span class="bx-q${x.mibal > 0 ? ' bx-q-yes' : ''}">${!x.inTable ? '확인 못 함' : x.mibal > 0 ? `미발 ${esc(num(x.mibal))}` : x.noDoc ? '' : '0'}</span></li>`).join('') + '</ul>');
        }
        extra.push(`<div class="bx-choices bx-alt"><button type="button" class="bx-pick" data-box="${esc(box)}">${esc(box)}번 박스 전체</button>`
            + `<button type="button" class="bx-pick bx-pick-sup" data-sup="${esc(name)}">${esc(name)} 전체</button></div>`);
        out.insertAdjacentHTML('beforeend', extra.join(''));
        out.querySelectorAll('.bx-alt [data-box]').forEach(b => b.addEventListener('click', () => { pairCtx = null; pickBox(b.dataset.box); }));
        out.querySelectorAll('.bx-alt [data-sup]').forEach(b => b.addEventListener('click', () => pickSup(b.dataset.sup)));
        fillSup(supP, my);
        scrollResult();
    }

    /** 공급처상품명 하나 → 고른 패킹의 박스들 + 미발. my = 이 확인의 순번 */
    async function showSup(name, s, my) {
        const si = await getSupIdx();
        if (my !== seq) return;
        if (!si) { ask('공급처상품명 자료를 읽지 못했습니다', '박스 번호로 넣어 주세요.', s, '공급처상품명 못 읽음'); return; }
        const codes = si.byName.get(name) || [];
        const place = supPlace(codes, cbox);
        if (!place.inPack.length) {
            ask('이 패킹에 없는 공급처상품명입니다', `${name} · 옵션 ${num(codes.length)}개 — 고른 패킹(${curLabel()})이 맞는지 확인하세요.`, name, '패킹에 없음');
            return;
        }
        out.innerHTML = banner('bx-ask', `<div class="bx-box bx-box-sup">${esc(name)}</div><div class="bx-say">미발 확인 중…</div>`, '');
        scrollResult();
        const supP = supStart(place.inPack);
        const results = await readCodes(place.inPack);
        if (my !== seq) return;
        const p = curPack();
        showHit('', [{ tag: '', key: p ? p.key : '', codes: place.inPack }], s, false, results, { name, place });
        // 박스 번호도 넣으면(아래 단추·자판·스캐너) 그 박스 × 이 품번만 정확히 본다
        out.insertAdjacentHTML('beforeend', `<div class="bx-sub bx-pair-note">박스 번호도 넣으면 그 박스만 정확히 봅니다</div>`
            + `<div class="bx-choices bx-pair-chips">${place.boxes.map(b => `<button type="button" class="bx-pick" data-pbox="${esc(b)}">${esc(b)}번</button>`).join('')}</div>`);
        out.querySelectorAll('.bx-pair-chips [data-pbox]').forEach(b => b.addEventListener('click', () => pickPair(b.dataset.pbox, name)));
        pairCtx = { name, seq: my };
        fillSup(supP, my);
        scrollResult();
    }

    /** 박스 번호 자료·고른 패킹이 아직 판정할 수 없으면 안내를 띄우고 true */
    function notReady(s) {
        if (!parsed) {
            if (loadState === 'fail') ask('박스 번호 자료를 읽지 못했습니다', '[다시 읽기]를 누른 뒤 다시 찍으세요.', s, '자료 못 읽음');
            else ask('박스 번호 자료를 읽는 중입니다', '잠시 뒤 다시 찍으세요.', s, '아직 판정 안 함');
            return true;
        }
        const p = curPack();
        if (!p) { ask('박스 번호 자료가 없습니다', '패킹봇이 보낸 패킹만 박스 번호가 있습니다.', s, '자료 없음'); return true; }
        if (p.err) { ask('이 패킹은 박스 번호를 읽지 못했습니다', '수정본 파일의 박스를 못 읽은 패킹입니다 — 위에서 다른 패킹을 고르세요.', s, '읽기 실패 패킹'); return true; }
        return false;
    }

    // ── 사진으로 읽기 — 후보는 이 패킹에 있는 번호만, 하나여도 사람이 눌러야 확인 ──
    async function readPhoto(blob) {
        if (photoBusy) return;
        photoBusy = true;
        const my = ++seq;
        last = { raw: '', at: 0 };
        const stale = () => my !== seq;
        const prep = (pct) => {
            if (stale()) return;
            out.innerHTML = banner('bx-ask', '<div class="bx-say">글자 인식 준비 중</div>',
                `처음 한 번 수 MB 를 받습니다${pct != null ? ` · ${pct}%` : ''} — 사진은 이 폰 안에서만 읽습니다`);
        };
        try {
            if (notReady('사진')) return;
            if (!tessReady && !ocrOverride && navigator.onLine === false) {
                ask('읽지 못했습니다 — 자판으로 넣어 주세요', '오프라인이라 글자 인식을 불러오지 못했습니다.', '사진', '오프라인');
                return;
            }
            out.innerHTML = banner('bx-ask', '<div class="bx-say">사진 읽는 중…</div>', '');
            const cv = await photoCanvas(blob);
            if (stale()) return;
            if (!tessReady && !ocrOverride) prep(null);
            else out.innerHTML = banner('bx-ask', '<div class="bx-say">글자 읽는 중…</div>', '');
            const text = await recognize(cv, (m) => {
                if (tessReady || !m || typeof m.progress !== 'number') return;
                prep(Math.round(m.progress * 100));
            });
            if (stale()) return;
            // 공급처상품명처럼 보이면 그 자료(처음 한 번)로 후보를 찾고, 박스 번호는 그 조각을 뺀 나머지에서
            // 공급처상품명(GGS…)·款号(스타일번호) → 이름 후보(자료는 처음 한 번). 款号로 찾은 것은 이 패킹에 든 이름만
            const si = o.supAll ? await getSupIdx() : null;
            if (stale()) return;
            const sups = si ? supCandidates(text, si, 4, { packCodes: new Set(cbox.keys()) }) : [];
            const cands = ocrCandidates(sups.length ? withoutSup(text, sups) : text, idx);   // 이름 후보가 없으면 원문 그대로(줄 정보 유지 — 리뷰)
            if (!cands.length && !sups.length) {
                ask('읽지 못했습니다 — 자판으로 넣어 주세요', '손글씨는 잘 못 읽을 수 있습니다. 아래 자판으로 박스 번호를 넣거나, 번호가 크고 반듯하게 나오게 다시 찍으세요.', '사진', '못 읽음');
                openPadHere();
                return;
            }
            if (cands.length && sups.length) {
                // 한 장에서 둘 다 — 그 박스에 그 품번 옵션이 실제로 든 조합만
                const pairs = pairCandidates(cands, sups, idx);
                if (pairs.length === 1) { await showPair(pairs[0].box, pairs[0].name, '사진', my, true); return; }
                if (pairs.length > 1) {
                    showChoices('라벨과 같은 박스 번호 · 품번을 누르세요', `사진에서 읽은 것 중 ${esc(curLabel())} 에서 서로 맞는 조합만`, [], [], '사진', pairs.slice(0, 6));
                    return;
                }
                showChoices(`${cands[0].box}번 박스에는 ${sups[0].name} 이(가) 없습니다`, `사진에서 읽은 박스 번호와 품번이 ${esc(curLabel())} 에서 서로 맞지 않습니다`,
                    cands, sups, '사진', [], '박스만 보거나 품번만 보려면 아래 단추를 누르세요', '라벨의 박스 번호·품번을 다시 확인하세요');
                return;
            }
            showChoices(sups.length ? '라벨과 같은 품번을 누르세요' : '라벨과 같은 번호를 누르세요',
                `사진에서 읽은 것 중 ${esc(curLabel())} 에 있는 번호${sups.length ? '·자료에 있는 공급처상품명' : ''}만`, cands, sups, '사진', [],
                sups.length ? '박스 번호는 못 읽었습니다 — 자판으로 박스 번호도 넣으면 그 박스만 정확히 봅니다' : '');
            if (!cands.length) openPadHere();
        } catch (e) {
            console.warn('[scan-box] 사진 읽기 실패', (e && e.message) || '');
            if (!stale()) ask('읽지 못했습니다 — 자판으로 넣어 주세요',
                navigator.onLine === false ? '오프라인이라 글자 인식을 불러오지 못했습니다.' : '글자 인식을 하지 못했습니다(처음이면 인터넷 연결 확인).', '사진', '인식 실패');
        } finally {
            photoBusy = false;
        }
    }
    function openPhotoPicker() {
        if (!photoFile) return;
        photoFile.value = '';
        photoFile.click();
    }
    async function onPhotoBtn() {
        if (photoBusy) return;
        if (notReady('사진')) return;
        // 스캐너 카메라가 켜져 있으면 지금 화면(수동 촬영과 같은 방법), 아니면 폰 카메라로 찍기
        if (o.camReady && o.grabPhoto && o.camReady()) {
            let blob = null;
            try { blob = await o.grabPhoto(); } catch (e) { blob = null; }
            if (blob) { readPhoto(blob); return; }
        }
        openPhotoPicker();
    }

    /**
     * 찍은 글자 하나 확인. opt.manual = 입력칸에서 넣음(같은 글자 거르기 안 함), opt.pick = 'many' 에서 고른 번호.
     * 예외를 밖으로 던지지 않는다(스캐너가 멈추지 않게).
     */
    async function check(raw, opt = {}) {
        const s = String(raw == null ? '' : raw).trim();
        if (!s) return;
        const now = Date.now();
        if (!opt.manual && !opt.pick && s === last.raw && now - last.at < SAME_MS) { last.at = now; return; }
        last = { raw: s, at: now };
        const my = ++seq;
        try {
            if (notReady(s)) return;
            if (!opt.pair) pairCtx = null;
            if (opt.pair) { await showPair(opt.pair.box, opt.pair.name, s, my); return; }
            // 박스 번호 QR 스티커 — 'GGSBOX:<번호>' 면 그 번호로 바로(공급처상품명·후보 고르기 없음)
            if (!opt.pick && !opt.sup && isBoxQr(s)) {
                const qb = parseBoxQr(s);
                if (!qb) { ask('박스 스티커 번호를 읽지 못했습니다', `'${s}' — 스티커가 맞는지 확인하세요.`, s, '스티커 번호 오류'); return; }
                if (!idx.has(qb)) {
                    ask('이 패킹에 없는 박스 번호입니다', `스티커 ${qb}번 — 고른 패킹(${curLabel()})이 맞는지, 스티커가 이 패킹 박스에 붙은 것인지 확인하세요.`, `${qb}번(스티커)`, '없는 박스');
                    return;
                }
                opt = { ...opt, pick: qb };
            }
            if (opt.sup) { await showSup(opt.sup, s, my); return; }
            // 공급처상품명처럼 보이면(GGS…-…) 자료를 불러와 후보를 찾고, 박스 번호는 그 조각을 뺀 나머지에서만
            let sups = [], supFail = false;
            if (!opt.pick && o.supAll && looksSup(s)) {
                out.innerHTML = banner('bx-ask', '<div class="bx-say">공급처상품명 찾는 중…</div>', '처음 한 번 자료를 받습니다');
                const si = await getSupIdx();
                if (my !== seq) return;
                if (si) sups = supCandidates(s, si); else supFail = true;
            }
            const rest = sups.length ? withoutSup(s, sups) : s;
            const r = opt.pick && idx.has(opt.pick) ? { status: 'hit', box: opt.pick, packs: idx.get(opt.pick), weak: false }
                : rest ? findBox(rest, idx) : { status: 'none', candidates: [] };
            if (sups.length) {
                const boxes = r.status === 'hit' ? [r.box] : r.status === 'many' ? r.choices : [];
                // 그대로 맞은 이름 하나뿐(박스 번호 후보 없음) = 사람이 넣은 그 이름 → 바로 결과. 그 밖은 고르게
                if (!boxes.length && sups.length === 1 && !sups[0].fixed) { await showSup(sups[0].name, s, my); return; }
                showChoices('박스 번호와 공급처상품명이 같이 읽힙니다 — 고르세요', `${esc(curLabel())} 기준`,
                    boxes.map(b => ({ box: b, fixed: false })), sups, s);
                return;
            }
            if (r.status === 'hit') {
                out.innerHTML = banner('bx-ask', `<div class="bx-box">${esc(r.box)}번 박스</div><div class="bx-say">미발 확인 중…</div>`, '');
                scrollResult();
                const codes = [...new Set(r.packs.flatMap(x => x.codes || []))];
                const supP = supStart(codes);   // 공급처상품명 — 기다리지 않는다
                const results = await readCodes(codes);
                if (my !== seq) return;   // 그사이 다른 라벨을 찍었다
                showHit(r.box, r.packs, s, r.weak, results);
                fillSup(supP, my);
                scrollResult();
            } else if (r.status === 'many') {
                out.innerHTML = banner('bx-ask', '<div class="bx-say">박스 번호가 여럿으로 읽힙니다 — 고르세요</div>', '',
                    `<div class="bx-choices">${r.choices.map(b => `<button type="button" class="bx-pick" data-box="${esc(b)}">${esc(b)}번</button>`).join('')}</div>`);
                out.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => { check(s, { pick: b.dataset.box }).finally(() => focusInput()); }));
                scrollResult();
                addHist(s, '번호 고르기', 'bx-h-ask');
            } else if (r.status === 'empty') {
                ask('이 패킹에 박스 번호 자료가 없습니다', '다른 패킹을 고르세요.', s, '자료 없음');
            } else {
                if (looksSup(s) && o.supAll) {
                    ask(supFail ? '공급처상품명 자료를 읽지 못했습니다' : '자료에 없는 공급처상품명입니다',
                        supFail ? '박스 번호로 넣어 주세요(잠시 뒤 다시 하면 다시 읽습니다).' : `읽은 글자: ${s} — 글자가 맞는지, 박스 번호로도 넣어 보세요.`,
                        s, supFail ? '공급처상품명 못 읽음' : '없는 공급처상품명');
                    return;
                }
                ask('이 패킹에 없는 박스 번호입니다',
                    `읽은 번호: ${r.candidates.length ? r.candidates.join(', ') : '없음'} — 고른 패킹(${curLabel()})이 맞는지, 라벨이 이 패킹 것인지 확인하세요.`,
                    s, '없는 박스');
            }
        } catch (e) {
            console.warn('[scan-box] 확인 오류', e);
            if (my === seq) ask('확인 중 오류가 났습니다', '다시 찍어 주세요.', s, '확인 안 됨');
        }
    }

    sel.addEventListener('change', () => {
        packKey = sel.value;
        manual = true;
        if (packKey) lsSet(PACK_KEY, packKey);
        newer = !!(pickPack(choices(), packKey) || {}).newer;
        rebuild(); renderSrc();
        seq++; last = { raw: '', at: 0 };
        out.innerHTML = '';
    });
    form.addEventListener('submit', (e) => { e.preventDefault(); confirmInput(); });
    input.addEventListener('input', updateHint);
    if (pad) {
        // 자판 단추를 눌러도 입력칸 커서를 뺏지 않게(블루투스 스캐너 글자가 계속 입력칸으로)
        pad.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-k]')) e.preventDefault(); });
        pad.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b) padPress(b.dataset.k); });
    }
    if (padHint) {
        padHint.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-box]')) e.preventDefault(); });
        padHint.addEventListener('click', (e) => { const b = e.target.closest('[data-box]'); if (b) pickBox(b.dataset.box); });
    }
    if (padBtn) padBtn.addEventListener('click', () => { setPadOpen(!padOpen); if (padOpen) focusInput(); else if (touch) input.blur(); });
    // 단추를 누른 뒤에도 커서는 입력칸으로 — 블루투스 스캐너의 Enter 가 방금 누른 단추를 다시 누르지 않게(2026-11-27 리뷰)
    if (photoBtn) photoBtn.addEventListener('click', () => { onPhotoBtn().finally(() => focusInput()); });
    if (photoFile) photoFile.addEventListener('change', () => {
        const f = photoFile.files && photoFile.files[0];
        photoFile.value = '';
        if (f) readPhoto(f);
    });
    if (entryBtn) entryBtn.addEventListener('click', () => { setEntryOpen(!entryOpen); focusInput(); });
    // 카메라 화면의 [📷 찍어서 읽기] — [사진으로 읽기]와 같은 흐름(카메라가 켜져 있으면 지금 화면, 꺼져 있으면 폰 카메라)
    if (shutter) shutter.addEventListener('click', (e) => { e.stopPropagation(); onPhotoBtn().finally(() => focusInput()); });
    setPadOpen(padOpen);
    setEntryOpen(false);
    renderPad();
    if (reloadBtn) reloadBtn.addEventListener('click', () => { reload(); focusInput(); });
    tab.addEventListener('click', () => setOn(!on));

    return { isOn: () => on, setOn, check, reload };
}
