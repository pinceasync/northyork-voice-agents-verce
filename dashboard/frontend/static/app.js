let conversationId = null;
let ttsEnabled = false;
let currentAgent = "hvac";

// ── Audio context (created lazily on first user gesture) ──────────────────────
let _audioCtx = null;
let _ambienceNode = null;
let _ambienceGain = null;

function audioCtx() {
  if (!_audioCtx) {
    _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

// Synthesised keyboard click: filtered noise burst
function playKeyClick() {
  const ctx = audioCtx();
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 4);
    data[i] = (Math.random() * 2 - 1) * env;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;

  const bpf = ctx.createBiquadFilter();
  bpf.type = "bandpass";
  bpf.frequency.value = 2400 + Math.random() * 600;
  bpf.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.22, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

  src.connect(bpf);
  bpf.connect(gain);
  gain.connect(ctx.destination);
  src.start();
}

// Pink noise office ambience using a ScriptProcessor
function startAmbience() {
  if (_ambienceNode) return;
  const ctx = audioCtx();
  let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
  _ambienceNode = ctx.createScriptProcessor(4096, 1, 1);
  _ambienceNode.onaudioprocess = (e) => {
    const out = e.outputBuffer.getChannelData(0);
    for (let i = 0; i < out.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886*b0 + w*0.0555179;
      b1 = 0.99332*b1 + w*0.0750759;
      b2 = 0.96900*b2 + w*0.1538520;
      b3 = 0.86650*b3 + w*0.3104856;
      b4 = 0.55000*b4 + w*0.5329522;
      b5 = -0.7616*b5 - w*0.0168980;
      out[i] = (b0+b1+b2+b3+b4+b5+b6+w*0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  };
  _ambienceGain = ctx.createGain();
  _ambienceGain.gain.setValueAtTime(0, ctx.currentTime);
  _ambienceGain.gain.linearRampToValueAtTime(0.045, ctx.currentTime + 2);
  _ambienceNode.connect(_ambienceGain);
  _ambienceGain.connect(ctx.destination);
}

function stopAmbience() {
  if (!_ambienceNode || !_ambienceGain) return;
  const ctx = audioCtx();
  _ambienceGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
  setTimeout(() => {
    try { _ambienceNode.disconnect(); _ambienceGain.disconnect(); } catch(_) {}
    _ambienceNode = null;
    _ambienceGain = null;
  }, 1600);
}

// ── Tab / overview ─────────────────────────────────────────────────────────────
function showTab(name) {
  document.getElementById("view-overview").classList.toggle("hidden", name !== "overview");
  document.getElementById("view-chat").classList.toggle("hidden", name !== "chat");
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  if (name === "overview") loadOverview();
}

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
      <td class="px-5 py-3"><span class="text-xs px-2 py-1 rounded-full ${c.status === "active" ? "bg-green/10 text-green-400 border border-green-800" : "bg-surface text-slate-400 border border-border"}">${c.status}</span></td>
      <td class="px-5 py-3 text-slate-400 text-xs">${c.started_at}</td>
      <td class="px-5 py-3"><button onclick="viewConversation('${c._id}')" class="text-xs text-indigo-400 hover:underline">View</button></td>
    </tr>`).join("") : '<tr><td colspan="4" class="px-5 py-6 text-slate-500 text-center">No conversations yet</td></tr>';
}

async function viewConversation(id) {
  const data = await fetch(`/api/chat/${id}/history`).then(r => r.json());
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

// ── Chat ───────────────────────────────────────────────────────────────────────
async function startChat() {
  currentAgent = document.getElementById("agent-select").value;
  const res = await fetch("/api/chat/start", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({agent: currentAgent}),
  }).then(r => r.json());

  conversationId = res.conversation_id;
  const box = document.getElementById("chat-messages");
  box.innerHTML = "";
  appendMessage("assistant", res.message);
  if (ttsEnabled) {
    playTTS(res.message);
    startAmbience();
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
    stopAmbience();
  }
}

async function playTTS(text) {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text, agent: currentAgent}),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play();
    audio.onended = () => URL.revokeObjectURL(url);
  } catch (e) {
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
  if (ttsEnabled && conversationId) {
    startAmbience();
  } else {
    stopAmbience();
  }
}

function resetChat() {
  conversationId = null;
  stopAmbience();
  document.getElementById("chat-messages").innerHTML = '<p class="text-slate-500 text-sm text-center">Select an agent and start a conversation</p>';
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
    wrap.className = `flex ${role === "user" ? "justify-end" : "justify-start"}`;
    const bubble = document.createElement("div");
    bubble.className = `max-w-xs lg:max-w-md px-4 py-2.5 rounded-2xl text-sm ${role === "user" ? "bg-indigo-600 text-white rounded-br-sm" : "bg-surface border border-border text-slate-200 rounded-bl-sm"}`;
    bubble.textContent = content;
    wrap.appendChild(bubble);
  }
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}

// Keyboard click on every keydown in the chat input
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("chat-input").addEventListener("keydown", () => {
    playKeyClick();
  });
});

loadOverview();
setInterval(loadOverview, 30000);
