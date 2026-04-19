package cluster

import (
	"math"
)

type Election struct {
	Nodes []Node
}

func calculateScore(m Metrics) float64 {
	// weights (you can tune these later)
	wCPU := 0.3
	wMem := 0.3
	wLat := 0.2
	wLoad := 0.2

	return (wCPU * m.CPUUsage) +
		(wMem * m.MemoryUsage) +
		(wLat * m.Latency) +
		(wLoad * m.Load)
}

func (e *Election) ElectLeader() *Node {
	if len(e.Nodes) == 0 {
		return nil
	}

	bestIndex := 0
	bestScore := math.MaxFloat64

	for i, node := range e.Nodes {
		score := calculateScore(node.Metrics)

		if score < bestScore {
			bestScore = score
			bestIndex = i
		}
	}

	// assign leader
	for i := range e.Nodes {
		e.Nodes[i].IsLeader = false
	}
	e.Nodes[bestIndex].IsLeader = true

	return &e.Nodes[bestIndex]
}