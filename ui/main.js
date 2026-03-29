import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

const canvas = document.getElementById("game");

const pidLabel = document.getElementById("pid");
const zoneLabel = document.getElementById("zone");
const posLabel = document.getElementById("pos");

// world constants
const WORLD_SIZE = 600;
const ZONE_SIZE = 200;
const GRID_SIZE = 3;

// ---------- THREE SETUP ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0b0b);

const camera = new THREE.PerspectiveCamera(
  75,
  window.innerWidth / window.innerHeight,
  0.1,
  2000
);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);

// lights
const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(200, 400, 200);
scene.add(dirLight);

// ---------- FLOOR ----------
const groundGeo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE);
const groundMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
scene.add(ground);

// grid helper
const grid = new THREE.GridHelper(WORLD_SIZE, 30, 0xffffff, 0x444444);
grid.position.set(WORLD_SIZE / 2, 0.01, WORLD_SIZE / 2);
scene.add(grid);

// ---------- ZONE FLOOR COLORS ----------
function zoneColor(row, col) {
  const colors = [
    0x3a3a3a, 0x2f2f3f, 0x3f2f2f,
    0x2f3f2f, 0x3f3f2f, 0x2f3f3f,
    0x3f2f3f, 0x2f2f2f, 0x3a3030
  ];

  return colors[row * GRID_SIZE + col] || 0x333333;
}

for (let row = 0; row < GRID_SIZE; row++) {
  for (let col = 0; col < GRID_SIZE; col++) {
    const geo = new THREE.PlaneGeometry(ZONE_SIZE, ZONE_SIZE);
    const mat = new THREE.MeshStandardMaterial({
      color: zoneColor(row, col),
      transparent: true,
      opacity: 0.85
    });

    const tile = new THREE.Mesh(geo, mat);
    tile.rotation.x = -Math.PI / 2;

    const centerX = col * ZONE_SIZE + ZONE_SIZE / 2;
    const centerZ = row * ZONE_SIZE + ZONE_SIZE / 2;

    tile.position.set(centerX, 0.02, centerZ);
    scene.add(tile);
  }
}

// ---------- ZONE BOUNDARY WALLS ----------
function createBoundaryWall(x, z, width, depth) {
  const geo = new THREE.BoxGeometry(width, 40, depth);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const wall = new THREE.Mesh(geo, mat);
  wall.position.set(x, 20, z);
  scene.add(wall);
}

// vertical walls at x=200, x=400
createBoundaryWall(200, WORLD_SIZE / 2, 2, WORLD_SIZE);
createBoundaryWall(400, WORLD_SIZE / 2, 2, WORLD_SIZE);

// horizontal walls at z=200, z=400
createBoundaryWall(WORLD_SIZE / 2, 200, WORLD_SIZE, 2);
createBoundaryWall(WORLD_SIZE / 2, 400, WORLD_SIZE, 2);

// ---------- PLAYER ----------
function createPlayerMesh(color) {
  const geo = new THREE.BoxGeometry(12, 12, 12);
  const mat = new THREE.MeshStandardMaterial({ color });
  return new THREE.Mesh(geo, mat);
}

const myMesh = createPlayerMesh(0x00aaff);
myMesh.position.set(50, 6, 50);
scene.add(myMesh);

camera.position.set(50, 80, 120);
camera.lookAt(myMesh.position);

// ---------- OTHER PLAYERS ----------
let myPlayerID = null;
let currentZone = "unknown";

const players = {}; // playerId -> mesh

// ---------- NETWORK ----------
const ws = new WebSocket(`ws://${window.location.host}/ws`);

ws.onopen = () => {
  console.log("Connected to gateway");
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "welcome") {
    myPlayerID = msg.playerId;
    currentZone = msg.zone;

    pidLabel.innerText = myPlayerID.substring(0, 8);
    zoneLabel.innerText = currentZone;
  }

  if (msg.type === "zone_change") {
    currentZone = msg.zone;
    zoneLabel.innerText = currentZone;

    // clear players from old zone
    for (const id in players) {
      scene.remove(players[id]);
      delete players[id];
    }
  }

  if (msg.type === "update") {
    const p = msg.payload;
    const id = p.playerId;

    if (id === myPlayerID) {
      myMesh.position.set(p.x, 6, p.y);
      return;
    }

    if (!players[id]) {
      const mesh = createPlayerMesh(0x00ff44);
      mesh.position.set(p.x, 6, p.y);
      scene.add(mesh);
      players[id] = mesh;
    } else {
      players[id].position.set(p.x, 6, p.y);
    }
  }
};

// ---------- INPUT ----------
const keys = {};

window.addEventListener("keydown", (e) => {
  keys[e.key.toLowerCase()] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.key.toLowerCase()] = false;
});

function sendMove(dx, dy) {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(JSON.stringify({
    type: "move",
    dx,
    dy
  }));
}

let moveCooldown = 0;

function handleInput(delta) {
  moveCooldown -= delta;
  if (moveCooldown > 0) return;

  let dx = 0;
  let dy = 0;

  if (keys["w"] || keys["arrowup"]) dy -= 5;
  if (keys["s"] || keys["arrowdown"]) dy += 5;
  if (keys["a"] || keys["arrowleft"]) dx -= 5;
  if (keys["d"] || keys["arrowright"]) dx += 5;

  if (dx !== 0 || dy !== 0) {
    sendMove(dx, dy);
    moveCooldown = 0.05;
  }
}

// ---------- RENDER LOOP ----------
let lastTime = performance.now();

function animate() {
  requestAnimationFrame(animate);

  const now = performance.now();
  const delta = (now - lastTime) / 1000;
  lastTime = now;

  handleInput(delta);

  // camera follow smooth
  const targetCamPos = new THREE.Vector3(
    myMesh.position.x,
    myMesh.position.y + 80,
    myMesh.position.z + 120
  );

  camera.position.lerp(targetCamPos, 0.1);
  camera.lookAt(myMesh.position);

  posLabel.innerText = `(${myMesh.position.x.toFixed(0)}, ${myMesh.position.y.toFixed(0)}, ${myMesh.position.z.toFixed(0)})`;

  renderer.render(scene, camera);
}

animate();

// resize handler
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
