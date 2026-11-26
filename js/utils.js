// === js/utils.js ===

/**
 * 인원 산정용 정직원 명단(중복 제거 + 인원 제외 명단 적용)을 반환.
 * - 멤버 리스트 표시(선택 모달 등)에는 쓰지 않음. "몇 명?"을 셀 때만 사용.
 * - 제외 명단: appConfig.headcountExcludedMembers (없으면 빈 배열).
 * - teamGroups 내에서 한 사람이 여러 그룹에 들어 있어도 1명으로 셈.
 */
export const getRegularMembersForCount = (appConfig, dateStr = null) => {
    const flat = (appConfig?.teamGroups || []).flatMap(g => g?.members || []);
    const excluded = new Set(appConfig?.headcountExcludedMembers || []);
    const asOf = dateStr || getTodayDateString();
    const uniq = new Set();
    flat.forEach(name => {
        if (!name) return;
        if (excluded.has(name)) return;
        if (!isMemberActiveOn(name, asOf, appConfig)) return; // 퇴사자 제외(해당 날짜 기준)
        uniq.add(name);
    });
    return uniq;
};

// 전체 업무 키 목록(중복 제거, 순서: taskGroups → keyTasks → quantityTaskTypes → qualityCostTasks 보충)
export const getAllTaskKeys = (appConfig) => {
    const cfg = appConfig || {};
    const seen = new Set();
    const out = [];
    const add = (t) => { if (t && !seen.has(t)) { seen.add(t); out.push(t); } };
    (cfg.taskGroups || []).forEach(g => (g.tasks || []).forEach(add));
    (cfg.keyTasks || []).forEach(add);
    (cfg.quantityTaskTypes || []).forEach(add);
    (cfg.qualityCostTasks || []).forEach(add);
    return out;
};

// ===== 퇴사 처리(재직/비활성) 헬퍼 =====
// resignedMembers: { '이름': 'YYYY-MM-DD' }  ← 퇴사일. 팀원 데이터(급여·과거기록)는 그대로 두고 상태만 표시.

// 퇴사일 조회 (미퇴사면 null)
export const getResignationDate = (name, appConfig) => {
    const r = appConfig?.resignedMembers || {};
    return r[name] || null;
};

// 특정 날짜에 재직 중인지. 퇴사일 당일까지는 재직(포함), 그 다음날부터 비활성.
export const isMemberActiveOn = (name, dateStr, appConfig) => {
    const resign = getResignationDate(name, appConfig);
    if (!resign) return true;
    const asOf = dateStr || getTodayDateString();
    return asOf <= resign;
};

// 화면 명단(팀 선택·출근·연차 배정 등)에 노출할 '재직 중' 팀원 목록. 기본 오늘 기준.
export const getActiveTeamMembers = (appConfig, dateStr = null) => {
    const asOf = dateStr || getTodayDateString();
    const out = [];
    (appConfig?.teamGroups || []).forEach(g => (g?.members || []).forEach(name => {
        if (name && isMemberActiveOn(name, asOf, appConfig)) out.push(name);
    }));
    return out;
};

// 월급제 시급 환산 기준 시간(주휴 포함, 월 209시간). calc.js의 computeMonthlySalary와 동일 기준.
export const SALARY_STD_HOURS = 209;

/**
 * 인건비 계산용 "시급" 맵을 생성한다.
 * ⚠️ appConfig.memberWages 값은 "월 기본급"(월급제)이므로 시급 = 기본급 ÷ 209로 환산해야 한다.
 *    (예전에 memberWages가 시급이던 흔적으로, 여러 집계 코드가 월기본급을 시급처럼 곱해
 *     월급제 인건비가 209배 부풀려지는 버그가 있었음 → 이 헬퍼로 일원화)
 * 파트타이머(시급제) 시급은 이 맵 위에 각 호출부에서 pt.wage로 덮어쓴다(이미 시급이라 환산 대상 아님).
 * @returns {{[member: string]: number}} 팀원명 → 시급(원)
 */
export const buildMemberHourlyWageMap = (memberWages = {}) => {
    const out = {};
    const src = memberWages || {};
    for (const name in src) {
        if (Object.prototype.hasOwnProperty.call(src, name)) {
            out[name] = (Number(src[name]) || 0) / SALARY_STD_HOURS;
        }
    }
    return out;
};

// 알림 띠(2026-11-26 앱 점검): 오류는 3초 만에 사라지지 않고 ✕ 를 누를 때까지(또는 20초) 남는다 — 무엇이 잘못됐는지 읽을 틈.
//   같은 글·같은 종류(오류/보통)가 이미 떠 있으면 새로 쌓지 않고 그 띠를 다시 보여 준다(반복 실패가 화면을 덮지 않게). 한꺼번에 최대 4개
//   (넘치면 오류가 아닌 띠부터 뺀다). opts.action = { label, onClick } 이면 단추를 붙이고(예: 되돌리기) 10초 남긴다(합치지 않음).
//   opts.ms 로 남는 시간을 바꾼다. isError 자리에 false/true 를 넘기던 옛 호출은 그대로 동작한다.
// ⚠️ 업무마감봇(앱\업무마감봇\실행기.py)은 마감을 누른 뒤 '#toast-container .toast' 중 class 에 'bg-red-' 가 있는 띠를
//   '앱이 거부함' 으로 읽는다(띄운 시각은 안 봄). 예전 오류 띠는 3초면 사라졌으므로, 오류 띠는 처음 3초만 bg-red-500 클래스를
//   달고 그 뒤에는 같은 색을 인라인으로 칠해 남긴다 — 봇에게는 예전과 똑같이 보인다. 닫기(✕)는 글자 없는 그림(봇이 읽는 글에 안 섞이게).
const TOAST_MAX = 4;
const TOAST_FRESH_MS = 3000;
const TOAST_RED = '#ef4444';
function markToastFresh(t) {
    if (t.dataset.err !== '1') return;
    clearTimeout(Number(t.dataset.freshTimer));
    t.style.background = '';
    t.classList.add('bg-red-500');
    t.dataset.freshTimer = String(setTimeout(() => {
        if (!t.isConnected) return;
        t.style.background = TOAST_RED;
        t.classList.remove('bg-red-500');
    }, TOAST_FRESH_MS));
}
export const showToast = (message, isError = false, opts = {}) => {
    const container = document.getElementById('toast-container');
    if (!container) return;
    if (!container.hasAttribute('aria-live')) { container.setAttribute('aria-live', 'polite'); container.setAttribute('role', 'status'); }
    const text = String(message == null ? '' : message);
    const action = opts && opts.action && typeof opts.action.onClick === 'function' ? opts.action : null;
    const ms = Number(opts && opts.ms) || (isError ? 20000 : action ? 10000 : 3000);
    const err = isError ? '1' : '0';
    const close = (t) => {
        if (!t.isConnected || t.dataset.closing) return;
        t.dataset.closing = '1';
        t.classList.remove('show');
        t.addEventListener('transitionend', () => t.remove(), { once: true });
        setTimeout(() => t.remove(), 600);   // transition 이 없으면(스타일 못 받음) 그래도 지운다
    };
    if (!action) {
        const same = [...container.children].find(t => t.dataset.msg === text && t.dataset.err === err && t.dataset.act !== '1' && !t.dataset.closing);
        if (same) {
            container.prepend(same);
            markToastFresh(same);
            clearTimeout(Number(same.dataset.timer));
            same.dataset.timer = String(setTimeout(() => close(same), ms));
            return;
        }
    }
    while (container.children.length >= TOAST_MAX) {
        const kids = [...container.children];
        (kids.reverse().find(t => t.dataset.err !== '1') || container.lastElementChild).remove();
    }
    const toast = document.createElement('div');
    toast.className = `toast p-3 rounded-lg shadow-xl text-white ${isError ? 'bg-red-500' : 'bg-green-500'}`;
    toast.dataset.msg = text;
    toast.dataset.err = err;
    if (action) toast.dataset.act = '1';
    if (isError) toast.setAttribute('role', 'alert');
    toast.style.display = 'flex'; toast.style.alignItems = 'center'; toast.style.gap = '10px';
    const span = document.createElement('span');
    span.style.flex = '1'; span.style.minWidth = '0';
    span.textContent = text;
    toast.appendChild(span);
    if (action) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(action.label || '되돌리기');
        b.style.cssText = 'flex:none;padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.8);background:transparent;color:#fff;font-weight:700;font-size:12px;cursor:pointer;';
        b.addEventListener('click', () => { close(toast); try { action.onClick(); } catch (e) { console.error(e); } });
        toast.appendChild(b);
    }
    if (isError || action) {
        const x = document.createElement('button');
        x.type = 'button';
        x.setAttribute('aria-label', '닫기');
        x.style.cssText = 'flex:none;display:flex;padding:2px;border:0;background:transparent;color:#fff;cursor:pointer;opacity:.85;';
        x.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
        x.addEventListener('click', () => close(toast));
        toast.appendChild(x);
    }
    container.prepend(toast);
    markToastFresh(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    toast.dataset.timer = String(setTimeout(() => close(toast), ms));
};

// 🧪 시험 전용 스위치 — 로컬 주소 + 자동화 브라우저 + localStorage 'test.nativeDialogs'='1' 일 때만 브라우저 기본 창으로 돌린다.
//    예전 에뮬레이터 시험(tools/*-check.py)이 page.on('dialog') 로 창을 받아 누르기 때문(2026-11-26 앱 창 전환).
//    운영 주소·사람 브라우저·봇(그 칸을 쓰지 않음)에서는 늘 앱 창이다.
// 시험용 기본 창 글자 — 본문 그대로, 제목은 본문에 없을 때만 뒤에(첫 줄 경고를 보는 시험이 있다)
const testDialogText = (message, title) => {
    const m = String(message == null ? '' : message), t = String(title == null ? '' : title);
    return !t || m.includes(t) ? m : (m ? m + '\n\n' + t : t);
};
const nativeDialogsForTest = () => {
    try {
        const h = location.hostname;
        return (h === 'localhost' || h === '127.0.0.1') && navigator.webdriver === true && localStorage.getItem('test.nativeDialogs') === '1';
    } catch (_) { return false; }
};

// 네이티브 confirm 대체 — 스타일된 모달, Promise<boolean> 반환.
// 자체 DOM을 생성하므로 어느 페이지에서나 동작(별도 마크업/컨테이너 불필요).
// opts.backdrop === false 면 바깥 클릭으로 닫히지 않는다(두 단추가 모두 '실행' 이라 바깥 클릭=취소가 위험한 창 — 예: 메모 충돌).
// Esc·Enter 는 문서 capture 단계에서 먼저 받아 아래 창의 키 처리로 넘기지 않는다(2026-11-26 — 확인창만 닫히고 아래 창은 그대로).
// z-index 2147483646 — 브라우저 기본 창처럼 맨 위(로딩 덮개 999999·권한 가림막·상단바 알림 패널보다 위, 에뮬레이터 띠 아래).
export const showConfirm = (message, opts = {}) => {
    const { title = '확인', okText = '확인', cancelText = '취소', danger = false, backdrop = true } = opts;
    if (nativeDialogsForTest()) return Promise.resolve(window.confirm(testDialogText(message, opts.title)));
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        // data-esc-modal·data-esc-close — 공용 ESC(js/modal-esc.js)가 아래 창 대신 이 확인창을 맨 위로 보고 [취소]를 누르게
        ov.setAttribute('data-esc-modal', '');
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(30,40,60,.45);display:flex;align-items:center;justify-content:center;padding:16px;';
        // D안: 주 버튼 = 주색 채움, 위험 = 흰 바탕 + 장미 테두리 (다크 미대응 — 인라인 스타일)
        const okStyle = danger ? 'border:1px solid #C9808A;background:#fff;color:#A0525C;' : 'border:1px solid #2F62C9;background:#2F62C9;color:#fff;';
        ov.innerHTML = `
            <div role="dialog" aria-modal="true" style="background:#fff;border-radius:18px;max-width:380px;width:100%;box-shadow:0 8px 24px rgba(30,40,60,.12);overflow:hidden;font-family:inherit;">
              <div style="padding:20px 20px 8px;font-weight:700;font-size:16px;color:#23272E;">${esc(title)}</div>
              <div style="padding:0 20px 18px;font-size:14px;color:#646B75;line-height:1.55;white-space:pre-line;">${esc(message)}</div>
              <div style="display:flex;gap:8px;padding:12px 16px;background:#F7F8FA;border-top:1px solid #E6E8EC;justify-content:flex-end;">
                <button data-act="cancel" data-esc-close style="padding:8px 16px;border-radius:999px;border:1px solid #D6DAE0;background:#fff;color:#23272E;font-weight:700;font-size:13px;cursor:pointer;">${esc(cancelText)}</button>
                <button data-act="ok" style="padding:8px 16px;border-radius:999px;${okStyle}font-weight:700;font-size:13px;cursor:pointer;">${esc(okText)}</button>
              </div>
            </div>`;
        const done = (val) => { ov.remove(); document.removeEventListener('keydown', onKey, true); resolve(val); };
        // 위험(danger) 확인창은 Enter 로 실행되지 않는다 — 포커스도 [취소] 에 둔다(UX 개선 6번).
        // (포커스된 버튼에서 Enter 를 누르면 그 버튼의 클릭이 나므로 [취소] 위 Enter 는 취소다)
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); }
            // Enter = 확인 — 단, 초점이 [취소] 단추에 있으면 그 단추대로(취소)
            else if (e.key === 'Enter' && !danger) { const onCancel = e.target && e.target.closest && e.target.closest('[data-act="cancel"]'); e.preventDefault(); e.stopImmediatePropagation(); done(!onCancel); }
        };
        ov.addEventListener('click', (e) => {
            if (e.target === ov) { if (backdrop) done(false); return; } // 바깥 클릭=취소(backdrop:false 면 무시)
            const b = e.target.closest('[data-act]');
            if (b) done(b.dataset.act === 'ok');
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov);
        const firstFocus = ov.querySelector(danger ? '[data-act="cancel"]' : '[data-act="ok"]');
        if (firstFocus) firstFocus.focus();
    });
};

// 네이티브 alert·prompt 대체(2026-11-26 앱 점검) — 앱 모양 안내 창. 둘 다 Promise(닫힐 때 끝남).
// ⚠️ role="alertdialog" 이고 단추에 data-act 를 쓰지 않는다 — 업무마감봇은 div[role=dialog] + [data-act] 를 '마감 확인창' 으로
//    읽어 누른다(앱\업무마감봇\실행기.py). 안내 창이 그 흐름에 끼어들지 않게 다른 표시를 쓴다. 공용 ESC(js/modal-esc.js)용 data-esc-* 는 둔다.
const dlgEsc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function openAppDialog({ title, message, isError, input, okText = '확인', cancelText = '취소' }) {
    return new Promise((resolve) => {
        const ov = document.createElement('div');
        ov.setAttribute('data-esc-modal', '');
        ov.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:rgba(30,40,60,.45);display:flex;align-items:center;justify-content:center;padding:16px;';
        const head = title ? `<div style="padding:20px 20px 8px;font-weight:700;font-size:16px;color:${isError ? '#A0525C' : '#23272E'};">${dlgEsc(title)}</div>` : '<div style="height:14px"></div>';
        const field = input ? `<div style="padding:0 20px 14px;"><input data-dlg-input type="text" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #D6DAE0;border-radius:10px;font-size:14px;color:#23272E;background:#fff;" value="${dlgEsc(input.value)}" placeholder="${dlgEsc(input.placeholder || '')}"></div>` : '';
        const cancelBtn = input ? `<button data-dlg="cancel" data-esc-close style="padding:8px 16px;border-radius:999px;border:1px solid #D6DAE0;background:#fff;color:#23272E;font-weight:700;font-size:13px;cursor:pointer;">${dlgEsc(cancelText)}</button>` : '';
        ov.innerHTML = `
            <div role="alertdialog" aria-modal="true" style="background:#fff;border-radius:18px;max-width:400px;width:100%;box-shadow:0 8px 24px rgba(30,40,60,.12);overflow:hidden;font-family:inherit;">
              ${head}
              <div style="padding:0 20px 16px;font-size:14px;color:#646B75;line-height:1.55;white-space:pre-line;max-height:60vh;overflow:auto;">${dlgEsc(message)}</div>
              ${field}
              <div style="display:flex;gap:8px;padding:12px 16px;background:#F7F8FA;border-top:1px solid #E6E8EC;justify-content:flex-end;">
                ${cancelBtn}
                <button data-dlg="ok" ${input ? '' : 'data-esc-close'} style="padding:8px 16px;border-radius:999px;border:1px solid #2F62C9;background:#2F62C9;color:#fff;font-weight:700;font-size:13px;cursor:pointer;">${dlgEsc(okText)}</button>
              </div>
            </div>`;
        const inp = ov.querySelector('[data-dlg-input]');
        const done = (ok) => {
            ov.remove(); document.removeEventListener('keydown', onKey, true);
            resolve(input ? (ok ? inp.value : null) : undefined);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); done(false); }
            else if (e.key === 'Enter') {
                const onCancel = e.target && e.target.closest && e.target.closest('[data-dlg="cancel"]');
                e.preventDefault(); e.stopImmediatePropagation(); done(!onCancel);
            }
        };
        ov.addEventListener('click', (e) => {
            if (e.target === ov) { if (!input) done(false); return; }   // 안내 창은 바깥 클릭으로 닫힘, 입력 창은 안 닫힘(입력 보호)
            const btn = e.target.closest('[data-dlg]');
            if (btn) done(btn.dataset.dlg === 'ok');
        });
        document.addEventListener('keydown', onKey, true);
        document.body.appendChild(ov);
        const f = inp || ov.querySelector('[data-dlg="ok"]');
        if (f) { f.focus(); if (inp) inp.select(); }
    });
}
/** alert() 대신 — 앱 모양 안내 창. await 하면 닫힐 때까지 기다린다. opts: { title, isError, okText } */
export const showAlert = (message, opts = {}) => {
    if (nativeDialogsForTest()) { window.alert(testDialogText(message, opts.title)); return Promise.resolve(); }
    if (typeof document === 'undefined' || !document.body) { try { window.alert(String(message)); } catch (_) {} return Promise.resolve(); }
    return openAppDialog({ title: opts.title || '', message, isError: !!opts.isError, okText: opts.okText || '확인' });
};
/** prompt() 대신 — 입력 창. 확인 → 입력한 글(빈 글 포함), 취소·Esc → null (prompt 와 같은 약속). opts: { title, placeholder, okText, cancelText } */
export const showPrompt = (message, defaultValue = '', opts = {}) => {
    if (nativeDialogsForTest()) return Promise.resolve(window.prompt(String(message == null ? '' : message), defaultValue == null ? '' : String(defaultValue)));
    if (typeof document === 'undefined' || !document.body) { try { return Promise.resolve(window.prompt(String(message), defaultValue)); } catch (_) { return Promise.resolve(null); } }
    return openAppDialog({ title: opts.title || '', message, input: { value: defaultValue == null ? '' : String(defaultValue), placeholder: opts.placeholder },
        okText: opts.okText || '확인', cancelText: opts.cancelText || '취소' });
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

/** HTML 에 값을 끼워 넣기 전에 반드시 통과시킬 것.
 *  상품명·메모처럼 사람이 넣은 값에 < " ' 가 들어오면 마크업이 깨지거나 코드로 해석된다.
 *  (예전에는 이 함수를 모듈마다 다시 써서 13벌이 돌아다녔다) */
export const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Firebase 오류 → 직원이 할 수 있는 일 한 줄. 원시 코드(permission-denied 등)를 그대로 보여 주지 않는다.
 *  알 수 없는 오류는 코드만 괄호로 붙인다(관리자에게 알릴 때 쓰도록). */
export const friendlyFirebaseError = (e) => {
    const code = String((e && e.code) || '').replace(/^(firestore|auth|storage)\//, '');
    if (code === 'permission-denied' || code === 'unauthenticated') return '권한이 없습니다 — 관리자에게 문의하세요';
    if (code === 'unavailable' || /network/i.test(code)) return '인터넷 연결을 확인하세요';
    if (code === 'deadline-exceeded') return '응답이 늦습니다 — 잠시 뒤 다시 시도하세요';
    if (code) return `잠시 뒤 다시 시도하세요 (${code})`;
    // 코드가 없는 오류(프로그램 오류 등)는 원인을 짧게 붙인다 — 같은 실패를 계속 다시 누르지 않고 관리자에게 알릴 수 있게
    const msg = String((e && e.message) || '').trim().slice(0, 60);
    return msg ? `처리 중 오류가 났습니다 — 관리자에게 알려 주세요 (${msg})` : '잠시 뒤 다시 시도하세요';
};

/** 시간(hour) → '2시간 30분'. 음수도 부호를 붙여 그대로 표기한다.
 *  formatDuration 과 달리 공백이 없고 음수를 다룬다(남는 시간/초과 시간 표시용). */
export const formatHM = (hours) => {
    const total = Math.round(Math.abs(Number(hours) || 0) * 60);
    const sign = (Number(hours) || 0) < 0 ? '-' : '';
    const h = Math.floor(total / 60), m = total % 60;
    if (h === 0) return `${sign}${m}분`;
    return m === 0 ? `${sign}${h}시간` : `${sign}${h}시간 ${m}분`;
};

/** 분 → '1시간 30분' */
export const formatMinutesHM = (minutes) => formatHM((Number(minutes) || 0) / 60);

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

/** Date → 'YYYY-MM-DD' (로컬 기준).
 *
 *  ⚠️ toISOString().slice(0,10) 을 그냥 쓰면 안 된다 — UTC 로 바뀌면서 한국시간(UTC+9)에서는
 *     ① 오전 9시 이전의 new Date() 가 '어제'가 되고,
 *     ② new Date('2026-09-08T00:00:00') 처럼 로컬 자정으로 만든 날짜도 통째로 하루 밀린다.
 *     날짜 문자열이 필요하면 언제나 이 함수를 쓸 것. */
export const toDateString = (date = new Date()) => {
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const getTodayDateString = () => toDateString(new Date());

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

// 🔥 법정 공휴일 — 달력 표시와 업무 예상(주말·공휴일 건너뛰기)에서 함께 쓴다.
//
// ⚠️ 설·추석·대체공휴일은 해마다 날짜가 달라 아래 표에 직접 적어야 한다.
//    표가 끝난 해로 넘어가면 **에러 없이 기능만 조용히 꺼진다**
//    (연휴를 주말로만 세어 '업무 예상'의 밀린 물량 보정이 사라진다).
//    그래서 표가 못 덮는 해를 물어보면 콘솔에 한 번 경고한다.
export const HOLIDAY_TABLE_LAST_YEAR = 2027;
const warnedHolidayYears = new Set();   // 해마다 한 번만 경고(달력은 두 해를 번갈아 묻는다)

export function getHolidayName(year, month, day) {
    if (year > HOLIDAY_TABLE_LAST_YEAR && !warnedHolidayYears.has(year)) {
        warnedHolidayYears.add(year);
        console.warn(`[공휴일] ${year}년 표가 없습니다 — 설·추석·대체공휴일이 평일로 잡힙니다.`
                   + ` js/utils.js 의 variableHolidays 에 ${year}년을 추가하세요`
                   + ` (현재 ${HOLIDAY_TABLE_LAST_YEAR}년까지).`);
    }
    const mm = String(month).padStart(2, '0');
    const dd = String(day).padStart(2, '0');
    const md = `${mm}-${dd}`;
    const ymd = `${year}-${mm}-${dd}`;

    const fixedHolidays = {
        '01-01': '신정', '03-01': '3·1절', '05-05': '어린이날', '06-06': '현충일',
        '08-15': '광복절', '10-03': '개천절', '10-09': '한글날', '12-25': '기독탄신일(크리스마스)',
        // 근로자의 날 — 관공서 공휴일은 아니지만(근로기준법상 유급휴일) 우리 팀은 쉰다.
        // 해마다 같은 날이고 예전에도 쉬었으므로 fixed 에 둔다(과거 날짜도 맞게 나온다).
        // ⚠️ 대체공휴일이 붙지 않는다 — 토·일과 겹쳐도 그대로 넘어간다.
        '05-01': '근로자의 날'
    };

    const variableHolidays = {
        '2024-02-09': '설날 연휴', '2024-02-10': '설날', '2024-02-11': '설날 연휴', '2024-02-12': '대체공휴일',
        '2024-04-10': '국회의원선거', '2024-05-06': '대체공휴일', '2024-05-15': '부처님오신날',
        '2024-09-16': '추석 연휴', '2024-09-17': '추석', '2024-09-18': '추석 연휴',
        '2025-01-28': '설날 연휴', '2025-01-29': '설날', '2025-01-30': '설날 연휴',
        '2025-03-03': '대체공휴일', '2025-05-05': '어린이날/부처님오신날', '2025-05-06': '대체공휴일',
        '2025-10-05': '추석 연휴', '2025-10-06': '추석', '2025-10-07': '추석 연휴', '2025-10-08': '대체공휴일',
        '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
        '2026-03-02': '대체공휴일', '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일',
        '2026-06-03': '지방선거', '2026-08-17': '대체공휴일',
        '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-10-05': '대체공휴일',   /* 개천절(10/3 토) 대체 = 10/5(월). 10/4(일)는 잘못 들어가 있던 항목이라 뺐다(2026-10-07) */
        // 2027 — 설(2/7 일) → 2/9 대체 · 광복절(8/15 일) → 8/16 · 개천절(10/3 일) → 10/4
        //        한글날(10/9 토) → 10/11 · 성탄절(12/25 토) → 12/27
        //        추석(9/14~16 화·수·목)은 주말과 안 겹쳐 대체공휴일이 없다.
        // 제헌절 — 2008년에 공휴일에서 빠졌다가 되살아났다. **과거로 소급하면 안 되므로**
        //          fixed 가 아니라 해마다 적는다(2024·2025년은 실제로 근무일이었다).
        '2026-07-17': '제헌절', '2027-07-17': '제헌절', '2027-07-19': '대체공휴일',
        '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일',
        '2027-05-13': '부처님오신날', '2027-08-16': '대체공휴일',
        '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
        '2027-10-04': '대체공휴일', '2027-10-11': '대체공휴일', '2027-12-27': '대체공휴일'
    };

    if (variableHolidays[ymd]) return variableHolidays[ymd];
    if (fixedHolidays[md]) return fixedHolidays[md];
    return null;
}
