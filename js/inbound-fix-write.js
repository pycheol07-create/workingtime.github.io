// === js/inbound-fix-write.js ===
// 부족수량관리 '입고확인 수동 수정' 쓰기 — 이 기능의 Firestore 쓰기는 여기에만 있다. 2026-11-04.
// 기존 화면(js/china-stock-goods.js)은 정적 import, 신규 화면(js/china-mibal2.js)은 입고확인 칸을 누를 때만 동적 import 한다.
//
// 쓰는 것(한 트랜잭션):
//   · ChinaStockGoods_InboundHistory/fix__{code}  — 통째로 set(qty += after − before, rev + 1, log 최근 20건). 'timestamp' 칸 없음
//   · ChinaStockGoods_ScanDB/{code}               — 문서가 있을 때만 { arrivalQty, mibalQty, updatedAt } merge
// 안 쓰는 것: ScanDB 문서 새로 만들기 · hold · 비축창고 · 강제전송 허용목록 — tests/mibal2-readonly.test.js 가 소스를 본다.
// 확인창을 띄운 사이 바뀐 것이 있으면 아무것도 쓰지 않는다(conflict):
//   rev   — 수정 문서 rev 가 읽을 때와 다름(다른 사람이 고침)
//   reset — 읽을 때 본 스캔 문서 하나가 없어짐(미발 초기화·live 작업 마감 — 지난 작업 기준 수정량이 새 작업에 남지 않게)
//   scan  — ScanDB 문서 있음/없음·arrivalQty·mibalQty 가 읽을 때와 다름(그사이 스캔 전송·스캐너 반영)
// 계산은 js/lib/inbound-fix.js(순수 함수). 기록자 = 직원 이름(이메일 아님).
import { doc, collection, query, where, getDocsFromServer, getDocFromServer, runTransaction, serverTimestamp }
    from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { fixIdOf, isFixId, inboundSplitOf, scanDbPairOf, nextFixDoc } from './lib/inbound-fix.js?v=202611050851';

const INBOUND = 'ChinaStockGoods_InboundHistory';
const SCANDB = 'ChinaStockGoods_ScanDB';

const sdOf = (data) => ({ arrivalQty: parseInt(data.arrivalQty) || 0, mibalQty: parseInt(data.mibalQty) || 0 });

/**
 * 서버에서 이 상품의 입고이력·스캐너 자료를 새로 읽는다(확인창에 보여 줄 값 + 기록 때 바뀌었는지 볼 값).
 * → { sum, scan, fixQty, rev, probeId, scanIds, scanDb: {arrivalQty, mibalQty} | null }
 *   probeId = 스캔 문서 id 하나(없으면 '') — 기록 때 이것이 없어졌으면 입고이력이 비워진 것
 *   scanIds = 스캔 문서 id 전부 — 대기 항목의 probe(고칠 때 본 스캔 문서)가 아직 있는지 본다(lib pendingReset)
 */
export async function readServerInbound(db, code) {
    const [snap, sd] = await Promise.all([
        getDocsFromServer(query(collection(db, INBOUND), where('barcode', '==', code))),
        getDocFromServer(doc(db, SCANDB, code))
    ]);
    const sp = inboundSplitOf(snap.docs.map(d => { const x = d.data() || {}; return { id: d.id, barcode: x.barcode, qty: x.qty, rev: x.rev }; }));
    const f = sp.fix[code];
    const scanIds = snap.docs.filter(d => !isFixId(d.id)).map(d => d.id);
    return {
        sum: sp.map[code] || 0, scan: sp.scan[code] || 0, fixQty: f ? f.qty : 0, rev: f ? f.rev : 0,
        probeId: scanIds[0] || '', scanIds,
        scanDb: sd.exists() ? sdOf(sd.data() || {}) : null
    };
}

/**
 * 여러 상품을 서버에서 새로 읽는다(묶음 저장 확인창용) — 동시에 limit 개씩. 하나라도 못 읽으면 오류(아무것도 쓰지 않게).
 * → { code: readServerInbound 결과 }
 */
export async function readServerInboundMany(db, codes, limit = 5) {
    const list = [...new Set(codes || [])];
    const out = {};
    let next = 0;
    const worker = async () => {
        while (next < list.length) {
            const code = list[next++];
            out[code] = await readServerInbound(db, code);
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
    return out;
}

/**
 * 입고확인 수정 기록(한 상품 — 묶음 저장은 이것을 건마다 차례로 부른다). base = ScanDB 칸을 만든 기준 { arr, mibal }(모르면 null).
 * seen = readServerInbound 결과(rev·probeId·scanDb 를 기록 때 다시 견준다).
 * → { ok: true, rev, scanDb: {arrivalQty, mibalQty} | null } | { ok: false, conflict: 'rev'|'reset'|'scan', rev }
 */
export async function writeInboundFix(db, { code, before, after, seen, base, by, note }) {
    const s = seen || {};
    const fixRef = doc(db, INBOUND, fixIdOf(code));
    const sdRef = doc(db, SCANDB, code);
    const probeRef = s.probeId ? doc(db, INBOUND, s.probeId) : null;
    return runTransaction(db, async (tx) => {
        const fs = await tx.get(fixRef);
        const ss = await tx.get(sdRef);
        const ps = probeRef ? await tx.get(probeRef) : null;
        const old = fs.exists() ? (fs.data() || {}) : null;
        const rev = old ? (parseInt(old.rev) || 0) : 0;
        if (rev !== (parseInt(s.rev) || 0)) return { ok: false, conflict: 'rev', rev };
        if (ps && !ps.exists()) return { ok: false, conflict: 'reset', rev };
        const curSd = ss.exists() ? sdOf(ss.data() || {}) : null;
        const seenSd = s.scanDb || null;
        if (!curSd !== !seenSd || (curSd && (curSd.arrivalQty !== seenSd.arrivalQty || curSd.mibalQty !== seenSd.mibalQty))) {
            return { ok: false, conflict: 'scan', rev };
        }
        const next = nextFixDoc(old, { at: Date.now(), by, before, after, note }, code);
        tx.set(fixRef, { ...next, updatedAt: serverTimestamp() });
        let sd = null;
        if (ss.exists()) {
            sd = scanDbPairOf({ cur: curSd, base, before, after });
            tx.set(sdRef, { arrivalQty: sd.arrivalQty, mibalQty: sd.mibalQty, updatedAt: serverTimestamp() }, { merge: true });
        }
        return { ok: true, rev: next.rev, scanDb: sd };
    });
}
