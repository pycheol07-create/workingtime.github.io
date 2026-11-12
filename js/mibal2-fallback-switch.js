// === js/mibal2-fallback-switch.js ===
// 부족수량관리 비상 스위치 버튼(2026-11-10 사용자 결정) — 신규 화면(js/china-mibal2.js)이 정적 import, 관리자에게만 그린다.
// 스위치 문서(js/lib/mibal2-fallback.js FALLBACK_PATH)에 쓰는 곳은 여기 한 곳뿐(setDoc 2곳 — 켜기·되돌리기).
// 누르기 전에 서버 값을 다시 읽고, 그 값의 반대 방향으로만 쓴다(두 관리자가 동시에 눌러도 같은 방향을 두 번 쓰지 않게).
// 관리자 제한은 화면 판정이다 — 규칙은 mibal2/{docId}(hasFeature('china.mibal2')) 그대로.
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { FALLBACK_PATH } from './lib/mibal2-fallback.js?v=202611120908';
import { readFallback } from './mibal2-fallback-watch.js?v=202611120908';

const fmtMD = (s) => { const p = String(s || '').split('-'); return p.length === 3 ? `${+p[1]}.${+p[2]}` : String(s || ''); };

/** 켜기 확인창 문구 */
export function onConfirmText(ships) {
    const list = (ships || []).map(fmtMD).join(', ');
    return '비상 전환 — 기존 화면에서 스캐너 작업을 하게 할까요?\n\n'
        + '· 이 화면(신규)은 바로 조회 전용이 됩니다\n'
        + '· 스캔을 잠시 멈추세요\n'
        + `· 기존 화면에서 출고일을 [작업 출고일 ${list || '없음'}]로 맞춘 뒤 미발재고로그를 올리세요\n`
        + '  — 올리기 전에는 기존 화면이 스캐너에 쓰지 않습니다\n'
        + '· 끝나면 스캔을 다시 시작하세요\n\n'
        + NET_NOTE + '\n\n'
        + '되돌릴 때는 이 화면의 같은 버튼을 누릅니다.';
}
// 인터넷이 끊긴 PC 는 스위치가 바뀐 것을 모른다(30초 넘게 서버 확인이 안 되면 스스로 조회 전용이 되지만, 그 전까지는 모름)
const NET_NOTE = '⚠ 다른 PC(특히 지금 쓰기 중인 화면)가 인터넷에 연결돼 있고 그 화면의 띠가 \'조회 전용\'으로 바뀐 것을 확인한 뒤 진행하세요.';
/** 되돌리기 확인창 문구 */
export function offConfirmText() {
    return '신규 화면으로 되돌릴까요?\n\n'
        + '· 기존 화면은 바로 조회 전용이 됩니다\n'
        + '· 스캔을 잠시 멈추세요\n'
        + '· 이 화면을 새로고침 → 출고일 확인 → [스캐너에 반영] → 스캔 다시 시작\n'
        + '· 그날 작업이 끝나면 [작업 마감]\n\n'
        + NET_NOTE + '\n\n'
        + '[확인]을 누르면 이 화면을 새로고침합니다.';
}

/**
 * @param {object} o { db, el(버튼을 넣을 곳), getShips()→[작업 출고일], isBusy()→bool, memberName()→string, onWritten(fb) }
 * @returns {{ render(fb) }} 스위치 값이 바뀔 때마다 render 로 버튼 글자를 맞춘다
 */
export function mountFallbackSwitch(o) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'btn-mibal2-fallback';
    btn.className = 'd-btn d-btn-sm';
    btn.textContent = '비상: 기존 화면으로';
    btn.title = '관리자 — 신규 화면에 문제가 있을 때 기존 화면에서 스캐너 작업을 하게 바꿉니다(배포 없이 바로)';
    o.el.prepend(btn);
    let working = false;

    function render(fb) {
        if (fb && fb.known && fb.on) { btn.textContent = '신규 화면으로 되돌리기'; btn.title = '비상 전환을 끝내고 신규 화면에서 다시 작업합니다'; btn.classList.add('d-btn-primary'); }
        else { btn.textContent = '비상: 기존 화면으로'; btn.title = '관리자 — 신규 화면에 문제가 있을 때 기존 화면에서 스캐너 작업을 하게 바꿉니다(배포 없이 바로)'; btn.classList.remove('d-btn-primary'); }
    }

    btn.addEventListener('click', async () => {
        if (working) return;
        if (o.isBusy && o.isBusy()) { alert('이 화면에서 작업을 처리하는 중입니다 — 끝난 뒤 다시 누르세요.'); return; }
        working = true; btn.disabled = true;
        try {
            const cur = await readFallback(o.db, { timeoutMs: 8000 });
            if (!cur.known && !cur.badShape) { alert('스위치를 서버에서 읽지 못했습니다 — 네트워크를 확인한 뒤 다시 누르세요(아무것도 바꾸지 않음).'); return; }
            const by = String((o.memberName && o.memberName()) || '');
            if (!cur.known) {
                // 문서 모양이 틀림(두 화면 모두 조회 전용) — 평소(신규 쓰기)로 되돌리는 것만 한다
                if (!confirm('스위치 값이 올바르지 않아 두 화면 모두 조회 전용입니다.\n신규 화면 쓰기(평소)로 되돌릴까요?\n\n[확인]을 누르면 이 화면을 새로고침합니다.')) return;
                await setDoc(doc(o.db, FALLBACK_PATH), { on: false, atMs: 0, offAtMs: Date.now(), offTs: serverTimestamp(), by, ships: [], updatedAt: serverTimestamp() });
                location.reload();
                return;
            }
            if (!cur.on) {
                if (o.isBusy && o.isBusy()) { alert('이 화면에서 작업을 처리하는 중입니다 — 끝난 뒤 다시 누르세요.'); return; }
                const ships = ((o.getShips && o.getShips()) || []).map(String);
                if (!confirm(onConfirmText(ships))) return;
                const next = { on: true, atMs: Date.now(), by, ships };
                // 문서 통째로(merge 아님) — 지난 되돌리기 칸(offAtMs·offTs)을 남기지 않는다. atTs = 서버 시각(비교는 서버 시각끼리)
                await setDoc(doc(o.db, FALLBACK_PATH), { ...next, atTs: serverTimestamp(), updatedAt: serverTimestamp() });
                if (o.onWritten) o.onWritten({ known: true, on: true, atMs: next.atMs, offAtMs: 0, ships });
                render({ known: true, on: true });
            } else {
                if (!confirm(offConfirmText())) return;
                // merge — 켤 때의 atMs·atTs·ships 는 그대로 두고 되돌린 시각(PC·서버)만 더한다
                await setDoc(doc(o.db, FALLBACK_PATH), { on: false, offAtMs: Date.now(), offTs: serverTimestamp(), by, updatedAt: serverTimestamp() }, { merge: true });
                location.reload();
            }
        } catch (e) {
            console.error('[mibal2-fallback] 스위치 저장 실패:', e && e.code);
            alert('스위치를 바꾸지 못했습니다(그대로입니다) — ' + ((e && e.code) || (e && e.message) || '알 수 없는 문제'));
        } finally { working = false; btn.disabled = false; }
    });
    return { render };
}
