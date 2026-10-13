// === js/d-chart.js ===
// 데이터 관리 화면 차트의 D안 팔레트. 데이터 색은 라이트·다크 공통이다.
// 축·격자·범례 글자색은 history.html 의 Chart.defaults 가 맡는다(값을 여기 line·text 와 같게 유지).
// ⚠ accentRgb·okRgb 는 'rgb(r, g, b)' 형식이어야 한다 — 예측 차트가 .replace(')', ', 0.1)') 로 투명도를 만든다.

export const D = {
    accent: '#2F62C9', accentRgb: 'rgb(47, 98, 201)', accentMid: '#7FA1E6', accentLight: '#C4D4F5',
    ok: '#5A9E96', okRgb: 'rgb(90, 158, 150)', warn: '#D2A266', risk: '#C9808A',
    line: '#E6E8EC', lineStrong: '#D6DAE0', text3: '#8A9099'
};

/** '#RRGGBB' → 'rgba(r, g, b, a)' */
export const alpha = (hex, a) => {
    const n = parseInt(String(hex).replace('#', ''), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
