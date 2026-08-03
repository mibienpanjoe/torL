package torl

import (
	"encoding/json"
	"fmt"
)

type Event struct {
	ID              string  `json:"id,omitempty"`
	Type            string  `json:"type"`
	Name            string  `json:"name,omitempty"`
	Total           int64   `json:"total,omitempty"`
	Downloaded      int64   `json:"downloaded,omitempty"`
	Percent         float64 `json:"percent,omitempty"`
	CompletedPieces int     `json:"completedPieces,omitempty"`
	TotalPieces     int     `json:"totalPieces,omitempty"`
	ActivePeers     int     `json:"activePeers,omitempty"`
	AvailablePeers  int     `json:"availablePeers,omitempty"`
	Action          string  `json:"action,omitempty"`
	Peer            string  `json:"peer,omitempty"`
	Path            string  `json:"path,omitempty"`
	Message         string  `json:"message,omitempty"`
}

func ParseEvent(line []byte) (Event, error) {
	var event Event
	if err := json.Unmarshal(line, &event); err != nil {
		return event, fmt.Errorf("invalid torl event: %w", err)
	}
	return event, nil
}
