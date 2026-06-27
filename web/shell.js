'use strict';
/**
 * Gatekeeper Shell — Terminal Client (Guest Only)
 */

document.addEventListener('DOMContentLoaded', () => {

  const tBody        = document.getElementById('tBody');
  const outputLog    = document.getElementById('outputLog');
  const inputDisplay = document.getElementById('inputDisplay');
  const hiddenInput  = document.getElementById('hiddenInput');
  const cursor       = document.getElementById('cursor');
  const ps1Wrap      = document.getElementById('ps1Wrap');
  const ps1Path      = document.getElementById('ps1Path');
  const tTitle       = document.getElementById('tTitle');
  const tRole        = document.getElementById('tRole');
  const footMid      = document.getElementById('footMid');

  const waitBar = document.getElementById('waitBar');
  const waitMsg = document.getElementById('waitMsg');
  const errBanner = document.getElementById('errBanner');
  const errMsg    = document.getElementById('errMsg');

  const params = new URLSearchParams(location.search);
  const code   = params.get('code') || '';

  tRole.textContent = 'GUEST';
  tRole.classList.add('guest');
  tTitle.textContent  = `gatekeeper \u2014 guest`;

  let isReady = false;
  const cmdHistory = [];
  let histIdx  = -1;
  let histTemp = '';
  let tabLast  = '';
  let tabCount = 0;
  let cwdLabel = '~'; 

  let outBuf = '';

  function pushOutput(text, cls) {
    if (!text) return;
    outBuf += text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    drainBuf(cls);
  }

  function drainBuf(cls) {
    while (true) {
      if (outBuf === '$ ' || outBuf === '$ \n') {
        outBuf = '';
        isReady = true;
        scrollBot();
        break;
      }
      const pi = outBuf.lastIndexOf('\n$ ');
      if (pi !== -1 && pi + 3 >= outBuf.length - 1) {
        const body = outBuf.slice(0, pi);
        outBuf = outBuf.slice(pi + 3).trimStart();
        if (body) renderBlock(body, cls);
        isReady = true;
        scrollBot();
        continue;
      }
      const GUARD = 3; 
      if (outBuf.length > GUARD) {
        const candidate = outBuf.slice(0, outBuf.length - GUARD);
        const lastNL    = candidate.lastIndexOf('\n');
        if (lastNL >= 0) {
          const toRender = outBuf.slice(0, lastNL);
          outBuf = outBuf.slice(lastNL + 1);
          if (toRender.trim()) renderBlock(toRender, cls);
          scrollBot();
          continue;
        }
      }
      break; 
    }
  }

  function renderBlock(text, cls) {
    if (!text) return;
    const clean = text.replace(/^\n+/, '').replace(/\n+$/, '');
    if (!clean) return;
    const el = document.createElement('pre');
    el.className = `ln${cls ? ' ' + cls : ''}`;
    el.textContent = clean;
    outputLog.appendChild(el);
  }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${proto}//${location.host}/ws?role=guest&code=${code}`;
  let ws = null;

  function connect() {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      isReady = true;
      outputLog.innerHTML = '';
      writeLn('Connected to Host \u2014 commands need host approval before running.', 'warn');
      writeLn('', '');
      hiddenInput.focus();
    };

    ws.onclose = ev => {
      isReady = false;
      hiddenInput.disabled = true;
      footMid.textContent = 'disconnected';
      if (ev.code === 1006 || ev.code === 1005) {
        showError('Connection refused \u2014 invalid or missing session code.');
      } else {
        writeLn('\nSession disconnected.', 'err');
      }
    };

    ws.onmessage = ev => {
      try { route(JSON.parse(ev.data)); }
      catch (e) { console.error('ws parse:', e); }
    };
  }

  connect();

  function route(msg) {
    switch (msg.type) {
      case 'stdout':
        pushOutput(msg.data, '');
        break;
      case 'stderr':
        pushOutput(msg.data, 'err');
        break;
      case 'status':
        if (msg.msg) {
          waitMsg.textContent   = msg.msg;
          waitBar.style.display = 'flex';
          footMid.textContent   = '\u23f3 waiting';
          isReady = false;
        } else {
          waitBar.style.display = 'none';
          footMid.textContent   = '';
          isReady = true;
          hiddenInput.focus();
        }
        break;
      case 'completions':
        handleCompletions(msg.hits, msg.prefix);
        break;
      case 'exit':
        writeLn('\n[host ended session]', 'dim');
        isReady = false;
        break;
    }
  }

  document.addEventListener('click', () => {
    if (!hiddenInput.disabled) hiddenInput.focus();
  });
  hiddenInput.focus();

  hiddenInput.addEventListener('input', () => {
    inputDisplay.textContent = hiddenInput.value;
  });

  hiddenInput.addEventListener('keydown', e => {
    if (!isReady) { e.preventDefault(); return; }

    switch (e.key) {
      case 'Enter': {
        e.preventDefault();
        const cmd = hiddenInput.value;
        tabLast = ''; tabCount = 0; histIdx = -1;
        hiddenInput.value = '';
        inputDisplay.textContent = '';

        if (!cmd.trim()) return;

        if (cmd.trim() === 'clear' || cmd.trim() === 'cls') {
          outputLog.innerHTML = '';
          return;
        }

        cmdHistory.push(cmd);
        echoCmd(cmd);
        isReady = false;

        ws.send(JSON.stringify({ type: 'submit_command', command: cmd }));
        scrollBot();
        break;
      }
      case 'Tab':
        e.preventDefault();
        ws.send(JSON.stringify({ type: 'complete', command: hiddenInput.value }));
        break;
      case 'ArrowUp':
        e.preventDefault();
        navHist(1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        navHist(-1);
        break;
      case 'c':
        if (e.ctrlKey) {
          e.preventDefault();
          hiddenInput.value = '';
          inputDisplay.textContent = '';
        }
        break;
      case 'l':
        if (e.ctrlKey) {
          e.preventDefault();
          outputLog.innerHTML = '';
        }
        break;
    }
  });

  function handleCompletions(hits, prefix) {
    const line = hiddenInput.value;
    if (!hits || hits.length === 0) { flashCursor(); tabLast = ''; tabCount = 0; return; }

    if (hits.length === 1) {
      const sp = line.lastIndexOf(' ');
      hiddenInput.value = (sp !== -1 ? line.slice(0, sp + 1) : '') + hits[0];
      inputDisplay.textContent = hiddenInput.value;
      tabLast = ''; tabCount = 0;
      return;
    }

    const stripped = hits.map(h => h.replace(/[ /]$/, ''));
    const common = stripped.reduce((a, b) => {
      let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
      return a.slice(0, i);
    }, stripped[0]);

    if (common.length > prefix.length) {
      const sp = line.lastIndexOf(' ');
      hiddenInput.value = (sp !== -1 ? line.slice(0, sp + 1) : '') + common;
      inputDisplay.textContent = hiddenInput.value;
      tabLast = ''; tabCount = 0;
      return;
    }

    if (line === tabLast) tabCount++; else { tabLast = line; tabCount = 1; }
    if (tabCount === 1) { flashCursor(); return; }

    echoCmd(line);
    writeLn(stripped.sort().join('  '), 'dim');
    tabCount = 0;
    scrollBot();
  }

  function navHist(dir) {
    if (!cmdHistory.length) return;
    if (histIdx === -1) histTemp = hiddenInput.value;
    histIdx = Math.min(Math.max(histIdx + dir, -1), cmdHistory.length - 1);
    const val = histIdx === -1 ? histTemp : cmdHistory[cmdHistory.length - 1 - histIdx];
    hiddenInput.value = val;
    inputDisplay.textContent = val;
  }

  function echoCmd(cmd) {
    const div = document.createElement('div');
    div.className = 'ln cmd';
    const ps = ps1Wrap.cloneNode(true);
    const sp = document.createElement('span');
    sp.textContent = cmd;
    div.appendChild(ps);
    div.appendChild(sp);
    outputLog.appendChild(div);

    const t = cmd.trim().split(/\s+/);
    if (t[0] === 'cd' && t[1]) {
      if (t[1] === '~') cwdLabel = '~';
      else if (t[1] === '..') {
        const parts = cwdLabel.replace(/^~\/?/, '').split('/').filter(Boolean);
        parts.pop();
        cwdLabel = parts.length ? '~/' + parts.join('/') : '~';
      } else {
        const leaf = t[1].replace(/\\/g, '/').split('/').pop() || t[1];
        cwdLabel = cwdLabel === '~' ? '~/' + leaf : cwdLabel + '/' + leaf;
      }
      ps1Path.textContent = cwdLabel;
    }
  }

  function writeLn(text, cls) {
    const d = document.createElement('div');
    d.className = `ln${cls ? ' ' + cls : ''}`;
    d.textContent = text;
    outputLog.appendChild(d);
    scrollBot();
  }

  function showError(msg) {
    errMsg.textContent = msg;
    errBanner.classList.remove('hidden');
    footMid.textContent = 'error';
  }

  function scrollBot() { tBody.scrollTop = tBody.scrollHeight; }

  function flashCursor() {
    cursor.style.background = 'var(--yellow)';
    setTimeout(() => { cursor.style.background = ''; }, 120);
  }

}); // DOMContentLoaded
