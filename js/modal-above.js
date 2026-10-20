// === js/modal-above.js ===
// 표 창(.modal-overlay, JS 로 여닫는 창)의 ESC 처리에서 같이 쓴다 — js/refill-table.js · js/locrec-table.js.
//   '이 창보다 z 가 큰, 화면을 덮는 고정 창이 보이는가' — 보이면 ESC 를 그 창(js/modal-esc.js 등)에 맡긴다.
//   대시보드(index)에서 연장근무 확인창(z-200) 같은 위 창을 밑에 깔린 표 창이 가로채지 않게.

const zOf = (el) => { const z = parseInt(getComputedStyle(el).zIndex, 10); return Number.isNaN(z) ? 0 : z; };

/** modal 보다 위(z 가 큰)에 화면을 덮는 창이 보이면 true (.fixed.inset-0 · .modal-overlay · inline position:fixed 오버레이) */
export function higherOpenThan(modal) {
    const myZ = zOf(modal);
    return Array.from(document.querySelectorAll('.fixed.inset-0, .modal-overlay, body > div[style*="position:fixed"], body > div[style*="position: fixed"]'))
        .some(el => {
            if (el === modal || modal.contains(el) || el.classList.contains('hidden')) return false;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || cs.position !== 'fixed') return false;
            const r = el.getBoundingClientRect();     // 화면을 덮는 창만(띠·토스트 같은 작은 고정 요소는 빼고)
            return zOf(el) > myZ && r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.5;
        });
}
