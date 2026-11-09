// === js/lib/plan-auto-catalog.js ===
// 운영 계획 v2 D3 — 자동화 로드맵의 정적 카탈로그(지금 있는 자동화 ↔ 업무 id, 새 후보).
//   근거: 업무자동화\CLAUDE.md '앱 목록'(2026-11-05 기준). 업무는 task-ids.js SYSTEM_TASKS 의 고정 id 로만 잇는다.
//   항목 = { key, title, tasks[id], existing(앱 이름|null), status, saveRate, covered, difficulty 1~3, role, prereq[{key, text, met}] }
//     status   : live(운영 중) | trial(병행 시험) | recording(녹화·준비 단계) | candidate(아직 없음 — 새 후보)
//     saveRate : 그 업무 기록 시간 중 이 과제로 줄일 수 있다고 보는 몫(어림 — 실측 전 가정)
//     covered  : 이미 자동화가 맡고 있다고 보는 몫(절감 = 시간 × saveRate × (1 − covered))
//     prereq.met: 기본값. plan-automation.js 의 opts.prereqMet {prereqKey: bool} 로 덮어쓴다.
//   이지어드민 쓰기 API 는 쓰지 않는다(CLAUDE.md 3-1) — 반품 후보는 '조회' API 확인이 선행 조건.
//   금액·직원 이름·거래처 실명 없음(업무 id·앱 이름만).
// ※ 순수 모듈(DOM·Firebase 없음). 테스트: tests/plan-automation.test.js

import { TASK } from './task-ids.js?v=202611091200';

const P = (key, text, met = false) => Object.freeze({ key, text, met });

export const AUTO_CATALOG = Object.freeze([
    // 채우기자동화: 지시서 발송(운영) + 앱 '오늘 채우기 지시서' 완료 체크(refillWork). 남은 몫 = 완료 체크율 기록·이어 쓰기.
    { key: 'fill', title: '채우기 지시서 완료 체크율 기록', tasks: [TASK.fill], existing: '채우기자동화', status: 'live',
        saveRate: 0.15, covered: 0.3, difficulty: 1, role: 'lead',
        prereq: [P('refill_check', '채우기 지시서 완료 체크를 매일 누르기', false)] },
    // 로케이션추천: 변경 추천 카드·직원 처리 표시(locRecWork) 운영 중. 남은 몫 = 처리 수 기록·동선 기준 카드 활용.
    { key: 'locroute', title: '로케이션 변경 추천 처리 기록·동선 기준 활용', tasks: [TASK.locroute], existing: '로케이션추천', status: 'live',
        saveRate: 0.2, covered: 0.3, difficulty: 1, role: 'lead', prereq: [] },
    // 패킹봇(패킹 입력) + 미발계산기2(병행 시험, inspPacks 로 샘플검수 품목). 단독 운영 전환 전이라 trial.
    { key: 'china_insp', title: '중국제작·샘플검수 패킹 품목 자동 연결', tasks: [TASK.china, TASK.chinaOwner, TASK.sample],
        existing: '패킹입력 자동화·미발계산기2', status: 'trial',
        saveRate: 0.15, covered: 0.3, difficulty: 2, role: 'admin',
        prereq: [P('mibal2_live', '신규 부족수량관리(미발계산기2) 단독 운영 전환', false)] },
    // 플랫폼출고자동화: 직진·에이블리 출고 운영 중(봉 수 zabPacks 포함).
    { key: 'platform', title: '직진·에이블리 출고 자동화 범위 넓히기', tasks: [TASK.direct, TASK.directPrep, TASK.ably],
        existing: '플랫폼출고자동화', status: 'live',
        saveRate: 0.15, covered: 0.5, difficulty: 2, role: 'admin', prereq: [] },
    // 국내배송: 이지어드민연동은 숫자 수집만. 출고 업로드는 이지어드민출고자동화(B안, 화면 조작) — 지금은 녹화 단계.
    { key: 'domestic_upload', title: '국내배송 출고 업로드 자동화(화면 조작)', tasks: [TASK.domestic],
        existing: '이지어드민출고자동화', status: 'recording',
        saveRate: 0.1, covered: 0.1, difficulty: 3, role: 'admin',
        prereq: [P('ez_rec_steps', '녹화 기록으로 업로드 단계 정리', false)] },
    // 교환반품: 자동화 없음. 한도표(공통\이지어드민_API한도.md) 19번 '반품 내역 조회'가 있으나 우리 호출은 없음 — 확인 전 미충족.
    { key: 'return_collect', title: '반품 사유 코드·회수 수량 자동 수집', tasks: [TASK.return], existing: null, status: 'candidate',
        saveRate: 0.1, covered: 0, difficulty: 2, role: 'admin',
        prereq: [P('ez_return_api', '선행: 반품 조회 API·호출 한도 확인(공통\\이지어드민_API한도.md)', false)] },
    // 상.하차: 자동화 없음. 입고 예정은 incomingSchedule(시트 → Firestore)에 이미 있다 — 도착일 정확도가 먼저.
    { key: 'incoming_staff', title: '입고 예정 → 상.하차 인력 알림', tasks: [TASK.loadunload], existing: null, status: 'candidate',
        saveRate: 0.1, covered: 0, difficulty: 1, role: 'admin',
        prereq: [P('incoming_accuracy', '입고 예정 도착일이 상.하차 기록일과 맞는지 확인', false)] },
    // 오류: 자동화·유형 기록 없음 — 유형 기록 양식부터(자동화의 바탕 자료).
    { key: 'error_form', title: '오류 유형 기록 양식', tasks: [TASK.error], existing: null, status: 'candidate',
        saveRate: 0.1, covered: 0, difficulty: 1, role: 'lead', prereq: [] },
    // 관리자 개별업무: 송금자동화·업무마감봇·매출요약자동화·비품재고연동 운영 중.
    { key: 'admin', title: '관리자 개별업무 자동화 이어가기(송금·마감·매출 요약·비품)', tasks: [TASK.admin],
        existing: '송금자동화·업무마감봇·매출요약자동화·비품재고연동', status: 'live',
        saveRate: 0.2, covered: 0.5, difficulty: 2, role: 'admin', prereq: [] }
].map(e => Object.freeze({ ...e, tasks: Object.freeze(e.tasks.slice()), prereq: Object.freeze(e.prereq.slice()) })));

export const AUTO_STATUS_LABEL = Object.freeze({ live: '운영 중', trial: '병행 시험', recording: '준비(녹화)', candidate: '새 후보' });
