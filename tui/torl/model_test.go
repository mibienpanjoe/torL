package torl

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestParseEventStart(t *testing.T) {
	line := []byte(`{"type":"start","name":"test.txt","total":13}`)
	event, err := ParseEvent(line)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.Type != "start" || event.Name != "test.txt" || event.Total != 13 {
		t.Fatalf("unexpected event: %+v", event)
	}
}

func TestParseEventProgress(t *testing.T) {
	line := []byte(`{"type":"progress","downloaded":13,"total":13,"percent":1,"completedPieces":1,"totalPieces":1,"activePeers":1,"availablePeers":0}`)
	event, err := ParseEvent(line)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.Type != "progress" || event.Percent != 1 || event.ActivePeers != 1 {
		t.Fatalf("unexpected event: %+v", event)
	}
}

func TestModelStartEvent(t *testing.T) {
	m := NewModel("torl", "file.torrent", ".")
	m.handleEvent(Event{Type: "start", Name: "test.txt", Total: 100})
	if m.Name != "test.txt" || m.Total != 100 || !m.Started {
		t.Fatalf("model not updated: %+v", m)
	}
}

func TestModelProgressEvent(t *testing.T) {
	m := NewModel("torl", "file.torrent", ".")
	m.handleEvent(Event{Type: "progress", Downloaded: 50, Total: 100, Percent: 0.5, CompletedPieces: 1, TotalPieces: 2, ActivePeers: 3, AvailablePeers: 4})
	if m.Downloaded != 50 || m.Percent != 0.5 || m.ActivePeers != 3 {
		t.Fatalf("model not updated: %+v", m)
	}
}

func TestModelCompleteEvent(t *testing.T) {
	m := NewModel("torl", "file.torrent", ".")
	m.handleEvent(Event{Type: "complete"})
	if !m.Done || m.Status != "Complete" {
		t.Fatalf("model not complete: %+v", m)
	}
}

func TestModelErrorEvent(t *testing.T) {
	m := NewModel("torl", "file.torrent", ".")
	m.handleEvent(Event{Type: "error", Message: "boom"})
	if m.Err == nil || m.Status != "Error" {
		t.Fatalf("model error not set: %+v", m)
	}
}

func TestModelQuit(t *testing.T) {
	m := NewModel("torl", "file.torrent", ".")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Fatalf("expected quit command")
	}
}

func TestFormatBytes(t *testing.T) {
	if formatBytes(13) != "13 B" {
		t.Fatalf("unexpected bytes: %s", formatBytes(13))
	}
	if formatBytes(1024) != "1.00 KiB" {
		t.Fatalf("unexpected bytes: %s", formatBytes(1024))
	}
}

func TestTruncate(t *testing.T) {
	if truncate("hello world", 5) != "he..." {
		t.Fatalf("unexpected truncate: %s", truncate("hello world", 5))
	}
}

func TestLastN(t *testing.T) {
	items := []string{"a", "b", "c", "d", "e"}
	got := lastN(items, 3)
	want := []string{"c", "d", "e"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("expected %v, got %v", want, got)
		}
	}
}
