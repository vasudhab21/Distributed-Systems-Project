import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

// ─────────────────────────────────────────────
//  HUD ELEMENTS
// ─────────────────────────────────────────────
const pidLabel        = document.getElementById("pid");
const zoneLabel       = document.getElementById("zone");
const posLabel        = document.getElementById("pos");
const onlineCountEl   = document.getElementById("online-count");

// ─────────────────────────────────────────────
//  WORLD CONSTANTS  (must match server)
// ─────────────────────────────────────────────
const WORLD_SIZE = 600;
const ZONE_SIZE  = 200;
const GRID_SIZE  = 3;

// ─────────────────────────────────────────────
//  PLAYER NAMING LOGIC (ADDED)
// ─────────────────────────────────────────────
function getFriendlyName(id, isLocal) {
  if (isLocal) {
    const port = parseInt(window.location.port);
    // Map port 3000 -> Player 1, 3001 -> Player 2, etc.
    if (port >= 3000 && port < 4000) return "Player " + (port - 2999);
    // Map port 8080 -> Player 1, 8081 -> Player 2, etc.
    if (port >= 8080) return "Player " + (port - 8079);
    return "Player 1"; // Default fallback
  }
  // For remote players, generate a deterministic number (2-10) based on their ID string
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  const num = (Math.abs(hash) % 9) + 2; 
  return "Player " + num;
}

// ─────────────────────────────────────────────
//  RENDERER + SCENE + CAMERA
// ─────────────────────────────────────────────
const canvas = document.getElementById("game");

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type    = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
// IMPROVEMENT: Lighter, cleaner background color (Deep Slate)
scene.background = new THREE.Color(0x0f172a); 
scene.fog = new THREE.Fog(0x0f172a, 200, 700);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1200
);

// ─────────────────────────────────────────────
//  LIGHTING (REWORKED FOR BRIGHTNESS)
// ─────────────────────────────────────────────
// IMPROVEMENT: Increased ambient light for better visibility in shadows
scene.add(new THREE.AmbientLight(0xffffff, 0.8));

// IMPROVEMENT: Added a Hemisphere light to simulate sky bounce (fills the scene better)
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
hemiLight.position.set(0, 300, 0);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(200, 400, 200);
sun.castShadow = true;
sun.shadow.mapSize.width  = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near    = 1;
sun.shadow.camera.far     = 900;
sun.shadow.camera.left    = -400;
sun.shadow.camera.right   =  400;
sun.shadow.camera.top     =  400;
sun.shadow.camera.bottom  = -400;
scene.add(sun);

const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.4);
rimLight.position.set(-100, 80, -100);
scene.add(rimLight);

// ─────────────────────────────────────────────
//  GROUND + GRID
// ─────────────────────────────────────────────
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
// IMPROVEMENT: Changed "muddy green" to a sleek dark slate grey
const groundMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
const ground    = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
ground.receiveShadow = true;
scene.add(ground);

// IMPROVEMENT: Cleaner grid lines (Subtle blue-grey)
const grid = new THREE.GridHelper(WORLD_SIZE, 30, 0x334155, 0x1e293b);
grid.position.set(WORLD_SIZE / 2, 0.01, WORLD_SIZE / 2);
scene.add(grid);

// ─────────────────────────────────────────────
//  ZONE FLOOR TILES
// ─────────────────────────────────────────────
// IMPROVEMENT: Adjusted zone palette to be more vibrant and less muddy
const ZONE_COLORS = [
  0x1e293b, 0x334155, 0x1e293b,
  0x334155, 0x1e293b, 0x334155,
  0x1e293b, 0x334155, 0x1e293b,
];

for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    const geo = new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE);
    const mat = new THREE.MeshStandardMaterial({
      color: ZONE_COLORS[row * GRID_SIZE + col] || 0x1e293b,
      transparent: true,
      opacity: 0.4, // Made more transparent to keep it clean
    });
    const tile = new THREE.Mesh(geo, mat);
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(col * ZONE_SIZE + ZONE_SIZE / 2, 0.02, row * ZONE_SIZE + ZONE_SIZE / 2);
    tile.receiveShadow = true;
    scene.add(tile);
  }
}

// ─────────────────────────────────────────────
//  ZONE BOUNDARY WALLS
// ─────────────────────────────────────────────
function createBoundaryWall(x, z, width, depth) {
  const geo  = new THREE.BoxGeometry(width, 40, depth);
  // IMPROVEMENT: Changed red to a vibrant "Neon Cyan" for a clean tech look
  const mat  = new THREE.MeshStandardMaterial({ 
    color: 0x0ea5e9, 
    emissive: 0x0284c7, 
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.8
  });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(x, 20, z);
  wall.castShadow = true;
  scene.add(wall);
}

createBoundaryWall(200, WORLD_SIZE / 2, 2, WORLD_SIZE);
createBoundaryWall(400, WORLD_SIZE / 2, 2, WORLD_SIZE);
createBoundaryWall(WORLD_SIZE / 2, 200, WORLD_SIZE, 2);
createBoundaryWall(WORLD_SIZE / 2, 400, WORLD_SIZE, 2);

// ─────────────────────────────────────────────
//  COLOUR PALETTE (UNTOUCHED)
// ─────────────────────────────────────────────
const PALETTE = [
  0xE91E63, 0x4CAF50, 0xFF9800, 0x9C27B0,
  0x00BCD4, 0xFFEB3B, 0xFF5722, 0x8BC34A,
  0x03A9F4, 0xF44336, 0x009688, 0xCDDC39,
];

const playerColorMap = {}; 
let   colorIndex      = 0;

function getPlayerColor(id) {
  if (!playerColorMap[id]) {
    playerColorMap[id] = PALETTE[colorIndex % PALETTE.length];
    colorIndex++;
  }
  return playerColorMap[id];
}

// ─────────────────────────────────────────────
//  HUMANOID BUILDER (UNTOUCHED)
// ─────────────────────────────────────────────
function createHumanoid(bodyHex, isLocal) {
  const group   = new THREE.Group();
  const SKIN    = 0xF5CBA7;
  const bodyCol = new THREE.Color(bodyHex);
  const darkCol = bodyCol.clone().multiplyScalar(0.75);

  function box(w, h, d, col) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: col })
    );
    m.castShadow = true;
    return m;
  }

  const legL = box(0.28, 0.9, 0.28, darkCol);
  legL.position.set(-0.16, 0.45, 0);
  group.add(legL);

  const legR = legL.clone();
  legR.position.set(0.16, 0.45, 0);
  group.add(legR);

  const torso = box(0.65, 0.88, 0.33, bodyCol);
  torso.position.set(0, 1.29, 0);
  group.add(torso);

  if (isLocal) {
    const stripe = box(0.66, 0.12, 0.34, 0x7fd4ff);
    stripe.position.set(0, 1.45, 0);
    group.add(stripe);
  }

  const armL = box(0.25, 0.78, 0.25, bodyCol);
  armL.position.set(-0.47, 1.22, 0);
  group.add(armL);

  const armR = armL.clone();
  armR.position.set(0.47, 1.22, 0);
  group.add(armR);

  const head = box(0.52, 0.52, 0.50, SKIN);
  head.position.set(0, 1.98, 0);
  group.add(head);

  const eyeGeo = new THREE.BoxGeometry(0.11, 0.09, 0.04);
  const eyeMat = new THREE.MeshLambertMaterial({ color: 0x111111 });

  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.12, 1.99, 0.25);
  group.add(eyeL);

  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.12, 1.99, 0.25);
  group.add(eyeR);

  const hair = box(0.54, 0.14, 0.52, bodyCol);
  hair.position.set(0, 2.28, 0);
  group.add(hair);

  if (isLocal) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.045, 8, 28),
      new THREE.MeshLambertMaterial({ color: 0x7fd4ff })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
  }

  group.userData = {
    armL, armR, legL, legR,
    phase: Math.random() * Math.PI * 2,
    vx: 0, vz: 0,
  };

  return group;
}

// ─────────────────────────────────────────────
//  (REST OF CODE REMAINS UNCHANGED)
// ─────────────────────────────────────────────
// ... makeNameplate, animateHumanoid, drawMinimap, network, and render loop remain same

function makeNameplate(name, bodyHex, isLocal) {
  const CW = 280, CH = 60;
  const c   = document.createElement("canvas");
  c.width   = CW;
  c.height  = CH;
  const ctx = c.getContext("2d");
  const col = "#" + bodyHex.toString(16).padStart(6, "0");

  ctx.clearRect(0, 0, CW, CH);
  const r = 12;
  ctx.fillStyle = "rgba(0,0,0,0.76)";
  ctx.beginPath();
  ctx.moveTo(r, 0);        ctx.lineTo(CW - r, 0);
  ctx.quadraticCurveTo(CW, 0,  CW, r);
  ctx.lineTo(CW, CH - r);  ctx.quadraticCurveTo(CW, CH, CW - r, CH);
  ctx.lineTo(r,  CH);      ctx.quadraticCurveTo(0, CH, 0, CH - r);
  ctx.lineTo(0,  r);       ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = col;
  ctx.lineWidth   = 2.5;
  ctx.beginPath();
  ctx.moveTo(r, 0);        ctx.lineTo(CW - r, 0);
  ctx.quadraticCurveTo(CW, 0,  CW, r);
  ctx.lineTo(CW, CH - r);  ctx.quadraticCurveTo(CW, CH, CW - r, CH);
  ctx.lineTo(r,  CH);      ctx.quadraticCurveTo(0, CH, 0, CH - r);
  ctx.lineTo(0,  r);       ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(26, CH / 2, 8, 0, Math.PI * 2);
  ctx.fill();

  if (isLocal) {
    ctx.fillStyle = "#7fd4ff";
    ctx.font      = "bold 11px Segoe UI, Arial";
    ctx.fillText("YOU", 42, 20);
    ctx.fillStyle = "#ffffff";
    ctx.font      = "bold 17px Segoe UI, Arial";
    ctx.fillText(name, 42, 40);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font      = "15px Segoe UI, Arial";
    ctx.fillText(name, 42, CH / 2 + 5);
  }

  const tex    = new THREE.CanvasTexture(c);
  const mat    = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.8, 1.04, 1);
  return sprite;
}

const HUMANOID_SCALE = 5;
const NAMEPLATE_Y    = HUMANOID_SCALE * 2.7;

let myPlayerID   = null;
let currentZone  = "unknown";
const myMesh  = createHumanoid(0x2196F3, true);
myMesh.scale.setScalar(HUMANOID_SCALE);
myMesh.position.set(50, 0, 50);
scene.add(myMesh);

let myPlate = null;
camera.position.set(50, 80, 170);
camera.lookAt(myMesh.position);

const players = {};

function addRemotePlayer(id, x, z) {
  const col     = getPlayerColor(id);
  const mesh    = createHumanoid(col, false);
  mesh.scale.setScalar(HUMANOID_SCALE);
  mesh.position.set(x, 0, z);
  scene.add(mesh);

  // LOGIC CHANGE: Use friendly name
  const displayName = getFriendlyName(id, false);
  const plate     = makeNameplate(displayName, col, false);
  plate.position.set(x, NAMEPLATE_Y, z);
  scene.add(plate);

  players[id] = { mesh, plate };
}

function removeRemotePlayer(id) {
  if (!players[id]) return;
  scene.remove(players[id].mesh);
  scene.remove(players[id].plate);
  delete players[id];
}

function animateHumanoid(group, t) {
  const ud    = group.userData;
  const speed = Math.sqrt(ud.vx * ud.vx + ud.vz * ud.vz);
  const sw    = speed > 0.5 ? Math.sin(t * 6 + ud.phase) * 0.42 : 0;
  ud.legL.rotation.x  =  sw;
  ud.legR.rotation.x  = -sw;
  ud.armL.rotation.x  = -sw * 0.55;
  ud.armR.rotation.x  =  sw * 0.55;
}

const mmCanvas = document.getElementById("mm");
const mmCtx    = mmCanvas.getContext("2d");

function drawMinimap() {
  const S = 140;
  mmCtx.clearRect(0, 0, S, S);
  mmCtx.fillStyle = "rgba(0,0,0,0.88)";
  mmCtx.fillRect(0, 0, S, S);
  mmCtx.strokeStyle = "rgba(255,255,255,0.06)";
  mmCtx.lineWidth   = 0.5;
  for (let i = 0; i <= S; i += 14) {
    mmCtx.beginPath(); mmCtx.moveTo(i, 0); mmCtx.lineTo(i, S); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(0, i); mmCtx.lineTo(S, i); mmCtx.stroke();
  }
  mmCtx.strokeStyle = "rgba(14, 165, 233, 0.5)"; // Blue minimap walls
  mmCtx.lineWidth   = 1.5;
  const m = 4;
  const cell = (S - m * 2) / 3;
  for (let i = 0; i <= 3; i++) {
    const v = m + cell * i;
    mmCtx.beginPath(); mmCtx.moveTo(m,  v); mmCtx.lineTo(S - m, v); mmCtx.stroke();
    mmCtx.beginPath(); mmCtx.moveTo(v,  m); mmCtx.lineTo(v, S - m); mmCtx.stroke();
  }
  const SCALE = (S - m * 2) / WORLD_SIZE;
  for (const id in players) {
    const p   = players[id];
    const px  = m + p.mesh.position.x * SCALE;
    const pz  = m + p.mesh.position.z * SCALE;
    const col = "#" + (getPlayerColor(id)).toString(16).padStart(6, "0");
    mmCtx.fillStyle = col;
    mmCtx.beginPath();
    mmCtx.arc(px, pz, 3.5, 0, Math.PI * 2);
    mmCtx.fill();
  }
  const lx = m + myMesh.position.x * SCALE;
  const lz = m + myMesh.position.z * SCALE;
  mmCtx.fillStyle   = "#7fd4ff";
  mmCtx.strokeStyle = "#ffffff";
  mmCtx.lineWidth   = 1.5;
  mmCtx.beginPath();
  mmCtx.arc(lx, lz, 5.5, 0, Math.PI * 2);
  mmCtx.fill();
  mmCtx.stroke();
  mmCtx.fillStyle = "rgba(255,255,255,0.25)";
  mmCtx.font      = "9px Arial";
  mmCtx.fillText(currentZone, 6, S - 5);
}

const ws = new WebSocket(`ws://${window.location.host}/ws`);
ws.onmessage = (event) => {
  let msg;
  try { msg = JSON.parse(event.data); } catch { return; }
  if (msg.type === "welcome") {
    myPlayerID  = msg.playerId;
    currentZone = msg.zone;
    
    // LOGIC CHANGE: Set HUD and Plate to "Player X"
    const myName = getFriendlyName(myPlayerID, true);
    pidLabel.innerText  = myName;
    zoneLabel.innerText = currentZone;
    if (myPlate) { scene.remove(myPlate); }
    myPlate = makeNameplate(myName, 0x2196F3, true);
    scene.add(myPlate);
  }
  if (msg.type === "zone_change") {
    currentZone = msg.zone;
    zoneLabel.innerText = currentZone;
    for (const id in players) removeRemotePlayer(id);
  }
  if (msg.type === "update") {
    const p  = msg.payload;
    const id = p.playerId;
    if (id === myPlayerID) {
      myMesh.position.lerp(new THREE.Vector3(p.x, 0, p.y), 0.3);
      return;
    }
    if (!players[id]) {
      addRemotePlayer(id, p.x, p.y);
    } else {
      const prev = players[id].mesh.position.clone();
      const next = new THREE.Vector3(p.x, 0, p.y);
      players[id].mesh.userData.vx = next.x - prev.x;
      players[id].mesh.userData.vz = next.z - prev.z;
      players[id].mesh.position.lerp(next, 0.25);
      const dx = next.x - prev.x, dz = next.z - prev.z;
      if (Math.abs(dx) > 0.1 || Math.abs(dz) > 0.1) {
        players[id].mesh.rotation.y = Math.atan2(dx, dz);
      }
    }
    onlineCountEl.textContent = Object.keys(players).length + 1;
  }
  if (msg.type === "player_leave") {
    removeRemotePlayer(msg.playerId);
    onlineCountEl.textContent = Object.keys(players).length + 1;
  }
};

const keys = {};
window.addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; });
window.addEventListener("keyup",   (e) => { keys[e.key.toLowerCase()] = false; });

function handleInput(delta) {
  let dx = 0, dy = 0;
  if (keys["w"] || keys["arrowup"])    dy -= 5;
  if (keys["s"] || keys["arrowdown"])  dy += 5;
  if (keys["a"] || keys["arrowleft"])  dx -= 5;
  if (keys["d"] || keys["arrowright"]) dx += 5;
  if (dx !== 0 || dy !== 0) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "move", dx, dy }));
    myMesh.rotation.y = Math.atan2(dx, dy);
  }
  myMesh.userData.vx = dx;
  myMesh.userData.vz = dy;
}

const clock = new THREE.Clock();
const camOffset = new THREE.Vector3(0, 80, 130);
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const t = clock.getElapsedTime();
  handleInput(delta);
  animateHumanoid(myMesh, t);
  for (const id in players) {
    animateHumanoid(players[id].mesh, t);
    players[id].plate.position.set(players[id].mesh.position.x, NAMEPLATE_Y, players[id].mesh.position.z);
    players[id].plate.quaternion.copy(camera.quaternion);
  }
  if (myPlate) {
    myPlate.position.set(myMesh.position.x, NAMEPLATE_Y, myMesh.position.z);
    myPlate.quaternion.copy(camera.quaternion);
  }
  camera.position.lerp(new THREE.Vector3(myMesh.position.x + camOffset.x, camOffset.y, myMesh.position.z + camOffset.z), 0.08);
  camera.lookAt(myMesh.position.x, myMesh.position.y + 10, myMesh.position.z);
  posLabel.innerText = `(${myMesh.position.x.toFixed(0)}, 0, ${myMesh.position.z.toFixed(0)})`;
  drawMinimap();
  renderer.render(scene, camera);
}
animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});