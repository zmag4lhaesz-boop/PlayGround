// ─────────────────────────────────────────────────────────────────────────────
//  ENGINE BOOTSTRAP (dynamic imports so CDN failures show a friendly message)
// ─────────────────────────────────────────────────────────────────────────────
try {
  const mods = await Promise.all([import("three"), import("cannon-es")]);
  THREE = mods[0];
  CANNON = mods[1];
} catch (err) {
  console.error("[Reality Forge] engine load failed", err);
  const box = document.getElementById("loadError");
  if (box) {
    box.classList.add("on");
    box.textContent = "The 3D engine could not load. Check your connection and reload — the forge needs Three.js + cannon-es once.";
  }
  const sub = document.querySelector("#loading .load-sub");
  if (sub) sub.textContent = "ENGINE OFFLINE";
  throw err;
}

const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, -1);
const GEO = {};
const materialCache = new Map();
const skyTarget = {
  top: new THREE.Color("#1d6cbe"),
  horizon: new THREE.Color("#bcdaf2"),
  fog: new THREE.Color("#a8c8df"),
  sun: 1.85,
  hemi: 0.85,
};

function solid(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: opts.roughness ?? 0.55,
    metalness: opts.metalness ?? 0.12,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color("#000000"),
    emissiveIntensity: opts.emissiveIntensity ?? 0.6,
    transparent: (opts.opacity ?? 1) < 1,
    opacity: opts.opacity ?? 1,
    flatShading: !!opts.flat,
  });
}

function visualMaterial(v) {
  const key = [v.color, v.emissive || "-", v.emissiveIntensity, v.metalness, v.roughness, v.opacity].join("|");
  let mat = materialCache.get(key);
  if (mat) return mat;
  mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(v.color),
    metalness: v.metalness,
    roughness: v.roughness,
    transparent: v.opacity < 1,
    opacity: v.opacity,
    depthWrite: v.opacity > 0.45,
  });
  if (v.emissive) {
    mat.emissive = new THREE.Color(v.emissive);
    mat.emissiveIntensity = v.emissiveIntensity ?? 0.65;
  }
  if (materialCache.size < 240) materialCache.set(key, mat);
  return mat;
}

function makeGlowTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.28, "rgba(255,255,255,.85)");
  grad.addColorStop(0.62, "rgba(255,255,255,.18)");
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const glowTexture = makeGlowTexture();

// ─────────────────────────────────────────────────────────────────────────────
//  RENDERER / SCENE / SKY
// ─────────────────────────────────────────────────────────────────────────────
function pixelRatioForQuality() {
  const dpr = window.devicePixelRatio || 1;
  if (settings.quality === "low") return 1;
  if (settings.quality === "high") return Math.min(dpr, 2);
  return Math.min(dpr, window.innerWidth < 700 ? 1.7 : 2);
}

function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(pixelRatioForQuality());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = ENABLE_SHADOWS && settings.quality !== "low";
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  dom.app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(skyTarget.fog.clone(), 95, 470);
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1600);
  cam.target = new THREE.Vector3(0, 1.35, 0);
  camera.position.set(0, 4, 7);
  camera.lookAt(cam.target);
}

function initSky() {
  skyUniforms = {
    topColor: { value: skyTarget.top.clone() },
    horizonColor: { value: skyTarget.horizon.clone() },
    sunColor: { value: new THREE.Color("#fff4cf") },
    sunDirection: { value: new THREE.Vector3(0.49, 0.69, -0.53).normalize() },
  };
  const skyGeo = new THREE.SphereGeometry(820, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vWorldPosition;
      void main(){
        vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 sunColor;
      uniform vec3 sunDirection;
      varying vec3 vWorldPosition;
      void main(){
        vec3 dir = normalize(vWorldPosition);
        float h = clamp(dir.y, 0.0, 1.0);
        vec3 col = mix(horizonColor, topColor, pow(h, 0.5));
        float d = max(dot(dir, normalize(sunDirection)), 0.0);
        col += sunColor * pow(d, 1400.0) * 2.0;
        col += sunColor * pow(d, 22.0) * 0.14;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.frustumCulled = false;
  scene.add(skyMesh);

  // Soft sun billboard (cheap bloom substitute)
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, color: 0xfff2bf, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  sunSprite.scale.setScalar(120);
  sunSprite.position.set(0.49, 0.69, -0.53).normalize().multiplyScalar(700);
  scene.add(sunSprite);
}

function initLights() {
  hemiLight = new THREE.HemisphereLight(0xd8ecff, 0x8da383, 0.85);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xfff0d0, 1.85);
  sunLight.position.set(30, 42, -32);
  sunLight.castShadow = renderer.shadowMap.enabled;
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 130;
  sunLight.shadow.camera.left = -28;
  sunLight.shadow.camera.right = 28;
  sunLight.shadow.camera.top = 28;
  sunLight.shadow.camera.bottom = -28;
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.035;
  scene.add(sunLight);
  scene.add(sunLight.target);

  const fill = new THREE.DirectionalLight(0xbcdcff, 0.32);
  fill.position.set(-24, 16, 28);
  scene.add(fill);
}

function makeGridTexture() {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  g.fillStyle = "#cfdcc0";
  g.fillRect(0, 0, size, size);

  // Soft organic speckle keeps the huge plane from looking flat
  for (let i = 0; i < 1500; i++) {
    const a = Math.random() * 0.085;
    g.fillStyle = `rgba(70,104,84,${a})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }

  // 10 x 10 cells, 1 metre per cell
  const step = size / 10;
  g.strokeStyle = "rgba(60,96,74,.38)";
  g.lineWidth = 1;
  for (let i = 0; i <= 10; i++) {
    const p = Math.round(i * step) + 0.5;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, size); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(size, p); g.stroke();
  }
  g.strokeStyle = "rgba(44,78,58,.55)";
  g.lineWidth = 2;
  g.strokeRect(1, 1, size - 2, size - 2);

  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(220, 220);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return tex;
}

function initGround() {
  const groundMat = new THREE.MeshStandardMaterial({
    map: makeGridTexture(), roughness: 0.96, metalness: 0.0, color: 0xd7e0cb,
  });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2200, 2200), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Spawn pad: a subtle landing marker at the center of the infinite plane
  const pad = new THREE.Group();
  const padBase = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 0.07, 64), solid("#dfe8d4", { roughness: 0.92 }));
  padBase.position.y = 0.035;
  padBase.receiveShadow = true;
  pad.add(padBase);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.72, 0.045, 8, 64), solid("#ffb36b", { emissive: "#ff8a4c", emissiveIntensity: 0.5 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  pad.add(ring);
  const inner = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 48), solid("#7dd3fc", { emissive: "#38bdf8", emissiveIntensity: 0.35, opacity: 0.7 }));
  inner.rotation.x = -Math.PI / 2;
  inner.position.y = 0.08;
  pad.add(inner);
  for (let i = 0; i < 4; i++) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.8), solid("#7dd3fc", { emissive: "#38bdf8", emissiveIntensity: 0.4 }));
    const a = (i / 4) * Math.PI * 2;
    tick.position.set(Math.sin(a) * 2.6, 0.08, Math.cos(a) * 2.6);
    tick.rotation.y = a;
    pad.add(tick);
  }
  scene.add(pad);
}

function initScenery() {
  // Low-poly rocks
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x9fb098, roughness: 0.95, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 64);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < 64; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 9 + Math.random() * 78;
    const s = 0.16 + Math.random() * 1.05;
    dummy.position.set(Math.cos(a) * r, s * 0.28, Math.sin(a) * r);
    dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
    dummy.scale.set(s * (0.8 + Math.random() * 0.7), s * (0.5 + Math.random() * 0.5), s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.instanceMatrix.needsUpdate = true;
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);

  // Grass tufts (two shades)
  for (const [color, count, offset] of [["#6fae5f", 180, 0], ["#8ac773", 120, 0.5]]) {
    const geo = new THREE.ConeGeometry(0.09, 0.52, 4);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
    const grass = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 72;
      const s = 0.6 + Math.random() * 1.2;
      dummy.position.set(Math.cos(a) * r, 0.25 * s, Math.sin(a) * r);
      dummy.rotation.set(rand(-0.2, 0.2), Math.random() * 6, rand(-0.2, 0.2));
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      grass.setMatrixAt(i, dummy.matrix);
    }
    grass.instanceMatrix.needsUpdate = true;
    grass.castShadow = false;
    scene.add(grass);
  }

  // Distant pastel hills
  const hills = new THREE.Group();
  const hillColors = ["#8fb3a0", "#85a897", "#9cbaa5", "#97b5a0"];
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2 + rand(-0.2, 0.2);
    const radius = 300 + rand(0, 150);
    const h = rand(16, 34);
    const w = rand(46, 96);
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(w, h, randInt(5, 8)),
      new THREE.MeshStandardMaterial({ color: choice(hillColors), roughness: 1, flatShading: true })
    );
    hill.position.set(Math.cos(angle) * radius, h / 2 - 5, Math.sin(angle) * radius);
    hill.rotation.y = Math.random() * Math.PI;
    hills.add(hill);
  }
  scene.add(hills);

  // Puffy instanced clouds
  const cloudGeo = new THREE.SphereGeometry(1, 12, 8);
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: false });
  const cloudCount = 52;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudCount);
  let ci = 0;
  for (let c = 0; c < 12 && ci < cloudCount; c++) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 110 + Math.random() * 180;
    const cx = Math.cos(angle) * radius;
    const cz = Math.sin(angle) * radius;
    const cy = 34 + Math.random() * 34;
    const puffs = 2 + Math.floor(Math.random() * 3);
    for (let p = 0; p < puffs && ci < cloudCount; p++, ci++) {
      dummy.position.set(cx + rand(-8, 8), cy + rand(-1.5, 2.5), cz + rand(-6, 6));
      dummy.rotation.set(0, Math.random() * 3, 0);
      dummy.scale.set(rand(6, 13), rand(2.4, 4.2), rand(4, 7.5));
      dummy.updateMatrix();
      clouds.setMatrixAt(ci, dummy.matrix);
    }
  }
  clouds.count = ci;
  clouds.instanceMatrix.needsUpdate = true;
  clouds.frustumCulled = false;
  scene.add(clouds);
  scene.userData.clouds = clouds;

  // Floating dust motes for depth
  const dustCount = 180;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = rand(-35, 35);
    dustPos[i * 3 + 1] = rand(0.3, 7);
    dustPos[i * 3 + 2] = rand(-35, 35);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.055, transparent: true, opacity: 0.4, depthWrite: false,
  }));
  dust.frustumCulled = false;
  scene.add(dust);
  scene.userData.dust = dust;
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHYSICS
// ─────────────────────────────────────────────────────────────────────────────
function initPhysics() {
  world = new CANNON.World({ gravity: new CANNON.Vec3(0, BASE_GRAVITY, 0) });
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = true;
  world.solver.iterations = 8;
  world.defaultContactMaterial.friction = 0.4;
  world.defaultContactMaterial.restitution = 0.1;

  matGround = new CANNON.Material("ground");
  matPlayer = new CANNON.Material("player");
  matEntity = new CANNON.Material("entity");
  matBouncy = new CANNON.Material("bouncy");
  matVehicle = new CANNON.Material("vehicle");

  const contact = (a, b, friction, restitution) => {
    world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution }));
  };
  // The player is driven by setting velocity every frame. Cannon's friction
  // solver is strong enough to cancel that velocity outright, so keep the
  // player's ground contact nearly frictionless and let damping stop them.
  contact(matGround, matPlayer, 0.0, 0.02);
  contact(matGround, matEntity, 0.55, 0.22);
  contact(matGround, matBouncy, 0.15, 1.12);
  contact(matGround, matVehicle, 0.75, 0.05);
  contact(matPlayer, matEntity, 0.15, 0.2);
  contact(matPlayer, matBouncy, 0.05, 1.35);
  contact(matPlayer, matVehicle, 0.5, 0.1);
  contact(matEntity, matEntity, 0.45, 0.28);
  contact(matEntity, matBouncy, 0.2, 1.1);
  contact(matEntity, matVehicle, 0.5, 0.15);
  contact(matVehicle, matVehicle, 0.5, 0.1);

  // Infinite ground plane
  const groundBody = new CANNON.Body({ mass: 0, material: matGround });
  groundBody.addShape(new CANNON.Plane());
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  groundBody.collisionFilterGroup = G_GROUND;
  groundBody.collisionFilterMask = G_PLAYER | G_ENTITY | G_PROJECTILE | G_VEHICLE;
  world.addBody(groundBody);

  // Player: a sphere with fixed rotation gives smooth, snag-free movement
  playerBody = new CANNON.Body({
    mass: 70,
    material: matPlayer,
    shape: new CANNON.Sphere(PLAYER_RADIUS),
    position: new CANNON.Vec3(0, 1.1, 0),
    fixedRotation: true,
    linearDamping: 0.02,
    allowSleep: false,
  });
  playerBody.collisionFilterGroup = G_PLAYER;
  playerBody.collisionFilterMask = G_GROUND | G_ENTITY | G_VEHICLE;
  world.addBody(playerBody);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PLAYER CHARACTER (procedural low-poly explorer)
// ─────────────────────────────────────────────────────────────────────────────
function buildPlayer() {
  playerGroup = new THREE.Group();
  playerVisual = new THREE.Group();
  playerGroup.add(playerVisual);
  scene.add(playerGroup);

  const jacket = solid("#ff7a45", { roughness: 0.6 });
  const jacketDark = solid("#e05a32", { roughness: 0.65 });
  const pants = solid("#25344f", { roughness: 0.7 });
  const skin = solid("#ffd7b0", { roughness: 0.75 });
  const cream = solid("#f7f1df", { roughness: 0.55 });
  const visor = solid("#17324a", { roughness: 0.15, metalness: 0.55, emissive: "#4cc9f0", emissiveIntensity: 0.35 });
  const gold = solid("#ffd166", { roughness: 0.5, metalness: 0.2 });
  const boot = solid("#1b2537", { roughness: 0.8 });
  const mint = solid("#6ee7c8", { roughness: 0.4, emissive: "#2dd4bf", emissiveIntensity: 0.4 });

  const addMesh = (geo, mat, pos, parent = playerVisual) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(pos[0], pos[1], pos[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };

  // Torso + belt
  addMesh(new THREE.CapsuleGeometry(0.3, 0.48, 5, 12), jacket, [0, 1.13, 0]);
  addMesh(new THREE.CylinderGeometry(0.305, 0.305, 0.09, 16), pants, [0, 0.86, 0]);
  addMesh(new THREE.BoxGeometry(0.16, 0.1, 0.06), gold, [0, 0.86, -0.3]);

  // Head + helmet + visor
  addMesh(new THREE.SphereGeometry(0.265, 20, 16), skin, [0, 1.66, 0]);
  const helmet = addMesh(new THREE.SphereGeometry(0.3, 20, 16), cream, [0, 1.71, 0.02]);
  helmet.scale.set(1.02, 0.86, 1.05);
  addMesh(new THREE.BoxGeometry(0.36, 0.145, 0.12), visor, [0, 1.66, -0.235]);
  addMesh(new THREE.BoxGeometry(0.38, 0.04, 0.14), gold, [0, 1.79, -0.2]);

  // Backpack + antenna
  addMesh(new THREE.BoxGeometry(0.42, 0.5, 0.24), gold, [0, 1.18, 0.3]);
  addMesh(new THREE.BoxGeometry(0.26, 0.16, 0.06), mint, [0, 1.28, 0.43]);
  addMesh(new THREE.CylinderGeometry(0.018, 0.018, 0.34, 6), boot, [0.14, 1.5, 0.32]);
  addMesh(new THREE.SphereGeometry(0.045, 8, 6), mint, [0.14, 1.68, 0.32]);

  // Arms (pivots so they can swing / aim)
  const makeArm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.35, 1.4, 0);
    playerVisual.add(pivot);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 8), jacket);
    arm.position.y = -0.26; arm.castShadow = true;
    pivot.add(arm);
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.1, 10), jacketDark);
    cuff.position.y = -0.47; cuff.castShadow = true;
    pivot.add(cuff);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.095, 10, 8), skin);
    hand.position.y = -0.55; hand.castShadow = true;
    pivot.add(hand);
    return pivot;
  };
  playerVisual.userData.armL = makeArm(-1);
  playerVisual.userData.armR = makeArm(1);

  // Legs
  const makeLeg = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.16, 0.82, 0);
    playerVisual.add(pivot);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.42, 4, 8), pants);
    leg.position.y = -0.33; leg.castShadow = true;
    pivot.add(leg);
    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.14, 0.32), boot);
    shoe.position.set(0, -0.66, -0.05); shoe.castShadow = true;
    pivot.add(shoe);
    return pivot;
  };
  playerVisual.userData.legL = makeLeg(-1);
  playerVisual.userData.legR = makeLeg(1);

  // Weapon socket
  weaponMount = new THREE.Group();
  weaponMount.position.set(0.46, 1.3, -0.24);
  weaponMount.userData.base = weaponMount.position.clone();
  playerVisual.add(weaponMount);

  // Contact shadow (extra grounding, especially on low-end devices without shadows)
  blobShadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.62, 28),
    new THREE.MeshBasicMaterial({ color: 0x1a2b20, transparent: true, opacity: 0.17, depthWrite: false })
  );
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.position.y = 0.055;
  scene.add(blobShadow);

  playerGroup.position.set(0, 0.65, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
//  CAMERA
// ─────────────────────────────────────────────────────────────────────────────
function cameraDesiredPosition(target) {
  const cp = Math.cos(cam.pitch);
  const offset = new THREE.Vector3(
    Math.sin(cam.yaw) * cp * cam.dist,
    Math.sin(cam.pitch) * cam.dist + 0.5,
    Math.cos(cam.yaw) * cp * cam.dist
  );
  const pos = target.clone().add(offset);
  pos.y = Math.max(0.62, pos.y);
  return pos;
}
function snapCamera() {
  const target = new THREE.Vector3(
    playerBody.position.x,
    playerBody.position.y + 0.9,
    playerBody.position.z
  );
  cam.target.copy(target);
  camera.position.copy(cameraDesiredPosition(target));
  camera.lookAt(cam.target);
}
function updateCamera(dt) {
  const driving = state.drivingEntity;
  const target = new THREE.Vector3();
  if (driving && !driving.dead) {
    target.set(driving.body.position.x, driving.body.position.y + (driving.cameraLift || 1.25), driving.body.position.z);
  } else {
    target.set(playerBody.position.x, playerBody.position.y + 0.9, playerBody.position.z);
  }
  cam.target.lerp(target, 1 - Math.exp(-12 * dt));
  const desired = cameraDesiredPosition(cam.target);
  camera.position.lerp(desired, 1 - Math.exp(-15 * dt));
  if (cam.shake > 0.001) {
    camera.position.x += rand(-1, 1) * cam.shake * 0.35;
    camera.position.y += rand(-1, 1) * cam.shake * 0.28;
    camera.position.z += rand(-1, 1) * cam.shake * 0.35;
    cam.shake = damp(cam.shake, 0, 7, dt);
  }
  camera.lookAt(cam.target.x, cam.target.y + 0.12, cam.target.z);
}

// ─────────────────────────────────────────────────────────────────────────────
//  WORLD QUALITY
// ─────────────────────────────────────────────────────────────────────────────
function applyQuality() {
  if (!renderer) return;
  renderer.setPixelRatio(pixelRatioForQuality());
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  const shadows = ENABLE_SHADOWS && settings.quality !== "low";
  renderer.shadowMap.enabled = shadows;
  if (sunLight) {
    sunLight.castShadow = shadows;
    sunLight.shadow.mapSize.set(shadows ? 1024 : 512, shadows ? 1024 : 512);
  }
  AudioFX.enabled = settings.sound;
}

function initEngine() {
  initRenderer();
  initSky();
  initLights();
  initGround();
  initScenery();
  initPhysics();
  buildPlayer();
  snapCamera();

  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", syncViewport);
  window.visualViewport?.addEventListener("scroll", syncViewport);

  renderer.render(scene, camera);
}

function onResize() {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  placeJoystickHome();
  syncViewport();
}
