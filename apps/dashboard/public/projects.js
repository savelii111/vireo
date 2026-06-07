// Vireo projects — client-side logic.

const STUDIO_URL = "/api/studio";
const $ = (id) => document.getElementById(id);

function getToken() { return localStorage.getItem("vireo_token"); }

async function studioFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(STUDIO_URL + path, { ...opts, headers });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: "bad_json", raw: text }; }
  if (!r.ok) {
    const err = new Error(body?.message || body?.error || `HTTP ${r.status}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function setStatus(text, kind = "ok") {
  $("status-text").textContent = text;
  $("status-pill").classList.toggle("bad", kind === "bad");
}

async function loadProjects() {
  try {
    const r = await studioFetch("/projects");
    renderProjects(r.projects || []);
  } catch (e) {
    if (e.status === 401) { location.href = "/login.html"; return; }
    setStatus("Load: " + e.message, "bad");
  }
}

function renderProjects(projects) {
  const grid = $("projects-grid");
  $("projects-sub").textContent = `${projects.length} project${projects.length === 1 ? "" : "s"}`;
  if (projects.length === 0) {
    grid.innerHTML = `
      <div class="new-project-card" id="btn-new-card">
        <div class="icon">+</div>
        <div>Create your first project</div>
      </div>
    `;
    document.getElementById("btn-new-card").addEventListener("click", showModal);
    return;
  }
  grid.innerHTML = projects.map((p) => {
    const plats = (p.target_platforms || []).map((x) => `<span class="platform-tag">${escapeHtml(x)}</span>`).join("");
    const date = p.updated_at ? new Date(p.updated_at).toLocaleDateString() : "";
    return `
      <div class="project-card" data-id="${p.id}">
        <h3>${escapeHtml(p.name)}</h3>
        <div class="meta">${escapeHtml(p.niche || "—")} · ${date}</div>
        <div class="desc">${escapeHtml(p.description || "No description")}</div>
        <div class="platforms">${plats}</div>
      </div>
    `;
  }).join("") + `
    <div class="new-project-card" id="btn-new-card">
      <div class="icon">+</div>
      <div>New project</div>
    </div>
  `;
  grid.querySelectorAll(".project-card").forEach((el) => {
    el.addEventListener("click", () => openProject(el.dataset.id));
  });
  document.getElementById("btn-new-card").addEventListener("click", showModal);
}

function openProject(id) {
  // For now, open the chat with this project pre-selected via URL query.
  location.href = `/chat.html?project_id=${encodeURIComponent(id)}`;
}

function showModal() {
  $("modal-backdrop").style.display = "flex";
  $("np-name").focus();
}
function hideModal() { $("modal-backdrop").style.display = "none"; }

async function createProject() {
  const name = $("np-name").value.trim();
  if (!name) { alert("Name is required"); return; }
  const platforms = Array.from($("np-platforms").selectedOptions).map((o) => o.value);
  try {
    const r = await studioFetch("/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        niche: $("np-niche").value.trim() || null,
        description: $("np-desc").value.trim() || null,
        target_platforms: platforms,
      }),
    });
    hideModal();
    $("np-name").value = "";
    $("np-niche").value = "";
    $("np-desc").value = "";
    setStatus(`Created "${r.project.name}"`);
    await loadProjects();
  } catch (e) {
    setStatus("Create: " + e.message, "bad");
  }
}

(async function init() {
  if (!getToken()) { location.href = "/login.html"; return; }
  $("np-cancel").addEventListener("click", hideModal);
  $("np-create").addEventListener("click", createProject);
  $("modal-backdrop").addEventListener("click", (e) => { if (e.target === $("modal-backdrop")) hideModal(); });
  await loadProjects();
})();
