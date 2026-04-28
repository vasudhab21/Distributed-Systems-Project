package cluster

type Metrics struct {
	CPUUsage    float64
	MemoryUsage float64
	Latency     float64
	Load        float64
}

type Node struct {
	ID      string
	Address string
	Metrics Metrics
	IsLeader bool
}