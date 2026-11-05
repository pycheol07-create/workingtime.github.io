// === js/locset-panel.js ===
// 로케이션관리 환경설정 '추천·채우기' 탭 (2026-10-27 — 옛 '추천·입고' 탭 + 관리자 페이지 '채우기 설정' 탭(옛 js/admin-refill.js)을 합침).
// location.js 가 initLocSetPanel({ db, auth, combosOf }) 로 부른다(Firebase 를 여기서 초기화하지 않는다 — 두 번 만들면 duplicate-app).
//   combosOf() = 지금 로케이션 자료의 피킹 자리(기타 아님) 카드 이름('A-1' 조합) → 칸 수.
//
// ① 변경 추천 설정 — [변경 추천 설정 저장] = window.saveLocRecSettings (js/lib/location-guard-map.js 가 location.settings 로 감싼다)
//    · 동선 기준: Locations/INFO_CONFIG.recommendPriorities. 화면 입고대기 추천 자리도 이 기준을 쓴다.
//      2026-11-03 '구역-동 카드' 순서 화면 — 저장 { poses, excludeCombos, cards{v,order,level,rowsPerDong} } (merge).
//      zones·dongs 는 쓰지 않는다 — 카드 저장 전 옛 방식 값이 그대로 남아 [옛 방식으로] 되돌리기의 값이 된다.
//      화면 상태 ↔ 저장 모양·'바뀜' 서명은 js/lib/loc-card-board.js, 검사·사본·자동 정렬은 js/lib/loc-cards.js.
//      카드 칸이 없으면(옛 방식) 지금 설정을 legacyToCards 로 보여 주고, 그대로 저장하면 카드 방식으로 바뀐다(확인창).
//      [옛 방식으로] = window.resetLocCardOrder — cards 칸만 deleteField(location.settings 로 감쌈). 남은 zones·dongs·poses·제외로 계산.
//    · 추천 양: Locations/INFO_CONFIG.locRecSettings { maxRows, weeklyMoves, minGain, updatedAt } — 범위는 js/lib/locrec-settings.js LIMITS.
//      서버 앱\로케이션추천 이 다음 추천(06:40 또는 [지금 재고로 다시 만들기])부터 쓴다. 규칙: INFO_CONFIG 새 키는 location.settings(규칙 변경 없음).
//      저장하는 사람 이메일은 넣지 않는다(INFO_CONFIG 는 직원 누구나 읽는다).
//    · 서버가 정하는 값(하루 출고 기준·재고 빼기·판정 기준·점수 비율·페어 기준)은 integrations/locRecLatest.settings 를 읽기 전용으로.
// ② 채우기 설정 — adminPrivate/refillSettings { enabled, days(0=월…6=일), skipHolidays, salesRule(false = ① 주문 부족만, 없으면 ①+②), updatedAt, updatedBy(이메일 소문자) }.
//    adminPrivate 는 관리자만 읽고 쓴다. 관리자가 아니면 integrations/refillLatest.schedule('마지막 지시서 기준' 사본)을 잠근 채 보여 준다.
//    앱\채우기자동화\채우기.py 가 매일 아침 이 문서를 읽는다(규칙.py parse_settings).
//    ⚠️ 이름·범위를 바꾸면 채우기자동화\규칙.py parse_settings 도 바꿀 것(값이 이상하면 그쪽은 기본값을 쓴다).
//    pct·minQty 는 2026-10-14 부터 쓰지 않는다(문서에 남은 옛 값은 merge 저장이라 그대로 남지만 무해).
// ③ 계산 방식 안내 — 숫자는 locRecLatest.settings 로 채운다(js/lib/locrec-settings.js guideLines).
//
// 탭을 열 때마다 읽는다(getDoc). 저장 안 한 변경은 ①·② 를 따로 센다 — 다른 탭으로 가거나 창을 닫거나 페이지를 떠날 때 묻는다.
// 원문 문자열은 textContent 로만 넣는다.

import { doc, getDoc, setDoc, updateDoc, deleteField, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { onBeforeLeave, leaveAlreadyConfirmed } from './app-shell-bridge.js?v=202611051206';
import { canFeature, currentPerm } from './feature-gate.js?v=202611051206';
import { KEYS, LIMITS, FIELD_TEXT, normalize, sameValues, serverRows, sourceText, guideLines } from './lib/locrec-settings.js?v=202611051206';
import { autoSort, CARD_LAYOUT } from './lib/loc-cards.js?v=202611051206';
import {
    cardLabel, parseExcludeText, boardFrom, applyCards, whereIs, excludedCards, placeCard, cardMoves, moveCard,
    toggleExclude, addRow, deleteRow, moveRow, setExclude, setU, boardSignature, boardToSave
} from './lib/loc-card-board.js?v=202611051206';

const PANE = 'recommend';
const INFO_PATH = ['Locations', 'INFO_CONFIG'];
const LATEST_PATH = ['artifacts', 'team-work-logger-v2', 'integrations', 'locRecLatest'];
const REFILL_LATEST_PATH = ['artifacts', 'team-work-logger-v2', 'integrations', 'refillLatest'];
const REFILL_PATH = ['adminPrivate', 'refillSettings'];
const 채우기기본값 = Object.freeze({ enabled: true, days: [0, 1, 2, 3, 4], skipHolidays: true, salesRule: true });
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
let combosOf = null;        // location.js 가 넘긴 () => { 카드 이름: 칸 수 }
// 동선 기준 카드 화면 상태
let 보드 = null;            // js/lib/loc-card-board.js 보드
let 칸수 = {};              // 카드 이름 → 칸 수(탭을 열 때 읽음)
let 보드원본 = null;       // 불러온 때 보드 — 제외만 바꿨는지 가린다
let 옛칸있음 = true;       // 문서에 zones·dongs 가 있는가(없으면 저장 때 기본값을 같이 넣는다 — 서버 옛 방식 계산이 비지 않게)
let 보드기준위치 = [];     // 불러온 때 위치 순서 — 옛 방식에서 카드를 건드렸는지(위치만 바꾼 것과 구분)
let 저장방식 = 'legacy';    // 저장값 기준 지금 계산 방식 'cards' | 'legacy'
let 카드오류 = [];          // 저장된 cards 칸이 검사에 걸린 이유(있으면 서버도 옛 방식)
let 기준우선순위 = null;    // 불러온 recommendPriorities(자동 정렬 ①·거리 순의 동 순서용)
let 보드기준 = '';          // 불러온(또는 저장한) 때 서명
let 고른카드 = null;
let 끄는카드 = null;

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

// ── ① 동선 기준(구역-동 카드 순서·위치 순서·제외) ──
// 카드 끌기는 여기서 처리한다(카드 글자에 칸 수가 붙어 location.js handleDrop 의 글자 찾기가 맞지 않음).
// 위치 순서 줄세우기만 location.js 의 handleDragStart·handleSortDragOver 를 쓴다.
function 블록(text, cls, 끌기) {
    const b = document.createElement('div');
    b.className = cls;
    b.textContent = text;
    b.draggable = 끌기;
    if (끌기) { b.ondragstart = window.handleDragStart; b.ondragend = window.handleDragEnd; }
    return b;
}

const 자료있음 = () => Object.keys(칸수).length > 0;

function 칸수읽기() {
    try {
        const c = typeof combosOf === 'function' ? combosOf() : null;
        return c && typeof c === 'object' ? c : {};
    } catch (e) {
        console.warn('[추천·채우기] 로케이션 카드 칸 수 읽기 실패:', e);
        return {};
    }
}

function 위치줄그리기(poses) {
    const box = $('lrs-sort-poses');
    if (!box) return;
    box.replaceChildren();
    // 저장된 순서에 ★ 가 없으면 맨 앞에(예전 화면·서버 입력.priorities_of 와 같게) — 기본값과 합치며 ★ 가 꼴찌로 가지 않게
    let saved = Array.isArray(poses) ? poses.map(String) : [];
    if (saved.length && !saved.includes('★')) saved = ['★', ...saved];
    [...new Set([...saved, '★', '1', '2', '3', '4', '5'])]
        .forEach(x => box.appendChild(블록(x, 'puzzle-sort-block', canSettings())));
}

const 위치읽기 = () => [...(($('lrs-sort-poses') && $('lrs-sort-poses').querySelectorAll('.puzzle-sort-block')) || [])].map(b => b.textContent.trim());

function 우선순위그리기(p) {
    const src = p && typeof p === 'object' ? p : 기본우선순위;
    기준우선순위 = src;
    옛칸있음 = !!(p && typeof p === 'object' && p.zones && typeof p.zones === 'object' && Array.isArray(p.dongs) && p.dongs.length);
    칸수 = 칸수읽기();
    const r = boardFrom(src, 칸수);
    보드 = r.board;
    저장방식 = r.mode;
    카드오류 = r.errors;
    고른카드 = null;
    위치줄그리기(src.poses);
    보드그리기();
}

function 방식표시() {
    const box = $('lrs-card-mode');
    if (box) {
        let 글, 톤;
        if (저장방식 === 'cards') {
            글 = '지금: 카드 순서 — 변경 추천·입고대기 추천이 아래 카드 순서로 계산합니다.'; 톤 = 'ok';
        } else if (카드오류.length) {
            글 = `지금: 옛 방식 — 저장된 카드 순서에 문제가 있어(${카드오류.join(', ')}) 구역 순위·동 순서로 계산 중입니다. `
                + '아래는 그 옛 설정을 카드로 바꿔 보여 준 것입니다. 고쳐 저장하면 카드 순서 방식으로 바뀝니다.'; 톤 = 'warn';
        } else {
            글 = '지금: 옛 방식(구역 순위·동 순서) — 아래는 지금 설정을 카드로 바꿔 보여 준 것입니다. 이대로 저장하면 카드 순서 방식으로 바뀝니다.'; 톤 = 'info';
        }
        if (!자료있음()) { 글 += ' 로케이션 자료를 아직 읽지 못해 칸 수를 모릅니다 — 잠시 뒤 탭을 다시 열어 주세요.'; 톤 = 'warn'; }
        box.dataset.tone = 톤;
        box.textContent = 글;
    }
    const back = $('lrs-card-legacy-btn');
    if (back) back.hidden = !(canSettings() && (저장방식 === 'cards' || 카드오류.length > 0));
}

function 카드(name, where) {
    const 고침 = canSettings();
    const b = document.createElement('div');
    b.className = 'puzzle-block lrs-card';
    b.dataset.card = name;
    b.draggable = 고침;
    if (!고침) b.classList.add('is-locked');
    if (where === 'ex') b.classList.add('is-ex');
    if (name === 고른카드) b.classList.add('is-picked');
    const t = document.createElement('span');
    t.textContent = cardLabel(name);
    const n = document.createElement('span');
    n.className = 'lrs-card-n';
    const cnt = 칸수[name];
    if (cnt != null) n.textContent = `· ${cnt}칸`;
    else if (자료있음()) {
        b.classList.add('is-missing');
        n.textContent = '· 자리 없음';
        b.title = '지금 로케이션 자료에 이 구역-동 자리가 없습니다(저장된 순서에만 있음)';
    }
    b.append(t, n);
    return b;
}

function 줄그리기(row, i, last) {
    const 고침 = canSettings();
    const wrap = document.createElement('div');
    wrap.className = 'puzzle-row lrs-card-row';
    const label = document.createElement('div');
    label.className = `puzzle-label ${i === 0 ? 'pz-r0' : 'pz-r1'}`;
    label.textContent = `${i + 1}순위`;
    const area = document.createElement('div');
    area.className = 'puzzle-drop-area';
    area.dataset.drop = 'row';
    area.dataset.row = String(i);
    row.forEach(name => area.appendChild(카드(name, 'row')));
    const tools = document.createElement('div');
    tools.className = 'lrs-row-tools';
    const 버튼 = (txt, act, title, off) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = txt;
        btn.title = title;
        btn.dataset.rowact = act;
        btn.dataset.row = String(i);
        btn.disabled = !고침 || off;
        return btn;
    };
    tools.append(버튼('▲', 'up', '이 줄을 위로', i === 0), 버튼('▼', 'down', '이 줄을 아래로', i === last), 버튼('줄 삭제', 'del', '줄을 지우고 카드는 미지정으로', false));
    wrap.append(label, area, tools);
    return wrap;
}

function 고른카드그리기() {
    const bar = $('lrs-card-pick');
    if (!bar) return;
    if (고른카드 && !whereIs(보드, 고른카드)) 고른카드 = null;
    if (!고른카드 || !canSettings()) { bar.hidden = true; return; }
    const m = cardMoves(보드, 고른카드);
    $('lrs-card-pick-name').textContent = cardLabel(고른카드);
    bar.querySelector('[data-pick="up"]').disabled = !m.up;
    bar.querySelector('[data-pick="down"]').disabled = !m.down;
    bar.querySelector('[data-pick="ex"]').textContent = m.exclude === 'remove' ? '제외 풀기' : '제외';
    bar.hidden = false;
}

function 보드그리기() {
    if (!보드) return;
    const 고침 = canSettings();
    const rowsBox = $('lrs-card-rows');
    if (rowsBox) rowsBox.replaceChildren(...보드.rows.map((r, i) => 줄그리기(r, i, 보드.rows.length - 1)));
    const none = $('lrs-card-none');
    if (none) none.replaceChildren(...보드.unassigned.map(n => 카드(n, 'none')));
    const exBox = $('lrs-card-ex');
    if (exBox) exBox.replaceChildren(...excludedCards(보드).map(n => 카드(n, 'ex')));
    const warn = $('lrs-card-none-warn');
    if (warn) {
        const k = 보드.unassigned.length;
        warn.hidden = k === 0;
        if (k) {
            const 보기 = 보드.unassigned.slice(0, 8).map(cardLabel).join(', ') + (k > 8 ? ' …' : '');
            warn.textContent = `미지정 카드 ${k}장(${보기}) — 변경 추천은 이 자리들로 옮기지 않고, 거기 있는 상품은 순위 있는 자리로 옮기는 추천 대상이 됩니다. 저장은 됩니다.`;
        }
    }
    const add = $('lrs-card-addrow');
    if (add) add.disabled = !고침;
    document.querySelectorAll('#lrs-card-auto [data-auto]').forEach(b => { b.disabled = !고침; });
    자동정렬표시();
    const u = $('lrs-card-u');
    if (u) { if (document.activeElement !== u) u.value = String(보드.U); u.disabled = !고침; }
    const ex = $('lrs-exclude-input');
    if (ex) { if (document.activeElement !== ex) ex.value = 보드.exclude.join(', '); ex.disabled = !고침; }
    제외미리보기();
    고른카드그리기();
    방식표시();
}

// 보드를 바꾼 뒤 — 다시 그리고, 불러온(또는 저장한) 때와 서명이 다르면 '바뀜'
function 보드바꿈(next) {
    if (!next || next === 보드) { 고른카드그리기(); return; }
    보드 = next;
    보드그리기();
    바뀜확인();
}

function 바뀜확인() {
    if (추천불러옴 && 보드 && boardSignature(보드, 위치읽기()) !== 보드기준) 추천바뀜 = true;
}

function 제외미리보기() {
    const box = $('lrs-exclude-preview');
    if (!box) return;
    const ex = $('lrs-exclude-input');
    const list = parseExcludeText(ex ? ex.value : '');
    box.replaceChildren(...(list.length ? list : ['제외 항목 없음']).map(t => {
        const s = document.createElement('span');
        s.className = list.length ? 'lrs-chip' : 'lrs-muted';
        s.textContent = t;
        return s;
    }));
}

const 자동정렬이름 = { distance: '④ 출발점 거리 순', 'dong-first': '② 동 우선', 'line-first': '③ 라인 우선', 'dong-group': '① 기존 설정' };

// 지금 보드가 어느 자동 정렬과 같은지 — 같은 버튼을 채워 표시(줄·동 1칸 값·제외까지 같을 때). 하나도 아니면 '직접 조정함'
function 자동정렬표시() {
    const now = $('lrs-card-auto-now');
    const combos = Object.keys(칸수 || {});
    let hit = '';
    if (보드 && combos.length) {
        const mine = boardSignature(보드, []);
        for (const preset of Object.keys(자동정렬이름)) {
            try {
                const cards = autoSort(combos, preset, { priorities: { ...(기준우선순위 || {}), excludeCombos: 보드.exclude }, layout: CARD_LAYOUT });
                if (boardSignature(applyCards(보드, cards), []) === mine) { hit = preset; break; }
            } catch (e) { /* 이 정렬은 못 만듦 — 표시만 건너뜀 */ }
        }
    }
    document.querySelectorAll('#lrs-card-auto [data-auto]').forEach(b => {
        const on = b.dataset.auto === hit;
        b.classList.toggle('btn-primary', on);
        b.classList.toggle('btn-secondary', !on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    if (now) now.textContent = !보드 || !combos.length ? '' : hit ? `지금 배치: ${자동정렬이름[hit]}` : '지금 배치: 직접 조정함';
}

function 자동정렬(preset) {
    if (!canSettings() || !보드) return;
    const combos = Object.keys(칸수);
    if (!combos.length) { 상태('lrs-status', '로케이션 자료를 아직 읽지 못해 자동 정렬을 할 수 없습니다 — 잠시 뒤 탭을 다시 열어 주세요.', 'error'); return; }
    if (!confirm(`자동 정렬(${자동정렬이름[preset] || preset})로 카드 줄을 다시 짭니다.\n`
        + '지금 줄 배치와 \'동 1칸 = 줄\' 값이 바뀝니다(제외 칸은 그대로).\n저장하기 전이면 탭을 다시 열어 저장된 배치로 돌아갈 수 있습니다.\n계속할까요?')) return;
    try {
        const cards = autoSort(combos, preset, { priorities: { ...(기준우선순위 || {}), excludeCombos: 보드.exclude }, layout: CARD_LAYOUT });
        고른카드 = null;
        보드바꿈(applyCards(보드, cards));
        상태('lrs-status', `자동 정렬(${자동정렬이름[preset] || preset})로 바꿨습니다 — 저장해야 반영됩니다.`, 'info');
    } catch (e) {
        console.warn('[추천·채우기] 자동 정렬 실패:', e);
        상태('lrs-status', '자동 정렬을 하지 못했습니다.', 'error');
    }
}

// 카드 끌기·누르기·줄 버튼 — 보드 상자 하나에 위임
function 카드이벤트걸기() {
    const board = $('lrs-card-board');
    if (board) {
        const 칸 = (e) => (e.target && e.target.closest ? e.target.closest('[data-drop]') : null);
        board.addEventListener('dragstart', (e) => {
            const c = e.target && e.target.closest ? e.target.closest('.lrs-card') : null;
            if (!c || !canSettings()) return;
            끄는카드 = c.dataset.card;
            c.classList.add('dragging');
            try { e.dataTransfer.setData('text/plain', 끄는카드); e.dataTransfer.effectAllowed = 'move'; } catch (_) { /* 일부 브라우저 */ }
        });
        board.addEventListener('dragend', (e) => {
            const c = e.target && e.target.closest ? e.target.closest('.lrs-card') : null;
            if (c) c.classList.remove('dragging');
            board.querySelectorAll('.dragover').forEach(x => x.classList.remove('dragover'));
            끄는카드 = null;
        });
        board.addEventListener('dragover', (e) => {
            const a = 칸(e);
            if (!a || !끄는카드) return;
            e.preventDefault();
            a.classList.add('dragover');
            try { e.dataTransfer.dropEffect = 'move'; } catch (_) { /* 무시 */ }
        });
        board.addEventListener('dragleave', (e) => {
            const a = 칸(e);
            if (a && !(e.relatedTarget && a.contains(e.relatedTarget))) a.classList.remove('dragover');
        });
        board.addEventListener('drop', (e) => {
            const a = 칸(e);
            if (!a || !끄는카드) return;
            e.preventDefault();
            a.classList.remove('dragover');
            const name = 끄는카드;
            끄는카드 = null;
            const d = a.dataset.drop;
            보드바꿈(placeCard(보드, name, d === 'row' ? { row: Number(a.dataset.row) } : d));
        });
        board.addEventListener('click', (e) => {
            if (!canSettings() || !보드) return;
            const t = e.target;
            const act = t && t.closest ? t.closest('[data-rowact]') : null;
            if (act) {
                const i = Number(act.dataset.row);
                const a = act.dataset.rowact;
                보드바꿈(a === 'del' ? deleteRow(보드, i) : moveRow(보드, i, a));
                return;
            }
            const c = t && t.closest ? t.closest('.lrs-card') : null;
            if (!c) return;
            고른카드 = 고른카드 === c.dataset.card ? null : c.dataset.card;
            보드그리기();
        });
    }
    const add = $('lrs-card-addrow');
    if (add) add.addEventListener('click', () => { if (canSettings() && 보드) 보드바꿈(addRow(보드)); });
    const pick = $('lrs-card-pick');
    if (pick) pick.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-pick]') : null;
        if (!b || !보드 || !canSettings()) return;
        const a = b.dataset.pick;
        if (a === 'close') { 고른카드 = null; 보드그리기(); return; }
        if (!고른카드) return;
        if (a === 'ex') 보드바꿈(toggleExclude(보드, 고른카드));
        else 보드바꿈(moveCard(보드, 고른카드, a));
    });
    const auto = $('lrs-card-auto');
    if (auto) auto.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-auto]') : null;
        if (b) 자동정렬(b.dataset.auto);
    });
    const u = $('lrs-card-u');
    if (u) u.addEventListener('input', () => {
        if (!보드) return;
        보드 = setU(보드, u.value.trim() === '' ? NaN : Number(u.value));
        바뀜확인();
    });
    const ex = $('lrs-exclude-input');
    if (ex) ex.addEventListener('change', () => { if (보드) 보드바꿈(setExclude(보드, parseExcludeText(ex.value))); });
    const back = $('lrs-card-legacy-btn');
    if (back) back.addEventListener('click', () => window.resetLocCardOrder());   // 감싼(권한 확인) 함수를 부른다
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
    보드기준 = boardSignature(보드, 위치읽기());   // 불러온 때 서명 — 끌었다 제자리에 놓으면 같으므로 변경으로 치지 않는다
    보드기준위치 = 위치읽기();
    보드원본 = 보드;
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
    // 동선 기준 카드 — 고급 입력칸에 쓰고 바로 누른 제외 목록도 반영(change 가 늦을 때)
    const exIn = $('lrs-exclude-input');
    if (exIn && 보드) 보드 = setExclude(보드, parseExcludeText(exIn.value));
    // 옛 방식인데 카드를 건드리지 않았으면(추천 양·위치 순서만 바꿈) 카드 방식으로 켜지 않는다 — 옛 칸(poses)만 저장.
    //   이때는 카드 검사도 하지 않는다(자리 자료를 아직 못 읽어 카드가 비어 있어도 추천 양은 저장되게)
    //   제외 입력칸만 바꾼 경우도 옛 방식 그대로 두고 excludeCombos 를 같이 저장한다(예전 화면처럼)
    const exNow = exIn ? parseExcludeText(exIn.value) : null;
    const sigNow = 보드 ? boardSignature(보드, 보드기준위치) : '';
    const exOnly = 저장방식 !== 'cards' && !!보드 && !!보드원본 && !!exNow && sigNow !== 보드기준
        && boardSignature(setExclude(보드원본, exNow), 보드기준위치) === sigNow;
    const legacyKeep = 저장방식 !== 'cards' && (!보드 || sigNow === 보드기준 || exOnly);
    const sv = legacyKeep ? { ok: true, value: null, unassigned: 0 }
        : 보드 ? boardToSave(보드, { poses: 위치읽기() }) : { ok: false, errors: ['카드 화면이 준비되지 않았습니다'] };
    if (!sv.ok) { 보드그리기(); 상태('lrs-status', `동선 기준 카드를 저장할 수 없습니다: ${sv.errors.join(' / ')}`, 'error'); return; }
    if (!legacyKeep && 저장방식 !== 'cards' && !confirm('동선 기준이 카드 순서 방식으로 바뀝니다.\n'
        + '다음 추천부터 구역 순위·동 순서 대신 카드 순서로 계산합니다(변경 추천 지표가 이날부터 예전과 이어지지 않을 수 있습니다).\n'
        + '되돌리기: [옛 방식으로]\n저장할까요?')) {
        상태('lrs-status', '저장하지 않았습니다.');
        return;
    }
    const pr = legacyKeep ? { poses: 위치읽기(), ...(exOnly ? { excludeCombos: exNow } : {}) } : { ...sv.value };
    if (!옛칸있음) { pr.zones = 기본우선순위.zones; pr.dongs = 기본우선순위.dongs; }   // 문서에 옛 칸이 없을 때만(되돌리기·옛 방식 계산용)
    const btn = $('lrs-save-btn');
    if (btn) btn.disabled = true;
    상태('lrs-status', '저장 중…');
    try {
        await setDoc(doc(db, ...INFO_PATH), {
            locRecSettings: { ...value, updatedAt: serverTimestamp() },
            recommendPriorities: pr
        }, { merge: true });
        // 화면 입고대기 추천(calcIncomingRecommend)이 바로 쓰게(구독도 곧 같은 값을 준다). zones·dongs 는 문서에 남은 값 그대로
        window.recommendPriorities = { ...(window.recommendPriorities || {}), ...pr };
        추천바뀜 = false;
        if (!legacyKeep) { 저장방식 = 'cards'; 카드오류 = []; }
        기준우선순위 = { ...(기준우선순위 || {}), ...pr };
        보드기준 = boardSignature(보드, 위치읽기());
        보드기준위치 = 위치읽기();
        보드원본 = 보드;
        옛칸있음 = true;
        추천양그리기(value);
        보드그리기();
        상태('lrs-status', (legacyKeep ? '저장했습니다 — 동선 기준은 지금처럼 옛 방식입니다(카드 순서로 바꾸려면 카드를 정리하고 저장). '
            : '저장했습니다 — 다음 추천부터 카드 순서로 계산합니다(되돌리기: [옛 방식으로]). ')
            + '추천 양은 다음 추천(06:40 또는 [지금 재고로 다시 만들기])부터, 입고대기 추천 자리에는 바로 반영됩니다.'
            + (sv.unassigned ? ` 미지정 카드 ${sv.unassigned}장은 그 자리로 추천하지 않습니다.` : ''), 'ok');
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

// [옛 방식으로] — recommendPriorities.cards 칸만 지운다. 남은 zones·dongs(카드 저장 때 건드리지 않은 옛 값)로 계산한다.
// 권한: js/lib/location-guard-map.js 가 location.settings 로 감싼다.
window.resetLocCardOrder = async function () {
    if (!db || !추천불러옴) {
        상태('lrs-status', '설정을 불러오지 못해 되돌릴 수 없습니다 — 새로고침해 보세요.', 'error');
        return;
    }
    if (!confirm('동선 기준을 옛 방식(구역 순위·동 순서)으로 되돌릴까요?\n'
        + '카드 순서를 지우고, 카드 방식으로 바꾸기 전의 구역 순위·동 순서(위치 순서·제외는 지금 값)로 다음 추천부터 계산합니다.'
        + (추천바뀜 ? '\n저장하지 않은 변경(추천 양 포함)은 버립니다.' : ''))) return;
    const back = $('lrs-card-legacy-btn');
    if (back) back.disabled = true;
    상태('lrs-status', '되돌리는 중…');
    try {
        await updateDoc(doc(db, ...INFO_PATH), { 'recommendPriorities.cards': deleteField() });
        if (window.recommendPriorities && typeof window.recommendPriorities === 'object') {
            const { cards, ...rest } = window.recommendPriorities;   // 구독이 곧 같은 값을 주지만 입고대기 추천이 바로 옛 방식으로
            window.recommendPriorities = rest;
        }
        추천바뀜 = false;
        await 추천불러오기(읽는중);
        상태('lrs-status', '옛 방식으로 되돌렸습니다 — 다음 추천부터 구역 순위·동 순서로 계산합니다. 아래 카드는 그 설정을 카드로 바꿔 보여 준 것입니다(저장하면 다시 카드 순서 방식).', 'ok');
    } catch (e) {
        const code = (e && e.code) || '';
        console.warn('[추천·채우기] 옛 방식 되돌리기 실패:', code || e);
        상태('lrs-status', code === 'permission-denied'
            ? '권한이 없습니다(로케이션 설정 권한이 필요합니다).'
            : `되돌리지 못했습니다 (${code || '알 수 없는 오류'}).`, 'error');
    } finally {
        if (back) back.disabled = false;
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
    // salesRule: 칸이 없으면(옛 문서) ①+② — 문제 아님
    if ('salesRule' in d) { if (typeof d.salesRule === 'boolean') 값.salesRule = d.salesRule; else 이상.push('계산 방식'); }
    if (Array.isArray(d.days) && d.days.length > 0 && d.days.every((x) => 정수(x, 0, 6))) {
        값.days = [...new Set(d.days)].sort((a, b) => a - b);
    } else 이상.push('요일');
    return { 값, 이상 };
}

const 채우기입력들 = () => [$('refill-enabled'), $('refill-skip-holidays'), $('refill-sales-on'), $('refill-sales-off'),
    ...document.querySelectorAll('.refill-day')].filter(Boolean);

function 채우기화면에(s, 고침) {
    $('refill-enabled').checked = !!s.enabled;
    $('refill-skip-holidays').checked = !!s.skipHolidays;
    $('refill-sales-on').checked = s.salesRule !== false;
    $('refill-sales-off').checked = s.salesRule === false;
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
        salesRule: !$('refill-sales-off').checked,
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
            enabled: s.enabled, days: s.days, skipHolidays: s.skipHolidays, salesRule: s.salesRule,
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

export function initLocSetPanel({ db: _db, auth: _auth, combosOf: _combosOf }) {
    db = _db;
    auth = _auth;
    combosOf = _combosOf || null;
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
        // 위치 순서 끌기 — 놓은 뒤 서명이 불러온(또는 저장한) 때와 달라졌을 때만 변경으로 친다(카드는 보드바꿈이 센다)
        ['drop', 'dragend'].forEach(ev => sec1.addEventListener(ev, () => 바뀜확인()));
        카드이벤트걸기();
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
