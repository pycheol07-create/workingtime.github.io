// js/lib/history-merge.js
//
// 하루치 이력을 저장할 때 **서버에 있는 것과 내 화면에 있는 것 중 무엇이 이기는가**.
//
// 왜 따로 떼어냈나
//   이 판단은 `saveProgress` 안에 인라인으로 있었고, 같은 종류의 사고가 반복해서 났다.
//   2026-10-01: 마감이 끝난 뒤(이력 53건) 아침부터 켜 둔 탭의 안전망이 저장을 돌려
//   기록 7건이 사라지고 근무시간이 27시간 부풀었다. 마감 뒤 재출근이 되살아난 사고도 있었다.
//   원인은 Firestore 의 성질 두 개다 —
//     · `merge:true` 는 **배열을 합치지 않는다.** 통째로 바꾼다.
//     · 중첩 map 은 깊게 합치므로, 빼지 않은 키는 살아남는다.
//   그래서 "무엇을 payload 에 넣고 무엇을 **키째로 빼는가**" 가 데이터의 생사를 가른다.
//
//   이 함수는 쓰지 않고 **정하기만** 한다. Firestore 도 State 도 모른다 — 그래서 테스트된다.
//
// 불변식 (tests/history-merge.test.js 가 지킨다)
//   ① 마감된 날은 기록을 교체하지 않는다. **완료된** 새 기록만 덧붙인다.
//   ② 마감된 날의 근태는 서버가 이긴다.
//   ③ 살아있는 기록이 0건이고 이력에 있으면 `workRecords` 키를 **뺀다**(빈 배열이 아니다).
//   ④ `isQuantityVerified` 는 인자·라이브·서버의 OR 이다. 절대 후퇴하지 않는다.
//   ⑤ `memRecords` 는 **서버에 실제로 남는 배열과 같아야 한다.** 어긋나면 다른 함수들이
//      메모리 배열을 통째로 서버에 써서 방금 지킨 기록을 날린다.
//   ⑥ `inspectionDone`(매니저에서 비운 완료 검수, 2026-10-29)은 화면 쪽이 비어 있으면 **키를 뺀다**(마감 여부와 상관없이).
//      옛 탭·아직 못 받은 탭이 빈 배열로 덮어 일자별 검수 기록을 지우지 않게. 지금 saveProgress 는 이 칸을 넘기지 않는다 —
//      매니저 비우기·삭제(js/inspection-logic.js)가 daily_data 와 history 에 직접 쓴다. 이 규칙은 넘기게 되더라도 지우지 않게 하는 안전망.
//   ⑦ 처리량(2026-11-09): 마감된 날은 칸별로 본다 — 이력 값이 0이거나 없는 칸만 화면의 0보다 큰 값으로 채운다.
//      이력의 양수는 바꾸지 않고(마감 뒤 들어온 추가 수량 포함), 0을 새 칸으로 만들지 않는다. '0건 확인'은 합집합.
//      정정은 데이터 관리 처리량 창(이력에 직접 씀)으로만 한다.
//      patch 에는 **이번에 채울 칸만** 넣는다. 서버 칸을 통째로 다시 보내면 읽은 뒤 들어온 값을 옛 값으로 되돌린다.
//      채울 칸이 없으면 키를 뺀다(빈 맵을 보내면 merge 라도 그 맵이 통째로 지워진다). 메모리에 넣을 전체 값은 `memQuantities`.
//      실제 사고: 11/09 17:22 마감 뒤(원본 처리량이 비워진 뒤) 빈 칸으로 열린 처리량 창을 17:25 에 저장 → 전 업무 0 이 이력을 덮었다.
//      마감 전이어도 원본 처리량이 `{}` 이면 이력 처리량을 비우지 않는다 — 지우려는 입력은 전 칸 0 으로 오지 `{}` 로 오지 않는다
//      (이력 저장·초기화까지 끝나고 closedAt 만 못 찍힌 날의 재시도는 원본이 이미 비어 있다).

const 빈객체 = (v) => !v || Object.keys(v).length === 0;
const 빈배열 = (v) => !Array.isArray(v) || v.length === 0;

/** ⑦ 마감된 날 이번에 채울 칸 — 이력에 양수가 있는 업무(옛 이름 칸 포함)는 빼고, 화면의 양수만. */
function 마감된날채울칸(서버값, 화면값, canon) {
    const 양수업무 = new Set(Object.entries(서버값 || {}).filter(([, v]) => Number(v) > 0).map(([k]) => canon(k)));
    const 채울칸 = {};
    Object.entries(화면값 || {}).forEach(([k, v]) => {
        if (Number(v) > 0 && !양수업무.has(canon(k))) 채울칸[k] = v;
    });
    return 채울칸;
}

/** 그 날 이력 문서에 지켜야 할 내용이 있는가 — 마감 표시(closedAt)를 빈 문서에 찍지 않기 위한 판단 */
export const historyHasContent = (d) => !!d && (!빈배열(d.workRecords) || !빈객체(d.taskQuantities));

/**
 * 처리량 창의 '0건 확인' — 창에 표시된 업무만 비교한다(표시 안 된 업무의 표시는 지키도록).
 * 달라졌으면 '기존 목록 − 표시된 업무 + 체크된 업무' 를, 그대로면 null(쓰지 않음)을 돌려준다.
 * 기존 목록의 옛 이름은 canon 으로 지금 이름에 맞춰 본다.
 */
export function changedZeroList(그릴때목록, 표시업무, 체크목록, canon = (n) => n) {
    const 표시 = new Set(표시업무 || []);
    const 기존 = Array.isArray(그릴때목록) ? 그릴때목록 : [];
    const 전 = new Set(기존.map(canon).filter(t => 표시.has(t)));
    const 지금 = new Set((체크목록 || []).filter(t => 표시.has(t)));
    if (전.size === 지금.size && [...지금].every(t => 전.has(t))) return null;
    return [...new Set([...기존.filter(t => !표시.has(canon(t))), ...지금])];
}

/** 처리량 창 — 그릴 때와 **달라진 칸만**. 빈칸(없음·0)이던 칸을 0 으로 저장하면 그 사이 들어온 값을 덮는다. */
export function changedQuantities(그릴때, 저장값) {
    const 바뀐칸 = {};
    Object.entries(저장값 || {}).forEach(([k, v]) => {
        if ((Number(v) || 0) !== (Number((그릴때 || {})[k]) || 0)) 바뀐칸[k] = v;
    });
    return 바뀐칸;
}

/**
 * @param {object}  a
 * @param {string}  a.dateStr        'YYYY-MM-DD'
 * @param {Array}   a.liveRecords    저장하려는 기록들(종료시각 정리까지 끝난 것)
 * @param {object}  a.serverHistory  서버 이력 문서 내용. 없으면 `{}`
 * @param {object}  a.live           화면의 오늘 값들
 * @param {boolean} [a.isQuantityVerifiedArg]  '물량 검증' 을 이 저장에서 찍었는가
 * @param {function} [a.canonName]   업무 이름 → 지금 이름(옛 이름 칸도 같은 업무로 본다). 없으면 이름 그대로
 * @param {string}  a.now            저장 시각. 순수함수를 위해 **인자로 받는다**
 * @returns {{patch:object, memRecords:Array, memQuantities:object, notes:object}}
 *   patch     — 그대로 `setDoc(ref, patch, {merge:true})` 에 넣을 값
 *   memRecords— 저장 뒤 메모리 이력에 넣어야 하는 기록 배열(= 서버에 남는 배열)
 *   memQuantities — 저장 뒤 메모리 이력에 넣어야 하는 처리량 전체(patch 는 일부 칸만이거나 키가 없을 수 있다)
 *   notes     — 호출처가 로그·분기에 쓰는 사실들
 */
export function decideHistoryMerge({ dateStr, liveRecords, serverHistory, live,
                                    isQuantityVerifiedArg = false,
                                    canonName = (n) => n, now }) {
    const 기록 = Array.isArray(liveRecords) ? liveRecords : [];
    const 서버 = serverHistory || {};
    const 화면 = live || {};
    const 서버기록 = Array.isArray(서버.workRecords) ? 서버.workRecords : [];
    const existingBefore = 서버기록.length;

    const isClosedDay = !!서버.closedAt;

    // ③ 살아있는 기록이 0건인데 이력엔 있으면 '업무기록만' 손대지 않는다.
    //    저장 자체를 멈추면 같은 payload 의 물량·검수·검증여부까지 날아가므로,
    //    '중단' 이 아니라 '키 빼기' 로 처리한다 — merge 라서 서버 배열이 보존된다.
    const keepServerRecords = existingBefore > 0 && 기록.length === 0;

    // ① 마감된 날은 교체하지 않고 덧붙인다.
    let appendOnlyRecords = null;
    let appendedCount = 0, skippedNoIdCount = 0;
    if (isClosedDay && !keepServerRecords) {
        const 서버id = new Set(서버기록.map(r => r && r.id).filter(Boolean));
        // 진행 중 기록은 덧붙이지 않는다. endTime 이 '저장한 시각' 으로 박히고,
        // 그 뒤에는 '이미 있는 id' 라 영원히 갱신되지 않아 거짓 시간이 굳는다.
        const 덧붙일만한 = 기록.filter(r => r && r.status === 'completed');
        skippedNoIdCount = 덧붙일만한.filter(r => !r.id).length;
        const 새것 = 덧붙일만한.filter(r => r.id && !서버id.has(r.id));
        appendedCount = 새것.length;
        appendOnlyRecords = 새것.length > 0 ? [...서버기록, ...새것] : null;
    }

    const omitRecordsKey = keepServerRecords || (isClosedDay && appendOnlyRecords === null);

    // 🛡️ 마감된 날에는 이력에 있는 값을 **후퇴시키지 않는다.**
    //    마감이 daily_data 의 물량·검증여부를 초기화하기 때문에, 마감 뒤에 열린 세션이
    //    저장을 돌리면 빈 값이 이력을 덮어 그날 물량이 통째로 사라진다.
    const 지키기 = (화면값, 서버값, 비었나) => (!isClosedDay || !비었나(화면값))
        ? 화면값
        : (서버값 !== undefined && 서버값 !== null ? 서버값 : 화면값);

    // ② 마감된 날의 근태는 서버가 이긴다 — 마감이 확정한 퇴근시각을, 그 전 상태를 들고 있던
    //    세션이 지우거나 되살리지 못하게 한다(마감 후 재출근이 되살아난 사고와 같은 종류).
    //    키를 통째로 빼지는 않는다. 그러면 틀린 퇴근시각을 고칠 경로가 사라진다.
    // ⑦ 처리량·0건 확인 — 규칙은 머리말 참고.
    const 화면처리량 = 화면.taskQuantities || {};
    let 처리량patch = 화면처리량, memQuantities = 화면처리량;
    if (isClosedDay) {
        const 채울칸 = 마감된날채울칸(서버.taskQuantities, 화면처리량, canonName);
        처리량patch = 빈객체(채울칸) ? null : 채울칸;
        memQuantities = { ...(서버.taskQuantities || {}), ...채울칸 };
    } else if (빈객체(화면처리량) && !빈객체(서버.taskQuantities)) {
        처리량patch = null;   // 키를 빼면 merge 라 서버 값이 그대로 남는다
        memQuantities = 서버.taskQuantities;
    }
    const 화면0건 = 화면.confirmedZeroTasks || [];
    const confirmedZeroTasks = isClosedDay
        ? [...new Set([...(Array.isArray(서버.confirmedZeroTasks) ? 서버.confirmedZeroTasks : []), ...화면0건])]
        : ((빈객체(화면처리량) && !빈객체(서버.taskQuantities) && 빈배열(화면0건) && !빈배열(서버.confirmedZeroTasks))
            ? 서버.confirmedZeroTasks : 화면0건);

    const 화면근태 = 화면.dailyAttendance || {};
    // 마감 안 된 날도 **사본**을 만든다. 같은 참조를 넘기면 memPatch 를 거쳐
    // State.allHistoryData 의 그날 근태가 라이브 객체를 가리키고, 이후 라이브 변경이
    // 메모리 이력에 몰래 반영된다(저장하지 않은 값이 저장된 것처럼 보인다).
    const dailyAttendance = isClosedDay
        ? { ...화면근태, ...(서버.dailyAttendance || {}) }
        : { ...화면근태 };

    const patch = {
        id: dateStr,
        ...(omitRecordsKey ? {} : { workRecords: appendOnlyRecords || 기록 }),
        ...(처리량patch ? { taskQuantities: 처리량patch } : {}),
        confirmedZeroTasks,
        onLeaveMembers: 지키기(화면.onLeaveMembers || [], 서버.onLeaveMembers, 빈배열),
        partTimers: 지키기(화면.partTimers || [], 서버.partTimers, 빈배열),
        dailyAttendance,
        // 라이브 management 가 일부 필드만 들고 있을 수 있으므로 서버 값 위에 얹는다.
        // (메모리 캐시를 베이스로 쓰면 내 탭이 켜진 뒤 남이 고친 매출·재고가 옛 값으로 되돌아간다)
        management: { ...(서버.management || {}), ...(화면.management || {}) },
        inspectionList: 지키기(화면.inspectionList || [], 서버.inspectionList, 빈배열),
        ...(빈배열(화면.inspectionDone) ? {} : { inspectionDone: 화면.inspectionDone }),
        // ④ 서버값을 항상 OR 에 넣는다 — 검증을 찍은 뒤 다른 탭이 저장하면 false 로 후퇴했다.
        isQuantityVerified: !!(isQuantityVerifiedArg || 화면.isQuantityVerified
            || 서버.isQuantityVerified),
        savedAt: now
    };

    // ⑤ 서버에 실제로 남는 배열. patch 에서 키를 뺐으면 서버의 기존 배열이 그대로 남는다.
    const memRecords = omitRecordsKey ? 서버기록 : (appendOnlyRecords || 기록);

    // 저장할 것이 아무것도 없는 상태. 실패가 아니지만 저장도 아니다 —
    // 마감 안전망은 재시도해야 하고, 화면은 오류로 안내하면 안 되어 따로 구분한다.
    const nothingToSave = 기록.length === 0
        && 빈객체(화면.taskQuantities)
        && 빈배열(화면.inspectionList)
        && 빈배열(화면.inspectionDone);

    return {
        patch, memRecords, memQuantities,
        notes: { isClosedDay, keepServerRecords, omitRecordsKey, existingBefore,
                 appendedCount, skippedNoIdCount, nothingToSave,
                 closedAt: 서버.closedAt || null }
    };
}
