// === js/utils.js ===

/**
 * 인원 산정용 정직원 명단(중복 제거 + 인원 제외 명단 적용)을 반환.
 * - 멤버 리스트 표시(선택 모달 등)에는 쓰지 않음. "몇 명?"을 셀 때만 사용.
 * - 제외 명단: appConfig.headcountExcludedMembers (없으면 빈 배열).
 * - teamGroups 내에서 한 사람이 여러 그룹에 들어 있어도 1명으로 셈.
 */
export const getRegularMembersForCount = (appConfig) => {
    const flat = (appConfig?.teamGroups || []).flatMap(g => g?.members || []);
    const excluded = new Set(appConfig?.headcountExcludedMembers || []);
    const uniq = new Set();
    flat.forEach(name => {
        if (!name) return;
        if (excluded.has(name)) return;
        uniq.add(name);
    });
    return uniq;
};

export const showToast = (message, isError = false) => {
    const container = document.getElementById('toast-container');
    if (!container) return; 
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

// 네이티브 confirm 대체 — 스타일된 모달, Promise<boolean> 반환.
// 자체 DOM을 생성하므로 어느 페이지에서나 동작(별도 마크업/컨테이너 불필요).
export const showConfirm = (message, opts = {}) => {
    const { title = '확인', okText = '확인', cancelText = '취소', danger = false } = opts;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:rgba(17,24,39,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
        const okColor = danger ? '#dc2626' : '#2563eb';
        ov.innerHTML = `
            <div role="dialog" aria-modal="true" style="background:#fff;border-radius:16px;max-width:380px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3);overflow:hidden;font-family:inherit;">
              <div style="padding:20px 20px 8px;font-weight:800;font-size:16px;color:#111827;">${esc(title)}</div>
              <div style="padding:0 20px 18px;font-size:14px;color:#374151;line-height:1.55;white-space:pre-line;">${esc(message)}</div>
              <div style="display:flex;gap:8px;padding:12px 16px;background:#f9fafb;border-top:1px solid #f1f5f9;justify-content:flex-end;">
                <button data-act="cancel" style="padding:8px 16px;border-radius:10px;border:1px solid #e5e7eb;background:#fff;color:#374151;font-weight:700;font-size:13px;cursor:pointer;">${esc(cancelText)}</button>
                <button data-act="ok" style="padding:8px 16px;border-radius:10px;border:none;background:${okColor};color:#fff;font-weight:700;font-size:13px;cursor:pointer;">${esc(okText)}</button>
              </div>
            </div>`;
        const done = (val) => { ov.remove(); document.removeEventListener('keydown', onKey); resolve(val); };
        const onKey = (e) => { if (e.key === 'Escape') done(false); else if (e.key === 'Enter') done(true); };
        ov.addEventListener('click', (e) => {
            if (e.target === ov) return done(false); // 바깥 클릭=취소
            const b = e.target.closest('[data-act]');
            if (b) done(b.dataset.act === 'ok');
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(ov);
        const okBtn = ov.querySelector('[data-act="ok"]');
        if (okBtn) okBtn.focus();
    });
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

// ✅ 총 휴식 시간(분) 계산 함수
export const calcTotalPauseMinutes = (pauses = []) => {
    if (!pauses || pauses.length === 0) return 0;
    let total = 0;
    
    const now = new Date();
    const nowTimeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    
    pauses.forEach(p => {
        if (p.start) {
            const s = new Date(`1970-01-01T${p.start}:00Z`).getTime();
            const endTimeStr = p.end || nowTimeStr;
            const e = new Date(`1970-01-01T${endTimeStr}:00Z`).getTime();
            
            if (e > s) {
                total += (e - s);
            }
        }
    });
    return Math.floor(total / 60000);
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
    const date = new Date(dateString + 'T00:00:00');
    const day = date.getDay();
    return day >= 1 && day <= 5; // 월(1) ~ 금(5)
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

// 💡 [변경됨] 초를 제거하고 "00시 00분" 형태로 출력하도록 수정
export const displayCurrentDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = weekdays[now.getDay()];
    
    // 시간, 분 추출 및 두 자리수 맞춤
    const hours = now.getHours().toString().padStart(2, '0');
    const minutes = now.getMinutes().toString().padStart(2, '0');
    
    // 최종 표시될 텍스트 (예: 2024년 05월 12일 (수) 14시 30분)
    const dateString = `${year}년 ${month}월 ${day}일 (${dayOfWeek}) ${hours}시 ${minutes}분`;
    
    const displayElement = document.getElementById('current-date-display');
    if (displayElement) {
        displayElement.textContent = dateString;
    }
};

export const normalizeName = (s = '') => s.normalize('NFC').trim().toLowerCase();

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

// ✅ 주말을 제외한 평일(Working Days)만 계산하는 함수
export const calculateWorkingDays = (start, end) => {
    if (!start) return 0;
    const startDate = new Date(start + 'T00:00:00');
    const endDate = end ? new Date(end + 'T00:00:00') : new Date(start + 'T00:00:00');
    let count = 0;
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const day = d.getDay();
        if (day >= 1 && day <= 5) count++; // 평일만 카운트
    }
    return count;
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