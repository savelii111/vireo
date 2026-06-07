// Vireo Auth — signup/login/onboarding flow
const AUTH_URL = "/api/auth";
const STORAGE_KEY = "vireo_token";

function getToken() { return localStorage.getItem(STORAGE_KEY); }
function setToken(t) { localStorage.setItem(STORAGE_KEY, t); }
function clearToken() { localStorage.removeItem(STORAGE_KEY); }
function getUser() { try { return JSON.parse(localStorage.getItem("vireo_user") || "null"); } catch { return null; } }
function setUser(u) { localStorage.setItem("vireo_user", JSON.stringify(u)); }

async function authFetch(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const r = await fetch(AUTH_URL + path, { ...opts, headers });
  let body;
  try { body = await r.json(); } catch { body = null; }
  if (!r.ok) {
    const msg = body?.error || body?.message || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return body;
}

function showError(form, msg) {
  const el = form.querySelector("#form-error");
  el.textContent = msg;
  el.style.display = "block";
}

function hideError(form) {
  form.querySelector("#form-error").style.display = "none";
}

function setLoading(form, loading) {
  const btn = form.querySelector("#submit-btn");
  btn.disabled = loading;
  btn.textContent = loading ? "Working..." : btn.dataset.original || btn.textContent;
}

// ---- Signup ----
const signupForm = document.getElementById("signup-form");
if (signupForm) {
  signupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError(signupForm);
    setLoading(signupForm, true);
    const data = Object.fromEntries(new FormData(signupForm));
    try {
      const res = await authFetch("/signup", { method: "POST", body: JSON.stringify(data) });
      setToken(res.token);
      setUser(res.user);
      // Check for ?plan=... to redirect to billing
      const params = new URLSearchParams(location.search);
      if (params.get("plan") && params.get("plan") !== "free") {
        location.href = "/dashboard/?onboard=1&plan=" + params.get("plan");
      } else {
        location.href = "/onboarding.html";
      }
    } catch (err) {
      showError(signupForm, err.message);
    } finally {
      setLoading(signupForm, false);
    }
  });
}

// ---- Login ----
const loginForm = document.getElementById("login-form");
if (loginForm) {
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError(loginForm);
    setLoading(loginForm, true);
    const data = Object.fromEntries(new FormData(loginForm));
    try {
      const res = await authFetch("/login", { method: "POST", body: JSON.stringify(data) });
      setToken(res.token);
      setUser(res.user);
      location.href = "/dashboard/";
    } catch (err) {
      showError(loginForm, err.message === "invalid_credentials" ? "Wrong email or password" : err.message);
    } finally {
      setLoading(loginForm, false);
    }
  });
}

// ---- Onboarding ----
if (location.pathname.endsWith("/onboarding.html") || location.pathname.endsWith("/onboarding")) {
  // require auth
  if (!getToken()) { location.href = "/login.html"; }
}
