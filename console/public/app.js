/* FDE 现场控制台前端（原生 JS，无框架）。 */
'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  conn: $('conn'),
  turnIndicator: $('turn-indicator'),
  recordCard: $('record-card'),
  btnRecord: $('btn-record'),
  btnPause: $('btn-pause'),
  recTime: $('rec-time'),
  levelBar: $('level-bar'),
  asrReason: $('asr-reason'),
  transcript: $('transcript'),
  partial: $('partial'),
  manualInput: $('manual-input'),
  btnManual: $('btn-manual'),
  note: $('note'),
  btnTurn: $('btn-turn'),
  turnStatus: $('turn-status'),
  turnLog: $('turn-log'),
  spec: $('spec'),
  candidates: $('candidates'),
  btnRefresh: $('btn-refresh'),
  demoFrame: $('demo-frame'),
  demoUrl: $('demo-url'),
};

const state = {
  ws: null,
  demoUrl: '',
  asrMode: 'none',
  asrAvailable: false,
  recording: false,
  paused: false,
  seconds: 0,
  timerId: null,
  audioCtx: null,
  mediaStream: null,
};

/* ---------- WebSocket ---------- */

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.binaryType = 'arraybuffer';
  state.ws = ws;
  ws.onopen = () => {
    el.conn.textContent = '已连接';
    el.conn.className = 'pill pill-on';
  };
  ws.onclose = () => {
    el.conn.textContent = '已断开，重连中…';
    el.conn.className = 'pill pill-off';
    setTimeout(connect, 1500);
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') return;
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    handleMessage(msg);
  };
}

function send(obj) {
  if (state.ws && state.ws.readyState === 1) state.ws.send(JSON.stringify(obj));
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state': return renderState(msg);
    case 'asr-partial':
      el.partial.textContent = `… ${msg.text}`;
      return;
    case 'asr-status': return renderAsrStatus(msg);
    case 'turn-start':
      el.turnIndicator.classList.remove('hidden');
      el.turnIndicator.className = 'pill pill-busy';
      el.turnIndicator.textContent = `回合 #${msg.turnId} 运行中…`;
      appendTurnLog('status', `—— 回合 #${msg.turnId} 开始（排队 ${msg.queued || 0}）——`);
      return;
    case 'turn-event': return handleTurnEvent(msg.turnId, msg.event);
    default:
      return;
  }
}

/* ---------- 渲染 ---------- */

function renderState(msg) {
  state.demoUrl = msg.demoUrl;
  state.asrMode = msg.asr;
  el.demoUrl.textContent = msg.demoUrl;
  if (!el.demoFrame.src || el.demoFrame.src === 'about:blank') {
    el.demoFrame.src = msg.demoUrl;
  }
  renderTranscript(msg.transcript, msg.consumedOffset);
  el.spec.innerHTML = renderMarkdown(msg.spec || '（空）');
  el.candidates.innerHTML = renderMarkdown(msg.candidates || '（空）');
  if (msg.turnActive == null && !msg.turnQueued) {
    el.turnIndicator.classList.add('hidden');
  }
  el.turnStatus.textContent = msg.turnQueued > 0 ? `排队中的回合：${msg.turnQueued}` : '';
  if (msg.asr === 'none' && !state.recording) {
    setAsrUnavailable('未启用 ASR（--asr none）。手动输入始终可用；用 --asr funasr 重启可开录音。');
  }
}

function renderTranscript(full, consumedOffset) {
  const consumed = full.slice(0, consumedOffset);
  const unconsumed = full.slice(consumedOffset);
  el.transcript.textContent = '';
  const c = document.createElement('span');
  c.textContent = consumed;
  const u = document.createElement('span');
  u.className = 'unconsumed';
  u.textContent = unconsumed;
  el.transcript.append(c, u);
  el.transcript.scrollTop = el.transcript.scrollHeight;
}

function setAsrUnavailable(reason) {
  state.asrAvailable = false;
  el.recordCard.classList.add('disabled');
  el.asrReason.textContent = reason;
}

function renderAsrStatus(msg) {
  if (msg.status === 'ready') {
    state.asrAvailable = true;
    el.recordCard.classList.remove('disabled');
    el.asrReason.textContent = 'FunASR 已连接（本地转写，不上云）';
  } else if (msg.status === 'asr-unavailable') {
    setAsrUnavailable(msg.detail || 'ASR 不可用');
    stopRecordingUi();
  } else if (msg.status === 'stopped') {
    el.asrReason.textContent = 'ASR 已停止';
  }
}

function appendTurnLog(kind, text) {
  const div = document.createElement('div');
  div.className = `ev-${kind}`;
  div.textContent = text;
  el.turnLog.appendChild(div);
  while (el.turnLog.childNodes.length > 200) el.turnLog.removeChild(el.turnLog.firstChild);
  el.turnLog.scrollTop = el.turnLog.scrollHeight;
}

function handleTurnEvent(turnId, ev) {
  if (!ev) return;
  switch (ev.type) {
    case 'status': return appendTurnLog('status', `· ${ev.message}`);
    case 'text': return appendTurnLog('text', ev.text);
    case 'tool': return appendTurnLog('tool', `⚙ ${ev.name}${ev.detail ? ` ${ev.detail}` : ''}`);
    case 'summary': return appendTurnLog('summary', `» ${ev.summary}`);
    case 'error':
      el.turnIndicator.classList.add('hidden');
      return appendTurnLog('error', `✗ ${ev.message}`);
    case 'done':
      el.turnIndicator.classList.add('hidden');
      appendTurnLog('done', `✓ 回合 #${turnId} 完成，Demo 已刷新`);
      el.note.value = '';
      refreshDemo();
      return;
    default:
      return;
  }
}

/* ---------- 极简 markdown 渲染（标题/列表/表格行/加粗/行内代码） ---------- */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(s) {
  return escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function renderMarkdown(md) {
  const out = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push('</ul>'); inList = false; } };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (t.startsWith('<!--')) continue;
    if (/^###\s+/.test(t)) { closeList(); out.push(`<h3>${inline(t.replace(/^###\s+/, ''))}</h3>`); continue; }
    if (/^##\s+/.test(t)) { closeList(); out.push(`<h2>${inline(t.replace(/^##\s+/, ''))}</h2>`); continue; }
    if (/^#\s+/.test(t)) { closeList(); out.push(`<h1>${inline(t.replace(/^#\s+/, ''))}</h1>`); continue; }
    if (/^[-*]\s+/.test(t)) {
      if (!inList) { out.push('<ul>'); inList = true; }
      out.push(`<li>${inline(t.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (t.startsWith('|')) { closeList(); out.push(`<div class="tbl">${escapeHtml(t)}</div>`); continue; }
    if (t.startsWith('>')) { closeList(); out.push(`<p class="muted">${inline(t.replace(/^>\s?/, ''))}</p>`); continue; }
    if (t === '') { closeList(); continue; }
    closeList();
    out.push(`<p>${inline(t)}</p>`);
  }
  closeList();
  return out.join('\n');
}

/* ---------- Demo iframe ---------- */

function refreshDemo() {
  if (!state.demoUrl) return;
  const sep = state.demoUrl.includes('?') ? '&' : '?';
  el.demoFrame.src = `${state.demoUrl}${sep}_console_ts=${Date.now()}`;
}

/* ---------- 录音链路：getUserMedia → AudioWorklet(16k PCM16) → ws 二进制帧 ---------- */

function fmtTime(sec) {
  const m = String(Math.floor(sec / 60)).padStart(2, '0');
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

async function startRecording() {
  if (state.recording) return;
  send({ type: 'asr-start' });
  try {
    state.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    setAsrUnavailable(`无法访问麦克风：${err.message}`);
    return;
  }
  state.audioCtx = new AudioContext();
  await state.audioCtx.audioWorklet.addModule('recorder-worklet.js');
  const source = state.audioCtx.createMediaStreamSource(state.mediaStream);
  const node = new AudioWorkletNode(state.audioCtx, 'pcm-recorder');
  node.port.onmessage = (e) => {
    if (e.data.level !== undefined) {
      el.levelBar.style.width = `${Math.min(100, e.data.level * 300)}%`;
      return;
    }
    if (e.data.pcm && state.recording && !state.paused && state.ws && state.ws.readyState === 1) {
      state.ws.send(e.data.pcm);
    }
  };
  source.connect(node);

  state.recording = true;
  state.paused = false;
  state.seconds = 0;
  el.recordCard.classList.add('recording');
  el.btnRecord.textContent = '■ 停止';
  el.btnPause.disabled = false;
  el.btnPause.textContent = '⏸ 暂停';
  state.timerId = setInterval(() => {
    if (!state.paused) {
      state.seconds += 1;
      el.recTime.textContent = fmtTime(state.seconds);
    }
  }, 1000);
}

function stopRecordingUi() {
  state.recording = false;
  state.paused = false;
  if (state.timerId) { clearInterval(state.timerId); state.timerId = null; }
  el.recordCard.classList.remove('recording');
  el.btnRecord.textContent = '● 开始';
  el.btnPause.disabled = true;
  el.btnPause.textContent = '⏸ 暂停';
  el.levelBar.style.width = '0%';
  if (state.mediaStream) {
    for (const track of state.mediaStream.getTracks()) track.stop();
    state.mediaStream = null;
  }
  if (state.audioCtx) {
    state.audioCtx.close().catch(() => {});
    state.audioCtx = null;
  }
}

function stopRecording() {
  send({ type: 'asr-stop' });
  stopRecordingUi();
}

/* ---------- 事件绑定 ---------- */

el.btnRecord.addEventListener('click', () => {
  if (state.recording) stopRecording();
  else void startRecording();
});

el.btnPause.addEventListener('click', () => {
  if (!state.recording) return;
  state.paused = !state.paused;
  el.btnPause.textContent = state.paused ? '▶ 继续' : '⏸ 暂停';
});

function sendManual() {
  const text = el.manualInput.value.trim();
  if (!text) return;
  send({ type: 'transcript', text });
  el.manualInput.value = '';
}
el.btnManual.addEventListener('click', sendManual);
el.manualInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendManual();
});

el.btnTurn.addEventListener('click', () => {
  send({ type: 'turn-start', note: el.note.value });
});

el.btnRefresh.addEventListener('click', refreshDemo);

connect();
