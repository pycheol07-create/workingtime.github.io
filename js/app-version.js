// === js/app-version.js === 인앱 버전 표시 + 변경 이력 (의존성 없는 단독 스크립트)
// ※ 배포 때마다 VERSION 과 CHANGELOG 최상단 항목을 갱신하세요.
(function () {
    const VERSION = '2026.06.26';
    const CHANGELOG = [
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
