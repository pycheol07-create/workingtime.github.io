// === js/china-mibal2-urgent.js ===
// 부족수량관리(신규) '긴급' 상품 화면(2026-11-27 사용자 요청) — 표시·선택·단추. 쓰기 함수는 없다(쓰기는 live 모듈 js/china-mibal2-live-urgent.js).
// 필요할 때만 켜서 쓰는 기능: 문서 mibal2/urgent 의 enabled 가 true 일 때만 긴급 관련 화면이 나온다. 꺼져 있으면 표·머리줄은 예전 그대로이고,
//   쓸 수 있는 사람(live + 입장 판정 통과)에게만 [관리 ▾] 메뉴 맨 끝에 [긴급 모드 켜기]/[긴급 모드 끄기] 항목 하나가 보인다(2026-11-27 사용자 요청 — 표 위 줄에서 옮김).
// 켜져 있으면:
//   · 긴급 상품 행 — 코드 칸 앞 빨간 '긴급' 배지 + 행 왼쪽 빨간 띠, 플래그 열 필터 값에 '긴급'(js/lib/mibal2-filter.js)
//   · 표 위 줄(#urgent-bar) — 긴급 N개 · [긴급만 보기] · (쓸 수 있으면) 'N개 선택(안 보이는 M개 포함)' [긴급 지정] [긴급 해제] [선택 풀기]
//   · (쓸 수 있으면) 표 맨 앞 체크칸 열 — 열 순서·[칸 설정] 대상이 아니다(th.usel-col 은 headCells 에서 빠진다, data-col="usel" 은 COLS 에 없음).
//     머리글 체크칸 = 지금 보이는(필터된) 행 전체 선택/해제, Shift+클릭 = 범위. 선택은 다시 그려도(구독·필터) 남고, 표에서 사라진 상품만 빠진다.
//   · 행 상세(펼침) 맨 위 [긴급 지정]/[긴급 해제] 단추(한 상품)
//   · '선택 출고일 밖 입고' 행(r.outside)은 긴급 대상이 아니다 — 체크칸 자리는 빈 칸(칸 수 유지), 전체 선택·범위·배지에서 뺀다
// 체크칸 열이 있나(rendered)는 표를 실제로 그릴 때(markRender — js/china-mibal2.js renderTable) 정한다. 입고확인 칸을 고치느라
//   그리기를 미루는 동안 다른 PC 가 긴급 모드를 켜고 꺼도 머리글만 먼저 바뀌어 칸이 어긋나지 않게(2026-11-27 리뷰).
// 순수 함수는 js/lib/mibal2-urgent.js.
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { parseUrgent, attachUrgent, urgentOnlyPass, selectionSummary, selectionText, headCheckState, toggleAllVisible, rangeCodes,
    pruneSelection, disableConfirmText, changeResultText, urgentChanges, targetCodes, isTargetRow, URGENT_DOC_PATH, URGENT_LABEL, URGENT_WRITE_MAX } from './lib/mibal2-urgent.js?v=8b9020e9f9f6-dcb7b034';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEL_W = 30;   // 체크칸 열 너비(px) — 고정 너비 표(열 너비 조절 뒤)에서도 이 값

const CSS = `
.list-table th.usel-col, .list-table td.usel-cell { width: ${SEL_W}px; min-width: ${SEL_W}px; max-width: ${SEL_W}px; padding: 0 4px; box-sizing: border-box; user-select: none; }
.list-table td.usel-cell { cursor: pointer; }
.list-table th.usel-col input, .list-table td.usel-cell input { width: 16px; height: 16px; cursor: pointer; vertical-align: middle; margin: 0; }
.list-table tbody tr.urgent-row > td:first-child { box-shadow: inset 4px 0 0 #D93A3A; }
.urg-badge { display: inline-block; padding: 0 6px; margin-right: 4px; border-radius: var(--r-pill, 999px); background: #D93A3A; color: #fff; font-size: 10.5px; font-weight: 700; line-height: 1.6; vertical-align: 1px; }
.urgent-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 10px; margin: 0 0 6px; border: 1px solid #EBCDD1; border-left: 4px solid #D93A3A; border-radius: var(--r-inner, 8px); background: #FDF3F4; font-size: 12.5px; }
.urgent-bar .urg-only { display: inline-flex; align-items: center; gap: 5px; font-weight: 600; cursor: pointer; }
.urgent-bar .urg-only input { width: 15px; height: 15px; }
.urgent-bar .urg-sel { font-weight: 700; color: var(--c-text-2, #444); }
.urg-detail { margin-bottom: 8px; display: flex; align-items: center; gap: 8px; }
`;

/**
 * @param {object} o
 *   db · showToast · showAlert · showConfirm · errText
 *   getAllRows() · getViewRows() — 표 행(전체·지금 보이는)
 *   rerender() — 거르기·정렬·그리기 다시(applyFilters) · relayout() — 체크칸 열이 생기거나 없어졌을 때(열 너비 다시)
 *   writer() — live 쓰기 도구(setupLiveUrgent 반환) 또는 null(쓰기 못 함 = 표시만)
 *   onModeChange(enabled) — 켜짐·꺼짐이 바뀜(꺼지면 '긴급' 값으로 건 플래그 필터를 풀게)
 */
export function createUrgentUi(o) {
    let u = parseUrgent(null);    // 서버 문서를 받기 전 = 꺼짐(예전 화면 그대로)
    let selected = new Set();     // 고른 상품코드(이 화면 메모리에만)
    let anchor = null;            // Shift+클릭 범위 시작
    let onlyUrgent = false;       // '긴급만 보기'
    let busy = false;
    let started = false;
    let barKey = '';
    let rendered = false;         // 마지막으로 그린 표에 체크칸 열이 있나(markRender) — 머리글·칸 수·너비는 이것만 본다

    const canWrite = () => !!(o.writer && o.writer());
    const picking = () => u.enabled && canWrite();
    const visibleCodes = () => targetCodes(o.getViewRows());   // 보이는 행 중 긴급 대상(출고일 밖 입고 행 제외)
    const headRow = () => { const tb = $('table-body'); const t = tb && tb.closest('table'); return t ? t.querySelector('thead tr') : null; };

    function injectCss() {
        if ($('urgent-style')) return;
        const st = document.createElement('style');
        st.id = 'urgent-style';
        st.textContent = CSS;
        document.head.appendChild(st);
    }

    // ── 구독(여러 PC 실시간) ──
    function start() {
        if (started) return;
        started = true;
        injectCss();
        syncModeBtn();
        onSnapshot(doc(o.db, URGENT_DOC_PATH), (snap) => {
            const next = parseUrgent(snap.exists() ? snap.data() : null);
            const modeChanged = next.enabled !== u.enabled;
            u = next;
            if (!u.enabled) { selected = new Set(); anchor = null; onlyUrgent = false; }
            if (modeChanged && o.onModeChange) o.onModeChange(u.enabled);
            attach(o.getAllRows());
            o.rerender();
        }, (err) => {
            console.warn('[mibal2] 긴급 문서(mibal2/urgent) 구독 실패 — 긴급 표시 꺼짐:', err && err.code);
        });
    }

    /** 행마다 r.urgent + 표에서 사라진 상품은 선택에서 뺀다 */
    function attach(rows) {
        attachUrgent(rows, u);
        if (selected.size) selected = pruneSelection(selected, targetCodes(rows));
    }

    // ── 표 그리기 조각(js/china-mibal2.js renderTable 이 부른다) ──
    const passes = (r) => urgentOnlyPass(r, u.enabled && onlyUrgent);
    /** 표를 실제로 그리기 직전(미루지 않을 때만) — 이번 그림에 체크칸 열을 넣을지 정한다 */
    const markRender = () => { rendered = picking(); };
    const extraCols = () => (rendered ? 1 : 0);
    const rowClass = (r) => (r && r.urgent ? 'urgent-row' : '');
    const badge = (r) => (r && r.urgent ? `<span class="urg-badge" title="긴급 상품">${URGENT_LABEL}</span>` : '');
    const selTd = (r) => (!rendered ? '' : !isTargetRow(r) ? '<td class="usel-cell usel-none" data-col="usel" title="선택 출고일 밖 입고 — 긴급 대상 아님"></td>'
        : `<td class="usel-cell" data-col="usel"><input type="checkbox" class="urg-chk" aria-label="${esc(r.code)} 선택"${selected.has(String(r.code)) ? ' checked' : ''}></td>`);
    function detailHtml(r) {
        if (!picking() || !r || r.outside) return '';
        return `<div class="urg-detail">${r.urgent ? badge(r) + '긴급 상품입니다' : '긴급 상품 아님'}
            <button type="button" class="d-btn d-btn-sm" data-urg-toggle="${esc(r.code)}" data-urg-on="${r.urgent ? '0' : '1'}">${r.urgent ? '긴급 해제' : '긴급 지정'}</button></div>`;
    }

    // ── 머리글 체크칸 열 · 표 위 줄 · [긴급 모드] 단추 ──
    function syncHead() {
        const tr = headRow(); if (!tr) return;
        let th = tr.querySelector(':scope > th.usel-col');
        const want = rendered;   // 지금 표(tbody)에 그려진 그대로 — 미뤄 둔 그리기 동안 머리글만 바뀌지 않게
        if (want && !th) {
            th = document.createElement('th');
            th.className = 'usel-col';
            th.dataset.col = 'usel';
            th.innerHTML = '<input type="checkbox" id="urg-head-chk" aria-label="보이는 행 모두 선택" title="지금 보이는 행 모두 선택 / 해제">';
            th.querySelector('input').addEventListener('change', () => {
                selected = toggleAllVisible(selected, visibleCodes());
                anchor = null;
                paintChecks();
            });
            tr.insertBefore(th, tr.firstChild);
            if (o.relayout) o.relayout();
        } else if (!want && th) {
            th.remove();
            if (o.relayout) o.relayout();
        }
        const hc = $('urg-head-chk');
        if (hc) {
            const st = headCheckState(selected, visibleCodes());
            hc.checked = st === 'all';
            hc.indeterminate = st === 'some';
        }
    }
    function syncModeBtn() {
        let b = $('btn-urgent-mode');
        if (!canWrite()) { if (b) b.remove(); return; }
        if (!b) {
            const host = $('menu-admin-panel');   // [관리 ▾] — 누르면 메뉴는 닫힌다(china-mibal2.html 메뉴 스크립트)
            if (!host) return;
            b = document.createElement('button');
            b.type = 'button'; b.id = 'btn-urgent-mode'; b.className = 'd-btn d-btn-sm';
            b.addEventListener('click', () => toggleMode());
            host.insertBefore(b, host.querySelector(':scope > .menu-empty'));   // 맨 끝(빈 안내 앞)
        }
        b.textContent = u.enabled ? '긴급 모드 끄기' : '긴급 모드 켜기';
        b.title = u.enabled ? '긴급 모드를 끕니다 — 지정한 긴급 상품도 모두 해제됩니다(스캐너 표시도 사라짐)'
            : '긴급 모드를 켭니다 — 표에서 상품을 골라 긴급으로 지정하면 모든 PC·스캐너에 보입니다(필요할 때만 켜서 쓰세요)';
        b.disabled = busy;
    }
    function syncBar() {
        let bar = $('urgent-bar');
        if (!u.enabled) { if (bar) bar.remove(); barKey = ''; return; }
        const notes = $('table-notes'); if (!notes) return;
        if (!bar) {
            bar = document.createElement('div');
            bar.id = 'urgent-bar'; bar.className = 'urgent-bar'; bar.setAttribute('role', 'status');
            notes.insertBefore(bar, notes.firstChild);
            bar.addEventListener('change', (e) => { if (e.target.id === 'urg-only') { onlyUrgent = e.target.checked; o.rerender(); } });
            bar.addEventListener('click', (e) => {
                const b = e.target.closest('button[data-urg-act]'); if (!b) return;
                const act = b.dataset.urgAct;
                if (act === 'set') applySelected(true);
                else if (act === 'unset') applySelected(false);
                else if (act === 'clear') { selected = new Set(); anchor = null; paintChecks(); }
            });
        }
        const key = picking() ? 'w' : 'r';
        if (key !== barKey) {
            barKey = key;
            bar.innerHTML = `<span class="urg-badge">긴급 모드</span><span id="urg-count"></span>
                <label class="urg-only"><input type="checkbox" id="urg-only"> 긴급만 보기</label>`
                + (key === 'w' ? `<span style="flex:1;"></span><span id="urg-sel-text" class="urg-sel"></span>
                <button type="button" class="d-btn d-btn-sm" id="btn-urg-set" data-urg-act="set" title="고른 상품을 긴급으로 지정합니다(모든 PC·스캐너에 보임)">긴급 지정</button>
                <button type="button" class="d-btn d-btn-sm" id="btn-urg-unset" data-urg-act="unset" title="고른 상품의 긴급을 풉니다">긴급 해제</button>
                <button type="button" class="d-btn d-btn-sm" id="btn-urg-clear" data-urg-act="clear">선택 풀기</button>`
                : `<span class="t-3">긴급 지정은 부족수량관리 권한자가 합니다</span>`);
        }
        $('urg-count').textContent = `긴급 ${u.count}개`;
        $('urg-only').checked = onlyUrgent;
        if (key === 'w') {
            const s = selectionSummary(selected, visibleCodes());
            $('urg-sel-text').textContent = selectionText(s) || '표 맨 앞 칸을 체크해 고르세요(Shift+클릭 = 범위)';
            ['btn-urg-set', 'btn-urg-unset', 'btn-urg-clear'].forEach(id => { $(id).disabled = busy || !s.total; });
        }
    }
    /** 다시 그린 뒤(applyFilters 끝) — 머리글 체크칸·표 위 줄·단추 */
    function sync() {
        syncModeBtn();
        syncHead();
        syncBar();
    }
    /** 표 전체를 다시 그리지 않고 체크칸만 맞춘다(고르기는 자주 누르니까) */
    function paintChecks() {
        document.querySelectorAll('#table-body tr.data-row').forEach(tr => {
            const c = tr.querySelector('td.usel-cell input');
            if (c) c.checked = selected.has(String(tr.dataset.code));
        });
        syncHead();
        syncBar();
    }

    /** 표 클릭 — 체크칸·상세 단추면 여기서 처리하고 true(줄 펼치기 안 함) */
    function onBodyClick(e) {
        const t = e.target;
        if (!t || !t.closest) return false;
        const tb = t.closest('[data-urg-toggle]');
        if (tb) { e.stopPropagation(); applyCodes([tb.dataset.urgToggle], tb.dataset.urgOn === '1', false); return true; }
        const td = t.closest('td.usel-cell');
        if (!td) return false;
        const tr = td.closest('tr.data-row');
        const code = tr ? String(tr.dataset.code) : '';
        if (!code || !picking() || !td.querySelector('input')) return true;   // 빈 칸(출고일 밖 입고) · 쓸 수 없음 — 줄도 안 펼친다
        const on = !selected.has(code);
        const codes = e.shiftKey && anchor ? rangeCodes(visibleCodes(), anchor, code) : [code];
        codes.forEach(c => { if (on) selected.add(c); else selected.delete(c); });
        anchor = code;
        paintChecks();
        return true;
    }

    // ── 쓰기(live 도구로) ──
    async function guard(fn) {
        if (busy) { o.showToast('⏳ 긴급 표시를 저장하는 중입니다'); return; }
        busy = true; sync();
        try { await fn(); }
        catch (e) {
            console.error('[mibal2] 긴급 저장 실패:', e && e.code);
            const denied = e && (e.code === 'permission-denied' || /permission/i.test(String(e.message || '')));
            o.showAlert(denied ? '긴급 표시를 저장할 권한이 없습니다(부족수량관리 권한 필요) — 아무것도 바뀌지 않았습니다.'
                : e && e.code === 'too-many' ? e.message : '긴급 표시를 저장하지 못했습니다 — ' + o.errText(e), { title: '저장하지 못했습니다', isError: true });
        } finally { busy = false; sync(); }
    }
    async function applySelected(on) {
        const codes = [...selected];
        if (!codes.length) return;
        const s = selectionSummary(selected, visibleCodes());
        if (s.hidden && !(await o.showConfirm(`고른 ${s.total}개 중 ${s.hidden}개는 지금 표(검색·필터)에 안 보이는 상품입니다.\n그것까지 모두 ${on ? '긴급 지정' : '긴급 해제'}할까요?`,
            { title: on ? '긴급 지정' : '긴급 해제', okText: on ? '모두 지정' : '모두 해제' }))) return;
        await applyCodes(codes, on, true);
    }
    async function applyCodes(codes, on, clearAfter) {
        const w = o.writer && o.writer();
        if (!w) return;
        if (!u.enabled) { o.showToast('긴급 모드가 꺼져 있습니다 — 먼저 [긴급 모드 켜기]'); return; }
        const { change } = urgentChanges(u, codes, on);
        if (change.length > URGENT_WRITE_MAX) { o.showAlert(`한 번에 ${URGENT_WRITE_MAX}개까지만 바꿀 수 있습니다(${change.length}개 고름) — 나눠서 해 주세요.`, { title: '너무 많습니다', isError: true }); return; }
        await guard(async () => {
            const r = await w.setCodes(codes, on);
            if (r && r.off) { o.showToast('긴급 모드가 꺼져 있어 저장하지 않았습니다'); return; }
            if (clearAfter) { selected = new Set(); anchor = null; }
            o.showToast((r && r.changed ? '✅ ' : 'ℹ️ ') + changeResultText(on, r ? r.changed : 0, r ? r.same : 0));
        });
    }
    async function toggleMode() {
        const w = o.writer && o.writer();
        if (!w) return;
        if (!u.enabled) {
            await guard(async () => {
                const r = await w.enable();
                o.showToast(r && r.already ? 'ℹ️ 이미 긴급 모드입니다' : '✅ 긴급 모드를 켰습니다 — 표 맨 앞 칸을 체크해 긴급 상품을 고르세요');
            });
            return;
        }
        if (!(await o.showConfirm(disableConfirmText(u.count), { title: '긴급 모드를 끌까요?', okText: '끄기', danger: true }))) return;
        await guard(async () => {
            const r = await w.disable();
            o.showToast(r && r.already ? 'ℹ️ 이미 꺼져 있습니다' : `✅ 긴급 모드를 껐습니다${r && r.count ? ` — 긴급 ${r.count}개 해제` : ''}`);
        });
    }

    return {
        start, attach, passes, markRender, extraCols, rowClass, badge, selTd, detailHtml, onBodyClick, sync,
        selWidth: () => (rendered ? SEL_W : 0),
        isOn: () => u.enabled
    };
}
