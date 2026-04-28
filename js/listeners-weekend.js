// === js/listeners-weekend.js ===
import * as WeekendCalendar from './weekend-calendar.js';

export function setupWeekendListeners() {
    // 1. 메인 메뉴에서 '주말 근무' 버튼 클릭 시 모달 열기
    const openBtn = document.getElementById('open-weekend-modal-btn');
    const openBtnMobile = document.getElementById('open-weekend-modal-btn-mobile');
    const modal = document.getElementById('weekend-work-modal');
    const closeBtn = document.getElementById('close-weekend-modal-btn');

    const openModal = () => {
        if (modal) {
            modal.classList.remove('hidden');
            WeekendCalendar.initWeekendCalendar();
        }
    };

    if (openBtn) openBtn.addEventListener('click', openModal);
    if (openBtnMobile) openBtnMobile.addEventListener('click', openModal);

    if (closeBtn && modal) {
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    // 2. 월 이동 버튼
    const prevBtn = document.getElementById('prev-month-btn');
    const nextBtn = document.getElementById('next-month-btn');

    if (prevBtn) prevBtn.addEventListener('click', () => WeekendCalendar.changeMonth(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => WeekendCalendar.changeMonth(1));


    // 3. 관리자 날짜 관리 팝업 관련 리스너
    const adminDatePopup = document.getElementById('weekend-admin-date-popup');
    const adminDateCloseBtn = document.getElementById('admin-date-close-btn');
    
    // 수동 추가 엘리먼트
    const adminDateAddBtn = document.getElementById('admin-date-add-btn');
    const adminDateAddInput = document.getElementById('admin-date-add-member');
    
    // 날짜 마감 엘리먼트
    const adminDateBlockToggle = document.getElementById('admin-date-block-toggle');

    // [신규] 랜덤 뽑기 엘리먼트
    const adminDateRandomBtn = document.getElementById('admin-date-random-btn');
    const adminDateRandomCount = document.getElementById('admin-date-random-count');

    // 팝업 닫기
    if (adminDateCloseBtn && adminDatePopup) {
        adminDateCloseBtn.addEventListener('click', () => {
            adminDatePopup.classList.add('hidden');
        });
    }

    // 수동 인원 추가 리스너 (버튼 클릭)
    if (adminDateAddBtn) {
        adminDateAddBtn.addEventListener('click', () => {
            WeekendCalendar.adminAddMemberToDate();
        });
    }

    // 수동 인원 추가 리스너 (엔터키 입력)
    if (adminDateAddInput) {
        adminDateAddInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                WeekendCalendar.adminAddMemberToDate();
            }
        });
    }

    // [신규] 랜덤 뽑기 버튼 클릭 리스너
    if (adminDateRandomBtn && adminDateRandomCount) {
        adminDateRandomBtn.addEventListener('click', () => {
            const count = parseInt(adminDateRandomCount.value, 10);
            if (isNaN(count) || count <= 0) {
                alert("올바른 인원 수를 입력하세요.");
                return;
            }
            if (confirm(`관리자를 제외한 인원 중 ${count}명을 무작위로 뽑아 '승인 대기' 상태로 등록하시겠습니까?`)) {
                 WeekendCalendar.adminRandomSelectMembers(count);
            }
        });
    }

    // 마감 설정 토글 리스너
    if (adminDateBlockToggle) {
        adminDateBlockToggle.addEventListener('change', (e) => {
            WeekendCalendar.toggleBlockDate(e.target.checked);
        });
    }
}