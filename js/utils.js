// === js/utils.js ===

// ... (기존 showToast, calcElapsedMinutes, formatTimeTo24H, ... getWeekOfYear, displayCurrentDate 함수들은 그대로 둠) ...

export const showToast = (message, isError = false) => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast p-3 rounded-lg shadow-xl text-white ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    toast.textContent = message;
    container.prepend(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, 3000);
};

export const calcElapsedMinutes = (start, end, pauses = []) => {
  if (!start || !end) return 0;
  const s = new Date(`1970-01-01T${start}:00Z`).getTime();
  const e = new Date(`1970-01-01T${end}:00Z`).getTime();
  let total = Math.max(0, e - s);
  (pauses || []).forEach(p => {
    if (p.start && p.end) {
      const ps = new Date(`1970-01-01T${p.start}:00Z`).getTime();
      const pe = new Date(`1970-01-01T${p.end}:00Z`).getTime();
      if (pe > ps) total -= (pe - ps);
    }
  });
  return Math.max(0, total / 60000);
};

export const formatTimeTo24H = (timeStr) => {
    if (!timeStr) return '';
    const [hours, minutes] = timeStr.split(':');
    const date = new Date(1970, 0, 1, hours, minutes);
    return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

export const getCurrentTime = () => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
}

export const formatDuration = (minutes) => {
    minutes = Math.round(minutes);
    if (isNaN(minutes) || minutes < 0) return '0 분';
    if (minutes === 0) return '0 분';
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    let result = '';
    if (h > 0) result += `${h} 시간 `;
    if (m > 0) result += `${m} 분`;
    return result.trim();
};

export const isWeekday = (dateString) => {
    const date = new Date(dateString + 'T00:00:00'); // Treat as local date
    const day = date.getDay();
    return day >= 1 && day <= 5; // Monday to Friday
};

export const getTodayDateString = () => {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localDate = new Date(now - offset);
    return localDate.toISOString().slice(0, 10);
};

export const getWeekOfYear = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
};

export const displayCurrentDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = weekdays[now.getDay()];
    const dateString = `${year}년 ${month}월 ${day}일 (${dayOfWeek})`;
    document.getElementById('current-date-display').textContent = dateString;
};

// === ⬇️ app.js에서 이동해 온 헬퍼 함수들 ⬇️ ===

let recordCounter = 0; // generateId를 위한 카운터
export const generateId = () => `${Date.now()}-${++recordCounter}`;

export const normalizeName = (s='') => s.normalize('NFC').trim().toLowerCase();

export const calculateDateDifference = (start, end) => {
    if (!start) return 0;
    const startDate = new Date(start);
    const endDate = end ? new Date(end) : new Date(start);
    const startUTC = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const endUTC = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    const diffTime = endUTC - startUTC;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1;
};

export const debounce = (func, delay) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            func.apply(this, args);
        }, delay);
    };
};

/**
 * 모달 팝업을 드래그 가능하게 만듭니다. (app.js에서 이동)
 */
export function makeDraggable(modalOverlay, header, contentBox) {
    let isDragging = false;
    let offsetX, offsetY;

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('button')) {
            return;
        }
        
        isDragging = true;
        
        if (contentBox.dataset.hasBeenUncentered !== 'true') {
            const rect = contentBox.getBoundingClientRect();
            modalOverlay.classList.remove('flex', 'items-center', 'justify-center');
            contentBox.style.position = 'absolute';
            contentBox.style.top = `${rect.top}px`;
            contentBox.style.left = `${rect.left}px`;
            contentBox.style.transform = 'none';
            contentBox.dataset.hasBeenUncentered = 'true';
        }

        const rect = contentBox.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        let newLeft = e.clientX - offsetX;
        let newTop = e.clientY - offsetY;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const boxWidth = contentBox.offsetWidth;
        const boxHeight = contentBox.offsetHeight;

        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + boxWidth > viewportWidth) newLeft = viewportWidth - boxWidth;
        if (newTop + boxHeight > viewportHeight) newTop = viewportHeight - boxHeight;

        contentBox.style.left = `${newLeft}px`;
        contentBox.style.top = `${newTop}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}