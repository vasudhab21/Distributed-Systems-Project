package cluster

type Zone struct {
	ID   string
	MinX int32
	MaxX int32
	MinY int32
	MaxY int32
}

const ZoneSize int32 = 200
const WorldMax int32 = 600

func DefaultZones() []Zone {
	return []Zone{
		{ID: "zone_0_0", MinX: 0, MaxX: 199, MinY: 0, MaxY: 199},
		{ID: "zone_0_1", MinX: 200, MaxX: 399, MinY: 0, MaxY: 199},
		{ID: "zone_0_2", MinX: 400, MaxX: 599, MinY: 0, MaxY: 199},

		{ID: "zone_1_0", MinX: 0, MaxX: 199, MinY: 200, MaxY: 399},
		{ID: "zone_1_1", MinX: 200, MaxX: 399, MinY: 200, MaxY: 399},
		{ID: "zone_1_2", MinX: 400, MaxX: 599, MinY: 200, MaxY: 399},

		{ID: "zone_2_0", MinX: 0, MaxX: 199, MinY: 400, MaxY: 599},
		{ID: "zone_2_1", MinX: 200, MaxX: 399, MinY: 400, MaxY: 599},
		{ID: "zone_2_2", MinX: 400, MaxX: 599, MinY: 400, MaxY: 599},
	}
}

func FindZone(zones []Zone, x, y int32) *Zone {
	for _, z := range zones {
		if x >= z.MinX && x <= z.MaxX && y >= z.MinY && y <= z.MaxY {
			zone := z
			return &zone
		}
	}
	return nil
}

func NeighborZones(zones []Zone, current Zone) []Zone {
	neighbors := []Zone{}

	for _, z := range zones {
		if z.ID == current.ID {
			continue
		}

		// touching horizontally or vertically
		touching :=
			(z.MinX == current.MaxX+1 || z.MaxX+1 == current.MinX) && (z.MinY <= current.MaxY && z.MaxY >= current.MinY) ||
				(z.MinY == current.MaxY+1 || z.MaxY+1 == current.MinY) && (z.MinX <= current.MaxX && z.MaxX >= current.MinX)

		if touching {
			neighbors = append(neighbors, z)
		}
	}

	return neighbors
}
