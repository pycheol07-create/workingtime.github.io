// === js/lib/kst-time.js ===
// 저장된 UTC ISO 시각('2026-10-16T15:30:00.000Z') → 한국시간 'YYYY-MM-DD HH:mm' (화면 표시용 — 저장값은 그대로 UTC).
//   비품 재고 변동 이력(js/supplies.js)의 at: 화면 조정·이지어드민 연동(비품재고연동\연동.py) 모두 UTC ISO 로 쓴다.
//   예전엔 at.slice(0, 10) 로 UTC 날짜를 보여 줘 한국시간 00:00~08:59 기록이 전날로 보였다.
// 한국은 서머타임이 없어 +9시간 고정 — PC 시간대 설정과 상관없이 같은 결과.
// 시간대 표시(Z·+09:00 등)가 없는 글자는 무엇 기준인지 몰라 예전처럼 앞 10자리(날짜)만 보인다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HAS_TZ = /(?:Z|[+-]\d{2}:?\d{2})$/i;

export function kstDateTime(at) {
    const s = typeof at === 'string' ? at.trim() : '';
    const ms = HAS_TZ.test(s) ? Date.parse(s) : NaN;
    if (!Number.isFinite(ms)) return String(at).slice(0, 10);
    const d = new Date(ms + KST_OFFSET_MS);
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
