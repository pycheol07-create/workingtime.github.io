// === js/china-mibal2-live-admin.js ===
// 신규 부족수량관리 단독 운영(live) — [관리] 창(위치매핑·오류바코드·구역 적재량·본사도착 유예)과 적재량 칸 편집. 2026-10-28 준비.
// js/china-mibal2-live.js 가 불러온다(live 일 때만). 기존 화면 js/china-stock-goods.js 의 같은 기능을 복사해 옮겼다
// (그 파일은 그대로 — 되돌리기용). 문서·칸 이름은 같다:
//   ChinaStockGoods/LOCATION_MAP  {mapStr}                   ← 기존 loadLocationMapDoc·saveLocationMapDoc·handleLocationMapUpload
//   ChinaStockGoods/BARCODE_ALIAS {mapStr} + BARCODE_MEMO     ← 기존 loadBarcodeAlias·saveBarcodeAlias·handleBarcodeAliasUpload
//   ChinaStockGoods/CONFIG        zoneCapacity·graceDays(merge) ← 기존 saveZoneCap·openGraceSetting — 이 화면에서는 관리자만(규칙은 그대로)
//   ChinaStockGoods/EDITED_CELLS  cells.{code}.capacity        ← 기존 셀 편집(적재량) — 그 칸 하나만 merge/지움(다른 사람이 고친 칸을 덮지 않게)
// 불러오기에 실패한 목록은 저장하지 않는다(빈 목록으로 덮어 스캐너 매핑이 지워지는 것을 막음 — 기존과 같다).
import { doc, getDoc, setDoc, updateDoc, deleteField, FieldPath } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { zoneKey, capacityFor } from './lib/mibal2-calc.js?v=202610291646';

const CHINA = 'ChinaStockGoods';
const ADMIN_ONLY = '관리자만 바꿀 수 있습니다';
const MAP_STR_LIMIT = 900000;   // 기존 화면과 같은 값

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cleanKey = (str) => (str || '').toString().replace(/[^a-zA-Z0-9가-힣]/g, '');

/** 큰 맵은 JSON 문자열로 저장(색인 한도) — 기존 packMap 과 같다 */
export function packMap(obj) {
    const mapStr = JSON.stringify(obj || {});
    if (mapStr.length > MAP_STR_LIMIT) throw new Error(`저장할 자료가 너무 큽니다(${Math.round(mapStr.length / 1024)}KB). 오래된 항목을 정리해 주세요.`);
    return { mapStr, count: Object.keys(obj || {}).length, updatedAt: new Date() };
}
/** 새 형식(mapStr)·옛 형식(map) 모두 — 기존 unpackMap 과 같다 */
export function unpackMap(data) {
    if (!data) return {};
    if (typeof data.mapStr === 'string') { try { return JSON.parse(data.mapStr) || {}; } catch (e) { return {}; } }
    return data.map || {};
}
/** 시트 행 읽기 — 기존 readSheetRowsAOA 와 같다(xlsx/xls, 머리글 못 찾으면 UTF-8 텍스트(csv/html)로 다시) */
export async function readSheetRowsAOA(file, need) {
    const X = window.XLSX;
    const buf = await file.arrayBuffer();
    const hasHdr = (rs) => (rs || []).slice(0, 20).some(r => { const cl = (r || []).map(cleanKey); return need.every(k => cl.includes(k)); });
    let rows = [];
    try { const wb = X.read(new Uint8Array(buf), { type: 'array' }); rows = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); } catch (e) { /* 아래에서 다시 */ }
    if (!hasHdr(rows)) {
        try {
            const t = new TextDecoder('utf-8').decode(buf);
            if (/<table/i.test(t)) {
                const d = new DOMParser().parseFromString(t, 'text/html');
                const r2 = [];
                d.querySelectorAll('table tr').forEach(tr => { const c = []; tr.querySelectorAll('th,td').forEach(td => c.push((td.innerText || td.textContent || '').trim())); if (c.length) r2.push(c); });
                if (hasHdr(r2)) rows = r2;
            } else {
                const wb2 = X.read(t, { type: 'string' }); const r2 = X.utils.sheet_to_json(wb2.Sheets[wb2.SheetNames[0]], { header: 1, defval: '' }); if (hasHdr(r2)) rows = r2;
            }
        } catch (e) { /* 못 읽으면 빈 목록 */ }
    }
    return rows;
}
function writeXls(aoa, name) {
    const X = window.XLSX;
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(aoa), 'worksheet');
    X.writeFile(wb, name, { bookType: 'biff8' });
}
// 위치 열 고르기 — 기존 pickLocationColumn 과 같다(이름 우선순위)
function pickLocationColumn(headers, codeIdx, known) {
    for (const name of known) { const idx = headers.indexOf(name); if (idx >= 0 && idx !== codeIdx) return idx; }
    return -1;
}

export function setupLiveAdmin(ctx) {
    const { db, showToast, setLoading, errText } = ctx;
    let tab = 'cap';
    let locMap = {}, locMapOk = false;
    let alias = {}, aliasOk = false;
    const baCode = (v) => (v && typeof v === 'object') ? (v.code || '') : (v || '');
    const baMemo = (v) => (v && typeof v === 'object') ? (v.memo || '') : '';

    // ── 창 만들기(처음 열 때 한 번) ──
    function modal() {
        let m = $('live-admin-modal');
        if (m) return m;
        m = document.createElement('div');
        m.id = 'live-admin-modal'; m.className = 'modal-overlay';
        const inp = 'padding:6px 8px; border:1px solid var(--c-line-strong); border-radius:var(--r-sm); font-size:12px;';
        m.innerHTML = `<div class="modal-content" style="width:820px; max-width:96vw; max-height:90vh; overflow-y:auto;">
            <h3 style="margin-top:0;">관리</h3>
            <div id="lv-tabs" style="display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap;">
                <button type="button" class="d-btn d-btn-sm lv-tab" data-tab="cap">적재량·유예</button>
                <button type="button" class="d-btn d-btn-sm lv-tab" data-tab="locmap">위치매핑</button>
                <button type="button" class="d-btn d-btn-sm lv-tab" data-tab="alias">오류바코드</button>
            </div>
            <div id="lv-pane-cap" class="lv-pane">
                <div class="d-note" style="margin-bottom:8px;">구역별 적재량 — 로케이션 앞 글자(★ 구역은 ★·★★ 모두)마다 피킹칸에 올리는 기본 수량. 상품 하나만 바꾸려면 표의 <b>적재량</b> 칸을 누르세요.
                    <span id="lv-cap-admin" class="t-warn"></span></div>
                <div style="max-height:40vh; overflow:auto; border:1px solid var(--c-line); border-radius:var(--r-sm);">
                    <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;"><thead><tr><th class="d-th">구역</th><th class="d-th">표의 상품 수</th><th class="d-th">적재량</th></tr></thead><tbody id="lv-zone-tbody"></tbody></table>
                </div>
                <div style="margin-top:8px; text-align:right;"><button type="button" id="lv-zone-save" class="d-btn d-btn-sm d-btn-primary">구역 적재량 저장</button></div>
                <div style="margin-top:14px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; font-size:12.5px;">
                    <b>본사도착 유예</b> 본사도착일 + <input type="number" id="lv-grace" min="0" style="width:64px; ${inp}"> 일까지 출고일 목록·스캐너에 남김
                    <button type="button" id="lv-grace-save" class="d-btn d-btn-sm">유예 저장</button>
                </div>
            </div>
            <div id="lv-pane-locmap" class="lv-pane" style="display:none;">
                <div class="d-note" style="margin-bottom:8px;">스캐너가 상품코드마다 보여 줄 고정 위치(LOCATION_MAP). 바꾸면 스캐너에 바로 반영됩니다.</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; align-items:center;">
                    <input id="lv-locmap-code" placeholder="상품코드" style="width:130px; ${inp}"><input id="lv-locmap-loc" placeholder="위치" style="width:150px; ${inp}">
                    <button type="button" id="lv-locmap-add" class="d-btn d-btn-sm">+ 추가</button>
                    <span style="flex:1;"></span>
                    <input id="lv-locmap-search" placeholder="검색" style="width:130px; ${inp}">
                    <button type="button" id="lv-locmap-upload" class="d-btn d-btn-sm">엑셀 올리기</button>
                    <button type="button" id="lv-locmap-download" class="d-btn d-btn-sm">받기</button>
                    <button type="button" id="lv-locmap-clear" class="d-btn d-btn-sm d-btn-risk">전체 삭제</button>
                </div>
                <div id="lv-locmap-count" class="t-3" style="font-size:12px; margin-bottom:4px;"></div>
                <div style="max-height:46vh; overflow:auto; border:1px solid var(--c-line); border-radius:var(--r-sm);">
                    <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;"><thead><tr><th class="d-th">상품코드</th><th class="d-th">위치</th><th class="d-th"></th></tr></thead><tbody id="lv-locmap-tbody"></tbody></table>
                </div>
            </div>
            <div id="lv-pane-alias" class="lv-pane" style="display:none;">
                <div class="d-note" style="margin-bottom:8px;">잘못 붙은 바코드를 상품코드로 바꿔 읽는 목록(BARCODE_ALIAS · 사유는 BARCODE_MEMO). 바꾸면 스캐너에 바로 반영됩니다.</div>
                <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; align-items:center;">
                    <input id="lv-ba-barcode" placeholder="바코드" style="width:130px; ${inp}"><input id="lv-ba-code" placeholder="상품코드" style="width:120px; ${inp}"><input id="lv-ba-memo" placeholder="사유(선택)" style="width:150px; ${inp}">
                    <button type="button" id="lv-ba-add" class="d-btn d-btn-sm">+ 추가</button>
                    <span style="flex:1;"></span>
                    <input id="lv-ba-search" placeholder="검색" style="width:110px; ${inp}">
                    <button type="button" id="lv-ba-upload" class="d-btn d-btn-sm">엑셀 올리기</button>
                    <button type="button" id="lv-ba-download" class="d-btn d-btn-sm">받기</button>
                    <button type="button" id="lv-ba-clear" class="d-btn d-btn-sm d-btn-risk">전체 삭제</button>
                </div>
                <div id="lv-ba-count" class="t-3" style="font-size:12px; margin-bottom:4px;"></div>
                <div style="max-height:46vh; overflow:auto; border:1px solid var(--c-line); border-radius:var(--r-sm);">
                    <table style="width:100%; border-collapse:collapse; font-size:12px; text-align:center;"><thead><tr><th class="d-th">바코드</th><th class="d-th">상품코드</th><th class="d-th">사유</th><th class="d-th"></th></tr></thead><tbody id="lv-ba-tbody"></tbody></table>
                </div>
            </div>
            <div style="margin-top:16px; text-align:right; border-top:1px solid var(--c-line-soft); padding-top:12px;">
                <button type="button" id="lv-close" class="d-btn">닫기</button>
            </div></div>`;
        document.body.appendChild(m);
        const close = () => { m.style.display = 'none'; };
        $('lv-close').addEventListener('click', close);
        m.addEventListener('click', (e) => { if (e.target === m) close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && m.style.display === 'flex') close(); });
        $('lv-tabs').addEventListener('click', (e) => { const b = e.target.closest('.lv-tab'); if (b) showTab(b.dataset.tab); });
        $('lv-zone-save').addEventListener('click', saveZoneCap);
        $('lv-grace-save').addEventListener('click', saveGrace);
        // 위치매핑
        $('lv-locmap-add').addEventListener('click', addLocMap);
        $('lv-locmap-search').addEventListener('input', renderLocMap);
        $('lv-locmap-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lv-locmap-loc').focus(); });
        $('lv-locmap-loc').addEventListener('keydown', (e) => { if (e.key === 'Enter') addLocMap(); });
        $('lv-locmap-download').addEventListener('click', () => {
            const entries = Object.entries(locMap).sort((a, b) => a[0].localeCompare(b[0]));
            if (!entries.length) { alert('내려받을 위치매핑이 없습니다.'); return; }
            writeXls([['상품코드', '위치'], ...entries], '위치매핑.xls');
        });
        $('lv-locmap-clear').addEventListener('click', async () => {
            if (!Object.keys(locMap).length || !confirm('위치매핑을 전부 삭제할까요? (되돌릴 수 없습니다)')) return;
            locMap = {};
            try { await saveLocMap(); } catch (err) { alert('저장 실패: ' + err.message); await loadLocMap(); renderLocMap(); return; }
            renderLocMap(); showToast('🗑️ 전체 삭제됨');
        });
        // 오류바코드
        $('lv-ba-add').addEventListener('click', addAlias);
        $('lv-ba-search').addEventListener('input', renderAlias);
        $('lv-ba-barcode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lv-ba-code').focus(); });
        $('lv-ba-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lv-ba-memo').focus(); });
        $('lv-ba-memo').addEventListener('keydown', (e) => { if (e.key === 'Enter') addAlias(); });
        $('lv-ba-download').addEventListener('click', () => {
            const entries = Object.entries(alias).sort((a, b) => a[0].localeCompare(b[0]));
            if (!entries.length) { alert('내려받을 매칭이 없습니다.'); return; }
            writeXls([['바코드', '상품코드', '사유'], ...entries.map(([b, v]) => [b, baCode(v), baMemo(v)])], '오류바코드매칭.xls');
        });
        $('lv-ba-clear').addEventListener('click', async () => {
            if (!Object.keys(alias).length || !confirm('오류바코드매칭을 전부 삭제할까요? (되돌릴 수 없습니다)')) return;
            alias = {};
            try { await saveAlias(); } catch (err) { alert('저장 실패: ' + err.message); await loadAlias(); renderAlias(); return; }
            renderAlias(); showToast('🗑️ 전체 삭제됨');
        });
        // 엑셀 올리기(파일 입력은 창 안에 숨김)
        const fileFor = (id, handler) => {
            const f = document.createElement('input');
            f.type = 'file'; f.accept = '.xls,.xlsx,.csv,.html,.htm'; f.style.display = 'none';
            m.appendChild(f);
            $(id).addEventListener('click', () => f.click());
            f.addEventListener('change', async (e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file) await handler(file); });
        };
        fileFor('lv-locmap-upload', uploadLocMap);
        fileFor('lv-ba-upload', uploadAlias);
        return m;
    }
    function showTab(t) {
        tab = t;
        document.querySelectorAll('#lv-tabs .lv-tab').forEach(b => b.classList.toggle('d-btn-primary', b.dataset.tab === tab));
        ['cap', 'locmap', 'alias'].forEach(k => { $('lv-pane-' + k).style.display = k === tab ? '' : 'none'; });
        if (tab === 'cap') renderCap();
        if (tab === 'locmap') loadLocMap().then(renderLocMap);
        if (tab === 'alias') loadAlias().then(renderAlias);
    }
    function open() { modal().style.display = 'flex'; showTab(tab); }

    // ── 적재량·유예 (관리자만 저장 — 화면 제한, 규칙은 그대로) ──
    function renderCap() {
        const cfg = ctx.getConfig() || {};
        const zc = cfg.zoneCapacity || {};
        const counts = {};
        (ctx.getRows() || []).forEach(r => { if (r.locInfo) { const z = zoneKey(r.loc); if (z) counts[z] = (counts[z] || 0) + 1; } });
        const zones = [...new Set([...Object.keys(counts), ...Object.keys(zc)])].sort();
        const admin = ctx.isAdmin();
        $('lv-cap-admin').textContent = admin ? '' : ` 🔒 ${ADMIN_ONLY}(보기만 됩니다)`;
        $('lv-zone-save').disabled = !admin; $('lv-grace-save').disabled = !admin; $('lv-grace').disabled = !admin;
        $('lv-zone-tbody').innerHTML = zones.length ? zones.map(z => `<tr>
            <td style="font-weight:700; padding:5px;">${esc(z)}</td><td class="t-3">${counts[z] || 0}</td>
            <td><input type="number" class="lv-zcap" data-z="${esc(z)}" value="${esc(capacityFor(z, cfg, null))}" ${admin ? '' : 'disabled'} style="width:74px; padding:5px; text-align:center;"></td></tr>`).join('')
            : '<tr><td colspan="3" class="t-3" style="padding:18px;">표시할 구역이 없습니다(출고일을 고르면 표의 구역이 보입니다).</td></tr>';
        const g = (cfg.graceDays !== undefined && cfg.graceDays !== null) ? (parseInt(cfg.graceDays) || 0) : 1;
        $('lv-grace').value = String(g);
    }
    async function saveZoneCap() {
        if (!ctx.isAdmin()) { alert(ADMIN_ONLY); return; }
        const zc = { ...((ctx.getConfig() || {}).zoneCapacity || {}) };
        document.querySelectorAll('.lv-zcap').forEach(inp => {
            const z = inp.dataset.z, v = inp.value.trim();
            if (v === '') delete zc[z]; else zc[z] = parseInt(v) || 0;
        });
        try {
            await setDoc(doc(db, CHINA, 'CONFIG'), { zoneCapacity: zc, updatedAt: new Date() }, { merge: true });
            ctx.patchConfig({ zoneCapacity: zc });
            renderCap();
            showToast('✅ 구역별 적재량 저장됨');
        } catch (e) { alert('저장 실패: ' + errText(e)); }
    }
    async function saveGrace() {
        if (!ctx.isAdmin()) { alert(ADMIN_ONLY); return; }
        const v = parseInt($('lv-grace').value);
        if (isNaN(v) || v < 0) { alert('0 이상의 숫자를 입력하세요.'); return; }
        try {
            await setDoc(doc(db, CHINA, 'CONFIG'), { graceDays: v, updatedAt: new Date() }, { merge: true });
            ctx.patchConfig({ graceDays: v });
            showToast(`✅ 본사도착 유예 ${v}일 저장됨`);
        } catch (e) { alert('본사도착 유예 일수를 저장하지 못했습니다 — ' + errText(e)); }
    }

    // ── 적재량 칸 편집(직원도 — 기존 셀 편집과 같다) ──
    async function editCapacity(code) {
        if (!code) return;
        const ed = (ctx.getEdited() || {})[code] || {};
        const has = ed.capacity !== undefined && ed.capacity !== '';
        const row = (ctx.getRows() || []).find(r => r.code === code);
        const zoneVal = row && row.locInfo ? capacityFor(row.loc, ctx.getConfig(), null) : 0;
        const v = prompt(`${code} 적재량(피킹칸에 올릴 수량)\n\n비우면 구역 값(${zoneVal})을 씁니다.`, has ? String(ed.capacity) : '');
        if (v === null) return;
        const t = v.trim();
        if (t !== '' && (!/^\d+$/.test(t))) { alert('0 이상의 숫자를 입력하세요.'); return; }
        const ref = doc(db, CHINA, 'EDITED_CELLS');
        try {
            setLoading(true, '적재량 저장 중...');
            if (t === '') {
                if (has) await updateDoc(ref, new FieldPath('cells', code, 'capacity'), deleteField());
                ctx.setEditedCap(code, undefined);
            } else {
                await setDoc(ref, { cells: { [code]: { capacity: t } } }, { merge: true });
                ctx.setEditedCap(code, t);
            }
            setLoading(false);
            showToast(`💾 ${code} 적재량 ${t === '' ? '구역 값으로' : t} — 스캐너에는 [스캐너에 반영] 때 들어갑니다`);
        } catch (e) { setLoading(false); alert('적재량을 저장하지 못했습니다 — ' + errText(e)); }
    }

    // ── 위치매핑(LOCATION_MAP) — 기존과 같다 ──
    async function loadLocMap() {
        try { const s = await getDoc(doc(db, CHINA, 'LOCATION_MAP')); locMap = s.exists() ? unpackMap(s.data()) : {}; locMapOk = true; }
        catch (e) { locMap = {}; locMapOk = false; alert('목록을 불러오지 못했습니다. 새로고침해 주세요(저장은 막힘).'); }
    }
    async function saveLocMap() {
        if (!locMapOk) throw new Error('목록을 불러오지 못한 상태라 저장하지 않았습니다. 새로고침 후 다시 해 주세요.');
        await setDoc(doc(db, CHINA, 'LOCATION_MAP'), packMap(locMap));
    }
    function renderLocMap() {
        const kw = ($('lv-locmap-search').value || '').trim().toUpperCase();
        let entries = Object.entries(locMap);
        if (kw) entries = entries.filter(([c, l]) => c.includes(kw) || String(l || '').toUpperCase().includes(kw));
        entries.sort((a, b) => a[0].localeCompare(b[0]));
        $('lv-locmap-count').textContent = `총 ${Object.keys(locMap).length}건` + (kw ? ` · 검색 ${entries.length}건` : '');
        const tb = $('lv-locmap-tbody');
        tb.innerHTML = entries.length ? entries.map(([c, l]) => `<tr style="border-bottom:1px solid var(--c-line);"><td style="padding:6px; font-weight:600;">${esc(c)}</td>
            <td class="t-accent" style="padding:6px; font-weight:600;">${esc(l)}</td>
            <td style="padding:6px; white-space:nowrap;"><button type="button" class="d-btn d-btn-sm lv-lm-edit" data-c="${esc(c)}">수정</button> <button type="button" class="d-btn d-btn-sm lv-lm-del" data-c="${esc(c)}">삭제</button></td></tr>`).join('')
            : '<tr><td colspan="3" class="t-3" style="padding:18px;">등록된 위치매핑이 없습니다. 엑셀 올리기 또는 위에서 직접 추가하세요.</td></tr>';
        tb.querySelectorAll('.lv-lm-del').forEach(x => x.addEventListener('click', async () => {
            if (!confirm(`[${x.dataset.c}] 매핑을 삭제할까요?`)) return;
            delete locMap[x.dataset.c];
            try { await saveLocMap(); } catch (err) { alert('저장 실패: ' + err.message); await loadLocMap(); renderLocMap(); return; }
            renderLocMap(); showToast('🗑️ 삭제됨 — 스캐너 즉시 반영');
        }));
        tb.querySelectorAll('.lv-lm-edit').forEach(x => x.addEventListener('click', async () => {
            const code = x.dataset.c;
            const nv = prompt(`[${code}] 새 위치값`, locMap[code] || '');
            if (nv === null) return;
            locMap[code] = nv.trim();
            try { await saveLocMap(); } catch (err) { alert('저장 실패: ' + err.message); await loadLocMap(); renderLocMap(); return; }
            renderLocMap(); showToast('✏️ 수정됨 — 스캐너 즉시 반영');
        }));
    }
    async function addLocMap() {
        const c = ($('lv-locmap-code').value || '').trim().toUpperCase(), l = ($('lv-locmap-loc').value || '').trim();
        if (!c || !l) { alert('상품코드와 위치를 모두 입력하세요.'); return; }
        const exists = locMap[c] !== undefined;
        locMap[c] = l;
        try { await saveLocMap(); } catch (err) { alert('저장 실패: ' + err.message); await loadLocMap(); renderLocMap(); return; }
        $('lv-locmap-code').value = ''; $('lv-locmap-loc').value = ''; $('lv-locmap-code').focus();
        renderLocMap();
        showToast(exists ? '✏️ 기존 상품코드 위치 변경됨 — 스캐너 즉시 반영' : '✅ 위치매핑 추가됨 — 스캐너 즉시 반영');
    }
    async function uploadLocMap(file) {
        setLoading(true, '위치 매핑 처리 중...');
        try {
            const rows = await readSheetRowsAOA(file, ['상품코드']);
            let hi = -1, headers = [];
            for (let i = 0; i < Math.min(20, rows.length); i++) { const cl = rows[i].map(cleanKey); if (cl.includes('상품코드')) { hi = i; headers = cl; break; } }
            if (hi < 0) { setLoading(false); alert('상품코드 열을 찾지 못했습니다.'); return; }
            const codeIdx = headers.indexOf('상품코드');
            const locIdx = pickLocationColumn(headers, codeIdx, ['로케이션', '위치', '옵션추가항목1', '옵션']);
            if (locIdx < 0) { setLoading(false); alert("위치 열을 찾지 못했습니다.\n헤더에 '로케이션'(또는 위치/옵션추가항목1)이 있어야 합니다."); return; }
            const map = {};
            for (let i = hi + 1; i < rows.length; i++) {
                const code = (rows[i][codeIdx] || '').toString().trim().toUpperCase();
                const loc = (rows[i][locIdx] || '').toString().trim();
                if (code) map[code] = loc;
            }
            const cnt = Object.keys(map).length;
            if (!cnt) { setLoading(false); alert('유효한 행이 없습니다.'); return; }
            await loadLocMap();
            Object.assign(locMap, map);   // 병합(같은 상품코드는 덮어씀) — 기존과 같다
            await saveLocMap();
            setLoading(false);
            renderLocMap();
            showToast(`✅ 위치 매핑 ${cnt}건 반영 (총 ${Object.keys(locMap).length}건) — 스캐너에 즉시 반영`);
        } catch (err) { setLoading(false); alert('위치 매핑 처리 실패: ' + err.message); await loadLocMap(); renderLocMap(); }
    }

    // ── 오류바코드(BARCODE_ALIAS + BARCODE_MEMO) — 기존과 같다 ──
    async function loadAlias() {
        try { const s = await getDoc(doc(db, CHINA, 'BARCODE_ALIAS')); alias = s.exists() ? unpackMap(s.data()) : {}; aliasOk = true; }
        catch (e) { alias = {}; aliasOk = false; alert('목록을 불러오지 못했습니다. 새로고침해 주세요(저장은 막힘).'); }
    }
    async function saveAlias() {
        if (!aliasOk) throw new Error('목록을 불러오지 못한 상태라 저장하지 않았습니다. 새로고침 후 다시 해 주세요.');
        await setDoc(doc(db, CHINA, 'BARCODE_ALIAS'), packMap(alias));
        const memoMap = {}; for (const b in alias) { const mm = baMemo(alias[b]); if (mm) memoMap[b] = mm; }
        await setDoc(doc(db, CHINA, 'BARCODE_MEMO'), packMap(memoMap));
    }
    function renderAlias() {
        const kw = ($('lv-ba-search').value || '').trim().toUpperCase();
        let entries = Object.entries(alias);
        if (kw) entries = entries.filter(([b, v]) => b.includes(kw) || baCode(v).toUpperCase().includes(kw) || baMemo(v).toUpperCase().includes(kw));
        entries.sort((a, b) => a[0].localeCompare(b[0]));
        $('lv-ba-count').textContent = `총 ${Object.keys(alias).length}건` + (kw ? ` · 검색 ${entries.length}건` : '');
        const tb = $('lv-ba-tbody');
        tb.innerHTML = entries.length ? entries.map(([b, v]) => `<tr style="border-bottom:1px solid var(--c-line);"><td style="padding:6px; font-weight:600;">${esc(b)}</td>
            <td class="t-accent" style="padding:6px; font-weight:600;">${esc(baCode(v))}</td><td class="t-risk" style="padding:6px; text-align:left; word-break:break-all;">${esc(baMemo(v))}</td>
            <td style="padding:6px; white-space:nowrap;"><button type="button" class="d-btn d-btn-sm lv-ba-edit" data-b="${esc(b)}">수정</button> <button type="button" class="d-btn d-btn-sm lv-ba-del" data-b="${esc(b)}">삭제</button></td></tr>`).join('')
            : '<tr><td colspan="4" class="t-3" style="padding:18px;">등록된 매칭이 없습니다. 엑셀 올리기 또는 위에서 직접 추가하세요.</td></tr>';
        tb.querySelectorAll('.lv-ba-del').forEach(x => x.addEventListener('click', async () => {
            if (!confirm(`[${x.dataset.b}] 매칭을 삭제할까요?`)) return;
            delete alias[x.dataset.b];
            try { await saveAlias(); } catch (err) { alert('저장 실패: ' + err.message); await loadAlias(); renderAlias(); return; }
            renderAlias();
        }));
        // 수정 = 입력칸에 불러와 고친 뒤 [+ 추가]로 덮어씀(기존과 같다)
        tb.querySelectorAll('.lv-ba-edit').forEach(x => x.addEventListener('click', () => {
            const b = x.dataset.b, v = alias[b];
            $('lv-ba-barcode').value = b; $('lv-ba-code').value = baCode(v); $('lv-ba-memo').value = baMemo(v); $('lv-ba-barcode').focus();
        }));
    }
    async function addAlias() {
        const b = ($('lv-ba-barcode').value || '').trim().toUpperCase(), c = ($('lv-ba-code').value || '').trim().toUpperCase(), mm = ($('lv-ba-memo').value || '').trim();
        if (!b || !c) { alert('바코드와 상품코드를 모두 입력하세요.'); return; }
        alias[b] = { code: c, memo: mm };
        try { await saveAlias(); } catch (err) { alert('저장 실패: ' + err.message); await loadAlias(); renderAlias(); return; }
        $('lv-ba-barcode').value = ''; $('lv-ba-code').value = ''; $('lv-ba-memo').value = ''; $('lv-ba-barcode').focus();
        renderAlias();
        showToast('✅ 매칭 추가됨 — 스캐너 즉시 반영');
    }
    async function uploadAlias(file) {
        setLoading(true, '오류바코드 매칭 처리 중...');
        try {
            const rows = await readSheetRowsAOA(file, ['바코드', '상품코드']);
            let hi = -1, headers = [];
            for (let i = 0; i < Math.min(20, rows.length); i++) { const cl = rows[i].map(cleanKey); if (cl.includes('바코드') && cl.includes('상품코드')) { hi = i; headers = cl; break; } }
            if (hi < 0) { setLoading(false); alert('바코드/상품코드 두 열을 찾지 못했습니다.'); return; }
            const bIdx = headers.indexOf('바코드'), cIdx = headers.indexOf('상품코드'), mIdx = headers.indexOf('사유');
            const map = {}; let added = 0;
            for (let i = hi + 1; i < rows.length; i++) {
                const b = (rows[i][bIdx] || '').toString().trim().toUpperCase();
                const c = (rows[i][cIdx] || '').toString().trim().toUpperCase();
                const mm = mIdx >= 0 ? (rows[i][mIdx] || '').toString().trim() : '';
                if (b && c) { map[b] = { code: c, memo: mm }; added++; }
            }
            if (!added) { setLoading(false); alert('유효한 행이 없습니다.'); return; }
            await loadAlias();
            Object.assign(alias, map);
            await saveAlias();
            setLoading(false);
            renderAlias();
            showToast(`✅ ${added}건 반영 (총 ${Object.keys(alias).length}건) — 스캐너 즉시 반영`);
        } catch (err) { setLoading(false); alert('처리 실패: ' + err.message); await loadAlias(); renderAlias(); }
    }

    return { open, editCapacity };
}
