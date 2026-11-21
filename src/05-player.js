// ─────────────────────────────────────────────────────────────────────────────
//  PLAYER MOVEMENT + ANIMATION
// ─────────────────────────────────────────────────────────────────────────────
const rayFrom = new CANNON.Vec3();
const rayTo = new CANNON.Vec3();
const rayResult = new CANNON.RaycastResult();

function updatePlayer(dt) {
  if (!playerBody) return;
  if (state.drivingEntity) return;

  const b = playerBody;
  rayFrom.set(b.position.x, b.position.y, b.position.z);
  rayTo.set(b.position.x, b.position.y - 0.92, b.position.z);
  rayResult.reset();
  world.raycastClosest(rayFrom, rayTo, {
    collisionFilterMask: G_GROUND | G_ENTITY | G_VEHICLE,
    skipBackfaces: true,
  }, rayResult);
  const grounded = rayResult.hasHit && rayResult.distance <= PLAYER_RADIUS + 0.19;
  state.grounded = grounded;
  state.coyote = grounded ? 0.12 : Math.max(0, state.coyote - dt);

  state.jumpBuffer = Math.max(0, state.jumpBuffer - dt);
  state.jumpCooldown = Math.max(0, state.jumpCooldown - dt);
  state.boostCooldown = Math.max(0, state.boostCooldown - dt);

  if (state.jumpBuffer > 0 && state.coyote > 0 && state.jumpCooldown <= 0) {
    b.velocity.y = 8.4;
    b.wakeUp();
    state.jumpBuffer = 0;
    state.coyote = 0;
    state.jumpCooldown = 0.22;
    state.squash = 0.14;
    state.wasGrounded = false;
    AudioFX.jump();
    buzz(8);
  }

  let mx = clamp(input.moveX + (keys.d ? 1 : 0) - (keys.a ? 1 : 0), -1, 1);
  let my = clamp(input.moveY + (keys.w ? 1 : 0) - (keys.s ? 1 : 0), -1, 1);
  if (state.paused) { mx = 0; my = 0; }
  const mag = Math.min(1, Math.hypot(mx, my));

  const forward = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const wish = forward.multiplyScalar(my).add(right.multiplyScalar(mx));
  if (wish.lengthSq() > 1) wish.normalize();

  const targetX = wish.x * PLAYER_SPEED * mag;
  const targetZ = wish.z * PLAYER_SPEED * mag;
  const accel = grounded ? (mag > 0.06 ? 17 : 26) : 4.2;
  b.velocity.x = damp(b.velocity.x, targetX, accel, dt);
  b.velocity.z = damp(b.velocity.z, targetZ, accel, dt);

  // Landing detection
  if (!grounded) state.fallSpeed = Math.min(state.fallSpeed, b.velocity.y);
  if (!state.wasGrounded && grounded) {
    if (state.fallSpeed < -6.5) {
      state.squash = 0.17;
      AudioFX.land();
      buzz(6);
    }
    state.fallSpeed = 0;
  }
  state.wasGrounded = grounded;

  // Sync the visual rig
  playerGroup.position.set(b.position.x, b.position.y - PLAYER_RADIUS, b.position.z);
  const horizSpeed = Math.hypot(b.velocity.x, b.velocity.z);
  const moving = horizSpeed > 0.35;
  let targetYaw = playerGroup.rotation.y;
  if (state.time < state.aimingUntil) targetYaw = cam.yaw;
  else if (moving) targetYaw = Math.atan2(-b.velocity.x, -b.velocity.z);
  playerGroup.rotation.y = angleDamp(playerGroup.rotation.y, targetYaw, 13, dt);

  const sf = clamp(horizSpeed / PLAYER_SPEED, 0, 1);
  state.walkPhase += dt * (3.2 + horizSpeed * 1.35);
  const swing = Math.sin(state.walkPhase * 2.1) * 0.58 * sf;
  const legL = playerVisual.userData.legL;
  const legR = playerVisual.userData.legR;
  const armL = playerVisual.userData.armL;
  const armR = playerVisual.userData.armR;
  if (legL) legL.rotation.x = damp(legL.rotation.x, swing, 16, dt);
  if (legR) legR.rotation.x = damp(legR.rotation.x, -swing, 16, dt);

  const aiming = state.equipped && state.equipped.type === "weapon";
  if (aiming) {
    if (armR) {
      armR.rotation.x = damp(armR.rotation.x, -1.38 + state.recoil * 0.18, 14, dt);
      armR.rotation.z = damp(armR.rotation.z, -0.1, 14, dt);
    }
    if (armL) {
      armL.rotation.x = damp(armL.rotation.x, -0.92, 14, dt);
      armL.rotation.z = damp(armL.rotation.z, 0.36, 14, dt);
    }
  } else {
    if (armL) {
      armL.rotation.x = damp(armL.rotation.x, -swing * 0.85, 14, dt);
      armL.rotation.z = damp(armL.rotation.z, 0.08, 14, dt);
    }
    if (armR) {
      armR.rotation.x = damp(armR.rotation.x, swing * 0.85, 14, dt);
      armR.rotation.z = damp(armR.rotation.z, -0.08, 14, dt);
    }
  }

  state.squash = damp(state.squash, 0, 9, dt);
  const bob = grounded ? Math.abs(Math.sin(state.walkPhase * 2.1)) * 0.035 * sf : 0;
  playerVisual.position.y = damp(playerVisual.position.y, bob - state.squash * 0.18, 14, dt);
  playerVisual.scale.set(1 - state.squash * 0.35, 1 + state.squash, 1 - state.squash * 0.35);

  // Weapon pop-in, recoil and idle sway
  if (weaponMount) {
    const base = weaponMount.userData.base;
    weaponMount.scale.setScalar(damp(weaponMount.scale.x, 1, 14, dt));
    state.recoil = damp(state.recoil, 0, 12, dt);
    weaponMount.position.z = base.z + state.recoil * 0.16;
    weaponMount.position.y = base.y + Math.sin(state.walkPhase * 2.1) * 0.012 * sf - state.recoil * 0.025;
    weaponMount.rotation.x = -state.recoil * 0.3;
  }

  // Contact shadow follows, fading with height
  if (blobShadow) {
    blobShadow.position.set(b.position.x, 0.06, b.position.z);
    const h = Math.max(0, b.position.y - PLAYER_RADIUS);
    const k = clamp(1 - h * 0.07, 0.45, 1);
    blobShadow.scale.setScalar(k);
    blobShadow.material.opacity = 0.17 * k;
  }

  if (b.position.y < state.deathY) respawnPlayer(true);
}

// ─────────────────────────────────────────────────────────────────────────────
//  WEAPONS
// ─────────────────────────────────────────────────────────────────────────────
function defaultProjectileVisuals(spec) {
  const color = (spec.visuals && spec.visuals[0] && spec.visuals[0].color) || "#ffd166";
  return orbVisuals(color);
}

function equipWeapon(spec) {
  state.equipped = spec;
  state.lastCreated = spec;
  state.cooldownTotal = Math.max(0.15, spec.action_behavior.cooldown || 0.4);
  state.nextFire = state.time + 0.12;
  if (!weaponMount) return;
  weaponMount.clear();
  const group = new THREE.Group();
  const built = buildVisualsGroup(spec.visuals, group, true);
  const maxDim = Math.max(built.size.x, built.size.y, built.size.z);
  let s = 1;
  if (maxDim > 1.32) s = 1.32 / maxDim;
  else if (maxDim < 0.52) s = Math.min(2.1, 0.52 / Math.max(0.08, maxDim));
  group.scale.setScalar(s);
  group.rotation.y = 0.035;
  weaponMount.add(group);
  heldGroup = group;
  weaponMount.scale.setScalar(0.35);
  setItemCard(spec, "FIRE · " + String(spec.action_behavior.projectile || "PROJECTILE").toUpperCase());
  setUseLabel("FIRE");
  setUseBadge(null);
  dom.reticle.classList.add("on");
  AudioFX.forge();
}

function clearWeapon() {
  if (weaponMount) weaponMount.clear();
  heldGroup = null;
  state.equipped = null;
  dom.reticle.classList.remove("on");
  setUseLabel("USE");
  hideItemCard();
}

function fireWeapon(spec) {
  if (!spec || state.time < state.nextFire) return;
  const action = spec.action_behavior;
  state.cooldownTotal = Math.max(0.12, action.cooldown);
  state.nextFire = state.time + state.cooldownTotal;
  state.aimingUntil = state.time + 1.15;
  state.recoil = 1;
  AudioFX.shoot();
  buzz(9);

  const origin = new THREE.Vector3(playerBody.position.x, playerBody.position.y + 0.92, playerBody.position.z);
  const dir = new THREE.Vector3(
    -Math.sin(cam.yaw),
    clamp(0.16 - cam.pitch * 0.55, -0.45, 0.3),
    -Math.cos(cam.yaw)
  ).normalize();
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  origin.addScaledVector(right, 0.32).addScaledVector(dir, 0.7);

  const visuals = spec.projectile_visuals && spec.projectile_visuals.length
    ? spec.projectile_visuals
    : defaultProjectileVisuals(spec);

  const count = clamp(Math.round(action.spawnCount || 1), 1, 4);
  for (let i = 0; i < count; i++) {
    const spread = action.spread || 0;
    const d = dir.clone().add(new THREE.Vector3(
      rand(-spread, spread), rand(-spread, spread), rand(-spread, spread)
    )).normalize();
    spawnEntity(spec, {
      position: origin.clone().add(new THREE.Vector3(rand(-0.06, 0.06), rand(-0.06, 0.06), rand(-0.06, 0.06))),
      velocity: d.multiplyScalar(action.speed || 40),
      isProjectile: true,
      visuals,
      action,
      life: 8,
      scale: action.projectileScale || 1,
      onImpact: action.onImpact,
    });
  }

  const muzzle = origin.clone().addScaledVector(dir, 0.35);
  muzzleFlash(muzzle, "#ffe0a0");
  spawnBurst(muzzle, "#ffe0a0", 0.7, 10);
  dom.reticle.classList.remove("pulse");
  void dom.reticle.offsetWidth;
  dom.reticle.classList.add("pulse");
  dom.useBtn.classList.remove("ready");
}

// ─────────────────────────────────────────────────────────────────────────────
//  OBJECT DEPLOYMENT + TOWERS
// ─────────────────────────────────────────────────────────────────────────────
function spawnPhysicsObject(spec) {
  const forward = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const base = new THREE.Vector3(
    playerBody.position.x + forward.x * 5.0,
    0,
    playerBody.position.z + forward.z * 5.0
  );
  if (spec.structure === "tower") {
    spawnTower(spec, base);
    return null;
  }
  const size = measureVisuals(spec.visuals);
  const y = Math.max(size.y / 2 + 0.14, 0.32);
  const velocity = forward.clone().multiplyScalar(spec.physics.bouncy ? 2.4 : 0.35);
  return spawnEntity(spec, {
    position: new THREE.Vector3(base.x, y, base.z),
    yaw: cam.yaw + rand(-0.16, 0.16),
    velocity,
  });
}

function spawnTower(spec, base) {
  const count = clamp(spec.structureCount || 8, 2, 12);
  const size = measureVisuals(spec.visuals);
  const blockH = Math.max(0.3, size.y * 1.015);
  const palette = ["#ffd166", "#ff8a4c", "#7dd3fc", "#6ee7c8", "#c084fc", "#ff5c8a"];
  for (let i = 0; i < count; i++) {
    const blockSpec = {
      ...spec,
      visuals: spec.visuals.map((v) => ({ ...v })),
      physics: { ...spec.physics },
      action_behavior: { ...spec.action_behavior },
      structure: null,
    };
    blockSpec.visuals[0].color = palette[i % palette.length];
    if (blockSpec.visuals[1]) blockSpec.visuals[1].emissive = palette[i % palette.length];
    spawnEntity(blockSpec, {
      position: new THREE.Vector3(
        base.x + Math.sin(i * 0.8) * 0.045,
        blockH / 2 + i * blockH * 1.005,
        base.z + Math.cos(i * 0.7) * 0.045
      ),
      yaw: (i % 2 ? 1 : -1) * 0.055,
      silent: i > 0,
    });
  }
  spawnShockwave(base, 3.4, "#ffd166", 0.6);
  spawnBurst(new THREE.Vector3(base.x, 0.4, base.z), "#ffd166", 2.4, 26);
  AudioFX.forge();
}

function deployObject(spec) {
  if (state.time < state.nextFire) return;
  const action = spec.action_behavior;
  state.cooldownTotal = Math.max(0.3, action.cooldown || 1);
  state.nextFire = state.time + state.cooldownTotal;
  spawnPhysicsObject(spec);
  AudioFX.forge();
  buzz(10);
}

function deployVehicle(spec) {
  if (state.time < state.nextFire) return;
  state.nextFire = state.time + 2.2;
  const forward = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const base = new THREE.Vector3(
    playerBody.position.x + forward.x * 5.5,
    0,
    playerBody.position.z + forward.z * 5.5
  );
  const ent = spawnVehicle(spec, base, cam.yaw);
  setTimeout(() => {
    if (!ent.dead && !state.drivingEntity && !state.paused) enterVehicle(ent);
  }, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
//  USE / FIRE / KICK
// ─────────────────────────────────────────────────────────────────────────────
function kickNearby() {
  const origin = new THREE.Vector3(playerBody.position.x, playerBody.position.y + 0.55, playerBody.position.z);
  const dir = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  let best = null;
  let bestScore = -Infinity;
  for (const ent of entities) {
    if (ent.dead) continue;
    const dx = ent.body.position.x - origin.x;
    const dy = ent.body.position.y - origin.y;
    const dz = ent.body.position.z - origin.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > 5.2 || dist < 0.01) continue;
    const dot = (dx * dir.x + dz * dir.z) / Math.max(0.001, Math.hypot(dx, dz));
    if (dot < 0.1) continue;
    const score = dot * 2 - dist * 0.12;
    if (score > bestScore) { bestScore = score; best = ent; }
  }
  if (best) {
    const strength = Math.min(46, 8 + best.body.mass * 2.2);
    best.body.wakeUp();
    best.body.applyImpulse(new CANNON.Vec3(dir.x * strength, strength * 0.5, dir.z * strength));
    spawnBurst(new THREE.Vector3(best.body.position.x, best.body.position.y, best.body.position.z), "#ffffff", 0.7, 12);
    AudioFX.land();
    buzz(10);
  } else {
    toast("Nothing to use — tap ✦ Create", "", "✦", 1700);
    AudioFX.ui();
  }
}

function useAction() {
  if (!state.ready || state.paused) return;
  AudioFX.init();
  if (state.drivingEntity) { exitVehicle(); return; }
  if (state.nearVehicle) { enterVehicle(state.nearVehicle); return; }
  const spec = state.equipped;
  if (!spec) { kickNearby(); return; }
  if (spec.type === "weapon") fireWeapon(spec);
  else if (spec.type === "physics_object") deployObject(spec);
  else if (spec.type === "vehicle") deployVehicle(spec);
  else if (spec.type === "world_event") applyWorldEffect(spec);
}

function requestJump() {
  AudioFX.init();
  if (state.drivingEntity) {
    const v = state.drivingEntity.vehicle;
    if (v && state.boostCooldown <= 0) {
      v.boost = 1;
      state.boostCooldown = 1.5;
      AudioFX.boost();
      buzz(20);
      cam.shake = Math.min(0.5, cam.shake + 0.18);
    }
    return;
  }
  if (state.paused) return;
  state.jumpBuffer = 0.17;
}

// ─────────────────────────────────────────────────────────────────────────────
//  CREATE FLOW (AI or local forge -> world)
// ─────────────────────────────────────────────────────────────────────────────
async function createFromPrompt(prompt) {
  prompt = String(prompt || "").trim();
  if (!prompt) { toast("Type something first", "warn", "✍️", 1600); return; }
  if (state.creating) { toast("Still materializing…", "warn", "⏳", 1500); return; }
  state.lastPrompt = prompt;
  state.creating = true;
  hideHint();
  setMaterializing(true);
  AudioFX.init();
  AudioFX.materialize();
  const started = performance.now();
  let spec = null;
  let usedAI = false;
  let aiError = null;
  try {
    if ((settings.key || "").trim()) {
      usedAI = true;
      spec = await requestAICreation(prompt);
    } else {
      spec = localForge(prompt);
    }
  } catch (err) {
    aiError = err;
    console.warn("[Reality Forge] AI request failed; using local forge.", err);
  }
  const elapsed = performance.now() - started;
  if (elapsed < 560) await wait(560 - elapsed);
  if (!spec) {
    spec = localForge(prompt);
    if (usedAI) toast("AI hiccup — local forge took over", "warn", "⚡", 3200);
  }
  if (spec) {
    applySpec(spec, prompt);
    if (!usedAI && state.firstCreation) {
      state.firstCreation = false;
      setTimeout(() => toast("Local forge mode — add a key for anything", "", "🔑", 3000), 700);
    }
  }
  if (aiError && !spec) toast("Forge failed — try again", "warn", "⚠️", 2600);
  state.creating = false;
  setMaterializing(false);
}

function applySpec(spec, prompt) {
  if (!spec) return;
  state.lastCreated = spec;
  hideHint();
  const forward = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const base = new THREE.Vector3(
    playerBody.position.x + forward.x * 5.5,
    0,
    playerBody.position.z + forward.z * 5.5
  );

  if (spec.type === "weapon") {
    equipWeapon(spec);
    toast("Forged " + spec.name, "good", "✦", 2400);
  } else if (spec.type === "vehicle") {
    state.equipped = spec;
    state.nextFire = state.time + 2.2;
    const ent = spawnVehicle(spec, base, cam.yaw);
    setItemCard(spec, "TAP USE TO DRIVE");
    setUseLabel("DRIVE");
    dom.reticle.classList.remove("on");
    toast("Forged " + spec.name, "good", "🚙", 2200);
    setTimeout(() => {
      if (!ent.dead && !state.drivingEntity && !state.paused) enterVehicle(ent);
    }, 700);
  } else if (spec.type === "physics_object") {
    state.equipped = spec;
    state.nextFire = state.time + 0.9;
    state.cooldownTotal = Math.max(0.4, spec.action_behavior.cooldown || 1);
    spawnPhysicsObject(spec);
    setItemCard(spec, "DEPLOY");
    setUseLabel("DEPLOY");
    dom.reticle.classList.remove("on");
    toast("Forged " + spec.name, "good", "🧱", 2200);
  } else {
    applyWorldEffect(spec);
  }
  updateBodyCount();
}

function respawnPlayer(silent = false) {
  if (state.drivingEntity) exitVehicle(true);
  playerBody.collisionResponse = true;
  playerBody.wakeUp();
  playerBody.position.set(0, 1.2, 0);
  playerBody.velocity.setZero();
  playerBody.angularVelocity.setZero();
  playerGroup.visible = true;
  playerGroup.position.set(0, 0.75, 0);
  playerGroup.rotation.y = 0;
  blobShadow.visible = true;
  state.fallSpeed = 0;
  state.jumpBuffer = 0;
  state.wasGrounded = false;
  cam.target.set(0, 1.35, 0);
  snapCamera();
  if (!silent) toast("Back at the forge", "", "✦", 1600);
}

function clearCreations() {
  if (state.drivingEntity) exitVehicle(true);
  [...entities].forEach((ent) => despawnEntity(ent));
  clearWeapon();
  state.equipped = null;
  state.nextFire = 0;
  state.effect = null;
  state.gravityTarget = 1;
  stopWeather();
  setSkyDefault();
  hideEffectChip();
  hideItemCard();
  setUseLabel("USE");
  updateBodyCount();
  toast("World cleared", "", "🧹", 1800);
}
