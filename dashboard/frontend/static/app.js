const POLL_MS = 5000;

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

function fmtDuration(sec) {
  if (!sec && sec !== 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function agentLabel(agent) {
  const map = { law_firm: "Law Firm", hvac: "HVAC" };
  return map[agent] || agent;
}

function agentColor(agent) {
  return agent === "law_firm"
    ? "bg-indigo-500/20 text-indigo-300"
    : "bg-emerald-500/20 text-emerald-300";
}

function statusPill(status) {
  if (status === "active")
    return `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green/20 text-green">
              <span class="w-1.5 h-1.5 rounded-full bg-green animate-pulse"></span>Live
            </span>`;
  return `<span class="px-2 py-0.5 rounded-full text-xs bg-slate-700 text-slate-400">Done</span>`;
}

function urgentBadge(isUrgent) {
  return isUrgent
    ? `<span class="px-2 py-0.5 rounded-full text-xs bg-red/20 text-red font-medium">Urgent</span>`
    : `<span class="text-slate-500">—</span>`;
}

// ── Active calls ──────────────────────────────────────────────────────────────

async function refreshActive() {
  const calls = await fetchJSON("/api/active");
  const container = document.getElementById("active-calls");
  const countEl   = document.getElementById("active-count");

  countEl.textContent = calls.length === 1 ? "1 active call" : `${calls.length} active calls`;

  if (calls.length === 0) {
    container.innerHTML = `
      <div class="bg-card border border-border rounded-xl px-5 py-4 text-slate-500 text-sm">
        No active calls right now
      </div>`;
    return;
  }

  container.innerHTML = calls.map(c => {
    const elapsed = c.started_at
      ? Math.floor((Date.now() - new Date(c.started_at.replace(" ","T")+"Z").getTime()) / 1000)
      : 0;
    return `
      <div class="bg-card border border-border rounded-xl px-5 py-4 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <div class="w-2 h-2 rounded-full bg-green animate-pulse"></div>
          <div>
            <p class="font-medium text-white">${c.caller_number || "Unknown caller"}</p>
            <p class="text-xs text-slate-400">${fmtTime(c.started_at)}</p>
          </div>
        </div>
        <div class="flex items-center gap-4">
          <span class="text-sm text-slate-300">${fmtDuration(elapsed)}</span>
          <span class="px-2 py-0.5 rounded-full text-xs ${agentColor(c.agent)}">${agentLabel(c.agent)}</span>
        </div>
      </div>`;
  }).join("");
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function refreshStats() {
  const s = await fetchJSON("/api/stats");
  document.getElementById("stat-calls").textContent  = s.calls_today ?? "0";
  document.getElementById("stat-avg").textContent    = fmtDuration(s.avg_duration_sec);
  document.getElementById("stat-leads").textContent  = s.consultations_booked ?? "0";
  document.getElementById("stat-urgent").textContent = s.urgent_matters ?? "0";
}

// ── Leads ─────────────────────────────────────────────────────────────────────

async function refreshLeads() {
  const leads = await fetchJSON("/api/leads");
  const tbody = document.getElementById("leads-body");

  if (!leads.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-6 text-slate-500 text-center">No leads yet</td></tr>`;
    return;
  }

  tbody.innerHTML = leads.map(l => `
    <tr class="border-t border-border hover:bg-white/[0.02] transition-colors">
      <td class="px-5 py-3 font-medium text-white">${l.caller_name || "—"}</td>
      <td class="px-5 py-3 text-slate-300">${l.caller_phone || "—"}</td>
      <td class="px-5 py-3 text-slate-300">${l.legal_matter || l.problem_details || "—"}</td>
      <td class="px-5 py-3 text-slate-400">${l.preferred_datetime || "—"}</td>
      <td class="px-5 py-3">
        <span class="px-2 py-0.5 rounded-full text-xs ${agentColor(l.agent)}">${agentLabel(l.agent)}</span>
      </td>
      <td class="px-5 py-3">${urgentBadge(l.is_urgent)}</td>
      <td class="px-5 py-3 text-slate-400 text-xs">${fmtTime(l.created_at)}</td>
    </tr>`).join("");
}

// ── Call log ──────────────────────────────────────────────────────────────────

async function refreshCalls() {
  const calls = await fetchJSON("/api/calls");
  const tbody = document.getElementById("calls-body");

  if (!calls.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="px-5 py-6 text-slate-500 text-center">No calls yet</td></tr>`;
    return;
  }

  tbody.innerHTML = calls.map(c => `
    <tr class="border-t border-border hover:bg-white/[0.02] transition-colors">
      <td class="px-5 py-3 text-slate-300">${c.caller_number || "Unknown"}</td>
      <td class="px-5 py-3">
        <span class="px-2 py-0.5 rounded-full text-xs ${agentColor(c.agent)}">${agentLabel(c.agent)}</span>
      </td>
      <td class="px-5 py-3 text-slate-400 text-xs">${fmtTime(c.started_at)}</td>
      <td class="px-5 py-3 text-slate-300">${fmtDuration(c.duration_sec)}</td>
      <td class="px-5 py-3">${statusPill(c.status)}</td>
    </tr>`).join("");
}

// ── Poll loop ─────────────────────────────────────────────────────────────────

async function refresh() {
  try {
    await Promise.all([refreshActive(), refreshStats(), refreshLeads(), refreshCalls()]);
    document.getElementById("last-refresh").textContent =
      "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch (e) {
    console.error("Refresh error:", e);
  }
}

refresh();
setInterval(refresh, POLL_MS);
