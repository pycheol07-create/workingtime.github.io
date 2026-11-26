// === js/supplies-io.js — 비품 입·출고(supplies-io.html, 2026-11-26 비품관리 앱 기준 전환 3단계) ===
// 휴대폰으로 비품을 고르고(검색·초성·바코드·자주 쓰는 것) 단위 단추로 수량을 쌓아 목록에 모은 뒤 [저장 및 전송] 한 번으로 원장에 쓴다.
//   계산(검색·카드·목록·결과 나누기·sessionStorage 모양)은 js/lib/supplies-io.js, 저장은 js/supplies-ledger-store.js commitLines.
//   스위치 persistent_data/suppliesSettings.ledgerLive 가 true 일 때만 받는다 — 저장 직전에 한 번 더 읽는다.
// ⚠️ 비품 문서(persistent_data/supplies)는 읽자마자 safeItems 로 id·name·unit·barcodes·units·noSingleOut·favorite 만 남긴다(단가·업체 칸은 버림).
// 오프라인 대기열은 없다 — 연결이 없으면 [저장 및 전송]을 막고, 목록은 sessionStorage(비품 id·수량·구성 글·전송 대기 묶음 id)에 남긴다.

import { initializeFirebase } from './config.js?v=242bb63abbe9-dd1665a9';
import { setShellContext } from './app-shell-bridge.js?v=b9a7199f3e1d-c80c27e9';
import { memberNameFor } from './app-shell-data.js?v=e42c6a10ca7a-9319c795';
import { escapeHtml as esc, showConfirm, showAlert } from './utils.js?v=65bb3512764f-e315797c';
import { findByBarcode } from './lib/supplies-units.js?v=38146ad5b84d-33598b26';
import { isLive } from './lib/supplies-mode.js?v=5f016d6adc90-90c9a625';
import { ledgerErrorText } from './lib/supplies-ledger.js?v=44c94c8b86ad-92d65f68';
import { newBatchId, loadStock, commitLines, ledgerEntriesOnServer } from './supplies-ledger-store.js?v=d18800c379ed-8adb83c4';
import {
    safeItems, searchItems, favoriteItems, looksLikeBarcode, hangulBarcodeHint, burstCode, cardSummary, pressUnit, listQtyOf, projected, cardBlockReason,
    addLine, removeLine, planSend, idsToCheck, readResult, afterFailure, toSession, fromSession, fmt, baseUnit, SESSION_KEY
} from './lib/supplies-io.js?v=f9a9017b1958-9f0e7939';
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const { db, auth } = initializeFirebase();
const BASE = ['artifacts', 'team-work-logger-v2'];
const ITEMS_REF = doc(db, ...BASE, 'persistent_data', 'supplies');
const SETTINGS_REF = doc(db, ...BASE, 'persistent_data', 'suppliesSettings');
const CONFIG_REF = doc(db, ...BASE, 'config', 'mainConfig');

const $ = (id) => document.getElementById(id);

let items = [];            // safeItems 결과만
let byId = new Map();
let stock = {};            // { itemId: qty } 원장 재고
let stockOk = false;
let live = null;           // null = 아직 모름(못 읽음), true/false
let dir = 'out';
let list = [];             // [{ itemId, qty, desc }]
let pending = null;        // 저장됐는지 모르는 앞 전송 { dir, batchId, lines, remainKey } — 같은 목록이면 같은 batchId 로 다시
let selId = null;          // 카드에 고른 비품
let counts = {};           // { 단위 qty: 누른 횟수 }
let busy = false;
let me = { email: '', name: '' };
let asking = 0;            // 앱 확인창·안내창이 떠 있는 수 — 그동안 카메라 스캔 결과는 버린다
const HANGUL_TEXT = '바코드가 한글로 들어왔습니다 — 한/영 키를 영문으로 바꾼 뒤 다시 스캔하세요.';
const PENDING_TEXT ='앞 전송이 저장됐는지 확인하지 못했습니다 — 목록을 그대로 두고 먼저 [다시 전송]을 누르세요(두 번 들어가지 않습니다). 실물 출고를 취소했다면 연결된 뒤 [다시 전송]으로 결과를 확인하고, 저장됐으면 비품 관리 화면 이력에서 [되돌리기]를 누르세요.';

const nameOf = (id) => (byId.get(id) ? byId.get(id).name : '(알 수 없는 비품)');
const unitOf = (id) => baseUnit(byId.get(id));
const dirWord = () => (dir === 'out' ? '출고' : '입고');
const hasCounts = () => Object.values(counts).some(n => n > 0);
const ask = async (fn) => { asking++; try { return await fn(); } finally { asking--; } };
const confirmBox = (msg, opts) => ask(() => showConfirm(msg, opts));
const alertBox = (msg, opts) => ask(() => showAlert(msg, opts));
// 찾기 칸으로 초점 — USB 스캐너용(PC). 터치 화면(휴대폰)은 화면 키보드가 올라와 가리므로 옮기지 않는다(2026-11-26)
const isTouch = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } };
const focusSearch = () => { if (!scanner && !isTouch() && !$('si-work').hidden) $('si-search').focus(); };

function saveSession() {
    try { sessionStorage.setItem(SESSION_KEY, toSession(dir, list, pending)); } catch (_) { /* 저장소 막힘 — 이번 화면만 */ }
}

function setMsg(text, ok = false) {
    const el = $('si-msg');
    el.textContent = text || '';
    el.classList.toggle('ok', !!ok);
    el.hidden = !text;
}

// ───────── 불러오기 ─────────
async function loadSettings() {
    try {
        const s = await getDoc(SETTINGS_REF);
        live = isLive(s.exists() ? s.data() : null);
    } catch (e) {
        console.warn('[supplies-io] 재고 기준 설정 읽기 실패:', e && e.code);
        live = null;
    }
    return live;
}

async function loadStockNow() {
    try { stock = await loadStock(db); stockOk = true; }
    catch (e) { stockOk = false; console.warn('[supplies-io] 원장 재고 읽기 실패:', e && e.code); }
}

async function loadAll() {
    $('si-error').hidden = true;
    await loadSettings();
    if (live !== true) { items = []; byId = new Map(); return; }
    try {
        const snap = await getDoc(ITEMS_REF);
        items = safeItems(snap.exists() ? snap.data().items : []);   // 단가·업체 등은 여기서 버린다
        byId = new Map(items.map(it => [it.id, it]));
    } catch (e) {
        console.warn('[supplies-io] 비품 목록 읽기 실패:', e && e.code);
        items = []; byId = new Map();
        showError('비품 목록을 불러오지 못했습니다 — 새로고침해 주세요.');
    }
    await loadStockNow();
    if (!stockOk) showError('앱 재고를 불러오지 못했습니다 — 새로고침한 뒤 다시 해 주세요.');
    let saved = null;
    try { saved = sessionStorage.getItem(SESSION_KEY); } catch (_) { saved = null; }
    if (saved) {
        const r = fromSession(saved, new Set(byId.keys()));
        dir = r.dir; list = r.list; pending = r.pending;
        if (r.dropped) setMsg(`저장 전 목록 중 ${r.dropped}건은 비품을 찾지 못해 뺐습니다.`);
        saveSession();
    }
}

function showError(text) {
    const el = $('si-error');
    el.textContent = text;
    el.hidden = !text;
}

// ───────── 그리기 ─────────
function renderAll() {
    $('si-loading').hidden = true;
    document.querySelectorAll('#si-dir [data-dir]').forEach(b => {
        const on = b.dataset.dir === dir;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const off = $('si-off');
    if (live === true) off.hidden = true;
    else {
        off.textContent = live === false ? '아직 앱 기준으로 전환 전입니다(비품 관리 화면에서 관리자가 전환).'
            : '재고 기준 설정을 읽지 못했습니다 — 인터넷 연결을 확인하고 새로고침해 주세요.';
        off.hidden = false;
    }
    $('si-work').hidden = live !== true;
    $('si-scan').disabled = live !== true;
    if (live !== true && scanner) stopScan();
    if (live !== true) return;
    renderResults();
    renderFavs();
    renderCard();
    renderList();
}

const stockLabel = (id) => (stockOk ? `${fmt(stock[id] || 0)}${unitOf(id)}` : '재고 ?');

function renderResults() {
    const q = $('si-search').value;
    const box = $('si-results');
    if (!q.trim()) { box.hidden = true; box.innerHTML = ''; return; }
    const hits = searchItems(items, q);
    box.innerHTML = hits.length
        ? hits.map(it => `<button type="button" class="si-row" role="listitem" data-pick="${esc(it.id)}"><span class="si-row-name">${it.favorite ? '★ ' : ''}${esc(it.name)}</span><span class="si-row-stock num">재고 ${esc(stockLabel(it.id))}</span></button>`).join('')
        : '<div class="si-empty">맞는 비품이 없습니다</div>';
    box.hidden = false;
}

function renderFavs() {
    const favs = favoriteItems(items);
    $('si-favs').innerHTML = favs.length
        ? favs.map(it => `<button type="button" class="d-btn" data-pick="${esc(it.id)}">${esc(it.name)}</button>`).join('')
        : '<span class="si-small t-2">자주 쓰는 비품이 없습니다(비품 관리 상세에서 표시)</span>';
}

function renderCard() {
    const card = $('si-card');
    const it = selId ? byId.get(selId) : null;
    if (!it) { card.hidden = true; return; }
    card.hidden = false;
    const sum = cardSummary(it, counts, dir);
    const now = stock[it.id] || 0;
    const inList = listQtyOf(list, it.id);
    const after = projected(now, inList, sum.total || 0, dir);
    const unit = baseUnit(it);
    $('si-card-name').textContent = it.name;
    const st = $('si-card-stock');
    st.innerHTML = stockOk
        ? `재고 <b>${esc(fmt(now))}</b> → 저장 후 <b>${esc(fmt(after))}</b> ${esc(unit)}${inList ? ` <span class="si-small">(목록 ${dir === 'out' ? '−' : '+'}${esc(fmt(inList))} 포함)</span>` : ''}`
        : '재고를 불러오지 못했습니다';
    st.classList.toggle('short', stockOk && after < 0);
    $('si-units').innerHTML = sum.buttons.map(u => `<button type="button" class="si-unit${u.n ? ' on' : ''}" data-unit="${u.qty}">`
        + `<span class="si-unit-name">${esc(u.name)}</span><span class="si-unit-base num">${esc(fmt(u.qty))}${esc(unit)}</span>`
        + (u.n ? `<span class="si-unit-n">×${u.n}</span>` : '') + '</button>').join('');
    $('si-calc').textContent = sum.text;
    const why = !stockOk ? '재고를 불러오지 못해 막았습니다 — 새로고침해 주세요.'
        : pending ? '앞 전송 결과를 확인하지 못해 목록에 더 넣을 수 없습니다 — 먼저 [다시 전송]을 누르세요.'
        : cardBlockReason(sum, now, inList, dir);
    const add = $('si-add');
    add.textContent = dirWord();
    add.disabled = !!why || busy;
    $('si-add-why').textContent = sum.parts.length || pending ? why : '';
}

function renderList() {
    $('si-list-title').textContent = list.length ? `${dirWord()}할 것 ${list.length}건 — 아직 저장 전` : `${dirWord()}할 것 0건`;
    const sign = dir === 'out' ? '−' : '+';
    $('si-list').innerHTML = list.length
        ? list.map(l => `<li class="si-li" data-line="${esc(l.itemId)}"><div class="si-li-main"><div class="si-li-name">${esc(nameOf(l.itemId))}</div>`
            + `<div class="si-li-desc">${esc(l.desc || '')}</div></div><span class="si-li-qty num">${sign}${esc(fmt(l.qty))}${esc(unitOf(l.itemId))}</span>`
            + `<button type="button" class="si-x" data-remove="${esc(l.itemId)}" aria-label="${esc(nameOf(l.itemId))} 빼기"${pending || busy ? ' disabled' : ''}>✕</button></li>`).join('')
        : '<li class="si-li-empty">비품을 고르고 단위 단추를 누른 뒤 [' + dirWord() + ']를 누르면 여기에 모입니다.</li>';
    const save = $('si-save');
    save.textContent = busy ? '저장하는 중…' : pending ? `다시 전송 (${list.length}건)` : `저장 및 전송 (${list.length}건)`;
    const online = navigator.onLine !== false;
    let why = '';
    if (!online) why = '인터넷 연결이 없습니다 — 연결된 뒤 다시 눌러 주세요(목록은 이 화면에 남아 있습니다).';
    else if (!stockOk && list.length) why = '재고를 불러오지 못해 막았습니다 — 새로고침해 주세요(목록은 남아 있습니다).';
    else if (pending) why = PENDING_TEXT;
    // pending 이 있으면 화면 목록이 비어 보여도(세션에서 모르는 비품이 빠진 경우) 다시 보낼 수 있게 켠다
    save.disabled = busy || (!list.length && !pending) || !online || !stockOk;
    $('si-save-why').textContent = why;
}

// ───────── 고르기 ─────────
async function pick(id) {
    const it = byId.get(id);
    if (!it) return;
    if (selId && selId !== id && hasCounts()) {
        const ok = await confirmBox(`'${nameOf(selId)}'에 넣던 수량을 버리고 '${it.name}'(으)로 바꿀까요?`, { title: '비품 바꾸기', okText: '바꾸기' });
        if (!ok) return;
    }
    if (selId !== id) counts = {};
    selId = id;
    $('si-search').value = '';
    setMsg('');
    renderAll();
}

/** 바코드(스캐너 카메라·USB) 또는 Enter — 바코드가 맞으면 바로, 아니면 검색 결과가 하나일 때 그것 */
function handleCode(raw, fromCamera = false) {
    const code = String(raw || '').trim();
    if (!code) return;
    const hit = findByBarcode(items, code);
    if (hit) { pick(hit.id); return; }
    if (!fromCamera) {
        const hits = searchItems(items, code);
        if (hits.length === 1) { pick(hits[0].id); return; }
        if (hits.length) return;   // 여럿 — 목록에서 고른다
        // 한글 입력 상태로 스캐너가 친 글자 — 영문으로 바꿔 맞추지 않는다(틀린 비품을 고를 수 있다). 안내만
        if (hangulBarcodeHint(code)) { setMsg(HANGUL_TEXT); $('si-search').select(); return; }
    }
    if (fromCamera || looksLikeBarcode(code)) {
        setMsg(`등록되지 않은 바코드(${code.slice(0, 40)}) — 비품 관리에서 비품에 연결해 주세요.`);
        if (!fromCamera) $('si-search').select();   // 카메라 중에는 키보드가 카메라 화면을 가리므로 고르지 않는다
    }
}

// ───────── 카드 → 목록 ─────────
function addToList() {
    const it = selId ? byId.get(selId) : null;
    if (!it || busy || !stockOk || pending) return;
    const sum = cardSummary(it, counts, dir);
    if (cardBlockReason(sum, stock[it.id] || 0, listQtyOf(list, it.id), dir)) return;
    list = addLine(list, { itemId: it.id, qty: sum.total, desc: sum.desc });
    selId = null; counts = {};
    $('si-result').hidden = true;
    saveSession();
    setMsg(`${it.name} ${fmt(sum.total)}${baseUnit(it)}를 목록에 넣었습니다.`, true);
    renderAll();
    focusSearch();
}

async function switchDir(to) {
    if (to === dir || busy) return;
    if (pending) { alertBox(PENDING_TEXT, { title: '입고·출고 바꾸기' }); return; }
    if (list.length || hasCounts()) {
        const what = list.length ? `저장 전 목록 ${list.length}건` : '고르던 수량';
        const ok = await confirmBox(`${what}을 비우고 ${to === 'out' ? '출고' : '입고'}로 바꿀까요?`, { title: '입고·출고 바꾸기', okText: '비우고 바꾸기', danger: true });
        if (!ok) return;
        list = []; pending = null; counts = {};
    }
    dir = to;
    $('si-result').hidden = true;
    saveSession();
    renderAll();
}

// ───────── 저장 및 전송 ─────────
const errText = (e) => {
    // permission-denied = 비품 권한이 없거나, 그사이 관리자가 앱 기준(스위치)을 껐다(규칙이 막음)
    if (e && e.reason === 'write') return e.code === 'permission-denied' ? '저장하지 못했습니다 — 비품 관리 권한이 없거나, 방금 앱 기준이 꺼졌습니다(새로고침해서 확인).' : `저장하지 못했습니다(${e.code || '연결 확인'}).`;
    return ledgerErrorText(e, nameOf);
};
const lineLi = (l) => `<li>${esc(nameOf(l.itemId))} ${dir === 'out' ? '−' : '+'}${esc(fmt(l.qty))}${esc(unitOf(l.itemId))}</li>`;

async function save() {
    if (busy || (!list.length && !pending)) return;
    if (navigator.onLine === false) { renderList(); return; }
    busy = true;
    renderAll();
    const box = $('si-result');
    try {
        // 저장 직전에 스위치를 다시 본다 — 그사이 관리자가 껐으면 쓰지 않는다
        //   못 읽으면 화면 상태(live)는 그대로 두고 이번 저장만 멈춘다(목록·다시 전송 단추가 사라지지 않게)
        let nowLive = null;
        try { const s = await getDoc(SETTINGS_REF); nowLive = isLive(s.exists() ? s.data() : null); }
        catch (e) { console.warn('[supplies-io] 재고 기준 설정 다시 읽기 실패:', e && e.code); }
        if (nowLive !== true) {
            if (nowLive === false) live = false;
            busy = false;
            renderAll();
            if (nowLive === null) alertBox('재고 기준 설정을 읽지 못해 저장하지 않았습니다 — 연결을 확인한 뒤 다시 눌러 주세요.', { title: '저장 안 함', isError: true });
            return;
        }
        const shown = list.slice();
        const sent = planSend(dir, shown, pending, newBatchId);
        let r;
        try { r = await commitLines(db, sent.lines, dir, me, sent.batchId); }
        catch (e) { r = { parts: [{ ok: false, errors: [{ itemId: '', reason: 'write', code: e && e.code }] }] }; }
        let res = readResult(sent.lines, r.parts, sent.batchId);
        if (!res.allOk && res.uncertain) {
            // 연결 오류 — 안 된 덩어리의 기록 id 를 서버에서 하나씩 확인한다(캐시는 안 믿음 — 오프라인이면 빈 사본으로 '없음' 이 된다).
            // 하나라도 못 읽으면 '모름' 그대로 → pending 으로 같은 batchId 를 다시 쓰게
            try {
                const found = await ledgerEntriesOnServer(db, idsToCheck(sent.lines, r.parts, sent.batchId));
                res = readResult(sent.lines, r.parts, sent.batchId, found);
            } catch (e) { console.warn('[supplies-io] 저장 확인 읽기 실패:', e && e.code); }
        }
        const savedShown = shown.filter(l => res.saved.includes(l.itemId));
        if (res.allOk) {
            list = []; pending = null; selId = null; counts = {};
            box.className = 'si-result ok';
            box.innerHTML = `<b>저장했습니다</b> — ${dirWord()} ${savedShown.length}건<ul>${savedShown.map(lineLi).join('')}</ul>`
                + (res.already ? '<div>이미 저장돼 있던 것은 두 번 들어가지 않았습니다.</div>' : '');
        } else {
            const next = afterFailure(dir, shown, sent, res);
            list = next.list; pending = next.pending;
            const msgs = [...new Set(res.errors.map(errText))];
            box.className = savedShown.length ? 'si-result part' : 'si-result bad';
            box.innerHTML = (savedShown.length ? `<b>저장된 것 ${savedShown.length}건</b><ul>${savedShown.map(lineLi).join('')}</ul>` : '')
                + `<b>안 된 것 ${list.length}건</b>(목록에 남김)<ul>${list.map(lineLi).join('')}</ul>`
                + msgs.map(m => `<div>${esc(m)}</div>`).join('')
                + (res.uncertain ? '<div>연결이 끊겨 저장됐는지 확인하지 못했습니다 — 목록을 고치지 말고 연결된 뒤 [다시 전송]을 누르면 두 번 들어가지 않습니다.</div>' : '');
        }
        box.hidden = false;
        saveSession();
        await loadStockNow();   // 저장한 뒤·재고 부족 뒤 — 지금 재고로 다시
        if (!stockOk) showError('앱 재고를 다시 불러오지 못했습니다 — 새로고침해 주세요.');
    } finally {
        busy = false;
        renderAll();
        if (!list.length && !pending) focusSearch();
    }
}

// ───────── 카메라 스캔(html5-qrcode — js/inspection-media.js 와 같은 판·SRI, 누를 때 받음) ─────────
const QR_LIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html5-qrcode/2.3.8/html5-qrcode.min.js';
const QR_LIB_SRI = 'sha384-c9d8RFSL+u3exBOJ4Yp3HUJXS4znl9f+z66d1y54ig+ea249SpqR+w1wyvXz/lk+';
let qrLibP = null;
const loadQrLib = () => {
    if (window.Html5Qrcode) return Promise.resolve(window.Html5Qrcode);
    if (qrLibP) return qrLibP;
    qrLibP = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = QR_LIB_URL;
        s.integrity = QR_LIB_SRI;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
        s.onload = () => (window.Html5Qrcode ? resolve(window.Html5Qrcode) : reject(new Error('Html5Qrcode 없음')));
        s.onerror = () => { qrLibP = null; s.remove(); reject(new Error('html5-qrcode 를 불러오지 못함')); };
        document.head.appendChild(s);
    });
    return qrLibP;
};

let scanner = null;        // { inst, starting }
let lastCode = { text: '', at: 0 };

function setScanUi(on) {
    $('si-scan').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('si-scan').textContent = on ? '스캔 끄기' : '스캔';
    $('si-reader-wrap').hidden = !on;
}

async function startScan() {
    if (scanner) return;
    const me1 = { inst: null, starting: null, stopped: false };
    scanner = me1;
    setScanUi(true);
    try { await loadQrLib(); }
    catch (e) {
        console.warn('[supplies-io]', e && e.message);
        if (scanner === me1) { scanner = null; setScanUi(false); }
        alertBox('스캐너 도구를 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 눌러 주세요.', { title: '스캔', isError: true });
        return;
    }
    if (me1.stopped) return;
    me1.inst = new window.Html5Qrcode('si-reader');
    me1.starting = me1.inst.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 140 } }, (text) => {
        if (asking) return;   // 확인창이 떠 있는 동안 읽은 것은 버린다(창 뒤에서 비품이 바뀌지 않게)
        const now = Date.now();
        if (text === lastCode.text && now - lastCode.at < 2500) return;   // 같은 바코드를 계속 비추는 동안은 한 번만
        lastCode = { text, at: now };
        try { if (navigator.vibrate) navigator.vibrate(40); } catch (_) { /* 없음 */ }
        handleCode(text, true);
    });
    me1.starting.catch((err) => {
        console.warn('[supplies-io] 카메라 시작 실패:', err && (err.name || err.message || err));
        if (scanner === me1) { scanner = null; setScanUi(false); }
        if (!me1.stopped) alertBox('카메라를 시작할 수 없습니다 — 카메라 권한을 확인해 주세요. USB 스캐너는 찾기 칸에 바로 읽히면 됩니다.', { title: '스캔', isError: true });
    });
}

async function stopScan() {
    const s = scanner;
    scanner = null;
    setScanUi(false);
    if (!s) return;
    s.stopped = true;
    if (!s.inst) return;
    if (s.starting) { try { await s.starting; } catch (_) { return; } }
    try { await s.inst.stop(); } catch (_) { /* 이미 멈춤 */ }
    try { s.inst.clear(); } catch (_) { /* 무시 */ }
}

// ───────── 이벤트 ─────────
function wire() {
    $('si-dir').addEventListener('click', (e) => { const b = e.target.closest('[data-dir]'); if (b) switchDir(b.dataset.dir); });
    $('si-scan').addEventListener('click', () => (scanner ? stopScan() : startScan()));
    const search = $('si-search');
    search.addEventListener('input', () => { setMsg(''); renderResults(); });
    search.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        handleCode(search.value);
    });
    document.addEventListener('click', (e) => {
        const p = e.target.closest('[data-pick]');
        if (p) { pick(p.dataset.pick); return; }
        const u = e.target.closest('#si-units [data-unit]');
        if (u) { counts = pressUnit(counts, Number(u.dataset.unit)); renderCard(); return; }
        const x = e.target.closest('[data-remove]');
        if (x && !busy && !pending) {
            list = removeLine(list, x.dataset.remove);
            $('si-result').hidden = true;
            saveSession();
            renderAll();
        }
    });
    $('si-reset').addEventListener('click', () => { counts = {}; renderCard(); });
    $('si-change').addEventListener('click', () => { selId = null; counts = {}; renderAll(); search.focus(); });
    $('si-add').addEventListener('click', addToList);
    $('si-save').addEventListener('click', save);
    // USB 스캐너 — 찾기 칸 밖(단추에 초점 등)에서 빠르게 들어온 글자 + Enter 도 바코드로 받는다(js/lib/supplies-io.js burstCode).
    //   그때 Enter 는 막는다(초점이 간 단추가 눌리지 않게). 다른 입력칸·찾기 칸에서는 건드리지 않는다(찾기 칸은 자기 Enter 처리)
    let burst = [];
    document.addEventListener('keydown', (e) => {
        if ($('si-work').hidden || e.ctrlKey || e.altKey || e.metaKey) { burst = []; return; }
        const t = e.target;
        if (t === search || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) { burst = []; return; }
        const now = performance.now();
        if (e.key === 'Enter') {
            const b = burstCode(burst, now);
            burst = [];
            if (!b) return;
            e.preventDefault();
            e.stopPropagation();
            if (asking) return;
            if (b.ime) { setMsg(HANGUL_TEXT); return; }
            handleCode(b.code);
            return;
        }
        if (e.key === 'Process' || e.key.length === 1) {
            if (burst.length && now - burst[burst.length - 1].t > 60) burst = [];
            burst.push({ key: e.key, t: now });
            if (burst.length > 40) burst.shift();
        } else if (e.key === 'Shift' || e.key === 'CapsLock') {
            // 스캐너는 대문자마다 Shift 를 먼저 보낸다 — 모은 글자를 지우지 않는다
        } else burst = [];
    }, true);
    window.addEventListener('online', () => renderAll());
    window.addEventListener('offline', () => renderAll());
    window.addEventListener('pagehide', () => { if (scanner) stopScan(); });
}

// 공통 상단바 개인 알림·원장 by 칸(표시용) — 이름은 메모리에만
function loadMemberName(user) {
    getDoc(CONFIG_REF).then((snap) => {
        const name = memberNameFor(snap.exists() ? snap.data().memberEmails : null, user.email);
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
        me = { ...me, name: name || '' };
        if (name) setShellContext({ signedIn: true, uid: user.uid, memberName: name });
    }).catch((e) => console.warn('[supplies-io] 설정 읽기 실패:', e && e.code));
}

wire();
onAuthStateChanged(auth, async (user) => {
    setShellContext(user ? { signedIn: true, uid: user.uid } : { signedIn: false });
    $('si-loading').hidden = true;
    if (!user) {
        $('si-gate').hidden = false;
        $('si-main').hidden = true;
        if (scanner) stopScan();
        return;
    }
    me = { email: String(user.email || '').toLowerCase(), name: '' };
    loadMemberName(user);
    $('si-gate').hidden = true;
    $('si-main').hidden = false;
    $('si-loading').hidden = false;
    await loadAll();
    renderAll();
});
