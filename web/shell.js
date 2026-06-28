'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const tTitle       = document.getElementById('tTitle');
  const tRole        = document.getElementById('tRole');
  const footMid      = document.getElementById('footMid');
  const waitBar      = document.getElementById('waitBar');
  const waitMsg      = document.getElementById('waitMsg');

  const params = new URLSearchParams(location.search);
  let code = params.get('code') || '';
  if (!code && location.pathname.length > 1) {
    code = location.pathname.substring(1);
  }

  tRole.textContent = 'GUEST';
  tRole.classList.add('guest');
  tTitle.textContent  = `gatekeeper \u2014 guest`;

  const term = new Terminal({
    fontFamily: '"JetBrains Mono", monospace',
    fontSize: 14,
    theme: { background: '#0D0D0D', foreground: '#E0E0E0', cursor: '#E0E0E0' },
    cursorBlink: true
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();
  window.addEventListener('resize', () => fitAddon.fit());

  term.writeln('\x1b[33mConnected to Host \u2014 commands need host approval before running.\x1b[0m');
  
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws?role=guest&code=${code}`;
  let ws = new WebSocket(wsUrl);

  ws.onopen = () => footMid.textContent = 'connected';
  ws.onclose = () => {
    footMid.textContent = 'disconnected';
    term.writeln('\r\n\x1b[31mSession disconnected.\x1b[0m');
  };

  ws.onmessage = ev => {
    try {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'stdout':
        case 'stderr':
          term.write(msg.data.replace(/\r?\n/g, '\r\n'));
          break;
        case 'status':
          if (msg.msg) {
            waitMsg.textContent = msg.msg; waitBar.style.display = 'flex';
            footMid.textContent = '\u23f3 waiting';
          } else {
            waitBar.style.display = 'none'; footMid.textContent = 'connected';
          }
          break;
        case 'exit':
          term.writeln('\r\n\x1b[90m[host ended session]\x1b[0m');
          break;
      }
    } catch (e) {}
  };

  let inputBuffer = '';
  term.onData(data => {
    if (ws.readyState !== WebSocket.OPEN) return;
    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      if (char === '\r') {
        term.write('\r\n');
        if (inputBuffer.trim()) ws.send(JSON.stringify({ type: 'submit_command', command: inputBuffer }));
        inputBuffer = '';
      } else if (char === '\x7F') {
        if (inputBuffer.length > 0) { inputBuffer = inputBuffer.slice(0, -1); term.write('\b \b'); }
      } else {
        inputBuffer += char; term.write(char);
      }
    }
  });
});
