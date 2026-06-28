﻿﻿let conversationId = null;
let ttsEnabled = false;
const currentAgent = "law_firm";

// ── Web Audio ─────────────────────────────────────────────────────────────────
let _audioCtx = null;
let _noiseBuffer = null;   // pre-generated pink noise PCM
let _noiseSrc = null;      // currently playing BufferSourceNode
let _ambienceGain = null;
let _humOsc = null;
let _keyboardTimer = null;

const AMBIENCE_BG   = 0.015;  // subtle always-on level while chatting
const AMBIENCE_TALK = 0.10;   // level when agent is speaking

function audioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

// Fill a buffer with pink noise samples — no ScriptProcessor needed
function _buildNoiseBuffer(ctx) {
  const seconds = 14;
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0=0, b1=0, b2=0, b3=0, b4=0, b5=0, b6=0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99886*b0 + w*0.0555179;
    b1 = 0.99332*b1 + w*0.0750759;
    b2 = 0.96900*b2 + w*0.1538520;
    b3 = 0.86650*b3 + w*0.3104856;
    b4 = 0.55000*b4 + w*0.5329522;
    b5 = -0.7616*b5 - w*0.0168980;
    d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w*0.5362) * 0.035;
    b6 = w * 0.115926;
  }
  return buf;
}

// Start the ambient layer — plays continuously while chat is active
function _startAmbience() {
  if (_noiseSrc) return;
  const ctx = audioCtx();

  if (!_noiseBuffer) _noiseBuffer = _buildNoiseBuffer(ctx);

  // Room noise source (looping)
  _noiseSrc = ctx.createBufferSource();
  _noiseSrc.buffer = _noiseBuffer;
  _noiseSrc.loop = true;

  // Low-pass to remove harsh highs
  const lpf = ctx.createBiquadFilter();
  lpf.type = "lowpass";
  lpf.frequency.value = 350;

  // Subtle AC hum at 60 Hz
  _humOsc = ctx.createOscillator();
  _humOsc.type = "sine";
  _humOsc.frequency.value = 60;
  const humGain = ctx.createGain();
  humGain.gain.value = 0.001;
  _humOsc.connect(humGain);

  // Master gain — starts silent, ramps to BG level
  _ambienceGain = ctx.createGain();
  _ambienceGain.gain.setValueAtTime(0, ctx.currentTime);
  _ambienceGain.gain.linearRampToValueAtTime(AMBIENCE_BG, ctx.currentTime + 1.2);

  _noiseSrc.connect(lpf);
  lpf.connect(_ambienceGain);
  humGain.connect(_ambienceGain);
  _ambienceGain.connect(ctx.destination);

  _noiseSrc.start();
  _humOsc.start();
}

function _stopAmbience() {
  _stopKeyboardAmbience();
  if (!_noiseSrc || !_ambienceGain) return;
  const ctx = audioCtx();
  _ambienceGain.gain.cancelScheduledValues(ctx.currentTime);
  _ambienceGain.gain.setValueAtTime(_ambienceGain.gain.value, ctx.currentTime);
  _ambienceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
  setTimeout(() => {
    try { _noiseSrc.stop(); } catch(_) {}
    try { _noiseSrc.disconnect(); } catch(_) {}
    try { _humOsc.stop(); _humOsc.disconnect(); } catch(_) {}
    try { _ambienceGain.disconnect(); } catch(_) {}
    _noiseSrc = null; _humOsc = null; _ambienceGain = null;
  }, 700);
}

// Smoothly ramp the ambience to a target level
function _setAmbienceLevel(target, ramp) {
  if (!_ambienceGain) return;
  const ctx = audioCtx();
  _ambienceGain.gain.cancelScheduledValues(ctx.currentTime);
  _ambienceGain.gain.setValueAtTime(_ambienceGain.gain.value, ctx.currentTime);
  _ambienceGain.gain.linearRampToValueAtTime(target, ctx.currentTime + (ramp || 0.25));
}

// ── Keyboard ambience ─────────────────────────────────────────────────────────
function _keyClick(ctx, when, vol) {
  const len = Math.floor(ctx.sampleRate * 0.035);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random()*2-1) * Math.pow(1 - i/len, 5);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bpf = ctx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.value = 1800 + Math.random() * 1000;
  bpf.Q.value = 1.2;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
  src.connect(bpf); bpf.connect(g); g.connect(ctx.destination);
  src.start(when);
}

function _scheduleKeyBurst() {
  const ctx = audioCtx();
  const count = 3 + Math.floor(Math.random() * 8);
  let t = ctx.currentTime + 0.05;
  for (let i = 0; i < count; i++) {
    _keyClick(ctx, t, 0.055 + Math.random() * 0.045);
    t += 0.07 + Math.random() * 0.11;
  }
}

function _startKeyboardAmbience() {
  if (_keyboardTimer) return;
  function next() {
    _scheduleKeyBurst();
    _keyboardTimer = setTimeout(next, (3 + Math.random() * 6) * 1000);
  }
  _keyboardTimer = setTimeout(next, 600 + Math.random() * 1200);
}

function _stopKeyboardAmbience() {
  clearTimeout(_keyboardTimer);
  _keyboardTimer = null;
}

// ── Tab routing ───────────────────────────────────────────────────────────────
function showTab(name) {
  ["overview", "chat", "dev"].forEach(t => {
    document.getElementById("view-" + t).classList.toggle("hidden", t !== name);
  });
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  if (name === "overview") loadOverview();
  if (name === "dev") loadDevDashboard();
}

// ── Overview ──────────────────────────────────────────────────────────────────
async function loadOverview() {
  const [stats, leads, convs] = await Promise.all([
    fetch("/api/stats").then(r => r.json()),
    fetch("/api/leads").then(r => r.json()),
    fetch("/api/conversations").then(r => r.json()),
  ]);
  document.getElementById("stat-calls").textContent = stats.calls_today ?? "—";
  document.getElementById("stat-leads").textContent = stats.consultations_booked ?? "—";

  const leadsBody = document.getElementById("leads-body");
  leadsBody.innerHTML = leads.length ? leads.map(l => `
    <tr class="border-t border-border hover:bg-surface">
      <td class="px-5 py-3">${l.caller_name || "—"}</td>
      <td class="px-5 py-3 text-slate-400">${l.caller_phone || "inbound"}</td>
      <td class="px-5 py-3 text-slate-300 max-w-xs truncate">${l.problem_details || "—"}</td>
      <td class="px-5 py-3"><span class="text-xs bg-surface px-2 py-1 rounded-full border border-border">${l.agent}</span></td>
      <td class="px-5 py-3 text-slate-400 text-xs">${l.created_at}</td>
    </tr>`).join("") : '<tr><td colspan="5" class="px-5 py-6 text-slate-500 text-center">No leads yet</td></tr>';

  const convsBody = document.getElementById("convs-body");
  convsBody.innerHTML = convs.length ? convs.map(c => `
    <tr class="border-t border-border hover:bg-surface">
      <td class="px-5 py-3">${c.agent}</td>
      <td class="px-5 py-3"><span class="text-xs px-2 py-1 rounded-full ${c.status==="active" ? "text-green-400 border border-green-800" : "text-slate-400 border border-border"}">${c.status}</span></td>
      <td class="px-5 py-3 text-slate-400 text-xs">${c.started_at}</td>
      <td class="px-5 py-3"><button onclick="viewConversation('${c._id}')" class="text-xs text-indigo-400 hover:underline">View</button></td>
    </tr>`).join("") : '<tr><td colspan="4" class="px-5 py-6 text-slate-500 text-center">No conversations yet</td></tr>';
}

// ── Dev Dashboard ─────────────────────────────────────────────────────────────
function fmtNum(n) {
  if (!n) return "0";
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toString();
}

function fmtUsd(n, dec) {
  if (!n) return "$0.00";
  const d = dec !== undefined ? dec : (n < 0.01 ? 6 : 4);
  return "$" + Number(n).toFixed(d);
}

const SVC_COLOUR = {
  Twilio:   { bar: "bg-blue-500",    txt: "text-blue-400"    },
  Deepgram: { bar: "bg-violet-500",  txt: "text-violet-400"  },
  Cartesia: { bar: "bg-rose-500",    txt: "text-rose-400"    },
  OpenAI:   { bar: "bg-emerald-500", txt: "text-emerald-400" },
  LiveKit:  { bar: "bg-amber-500",   txt: "text-amber-400"   },
};
function svc(name, k) { return (SVC_COLOUR[name] || { bar: "bg-slate-500", txt: "text-slate-400" })[k]; }

async function loadDevDashboard() {
  const data = await fetch("/api/dev/stats").then(r => r.json());
  const pm = data.per_minute;

  document.getElementById("dev-cost-per-min").textContent = fmtUsd(pm.total, 4) + "/min";
  document.getElementById("dev-cost-per-call").textContent = fmtUsd(pm.cost_per_call, 4);
  document.getElementById("dev-avg-label").textContent = "avg " + pm.avg_call_min + " min";

  document.getElementById("dev-permin-rows").innerHTML = pm.components.map(c => {
    const pct = Math.round((c.cost / pm.total) * 100);
    return `
      <div class="flex items-center gap-4">
        <div class="w-28 flex-shrink-0 flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${svc(c.service,"bar")} flex-shrink-0"></span>
          <span class="text-sm text-white font-medium">${c.service}</span>
        </div>
        <div class="w-36 flex-shrink-0 text-xs text-slate-500">${c.detail}</div>
        <div class="flex-1 bg-surface rounded-full h-1.5 overflow-hidden">
          <div class="${svc(c.service,"bar")} h-full rounded-full" style="width:${pct}%"></div>
        </div>
        <div class="w-10 text-right text-xs text-slate-500">${pct}%</div>
        <div class="w-20 text-right text-sm font-mono ${svc(c.service,"txt")}">$${c.cost.toFixed(4)}</div>
      </div>`;
  }).join("");

  document.getElementById("dev-projections").innerHTML = pm.projections.map(p => `
    <div class="bg-surface border border-border rounded-lg p-4">
      <p class="text-xs text-slate-400 mb-2">${p.label}</p>
      <p class="text-xl font-bold text-white mb-1">$${p.total.toFixed(0)}<span class="text-sm font-normal text-slate-400">/mo</span></p>
      <p class="text-xs text-slate-500">${p.minutes.toLocaleString()} min · +$${p.hosting_cost} hosting</p>
    </div>`).join("");

  document.getElementById("dev-cost-total").textContent = fmtUsd(data.costs.total_usd);
  document.getElementById("dev-cost-openai").textContent = fmtUsd(data.costs.openai.cost_usd);
  document.getElementById("dev-openai-tokens").textContent =
    fmtNum(data.costs.openai.tokens_in) + "↑ " + fmtNum(data.costs.openai.tokens_out) + "↓ tok";
  document.getElementById("dev-cost-cartesia").textContent = fmtUsd(data.costs.cartesia.cost_usd);
  document.getElementById("dev-cartesia-chars").textContent = fmtNum(data.costs.cartesia.characters) + " chars";

  document.getElementById("dev-services-body").innerHTML = data.services.map(s => {
    const ok = s.status === "ok" || s.status === "configured";
    return `
      <tr class="border-t border-border">
        <td class="px-5 py-3 inline-flex items-center gap-2">
          <span class="w-2 h-2 rounded-full ${ok ? "bg-green-400" : "bg-yellow-500"}"></span>
          <span class="font-medium text-white">${s.name}</span>
        </td>
        <td class="px-5 py-3 text-slate-400 font-mono text-xs">${s.detail}</td>
        <td class="px-5 py-3 text-slate-500 text-xs">${s.purpose}</td>
        <td class="px-5 py-3 text-xs ${ok ? "text-green-400" : "text-yellow-400"}">${s.status}</td>
      </tr>`;
  }).join("");

  const a = data.activity;
  document.getElementById("dev-convs").textContent = a.conversations;
  document.getElementById("dev-active").textContent = a.active_conversations;
  document.getElementById("dev-messages").textContent = a.total_messages;
  document.getElementById("dev-leads").textContent = a.leads_captured;
  document.getElementById("dev-llm-calls").textContent = a.llm_calls;
  document.getElementById("dev-tts-calls").textContent = a.tts_requests;

  document.getElementById("dev-agents").innerHTML = data.agents.map(ag => `
    <div class="bg-card border border-border rounded-xl p-5">
      <div class="flex items-start justify-between mb-4">
        <div>
          <p class="font-semibold text-white text-base">${ag.name}</p>
          <p class="text-slate-400 text-sm">${ag.role}</p>
        </div>
        <span class="text-xs bg-indigo-950 text-indigo-300 border border-indigo-800 px-2 py-0.5 rounded-full">testing</span>
      </div>
      <div class="space-y-2 text-xs">
        <div class="flex gap-3"><span class="text-slate-500 w-12 flex-shrink-0">Voice</span><span class="text-slate-300">${ag.voice}</span></div>
        <div class="flex gap-3"><span class="text-slate-500 w-12 flex-shrink-0">LLM</span><span class="text-slate-300">${ag.model}</span></div>
        <div class="flex gap-3"><span class="text-slate-500 w-12 flex-shrink-0">TTS</span><span class="text-slate-300">${ag.tts_model}</span></div>
        <div class="flex gap-3 flex-wrap items-start">
          <span class="text-slate-500 w-12 flex-shrink-0 mt-0.5">Tools</span>
          <div class="flex flex-wrap gap-1">${ag.tools.map(t =>
            `<span class="bg-surface border border-border px-2 py-0.5 rounded font-mono text-slate-300">${t}</span>`
          ).join("")}</div>
        </div>
      </div>
    </div>`).join("");
}

// ── Chat ───────────────────────────────────────────────────────────────────────
async function viewConversation(id) {
  const data = await fetch("/api/chat/" + id + "/history").then(r => r.json());
  showTab("chat");
  conversationId = id;
  const box = document.getElementById("chat-messages");
  box.innerHTML = "";
  data.messages.forEach(m => appendMessage(m.role, m.content));
  const active = data.conversation.status === "active";
  document.getElementById("chat-input").disabled = !active;
  document.getElementById("send-btn").disabled = !active;
  document.getElementById("reset-btn").classList.remove("hidden");
  document.getElementById("start-btn").classList.add("hidden");
}

async function startChat() {
  const res = await fetch("/api/chat/start", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({agent: currentAgent}),
  }).then(r => r.json());

  conversationId = res.conversation_id;
  const box = document.getElementById("chat-messages");
  box.innerHTML = "";
  appendMessage("assistant", res.message);

  // Ambience starts at background level as soon as chat begins
  if (ttsEnabled) {
    _startAmbience();
    playTTS(res.message);
  }

  document.getElementById("chat-input").disabled = false;
  document.getElementById("send-btn").disabled = false;
  document.getElementById("chat-input").focus();
  document.getElementById("reset-btn").classList.remove("hidden");
  document.getElementById("start-btn").classList.add("hidden");
}

async function sendMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !conversationId) return;
  input.value = "";
  appendMessage("user", text);

  const res = await fetch("/api/chat/message", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({conversation_id: conversationId, message: text}),
  }).then(r => r.json());

  appendMessage("assistant", res.message);
  if (ttsEnabled) playTTS(res.message);

  if (res.ended) {
    document.getElementById("chat-input").disabled = true;
    document.getElementById("send-btn").disabled = true;
    appendMessage("system", "— Conversation ended —");
    _stopAmbience();
  }
}

function _ttsDebug(msg) {
  const el = document.getElementById("tts-debug");
  if (el) el.textContent = msg;
}

async function playTTS(text) {
  try {
    _ttsDebug("fetching…");
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text, agent: currentAgent}),
    });
    if (!res.ok) { _ttsDebug("HTTP " + res.status); return; }

    _ttsDebug("decoding…");
    const arrayBuf = await res.arrayBuffer();
    _ttsDebug("buf=" + arrayBuf.byteLength + "B");

    const ctx = audioCtx();
    if (ctx.state !== "running") {
      _ttsDebug("ctx=" + ctx.state + " resuming…");
      await ctx.resume();
    }

    const audioBuf = await new Promise((resolve, reject) =>
      ctx.decodeAudioData(arrayBuf, resolve, (e) => {
        _ttsDebug("decode fail: " + e);
        reject(e);
      })
    );

    _ttsDebug("playing " + audioBuf.duration.toFixed(1) + "s");

    const src = ctx.createBufferSource();
    src.buffer = audioBuf;

    const gain = ctx.createGain();
    const now = ctx.currentTime;
    const dur = audioBuf.duration;
    const fadeAt = Math.max(0, dur - 0.7);

    gain.gain.setValueAtTime(1, now);
    if (fadeAt > 0) {
      gain.gain.setValueAtTime(1, now + fadeAt);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + dur + 0.1);
    }

    src.connect(gain);
    gain.connect(ctx.destination);

    src.onended = () => {
      gain.disconnect();
      _ttsDebug("done");
      _setAmbienceLevel(AMBIENCE_BG, 0.6);
      _stopKeyboardAmbience();
    };

    _setAmbienceLevel(AMBIENCE_TALK, 0.2);
    _startKeyboardAmbience();
    src.start(now);

  } catch (e) {
    _ttsDebug("err: " + (e.message || e));
    console.error("TTS error:", e);
  }
}

function toggleTTS() {
  ttsEnabled = !ttsEnabled;
  const btn = document.getElementById("tts-btn");
  btn.textContent = ttsEnabled ? "🔊 Voice On" : "🔇 Voice Off";
  btn.classList.toggle("bg-indigo-600", ttsEnabled);
  btn.classList.toggle("border-indigo-600", ttsEnabled);
  btn.classList.toggle("text-white", ttsEnabled);
  if (!ttsEnabled) {
    _stopAmbience();
  } else if (conversationId) {
    _startAmbience();
  }
}

function resetChat() {
  conversationId = null;
  _stopAmbience();
  document.getElementById("chat-messages").innerHTML =
    '<p class="text-slate-500 text-sm text-center">Press Start to connect to Claire</p>';
  document.getElementById("chat-input").disabled = true;
  document.getElementById("send-btn").disabled = true;
  document.getElementById("reset-btn").classList.add("hidden");
  document.getElementById("start-btn").classList.remove("hidden");
}

function appendMessage(role, content) {
  const box = document.getElementById("chat-messages");
  const wrap = document.createElement("div");
  if (role === "system") {
    wrap.className = "text-center text-xs text-slate-500 py-2";
    wrap.textContent = content;
  } else {
    wrap.className = "flex " + (role === "user" ? "justify-end" : "justify-start");
    const bubble = document.createElement("div");
    bubble.className = "max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm " +
      (role === "user"
        ? "bg-indigo-600 text-white rounded-br-sm"
        : "bg-surface border border-border text-slate-200 rounded-bl-sm");
    bubble.textContent = content;
    wrap.appendChild(bubble);
  }
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

loadOverview();
setInterval(loadOverview, 30000);



