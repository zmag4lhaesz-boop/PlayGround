// ─────────────────────────────────────────────────────────────────────────────
//  SHARED PRIMITIVES + ENTITY POOL
//  A live entity is one Three.Group + one cannon body. When it dies the group
//  goes back to a pool; geometries and materials are shared and cached.
// ─────────────────────────────────────────────────────────────────────────────
function initGeometries() {
  GEO.box = new THREE.BoxGeometry(1, 1, 1);
  GEO.sphere = new THREE.SphereGeometry(0.5, 18, 12);
  GEO.cylinder = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
  GEO.cone = new THREE.ConeGeometry(0.5, 1, 16);
  GEO.torus = new THREE.TorusGeometry(0.5, 0.12, 8, 20);
}

function buildVisualsGroup(visuals, group, center = true) {
  group.clear();
  for (const v of visuals) {
    const mesh = new THREE.Mesh(GEO[v.shape] || GEO.box, visualMaterial(v));
    mesh.position.set(v.position[0], v.position[1], v.position[2]);
    mesh.rotation.set(deg(v.rotation[0]), deg(v.rotation[1]), deg(v.rotation[2]));
    mesh.scale.set(v.scale[0], v.scale[1], v.scale[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.tag = v.tag || null;
    group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.5, -0.5, -0.5), new THREE.Vector3(0.5, 0.5, 0.5));
  const centerVec = box.getCenter(new THREE.Vector3());
  if (center) {
    for (const child of group.children) child.position.sub(centerVec);
    group.updateMatrixWorld(true);
  }
  const size = box.getSize(new THREE.Vector3());
  size.set(Math.max(0.2, size.x), Math.max(0.2, size.y), Math.max(0.2, size.z));
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.setScalar(1);
  return { size, center: centerVec };
}

function measureVisuals(visuals) {
  const temp = new THREE.Group();
  const built = buildVisualsGroup(visuals, temp, true);
  temp.clear();
  return built.size;
}

function updateBodyCount() {
  if (dom.bodyCount) dom.bodyCount.textContent = String(entities.length);
  if (dom.stats) {
    dom.stats.style.borderColor = entities.length >= MAX_BODIES ? "rgba(255,140,90,.55)" : "";
    dom.stats.style.background = entities.length >= MAX_BODIES ? "rgba(70,30,12,.45)" : "";
  }
}

function recycleOldest() {
  const candidates = entities
    .filter((e) => !e.dead && e !== state.drivingEntity && !e.protected && state.time - e.born > 0.9)
    .sort((a, b) => a.born - b.born);
  let target = candidates[0];
  if (!target) target = entities.find((e) => !e.dead && e !== state.drivingEntity);
  if (!target) return false;
  despawnEntity(target);
  if (state.time - state.lastRecycleToast > 2.6) {
    state.lastRecycleToast = state.time;
    toast("Body limit reached — recycled oldest creation", "warn", "♻️", 1800);
  }
  return true;
}

function spawnEntity(spec, opts = {}) {
  if (entities.length >= MAX_BODIES) recycleOldest();
  const isProjectile = !!opts.isProjectile;
  const position = opts.position || new THREE.Vector3(0, 1, 0);
  const group = entityPool.pop() || new THREE.Group();
  group.visible = true;
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.scale.setScalar(1);

  const visuals = opts.visuals || spec.visuals;
  const built = buildVisualsGroup(visuals, group, true);
  let scale = Number(opts.scale ?? 1);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  scale = clamp(scale, 0.1, 3.5);
  const size = built.size.clone().multiplyScalar(scale);
  group.scale.setScalar(isProjectile ? scale : scale * 0.01);
  group.position.copy(position);

  const action = opts.action || spec.action_behavior;
  const quat = new THREE.Quaternion();
  if (opts.quaternion) quat.copy(opts.quaternion);
  else if (typeof opts.yaw === "number") quat.setFromAxisAngle(UP, opts.yaw);

  group.quaternion.copy(quat);
  scene.add(group);

  const bouncy = spec.physics.bouncy || action.onImpact === "bounce";
  const mass = isProjectile ? Math.max(0.08, action.projectileMass || 0.5) : Math.max(0.05, spec.physics.mass);
  const body = new CANNON.Body({
    mass,
    material: bouncy ? matBouncy : spec.type === "vehicle" ? matVehicle : matEntity,
    linearDamping: isProjectile ? 0.01 : spec.physics.linearDamping,
    angularDamping: isProjectile ? 0.05 : spec.physics.angularDamping,
    fixedRotation: spec.type === "vehicle",
    allowSleep: !isProjectile,
  });

  const maxDim = Math.max(size.x, size.y, size.z);
  if (isProjectile) {
    body.addShape(new CANNON.Sphere(clamp(maxDim * 0.33, 0.16, 0.9)));
  } else if (spec.physics.collider === "sphere") {
    body.addShape(new CANNON.Sphere(clamp(maxDim * 0.5, 0.12, 3.2)));
  } else {
    body.addShape(new CANNON.Box(new CANNON.Vec3(
      Math.max(0.05, size.x / 2), Math.max(0.05, size.y / 2), Math.max(0.05, size.z / 2)
    )));
  }

  body.position.set(position.x, position.y, position.z);
  body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
  body.collisionFilterGroup = isProjectile ? G_PROJECTILE : (spec.type === "vehicle" ? G_VEHICLE : G_ENTITY);
  body.collisionFilterMask = isProjectile
    ? (G_GROUND | G_ENTITY | G_VEHICLE)
    : (G_GROUND | G_PLAYER | G_ENTITY | G_PROJECTILE | G_VEHICLE);
  if (opts.velocity) body.velocity.set(opts.velocity.x, opts.velocity.y, opts.velocity.z);
  if (isProjectile) {
    body.angularVelocity.set(rand(-2, 2), rand(-2, 2), rand(-2, 2));
  }
  world.addBody(body);

  const ent = {
    id: nextEntityId++,
    spec, group, body, size,
    isProjectile, isWeather: !!opts.isWeather,
    action, onImpact: opts.onImpact || action.onImpact || "none",
    life: opts.life ?? (isProjectile ? 7 : Infinity),
    age: 0, born: state.time, dead: false, impacted: false,
    baseScale: scale, spawnT: isProjectile ? 1 : 0,
    protected: !!opts.protected,
    tag: opts.tag || "",
    vehicle: null,
  };
  body.entity = ent;

  if (spec.type === "vehicle") {
    ent.vehicle = {
      yaw: typeof opts.yaw === "number" ? opts.yaw : 0,
      speed: 0,
      maxSpeed: action.maxSpeed,
      acceleration: action.acceleration,
      turnSpeed: action.turnSpeed,
      boost: 0,
      boostReady: 0,
    };
    ent.protected = true;
    setTimeout(() => { if (!ent.dead) ent.protected = false; }, 7000);
  }

  if (isProjectile) {
    body.addEventListener("collide", (event) => {
      if (ent.dead || ent.impacted) return;
      if (ent.age < 0.06) return;
      let impact = 4;
      try { impact = Math.abs(event.contact.getImpactVelocityAlongNormal()); } catch { /* older contact */ }
      if (impact < 1.1) return;
      // NEVER remove a body inside a cannon collision callback — it corrupts
      // the narrowphase. Queue the impact and resolve it after world.step().
      ent.impacted = true;
      pendingImpacts.push({ ent, impact });
    });
  }

  entities.push(ent);
  updateBodyCount();
  if (!isProjectile && !opts.silent) materializeAt(position, scale);
  return ent;
}

function despawnEntity(ent) {
  if (!ent || ent.dead) return;
  ent.dead = true;
  if (ent === state.drivingEntity) exitVehicle(true);
  if (ent === state.nearVehicle) state.nearVehicle = null;
  try { world.removeBody(ent.body); } catch { /* already removed */ }
  scene.remove(ent.group);
  ent.group.clear();
  ent.group.visible = false;
  if (entityPool.length < 90) entityPool.push(ent.group);
  const idx = entities.indexOf(ent);
  if (idx >= 0) entities.splice(idx, 1);
  updateBodyCount();
}

function resolveProjectileImpacts() {
  while (pendingImpacts.length) {
    const item = pendingImpacts.shift();
    if (!item.ent.dead) resolveProjectileImpact(item.ent, item.impact);
  }
}

function resolveProjectileImpact(ent, impact) {
  if (ent.dead) return;
  const p = ent.body.position;
  const pos = new THREE.Vector3(p.x, p.y, p.z);
  const action = ent.action;
  if (ent.onImpact === "explode") {
    const firstMat = ent.group.children[0] && ent.group.children[0].material;
    const color = firstMat && firstMat.color ? "#" + firstMat.color.getHexString() : "#ff9a52";
    despawnEntity(ent);
    explodeAt(pos, action.explosionRadius || 4, action.explosionForce || 12, color);
  } else if (ent.onImpact === "bounce") {
    AudioFX.bounce();
    ent.body.velocity.y = Math.max(ent.body.velocity.y, 4.5);
  } else if (ent.onImpact === "stick") {
    ent.body.velocity.setZero();
    ent.body.angularVelocity.setZero();
    ent.body.mass = 0;
    ent.body.type = CANNON.Body.STATIC;
    ent.body.updateMassProperties();
    AudioFX.land();
    ent.life = Math.min(ent.life, 8);
  } else if (ent.onImpact === "none" && impact > 30) {
    despawnEntity(ent);
  }
}

function updateEntities(dt) {
  for (let i = entities.length - 1; i >= 0; i--) {
    const ent = entities[i];
    if (ent.dead) continue;
    ent.age += dt;
    const b = ent.body;

    // Per-entity gravity scale (cannon-es has no native gravityScale)
    const gs = ent.isProjectile ? ent.action.gravityScale : ent.spec.physics.gravityScale;
    if (gs !== undefined && gs !== 1) {
      b.force.y += b.mass * world.gravity.y * (gs - 1);
    }

    // Remove anything that fell off the world
    if (b.position.y < -14) {
      despawnEntity(ent);
      continue;
    }

    ent.group.position.set(b.position.x, b.position.y, b.position.z);
    ent.group.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);

    if (ent.isProjectile) {
      const v = b.velocity;
      if (v.lengthSquared() > 1.2) {
        const dir = new THREE.Vector3(v.x, v.y, v.z).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(FORWARD, dir);
        ent.group.quaternion.slerp(q, 1 - Math.exp(-18 * dt));
      }
      ent.life -= dt;
      if (ent.life <= 0) {
        despawnEntity(ent);
        continue;
      }
    } else if (ent.spawnT < 1) {
      ent.spawnT = Math.min(1, ent.spawnT + dt * 4.5);
      const t = ent.spawnT;
      const ease = 1 - Math.pow(1 - t, 3);
      const overshoot = 1 + Math.sin(t * Math.PI) * 0.12;
      ent.group.scale.setScalar(ent.baseScale * ease * overshoot);
    }

    if (ent.vehicle && ent !== state.drivingEntity) {
      // Parked vehicles stay upright and settle quickly
      b.angularVelocity.setZero();
      const q = new THREE.Quaternion().setFromAxisAngle(UP, ent.vehicle.yaw);
      b.quaternion.set(q.x, q.y, q.z, q.w);
      b.velocity.x = damp(b.velocity.x, 0, 1.8, dt);
      b.velocity.z = damp(b.velocity.z, 0, 1.8, dt);
      ent.vehicle.speed = damp(ent.vehicle.speed, 0, 2.2, dt);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPLOSIONS + PARTICLES
// ─────────────────────────────────────────────────────────────────────────────
let bursts = [];
let shockwaves = [];
let flashes = [];
let scorches = [];

function initEffects() {
  for (let i = 0; i < 5; i++) {
    const count = 64;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    const mat = new THREE.PointsMaterial({
      size: 0.6, map: glowTexture, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffb36b,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.visible = false;
    scene.add(pts);
    bursts.push({ pts, vel: new Float32Array(count * 3), life: 0, maxLife: 0.9, count });
  }
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb36b, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 48), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.renderOrder = 3;
    scene.add(ring);
    shockwaves.push({ mesh: ring, life: 0, maxLife: 0.55, radius: 4 });
  }
  for (let i = 0; i < 6; i++) {
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: 0xffe0a0, transparent: true, opacity: 1,
      depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    sprite.visible = false;
    scene.add(sprite);
    flashes.push({ sprite, life: 0, maxLife: 0.09 });
  }
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x1c281d, transparent: true, opacity: 0.2, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    });
    const scorch = new THREE.Mesh(new THREE.CircleGeometry(1, 28), mat);
    scorch.rotation.x = -Math.PI / 2;
    scorch.visible = false;
    scorch.renderOrder = 1;
    scene.add(scorch);
    scorches.push({ mesh: scorch, life: 0, maxLife: 8 });
  }
}

function spawnBurst(pos, color = "#ffb36b", radius = 3, count = 64) {
  let b = bursts.find((x) => x.life <= 0);
  if (!b) b = bursts.reduce((a, c) => (c.life < a.life ? c : a), bursts[0]);
  const arr = b.pts.geometry.attributes.position.array;
  b.count = Math.min(count, arr.length / 3);
  b.vel.fill(0);
  const speed = 2.2 + radius * 1.15;
  for (let i = 0; i < b.count; i++) {
    arr[i * 3] = pos.x + rand(-0.15, 0.15);
    arr[i * 3 + 1] = pos.y + rand(-0.15, 0.15);
    arr[i * 3 + 2] = pos.z + rand(-0.15, 0.15);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(rand(-1, 1));
    const sp = speed * (0.35 + Math.random() * 0.85);
    b.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * sp;
    b.vel[i * 3 + 1] = Math.cos(phi) * sp * 0.75 + rand(0.5, 2.5);
    b.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * sp;
  }
  for (let i = b.count; i < arr.length / 3; i++) {
    arr[i * 3] = pos.x; arr[i * 3 + 1] = -999; arr[i * 3 + 2] = pos.z;
  }
  b.pts.geometry.attributes.position.needsUpdate = true;
  b.pts.material.color.set(color);
  b.pts.material.size = clamp(radius * 0.14, 0.32, 0.9);
  b.pts.material.opacity = 1;
  b.pts.visible = true;
  b.life = 0.95;
  b.maxLife = 0.95;
}

function spawnShockwave(pos, radius, color = "#ffb36b", life = 0.55) {
  let w = shockwaves.find((x) => x.life <= 0);
  if (!w) w = shockwaves.reduce((a, c) => (c.life < a.life ? c : a), shockwaves[0]);
  w.mesh.position.set(pos.x, Math.max(0.08, pos.y + 0.04), pos.z);
  w.mesh.scale.setScalar(0.5);
  w.mesh.material.color.set(color);
  w.mesh.material.opacity = 0.85;
  w.mesh.visible = true;
  w.life = life; w.maxLife = life; w.radius = radius;
}

function muzzleFlash(pos, color = "#ffe0a0") {
  let f = flashes.find((x) => x.life <= 0);
  if (!f) f = flashes[0];
  f.sprite.position.copy(pos);
  f.sprite.material.color.set(color);
  f.sprite.material.opacity = 1;
  f.sprite.scale.setScalar(rand(0.65, 0.95));
  f.sprite.visible = true;
  f.life = 0.09; f.maxLife = 0.09;
}

function addScorch(pos, radius) {
  let s = scorches.find((x) => x.life <= 0);
  if (!s) s = scorches.reduce((a, c) => (c.life < a.life ? c : a), scorches[0]);
  s.mesh.position.set(pos.x, 0.065, pos.z);
  s.mesh.scale.setScalar(radius * 0.72);
  s.mesh.material.opacity = 0.22;
  s.mesh.visible = true;
  s.life = 8; s.maxLife = 8;
}

function materializeAt(pos, scale = 1) {
  spawnShockwave(pos, 1.6 * scale, "#6ee7c8", 0.45);
  spawnBurst(pos, "#6ee7c8", 1.2, 18);
}

function explodeAt(pos, radius = 4, force = 12, color = "#ffb36b") {
  const p = new THREE.Vector3(pos.x, pos.y, pos.z);
  // Push every dynamic body, including the player
  for (const ent of entities) {
    if (ent.dead) continue;
    const b = ent.body;
    const dx = b.position.x - p.x, dy = b.position.y - p.y, dz = b.position.z - p.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > radius || dist < 0.001) continue;
    const falloff = 1 - dist / radius;
    const inv = 1 / dist;
    const strength = force * falloff * b.mass * 0.62;
    b.wakeUp();
    b.applyImpulse(new CANNON.Vec3(
      dx * inv * strength,
      (dy * inv + 0.62) * strength,
      dz * inv * strength
    ));
  }
  if (state.drivingEntity === null) {
    const b = playerBody;
    const dx = b.position.x - p.x, dy = b.position.y - p.y, dz = b.position.z - p.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < radius && dist > 0.001) {
      const falloff = 1 - dist / radius;
      const inv = 1 / dist;
      const strength = force * falloff * b.mass * 0.5;
      b.wakeUp();
      b.velocity.x += dx * inv * strength / b.mass;
      b.velocity.y += Math.max(0.4, dy * inv + 0.7) * strength / b.mass;
      b.velocity.z += dz * inv * strength / b.mass;
      state.jumpBuffer = 0;
      state.fallSpeed = 0;
    }
  }
  spawnBurst(p, color, radius, 64);
  spawnShockwave(p, radius * 1.15, color, 0.6);
  if (p.y < 2.2) addScorch(p, radius);
  const camDist = camera.position.distanceTo(p);
  cam.shake = Math.min(1.4, cam.shake + clamp(radius / Math.max(1, camDist), 0, 1.1) * 0.75);
  AudioFX.explosion();
  buzz(35);
}

function updateEffects(dt) {
  for (const b of bursts) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.life <= 0) { b.pts.visible = false; continue; }
    const arr = b.pts.geometry.attributes.position.array;
    for (let i = 0; i < b.count; i++) {
      b.vel[i * 3 + 1] -= 9.5 * dt;
      b.vel[i * 3] *= 1 - 1.8 * dt;
      b.vel[i * 3 + 1] *= 1 - 0.4 * dt;
      b.vel[i * 3 + 2] *= 1 - 1.8 * dt;
      arr[i * 3] += b.vel[i * 3] * dt;
      arr[i * 3 + 1] += b.vel[i * 3 + 1] * dt;
      arr[i * 3 + 2] += b.vel[i * 3 + 2] * dt;
    }
    b.pts.geometry.attributes.position.needsUpdate = true;
    b.pts.material.opacity = Math.pow(clamp(b.life / b.maxLife, 0, 1), 1.4);
  }
  for (const w of shockwaves) {
    if (w.life <= 0) continue;
    w.life -= dt;
    if (w.life <= 0) { w.mesh.visible = false; continue; }
    const t = 1 - w.life / w.maxLife;
    w.mesh.scale.setScalar(lerp(0.55, w.radius, 1 - Math.pow(1 - t, 2)));
    w.mesh.material.opacity = (1 - t) * 0.85;
  }
  for (const f of flashes) {
    if (f.life <= 0) continue;
    f.life -= dt;
    if (f.life <= 0) { f.sprite.visible = false; continue; }
    f.sprite.material.opacity = f.life / f.maxLife;
  }
  for (const s of scorches) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.mesh.visible = false; continue; }
    s.mesh.material.opacity = 0.22 * (s.life / s.maxLife);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  SKY / WORLD EFFECTS / WEATHER
// ─────────────────────────────────────────────────────────────────────────────
function setSkyDefault() {
  skyTarget.top.set("#1d6cbe");
  skyTarget.horizon.set("#bcdaf2");
  skyTarget.fog.set("#a8c8df");
  skyTarget.sun = 1.85;
  skyTarget.hemi = 0.85;
}
function setSkyTo(hex, mode = "normal") {
  const top = new THREE.Color(hex);
  if (mode === "dark") top.multiplyScalar(0.62);
  skyTarget.top.copy(top);
  skyTarget.horizon.copy(top).lerp(new THREE.Color("#ffffff"), 0.62);
  skyTarget.fog.copy(skyTarget.horizon).lerp(new THREE.Color("#dfe9e0"), 0.25);
  skyTarget.sun = mode === "dark" ? 0.8 : mode === "rain" ? 1.2 : 1.85;
  skyTarget.hemi = mode === "dark" ? 0.7 : mode === "rain" ? 0.8 : 0.85;
}
function updateSky(dt) {
  if (!skyUniforms) return;
  const k = 1 - Math.exp(-2.2 * dt);
  skyUniforms.topColor.value.lerp(skyTarget.top, k);
  skyUniforms.horizonColor.value.lerp(skyTarget.horizon, k);
  if (scene.fog) scene.fog.color.lerp(skyTarget.fog, k);
  if (sunLight) sunLight.intensity = damp(sunLight.intensity, skyTarget.sun, 2.5, dt);
  if (hemiLight) hemiLight.intensity = damp(hemiLight.intensity, skyTarget.hemi, 2.5, dt);

  // Follow the player with the shadow frustum
  if (sunLight && playerBody) {
    sunLight.position.set(playerBody.position.x + 30, 42, playerBody.position.z - 32);
    sunLight.target.position.set(playerBody.position.x, 0, playerBody.position.z);
    sunLight.target.updateMatrixWorld();
  }
  if (scene.userData.clouds) scene.userData.clouds.rotation.y += dt * 0.0035;
  if (scene.userData.dust) scene.userData.dust.rotation.y += dt * 0.004;
}

function startWeather(kind, spec, duration) {
  stopWeather();
  const action = spec.action_behavior;
  if (kind === "rain") {
    createRain();
    state.weather = { kind: "rain", until: state.time + duration, spec, action };
  } else if (kind === "meteor") {
    state.weather = {
      kind: "meteor",
      until: state.time + duration,
      rate: spec.world_effect.weatherRate || 2,
      spawnTimer: 0.4,
      spec,
      action,
      visuals: spec.projectile_visuals && spec.projectile_visuals.length ? spec.projectile_visuals : fireballVisuals(),
    };
  }
}
function stopWeather() {
  if (rainSystem) {
    scene.remove(rainSystem.points);
    rainSystem.points.geometry.dispose();
    rainSystem.points.material.dispose();
    rainSystem = null;
  }
  state.weather = null;
}
function createRain() {
  const count = window.innerWidth < 700 ? 420 : 620;
  const positions = new Float32Array(count * 3);
  const speeds = new Float32Array(count);
  const px = playerBody ? playerBody.position.x : 0;
  const pz = playerBody ? playerBody.position.z : 0;
  for (let i = 0; i < count; i++) {
    positions[i * 3] = px + rand(-30, 30);
    positions[i * 3 + 1] = rand(0, 26);
    positions[i * 3 + 2] = pz + rand(-30, 30);
    speeds[i] = rand(18, 30);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xcfeaff, size: 0.085, transparent: true, opacity: 0.72,
    depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);
  rainSystem = { points, positions, speeds, count, geo };
}
function spawnMeteor() {
  if (!state.weather || state.weather.kind !== "meteor") return;
  const active = entities.filter((e) => e.isWeather && !e.dead).length;
  if (active >= 7) return;
  const px = playerBody.position.x, pz = playerBody.position.z;
  const angle = Math.random() * Math.PI * 2;
  const radius = rand(4, 17);
  const pos = new THREE.Vector3(px + Math.cos(angle) * radius, rand(22, 28), pz + Math.sin(angle) * radius);
  const velocity = new THREE.Vector3(rand(-2.5, 2.5), rand(-13, -8), rand(-2.5, 2.5));
  const spec = state.weather.spec;
  spawnEntity(spec, {
    position: pos,
    velocity,
    isProjectile: true,
    isWeather: true,
    visuals: state.weather.visuals,
    action: state.weather.action,
    life: 14,
    scale: rand(1.0, 1.4),
    onImpact: "explode",
  });
}
function updateWeather(dt) {
  if (!state.weather) return;
  if (state.time > state.weather.until) { stopWeather(); return; }
  if (state.weather.kind === "rain" && rainSystem) {
    const { positions, speeds, count, geo } = rainSystem;
    const px = playerBody.position.x, pz = playerBody.position.z;
    for (let i = 0; i < count; i++) {
      positions[i * 3 + 1] -= speeds[i] * dt;
      positions[i * 3] += dt * 1.2;
      if (positions[i * 3 + 1] < 0.1) {
        positions[i * 3] = px + rand(-30, 30);
        positions[i * 3 + 1] = rand(20, 30);
        positions[i * 3 + 2] = pz + rand(-30, 30);
      }
    }
    geo.attributes.position.needsUpdate = true;
  } else if (state.weather.kind === "meteor") {
    state.weather.spawnTimer -= dt;
    if (state.weather.spawnTimer <= 0) {
      spawnMeteor();
      state.weather.spawnTimer = 1 / Math.max(0.2, state.weather.rate);
    }
  }
}

function applyWorldEffect(spec) {
  const eff = spec.world_effect;
  state.gravityTarget = clamp(eff.gravity, 0, 2.5);
  const duration = clamp(eff.duration, 5, 60);
  let icon = "✨";
  if (eff.weather === "rain") icon = "🌧️";
  else if (eff.weather === "meteor") icon = "☄️";
  else if (eff.gravity < 0.65) icon = "🌙";
  state.effect = { name: spec.name, icon, until: state.time + duration, duration, spec };

  if (eff.weather === "rain" || eff.weather === "meteor") {
    startWeather(eff.weather, spec, duration);
  } else {
    stopWeather();
  }

  let sky = eff.skyColor;
  let mode = "normal";
  if (eff.weather === "rain") { sky = sky || "#74879b"; mode = "rain"; }
  else if (eff.weather === "meteor") { sky = sky || "#ff9a6b"; mode = "warm"; }
  else if (eff.gravity < 0.65) { sky = sky || "#6ea8ff"; mode = "normal"; }
  if (sky) setSkyTo(sky, mode); else setSkyDefault();

  setEffectChip(spec.name, duration, icon);
  AudioFX.forge();
  toast(spec.name + " — world altered", "good", icon, 2600);
}
function endWorldEffect() {
  state.effect = null;
  state.gravityTarget = 1;
  stopWeather();
  setSkyDefault();
  hideEffectChip();
}
function updateWorldEffect(dt) {
  world.gravity.y = damp(world.gravity.y, BASE_GRAVITY * state.gravityTarget, 3.2, dt);
  if (state.effect && state.time >= state.effect.until) {
    const name = state.effect.name;
    endWorldEffect();
    toast(name + " faded", "", "🌤️", 2000);
  }
  if (state.effect) {
    const remaining = Math.max(0, state.effect.until - state.time);
    const secs = Math.ceil(remaining);
    if (state.lastEffectSec !== secs) {
      state.lastEffectSec = secs;
      setEffectChip(state.effect.name, secs, state.effect.icon);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  VEHICLES
// ─────────────────────────────────────────────────────────────────────────────
function spawnVehicle(spec, position, yaw = 0) {
  const size = measureVisuals(spec.visuals);
  const y = Math.max(size.y / 2 + 0.18, 0.6);
  const ent = spawnEntity(spec, {
    position: new THREE.Vector3(position.x, y, position.z),
    yaw,
  });
  if (ent.vehicle) ent.vehicle.yaw = yaw;
  state.nearVehicle = ent;
  return ent;
}

function enterVehicle(ent) {
  if (!ent || ent.dead || state.drivingEntity) return;
  state.drivingEntity = ent;
  state.nearVehicle = null;
  playerGroup.visible = false;
  blobShadow.visible = false;
  playerBody.collisionResponse = false;
  playerBody.velocity.setZero();
  playerBody.angularVelocity.setZero();
  playerBody.sleep();
  const vsize = measureVisuals(ent.spec.visuals);
  const span = Math.max(vsize.x, vsize.z, vsize.y * 0.9);
  cam.dist = clamp(7.2 + span * 0.95, 9.5, 26);
  ent.cameraLift = clamp(vsize.y * 0.6 + 0.9, 1.3, 5.2);
  cam.lastLook = -99;
  cam.yaw = ent.vehicle.yaw;
  setUseLabel("EXIT");
  setUseBadge(null);
  document.querySelector("#jumpBtn .lbl").textContent = "BOOST";
  dom.vehicleHint.classList.remove("on");
  setItemCard(ent.spec, "DRIVING · USE TO EXIT");
  AudioFX.ui();
  toast("Driving " + ent.spec.name + " — USE to exit", "good", "🚙", 2800);
}

function exitVehicle(force = false) {
  const ent = state.drivingEntity;
  if (!ent) return;
  state.drivingEntity = null;
  if (!ent.dead) {
    const right = new THREE.Vector3(1, 0, 0).applyAxisAngle(UP, ent.vehicle.yaw);
    const p = ent.body.position;
    const px = p.x + right.x * 2.6;
    const pz = p.z + right.z * 2.6;
    playerBody.collisionResponse = true;
    playerBody.wakeUp();
    playerBody.position.set(px, Math.max(1.2, p.y + 0.9), pz);
    playerBody.velocity.setZero();
    playerBody.angularVelocity.setZero();
    state.nearVehicle = ent;
  }
  playerGroup.visible = true;
  blobShadow.visible = true;
  cam.dist = 6.7;
  document.querySelector("#jumpBtn .lbl").textContent = "JUMP";
  if (state.equipped && state.equipped.type === "weapon") {
    setUseLabel("FIRE");
    setItemCard(state.equipped, "FIRE · " + (state.equipped.action_behavior.projectile || "PROJECTILE"));
    dom.reticle.classList.add("on");
  } else if (state.equipped && state.equipped.type === "physics_object") {
    setUseLabel("DEPLOY");
    setItemCard(state.equipped, "DEPLOY");
  } else {
    setUseLabel("USE");
    hideItemCard();
  }
  if (!force) toast("Jumped out", "", "👟", 1600);
}

function updateVehicles(dt) {
  let nearest = null;
  let nearestDist = 8;
  for (const ent of entities) {
    if (ent.dead || !ent.vehicle) continue;
    if (ent === state.drivingEntity) {
      const v = ent.vehicle;
      const throttle = state.paused ? 0 : clamp(input.moveY + (keys.w ? 1 : 0) - (keys.s ? 1 : 0), -1, 1);
      const steer = state.paused ? 0 : clamp(input.moveX + (keys.d ? 1 : 0) - (keys.a ? 1 : 0), -1, 1);
      let target = throttle >= 0 ? throttle * v.maxSpeed : throttle * v.maxSpeed * 0.45;
      if (v.boost > 0) {
        target += v.maxSpeed * 0.55 * v.boost;
        v.boost = Math.max(0, v.boost - dt * 1.8);
      }
      v.speed = damp(v.speed, target, throttle !== 0 ? 2.6 : 1.2, dt);
      if (Math.abs(v.speed) > 0.2) {
        v.yaw += steer * v.turnSpeed * dt * clamp(Math.abs(v.speed) / 6, 0, 1) * (v.speed < 0 ? -1 : 1);
      }
      const q = new THREE.Quaternion().setFromAxisAngle(UP, v.yaw);
      ent.body.quaternion.set(q.x, q.y, q.z, q.w);
      ent.body.angularVelocity.setZero();
      ent.body.velocity.x = -Math.sin(v.yaw) * v.speed;
      ent.body.velocity.z = -Math.cos(v.yaw) * v.speed;
      if (state.time - cam.lastLook > 1.5) cam.yaw = angleDamp(cam.yaw, v.yaw, 2.2, dt);
      playerBody.position.set(ent.body.position.x, ent.body.position.y + 0.2, ent.body.position.z);
      playerBody.velocity.setZero();
      if (ent.body.position.y < -12) {
        exitVehicle(true);
        despawnEntity(ent);
        toast("Vehicle lost — back on foot", "warn", "🚙", 2200);
      }
    } else {
      const dx = ent.body.position.x - playerBody.position.x;
      const dz = ent.body.position.z - playerBody.position.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < nearestDist) { nearestDist = d; nearest = ent; }
    }
  }
  state.nearVehicle = state.drivingEntity ? null : nearest;
  dom.vehicleHint.classList.toggle("on", !!state.nearVehicle && !state.drivingEntity);
  if (state.nearVehicle && !state.drivingEntity) {
    dom.vehicleHint.innerHTML = "Tap <b>USE</b> to drive · joystick steers";
  }
}
