package discovery

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisDiscovery struct {
	rdb *redis.Client
}

func NewRedisDiscovery(redisAddr string) *RedisDiscovery {
	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	return &RedisDiscovery{rdb: rdb}
}

// Register zone in redis
func (d *RedisDiscovery) RegisterZone(zoneID string, addr string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	keyAddr := fmt.Sprintf("zone:%s:addr", zoneID)
	keyLeader := fmt.Sprintf("zone:%s:leader", zoneID)

	// Store address permanently
	if err := d.rdb.Set(ctx, keyAddr, addr, 0).Err(); err != nil {
		return err
	}

	// If leader doesn't exist, set it
	_, err := d.rdb.SetNX(ctx, keyLeader, addr, 0).Result()
	return err
}

// Lookup leader address
func (d *RedisDiscovery) GetZoneLeader(zoneID string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	keyLeader := fmt.Sprintf("zone:%s:leader", zoneID)
	return d.rdb.Get(ctx, keyLeader).Result()
}
