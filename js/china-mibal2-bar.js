// === js/china-mibal2-bar.js ===
// 부족수량관리(신규, live) '오늘 작업' 줄 + [파일·기록 ▾] 메뉴 — [줄 편집](2026-11-10 사용자 요청, 2026-11-13 고정 배치로 정리).
// js/china-mibal2-live.js decorate 끝에서 부른다.
//   · 기본 배치 = 화면(HTML·decorate)이 처음 줄에 둔 버튼. 나머지는 [파일·기록 ▾] 메뉴 안에 있다
//   · 진짜 버튼(id 그대로, 하나뿐)을 줄 또는 메뉴로 옮길 뿐 — 거는 코드·버튼 끄기(마감된 작업 보기 등)는 그대로 따른다
//   · [⚙ 버튼 설정(줄 편집)…]은 [관리 ▾] 메뉴 안. 줄 구성·순서는 그 PC localStorage(js/lib/mibal2-bar.js — 2026-11-13 새 키, 옛 배치는 읽지 않음)
import { BAR_KEY, rowFromStorage, serializeRow, toggleRow, moveRow, editList, menuIds } from './lib/mibal2-bar.js?v=202611131006';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shown = (b) => !!b && !b.hidden && b.style.display !== 'none';

/**
 * @param {{ row: HTMLElement, menu: HTMLElement, editHost?: HTMLElement, isAdmin: () => boolean, adminOnly?: string[] }} o
 *   row = '오늘 작업' 줄 · menu = [파일·기록 ▾] 메뉴 판(줄에 없는 버튼이 들어감) · editHost = [줄 편집…] 항목을 넣을 메뉴 판([관리 ▾])
 *   adminOnly = 관리자 전용 버튼 id(관리자가 아니면 줄·메뉴에서 빠짐)
 */
export function setupScanBar(o) {
    const rowEl = o && o.row, menuEl = o && o.menu;
    if (!rowEl || !menuEl) return null;
    const opt = { isAdmin: !!(o.isAdmin && o.isAdmin()), adminOnly: o.adminOnly || [] };
    // 고를 수 있는 버튼 = 지금 줄·메뉴에 보이는 버튼(줄 → 메뉴 순서 그대로). 숨겨 둔 것(예: 꺼 둔 스캔잠금)은 넣지 않는다
    const rowNow = [...rowEl.querySelectorAll(':scope > button[id]')].filter(shown).map(b => b.id);
    const available = [...rowNow, ...[...menuEl.querySelectorAll(':scope > button[id]')].filter(shown).map(b => b.id)];
    const defaults = rowNow;
    // 관리자 전용은 관리자가 아니면 줄·메뉴 어디에도 없게 — 진짜 버튼을 숨긴 보관함으로
    const holder = document.createElement('span');
    holder.id = 'scan-bar-holder'; holder.hidden = true;
    menuEl.appendChild(holder);
    const toggle = menuEl.closest('.menu') && menuEl.closest('.menu').querySelector(':scope > .menu-toggle');
    const empty = menuEl.querySelector(':scope > .menu-empty');
    const style = document.createElement('style');
    style.textContent = ' #scan-bar-edit-list .be-row { display: flex; align-items: center; gap: 6px; padding: 4px 2px; border-bottom: 1px solid var(--c-line-soft); font-size: 13px; }'
        + ' #scan-bar-edit-list .be-row label { flex: 1; display: flex; align-items: center; gap: 7px; cursor: pointer; min-width: 0; }'
        + ' #scan-bar-edit-list .be-row.off label { color: var(--c-text-3); } #scan-bar-edit-list input { width: 16px; height: 16px; }'
        + ' #scan-bar-edit-list .be-mv { min-width: 34px; }';
    document.head.appendChild(style);

    const realOf = (id) => $(id);
    const label = (id) => { const b = realOf(id); return b ? b.textContent.trim() : id; };
    let row = load();
    function load() {
        let raw = null;
        try { raw = localStorage.getItem(BAR_KEY); } catch (e) { /* 못 읽으면 기본 배치 */ }
        return rowFromStorage(raw, available, opt, defaults);
    }
    function save() { try { localStorage.setItem(BAR_KEY, serializeRow(row, available, opt)); } catch (e) { /* 기억 못 해도 지금 줄은 바뀐다 */ } }
    // 진짜 버튼을 줄(순서대로) 또는 메뉴(원래 순서)로. 관리자 전용은 관리자가 아니면 보관함
    function layout() {
        row.forEach(id => { const b = realOf(id); if (b) rowEl.appendChild(b); });
        menuIds(row, available, opt).forEach(id => { const b = realOf(id); if (b) menuEl.insertBefore(b, empty || holder); });
        available.filter(id => !row.includes(id) && !menuIds(row, available, opt).includes(id)).forEach(id => { const b = realOf(id); if (b) holder.appendChild(b); });
        if (toggle) toggle.hidden = menuIds(row, available, opt).length === 0;   // 다 줄에 올렸으면 메뉴 단추도 숨김
    }

    // ── 줄 편집 창 — [관리 ▾] 메뉴의 [⚙ 버튼 설정(줄 편집)…] ──
    const host = o.editHost || menuEl;
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.id = 'btn-scan-bar-edit'; editBtn.className = 'd-btn d-btn-sm';
    editBtn.textContent = '⚙ 버튼 설정(줄 편집)…';
    editBtn.title = "'오늘 작업' 줄에 둘 버튼과 순서를 고릅니다(이 PC 에만 기억). 줄에 없는 버튼은 [파일·기록 ▾]에 있습니다";
    host.insertBefore(editBtn, host.querySelector(':scope > .menu-empty'));
    const modal = document.createElement('div');
    modal.id = 'scan-bar-edit-modal'; modal.className = 'modal-overlay';
    modal.innerHTML = `<div class="modal-content" style="width:520px; max-width:96vw;">
        <h3 style="margin-top:0;">오늘 작업 줄 편집 <span class="t-3" style="font-size:12px; font-weight:500;">— 이 PC 에만 기억합니다</span></h3>
        <div class="t-3" style="font-size:12px; line-height:1.6;">체크한 버튼만 줄에 둡니다. ▲▼ 로 순서를 바꿉니다. 줄에 없는 버튼은 [파일·기록 ▾] 메뉴에서 늘 누를 수 있습니다.</div>
        <div id="scan-bar-edit-list" style="margin:8px 0 12px; max-height:60vh; overflow-y:auto;"></div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" id="btn-scan-bar-default" class="d-btn d-btn-sm" title="입고용 파일 받기 · 스캐너에 반영 · 작업 마감">기본값으로</button>
            <button type="button" id="btn-scan-bar-all" class="d-btn d-btn-sm">전체 체크</button>
            <button type="button" id="btn-scan-bar-none" class="d-btn d-btn-sm" title="줄에서 모두 뺍니다(버튼은 [파일·기록 ▾] 메뉴에서 그대로 누를 수 있음)">전체 해제</button>
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
    editBtn.addEventListener('click', () => { draft = row; drawEdit(); modal.style.display = 'flex'; });
    $('btn-scan-bar-default').addEventListener('click', () => { draft = rowFromStorage(null, available, opt, defaults); drawEdit(); });
    // 전체 체크 = 지금 순서 뒤에 빠진 버튼을 목록 순서대로 붙임 · 전체 해제 = 줄 비움(메뉴에는 그대로). 같은 toggleRow 를 거쳐 권한 거름이 같다
    const setAll = (on) => {
        editList(draft, available, opt).forEach(({ id, on: cur }) => { if (cur !== on) draft = toggleRow(draft, id, on, available, opt); });
        drawEdit();
    };
    $('btn-scan-bar-all').addEventListener('click', () => setAll(true));
    $('btn-scan-bar-none').addEventListener('click', () => setAll(false));
    $('btn-scan-bar-close').addEventListener('click', closeEdit);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeEdit(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') closeEdit(); });

    layout();
    return { available: () => available.slice(), row: () => row.slice(), defaults: () => defaults.slice() };
}
