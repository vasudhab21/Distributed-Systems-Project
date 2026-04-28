package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"google.golang.org/grpc"

	"shardworld/pkg/cluster"
	"shardworld/pkg/discovery"
	worldpb "shardworld/proto/worldpb"
)

const GhostRange int32 = 60
const HysteresisMargin int32 = 20
const maxAdminLogEntries = 250

type ClientMessage struct {
	Type string `json:"type"`
	Dx   int32  `json:"dx"`
	Dy   int32  `json:"dy"`
	Name string `json:"name"`
}

type ServerMessage struct {
	Type       string                 `json:"type"`
	PlayerID   string                 `json:"playerId,omitempty"`
	PlayerName string                 `json:"playerName,omitempty"`
	Zone       string                 `json:"zone,omitempty"`
	Payload    map[string]interface{} `json:"payload,omitempty"`
}

type PlayerSnapshot struct {
	PlayerID   string `json:"playerId"`
	PlayerName string `json:"playerName"`
	Zone       string `json:"zone"`
	X          int32  `json:"x"`
	Y          int32  `json:"y"`
	UpdatedAt  string `json:"updatedAt"`
}

type AdminLogEntry struct {
	Timestamp string `json:"timestamp"`
	Message   string `json:"message"`
}

type AdminMessage struct {
	Type    string           `json:"type"`
	Players []PlayerSnapshot `json:"players,omitempty"`
	Logs    []AdminLogEntry  `json:"logs,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type ClientConn struct {
	ws         *websocket.Conn
	playerID   string
	playerName string
	zoneID     string
	mu         sync.Mutex
}

func (c *ClientConn) send(msg interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.WriteJSON(msg)
}

type AdminConn struct {
	ws *websocket.Conn
	mu sync.Mutex
}

func (a *AdminConn) send(msg interface{}) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.ws.WriteJSON(msg)
}

var hub = struct {
	mu      sync.RWMutex
	players map[string]PlayerSnapshot
	admins  map[*AdminConn]struct{}
	clients map[string]*ClientConn
	logs    []AdminLogEntry
}{
	players: make(map[string]PlayerSnapshot),
	admins:  make(map[*AdminConn]struct{}),
	clients: make(map[string]*ClientConn),
	logs:    make([]AdminLogEntry, 0, maxAdminLogEntries),
}

func main() {
	listenAddr := getenv("GATEWAY_ADDR", ":8080")

	log.Printf("[GATEWAY][START] Starting on %s", listenAddr)

	http.HandleFunc("/ws", handleWebSocket)
	http.HandleFunc("/admin/ws", handleAdminWebSocket)
	http.HandleFunc("/admin", handleAdminPage)
	http.HandleFunc("/healthz", handleHealth)

	fs := http.FileServer(http.Dir("ui"))
	http.Handle("/", fs)

	log.Printf("[GATEWAY][START] Listening on %s", listenAddr)
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func defaultPlayerName(playerID string) string {
	shortID := playerID
	if len(shortID) > 6 {
		shortID = shortID[:6]
	}
	return fmt.Sprintf("Guest-%s", shortID)
}

func sanitizePlayerName(raw, fallback string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return fallback
	}
	if len(trimmed) > 24 {
		trimmed = trimmed[:24]
	}
	return trimmed
}

func playerLabel(playerName, playerID string) string {
	return fmt.Sprintf("%s [%s]", playerName, playerID)
}

func snapshotPlayers() []PlayerSnapshot {
	hub.mu.RLock()
	players := make([]PlayerSnapshot, 0, len(hub.players))
	for _, player := range hub.players {
		players = append(players, player)
	}
	hub.mu.RUnlock()

	sort.Slice(players, func(i, j int) bool {
		if players[i].Zone == players[j].Zone {
			return players[i].PlayerName < players[j].PlayerName
		}
		return players[i].Zone < players[j].Zone
	})

	return players
}

func snapshotLogs() []AdminLogEntry {
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	logs := make([]AdminLogEntry, len(hub.logs))
	copy(logs, hub.logs)
	return logs
}

func adminConnections() []*AdminConn {
	hub.mu.RLock()
	defer hub.mu.RUnlock()

	admins := make([]*AdminConn, 0, len(hub.admins))
	for admin := range hub.admins {
		admins = append(admins, admin)
	}
	return admins
}

func broadcastAdminMessage(msg AdminMessage) {
	for _, admin := range adminConnections() {
		if err := admin.send(msg); err != nil {
			hub.mu.Lock()
			delete(hub.admins, admin)
			hub.mu.Unlock()
			_ = admin.ws.Close()
		}
	}
}

func broadcastPlayerSnapshot() {
	broadcastAdminMessage(AdminMessage{
		Type:    "snapshot",
		Players: snapshotPlayers(),
	})
}

func appendAdminLog(format string, args ...interface{}) {
	message := fmt.Sprintf(format, args...)
	entry := AdminLogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		Message:   message,
	}

	hub.mu.Lock()
	hub.logs = append(hub.logs, entry)
	if len(hub.logs) > maxAdminLogEntries {
		hub.logs = hub.logs[len(hub.logs)-maxAdminLogEntries:]
	}
	hub.mu.Unlock()

	log.Printf("[GATEWAY][EVENT] %s", message)
	broadcastAdminMessage(AdminMessage{
		Type: "log_append",
		Logs: []AdminLogEntry{entry},
	})
}

func registerClient(client *ClientConn) {
	hub.mu.Lock()
	hub.clients[client.playerID] = client
	hub.mu.Unlock()
}

func unregisterClient(playerID string) {
	hub.mu.Lock()
	delete(hub.clients, playerID)
	hub.mu.Unlock()
}

func playerNameByID(playerID string) string {
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	if player, ok := hub.players[playerID]; ok && player.PlayerName != "" {
		return player.PlayerName
	}
	return defaultPlayerName(playerID)
}

func broadcastToPlayers(msg ServerMessage, excludeID string) {
	hub.mu.RLock()
	clients := make([]*ClientConn, 0, len(hub.clients))
	for playerID, client := range hub.clients {
		if playerID == excludeID {
			continue
		}
		clients = append(clients, client)
	}
	hub.mu.RUnlock()

	for _, client := range clients {
		client.send(msg)
	}
}

func upsertPlayer(playerID, playerName, zoneID string, x, y int32) {
	hub.mu.Lock()
	previous := hub.players[playerID]
	if playerName == "" {
		playerName = previous.PlayerName
	}
	if playerName == "" {
		playerName = defaultPlayerName(playerID)
	}
	hub.players[playerID] = PlayerSnapshot{
		PlayerID:   playerID,
		PlayerName: playerName,
		Zone:       zoneID,
		X:          x,
		Y:          y,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
	}
	hub.mu.Unlock()

	broadcastPlayerSnapshot()
}

func removePlayer(playerID string) {
	hub.mu.Lock()
	player := hub.players[playerID]
	delete(hub.players, playerID)
	hub.mu.Unlock()

	broadcastPlayerSnapshot()
	broadcastToPlayers(ServerMessage{
		Type:       "player_leave",
		PlayerID:   playerID,
		PlayerName: player.PlayerName,
	}, playerID)
}

func applyPlayerName(playerID, name string) string {
	hub.mu.Lock()
	player := hub.players[playerID]
	fallback := player.PlayerName
	if fallback == "" {
		fallback = defaultPlayerName(playerID)
	}
	player.PlayerName = sanitizePlayerName(name, fallback)
	player.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	hub.players[playerID] = player

	client := hub.clients[playerID]
	if client != nil {
		client.playerName = player.PlayerName
	}
	hub.mu.Unlock()

	broadcastPlayerSnapshot()
	broadcastToPlayers(ServerMessage{
		Type:       "player_profile",
		PlayerID:   playerID,
		PlayerName: player.PlayerName,
		Zone:       player.Zone,
	}, "")
	return player.PlayerName
}

func handleAdminPage(w http.ResponseWriter, r *http.Request) {
	http.ServeFile(w, r, "ui/admin.html")
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"status":  "ok",
		"players": len(snapshotPlayers()),
	})
}

func handleAdminWebSocket(w http.ResponseWriter, r *http.Request) {
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[GATEWAY][ADMIN] Upgrade failed: %v", err)
		return
	}

	admin := &AdminConn{ws: wsConn}

	hub.mu.Lock()
	hub.admins[admin] = struct{}{}
	hub.mu.Unlock()

	if err := admin.send(AdminMessage{
		Type:    "state",
		Players: snapshotPlayers(),
		Logs:    snapshotLogs(),
	}); err != nil {
		hub.mu.Lock()
		delete(hub.admins, admin)
		hub.mu.Unlock()
		_ = wsConn.Close()
		return
	}

	for {
		if _, _, err := wsConn.ReadMessage(); err != nil {
			hub.mu.Lock()
			delete(hub.admins, admin)
			hub.mu.Unlock()
			_ = wsConn.Close()
			return
		}
	}
}

func connectToZoneWithRetry(redisClient *discovery.RedisDiscovery, zoneID string) (*grpc.ClientConn, worldpb.ZoneServiceClient, string, error) {
	attempt := 0

	for {
		attempt++

		leaderAddr, err := redisClient.GetZoneLeader(zoneID)
		if err != nil {
			wait := time.Duration(attempt*200) * time.Millisecond
			if wait > 2*time.Second {
				wait = 2 * time.Second
			}
			log.Printf("[GATEWAY][RETRY] no leader zone=%s attempt=%d wait=%v", zoneID, attempt, wait)
			time.Sleep(wait)
			continue
		}

		conn, err := grpc.Dial(leaderAddr, grpc.WithInsecure())
		if err != nil {
			wait := time.Duration(attempt*200) * time.Millisecond
			if wait > 2*time.Second {
				wait = 2 * time.Second
			}
			log.Printf("[GATEWAY][RETRY] grpc dial failed zone=%s addr=%s attempt=%d wait=%v err=%v",
				zoneID, leaderAddr, attempt, wait, err)
			time.Sleep(wait)
			continue
		}

		log.Printf("[GATEWAY][CONNECT] Connected zone=%s leader=%s", zoneID, leaderAddr)
		return conn, worldpb.NewZoneServiceClient(conn), leaderAddr, nil
	}
}

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	wsConn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[GATEWAY][ERROR] Upgrade failed: %v", err)
		return
	}
	defer wsConn.Close()

	playerID := uuid.New().String()
	playerName := defaultPlayerName(playerID)

	client := &ClientConn{
		ws:         wsConn,
		playerID:   playerID,
		playerName: playerName,
	}

	registerClient(client)
	defer unregisterClient(playerID)

	zones := cluster.DefaultZones()
	redisAddr := getenv("REDIS_ADDR", "redis:6379")
	redisClient := discovery.NewRedisDiscovery(redisAddr)

	var x int32 = 50
	var y int32 = 50

	currentZone := cluster.FindZone(zones, x, y)
	if currentZone == nil {
		log.Printf("[GATEWAY][ERROR] No zone found for spawn")
		return
	}

	grpcConn, grpcClient, _, err := connectToZoneWithRetry(redisClient, currentZone.ID)
	if err != nil {
		log.Printf("[GATEWAY][ERROR] gRPC connect failed: %v", err)
		return
	}
	defer grpcConn.Close()

	client.zoneID = currentZone.ID

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	joinResp, err := grpcClient.Join(ctx, &worldpb.JoinRequest{
		PlayerId: playerID,
		X:        x,
		Y:        y,
	})
	cancel()

	if err != nil {
		log.Printf("[GATEWAY][ERROR] Join failed: %v", err)
		return
	}

	x = joinResp.X
	y = joinResp.Y
	upsertPlayer(playerID, playerName, currentZone.ID, x, y)

	appendAdminLog("%s joined %s at (%d,%d)", playerLabel(playerName, playerID), currentZone.ID, x, y)

	client.send(ServerMessage{
		Type:       "welcome",
		PlayerID:   playerID,
		PlayerName: playerName,
		Zone:       currentZone.ID,
	})

	stopStreams := make(chan struct{})
	go streamZone(grpcClient, currentZone.ID, currentZone.MinX, currentZone.MaxX, currentZone.MinY, currentZone.MaxY, client, stopStreams)
	startGhostStreams(redisClient, zones, currentZone, client, stopStreams)

	for {
		_, raw, err := wsConn.ReadMessage()
		if err != nil {
			appendAdminLog("%s disconnected from %s", playerLabel(client.playerName, playerID), client.zoneID)
			close(stopStreams)
			removePlayer(playerID)
			return
		}

		var msg ClientMessage
		_ = json.Unmarshal(raw, &msg)

		switch msg.Type {
		case "set_name":
			oldName := client.playerName
			newName := applyPlayerName(playerID, msg.Name)
			client.playerName = newName
			upsertPlayer(playerID, newName, currentZone.ID, x, y)
			appendAdminLog("%s is now known as %s [%s]", oldName, newName, playerID)
			client.send(ServerMessage{
				Type:       "name_ack",
				PlayerID:   playerID,
				PlayerName: newName,
			})
		case "move":
			ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
			resp, err := grpcClient.Move(ctx, &worldpb.MoveRequest{
				PlayerId: playerID,
				Dx:       msg.Dx,
				Dy:       msg.Dy,
			})
			cancel()

			if err != nil {
				log.Printf("[GATEWAY][WARN] Move failed, reconnecting zone=%s err=%v", currentZone.ID, err)

				grpcConn.Close()

				grpcConn, grpcClient, _, err = connectToZoneWithRetry(redisClient, currentZone.ID)
				if err != nil {
					log.Printf("[GATEWAY][ERROR] Cannot reconnect zone=%s err=%v", currentZone.ID, err)
					return
				}

				continue
			}

			x = resp.X
			y = resp.Y
			upsertPlayer(playerID, client.playerName, currentZone.ID, x, y)

			newZone := cluster.FindZone(zones, x, y)
			if newZone == nil {
				continue
			}

			if newZone.ID != currentZone.ID {
				if x >= currentZone.MinX+HysteresisMargin &&
					x <= currentZone.MaxX-HysteresisMargin &&
					y >= currentZone.MinY+HysteresisMargin &&
					y <= currentZone.MaxY-HysteresisMargin {
					continue
				}

				appendAdminLog("%s moved from %s to %s at (%d,%d)",
					playerLabel(client.playerName, playerID), currentZone.ID, newZone.ID, x, y)

				close(stopStreams)
				grpcConn.Close()

				grpcConn, grpcClient, _, err = connectToZoneWithRetry(redisClient, newZone.ID)
				if err != nil {
					log.Printf("[GATEWAY][ERROR] Cannot connect new zone=%s err=%v", newZone.ID, err)
					return
				}

				currentZone = newZone
				client.zoneID = currentZone.ID

				ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
				_, err = grpcClient.Join(ctx, &worldpb.JoinRequest{
					PlayerId: playerID,
					X:        x,
					Y:        y,
				})
				cancel()

				if err != nil {
					log.Printf("[GATEWAY][ERROR] Join new zone failed: %v", err)
					return
				}

				upsertPlayer(playerID, client.playerName, currentZone.ID, x, y)

				stopStreams = make(chan struct{})
				go streamZone(grpcClient, currentZone.ID, currentZone.MinX, currentZone.MaxX, currentZone.MinY, currentZone.MaxY, client, stopStreams)
				startGhostStreams(redisClient, zones, currentZone, client, stopStreams)

				client.send(ServerMessage{
					Type: "zone_change",
					Zone: currentZone.ID,
				})
			}
		}
	}
}

func startGhostStreams(redisClient *discovery.RedisDiscovery, zones []cluster.Zone, currentZone *cluster.Zone, client *ClientConn, stopStreams chan struct{}) {
	neighbors := cluster.NeighborZones(zones, *currentZone)

	for _, n := range neighbors {
		go func(zone cluster.Zone) {
			ghostConn, ghostClient, _, err := connectToZoneWithRetry(redisClient, zone.ID)
			if err != nil {
				log.Printf("[GATEWAY][WARN] ghost connect failed zone=%s err=%v", zone.ID, err)
				return
			}
			defer ghostConn.Close()

			streamZone(ghostClient, zone.ID, zone.MinX, zone.MaxX, zone.MinY, zone.MaxY, client, stopStreams)
		}(n)
	}
}

func streamZone(grpcClient worldpb.ZoneServiceClient, zoneID string, minX, maxX, minY, maxY int32, client *ClientConn, stop chan struct{}) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream, err := grpcClient.StreamZoneUpdates(ctx, &worldpb.StreamRequest{
		ZoneId: zoneID,
		MinX:   minX - GhostRange,
		MaxX:   maxX + GhostRange,
		MinY:   minY - GhostRange,
		MaxY:   maxY + GhostRange,
	})

	if err != nil {
		log.Printf("[GATEWAY][STREAM_ERROR] zone=%s err=%v", zoneID, err)
		return
	}

	log.Printf("[GATEWAY][STREAM] zone=%s filter=(%d..%d,%d..%d)", zoneID, minX, maxX, minY, maxY)

	for {
		select {
		case <-stop:
			return
		default:
			update, err := stream.Recv()
			if err != nil {
				return
			}

			client.send(ServerMessage{
				Type: "update",
				Payload: map[string]interface{}{
					"zone":       zoneID,
					"playerId":   update.PlayerId,
					"playerName": playerNameByID(update.PlayerId),
					"x":          update.X,
					"y":          update.Y,
				},
			})
		}
	}
}
