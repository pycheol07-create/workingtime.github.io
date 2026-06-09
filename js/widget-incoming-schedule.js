// === js/widget-incoming-schedule.js ===
// 🚚 메인 대시보드 "주요 일정 및 알림" 위젯의 입고 예정 섹션.
// 구글 시트(공개 export)에서 CSV를 받아 도착일이 당일 이후인 행을 표시.

const SHEET_ID = '1k6qa9X96RPr8bRf0fUTk7p3RS5HuhOaDz6kXSGSlQgc';
const GID = '606554960';
const CSV_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;

// 컬럼 인덱스 (0-based). A=0 ... B=1 ... Q=16 ... R=17 ... AC=28
const COL_PACK_DATE = 1;   // B열 — 패킹 일자
const COL_BOXES = 16;      // Q열 — 박스 수
const COL_QTY = 17;        // R열 — 수량
const COL_ARRIVAL = 28;    // AC열 — 도착일

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30분
const CACHE_KEY = 'incoming_schedule_cache_v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1시간 (오프라인 fallback)

let _refreshTimer = null;
let _lastFetchAt = 0;

// ────────────────────────────────────────
// CSV 파싱 (RFC 4180 단순화 — 쉼표/줄바꿈/이중인용 처리)
// ────────────────────────────────────────
function parseCSV(text) {
    const rows = [];
    let row = [], cell = '', inQuote = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuote) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cell += '"'; i++; }
                else inQuote = false;
            } else cell += ch;
        } else {
            if (ch === '"') inQuote = true;
            else if (ch === ',') { row.push(cell); cell = ''; }
            else if (ch === '\r') { /* skip */ }
            else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
            else cell += ch;
        }
    }
    if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
    return rows;
}

// ────────────────────────────────────────
// 날짜 파서 — "6/15", "06/15", "2026-06-15", "6/15(월)" 등 다양한 형식 처리
// 반환: Date | null
// ────────────────────────────────────────
function parseDateCell(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const now = new Date();
    const thisYear = now.getFullYear();

    // 패턴 1: YYYY.M.D / YYYY-M-D / YYYY/M/D (+ 뒤에 요일/공백 등 무시)
    // 패턴 2: YY.M.D / YY-M-D (2자리 연도 — 첫 그룹이 > 12 라야 연도로 인정)
    const three = s.match(/^(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    if (three) {
        const first = Number(three[1]);
        const firstLen = three[1].length;
        // 4자리면 무조건 연도. 2자리이고 12보다 크면 연도(YY).
        if (firstLen === 4 || first > 12) {
            const year = firstLen === 4 ? first : 2000 + first;
            const month = Number(three[2]);
            const day = Number(three[3]);
            const d = new Date(year, month - 1, day);
            if (!isNaN(d.getTime())) return d;
        }
        // 그 외(첫 그룹이 1~12)는 M/D/YY 가능성도 있으나 본 시트엔 없음 → 패스
    }
    // 패턴 3: M/D 또는 MM/DD (연도 없음) — 올해 기준, 너무 과거면 다음해
    const md = s.match(/^(\d{1,2})[-/.](\d{1,2})(?!\d)/);
    if (md) {
        const m = Number(md[1]); const dd = Number(md[2]);
        if (m >= 1 && m <= 12 && dd >= 1 && dd <= 31) {
            const d = new Date(thisYear, m - 1, dd);
            const diffMonths = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
            if (diffMonths > 6) d.setFullYear(thisYear + 1);
            return d;
        }
    }
    // 마지막 fallback: Date 직접 시도
    const fb = new Date(s);
    if (!isNaN(fb.getTime())) return fb;
    return null;
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// 도착일 라벨: "오늘" / "내일" / "모레" / "M/D"
function formatArrivalLabel(arrivalDate) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const arr = new Date(arrivalDate); arr.setHours(0, 0, 0, 0);
    const diffDays = Math.round((arr - now) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) return '오늘';
    if (diffDays === 1) return '내일';
    if (diffDays === 2) return '모레';
    return `${arr.getMonth() + 1}/${arr.getDate()}일`;
}

function normalizePackDateText(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    // "2024.11.4.월" / "24.11.4" / "11/4" / "11-4" 모두 → "11/4일자"
    const ymdMatch = s.match(/^(\d{2,4})[.\/\-](\d{1,2})[.\/\-](\d{1,2})/);
    if (ymdMatch) {
        const first = Number(ymdMatch[1]);
        if (ymdMatch[1].length === 4 || first > 12) {
            return `${Number(ymdMatch[2])}/${Number(ymdMatch[3])}일자`;
        }
    }
    const md = s.match(/^(\d{1,2})[-/.](\d{1,2})(?!\d)/);
    if (md) return `${Number(md[1])}/${Number(md[2])}일자`;
    return s;
}

const numFmt = (n) => Number(n || 0).toLocaleString();

// ────────────────────────────────────────
// 메인: fetch → 파싱 → 필터 → 렌더
// ────────────────────────────────────────
async function fetchIncomingSchedule() {
    const listEl = document.getElementById('widget-incoming-list');
    const statusEl = document.getElementById('widget-incoming-status');
    if (!listEl) return;

    try {
        if (statusEl) statusEl.textContent = '조회 중...';
        const res = await fetch(CSV_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const csvText = await res.text();
        const rows = parseCSV(csvText);
        // 첫 행은 헤더로 가정 — 데이터부터
        const today = new Date(); today.setHours(0, 0, 0, 0);

        const items = [];
        for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (!r || r.length < 3) continue;
            const arrivalRaw = r[COL_ARRIVAL];
            const arrival = parseDateCell(arrivalRaw);
            if (!arrival) continue;
            const arr = new Date(arrival); arr.setHours(0, 0, 0, 0);
            if (arr < today) continue; // 과거는 제외

            const packDate = r[COL_PACK_DATE];
            const boxes = Number(String(r[COL_BOXES] || '').replace(/[^0-9.-]/g, '')) || 0;
            const qty = Number(String(r[COL_QTY] || '').replace(/[^0-9.-]/g, '')) || 0;
            if (boxes === 0 && qty === 0) continue; // 빈 행 제외

            items.push({
                arrivalDate: arr,
                arrivalLabel: formatArrivalLabel(arr),
                packDateText: normalizePackDateText(packDate),
                boxes, qty
            });
        }

        // 도착일 가까운 순 정렬
        items.sort((a, b) => a.arrivalDate - b.arrivalDate);

        // 캐시 저장 (오프라인 fallback)
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items: items.map(it => ({ ...it, arrivalDate: it.arrivalDate.toISOString() })) }));
        } catch (_) {}

        renderItems(items);
        const now = new Date();
        if (statusEl) statusEl.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')} 갱신`;
        _lastFetchAt = Date.now();
    } catch (e) {
        console.warn('[widget-incoming] fetch 실패:', e);
        // 캐시 폴백
        try {
            const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
            if (cached && Date.now() - cached.at < CACHE_TTL_MS && Array.isArray(cached.items)) {
                const items = cached.items.map(it => ({ ...it, arrivalDate: new Date(it.arrivalDate) }))
                    .filter(it => {
                        const d = new Date(it.arrivalDate); d.setHours(0, 0, 0, 0);
                        const today = new Date(); today.setHours(0, 0, 0, 0);
                        return d >= today;
                    });
                renderItems(items);
                if (statusEl) statusEl.textContent = '⚠️ 오프라인 (캐시)';
                return;
            }
        } catch (_) {}
        listEl.innerHTML = `<li class="text-[10px] text-red-500">⚠️ 시트 조회 실패. 시트가 "링크가 있는 모든 사람이 보기" 권한인지 확인.</li>`;
        if (statusEl) statusEl.textContent = '오류';
    }
}

function renderItems(items) {
    const listEl = document.getElementById('widget-incoming-list');
    if (!listEl) return;
    if (items.length === 0) {
        listEl.innerHTML = `<li class="text-[10px] text-gray-400 italic">표시할 입고 예정이 없습니다.</li>`;
        return;
    }
    listEl.innerHTML = items.map(it => {
        const arrTone = it.arrivalLabel === '오늘' ? 'text-red-600 dark:text-red-400'
            : (it.arrivalLabel === '내일' ? 'text-orange-600 dark:text-orange-400'
            : 'text-amber-700 dark:text-amber-300');
        const qtyText = it.qty > 0 ? `, ${numFmt(it.qty)}개` : '';
        const boxText = it.boxes > 0 ? `${numFmt(it.boxes)}박스` : '';
        const detail = [boxText, qtyText.replace(/^,\s*/, '')].filter(Boolean).join(', ');
        return `
            <li class="flex items-baseline gap-1.5 pl-0">
                <span class="font-extrabold ${arrTone} whitespace-nowrap">${it.arrivalLabel}</span>
                <span class="text-amber-700 dark:text-amber-400">-</span>
                <span class="font-bold">${escapeHtml(it.packDateText)} 패킹:</span>
                <span class="opacity-95">${escapeHtml(detail)} 입고예정</span>
            </li>
        `;
    }).join('');
}

const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);

// ────────────────────────────────────────
// 초기화 / 자동 갱신
// ────────────────────────────────────────
export function initIncomingScheduleWidget() {
    fetchIncomingSchedule(); // 즉시 1회
    if (_refreshTimer) clearInterval(_refreshTimer);
    _refreshTimer = setInterval(fetchIncomingSchedule, REFRESH_INTERVAL_MS);

    const refreshBtn = document.getElementById('refresh-incoming-btn');
    if (refreshBtn && !refreshBtn.__bound) {
        refreshBtn.__bound = true;
        refreshBtn.addEventListener('click', () => {
            // 짧은 쿨다운 — 30초 내 재요청 방지
            if (Date.now() - _lastFetchAt < 30_000) return;
            fetchIncomingSchedule();
        });
    }
}
