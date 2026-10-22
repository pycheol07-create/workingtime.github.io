// === js/inspection-packs.js ===
// 샘플검수 '패킹에서 만들기' — 입고예정 패킹을 골라 검수 대기 리스트(daily_data.inspectionList)에 추가한다.
// 읽기: integrations/inspPacks (미발계산기2 수집기가 씀, 열 때 getDoc 1회 — 구독하지 않는다) · product_history/{상품명}(두께) · 날짜별 이력(샘플위치)
//       · Locations ZONE_* (샘플위치, [만들기] 때 getDocs 1회 — 이름·옵션·대분류·id 만 꺼내고 rawDataStr 등은 버린다)
// 쓰기: updateDailyData({inspectionList}) — 엑셀 업로드(js/inspection-excel.js)와 같은 경로. 순수 규칙은 js/lib/insp-packs.js.
// ⚠️ 이 창은 index.html 에 붙는다 — 업무마감봇 선택자와 겹치지 않게 role="dialog"·data-act·end-shift-* 를 쓰지 않는다. id 는 모두 insp-pack-*.
// ⚠️ 공급처는 코드만(supplierCode). supplierName 은 빈칸(CLAUDE.md 3절).
import * as State from './state.js?v=202610230833';
import { updateDailyData } from './app-data.js?v=202610230833';
import { showToast, getTodayDateString, escapeHtml } from './utils.js?v=202610230833';
import { renderTodoList, openInspectionListWindow } from './inspection-logic.js?v=202610230833';
import { fetchAllHistoryData } from './history-data-manager.js?v=202610230833';
import { doc, getDoc, getDocs, collection, query, where, documentId } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { parseInspPacks, buildCards, mergeList, previewCount, existingCount, refsFromDays, thicknessFromHistoryDoc, samplesFromLocations } from './lib/insp-packs.js?v=202610230833';

const DOC_PATH = ['artifacts', 'team-work-logger-v2', 'integrations', 'inspPacks'];
const PICKER_ID = 'insp-pack-picker';
const HIST_CONCURRENCY = 8;

let parsed = null;            // parseInspPacks 결과(창을 열 때마다 새로 읽음)
const picked = new Set();     // 고른 패킹번호
let busy = false;

const fmtMs = (ms) => {
    if (!ms) return '-';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const md = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : (s || '-'));

function closePicker() {
    const el = document.getElementById(PICKER_ID);
    if (el) el.remove();
    picked.clear();
    parsed = null;
}

function ensureShell() {
    let el = document.getElementById(PICKER_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PICKER_ID;
    // modal-esc.js 가 ESC 후보로 보는 모양(.fixed.inset-0 + justify-center). 닫기 버튼 id 에 close 가 있어 ESC 가 그것을 누른다.
    el.className = 'fixed inset-0 bg-gray-900 bg-opacity-60 flex items-center justify-center z-[70] p-4';
    el.innerHTML = `
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
            <div class="p-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
                <div>
                    <h3 class="text-lg font-bold text-gray-900">패킹에서 검수 리스트 만들기</h3>
                    <p class="text-xs text-gray-500 mt-0.5">입고예정 패킹을 고르면 엑셀 업로드와 같은 기준(공급처·색상 1장)으로 검수 대기 리스트에 추가합니다.</p>
                </div>
                <button id="insp-pack-close-btn" class="text-gray-400 hover:text-gray-700 p-1" title="닫기">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-6 h-6"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div id="insp-pack-body" class="p-4 overflow-y-auto flex-grow min-h-[120px] text-sm text-gray-500">불러오는 중...</div>
            <div class="p-4 border-t border-gray-200 flex-shrink-0 space-y-2">
                <div id="insp-pack-notes" class="text-[11px] text-gray-500 space-y-0.5"></div>
                <div class="flex justify-between items-center gap-3">
                    <span id="insp-pack-summary" class="text-sm font-bold text-gray-700">선택 0개 → 0장</span>
                    <div class="flex gap-2">
                        <button id="insp-pack-cancel-btn" class="text-sm bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold py-2 px-4 rounded">취소</button>
                        <button id="insp-pack-make-btn" class="text-sm bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed" disabled>만들기</button>
                    </div>
                </div>
            </div>
        </div>`;
    document.body.appendChild(el);
    el.querySelector('#insp-pack-close-btn').addEventListener('click', () => { if (!busy) closePicker(); });
    el.querySelector('#insp-pack-cancel-btn').addEventListener('click', () => { if (!busy) closePicker(); });
    el.querySelector('#insp-pack-make-btn').addEventListener('click', makeFromPicked);
    el.querySelector('#insp-pack-body').addEventListener('change', (e) => {
        const cb = e.target;
        if (!cb || !cb.classList || !cb.classList.contains('insp-pack-check')) return;
        if (cb.checked) picked.add(cb.value); else picked.delete(cb.value);
        renderSummary();
    });
    return el;
}

function selectedPacks() {
    if (!parsed) return [];
    return parsed.packs.filter(p => picked.has(p.no));
}

function renderSummary() {
    const sum = document.getElementById('insp-pack-summary');
    const btn = document.getElementById('insp-pack-make-btn');
    const packs = selectedPacks();
    const n = previewCount(packs).total;
    const existing = State.appState.inspectionList || [];
    const willAdd = mergeList(existing, buildCards(packs, null, '')).added;
    if (sum) {
        sum.textContent = `선택 ${packs.length}개 → ${n}장` + (packs.length && willAdd !== n ? ` (이미 목록에 있거나 서로 겹쳐서 빠지는 ${n - willAdd}건 → ${willAdd}장 추가)` : '');
    }
    if (btn) btn.disabled = busy || packs.length === 0;
}

function renderNotes() {
    const el = document.getElementById('insp-pack-notes');
    if (!el || !parsed) return;
    const lines = [];
    lines.push(`기준 시각 ${escapeHtml(fmtMs(parsed.updatedAtMs))} — 최신 패킹은 중국제작 부족수량 관리(신규·시험) [지금 갱신] 뒤 반영됩니다.`);
    const noCode = (parsed.counts.noSup || 0) + (parsed.counts.supNotCode || 0);
    if (noCode > 0) lines.push(`공급처코드 없는 품목 ${noCode}건은 상품명 기준으로 묶습니다.`);
    if (parsed.counts.badShip > 0) lines.push(`출고일을 읽지 못해 빠진 품목 ${parsed.counts.badShip}건이 있습니다.`);
    if (parsed.counts.dropped > 0) lines.push(`문서 크기 때문에 오래된 패킹 ${parsed.counts.dropped}개는 목록에서 빠졌습니다.`);
    if (parsed.error) lines.push(`<span class="text-red-600 font-bold">${escapeHtml(parsed.error)}</span>`);
    el.innerHTML = lines.map(l => `<div>${l}</div>`).join('');
}

function renderRows() {
    const body = document.getElementById('insp-pack-body');
    if (!body || !parsed) return;
    if (parsed.packs.length === 0) {
        body.innerHTML = `<div class="text-center text-gray-400 py-8">${parsed.error ? '패킹 목록을 불러오지 못했습니다.' : '고를 수 있는 입고예정 패킹이 없습니다.'}</div>`;
        return;
    }
    const existing = State.appState.inspectionList || [];
    const pc = previewCount(parsed.packs);
    const rows = parsed.packs.map(p => {
        const arrive = p.arriveDate ? `${md(p.arriveDate)} 도착`
            : (p.eta ? `${md(p.eta)}(예상)` : '-');
        const part = p.partial ? ' <span class="text-amber-600">일부 도착</span>' : '';
        const already = existingCount(p, existing);
        const alreadyTxt = already > 0 ? `<span class="text-amber-700">목록에 이미 ${already}건</span>` : '';
        return `
            <tr class="border-b last:border-0 hover:bg-indigo-50 ${p.arriveDate ? 'text-gray-400' : ''}">
                <td class="px-2 py-2 text-center"><input type="checkbox" class="insp-pack-check w-4 h-4" value="${escapeHtml(p.no)}" ${picked.has(p.no) ? 'checked' : ''}></td>
                <td class="px-2 py-2 font-mono text-gray-800">${escapeHtml(p.no)}</td>
                <td class="px-2 py-2">${escapeHtml(md(p.shipDate))}</td>
                <td class="px-2 py-2">${escapeHtml(arrive)}${part}</td>
                <td class="px-2 py-2 text-right">${p.items.length}</td>
                <td class="px-2 py-2 text-right font-bold">${pc.byPack[p.no] || 0}</td>
                <td class="px-2 py-2 text-xs">${alreadyTxt}</td>
            </tr>`;
    }).join('');
    body.innerHTML = `
        <table class="w-full text-sm text-gray-700">
            <thead class="text-xs text-gray-500 bg-gray-50">
                <tr><th class="px-2 py-1.5"></th><th class="px-2 py-1.5 text-left">패킹번호</th><th class="px-2 py-1.5 text-left">출고일</th>
                    <th class="px-2 py-1.5 text-left">도착</th><th class="px-2 py-1.5 text-right">품목</th><th class="px-2 py-1.5 text-right">장수</th><th class="px-2 py-1.5"></th></tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

export async function openPackPicker() {
    if (document.getElementById(PICKER_ID)) return;
    picked.clear();
    parsed = null;
    ensureShell();
    renderSummary();
    try {
        const snap = await getDoc(doc(State.db, ...DOC_PATH));
        if (!document.getElementById(PICKER_ID)) return;           // 읽는 사이 닫음
        parsed = parseInspPacks(snap.exists() ? snap.data() : null);
    } catch (e) {
        console.warn('inspPacks 읽기 실패:', e && e.code ? e.code : e);
        if (!document.getElementById(PICKER_ID)) return;
        parsed = parseInspPacks(null);
        parsed.error = '패킹 목록을 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.';
    }
    renderRows();
    renderNotes();
    renderSummary();
}

/** 상품명마다 product_history 두께를 읽는다(동시 8개, 실패는 무시) → Map(상품명 → 두께) */
async function loadHistoryThickness(names) {
    const out = new Map();
    const queue = names.slice();
    const worker = async () => {
        while (queue.length) {
            const name = queue.shift();
            try {
                const snap = await getDoc(doc(State.db, 'product_history', name.replace(/\//g, '-')));
                if (snap.exists()) {
                    const t = thicknessFromHistoryDoc(snap.data());
                    if (t) out.set(name, t);
                }
            } catch (e) { /* 없거나 못 읽으면 다음 대체(날짜별 목록)로 */ }
        }
    };
    await Promise.all(Array.from({ length: Math.min(HIST_CONCURRENCY, queue.length) }, worker));
    return out;
}

/** 로케이션관리 자리 목록 — location.js 와 같은 ZONE_* 문서(자리 id → 자리 map). 공급처 열이 섞인 rawDataStr 는 꺼내지 않는다(CLAUDE.md 3절). */
async function loadLocationItems() {
    const snap = await getDocs(query(collection(State.db, 'Locations'), where(documentId(), '>=', 'ZONE_'), where(documentId(), '<=', 'ZONE_\uf8ff')));
    const items = [];
    snap.forEach(docSnap => {
        const zone = docSnap.data() || {};
        for (const id in zone) {
            const o = zone[id];
            if (!o || typeof o !== 'object') continue;
            items.push({ id, name: o.name, option: o.option, category: o.category });
        }
    });
    return items;
}

async function makeFromPicked() {
    if (busy) return;
    const packs = selectedPacks();
    if (packs.length === 0) return;
    busy = true;
    const btn = document.getElementById('insp-pack-make-btn');
    if (btn) { btn.disabled = true; btn.textContent = '만드는 중...'; }
    try {
        const today = getTodayDateString();
        let days = [];
        try { days = await fetchAllHistoryData(); } catch (e) { console.warn('이력 조회 실패(샘플위치·두께 참고 없이 진행):', e); }
        const refs = refsFromDays(days);
        let locNote = '';
        try {
            const loc = samplesFromLocations(await loadLocationItems());
            refs.sampleByLoc = loc.byKey;
            refs.sampleByLocColor = loc.byColor;
            refs.sampleByLocName = loc.byName;
        } catch (e) {
            // 권한으로 막히면 조용히 이력만 쓴다. 그 밖의 실패는 한 줄 안내.
            console.warn('로케이션관리 조회 실패(샘플위치는 지난 검수 기록으로만):', e && e.code ? e.code : e);
            if (!(e && e.code === 'permission-denied')) locNote = ' · 로케이션관리를 읽지 못해 샘플위치는 지난 검수 기록으로만 채웠습니다';
        }
        const names = [...new Set(buildCards(packs, null, today).map(c => c.name).filter(Boolean))];
        refs.thickByDoc = await loadHistoryThickness(names);
        const cards = buildCards(packs, refs, today);
        if (cards.length === 0) { showToast('선택한 패킹에 만들 항목이 없습니다.', true); return; }
        const { merged, added, skipped } = mergeList(State.appState.inspectionList || [], cards);
        if (added === 0) {
            showToast(`0장 추가, 이미 있거나 겹쳐서 빠진 ${skipped}건${locNote}`);
        } else {
            const ok = await updateDailyData({ inspectionList: merged });
            if (ok === false) { showToast('검수 리스트를 저장하지 못했습니다.', true); return; }
            State.appState.inspectionList = merged;
            showToast(`${added}장 추가, 이미 있거나 겹쳐서 빠진 ${skipped}건 (총 ${merged.length}개)${locNote}`);
        }
        busy = false;
        closePicker();
        renderTodoList();
        openInspectionListWindow();
    } catch (err) {
        console.error('패킹으로 검수 리스트 만들기 실패:', err);
        showToast('검수 리스트를 만드는 중 오류가 발생했습니다.', true);
    } finally {
        busy = false;
        const b = document.getElementById('insp-pack-make-btn');
        if (b) { b.textContent = '만들기'; renderSummary(); }
    }
}
