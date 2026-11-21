/* ==========================================================================
   REALITY FORGE — a text-to-reality 3D sandbox
   Three.js + cannon-es · single file · mobile-first
   --------------------------------------------------------------------------
   QUICK START
   1. Paste a Gemini (or OpenAI) key into API_KEY below, or use the in-game
      gear icon on your phone. With no key the local forge still works.
   2. Open this file on a phone (or wrap it with Capacitor/Cordova).
   ========================================================================== */

// ─────────────────────────────────────────────────────────────────────────────
//  EASY-TO-FIND CONFIG — paste your key here
// ─────────────────────────────────────────────────────────────────────────────
const API_KEY = "";                          // <-- Gemini or OpenAI key
const API_PROVIDER = "gemini";               // "gemini" | "openai"
const GEMINI_MODEL = "gemini-2.5-flash";     // or gemini-2.0-flash
const OPENAI_MODEL = "gpt-4o-mini";          // or gpt-4.1-mini

// Performance + gameplay guardrails
const MAX_BODIES = 40;           // hard cap on live physics entities (pooled)
const PLAYER_SPEED = 7.4;
const PLAYER_RADIUS = 0.45;
const BASE_GRAVITY = -9.82;
const ENABLE_SHADOWS = true;

// Collision layers
const G_GROUND = 1, G_PLAYER = 2, G_ENTITY = 4, G_PROJECTILE = 8, G_VEHICLE = 16;

// ─────────────────────────────────────────────────────────────────────────────
//  Tiny helpers
// ─────────────────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const choice = (arr) => arr[(Math.random() * arr.length) | 0];
const deg = (d) => (d * Math.PI) / 180;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const isTyping = (el) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
function angleDamp(a, b, lambda, dt) {
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + delta * (1 - Math.exp(-lambda * dt));
}
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function titleFromPrompt(prompt) {
  let s = String(prompt || "").trim()
    .replace(/^(please\s+)?(make|create|spawn|build|give me|forge)\s+/i, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/[.!?]+$/g, "");
  if (!s) s = "Creation";
  const words = s.split(/\s+/).slice(0, 4);
  return words.map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ").slice(0, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Settings (persisted locally; API_KEY above is the default)
// ─────────────────────────────────────────────────────────────────────────────
const SETTINGS_KEY = "realityForge.settings.v1";
const storedSettings = (() => {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; }
})();
const settings = {
  provider: storedSettings.provider === "openai" ? "openai" : API_PROVIDER,
  key: typeof storedSettings.key === "string" ? storedSettings.key : API_KEY,
  model: typeof storedSettings.model === "string" ? storedSettings.model : "",
  sound: storedSettings.sound !== false,
  quality: ["auto", "high", "low"].includes(storedSettings.quality) ? storedSettings.quality : "auto",
};
function persistSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      provider: settings.provider, key: settings.key, model: settings.model,
      sound: settings.sound, quality: settings.quality,
    }));
  } catch { /* private mode */ }
}
function defaultModel(provider = settings.provider) {
  return provider === "openai" ? OPENAI_MODEL : GEMINI_MODEL;
}
function activeModel() {
  return (settings.model || "").trim() || defaultModel();
}

// ─────────────────────────────────────────────────────────────────────────────
//  DOM cache
// ─────────────────────────────────────────────────────────────────────────────
const dom = {
  app: $("app"), loading: $("loading"), loadError: $("loadError"),
  createBtn: $("createBtn"), settingsBtn: $("settingsBtn"),
  bodyCount: $("bodyCount"), fpsCount: $("fpsCount"), stats: $("stats"),
  effectChip: $("effectChip"), effectName: $("effectName"), effectTime: $("effectTime"),
  materializing: $("materializing"), toasts: $("toasts"), hint: $("hint"),
  reticle: $("reticle"),
  joystickZone: $("joystickZone"), joystick: $("joystick"), stickKnob: $("stickKnob"),
  lookZone: $("lookZone"), jumpBtn: $("jumpBtn"), useBtn: $("useBtn"),
  useLabel: $("useLabel"), useBadge: $("useBadge"),
  itemCard: $("itemCard"), itemName: $("itemName"), itemAction: $("itemAction"), itemIcon: $("itemIcon"),
  vehicleHint: $("vehicleHint"),
  promptOverlay: $("promptOverlay"), promptInput: $("promptInput"), sendBtn: $("sendBtn"),
  micBtn: $("micBtn"), voiceStatus: $("voiceStatus"), engineNote: $("engineNote"),
  chips: $("chips"), closePrompt: $("closePrompt"),
  settingsOverlay: $("settingsOverlay"), closeSettings: $("closeSettings"),
  providerSeg: $("providerSeg"), keyInput: $("keyInput"), modelInput: $("modelInput"),
  eyeBtn: $("eyeBtn"), soundToggle: $("soundToggle"), qualitySelect: $("qualitySelect"),
  saveSettings: $("saveSettings"), clearWorldBtn: $("clearWorldBtn"), respawnBtn: $("respawnBtn"),
};

// ─────────────────────────────────────────────────────────────────────────────
//  Toast / HUD helpers
// ─────────────────────────────────────────────────────────────────────────────
function toast(message, kind = "", icon = "✦", duration = 2600) {
  if (!dom.toasts) return;
  const el = document.createElement("div");
  el.className = "toast " + kind;
  const ic = document.createElement("span"); ic.className = "t-icon"; ic.textContent = icon;
  const tx = document.createElement("span"); tx.textContent = message;
  el.append(ic, tx);
  dom.toasts.appendChild(el);
  while (dom.toasts.children.length > 2) dom.toasts.firstChild.remove();
  setTimeout(() => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 320);
  }, duration);
}
function setMaterializing(on) {
  dom.materializing.classList.toggle("on", !!on);
}
function setEffectChip(name, seconds, icon = "🌙") {
  if (!name) { dom.effectChip.classList.remove("on"); return; }
  dom.effectChip.classList.add("on");
  dom.effectName.textContent = name.toUpperCase();
  dom.effectTime.textContent = Math.max(0, Math.ceil(seconds)) + "s";
  dom.effectChip.querySelector(".e-icon").textContent = icon;
}
function hideEffectChip() { dom.effectChip.classList.remove("on"); }
function hideHint() {
  dom.hint.classList.add("off");
}
function setItemCard(spec, actionText) {
  if (!spec) { dom.itemCard.classList.remove("on"); return; }
  const icon = spec.type === "vehicle" ? "🚙" : spec.type === "physics_object" ? "🧱" : spec.type === "world_event" ? "🌍" : "✦";
  dom.itemIcon.textContent = icon;
  dom.itemName.textContent = spec.name || "Creation";
  dom.itemAction.textContent = actionText || "TAP USE";
  dom.itemCard.classList.add("on");
}
function hideItemCard() { dom.itemCard.classList.remove("on"); }
function setUseLabel(label) {
  if (dom.useLabel.textContent !== label) dom.useLabel.textContent = label;
}
function setUseBadge(text) {
  if (!text) { dom.useBadge.style.display = "none"; return; }
  dom.useBadge.style.display = "flex";
  dom.useBadge.textContent = text;
}
function syncViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const active = dom.promptOverlay.classList.contains("open") || dom.settingsOverlay.classList.contains("open");
  if (active) {
    for (const overlay of [dom.promptOverlay, dom.settingsOverlay]) {
      if (!overlay.classList.contains("open")) continue;
      overlay.style.top = vv.offsetTop + "px";
      overlay.style.height = vv.height + "px";
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Procedural audio (no assets, unlocked on first gesture)
// ─────────────────────────────────────────────────────────────────────────────
const AudioFX = {
  ctx: null, master: null, noiseBuffer: null, enabled: settings.sound,
  init() {
    if (this.ctx) { if (this.ctx.state === "suspended") this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 1.2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;
    } catch { /* audio unavailable */ }
  },
  tone(freq = 440, dur = 0.12, type = "sine", vol = 0.16, slide = 0, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, freq), t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  noise(dur = 0.2, vol = 0.2, freq = 1200, type = "lowpass", delay = 0) {
    if (!this.enabled || !this.ctx || !this.noiseBuffer) return;
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type; filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.18), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  },
  ui() { this.tone(560, 0.05, "triangle", 0.06); },
  shoot() { this.tone(240, 0.12, "sawtooth", 0.1, -170); this.noise(0.09, 0.12, 2600, "highpass"); },
  laser() { this.tone(880, 0.16, "square", 0.07, -620); },
  explosion() { this.noise(0.55, 0.34, 900, "lowpass"); this.tone(62, 0.45, "sine", 0.2, -30); },
  jump() { this.tone(300, 0.16, "sine", 0.11, 220); },
  land() { this.noise(0.09, 0.1, 500, "lowpass"); },
  bounce() { this.tone(420, 0.2, "sine", 0.13, 420); },
  boost() { this.tone(180, 0.3, "sawtooth", 0.09, 320); this.noise(0.25, 0.1, 1600, "bandpass"); },
  materialize() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, "sine", 0.06, 0, i * 0.07)); },
  forge() { [392, 523, 784].forEach((f, i) => this.tone(f, 0.24, "triangle", 0.07, 0, i * 0.06)); },
  error() { this.tone(190, 0.18, "square", 0.07, -60); },
};
function buzz(ms = 10) {
  try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* unsupported */ }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Runtime state
// ─────────────────────────────────────────────────────────────────────────────
const state = {
  ready: false, paused: false, creating: false, time: 0,
  equipped: null, lastCreated: null, lastPrompt: "",
  drivingEntity: null, nearVehicle: null,
  nextFire: 0, cooldownTotal: 0.4, recoil: 0,
  jumpBuffer: 0, coyote: 0, jumpCooldown: 0, wasGrounded: true, fallSpeed: 0, squash: 0,
  walkPhase: 0, faceYaw: 0, aimingUntil: 0,
  gravityTarget: 1, effect: null, weather: null,
  fps: 60, lastHud: 0, lastRecycleToast: 0,
  quality: "high", boostCooldown: 0,
  firstCreation: true, deathY: -15,
};
const input = { moveX: 0, moveY: 0, lookDX: 0, lookDY: 0, active: false };
const keys = Object.create(null);

// Placeholder engine globals, assigned in the engine section
let THREE, CANNON;
let scene, camera, renderer, clock;
let world, matGround, matPlayer, matEntity, matBouncy, matVehicle;
let playerBody, playerGroup, playerVisual, weaponMount, heldGroup, blobShadow;
let sunLight, hemiLight, skyMesh, skyUniforms;
let cam = { yaw: 0.55, pitch: 0.28, dist: 6.7, target: null, shake: 0, lastLook: -99 };
let entities = [];
let entityPool = [];
let nextEntityId = 1;
const pendingImpacts = [];
let effectPool = null;
let rainSystem = null;
let lastFrame = 0;
