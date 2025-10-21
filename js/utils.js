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

// === [추가] 시간/날짜 보조 함수 ===
export const addMinutesToTime = (timeStr, minutesToAdd) => {
    if (!timeStr || !/^\d{2}:\d{2}$/.test(timeStr)) return '';
    const [h, m] = timeStr.split(':').map(Number);
    const base = new Date(1970, 0, 1, h, m, 0);
    base.setMinutes(base.getMinutes() + Number(minutesToAdd || 0));
    const hh = String(base.getHours()).padStart(2, '0');
    const mm = String(base.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
};

export const calcDateDiffInDays = (startDateStr, endDateStr) => {
    if (!startDateStr) return 0;
    const s = new Date(startDateStr + 'T00:00:00');
    const e = new Date((endDateStr || startDateStr) + 'T00:00:00');
    const diff = Math.floor((e - s) / (1000 * 60 * 60 * 24)) + 1; // 양끝 포함
    return Math.max(1, diff);
};
