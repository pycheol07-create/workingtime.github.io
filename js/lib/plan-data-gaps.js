// === js/lib/plan-data-gaps.js ===
// 운영 계획 v2 D3 — 데이터 관리 과제(빈칸 탐지). 계획·신뢰도를 떨어뜨리는 기록 빈칸을 과제로 만든다.
//   입력: 월 요약(OpsMonthly, scratchpad opsmonthly_contract.md schema 1) 배열 — 쓰는 칸은 ym, workdays, workMin,
//         notes{missingQty,stdHours,estimated,capped,unlinkedMin,plannedDays(모르면 null — 그 달은 입력률 계산에서 뺀다)}.
//         + 화면이 따로 모아 넘기는 값(opts): refillDone(refillWork 완료 체크 수, 최근 한 달 — 모르면 null),
//           incoming{matched,total}(incomingSchedule 도착일 vs 상.하차 기록일이 맞은 주 수 / 비교한 주 수),
//           aliasUnmatchedRatio(별칭으로 못 잇는 업무 시간 비율 0~1 — 없으면 월 요약 notes.unlinkedMin ÷ workMin.
//             주의: 월 요약은 업무 60개 넘는 나머지 분도 unlinkedMin 에 더한다), confirmedPlans(확정 계획 수),
//           returnReasonCollected(반품 사유 수집 경로가 생기면 true — 지금은 없음).
//   now 는 최근 recent(3)개월 한 달 평균(일수·건수) 또는 비율(%). 값을 모르면 now null 로 두고 과제로 남긴다('비교 먼저').
//   과제 = { key, what, role, startBy, auto{level:'가능'|'부분'|'불가', how}, metric, now, target, itemDraft(kind 'data') }
//   startBy: 계획 신뢰도에 바로 걸리는 것(처리량·퇴근·예정 물량·확정 계획)은 from, 나머지는 다음 달 1일.
//   문장은 '제안' 말투, 업무명·숫자만(금액·직원 이름·거래처 실명 없음).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-data-gaps.test.js

import { quarterList } from './plan-automation.js?v=202611101235';

export const GAP_LEVELS = Object.freeze({
    recent: 3, plannedPct: 90, incomingPct: 90, aliasPct: 1, confirmedMin: 1, titleMax: 80
});

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r1 = (v) => Math.round(v * 10) / 10;
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const pad = (n) => String(n).padStart(2, '0');
const clip = (s, max) => (s.length <= max ? s : s.slice(0, max - 1) + '…');
const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));

function nextMonth1(ymd) {
    const y = Number(ymd.slice(0, 4)), m = Number(ymd.slice(5, 7));
    return m === 12 ? `${y + 1}-01-01` : `${y}-${pad(m + 1)}-01`;
}

/** 월 요약 목록 — 최근 n개월(notes 가 있는 끝난 달). (plan-automation recentMonths 는 tasks 칸으로 거르므로 따로) */
function monthsWithNotes(months, n) {
    return (months || []).filter(m => m && /^\d{4}-\d{2}$/.test(String(m.ym)) && isObj(m.notes))
        .slice().sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0)).slice(-n);
}

/**
 * 데이터 관리 과제.
 * @param {object[]} months OpsMonthly 문서 배열(끝난 달)
 * @param {object} opts { from(YYYY-MM-DD, 필수에 가깝다 — 없으면 마지막 달 다음 달 1일), recent, refillDone, incoming,
 *                        aliasUnmatchedRatio, confirmedPlans, returnReasonCollected }
 * @returns {{ months:number, items:object[], ok:string[] }}  items = 빈칸 과제, ok = 점검했고 문제없는 key
 */
export function buildDataGaps(months, opts = {}) {
    const L = GAP_LEVELS;
    const list = monthsWithNotes(months, opts.recent || L.recent);
    const n = list.length;
    const from = opts.from || (n ? nextMonth1(`${list[n - 1].ym}-01`) : null);
    const later = from ? nextMonth1(from) : null;
    const items = [];
    const ok = [];
    const avg = (code) => (n ? r1(list.reduce((s, m) => s + num(m.notes[code]), 0) / n) : null);
    const add = (g, isGap) => {
        if (!isGap) { ok.push(g.key); return; }
        items.push(g);
    };

    // 1~4: 하루 기록 빈칸(월 요약 notes) — 한 달 평균 일수·건수, 목표 0
    const NOTE = [
        { key: 'missingQty', metric: '처리량 빠진 날(한 달 평균, 일)', what: '처리량 입력이 빠진 날이 있습니다. 업무를 마칠 때 처리량을 바로 넣는 것을 제안합니다.',
            role: 'lead', auto: { level: '부분', how: '처리량 자동 입력 대상 업무는 자동으로 채워짐 — 나머지 업무는 사람이 입력' }, urgent: true },
        { key: 'stdHours', metric: '퇴근 기록 빠진 날(한 달 평균, 일)', what: '퇴근 기록이 없어 기본 시간으로 계산한 날이 있습니다. 퇴근 때 기록을 남기는 것을 제안합니다.',
            role: 'lead', auto: { level: '부분', how: '업무마감봇 마감 알림으로 누락을 줄임' }, urgent: true },
        { key: 'estimated', metric: '출근 기록 추정한 날(한 달 평균, 일)', what: '출근 기록이 없어 추정한 날이 있습니다. 출근 때 기록을 남기는 것을 제안합니다.',
            role: 'lead', auto: { level: '불가', how: '사람이 출근 때 직접 기록' }, urgent: false },
        { key: 'capped', metric: '종료 안 누른 기록(한 달 평균, 건)', what: "업무 '종료'를 누르지 않아 잘린 기록이 있습니다. 업무가 끝나면 종료를 누르는 것을 제안합니다.",
            role: 'lead', auto: { level: '부분', how: '업무마감봇 마감으로 하루 끝에 정리됨 — 업무 사이 종료는 사람이' }, urgent: false }
    ];
    NOTE.forEach(d => {
        const now = avg(d.key);
        add(gap(d.key, d.what, d.role, d.urgent ? from : later, d.auto, d.metric, now, 0), now == null || now > 0);
    });

    // 5: 예정 물량 입력률 = plannedDays ÷ workdays
    {
        const known = list.filter(m => isNum(m.notes.plannedDays));
        const wd = known.reduce((s, m) => s + num(m.workdays), 0);
        const pd = known.reduce((s, m) => s + num(m.notes.plannedDays), 0);
        const now = wd > 0 ? r1(Math.min(100, pd / wd * 100)) : null;
        add(gap('plannedRate', '예정 물량을 넣은 업무일 비율이 낮습니다. 전날까지 다음 날 예정 물량을 넣는 것을 제안합니다.', 'lead', from,
            { level: '부분', how: '예정 물량 미리 채우기(지난 기록 기준)를 쓰고 사람이 확인' },
            '예정 물량 입력률(%)', now, L.plannedPct), now == null || now < L.plannedPct);
    }

    // 6: 채우기 실적 — refillWork 완료 체크 수(최근 한 달). 목표 = 마지막 달 업무일 수(업무일마다 1번 이상)
    {
        const now = isNum(opts.refillDone) ? num(opts.refillDone) : null;
        const target = n ? num(list[n - 1].workdays) || 1 : 1;
        add(gap('refillDone', '채우기 지시서 완료 체크가 쌓이지 않았습니다. 채우기를 마치면 앱의 지시서 카드에서 완료를 누르는 것을 제안합니다.', 'lead', later,
            { level: '부분', how: '채우기자동화가 지시서를 만들고, 완료 체크는 사람이' },
            '채우기 완료 체크 수(최근 한 달)', now, target), now == null || now === 0);
    }

    // 7: 반품 사유 — 수집 경로 없음(미수집)
    {
        const has = opts.returnReasonCollected === true;
        add(gap('returnReason', '반품 사유 코드·회수 수량을 모으는 경로가 없습니다(미수집). 반품 조회 API·호출 한도를 먼저 확인하는 것을 제안합니다.', 'admin', later,
            { level: '불가', how: '선행: 반품 조회 API·호출 한도 확인(공통\\이지어드민_API한도.md) — 쓰기 API 는 쓰지 않음' },
            '반품 사유 수집 여부', has ? 1 : null, 1), !has);
    }

    // 8: 입고 예정 정확도 — incomingSchedule 도착일 vs 상.하차 기록일
    {
        const inc = isObj(opts.incoming) ? opts.incoming : null;
        const total = inc ? num(inc.total) : 0;
        const now = total > 0 ? r1(Math.min(100, num(inc.matched) / total * 100)) : null;
        add(gap('incomingAccuracy', now == null
            ? '입고 예정 도착일과 상.하차 기록일을 비교할 자료가 없습니다. 비교부터 해 보는 것을 제안합니다.'
            : '입고 예정 도착일과 실제 상.하차 날이 어긋난 주가 있습니다. 도착일이 바뀌면 송금관리 시트를 바로 고치는 것을 제안합니다.',
            'admin', later, { level: '부분', how: '입고 예정은 시트 → 앱으로 자동 반영, 도착일 수정은 사람이' },
            '입고 예정 도착일 맞은 비율(%)', now, L.incomingPct), now == null || now < L.incomingPct);
    }

    // 9: 업무 이름 별칭 못 잇는 시간 비율
    {
        const wm = list.reduce((s, m) => s + num(m.workMin), 0);
        const um = list.filter(m => isNum(m.notes.unlinkedMin));
        const raw = isNum(opts.aliasUnmatchedRatio) ? num(opts.aliasUnmatchedRatio)
            : (um.length && wm > 0 ? um.reduce((s, m) => s + num(m.notes.unlinkedMin), 0) / wm : null);
        const now = raw != null ? r1(raw * 100) : null;
        add(gap('aliasUnmatched', '지금 업무 이름과 이어지지 않는 옛 이름 기록 시간이 있습니다. 설정에서 옛 이름을 지금 업무에 잇는 것을 제안합니다.', 'admin', later,
            { level: '부분', how: '이름을 바꾸면 별칭이 자동으로 생김 — 그 전 기록은 사람이 이어 줌' },
            '이어지지 않는 업무 시간 비율(%)', now, L.aliasPct), now == null || now > L.aliasPct);
    }

    // 10: 확정 계획 수
    {
        const now = isNum(opts.confirmedPlans) ? num(opts.confirmedPlans) : null;
        add(gap('confirmedPlans', '확정한 계획이 없어 계획과 실제를 비교할 수 없습니다. 이번 달 계획을 확정하는 것을 제안합니다.', 'admin', from,
            { level: '불가', how: '관리자가 월간 계획에서 [확정]' },
            '확정 계획 수', now, L.confirmedMin), now == null || now < L.confirmedMin);
    }

    items.forEach(g => {
        const q = g.startBy ? quarterList(g.startBy, 1)[0] : null;
        g.itemDraft = {
            kind: 'data',
            title: clip(`데이터 관리: ${g.metric}`, L.titleMax),
            role: g.role,
            year: q ? q.year : null,
            quarter: q ? q.key : null,
            due: q ? q.end : null,
            kpi: { metric: g.key, from: g.now, target: g.target },
            src: { rule: 'dataGap', catalogKey: g.key }
        };
    });
    return { months: n, items, ok };
}

function gap(key, what, role, startBy, auto, metric, now, target) {
    return { key, what, role, startBy: startBy || null, auto: { ...auto }, metric, now, target };
}

