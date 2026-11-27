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
// scan.html 은 setupScanBoxCheck({ db, doc, getDoc, speak, camReady, grabPhoto }) 한 번 부르고, onScan 에서 isOn() 이면 check(raw) 로 넘긴다.
import { parsePackBoxes } from './lib/pack-boxes.js?v=9e13a65b0cb3-3b57fd51';
import { boxIndex, findBox, boxReport, packChoices, pickPack, scanDbRows, mapLimit,
    padLetters, padMatches, ocrCandidates, ocrScale, enhanceGray } from './lib/box-check.js?v=6dc90ab96df1-f0a046ea';
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
 *           camReady?:()=>boolean, grabPhoto?:()=>Promise<Blob|null>, urgent?:()=>Set<string> }} o
 *   urgent = 지금 긴급 상품코드(scan.html 이 mibal2/urgent 를 구독 — 꺼짐·못 읽음이면 빈 Set)
 *   camReady·grabPhoto = 스캐너 카메라가 켜져 있으면 지금 프레임(scan.html 수동 촬영과 같은 방법). 없으면 폰 카메라 사진 고르기
 * @returns {{ isOn:()=>boolean, setOn:(v:boolean)=>void, check:(raw:string, opt?:object)=>Promise<void>, reload:()=>Promise<void> } | null}
 */
export function setupScanBoxCheck(o) {
    const $ = (id) => document.getElementById(id);
    const panel = $('bx-panel'), tab = $('tab-box'), sel = $('bx-pack'), src = $('bx-src'), form = $('bx-form'),
        input = $('bx-input'), out = $('bx-result'), hist = $('bx-hist'), reloadBtn = $('bx-reload'),
        pad = $('bx-pad'), padHint = $('bx-pad-hint'), padBtn = $('bx-pad-toggle'), photoBtn = $('bx-photo'), photoFile = $('bx-photo-file');
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
    let seq = 0;              // 늦게 끝난 앞 확인이 새 결과를 덮지 않게
    let last = { raw: '', at: 0 };
    let photoBusy = false;
    const history = [];
    let touch = false;
    try { touch = window.matchMedia('(hover: none)').matches; } catch (e) { /* 모르면 PC 로 본다 */ }
    let padOpen = touch;      // 휴대폰은 번호 자판이 기본(PC 는 [번호 자판]으로 연다)

    const choices = () => packChoices(parsed, workShips);
    const curPack = () => (parsed ? parsed.packs.find(p => p.key === packKey) || null : null);
    const curLabel = () => { const c = choices().find(x => x.key === packKey); return c ? c.label : ''; };

    function rebuild() {
        const p = curPack();
        idx = p && !p.err ? boxIndex([{ key: p.key, tag: '', b: p.b }]) : new Map();
        renderPad();
    }

    // ── 번호 자판 — 앞글자는 이 패킹 박스 번호에 쓰인 것만. 입력값은 위 입력칸(#bx-input) 그대로(블루투스 스캐너 입력도 같은 칸) ──
    function setPadOpen(v) {
        padOpen = !!v;
        if (pad) pad.hidden = !padOpen;
        if (padBtn) { padBtn.textContent = padOpen ? '자판 닫기' : '번호 자판'; padBtn.setAttribute('aria-pressed', padOpen ? 'true' : 'false'); }
        // 휴대폰에서 자판을 쓰는 동안은 입력칸을 눌러도 폰 키보드가 안 뜨게(inputmode none — 블루투스 스캐너 글자는 그대로 들어온다)
        if (touch) input.setAttribute('inputmode', padOpen ? 'none' : 'text');
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
        if (m.exact) { pickBox(m.exact); return; }
        if (typed && m.one) { pickBox(m.one); return; }
        submitInput();
    }
    function pickBox(b) {
        input.value = '';
        updateHint();
        check(b, { manual: true, pick: b }).finally(() => focusInput());
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
        if (!touch || padOpen) { try { input.focus({ preventScroll: true }); } catch (e) { /* 무시 */ } }
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
            if (loadState !== 'loading') reload();   // 켤 때마다 새로 읽는다(문서 하나)
            focusInput();
        }
    }

    /** 결과 띠가 자판 아래로 밀려 안 보이면 박스 칸 안에서 보이게 */
    function scrollResult() { try { out.scrollIntoView({ block: 'nearest' }); } catch (e) { /* 무시 */ } }
    function banner(cls, say, sub, extra) {
        return `<div class="bx-banner ${cls}" role="status">${say}${sub ? `<div class="bx-sub">${sub}</div>` : ''}${extra || ''}</div>`;
    }
    function addHist(label, text, cls) {
        history.unshift({ label, text, cls, at: new Date() });
        if (history.length > HIST_MAX) history.pop();
        hist.innerHTML = history.map(x => `<li class="${esc(x.cls)}"><span class="bx-t">${esc(hhmm(x.at))}</span> <b>${esc(x.label)}</b> — ${esc(x.text)}</li>`).join('');
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

    function showHit(box, packs, raw, weak, results) {
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
        const sub = `${esc(curLabel())} · 박스 안 ${num(rep.total)}종`
            + (rep.unknown ? ` · 확인 못 함 ${num(rep.unknown)}종(${navigator.onLine === false ? '오프라인' : '읽기 실패'})` : '');
        const warn = weak ? `<div class="bx-warn">라벨 글자 '${esc(raw)}' 에서 ${esc(box)}번으로 읽었습니다 — 라벨의 박스 번호와 맞는지 확인하세요</div>` : '';
        const urgLine = urg ? `<div class="bx-urgent-top">${has ? `긴급 ${num(rep.urgentCodes)}종 포함` : `긴급 상품 있음 ${num(rep.urgentCodes)}종(미발 없음)`}</div>` : '';
        let h = banner(has ? 'bx-yes' : unsure ? 'bx-ask' : 'bx-no',
            `${urgLine}<div class="bx-box">${esc(box)}번 박스</div><div class="bx-say">${say}</div>`, sub, warn);
        const items = rep.packs.flatMap(p => p.items);
        if (items.length) {
            h += '<ul class="bx-list">' + items.map(x => {
                const right = !x.inTable ? '<span class="bx-q bx-q-unk">확인 못 함</span>'
                    : x.mibal > 0 ? `<span class="bx-q bx-q-yes">미발 ${esc(num(x.mibal))}</span>`
                    : x.noDoc ? '<span class="bx-q bx-q-nodoc">스캐너 목록에 없음</span>' : '<span class="bx-q">0</span>';
                const cls = [x.mibal > 0 ? 'bx-hit' : '', x.urgent ? 'bx-urgent' : ''].filter(Boolean).join(' ');
                return `<li class="${cls}">${x.urgent ? '<span class="bx-utag">긴급</span>' : ''}<span class="bx-code">${esc(x.code)}</span>`
                    + `<span class="bx-name">${x.name ? esc(x.name) : ''}</span>${right}</li>`;
            }).join('') + '</ul>';
        }
        out.innerHTML = h;
        if (urg || has) {
            // 음성은 한 번만(speak 가 앞 음성을 끊는다) — 긴급이 먼저
            try { if (o.speak) o.speak(urg ? (has ? '긴급 미발' : '긴급') : '미발'); } catch (e) { /* 무시 */ }
            try { navigator.vibrate(urg ? [150, 80, 150] : 150); } catch (e) { /* 무시 */ }
        }
        addHist(`${box}번`, (urg ? `긴급 ${num(rep.urgentCodes)}종 · ` : '')
            + (has ? `미발 ${num(rep.mibalCodes)}종 · ${num(rep.mibalQty)}개` : rep.unknown > 0 ? `확인 못 함 ${num(rep.unknown)}종` : allNoDoc ? '스캐너 목록에 없음' : '미발 없음'),
            has || urg ? 'bx-h-yes' : unsure ? 'bx-h-ask' : 'bx-h-no');
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
            const cands = ocrCandidates(text, idx);
            if (!cands.length) {
                ask('읽지 못했습니다 — 자판으로 넣어 주세요', '라벨 번호가 크고 반듯하게 나오게 다시 찍거나, 아래 자판으로 번호를 넣으세요.', '사진', '못 읽음');
                return;
            }
            const fixedNote = cands.some(c => c.fixed) ? " · '보정' = 헷갈리는 글자를 바꿔 맞춘 번호" : '';
            out.innerHTML = banner('bx-ask', '<div class="bx-say">라벨과 같은 번호를 누르세요</div>',
                `사진에서 읽은 번호 중 ${esc(curLabel())} 에 있는 것만${fixedNote}`,
                `<div class="bx-choices">${cands.map(c => `<button type="button" class="bx-pick bx-pick-big" data-box="${esc(c.box)}">${esc(c.box)}번${c.fixed ? '<small> 보정</small>' : ''}</button>`).join('')}</div>`
                + '<div class="bx-sub">없으면 다시 찍거나 자판으로 넣으세요</div>');
            out.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => pickBox(b.dataset.box)));
            scrollResult();
            addHist('사진', `후보 ${cands.map(c => c.box).join(', ')}`, 'bx-h-ask');
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
            const r = opt.pick && idx.has(opt.pick) ? { status: 'hit', box: opt.pick, packs: idx.get(opt.pick), weak: false } : findBox(s, idx);
            if (r.status === 'hit') {
                out.innerHTML = banner('bx-ask', `<div class="bx-box">${esc(r.box)}번 박스</div><div class="bx-say">미발 확인 중…</div>`, '');
                scrollResult();
                const codes = [...new Set(r.packs.flatMap(x => x.codes || []))];
                const results = await readCodes(codes);
                if (my !== seq) return;   // 그사이 다른 라벨을 찍었다
                showHit(r.box, r.packs, s, r.weak, results);
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
    setPadOpen(padOpen);
    renderPad();
    if (reloadBtn) reloadBtn.addEventListener('click', () => { reload(); focusInput(); });
    tab.addEventListener('click', () => setOn(!on));

    return { isOn: () => on, setOn, check, reload };
}
