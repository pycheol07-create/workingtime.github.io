// === js/supplies-io.js — 비품 입·출고(supplies-io.html, 2026-11-26 비품관리 앱 기준 전환 3단계 · 2026-11-27 공유 누적) ===
// 휴대폰으로 비품을 고르고(검색·초성·바코드·자주 쓰는 것·목록 드롭다운) 단위 단추를 누르면 공유 누적 칸에 바로 더한다.
//   칸 = suppliesIoCart/{in|out}-{비품 id} — 모든 사람이 실시간(onSnapshot)으로 같은 칸을 본다. 같은 비품은 누가 눌러도 한 칸(이중 누적 없음),
//   다른 비품 칸은 서로 독립. 누름은 트랜잭션(cartPress)이라 동시에 눌러도 잃지 않는다. 쓰기가 실패한 누름은 '반영 안 됨'으로 보이고 내 폰에 쌓아 두지 않는다.
//   [출고 전송]/[입고 전송] = 고른 비품 칸만 한 트랜잭션에서 원장 기록 + 칸 비움(cartSend). 남이 먼저 보냈으면 칸이 비어 두 번 들어가지 않는다.
//   입고도 출고와 같은 흐름(2026-11-27 — 공유 누적이라 '내 폰 카드에 모았다가 넣기'가 없다).
//   음성 안내: 내가 누른 것만, 그 비품 칸의 누적(기본 단위 합 + 단위). 다른 사람 변경은 화면만.
//   계산(검색·칸 모양·누름 검사·목록 순서)은 js/lib/supplies-io.js, 저장은 js/supplies-ledger-store.js cartPress·cartSend·cartClear.
//   스위치 persistent_data/suppliesSettings.ledgerLive 가 true 일 때만 받는다 — 전송 직전에 한 번 더 읽는다(규칙도 켜짐일 때만 허용).
// ⚠️ 비품 문서(persistent_data/supplies)는 읽자마자 safeItems 로 id·name·unit·barcodes·units·noSingleOut·favorite·category·code(비품코드) 만 남긴다(단가·업체 칸은 버림).
//   칸 문서의 by(이름)는 화면에만 보인다(로그에 남기지 않는다).

import { initializeFirebase } from './config.js?v=242bb63abbe9-dd1665a9';
import { setShellContext } from './app-shell-bridge.js?v=b9a7199f3e1d-c80c27e9';
import { memberNameFor } from './app-shell-data.js?v=e42c6a10ca7a-9319c795';
import { escapeHtml as esc, showConfirm, showAlert } from './utils.js?v=65bb3512764f-e315797c';
import { findByBarcode } from './lib/supplies-units.js?v=38146ad5b84d-33598b26';
import { isLive, atMs } from './lib/supplies-mode.js?v=5f016d6adc90-90c9a625';
import { ledgerErrorText } from './lib/supplies-ledger.js?v=44c94c8b86ad-92d65f68';
import { newBatchId, loadStock, watchCart, cartPress, cartSend, cartClear, cartEntryId, ledgerEntryOnServer, loadLedger, commitRevert } from './supplies-ledger-store.js?v=a8c432ad2382-df961c02';
import {
    safeItems, searchItems, favoriteItems, looksLikeBarcode, hangulBarcodeHint, burstCode, cardSummary, fmt, baseUnit, SESSION_KEY,
    dropdownGroups, speechText, slotId, slotOf, countsDesc, pressSlot, unpressSlot, slotRows, otherDirCount, slotEmptiedBy, agoText, slotIsOld,
    kstDayStartMs, kstTimeText, historyRows
} from './lib/supplies-io.js?v=167eae41e003-f29708e5';
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
let liveAtMs = NaN;        // 앱 기준을 (다시) 켠 시각 — 그보다 먼저 쌓인 칸은 전송·이어 쌓기 막음(비우기만)
let loaded = false;        // 첫 불러오기가 끝났나(그 전에는 이름이 와도 다시 그리지 않는다)
let memberEmails = null;   // mainConfig.memberEmails — 칸을 누른·보낸 사람 이름은 byEmail 로 여기서 찾는다(메모리에만)
let dir = 'out';
let selId = null;          // 카드에 고른 비품
let slots = new Map();     // 공유 누적 칸 { slotId: slotOf(...) } — onSnapshot 이 채운다
let cartOk = false;        // 칸 구독이 한 번이라도 서버 값을 받았나
let cartErr = '';          // 구독 오류 안내
let unwatch = null;
let pressing = 0;          // 쓰는 중인 누름 수(그동안 [전송]을 막는다 — 마지막 누름이 빠진 채 보내지 않게)
let pressWhy = '';         // 방금 누름이 막히거나 실패한 이유
let flashId = null;        // 누적 칸에서 잠깐 강조할 비품(방금 누름)
let busy = false;          // 전송 중
let selectFor = null;      // 드롭다운을 그린 items(같으면 다시 안 그림 — 펼친 목록이 닫히지 않게)
let me = { email: '', name: '' };
let asking = 0;            // 앱 확인창·안내창이 떠 있는 수 — 그동안 카메라 스캔 결과는 버린다
// 전송 기록(2026-11-27) — 열었을 때만 원장을 읽는다(한국 날짜 0시부터 · 한도 HIST_MAX)
const HIST_MAX = 300;
let hist = { open: false, days: 2, mine: false, entries: [], loading: false, err: '', full: false, msg: '', msgOk: false };
const reverting = new Set();   // 되돌리는 중인 기록 id — 두 번 눌러도 한 번만(서버도 rv-{id} 한 번만)
const HANGUL_TEXT = '바코드가 한글로 들어왔습니다 — 한/영 키를 영문으로 바꾼 뒤 다시 스캔하세요.';

const nameOf = (id) => (byId.get(id) ? byId.get(id).name : '(알 수 없는 비품)');
// 사람 이름 — byEmail → memberEmails(비품관리 이력과 같은 방식). 모르면 '다른 사람'
const personOf = (email) => (email && email === me.email ? '나' : (memberNameFor(memberEmails, email) || '다른 사람'));
const OLD_TEXT = '앱 기준을 다시 켜기 전에 쌓인 칸입니다 — [비우기] 한 뒤 다시 쌓아 주세요.';
const unitOf = (id) => baseUnit(byId.get(id));
const dirWord = () => (dir === 'out' ? '출고' : '입고');
const slotFor = (id) => slots.get(slotId(dir, id)) || null;
const ask = async (fn) => { asking++; try { return await fn(); } finally { asking--; } };
const confirmBox = (msg, opts) => ask(() => showConfirm(msg, opts));
const alertBox = (msg, opts) => ask(() => showAlert(msg, opts));
// 찾기 칸으로 초점 — USB 스캐너용(PC). 터치 화면(휴대폰)은 화면 키보드가 올라와 가리므로 옮기지 않는다(2026-11-26)
const isTouch = () => { try { return matchMedia('(pointer: coarse)').matches; } catch (_) { return false; } };
const focusSearch = () => { if (!scanner && !isTouch() && !$('si-work').hidden) $('si-search').focus(); };
const online = () => navigator.onLine !== false;
// 음성 안내 — 앞 음성은 끊고 새로. 지원 안 되거나 막히면 조용히 넘어간다
//   휴대폰(특히 iPhone)은 화면을 누른 그 순간에 시작한 음성만 허용한다 — 누름 결과는 서버 저장 뒤(await)에 읽으므로
//   처음 화면을 누를 때 빈 음성을 한 번 내서 잠금을 푼다(입고 스캐너 scan.html 과 같은 방법, 2026-11-27 '음성 안 나옴').
const hasSpeech = () => { try { return !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined'; } catch (_) { return false; } };
let speechUnlocked = false;
let koVoice = null;
function pickVoice() {
    try { koVoice = speechSynthesis.getVoices().find(v => /^ko(-|_|$)/i.test(v.lang)) || null; } catch (_) { koVoice = null; }
}
// 빈 음성으로 잠금 풀기는 아이폰·아이패드만 — 안드로이드 크롬은 이 소리 없는 음성이 '말하는 중'으로 남아 다음 음성을
//   cancel() 직후 삼키는 일이 있다(2026-11-27 '안드로이드도 소리 안 남'). 안드로이드는 앞선 탭만 있으면 된다.
const isIOS = (() => { try { return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); } catch (_) { return false; } })();
let lastUtter = null;   // 크롬이 말하기 전에 음성 객체를 치워 버려 조용해지는 일이 있다 — 참조를 잡아 둔다
function unlockSpeech() {
    if (speechUnlocked || !hasSpeech()) return;
    if (!isIOS) { speechUnlocked = true; pickVoice(); return; }
    try {
        pickVoice();
        const u = new SpeechSynthesisUtterance('.');   // 빈 글자는 사파리가 건너뛰어 잠금이 안 풀린다 — 소리 없이 한 글자
        u.volume = 0;
        u.lang = 'ko-KR';
        speechSynthesis.speak(u);
        speechUnlocked = true;
    } catch (_) { /* 무시 — 다음 탭에 다시 */ }
}
if (hasSpeech()) {
    try { speechSynthesis.addEventListener('voiceschanged', pickVoice); } catch (_) { /* 옛 브라우저 */ }
    pickVoice();
    // 화면을 처음 탭할 때(어느 단추든) 잠금을 푼다 — 아이폰 사파리는 손을 뗄 때(touchend·click)만 사용자 동작으로 친다
    //   (pointerdown·touchstart 에서 부르면 조용히 무시되고, 그 뒤로 다시 풀지 않아 음성이 계속 안 났다 — 2026-11-27)
    ['touchend', 'click', 'keydown'].forEach(ev => document.addEventListener(ev, unlockSpeech, { capture: true, passive: true }));
}
function speak(text) {
    try {
        if (!hasSpeech()) return;
        const u = new SpeechSynthesisUtterance(text);
        u.lang = 'ko-KR';
        // 목소리(u.voice)는 고르지 않는다 — 삼성 인터넷은 직접 고른 목소리면 조용해진다(입고 스캐너처럼 lang 만, 2026-11-27)
        u.rate = 1.1;
        u.volume = 1;
        lastUtter = u;
        if (speechSynthesis.paused) speechSynthesis.resume();
        // 말하는 중이면 끊고 잠깐 뒤에 — cancel() 바로 뒤 speak() 는 안드로이드 크롬이 조용히 버린다
        if (speechSynthesis.speaking || speechSynthesis.pending) {
            speechSynthesis.cancel();
            setTimeout(() => { try { if (lastUtter === u) speechSynthesis.speak(u); } catch (_) { /* 무시 */ } }, 120);
        } else {
            speechSynthesis.speak(u);
        }
    } catch (_) { /* 음성 없음 */ }
}

function setMsg(text, ok = false) {
    const el = $('si-msg');
    el.textContent = text || '';
    el.classList.toggle('ok', !!ok);
    el.hidden = !text;
}

function showResult(cls, html) {
    const box = $('si-result');
    box.className = `si-result ${cls}`;
    box.innerHTML = html;
    box.hidden = false;
}

// ───────── 불러오기 ─────────
async function loadSettings() {
    try {
        const s = await getDoc(SETTINGS_REF);
        const d = s.exists() ? s.data() : null;
        live = isLive(d);
        liveAtMs = live ? atMs(d.liveAt) : NaN;
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
    // 2026-11-26 판의 '내 폰 목록'(sessionStorage) — 공유 누적으로 바뀌어 더 쓰지 않는다
    try { sessionStorage.removeItem(SESSION_KEY); } catch (_) { /* 저장소 막힘 */ }
    await loadSettings();
    // 꺼짐이어도 비품 이름·누적 칸은 읽는다 — 남은 칸을 비울 수 있게(다시 켰을 때 옛 칸이 전송되지 않도록)
    try {
        const snap = await getDoc(ITEMS_REF);
        items = safeItems(snap.exists() ? snap.data().items : []);   // 단가·업체 등은 여기서 버린다
        byId = new Map(items.map(it => [it.id, it]));
    } catch (e) {
        console.warn('[supplies-io] 비품 목록 읽기 실패:', e && e.code);
        items = []; byId = new Map();
        showError('비품 목록을 불러오지 못했습니다 — 새로고침해 주세요.');
    }
    startWatch();
    if (live !== true) return;
    await loadStockNow();
    if (!stockOk) showError('앱 재고를 불러오지 못했습니다 — 새로고침한 뒤 다시 해 주세요.');
}

// 공유 누적 칸 구독 — 바뀔 때마다 다시 그린다. 내가 고른 칸을 남이 전송·비웠으면 짧게 알린다(이름은 화면에만)
function startWatch() {
    if (unwatch) return;
    unwatch = watchCart(db, (docs, qs) => {
        const next = new Map();
        for (const d of docs) { const s = slotOf(d.id, d.data); if (s) next.set(s.id, s); }
        if (selId) {
            const k = slotId(dir, selId);
            const why = slotEmptiedBy(slots.get(k), next.get(k), me.email);
            if (why) {
                const who = personOf(why.byEmail);
                setMsg(`${nameOf(selId)} — ${who === '다른 사람' ? '다른 사람이' : who + '님이'} ${why.kind === 'sent' ? `${dirWord()} 전송했습니다` : '비웠습니다'}.`);
            }
        }
        slots = next;
        if (!qs.metadata.fromCache) { cartOk = true; cartErr = ''; }
        renderAll();
    }, (e) => {
        console.warn('[supplies-io] 누적 칸 구독 실패:', e && e.code);
        cartOk = false;
        cartErr = '누적 칸을 불러오지 못했습니다 — 새로고침해 주세요.';
        unwatch = null;
        renderAll();
    });
}
function stopWatch() { if (unwatch) { unwatch(); unwatch = null; } slots = new Map(); cartOk = false; }

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
    renderLeftovers();
    if (live !== true) return;
    renderResults();
    renderSelect();
    renderFavs();
    renderCard();
    renderAcc();
    renderHistory();
}

// 꺼짐일 때 남은 누적 칸(입고·출고 모두) — 비우기만 된다. 켜짐이면 숨김
function renderLeftovers() {
    const box = $('si-off-left');
    const rows = live === false ? [...slots.values()].filter(s => s.qty > 0) : [];
    box.hidden = !rows.length;
    if (!rows.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="si-small"><b>남은 누적 칸 ${rows.length}건</b> — 원장에는 안 들어갔습니다. 다시 켰을 때 옛 수량이 전송되지 않도록 비워 주세요.</div>`
        + '<ul class="si-acc-list">' + rows.map(r => `<li class="si-acc-li" data-left="${esc(r.id)}"><span class="si-acc-name">${esc(nameOf(r.itemId))}`
            + `<span class="si-acc-meta">${r.dir === 'out' ? '출고' : '입고'} · ${esc(personOf(r.byEmail))} · ${esc(agoText(r.atMs))}</span></span>`
            + `<span class="si-acc-qty num">${r.dir === 'out' ? '−' : '+'}${esc(fmt(r.qty))}${esc(unitOf(r.itemId))}</span>`
            + `<button type="button" class="si-x" data-clear="${esc(r.itemId)}" data-clear-dir="${esc(r.dir)}" aria-label="${esc(nameOf(r.itemId))} 누적 비우기">✕</button></li>`).join('') + '</ul>';
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

// 목록 드롭다운 — 분류별 묶음(optgroup), 이름순, 비품코드 같이. 고르면 검색으로 고른 것과 같은 pick()
function renderSelect() {
    if (selectFor === items) return;
    selectFor = items;
    const groups = dropdownGroups(items);
    $('si-select').innerHTML = `<option value="">목록에서 고르기 (${items.length}개)</option>`
        + groups.map(g => `<optgroup label="${esc(g.category)}">${g.items.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join('')}</optgroup>`).join('');
    $('si-select').value = '';
}

function renderFavs() {
    const favs = favoriteItems(items);
    $('si-favs').innerHTML = favs.length
        ? favs.map(it => `<button type="button" class="d-btn" data-pick="${esc(it.id)}">${esc(it.name)}</button>`).join('')
        : '<span class="si-small t-2">자주 쓰는 비품이 없습니다(비품 관리 상세에서 표시)</span>';
}

/** 전송 단추를 막는 이유('' = 켤 수 있음) */
function sendBlock(sl) {
    if (!online()) return '인터넷 연결이 없습니다 — 연결된 뒤 다시 눌러 주세요(누적은 공유 칸에 남아 있습니다).';
    if (!stockOk) return '재고를 불러오지 못해 막았습니다 — 새로고침해 주세요.';
    if (!cartOk) return cartErr || '누적 칸을 불러오는 중입니다…';
    if (pressing) return '방금 누른 것을 반영하는 중…';
    if (slotIsOld(sl, liveAtMs) && sl.qty) return OLD_TEXT;
    return '';
}

function renderCard() {
    const card = $('si-card');
    const it = selId ? byId.get(selId) : null;
    if (!it) { card.hidden = true; return; }
    card.hidden = false;
    const sl = slotFor(it.id);
    const counts = sl && sl.qty ? sl.counts : {};
    const sum = cardSummary(it, counts, dir);
    const total = sl ? sl.qty : 0;
    const now = stock[it.id] || 0;
    const after = dir === 'in' ? now + total : now - total;
    const unit = baseUnit(it);
    $('si-card-name').textContent = it.name;
    const st = $('si-card-stock');
    st.innerHTML = stockOk
        ? `재고 <b>${esc(fmt(now))}</b> → 전송 후 <b>${esc(fmt(after))}</b> ${esc(unit)}`
        : '재고를 불러오지 못했습니다';
    st.classList.toggle('short', stockOk && after < 0);
    $('si-card-who').textContent = sl && sl.qty && sl.byEmail !== me.email
        ? `같이 쌓는 중 — 마지막 ${personOf(sl.byEmail)} · ${agoText(sl.atMs)}` : '';
    // 단위 단추 + 그 아래 [−](그 단위 1회 빼기 — 그 단위로 쌓인 것이 없으면 끔, 2026-11-27)
    $('si-units').innerHTML = sum.buttons.map(u => `<div class="si-unit-wrap"><button type="button" class="si-unit${u.n ? ' on' : ''}" data-unit="${u.qty}"${busy ? ' disabled' : ''}>`
        + `<span class="si-unit-name">${esc(u.name)}</span><span class="si-unit-base num">${esc(fmt(u.qty))}${esc(unit)}</span>`
        + (u.n ? `<span class="si-unit-n">×${u.n}</span>` : '') + '</button>'
        + `<button type="button" class="si-unit-minus" data-unit-minus="${u.qty}" aria-label="${esc(u.name)} 하나 빼기"${busy || !u.n ? ' disabled' : ''}>−</button></div>`).join('');
    const desc = countsDesc(it, counts, dir);
    $('si-calc').textContent = total ? `${desc} = ${fmt(total)}${unit}` : '';
    $('si-add-why').textContent = pressWhy || (pressing ? '반영하는 중…' : '');
    const save = $('si-save');
    const why = sendBlock(sl);
    save.textContent = busy ? '전송하는 중…' : total ? `${dirWord()} 전송 (${fmt(total)}${unit})` : `${dirWord()} 전송`;
    save.disabled = busy || !!why || !total;
    $('si-save-why').textContent = why;
    $('si-reset').disabled = busy || !total;
}

// 누적 칸 — 이 방향의 비품별 공유 칸(모든 사람). 고른 비품 강조, 다른 줄은 마지막 누른 사람·시각·진행 중/오래됨, 누르면 그 비품으로
function renderAcc() {
    const rows = slotRows(slots.values(), dir, selId, me.email, Date.now(), liveAtMs);
    const sign = dir === 'out' ? '−' : '+';
    $('si-acc-title').textContent = `누적 — ${dirWord()} ${rows.length}건`;
    const fl = flashId;
    flashId = null;   // 강조는 한 번만(다시 그리면 사라진다)
    $('si-acc').innerHTML = !cartOk && !rows.length
        ? `<li class="si-acc-empty">${esc(cartErr || '불러오는 중…')}</li>`
        : rows.length
        ? rows.map(r => {
            const it = byId.get(r.itemId);
            const desc = it ? countsDesc(it, r.counts, dir) : '';
            const meta = `${esc(personOf(r.byEmail))} · ${esc(agoText(r.atMs))}`
                + (r.selected ? ' · 고른 비품' : ' · 진행 중') + (r.old ? ' · <span class="stale">켜기 전 칸</span>' : r.stale ? ' · <span class="stale">오래됨</span>' : '');
            return `<li class="si-acc-li${r.selected ? ' cur' : ''}${r.itemId === fl ? ' flash' : ''}" data-acc="${esc(r.itemId)}">`
                + `<button type="button" class="si-acc-pick" data-pick="${esc(r.itemId)}"><span class="si-acc-name">${esc(nameOf(r.itemId))}`
                + `<span class="si-acc-desc">${esc(desc)}</span><span class="si-acc-meta">${meta}</span></span>`
                + `<span class="si-acc-qty num">${sign}${esc(fmt(r.qty))}${esc(unitOf(r.itemId))}</span></button>`
                + `<button type="button" class="si-x" data-clear="${esc(r.itemId)}" aria-label="${esc(nameOf(r.itemId))} 누적 비우기"${busy ? ' disabled' : ''}>✕</button></li>`;
        }).join('')
        : '<li class="si-acc-empty">비품을 고르고 단위 단추를 누르면 여기에 쌓입니다(모든 사람이 같이 봅니다).</li>';
    const other = otherDirCount(slots.values(), dir);
    const o = $('si-acc-other');
    o.textContent = other ? `${dir === 'out' ? '입고' : '출고'} 쪽에 쌓는 중인 비품 ${other}건이 있습니다.` : '';
    o.hidden = !other;
}

/** 단위 단추 한 번 — 공유 칸에 트랜잭션으로 더한다(minus = [−] 로 그 단위 1회 빼기). 성공하면 그 칸 누적을 읽어 준다(내가 누른 것만) */
async function pressUnitBtn(qty, minus = false) {
    const it = selId ? byId.get(selId) : null;
    if (!it || busy) return;
    if (!online()) { pressWhy = '인터넷 연결이 없어 반영하지 않았습니다 — 연결된 뒤 다시 눌러 주세요.'; renderCard(); return; }
    if (!cartOk) { pressWhy = cartErr || '누적 칸을 불러오는 중입니다 — 잠시 뒤 다시 눌러 주세요.'; renderCard(); return; }
    if (slotIsOld(slotFor(it.id), liveAtMs) && slotFor(it.id).qty) { pressWhy = OLD_TEXT; renderCard(); return; }
    unlockSpeech();   // 단위 단추를 누른 그 순간(서버 저장 전)에 — 아이폰 사파리 음성 잠금
    const d0 = dir;
    pressing++;
    pressWhy = '';
    renderCard();
    try {
        const r = await cartPress(db, d0, it.id, me, (data, stockNow) => {
            const cur = slotOf(slotId(d0, it.id), data);
            if (slotIsOld(cur, liveAtMs) && cur.qty) return { why: OLD_TEXT };   // 트랜잭션에서 읽은 칸으로 한 번 더
            return minus ? unpressSlot(cur, qty) : pressSlot(cur, qty, d0, stockNow);   // 빼기는 트랜잭션에서 읽은 칸 기준(남이 그사이 뺐으면 막힘)
        });
        if (!r.ok) { pressWhy = r.why; return; }
        flashId = it.id;
        $('si-result').hidden = true;
        if (d0 === dir && selId === it.id) speak(speechText(r.qty, baseUnit(it)));
    } catch (e) {
        console.warn('[supplies-io] 누름 쓰기 실패:', e && e.code);
        pressWhy = e && e.code === 'permission-denied'
            ? '반영하지 못했습니다 — 비품 권한이 없거나 방금 앱 기준이 꺼졌습니다(새로고침해서 확인).'
            : '방금 누른 것은 반영되지 않았습니다 — 연결을 확인한 뒤 다시 눌러 주세요.';
    } finally {
        pressing--;
        renderAll();
    }
}

// ───────── 고르기 ─────────
function pick(id) {
    const it = byId.get(id);
    if (!it) return;
    selId = id;
    pressWhy = '';
    $('si-search').value = '';
    $('si-select').value = '';
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

// 입고·출고 바꾸기 — 칸은 방향마다 따로라 비울 것이 없다(공유 칸은 그대로 남는다)
function switchDir(to) {
    if (to === dir || busy) return;
    dir = to;
    pressWhy = '';
    $('si-result').hidden = true;
    renderAll();
}

// [이 칸 비우기] — 모두에게 비워진다(확인창). 꺼짐이어도 된다(남은 칸 정리). 그사이 누가 더 눌렀으면 새 수량으로 다시 묻는다
async function clearSlot(itemId, dirX = dir) {
    const word = dirX === 'out' ? '출고' : '입고';
    let sl = slots.get(slotId(dirX, itemId)) || null;
    if (busy || !sl || !sl.qty) return;
    let seenRev = sl.rev, qty = sl.qty;
    for (let round = 0; round < 3; round++) {
        const whoTxt = sl && sl.byEmail !== me.email ? `\n마지막으로 ${personOf(sl.byEmail)}님이 ${agoText(sl.atMs)} 눌렀습니다.` : '';
        const head = round ? `그사이 늘었습니다(새 합계 ${fmt(qty)}${unitOf(itemId)}).\n` : '';
        const ok = await confirmBox(`${head}'${nameOf(itemId)}' ${word} 누적 ${fmt(qty)}${unitOf(itemId)}를 비울까요?\n모든 사람 화면에서 비워집니다(원장에는 안 들어감).${whoTxt}`,
            { title: '누적 비우기', okText: '비우기', danger: true });
        if (!ok) return;
        let r;
        try { r = await cartClear(db, dirX, itemId, me, seenRev); }
        catch (e) {
            console.warn('[supplies-io] 비우기 실패:', e && e.code);
            alertBox('비우지 못했습니다 — 연결을 확인한 뒤 다시 해 주세요.', { title: '비우기', isError: true });
            return;
        }
        if (r.ok) { setMsg(`${nameOf(itemId)} 누적을 비웠습니다.`, true); return; }
        seenRev = r.rev; qty = r.qty; sl = slots.get(slotId(dirX, itemId)) || sl;   // 'moved' — 새 수량으로 다시 묻는다
    }
}

// ───────── 전송 기록 보기·되돌리기(2026-11-27) ─────────
// 원장(suppliesLedger)을 한국 날짜 0시부터(오늘·어제 → [7일 보기]) 새 것부터 HIST_MAX 건까지 읽어, 이 화면이 보낸 입고·출고(batchId 있는 것)와
// 그 되돌림만 보인다(js/lib/supplies-io.js historyRows). [되돌리기]는 비품 관리 이력과 같은 commitRevert(규칙: 비품 권한·앱 기준 켜짐,
// 기록마다 'rv-' + id 한 번만, 되돌림 기록은 되돌리지 않음, 재고 0 밑이면 거절).
function openHistory() {
    hist.open = true;
    hist.days = 2;
    hist.msg = '';
    $('si-hist').hidden = false;
    loadHistory();
    $('si-hist').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function closeHistory() { hist.open = false; renderHistory(); }

let histSeq = 0;   // 늦게 온 앞 응답이 새 결과를 덮지 않게(리뷰)
async function loadHistory() {
    if (!hist.open) return;
    const seq = ++histSeq;
    hist.loading = true; hist.err = '';
    renderHistory();
    try {
        const r = await loadLedger(db, { sinceMs: kstDayStartMs(Date.now(), hist.days - 1), max: HIST_MAX });
        if (seq !== histSeq) return;
        hist.entries = r;
        hist.full = !!r.full;
    } catch (e) {
        if (seq !== histSeq) return;
        console.warn('[supplies-io] 전송 기록 읽기 실패:', e && e.code);
        hist.err = '전송 기록을 불러오지 못했습니다 — 연결을 확인한 뒤 다시 열어 주세요.';
    } finally {
        if (seq === histSeq) { hist.loading = false; renderHistory(); }
    }
}

function renderHistory() {
    const sec = $('si-hist');
    $('si-hist-btn').setAttribute('aria-pressed', hist.open ? 'true' : 'false');
    $('si-hist-btn').disabled = live !== true;
    sec.hidden = !hist.open || live !== true;
    if (sec.hidden) return;
    document.querySelectorAll('#si-hist-who [data-hist-who]').forEach(b => {
        const on = (b.dataset.histWho === 'mine') === hist.mine;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const rows = historyRows(hist.entries, { mine: hist.mine, myEmail: me.email, liveAtMs });
    $('si-hist-range').textContent = (hist.days > 2 ? '최근 7일' : '오늘·어제') + ` · ${rows.length}건`
        + (hist.full ? ` (기록이 많아 최근 ${HIST_MAX}건만 봤습니다)` : '');
    const list = $('si-hist-list');
    if (hist.loading && !hist.entries.length) list.innerHTML = '<li class="si-acc-empty">불러오는 중…</li>';
    else if (hist.err) list.innerHTML = `<li class="si-acc-empty">${esc(hist.err)}</li>`;
    else if (!rows.length) list.innerHTML = `<li class="si-acc-empty">${hist.mine ? '내가 보낸 기록이 없습니다.' : '보낸 기록이 없습니다.'}</li>`;
    else list.innerHTML = rows.map(r => {
        const word = r.kind === 'out' ? '출고' : r.kind === 'in' ? '입고' : '되돌림';
        const tag = `<span class="si-hist-tag ${r.kind === 'revert' ? '' : esc(r.kind)}">${word}</span>`;
        const state = r.reverted ? ' · <b>되돌림됨</b>' : r.locked === 'count' ? ' · 실사 이후라 되돌릴 수 없음' : r.locked === 'live' ? ' · 앱 기준 전환 전 기록' : '';
        const btn = r.canRevert
            ? `<button type="button" class="d-btn d-btn-sm si-hist-rv" data-revert="${esc(r.id)}"${reverting.has(r.id) || busy ? ' disabled' : ''}>${reverting.has(r.id) ? '되돌리는 중…' : '되돌리기'}</button>`
            : '';
        return `<li class="si-hist-li${r.reverted || r.kind === 'revert' ? ' done' : ''}" data-hist="${esc(r.id)}">${tag}`
            + `<span class="si-acc-name">${esc(nameOf(r.itemId))}<span class="si-acc-meta">${esc(personOf(r.byEmail))} · ${esc(kstTimeText(r.atMs))}${state}</span></span>`
            + `<span class="si-acc-qty num">${r.qty > 0 ? '+' : ''}${esc(fmt(r.qty))}${esc(unitOf(r.itemId))}</span>${btn}</li>`;
    }).join('');
    const m = $('si-hist-msg');
    m.textContent = hist.msg;
    m.classList.toggle('ok', hist.msgOk);
    $('si-hist-more').hidden = hist.days > 2 || !!hist.err;
}

async function revertEntry(id) {
    const e = (hist.entries || []).find(x => x.id === id);
    const row = historyRows(hist.entries, { liveAtMs }).find(r => r.id === id);
    if (!e || !row || !row.canRevert || reverting.has(id) || busy) return;
    const unit = unitOf(e.itemId), word = e.kind === 'out' ? '출고' : '입고';
    const back = -row.qty;
    const ok = await confirmBox(`'${nameOf(e.itemId)}' ${word} ${fmt(Math.abs(row.qty))}${unit} (${kstTimeText(row.atMs)} · ${personOf(row.byEmail)}) 기록을 되돌릴까요?
`
        + `재고가 ${fmt(Math.abs(back))}${unit} ${back > 0 ? '늘어납니다' : '줄어듭니다'}. 원래 기록은 남고 되돌림 기록이 하나 더 생깁니다.`,
        { title: '기록 되돌리기', okText: '되돌리기', danger: true });
    if (!ok || reverting.has(id)) return;
    reverting.add(id);
    hist.msg = '';
    renderHistory();
    try {
        let nowLive = null;
        try { const s = await getDoc(SETTINGS_REF); nowLive = isLive(s.exists() ? s.data() : null); }
        catch (err) { console.warn('[supplies-io] 재고 기준 설정 다시 읽기 실패:', err && err.code); }
        if (nowLive !== true) {
            hist.msg = nowLive === false ? '앱 기준이 꺼져 있어 되돌리지 않았습니다.' : '재고 기준 설정을 읽지 못해 되돌리지 않았습니다 — 연결을 확인해 주세요.';
            hist.msgOk = false;
            if (nowLive === false) live = false;
            return;
        }
        let r;
        try { r = await commitRevert(db, { id: e.id, itemId: e.itemId, kind: e.kind, qty: row.qty }, me); }
        catch (err) {
            console.warn('[supplies-io] 되돌리기 쓰기 실패:', err && err.code);
            r = { ok: false, reason: err && err.code === 'permission-denied' ? 'denied' : 'write' };
        }
        if (r.ok) { hist.msg = `${nameOf(e.itemId)} ${word} 기록을 되돌렸습니다(재고 ${back > 0 ? '+' : ''}${fmt(back)}${unit}).`; hist.msgOk = true; }
        else if (r.reason === 'already') { hist.msg = '이미 되돌린 기록입니다(두 번 들어가지 않았습니다).'; hist.msgOk = false; }
        else if (r.reason === 'denied') { hist.msg = '되돌리지 못했습니다 — 비품 관리 권한이 없거나 방금 앱 기준이 꺼졌습니다.'; hist.msgOk = false; }
        else if (r.reason === 'write') { hist.msg = '되돌리지 못했습니다 — 연결을 확인한 뒤 다시 눌러 주세요(되돌림은 기록마다 한 번만 들어갑니다).'; hist.msgOk = false; }
        else { hist.msg = `되돌리지 못했습니다 — ${ledgerErrorText({ ...r, itemId: e.itemId }, nameOf)}`; hist.msgOk = false; }
        await loadStockNow();
    } finally {
        reverting.delete(id);
        await loadHistory();   // 되돌림 기록·'되돌림됨' 표시를 서버 값으로
        renderAll();
    }
}

// ───────── 전송(고른 비품 칸만) ─────────
const errText = (e) => ledgerErrorText(e, nameOf);

async function save() {
    const it = selId ? byId.get(selId) : null;
    const sl = it ? slotFor(it.id) : null;
    if (busy || !it || !sl || !sl.qty || sendBlock(sl)) return;
    const d0 = dir, unit = baseUnit(it);
    const word = d0 === 'out' ? '출고' : '입고', sign = d0 === 'out' ? '−' : '+';
    busy = true;
    renderAll();
    try {
        // 전송 직전에 스위치를 다시 본다 — 그사이 관리자가 껐으면 쓰지 않는다
        let nowLive = null;
        try { const s = await getDoc(SETTINGS_REF); nowLive = isLive(s.exists() ? s.data() : null); }
        catch (e) { console.warn('[supplies-io] 재고 기준 설정 다시 읽기 실패:', e && e.code); }
        if (nowLive !== true) {
            if (nowLive === false) live = false;
            else alertBox('재고 기준 설정을 읽지 못해 전송하지 않았습니다 — 연결을 확인한 뒤 다시 눌러 주세요.', { title: '전송 안 함', isError: true });
            return;
        }
        // 화면이 본 rev 로 보낸다 — 그사이 누가 더 눌렀으면(moved) 새 합계로 다시 묻는다(전송 단추 수량 = 원장 수량)
        let seenRev = sl.rev, r = null, unknown = false, bid = '';
        for (let round = 0; round < 3; round++) {
            bid = newBatchId();
            r = null;
            try { r = await cartSend(db, d0, it.id, me, bid, seenRev); }
            catch (e) {
                console.warn('[supplies-io] 전송 쓰기 실패:', e && e.code);
                if (e && e.code === 'permission-denied') r = { ok: false, reason: 'denied' };
                else {
                    // 연결 오류 — 이 묶음의 원장 기록이 서버에 있는지로 판정한다(트랜잭션이라 기록이 있으면 칸도 같이 비워졌다).
                    //   칸의 sent 는 그 뒤 누름이 칸을 다시 쓰면 사라지므로 보지 않는다. 수량도 기록에서 읽는다
                    try {
                        const en = await ledgerEntryOnServer(db, cartEntryId(bid, it.id));
                        r = en ? { ok: true, qty: Math.abs(Number(en.qty) || 0) } : { ok: false, reason: 'notsent' };
                    } catch (e2) { unknown = true; }
                }
            }
            if (unknown || !r || r.reason !== 'moved') break;
            busy = false; renderAll();
            const again = await confirmBox(`그사이 늘었습니다(새 합계 ${fmt(r.qty)}${unit}).\n'${it.name}' ${fmt(r.qty)}${unit}를 ${word} 전송할까요?`,
                { title: `${word} 전송`, okText: '전송' });
            busy = true; renderAll();
            if (!again) { r = { ok: false, reason: 'cancel' }; break; }
            seenRev = r.rev;
        }
        if (unknown) {
            showResult('bad', `<b>전송됐는지 확인하지 못했습니다</b> — ${esc(it.name)}<div>연결된 뒤 비품 관리 화면 이력(원장)을 보세요. 기록이 없으면 다시 [${word} 전송]을 누르면 됩니다(누적 칸이 남아 있으면 아직 안 들어간 것입니다 — 두 번 들어가지 않습니다).</div>`);
        } else if (r.ok) {
            showResult('ok', `<b>${word} 전송했습니다</b> — ${esc(it.name)} ${sign}${esc(fmt(r.qty))}${esc(unit)}`);
            selId = null;
            if (hist.open) loadHistory();   // 열어 둔 전송 기록에 바로 보이게
        } else if (r.reason === 'cancel') {
            showResult('part', `<b>전송하지 않았습니다</b> — ${esc(it.name)} 누적은 그대로 남아 있습니다.`);
        } else if (r.reason === 'moved') {
            showResult('part', `<b>전송하지 않았습니다</b> — 그사이 계속 바뀌고 있습니다. 누적을 확인한 뒤 다시 눌러 주세요.`);
        } else if (r.reason === 'empty') {
            const who = r.byEmail ? personOf(r.byEmail) : '';
            showResult('part', `<b>보낼 것이 없습니다</b> — ${esc(it.name)} 칸이 이미 비었습니다${who ? `(${esc(who)}${who === '나' ? '' : '님'}이 ${r.sent ? '전송' : '비움'})` : ''}. 두 번 들어가지 않았습니다.`);
        } else if (r.reason === 'plan') {
            showResult('bad', `<b>전송하지 못했습니다</b>${[...new Set((r.errors || []).map(errText))].map(m => `<div>${esc(m)}</div>`).join('')}<div>누적은 그대로 남아 있습니다.</div>`);
        } else if (r.reason === 'denied') {
            showResult('bad', '<b>전송하지 못했습니다</b> — 비품 관리 권한이 없거나, 방금 앱 기준이 꺼졌습니다(새로고침해서 확인). 누적은 그대로 남아 있습니다.');
        } else {
            showResult('bad', `<b>전송하지 못했습니다</b> — 연결을 확인한 뒤 다시 [${word} 전송]을 눌러 주세요. 누적은 그대로 남아 있습니다.`);
        }
        await loadStockNow();   // 전송한 뒤·재고 부족 뒤 — 지금 재고로 다시
        if (!stockOk) showError('앱 재고를 다시 불러오지 못했습니다 — 새로고침해 주세요.');
    } finally {
        busy = false;
        renderAll();
        if (!selId) focusSearch();
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
        const x = e.target.closest('[data-clear]');
        if (x) { clearSlot(x.dataset.clear, x.dataset.clearDir || dir); return; }
        const p = e.target.closest('[data-pick]');
        if (p) { pick(p.dataset.pick); return; }
        const m = e.target.closest('#si-units [data-unit-minus]');
        if (m) { pressUnitBtn(Number(m.dataset.unitMinus), true); return; }
        const u = e.target.closest('#si-units [data-unit]');
        if (u) { pressUnitBtn(Number(u.dataset.unit)); return; }
    });
    // [비우기] — 고른 비품 칸을 모두에게 비운다(확인창)
    $('si-reset').addEventListener('click', () => { if (selId) clearSlot(selId); });
    $('si-change').addEventListener('click', () => { selId = null; pressWhy = ''; renderAll(); search.focus(); });
    // 고른 뒤 드롭다운은 '목록에서 고르기'로 되돌린다
    $('si-select').addEventListener('change', (e) => { const v = e.target.value; e.target.value = ''; if (v) pick(v); });
    $('si-save').addEventListener('click', save);
    // 전송 기록 — 열기·닫기 · 전체/내 기록 · 7일 보기 · [되돌리기]
    $('si-hist-btn').addEventListener('click', () => (hist.open ? closeHistory() : openHistory()));
    $('si-hist-close').addEventListener('click', closeHistory);
    $('si-hist-who').addEventListener('click', (e) => {
        const b = e.target.closest('[data-hist-who]');
        if (!b) return;
        hist.mine = b.dataset.histWho === 'mine';
        renderHistory();
    });
    $('si-hist-more').addEventListener('click', () => { hist.days = 7; loadHistory(); });
    $('si-hist-list').addEventListener('click', (e) => { const b = e.target.closest('[data-revert]'); if (b) revertEntry(b.dataset.revert); });
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
    // 'n분 전'·'오래됨' 표시를 1분마다 새로(데이터는 안 읽음)
    setInterval(() => { if (live === true && !$('si-work').hidden) { renderAcc(); renderCard(); } }, 60000);
}

// 공통 상단바 개인 알림·칸·원장 by 칸(표시용) — 이름은 메모리에만
function loadMemberName(user) {
    getDoc(CONFIG_REF).then((snap) => {
        const name = memberNameFor(snap.exists() ? snap.data().memberEmails : null, user.email);
        if (!auth.currentUser || auth.currentUser.uid !== user.uid) return;
        me = { ...me, name: name || '' };
        memberEmails = (snap.exists() && snap.data().memberEmails) || null;
        if (name) setShellContext({ signedIn: true, uid: user.uid, memberName: name });
        if (loaded) renderAll();   // 누적 칸의 사람 이름
    }).catch((e) => console.warn('[supplies-io] 설정 읽기 실패:', e && e.code));
}

wire();
onAuthStateChanged(auth, async (user) => {
    setShellContext(user ? { signedIn: true, uid: user.uid } : { signedIn: false });
    $('si-loading').hidden = true;
    if (!user) {
        stopWatch();
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
    loaded = true;
    renderAll();
});
