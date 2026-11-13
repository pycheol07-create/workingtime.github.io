import { escapeHtml } from './utils.js?v=202611131136';
// === js/panel-pdf.js ===
// 📄 화면의 패널 하나를 '보이는 그대로' PDF 로 받는다(A4 가로) — 운영 리포트 탭의 [PDF 받기] (2026-11-10).
//   방식은 팀 결산 PDF(js/ui-history-settlement.js downloadSettlementPdf)와 같다 — 그쪽은 그대로 두고 여기서 일반화했다.
//     · 임시 상자는 문서 흐름 안(높이 0 · overflow hidden 껍데기). fixed/absolute 로 두면 html2pdf 가 높이를 0 으로 재 빈 종이가 나온다.
//       ⚠️ js/history-excel-utils.js downloadContentAsPdf 는 fixed 방식이라 쓰지 않는다.
//     · 패널을 복제해 조작용만 지우고, 버튼은 껍데기만 벗기고(제목·숫자가 버튼 안에 있다), 캔버스(차트)는 그림으로 옮긴다.
//     · 입력칸(input·select·textarea)은 지우지 않고 지금 값을 글자로 바꿔 넣는다(목표 값처럼 입력칸에 든 화면).
//     · 펼침(details)은 지금 열린 상태 그대로 — 닫힌 펼침은 머리(summary)만 남긴다.
//     · 복제본의 id 는 data-pdf-id 로 옮긴다 — 만드는 동안 화면이 다시 그려져도(getElementById) 복제본에 쓰지 않게.
//       id 로 거는 모양 규칙은 같은 속성 선택자로 바꿔 넣는다(idsToAttr).
//     · 스크롤·sticky·겹침 배치를 흐름 배치로. 캡처 폭·높이를 픽셀로 못 박고, 덩어리가 두 쪽에 걸치면 그 앞을 띄워 다음 장으로 민다
//       (html2pdf pagebreak.avoid 는 이 방식에서 안 듣는다). 높이는 한 번에 다 재고 한 군데만 고친 뒤 다시 잰다(읽기·쓰기 분리).
//     · 캔버스 한 변 한계(약 16000px)를 넘으면 배율을 낮추고(최저 1), 그래도 넘으면 안내하고 멈춘다(빈 PDF 를 저장하지 않는다).
//   ⚠️ 운영 리포트 화면의 모양(.opv-* 등)은 '#history-modal …' 범위 규칙이다. 임시 상자는 #history-modal 밖(body 맨 앞)에 있어
//      그 규칙이 안 걸리므로, 그 규칙들을 임시 상자 id 로 바꿔 상자 안 <style> 에 넣는다(scopeRule). 어두운 화면 규칙은 옮기지 않는다(종이는 밝게).
//   여기는 DOM 이 없어도 불러올 수 있다(순수 함수는 tests/panel-pdf.test.js 가 node 로 본다).
// ⚠️ 직원 이름·금액을 콘솔에 찍지 않는다.

export const HOLDER_ID = 'panel-pdf-holder';
export const MAX_CANVAS_SIDE = 16000;   // 브라우저 캔버스 한 변 한계(크롬·사파리 어림) — 넘으면 빈 그림이 나온다
export const TOO_LONG_MSG = '내용이 너무 길어 PDF로 받을 수 없습니다 — 상세 표를 접고 받아 주세요';
const PREF_SCALE = 2;                   // html2canvas 배율(선명도)
const MIN_SCALE = 1;
const PAGE_RATIO = 194 / 281;           // A4 가로 297x210mm, 여백 8mm → 쓸 높이 194mm / 폭 281mm

// 늘 지우는 것 — 조작용 표식. 'print:hidden' 은 콜론이 든 클래스라 속성 선택자로 찾는다.
const BASE_REMOVE = '[data-html2canvas-ignore], [class*="print:hidden"]';

/** 파일 이름 — 조각을 '_' 로 잇고 .pdf. / \ 는 -, 나머지 금지 문자는 지우고 공백은 하나로. 빈 조각은 뺀다. */
export function pdfFileName(parts, maxLen = 120) {
    const name = (parts || []).map(p => cleanPart(p)).filter(Boolean).join('_').slice(0, maxLen).trim() || '화면';
    return name + '.pdf';
}

/** 파일 이름에 넣을 글자 — 날짜의 / \ 는 - 로, 나머지 금지 문자(: * ? " < > |·제어 문자)는 지운다. */
const cleanPart = (s) => String(s == null ? '' : s)
    .replace(/[\\/]/g, '-')
    .replace(/[:*?"<>|\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');

/**
 * 배율 고르기 — 캔버스 한 변(폭·높이 × 배율)이 maxSide 를 넘지 않는 가장 큰 배율(preferred 이하, 소수 둘째 자리 내림).
 *   min 배율로도 넘으면 0(= 받을 수 없음).
 */
export function pickScale(capW, capH, { preferred = PREF_SCALE, min = MIN_SCALE, maxSide = MAX_CANVAS_SIDE } = {}) {
    const side = Math.max(capW || 0, capH || 0);
    if (!(side > 0)) return preferred;
    const fit = Math.floor((maxSide / side) * 100) / 100;
    const s = Math.min(preferred, fit);
    return s >= min ? s : 0;
}

/** html2pdf 가 자르는 한 장 높이(CSS px) — 캔버스 폭(내림) × 194/281 을 내림한 값을 배율로 나눈다. */
export function pdfPageHeight(capW, scale) {
    return Math.floor(Math.floor(capW * scale) * PAGE_RATIO) / scale;
}

/**
 * 캡처 높이 — 내용 끝(contentBottom)이 든 장 안에서 끝나게. 내용 아래 여백 margin 은 남기되 다음 장으로는 넘기지 않는다.
 *   total = 상자 전체 높이, pageH = 한 장 높이(px, 소수 가능). 내용 끝을 못 쟀으면(0) total 그대로.
 *   slack — 내용 끝이 장 경계를 이만큼(px)만 넘으면 경계에서 자른다(카드 아래 테두리 1px 같은 것 때문에 빈 장이 붙지 않게).
 */
export function lastPageCut(total, contentBottom, pageH, margin = 8, slack = 4) {
    if (!(contentBottom > 0) || !(pageH > 0) || contentBottom >= total) return total;
    const pages = Math.max(1, Math.ceil((contentBottom - slack) / pageH));
    const pageEnd = Math.floor(pages * pageH);
    return Math.max(1, Math.min(total, contentBottom + margin, pageEnd));
}

/**
 * 장 경계 판단 — 위에서 top, 높이 h 인 덩어리가 두 장에 걸치면 다음 장 머리까지 띄울 px, 아니면 0.
 *   한 장보다 크면 -1(나뉠 수밖에 없다 — 안의 덩어리가 따로 맞춰진다).
 */
export function pushGap(top, h, pageH) {
    if (!(h > 0) || !(pageH > 0)) return 0;
    if (h > pageH) return -1;
    const startPage = Math.floor(top / pageH);
    const endPage = Math.floor((top + h - 1) / pageH);
    if (startPage === endPage) return 0;
    return Math.ceil((startPage + 1) * pageH - top);
}

// 쉼표 목록 나누기 — 괄호 안(:is(a, b))의 쉼표는 나누지 않는다
export function splitSelectors(sel) {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of String(sel || '')) {
        if (ch === '(' || ch === '[') depth++;
        else if ((ch === ')' || ch === ']') && depth > 0) depth--;
        if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
}

// :is(#임시상자, #다른범위, …) → #임시상자 — 옮긴 규칙에 다른 범위 id 가 남지 않게
const reduceIs = (sel, toId) => sel.replace(/:is\(([^()]*)\)/g, (m, inner) =>
    splitSelectors(inner).includes('#' + toId) ? '#' + toId : m);

/**
 * 범위 규칙 하나를 임시 상자용으로 — selectorText 의 fromId(예: history-modal)를 toId 로 바꾼다.
 *   fromId 가 없는 선택자·어두운 화면(.dark) 선택자는 뺀다. 남는 게 없으면 null.
 *   subject = 그 범위 자체를 고르는 선택자(#history-modal { position:fixed … })만 남았는가 — 그때는 변수(--*)만 옮겨야 한다
 *   (통째로 옮기면 임시 상자가 fixed 가 되어 빈 종이가 나온다).
 *   반환 { selector, subject, subjectSelector }. `#history-modal-content-box` 처럼 이름이 이어지는 id 는 건드리지 않는다.
 */
export function scopeRule(selectorText, fromId, toId) {
    const re = new RegExp('#' + fromId + '(?![-\\w])', 'g');
    const keep = splitSelectors(selectorText).filter(s => { re.lastIndex = 0; return re.test(s) && !/\.dark(?![-\w])/.test(s); });
    if (!keep.length) return null;
    const isSubject = (s) => !/[\s>+~]/.test(s.replace(/\([^()]*\)/g, '()').replace(/\([^()]*\)/g, '()').trim());
    const sub = keep.filter(isSubject);
    const desc = keep.filter(s => !isSubject(s));
    const conv = (list) => list.map(s => reduceIs(s.replace(re, '#' + toId), toId)).join(', ');
    // 섞여 있으면 자손 쪽을 먼저(모양이 중요) — 범위 자체 쪽은 변수만이라 따로 부른다
    return { selector: conv(desc.length ? desc : sub), subject: !desc.length, subjectSelector: sub.length && desc.length ? conv(sub) : null };
}

/** 선택자의 #id 중 ids(복제본에서 옮긴 id)에 든 것을 [data-pdf-id="id"] 로. keepId(임시 상자)는 그대로. */
export function idsToAttr(selector, ids, keepId = HOLDER_ID) {
    return String(selector).replace(/#([A-Za-z_][\w-]*)/g, (m, id) => (id !== keepId && ids.has(id) ? `[data-pdf-id="${id}"]` : m));
}

const hasIdIn = (selector, ids) => [...String(selector).matchAll(/#([A-Za-z_][\w-]*)/g)].some(m => ids.has(m[1]));

// 문서의 모양 규칙 중 복제본에 필요한 것을 임시 상자용 CSS 글자로.
//   ① '#history-modal …' 범위 규칙 → 임시 상자 범위로(scopeRule)  ② 범위 밖이지만 복제본 안의 id 를 거는 규칙
//   둘 다 복제본 id 는 data-pdf-id 속성 선택자로 바꾼다. 읽을 수 없는 시트(다른 출처)는 건너뛴다.
function scopedCssText(fromId, toId, ids) {
    const out = [];
    const varsOnly = (style) => {
        const decl = [];
        for (let i = 0; i < style.length; i++) {
            const p = style[i];
            if (p.startsWith('--')) decl.push(`${p}:${style.getPropertyValue(p)}`);
        }
        return decl.join(';');
    };
    const walk = (rules, wrapOpen, wrapClose) => {
        for (const r of rules) {
            if (r.cssRules && r.media) { walk(r.cssRules, `@media ${r.media.mediaText}{`, '}'); continue; }
            if (!r.selectorText || !r.style) continue;
            let css = '';
            if (r.selectorText.includes('#' + fromId)) {
                const s = scopeRule(r.selectorText, fromId, toId);
                if (!s) continue;
                if (s.subject) { const v = varsOnly(r.style); if (v) css = `${s.selector}{${v}}`; }
                else {
                    css = `${idsToAttr(s.selector, ids, toId)}{${r.style.cssText}}`;
                    if (s.subjectSelector) { const v = varsOnly(r.style); if (v) css += `${s.subjectSelector}{${v}}`; }
                }
            } else if (hasIdIn(r.selectorText, ids)) {
                const sel = splitSelectors(r.selectorText).filter(s => hasIdIn(s, ids) && !/\.dark(?![-\w])/.test(s)).map(s => idsToAttr(s, ids, toId));
                if (sel.length) css = `${sel.join(', ')}{${r.style.cssText}}`;
            }
            if (css) out.push(wrapOpen + css + wrapClose);
        }
    };
    for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch (e) { continue; }
        if (rules) walk(rules, '', '');
    }
    return out.join('\n');
}

// 입력칸 → 지금 값 글자. 원본과 복제본을 같은 순서로 짝짓는다(복제본의 value 속성은 처음 값이라 원본에서 읽는다).
function inputsToText(panel, clone) {
    const src = panel.querySelectorAll('input, select, textarea');
    const dst = clone.querySelectorAll('input, select, textarea');
    src.forEach((el, i) => {
        const d = dst[i];
        if (!d) return;
        const tag = el.tagName;
        const type = (el.getAttribute('type') || '').toLowerCase();
        if (tag === 'INPUT' && (type === 'hidden' || type === 'file' || type === 'button' || type === 'submit' || type === 'reset')) { d.remove(); return; }
        let text;
        if (tag === 'SELECT') text = [...el.selectedOptions].map(o => o.textContent.trim()).join(', ');
        else if (type === 'checkbox' || type === 'radio') text = el.checked ? '■' : '□';
        else text = el.value == null ? '' : String(el.value);
        const span = document.createElement('span');
        span.textContent = text || (type === 'checkbox' || type === 'radio' ? '' : ' ');
        span.className = (d.className || '').replace(/hover:[^\s]+|focus[^\s]*/g, '');
        const w = Math.round(el.offsetWidth || 0);
        span.style.cssText = `display:inline-block;box-sizing:border-box;${w ? `min-width:${w}px;` : ''}line-height:28px;vertical-align:middle;`
            + (tag === 'TEXTAREA' ? 'white-space:pre-wrap;line-height:1.5;padding:4px 8px;' : '');
        d.replaceWith(span);
    });
}

// 덩어리가 두 장에 걸치지 않게 띄운다. 매 회 모든 높이를 먼저 읽고(읽기), 처음 걸치는 덩어리 하나만 띄운 뒤(쓰기) 그 자리부터 다시 잰다.
//   띄우기는 margin-top(새 칸을 끼우면 grid 칸이 하나 늘어 간격이 더 생긴다), 표 줄만 빈 줄을 끼운다.
function pushSections(holder, selector, pageH) {
    const els = [...holder.querySelectorAll(selector)];
    let start = 0, pushed = 0, tooTall = 0, guard = 0;
    while (start < els.length && guard++ < 400) {
        const top0 = holder.getBoundingClientRect().top;
        const rects = els.slice(start).map(el => el.getBoundingClientRect());   // 읽기만
        let hit = -1, gap = 0;
        for (let k = 0; k < rects.length; k++) {
            const g = pushGap(rects[k].top - top0, rects[k].height, pageH);
            if (g < 0) { tooTall++; continue; }
            if (g > 0) { hit = start + k; gap = g; break; }
        }
        if (hit < 0) break;
        const el = els[hit];                                                   // 쓰기 한 번
        if (el.tagName === 'TR') {
            const row = document.createElement('tr');
            row.setAttribute('data-pdf-spacer', '');
            row.innerHTML = `<td colspan="99" data-pdf-spacer style="height:${escapeHtml(gap)}px;padding:0;border:0;background:transparent;"></td>`;
            el.parentNode.insertBefore(row, el);
            start = hit + 1;
        } else {
            const mt = parseFloat(getComputedStyle(el).marginTop) || 0;
            el.style.marginTop = (mt + gap) + 'px';
            start = hit;   // 여백이 겹쳐(collapse) 덜 내려갔으면 다음 회에 남은 만큼 더 띄운다
        }
        pushed++;
    }
    return { pushed, tooTall };
}

/**
 * 패널 하나를 PDF 로.
 * @param {HTMLElement} panel 지금 화면에 보이는 패널
 * @param {{filename?:string, btn?:HTMLElement, removeSelector?:string, sectionSelector?:string, scopeId?:string, notify?:(msg:string)=>void}} o
 *   removeSelector = 더 지울 조작용(기본 표식에 더해), sectionSelector = 두 쪽에 걸치지 않게 할 덩어리,
 *   scopeId = 화면 모양 규칙의 범위 id(기본 history-modal), notify = 안내 방법(기본 alert).
 * @returns {Promise<boolean>} 저장했으면 true
 */
export async function downloadPanelPdf(panel, o = {}) {
    const { filename = '화면.pdf', btn = null, removeSelector = '', sectionSelector = 'section', scopeId = 'history-modal', notify = (m) => alert(m) } = o;
    if (typeof html2pdf === 'undefined') {
        notify('PDF 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        return false;
    }
    if (!panel) return false;
    const btnText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중…'; }

    const wrap = document.createElement('div');
    wrap.style.cssText = 'height:0;overflow:hidden;';
    const holder = document.createElement('div');
    holder.id = HOLDER_ID;
    // 폭은 화면에 보이는 그 폭(임의의 넓은 폭은 레이아웃이 다시 잡혀 좌우에 빈 띠가 생긴다)
    const capW0 = Math.max(900, Math.round(panel.clientWidth));
    holder.style.cssText = `width:${capW0}px;height:auto;background:#fff;padding:16px;overflow:visible;`;

    let prevBody = null, prevHtml = null, inserted = false;
    try {
        const clone = panel.cloneNode(true);
        clone.classList.remove('hidden', 'flex-1', 'h-full', 'overflow-y-auto', 'overflow-hidden', 'absolute', 'inset-0');
        clone.style.cssText = 'display:block;position:static;width:100%;height:auto;max-height:none;overflow:visible;';

        // 그래프(캔버스)는 복제만으론 빈 사각형 — 픽셀을 옮겨 담는다(지우기 전에, 같은 순서로 짝지어)
        const srcC = panel.querySelectorAll('canvas');
        const dstC = clone.querySelectorAll('canvas');
        srcC.forEach((c, i) => {
            if (!dstC[i]) return;
            const img = document.createElement('img');
            try { img.src = c.toDataURL('image/png'); } catch (e) { return; }
            img.style.cssText = `width:${c.clientWidth}px;height:${c.clientHeight}px;`;
            dstC[i].replaceWith(img);
        });
        inputsToText(panel, clone);

        clone.querySelectorAll(BASE_REMOVE + (removeSelector ? ', ' + removeSelector : '')).forEach(el => el.remove());

        // 내용이 든 버튼은 껍데기만 벗긴다
        clone.querySelectorAll('button').forEach(b => {
            const span = document.createElement('span');
            span.innerHTML = b.innerHTML;
            span.className = (b.className || '').replace(/hover:[^\s]+/g, '');
            b.replaceWith(span);
        });
        // 펼침은 지금 상태 그대로 — 닫힌 펼침은 머리(summary)만 남긴다. 닫힌 속 내용도 크롬에서는 상자 크기가 잡혀
        // (실측: 내용 끝 계산이 205px 늘어 빈 장이 붙음) html2canvas 가 그릴 수도 있어서 아예 뺀다.
        clone.querySelectorAll('details:not([open])').forEach(d => {
            [...d.children].forEach(ch => { if (ch.tagName !== 'SUMMARY') ch.remove(); });
            [...d.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
        });
        clone.querySelectorAll('summary').forEach(s => { s.style.cursor = 'default'; });

        // id → data-pdf-id (문서에 같은 id 가 둘 생기지 않게 — 넣기 전에)
        const ids = new Set();
        [clone, ...clone.querySelectorAll('[id]')].forEach(el => {
            if (!el.id) return;
            ids.add(el.id);
            el.setAttribute('data-pdf-id', el.id);
            el.removeAttribute('id');
        });
        const style = document.createElement('style');
        style.textContent = scopedCssText(scopeId, HOLDER_ID, ids) + `
            #${HOLDER_ID} * { overflow: visible !important; max-height: none !important; scrollbar-width: none !important; }`;
        holder.appendChild(style);

        holder.appendChild(clone);
        wrap.appendChild(holder);
        document.body.insertBefore(wrap, document.body.firstChild);
        inserted = true;

        // 스크롤 상자를 펼치고 겹쳐 놓는 배치를 흐름으로(남기면 겹쳐 그려지거나 높이가 0). 먼저 다 읽고 나중에 쓴다.
        const all = [...clone.querySelectorAll('*')];
        const posOf = all.map(el => getComputedStyle(el).position);
        all.forEach((el, i) => {
            el.classList.remove('h-full', 'h-screen', 'overflow-y-auto', 'overflow-x-auto', 'overflow-auto', 'sticky');
            el.style.maxHeight = 'none';
            el.style.overflow = 'visible';
            // 겹쳐 그리는 칸(차트 위 '데이터 없음' 안내·고정 열 등)은 흐름으로. 감춰진(.hidden) 것은 감춰진 채.
            if (posOf[i] === 'fixed' || posOf[i] === 'sticky' || posOf[i] === 'absolute') el.style.position = 'static';
        });

        // 결산 PDF 와 같이 인라인 overflow 를 푼다 — 단 history.html 의 html·body 는 overflow:hidden !important 라
        // 인라인 값(중요도 없음)으로는 실제로 풀리지 않는다. 임시 상자가 body 맨 앞(화면 0,0)이라 지금은 잘리지 않는다.
        prevBody = document.body.style.overflow;
        prevHtml = document.documentElement.style.overflow;
        document.body.style.overflow = 'visible';
        document.documentElement.style.overflow = 'visible';

        const capW = Math.ceil(holder.scrollWidth);
        // ⚠️ html2pdf 는 복제본을 '화면 폭 가운데'(margin:auto) 상자에 넣고, 잘라낼 왼쪽 끝을 그 상자의 화면 위치로 잡는다.
        //    그리는 창 폭(windowWidth)을 캡처 폭으로 줄이면 그리는 쪽만 가운데가 바뀌어 왼쪽이 (화면 폭 - 캡처 폭)/2 만큼 잘린다
        //    (실측: 화면 1500px · 패널 1080px → 왼쪽 210px 잘림, 오른쪽 빈 띠). 그리는 창 폭은 실제 화면 폭으로 둔다.
        const winW = Math.max(capW, Math.ceil(document.documentElement.clientWidth || window.innerWidth || capW));

        // 배율은 띄우기 전 높이로 먼저 어림(띄우면 조금 길어진다 — 아래에서 다시 본다)
        const scale = pickScale(capW, Math.ceil(holder.scrollHeight));
        if (!scale) { notify(TOO_LONG_MSG); return false; }
        const pageH = pdfPageHeight(capW, scale);
        const { pushed, tooTall } = sectionSelector ? pushSections(holder, idsToAttr(sectionSelector, ids), pageH) : { pushed: 0, tooTall: 0 };
        if (pushed || tooTall) {
            console.info(`화면 PDF: ${pushed}개 덩어리를 다음 장으로 밀었습니다.` + (tooTall ? ` (${tooTall}개는 한 쪽보다 커서 나뉩니다)` : ''));
        }

        // 끝의 여백(패널 아래 padding·상자 padding)만 다음 장으로 넘어가면 빈 종이가 한 장 붙는다(실측: 마지막 장 16~69px 빈칸).
        // 내용의 실제 끝을 재서 그 장 안에서 자른다.
        const holderTop = holder.getBoundingClientRect().top;
        let contentBottom = 0;
        clone.querySelectorAll('*').forEach(el => {
            if (el.hasAttribute('data-pdf-spacer')) return;
            const r = el.getBoundingClientRect();
            if (r.height > 0 && r.width > 0) contentBottom = Math.max(contentBottom, r.bottom - holderTop);
        });
        const capH = lastPageCut(Math.ceil(holder.scrollHeight), Math.ceil(contentBottom), pageH);
        if (capH < 50) throw new Error('내용 높이를 계산하지 못했습니다 (' + capH + 'px)');
        // 띄운 뒤 길어져 한계를 넘었으면 — 배율을 바꾸면 장 높이가 달라져 띄운 자리가 어긋나므로 멈춘다
        if (!pickScale(capW, capH, { preferred: scale, min: scale })) { notify(TOO_LONG_MSG); return false; }

        await html2pdf().from(holder).set({
            margin: [8, 8, 8, 8],
            filename,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: {
                scale, useCORS: true, backgroundColor: '#ffffff',
                scrollX: 0, scrollY: 0,
                width: capW, height: capH, windowWidth: winW, windowHeight: capH
            },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
            pagebreak: { mode: [] }
        }).save();
        return true;
    } catch (e) {
        console.error('화면 PDF 저장 실패:', e && e.message);
        notify('PDF 저장 중 오류가 발생했습니다.');
        return false;
    } finally {
        if (prevBody !== null) document.body.style.overflow = prevBody;
        if (prevHtml !== null) document.documentElement.style.overflow = prevHtml;
        if (inserted) wrap.remove();
        // html2pdf 가 실패하면 자기 겹침 상자(.html2pdf__overlay)를 남길 수 있다 — 화면을 덮지 않게 치운다
        document.querySelectorAll('.html2pdf__overlay').forEach(el => el.remove());
        if (btn) { btn.disabled = false; btn.textContent = btnText; }
    }
}
