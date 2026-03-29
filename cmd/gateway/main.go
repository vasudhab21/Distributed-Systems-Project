package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
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

type ClientMessage struct {
	Type string `json:"type"`
	Dx   int32  `json:"dx"`
	Dy   int32  `json:"dy"`
}

type ServerMessage struct {
	Type     string                 `json:"type"`
	PlayerID string                 `json:"playerId,omitempty"`
	Zone     string                 `json:"zone,omitempty"`
	Payload  map[string]interface{} `json:"payload,omitempty"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type ClientConn struct {
	ws       *websocket.Conn
	playerID string
	zoneID   string
	mu       sync.Mutex
}

func (c *ClientConn) send(msg interface{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.ws.WriteJSON(msg)
}

func main() {
	log.Println("[GATEWAY][START] Starting on :8080")

	http.HandleFunc("/ws", handleWebSocket)

	fs := http.FileServer(http.Dir("ui"))
	http.Handle("/", fs)

	log.Println("[GATEWAY][START] Listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

// Connects to leader of zone using Redis leader key with retry
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

	client := &ClientConn{
		ws:       wsConn,
		playerID: playerID,
	}

	zones := cluster.DefaultZones()

	redisClient := discovery.NewRedisDiscovery("redis:6379")

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

	// JOIN
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

	log.Printf("[GATEWAY][JOIN] player=%s zone=%s pos=(%d,%d)", playerID, currentZone.ID, x, y)

	client.send(ServerMessage{
		Type:     "welcome",
		PlayerID: playerID,
		Zone:     currentZone.ID,
	})

	// STREAM HANDLING
	stopStreams := make(chan struct{})

	// main zone stream
	go streamZone(grpcClient, currentZone.ID, currentZone.MinX, currentZone.MaxX, currentZone.MinY, currentZone.MaxY, client, stopStreams)

	// ghost neighbor streams
	startGhostStreams(redisClient, zones, currentZone, client, stopStreams)

	for {
		_, raw, err := wsConn.ReadMessage()
		if err != nil {
			log.Printf("[GATEWAY][DISCONNECT] player=%s err=%v", playerID, err)
			close(stopStreams)
			return
		}

		var msg ClientMessage
		_ = json.Unmarshal(raw, &msg)

		if msg.Type != "move" {
			continue
		}

		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		resp, err := grpcClient.Move(ctx, &worldpb.MoveRequest{
			PlayerId: playerID,
			Dx:       msg.Dx,
			Dy:       msg.Dy,
		})
		cancel()

		// FAILOVER FIX: if leader died, reconnect automatically
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

		newZone := cluster.FindZone(zones, x, y)
		if newZone == nil {
			continue
		}

		// hysteresis (prevents flicker)
		if newZone.ID != currentZone.ID {
			if x >= currentZone.MinX+HysteresisMargin &&
				x <= currentZone.MaxX-HysteresisMargin &&
				y >= currentZone.MinY+HysteresisMargin &&
				y <= currentZone.MaxY-HysteresisMargin {
				continue
			}

			log.Printf("[GATEWAY][HANDOVER] player=%s %s -> %s at (%d,%d)",
				playerID, currentZone.ID, newZone.ID, x, y)

			// stop old streams
			close(stopStreams)

			grpcConn.Close()

			// connect to new zone leader with retry
			grpcConn, grpcClient, _, err = connectToZoneWithRetry(redisClient, newZone.ID)
			if err != nil {
				log.Printf("[GATEWAY][ERROR] Cannot connect new zone=%s err=%v", newZone.ID, err)
				return
			}

			currentZone = newZone
			client.zoneID = currentZone.ID

			// re-join
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

			// restart streams
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
					"zone":     zoneID,
					"playerId": update.PlayerId,
					"x":        update.X,
					"y":        update.Y,
				},
			})
		}
	}
}
