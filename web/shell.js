'use strict';

let aesKey = null;

async function initCrypto() {
  const hash = window.location.hash;
  if (hash.startsWith('#key=')) {
    const b64 = hash.substring(5);
    // Base64URL decode
    const raw = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
    const keyBytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) keyBytes[i] = raw.charCodeAt(i);
    
    aesKey = await crypto.subtle.importKey(
      "raw", keyBytes, "AES-GCM", false, ["encrypt", "decrypt"]
    );
    console.log("E2EE Initialized");
  } else {
    console.warn("No E2EE key provided in URL! Ensure you used the secure link from the host.");
  }
}

async function decryptStr(ciphertextB64) {
  if (!aesKey || !ciphertextB64) return ciphertextB64;
  try {
    const raw = atob(ciphertextB64.replace(/-/g, '+').replace(/_/g, '/'));
    const data = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) data[i] = raw.charCodeAt(i);
    
    const nonce = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext);
    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.error("Decryption failed", e);
    return "";
  }
}

async function encryptStr(text) {
  if (!aesKey || !text) return text;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(text);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, encoded);
  
  const combined = new Uint8Array(12 + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), 12);
  
  let binary = '';
  for (let i = 0; i < combined.length; i++) binary += String.fromCharCode(combined[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

document.addEventListener('DOMContentLoaded', async () => {
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
    fontFamily: '"JetBrains Mono", "Fira Code", monospace',
    fontSize: 14.5,
    letterSpacing: 0.5,
    lineHeight: 1.6,
    theme: { 
      background: '#00000000', 
      foreground: '#e6e6e6', 
      cursor: '#4fc1ff',
      selectionBackground: 'rgba(79, 193, 255, 0.3)'
    },
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2
  });
  const fitAddon = new FitAddon.FitAddon();
  term.loadAddon(fitAddon);
  term.open(document.getElementById('terminal-container'));
  fitAddon.fit();
  window.addEventListener('resize', () => fitAddon.fit());

  // Initialize E2EE
  await initCrypto();
  if (aesKey) {
    term.writeln('\x1b[32m🔒 AES-GCM End-to-End Encryption Active.\x1b[0m');
  } else {
    term.writeln('\x1b[31m⚠️ WARNING: Connection is NOT End-to-End Encrypted (missing key in URL).\x1b[0m');
  }
  term.writeln('\x1b[33mConnected to Host \u2014 commands need host approval before running.\x1b[0m');
  
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws?role=guest&code=${code}`;
  let ws = new WebSocket(wsUrl);

  ws.onopen = () => footMid.textContent = 'connected';
  ws.onclose = () => {
    footMid.textContent = 'disconnected';
    term.writeln('\r\n\x1b[31mSession disconnected.\x1b[0m');
  };

  ws.onmessage = async (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case 'stdout':
        case 'stderr':
          const output = await decryptStr(msg.data);
          term.write(output.replace(/\r?\n/g, '\r\n'));
          break;
        case 'status':
          const statusMsg = msg.msg ? await decryptStr(msg.msg) : "";
          if (statusMsg) {
            waitMsg.textContent = statusMsg; waitBar.style.display = 'flex';
            footMid.textContent = '\u23f3 waiting';
          } else {
            waitBar.style.display = 'none'; footMid.textContent = 'connected';
          }
          break;
        case 'exit':
          term.writeln('\r\n\x1b[90m[host ended session]\x1b[0m');
          break;
      }
    } catch (e) {
      console.error(e);
    }
  };

  let inputBuffer = '';
  let cursorOffset = 0;
  let history = [];
  let historyIdx = -1;
  let tempBuffer = '';

  term.onData(async (data) => {
    if (ws.readyState !== WebSocket.OPEN) return;

    if (data.startsWith('\x1b[')) {
      if (data === '\x1b[A') { // Up Arrow
        if (history.length > 0 && historyIdx < history.length - 1) {
          if (historyIdx === -1) tempBuffer = inputBuffer;
          term.write('\b'.repeat(inputBuffer.length - cursorOffset) + ' '.repeat(inputBuffer.length) + '\b'.repeat(inputBuffer.length));
          historyIdx++;
          inputBuffer = history[historyIdx];
          cursorOffset = 0;
          term.write(inputBuffer);
        }
      } else if (data === '\x1b[B') { // Down Arrow
        if (historyIdx > 0) {
          term.write('\b'.repeat(inputBuffer.length - cursorOffset) + ' '.repeat(inputBuffer.length) + '\b'.repeat(inputBuffer.length));
          historyIdx--;
          inputBuffer = history[historyIdx];
          cursorOffset = 0;
          term.write(inputBuffer);
        } else if (historyIdx === 0) {
          term.write('\b'.repeat(inputBuffer.length - cursorOffset) + ' '.repeat(inputBuffer.length) + '\b'.repeat(inputBuffer.length));
          historyIdx = -1;
          inputBuffer = tempBuffer;
          cursorOffset = 0;
          term.write(inputBuffer);
        }
      } else if (data === '\x1b[C') { // Right Arrow
        if (cursorOffset > 0) {
          cursorOffset--;
          term.write(data);
        }
      } else if (data === '\x1b[D') { // Left Arrow
        if (cursorOffset < inputBuffer.length) {
          cursorOffset++;
          term.write(data);
        }
      } else if (data === '\x1b[H' || data === '\x1b[1~') { // Home Key
        if (cursorOffset < inputBuffer.length) {
          const moveCount = inputBuffer.length - cursorOffset;
          term.write('\x1b[D'.repeat(moveCount));
          cursorOffset = inputBuffer.length;
        }
      } else if (data === '\x1b[F' || data === '\x1b[4~') { // End Key
        if (cursorOffset > 0) {
          const moveCount = cursorOffset;
          term.write('\x1b[C'.repeat(moveCount));
          cursorOffset = 0;
        }
      }
      return;
    }

    for (let i = 0; i < data.length; i++) {
      const char = data[i];
      if (char === '\r') {
        term.write('\r\n');
        if (inputBuffer.trim()) {
            if (history[0] !== inputBuffer) history.unshift(inputBuffer);
            const encryptedCmd = await encryptStr(inputBuffer);
            ws.send(JSON.stringify({ type: 'submit_command', command: encryptedCmd }));
        }
        inputBuffer = '';
        tempBuffer = '';
        cursorOffset = 0;
        historyIdx = -1;
      } else if (char === '\x7F') { // Backspace
        if (inputBuffer.length > cursorOffset) {
          const splitIdx = inputBuffer.length - cursorOffset;
          inputBuffer = inputBuffer.slice(0, splitIdx - 1) + inputBuffer.slice(splitIdx);
          
          term.write('\b \b');
          if (cursorOffset > 0) {
            const rest = inputBuffer.slice(splitIdx - 1);
            term.write(rest + ' \b' + '\b'.repeat(rest.length));
          }
        }
      } else { // Normal printable char
        const splitIdx = inputBuffer.length - cursorOffset;
        inputBuffer = inputBuffer.slice(0, splitIdx) + char + inputBuffer.slice(splitIdx);
        
        term.write(char);
        if (cursorOffset > 0) {
          const rest = inputBuffer.slice(splitIdx + 1);
          term.write(rest + '\b'.repeat(rest.length));
        }
      }
    }
  });
});
