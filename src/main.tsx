import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PopupApp } from './popup/PopupApp';
import './theme.css';

// electron/popupWindow.ts는 별도 창을 띄울 때도 같은 index.html을 재사용한다
// (팝업 전용 빌드 엔트리를 따로 만들지 않기 위해) — `?mode=popup` 쿼리로
// 이 파일이 어느 화면을 그릴지만 나눈다.
const isPopup = new URLSearchParams(window.location.search).get('mode') === 'popup';
// 팝업 창은 frame:false + transparent:true라, body가 --bg를 그대로 칠하면
// 모서리가 각지게 보인다 — popup.css가 이 클래스를 보고서만 배경을 투명하게
// 바꾼다 (메인 창까지 투명해지면 안 되므로 전역이 아니라 클래스로 분기).
if (isPopup) document.documentElement.classList.add('is-popup');

// `prefers-color-scheme` 미디어쿼리만 믿지 않는다 — 오프스크린으로 뜨는 창
// (E2E, 트레이에서 조용히 열기)에서 macOS의 다크모드 신호가 Chromium
// 렌더러까지 실시간으로 안 붙는 경우를 실제로 겪었다(electron/main.ts 참고).
// 대신 nativeTheme의 판단을 IPC로 직접 받아 `<html data-theme>`을 세팅하고,
// src/theme.css는 이 속성을 기준으로 다크 토큰을 켠다.
function applyTheme(isDark: boolean) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
}
void window.playbook.getEffectiveDark().then(applyTheme);
window.playbook.onThemeChanged(applyTheme);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPopup ? <PopupApp /> : <App />}</React.StrictMode>,
);
