// === js/mibal2-boxcheck.js — 부족수량관리(신규) [박스 확인] 창(2026-11-26 사용자 요청) ===
// 박스 라벨을 스캐너로 찍거나 번호를 치면 그 박스에 미발 상품이 들었는지 크게 보여 준다(읽기만 — Firestore 를 따로 읽지 않는다).
//   · 박스 번호 = 표 '박스' 열과 같은 자료(china-mibal2.js 가 읽어 둔 packBoxes, 고른 출고일의 패킹들).
//   · 미발 = 표의 '미발수량(추가 출고)'(행 mibal) > 0. 계산은 js/lib/box-check.js.
//   · 라벨 바코드 모양을 아직 모른다 — 찍힌 글자에서 박스 번호 후보를 뽑아 그 출고일 패킹에 있는 번호만 고른다.
//     찍힌 글자는 창 안 '찍은 기록'에만 보이고 저장하지 않는다.
// china-mibal2.js 는 setupBoxCheck({ getRows, getPacksOn, getDatesText, getState }) 한 번만 부른다.
//   getState = 'rows'(표를 아직 못 만듦 — 판정 안 함) · 'boxes'(박스 자료 읽는 중) · 'fail'(박스 자료 읽기 실패) · 'ok'
//   표에 없는 상품이 든 박스는 '미발 없음'(초록)으로 보이지 않는다(회색 '확인 못 함').
import { boxIndex, findBox, boxReport } from './lib/box-check.js?v=77d9395a8d04-51027250';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (n) => Number(n || 0).toLocaleString('ko-KR');
const HIST_MAX = 15;

/**
 * @param {{ getRows:()=>object[], getPacksOn:()=>object[]|null, getDatesText:()=>string }} o
 *   getRows = 고른 출고일의 전체 행(검색·필터 전), getPacksOn = pack-boxes packsOn 결과(박스 자료 못 읽었으면 null)
 */
export function setupBoxCheck(o) {
    const modal = $('boxchk-modal'), input = $('boxchk-input'), out = $('boxchk-result'), hist = $('boxchk-hist');
    const btn = $('btn-box-check');
    if (!modal || !input || !btn || modal.dataset.wired) return;
    modal.dataset.wired = '1';   // 로그인 상태가 다시 바뀌어 두 번 불려도 이벤트는 한 벌
    const history = [];
    let idx = null;

    const state = () => (o.getState ? o.getState() : 'ok');
    const rebuild = () => { const on = o.getPacksOn(); idx = on ? boxIndex(on) : new Map(); };
    const srcText = () => {
        const st = state();
        if (st === 'rows') return '부족수량 표를 아직 만드는 중입니다';
        if (st === 'boxes') return '박스 번호 자료를 읽는 중입니다';
        if (st === 'fail') return '박스 번호 자료를 읽지 못했습니다(새로고침)';
        return idx.size ? `이 출고일 패킹의 박스 ${num(idx.size)}개` : '고른 출고일에 박스 번호 자료가 없습니다(패킹봇이 보낸 패킹만 있음)';
    };
    const open = () => {
        rebuild();
        $('boxchk-dates').textContent = o.getDatesText() || '출고일 없음';
        $('boxchk-src').textContent = srcText();
        modal.style.display = 'flex';
        input.value = '';
        setTimeout(() => input.focus(), 0);
    };
    const close = () => { modal.style.display = 'none'; };

    const rowsByCode = () => { const m = {}; (o.getRows() || []).forEach(r => { if (r && r.code) m[r.code] = r; }); return m; };

    function showHit(box, packs, raw, weak) {
        const rep = boxReport(packs, rowsByCode());
        const has = rep.mibalCodes > 0;
        const unsure = !has && rep.unknown > 0;   // 표에 없는 상품이 있으면 '없음'이라 말하지 않는다
        const multi = rep.packs.length > 1 || rep.packs.some(p => p.tag);
        const say = has ? `미발 상품 있음 — ${num(rep.mibalCodes)}개 상품 · 미발 ${num(rep.mibalQty)}개`
            : unsure ? `미발 확인 못 함 — 표에 없는 상품 ${num(rep.unknown)}개` : '미발 상품 없음';
        let h = `<div class="bc-banner ${has ? 'bc-yes' : unsure ? 'bc-ask' : 'bc-no'}" role="status">
            <div class="bc-box">${esc(box)}번 박스</div>
            <div class="bc-say">${say}</div>
            <div class="bc-sub">박스 안 상품 ${num(rep.total)}개${multi ? ` · 패킹 ${rep.packs.length}개에 같은 번호` : ''}${has && rep.unknown ? ` · 표에 없는 상품 ${num(rep.unknown)}개는 확인 못 함` : ''}</div>
            ${weak ? `<div class="bc-warn">라벨 글자 '${esc(raw)}' 에서 ${esc(box)}번으로 읽었습니다 — 라벨의 박스 번호와 맞는지 확인하세요</div>` : ''}</div>`;
        rep.packs.forEach(p => {
            if (multi) h += `<div class="bc-pack">${esc(p.tag || p.key)} 패킹 — 미발 ${num(p.mibalCodes)}개 상품</div>`;
            h += '<table class="bc-table"><thead><tr><th>상품코드</th><th>상품명</th><th>옵션</th><th>미발</th></tr></thead><tbody>';
            p.items.forEach(x => {
                h += `<tr class="${x.mibal > 0 ? 'bc-hit' : ''}"><td>${esc(x.code)}</td><td class="bc-name" title="${esc(x.name)}">${x.inTable ? esc(x.name) : '<span class="t-3">이 출고일 표에 없음</span>'}</td>`
                    + `<td>${esc(x.option)}</td><td>${x.mibal > 0 ? `<b>${esc(num(x.mibal))}</b>` : '<span class="t-3">0</span>'}</td></tr>`;
            });
            h += '</tbody></table>';
        });
        out.innerHTML = h;
        return { text: has ? `미발 ${num(rep.mibalCodes)}개 상품` : unsure ? '확인 못 함' : '미발 없음', cls: has ? 'bc-h-yes' : unsure ? 'bc-h-ask' : 'bc-h-no' };
    }

    function addHist(raw, text, cls) {
        history.unshift({ raw, text, cls, at: new Date() });
        if (history.length > HIST_MAX) history.pop();
        hist.innerHTML = history.map(x => `<li class="${esc(x.cls)}"><span class="t-3">${esc(x.at.toTimeString().slice(0, 5))}</span> <b>${esc(x.raw)}</b> — ${esc(x.text)}</li>`).join('');
    }

    function check(raw, pick) {
        const s = String(raw || '').trim();
        if (!s) return;
        rebuild();   // 박스 자료가 창을 연 뒤에 읽혀도 바로 쓴다(가벼움)
        $('boxchk-src').textContent = srcText();
        const st = state();
        if (st !== 'ok') {
            out.innerHTML = `<div class="bc-banner bc-ask" role="status"><div class="bc-say">${esc(srcText())}</div><div class="bc-sub">${st === 'fail' ? '화면을 새로고침한 뒤 다시 찍으세요.' : '잠시 뒤 다시 찍으세요.'}</div></div>`;
            addHist(s, '아직 판정 안 함', 'bc-h-ask');
            input.value = ''; input.focus();
            return;
        }
        const r = pick && idx.has(pick) ? { status: 'hit', box: pick, packs: idx.get(pick), weak: false } : findBox(s, idx);
        if (r.status === 'hit') { const t = showHit(r.box, r.packs, s, r.weak); addHist(s, `${r.box}번 · ${t.text}`, t.cls); }
        else if (r.status === 'many') {
            out.innerHTML = `<div class="bc-banner bc-ask" role="status"><div class="bc-say">박스 번호가 여럿으로 읽힙니다 — 고르세요</div>
                <div class="bc-choices">${r.choices.map(b => `<button type="button" class="d-btn" data-box="${esc(b)}">${esc(b)}번</button>`).join('')}</div></div>`;
            out.querySelectorAll('[data-box]').forEach(b => b.addEventListener('click', () => { check(s, b.dataset.box); input.focus(); }));
            addHist(s, '번호 고르기', 'bc-h-ask');
        } else if (r.status === 'empty') {
            out.innerHTML = '<div class="bc-banner bc-ask" role="status"><div class="bc-say">고른 출고일에 박스 번호 자료가 없습니다</div><div class="bc-sub">출고일을 확인하세요. 패킹봇이 보낸 패킹만 박스 번호가 있습니다.</div></div>';
            addHist(s, '자료 없음', 'bc-h-ask');
        } else {
            out.innerHTML = `<div class="bc-banner bc-ask" role="status"><div class="bc-say">이 출고일 패킹에 없는 박스입니다</div>
                <div class="bc-sub">읽은 번호: ${r.candidates.length ? r.candidates.map(esc).join(', ') : '없음'} — 출고일이 맞는지, 라벨이 이 패킹 것인지 확인하세요.</div></div>`;
            addHist(s, '없는 박스', 'bc-h-ask');
        }
        input.value = '';
        input.focus();
    }

    btn.addEventListener('click', open);
    $('btn-boxchk-close').addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    $('boxchk-form').addEventListener('submit', (e) => { e.preventDefault(); check(input.value); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.style.display === 'flex') close(); });
    return { open, close, check, rebuild };
}
