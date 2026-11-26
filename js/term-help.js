// === js/term-help.js ===
// 어려운 용어 눌러서 설명 보기(2026-11-23 사용자 요청 — UPH·OEE 처럼 직관적이지 않은 이름).
// js/app-shell.js 가 대시보드(index)·데이터 관리(history) 화면에서 늦게 불러 start() 한다.
//   짧은 글자(제목·칸 이름·표 머리글 — 24자 이하)에서 사전(js/lib/term-glossary.js) 용어를 찾아 점선 밑줄 span 으로 감싸고,
//   누르면(터치·Enter 포함) 그 옆에 설명 창을 띄운다. ESC·바깥 누르기·스크롤로 닫힌다.
// ⚠️ 봇 안전: 봇 브라우저(navigator.webdriver — 업무마감봇·업무예상알림)에서는 켜지 않는다(시험은 ?termhelp=1 로 강제).
//    span 에 글자를 더하지 않아 textContent 는 그대로. 설명 창은 섀도 DOM 안(app-term-pop 태그 하나) — role=dialog·[data-act]·id 없음,
//    .fixed.inset-0 도 쓰지 않는다(js/lib/noti-popup.js 가 '열린 창'으로 보지 않게).
// 버튼·링크·라벨·입력칸·정렬 머리글(onclick) 안의 글자는 감싸지 않는다(누르면 원래 동작). 운영 리포트 PDF 는 .term-help-plain 으로 밑줄을 뺀다.

import { findTerm, shouldSkip, termOf } from './lib/term-glossary.js?v=202611260923';
import { isAutomation } from './lib/noti-popup.js?v=202611260923';

const MAX_LEN = 24;            // 이보다 긴 글자(문장)는 보지 않는다 — 제목·칸 이름만
const STYLE_ID = 'term-help-style';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const PAGE_CSS = `
.term-help { text-decoration: underline dotted; text-decoration-thickness: 1px; text-underline-offset: 3px; cursor: help; border-radius: 3px; }
.term-help:hover { background: rgba(47, 98, 201, .10); }
.term-help:focus-visible { outline: 2px solid #2F62C9; outline-offset: 1px; }
.term-help-plain .term-help { text-decoration: none; background: none; }
@media print { .term-help { text-decoration: none; background: none; } }`;

const POP_CSS = `
:host { all: initial; position: fixed; z-index: 2147483100; display: block; font-family: 'SUIT', 'Noto Sans KR', 'Malgun Gothic', system-ui, sans-serif;
        --bg: #FFFFFF; --line: #D6DAE0; --text: #23272E; --text-2: #646B75; --soft: #F7F8FA; --accent: #2F62C9; }
:host([data-theme="dark"]) { --bg: #20252C; --line: #3A414B; --text: #E6E8EC; --text-2: #A9B0BA; --soft: #1A1E24; --accent: #6E95E6; }
.box { width: min(320px, calc(100vw - 16px)); background: var(--bg); color: var(--text); border: 1px solid var(--line); border-radius: 10px;
       box-shadow: 0 8px 24px rgba(30, 40, 60, .22); padding: 12px 14px; font-size: 13px; line-height: 1.6; }
.name { font-weight: 700; font-size: 14px; margin: 0 0 4px; color: var(--accent); }
.desc { margin: 0; }
.calc { margin: 8px 0 0; padding: 6px 8px; background: var(--soft); border-radius: 6px; color: var(--text-2); font-size: 12.5px; }
.calc b { color: var(--text); font-weight: 600; }`;

let started = false;
let popHost = null;

/** 글자 노드에서 body 까지 조상 모양 목록(shouldSkip 입력) */
function chainOf(node) {
    const out = [];
    for (let el = node.parentElement; el && el !== document.body; el = el.parentElement) {
        out.push({
            tag: el.tagName,
            attrs: el.getAttributeNames ? el.getAttributeNames() : [],
            classes: el.classList ? Array.from(el.classList) : []
        });
    }
    return out;
}

/** 글자 노드 하나 — 용어가 있으면 그 부분만 span 으로 감싼다(앞뒤 글자는 그대로 글자 노드) */
function wrapText(tn) {
    const text = tn.nodeValue;
    if (!text || text.length > MAX_LEN || !text.trim()) return;
    if (!tn.parentElement || tn.parentElement.closest('.term-help')) return;
    const hit = findTerm(text);
    if (!hit) return;
    // 대시보드는 UPH 를 기존 설명(js/uph-tooltip.js)이 맡는다 — 같은 용어에 창이 둘 뜨지 않게
    if (hit.term.key === 'uph' && document.getElementById('uph-tooltip-style')) return;
    if (shouldSkip(chainOf(tn))) return;
    const mid = tn.splitText(hit.start);
    mid.splitText(hit.end - hit.start);
    const span = document.createElement('span');
    span.className = 'term-help';
    span.setAttribute('data-term-key', hit.term.key);
    span.setAttribute('tabindex', '0');
    span.setAttribute('aria-label', `${hit.term.name} 설명 보기`);
    mid.parentNode.insertBefore(span, mid);
    span.appendChild(mid);
}

function scan(root) {
    if (!root) return;
    if (root.nodeType === 3) { wrapText(root); return; }
    if (root.nodeType !== 1 || (root.closest && root.closest('.term-help'))) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.nodeValue && n.nodeValue.length <= MAX_LEN && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
    });
    const list = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) list.push(n);
    list.forEach(n => { if (n.parentElement && !n.parentElement.closest('.term-help')) wrapText(n); });
}

// ── 설명 창 ──
function closePop() {
    if (!popHost) return;
    popHost.remove();
    popHost = null;
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', closePop, true);
    window.removeEventListener('resize', closePop);
    document.removeEventListener('pointerdown', onOutside, true);
}
function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopImmediatePropagation(); closePop(); }
}
function onOutside(e) {
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(popHost)) return;
    if (e.target && e.target.closest && e.target.closest('.term-help')) return;   // 용어를 다시 누르면 click 이 처리
    closePop();
}
function openPop(span) {
    const t = termOf(span.getAttribute('data-term-key'));
    if (!t) return;
    const same = popHost && popHost.__span === span;
    closePop();
    if (same) return;                                   // 같은 용어를 다시 누르면 닫기
    popHost = document.createElement('app-term-pop');
    popHost.__span = span;
    if (document.documentElement.classList.contains('dark')) popHost.setAttribute('data-theme', 'dark');
    const root = popHost.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${POP_CSS}</style><div class="box" role="note">
        <p class="name">${esc(t.name)}</p><p class="desc">${esc(t.desc)}</p>${t.calc ? `<p class="calc"><b>계산</b> ${esc(t.calc)}</p>` : ''}</div>`;
    popHost.style.visibility = 'hidden';
    document.body.appendChild(popHost);
    // 용어 아래(자리가 없으면 위), 화면 밖으로 나가지 않게
    const r = span.getBoundingClientRect();
    const box = root.querySelector('.box').getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = Math.min(Math.max(8, r.left), vw - box.width - 8);
    let top = r.bottom + 6;
    if (top + box.height > vh - 8) top = Math.max(8, r.top - box.height - 6);
    popHost.style.left = `${Math.round(left)}px`;
    popHost.style.top = `${Math.round(top)}px`;
    popHost.style.visibility = '';
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', closePop, true);
    window.addEventListener('resize', closePop);
    document.addEventListener('pointerdown', onOutside, true);
}

/** 시작 — 봇이면 아무것도 안 한다(?termhelp=1 이면 강제). 두 번 불러도 한 번만 */
export function start({ force = false } = {}) {
    if (started || !document.body) return;
    let forced = force;
    try { forced = forced || new URLSearchParams(location.search).get('termhelp') === '1'; } catch (e) { /* 무시 */ }
    if (isAutomation() && !forced) return;
    started = true;
    if (!document.getElementById(STYLE_ID)) {
        const st = document.createElement('style');
        st.id = STYLE_ID;
        st.textContent = PAGE_CSS;
        document.head.appendChild(st);
    }
    // 누르기 — 캡처 단계에서 받아 밑 요소(행 누르면 상세 등)로 가지 않게
    document.addEventListener('click', (e) => {
        const sp = e.target && e.target.closest ? e.target.closest('.term-help') : null;
        if (!sp) return;
        e.preventDefault();
        e.stopPropagation();
        openPop(sp);
    }, true);
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const sp = e.target && e.target.classList && e.target.classList.contains('term-help') ? e.target : null;
        if (!sp) return;
        e.preventDefault();
        openPop(sp);
    });
    scan(document.body);
    // 다시 그려지는 화면 — 추가된 노드만 모아 쉬는 틈에 처리(자기가 넣은 span 은 건너뜀)
    let pending = new Set(), timer = null;
    const flush = () => {
        timer = null;
        const list = Array.from(pending);
        pending = new Set();
        list.forEach(n => { if (n.isConnected) scan(n); });
    };
    const mo = new MutationObserver((recs) => {
        for (const r of recs) {
            if (r.type === 'characterData') { pending.add(r.target); continue; }
            r.addedNodes.forEach(n => {
                if (n.nodeType === 1 && (n.classList.contains('term-help') || n.tagName === 'APP-TERM-POP' || n.tagName === 'STYLE' || n.tagName === 'SCRIPT')) return;
                if (n.nodeType === 3 && n.parentElement && n.parentElement.classList.contains('term-help')) return;
                pending.add(n);
            });
        }
        if (pending.size && !timer) {
            timer = (window.requestIdleCallback ? window.requestIdleCallback(flush, { timeout: 400 }) : setTimeout(flush, 200));
        }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
}
