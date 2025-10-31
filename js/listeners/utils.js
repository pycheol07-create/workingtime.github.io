// === js/listeners/utils.js ===

import { makeDraggable } from '../utils.js';

export function attachUtilListeners() {
    
    // --- 1. 햄버거 메뉴 (모바일) ---
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const navContent = document.getElementById('nav-content');
    if (hamburgerBtn && navContent) {
        hamburgerBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            navContent.classList.toggle('hidden');
        });

        navContent.addEventListener('click', (e) => {
            if (window.innerWidth < 768 && e.target.closest('a, button')) {
                navContent.classList.add('hidden');
            }
        });
    }

    // --- 2. 드롭다운 메뉴 (데스크탑) ---
    const menuToggleBtn = document.getElementById('menu-toggle-btn');
    const menuDropdown = document.getElementById('menu-dropdown');
    if (menuToggleBtn) {
        menuToggleBtn.addEventListener('click', (e) => {
            e.stopPropagation(); 
            if (menuDropdown) menuDropdown.classList.toggle('hidden');
        });
    }
    
    // --- 3. 메뉴 바깥 영역 클릭 시 닫기 (공통) ---
    document.addEventListener('click', (e) => {
        // 햄버거
        if (navContent && hamburgerBtn) {
            const isClickInsideNav = navContent.contains(e.target);
            const isClickOnHamburger = hamburgerBtn.contains(e.target);
            if (!navContent.classList.contains('hidden') && !isClickInsideNav && !isClickOnHamburger) {
                navContent.classList.add('hidden');
            }
        }
        // 데스크탑
        if (menuDropdown && menuToggleBtn) {
            const isClickInsideMenu = menuDropdown.contains(e.target);
            const isClickOnMenuBtn = menuToggleBtn.contains(e.target);
            if (!menuDropdown.classList.contains('hidden') && !isClickInsideMenu && !isClickOnMenuBtn) {
                menuDropdown.classList.add('hidden');
            }
        }
    });

    // --- 4. 드래그 기능 활성화 (이력 모달) ---
    const historyModal = document.getElementById('history-modal');
    const historyHeader = document.getElementById('history-modal-header');
    const historyContentBox = document.getElementById('history-modal-content-box');
    if (historyModal && historyHeader && historyContentBox) {
        makeDraggable(historyModal, historyHeader, historyContentBox);
    }
    
    // --- 5. 접기/펴기 (모바일용 요약) ---
    const toggleCompletedLog = document.getElementById('toggle-completed-log');
    const toggleAnalysis = document.getElementById('toggle-analysis');
    const toggleSummary = document.getElementById('toggle-summary');
    
    [toggleCompletedLog, toggleAnalysis, toggleSummary].forEach(toggle => {
      if (!toggle) return;
      toggle.addEventListener('click', () => {
        if (window.innerWidth >= 768) return; // 데스크탑에선 작동 안 함
        const content = toggle.nextElementSibling;
        const arrow = toggle.querySelector('svg');
        if (!content) return;
        content.classList.toggle('hidden');
        if (arrow) arrow.classList.toggle('rotate-180');
      });
    });
}