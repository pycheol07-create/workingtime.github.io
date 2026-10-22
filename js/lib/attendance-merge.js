// === js/lib/attendance-merge.js ===
// 마감 때 그날 근태(dailyAttendance)를 서버 값과 이 탭의 메모리 값으로 합친다 — 서버가 이긴다. (2026-10-22)
//
//   예전엔 { ...서버, ...메모리 } 라 오래 켜 둔 탭의 옛 근태가 다른 PC 에서 고친 값을 덮었다.
//   · 메모리에만 있는 사람은 살린다(아직 서버에 안 올라간 출근).
//   · 둘 다 있으면 서버 값.
//   · 사람마다 값을 얕게 복사한다 — 마감은 이 결과의 객체를 직접 바꿔(status·outTime) 저장하므로,
//     복사하지 않으면 State.appState.dailyAttendance 나 서버 스냅샷 객체가 같이 바뀐다.
// 순수 모듈(DOM/Firebase 의존 없음).

const copy = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : v);
const asObj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export function mergeAttendanceServerFirst(server, local) {
    const s = asObj(server);
    const out = {};
    for (const [member, a] of Object.entries(asObj(local))) {
        if (!Object.prototype.hasOwnProperty.call(s, member)) out[member] = copy(a);
    }
    for (const [member, a] of Object.entries(s)) out[member] = copy(a);
    return out;
}
