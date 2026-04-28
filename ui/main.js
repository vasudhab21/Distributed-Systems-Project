import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const pidLabel = document.getElementById("pid");
const zoneLabel = document.getElementById("zone");
const posLabel = document.getElementById("pos");
const onlineCountEl = document.getElementById("online-count");
const netStatusEl = document.getElementById("net-status");
const nameOverlayEl = document.getElementById("name-overlay");
const nameFormEl = document.getElementById("name-form");
const nameInputEl = document.getElementById("player-name-input");

const WORLD_SIZE = 600;
const ZONE_SIZE = 200;
const GRID_SIZE = 3;
const MOVE_SPEED = 90;
const SEND_RATE_MS = 80;
const REMOTE_STALE_MS = 6000;
const REMOTE_SMOOTH = 0.17;
const LOCAL_RECONCILE = 0.2;
const NAME_STORAGE_KEY = "shardworld-player-name";

let myPlayerID = null;
let myPlayerName = "connecting...";
let currentZone = "unknown";
let pendingPlayerName = localStorage.getItem(NAME_STORAGE_KEY) || "";
let lastSendAt = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wsBase() {
  return window.location.protocol === "https:" ? "wss:" : "ws:";
}

function setConnectionState(label, toneClass) {
  netStatusEl.textContent = label;
  netStatusEl.className = `value ${toneClass}`;
}

function fallbackNameForId(id) {
  if (!id) return "Guest";
  return `Guest-${id.slice(0, 6)}`;
}

function displayName(playerName, playerId) {
  return playerName || fallbackNameForId(playerId);
}

function sendPreferredName() {
  const trimmed = nameInputEl.value.trim();
  if (trimmed) {
    pendingPlayerName = trimmed.slice(0, 24);
    localStorage.setItem(NAME_STORAGE_KEY, pendingPlayerName);
  }

  if (ws.readyState === WebSocket.OPEN && pendingPlayerName) {
    ws.send(JSON.stringify({ type: "set_name", name: pendingPlayerName }));
  }
}

nameInputEl.value = pendingPlayerName;

nameFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  sendPreferredName();
  nameOverlayEl.classList.add("hidden");
});

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07111f);
scene.fog = new THREE.Fog(0x07111f, 180, 760);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);
scene.add(new THREE.AmbientLight(0xffffff, 0.9));

const hemiLight = new THREE.HemisphereLight(0xbfe9ff, 0x172033, 0.75);
hemiLight.position.set(0, 300, 0);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(220, 420, 180);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 900;
sun.shadow.camera.left = -400;
sun.shadow.camera.right = 400;
sun.shadow.camera.top = 400;
sun.shadow.camera.bottom = -400;
scene.add(sun);

const rimLight = new THREE.DirectionalLight(0x38bdf8, 0.45);
rimLight.position.set(-140, 100, -80);
scene.add(rimLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.82, metalness: 0.08 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(WORLD_SIZE, 30, 0x274156, 0x0f2234);
grid.position.set(WORLD_SIZE / 2, 0.01, WORLD_SIZE / 2);
scene.add(grid);

const zoneTint = [
  0x0f172a, 0x132338, 0x0f172a,
  0x132338, 0x102030, 0x132338,
  0x0f172a, 0x132338, 0x0f172a,
];

for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    const tile = new THREE.Mesh(
      new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE),
      new THREE.MeshStandardMaterial({
        color: zoneTint[row * GRID_SIZE + col],
        transparent: true,
        opacity: 0.45,
      })
    );
    tile.rotation.x = -Math.PI / 2;
    tile.position.set(col * ZONE_SIZE + ZONE_SIZE / 2, 0.02, row * ZONE_SIZE + ZONE_SIZE / 2);
    tile.receiveShadow = true;
    scene.add(tile);
  }
}

function createBoundaryWall(x, z, width, depth) {
  const wall = new THREE.Mesh(
    new THREE.BoxGeometry(width, 36, depth),
    new THREE.MeshStandardMaterial({
      color: 0x22d3ee,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.45,
      transparent: true,
      opacity: 0.82,
    })
  );
  wall.position.set(x, 18, z);
  wall.castShadow = true;
  scene.add(wall);
}

createBoundaryWall(200, WORLD_SIZE / 2, 2, WORLD_SIZE);
createBoundaryWall(400, WORLD_SIZE / 2, 2, WORLD_SIZE);
createBoundaryWall(WORLD_SIZE / 2, 200, WORLD_SIZE, 2);
createBoundaryWall(WORLD_SIZE / 2, 400, WORLD_SIZE, 2);

const PALETTE = [0xe11d48, 0xf97316, 0xeab308, 0x22c55e, 0x06b6d4, 0x3b82f6, 0x8b5cf6, 0xec4899];
const playerColorMap = {};
let colorIndex = 0;

function getPlayerColor(id) {
  if (!playerColorMap[id]) {
    playerColorMap[id] = PALETTE[colorIndex % PALETTE.length];
    colorIndex++;
  }
  return playerColorMap[id];
}

function createHumanoid(bodyHex, isLocal) {
  const group = new THREE.Group();
  const skin = 0xf5cba7;
  const bodyCol = new THREE.Color(bodyHex);
  const darkCol = bodyCol.clone().multiplyScalar(0.74);

  function box(w, h, d, col) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color: col })
    );
    mesh.castShadow = true;
    return mesh;
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
    const stripe = box(0.66, 0.12, 0.34, 0x7dd3fc);
    stripe.position.set(0, 1.45, 0);
    group.add(stripe);
  }

  const armL = box(0.25, 0.78, 0.25, bodyCol);
  armL.position.set(-0.47, 1.22, 0);
  group.add(armL);

  const armR = armL.clone();
  armR.position.set(0.47, 1.22, 0);
  group.add(armR);

  const head = box(0.52, 0.52, 0.5, skin);
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
      new THREE.MeshLambertMaterial({ color: 0x7dd3fc })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.06;
    group.add(ring);
  }

  group.userData = { armL, armR, legL, legR, phase: Math.random() * Math.PI * 2, vx: 0, vz: 0 };
  return group;
}

function makeNameplate(name, bodyHex, isLocal) {
  const c = document.createElement("canvas");
  c.width = 280;
  c.height = 60;
  const ctx = c.getContext("2d");
  const col = `#${bodyHex.toString(16).padStart(6, "0")}`;

  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = "rgba(3, 7, 18, 0.84)";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5;
  ctx.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);

  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(24, 30, 8, 0, Math.PI * 2);
  ctx.fill();

  if (isLocal) {
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 11px Segoe UI, Arial";
    ctx.fillText("YOU", 40, 19);
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 17px Segoe UI, Arial";
    ctx.fillText(name, 40, 40);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = "15px Segoe UI, Arial";
    ctx.fillText(name, 40, 36);
  }

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.8, 1.04, 1);
  return sprite;
}

function animateHumanoid(group, t) {
  const ud = group.userData;
  const speed = Math.hypot(ud.vx, ud.vz);
  const swing = speed > 0.1 ? Math.sin(t * 7 + ud.phase) * 0.42 : 0;
  ud.legL.rotation.x = swing;
  ud.legR.rotation.x = -swing;
  ud.armL.rotation.x = -swing * 0.58;
  ud.armR.rotation.x = swing * 0.58;
}

const mmCanvas = document.getElementById("mm");
const mmCtx = mmCanvas.getContext("2d");

const HUMANOID_SCALE = 5;
const NAMEPLATE_Y = HUMANOID_SCALE * 2.7;
const myMesh = createHumanoid(0x2196f3, true);
myMesh.scale.setScalar(HUMANOID_SCALE);
scene.add(myMesh);

let myPlate = null;
const localState = {
  predicted: new THREE.Vector3(50, 0, 50),
  authoritative: new THREE.Vector3(50, 0, 50),
  velocity: new THREE.Vector3(),
};

myMesh.position.copy(localState.predicted);
camera.position.set(50, 90, 170);
camera.lookAt(myMesh.position);

const players = {};

function setMyDisplayName(name) {
  myPlayerName = name;
  pidLabel.innerText = name;
  if (myPlate) {
    scene.remove(myPlate);
  }
  myPlate = makeNameplate(name, 0x2196f3, true);
  scene.add(myPlate);
}

function addRemotePlayer(id, playerName, x, z) {
  const color = getPlayerColor(id);
  const mesh = createHumanoid(color, false);
  mesh.scale.setScalar(HUMANOID_SCALE);
  mesh.position.set(x, 0, z);
  scene.add(mesh);

  const resolvedName = displayName(playerName, id);
  const plate = makeNameplate(resolvedName, color, false);
  plate.position.set(x, NAMEPLATE_Y, z);
  scene.add(plate);

  players[id] = {
    mesh,
    plate,
    playerName: resolvedName,
    target: new THREE.Vector3(x, 0, z),
    lastSeenAt: Date.now(),
  };
}

function updateRemotePlayerName(id, playerName) {
  const remote = players[id];
  if (!remote) return;
  const resolvedName = displayName(playerName, id);
  if (remote.playerName === resolvedName) return;
  remote.playerName = resolvedName;
  scene.remove(remote.plate);
  remote.plate = makeNameplate(resolvedName, getPlayerColor(id), false);
  scene.add(remote.plate);
}

function removeRemotePlayer(id) {
  if (!players[id]) return;
  scene.remove(players[id].mesh);
  scene.remove(players[id].plate);
  delete players[id];
}

function updateOnlineCount() {
  onlineCountEl.textContent = String(Object.keys(players).length + (myPlayerID ? 1 : 0));
}

function drawMinimap() {
  const size = 140;
  const padding = 4;
  const cell = (size - padding * 2) / 3;
  const scale = (size - padding * 2) / WORLD_SIZE;

  mmCtx.clearRect(0, 0, size, size);
  mmCtx.fillStyle = "rgba(3, 7, 18, 0.9)";
  mmCtx.fillRect(0, 0, size, size);
  mmCtx.strokeStyle = "rgba(255,255,255,0.06)";
  mmCtx.lineWidth = 0.5;

  for (let i = 0; i <= size; i += 14) {
    mmCtx.beginPath();
    mmCtx.moveTo(i, 0);
    mmCtx.lineTo(i, size);
    mmCtx.stroke();
    mmCtx.beginPath();
    mmCtx.moveTo(0, i);
    mmCtx.lineTo(size, i);
    mmCtx.stroke();
  }

  mmCtx.strokeStyle = "rgba(34, 211, 238, 0.45)";
  mmCtx.lineWidth = 1.4;
  for (let i = 0; i <= 3; i++) {
    const value = padding + cell * i;
    mmCtx.beginPath();
    mmCtx.moveTo(value, padding);
    mmCtx.lineTo(value, size - padding);
    mmCtx.stroke();
    mmCtx.beginPath();
    mmCtx.moveTo(padding, value);
    mmCtx.lineTo(size - padding, value);
    mmCtx.stroke();
  }

  for (const id in players) {
    const p = players[id];
    const px = padding + p.mesh.position.x * scale;
    const pz = padding + p.mesh.position.z * scale;
    mmCtx.fillStyle = `#${getPlayerColor(id).toString(16).padStart(6, "0")}`;
    mmCtx.beginPath();
    mmCtx.arc(px, pz, 3.4, 0, Math.PI * 2);
    mmCtx.fill();
  }

  const lx = padding + myMesh.position.x * scale;
  const lz = padding + myMesh.position.z * scale;
  mmCtx.fillStyle = "#7dd3fc";
  mmCtx.strokeStyle = "#ffffff";
  mmCtx.lineWidth = 1.5;
  mmCtx.beginPath();
  mmCtx.arc(lx, lz, 5.5, 0, Math.PI * 2);
  mmCtx.fill();
  mmCtx.stroke();

  mmCtx.fillStyle = "rgba(255,255,255,0.35)";
  mmCtx.font = "9px Arial";
  mmCtx.fillText(currentZone, 6, size - 6);
}

const ws = new WebSocket(`${wsBase()}//${window.location.host}/ws`);
setConnectionState("connecting", "highlight-warn");

ws.onopen = () => {
  setConnectionState("live", "highlight-green");
};

ws.onmessage = (event) => {
  let msg;
  try {
    msg = JSON.parse(event.data);
  } catch {
    return;
  }

  if (msg.type === "welcome") {
    myPlayerID = msg.playerId;
    currentZone = msg.zone;
    zoneLabel.innerText = currentZone;
    setMyDisplayName(displayName(msg.playerName, myPlayerID));
    if (pendingPlayerName) {
      sendPreferredName();
    }
    updateOnlineCount();
    return;
  }

  if (msg.type === "name_ack") {
    setMyDisplayName(displayName(msg.playerName, myPlayerID));
    return;
  }

  if (msg.type === "player_profile") {
    if (msg.playerId === myPlayerID) {
      setMyDisplayName(displayName(msg.playerName, myPlayerID));
      return;
    }
    if (players[msg.playerId]) {
      updateRemotePlayerName(msg.playerId, msg.playerName);
    }
    return;
  }

  if (msg.type === "zone_change") {
    currentZone = msg.zone;
    zoneLabel.innerText = currentZone;
    for (const id in players) {
      removeRemotePlayer(id);
    }
    updateOnlineCount();
    return;
  }

  if (msg.type === "update") {
    const payload = msg.payload;
    const id = payload.playerId;
    const next = new THREE.Vector3(payload.x, 0, payload.y);

    if (id === myPlayerID) {
      localState.authoritative.copy(next);
      return;
    }

    if (!players[id]) {
      addRemotePlayer(id, payload.playerName, payload.x, payload.y);
    } else {
      const remote = players[id];
      remote.lastSeenAt = Date.now();
      remote.target.copy(next);
      updateRemotePlayerName(id, payload.playerName);
    }

    updateOnlineCount();
    return;
  }

  if (msg.type === "player_leave") {
    removeRemotePlayer(msg.playerId);
    updateOnlineCount();
  }
};

ws.onclose = () => {
  zoneLabel.innerText = "offline";
  setConnectionState("offline", "highlight-red");
};

ws.onerror = () => {
  setConnectionState("error", "highlight-red");
};

const keys = {};
window.addEventListener("keydown", (event) => {
  keys[event.key.toLowerCase()] = true;
});
window.addEventListener("keyup", (event) => {
  keys[event.key.toLowerCase()] = false;
});

function getInputVector() {
  let x = 0;
  let z = 0;
  if (keys["w"] || keys["arrowup"]) z -= 1;
  if (keys["s"] || keys["arrowdown"]) z += 1;
  if (keys["a"] || keys["arrowleft"]) x -= 1;
  if (keys["d"] || keys["arrowright"]) x += 1;

  const vec = new THREE.Vector2(x, z);
  if (vec.lengthSq() > 1) vec.normalize();
  return vec;
}

function sendMovement(inputVec, delta) {
  if (ws.readyState !== WebSocket.OPEN || inputVec.lengthSq() === 0) return;
  const now = performance.now();
  if (now - lastSendAt < SEND_RATE_MS) return;
  lastSendAt = now;

  const step = MOVE_SPEED * Math.max(delta, SEND_RATE_MS / 1000);
  const dx = Math.round(inputVec.x * step);
  const dy = Math.round(inputVec.y * step);
  if (dx === 0 && dy === 0) return;
  ws.send(JSON.stringify({ type: "move", dx, dy }));
}

function updateLocalPlayer(delta) {
  const inputVec = getInputVector();
  const moveAmount = MOVE_SPEED * delta;

  localState.velocity.set(inputVec.x * MOVE_SPEED, 0, inputVec.y * MOVE_SPEED);
  localState.predicted.x = clamp(localState.predicted.x + inputVec.x * moveAmount, 0, WORLD_SIZE);
  localState.predicted.z = clamp(localState.predicted.z + inputVec.y * moveAmount, 0, WORLD_SIZE);
  localState.predicted.lerp(localState.authoritative, LOCAL_RECONCILE);

  myMesh.position.copy(localState.predicted);
  myMesh.userData.vx = localState.velocity.x / MOVE_SPEED;
  myMesh.userData.vz = localState.velocity.z / MOVE_SPEED;

  if (inputVec.lengthSq() > 0.01) {
    myMesh.rotation.y = Math.atan2(inputVec.x, inputVec.y);
  }

  sendMovement(inputVec, delta);
}

function updateRemotePlayers() {
  const now = Date.now();
  for (const id in players) {
    const remote = players[id];
    if (now - remote.lastSeenAt > REMOTE_STALE_MS) {
      removeRemotePlayer(id);
      continue;
    }

    const delta = remote.target.clone().sub(remote.mesh.position);
    remote.mesh.userData.vx = delta.x;
    remote.mesh.userData.vz = delta.z;
    remote.mesh.position.lerp(remote.target, REMOTE_SMOOTH);

    if (delta.lengthSq() > 0.02) {
      remote.mesh.rotation.y = Math.atan2(delta.x, delta.z);
    }
  }
}

const clock = new THREE.Clock();
const cameraOffset = new THREE.Vector3(0, 86, 138);
const cameraTarget = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const t = clock.getElapsedTime();

  updateLocalPlayer(delta);
  updateRemotePlayers();

  animateHumanoid(myMesh, t);
  for (const id in players) {
    const remote = players[id];
    animateHumanoid(remote.mesh, t);
    remote.plate.position.set(remote.mesh.position.x, NAMEPLATE_Y, remote.mesh.position.z);
    remote.plate.quaternion.copy(camera.quaternion);
  }

  if (myPlate) {
    myPlate.position.set(myMesh.position.x, NAMEPLATE_Y, myMesh.position.z);
    myPlate.quaternion.copy(camera.quaternion);
  }

  cameraTarget.set(myMesh.position.x + cameraOffset.x, cameraOffset.y, myMesh.position.z + cameraOffset.z);
  camera.position.lerp(cameraTarget, 0.08);
  camera.lookAt(myMesh.position.x, myMesh.position.y + 10, myMesh.position.z);

  posLabel.innerText = `(${myMesh.position.x.toFixed(0)}, 0, ${myMesh.position.z.toFixed(0)})`;
  drawMinimap();
  updateOnlineCount();
  renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
