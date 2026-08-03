package torl

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadQueueMissingFileReturnsEmpty(t *testing.T) {
	items, err := LoadQueue(filepath.Join(t.TempDir(), "missing.json"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty queue, got %#v", items)
	}
}

func TestLoadQueueCorruptFileReturnsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queue.json")
	if err := os.WriteFile(path, []byte("{not-json"), 0o600); err != nil {
		t.Fatal(err)
	}
	items, err := LoadQueue(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty queue for corrupt file, got %#v", items)
	}
}

func TestSaveAndLoadQueueRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "torl", "queue.json")
	magnet := "magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678"
	output := filepath.Join(t.TempDir(), "Downloads")

	if err := SaveQueue(path, []QueueItem{
		{Source: magnet, Output: output, Status: "active"},
		{Source: "", Output: output, Status: "paused"},
	}); err != nil {
		t.Fatalf("save: %v", err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected 0600 permissions, got %o", info.Mode().Perm())
	}

	items, err := LoadQueue(path)
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 item, got %#v", items)
	}
	if items[0].Source != magnet || items[0].Output != output || items[0].Status != "paused" {
		t.Fatalf("unexpected item: %#v", items[0])
	}
}

func TestLoadQueueSkipsWrongVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "queue.json")
	if err := os.WriteFile(path, []byte(`{"version":99,"items":[{"source":"x","output":"y","status":"paused"}]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	items, err := LoadQueue(path)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected empty queue for wrong version, got %#v", items)
	}
}
