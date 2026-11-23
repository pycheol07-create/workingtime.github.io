// === js/total-insp-excel-ui.js ===
// 전량검수 [엑셀 업로드](2026-11-20 사용자 요청) — 파일 읽기 → 상품코드로 상품 찾기 → 확인 창(사유 입력) → 진행 목록에 넣기.
//   머리글은 '상품코드', '수량'. 상품명·옵션·로케이션은 상품 DB(js/products-store.js)에서, 수량은 검수수량(totalStock).
//   규칙은 js/lib/total-insp-excel.js, 넣기(트랜잭션·완료 상품 새 회차 확인)는 js/total-inspection-logic.js addTotalItemsFromExcel.
//   ⚠️ 이 창은 index.html·history.html 에 붙는다 — role="dialog"·data-act·end-shift-* 를 쓰지 않는다(업무마감봇 선택자).
//   엑셀 내용(상품코드·수량)은 화면에만 쓰고 로그·서버에 원본을 남기지 않는다.
import * as State from './state.js?v=202611240857';
import { showToast, escapeHtml } from './utils.js?v=202611240857';
import { S as PS, loadCatalog, loadLoc, locOf } from './products-store.js?v=202611240857';
import { parseSheetRows, matchRows, buildItems, summaryLines } from './lib/total-insp-excel.js?v=202611240857';
import { resolveHistory } from './inspection-manual.js?v=202611240857';   // 이력 상품명 찾기 — [개별 추가]와 같은 함수
import { addTotalItemsFromExcel } from './total-inspection-logic.js?v=202611240857';

const BOX_ID = 'total-insp-excel-box';
let busy = false;

async function readAoa(file) {
    if (!window.XLSX) throw Object.assign(new Error('XLSX 없음'), { userMessage: '엑셀 읽기 도구가 아직 준비되지 않았습니다. 잠시 뒤 다시 눌러 주세요.' });
    const buf = await file.arrayBuffer();
    const wb = window.XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw Object.assign(new Error('시트 없음'), { userMessage: '엑셀에 시트가 없습니다.' });
    let base = 0;   // 시트 사용 범위의 첫 줄(위쪽 빈 줄을 빼고 저장된 파일 — 못 넣은 줄 번호를 엑셀과 맞춘다)
    try { if (ws['!ref']) base = window.XLSX.utils.decode_range(ws['!ref']).s.r; } catch (e) { base = 0; }
    return { aoa: window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), base };
}

/** 찾은 옵션마다 이력 문서 이름(옛 상품명) — 5개씩 나눠 읽는다. 못 읽으면 상품 DB 이름(resolveHistory 가 빈 이름을 돌려줌) */
async function historyNamesOf(matches) {
    const out = new Array(matches.length).fill('');
    for (let i = 0; i < matches.length; i += 5) {
        const part = await Promise.all(matches.slice(i, i + 5).map(m => resolveHistory(m.cand, [m.opt.code]).then(h => (h && h.name) || '').catch(() => '')));
        part.forEach((n, j) => { out[i + j] = n; });
    }
    return out;
}

function closeBox() {
    const b = document.getElementById(BOX_ID);
    if (b) b.remove();
}

/** 확인 창 — 요약·못 넣는 줄·사유 입력. 넣기를 누르면 사유를, 취소면 null 을 돌려준다. */
function askReason(sum, canAdd) {
    closeBox();
    return new Promise((resolve) => {
        const box = document.createElement('div');
        box.id = BOX_ID;
        box.className = 'fixed inset-0 bg-gray-900/70 flex items-center justify-center z-[80] p-4';
        box.innerHTML = `
            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col">
                <div class="p-4 border-b border-gray-200">
                    <h3 class="text-base font-bold text-gray-900">엑셀로 전량검수 넣기</h3>
                    <p class="text-sm text-gray-700 mt-1">${escapeHtml(sum.head)}</p>
                </div>
                <div class="p-4 overflow-y-auto space-y-3">
                    ${sum.bad.length ? `<div class="text-xs text-red-700 bg-red-50 rounded-lg p-2 space-y-0.5">
                        <div class="font-bold">넣지 않는 줄</div>
                        ${sum.bad.map(t => `<div>${escapeHtml(t)}</div>`).join('')}
                        ${sum.more ? `<div>… 외 ${sum.more}줄</div>` : ''}
                    </div>` : ''}
                    ${canAdd ? `<label class="block text-xs font-bold text-gray-600">검수 사유 <span class="text-red-500">*</span> (넣는 상품 공통)
                        <input type="text" id="total-insp-excel-reason" maxlength="60" class="mt-1 w-full p-2 border border-gray-300 rounded-lg text-sm" placeholder="예: 불량 다발 · 고객 클레임">
                    </label>
                    <p class="text-[11px] text-gray-500">상품명·옵션·로케이션은 상품코드로 채우고, 수량은 검수수량으로 넣습니다. 고객 이름·연락처는 적지 마세요.</p>` : '<p class="text-sm text-gray-600">넣을 수 있는 상품이 없습니다.</p>'}
                </div>
                <div class="p-4 bg-gray-50 rounded-b-2xl flex justify-end gap-2">
                    <button type="button" data-x="cancel" class="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-bold min-h-[44px]">${canAdd ? '취소' : '닫기'}</button>
                    ${canAdd ? '<button type="button" data-x="ok" class="px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm font-bold min-h-[44px]">넣기</button>' : ''}
                </div>
            </div>`;
        document.body.appendChild(box);
        const input = box.querySelector('#total-insp-excel-reason');
        const done = (v) => { closeBox(); resolve(v); };
        const ok = () => {
            const r = input ? input.value.trim() : '';
            if (!r) { showToast('전량검수 사유를 입력해 주세요.', true); if (input) input.focus(); return; }
            done(r);
        };
        box.addEventListener('click', (e) => {
            const x = e.target.closest('[data-x]');
            if (x) { if (x.dataset.x === 'ok') ok(); else done(null); return; }
            if (e.target === box) done(null);
        });
        if (input) {
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } if (e.key === 'Escape') done(null); });
            setTimeout(() => input.focus(), 0);
        }
    });
}

/** [엑셀 업로드] 파일을 골랐을 때 */
export async function uploadTotalExcel(file) {
    if (busy) { showToast('엑셀을 처리하는 중입니다.', true); return; }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        showToast('인터넷 연결이 끊겨 넣지 못했습니다.', true);
        return;
    }
    busy = true;
    try {
        const sheet = await readAoa(file);
        const parsed = parseSheetRows(sheet.aoa, sheet.base);
        if (!parsed.ok) { showToast(parsed.message, true); return; }
        if (!parsed.rows.length && !parsed.errors.length) { showToast('엑셀에 상품 줄이 없습니다.', true); return; }
        showToast('상품코드로 상품을 찾는 중…');
        if (!PS.db) PS.db = State.db;
        await loadCatalog();
        try { await loadLoc(); } catch (e) { console.warn('[전량 엑셀] 위치 읽기 실패(로케이션 없이 넣음):', e && e.code ? e.code : e); }
        const m = matchRows(parsed.rows, PS.products);
        const b = buildItems(m.matches, { historyNames: await historyNamesOf(m.matches), locOf });
        const items = b.items;
        const missing = [...m.missing, ...b.missing];
        const reason = await askReason(summaryLines({ items, missing, errors: parsed.errors }), items.length > 0);
        if (!reason || !items.length) return;
        await addTotalItemsFromExcel(items.map(({ lines, ...it }) => it), reason);   // 줄 번호는 확인 창용 — 문서에 넣지 않는다
    } catch (e) {
        console.error('[전량 엑셀] 실패:', e && e.code ? e.code : (e && e.message));
        showToast(e && e.code === 'permission-denied' ? '넣을 권한이 없습니다.'
            : (e && e.userMessage) || '엑셀을 넣지 못했습니다. 파일을 확인한 뒤 다시 올려 주세요.', true);
    } finally {
        busy = false;
    }
}
