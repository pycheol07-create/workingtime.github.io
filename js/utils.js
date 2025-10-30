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

// ✅ [추가] app.js에서 이동해 온 함수
/**
 * 시작 시간, 종료 시간, 그리고 정지 기록 배열을 바탕으로 순수 작업 시간을 분 단위로 계산합니다.
 * @param {string} start - 시작 시간 (HH:MM)
 * @param {string} end - 종료 시간 (HH:MM)
 * @param {Array<Object>} pauses - 정지 기록 배열 (e.g., [{start: 'HH:MM', end: 'HH:MM'}])
 * @returns {number} - 계산된 총 분
 */
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

// === utils.js (36번째 줄부터 파일 끝까지 교체) ===

// ✅ [수정] 중복 선언 및 불필요한 괄호 제거
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

// ✅ [추가] CSV 관련 헬퍼 함수

/**
 * 객체 배열을 CSV 문자열로 변환합니다.
 * @param {Array<Object>} dataArray - 변환할 데이터 배열
 * @param {Array<string>} headers - CSV 헤더 배열
 * @returns {string} - 생성된 CSV 문자열
 */
export const convertToCSV = (dataArray, headers) => {
    if (!dataArray || dataArray.length === 0) return '';

    // 헤더 행 생성
    const headerRow = headers.map(header => `"${String(header).replace(/"/g, '""')}"`).join(',');

    // 데이터 행 생성
    const dataRows = dataArray.map(row => {
        return headers.map(header => {
            const value = row[header];
            let cellValue = (value === null || value === undefined) ? '' : String(value);
            // 셀 값에 따옴표, 쉼표, 줄바꿈이 포함된 경우 따옴표로 감싸고 내부 따옴표 이스케이프
            if (/[",\n\r]/.test(cellValue)) {
                cellValue = `"${cellValue.replace(/"/g, '""')}"`;
            }
            return cellValue;
        }).join(',');
    });

    // BOM 추가 (Excel에서 UTF-8 인식) + 헤더 + 데이터 반환
    return '\uFEFF' + headerRow + '\n' + dataRows.join('\n');
};

/**
 * CSV 문자열을 파일로 다운로드합니다.
 * @param {string} csvString - 다운로드할 CSV 데이터
 * @param {string} filename - 저장할 파일 이름 (확장자 포함)
 */
export const downloadCSV = (csvString, filename) => {
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) { // feature detection
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", filename);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url); // 메모리 해제
    } else {
        alert("CSV 다운로드를 지원하지 않는 브라우저입니다.");
    }
};

// ⛔️ [삭제] 파일 끝에 있던 불필요한 '}' 괄호를 제거했습니다.