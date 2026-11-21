// ─────────────────────────────────────────────────────────────────────────────
//  OVERLAYS: CREATE SHEET + SETTINGS
// ─────────────────────────────────────────────────────────────────────────────
let draftProvider = settings.provider;
let recognition = null;
let listening = false;

function updateEngineNote() {
  const key = (settings.key || "").trim();
  if (key) {
    dom.engineNote.textContent = "Connected to " + (settings.provider === "openai" ? "OpenAI" : "Gemini") + " · " + activeModel();
  } else {
    dom.engineNote.textContent = "Local forge ready — add a key in settings for unlimited creations";
  }
}

function openPrompt() {
  if (state.creating) { toast("Still materializing…", "warn", "⏳", 1500); return; }
  if (dom.settingsOverlay.classList.contains("open")) closeSettings();
  AudioFX.init();
  AudioFX.ui();
  state.paused = true;
  resetJoystick();
  hideHint();
  dom.promptOverlay.classList.add("open");
  dom.promptOverlay.setAttribute("aria-hidden", "false");
  dom.promptOverlay.style.top = "";
  dom.promptOverlay.style.height = "";
  updateEngineNote();
  syncViewport();
  setTimeout(() => {
    try { dom.promptInput.focus({ preventScroll: true }); } catch { dom.promptInput.focus(); }
  }, 230);
}

function closePrompt() {
  if (!dom.promptOverlay.classList.contains("open")) return;
  stopVoice();
  dom.promptOverlay.classList.remove("open");
  dom.promptOverlay.setAttribute("aria-hidden", "true");
  dom.promptOverlay.style.top = "";
  dom.promptOverlay.style.height = "";
  dom.promptInput.blur();
  dom.voiceStatus.classList.remove("on");
  state.paused = false;
}

function sendPrompt() {
  const text = dom.promptInput.value.trim();
  if (!text) {
    toast("Type something first", "warn", "✍️", 1600);
    try { dom.promptInput.focus(); } catch { /* ignore */ }
    return;
  }
  state.lastPrompt = text;
  dom.promptInput.value = "";
  dom.promptInput.style.height = "auto";
  closePrompt();
  createFromPrompt(text);
}

function openSettings() {
  if (dom.promptOverlay.classList.contains("open")) closePrompt();
  AudioFX.init();
  AudioFX.ui();
  state.paused = true;
  resetJoystick();
  draftProvider = settings.provider;
  refreshSettingsUI();
  dom.settingsOverlay.classList.add("open");
  dom.settingsOverlay.setAttribute("aria-hidden", "false");
  dom.settingsOverlay.style.top = "";
  dom.settingsOverlay.style.height = "";
  syncViewport();
}

function closeSettings() {
  if (!dom.settingsOverlay.classList.contains("open")) return;
  dom.settingsOverlay.classList.remove("open");
  dom.settingsOverlay.setAttribute("aria-hidden", "true");
  dom.settingsOverlay.style.top = "";
  dom.settingsOverlay.style.height = "";
  state.paused = false;
}

function refreshSettingsUI() {
  if (!dom.providerSeg) return;
  [...dom.providerSeg.querySelectorAll("button")].forEach((b) => {
    b.classList.toggle("on", b.dataset.provider === draftProvider);
  });
  dom.modelInput.placeholder = defaultModel(draftProvider);
  dom.keyInput.value = settings.key || "";
  dom.keyInput.type = "password";
  dom.eyeBtn.textContent = "SHOW";
  dom.modelInput.value = settings.model || "";
  dom.soundToggle.classList.toggle("on", settings.sound);
  dom.soundToggle.setAttribute("aria-checked", String(settings.sound));
  dom.qualitySelect.value = settings.quality;
}

function saveSettingsFromUI() {
  let key = (dom.keyInput.value || "").trim();
  const model = (dom.modelInput.value || "").trim();
  let provider = draftProvider;
  if (key.startsWith("AIza") && provider === "openai") {
    provider = "gemini";
    toast("Detected a Gemini key — provider switched", "", "🔑", 2600);
  } else if (key.startsWith("sk-") && provider === "gemini") {
    provider = "openai";
    toast("Detected an OpenAI key — provider switched", "", "🔑", 2600);
  }
  settings.provider = provider;
  settings.key = key;
  settings.model = model;
  settings.sound = dom.soundToggle.classList.contains("on");
  settings.quality = dom.qualitySelect.value;
  persistSettings();
  AudioFX.enabled = settings.sound;
  applyQuality();
  updateEngineNote();
  closeSettings();
  if (key) toast("AI connected · " + activeModel(), "good", "⚡", 2600);
  else toast("Local forge mode enabled", "", "🧠", 2200);
  AudioFX.ui();
}

function closeAll() {
  closePrompt();
  closeSettings();
}

// ─────────────────────────────────────────────────────────────────────────────
//  VOICE-TO-TEXT (Web Speech API)
// ─────────────────────────────────────────────────────────────────────────────
function setupVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    dom.micBtn.style.opacity = "0.42";
    dom.micBtn.setAttribute("aria-label", "Voice input not supported in this browser");
    dom.micBtn.addEventListener("click", () => {
      toast("Voice input is not supported in this browser", "warn", "🎙️", 2600);
    });
    return;
  }
  recognition = new SR();
  recognition.lang = navigator.language || "en-US";
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  recognition.onresult = (event) => {
    let text = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      text += event.results[i][0].transcript;
    }
    dom.promptInput.value = text.trim();
    dom.promptInput.style.height = "auto";
    dom.promptInput.style.height = Math.min(128, dom.promptInput.scrollHeight) + "px";
    dom.voiceStatus.textContent = "🎙 " + text.trim();
    dom.voiceStatus.classList.add("on");
  };
  recognition.onerror = (event) => {
    listening = false;
    dom.micBtn.classList.remove("listening");
    dom.voiceStatus.classList.remove("on");
    if (event.error !== "aborted" && event.error !== "no-speech") {
      toast("Voice unavailable: " + event.error, "warn", "🎙️", 2600);
    }
  };
  recognition.onend = () => {
    listening = false;
    dom.micBtn.classList.remove("listening");
    dom.voiceStatus.classList.remove("on");
  };

  dom.micBtn.addEventListener("click", () => {
    if (!dom.promptOverlay.classList.contains("open")) return;
    AudioFX.init();
    if (listening) {
      stopVoice();
      return;
    }
    try {
      recognition.start();
      listening = true;
      dom.micBtn.classList.add("listening");
      dom.voiceStatus.textContent = "🎙 Listening… speak your creation";
      dom.voiceStatus.classList.add("on");
      buzz(8);
    } catch {
      toast("Could not start the microphone", "warn", "🎙️", 2200);
    }
  });
}

function stopVoice() {
  if (!recognition || !listening) return;
  try { recognition.stop(); } catch { /* ignore */ }
  listening = false;
  dom.micBtn.classList.remove("listening");
  dom.voiceStatus.classList.remove("on");
}

// ─────────────────────────────────────────────────────────────────────────────
//  JOYSTICK
// ─────────────────────────────────────────────────────────────────────────────
let joyPointer = null;
const joyBase = { x: 0, y: 0 };
const joyHome = { x: 90, y: 600 };
const JOY_RADIUS = 44;

function placeJoystickHome() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  joyHome.x = Math.max(82, Math.min(w * 0.17, 128));
  joyHome.y = h - Math.max(112, Math.min(h * 0.15, 146));
  if (joyPointer === null) {
    dom.joystick.style.left = joyHome.x + "px";
    dom.joystick.style.top = joyHome.y + "px";
  }
}

function setKnob(dx, dy) {
  dom.stickKnob.style.transform = "translate(calc(-50% + " + dx + "px), calc(-50% + " + dy + "px))";
}

function applyJoystick(dx, dy) {
  const d = Math.hypot(dx, dy);
  if (d > JOY_RADIUS) { dx = (dx / d) * JOY_RADIUS; dy = (dy / d) * JOY_RADIUS; }
  setKnob(dx, dy);
  let nx = dx / JOY_RADIUS;
  let ny = -dy / JOY_RADIUS;
  const mag = Math.hypot(nx, ny);
  if (mag < 0.14) { nx = 0; ny = 0; }
  else {
    const k = (mag - 0.14) / (1 - 0.14);
    nx = (nx / mag) * k;
    ny = (ny / mag) * k;
  }
  input.moveX = clamp(nx, -1, 1);
  input.moveY = clamp(ny, -1, 1);
}

function resetJoystick() {
  joyPointer = null;
  input.moveX = 0;
  input.moveY = 0;
  dom.joystick.classList.remove("active");
  setKnob(0, 0);
  dom.joystick.style.transition = "left .2s ease, top .2s ease, opacity .2s, width .15s, height .15s";
  dom.joystick.style.left = joyHome.x + "px";
  dom.joystick.style.top = joyHome.y + "px";
  setTimeout(() => { if (joyPointer === null) dom.joystick.style.transition = ""; }, 240);
}

function setupJoystick() {
  dom.joystickZone.addEventListener("pointerdown", (e) => {
    if (joyPointer !== null || state.paused) return;
    e.preventDefault();
    e.stopPropagation();
    AudioFX.init();
    joyPointer = e.pointerId;
    try { dom.joystickZone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    joyBase.x = e.clientX;
    joyBase.y = e.clientY;
    dom.joystick.style.transition = "none";
    dom.joystick.style.left = e.clientX + "px";
    dom.joystick.style.top = e.clientY + "px";
    dom.joystick.classList.add("active");
    applyJoystick(0, 0);
  });
  dom.joystickZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== joyPointer) return;
    e.preventDefault();
    applyJoystick(e.clientX - joyBase.x, e.clientY - joyBase.y);
  });
  const end = (e) => {
    if (e.pointerId !== joyPointer) return;
    resetJoystick();
  };
  dom.joystickZone.addEventListener("pointerup", end);
  dom.joystickZone.addEventListener("pointercancel", end);
  dom.joystickZone.addEventListener("lostpointercapture", end);
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOOK / CAMERA DRAG
// ─────────────────────────────────────────────────────────────────────────────
let lookPointer = null;
const lookLast = { x: 0, y: 0 };

function setupLook() {
  dom.lookZone.addEventListener("pointerdown", (e) => {
    if (state.paused || lookPointer !== null) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    lookPointer = e.pointerId;
    lookLast.x = e.clientX;
    lookLast.y = e.clientY;
    try { dom.lookZone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    AudioFX.init();
  });
  dom.lookZone.addEventListener("pointermove", (e) => {
    if (e.pointerId !== lookPointer) return;
    const dx = e.clientX - lookLast.x;
    const dy = e.clientY - lookLast.y;
    lookLast.x = e.clientX;
    lookLast.y = e.clientY;
    cam.yaw -= dx * 0.0042;
    cam.pitch = clamp(cam.pitch + dy * 0.0034, -0.18, 1.18);
    cam.lastLook = state.time;
  });
  const end = (e) => { if (e.pointerId === lookPointer) lookPointer = null; };
  dom.lookZone.addEventListener("pointerup", end);
  dom.lookZone.addEventListener("pointercancel", end);
  dom.lookZone.addEventListener("lostpointercapture", end);
  dom.lookZone.addEventListener("wheel", (e) => {
    e.preventDefault();
    cam.dist = clamp(cam.dist + e.deltaY * 0.0035, 3.8, 11.5);
  }, { passive: false });
  dom.lookZone.addEventListener("contextmenu", (e) => e.preventDefault());
}

// ─────────────────────────────────────────────────────────────────────────────
//  KEYBOARD (desktop convenience)
// ─────────────────────────────────────────────────────────────────────────────
function setupKeyboard() {
  window.addEventListener("keydown", (e) => {
    if (isTyping(e.target)) {
      if (e.code === "Escape") closeAll();
      return;
    }
    AudioFX.init();
    const code = e.code;
    if (["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(code)) {
      e.preventDefault();
    }
    if (code === "KeyW" || code === "ArrowUp") keys.w = true;
    if (code === "KeyS" || code === "ArrowDown") keys.s = true;
    if (code === "KeyA" || code === "ArrowLeft") keys.a = true;
    if (code === "KeyD" || code === "ArrowRight") keys.d = true;
    if (e.repeat) return;
    if (code === "Space") requestJump();
    else if (code === "KeyF" || code === "KeyE") useAction();
    else if (code === "KeyC") openPrompt();
    else if (code === "Escape") closeAll();
  });
  window.addEventListener("keyup", (e) => {
    const code = e.code;
    if (code === "KeyW" || code === "ArrowUp") keys.w = false;
    if (code === "KeyS" || code === "ArrowDown") keys.s = false;
    if (code === "KeyA" || code === "ArrowLeft") keys.a = false;
    if (code === "KeyD" || code === "ArrowRight") keys.d = false;
  });
  window.addEventListener("blur", () => {
    keys.w = keys.a = keys.s = keys.d = false;
    resetJoystick();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  BUTTON / SHEET WIRING
// ─────────────────────────────────────────────────────────────────────────────
function bindPress(el, fn) {
  if (!el) return;
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  });
  el.addEventListener("click", (e) => {
    if (e.detail === 0) { e.preventDefault(); fn(); }
  });
}

function setupUI() {
  placeJoystickHome();
  setupJoystick();
  setupLook();
  setupKeyboard();
  setupVoice();

  dom.createBtn.addEventListener("click", (e) => { e.preventDefault(); openPrompt(); });
  dom.settingsBtn.addEventListener("click", (e) => { e.preventDefault(); openSettings(); });
  dom.closePrompt.addEventListener("click", (e) => { e.preventDefault(); closePrompt(); });
  dom.closeSettings.addEventListener("click", (e) => { e.preventDefault(); closeSettings(); });
  dom.sendBtn.addEventListener("click", (e) => { e.preventDefault(); sendPrompt(); });

  bindPress(dom.jumpBtn, requestJump);
  bindPress(dom.useBtn, useAction);

  dom.chips.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    dom.promptInput.value = chip.dataset.prompt || chip.textContent.trim();
    AudioFX.ui();
    sendPrompt();
  });

  dom.promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendPrompt();
    }
  });
  dom.promptInput.addEventListener("input", () => {
    dom.promptInput.style.height = "auto";
    dom.promptInput.style.height = Math.min(128, dom.promptInput.scrollHeight) + "px";
  });

  for (const overlay of [dom.promptOverlay, dom.settingsOverlay]) {
    overlay.addEventListener("click", (e) => {
      if (e.target !== overlay) return;
      if (overlay === dom.promptOverlay) closePrompt();
      else closeSettings();
    });
  }

  dom.providerSeg.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-provider]");
    if (!btn) return;
    draftProvider = btn.dataset.provider;
    [...dom.providerSeg.querySelectorAll("button")].forEach((b) => b.classList.toggle("on", b === btn));
    dom.modelInput.placeholder = defaultModel(draftProvider);
    AudioFX.ui();
  });

  dom.eyeBtn.addEventListener("click", () => {
    const show = dom.keyInput.type === "password";
    dom.keyInput.type = show ? "text" : "password";
    dom.eyeBtn.textContent = show ? "HIDE" : "SHOW";
  });

  dom.soundToggle.addEventListener("click", () => {
    settings.sound = !settings.sound;
    dom.soundToggle.classList.toggle("on", settings.sound);
    dom.soundToggle.setAttribute("aria-checked", String(settings.sound));
    AudioFX.enabled = settings.sound;
    AudioFX.init();
    if (settings.sound) AudioFX.ui();
    persistSettings();
  });

  dom.qualitySelect.addEventListener("change", () => {
    settings.quality = dom.qualitySelect.value;
    persistSettings();
    applyQuality();
    toast("Quality: " + settings.quality, "", "🎛️", 1500);
  });

  dom.saveSettings.addEventListener("click", saveSettingsFromUI);
  dom.clearWorldBtn.addEventListener("click", clearCreations);
  dom.respawnBtn.addEventListener("click", () => { closeSettings(); respawnPlayer(false); });

  document.addEventListener("gesturestart", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });
  document.addEventListener("contextmenu", (e) => {
    if (e.target && e.target.tagName === "CANVAS") e.preventDefault();
  });
  window.addEventListener("pointerdown", () => AudioFX.init(), { once: true, passive: true });
  window.addEventListener("keydown", () => AudioFX.init(), { once: true });

  updateEngineNote();
  if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    dom.hint.innerHTML = "Tap <b>✦ Create</b> · WASD move · drag to look";
  }
  setTimeout(hideHint, 13000);
  applyQuality();
}

// ─────────────────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────────────────
function updateCooldownUI() {
  const remain = Math.max(0, state.nextFire - state.time);
  const total = Math.max(0.15, state.cooldownTotal || 0.4);
  const cd = clamp(remain / total, 0, 1);
  dom.useBtn.style.setProperty("--cd", cd.toFixed(3));
  dom.useBtn.classList.toggle("ready", cd <= 0.001);
}

function updateHud() {
  updateCooldownUI();
  if (state.time - state.lastHud < 0.22) return;
  state.lastHud = state.time;
  dom.fpsCount.textContent = String(Math.round(clamp(state.fps, 1, 144)));
  updateBodyCount();

  if (state.drivingEntity) setUseLabel("EXIT");
  else if (state.nearVehicle) setUseLabel("DRIVE");
  else if (state.equipped && state.equipped.type === "weapon") setUseLabel("FIRE");
  else if (state.equipped && state.equipped.type === "physics_object") setUseLabel("DEPLOY");
  else setUseLabel("USE");
}
