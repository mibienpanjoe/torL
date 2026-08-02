package torl

import (
	"errors"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestParseEventStart(t *testing.T) {
	line := []byte(`{"type":"start","id":"file.torrent","name":"test.txt","total":13}`)
	event, err := ParseEvent(line)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.Type != "start" || event.ID != "file.torrent" || event.Name != "test.txt" || event.Total != 13 {
		t.Fatalf("unexpected event: %+v", event)
	}
}

func TestParseEventProgress(t *testing.T) {
	line := []byte(`{"type":"progress","id":"file.torrent","downloaded":13,"total":13,"percent":1,"completedPieces":1,"totalPieces":1,"activePeers":1,"availablePeers":0}`)
	event, err := ParseEvent(line)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if event.Type != "progress" || event.ID != "file.torrent" || event.Percent != 1 || event.ActivePeers != 1 {
		t.Fatalf("unexpected event: %+v", event)
	}
}

func TestModelStartEvent(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	m.handleEvent(Event{Type: "start", ID: "file.torrent", Name: "test.txt", Total: 100})
	d := m.Downloads["file.torrent"]
	if d.Name != "test.txt" || d.Total != 100 || !d.Started {
		t.Fatalf("model not updated: %+v", d)
	}
}

func TestModelProgressEvent(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	m.handleEvent(Event{Type: "progress", ID: "file.torrent", Downloaded: 50, Total: 100, Percent: 0.5, CompletedPieces: 1, TotalPieces: 2, ActivePeers: 3, AvailablePeers: 4})
	d := m.Downloads["file.torrent"]
	if d.Downloaded != 50 || d.Percent != 0.5 || d.ActivePeers != 3 {
		t.Fatalf("model not updated: %+v", d)
	}
}

func TestModelCompleteEvent(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	m.handleEvent(Event{Type: "complete", ID: "file.torrent"})
	d := m.Downloads["file.torrent"]
	if !d.Done || d.Status != "Complete" {
		t.Fatalf("model not complete: %+v", d)
	}
}

func TestModelErrorEvent(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	m.handleEvent(Event{Type: "error", ID: "file.torrent", Message: "boom"})
	d := m.Downloads["file.torrent"]
	if d.Err == nil || d.Status != "Error" {
		t.Fatalf("model error not set: %+v", d)
	}
}

func TestModelMultiDownloadRouting(t *testing.T) {
	m := NewModel("torl", []string{"a.torrent", "b.torrent"}, ".")
	m.handleEvent(Event{Type: "start", ID: "a.torrent", Name: "a.txt", Total: 100})
	m.handleEvent(Event{Type: "start", ID: "b.torrent", Name: "b.txt", Total: 200})
	if m.Downloads["a.torrent"].Name != "a.txt" {
		t.Fatalf("a.torrent not routed: %+v", m.Downloads["a.torrent"])
	}
	if m.Downloads["b.torrent"].Name != "b.txt" {
		t.Fatalf("b.torrent not routed: %+v", m.Downloads["b.torrent"])
	}
}

func TestModelAllDone(t *testing.T) {
	m := NewModel("torl", []string{"a.torrent", "b.torrent"}, ".")
	if m.allDone() {
		t.Fatalf("should not be done before start")
	}
	m.handleEvent(Event{Type: "complete", ID: "a.torrent"})
	if m.allDone() {
		t.Fatalf("should not be done with one remaining")
	}
	m.handleEvent(Event{Type: "complete", ID: "b.torrent"})
	if !m.allDone() {
		t.Fatalf("should be done after both complete")
	}
}

func TestModelQuit(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Fatalf("expected quit command")
	}
}

func TestEmptyModelShowsAddActions(t *testing.T) {
	m := NewModel("torl", nil, ".")
	view := m.View()

	if !strings.Contains(view, "No downloads yet") {
		t.Fatalf("empty state is missing from view: %q", view)
	}
	if !strings.Contains(view, "a add") || !strings.Contains(view, "f browse") {
		t.Fatalf("add actions are missing from view: %q", view)
	}
}

func TestModelStaysOpenWhenLastProcessFinishes(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	_, cmd := m.Update(procDoneMsg{input: "file.torrent"})

	if cmd != nil {
		t.Fatalf("dashboard should remain open after the queue finishes")
	}
}

func TestModelStaysOpenWhenLastProcessFails(t *testing.T) {
	m := NewModel("torl", []string{"file.torrent"}, ".")
	_, cmd := m.Update(procErrMsg{input: "file.torrent", err: errors.New("boom")})

	if cmd != nil {
		t.Fatalf("dashboard should remain open after the queue fails")
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
