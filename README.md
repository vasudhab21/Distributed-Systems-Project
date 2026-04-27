## ShardWorld

Prototype distributed world server in Go with:

- `gateway`: WebSocket gateway and static UI server
- `zone-server`: gRPC shard server with Redis-backed leader election
- `coordinator`: simple heartbeat process
- `ui`: lightweight Three.js client

## What works now

- Go dependencies are downloaded
- `go build ./...` succeeds
- `go test ./...` succeeds

## Prerequisites

- Go 1.22+
- Docker Desktop running

## Run with Docker Compose

From the repo root:

```powershell
docker compose up --build
```

Then open [http://localhost:8080](http://localhost:8080).

Health check:

```powershell
Invoke-WebRequest http://localhost:8080/healthz
```

## Multiplayer Access

Players can join from different systems by opening the same gateway link in their browser.

- Player view: `http://YOUR_HOST_OR_IP:8080`
- Admin panel: `http://YOUR_HOST_OR_IP:8080/admin`

For hosted deployments behind HTTPS, the client now automatically upgrades from `ws://` to `wss://`.

## Deployment Notes

- Only the `gateway` service needs to be publicly reachable.
- Redis and the zone servers stay on the internal Docker network.
- If you host this on a VM or another machine, open port `8080` and share that one link with players.
- If you use a domain and reverse proxy later, point it at the gateway service.

## VS Code Terminal Commands

Run from the repo root in the integrated terminal:

```powershell
docker compose up --build
```

Stop everything:

```powershell
docker compose down
```

If you want other devices on the same Wi-Fi/LAN to join, find your machine IP:

```powershell
ipconfig
```

Then share:

- Player link: `http://YOUR_LAN_IP:8080`
- Admin link: `http://YOUR_LAN_IP:8080/admin`

## Demo Helpers

- `Makefile`: quick Linux/EC2 commands like `make up`, `make ps`, `make logs-gateway`
- [PRESENTATION_DAY.md](C:\Users\Rithvik Reddy\Desktop\Distributed-Systems-Project-main\PRESENTATION_DAY.md): AWS presentation-day checklist and exact commands

## Notes for this workspace

This repo may use local cache folders during development:

- `.gocache`
- `.gomodcache`
