// === js/locrec-table.js ===
// 로케이션 변경 추천 표 창(#locrec-modal) — 탭[단독|맞바꾸기|페어|뒤로 보내기(행이 있거나 서버가 켰을 때만)] 표 · 행마다 [처리함]/[안 함]/되돌리기(처음 보여 주는 날짜만,
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
//   새 판을 기다리는 동안([새로 보기] 전)은 [처리함]·[안 함]·[전체 처리함]을 잠근다([되돌리기]는 그대로).
//   같은 상품을 오늘 다른 추천으로 옮긴 줄(st.other)은 '○○(으)로 처리 · 이름 HH:MM' + 그 추천의 [되돌리기].
// 데이터 리스트 반영(2026-10-29): [처리함]·[전체 처리함]은 데이터 리스트(Locations) 상품 칸도 추천대로 옮긴다(js/locrec-store.js).
//   반영된 표시는 '처리함 · 이름 HH:MM · 표에 반영'. [전체 처리함] 진행 중에는 버튼이 '반영 중 n/N'.
// 칸수 무관 허용(2026-11-13): 상품 줄마다 [칸수 무관 허용]/[끄기](지금 자리에 칸수가 있는 줄·이미 허용한 상품) — store.setSizeFree.
//   허용한 상품은 줄에 '칸수 무관' 배지. 도구 줄 '칸수 무관 N건 보기'를 켜면 허용 목록 전체(오늘 표에 없는 상품 포함)가 표 끝에 나와 끌 수 있다.
//   날짜·새 판 대기와 상관없이 누를 수 있다(추천 표시가 아니라 다음 계산 설정이라서).
import { escapeHtml } from './utils.js?v=202611131345';
import { fmtHM, tabCounts, tabCarried, TABS, TAB_LABEL, fmtNum, canMark, tabMeta, dayLabel, rowLines, dayMessage, fmtGain, ROUTE_OUT_LABEL, ROUTE_OUT_HELP, locLabel, bulkDoneKeys, CARRIED_LABEL, qtyCellOf, PENDING_TEXT,
    shownTabs, BACK_TAB_HELP, BACK_GAIN_LABEL, BACK_SCORE_HELP, backReasonTitle, BLOCKED_LABEL, SKIP_HELP, holdRows, HOLD_ROW_LABEL, HOLD_UNDO_TEXT,
    SIZE_FREE_LABEL, SIZE_FREE_HELP, sizeFreeShown, fmtMDHM } from './lib/locrec-view.js?v=202611131345';
import { NO_NAME, todayKey } from './locrec-store.js?v=202611131345';
import { higherOpenThan } from './modal-above.js?v=202611131345';
import { undoConfirmText } from './lib/locrec-apply.js?v=202611131345';
import { SORT_COLS, sortRows, nextSort, isLowStockRow, lineTotal } from './lib/locrec-sort.js?v=202611131345';

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
                    <thead><tr><th>순위</th><th title="누르면 데이터 리스트에서 그 상품 보기 — 맞바꾸기·페어는 두 줄(A/B)">상품코드</th><th>상품명</th><th>옵션</th><th>현재 로케이션</th><th>추천 로케이션</th><th title="옮길 수량(괄호는 비축 수량)">이동수량</th><th title="하루 평균 출고(개/일)">일출고</th><th title="하루에 덜 걷는 양(동·개/일)">이득</th><th title="이 줄만 처리하면 동선 점수(0~100)가 오르는 만큼">점수</th><th>상태</th><th>표시</th></tr></thead>
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
    const ALL_TITLE = mAll ? mAll.title : '';            // [전체 처리함] 원래 툴팁(새 판 대기 중에는 PENDING_TEXT)
    let tab = 'single', showSkipped = false, lastTabsHtml = '';
    // 머리줄 정렬(2026-11-05) — { key, dir:'asc'|'desc' } · null 이면 원래(순위) 순서. 이동수량은 비축 포함 여부를 따로 고른다
    let sort = null, qtyWithReserve = false;
    // 비축 포함 총 재고가 적은 추천 빼기(2026-11-05) — 이 PC 에 기억(localStorage, 실패해도 기본값)
    const LOW_KEY = 'locrecLowStock';
    let lowOn = false, lowLimit = 10;
    try { const v = JSON.parse(localStorage.getItem(LOW_KEY) || 'null'); if (v) { lowOn = !!v.on; if (Number.isFinite(Number(v.n))) lowLimit = Math.max(0, Math.round(Number(v.n))); } } catch (e) { /* 기본값 */ }
    const saveLow = () => { try { localStorage.setItem(LOW_KEY, JSON.stringify({ on: lowOn, n: lowLimit })); } catch (e) { /* 무시 */ } };
    const keepRow = (r) => !(lowOn && isLowStockRow(r, lowLimit, rowLines));
    // 도구 줄에 체크 + 개수 칸(두 페이지 마크업이 같으므로 JS 로 붙인다)
    let mLowCnt = null;
    (() => {
        const anchor = q('locrec-skip-wrap');
        if (!anchor || q('locrec-low-wrap')) return;
        const wrap = document.createElement('label');
        wrap.className = 'refill-sub locrec-skipchk';
        wrap.id = 'locrec-low-wrap';
        wrap.title = '이동수량 + 비축 수량(총 재고)이 이 개수 이하인 추천을 표에서 뺍니다. 맞바꾸기·페어는 두 상품이 모두 이하일 때만 뺍니다. 엑셀 받기에도 같이 적용됩니다.';
        wrap.innerHTML = `<input type="checkbox" id="locrec-low-on"> <span style="vertical-align:middle;">비축 포함 총 재고</span> `
            + `<input type="number" id="locrec-low-n" min="0" max="999" step="1" style="width:52px; padding:1px 4px; vertical-align:middle;"> `
            + `<span style="vertical-align:middle;">개 이하 빼기</span> <span id="locrec-low-cnt" class="locrec-opt"></span>`;
        anchor.parentNode.insertBefore(wrap, anchor);
        const on = q('locrec-low-on'), num = q('locrec-low-n');
        on.checked = lowOn; num.value = String(lowLimit);
        on.addEventListener('change', () => { lowOn = on.checked; saveLow(); render(); });
        num.addEventListener('change', () => {
            const v = Math.round(Number(num.value));
            lowLimit = Number.isFinite(v) && v >= 0 ? Math.min(999, v) : 10;
            num.value = String(lowLimit); saveLow(); render();
        });
        mLowCnt = q('locrec-low-cnt');
    })();
    // 칸수 무관 허용 목록 보기(2026-11-13) — '안 함도 보기' 뒤에 붙인다
    let showSf = false, mSfWrap = null, mSfTxt = null;
    (() => {
        const anchor = q('locrec-skip-wrap');
        if (!anchor || q('locrec-sf-wrap')) return;
        const wrap = document.createElement('label');
        wrap.className = 'refill-sub locrec-skipchk';
        wrap.id = 'locrec-sf-wrap';
        wrap.hidden = true;
        wrap.title = '칸수가 다른 자리로도 추천하도록 허용한 상품 전체(오늘 표에 없는 상품 포함)를 표 끝에 보여 줍니다 — 거기서 끌 수 있습니다';
        wrap.innerHTML = `<input type="checkbox" id="locrec-sf-show"> <span id="locrec-sf-txt" style="vertical-align:middle;"></span>`;
        anchor.parentNode.insertBefore(wrap, anchor.nextSibling);
        const chk = q('locrec-sf-show');
        chk.addEventListener('change', () => { showSf = chk.checked; render(); });
        mSfWrap = wrap; mSfTxt = q('locrec-sf-txt');
    })();
    const thead = modal.querySelector('.locrec-table thead');
    const headHtml = () => SORT_COLS.map(c => {
        const on = sort && sort.key === c.key;
        const arrow = on ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
        // 정렬 기준은 버튼 둘 — 켜진 쪽이 지금 기준(예전 한 버튼은 '+비축'이 '누르면 더함'으로 읽혀 헷갈렸다)
        const qtyMode = c.key === 'qty'
            ? ` <span class="locrec-qtymodes" title="이동수량으로 정렬할 때 기준">`
              + `<button type="button" class="locrec-qtymode${qtyWithReserve ? '' : ' on'}" data-locrec-qtymode="pick" aria-pressed="${escapeHtml(!qtyWithReserve)}" title="피킹으로 옮길 수량으로 정렬">피킹</button>`
              + `<button type="button" class="locrec-qtymode${qtyWithReserve ? ' on' : ''}" data-locrec-qtymode="total" aria-pressed="${escapeHtml(qtyWithReserve)}" title="비축까지 더한 합계로 정렬">합계</button></span>` : '';
        if (!c.sortable) return `<th class="lc-${escapeHtml(c.key)}"${c.title ? ` title="${escapeHtml(c.title)}"` : ''}>${escapeHtml(c.label)}</th>`;
        return `<th class="lc-${escapeHtml(c.key)} locrec-sortable${on ? ' on' : ''}" data-locrec-sort="${escapeHtml(c.key)}"${c.title ? ` title="${escapeHtml(c.title + ' — 누르면 정렬')}"` : ' title="누르면 정렬"'}>${escapeHtml(c.label)}${escapeHtml(arrow)}${qtyMode}</th>`;
    }).join('');
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
            + (qtyWithReserve && c.reserve && lineTotal(l) != null ? `<div class="locrec-opt" style="font-weight:600;">합계 ${escapeHtml(lineTotal(l).toLocaleString('ko-KR'))}개</div>` : '')
            + (c.hint ? `<div class="locrec-who" style="font-weight:400; white-space:normal;">${escapeHtml(c.hint)}</div>` : '') + '</td>';
    };
    // 상품명·옵션은 칸을 나눈다(2026-11-05 사용자 요청)
    const nameCell = (name) => escapeHtml(name || '');
    // 칸수 무관 허용 — 상품코드 칸 아래 배지 + 토글(지금 자리에 칸수가 있는 줄·이미 허용한 상품만). 칸수는 행 값 → 없으면 sizeOfLoc 보충
    // 칸수무관 칸 — 켜짐/꺼짐 토글 하나(2026-11-13 사용자 요청: 배지·글자 버튼 대신)
    const sfToggle = (code, on, busy) => `<button type="button" class="locrec-sf-toggle${on ? ' on' : ''}" role="switch" aria-checked="${on ? 'true' : 'false'}"`
        + ` data-locrec-act="sizeFree" data-locrec-sf="${escapeHtml(code)}" data-locrec-sf-on="${on ? '0' : '1'}"${busy ? ' disabled' : ''}`
        + ` aria-label="${escapeHtml(`${code} 칸수 무관 허용`)}" title="${escapeHtml(on ? '켜짐 — 칸수가 다른 자리로도 추천합니다. 누르면 끕니다' : SIZE_FREE_HELP)}"><span></span></button>`;
    const sizeFreeCell = (S, l, allowed) => {
        const code = String(l.code == null ? '' : l.code).trim();
        let size = l.fromSize;
        if (!size && l.from && sizeOfLoc) { try { size = sizeOfLoc(l.from) || ''; } catch (e) { size = ''; } }
        if (!sizeFreeShown(code, size, allowed)) return '';
        return sfToggle(code, allowed.has(code), S.saving.has(store.sizeFreeBusyKey(code)));
    };

    function rowHtml(S, r, st, i, editable, pending, i0 = i, allowed = new Set()) {
        const busy = S.saving.has(r.recKey) || !!S.applying || !editable;   // 지난 날짜는 볼 수만 · 전체 반영 중에는 잠금
        const busyMark = busy || pending;                                   // 새 판 대기 중 — [처리함]/[안 함]만 잠금(되돌리기는 된다)
        const k = escapeHtml(r.recKey);
        const mk = st.mark;
        const ot = st.other || null;                                         // 같은 상품을 오늘 다른 추천으로 옮김
        // 누가·언제·자리 겹침 사유는 상태 표시에 마우스를 올릴 때만(title) — 칸 안 설명 줄은 뺐다(2026-11-03 사용자 요청)
        const altTo = mk && mk.state === 'done' && mk.alt && mk.alt.to ? String(mk.alt.to) : '';   // 대신 자리로 처리함(2026-11-12)
        const blk = mk && mk.state === 'blocked' ? (mk.block || {}) : null;                          // 자리 막힘(그날 숨김 — 안 함도 보기에서만 보인다)
        const whoText = blk ? `${BLOCKED_LABEL} · ${mk.by || NO_NAME} ${fmtHM(mk.at)}${blk.loc ? ` · ${blk.loc} 를 쓸 수 없음` : ''} · 데이터 리스트는 그대로`
            : mk ? `${mk.state === 'skip' ? '안 함' : '처리함'} · ${mk.by || NO_NAME} ${fmtHM(mk.at)}${mk.state === 'done' && mk.applied ? ' · 표에 반영' : ''}${altTo ? ` · 대신 ${altTo}` : ''}`
            : ot ? `처리함 · ${ot.by || NO_NAME} ${fmtHM(ot.at)} · 표에 반영` : '';
        // 다른 추천으로 이미 옮긴 줄은 이 판의 추천 자리 대신 실제로 옮긴 자리(현재→처리한 자리)를 보여 준다 — 추천과 처리가 달라 헷갈리지 않게(2026-11-03)
        const stLabel = ot && !mk ? '변경완료' : st.label;
        const carried = r.carried === true;                                   // 이월 행 — 지금 기준 추천에서 빠짐
        const otBusy = S.saving.has(ot && ot.recKey) || !!S.applying || !editable;
        const tk = st.taken || null;                                         // 옮길 자리에 오늘 다른 상품을 넣음 — 처리 불가
        // 자리 겹침 — [처리함]은 남긴다(최종 판정은 저장 트랜잭션이 지금 자리 상태로 한다: 엑셀로 자리가 다시 비었으면 통과)
        const stTitle = tk && !mk ? `${tk.dst} 에 오늘 ${tk.code} 를 넣었습니다 — 머리줄 [지금 재고로 다시 만들기]를 누르면 새 자리로 추천합니다`
            : carried ? CARRIED_LABEL : whoText;
        const btns = ot && !mk
            ? `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="undo" data-locrec-key="${escapeHtml(ot.recKey)}"${otBusy ? ' disabled' : ''} title="오늘 ${escapeHtml(ot.code)} 를 옮긴 추천을 되돌립니다">되돌리기</button>`
            : (st.label === '처리됨' || carried) && !mk ? ''         // 서버가 위치 변화를 확인한 행·이월 행 — 누를 것이 없다
            : mk
            ? `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="undo" data-locrec-key="${k}"${busy ? ' disabled' : ''}>되돌리기</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" data-locrec-act="done" data-locrec-key="${k}"${busyMark ? ' disabled' : ''} title="${pending ? escapeHtml(PENDING_TEXT) : '처리함으로 표시하고 데이터 리스트 자리도 추천대로 옮깁니다'}">처리함</button>`
              + `<button type="button" class="btn btn-ghost btn-sm" data-locrec-act="skip" data-locrec-key="${k}"${busyMark ? ' disabled' : ''} title="${escapeHtml(pending ? PENDING_TEXT : SKIP_HELP)}">안 함</button>`;
        const isBack = r.type === 'back';                                     // 뒤로 보내기 — 이득·점수 대신 '앞자리 확보'
        const badges = (isBack ? `<span class="badge badge-accent locrec-badge" title="${escapeHtml(backReasonTitle(r))}">사유: ${escapeHtml(BACK_GAIN_LABEL)}</span>` : '')
            + (r.capWarn ? '<span class="badge badge-warn locrec-badge" title="옮길 자리 적재량보다 수량이 많습니다">적재량 확인</span>' : '')
            + (r.pairNear ? `<span class="badge badge-accent locrec-badge" title="함께 잘 팔리는 상품이 옮길 자리와 같은 동에 있습니다">페어 ${escapeHtml(r.pairNear)}</span>` : '')
            // 다시 만든 판에 처음 들어온 행 — 상태 '새로'(오늘 처음 나온 추천)와 헷갈리지 않게 '추가'
            + (r.addedAt ? `<span class="badge badge-accent locrec-badge" title="다시 만든 판(${escapeHtml(r.addedAt)})에 새로 들어온 추천">추가 ${escapeHtml(r.addedAt)}</span>` : '');
        // 맞바꾸기·페어는 줄(A/B)마다 <tr> — 상품·현재·추천·이동수량·일출고 칸끼리 짝이 맞게. 순위·이득·상태·표시는 rowspan 으로 하나만.
        // 줄무늬는 추천 단위(.locrec-alt) — usage-table 의 tr:nth-child(even) 는 줄 단위라 locrec-table 에서 끈다(location.html · css/locrec-modal.css).
        const lines = rowLines(r);
        const span = lines.length > 1 ? ` rowspan="${lines.length}"` : '';
        const trCls = `locrec-row tone-${ot && !mk ? 'ok' : st.tone}${st.label === '안 함' || st.blocked ? ' locrec-skipped' : ''}${i % 2 ? ' locrec-alt' : ''}${carried ? ' locrec-carried' : ''}`;
        const trAttr = carried ? ' style="opacity:.55" title="지금 기준 추천에서 빠진 행 — 오늘 손댄 것이라 남겨 둠"' : '';
        return lines.map((l, j) => {
            const sfTd = `<td class="locrec-sfcol">${sizeFreeCell(S, l, allowed)}</td>`;   // 맨 끝 칸(2026-11-13) — 줄(A/B)마다 그 상품
            const last = j === lines.length - 1;
            // 상품코드 칸(누르면 데이터 리스트에서 그 상품 검색) · 상품 칸(상품명(옵션) + 배지)
            const moved = ot && !mk && l.code === ot.code;
            const fromTxt = moved ? locCell(ot.src || l.from, ot.src === l.from ? l.fromSize : '') : locCell(l.from, l.fromSize);
            const altHere = altTo && j === 0;                                 // 대신 자리는 단독(첫 줄)만
            const toTxt = moved ? locCell(ot.dst, '') : altHere ? locCell(altTo, '') : locCell(l.to, l.toSize);
            const toTitle = moved && ot.dst !== l.to ? ` title="${escapeHtml(`처리한 자리 — 나중에 다시 만든 추천은 ${l.to}`)}"`
                : altHere ? ` title="${escapeHtml(`대신 자리로 처리함 — 추천 자리 ${l.to} 를 쓸 수 없었음`)}"` : '';
            const cells = `<td class="locrec-pcode"><a class="locrec-code" href="location.html?q=${escapeHtml(encodeURIComponent(l.code || ''))}#tab=list" data-locrec-code="${escapeHtml(l.code)}" title="데이터 리스트에서 이 상품 보기">${escapeHtml(l.code)}</a></td>`
                + `<td class="locrec-prod">${nameCell(l.name)}`
                + (last && badges ? `<div class="locrec-badges">${badges}</div>` : '') + '</td>'
                + `<td class="locrec-optcell">${escapeHtml(l.option || '')}</td>`
                + `<td class="locrec-loc locrec-from">${escapeHtml(fromTxt)}</td>`
                + `<td class="locrec-loc"${toTitle}><b class="locrec-to">${escapeHtml(toTxt)}</b></td>`
                + qtyCell(l)
                + `<td class="locrec-num locrec-daily">${escapeHtml(l.daily == null ? '' : fmtNum(l.daily))}</td>`;
            if (j > 0) return `<tr class="${trCls} locrec-sub"${trAttr}>${cells}${sfTd}</tr>`;
            return `<tr class="${trCls}"${trAttr}>`
                + `<td class="locrec-rank"${span}>${escapeHtml(carried ? '' : (r.rank == null ? i0 + 1 : r.rank))}</td>`     // 이월 행은 순위 없음 · 정렬해도 원래 순위
                + cells
                + (isBack
                    ? `<td class="locrec-gain"${span} title="${escapeHtml(backReasonTitle(r))}">${escapeHtml(BACK_GAIN_LABEL)}</td>`
                      + `<td class="locrec-score-gain"${span} title="${escapeHtml(BACK_SCORE_HELP)}">—</td>`
                    : `<td class="locrec-gain"${span}>${escapeHtml(fmtNum(r.gain))}</td>`
                      + `<td class="locrec-score-gain"${span} title="${scoreTitle(r)}">${escapeHtml(r.routeOut ? ROUTE_OUT_LABEL : fmtGain(r.scoreGain))}</td>`)
                + `<td class="locrec-state"${span}><span class="locrec-st st-${ot && !mk ? 'ok' : st.tone}"${stTitle ? ` title="${escapeHtml(stTitle)}"` : ''}>${escapeHtml(stLabel)}</span></td>`
                + `<td class="locrec-acts"${span}>${btns}</td>${sfTd}</tr>`;
        }).join('');
    }

    /** '안 함'으로 붙잡혀 결과 행에서 빠진 추천 한 줄(holdRows) — 상품코드·자리·기한 + [되돌리기](marks 의 skip 지우기, 날짜와 상관없이) */
    function holdHtml(S, h) {
        const busy = S.saving.has(h.recKey) || !!S.applying;
        const codes = [h.code, h.code2].filter(Boolean).join(' / ');
        const froms = [h.from, h.from2].filter(Boolean).join(' / ');
        const until = h.until ? `${h.until.slice(4, 6)}/${h.until.slice(6, 8)}까지` : '30일 동안';
        return `<tr class="locrec-row tone-muted locrec-skipped locrec-hold">`
            + '<td class="locrec-rank"></td>'
            + `<td class="locrec-pcode">${escapeHtml(codes)}</td>`
            + `<td class="locrec-prod" colspan="2">${escapeHtml('안 함으로 붙잡아 이번 판 추천에서 빠짐')}</td>`
            + `<td class="locrec-loc locrec-from">${escapeHtml(froms)}</td>`
            + `<td colspan="5" class="locrec-opt">${escapeHtml(`${until} 이 자리에서 옮기라고 하지 않음`)}</td>`
            + `<td class="locrec-state"><span class="locrec-st st-muted" title="${escapeHtml(SKIP_HELP)}">${escapeHtml(HOLD_ROW_LABEL)}</span></td>`
            + `<td class="locrec-acts"><button type="button" class="btn btn-ghost btn-sm" data-locrec-act="unhold" data-locrec-key="${escapeHtml(h.recKey)}"${busy ? ' disabled' : ''}`
            + ` title="${escapeHtml(HOLD_UNDO_TEXT)}">되돌리기</button></td><td class="locrec-sfcol"></td></tr>`;
    }

    /** 칸수 무관 허용 목록(표 끝, '칸수 무관 N건 보기') — 머리 한 줄 + 상품마다 한 줄 [끄기]. inDay = 오늘 판에 그 상품 줄이 있나 */
    function sizeFreeHtml(S, list, inDay) {
        if (!list.length) return '';
        const head = `<tr class="locrec-row tone-muted locrec-sf-head"><td colspan="13" class="locrec-opt" style="font-weight:600;">`
            + `${escapeHtml(`${SIZE_FREE_LABEL} 허용 ${list.length}건 — 칸수가 다른 자리로도 추천합니다(끌 때까지 유지)`)}</td></tr>`;
        return head + list.map(x => {
            const busy = S.saving.has(store.sizeFreeBusyKey(x.code));
            const who = [x.by || NO_NAME, fmtMDHM(x.at)].filter(Boolean).join(' ');
            return `<tr class="locrec-row tone-muted locrec-sf-row">`
                + '<td class="locrec-rank"></td>'
                + `<td class="locrec-pcode">${escapeHtml(x.code)}</td>`
                + `<td class="locrec-prod" colspan="2">${escapeHtml(inDay.has(x.code) ? '오늘 추천 표에 있음' : '오늘 추천 표에 없음')}</td>`
                + `<td colspan="6" class="locrec-opt">${escapeHtml(`${who} 허용`)}</td>`
                + `<td class="locrec-state"><span class="locrec-st st-muted" title="${escapeHtml(SIZE_FREE_HELP)}">${escapeHtml(SIZE_FREE_LABEL)}</span></td>`
                + `<td class="locrec-acts"></td><td class="locrec-sfcol">${sfToggle(x.code, true, busy)}</td></tr>`;
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
        // 새 판이 기다리는 중이면 [새로 보기] 전에는 처리 표시를 막는다(옛 판으로 자리를 옮기지 않게)
        const pd = S.pendingDay && S.pendingDay.key === S.key ? S.pendingDay : null;
        if (mBand) {
            mBand.hidden = !pd;
            if (pd) mBandTxt.textContent = `새 추천이 도착했습니다(${fmtHM(pd.data && pd.data.at) || '방금'}) — [새로 보기] 후 처리해 주세요`;
        }
        const cnt = tabCounts(loaded ? S.day.parsed : null);                 // 이월 빼고(카드·띠 건수와 같은 기준)
        const cry = tabCarried(loaded ? S.day.parsed : null);
        // 뒤로 보내기 탭은 그날 행이 있거나 서버가 켰을 때만(옛 문서·꺼진 서버면 탭 없음) — 보던 탭이 사라지면 단독으로
        const tabs = shownTabs(S.latest, loaded ? S.day.parsed : null);
        if (!tabs.includes(tab)) tab = 'single';
        const tabsHtml = tabs.map(t => `<button type="button" class="seg-tab${t === tab ? ' active' : ''}" data-locrec-tab="${escapeHtml(t)}">${escapeHtml(TAB_LABEL[t])} ${escapeHtml(cnt[t])}${escapeHtml(cry[t] ? ` (+이월 ${cry[t]})` : '')}</button>`).join('');
        if (lastTabsHtml !== tabsHtml) { lastTabsHtml = tabsHtml; mTabs.innerHTML = tabsHtml; }
        const all = store.visibleRows(tab);
        // '안 함'으로 붙잡혀 이 판 결과 행에서 빠진 추천(서버 색인 holds) — 이 탭 종류이고 표에 이미 있는 줄은 뺀다
        const inTab = new Set(all.map(x => x.r.recKey));
        const holds = holdRows({ latest: S.latest, marks: S.marks, todayKey: today }).filter(h => h.type === tab && !inTab.has(h.recKey));
        const hiddenN = all.filter(x => x.st.hidden).length + holds.length;
        const blockedN = all.filter(x => x.st.hidden && x.st.blocked).length;    // 그중 자리 막힘(오늘 숨김)
        // 원래 순서 번호(순위 칸이 없는 옛 문서용)를 정렬 전에 붙인다
        const shown = all.filter(x => showSkipped || !x.st.hidden);
        const kept = shown.filter(x => keepRow(x.r));
        if (mLowCnt) mLowCnt.textContent = lowOn && shown.length !== kept.length ? `(${shown.length - kept.length}건 뺌)` : '';
        const rows = sortRows(kept.map((x, i) => ({ ...x, i0: shown.indexOf(x) })),
            sort, { qtyWithReserve, lines: rowLines });
        if (thead) thead.innerHTML = `<tr>${headHtml()}</tr>`;
        mSkip.checked = showSkipped;
        mSkipWrap.hidden = !(hiddenN || showSkipped);
        mSkipTxt.textContent = blockedN
            ? `${hiddenN > blockedN ? '안 함·' : ''}${BLOCKED_LABEL} ${hiddenN}건도 보기`
            : `안 함${hiddenN ? ` ${hiddenN}건` : ''}도 보기`;
        mDl.disabled = !rows.length;
        // 칸수 무관 허용 — 목록 보기 체크(허용이 있거나 켜 둔 동안만 보인다)
        const allowed = store.sizeFreeCodes();
        const sfList = store.sizeFreeRows();
        if (mSfWrap) {
            mSfWrap.hidden = !(sfList.length || showSf);
            mSfTxt.textContent = `${SIZE_FREE_LABEL} ${sfList.length}건 보기`;
            q('locrec-sf-show').checked = showSf;
        }
        const inDay = new Set();
        if (loaded) TABS.forEach(t => (S.day.parsed[t] || []).forEach(x => rowLines(x).forEach(l => inDay.add(String(l.code == null ? '' : l.code).trim()))));
        const sfPart = showSf ? sizeFreeHtml(S, sfList, inDay) : '';
        // [전체 처리함] — 처음 보여 주는 날짜에서, 지금 탭에 아직 표시 안 한 추천이 있을 때만
        const bulk = loaded && editable ? bulkDoneKeys(all.filter(x => keepRow(x.r))) : [];   // 빼기로 숨긴 추천은 [전체 처리함]에서도 뺀다
        if (mAll) {
            mAll.hidden = !(loaded && editable);
            mAll.disabled = !bulk.length || !!S.applying || !!pd;
            if (pd) mAll.title = PENDING_TEXT;
            else if (mAll.title === PENDING_TEXT) mAll.title = ALL_TITLE;
            mAll.textContent = S.applying ? `반영 중 ${S.applying.i}/${S.applying.n}`
                : bulk.length ? `전체 처리함 (${bulk.length})` : '전체 처리함';
        }
        if (!loaded) {
            mMeta.textContent = '';
            const t = (S.latest && dayMessage(store.entryOf(S.key)))
                || S.dayErr || (S.latestErr ? `추천 상태를 읽지 못했습니다(${S.latestErr})` : '') || '표 불러오는 중…';
            mTbody.innerHTML = `<tr><td colspan="13" class="refill-empty">${escapeHtml(t)}</td></tr>` + sfPart;
            return;
        }
        mMeta.textContent = tabMeta(tab, all) + (tab === 'back' ? ` · ${BACK_TAB_HELP}` : '') + (editable ? '' : ' · 지난 날짜는 볼 수만 있습니다');
        const holdPart = showSkipped ? holds.map(h => holdHtml(S, h)).join('') : '';
        if (!rows.length && !holdPart) {
            mTbody.innerHTML = `<tr><td colspan="13" class="refill-empty">${escapeHtml(cnt[tab] || cry[tab] || holds.length ? (blockedN ? `모두 안 함·${BLOCKED_LABEL}으로 숨겼습니다` : '모두 안 함으로 숨겼습니다') : `${TAB_LABEL[tab]} 추천이 없습니다`)}</td></tr>` + sfPart;
            return;
        }
        mTbody.innerHTML = rows.map((x, i) => rowHtml(S, x.r, x.st, i, editable, !!pd, x.i0, allowed)).join('') + holdPart + sfPart;
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
        // 머리줄 — [피킹만/+비축] 은 이동수량 정렬 기준만 바꾸고(이동수량으로 정렬 중이 아니면 이동수량 많은 순으로), 칸 이름은 정렬
        const qm = ev.target.closest('[data-locrec-qtymode]');
        if (qm) {
            qtyWithReserve = qm.getAttribute('data-locrec-qtymode') === 'total';
            if (!sort || sort.key !== 'qty') sort = { key: 'qty', dir: 'desc' };
            render(); return;
        }
        const sh = ev.target.closest('[data-locrec-sort]');
        if (sh) { sort = nextSort(sort, sh.getAttribute('data-locrec-sort')); render(); return; }
        const t = ev.target.closest('[data-locrec-tab]');
        if (t) { tab = TABS.includes(t.getAttribute('data-locrec-tab')) ? t.getAttribute('data-locrec-tab') : 'single'; render(); return; }
        const b = ev.target.closest('button[data-locrec-act]');
        if (!b || b.disabled) return;
        const act = b.getAttribute('data-locrec-act');
        const key = b.getAttribute('data-locrec-key');
        if (act === 'download') store.downloadTab(tab, showSkipped, keepRow);
        else if (act === 'applyNew') store.applyPending();
        else if (act === 'doneAll') {
            const keys = bulkDoneKeys(store.visibleRows(tab).filter(x => keepRow(x.r)));
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
        else if (act === 'unhold') store.unhold(key);
        else if (act === 'sizeFree') store.setSizeFree(b.getAttribute('data-locrec-sf'), b.getAttribute('data-locrec-sf-on') === '1');
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
