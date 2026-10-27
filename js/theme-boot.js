// === js/theme-boot.js === 다크 모드 판정 (2026-10-22, 모든 화면 다크 적용)
// <head> 에서 스타일시트보다 먼저, 일반 <script src> 로(defer·module 금지) 불러야 첫 화면이 깜빡이지 않는다.
//   <script src="js/theme-boot.js?v=202610271255"></script>     (calculator/ 는 ../js/theme-boot.js)
// 판정은 index.html <head> 인라인 스크립트와 같다 — localStorage 'color-theme'('dark'|'light'), 없으면 OS 설정.
//   키는 대시보드 토글이 쓴다. 이 파일은 읽기만 한다.
//   index·admin·history·manual·products 는 아직 각자 인라인 스크립트를 쓴다(같은 규칙 — 바꾸면 같이 바꿀 것).
// 공통 상단바(js/app-shell.js)는 html.dark 를 따라간다.
(function () {
    var dark = false;
    try {
        var v = localStorage.getItem('color-theme');
        dark = v === 'dark' || (v === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (e) { /* 저장소 막힘 — 밝게 */ }
    document.documentElement.classList.toggle('dark', dark);
})();
