// ─────────────────────────────────────────────────────────────────────────────
//  GAME LOOP
// ─────────────────────────────────────────────────────────────────────────────
function animate(now) {
  requestAnimationFrame(animate);
  if (!lastFrame) lastFrame = now;
  const rawDt = (now - lastFrame) / 1000;
  lastFrame = now;
  if (document.hidden) return;
  const dt = clamp(rawDt, 0.0005, 0.05);
  state.time += dt;
  state.fps = damp(state.fps, 1 / Math.max(0.0005, rawDt), 4, dt);

  updateWorldEffect(dt);
  world.step(1 / 60, dt, 4);
  resolveProjectileImpacts();

  updatePlayer(dt);
  updateVehicles(dt);
  updateEntities(dt);
  updateWeather(dt);
  updateEffects(dt);
  updateCamera(dt);
  updateSky(dt);
  updateHud();

  renderer.render(scene, camera);
}

function initGame() {
  initEngine();
  initGeometries();
  initEffects();
  setupUI();
  updateBodyCount();

  lastFrame = 0;
  requestAnimationFrame(animate);

  // Hide the loader only after the first real frame is on screen
  setTimeout(() => {
    dom.loading.classList.add("done");
    state.ready = true;
    window.__READY__ = true;
    document.body.dataset.ready = "1";
    setTimeout(() => { try { dom.loading.remove(); } catch { /* ignore */ } }, 950);
    setTimeout(() => toast("Forge anything with ✦ Create", "", "✦", 3200), 900);
  }, 420);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) lastFrame = 0;
    if (document.hidden) {
      keys.w = keys.a = keys.s = keys.d = false;
      resetJoystick();
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  DEBUG / AUTOMATION API (handy for testing on a phone via console)
// ─────────────────────────────────────────────────────────────────────────────
window.__GAME__ = {
  get ready() { return state.ready; },
  state, settings, input, cam, entities,
  get world() { return world; },
  get scene() { return scene; },
  get camera() { return camera; },
  get playerBody() { return playerBody; },
  createFromPrompt,
  localForge,
  applySpec,
  use: useAction,
  useAction,
  jump: requestJump,
  openPrompt,
  closePrompt,
  openSettings,
  closeSettings,
  clearCreations,
  respawnPlayer,
  spawnLocal(query) {
    const spec = localForge(query);
    applySpec(spec, query);
    return spec;
  },
  forceSpec(raw) {
    const spec = normalizeSpec(raw, "debug");
    applySpec(spec, "debug");
    return spec;
  },
  setMove(x, y) { input.moveX = clamp(x, -1, 1); input.moveY = clamp(y, -1, 1); },
  setLook(dx, dy) {
    cam.yaw -= dx;
    cam.pitch = clamp(cam.pitch + dy, -0.18, 1.18);
  },
  info() {
    return {
      entities: entities.length,
      maxBodies: MAX_BODIES,
      equipped: state.equipped ? state.equipped.name : null,
      equippedType: state.equipped ? state.equipped.type : null,
      driving: state.drivingEntity ? state.drivingEntity.spec.name : null,
      nearVehicle: state.nearVehicle ? state.nearVehicle.spec.name : null,
      gravity: world ? world.gravity.y : null,
      effect: state.effect ? state.effect.name : null,
      paused: state.paused,
      creating: state.creating,
      fps: Math.round(state.fps),
      ready: state.ready,
    };
  },
};

try {
  initGame();
} catch (err) {
  console.error("[Reality Forge] init failed", err);
  const box = document.getElementById("loadError");
  if (box) {
    box.classList.add("on");
    box.textContent = "The forge failed to start: " + (err && err.message ? err.message : "unknown error");
  }
  const sub = document.querySelector("#loading .load-sub");
  if (sub) sub.textContent = "STARTUP ERROR";
}
