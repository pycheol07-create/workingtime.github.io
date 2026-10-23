// === js/lib/resigned-emails.js ===
// 관리자 설정 저장 때 퇴사자 { 이메일(소문자): 퇴사일 } 만들기. 2026-10-14 보안점검(규칙이 퇴사자를 이메일로 막는다)
//
// 퇴사자 행의 이메일 칸을 비우고 저장해도 규칙에서 빠지지 않게, 이번 저장에 이메일이 없으면
//   저장 전 설정(prevMemberEmails)의 이메일로 보충한다. 단 그 이메일을 지금 다른 사람이 쓰면 보충하지 않는다
//   (재직자를 퇴사자로 막는 사고 방지).
// 2026-10-23: 저장 전 resignedEmails(prevResignedEmails)를 물려받는다 — 퇴사자 행을 지우거나 이메일을 비워도
//   규칙에서 빠지지 않게(빠지면 그 사람이 계산기 guest 로 들어온다). 빠지는 것은 이번 저장에서 재직 중인 사람
//   (emailOwner 에 있고 그 이름이 퇴사가 아님 = 재입사·다른 재직자)의 이메일뿐이다.
// 순수 모듈(DOM/Firebase 의존 없음).

/**
 * @param {Object<string,string>} resignedMembers  { 이름: 퇴사일 }
 * @param {Object<string,string>} memberEmails     이번 저장의 { 이름: 이메일 }
 * @param {Object<string,string>} prevMemberEmails 저장 전 설정의 { 이름: 이메일 } (보충용)
 * @param {Map<string,string>} [emailOwner]        이번 저장에서 { 이메일(소문자) → 이름 } (팀원·시스템 계정 전부)
 * @param {Object<string,string>} [prevResignedEmails] 저장 전 설정의 { 이메일(소문자): 퇴사일 } (물려받기)
 * @returns {Object<string,string>} { 이메일(소문자): 퇴사일 }
 */
export function buildResignedEmails(resignedMembers, memberEmails, prevMemberEmails, emailOwner, prevResignedEmails) {
    const out = {};
    const resigned = resignedMembers || {};
    // 이번 저장에서 재직 중인 이메일 — 명단에 있고 그 이름이 퇴사가 아님
    const isActive = (em) => {
        const owner = emailOwner && emailOwner.get(em);
        return !!owner && !resigned[owner];
    };
    Object.entries(prevResignedEmails || {}).forEach(([e, date]) => {
        const em = String(e || '').trim().toLowerCase();
        if (em && !isActive(em)) out[em] = String(date || '');
    });
    Object.entries(resignedMembers || {}).forEach(([name, date]) => {
        let em = String((memberEmails || {})[name] || '').trim().toLowerCase();
        if (!em) {
            const prev = String((prevMemberEmails || {})[name] || '').trim().toLowerCase();
            const owner = emailOwner && emailOwner.get(prev);
            if (prev && (!owner || owner === name)) em = prev;
        }
        if (em) out[em] = String(date || '');
    });
    return out;
}
