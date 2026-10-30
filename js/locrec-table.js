// === js/locrec-table.js ===
// 로케이션 변경 추천 표 창(#locrec-modal) — 탭[단독|맞바꾸기|페어] 표 · 행마다 [처리함]/[안 함]/되돌리기(처음 보여 주는 날짜만,
//   지난 날짜는 볼 수만) · 안 함도 보기 · 엑셀 받기(지금 탭) · ESC · 바깥 클릭 닫기.
// 데이터는 js/locrec-store.js 가 갖고, 이 파일은 그리기와 입력만 한다(로케이션 띠 js/locrec-card.js · 대시보드 js/locrec-dash.js 가 같이 쓴다).
// DOM: 페이지에 #locrec-modal 이 이미 있으면(location.html) 그것을 쓰고, 없으면(index.html) 같은 마크업을 JS 로 만든다.
//   스타일은 location.html <style> · index 는 css/locrec-modal.css(#locrec-modal 범위로 같은 모양).
// ⚠️ role="dialog" · data-act 를 붙이지 않는다 — 업무마감봇이 div[role=dialog] 마지막 것 · [data-act] 로 자기 확인창을 읽는다(버튼은 data-locrec-act).
// 오버레이 자식 1개 · 첫 자식 .modal-header 라 공통 끌기(js/modal-drag.js)가 붙는다.
// 다시 만들기: 창에는 상태 문구만(버튼은 로케이션관리 대시보드 머리줄 [지금 재고로 다시 만들기] 하나 — js/rebuild-bar.js)
//   · 창을 보는 중에 새 판이 오면 띠 '새 추천이 도착했습니다' [새로 보기]
//   (store.setHold — 창이 열려 있으면 store 가 새 판을 pendingDay 에 둔다, 닫으면 바로 바꾼다).
//   이월 행(carried)은 흐리게 '(지금 기준 추천에서 빠짐)' — [처리함]/[안 함] 없이 되돌리기만.
// 데이터 리스트 반영(2026-10-29): [처리함]·[전체 처리함]은 데이터 리스트(Locations) 상품 칸도 추천대로 옮긴다(js/locrec-store.js).
//   반영된 표시는 '처리함 · 이름 HH:MM · 표에 반영'. [전체 처리함] 진행 중에는 버튼이 '반영 중 n/N'.
import { escapeHtml } from './utils.js?v=202610301032';
import { fmtHM, tabCounts, tabCarried, TABS, TAB_LABEL, fmtNum, canMark, tabMeta, dayLabel, rowLines, dayMessage, fmtGain, ROUTE_OUT_LABEL, ROUTE_OUT_HELP, locLabel, bulkDoneKeys, CARRIED_LABEL, qtyCellOf } from './lib/locrec-view.js?v=202610301032';
import { NO_NAME, todayKey } from './locrec-store.js?v=202610301032';
import { higherOpenThan } from './modal-above.js?v=202610301032';
import { undoConfirmText } from './lib/locrec-apply.js?v=202610301032';

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
                    <button type="button" class="btn btn-secondary btn-sm" id="locrec-all-btn" data-locrec-act="doneAll" title="지금 탭에서 아직 표시 안 한 추천을 모두 '처리함'으로 표시하고 데이터 리스트 자리도 추천대로 옮김(안 함·처리됨·만료·자리 바뀜은 제외)" hidden>전체 처리함</button>
                    <button type="button" class="btn btn-primary btn-sm" id="locrec-dl-btn" data-locrec-act="download" title="지금 탭(안 함도 보기면 그것까지)">엑셀 받기</button>
                </div>
            </div>
            <div id="locrec-new-band" hidden style="margin-bottom:8px; padding:6px 10px; border-radius:6px; background:var(--c-accent-soft, #EEF4FF); font-size:12.5px;"><span id="locrec-new-txt"></span> <button type="button" class="btn btn-primary btn-sm" data-locrec-act="applyNew">새로 보기</button></div>
            <div id="locrec-req-note" class="refill-sub" hidden style="margin-bottom:8px;"></div>
            <div id="locrec-modal-meta" class="modal-meta" style="margin-bottom:8px;"></div>
            <div class="table-box locrec-table-wrap">
                <table class="usage-table locrec-table">
                    <thead><tr><th>순위</th><th title="누르면 데이터 리스트에서 그 상품 보기 — 맞바꾸기·페어는 두 줄(A/B)">상품코드</th><th title="상품명(옵션)">상품</th><th>현재 로케이션</th><th>추천 로케이션</th><th title="옮길 수량(괄호는 비축 수량)">이동수량</th><th title="하루 평균 출고(개/일)">일출고</th><th title="하루에 덜 걷는 양(동·개/일)">이득</th><th title="이 줄만 처리하면 동선 점수(0~100)가 오르는 만큼">점수</th><th>상태</th><th>표시</th></tr></thead>
                    <tbody id="locrec-tbody"></tbody>
                </table>
            </div>
        </div>`;

let mounted = null;
// 옛 문서(행에 칸수 칸 없음) 보충용 — (자리 id) => 칸수 문자열. location.html 은 읽어 둔 Locations 에서 찾아 준다.
//   대시보드(index)는 Locations 를 읽지 않으므로 없음 → 옛 문서는 괄호 없이 보인다.
let sizeOfLoc = null;

/** 표 창을 붙인다(한 탭에 한 번). → { open(), close(), isOpen(), render(), onClose(fn), el }
 *  sizeOf: 선택 — 행에 칸수(fromSize·toSize)가 없을 때 쓸 (자리 id) => 칸수. */
export function mountLocRecTable({ store, sizeOf }) {
    if (typeof sizeOf === 'function') sizeOfLoc = sizeOf;
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
    const mDl = q('locrec-dl-btn'), mTbody = q('locrec-tbody'), mAll = q('locrec-all-btn');
    const mBand = q('locrec-new-band'), mBandTxt = q('locrec-new-txt'), mReqNote = q('locrec-req-note');
    let tab = 'single', showSkipped = false, lastTabsHtml = '';
    const closeFns = new Set();

    const isOpen = () => modal.style.display === 'flex';
    // 점수 칸 툴팁 — 이 줄만 처리했을 때 동선 점수·앞쪽 자리 출고 변화(옛 문서는 칸 없음)
    const scoreTitle = (r) => (r.routeOut ? escapeHtml(ROUTE_OUT_HELP) : r.scoreGain == null ? '동선 점수 기여도 없음(이전 추천이거나 계산 안 됨)'
        : escapeHtml(`이 줄만 처리하면 동선 점수 ${r.scoreGain >= 0 ? '+' : ''}${r.scoreGain.toFixed(2)}`
            + (r.frontGain == null ? '' : ` · 앞쪽 자리 출고 ${r.frontGain >= 0 ? '+' : ''}${r.frontGain.toFixed(2)}%p`)));
    // 로케이션 칸 — '★★-003(4)'(칸수 없으면 자리만). 행의 칸수가 우선, 없으면 sizeOfLoc 로 보충(실패해도 괄호 없이)
    const locCell = (id, size) => {
        let s = size;
        if (!s && id && sizeOfLoc) { try { s = sizeOfLoc(id) || ''; } catch (e) { s = ''; } }
        return locLabel(id, s) || '-';
    };
    // 이동수량 칸 — '1개 (비축 29)'(비축 없으면 '1개'). 피킹 수량이 적고 비축이 있으면 아래 작은 글씨 안내
    const qtyCell = (l) => {
        const c = qtyCellOf(l);
        return `<td class="locrec-num locrec-qty" title="${escapeHtml(c.title)}">${escapeHtml(c.text)}`
            + (c.reserve ? ` <span class="locrec-opt" style="font-weight:400;">(${escapeHtml(c.reserve)})</span>` : '')
            + (c.hint ? `<div class="locrec-who" style="font-weight:400; white-space:normal;">${escapeHtml(c.hint)}</div>` : '') + '</td>';
    };
    const nameCell = (name, option) => `${escapeHtml(name || '')}${option ? ` <span class="locrec-opt">(${escapeHtml(option)})</span>` : ''}`;

    function rowHtml(S, r, st, i, editable) {
        const busy = S.saving.has(r.recKey) || !!S.applying || !editable;   // 지난 날짜는 볼 수만 · 전체 반영 중에는 잠금
        const k = escapeHtml(r.recKey);
        const mk = st.mark;
        const who = mk ? `<div class="locrec-who">${escapeHtml(mk.state === 'skip' ? '안 함' : '처리함')} · ${escapeHtml(mk.by || NO_NAME)} ${escapeHtml(fmtHM(mk.at))}`
            + (mk.state === 'done' && mk.applied ? ' · 표에 반영' : '') + '</div>' : '';
        const carried = r.carried === true;                                   // 이월 행 — 지금 기준 추천에서 빠짐
        const btns = (st.label === '처리됨' || carried) && !mk ? ''         // 서버가 위치 변화를 확인한 행·이월 행 — 누를 것이 없다
            : mk
            ? `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="undo" data-locrec-key="${k}"${busy ? ' disabled' : ''}>되돌리기</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="done" data-locrec-key="${k}"${busy ? ' disabled' : ''} title="처리함으로 표시하고 데이터 리스트 자리도 추천대로 옮깁니다">처리함</button>`
              + `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="skip" data-locrec-key="${k}"${busy ? ' disabled' : ''}>안 함</button>`;
        const badges = (r.capWarn ? '<span class="badge badge-warn locrec-badge" title="옮길 자리 적재량보다 수량이 많습니다">적재량 확인</span>' : '')
            + (r.pairNear ? `<span class="badge badge-accent locrec-badge" title="함께 잘 팔리는 상품이 옮길 자리와 같은 동에 있습니다">페어 ${escapeHtml(r.pairNear)}</span>` : '')
            // 다시 만든 판에 처음 들어온 행 — 상태 '새로'(오늘 처음 나온 추천)와 헷갈리지 않게 '추가'
            + (r.addedAt ? `<span class="badge badge-accent locrec-badge" title="다시 만든 판(${escapeHtml(r.addedAt)})에 새로 들어온 추천">추가 ${escapeHtml(r.addedAt)}</span>` : '');
        // 맞바꾸기·페어는 줄(A/B)마다 <tr> — 상품·현재·추천·이동수량·일출고 칸끼리 짝이 맞게. 순위·이득·상태·표시는 rowspan 으로 하나만.
        // 줄무늬는 추천 단위(.locrec-alt) — usage-table 의 tr:nth-child(even) 는 줄 단위라 locrec-table 에서 끈다(location.html · css/locrec-modal.css).
        const lines = rowLines(r);
        const span = lines.length > 1 ? ` rowspan="${lines.length}"` : '';
        const trCls = `locrec-row tone-${st.tone}${st.label === '안 함' ? ' locrec-skipped' : ''}${i % 2 ? ' locrec-alt' : ''}${carried ? ' locrec-carried' : ''}`;
        const trAttr = carried ? ' style="opacity:.55" title="지금 기준 추천에서 빠진 행 — 오늘 손댄 것이라 남겨 둠"' : '';
        return lines.map((l, j) => {
            const last = j === lines.length - 1;
            // 상품코드 칸(누르면 데이터 리스트에서 그 상품 검색) · 상품 칸(상품명(옵션) + 배지)
            const cells = `<td class="locrec-pcode"><a class="locrec-code" href="location.html?q=${encodeURIComponent(l.code || '')}#tab=list" data-locrec-code="${escapeHtml(l.code)}" title="데이터 리스트에서 이 상품 보기">${escapeHtml(l.code)}</a></td>`
                + `<td class="locrec-prod">${nameCell(l.name, l.option)}`
                + (last && badges ? `<div class="locrec-badges">${badges}</div>` : '') + '</td>'
                + `<td class="locrec-loc locrec-from">${escapeHtml(locCell(l.from, l.fromSize))}</td>`
                + `<td class="locrec-loc"><b class="locrec-to">${escapeHtml(locCell(l.to, l.toSize))}</b></td>`
                + qtyCell(l)
                + `<td class="locrec-num locrec-daily">${l.daily == null ? '' : fmtNum(l.daily)}</td>`;
            if (j > 0) return `<tr class="${trCls} locrec-sub"${trAttr}>${cells}</tr>`;
            return `<tr class="${trCls}"${trAttr}>`
                + `<td class="locrec-rank"${span}>${carried ? '' : (r.rank == null ? i + 1 : r.rank)}</td>`     // 이월 행은 순위 없음
                + cells
                + `<td class="locrec-gain"${span}>${fmtNum(r.gain)}</td>`
                + `<td class="locrec-score-gain"${span} title="${scoreTitle(r)}">${escapeHtml(r.routeOut ? ROUTE_OUT_LABEL : fmtGain(r.scoreGain))}</td>`
                + `<td class="locrec-state"${span}><span class="locrec-st st-${st.tone}">${escapeHtml(st.label)}</span>${who}`
                + (carried ? `<div class="locrec-who">${escapeHtml(CARRIED_LABEL)}</div>` : '') + '</td>'
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
        // 다시 만들기 상태 문구(오늘 날짜일 때 — 버튼은 로케이션관리 머리줄 하나, js/rebuild-bar.js) · 새 판 도착 띠
        const ru = store.reqState();
        if (mReqNote) {
            mReqNote.hidden = !(ru.show && ru.note);
            mReqNote.textContent = ru.note || '';
            mReqNote.style.color = ru.tone === 'warn' ? 'var(--c-warn-text, #8A5A00)' : '';
        }
        if (mBand) {
            const pd = S.pendingDay && S.pendingDay.key === S.key ? S.pendingDay : null;
            mBand.hidden = !pd;
            if (pd) mBandTxt.textContent = `새 추천이 도착했습니다(${fmtHM(pd.data && pd.data.at) || '방금'}) — 처리함/안 함 표시는 그대로 남습니다`;
        }
        const cnt = tabCounts(loaded ? S.day.parsed : null);                 // 이월 빼고(카드·띠 건수와 같은 기준)
        const cry = tabCarried(loaded ? S.day.parsed : null);
        const tabsHtml = TABS.map(t => `<button type="button" class="seg-tab${t === tab ? ' active' : ''}" data-locrec-tab="${t}">${TAB_LABEL[t]} ${cnt[t]}${cry[t] ? ` (+이월 ${cry[t]})` : ''}</button>`).join('');
        if (lastTabsHtml !== tabsHtml) { lastTabsHtml = tabsHtml; mTabs.innerHTML = tabsHtml; }
        const all = store.visibleRows(tab);
        const hiddenN = all.filter(x => x.st.hidden).length;
        const rows = all.filter(x => showSkipped || !x.st.hidden);
        mSkip.checked = showSkipped;
        mSkipWrap.hidden = !(hiddenN || showSkipped);
        mSkipTxt.textContent = `안 함${hiddenN ? ` ${hiddenN}건` : ''}도 보기`;
        mDl.disabled = !rows.length;
        // [전체 처리함] — 처음 보여 주는 날짜에서, 지금 탭에 아직 표시 안 한 추천이 있을 때만
        const bulk = loaded && editable ? bulkDoneKeys(all) : [];
        if (mAll) {
            mAll.hidden = !(loaded && editable);
            mAll.disabled = !bulk.length || !!S.applying;
            mAll.textContent = S.applying ? `반영 중 ${S.applying.i}/${S.applying.n}`
                : bulk.length ? `전체 처리함 (${bulk.length})` : '전체 처리함';
        }
        if (!loaded) {
            mMeta.textContent = '';
            const t = (S.latest && dayMessage(store.entryOf(S.key)))
                || S.dayErr || (S.latestErr ? `추천 상태를 읽지 못했습니다(${S.latestErr})` : '') || '표 불러오는 중…';
            mTbody.innerHTML = `<tr><td colspan="11" class="refill-empty">${escapeHtml(t)}</td></tr>`;
            return;
        }
        mMeta.textContent = tabMeta(tab, all) + (editable ? '' : ' · 지난 날짜는 볼 수만 있습니다');
        if (!rows.length) {
            mTbody.innerHTML = `<tr><td colspan="11" class="refill-empty">${cnt[tab] || cry[tab] ? '모두 안 함으로 숨겼습니다' : `${TAB_LABEL[tab]} 추천이 없습니다`}</td></tr>`;
            return;
        }
        mTbody.innerHTML = rows.map((x, i) => rowHtml(S, x.r, x.st, i, editable)).join('');
    }

    function open() { modal.style.display = 'flex'; render(); }
    function close() {
        const was = isOpen();
        modal.style.display = 'none';
        if (was) store.applyPending();                 // 보던 동안 도착한 새 판은 닫을 때 바로 바꾼다(카드·띠 건수)
        if (was) closeFns.forEach(fn => { try { fn(); } catch (e) { console.warn('[locrec]', e); } });
    }
    /** 창이 닫힐 때 부를 함수(대시보드: 구독 끄기). 돌려준 함수로 해제 */
    function onClose(fn) { closeFns.add(fn); return () => closeFns.delete(fn); }

    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-locrec-close]')) { close(); return; }
        // 상품코드 — 로케이션관리(window.locSearchCode 있음)에서는 창을 닫고 데이터 리스트를 그 코드로 검색,
        //   대시보드(index)에서는 링크 그대로 location.html?q=코드 로 이동
        const c = ev.target.closest('a[data-locrec-code]');
        if (c) {
            if (typeof window.locSearchCode === 'function' && !(ev.ctrlKey || ev.metaKey || ev.shiftKey)) {
                ev.preventDefault(); close(); window.locSearchCode(c.getAttribute('data-locrec-code'));
            }
            return;
        }
        const t = ev.target.closest('[data-locrec-tab]');
        if (t) { tab = TABS.includes(t.getAttribute('data-locrec-tab')) ? t.getAttribute('data-locrec-tab') : 'single'; render(); return; }
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        const key = b.getAttribute('data-locrec-key');
        if (act === 'download') store.downloadTab(tab, showSkipped);
        else if (act === 'applyNew') store.applyPending();
        else if (act === 'doneAll') {
            const keys = bulkDoneKeys(store.visibleRows(tab));
            if (keys.length && confirm(`${TAB_LABEL[tab]} 탭의 추천 ${keys.length}건을 모두 '처리함'으로 표시할까요?
데이터 리스트도 바뀝니다 — 상품을 추천한 자리로 옮깁니다(한 건씩 차례로).
(오늘 안에는 줄마다 [되돌리기]로 자리까지 되돌릴 수 있습니다)`)) store.markMany(keys, 'done');
        }
        else if (act === 'done') {
            const r = store.get().day && TABS.flatMap(t => (store.get().day.parsed[t] || [])).find(x => x.recKey === key);
            const what = r ? rowLines(r).map(l => `${l.code} ${l.from}→${l.to}`).join(', ') : '';
            if (confirm(`'처리함'으로 표시하고 데이터 리스트도 추천대로 바꿉니다.${what ? `
${what}` : ''}
(오늘 안에는 [되돌리기]로 되돌릴 수 있습니다)

계속할까요?`)) store.mark(key, 'done');
        }
        else if (act === 'skip') store.mark(key, 'skip');
        else if (act === 'undo') {
            // 반영 기록이 있으면 데이터 리스트 자리도 되돌린다 — [처리함]과 같은 모양으로 묻는다(표시만이면 묻지 않음)
            const mk = store.get().marks[key];
            if (!(mk && mk.applied) || confirm(undoConfirmText(mk.applied))) store.mark(key, null);
        }
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
    store.setHold(isOpen);                             // 열려 있는 동안 새 판은 띠로만 알린다
    mounted = { open, close, isOpen, render, onClose, el: modal };
    return mounted;
}
