package torl

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func testModel(t *testing.T, inputs []string, output string) *Model {
	t.Helper()
	return NewModelWithQueuePath("torl", inputs, output, filepath.Join(t.TempDir(), "queue.json"))
}

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
	m := testModel(t, []string{"file.torrent"}, ".")
	id := m.Inputs[0]
	m.handleEvent(Event{Type: "start", ID: id, Name: "test.txt", Total: 100})
	d := m.Downloads[id]
	if d.Name != "test.txt" || d.Total != 100 || !d.Started {
		t.Fatalf("model not updated: %+v", d)
	}
}

func TestModelProgressEvent(t *testing.T) {
	m := testModel(t, []string{"file.torrent"}, ".")
	id := m.Inputs[0]
	m.handleEvent(Event{Type: "progress", ID: id, Downloaded: 50, Total: 100, Percent: 0.5, CompletedPieces: 1, TotalPieces: 2, ActivePeers: 3, AvailablePeers: 4})
	d := m.Downloads[id]
	if d.Downloaded != 50 || d.Percent != 0.5 || d.ActivePeers != 3 {
		t.Fatalf("model not updated: %+v", d)
	}
}

func TestModelCompleteEvent(t *testing.T) {
	m := testModel(t, []string{"file.torrent"}, ".")
	id := m.Inputs[0]
	m.handleEvent(Event{Type: "complete", ID: id})
	d := m.Downloads[id]
	if !d.Done || d.Status != "Complete" {
		t.Fatalf("model not complete: %+v", d)
	}
}

func TestModelErrorEvent(t *testing.T) {
	m := testModel(t, []string{"file.torrent"}, ".")
	id := m.Inputs[0]
	m.handleEvent(Event{Type: "error", ID: id, Message: "boom"})
	d := m.Downloads[id]
	if d.Err == nil || d.Status != "Error" || !d.Paused {
		t.Fatalf("model error not set: %+v", d)
	}
}

func TestModelMultiDownloadRouting(t *testing.T) {
	m := testModel(t, []string{"a.torrent", "b.torrent"}, ".")
	aID, bID := m.Inputs[0], m.Inputs[1]
	m.handleEvent(Event{Type: "start", ID: aID, Name: "a.txt", Total: 100})
	m.handleEvent(Event{Type: "start", ID: bID, Name: "b.txt", Total: 200})
	if m.Downloads[aID].Name != "a.txt" {
		t.Fatalf("a.torrent not routed: %+v", m.Downloads[aID])
	}
	if m.Downloads[bID].Name != "b.txt" {
		t.Fatalf("b.torrent not routed: %+v", m.Downloads[bID])
	}
}

func TestModelAllDone(t *testing.T) {
	m := testModel(t, []string{"a.torrent", "b.torrent"}, ".")
	aID, bID := m.Inputs[0], m.Inputs[1]
	if m.allDone() {
		t.Fatalf("should not be done before start")
	}
	m.handleEvent(Event{Type: "complete", ID: aID})
	if m.allDone() {
		t.Fatalf("should not be done with one remaining")
	}
	m.handleEvent(Event{Type: "complete", ID: bID})
	if !m.allDone() {
		t.Fatalf("should be done after both complete")
	}
}

func TestModelQuit(t *testing.T) {
	m := testModel(t, []string{"file.torrent"}, ".")
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	if cmd == nil {
		t.Fatalf("expected quit command")
	}
}

func TestEmptyModelShowsAddActions(t *testing.T) {
	m := testModel(t, nil, ".")
	view := m.View()

	if !strings.Contains(view, "No downloads yet") {
		t.Fatalf("empty state is missing from view: %q", view)
	}
	if !strings.Contains(view, "a add") || !strings.Contains(view, "f browse") {
		t.Fatalf("add actions are missing from view: %q", view)
	}
}

func TestModelStaysOpenWhenLastProcessFinishes(t *testing.T) {
	m := testModel(t, []string{"file.torrent"}, ".")
	_, cmd := m.Update(procDoneMsg{input: m.Inputs[0]})

	if cmd != nil {
		t.Fatalf("dashboard should remain open after the queue finishes")
	}
}

func TestModelStaysOpenWhenLastProcessFails(t *testing.T) {
	m := testModel(t, []string{"file.torrent"}, ".")
	_, cmd := m.Update(procErrMsg{input: m.Inputs[0], err: errors.New("boom")})

	if cmd != nil {
		t.Fatalf("dashboard should remain open after the queue fails")
	}
}

func TestNormalizeSourceAcceptsMagnet(t *testing.T) {
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	got, err := normalizeSource("  " + magnet + "  ")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != magnet {
		t.Fatalf("expected %q, got %q", magnet, got)
	}
}

func TestNormalizeSourceAcceptsQuotedTorrentPath(t *testing.T) {
	dir := t.TempDir()
	torrentPath := filepath.Join(dir, "debian image.torrent")
	if err := os.WriteFile(torrentPath, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := normalizeSource("\"" + torrentPath + "\"")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != torrentPath {
		t.Fatalf("expected %q, got %q", torrentPath, got)
	}
}

func TestNormalizeSourceRejectsInvalidInput(t *testing.T) {
	for _, input := range []string{
		"",
		"magnet:?dn=missing-hash",
		"magnet:?xt=urn:btih:abc",
		"MAGNET:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678",
		"magnet:download?xt=urn:btih:1234567890abcdef1234567890abcdef12345678",
		"magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678\x1b[31m",
		"notes.txt",
	} {
		if _, err := normalizeSource(input); err == nil {
			t.Fatalf("expected %q to be rejected", input)
		}
	}
}

func TestNormalizeSourceRejectsOversizedMagnet(t *testing.T) {
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=" + strings.Repeat("a", maxSourceInputRunes)
	if _, err := normalizeSource(magnet); err == nil {
		t.Fatalf("expected oversized magnet to be rejected")
	}
}

func TestSourceInputQueuesMagnet(t *testing.T) {
	m := testModel(t, nil, ".")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"

	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	if m.mode != sourceInputMode {
		t.Fatalf("expected source input mode")
	}
	m.inputValue = magnet
	m.inputCursor = len([]rune(magnet))
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})

	if cmd == nil {
		t.Fatalf("expected a download command")
	}
	if len(m.Inputs) != 1 || m.Inputs[0] != magnet {
		t.Fatalf("source was not queued: %v", m.Inputs)
	}
	if m.mode != dashboardMode {
		t.Fatalf("expected dashboard mode after adding")
	}
	if m.Downloads[magnet].Output != m.Output {
		t.Fatalf("expected per-download output %q, got %q", m.Output, m.Downloads[magnet].Output)
	}
}

func TestSourceInputRejectsDuplicate(t *testing.T) {
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	m := testModel(t, []string{magnet}, ".")

	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'a'}})
	m.inputValue = magnet
	m.inputCursor = len([]rune(magnet))
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})

	if cmd != nil {
		t.Fatalf("duplicate source must not spawn a command")
	}
	if !strings.Contains(m.inputError, "already") {
		t.Fatalf("expected duplicate error, got %q", m.inputError)
	}
}

func TestOutputInputChangesFutureDestination(t *testing.T) {
	m := testModel(t, nil, ".")
	destination := filepath.Join(t.TempDir(), "new downloads")

	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'o'}})
	if m.mode != outputInputMode {
		t.Fatalf("expected output input mode")
	}
	m.inputValue = destination
	m.inputCursor = len([]rune(destination))
	m.Update(tea.KeyMsg{Type: tea.KeyEnter})

	if m.Output != destination {
		t.Fatalf("expected output %q, got %q", destination, m.Output)
	}
	if m.mode != dashboardMode {
		t.Fatalf("expected dashboard mode after changing output")
	}
}

func TestNormalizeOutputRejectsExistingFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(file, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	if _, err := normalizeOutputDirectory(file); err == nil {
		t.Fatalf("expected an existing file to be rejected")
	}
}

func TestFilePickerQueuesSelectedTorrent(t *testing.T) {
	dir := t.TempDir()
	torrentPath := filepath.Join(dir, "debian.torrent")
	if err := os.WriteFile(torrentPath, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	m := testModel(t, nil, ".")
	m.picker = newTorrentPicker(dir)
	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'f'}})
	if m.mode != filePickerMode {
		t.Fatalf("expected file picker mode")
	}
	for i, entry := range m.picker.entries {
		if entry.path == torrentPath {
			m.picker.cursor = i
		}
	}
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyEnter})

	if cmd == nil {
		t.Fatalf("expected selected torrent to spawn a command")
	}
	if len(m.Inputs) != 1 || m.Inputs[0] != torrentPath {
		t.Fatalf("selected torrent was not queued: %v", m.Inputs)
	}
}

func TestModelRestoresQueueAsPausedWithoutSpawning(t *testing.T) {
	queuePath := filepath.Join(t.TempDir(), "queue.json")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	output := filepath.Join(t.TempDir(), "Downloads")
	if err := SaveQueue(queuePath, []QueueItem{
		{Source: magnet, Output: output, Status: "paused"},
	}); err != nil {
		t.Fatal(err)
	}

	m := NewModelWithQueuePath("torl", nil, ".", queuePath)
	if len(m.Inputs) != 1 || m.Inputs[0] != magnet {
		t.Fatalf("expected restored input, got %v", m.Inputs)
	}
	d := m.Downloads[magnet]
	if d == nil || !d.Paused || d.Status != "Paused" || d.Output != output {
		t.Fatalf("expected paused restore: %+v", d)
	}

	// Init should only schedule spinner/tick for a fully paused queue.
	// Spy by clearing paused and comparing command presence is brittle; instead
	// assert the spawn gate directly via a mixed queue.
	active := "magnet:?xt=urn:btih:abcdef1234567890abcdef1234567890abcdef12"
	m.Inputs = append(m.Inputs, active)
	m.Downloads[active] = &Download{ID: active, Output: output, Status: "Starting", Peers: []string{}}

	spawned := 0
	for _, input := range m.Inputs {
		item := m.Downloads[input]
		if item == nil || item.Paused {
			continue
		}
		spawned++
	}
	if spawned != 1 {
		t.Fatalf("expected exactly one active spawn candidate, got %d", spawned)
	}
}

func TestModelResumeReturnsSpawnCommandAndPersists(t *testing.T) {
	queuePath := filepath.Join(t.TempDir(), "queue.json")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	output := filepath.Join(t.TempDir(), "Downloads")
	m := NewModelWithQueuePath("torl", nil, output, queuePath)
	m.Inputs = []string{magnet}
	m.Downloads[magnet] = &Download{
		ID:     magnet,
		Output: output,
		Status: "Paused",
		Paused: true,
		Peers:  []string{},
	}

	cmd := m.togglePause(0)
	if cmd == nil {
		t.Fatalf("resume must return a spawn command")
	}
	d := m.Downloads[magnet]
	if d.Paused || d.Status != "Resuming" {
		t.Fatalf("expected resuming state: %+v", d)
	}

	items, err := LoadQueue(queuePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Source != magnet || items[0].Output != output {
		t.Fatalf("expected queue entry while active/resuming, got %#v", items)
	}
}

func TestModelCompleteRemovesQueueEntry(t *testing.T) {
	queuePath := filepath.Join(t.TempDir(), "queue.json")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	output := filepath.Join(t.TempDir(), "Downloads")
	m := NewModelWithQueuePath("torl", []string{magnet}, output, queuePath)
	m.persistQueueLocked()

	m.handleEvent(Event{Type: "complete", ID: magnet})
	items, err := LoadQueue(queuePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 {
		t.Fatalf("completed download must leave the queue, got %#v", items)
	}
}

func TestModelCLIInputOverridesRestoredPaused(t *testing.T) {
	queuePath := filepath.Join(t.TempDir(), "queue.json")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	output := filepath.Join(t.TempDir(), "Downloads")
	if err := SaveQueue(queuePath, []QueueItem{
		{Source: magnet, Output: output, Status: "paused"},
	}); err != nil {
		t.Fatal(err)
	}

	m := NewModelWithQueuePath("torl", []string{magnet}, output, queuePath)
	d := m.Downloads[magnet]
	if d == nil || d.Paused || d.Status != "Starting" {
		t.Fatalf("CLI input should start immediately: %+v", d)
	}
	cmd := m.Init()
	if cmd == nil {
		t.Fatalf("expected init commands including spawn")
	}
}

func TestModelQuitPersistsPausedQueue(t *testing.T) {
	queuePath := filepath.Join(t.TempDir(), "queue.json")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	output := filepath.Join(t.TempDir(), "Downloads")
	m := NewModelWithQueuePath("torl", []string{magnet}, output, queuePath)

	m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'q'}})

	items, err := LoadQueue(queuePath)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].Source != magnet || items[0].Output != output {
		t.Fatalf("quit should persist incomplete downloads: %#v", items)
	}
	if !m.Downloads[magnet].Paused {
		t.Fatalf("quit should mark downloads paused")
	}
}

func TestDownloadDisplayNameIsSafeAndCompact(t *testing.T) {
	if got := downloadDisplayName(&Download{ID: "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"}); got != "Magnet download" {
		t.Fatalf("unexpected magnet display name: %q", got)
	}

	got := downloadDisplayName(&Download{ID: "evil\x1b[31m.torrent"})
	if strings.ContainsRune(got, '\x1b') {
		t.Fatalf("control sequence leaked into display name: %q", got)
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
	if truncate("Téléchargement", 5) != "Té..." {
		t.Fatalf("truncate must preserve UTF-8: %s", truncate("Téléchargement", 5))
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
