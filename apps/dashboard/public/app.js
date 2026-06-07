// Vireo dashboard — client-side logic.
// Connects to Distributor + Analyst + Style Learner APIs.
// Falls back to demo data when no backend is running.

const $ = (id) => document.getElementById(id);

const state = {
  distributorUrl: localStorage.getItem("vireo.distributor") || "http://127.0.0.1:8003",
  analystUrl: localStorage.getItem("vireo.analyst") || "http://127.0.0.1:8004",
  styleLearnerUrl: localStorage.getItem("vireo.style") || "http://127.0.0.1:8001",
  editorUrl: localStorage.getItem("vireo.editor") || "http://127.0.0.1:8002",
  videoUrl: localStorage.getItem("vireo.video") || "http://127.0.0.1:8007",
  online: false,
  lastData: null,
};

// ----- helpers -----
async function tryFetch(url, opts = {}) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

function setStatus(online, text) {
  const pill = $("status-pill");
  const txt = $("status-text");
  pill.classList.toggle("bad", !online);
  txt.textContent = text;
  state.online = online;
}

function tag(s) {
  return `<span class="dna-tag">${s}</span>`;
}

function renderDNA(dna) {
  $("dna-tone").textContent = dna.tone || "—";
  $("dna-pacing").textContent = dna.pacing || "—";
  $("dna-vocab").textContent = (dna.vocabulary_level || "—").replace(/_/g, " ");
  $("dna-humor").textContent = (dna.humor_style || "—").replace(/_/g, " ");
  $("dna-hooks").innerHTML = (dna.hook_patterns || []).map(tag).join("") || '<span class="muted">none</span>';
  $("dna-ctas").innerHTML = (dna.cta_patterns || []).map(tag).join("") || '<span class="muted">none</span>';
  $("dna-topics").innerHTML = (dna.topics || []).slice(0, 8).map(tag).join("") || '<span class="muted">none</span>';
  $("dna-confidence").textContent = `confidence ${(dna.confidence * 100).toFixed(0)}%`;
}

function renderPipeline(jobs) {
  const grouped = new Map();
  for (const j of jobs) {
    if (!grouped.has(j.content_id)) grouped.set(j.content_id, []);
    grouped.get(j.content_id).push(j);
  }
  const list = $("pipeline-list");
  if (grouped.size === 0) {
    list.innerHTML = '<div class="empty">No content yet. Click "Run pipeline" to generate a demo.</div>';
    return;
  }
  list.innerHTML = [...grouped.entries()].map(([id, jobs]) => {
    const first = jobs[0];
    return `
      <div class="pipeline-item">
        <div>
          <div>${id}</div>
          <div class="meta">${jobs.length} platforms · scheduled ${first.scheduled_at?.slice(0, 16) || "—"}</div>
        </div>
        <div class="platforms">
          ${jobs.map((j) => `<span class="platform-tag ${j.status === "published" ? "published" : ""}">${j.platform}</span>`).join("")}
        </div>
      </div>`;
  }).join("");
}

function renderAlerts(alerts) {
  const list = $("alerts-list");
  if (!alerts || alerts.length === 0) {
    list.innerHTML = '<div class="empty">No alerts.</div>';
    return;
  }
  list.innerHTML = alerts.slice(-5).reverse().map((a) => `
    <div class="alert ${a.kind}">
      <div class="alert-head">
        <span>${a.kind === "viral" ? "🚀" : "📉"} ${a.kind.toUpperCase()}</span>
        <span>${a.multiplier}×</span>
      </div>
      <div class="alert-meta">${a.platform} · ${(a.engagement_rate * 100).toFixed(2)}% ER</div>
    </div>
  `).join("");
}

function renderPerf(perPlatform) {
  const grid = $("perf-grid");
  const entries = Object.entries(perPlatform || {});
  if (entries.length === 0) {
    grid.innerHTML = '<div class="empty">No data yet.</div>';
    return;
  }
  grid.innerHTML = entries.map(([p, d]) => {
    const score = d.performance_score || 0;
    const cls = score > 0.6 ? "good" : score > 0.4 ? "ok" : "bad";
    const barW = Math.round(score * 100);
    return `
      <div class="perf-card">
        <div class="perf-head">
          <div class="perf-name">${p.replace(/_/g, " ")}</div>
          <div class="perf-score ${cls}">${(score * 100).toFixed(0)}</div>
        </div>
        <div class="perf-bar"><div style="width:${barW}%"></div></div>
        <div class="perf-meta">${d.count} pieces · ${d.views.toLocaleString()} views · ${(d.engagement_rate * 100).toFixed(2)}% ER</div>
      </div>`;
  }).join("");
}

// ----- data loaders -----

async function loadAll() {
  const [jobs, audit, report] = await Promise.all([
    tryFetch(`${state.distributorUrl}/jobs`),
    tryFetch(`${state.analystUrl}/alerts`),
    tryFetch(`${state.analystUrl}/report`),
  ]);

  const anyOnline = jobs || audit || report;
  setStatus(!!anyOnline, anyOnline ? "Connected to agents" : "Offline — using demo data");

  if (jobs) {
    renderPipeline(jobs.jobs || []);
    $("stat-queued").textContent = (jobs.jobs || []).filter((j) => j.status === "pending").length;
    $("stat-published").textContent = (jobs.jobs || []).filter((j) => j.status === "published").length;
  } else {
    $("stat-queued").textContent = "—";
    $("stat-published").textContent = "—";
  }

  if (audit) {
    renderAlerts(audit.alerts || []);
    $("stat-alerts").textContent = (audit.alerts || []).length;
  } else {
    $("stat-alerts").textContent = "0";
  }

  if (report) {
    const r = report.report;
    $("stat-er").textContent = `${(r.avg_engagement_rate * 100).toFixed(2)}%`;
    renderPerf(r.per_platform);
  } else {
    $("stat-er").textContent = "—";
  }
}

async function runPipelineDemo() {
  const btn = $("btn-pipeline");
  btn.disabled = true;
  btn.textContent = "Running…";

  const corpus = [
    { text: "Bro this is INSANE! AI is changing the game. Hit subscribe!", title: "AI is wild", platform: "youtube" },
    { text: "Stop! Watch this new tech — it's mind-blowing. Subscribe for more!", title: "MUST see", platform: "youtube" },
    { text: "Yooo welcome back! Today we test the new thing. Let's gooo!", title: "Test day", platform: "youtube" },
  ];

  // Try to run real pipeline via HTTP
  const dna = await tryFetch(`${state.styleLearnerUrl}/analyze-llm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pieces: corpus, user_id: "demo" }),
  });
  if (dna) {
    renderDNA(dna.style_dna);
  } else {
    // Fallback: derive DNA from corpus client-side
    const tone = corpus.some((c) => /!{2,}|insane|mind-blow|wild/i.test(c.text)) ? "energetic" : "casual";
    renderDNA({
      tone, pacing: "fast", vocabulary_level: "conversational", humor_style: "subtle",
      hook_patterns: ["command", "temporal", "curiosity"],
      cta_patterns: ["engagement"],
      topics: ["AI", "tech"],
      confidence: 0.6,
    });
  }

  // Distribute
  const editPlan = {
    source_id: "demo-content-1",
    cuts: [
      { start: 0, end: 5, text: "Bro this is INSANE!", score: 0.9, role: "hook" },
      { start: 5, end: 20, text: "AI is changing the game for creators.", score: 0.8, role: "body" },
      { start: 20, end: 25, text: "Hit subscribe!", score: 0.6, role: "cta" },
    ],
    output_duration_sec: 25,
    style_applied: {},
    notes: "Demo",
  };
  const dist = await tryFetch(`${state.distributorUrl}/distribute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      editPlan,
      styleDna: dna?.style_dna || { tone: "energetic" },
      platforms: ["youtube", "youtube_shorts", "instagram_reels", "tiktok", "x", "linkedin", "threads", "telegram"],
      contentId: "demo-content-1",
    }),
  });

  if (dist) {
    btn.textContent = "✓ Distributed";
    setTimeout(() => { btn.textContent = "Run pipeline"; btn.disabled = false; }, 1500);
    loadAll();
  } else {
    btn.textContent = "Backend offline";
    setTimeout(() => { btn.textContent = "Run pipeline"; btn.disabled = false; }, 2000);
  }
}

// ----- bind -----

$("btn-pipeline").addEventListener("click", runPipelineDemo);

// ----- Video editor -----

const videoState = {
  file: null,
  uploadedPath: null,
  activeJob: null,
  pollHandle: null,
};

function initVideoEditor() {
  const drop = $("video-dropzone");
  const fileInput = $("video-file-input");
  const optColor = $("opt-color");
  const colorRow = $("color-row");

  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("dragover");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("dragover");
    if (e.dataTransfer.files.length) handleVideoFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) handleVideoFile(e.target.files[0]);
  });
  optColor.addEventListener("change", () => {
    colorRow.style.display = optColor.checked ? "flex" : "none";
  });

  $("btn-start-edit").addEventListener("click", startEditJob);
  $("btn-cancel-edit").addEventListener("click", cancelEditJob);
}

function handleVideoFile(file) {
  videoState.file = file;
  $("video-dropzone").innerHTML = `
    <div class="dropzone-content">
      <div class="dropzone-icon">✓</div>
      <div class="dropzone-text"><strong>${file.name}</strong><br>
        <span class="muted">${(file.size / 1024 / 1024).toFixed(1)} MB</span></div>
    </div>`;
  $("video-controls").style.display = "block";
  $("video-results").innerHTML = "";
}

function setProgress(percent, label) {
  $("video-progress").style.display = percent > 0 || label ? "block" : "none";
  $("progress-fill").style.width = `${Math.min(100, percent)}%`;
  if (label) $("progress-label").textContent = label;
}

async function uploadVideo(file) {
  const fd = new FormData();
  fd.append("file", file);
  setProgress(10, "Uploading video...");
  const r = await fetch(`${state.videoUrl}/upload`, { method: "POST", body: fd });
  if (!r.ok) throw new Error(`upload failed: ${r.status}`);
  const data = await r.json();
  setProgress(20, "Upload complete");
  return data.file_path;
}

async function startEditJob() {
  if (!videoState.file) return;
  $("btn-start-edit").disabled = true;
  $("btn-cancel-edit").disabled = false;
  try {
    const filePath = await uploadVideo(videoState.file);
    videoState.uploadedPath = filePath;
    const platform = $("video-platform").value;
    const maxMoments = parseInt($("video-max-moments").value) || 3;
    const enableZoom = $("opt-zoom").checked;
    const enableColor = $("opt-color").checked;
    const colorLook = $("video-color-look").value;
    const enableSilence = $("opt-silence").checked;
    const multiClip = $("opt-multi").checked;

    setProgress(30, "Starting pipeline...");
    const r = await fetch(`${state.videoUrl}/edit/async`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_path: filePath,
        target_platform: platform,
        max_moments: maxMoments,
        enable_zoom: enableZoom,
        enable_color: enableColor,
        color_look: colorLook,
        enable_silence_removal: enableSilence,
        multi_clip: multiClip,
        word_burn: true,
      }),
    });
    if (!r.ok) throw new Error(`pipeline start failed: ${r.status}`);
    const data = await r.json();
    videoState.activeJob = data.job_id;
    setProgress(40, "Processing pipeline...");
    pollJob(data.job_id);
  } catch (e) {
    setProgress(0, "");
    $("video-status").textContent = `Error: ${e.message}`;
    $("btn-start-edit").disabled = false;
  }
}

function pollJob(jobId) {
  if (videoState.pollHandle) clearInterval(videoState.pollHandle);
  let progressPct = 40;
  videoState.pollHandle = setInterval(async () => {
    try {
      const r = await fetch(`${state.videoUrl}/jobs/${jobId}`);
      if (!r.ok) return;
      const data = await r.json();
      // Increase visual progress over time (cap 95% until done)
      progressPct = Math.min(95, progressPct + 2);
      const step = data.steps?.[data.steps.length - 1]?.name || "processing";
      setProgress(progressPct, `${step}... (${Math.round(progressPct)}%)`);

      if (data.state === "done" || data.state === "failed") {
        clearInterval(videoState.pollHandle);
        videoState.pollHandle = null;
        setProgress(100, data.state === "done" ? "Complete!" : `Failed: ${data.error}`);
        if (data.state === "done") {
          renderResults(data);
        } else {
          $("video-status").textContent = "Failed";
        }
        $("btn-start-edit").disabled = false;
        $("btn-cancel-edit").disabled = true;
      }
    } catch (e) {
      // network blip, keep polling
    }
  }, 1500);
}

function renderResults(data) {
  const results = $("video-results");
  results.innerHTML = "";
  const clips = data.clips && data.clips.length > 0 ? data.clips : [{
    output_path: data.output_path,
    duration_sec: data.duration_sec,
    output_size_bytes: data.output_size_bytes,
    moment: { reason: "main clip" },
  }];

  clips.forEach((clip, i) => {
    const div = document.createElement("div");
    div.className = "video-result" + (clip.error ? " error" : "");
    if (clip.error) {
      div.innerHTML = `
        <div class="video-result-header"><span>Clip ${i + 1}</span></div>
        <div class="err-msg">${clip.error}</div>`;
    } else {
      const filename = clip.output_path.split(/[\\/]/).pop();
      const sizeMB = (clip.output_size_bytes / 1024 / 1024).toFixed(1);
      const dur = clip.duration_sec ? clip.duration_sec.toFixed(1) : "?";
      div.innerHTML = `
        <div class="video-result-header">
          <span>Clip ${i + 1}</span>
          <span>${dur}s · ${sizeMB}MB</span>
        </div>
        <div class="video-result-title">${clip.moment?.reason || "Auto-selected"}</div>
        <video controls src="${state.videoUrl}/download/${filename}"></video>
        <a class="download-btn" href="${state.videoUrl}/download/${filename}" download>Download</a>`;
    }
    results.appendChild(div);
  });
}

function cancelEditJob() {
  if (videoState.pollHandle) {
    clearInterval(videoState.pollHandle);
    videoState.pollHandle = null;
  }
  setProgress(0, "");
  $("btn-start-edit").disabled = false;
  $("btn-cancel-edit").disabled = true;
  $("video-status").textContent = "Cancelled";
}

initVideoEditor();

// initial load + poll every 5s
loadAll();
setInterval(loadAll, 5000);
