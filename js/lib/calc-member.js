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


// ── 계산기 열람 판정 (2026-10-23 외부 열람) ────────────────────────────────────
// 계산기는 등록 직원이 아니어도 로그인한 사람(guest)이면 쓴다. 퇴사자는 막는다.
//   cfg       : mainConfig 내용(읽었을 때. 문서 없음이면 null) — 직원은 읽힌다
//   cfgDenied : mainConfig 읽기가 permission-denied 였나(명단 밖·퇴사자는 규칙상 못 읽는다)
//   probe     : 그때 공개 사본 calcPublic/settings 를 읽어 본 결과 'allow' | 'deny' | 'error'
//               (규칙 isCalcUser — 퇴사자·이메일 없는 토큰은 거부. 문서가 없어도 허용이면 'allow')
//   email     : 로그인한 이메일
/** → 'member' | 'guest' | 'resigned' | 'blocked' | 'error' */
export const calcAccess = ({ cfg, cfgDenied, probe, email } = {}) => {
    if (!norm(email)) return 'blocked';
    if (cfgDenied) {
        if (probe === 'allow') return 'guest';
        if (probe === 'deny') return 'blocked';
        return 'error';
    }
    const st = calcMemberStatus(cfg, email);
    if (st === 'resigned') return 'resigned';
    if (st === 'ok') return 'member';
    return 'guest';
};

// ── 계산기 사용 권한(calculator.view) — 직원(member)일 때만 본다(2026-10-23) ───────────────────
// 사용자 결정: 공용 설정은 '권한 받은 직원만 저장'(관리자 + calculator.view), 계산은 누구나 한다 → 권한이 없어도 막지 않는다
//   (permEnforce 'block' 이어도 보기 전용으로 연다).
// 판정은 firestore.rules hasFeature() 와 같은 식으로 직접 계산한다(화면 허용 = 서버 허용):
//   관리자(memberRoles[e] == 'admin' · 퇴사 아님)
//   || (memberRoles 에 있음 && 퇴사(resignedEmails) 아님 && permOverrides[e].deny 에 없음
//       && (permOverrides[e].allow 에 있음 || permRoles[permAssign[e]].features 에 있음))
//   옛 메뉴 권한(memberMenuAccess)은 보지 않는다(규칙이 모른다). 값 모양이 틀리면 규칙은 평가 오류 → 거부이므로 여기서도 readonly.
//   'allow'    공용 설정 저장 가능 · 'readonly' 계산기는 열고 공용 설정은 보기 전용
export const CALC_FEATURE = 'calculator.view';
const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** → 'allow' | 'readonly' */
export const calcPermDecision = (cfg, email) => {
    const e = norm(email);
    const c = isMap(cfg) ? cfg : {};
    const roles = isMap(c.memberRoles) ? c.memberRoles : {};
    if (!e || !own(roles, e) || own(isMap(c.resignedEmails) ? c.resignedEmails : {}, e)) return 'readonly';
    if (roles[e] === 'admin') return 'allow';
    const allOv = c.permOverrides === undefined ? {} : c.permOverrides;
    if (!isMap(allOv)) return 'readonly';
    const ov = own(allOv, e) ? allOv[e] : {};
    if (!isMap(ov)) return 'readonly';
    const deny = ov.deny === undefined ? [] : ov.deny;
    const allow = ov.allow === undefined ? [] : ov.allow;
    if (!Array.isArray(deny) || !Array.isArray(allow)) return 'readonly';
    if (deny.includes(CALC_FEATURE)) return 'readonly';
    if (allow.includes(CALC_FEATURE)) return 'allow';
    const assign = isMap(c.permAssign) ? c.permAssign : {};
    const roleId = own(assign, e) ? assign[e] : '';
    const permRoles = isMap(c.permRoles) ? c.permRoles : {};
    const role = (typeof roleId === 'string' && own(permRoles, roleId)) ? permRoles[roleId] : {};
    const feats = isMap(role) && Array.isArray(role.features) ? role.features : [];
    return feats.includes(CALC_FEATURE) ? 'allow' : 'readonly';
};
