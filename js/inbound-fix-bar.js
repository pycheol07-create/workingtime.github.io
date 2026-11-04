// === js/inbound-fix-bar.js ===
// 입고확인 수정 대기 막대(2026-11-04) — 화면 아래 고정: "입고확인 수정 n건 [저장] [취소]".
// 기존 화면(js/china-stock-goods.js)·신규 화면(js/china-mibal2.js)이 같이 쓴다. Firestore 는 다루지 않는다(import 없음) —
// 저장·취소는 화면이 넘긴 onSave·onCancel 이 한다. 대기가 있으면 창을 닫을 때 브라우저 확인(beforeunload)을 띄운다.

// ── 미뤄 둔 표 다시 그리기를 '클릭이 끝난 뒤'로 ──
// 입고확인 칸을 나가는 것은 보통 다른 곳을 누를 때(mousedown)다. 그 사이(mousedown~click)에 표를 새로 그리면 누른 칸이 사라져
// 첫 클릭이 없어진다. 마우스를 누르고 있으면 손을 뗀 뒤(click 처리 뒤) 그린다. 키보드(Tab)로 나가면 바로 다음 차례.
let ptrDown = false;
if (typeof document !== 'undefined') {
    document.addEventListener('pointerdown', () => { ptrDown = true; }, true);
    const up = () => { ptrDown = false; };
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
}
/** fn 을 지금 진행 중인 클릭이 끝난 뒤 한 번 부른다(누르고 있지 않으면 바로 다음 차례) */
export function afterClick(fn) {
    if (!ptrDown) { setTimeout(fn, 0); return; }
    let done = false;
    const run = () => { if (done) return; done = true; setTimeout(fn, 0); };
    // pointerup → mouseup → click 이 한 차례로 이어진다 — pointerup 에서 setTimeout 하면 click 처리 뒤에 돈다
    document.addEventListener('pointerup', run, { once: true, capture: true });
    document.addEventListener('pointercancel', run, { once: true, capture: true });
    setTimeout(run, 3000);   // 손을 창 밖에서 떼어 pointerup 이 안 와도 언젠가는 그린다
}

/**
 * opts = { onSave(), onCancel(), note?(안내 문구) }
 * → { update({ count, outside, progress }), disarm() }
 *   count = 대기 건수 · outside = 그중 지금 표에 안 보이는 건수 · progress = { done, total } | null(저장 중 표시)
 *   disarm() — 화면을 떠나야 할 때(은퇴 화면 이동 등) 닫기 확인을 끈다
 */
export function createFixBar(opts) {
    const o = opts || {};
    const bar = document.createElement('div');
    bar.id = 'inbound-fix-bar';
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'display:none; position:fixed; left:50%; bottom:14px; transform:translateX(-50%); z-index:9000;'
        + ' background:var(--c-warn-bg,#fff6d6); color:var(--c-text,#222); border:1px solid var(--c-line-strong,#ccc);'
        + ' border-radius:999px; padding:8px 16px; box-shadow:0 4px 16px rgba(0,0,0,.18); font-size:13px;'
        + ' align-items:center; gap:10px; white-space:nowrap; max-width:96vw;';
    const btn = 'border:1px solid var(--c-line-strong,#ccc); border-radius:999px; padding:5px 14px; font-weight:700; cursor:pointer; font-family:inherit; font-size:13px;';
    bar.innerHTML = '<b id="inbound-fix-count"></b>'
        + `<button type="button" id="btn-fix-save" style="${btn} background:var(--c-accent,#2f6fed); color:var(--c-on-fill,#fff); border-color:var(--c-accent,#2f6fed);">저장</button>`
        + `<button type="button" id="btn-fix-cancel" style="${btn} background:var(--c-surface,#fff); color:var(--c-text,#222);">취소</button>`
        + '<span id="inbound-fix-note" style="color:var(--c-text-2,#555); font-size:12px; white-space:normal;"></span>';
    document.body.appendChild(bar);
    const $c = bar.querySelector('#inbound-fix-count');
    const $s = bar.querySelector('#btn-fix-save');
    const $x = bar.querySelector('#btn-fix-cancel');
    const $n = bar.querySelector('#inbound-fix-note');
    const note = o.note || '입고확인만 [저장]을 눌러야 기록됩니다(다른 칸은 자동 저장).';
    let count = 0, busy = false, armed = true;
    $s.addEventListener('click', () => { if (!busy && o.onSave) o.onSave(); });
    $x.addEventListener('click', () => { if (!busy && o.onCancel) o.onCancel(); });
    window.addEventListener('beforeunload', (e) => {
        if (!armed || !count) return;
        e.preventDefault();
        e.returnValue = '';
    });
    function update({ count: c, outside, progress } = {}) {
        count = Math.max(0, parseInt(c) || 0);
        busy = !!progress;
        if (!count && !busy) { bar.style.display = 'none'; return; }
        bar.style.display = 'flex';
        if (busy) {
            $c.textContent = `입고확인 ${progress.done}/${progress.total} 기록 중…`;
            $n.textContent = '창을 닫지 마세요.';
        } else {
            $c.textContent = `입고확인 수정 ${count}건`;
            $n.textContent = (outside ? `표에 없는 ${outside}건 포함 · ` : '') + note;
        }
        $s.disabled = busy; $x.disabled = busy;
    }
    return { update, disarm: () => { armed = false; } };
}
