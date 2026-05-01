# Results

## 1. Test Setup

The ShardWorld system was evaluated on **May 1, 2026** using the local Docker-based deployment of the full stack:

- 1 gateway service
- 1 coordinator service
- Redis service
- 18 zone server replicas (2 per zone across a 3 x 3 world partition)

The following user-visible and system-level measurements were collected:

- HTTP health-check response time
- Initial player page response time
- WebSocket connection and welcome latency
- Player name registration latency
- Movement acknowledgement latency
- Zone handover latency between shards

These metrics were chosen because they directly reflect the speed, responsiveness, and distributed coordination behavior of the system.

## 2. Quantified Performance Results

| Metric Name | What Was Measured | Result |
|---|---|---:|
| Gateway health latency | `GET /healthz` over 25 requests | **53.74 ms average** |
| Gateway health latency (best case) | Fastest `/healthz` response | **24.77 ms** |
| Gateway health latency (worst case) | Slowest `/healthz` response | **207.04 ms** |
| Player page response time | `GET /` over 10 requests | **46.54 ms average** |
| Player page response (best case) | Fastest page response | **24.88 ms** |
| Player page response (worst case) | Slowest page response | **193.29 ms** |
| WebSocket connection time | Time to establish `ws://localhost:8080/ws` | **82.38 ms** |
| Welcome message latency | Time to receive the first welcome packet after connect | **34.36 ms** |
| Name update latency | Time from sending `set_name` to receiving `name_ack` | **25.59 ms** |
| Movement acknowledgement latency | Time from sending one movement command to receiving the updated player position | **13.39 ms** |
| Zone handover latency | Time for a player to move across the zone boundary and receive `zone_change` | **565.30 ms** |

## 3. Speed Results

The system shows good baseline speed for a prototype distributed game server.

- The **average player page response time was 46.54 ms**, which indicates that the gateway is able to serve the UI quickly.
- The **average gateway health latency was 53.74 ms**, showing that the public-facing service remains responsive even with the full multi-container stack running.
- The **movement acknowledgement latency was only 13.39 ms**, which is fast enough for visibly responsive avatar control in a classroom demonstration or prototype setting.

### Interpretation

These numbers suggest that the gateway and the zone servers communicate efficiently under light test load. The health and page response times both remained well under 100 ms on average, which is a strong result for a distributed prototype running through Dockerized services rather than a single monolithic process.

## 4. Latency Results

Latency was evaluated at multiple interaction points to understand both user-facing and coordination overhead.

- **WebSocket connection time**: 82.38 ms
- **Welcome packet latency**: 34.36 ms
- **Name registration latency**: 25.59 ms
- **Movement acknowledgement latency**: 13.39 ms
- **Zone handover latency**: 565.30 ms

### Interpretation

The first four latencies are low and indicate smooth interaction for:

- joining the game
- registering a player name
- moving inside a zone
- receiving immediate updates

The **zone handover latency is significantly higher at 565.30 ms**, which is expected because handover involves:

- detecting that the player crossed the boundary
- reconnecting to the new zone leader
- rejoining the correct shard
- restarting relevant update streams

This makes handover the most expensive distributed operation in the system, but it still completes within well under one second, which is acceptable for a prototype.

## 5. Functional Checks Performed

The following distributed-system behaviors were verified successfully:

### 5.1 Gateway Availability

- The gateway responded successfully to repeated health checks.
- No failure was observed in normal stack startup.

### 5.2 Multiplayer Session Startup

- A client could connect through WebSocket.
- The player received a `welcome` packet with an assigned UUID and starting zone.

### 5.3 Named Player Registration

- A player could submit a custom name.
- The gateway acknowledged the name change.
- The updated player name was stored in the in-memory player registry.
- The name was propagated to the admin panel and to live log events.

### 5.4 Real-Time Movement

- A movement command produced a position update with low response time.
- The player position was updated and streamed back correctly.

### 5.5 Cross-Zone Handover

- The player was able to cross from `zone_0_0` into `zone_0_1`.
- A valid `zone_change` event was received.
- The measured handover latency confirms that shard transitions are functioning.

## 6. Observability Results

The updated system also improves observability, which is an important part of evaluating a distributed application.

The following observability features were successfully integrated:

- live admin player monitor
- player names associated with player IDs
- live gateway event stream
- logs for:
  - player join
  - name update
  - zone handover
  - disconnect

This makes it easier to validate correctness during demonstrations because the admin panel acts as both:

- a monitoring console
- a lightweight debugging view

## 7. Overall Result Summary

Overall, the experimental results show that the system performs well as a distributed multiplayer prototype.

Key takeaways:

- **Fast average response times** for page access and health checks
- **Low interaction latency** for join, naming, and movement
- **Successful shard handover** with measurable coordination delay
- **Improved monitoring support** through live admin logs and player tracking

The main overhead observed in the system is **zone handover latency**, which is the most coordination-heavy operation. This is reasonable because boundary crossing requires distributed state transfer behavior at the gateway level.

## 8. Final Conclusion

From the measured results, ShardWorld demonstrates that:

- a distributed world can be partitioned into shards
- users can connect through a central gateway
- latency-sensitive operations such as movement can remain fast
- administrative observability can be added without breaking gameplay

Therefore, the system is successful as a proof-of-concept distributed multiplayer environment with measurable performance characteristics in terms of speed, latency, and shard coordination.
