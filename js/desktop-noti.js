// === js/desktop-noti.js ===
// 업무 캘린더 미리 알림(type 'calendar')을 Windows 알림(브라우저 알림)으로도 띄운다.
//   - 앱 안 알림창은 앱 화면이 앞에 있을 때만 보인다. 브라우저를 내려 두거나 다른 프로그램을 보고 있을 때를 위해
//     화면이 안 보이거나 창에 초점이 없을 때만 띄운다(보이고 있으면 앱 알림창이 이미 뜬다).
//   - 허용은 일정에 알림을 걸고 [저장]을 누를 때 묻는다(js/widget-calendar.js) — 브라우저는 클릭 때만 물을 수 있다.
//   - 같은 알림 id 는 tag 로 묶여 창(탭)이 여러 개여도 한 번만 보인다.
//   - 알림 구독 두 곳(js/app-sync.js 대시보드 · js/app-shell-noti.js 다른 화면)이 새 알림마다 부른다.
import { isAutomation } from './lib/noti-popup.js?v=202611051513';

const TYPES = new Set(['calendar', 'notice', 'approval']);   // notice: 중요 공지 알림(2026-11-04) · approval: 기안서 제출·결재(2026-11-05)
const TITLES = { calendar: '업무 일정 알림', notice: '중요 공지', approval: '기안서 알림' };

export function desktopNotifySupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
}

/** 허용 상태: 'granted' | 'denied' | 'default' | 'unsupported' */
export function desktopNotifyPermission() {
    return desktopNotifySupported() ? Notification.permission : 'unsupported';
}

/** 아직 묻지 않았으면 허용을 묻는다(클릭 처리 안에서 불러야 한다). 결과를 기다리지 않아도 된다. */
export function askDesktopNotifyPermission() {
    if (!desktopNotifySupported() || Notification.permission !== 'default') return Promise.resolve(desktopNotifyPermission());
    try { return Promise.resolve(Notification.requestPermission()).catch(() => 'default'); }
    catch (e) { return Promise.resolve('default'); }
}

/** 새 알림 하나({ id, message, type }) — 조건이 맞으면 Windows 알림으로 띄운다 */
export function desktopNotify(noti) {
    try {
        if (!noti || !TYPES.has(noti.type) || isAutomation()) return;
        if (desktopNotifyPermission() !== 'granted') return;
        if (document.visibilityState === 'visible' && document.hasFocus()) return;
        const n = new Notification(TITLES[noti.type] || '업무 일정 알림', {
            body: String(noti.message || '').replace(/^🗓️\s*/, '').replace(/^📢 중요 공지[^\n]*\n/, ''),
            tag: `noti-${noti.id || ''}`
        });
        n.onclick = () => { try { window.focus(); n.close(); } catch (e) { /* 무시 */ } };
    } catch (e) {
        // 알림을 못 띄워도 앱 알림(종)은 그대로 있다
    }
}
