// === js/china-mibal2-live-urgent.js ===
// 부족수량관리(신규) '긴급' 상품 쓰기 — 단독 운영(live) 모듈(js/china-mibal2-live.js)이 만든다. 2026-11-27 사용자 요청.
// 문서 하나만 쓴다: artifacts/team-work-logger-v2/mibal2/urgent (모양은 js/lib/mibal2-urgent.js 머리말 — 입고 스캐너와의 계약)
//   · 켜기  = 트랜잭션 set { v:1, enabled:true, codes:{}, enabledAt, enabledBy, updatedAt } (codes 는 빈 상태로 시작)
//   · 끄기  = 트랜잭션 update { enabled:false, codes:{}, updatedAt } — 한 번의 쓰기로 모두 해제(enabledAt·enabledBy 는 남김)
//   · 지정·해제 = 트랜잭션 update 필드 경로(codes.<코드>) 여러 개 — 다른 코드 칸은 건드리지 않는다. 꺼져 있으면 쓰지 않는다
// 규칙: firestore.rules match /artifacts/team-work-logger-v2/mibal2/{docId} — hasFeature('china.mibal2') 만 쓰기(관리자 포함), 읽기는 등록 직원.
// 이메일은 계약 칸(byEmail·enabledBy)에만 소문자로 넣는다(화면·로그에 찍지 않음).
import { doc, runTransaction, serverTimestamp, deleteField, FieldPath } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { parseUrgent, urgentChanges, URGENT_DOC_PATH, URGENT_WRITE_MAX } from './lib/mibal2-urgent.js?v=8b9020e9f9f6-dcb7b034';

/**
 * @param {{ db, myEmail: () => string }} ctx
 * @returns {{ enable, disable, setCodes }}
 */
export function setupLiveUrgent(ctx) {
    const { db } = ctx;
    const ref = doc(db, URGENT_DOC_PATH);
    const email = () => String((ctx.myEmail && ctx.myEmail()) || '').trim().toLowerCase();

    /** 켜기 — 이미 켜져 있으면 쓰지 않는다 → { ok, already } */
    function enable() {
        return runTransaction(db, async (tx) => {
            const s = await tx.get(ref);
            if (parseUrgent(s.exists() ? s.data() : null).enabled) return { ok: true, already: true };
            tx.set(ref, { v: 1, enabled: true, codes: {}, enabledAt: serverTimestamp(), enabledBy: email(), updatedAt: serverTimestamp() });
            return { ok: true, already: false };
        });
    }

    /** 끄기 — 지정한 긴급도 모두 해제(한 번의 쓰기). 이미 꺼져 있으면 쓰지 않는다 → { ok, already, count(그때 해제된 수) } */
    function disable() {
        return runTransaction(db, async (tx) => {
            const s = await tx.get(ref);
            const u = parseUrgent(s.exists() ? s.data() : null);
            if (!s.exists() || !u.enabled) return { ok: true, already: true, count: 0 };
            tx.update(ref, { enabled: false, codes: {}, updatedAt: serverTimestamp() });
            return { ok: true, already: false, count: u.count };
        });
    }

    /**
     * 여러 상품 지정(on true)·해제(false) — 한 번의 쓰기. 꺼져 있으면 { ok:false, off:true } (쓰지 않음).
     * @returns {Promise<{ ok, off?, changed, same }>}
     */
    function setCodes(codes, on) {
        return runTransaction(db, async (tx) => {
            const s = await tx.get(ref);
            const u = parseUrgent(s.exists() ? s.data() : null);
            if (!s.exists() || !u.enabled) return { ok: false, off: true, changed: 0, same: 0 };
            const { change, same } = urgentChanges(u, codes, on);
            if (!change.length) return { ok: true, changed: 0, same };
            if (change.length > URGENT_WRITE_MAX) throw Object.assign(new Error(`한 번에 ${URGENT_WRITE_MAX}개까지만 바꿀 수 있습니다(${change.length}개 고름)`), { code: 'too-many' });
            const by = email();
            const args = [];
            change.forEach(c => { args.push(new FieldPath('codes', c), on ? { at: serverTimestamp(), byEmail: by } : deleteField()); });
            tx.update(ref, ...args, 'updatedAt', serverTimestamp());
            return { ok: true, changed: change.length, same };
        });
    }

    return { enable, disable, setCodes };
}
