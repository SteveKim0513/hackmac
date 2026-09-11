#!/usr/bin/env node
'use strict';

// resources/bin/hackmac-popup(zsh)가 `ELECTRON_RUN_AS_NODE=1`로 앱 자신의
// Electron 바이너리를 이용해 이 파일을 순정 Node 스크립트로 실행한다 — 별도
// node 설치 없이도 JSON.stringify/parse로 안전하게 electron/popupServer.ts와
// 통신하기 위해서다 (셸에서 손으로 JSON을 이어붙이면 따옴표/개행 이스케이프가
// 깨지기 쉽다). argv 파싱만 이 파일의 책임이고, 실제 팝업 UI는
// electron/popupWindow.ts + src/popup가 그린다.

const net = require('node:net');

function fail(message) {
  process.stderr.write(`hackmac-popup: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const kind = argv[0];
  if (kind !== 'select' && kind !== 'prompt' && kind !== 'confirm') {
    fail(`알 수 없는 모드: ${kind ?? '(없음)'} (select/prompt/confirm 중 하나)`);
  }

  const flags = { title: '', prompt: '', ok: '', cancel: '', default: '' };
  const items = [];
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--') {
      items.push(...argv.slice(i + 1));
      break;
    }
    const key = arg.replace(/^--/, '');
    if (!(key in flags)) fail(`알 수 없는 옵션: ${arg}`);
    flags[key] = argv[i + 1] ?? '';
    i += 2;
  }

  if (kind === 'select') {
    return {
      kind,
      title: flags.title,
      prompt: flags.prompt,
      okLabel: flags.ok,
      cancelLabel: flags.cancel,
      items,
      defaultItem: flags.default || null,
    };
  }
  if (kind === 'prompt') {
    return {
      kind,
      title: flags.title,
      prompt: flags.prompt,
      okLabel: flags.ok,
      cancelLabel: flags.cancel,
      defaultValue: flags.default,
    };
  }
  return {
    kind,
    title: flags.title,
    prompt: flags.prompt,
    okLabel: flags.ok,
    cancelLabel: flags.cancel,
  };
}

function main() {
  const sockPath = process.env.HACKMAC_POPUP_SOCK;
  if (!sockPath) fail('HACKMAC_POPUP_SOCK 환경변수가 없음 — HackMac 앱이 실행 중인지 확인하세요');

  const request = parseArgs(process.argv.slice(2));

  const socket = net.connect(sockPath);
  let buffer = '';

  socket.on('connect', () => {
    socket.end(JSON.stringify(request) + '\n');
  });

  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
  });

  socket.on('error', (err) => {
    fail(`소켓 연결 실패: ${err.message}`);
  });

  socket.on('close', () => {
    let response;
    try {
      response = JSON.parse(buffer.split('\n')[0] || '{}');
    } catch {
      fail(`응답을 해석할 수 없음: ${buffer}`);
      return;
    }
    if (!response.ok) {
      process.exit(1); // 취소 — AppleScript의 -128(사용자 취소)과 같은 의미
    }
    process.stdout.write(response.value ?? '');
    process.exit(0);
  });
}

main();
