// === js/locrec-table.js ===
// 로케이션 변경 추천 표 창(#locrec-modal) — 탭[단독|맞바꾸기|페어] 표 · 행마다 [처리함]/[안 함]/되돌리기(처음 보여 주는 날짜만,
//   지난 날짜는 볼 수만) · 안 함도 보기 · 엑셀 받기(지금 탭) · ESC · 바깥 클릭 닫기.
// 데이터는 js/locrec-store.js 가 갖고, 이 파일은 그리기와 입력만 한다(로케이션 띠 js/locrec-card.js · 대시보드 js/locrec-dash.js 가 같이 쓴다).
// DOM: 페이지에 #locrec-modal 이 이미 있으면(location.html) 그것을 쓰고, 없으면(index.html) 같은 마크업을 JS 로 만든다.
//   스타일은 location.html <style> · index 는 css/locrec-modal.css(#locrec-modal 범위로 같은 모양).
// ⚠️ role="dialog" · data-act 를 붙이지 않는다 — 업무마감봇이 div[role=dialog] 마지막 것 · [data-act] 로 자기 확인창을 읽는다(버튼은 data-locrec-act).
// 오버레이 자식 1개 · 첫 자식 .modal-header 라 공통 끌기(js/modal-drag.js)가 붙는다.
import { escapeHtml } from './utils.js?v=202610221624';
import { fmtHM, tabCounts, TABS, TAB_LABEL, fmtNum, canMark, tabMeta, dayLabel, rowLines, dayMessage } from './lib/locrec-view.js?v=202610221624';
import { NO_NAME, todayKey } from './locrec-store.js?v=202610221624';
import { higherOpenThan } from './modal-above.js?v=202610221624';

// location.html 의 #locrec-modal 과 같은 마크업(바꾸면 둘 다)
const TEMPLATE = `
        <div class="modal-content refill-modal-content locrec-modal-content">
            <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <span id="locrec-modal-title">변경 추천</span>
                <button type="button" class="modal-x" data-locrec-close aria-label="닫기">×</button>
            </div>
            <div class="refill-modal-tools">
                <div class="seg-tabs locrec-tabs" id="locrec-tabs" style="margin-bottom:0;"></div>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <label class="refill-sub locrec-skipchk" id="locrec-skip-wrap" hidden><input type="checkbox" id="locrec-show-skip"> <span id="locrec-skip-txt" style="vertical-align:middle;">안 함도 보기</span></label>
                    <button type="button" class="btn btn-primary btn-sm" id="locrec-dl-btn" data-locrec-act="download" title="지금 탭(안 함도 보기면 그것까지)">엑셀 받기</button>
                </div>
            </div>
            <div id="locrec-modal-meta" class="modal-meta" style="margin-bottom:8px;"></div>
            <div class="table-box locrec-table-wrap">
                <table class="usage-table locrec-table">
                    <thead><tr><th>순위</th><th title="상품코드 · 상품명(옵션) — 맞바꾸기·페어는 두 줄(A/B)">상품</th><th>현재 로케이션</th><th>추천 로케이션</th><th title="옮길 수량">이동수량</th><th title="하루 평균 출고(개/일)">일출고</th><th title="하루에 덜 걷는 양(동·개/일)">이득</th><th>상태</th><th>표시</th></tr></thead>
                    <tbody id="locrec-tbody"></tbody>
                </table>
            </div>
        </div>`;

let mounted = null;

/** 표 창을 붙인다(한 탭에 한 번). → { open(), close(), isOpen(), render(), onClose(fn), el } */
export function mountLocRecTable({ store }) {
    if (mounted) return mounted;
    let modal = document.getElementById('locrec-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'locrec-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = TEMPLATE;
        document.body.appendChild(modal);
    }
    const q = (id) => document.getElementById(id);
    const mTitle = q('locrec-modal-title'), mMeta = q('locrec-modal-meta'), mTabs = q('locrec-tabs');
    const mSkipWrap = q('locrec-skip-wrap'), mSkip = q('locrec-show-skip'), mSkipTxt = q('locrec-skip-txt');
    const mDl = q('locrec-dl-btn'), mTbody = q('locrec-tbody');
    let tab = 'single', showSkipped = false, lastTabsHtml = '';
    const closeFns = new Set();

    const isOpen = () => modal.style.display === 'flex';
    const n0 = (v) => (v == null ? '' : Number(v).toLocaleString('ko-KR'));
    const nameCell = (name, option) => `${escapeHtml(name || '')}${option ? ` <span class="locrec-opt">(${escapeHtml(option)})</span>` : ''}`;

    function rowHtml(S, r, st, i, editable) {
        const busy = S.saving.has(r.recKey) || !editable;   // 지난 날짜는 볼 수만
        const k = escapeHtml(r.recKey);
        const mk = st.mark;
        const who = mk ? `<div class="locrec-who">${escapeHtml(mk.state === 'skip' ? '안 함' : '처리함')} · ${escapeHtml(mk.by || NO_NAME)} ${escapeHtml(fmtHM(mk.at))}</div>` : '';
        const btns = st.label === '처리됨' && !mk ? ''                       // 서버가 위치 변화를 확인한 행 — 누를 것이 없다
            : mk
            ? `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="undo" data-locrec-key="${k}"${busy ? ' disabled' : ''}>되돌리기</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="done" data-locrec-key="${k}"${busy ? ' disabled' : ''}>처리함</button>`
              + `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="skip" data-locrec-key="${k}"${busy ? ' disabled' : ''}>안 함</button>`;
        const badges = (r.capWarn ? '<span class="badge badge-warn locrec-badge" title="옮길 자리 적재량보다 수량이 많습니다">적재량 확인</span>' : '')
            + (r.pairNear ? `<span class="badge badge-accent locrec-badge" title="함께 잘 팔리는 상품이 옮길 자리와 같은 동에 있습니다">페어 ${escapeHtml(r.pairNear)}</span>` : '');
        // 맞바꾸기·페어는 줄(A/B)마다 <tr> — 상품·현재·추천·이동수량·일출고 칸끼리 짝이 맞게. 순위·이득·상태·표시는 rowspan 으로 하나만.
        // 줄무늬는 추천 단위(.locrec-alt) — usage-table 의 tr:nth-child(even) 는 줄 단위라 locrec-table 에서 끈다(location.html · css/locrec-modal.css).
        const lines = rowLines(r);
        const span = lines.length > 1 ? ` rowspan="${lines.length}"` : '';
        const trCls = `locrec-row tone-${st.tone}${st.label === '안 함' ? ' locrec-skipped' : ''}${i % 2 ? ' locrec-alt' : ''}`;
        return lines.map((l, j) => {
            const last = j === lines.length - 1;
            const cells = `<td class="locrec-prod"><span class="locrec-code">${escapeHtml(l.code)}</span> ${nameCell(l.name, l.option)}`
                + (last && badges ? `<div class="locrec-badges">${badges}</div>` : '') + '</td>'
                + `<td class="locrec-loc locrec-from">${escapeHtml(l.from || '-')}</td>`
                + `<td class="locrec-loc"><b class="locrec-to">${escapeHtml(l.to || '-')}</b></td>`
                + `<td class="locrec-num locrec-qty">${l.qty == null ? '' : `${n0(l.qty)}개`}</td>`
                + `<td class="locrec-num locrec-daily">${l.daily == null ? '' : fmtNum(l.daily)}</td>`;
            if (j > 0) return `<tr class="${trCls} locrec-sub">${cells}</tr>`;
            return `<tr class="${trCls}">`
                + `<td class="locrec-rank"${span}>${r.rank == null ? i + 1 : r.rank}</td>`
                + cells
                + `<td class="locrec-gain"${span}>${fmtNum(r.gain)}</td>`
                + `<td class="locrec-state"${span}><span class="locrec-st st-${st.tone}">${escapeHtml(st.label)}</span>${who}</td>`
                + `<td class="locrec-acts"${span}>${btns}</td></tr>`;
        }).join('');
    }

    // 열려 있을 때만 그린다(서버 문서·marks 가 바뀌면 store 가 알려 준다)
    function render() {
        if (!isOpen()) return;
        const S = store.get();
        if (S.authKnown && !S.signedIn) { close(); return; }      // 로그아웃 때 닫는다
        const today = todayKey();
        const loaded = store.loaded();
        const editable = loaded && canMark(S.latest, S.key, today);
        mTitle.textContent = `변경 추천 ${dayLabel(S.key || today)}`;
        const cnt = tabCounts(loaded ? S.day.parsed : null);
        const tabsHtml = TABS.map(t => `<button type="button" class="seg-tab${t === tab ? ' active' : ''}" data-locrec-tab="${t}">${TAB_LABEL[t]} ${cnt[t]}</button>`).join('');
        if (lastTabsHtml !== tabsHtml) { lastTabsHtml = tabsHtml; mTabs.innerHTML = tabsHtml; }
        const all = store.visibleRows(tab);
        const hiddenN = all.filter(x => x.st.hidden).length;
        const rows = all.filter(x => showSkipped || !x.st.hidden);
        mSkip.checked = showSkipped;
        mSkipWrap.hidden = !(hiddenN || showSkipped);
        mSkipTxt.textContent = `안 함${hiddenN ? ` ${hiddenN}건` : ''}도 보기`;
        mDl.disabled = !rows.length;
        if (!loaded) {
            mMeta.textContent = '';
            const t = (S.latest && dayMessage(store.entryOf(S.key)))
                || S.dayErr || (S.latestErr ? `추천 상태를 읽지 못했습니다(${S.latestErr})` : '') || '표 불러오는 중…';
            mTbody.innerHTML = `<tr><td colspan="9" class="refill-empty">${escapeHtml(t)}</td></tr>`;
            return;
        }
        mMeta.textContent = tabMeta(tab, all) + (editable ? '' : ' · 지난 날짜는 볼 수만 있습니다');
        if (!rows.length) {
            mTbody.innerHTML = `<tr><td colspan="9" class="refill-empty">${cnt[tab] ? '모두 안 함으로 숨겼습니다' : `${TAB_LABEL[tab]} 추천이 없습니다`}</td></tr>`;
            return;
        }
        mTbody.innerHTML = rows.map((x, i) => rowHtml(S, x.r, x.st, i, editable)).join('');
    }

    function open() { modal.style.display = 'flex'; render(); }
    function close() {
        const was = isOpen();
        modal.style.display = 'none';
        if (was) closeFns.forEach(fn => { try { fn(); } catch (e) { console.warn('[locrec]', e); } });
    }
    /** 창이 닫힐 때 부를 함수(대시보드: 구독 끄기). 돌려준 함수로 해제 */
    function onClose(fn) { closeFns.add(fn); return () => closeFns.delete(fn); }

    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-locrec-close]')) { close(); return; }
        const t = ev.target.closest('[data-locrec-tab]');
        if (t) { tab = TABS.includes(t.getAttribute('data-locrec-tab')) ? t.getAttribute('data-locrec-tab') : 'single'; render(); return; }
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        const key = b.getAttribute('data-locrec-key');
        if (act === 'download') store.downloadTab(tab, showSkipped);
        else if (act === 'done') store.mark(key, 'done');
        else if (act === 'skip') store.mark(key, 'skip');
        else if (act === 'undo') store.mark(key, null);
    });
    mSkip.addEventListener('change', () => { showSkipped = mSkip.checked; render(); });
    // ESC — 공통 js/modal-esc.js 는 .fixed.inset-0 오버레이만 닫아서 이 창(.modal-overlay)은 여기서 닫는다(열려 있을 때만).
    //   캡처 단계에서 받아 멈춘다 — 대시보드에서 밑에 깔린 다른 창까지 같은 ESC 로 닫히지 않게.
    //   단 이 창보다 위(z 가 큰) 창이 보이면 손대지 않는다 — 그 창의 ESC 처리에 맡긴다(연장근무 확인창 등). js/refill-table.js 와 같은 방식.
    window.addEventListener('keydown', (ev) => {
        if (!(ev.key === 'Escape' || ev.key === 'Esc') || !isOpen() || higherOpenThan(modal)) return;
        ev.preventDefault(); ev.stopPropagation(); close();
    }, true);

    store.on(render);
    mounted = { open, close, isOpen, render, onClose, el: modal };
    return mounted;
}
