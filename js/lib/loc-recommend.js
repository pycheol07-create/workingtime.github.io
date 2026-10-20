// === js/lib/loc-recommend.js ===
// 로케이션 변경 추천 계산 — 화면(location.js 의 [변경 추천] 모달)과 서버(업무자동화\앱\로케이션추천, node 로 실행)가 같이 쓴다.
// 순수 ESM: DOM·window·Firebase 를 쓰지 않는다. import 는 ./mibal2-rows.js·./mibal2-calc.js 만.
//
// 무엇이 어디서 왔나 (location.js 원래 줄 — 2026-10-19 기준):
//   makeRankers         ← showSingleRecommendation 의 getZoneRank·getDongRank·getPosRank
//   baseLocsForCode     ← getBaseLocsForCode
//   scoreItems          ← showSingleRecommendation 1단계(점수). 수요(zgQty·wQty·trendVal)는 밖에서 넣는다(화면·서버가 다름)
//   emptySlots          ← 2단계(빈 자리) + 4단계(정렬: 동 > 위치 > 구역)
//   recommendSingle     ← 5·6단계(점수 1위부터 빈 자리 배정)
//   buildPairMap        ← showPairRecommendation 2단계(신뢰 페어)
//   recommendPairs      ← 3~6단계(단독 결과 안에서 페어 묶기·파트너 재배정)
//   moveQtyOf           ← 이동수량(정상 합 - 비축 대표값)
// 회귀 테스트: tests/loc-recommend.test.js 가 tests/fixtures/loc-recommend-legacy.js(원래 코드 사본)와 결과를 비교한다.
//   옵션(zoneGuard·excludeTagged)을 끄면 원래 코드와 결과가 같아야 한다.
//
// 새로 더한 것(설계 로케이션추천_설계.md 3절):
//   zoneGuard     새 자리 구역 순위가 지금 자리보다 나쁘면(숫자가 크면) 더 좋은 자리로 보지 않는다
//   excludeTagged 예약(reserved)·당일지정/선지정(codeTag) 빈 자리를 빼고 추천한다(입고 추천과 같은 기준)
//   slotCost·recommendSwaps·selectPlan·frontShare·excelRows·normalizeLocs·runRecommend(서버 진입점)
//
// ⚠️ 이 파일을 고치면 서버(로케이션추천)도 바로 바뀐다 — 서버는 배포본이 아니라 v.수정본 소스를 node 로 읽는다.

import { isEtcLocObj } from './mibal2-rows.js?v=202610210848';
import { capacityFor } from './mibal2-calc.js?v=202610210848';

export { isEtcLocObj };

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const RANK_NONE = 99;

// ─────────────────────────────────────────────────────────────
// 기본 헬퍼
// ─────────────────────────────────────────────────────────────

/** 구역·동·위치 순위 함수. 설정에 없으면 99. P = 위치 개수(자리 비용 계산용). */
export function makeRankers(priorities) {
    const pr = priorities || {};
    const zoneRank = (locId) => {
        const prefix = (locId || '').charAt(0).toUpperCase();
        const zones = pr.zones || {};
        for (let i = 0; i <= 3; i++) {
            if (zones[i] && zones[i].includes(prefix)) return i;
        }
        return RANK_NONE;
    };
    const dongRank = (dong) => {
        const str = (dong || '').toString().trim();
        const idx = pr.dongs.indexOf(str);
        return idx !== -1 ? idx : RANK_NONE;
    };
    const posRank = (pos) => {
        const str = (pos || '').toString().trim();
        const idx = pr.poses.indexOf(str);
        return idx !== -1 ? idx : RANK_NONE;
    };
    const P = Math.max(1, (pr.poses || []).length);
    const nDongs = (pr.dongs || []).length;
    return { zoneRank, dongRank, posRank, P, nDongs };
}

/** 피킹용 자리가 있으면 피킹용만, 없으면 전체(기타·SAM). */
export function baseLocsForCode(locs, code) {
    const all = locs.filter(d => d.code === code);
    const picking = all.filter(d => !isEtcLocObj(d));
    return picking.length > 0 ? picking : all;
}

/** 이동수량 = 그 코드 자리들의 정상재고 합 - 비축재고 대표값(칸마다 같은 값이 반복 저장돼 있어 합이 아니라 최댓값). */
export function moveQtyOf(locs, code) {
    let ts = 0, ts2 = 0;
    locs.forEach(d => { if (d.code === code) { ts += Number(d.stock || 0); ts2 = Math.max(ts2, Number(d.stock2f || 0)); } });
    return ts - ts2;
}

const optionOf = (locs, code) => {
    const base = baseLocsForCode(locs, code);
    const locData = base.find(d => d.option) || base[0];
    return (locData && locData.option) ? locData.option : '';
};

/** ms → 그날 한국시간 00:00 의 ms */
export function kstMidnight(nowMs) {
    const t = Number(nowMs);
    return Math.floor((t + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS;
}

/**
 * 서버용 정리 — 화면이 Locations 를 받을 때 하는 일(location.js 의 codeTag 자정 초기화)을 메모리에서만 한다.
 *   · codeTagAt 이 오늘(KST) 0시 전이면 codeTag 를 비운다(화면은 DB 도 지우지만 서버는 쓰지 않는다)
 *   · 숫자로 온 id·code 는 문자열로(화면 코드가 .trim() 을 부른다)
 * 원본 배열·객체는 바꾸지 않고 얕은 사본을 돌려준다.
 */
export function normalizeLocs(locs, nowMs = Date.now()) {
    const todayStart = kstMidnight(nowMs);
    return (locs || []).filter(d => d && typeof d === 'object' && d.id != null && d.id !== '').map(d => {
        const o = { ...d };
        o.id = String(o.id);
        if (typeof o.code === 'number') o.code = String(o.code);
        if (o.codeTag && o.codeTagAt && Number(o.codeTagAt) < todayStart) { o.codeTag = ''; o.codeTagAt = 0; }
        return o;
    });
}

// ─────────────────────────────────────────────────────────────
// 단독 추천
// ─────────────────────────────────────────────────────────────

/**
 * 상품 점수.
 * @param {object} a
 * @param {Array}  a.locs                 Locations 자리 목록(화면 originalData 와 같은 모양)
 * @param {Function|Object} a.demand      (code) => {name, zgQty, wQty, trendVal}  또는 {code: {...}}.
 *                                        객체로 주면 상품명은 자리(Locations) 이름 → demand.name → '알 수 없음' 순.
 * @param {{zikjin:number, weekly:number, trend:number}} a.ratios  합 100
 * @param {Object} [a.incomingTotalByCode] {code: 입고대기 합} — 0 보다 크면 대상에서 뺀다
 * @returns {Array} 점수 내림차순 [{code, name, score, currentLocs, zContrib, wContrib, tContrib, zgQty, wQty, trendVal}]
 */
export function scoreItems({ locs, demand, ratios, incomingTotalByCode }) {
    const inc = incomingTotalByCode || {};
    const dmOf = typeof demand === 'function' ? demand : (code) => {
        const dm = (demand && demand[code]) || {};
        const locItem = baseLocsForCode(locs, code)[0];
        return {
            name: (locItem && locItem.name) || dm.name || '알 수 없음',
            zgQty: Number(dm.zgQty) || 0, wQty: Number(dm.wQty) || 0, trendVal: Number(dm.trendVal) || 0
        };
    };
    const r = ratios || { zikjin: 60, weekly: 20, trend: 20 };

    const allCodes = new Set(
        locs
            .filter(d => d.code && d.code.trim() !== '' && d.code !== d.id)
            .filter(d => !(inc[d.code.trim()] > 0))
            .map(d => d.code.trim())
    );

    let maxZQty = 0;
    let maxWQty = 0;
    let maxTrend = 0;
    const itemDataList = [];

    allCodes.forEach(code => {
        const dm = dmOf(code);
        if (dm.zgQty > maxZQty) maxZQty = dm.zgQty;
        if (dm.wQty > maxWQty) maxWQty = dm.wQty;
        if (dm.trendVal > maxTrend) maxTrend = dm.trendVal;
        itemDataList.push({ code, name: dm.name, zgQty: dm.zgQty, wQty: dm.wQty, trendVal: dm.trendVal });
    });

    const scoredItems = [];
    itemDataList.forEach(item => {
        const zScore = maxZQty > 0 ? (item.zgQty / maxZQty) * 100 : 0;
        const wScore = maxWQty > 0 ? (item.wQty / maxWQty) * 100 : 0;
        const tScore = maxTrend > 0 ? (item.trendVal / maxTrend) * 100 : 0;
        const finalScore = (zScore * (r.zikjin / 100)) + (wScore * (r.weekly / 100)) + (tScore * (r.trend / 100));

        if (finalScore > 0) {
            // 피킹용이 메인 — 피킹용에 있으면 기타(T-01 등) 로케이션은 기준에서 제외
            const currentLocs = baseLocsForCode(locs, item.code).map(d => d.id);
            scoredItems.push({
                code: item.code,
                name: item.name,
                score: finalScore,
                currentLocs: currentLocs,
                zContrib: zScore * (r.zikjin / 100),
                wContrib: wScore * (r.weekly / 100),
                tContrib: tScore * (r.trend / 100),
                zgQty: item.zgQty, wQty: item.wQty, trendVal: item.trendVal
            });
        }
    });
    scoredItems.sort((a, b) => b.score - a.score);
    return scoredItems;
}

const isTagged = (d) => !!d.reserved || !!(d.codeTag && String(d.codeTag).trim() !== '');
const comboOf = (d) => `${(d.id || '').charAt(0).toUpperCase()}-${(d.dong || '').toString().trim()}`;

/**
 * 빈 자리(상품·상품명 없음, 선지정 아님, 기타 아님, 제외 조합 아님) → 동 > 위치 > 구역 순 정렬.
 * @param {{excludeTagged?: boolean, rankers?: object}} [opt]  excludeTagged: 예약·당일지정·선지정 태그 자리도 뺀다
 */
export function emptySlots(locs, priorities, { excludeTagged = false, rankers } = {}) {
    const rk = rankers || makeRankers(priorities);
    const excludeCombos = (priorities && priorities.excludeCombos) || [];
    const emptyLocs = locs.filter(d => {
        const hasContent = (d.code && d.code !== d.id && d.code.trim() !== "") || (d.name && d.name.trim() !== "");
        if (hasContent || d.preAssigned) return false;
        if (excludeTagged && isTagged(d)) return false;
        // 기타(비축·샘플·SAM)는 실제 피킹 랙이 아니므로 이동 추천 대상에서 제외
        if (isEtcLocObj(d)) return false;
        if (excludeCombos.length > 0 && excludeCombos.includes(comboOf(d))) return false;
        return true;
    });
    emptyLocs.sort((a, b) => {
        const dRankA = rk.dongRank(a.dong);
        const dRankB = rk.dongRank(b.dong);
        if (dRankA !== dRankB) return dRankA - dRankB;
        const pRankA = rk.posRank(a.pos);
        const pRankB = rk.posRank(b.pos);
        if (pRankA !== pRankB) return pRankA - pRankB;
        return rk.zoneRank(a.id) - rk.zoneRank(b.id);
    });
    return emptyLocs;
}

/**
 * 단독 추천 — 점수 1위부터, 정렬된 빈 자리 중 '더 좋은' 첫 자리를 배정한다.
 *   mode 'dong': 새 자리 동이 더 앞이어야 한다 / 'pos': 같은 동 안에서 위치가 더 앞이어야 한다.
 *   zoneGuard: 위 조건에 더해 새 자리 구역 순위 <= 지금 구역 순위.
 * @returns {{recs: Array, ctx: {emptyLocs, usedEmptyKeys: Set, rankers}, skipped: {noLoc, noBetter}}}
 *   recs[i] = {code, name, option, score, currentLocs(지금 자리 id), targetLoc, currentInfo, targetInfo, target(빈 자리 객체), item(점수 행), moveQty}
 */
export function recommendSingle({ locs, scored, priorities, mode = 'dong', limit = 10, zoneGuard = false, excludeTagged = false }) {
    const rk = makeRankers(priorities);
    const emptyLocs = emptySlots(locs, priorities, { excludeTagged, rankers: rk });
    const limitVal = Number(limit) || 0;

    const byId = new Map();
    locs.forEach(d => { if (!byId.has(d.id)) byId.set(d.id, d); });   // = originalData.find(d => d.id === locId)

    const isBetterSlot = (slotInfo, currentInfo) => {
        if (zoneGuard && slotInfo.zoneRank > currentInfo.zoneRank) return false;
        if (mode === 'pos') {
            if (slotInfo.dongRank !== currentInfo.dongRank) return false;
            return slotInfo.posRank < currentInfo.posRank;
        }
        return slotInfo.dongRank < currentInfo.dongRank;
    };
    const getLocInfo = (locId) => {
        const locData = byId.get(locId);
        if (!locData) return null;
        return {
            id: locId,
            dongRank: rk.dongRank(locData.dong),
            posRank: rk.posRank(locData.pos),
            zoneRank: rk.zoneRank(locId),
            dong: (locData.dong || '').toString().trim()
        };
    };
    const getEmptyLocInfo = (eLoc) => ({
        id: eLoc.id,
        dongRank: rk.dongRank(eLoc.dong),
        posRank: rk.posRank(eLoc.pos),
        zoneRank: rk.zoneRank(eLoc.id),
        dong: (eLoc.dong || '').toString().trim()
    });
    const slotInfos = emptyLocs.map(getEmptyLocInfo);

    const recs = [];
    let skipNoCurrentLoc = 0;
    let skipNoBetterSlot = 0;
    const usedEmptyKeys = new Set();

    for (let i = 0; i < scored.length; i++) {
        if (limitVal > 0 && recs.length >= limitVal) break;
        const item = scored[i];
        const currentLocId = item.currentLocs && item.currentLocs[0];
        if (!currentLocId) { skipNoCurrentLoc++; continue; }
        const currentInfo = getLocInfo(currentLocId);
        if (!currentInfo) { skipNoCurrentLoc++; continue; }

        let found = -1;
        for (let j = 0; j < emptyLocs.length; j++) {
            if (usedEmptyKeys.has(emptyLocs[j].id)) continue;
            if (isBetterSlot(slotInfos[j], currentInfo)) { found = j; break; }
        }
        if (found < 0) { skipNoBetterSlot++; continue; }

        const foundSlot = emptyLocs[found];
        usedEmptyKeys.add(foundSlot.id);
        recs.push({
            code: item.code,
            name: item.name,
            option: optionOf(locs, item.code),
            score: item.score,
            currentLocs: currentInfo.id,
            targetLoc: foundSlot.id,
            currentInfo,
            targetInfo: getEmptyLocInfo(foundSlot),
            target: foundSlot,
            item,
            moveQty: moveQtyOf(locs, item.code)
        });
    }

    return {
        recs,
        ctx: { emptyLocs, usedEmptyKeys: new Set(usedEmptyKeys), rankers: rk },
        skipped: { noLoc: skipNoCurrentLoc, noBetter: skipNoBetterSlot }
    };
}

// ─────────────────────────────────────────────────────────────
// 페어
// ─────────────────────────────────────────────────────────────

/**
 * 신뢰 페어 → {code: [{partner, weight}] (weight 내림차순, topK 개)}.
 *   lift = count·N / (cA·cB),  weight = lift·count.  count < minCount 또는 lift < minLift 면 버린다.
 *   서버(가중 집계)용 선택 필드: pair.rawCount 가 있으면 minCount 비교에 그것을 쓰고,
 *   minRecent > 0 이면 pair.recentCount >= minRecent 인 것만 남긴다. 둘 다 없으면 화면과 같다.
 * @param {{pairs: Array<{codeA, codeB, count, rawCount?, recentCount?}>, stats: Object<string,{count}>, N: number}} a
 */
export function buildPairMap({ pairs, stats, N, minCount = 5, minLift = 2, topK = 5, minRecent = 0 }) {
    const pairMap = {};
    const st = stats || {};
    (pairs || []).forEach(p => {
        const cA = (st[p.codeA] || {}).count || 0;
        const cB = (st[p.codeB] || {}).count || 0;
        if (cA === 0 || cB === 0) return;
        const lift = (p.count * N) / (cA * cB);
        const cnt = p.rawCount != null ? p.rawCount : p.count;
        if (cnt < minCount || lift < minLift) return;
        if (minRecent > 0 && !((p.recentCount || 0) >= minRecent)) return;
        const weight = lift * p.count;
        if (!pairMap[p.codeA]) pairMap[p.codeA] = [];
        if (!pairMap[p.codeB]) pairMap[p.codeB] = [];
        pairMap[p.codeA].push({ partner: p.codeB, weight: weight });
        pairMap[p.codeB].push({ partner: p.codeA, weight: weight });
    });
    for (const code in pairMap) {
        pairMap[code].sort((a, b) => b.weight - a.weight);
        pairMap[code] = pairMap[code].slice(0, topK);
    }
    return pairMap;
}

/**
 * 페어 추천 — 단독 추천 결과 안에서 묶는다. 위 순위(base)는 단독 자리 그대로, 파트너는 base 와 같은 동
 * (같은 구역 우선, 위치가 가까운 순)의 빈 자리로 다시 배정한다. 파트너 자리가 단독 자리와 같으면 내지 않는다.
 * @param {{singleRecs: Array, ctx: {emptyLocs, usedEmptyKeys, rankers?, getPosRank?}, pairMap: Object}} a
 * @returns {Array<{baseItem, partnerItem, partnerNewSlot}>}
 */
export function recommendPairs({ singleRecs, ctx, pairMap }) {
    const posRankOf = (ctx.rankers && ctx.rankers.posRank) || ctx.getPosRank;
    const singleByCode = {};
    singleRecs.forEach((s, idx) => {
        singleByCode[s.code] = Object.assign({}, s, { singleRank: idx });
    });

    const matchedPairs = [];
    const usedCodes = new Set();
    const usedNewSlots = new Set();

    for (let i = 0; i < singleRecs.length; i++) {
        const base = singleRecs[i];
        if (usedCodes.has(base.code)) continue;

        const partners = pairMap[base.code] || [];
        if (partners.length === 0) continue;

        let foundPartner = null;
        for (let p = 0; p < partners.length; p++) {
            const partnerCode = partners[p].partner;
            if (usedCodes.has(partnerCode)) continue;
            if (!singleByCode[partnerCode]) continue;
            foundPartner = singleByCode[partnerCode];
            break;
        }
        if (!foundPartner) continue;

        const baseTargetInfo = base.targetInfo;
        if (!baseTargetInfo) continue;

        const baseDong = baseTargetInfo.dong;
        const baseZone = (base.targetLoc || '').charAt(0).toUpperCase();
        const basePosRank = baseTargetInfo.posRank;

        const occupiedKeys = new Set(ctx.usedEmptyKeys);
        occupiedKeys.delete(foundPartner.targetLoc);
        usedNewSlots.forEach(k => occupiedKeys.add(k));
        occupiedKeys.add(base.targetLoc);

        const sameDongSlots = ctx.emptyLocs.filter(eLoc => {
            if (occupiedKeys.has(eLoc.id)) return false;
            const eDong = (eLoc.dong || '').toString().trim();
            return eDong === baseDong;
        });
        if (sameDongSlots.length === 0) continue;

        const sameZoneInSameDong = sameDongSlots.filter(eLoc => (eLoc.id || '').charAt(0).toUpperCase() === baseZone);
        const otherZoneInSameDong = sameDongSlots.filter(eLoc => (eLoc.id || '').charAt(0).toUpperCase() !== baseZone);

        const posDistSort = (a, b) => {
            const aDist = Math.abs(posRankOf(a.pos) - basePosRank);
            const bDist = Math.abs(posRankOf(b.pos) - basePosRank);
            return aDist - bDist;
        };
        sameZoneInSameDong.sort(posDistSort);
        otherZoneInSameDong.sort(posDistSort);

        const partnerNewSlot = sameZoneInSameDong.concat(otherZoneInSameDong)[0];
        if (!partnerNewSlot) continue;
        if (partnerNewSlot.id === foundPartner.targetLoc) continue;   // 자리 변동 없음(케이스 A)

        matchedPairs.push({ baseItem: base, partnerItem: foundPartner, partnerNewSlot });
        usedCodes.add(base.code);
        usedCodes.add(foundPartner.code);
        usedNewSlots.add(partnerNewSlot.id);
    }
    return matchedPairs;
}

/** 페어 결과 → 화면 엑셀용 행(쌍마다 A·B 2행, {currentLocs, targetLoc, name, option, code}) */
export function pairExcelItems(matchedPairs) {
    const out = [];
    matchedPairs.forEach(mp => {
        const a = mp.baseItem, b = mp.partnerItem;
        out.push({ currentLocs: a.currentLocs || '-', targetLoc: a.targetLoc, name: a.name, option: a.option, code: a.code });
        out.push({ currentLocs: b.currentLocs || '-', targetLoc: mp.partnerNewSlot.id, name: b.name, option: b.option, code: b.code });
    });
    return out;
}

// ─────────────────────────────────────────────────────────────
// 자리 비용 · 맞바꾸기(스왑) · 계획
// ─────────────────────────────────────────────────────────────

/**
 * 자리 비용 c = 동순위·P + 위치순위 (P = 위치 개수). 작을수록 앞자리.
 *   mode 'pos' 면 위치순위만(같은 동끼리 비교할 때).
 *   동·위치·구역 중 하나라도 설정에 없으면(99) null — 스왑 대상에서 뺀다.
 *   loose: 99 대신 '맨 뒤 다음 칸'(동 개수·위치 개수)으로 계산해 숫자를 돌려준다(단독 이득 계산용).
 */
export function slotCost(slot, rankers, mode = 'dong', { loose = false } = {}) {
    if (!slot) return null;
    let d = rankers.dongRank(slot.dong);
    let p = rankers.posRank(slot.pos);
    const z = rankers.zoneRank(slot.id);
    if (!loose && (d === RANK_NONE || p === RANK_NONE || z === RANK_NONE)) return null;
    if (d === RANK_NONE) d = rankers.nDongs;
    if (p === RANK_NONE) p = rankers.P;
    return mode === 'pos' ? p : d * rankers.P + p;
}

const hasCode = (d) => !!(d.code && d.code !== d.id && String(d.code).trim() !== '');
const byKeyAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round = (v, n = 3) => { const f = 10 ** n; return Math.round(v * f) / f; };

/** 피킹 가능 자리(기타 아님·비용 있음·제외 조합 아님)를 비용 → id 순으로. */
export function rankedPickSlots(locs, priorities, rankers) {
    const rk = rankers || makeRankers(priorities);
    const excludeCombos = (priorities && priorities.excludeCombos) || [];
    const seen = new Set();
    const out = [];
    locs.forEach(d => {
        if (seen.has(d.id)) return;
        seen.add(d.id);
        if (isEtcLocObj(d)) return;
        if (excludeCombos.length && excludeCombos.includes(comboOf(d))) return;
        const c = slotCost(d, rk);
        if (c == null) return;
        out.push({ slot: d, cost: c });
    });
    out.sort((a, b) => a.cost - b.cost || byKeyAsc(a.slot.id, b.slot.id));
    return out;
}

/**
 * 앞쪽 영역 — 구역 등급(zoneRank)마다 비용 순 상위 K 칸씩. 등급을 섞어 잡으면 ★(등급 0) 같은 앞 구역이
 * 영역을 다 차지해 다른 등급 상품은 늘 '뒤'로 보이고, 같은 등급끼리만 바꾸는 맞바꾸기 후보가 사라진다.
 * K 번째 칸과 비용이 같은 칸은 모두 넣는다 — 같은 동·위치 칸이 수백 개라 id 순으로 자르면 같은 자리가 앞/뒤로 갈린다.
 * @param {Array<{slot, cost}>} ranked  rankedPickSlots 결과(비용 → id 순)
 * @param {number} K  등급마다 칸 수
 * @param {{pct?: number}} [opt]  pct(0~1) 를 주면 K 대신 등급마다 '그 등급 칸 수 × pct'(올림, 최소 1)
 * @returns {Set<string>} 자리 id
 */
export function frontByZone(ranked, rankers, K, { pct } = {}) {
    const byZone = new Map();
    ranked.forEach(x => {
        const z = rankers.zoneRank(x.slot.id);
        if (!byZone.has(z)) byZone.set(z, []);
        byZone.get(z).push(x);
    });
    const front = new Set();
    byZone.forEach(list => {
        const k = pct != null ? Math.max(1, Math.ceil(list.length * pct)) : K;
        if (!(k > 0) || !list.length) return;
        const edge = list[Math.min(k, list.length) - 1].cost;
        list.forEach(x => { if (x.cost <= edge) front.add(x.slot.id); });
    });
    return front;
}

/** 코드 → 피킹(기타 아님) 자리 목록 */
function pickSlotsByCode(locs) {
    const m = new Map();
    locs.forEach(d => {
        if (!hasCode(d) || isEtcLocObj(d)) return;
        const c = String(d.code).trim();
        if (!m.has(c)) m.set(c, []);
        m.get(c).push(d);
    });
    return m;
}

/** 출고 순위(일평균 내림차순, 같으면 코드 오름차순, 1부터). 일평균 0 이하는 순위 없음. */
export function demandRanks(daily) {
    const list = Object.keys(daily || {}).filter(c => Number(daily[c]) > 0)
        .sort((a, b) => (Number(daily[b]) - Number(daily[a])) || byKeyAsc(a, b));
    const r = {};
    list.forEach((c, i) => { r[c] = i + 1; });
    return r;
}

/**
 * 맞바꾸기 — 뒤에 있는 인기 상품(H)과 앞에 있는 비인기 상품(L)의 자리를 바꾼다.
 *   앞쪽 영역: 구역 등급마다 비용 순 상위 frontK 칸, K 번째와 비용이 같은 칸 포함(frontByZone)
 *   H: 점수 상위 topM 안 · 지금 자리가 자기 등급의 앞쪽 영역 밖 · 일평균 >= minDaily
 *   L: H 와 같은 등급의 앞쪽 영역 안 · d(L) <= d(H)/ratio
 *   둘 다: 피킹 자리 1곳뿐(다중 자리 제외) · 기타/SAM·선지정·예약·당일지정·제외 조합 자리 아님 · 입고대기 없음 ·
 *          excludeCodes/excludeLocIds(이번 계획 단독 추천이 쓴 코드·자리) 아님
 *   맞음: 구역 등급 같음 · 칸수(angleSize) 둘 다 있으면 같음 · 비용 차 >= P(1동 이상 앞)
 *   이득 = (d(H) - d(L)) · (c(H) - c(L)) / P.  적재량(capacityFor)보다 H 자리 수량이 많으면 capWarn(빼지는 않음).
 *   배정: 이득 내림차순 → H 코드 → L 코드 순으로 정렬해 앞에서부터 코드·자리가 안 겹치는 것만(탐욕).
 * @returns {{swaps: Array, inversions: number, counts: object, front: Set<string>}}
 */
export function recommendSwaps({
    locs, scored, daily, priorities, incomingTotalByCode, excludeCodes, excludeLocIds,
    topM = 200, frontK, ratio = 3, minDaily = 1, capacityConfig, editedCells
}) {
    const rk = makeRankers(priorities);
    const P = rk.P;
    const dOf = (c) => Number((daily || {})[c]) || 0;
    const inc = incomingTotalByCode || {};
    const exC = new Set(excludeCodes || []);
    const exL = new Set(excludeLocIds || []);
    const K = frontK == null ? topM : frontK;

    const ranked = rankedPickSlots(locs, priorities, rk);
    const front = frontByZone(ranked, rk, K);
    const costOf = new Map(ranked.map(x => [x.slot.id, x.cost]));
    const bySlotsOf = pickSlotsByCode(locs);

    const counts = { H: 0, L: 0, multiLoc: 0, candidates: 0 };
    const multiSeen = new Set();
    const okSlot = (d) => !d.preAssigned && !isTagged(d) && !exL.has(d.id) && costOf.has(d.id);
    // 코드 하나 → 그 코드의 유일한 피킹 자리(조건 안 맞으면 null)
    const soleSlot = (code) => {
        if (exC.has(code) || inc[code] > 0) return null;
        const list = bySlotsOf.get(code) || [];
        if (list.length !== 1) {
            if (list.length > 1 && !multiSeen.has(code)) { multiSeen.add(code); counts.multiLoc++; }
            return null;
        }
        return okSlot(list[0]) ? list[0] : null;
    };

    const H = [];
    (scored || []).slice(0, topM).forEach(it => {
        const s = soleSlot(it.code);
        if (!s || front.has(s.id)) return;
        if (dOf(it.code) < minDaily) return;
        H.push({ code: it.code, slot: s, d: dOf(it.code), c: costOf.get(s.id), z: rk.zoneRank(s.id) });
    });
    const L = [];
    ranked.forEach(({ slot }) => {
        if (!front.has(slot.id) || !hasCode(slot)) return;
        const code = String(slot.code).trim();
        const s = soleSlot(code);
        if (!s || s.id !== slot.id) return;
        L.push({ code, slot: s, d: dOf(code), c: costOf.get(s.id), z: rk.zoneRank(s.id) });
    });
    counts.H = H.length; counts.L = L.length;

    const angle = (d) => (d.angleSize ? String(d.angleSize).trim() : '');
    const cand = [];
    H.forEach(h => {
        L.forEach(l => {
            if (h.code === l.code) return;
            if (l.d > h.d / ratio) return;
            if (h.z !== l.z) return;
            const ah = angle(h.slot), al = angle(l.slot);
            if (ah && al && ah !== al) return;
            const dc = h.c - l.c;
            if (dc < P) return;
            cand.push({ h, l, dc, gain: (h.d - l.d) * dc / P });
        });
    });
    counts.candidates = cand.length;
    cand.sort((a, b) => (b.gain - a.gain) || byKeyAsc(a.h.code, b.h.code) || byKeyAsc(a.l.code, b.l.code));

    const usedC = new Set(), usedS = new Set();
    const swaps = [];
    cand.forEach(x => {
        if (usedC.has(x.h.code) || usedC.has(x.l.code) || usedS.has(x.h.slot.id) || usedS.has(x.l.slot.id)) return;
        usedC.add(x.h.code); usedC.add(x.l.code); usedS.add(x.h.slot.id); usedS.add(x.l.slot.id);
        const qtyH = Number(x.h.slot.stock || 0), qtyL = Number(x.l.slot.stock || 0);
        const ed = editedCells || {};
        const capL = capacityFor(x.l.slot.id, capacityConfig, ed[x.h.code]);   // H 가 들어갈 자리 적재량
        const capH = capacityFor(x.h.slot.id, capacityConfig, ed[x.l.code]);
        swaps.push({
            code: x.h.code, slotH: x.h.slot, code2: x.l.code, slotL: x.l.slot,
            daily: x.h.d, daily2: x.l.d, dc: x.dc, gain: x.gain,
            qty: qtyH, qty2: qtyL,
            capWarn: (capL > 0 && qtyH > capL) || (capH > 0 && qtyL > capH)
        });
    });
    return { swaps, inversions: cand.length, counts, front };
}

/** 단독 추천 한 건의 이득 = d · (c(지금) - c(새 자리)) / P  (설정에 없는 동·위치는 '맨 뒤 다음 칸'으로) */
export function singleGain(rec, daily, rankers, locs) {
    const cur = (locs || []).find(d => d.id === rec.currentLocs) || { id: rec.currentLocs, dong: '', pos: '' };
    const c0 = slotCost(cur, rankers, 'dong', { loose: true });
    const c1 = slotCost(rec.target || { id: rec.targetLoc, dong: '', pos: '' }, rankers, 'dong', { loose: true });
    const dc = c0 - c1;
    const d = Number((daily || {})[rec.code]) || 0;
    return { dc, gain: d * dc / rankers.P };
}

/**
 * 계획 — 단독(이동 1)·맞바꾸기(이동 2) 를 이득/이동수 내림차순으로 늘어놓는다.
 *   minGain 미만은 버린다. rows = 앞에서 maxRows 개(하루 목록). week = 앞에서부터 이동수 합이 weeklyMoves 를
 *   넘지 않게 담은 것(안 들어가는 큰 건은 건너뛰고 다음 것을 본다).
 * @param {{singles: Array<{recKey, gain}>, swaps: Array<{recKey, gain}>}} a
 */
export function selectPlan({ singles = [], swaps = [], maxRows = 15, weeklyMoves = 20, minGain = 0.5 }) {
    const items = [];
    let lowGain = 0;
    const add = (r, moves) => {
        if (!(Number(r.gain) >= minGain)) { lowGain++; return; }
        items.push({ row: r, moves, eff: r.gain / moves });
    };
    singles.forEach(r => add(r, 1));
    swaps.forEach(r => add(r, 2));
    items.sort((a, b) => (b.eff - a.eff) || (b.row.gain - a.row.gain) || byKeyAsc(a.row.recKey, b.row.recKey));
    const rows = items.slice(0, Math.max(0, maxRows)).map(x => x.row);
    const week = [];
    let weekMoves = 0;
    items.forEach(x => {
        if (weekMoves + x.moves > weeklyMoves) return;
        weekMoves += x.moves;
        week.push(x.row.recKey);
    });
    return { rows, week, weekMoves, dropped: { lowGain } };
}

/**
 * 좋은 자리 점유율 — 출고 상위 topN 코드 중 대표 피킹 자리가 자기 구역 등급의 앞쪽 영역에 있는 비율.
 *   앞쪽 영역(지표용): 등급마다 비용 순 상위 frontPct(기본 20%) 칸, K 번째와 비용이 같은 칸 포함(frontByZone).
 *   frontPct 를 null 로 주고 frontK 를 주면 옛 방식(등급마다 상위 K 칸) — 하위 호환용.
 *   맞바꾸기의 앞쪽 영역(swapFrontK 칸)과는 따로 잡는다.
 * @returns {{share: number|null, topN: number, counted: number, inFront: number}}
 */
export function frontShare({ locs, daily, priorities, topN = 100, frontPct = 0.2, frontK = 100 }) {
    const rk = makeRankers(priorities);
    const front = frontByZone(rankedPickSlots(locs, priorities, rk), rk, frontK, { pct: frontPct == null ? undefined : frontPct });
    const ranks = demandRanks(daily);
    const top = Object.keys(ranks).filter(c => ranks[c] <= topN);
    let counted = 0, inFront = 0;
    top.forEach(code => {
        const base = baseLocsForCode(locs, code);
        if (!base.length) return;
        counted++;
        if (base.some(d => !isEtcLocObj(d) && front.has(d.id))) inFront++;
    });
    return { share: counted ? round(inFront / counted, 4) : null, topN, counted, inFront, frontSlots: front.size };
}

// ─────────────────────────────────────────────────────────────
// 행 · 엑셀
// ─────────────────────────────────────────────────────────────

export const EXCEL_COLS = ['현재로케이션', '변경로케이션', '상품명', '옵션', '상품코드'];

/** 추천 키 — 단독 S:{code}:{from}>{to} · 맞바꾸기 W:{A}@{자리}~{B}@{자리}(코드 사전순) · 페어 P:{A}:{B}(사전순) */
export function recKeyOf(row) {
    if (row.type === 'swap') {
        const a = [row.code, row.from], b = [row.code2, row.from2];
        const [x, y] = byKeyAsc(a[0], b[0]) <= 0 ? [a, b] : [b, a];
        return `W:${x[0]}@${x[1]}~${y[0]}@${y[1]}`;
    }
    if (row.type === 'pair') {
        const [x, y] = [row.code, row.code2].sort(byKeyAsc);
        return `P:${x}:${y}`;
    }
    return `S:${row.code}:${row.from}>${row.to}`;
}

/**
 * 결과 행 → 엑셀 5열 행 [{현재로케이션, 변경로케이션, 상품명, 옵션, 상품코드}].
 *   단독 1행 · 맞바꾸기 2행(A: from→to, B: from2→to2) · 페어 2행(A, B).
 *   행 모양: {type, code, name, option, from, to, code2?, name2?, option2?, from2?, to2?}
 */
export function excelRows(rows) {
    const out = [];
    const one = (from, to, name, option, code) => ({
        '현재로케이션': from == null ? '' : from, '변경로케이션': to == null ? '' : to,
        '상품명': name == null ? '' : name, '옵션': option == null ? '' : option, '상품코드': code == null ? '' : code
    });
    (rows || []).forEach(r => {
        if (!r) return;
        out.push(one(r.from, r.to, r.name, r.option, r.code));
        if ((r.type === 'swap' || r.type === 'pair') && r.code2) out.push(one(r.from2, r.to2, r.name2, r.option2, r.code2));
    });
    return out;
}

// ─────────────────────────────────────────────────────────────
// 서버 진입점 (업무자동화\앱\로케이션추천\추천실행.mjs 가 stdin JSON 으로 부른다 — moduleSha·node 버전은 러너가 붙인다)
// ─────────────────────────────────────────────────────────────

export const SERVER_DEFAULTS = Object.freeze({
    mode: 'dong', singleLimit: 100, zoneGuard: true, excludeTagged: true,
    swapTopM: 200, swapFrontK: 200, swapRatio: 3, swapMinDaily: 1,
    maxRows: 15, weeklyMoves: 20, minGain: 0.5,
    metricTopN: 100, metricFrontPct: 0.2,          // 지표용 앞쪽 영역 = 등급마다 상위 20% 칸 (하위 호환: metricFrontPct 를 null 로 주면 metricFrontK 칸, 없으면 100)
    pairMinCount: 5, pairMinLift: 2, pairTopK: 5, pairMinRecent: 2
});

const DEFAULT_PRIORITIES = {
    zones: { 0: ['★'], 1: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'], 2: ['Z'], 3: ['L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'] },
    dongs: ['★', '1', '2', '3', '4', '5', '6'],
    poses: ['★', '2', '3', '4', '1', '5'],
    excludeCombos: []
};

const slotLabel = (d) => d ? { dong: (d.dong || '').toString().trim(), pos: (d.pos || '').toString().trim() } : { dong: '', pos: '' };

/**
 * 서버 계산 한 번. 입력·출력 모양은 tests/fixtures/locrec-input.example.json · locrec-output.example.json.
 * 순수 함수 — 같은 입력이면 같은 출력(nowMs 도 입력으로 받는다).
 */
export function runRecommend(input) {
    if (!input || typeof input !== 'object') throw new Error('입력이 비었습니다');
    if (!Array.isArray(input.locs)) throw new Error('locs 가 배열이 아닙니다');
    const S = { ...SERVER_DEFAULTS, ...(input.settings || {}) };
    const nowMs = Number(input.nowMs) || Date.now();
    const priorities = { ...DEFAULT_PRIORITIES, ...(input.priorities || {}) };
    const rk = makeRankers(priorities);
    const locs = normalizeLocs(input.locs, nowMs);
    const demandIn = input.demand || {};
    const daily = {};
    Object.keys(demandIn).forEach(c => { daily[c] = Number(demandIn[c] && demandIn[c].daily) || 0; });
    const ranks = demandRanks(daily);
    const incoming = input.incoming || {};
    const warn = [];

    const scored = scoreItems({ locs, demand: demandIn, ratios: input.ratios, incomingTotalByCode: incoming });

    // 1) 단독
    const single = recommendSingle({ locs, scored, priorities, mode: S.mode, limit: S.singleLimit, zoneGuard: S.zoneGuard, excludeTagged: S.excludeTagged });
    const singleRows = single.recs.map(r => {
        const g = singleGain(r, daily, rk, locs);
        const row = {
            type: 'single', code: r.code, name: r.name, option: r.option,
            from: r.currentLocs, to: r.targetLoc,
            fromDong: r.currentInfo.dong, toDong: slotLabel(r.target).dong, toPos: slotLabel(r.target).pos,
            qty: r.moveQty, daily: round(daily[r.code] || 0, 2), score: round(r.score, 2),
            gain: round(g.gain), dc: g.dc, demandRank: ranks[r.code] || null
        };
        row.recKey = recKeyOf(row);
        return row;
    });

    // 2) 맞바꾸기 — 계획에 들 수 있는 단독(이득 >= minGain)이 쓴 코드·자리는 뺀다
    const usable = singleRows.filter(r => r.gain >= S.minGain);
    const sw = recommendSwaps({
        locs, scored, daily, priorities, incomingTotalByCode: incoming,
        excludeCodes: usable.map(r => r.code), excludeLocIds: usable.flatMap(r => [r.from, r.to]),
        topM: S.swapTopM, frontK: S.swapFrontK, ratio: S.swapRatio, minDaily: S.swapMinDaily,
        capacityConfig: input.capacity || undefined, editedCells: input.editedCells || undefined
    });
    const nameOf = (code) => { const b = baseLocsForCode(locs, code)[0]; return (b && b.name) || (demandIn[code] && demandIn[code].name) || ''; };

    // 3) 페어 지도(자동 집계) — 자료가 없거나 '쌓는 중'이면 페어를 내지 않는다
    let pairMap = null;
    const pin = input.pairs;
    if (pin && pin.ready !== false && Array.isArray(pin.list)) {
        pairMap = buildPairMap({
            pairs: pin.list, stats: pin.stats || {}, N: Number(pin.N) || 1,
            minCount: S.pairMinCount, minLift: S.pairMinLift, topK: S.pairTopK, minRecent: S.pairMinRecent
        });
    } else if (pin && pin.ready === false) {
        warn.push('페어 자료 쌓는 중');
    }
    const partnerDongs = (code) => {
        if (!pairMap || !pairMap[code]) return [];
        return pairMap[code].map(p => {
            const b = baseLocsForCode(locs, p.partner)[0];
            return b && !isEtcLocObj(b) ? { code: p.partner, dong: slotLabel(b).dong } : null;
        }).filter(Boolean);
    };

    const swapRows = sw.swaps.map(s => {
        const row = {
            type: 'swap',
            code: s.code, name: nameOf(s.code), option: optionOf(locs, s.code), from: s.slotH.id, to: s.slotL.id,
            code2: s.code2, name2: nameOf(s.code2), option2: optionOf(locs, s.code2), from2: s.slotL.id, to2: s.slotH.id,
            fromDong: slotLabel(s.slotH).dong, toDong: slotLabel(s.slotL).dong,
            qty: s.qty, qty2: s.qty2, daily: round(s.daily, 2), daily2: round(s.daily2, 2),
            gain: round(s.gain), dc: s.dc, demandRank: ranks[s.code] || null, demandRank2: ranks[s.code2] || null,
            capWarn: s.capWarn
        };
        const near = partnerDongs(s.code).find(p => p.dong === row.toDong);
        if (near) row.pairNear = near.code;
        row.recKey = recKeyOf(row);
        return row;
    });

    // 4) 계획
    const plan = selectPlan({ singles: singleRows, swaps: swapRows, maxRows: S.maxRows, weeklyMoves: S.weeklyMoves, minGain: S.minGain });
    const picked = new Set(plan.rows.map(r => r.recKey));
    const order = new Map(plan.rows.map((r, i) => [r.recKey, i + 1]));
    const withRank = (r) => ({ ...r, rank: order.get(r.recKey) });
    const byRank = (a, b) => a.rank - b.rank;
    const outSingle = singleRows.filter(r => picked.has(r.recKey)).map(withRank).sort(byRank);
    const outSwap = swapRows.filter(r => picked.has(r.recKey)).map(withRank).sort(byRank);

    // 5) 페어 — 계획에 든 단독끼리만 묶는다(파트너는 같은 동 근처 빈 자리로 목표만 바뀐다)
    let outPair = [];
    if (pairMap) {
        const pickedRecs = single.recs.filter(r => picked.has(recKeyOf({ type: 'single', code: r.code, from: r.currentLocs, to: r.targetLoc })));
        const matched = recommendPairs({ singleRecs: pickedRecs, ctx: single.ctx, pairMap });
        outPair = matched.map((mp, i) => {
            const a = mp.baseItem, b = mp.partnerItem, ns = mp.partnerNewSlot;
            const gA = singleGain(a, daily, rk, locs);
            const gB = singleGain({ ...b, target: ns, targetLoc: ns.id }, daily, rk, locs);
            const row = {
                type: 'pair', rank: i + 1,
                code: a.code, name: a.name, option: a.option, from: a.currentLocs, to: a.targetLoc,
                code2: b.code, name2: b.name, option2: b.option, from2: b.currentLocs, to2: ns.id,
                toDong: (a.targetInfo && a.targetInfo.dong) || '', toDong2: slotLabel(ns).dong,
                qty: a.moveQty, qty2: b.moveQty, daily: round(daily[a.code] || 0, 2), daily2: round(daily[b.code] || 0, 2),
                gain: round(gA.gain + gB.gain), dc: gA.dc, dc2: gB.dc
            };
            row.recKey = recKeyOf(row);
            return row;
        });
    }

    const weekRowOf = new Map(singleRows.concat(swapRows).map(r => [r.recKey, order.has(r.recKey) ? withRank(r) : r]));
    const allGains = singleRows.map(r => r.gain).concat(swapRows.map(r => r.gain)).filter(g => g > 0).sort((a, b) => a - b);
    const p95 = allGains.length ? allGains[Math.min(allGains.length - 1, Math.floor(allGains.length * 0.95))] : 0;
    const usePct = S.metricFrontPct != null;   // 기본 0.2 — 옛 K 칸 방식은 metricFrontPct: null 로 끄고 metricFrontK 를 줄 때만
    const fs = frontShare({ locs, daily, priorities, topN: S.metricTopN,
        frontPct: usePct ? Number(S.metricFrontPct) : null, frontK: Number(S.metricFrontK) || 100 });

    return {
        schema: 1,
        single: outSingle,
        swap: outSwap,
        pair: outPair,
        plan: { order: plan.rows.map(r => r.recKey), week: plan.week, weekMoves: plan.weekMoves },
        // 주간 요약용 — plan.week 순서 그대로의 단독·맞바꾸기 행 전체(하루 표시 maxRows 에 잘리지 않는다). 표시 순위 rank 는 하루 목록에 든 행만
        weekRows: plan.week.map(k => weekRowOf.get(k)).filter(Boolean),
        metrics: {
            top100Front: fs.share, topN: fs.topN, counted: fs.counted, inFront: fs.inFront, frontSlots: fs.frontSlots,
            inversions: sw.inversions,
            gainSum: round(plan.rows.reduce((s, r) => s + r.gain, 0)),
            gainP95: round(p95)
        },
        counts: {
            locs: locs.length, scored: scored.length, emptySlots: single.ctx.emptyLocs.length,
            singleAll: singleRows.length, singleSkipped: single.skipped,
            swapAll: swapRows.length, swap: sw.counts, lowGain: plan.dropped.lowGain,
            pairMapCodes: pairMap ? Object.keys(pairMap).length : 0
        },
        settings: S,
        warn
    };
}
