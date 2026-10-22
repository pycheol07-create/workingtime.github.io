// === js/lib/calc-member.js ===
// 통합계산기 로그인 게이트(calculator/auth-gate.js)의 '앱에 등록된 사용자인가' 판정 — 순수 함수(node --test: tests/calc-member.test.js).
// 대시보드(js/app.js startAppAfterLogin)와 같은 기준:
//   이름 = memberEmails(이름 → 이메일)에서 찾고, 없으면 systemAccounts[{ email, name, role }] 의 name.
//   이름이 없으면 '등록 안 됨'. 퇴사 = resignedEmails[이메일] 또는 resignedMembers[이름].
// 더해서 firestore.rules isMember() 처럼 memberRoles 에 이메일이 있어야 한다
//   (관리자 '전체 저장' 이 두 목록의 이메일을 memberRoles 에 넣는다 — 없으면 데이터를 하나도 못 읽는다).
// 이름·이메일은 돌려주지 않는다(화면·로그에 남기지 않게) — 결과는 상태 글자 하나.

const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const norm = (s) => String(s || '').trim().toLowerCase();

/** → 'ok' | 'unregistered' | 'resigned'. cfg 가 없으면(읽기 거부) 'unregistered'. */
export const calcMemberStatus = (cfg, email) => {
    const e = norm(email);
    if (!cfg || typeof cfg !== 'object' || !e) return 'unregistered';
    const emails = (cfg.memberEmails && typeof cfg.memberEmails === 'object') ? cfg.memberEmails : {};
    const hit = Object.entries(emails).find(([, m]) => norm(m) === e);
    const sys = (Array.isArray(cfg.systemAccounts) ? cfg.systemAccounts : [])
        .find(a => a && typeof a === 'object' && norm(a.email) === e);
    const name = hit ? hit[0] : (sys ? sys.name : null);
    if (!name || !own(cfg.memberRoles, e)) return 'unregistered';
    if (own(cfg.resignedEmails, e) || (own(cfg.resignedMembers, name) && cfg.resignedMembers[name])) return 'resigned';
    return 'ok';
};
