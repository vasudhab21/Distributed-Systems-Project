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

## Notes for this workspace

This repo may use local cache folders during development:

- `.gocache`
- `.gomodcache`
