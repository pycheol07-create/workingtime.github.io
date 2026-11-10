// === js/china-mibal2-bar.js ===
// 부족수량관리(신규, live) 스캐너 연동 줄 — [⚙ 설정] 메뉴 + [줄 편집](2026-11-10 사용자 요청). js/china-mibal2-live.js decorate 끝에서 부른다.
//   · 줄의 진짜 버튼(id 그대로, 하나뿐)은 줄에 두거나 숨긴 보관함(#scan-bar-holder, 같은 줄 안)으로 옮길 뿐 — 거는 코드·비상 스위치 끄기는 그대로 따른다
//   · 메뉴는 진짜 버튼을 누르는 대리 버튼(id 없음, data-for) — 열 때·버튼 상태가 바뀔 때 글자·꺼짐·숨김을 진짜 버튼에서 베낀다
//   · 줄 구성·순서는 그 PC localStorage(js/lib/mibal2-bar.js). 처음은 지금 줄 그대로
import { BAR_KEY, rowFromStorage, serializeRow, toggleRow, moveRow, editList, menuIds } from './lib/mibal2-bar.js?v=202611101731';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shown = (b) => !!b && !b.hidden && b.style.display !== 'none';

/**
 * @param {{ isAdmin: () => boolean, adminOnly?: string[], extraMenu?: string[] }} o
 *   adminOnly = 관리자 전용 버튼 id(관리자가 아니면 줄·메뉴에서 빠짐) · extraMenu = 줄 밖 버튼 중 메뉴에도 넣을 것(예: 머리줄 [스캐너 열기])
 */
export function setupScanBar(o) {
    const bar = document.querySelector('.scan-bar');
    if (!bar) return null;
    const opt = { isAdmin: !!(o.isAdmin && o.isAdmin()), adminOnly: o.adminOnly || [] };
    bar.querySelectorAll('.scan-sep').forEach(s => { s.style.display = 'none'; });   // 순서를 바꾸므로 고정 구분선은 뺀다
    // 고를 수 있는 버튼 = 지금 줄에 보이는 버튼(순서 그대로). 숨겨 둔 것(예: 꺼 둔 스캔잠금)은 넣지 않는다
    const available = [...bar.querySelectorAll('button[id]')].filter(shown).map(b => b.id);
    const note = $('live-batch-note');
    const holder = document.createElement('span');
    holder.id = 'scan-bar-holder'; holder.hidden = true;
    const menuWrap = document.createElement('span');
    menuWrap.className = 'bar-menu';
    menuWrap.innerHTML = '<button type="button" id="btn-scan-menu" class="d-btn d-btn-sm" aria-expanded="false" title="스캐너 연동 버튼 전부 · 줄 편집">⚙ 설정</button>'
        + '<div id="scan-menu" class="bar-menu-panel" hidden></div>';
    bar.insertBefore(menuWrap, note || null);
    bar.appendChild(holder);
    const panel = menuWrap.querySelector('#scan-menu');
    const style = document.createElement('style');
    style.textContent = '.bar-menu { position: relative; }'
        + ' .bar-menu-panel { position: absolute; top: calc(100% + 4px); left: 0; z-index: 40; background: var(--c-surface); border: 1px solid var(--c-line); border-radius: var(--r-inner);'
        + ' box-shadow: var(--sh-pop); padding: 8px; display: flex; flex-direction: column; gap: 4px; min-width: 210px; max-height: 70vh; overflow-y: auto; }'
        + ' .bar-menu-panel[hidden] { display: none; } .bar-menu-panel .d-btn { justify-content: flex-start; text-align: left; width: 100%; }'
        + ' .bar-menu-panel hr { border: 0; border-top: 1px solid var(--c-line-soft); margin: 4px 0; width: 100%; }'
        + ' #scan-bar-edit-list .be-row { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-bottom: 1px solid var(--c-line-soft); font-size: 13px; }'
        + ' #scan-bar-edit-list .be-row label { flex: 1; display: flex; align-items: center; gap: 7px; cursor: pointer; min-width: 0; }'
        + ' #scan-bar-edit-list .be-row.off label { color: var(--c-text-3); } #scan-bar-edit-list input { width: 16px; height: 16px; }'
        + ' #scan-bar-edit-list .be-mv { min-width: 34px; }';
    document.head.appendChild(style);

    const realOf = (id) => $(id);
    const label = (id) => { const b = realOf(id); return b ? b.textContent.trim() : id; };
    let row = load();
    function load() {
        let raw = null;
        try { raw = localStorage.getItem(BAR_KEY); } catch (e) { /* 못 읽으면 기본값 */ }
        return rowFromStorage(raw, available, opt);
    }
    function save() { try { localStorage.setItem(BAR_KEY, serializeRow(row, available, opt)); } catch (e) { /* 기억 못 해도 지금 줄은 바뀐다 */ } }
    // 진짜 버튼을 줄(순서대로) 또는 보관함으로. 관리자 전용은 관리자가 아니면 보관함(메뉴에도 없음)
    function layout() {
        row.forEach(id => { const b = realOf(id); if (b) bar.insertBefore(b, menuWrap); });
        available.filter(id => !row.includes(id)).forEach(id => { const b = realOf(id); if (b) holder.appendChild(b); });
    }

    // ── 메뉴(대리 버튼) ──
    const menuList = [...menuIds(available, opt), ...(o.extraMenu || []).filter(id => realOf(id) && !available.includes(id))];
    panel.innerHTML = menuList.map(id => `<button type="button" class="d-btn d-btn-sm" data-for="${esc(id)}"></button>`).join('')
        + '<hr><button type="button" id="btn-scan-bar-edit" class="d-btn d-btn-sm" title="이 줄에 둘 버튼과 순서를 고릅니다(이 PC 에만 기억)">줄 편집…</button>';
    function syncMenu() {
        panel.querySelectorAll('button[data-for]').forEach(p => {
            const b = realOf(p.dataset.for);
            p.textContent = b ? b.textContent.trim() : p.dataset.for;
            p.title = b ? b.title : '';
            p.disabled = !b || b.disabled;
            // 숨김은 진짜 버튼이 스스로 숨은 경우만(보관함에 있어서 안 보이는 것은 메뉴에 그대로)
            p.hidden = !b || b.hidden || b.style.display === 'none';
        });
    }
    const setOpen = (on) => { panel.hidden = !on; $('btn-scan-menu').setAttribute('aria-expanded', on ? 'true' : 'false'); if (on) syncMenu(); };
    $('btn-scan-menu').addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });   // 바깥 .pop 닫기 스크립트로 새지 않게
    panel.addEventListener('click', (e) => {
        const p = e.target.closest('button[data-for]');
        if (!p) return;
        setOpen(false);
        const b = realOf(p.dataset.for);
        if (b && !b.disabled) b.click();
    });
    document.addEventListener('click', (e) => { if (!panel.hidden && !menuWrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); $('btn-scan-menu').focus(); } });
    // 진짜 버튼의 꺼짐·숨김·글자가 바뀌면(비상 전환·작업 중 등) 메뉴도 같이
    const mo = new MutationObserver(() => { if (!panel.hidden) syncMenu(); });
    menuList.forEach(id => { const b = realOf(id); if (b) mo.observe(b, { attributes: true, attributeFilter: ['disabled', 'hidden', 'style', 'title'], childList: true, characterData: true, subtree: true }); });

    // ── 줄 편집 창 ──
    const modal = document.createElement('div');
    modal.id = 'scan-bar-edit-modal'; modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal-content" style="width:520px; max-width:96vw;">
        <h3 style="margin-top:0;">스캐너 연동 줄 편집 <span class="t-3" style="font-size:12px; font-weight:500;">— 이 PC 에만 기억합니다</span></h3>
        <div class="t-3" style="font-size:12px; line-height:1.6;">체크한 버튼만 줄에 둡니다. ▲▼ 로 순서를 바꿉니다. 줄에 없는 버튼도 [⚙ 설정] 메뉴에서 늘 누를 수 있습니다.</div>
        <div id="scan-bar-edit-list" style="margin:8px 0 12px; max-height:60vh; overflow-y:auto;"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="btn-scan-bar-default" class="d-btn d-btn-sm">기본값으로</button>
            <button type="button" id="btn-scan-bar-all" class="d-btn d-btn-sm">전체 체크</button>
            <button type="button" id="btn-scan-bar-none" class="d-btn d-btn-sm" title="줄에서 모두 뺍니다(버튼은 [⚙ 설정] 메뉴에서 그대로 누를 수 있음)">전체 해제</button>
            <span style="flex:1;"></span>
            <button type="button" id="btn-scan-bar-close" class="d-btn d-btn-primary">닫기</button>
        </div></div>`;
    document.body.appendChild(modal);
    const list = modal.querySelector('#scan-bar-edit-list');
    let draft = row;
    function drawEdit() {
        const items = editList(draft, available, opt);
        const n = draft.length;
        list.innerHTML = items.map(({ id, on }) => {
            const i = draft.indexOf(id);
            return `<div class="be-row${on ? '' : ' off'}" data-id="${esc(id)}">
                <label><input type="checkbox" data-act="on"${on ? ' checked' : ''}> ${esc(label(id))}</label>
                <button type="button" class="d-btn d-btn-sm be-mv" data-act="up" title="앞으로"${on && i > 0 ? '' : ' disabled'}>▲</button>
                <button type="button" class="d-btn d-btn-sm be-mv" data-act="down" title="뒤로"${on && i < n - 1 ? '' : ' disabled'}>▼</button></div>`;
        }).join('');
    }
    list.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-act]'); if (!b) return;
        const id = b.closest('.be-row').dataset.id;
        draft = moveRow(draft, id, b.dataset.act === 'up' ? -1 : 1);
        drawEdit();
    });
    list.addEventListener('change', (e) => {
        const c = e.target.closest('input[data-act="on"]'); if (!c) return;
        draft = toggleRow(draft, c.closest('.be-row').dataset.id, c.checked, available, opt);
        drawEdit();
    });
    const closeEdit = () => { if (modal.style.display !== 'flex') return; modal.style.display = 'none'; row = draft; save(); layout(); };
    $('btn-scan-bar-edit').addEventListener('click', () => { draft = row; drawEdit(); modal.style.display = 'flex'; });
    $('btn-scan-bar-default').addEventListener('click', () => { draft = rowFromStorage(null, available, opt); drawEdit(); });
    // 전체 체크 = 지금 순서 뒤에 빠진 버튼을 목록 순서대로 붙임 · 전체 해제 = 줄 비움(메뉴에는 그대로). 같은 toggleRow 를 거쳐 권한 거름이 같다
    const setAll = (on) => {
        editList(draft, available, opt).forEach(({ id, on: cur }) => { if (cur !== on) draft = toggleRow(draft, id, on, available, opt); });
        drawEdit();
    };
    $('btn-scan-bar-all').addEventListener('click', () => setAll(true));
    $('btn-scan-bar-none').addEventListener('click', () => setAll(false));
    $('btn-scan-bar-close').addEventListener('click', closeEdit);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEdit(); });

    layout();
    return { available: () => available.slice(), row: () => row.slice() };
}
