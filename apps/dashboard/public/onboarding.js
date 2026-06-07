// Vireo Onboarding — 3-step wizard
const STORAGE_KEY = "vireo_token";
const USER_KEY = "vireo_user";

function getToken() { return localStorage.getItem(STORAGE_KEY); }
function setToken(t) { localStorage.setItem(STORAGE_KEY, t); }
function clearToken() { localStorage.removeItem(STORAGE_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; } }

function authFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch("/api/auth" + path, { ...opts, headers });
}

// require auth
if (!getToken()) location.href = "/login.html";

const state = {
  step: 1,
  niche: null,
  style: { tone: null, pacing: null, length: "60" },
  platforms: ["youtube", "tiktok"],
  uploadedFile: null,
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Step navigation
function goToStep(n) {
  state.step = n;
  $$(".step-panel").forEach(p => p.classList.remove("active"));
  $(`#step-${n}`).classList.add("active");
  $$(".step-dot").forEach(d => {
    const s = Number(d.dataset.step);
    d.classList.toggle("active", s === n);
    d.classList.toggle("done", s < n);
  });
  $$(".step-line").forEach((l, i) => l.classList.toggle("done", i < n - 1));
}

// Step 1: niche
$$(".niche-card").forEach(card => {
  card.addEventListener("click", () => {
    $$(".niche-card").forEach(c => c.classList.remove("selected"));
    card.classList.add("selected");
    state.niche = card.dataset.niche;
    $("#step-1-next").disabled = false;
  });
});
$("#step-1-skip").addEventListener("click", () => { state.niche = null; goToStep(2); });
$("#step-1-next").addEventListener("click", () => goToStep(2));

// Step 2: style
$$(".option-row").forEach(row => {
  const group = row.dataset.group;
  row.querySelectorAll(".option-card").forEach(card => {
    card.addEventListener("click", () => {
      row.querySelectorAll(".option-card").forEach(c => c.classList.remove("selected"));
      card.classList.add("selected");
      if (group === "length") {
        state.style.length = card.dataset.value;
      } else {
        state.style[group] = card.dataset.value;
      }
    });
  });
});
$$('.platform-toggles input[type="checkbox"]').forEach(cb => {
  cb.addEventListener("change", () => {
    state.platforms = $$('.platform-toggles input[type="checkbox"]:checked').map(i => i.value);
  });
});
$("#step-2-back").addEventListener("click", () => goToStep(1));
$("#step-2-next").addEventListener("click", async () => {
  // Save style preferences to user metadata
  try {
    await authFetch("/me", { method: "GET" });
    // store in localStorage for now (in real app, save to backend)
    localStorage.setItem("vireo_style", JSON.stringify({
      niche: state.niche,
      ...state.style,
      platforms: state.platforms,
    }));
  } catch (e) {
    console.warn("Could not save style", e);
  }
  goToStep(3);
});

// Step 3: upload
const uploadZone = $("#upload-zone");
const uploadInput = $("#video-input");
uploadZone.addEventListener("click", () => uploadInput.click());
uploadZone.addEventListener("dragover", (e) => { e.preventDefault(); uploadZone.classList.add("dragover"); });
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", (e) => {
  e.preventDefault();
  uploadZone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
uploadInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  state.uploadedFile = file;
  $("#upload-progress").style.display = "block";
  $("#progress-label").textContent = `Uploading ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)...`;

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/video/upload");
  xhr.setRequestHeader("Authorization", `Bearer ${getToken()}`);

  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) {
      const pct = Math.round((e.loaded / e.total) * 100);
      $("#progress-fill").style.width = pct + "%";
      $("#progress-label").textContent = `Uploading... ${pct}%`;
    }
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        const body = JSON.parse(xhr.responseText);
        $("#upload-result").style.display = "block";
        $("#upload-result").innerHTML = `
          <div style="color: var(--accent); font-weight: 600;">✓ Uploaded</div>
          <div style="margin-top: 4px;">${body.filename} — saved as <code>${body.file_path}</code></div>
          <div style="margin-top: 8px; font-size: 13px;">Now head to the dashboard and click "Generate clips" to edit it.</div>
        `;
        $("#progress-fill").style.width = "100%";
        $("#progress-label").textContent = "Done";
      } catch (e) {
        $("#progress-label").textContent = "Upload failed: bad response";
      }
    } else {
      $("#progress-label").textContent = `Upload failed: HTTP ${xhr.status}`;
    }
  };

  xhr.onerror = () => {
    $("#progress-label").textContent = "Upload failed: network error";
  };

  const formData = new FormData();
  formData.append("file", file);
  xhr.send(formData);
}

$("#step-3-back").addEventListener("click", () => goToStep(2));
$("#step-3-skip").addEventListener("click", () => { location.href = "/dashboard/"; });
$("#step-3-dashboard").addEventListener("click", () => { location.href = "/dashboard/"; });
