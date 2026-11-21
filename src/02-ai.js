// ─────────────────────────────────────────────────────────────────────────────
//  AI INTERPRETATION
//  The LLM is a "reality compiler": natural language -> one strict JSON spec.
//  Every field is sanitized locally, so a bad completion can never break the game.
// ─────────────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are REALITY FORGE, the generative engine inside a mobile 3D physics sandbox.
Convert the player's request into ONE buildable JSON object. Return ONLY raw JSON.
No markdown, no code fences, no explanation.

COORDINATES: Y is up, forward is -Z. Entity origin is its center. Units are meters.
SHAPES: "box", "sphere", "cylinder", "cone", "torus".
Each visual: {shape, position:[x,y,z], rotation:[x,y,z] in DEGREES, scale:[x,y,z],
color:"#rrggbb", emissive:"#rrggbb" or null, metalness:0..1, roughness:0..1, opacity:0.1..1}
- scale means FULL dimensions for box, diameter+height for cylinder/cone, diameter for sphere.
- Keep the whole creation under 4m; weapons under 1.5m. Center it near the origin.
- Use 3-10 primitives, chunky readable silhouettes, bright saturated colors. No black.
- The "front" of a weapon, vehicle and projectile points toward -Z.

TYPES (pick exactly one):
- "weapon": held in the player's hand, fires on the USE button. Requires projectile_visuals.
- "vehicle": spawns in front, drivable with the joystick. Add 4 visible wheel primitives.
- "physics_object": spawns in front with mass, gravity and collision (e.g. trampoline, ball, tower).
- "world_event": immediately alters the world (gravity, sky, weather). visuals may be [].

SCHEMA:
{"type":"weapon|vehicle|physics_object|world_event","name":"<=28 chars","description":"<=90 chars",
"visuals":[VISUAL...],"projectile_visuals":[VISUAL...],
"physics":{"mass":0.1..800,"restitution":0..1.4,"friction":0..1.5,"collider":"box|sphere",
  "gravityScale":0..2,"linearDamping":0..1,"angularDamping":0..1,"bouncy":true|false},
"action_behavior":{"mode":"projectile|drive|deploy|none","projectile":"name",
  "speed":5..80,"gravityScale":0..2,"onImpact":"explode|bounce|stick|none",
  "explosionRadius":1..9,"explosionForce":2..30,"cooldown":0.12..3,
  "spawnCount":1..4,"spread":0..0.2,"maxSpeed":5..28,"acceleration":8..40,"turnSpeed":1..3},
"world_effect":{"gravity":0..2,"skyColor":"#rrggbb","weather":"none|rain|meteor",
  "weatherRate":0.2..6,"duration":6..45},
"structure":"tower" or null}

RULES:
- Weapons: onImpact usually "explode"; give projectile speed 20-70 and gravityScale 0-1.
  Airplanes/rockets can use gravityScale 0.1-0.3. A "gun that shoots X" makes X the projectile.
- Vehicles: 4 wheel boxes at y<0, action mode "drive", maxSpeed 10-24. Wheels can be square.
- Trampolines/bouncy things: restitution 1.0-1.35 and bouncy true; make them wide and flat.
- "Giant tower": physics_object, structure "tower", 6-10 stacked blocks, each block chunky.
- World events: "low gravity" -> gravity 0.15-0.35; "rain" -> weather "rain";
  "explosive/meteor/watermelon rain" -> weather "meteor" and projectile_visuals for the falling object.
- For meteor weather, put the falling object in projectile_visuals and explosion values in action_behavior.
- If the request is vague or silly, choose the most playful physical interpretation. Never refuse.
- No text, logos, external assets or textures. Primitives only.

EXAMPLE:
{"type":"weapon","name":"Airplane Gun","description":"Launches tiny propeller planes.",
"visuals":[{"shape":"box","position":[0,0,0.1],"rotation":[0,0,0],"scale":[0.18,0.22,0.66],"color":"#334155","metalness":0.6,"roughness":0.35},{"shape":"cylinder","position":[0,0.03,-0.45],"rotation":[90,0,0],"scale":[0.11,0.55,0.11],"color":"#7dd3fc","emissive":"#38bdf8","metalness":0.8,"roughness":0.2}],
"projectile_visuals":[{"shape":"cylinder","position":[0,0,0],"rotation":[90,0,0],"scale":[0.22,0.22,1],"color":"#f8fafc","metalness":0.2,"roughness":0.4},{"shape":"box","position":[0,0,0.05],"rotation":[0,0,0],"scale":[1.7,0.05,0.34],"color":"#ff7a45","metalness":0.1,"roughness":0.5}],
"physics":{"mass":0.4,"restitution":0.2,"friction":0.4,"collider":"sphere","gravityScale":1},
"action_behavior":{"mode":"projectile","projectile":"Airplane","speed":54,"gravityScale":0.12,"onImpact":"explode","explosionRadius":3.2,"explosionForce":9,"cooldown":0.28,"spawnCount":1,"spread":0.015},
"world_effect":{"gravity":1,"skyColor":"#8ec9ff","weather":"none","duration":20}}`;

const VALID_TYPES = new Set(["weapon", "vehicle", "physics_object", "world_event"]);
const VALID_SHAPES = new Set(["box", "sphere", "cylinder", "cone", "torus"]);
const NAMED_COLORS = {
  red: "#ff5c5c", orange: "#ff8a4c", yellow: "#ffd166", green: "#6ee7a0",
  teal: "#6ee7c8", cyan: "#7dd3fc", blue: "#5b8def", purple: "#c084fc",
  pink: "#ff5c8a", magenta: "#ff5cc8", white: "#f8fafc", grey: "#9aa7b8",
  gray: "#9aa7b8", brown: "#a9744f", gold: "#ffcf5c", silver: "#cbd5e1",
};

function safeColor(value, fallback = "#7dd3fc") {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v)) {
    if (v.length === 4) return "#" + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return v;
  }
  return NAMED_COLORS[v] || fallback;
}
function num(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
}
function arr3(value, fallback, min, max) {
  if (!Array.isArray(value) || value.length < 3) return fallback.slice();
  return [0, 1, 2].map((i) => num(value[i], fallback[i], min, max));
}
function extractJson(text) {
  if (!text) return null;
  let s = String(text).trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const attempts = [s];
  const first = s.indexOf("{"), last = s.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const sliced = s.slice(first, last + 1);
    attempts.push(sliced, sliced.replace(/,\s*([}\]])/g, "$1"));
  }
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* try next */ }
  }
  return null;
}

function normalizeVisuals(list, limit = 12) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit).map((v) => {
    if (!v || typeof v !== "object") return null;
    const shape = VALID_SHAPES.has(String(v.shape).toLowerCase()) ? String(v.shape).toLowerCase() : "box";
    const scale = arr3(v.scale || v.size, [0.4, 0.4, 0.4], 0.02, 8);
    return {
      shape,
      position: arr3(v.position, [0, 0, 0], -4, 4),
      rotation: arr3(v.rotation, [0, 0, 0], -720, 720),
      scale,
      color: safeColor(v.color, "#8ec5ff"),
      emissive: v.emissive ? safeColor(v.emissive, "#000000") : null,
      emissiveIntensity: num(v.emissiveIntensity, 0.65, 0, 2),
      metalness: num(v.metalness, 0.18, 0, 1),
      roughness: num(v.roughness, 0.52, 0, 1),
      opacity: num(v.opacity, 1, 0.12, 1),
      tag: typeof v.tag === "string" ? v.tag.slice(0, 16) : null,
    };
  }).filter(Boolean);
}

function normalizeSpec(raw, prompt) {
  if (!raw || typeof raw !== "object") return null;
  const type = VALID_TYPES.has(String(raw.type)) ? String(raw.type) : "physics_object";
  let visuals = normalizeVisuals(raw.visuals || raw.shapes || [], 12);
  if (type !== "world_event" && visuals.length === 0) {
    visuals = [{
      shape: "box", position: [0, 0, 0], rotation: [0, 0, 0], scale: [0.8, 0.8, 0.8],
      color: "#ff8a4c", emissive: null, emissiveIntensity: 0.65, metalness: 0.2,
      roughness: 0.5, opacity: 1, tag: null,
    }];
  }
  const p = raw.physics && typeof raw.physics === "object" ? raw.physics : {};
  const physics = {
    mass: num(p.mass, type === "vehicle" ? 300 : 4, 0.05, 800),
    restitution: num(p.restitution, 0.3, 0, 1.45),
    friction: num(p.friction, 0.5, 0, 1.5),
    collider: p.collider === "sphere" ? "sphere" : "box",
    gravityScale: num(p.gravityScale, 1, 0, 2.5),
    linearDamping: num(p.linearDamping, 0.12, 0, 1),
    angularDamping: num(p.angularDamping, 0.24, 0, 1),
    bouncy: p.bouncy === true || num(p.restitution, 0, 0, 1.45) > 0.9,
  };
  const a = raw.action_behavior || raw.actionBehavior || {};
  const action = {
    mode: ["projectile", "drive", "deploy", "none"].includes(a.mode)
      ? a.mode
      : (type === "weapon" ? "projectile" : type === "vehicle" ? "drive" : type === "physics_object" ? "deploy" : "none"),
    projectile: typeof a.projectile === "string" ? a.projectile.slice(0, 28) : "Orb",
    speed: num(a.speed, type === "weapon" ? 38 : 12, 0, 90),
    gravityScale: num(a.gravityScale, 1, 0, 2.5),
    onImpact: ["explode", "bounce", "stick", "none"].includes(a.onImpact) ? a.onImpact : "explode",
    explosionRadius: num(a.explosionRadius, 4, 1, 10),
    explosionForce: num(a.explosionForce, 12, 1, 40),
    cooldown: num(a.cooldown, type === "weapon" ? 0.4 : 1.2, 0.1, 4),
    spawnCount: Math.round(num(a.spawnCount, 1, 1, 4)),
    spread: num(a.spread, 0.02, 0, 0.25),
    maxSpeed: num(a.maxSpeed, 17, 4, 32),
    acceleration: num(a.acceleration, 22, 5, 50),
    turnSpeed: num(a.turnSpeed, 2.2, 0.6, 4),
    projectileMass: num(a.projectileMass, 0.5, 0.05, 20),
    projectileScale: num(a.projectileScale, 1, 0.2, 3),
  };
  const w = raw.world_effect || raw.worldEffect || {};
  const worldEffect = {
    gravity: num(w.gravity, 1, 0, 2.5),
    skyColor: w.skyColor ? safeColor(w.skyColor, "#8ec9ff") : null,
    weather: ["rain", "meteor", "none"].includes(w.weather) ? w.weather : "none",
    weatherRate: num(w.weatherRate, 2, 0.2, 8),
    duration: num(w.duration, 20, 5, 60),
  };
  const structure = raw.structure === "tower" ? "tower" : null;
  return {
    type,
    name: String(raw.name || titleFromPrompt(prompt)).trim().slice(0, 28) || titleFromPrompt(prompt),
    description: String(raw.description || "").trim().slice(0, 100),
    visuals,
    projectile_visuals: normalizeVisuals(raw.projectile_visuals || raw.projectileVisuals || [], 8),
    physics,
    action_behavior: action,
    world_effect: worldEffect,
    structure,
    structureCount: Math.round(num(raw.structureCount, 8, 2, 12)),
    source: raw.__source === "local" ? "local" : "ai",
  };
}

async function requestAICreation(prompt) {
  const key = (settings.key || "").trim();
  if (!key) throw new Error("NO_KEY");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    let raw = null;
    if (settings.provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
        body: JSON.stringify({
          model: activeModel(),
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: "Build this: " + prompt },
          ],
          temperature: 0.9,
          max_tokens: 1800,
          response_format: { type: "json_object" },
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error("OpenAI " + res.status + ": " + (await res.text()).slice(0, 140));
      const data = await res.json();
      raw = extractJson(data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);
    } else {
      const model = encodeURIComponent(activeModel());
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
            contents: [{ role: "user", parts: [{ text: "Build this: " + prompt }] }],
            generationConfig: { temperature: 0.9, maxOutputTokens: 1800, responseMimeType: "application/json" },
          }),
          signal: controller.signal,
        }
      );
      if (!res.ok) throw new Error("Gemini " + res.status + ": " + (await res.text()).slice(0, 140));
      const data = await res.json();
      const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
        .map((part) => part.text || "").join("");
      raw = extractJson(text);
    }
    if (!raw) throw new Error("Model returned no usable JSON");
    const spec = normalizeSpec(raw, prompt);
    if (!spec) throw new Error("Could not normalize model output");
    spec.source = "ai";
    return spec;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOCAL FORGE — instant, key-free fallback (5+ behaviors + generic artifacts)
// ─────────────────────────────────────────────────────────────────────────────
const LOCAL_PALETTE = ["#ff7a45", "#ffd166", "#6ee7c8", "#7dd3fc", "#c084fc", "#ff5c8a", "#a3e635"];
const vz = (shape, position, scale, color, rotation = [0, 0, 0], extra = {}) => ({
  shape, position, rotation, scale, color, ...extra,
});

function gunVisuals(accent = "#7dd3fc") {
  return [
    vz("box", [0, 0, 0.12], [0.18, 0.22, 0.66], "#334155", [0, 0, 0], { metalness: 0.55, roughness: 0.38 }),
    vz("box", [0, -0.18, 0.2], [0.15, 0.32, 0.18], "#202b3d", [18, 0, 0]),
    vz("cylinder", [0, 0.03, -0.45], [0.11, 0.55, 0.11], accent, [90, 0, 0], { emissive: accent, metalness: 0.75, roughness: 0.22 }),
    vz("torus", [0, 0.03, -0.73], [0.18, 0.18, 0.18], accent, [90, 0, 0], { emissive: accent, metalness: 0.8 }),
    vz("box", [0, 0.15, 0.0], [0.12, 0.07, 0.34], "#ffd166", [0, 0, 0], { metalness: 0.4 }),
    vz("sphere", [0, 0.02, -0.74], [0.1, 0.1, 0.1], "#ffffff", [0, 0, 0], { emissive: accent }),
  ];
}
function airplaneVisuals(s = 1) {
  return [
    vz("cylinder", [0, 0, 0], [0.22 * s, 0.22 * s, 1.0 * s], "#f1f5f9", [90, 0, 0], { metalness: 0.25, roughness: 0.4 }),
    vz("cone", [0, 0, -0.6 * s], [0.22 * s, 0.34 * s, 0.22 * s], "#ff5c7a", [-90, 0, 0]),
    vz("box", [0, 0, 0.04 * s], [1.7 * s, 0.05 * s, 0.34 * s], "#ff7a45"),
    vz("box", [0, 0.02 * s, 0.45 * s], [0.62 * s, 0.04 * s, 0.22 * s], "#ffd166"),
    vz("box", [0, 0.17 * s, 0.45 * s], [0.05 * s, 0.3 * s, 0.26 * s], "#ff5c7a"),
    vz("sphere", [0, 0.14 * s, -0.2 * s], [0.2 * s, 0.16 * s, 0.3 * s], "#7dd3fc", [0, 0, 0], { opacity: 0.85, metalness: 0.3, roughness: 0.15 }),
    vz("box", [0, 0.14 * s, -0.78 * s], [0.72 * s, 0.055 * s, 0.04 * s], "#3b4a66"),
    vz("box", [0, 0.14 * s, -0.78 * s], [0.055 * s, 0.72 * s, 0.04 * s], "#3b4a66"),
  ];
}
function bombVisuals() {
  return [
    vz("sphere", [0, 0, 0], [0.62, 0.72, 0.62], "#27364d", [0, 0, 0], { metalness: 0.55, roughness: 0.35 }),
    vz("torus", [0, 0.02, 0], [0.7, 0.7, 0.7], "#ff8a4c", [90, 0, 0], { emissive: "#ff5c00" }),
    vz("box", [0, 0, 0.34], [0.5, 0.06, 0.3], "#ffd166"),
    vz("box", [0, 0, 0.34], [0.06, 0.5, 0.3], "#ffd166"),
    vz("cylinder", [0, 0.42, 0], [0.07, 0.18, 0.07], "#9aa7b8"),
  ];
}
function trampolineVisuals() {
  const legs = [];
  for (const [x, z] of [[-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05]]) {
    legs.push(vz("box", [x, -0.26, z], [0.18, 0.52, 0.18], "#ffd166"));
  }
  return [
    vz("cylinder", [0, 0, 0], [3.05, 0.24, 3.05], "#143848"),
    vz("cylinder", [0, 0.16, 0], [2.6, 0.16, 2.6], "#ff5c8a", [0, 0, 0], { emissive: "#7a0f38" }),
    vz("torus", [0, 0.27, 0], [2.75, 2.75, 2.75], "#ffd166", [-90, 0, 0], { metalness: 0.4 }),
    ...legs,
    vz("box", [0, 0.27, 0], [1.1, 0.02, 0.16], "#fff1f6"),
    vz("box", [0, 0.27, 0], [0.16, 0.02, 1.1], "#fff1f6"),
  ];
}
function towerBlockVisuals(color = "#ffd166") {
  return [
    vz("box", [0, 0, 0], [1.5, 0.85, 1.5], color, [0, 0, 0], { metalness: 0.15, roughness: 0.6 }),
    vz("box", [0, 0.12, -0.76], [1.2, 0.14, 0.05], "#fff4c2", [0, 0, 0], { emissive: "#ffd166" }),
  ];
}
function carVisuals(square = false, giant = false) {
  const s = giant ? 1.28 : 1;
  const wheels = [];
  const wheelColor = "#1c2a3d";
  for (const x of [-1.05, 1.05]) {
    for (const z of [-1.1, 1.1]) {
      if (square) {
        wheels.push(vz("box", [x * s, -0.28 * s, z * s], [0.62 * s, 0.62 * s, 0.62 * s], wheelColor, [0, 0, 0], { metalness: 0.3, roughness: 0.7 }));
      } else {
        wheels.push(vz("cylinder", [x * s, -0.28 * s, z * s], [0.66 * s, 0.3 * s, 0.66 * s], wheelColor, [0, 0, 90], { metalness: 0.25, roughness: 0.7 }));
        wheels.push(vz("cylinder", [x * s, -0.28 * s, z * s], [0.3 * s, 0.32 * s, 0.3 * s], "#ffd166", [0, 0, 90], { metalness: 0.5 }));
      }
    }
  }
  return [
    vz("box", [0, 0.06 * s, 0], [2.1 * s, 0.52 * s, 3.5 * s], "#ff7a45", [0, 0, 0], { metalness: 0.3, roughness: 0.4 }),
    vz("box", [0, 0.36 * s, -1.1 * s], [1.92 * s, 0.26 * s, 1.0 * s], "#ff9a52"),
    vz("box", [0, 0.62 * s, 0.15 * s], [1.66 * s, 0.62 * s, 1.5 * s], "#8ee6ff", [0, 0, 0], { opacity: 0.8, metalness: 0.2, roughness: 0.12 }),
    vz("box", [0, 0.95 * s, 0.15 * s], [1.74 * s, 0.12 * s, 1.54 * s], "#ffd166"),
    ...wheels,
    vz("box", [0, 0.04 * s, -1.8 * s], [1.9 * s, 0.18 * s, 0.18 * s], "#ffd166"),
    vz("box", [0, 0.04 * s, 1.8 * s], [1.9 * s, 0.18 * s, 0.18 * s], "#ffd166"),
    vz("sphere", [-0.66 * s, 0.16 * s, -1.77 * s], [0.24 * s, 0.18 * s, 0.1 * s], "#fff3b0", [0, 0, 0], { emissive: "#ffe066" }),
    vz("sphere", [0.66 * s, 0.16 * s, -1.77 * s], [0.24 * s, 0.18 * s, 0.1 * s], "#fff3b0", [0, 0, 0], { emissive: "#ffe066" }),
  ];
}
function ballVisuals(color = "#ff5c8a") {
  return [
    vz("sphere", [0, 0, 0], [2.0, 2.0, 2.0], color, [0, 0, 0], { metalness: 0.15, roughness: 0.35 }),
    vz("torus", [0, 0, 0], [2.02, 2.02, 2.02], "#fff1f6", [90, 0, 0], { metalness: 0.2 }),
    vz("torus", [0, 0, 0], [2.02, 2.02, 2.02], "#fff1f6", [0, 90, 0], { metalness: 0.2 }),
  ];
}
function watermelonVisuals() {
  return [
    vz("sphere", [0, 0, 0], [1.0, 1.05, 1.0], "#2f9e44", [0, 0, 0], { roughness: 0.5 }),
    vz("torus", [0, 0, 0], [1.02, 1.02, 1.02], "#14532d", [90, 0, 0], { metalness: 0.1 }),
    vz("torus", [0, 0, 0], [1.02, 1.02, 1.02], "#14532d", [0, 90, 0], { metalness: 0.1 }),
    vz("cylinder", [0, 0.55, 0], [0.12, 0.26, 0.12], "#6b8e23"),
  ];
}
function fireballVisuals() {
  return [
    vz("sphere", [0, 0, 0], [1.2, 1.2, 1.2], "#ff7a45", [0, 0, 0], { emissive: "#ff3d00", emissiveIntensity: 1.4 }),
    vz("sphere", [0, 0.05, 0], [0.78, 0.78, 0.78], "#ffd166", [0, 0, 0], { emissive: "#ffb000", emissiveIntensity: 1.5 }),
    vz("torus", [0, 0, 0], [1.5, 1.5, 1.5], "#ff5c00", [70, 20, 0], { emissive: "#ff2d00", opacity: 0.65 }),
  ];
}
function laserVisuals() {
  return [
    vz("box", [0, 0, 0], [0.14, 0.14, 1.8], "#6ee7c8", [0, 0, 0], { emissive: "#2dd4bf", emissiveIntensity: 1.6 }),
    vz("sphere", [0, 0, -0.95], [0.3, 0.3, 0.3], "#ffffff", [0, 0, 0], { emissive: "#6ee7c8" }),
  ];
}
function orbVisuals(color) {
  return [
    vz("sphere", [0, 0, 0], [0.7, 0.7, 0.7], color, [0, 0, 0], { emissive: color, emissiveIntensity: 0.9 }),
    vz("torus", [0, 0, 0], [0.95, 0.95, 0.95], "#ffffff", [90, 0, 0], { emissive: "#ffffff", opacity: 0.7 }),
  ];
}

function localRaw(type, name, visuals, opts = {}) {
  return {
    __source: "local", type, name,
    description: opts.description || "",
    visuals,
    projectile_visuals: opts.projectile_visuals || [],
    physics: opts.physics || {},
    action_behavior: opts.action_behavior || {},
    world_effect: opts.world_effect || {},
    structure: opts.structure || null,
    structureCount: opts.structureCount || 8,
  };
}

function buildLocalRaw(prompt) {
  const q = String(prompt || "").toLowerCase();
  const giant = /(giant|huge|big|massive|colossal)/.test(q);
  const wantsRain = /(rain|storm|shower|weather|sky)/.test(q);
  const wantsExplode = /(explos|bomb|grenade|detonat|boom|meteor|nuke)/.test(q);

  if (/watermelon/.test(q)) {
    if (/(gun|shoot|fire|launch|blaster|cannon)/.test(q)) {
      return localRaw("weapon", "Watermelon Blaster", gunVisuals("#6ee7a0"), {
        description: "Launches explosive watermelons.",
        projectile_visuals: watermelonVisuals(),
        physics: { mass: 0.5, restitution: 0.2, collider: "sphere" },
        action_behavior: { mode: "projectile", projectile: "Watermelon", speed: 32, gravityScale: 0.85, onImpact: "explode", explosionRadius: 4.8, explosionForce: 16, cooldown: 0.7, projectileMass: 2.2, projectileScale: 1.1 },
      });
    }
    return localRaw("world_event", "Explosive Watermelon Rain", [], {
      description: "The sky rains exploding watermelons.",
      projectile_visuals: watermelonVisuals(),
      action_behavior: { onImpact: "explode", explosionRadius: 4.6, explosionForce: 16 },
      world_effect: { gravity: 1, skyColor: "#ff9a6b", weather: "meteor", weatherRate: 2.2, duration: 20 },
    });
  }

  if (/(airplane|aeroplane|plane|aircraft|jet)/.test(q) && /(gun|shoot|fire|launch|blaster|cannon)/.test(q)) {
    return localRaw("weapon", "Airplane Gun", gunVisuals("#7dd3fc"), {
      description: "Launches tiny propeller planes that explode.",
      projectile_visuals: airplaneVisuals(1),
      physics: { mass: 0.4, restitution: 0.2, friction: 0.4, collider: "sphere" },
      action_behavior: { mode: "projectile", projectile: "Airplane", speed: 54, gravityScale: 0.12, onImpact: "explode", explosionRadius: 3.2, explosionForce: 9, cooldown: 0.28, spawnCount: 1, spread: 0.015, projectileMass: 0.5, projectileScale: 0.9 },
    });
  }

  if (/(trampolin|jump ?pad|bouncy ?pad|spring)/.test(q)) {
    return localRaw("physics_object", giant ? "Giant Trampoline" : "Bouncy Trampoline", trampolineVisuals(), {
      description: "A springy pad. Jump on it!",
      physics: { mass: 28, restitution: 1.3, friction: 0.15, collider: "box", bouncy: true, angularDamping: 0.9 },
      action_behavior: { mode: "deploy", cooldown: 1.1 },
    });
  }

  if (/(tower|skyscraper|stack|building)/.test(q)) {
    return localRaw("physics_object", giant ? "Giant Tower" : "Tower Stack", towerBlockVisuals("#ffd166"), {
      description: "A tall stack of physics blocks.",
      physics: { mass: 3, restitution: 0.08, friction: 0.75, collider: "box" },
      action_behavior: { mode: "deploy", cooldown: 2.6 },
      structure: "tower", structureCount: giant ? 10 : 8,
    });
  }

  if (/(low gravity|zero gravity|moon|anti.?grav|float|space)/.test(q)) {
    return localRaw("world_event", "Low Gravity", [], {
      description: "Gravity is turned way down.",
      world_effect: { gravity: 0.22, skyColor: "#6ea8ff", weather: "none", duration: 24 },
    });
  }

  if (/(car|truck|jeep|vehicle|drive|kart|racer|bus)/.test(q)) {
    const square = /(square|cube|blocky)/.test(q);
    return localRaw("vehicle", square ? "Square-Wheel Car" : "Dune Cruiser", carVisuals(square, giant), {
      description: "A drivable machine. Joystick steers.",
      physics: { mass: 330, restitution: 0.08, friction: 0.8, collider: "box", angularDamping: 1 },
      action_behavior: { mode: "drive", maxSpeed: giant ? 15 : 19, acceleration: 24, turnSpeed: 2.3, cooldown: 0.6 },
    });
  }

  if (wantsRain && wantsExplode) {
    return localRaw("world_event", "Explosive Rain", [], {
      description: "Meteors of pure boom fall from the sky.",
      projectile_visuals: fireballVisuals(),
      action_behavior: { onImpact: "explode", explosionRadius: 4.4, explosionForce: 15 },
      world_effect: { gravity: 1, skyColor: "#ff9a6b", weather: "meteor", weatherRate: 2.4, duration: 18 },
    });
  }
  if (wantsRain) {
    return localRaw("world_event", "Rainstorm", [], {
      description: "A cool rain rolls in.",
      world_effect: { gravity: 1, skyColor: "#7d90a6", weather: "rain", weatherRate: 3, duration: 28 },
    });
  }

  if (wantsExplode) {
    return localRaw("weapon", giant ? "Mega Boom Cannon" : "Boom Cannon", gunVisuals("#ff8a4c"), {
      description: "Lobs bombs with a big blast radius.",
      projectile_visuals: bombVisuals(),
      physics: { mass: 0.6, restitution: 0.15, collider: "sphere" },
      action_behavior: { mode: "projectile", projectile: "Bomb", speed: 30, gravityScale: 0.9, onImpact: "explode", explosionRadius: 6, explosionForce: 21, cooldown: 0.75, projectileMass: 2.5, projectileScale: 1.1 },
    });
  }

  if (/(bouncy ball|beach ball|ball|sphere|orb)/.test(q)) {
    return localRaw("physics_object", giant ? "Giant Bouncy Ball" : "Bouncy Ball", ballVisuals(choice(LOCAL_PALETTE)), {
      description: "A very energetic physics ball.",
      physics: { mass: 2.6, restitution: 1.35, friction: 0.12, collider: "sphere", bouncy: true, angularDamping: 0.12 },
      action_behavior: { mode: "deploy", cooldown: 0.5 },
    });
  }

  if (/(laser|plasma|beam|ray ?gun|pulse)/.test(q)) {
    return localRaw("weapon", "Plasma Lance", gunVisuals("#6ee7c8"), {
      description: "A rapid-fire energy lance.",
      projectile_visuals: laserVisuals(),
      physics: { mass: 0.2, restitution: 0.1, collider: "sphere" },
      action_behavior: { mode: "projectile", projectile: "Plasma", speed: 72, gravityScale: 0, onImpact: "explode", explosionRadius: 2.2, explosionForce: 6, cooldown: 0.16, projectileMass: 0.2, projectileScale: 1 },
    });
  }

  if (/(gun|shoot|fire|launch|blaster|cannon|rifle|weapon)/.test(q)) {
    const seed = hashString(q);
    const color = LOCAL_PALETTE[seed % LOCAL_PALETTE.length];
    return localRaw("weapon", titleFromPrompt(prompt), gunVisuals(color), {
      description: "A custom blaster forged from your words.",
      projectile_visuals: orbVisuals(color),
      physics: { mass: 0.4, restitution: 0.3, collider: "sphere" },
      action_behavior: { mode: "projectile", projectile: "Orb", speed: 44, gravityScale: 0.4, onImpact: "explode", explosionRadius: 3.2, explosionForce: 10, cooldown: 0.35, projectileMass: 0.5 },
    });
  }

  // Anything else becomes a playful one-of-a-kind physics sculpture.
  const seed = hashString(q || "mystery");
  const rnd = mulberry32(seed);
  const palette = LOCAL_PALETTE.slice().sort(() => rnd() - 0.5);
  const visuals = [
    vz("cylinder", [0, -0.45, 0], [1.1, 0.35, 1.1], palette[0], [0, 0, 0], { metalness: 0.4, roughness: 0.4 }),
  ];
  const count = 3 + Math.floor(rnd() * 4);
  const shapes = ["box", "sphere", "cone", "cylinder", "torus"];
  for (let i = 0; i < count; i++) {
    const shape = shapes[Math.floor(rnd() * shapes.length)];
    const size = 0.35 + rnd() * 0.65;
    visuals.push(vz(
      shape,
      [(rnd() - 0.5) * 0.9, -0.1 + i * 0.42, (rnd() - 0.5) * 0.9],
      shape === "box" ? [size, size * (0.6 + rnd()), size] : [size, size, size],
      palette[(i + 1) % palette.length],
      [rnd() * 360, rnd() * 360, rnd() * 360],
      { metalness: 0.2 + rnd() * 0.5, roughness: 0.2 + rnd() * 0.5, emissive: rnd() > 0.65 ? palette[(i + 2) % palette.length] : null }
    ));
  }
  return localRaw("physics_object", titleFromPrompt(prompt), visuals, {
    description: "A strange artifact materialized from your prompt.",
    physics: { mass: 5, restitution: 0.35, friction: 0.5, collider: "box" },
    action_behavior: { mode: "deploy", cooldown: 0.9 },
  });
}

function localForge(prompt) {
  const spec = normalizeSpec(buildLocalRaw(prompt), prompt);
  if (spec) spec.source = "local";
  return spec;
}
