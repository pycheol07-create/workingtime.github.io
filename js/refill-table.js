// === js/refill-table.js ===
// 채우기 지시서 표 창(#refill-modal) — 탭(채우기/확인필요) · 안 한 것만 보기 · 행별 완료 체크 · 전체 완료 · ESC · 바깥 클릭 닫기.
// 데이터는 js/refill-store.js 가 갖고, 이 파일은 그리기와 입력만 한다(로케이션 띠 js/refill-card.js · 대시보드 js/refill-dash.js 가 같이 쓴다).
// DOM: 페이지에 #refill-modal 이 이미 있으면(location.html) 그것을 쓰고, 없으면(index.html) 같은 마크업을 JS 로 만든다.
//   스타일은 location.html <style> · index 는 css/refill-modal.css(#refill-modal 범위로 같은 모양).
// ⚠️ role="dialog" · data-act 를 붙이지 않는다 — 업무마감봇이 div[role=dialog] 마지막 것 · [data-act] 로 자기 확인창을 읽는다.
// 오버레이 자식 1개 · 첫 자식 .modal-header 라 공통 끌기(js/modal-drag.js)가 붙는다.
import { escapeHtml } from './utils.js?v=202610301140';
import { dayLabel, fmtHM, progress, fmtCount, fixedNote } from './lib/refill-view.js?v=202610301140';
import { NO_NAME, SHEETS, todayKey } from './refill-store.js?v=202610301140';
import { higherOpenThan } from './modal-above.js?v=202610301140';

const TEMPLATE = `
        <div class="modal-content refill-modal-content">
            <div class="modal-header" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
                <span id="refill-modal-title">채우기 지시서</span>
                <button type="button" class="modal-x" data-refill-close aria-label="닫기">×</button>
            </div>
            <div class="refill-modal-tools">
                <div class="seg-tabs" id="refill-tabs" style="margin-bottom:0;">
                    <button type="button" class="seg-tab active" data-refill-tab="rows">채우기(현장용)</button>
                    <button type="button" class="seg-tab" data-refill-tab="checks">확인필요</button>
                </div>
                <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                    <label class="refill-sub" style="cursor:pointer; user-select:none;"><input type="checkbox" id="refill-only-todo" style="vertical-align:middle;"> <span style="vertical-align:middle;">안 한 것만 보기</span></label>
                    <button type="button" class="btn btn-secondary btn-sm" id="refill-all-btn" hidden>전체 완료</button>
                </div>
            </div>
            <div id="refill-modal-meta" class="modal-meta" style="margin-bottom:8px;"></div>
            <div class="table-box refill-table-wrap">
                <table class="usage-table refill-table">
                    <thead><tr><th>완료</th><th>피킹로케이션</th><th>비축위치</th><th>채울수량</th><th>비축재고</th><th>누가·언제</th></tr></thead>
                    <tbody id="refill-tbody"></tbody>
                </table>
            </div>
        </div>`;

let mounted = null;

/** 표 창을 붙인다(한 탭에 한 번). → { open(), close(), isOpen(), render(), el } */
export function mountRefillTable({ store }) {
    if (mounted) return mounted;
    let modal = document.getElementById('refill-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'refill-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = TEMPLATE;
        document.body.appendChild(modal);
    }
    const q = (id) => document.getElementById(id);
    const mTitle = q('refill-modal-title'), mMeta = q('refill-modal-meta'), mTbody = q('refill-tbody');
    const mTodo = q('refill-only-todo'), mAll = q('refill-all-btn'), mTabs = q('refill-tabs');
    let tab = 'rows';

    const isOpen = () => modal.style.display === 'flex';
    /** 이 창보다 z 가 큰, 화면을 덮는 고정 창이 보이는가 — js/modal-above.js(변경 추천 표 창과 같이 씀) */
    const higherOpen = () => higherOpenThan(modal);

    function render() {
        if (!isOpen()) return;
        const S = store.get();
        if (!S.signedIn) { close(); return; }      // 로그아웃·구독 중지 때 닫는다
        const d = store.currentDay();
        const editable = S.key === todayKey();
        mTitle.textContent = `채우기 지시서 ${dayLabel(S.key)}`;
        mTabs.querySelectorAll('[data-refill-tab]').forEach(b => b.classList.toggle('active', b.getAttribute('data-refill-tab') === tab));
        const list = d ? d.parsed[tab] : [];
        const pr = progress(list, S.work.checks);
        mMeta.textContent = `${SHEETS[tab]} ${list.length}행 · 완료 ${pr.done}/${pr.total}`
            + (editable ? '' : ' · 지난 날짜는 볼 수만 있습니다');
        // [전체 완료] / 모두 완료면 [전체 해제] — 오늘 지시서·보고 있는 시트만
        const allDone = pr.total > 0 && pr.done >= pr.total;
        mAll.hidden = !(editable && list.length);
        mAll.textContent = allDone ? '전체 해제' : '전체 완료';
        mAll.disabled = S.saving.has('*all');
        const todoOnly = mTodo.checked;
        const rows = list.filter(r => !(todoOnly && S.work.checks[r.code] && S.work.checks[r.code].done === true));
        if (!rows.length) {
            const empty = !d ? (S.dayErr || '지시서를 불러오는 중…') : list.length ? '안 한 것이 없습니다' : '행이 없습니다';
            mTbody.innerHTML = `<tr><td colspan="6" class="refill-empty">${escapeHtml(empty)}</td></tr>`;
            return;
        }
        mTbody.innerHTML = rows.map(r => {
            const c = S.work.checks[r.code] || {};
            const done = c.done === true;
            const who = done ? `${escapeHtml(c.by || NO_NAME)} ${escapeHtml(fmtHM(c.at))}` : '';
            const busy = S.saving.has(r.code);
            // 다시 만든 판: 새로 들어온 줄 배지 · 오늘 완료라 고정한 줄 안내(체크 동작은 그대로)
            const added = r.added ? ` <span class="badge badge-accent" title="다시 만든 판(${escapeHtml(r.added)})에 새로 들어온 줄">새로 ${escapeHtml(r.added)}</span>` : '';
            const note = fixedNote(r, done);
            const fixed = note ? `<div class="refill-sub" style="font-size:11px;">${escapeHtml(note)}</div>` : '';
            return `<tr class="${done ? 'refill-done' : ''}">`
                + `<td class="refill-chk"><input type="checkbox" data-refill-code="${escapeHtml(r.code)}" aria-label="완료 ${escapeHtml(r.loc)}"`
                + `${done ? ' checked' : ''}${editable && !busy ? '' : ' disabled'}></td>`
                + `<td class="refill-loc">${escapeHtml(r.loc)}${added}${fixed}</td><td>${escapeHtml(r.reserve)}</td>`
                + `<td class="refill-num">${r.qty == null ? '' : fmtCount(r.qty)}</td><td class="refill-num">${r.stock == null ? '' : fmtCount(r.stock)}</td>`
                + `<td class="refill-who">${who}</td></tr>`;
        }).join('');
    }

    function open() { modal.style.display = 'flex'; render(); }
    function close() { modal.style.display = 'none'; }

    mTabs.addEventListener('click', (ev) => {
        const b = ev.target.closest('[data-refill-tab]');
        if (!b) return;
        tab = b.getAttribute('data-refill-tab') === 'checks' ? 'checks' : 'rows';
        render();
    });
    mTodo.addEventListener('change', render);
    mAll.addEventListener('click', () => store.toggleAll(tab));
    mTbody.addEventListener('change', (ev) => {
        const t = ev.target;
        if (!t || !t.matches('input[type=checkbox][data-refill-code]')) return;
        store.toggleCheck(t.getAttribute('data-refill-code'), t.checked);
    });
    modal.addEventListener('click', (ev) => {
        if (ev.target === modal || ev.target.closest('[data-refill-close]')) close();
    });
    // ESC — 공통 js/modal-esc.js 는 .fixed.inset-0 오버레이만 닫아서 이 창(.modal-overlay)은 여기서 닫는다(열려 있을 때만).
    //   캡처 단계에서 받아 멈춘다 — 대시보드에서 밑에 깔린 다른 창까지 같은 ESC 로 닫히지 않게.
    //   단 이 창보다 위(z 가 큰) 창이 보이면 손대지 않는다 — 그 창의 ESC 처리(modal-esc.js 등)에 맡긴다(연장근무 확인창 등).
    window.addEventListener('keydown', (ev) => {
        if (!(ev.key === 'Escape' || ev.key === 'Esc') || !isOpen() || higherOpen()) return;
        ev.preventDefault(); ev.stopPropagation(); close();
    }, true);

    store.on(render);
    mounted = { open, close, isOpen, render, el: modal };
    return mounted;
}
