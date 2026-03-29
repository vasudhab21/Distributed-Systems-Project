package main

import (
	"context"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

func main() {
	log.Println("[COORDINATOR] Starting coordinator...")

	rdb := redis.NewClient(&redis.Options{
		Addr: "redis:6379",
	})

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err := rdb.Set(ctx, "shardworld_status", "alive", 30*time.Second).Err()
	if err != nil {
		log.Fatalf("[COORDINATOR][ERROR] Redis SET failed: %v", err)
	}

	val, err := rdb.Get(ctx, "shardworld_status").Result()
	if err != nil {
		log.Fatalf("[COORDINATOR][ERROR] Redis GET failed: %v", err)
	}

	log.Printf("[COORDINATOR] Redis working. shardworld_status=%s", val)

	for {
		log.Println("[COORDINATOR] Heartbeat OK")
		time.Sleep(5 * time.Second)
	}
}
