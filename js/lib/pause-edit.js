// js/lib/pause-edit.js
//
// '기록 관리' 표의 휴게시간(분 숫자) 수정 — 분 숫자를 휴식 구간(pauses)으로 바꾸는 순수 함수.
//
// 왜 순수 함수인가
//   저장되는 값은 시간대 목록이고 소요시간·인건비는 그 목록에서 계산된다(utils.js calcElapsedMinutes).
//   '입력한 분 = 실제로 빠지는 분' 이 항상 맞아야 해서 DOM·Firebase 없이 따로 시험한다(tests/pause-edit.test.js).

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// 형식이 틀리면 null
const 분으로 = (hhmm) => (typeof hhmm === 'string' && HHMM.test(hhmm)
    ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
    : null);
const 시각으로 = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * 소요시간에서 실제로 빠진 분 — 닫힌 양수 구간의 합(calcElapsedMinutes 와 같은 기준).
 * calcTotalPauseMinutes 는 end 없는 구간을 현재 시각까지 세므로 입력칸 초기값에 쓰지 않는다.
 */
export function deductedPauseMinutes(pauses) {
    return (Array.isArray(pauses) ? pauses : []).reduce((sum, p) => {
        const s = 분으로(p?.start);
        const e = 분으로(p?.end);
        return s !== null && e !== null && e > s ? sum + (e - s) : sum;
    }, 0);
}

// 검사를 통과한 pauses 를 분 단위 구간으로 — 닫힌 구간만, 기록 범위로 자르고, 겹침은 합친다.
function 정리(list, 시작, 종료) {
    const items = list
        .filter(p => p.end !== null && p.end !== undefined && p.end !== '')
        .map(p => ({ src: p, s: Math.max(분으로(p.start), 시작), e: Math.min(분으로(p.end), 종료) }))
        .filter(i => i.e > i.s)
        .sort((a, b) => a.s - b.s);
    const merged = [];
    items.forEach(i => {
        const last = merged[merged.length - 1];
        // 맞닿기만 한 구간은 겹침이 아니다 — 합치면 뒤 구간의 type 이 사라진다
        if (last && i.s < last.e) last.e = Math.max(last.e, i.e);
        else merged.push(i);
    });
    return merged;
}

/**
 * 휴식 합계가 정확히 minutes 분이 되도록 고친 새 pauses 를 만든다. 입력 배열은 바꾸지 않는다.
 * 줄일 때는 뒤 구간의 끝부터 앞당기고, 늘릴 때는 마지막 구간의 끝 → 앞 구간의 끝 → 첫 구간의 시작 순으로 넓힌다.
 * minutes 는 기록 길이보다 작아야 한다 — 소요시간이 0분이 되면 저장 함수가 기록을 삭제한다.
 * @returns {{pauses:Array}|{error:string}}
 */
export function setPauseMinutes(pauses, minutes, startTime, endTime) {
    const 시작 = 분으로(startTime);
    const 종료 = 분으로(endTime);
    if (시작 === null || 종료 === null) return { error: '시작·종료 시각이 올바르지 않습니다.' };
    if (시작 >= 종료) return { error: '시작 시각이 종료 시각보다 빨라야 합니다.' };

    const list = Array.isArray(pauses) ? pauses : [];
    for (const p of list) {
        if (분으로(p?.start) === null) return { error: '휴식 시작 시각이 올바르지 않은 구간이 있습니다.' };
        // 끝이 없는 구간은 버리지만, 끝이 깨진 구간은 무엇이 맞는지 몰라 저장하지 않는다
        const 끝없음 = p.end === null || p.end === undefined || p.end === '';
        if (!끝없음 && 분으로(p.end) === null) return { error: '휴식 종료 시각이 올바르지 않은 구간이 있습니다.' };
    }

    const n = typeof minutes === 'string' && minutes.trim() !== '' ? Number(minutes) : minutes;
    if (!Number.isInteger(n) || n < 0) return { error: '휴게시간은 0 이상의 정수(분)로 입력하세요.' };
    const 길이 = 종료 - 시작;
    if (n >= 길이) return { error: `휴게시간은 업무시간(${길이}분)보다 짧아야 합니다.` };

    if (n === 0) return { pauses: [] };

    const items = 정리(list, 시작, 종료);
    if (items.length === 0) {
        return { pauses: [{ start: 시각으로(시작), end: 시각으로(시작 + n), type: 'break' }] };
    }

    const 합계 = items.reduce((sum, i) => sum + (i.e - i.s), 0);
    if (n < 합계) {
        let 줄일분 = 합계 - n;
        for (let k = items.length - 1; k >= 0 && 줄일분 > 0; k--) {
            const cut = Math.min(줄일분, items[k].e - items[k].s);
            items[k].e -= cut;
            줄일분 -= cut;
        }
    } else {
        let 늘릴분 = n - 합계;
        for (let k = items.length - 1; k >= 0 && 늘릴분 > 0; k--) {
            const 한계 = k === items.length - 1 ? 종료 : items[k + 1].s;
            const add = Math.min(늘릴분, 한계 - items[k].e);
            items[k].e += add;
            늘릴분 -= add;
        }
        items[0].s -= 늘릴분;   // n < 길이 이므로 기록 시작 안쪽에서 끝난다
    }

    return {
        pauses: items
            .filter(i => i.e > i.s)
            .map(i => ({ ...i.src, start: 시각으로(i.s), end: 시각으로(i.e) })),
    };
}
