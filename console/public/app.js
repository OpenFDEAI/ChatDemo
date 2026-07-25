/* FDE 现场控制台前端（原生 JS，无框架）。 */
'use strict';

const $ = (id) => document.getElementById(id);

const el = {
  conn: $('conn'),
  turnIndicator: $('turn-indicator'),
  dropzone: $('dropzone'),
  fileInput: $('file-input'),
  inputsList: $('inputs-list'),
  recordCard: $('record-card'),
  btnRecord: $('btn-record'),
  btnPause: $('btn-pause'),
  recTime: $('rec-time'),
  levelBar: $('level-bar'),
  asrReason: $('asr-reason'),
  asrCreds: $('asr-creds'),
  volcApp: $('volc-app'),
  volcKey: $('volc-key'),
  btnSaveCreds: $('btn-save-creds'),
  transcript: $('transcript'),
  partial: $('partial'),
  manualInput: $('manual-input'),
  btnManual: $('btn-manual'),
  note: $('note'),
  engine: $('engine'),
  engineHint: $('engine-hint'),
  btnTurn: $('btn-turn'),
  turnStatus: $('turn-status'),
  turnLog: $('turn-log'),
  spec: $('spec'),
  journal: $('journal'),
  journalCard: $('journal-card'),
  candidates: $('candidates'),
  candidatesCard: $('candidates-card'),
  btnRefresh: $('btn-refresh'),
  demoFrame: $('demo-frame'),
  demoUrl: $('demo-url'),
};

const state = {
  ws: null,
  demoUrl: '',
  asrMode: 'none',
  asrEngine: null, // 'funasr' | 'webspeech' | null
  asrAvailable: false,
  recording: false,
  paused: false,
  seconds: 0,
  timerId: null,
  audioCtx: null,
  mediaStream: null,
  recognition: null,
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
      el.btnTurn.disabled = true;
      el.btnTurn.textContent = `⏳ 回合 #${msg.turnId} 运行中…（日志见下方）`;
      appendTurnLog(
        'status',
        `—— 回合 #${msg.turnId} 开始（引擎 ${msg.adapter || '?'}，排队 ${msg.queued || 0}）——`,
      );
      return;
    case 'turn-event': return handleTurnEvent(msg.turnId, msg.event);
    case 'adapter-status':
      if (!msg.ok) {
        el.engineHint.textContent = msg.message || '切换失败';
        el.engineHint.className = 'muted small err';
      }
      return;
    default:
      return;
  }
}

/* ---------- 渲染 ---------- */

const ENGINE_LABELS = { claude: 'Claude Code', codex: 'Codex', mock: 'Mock（兜底）' };

function renderEngines(active, engines) {
  if (!engines) return;
  // mock 只服务测试与兜底，不进现场选择列表——除非它正是当前引擎（两个真引擎都不可用时）。
  const listed = ['claude', 'codex', ...(active === 'mock' ? ['mock'] : [])];
  const sig = JSON.stringify({ engines, listed });
  if (el.engine.dataset.sig !== sig) {
    el.engine.dataset.sig = sig;
    el.engine.textContent = '';
    for (const name of listed) {
      const info = engines[name];
      if (!info) continue;
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = ENGINE_LABELS[name] + (info.available ? '' : '（不可用）');
      opt.disabled = !info.available;
      opt.title = info.detail || '';
      el.engine.appendChild(opt);
    }
  }
  if (document.activeElement !== el.engine) el.engine.value = active;
  const info = engines[active];
  el.engineHint.className = 'muted small';
  el.engineHint.textContent = info && info.detail ? info.detail : '';
}

function renderInputs(inputs) {
  el.inputsList.textContent = '';
  for (const f of inputs || []) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = f.name;
    const size = document.createElement('span');
    size.textContent = f.size >= 1024 ? `${Math.round(f.size / 1024)}KB` : `${f.size}B`;
    li.append(name, size);
    el.inputsList.appendChild(li);
  }
}

function renderState(msg) {
  state.demoUrl = msg.demoUrl;
  state.asrMode = msg.asr;
  el.demoUrl.textContent = `${msg.demoUrl} ↗`;
  el.demoUrl.href = msg.demoUrl;
  renderEngines(msg.adapter, msg.engines);
  renderInputs(msg.inputs);
  if (!el.demoFrame.src || el.demoFrame.src === 'about:blank') {
    el.demoFrame.src = msg.demoUrl;
  }
  renderTranscript(msg.transcript, msg.consumedOffset);
  el.spec.innerHTML = renderMarkdown(msg.spec || '（空）');
  const hasJournal = Boolean(msg.journal && msg.journal.trim());
  el.journalCard.classList.toggle('hidden', !hasJournal);
  if (hasJournal) {
    el.journal.innerHTML = renderMarkdown(msg.journal);
    el.journal.scrollTop = el.journal.scrollHeight;
  }
  el.candidates.innerHTML = renderMarkdown(msg.candidates || '（空）');
  // 空清单不占中栏：表格除表头/分隔行外没有数据行就藏起整张卡。
  const candidateRows = (msg.candidates || '')
    .split('\n')
    .filter((l) => l.trim().startsWith('|')).length;
  el.candidatesCard.classList.toggle('hidden', candidateRows <= 2);
  if (msg.turnActive == null && !msg.turnQueued) {
    el.turnIndicator.classList.add('hidden');
    restoreTurnButton();
  }
  el.turnStatus.textContent = msg.turnQueued > 0 ? `排队中的回合：${msg.turnQueued}` : '';
  if (msg.asr === 'funasr' || msg.asr === 'volcano') {
    state.asrEngine = 'server';
    if (msg.asr === 'volcano' && !state.recording) {
      const hasCreds = msg.volcCredentials === true;
      el.asrCreds.classList.toggle('hidden', hasCreds);
      if (!hasCreds) {
        el.asrReason.textContent =
          '火山引擎云端转写：首次使用请粘贴凭证（火山控制台 → 语音技术 → 流式语音识别大模型）。';
      } else if (!el.asrReason.textContent) {
        el.asrReason.textContent = '火山引擎云端转写就绪，点 ● 开始。';
      }
    }
  } else if (!state.recording) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Rec) {
      // 未启用 FunASR 时的零安装兜底：浏览器识别。仅测试用——识别由浏览器
      // 提供、可能经厂商云端；客户现场必须 --asr funasr 走本地转写（红线）。
      state.asrEngine = 'webspeech';
      state.asrAvailable = true;
      el.recordCard.classList.remove('disabled');
      el.asrReason.textContent =
        '浏览器识别模式（测试用：识别由浏览器提供、可能经厂商云端）。客户现场请起 FunASR 并加 --asr funasr 重启，本地转写不上云。';
    } else {
      setAsrUnavailable('未启用 ASR 且浏览器不支持语音识别。手动输入始终可用；起 FunASR 后加 --asr funasr 重启。');
    }
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
    el.asrReason.textContent = msg.detail || 'FunASR 已连接（本地转写，不上云）';
  } else if (msg.status === 'asr-unavailable') {
    setAsrUnavailable(msg.detail || 'ASR 不可用');
    stopRecordingUi();
  } else if (msg.status === 'stopped') {
    el.asrReason.textContent = msg.detail || 'ASR 已停止';
    if (msg.detail && msg.detail.includes('已保存')) {
      // 凭证保存成功：解除置灰、收起表单，等用户点 ● 重试。
      el.recordCard.classList.remove('disabled');
      el.asrCreds.classList.add('hidden');
      el.volcKey.value = '';
    }
  }
}

function restoreTurnButton() {
  el.btnTurn.disabled = false;
  el.btnTurn.textContent = '▶ 生成本回合';
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
      restoreTurnButton();
      return appendTurnLog('error', `✗ ${ev.message}`);
    case 'done':
      el.turnIndicator.classList.add('hidden');
      restoreTurnButton();
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

function beginRecordingUi() {
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

function startWebspeech() {
  const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new Rec();
  state.recognition = rec;
  rec.lang = 'zh-CN';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) {
        const text = r[0].transcript.trim();
        if (text) send({ type: 'transcript', text });
      } else {
        interim += r[0].transcript;
      }
    }
    el.partial.textContent = interim ? `… ${interim}` : '';
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      setAsrUnavailable('麦克风或识别权限被拒绝，请在浏览器地址栏允许后重试。');
      stopRecordingUi();
    }
  };
  rec.onend = () => {
    // 浏览器会周期性掐断 continuous 识别，录音中自动续上。
    if (state.recording && !state.paused) {
      try { rec.start(); } catch { /* 已在运行 */ }
    }
  };
  rec.start();
  beginRecordingUi();
}

async function startRecording() {
  if (state.recording) return;
  if (state.asrEngine === 'webspeech') {
    startWebspeech();
    return;
  }
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
  beginRecordingUi();
}

function stopRecordingUi() {
  state.recording = false;
  state.paused = false;
  if (state.recognition) {
    try { state.recognition.stop(); } catch { /* 已停止 */ }
    state.recognition = null;
  }
  el.partial.textContent = '';
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
  if (state.asrEngine !== 'webspeech') send({ type: 'asr-stop' });
  stopRecordingUi();
}

/* ---------- 事件绑定 ---------- */

el.btnRecord.addEventListener('click', () => {
  if (state.recording) stopRecording();
  else void startRecording();
});

el.btnSaveCreds.addEventListener('click', () => {
  send({ type: 'asr-credentials', appKey: el.volcApp.value, accessKey: el.volcKey.value });
});

el.btnPause.addEventListener('click', () => {
  if (!state.recording) return;
  state.paused = !state.paused;
  el.btnPause.textContent = state.paused ? '▶ 继续' : '⏸ 暂停';
  if (state.asrEngine === 'webspeech' && state.recognition) {
    if (state.paused) {
      try { state.recognition.stop(); } catch { /* 已停止 */ }
    } else {
      try { state.recognition.start(); } catch { /* 已在运行 */ }
    }
  }
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

el.engine.addEventListener('change', () => {
  el.engineHint.className = 'muted small';
  el.engineHint.textContent = '切换中…（下一回合生效）';
  send({ type: 'set-adapter', adapter: el.engine.value });
});

/* ---------- 材料上传：拖拽 / 选择 → POST /upload → 工作区 inputs/ ---------- */

async function uploadFiles(files) {
  for (const file of files) {
    try {
      const res = await fetch(`/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        appendTurnLog('error', `✗ 上传失败 ${file.name}：${body.error || res.status}`);
      } else {
        appendTurnLog('status', `· 材料已入 inputs/：${file.name}（下一回合自动摄取）`);
      }
    } catch (err) {
      appendTurnLog('error', `✗ 上传失败 ${file.name}：${err.message}`);
    }
  }
  send({ type: 'refresh-state' });
}

el.dropzone.addEventListener('click', () => el.fileInput.click());
el.fileInput.addEventListener('change', () => {
  if (el.fileInput.files.length) void uploadFiles([...el.fileInput.files]);
  el.fileInput.value = '';
});
el.dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  el.dropzone.classList.add('dragover');
});
el.dropzone.addEventListener('dragleave', () => el.dropzone.classList.remove('dragover'));
el.dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  el.dropzone.classList.remove('dragover');
  if (e.dataTransfer && e.dataTransfer.files.length) void uploadFiles([...e.dataTransfer.files]);
});

el.btnRefresh.addEventListener('click', refreshDemo);

connect();
