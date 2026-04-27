package cluster

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

type LeaderLock struct {
	rdb     *redis.Client
	zoneID  string
	nodeID  string
	key     string
}

func NewLeaderLock(rdb *redis.Client, zoneID, nodeID string) *LeaderLock {
	return &LeaderLock{
		rdb:    rdb,
		zoneID: zoneID,
		nodeID: nodeID,
		key:    "leader:" + zoneID,
	}
}

func (l *LeaderLock) TryAcquire(ctx context.Context) (bool, error) {
	return l.rdb.SetNX(ctx, l.key, l.nodeID, 10*time.Second).Result()
}

func (l *LeaderLock) Renew(ctx context.Context) error {
	return l.rdb.Expire(ctx, l.key, 10*time.Second).Err()
}

func (l *LeaderLock) GetLeader(ctx context.Context) (string, error) {
	return l.rdb.Get(ctx, l.key).Result()
}