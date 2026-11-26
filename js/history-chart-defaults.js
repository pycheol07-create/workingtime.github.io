// D안 차트 기본값 (history.html 만 — index 메인 대시보드 차트에는 넣지 않는다). js/d-chart.js 의 값과 같게 유지.
// chart.js 를 defer 로 받으므로 이 파일도 defer 로, chart.js 바로 뒤에 둔다(문서 순서대로 실행 → 화면 모듈보다 먼저). 2026-11-26
(function () {
    if (!window.Chart) return;
    const dark = document.documentElement.classList.contains('dark');
    Chart.defaults.font.family = "'SUIT', 'Noto Sans KR', 'Malgun Gothic', sans-serif";
    Chart.defaults.color = dark ? '#A9B0BA' : '#646B75';
    Chart.defaults.borderColor = dark ? '#2C323A' : '#E6E8EC';
})();
