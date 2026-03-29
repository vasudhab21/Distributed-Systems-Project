package cluster

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type LeaderElector struct {
	rdb       *redis.Client
	zoneID    string
	nodeID    string
	lockKey   string
	leaderKey string
	ttl       time.Duration
}

func NewLeaderElector(rdb *redis.Client, zoneID string, nodeID string) *LeaderElector {
	return &LeaderElector{
		rdb:       rdb,
		zoneID:    zoneID,
		nodeID:    nodeID,
		lockKey:   fmt.Sprintf("lock:zone:%s", zoneID),
		leaderKey: fmt.Sprintf("zone:%s:leader", zoneID),
		ttl:       5 * time.Second,
	}
}

func (e *LeaderElector) TryBecomeLeader() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ok, err := e.rdb.SetNX(ctx, e.lockKey, e.nodeID, e.ttl).Result()
	if err != nil {
		log.Printf("[%s][ELECTION][ERROR] %v", e.zoneID, err)
		return false
	}

	if ok {
		// I am leader now, update leader pointer
		e.rdb.Set(ctx, e.leaderKey, e.nodeID, 0)
		log.Printf("[%s][LEADER] Node=%s became LEADER", e.zoneID, e.nodeID)
		return true
	}

	return false
}

func (e *LeaderElector) RefreshLock() bool {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	val, err := e.rdb.Get(ctx, e.lockKey).Result()
	if err != nil {
		return false
	}

	if val != e.nodeID {
		return false
	}

	// extend TTL
	e.rdb.Expire(ctx, e.lockKey, e.ttl)
	return true
}

func (e *LeaderElector) RunLeaderLoop(isLeader *bool) {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		if *isLeader {
			ok := e.RefreshLock()
			if !ok {
				log.Printf("[%s][LEADER_LOST] Node=%s lost leadership", e.zoneID, e.nodeID)
				*isLeader = false
			}
		} else {
			ok := e.TryBecomeLeader()
			if ok {
				*isLeader = true
			}
		}
	}
}
