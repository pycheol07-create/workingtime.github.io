// === calculator/firebase-init.js ===
// 계산기 페이지의 Firebase 초기화 — 한 번만. logis-defaults.js·shared-settings.js 가 이 파일을 import 한다
// (같은 주소의 모듈은 한 번만 실행되므로 initializeApp 도 한 번). ?emu=1 이면 ../js/config.js 가 에뮬레이터로 돌린다.
// 공통 상단바(js/app-shell.js)는 Firebase 를 초기화하지 않는다.
import { initializeFirebase } from '../js/config.js?v=202610261315';

export const { db, auth } = initializeFirebase();
