// === js/lib/resigned-emails.js ===
// 관리자 설정 저장 때 퇴사자 { 이메일(소문자): 퇴사일 } 만들기. 2026-10-14 보안점검(규칙이 퇴사자를 이메일로 막는다)
//
// 퇴사자 행의 이메일 칸을 비우고 저장해도 규칙에서 빠지지 않게, 이번 저장에 이메일이 없으면
//   저장 전 설정(prevMemberEmails)의 이메일로 보충한다. 단 그 이메일을 지금 다른 사람이 쓰면 보충하지 않는다
//   (재직자를 퇴사자로 막는 사고 방지).
// 순수 모듈(DOM/Firebase 의존 없음).

/**
 * @param {Object<string,string>} resignedMembers  { 이름: 퇴사일 }
 * @param {Object<string,string>} memberEmails     이번 저장의 { 이름: 이메일 }
 * @param {Object<string,string>} prevMemberEmails 저장 전 설정의 { 이름: 이메일 } (보충용)
 * @param {Map<string,string>} [emailOwner]        이번 저장에서 { 이메일(소문자) → 이름 }
 * @returns {Object<string,string>} { 이메일(소문자): 퇴사일 }
 */
export function buildResignedEmails(resignedMembers, memberEmails, prevMemberEmails, emailOwner) {
    const out = {};
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
