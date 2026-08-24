// === js/app-version.js === 인앱 버전 표시 + 변경 이력 (의존성 없는 단독 스크립트)
// ※ 배포 때마다 VERSION 과 CHANGELOG 최상단 항목을 갱신하세요.
(function () {
    const VERSION = '2026.08.24';
    const CHANGELOG = [
        { v: '2026.08.24', items: [
            '근태현황에서 기존 근태를 수정하면 "수정할 항목을 찾을 수 없습니다"가 뜨던 문제 수정',
            '기간형 근태(연차·출장 등)를 근태현황에서 추가·수정해도 시작일 하루만 표시되던 문제 수정',
            '근태 종류 "휴직"을 "기타"로 바꾸고 항목명을 직접 입력할 수 있게 개선',
            '업무예상 자동입력 보정 — 국내배송은 실적예측값 반영, 샘플검수는 중국제작 입고일에만',
            '로케이션 ZG&AB 출고 전송 결과에 직진/에이블리 구분 표시',
            '근태예정 위젯 정리 — 열 정렬, 날짜별 구분선, 인원수 표기 제거',
            '업무 시트 대시보드를 상단 탭으로 — 한 번에 한 시트만 보고, 연 탭만 불러옵니다',
            '업무 시트 대시보드: 표 위 합계 칩 줄 제거, 머리글 고정, 창 전체 폭·높이 사용',
            '업무 시트 대시보드: 시트별로 탭 이름과 가져올 범위(A1:H200 등) 지정 가능',
            '비품관리 목록에 헤더 정렬·컬럼별 필터 추가',
            '비품관리 발주정보를 MOQ · 리드타임 · 최근발주 · 메모로 분리',
            '비품 리드타임에 단위(일·주·개월) 선택 추가, MOQ 값 천 단위 표시',
            '비품관리 화면 재배치 — 주요 비품을 왼쪽에 두고 목록을 넓고 길게',
            "비품 재고를 '현재고조회' 엑셀 업로드로 맞추는 기능 추가",
        ]},
        { v: '2026.08.21', items: [
            '대시보드 근태예정 위젯 · 업무 캘린더 · 내 연차관리 사이 일정 연동 수정',
            '개인 리포트 근태기록에 출장·재택근무·외근 등이 빠지던 문제 수정 (전 화면 점검)',
            '모바일 데이터관리: 주/월/년 날짜 목록이 한 줄로 눌리고 스크롤되지 않던 문제 수정',
            '업무 캘린더: 일정 없는 주가 납작해지지 않도록 최소 행 높이 지정',
        ]},
        { v: '2026.07.30', items: [
            '업무 캘린더 개편 — 날짜칸 안에 상세내역 표시, 날짜를 클릭해 등록·수정·삭제',
            '연속된 일정을 이어붙인 노션식 기간 바 + 모바일 목록 보기',
            '근태예정 위젯: 같은 날짜를 묶어 세로로 표시',
            '실적 예측 배송량 장/건 병기 복원, 직진·도착보장은 풀필먼트 기준으로 정리',
        ]},
        { v: '2026.07.29', items: [
            '업무기록 유실 수정 — 자동마감이 이력에 남지 않던 문제 + 마감 누락 자동 복구',
            '업무마감 후 직원이 다시 출근 상태로 되돌아가던 문제 수정',
            '대시보드 업무 캘린더 신설, 비품관리 메뉴 추가, UPH 마우스오버 설명',
            '경영지표 채널별(카페24·직진배송·도착보장) 매출·주문건수 입력 + 실적예측 채널 구분',
            '예정 물량(미래 처리량) 입력 기능 추가',
            '로케이션: 직진·에이블리(ZG&AB) 출고 전송 기록 확인 + 최신성 경고',
            '업무매뉴얼 → "업무 매뉴얼 및 도구"로 확장 (도구 등록·다운로드)',
        ]},
        { v: '2026.07.28', items: [
            '퇴사 처리(비활성) 추가 — 삭제 대신 퇴사일 지정, 과거 기록은 그대로 보존',
            '관리자 팀원관리에 퇴사자 섹션 분리 (기본 접힘)',
            '업무예상 상세 시뮬레이션 개선 + 가용인원에 퇴사 반영',
            '주문 분석 업로드 시 Firebase 읽기 요금이 급등하던 문제 완화',
        ]},
        { v: '2026.07.23', items: [
            '로케이션 대시보드: 피킹용/기타용/SAM 3분류 사용률·빈자리 표시',
            '로케이션 추천: 직진+에이블리를 단일 "ZG&AB 출고" 업로드로 통합',
            '팀 결산 보고에 운영 마일스톤 결과·종합의견 섹션 추가',
            '데이터관리 모바일 날짜 선택을 컴팩트 토글 바 + 드로어로 재설계',
        ]},
        { v: '2026.07.21', items: [
            '"업무 예상" 탭 신설 — 시뮬레이션 분리, 오늘·내일 자동 예측, 중국제작 입고일정 연동',
            '대시보드 입고일정 위젯 개편 — 같은 도착일 묶기, 총박스·총수량, 글자 확대',
            '인건비 계산 버그 수정 — 월급제 시급 환산(÷209) 누락으로 금액이 부풀던 문제',
            '로케이션 변경추천을 피킹용 우선 기준으로 수정 + 헤더 드래그로 순서 변경',
        ]},
        { v: '2026.07.14', items: [
            '데이터관리에 "팀 결산 보고" 탭 추가 (월/분기/년 종합 요약)',
            '개인 리포트 급여 금액 마스킹 — 클릭할 때만 표시',
            '메인화면 업무현황: 진행중 업무를 공통업무 / 그 외 업무 두 줄로 분리',
            '로케이션 도면 보기: 기타 로케이션 전용 탭 + 미배치 섹션',
            '생산성 탭에 "채우기 → 오류 영향 분석" 위젯 추가',
            '연차 사용기한을 다시 설정하면 이전 날짜 연차 내역을 자동 정리',
        ]},
        { v: '2026.07.06', items: [
            '급여 계산: 점심시간 외출 무차감 명시 + 주말근무 수당(회당 11만원) 반영',
            '로케이션 "2F이동추천"을 "빈칸확보"로 개편',
            '경영지표: 과거 환율 소급 입력 + 앱을 켜지 않은 날 환율 자동 채움',
        ]},
        { v: '2026.06.29', items: [
            '경영지표에 달러·위안 환율 추가 (매일 오전 9시 자동 입력, 주/월/년 증감 표시)',
            '개인 예상급여(세전)를 월 기본급 기준 근태 차감 방식으로 변경',
            '관리자 "시급" → "기본급"으로 명칭 변경 + 자동 시급(기본급÷209) 표시',
            '주말근무 신청 개선 — 적정횟수 고정·형평성 추천·자동마감',
            '메인 로고 교체 + 배경 워터마크',
        ]},
        { v: '2026.06.26', items: [
            '오프라인 상태 배너 + PWA(홈 화면 설치 · 오프라인 대비) 지원',
            '업무현황을 커버플로우 + 우측 빠른시작 리스트로 개편 (모바일 좌우 스와이프)',
            '업무 시트 대시보드: 기간(전·현·후 / 직접 지정) 조회 + 날짜별 내역 표',
            '주말 근무: 1인당 적정 횟수 안내 (관리자 1명 고정 · 기본 정원 3명)',
            '확인창을 앱 디자인에 맞는 모달로 개선',
        ]},
        { v: '2026.06.22', items: [
            '데이터 관리 평균 근무일수를 출근(근태) 기준 · 정규 팀원으로 보정',
            '주말 신청 공개 범위 정리(여는 날짜는 본인만, 마감/지난 날짜는 전체)',
            'Firebase 읽기 비용 절감(주말 모달 리스너 정리)',
        ]},
    ];

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

    function openModal() {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
        const groups = CHANGELOG.map(g =>
            `<div style="margin-bottom:14px;">
               <div style="font-weight:800;font-size:13px;color:#2563eb;margin-bottom:4px;">v${esc(g.v)}</div>
               <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:1.65;">${g.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
             </div>`).join('');
        ov.innerHTML = `
            <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;max-width:440px;width:100%;max-height:80vh;overflow:auto;box-shadow:0 20px 50px rgba(0,0,0,.3);">
              <div style="padding:16px 20px 12px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #f1f5f9;position:sticky;top:0;background:#fff;">
                <div style="font-weight:800;font-size:16px;color:#111827;">변경 이력 <span style="font-size:12px;color:#9ca3af;font-weight:600;">현재 v${esc(VERSION)}</span></div>
                <button data-close aria-label="닫기" style="border:none;background:transparent;font-size:22px;line-height:1;color:#9ca3af;cursor:pointer;">&times;</button>
              </div>
              <div style="padding:16px 20px;">${groups}</div>
            </div>`;
        ov.addEventListener('click', (e) => { if (e.target === ov || e.target.closest('[data-close]')) ov.remove(); });
        document.body.appendChild(ov);
    }

    function init() {
        const badge = document.getElementById('app-version-badge');
        if (badge) {
            badge.textContent = 'v' + VERSION + ' · 변경 이력';
            badge.addEventListener('click', openModal);
        }
        try {
            const seen = localStorage.getItem('app_seen_version');
            if (seen && seen !== VERSION && badge) {
                badge.style.color = '#2563eb';
                badge.style.fontWeight = '700';
                badge.textContent = '✨ 업데이트됨 · 변경 이력';
            }
            localStorage.setItem('app_seen_version', VERSION);
        } catch (_) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
