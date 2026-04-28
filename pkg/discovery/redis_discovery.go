package discovery

import (
	"context"
	"fmt"
	"time"

	"shardworld/pkg/cluster"

	"github.com/redis/go-redis/v9"
)

var ctx = context.Background()

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

// ✅ FIXED: Use correct struct (RedisDiscovery) + rdb instead of client
func (d *RedisDiscovery) UpdateNodeMetrics(nodeID string, metrics cluster.Metrics) error {
	key := "node:" + nodeID

	data := map[string]interface{}{
		"cpu":     metrics.CPUUsage,
		"memory":  metrics.MemoryUsage,
		"latency": metrics.Latency,
		"load":    metrics.Load,
	}

	return d.rdb.HSet(ctx, key, data).Err()
}

// ✅ FIXED: Use correct struct + rdb + proper import
func (d *RedisDiscovery) GetAllNodes() ([]cluster.Node, error) {
	keys, err := d.rdb.Keys(ctx, "node:*").Result()
	if err != nil {
		return nil, err
	}

	var nodes []cluster.Node

	for _, key := range keys {
		data, err := d.rdb.HGetAll(ctx, key).Result()
		if err != nil {
			continue
		}

		node := cluster.Node{
			ID: key[5:], // remove "node:"
		}

		fmt.Sscanf(data["cpu"], "%f", &node.Metrics.CPUUsage)
		fmt.Sscanf(data["memory"], "%f", &node.Metrics.MemoryUsage)
		fmt.Sscanf(data["latency"], "%f", &node.Metrics.Latency)
		fmt.Sscanf(data["load"], "%f", &node.Metrics.Load)

		nodes = append(nodes, node)
	}

	return nodes, nil
}