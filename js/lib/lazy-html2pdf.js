// === js/lib/lazy-html2pdf.js — PDF 라이브러리(html2pdf)를 처음 쓸 때 받는다(2026-11-26 성능 점검) ===
// 데이터 관리 화면이 첫 화면 전에 약 1MB 를 받던 것을 [PDF 저장] 을 누를 때로 미룬다.
// 주소·무결성 값은 예전 history.html <script> 와 같다(worktime.html 은 지금처럼 태그로 받는다 — 이미 있으면 바로 끝).
const SRC = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
const SRI = 'sha384-Yv5O+t3uE3hunW8uyrbpPW3iw6/5/Y7HitWJBLgqfMoA36NogMmy+8wWZMpn3HWc';

let pending = null;

/** html2pdf 를 쓸 수 있게 한다 → true / 못 받으면 false(예외 없음). 실패하면 다음 호출 때 다시 시도한다. */
export function ensureHtml2pdf() {
    if (typeof window !== 'undefined' && typeof window.html2pdf !== 'undefined') return Promise.resolve(true);
    if (pending) return pending;
    pending = new Promise((resolve) => {
        const s = document.createElement('script');
        s.src = SRC;
        s.integrity = SRI;
        s.crossOrigin = 'anonymous';
        s.referrerPolicy = 'no-referrer';
        s.onload = () => resolve(typeof window.html2pdf !== 'undefined');
        s.onerror = () => { s.remove(); resolve(false); };
        document.head.appendChild(s);
    }).then((ok) => { if (!ok) pending = null; return ok; });
    return pending;
}
