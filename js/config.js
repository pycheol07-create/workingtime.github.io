export const teamGroups = [
    { name: '관리', members: ['박영철', '박호진', '유아라', '이승운'] },
    { name: '공통파트', members: ['김수은', '이미숙', '김현', '박상희', '배은정', '김성곤', '김동훈', '신민재', '황호석'] },
    { name: '담당파트', members: ['송다진', '정미혜', '진희주'] },
    { name: '제작파트', members: ['이승운'] },
];

export const defaultMemberWages = {
    '유아라': 14114, '박호진': 14354, '송다진': 11722, '정미혜': 11483,
    '김수은': 11253, '이미숙': 11253, '이승운': 14593, '진희주': 10526,
    '김현': 10287, '배은정': 10287, '박상희': 10287, '김동훈': 10287,
    '신민재': 10047, '황호석': 10047
};

export const taskGroups = {
    '공통': ['국내배송', '중국제작', '직진배송', '티니', '택배포장', '해외배송', '재고조사', '앵글정리', '상품재작업'],
    '담당': ['개인담당업무', '상.하차', '검수', '아이롱', '오류'],
    '기타': ['채우기', '강성', '2층업무', '재고찾는시간', '매장근무']
};

export const taskTypes = [].concat(...Object.values(taskGroups));

export const quantityTaskTypes = ['채우기', '국내배송', '직진배송', '중국제작', '티니', '택배포장', '해외배송', '상.하차', '검수'];

export const firebaseConfig = {
    apiKey: "AIzaSyBxmX7fEISWYs_JGktAZrFjdb8cb_ZcmSY",
    authDomain: "work-tool-e2943.firebaseapp.com",
    projectId: "work-tool-e2943",
    storageBucket: "work-tool-e2943.appspot.com",
    messagingSenderId: "133294945093",
    appId: "1:133294945093:web:cde90aab6716127512842c",
    measurementId: "G-ZZQLKB0057"
};
