let conversationId = null;
let ttsEnabled = false;
let currentAgent = "hvac";

function showTab(name) {
  document.getElementById("view-overview").classList.toggle("hidden", name !== "overview");
  document.getElementById("view-chat").classList.toggle("hidden", name !== "chat");
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + name).classList.add("active");
  if (name === "overview") loadOverview();
}

async function loadOverview() {
  const [stats, leads, convs] = await Promise.all([
    fetch("/api/stats").then(r => r.json()).catch(() => ({})),
    fetch("/api/leads").then(r => r.json()).catch(() => []),
    fetch("/api/conversations").then(r => r.json()).catch(() => []),
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
      <td class="px-5 py-3"><span class="text-xs px-2 py-1 rounded-full ${c.status === "active" ? "bg-green-900 text-green-400 border border-green-800" : "bg-surface text-slate-400 border border-border"}">${c.status}</span></td>
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
  if (ttsEnabled) playTTS(res.message);
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
  input.disabled = true;
  document.getElementById("send-btn").disabled = true;
  appendMessage("user", text);

  const res = await fetch("/api/chat/message", {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({conversation_id: conversationId, message: text}),
  }).then(r => r.json());

  appendMessage("assistant", res.message);
  if (ttsEnabled) playTTS(res.message);

  if (res.ended) {
    appendMessage("system", "— Conversation ended —");
  } else {
    input.disabled = false;
    document.getElementById("send-btn").disabled = false;
    input.focus();
  }
}

async function playTTS(text) {
  try {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text, agent: currentAgent}),
    });
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
  btn.classList.toggle("bg-card", !ttsEnabled);
}

function resetChat() {
  conversationId = null;
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

loadOverview();
setInterval(loadOverview, 30000);
