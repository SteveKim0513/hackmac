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

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPopup ? <PopupApp /> : <App />}</React.StrictMode>,
);
