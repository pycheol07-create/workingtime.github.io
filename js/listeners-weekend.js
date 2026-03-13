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


    // 3. [신규] 관리자 날짜 관리 팝업 관련 리스너
    const adminDatePopup = document.getElementById('weekend-admin-date-popup');
    const adminDateCloseBtn = document.getElementById('admin-date-close-btn');
    const adminDateAddBtn = document.getElementById('admin-date-add-btn');
    const adminDateAddInput = document.getElementById('admin-date-add-member');
    const adminDateBlockToggle = document.getElementById('admin-date-block-toggle');

    if (adminDateCloseBtn && adminDatePopup) {
        adminDateCloseBtn.addEventListener('click', () => {
            adminDatePopup.classList.add('hidden');
        });
    }

    if (adminDateAddBtn) {
        adminDateAddBtn.addEventListener('click', () => {
            WeekendCalendar.adminAddMemberToDate();
        });
    }

    if (adminDateAddInput) {
        adminDateAddInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                WeekendCalendar.adminAddMemberToDate();
            }
        });
    }

    if (adminDateBlockToggle) {
        adminDateBlockToggle.addEventListener('change', (e) => {
            WeekendCalendar.toggleBlockDate(e.target.checked);
        });
    }
}