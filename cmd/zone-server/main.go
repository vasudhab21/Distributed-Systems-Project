package main

import (
	"context"
	"fmt"
	"log"
	"math/rand"
	"net"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
	"google.golang.org/grpc"

	"shardworld/pkg/cluster"
	"shardworld/pkg/discovery"
	worldpb "shardworld/proto/worldpb"
)

const (
	WorldMinX int32 = 0
	WorldMaxX int32 = 600
	WorldMinY int32 = 0
	WorldMaxY int32 = 600
)

type PlayerState struct {
	X int32
	Y int32
}

type ZoneServer struct {
	worldpb.UnimplementedZoneServiceServer

	zoneID string
	minX   int32
	maxX   int32
	minY   int32
	maxY   int32

	mu      sync.Mutex
	players map[string]*PlayerState

	subMu       sync.Mutex
	subscribers map[int]chan *worldpb.ZoneUpdate
	subCounter  int

	redisClient *redis.Client
	nodeID      string
	isLeader    bool
}

func getenvInt(key string, defaultVal int32) int32 {
	val := os.Getenv(key)
	if val == "" {
		return defaultVal
	}
	parsed, err := strconv.Atoi(val)
	if err != nil {
		return defaultVal
	}
	return int32(parsed)
}

func NewZoneServer(zoneID string, minX, maxX, minY, maxY int32, rdb *redis.Client, nodeID string) *ZoneServer {
	return &ZoneServer{
		zoneID:      zoneID,
		minX:        minX,
		maxX:        maxX,
		minY:        minY,
		maxY:        maxY,
		players:     make(map[string]*PlayerState),
		subscribers: make(map[int]chan *worldpb.ZoneUpdate),
		redisClient: rdb,
		nodeID:      nodeID,
		isLeader:    false,
	}
}

func (s *ZoneServer) broadcast(update *worldpb.ZoneUpdate) {
	s.subMu.Lock()
	defer s.subMu.Unlock()

	for _, ch := range s.subscribers {
		select {
		case ch <- update:
		default:
		}
	}
}

func (s *ZoneServer) verifyLeadership(ctx context.Context) bool {
	key := fmt.Sprintf("zone:%s:leader", s.zoneID)
	val, err := s.redisClient.Get(ctx, key).Result()
	if err != nil {
		return false
	}
	return val == s.nodeID
}

func (s *ZoneServer) Ping(ctx context.Context, req *worldpb.PingRequest) (*worldpb.PingResponse, error) {
	return &worldpb.PingResponse{
		Reply: fmt.Sprintf("PONG from %s! You said: %s", s.zoneID, req.Message),
	}, nil
}

func (s *ZoneServer) Join(ctx context.Context, req *worldpb.JoinRequest) (*worldpb.JoinResponse, error) {
	if !s.isLeader {
		return nil, fmt.Errorf("[%s] not leader", s.zoneID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	_, exists := s.players[req.PlayerId]
	if !exists {
		spawnX := req.X
		spawnY := req.Y

		if spawnX == 0 && spawnY == 0 {
			spawnX = (s.minX + s.maxX) / 2
			spawnY = (s.minY + s.maxY) / 2
		}

		if spawnX < WorldMinX {
			spawnX = WorldMinX
		}
		if spawnX > WorldMaxX {
			spawnX = WorldMaxX
		}
		if spawnY < WorldMinY {
			spawnY = WorldMinY
		}
		if spawnY > WorldMaxY {
			spawnY = WorldMaxY
		}

		s.players[req.PlayerId] = &PlayerState{X: spawnX, Y: spawnY}

		log.Printf("[%s][JOIN] player=%s spawn=(%d,%d)", s.zoneID, req.PlayerId, spawnX, spawnY)

		s.broadcast(&worldpb.ZoneUpdate{
			PlayerId: req.PlayerId,
			X:        spawnX,
			Y:        spawnY,
		})
	}

	p := s.players[req.PlayerId]

	return &worldpb.JoinResponse{
		X: p.X,
		Y: p.Y,
	}, nil
}

func (s *ZoneServer) Move(ctx context.Context, req *worldpb.MoveRequest) (*worldpb.MoveResponse, error) {
	if !s.isLeader {
		return nil, fmt.Errorf("[%s] not leader", s.zoneID)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	p, exists := s.players[req.PlayerId]
	if !exists {
		spawnX := (s.minX + s.maxX) / 2
		spawnY := (s.minY + s.maxY) / 2
		s.players[req.PlayerId] = &PlayerState{X: spawnX, Y: spawnY}
		p = s.players[req.PlayerId]
		log.Printf("[%s][AUTO_CREATE] player=%s spawn=(%d,%d)", s.zoneID, req.PlayerId, spawnX, spawnY)
	}

	p.X += req.Dx
	p.Y += req.Dy

	if p.X < WorldMinX {
		p.X = WorldMinX
	}
	if p.X > WorldMaxX {
		p.X = WorldMaxX
	}
	if p.Y < WorldMinY {
		p.Y = WorldMinY
	}
	if p.Y > WorldMaxY {
		p.Y = WorldMaxY
	}

	log.Printf("[%s][MOVE] player=%s pos=(%d,%d)", s.zoneID, req.PlayerId, p.X, p.Y)

	s.broadcast(&worldpb.ZoneUpdate{
		PlayerId: req.PlayerId,
		X:        p.X,
		Y:        p.Y,
	})

	return &worldpb.MoveResponse{
		X: p.X,
		Y: p.Y,
	}, nil
}

func (s *ZoneServer) StreamZoneUpdates(req *worldpb.StreamRequest, stream worldpb.ZoneService_StreamZoneUpdatesServer) error {
	ch := make(chan *worldpb.ZoneUpdate, 200)

	s.subMu.Lock()
	s.subCounter++
	id := s.subCounter
	s.subscribers[id] = ch
	s.subMu.Unlock()

	defer func() {
		s.subMu.Lock()
		delete(s.subscribers, id)
		s.subMu.Unlock()
	}()

	s.mu.Lock()
	for pid, p := range s.players {
		_ = stream.Send(&worldpb.ZoneUpdate{PlayerId: pid, X: p.X, Y: p.Y})
	}
	s.mu.Unlock()

	for {
		select {
		case <-stream.Context().Done():
			return nil
		case update := <-ch:
			if err := stream.Send(update); err != nil {
				return err
			}
		}
	}
}

func main() {
	port := 50051

	zoneID := os.Getenv("ZONE_ID")
	if zoneID == "" {
		zoneID = "zone_0_0"
	}

	minX := getenvInt("MIN_X", 0)
	maxX := getenvInt("MAX_X", 600)
	minY := getenvInt("MIN_Y", 0)
	maxY := getenvInt("MAX_Y", 600)

	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "redis:6379"
	}

	rdb := redis.NewClient(&redis.Options{Addr: redisAddr})

	myAddr := fmt.Sprintf("%s:%d", os.Getenv("HOSTNAME"), port)
	nodeID := myAddr

	discoveryClient := discovery.NewRedisDiscovery(redisAddr)

	discoveryClient.RegisterZone(zoneID, myAddr)

	server := NewZoneServer(zoneID, minX, maxX, minY, maxY, rdb, nodeID)

	leaderKey := fmt.Sprintf("zone:%s:leader", zoneID)

	go func() {
    previousState := false
    firstRun := true   // ✅ ensures first print happens

		for {
			ctx := context.Background()

			acquired, _ := rdb.SetNX(ctx, leaderKey, nodeID, 5*time.Second).Result()

			if acquired {
				server.isLeader = true
			} else {
				val, _ := rdb.Get(ctx, leaderKey).Result()

				if val == nodeID {
					server.isLeader = true
					rdb.Expire(ctx, leaderKey, 5*time.Second)
				} else {
					server.isLeader = false
				}
			}

			// ✅ FIXED LOGIC
			if firstRun || server.isLeader != previousState {
				if server.isLeader {
					fmt.Println("[", server.zoneID, "] became LEADER:", server.nodeID)
				} else {
					fmt.Println("[", server.zoneID, "] became FOLLOWER:", server.nodeID)
				}
				previousState = server.isLeader
				firstRun = false
			}

			time.Sleep(2 * time.Second)
		}
}()

	// ✅ NEW: metrics loop
	go func() {
		for {
			discoveryClient.UpdateNodeMetrics(nodeID, cluster.Metrics{
				CPUUsage:    rand.Float64() * 100,
				MemoryUsage: rand.Float64() * 100,
				Latency:     rand.Float64() * 50,
				Load:        rand.Float64() * 10,
			})
			time.Sleep(5 * time.Second)
		}
	}()

	lis, _ := net.Listen("tcp", fmt.Sprintf(":%d", port))
	grpcServer := grpc.NewServer()
	worldpb.RegisterZoneServiceServer(grpcServer, server)

	log.Printf("[%s] running on %d", zoneID, port)
	grpcServer.Serve(lis)
}
