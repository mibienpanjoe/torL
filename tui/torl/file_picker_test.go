package torl

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTorrentPickerFiltersFiles(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "debian.torrent"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("ignore"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "evil\x1b[31m.torrent"), []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, ".git"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(dir, "node_modules"), 0o700); err != nil {
		t.Fatal(err)
	}

	picker := newTorrentPicker(dir)
	view := picker.View(10)

	if !strings.Contains(view, "nested/") || !strings.Contains(view, "debian.torrent") {
		t.Fatalf("expected directory and torrent in picker: %q", view)
	}
	if strings.Contains(view, "notes.txt") {
		t.Fatalf("non-torrent file leaked into picker: %q", view)
	}
	if strings.Contains(view, ".git") || strings.Contains(view, "node_modules") {
		t.Fatalf("technical directories leaked into picker: %q", view)
	}
	if strings.ContainsRune(view, '\x1b') {
		t.Fatalf("terminal control sequence leaked into picker: %q", view)
	}
}

func TestTorrentPickerSelectsTorrent(t *testing.T) {
	dir := t.TempDir()
	torrentPath := filepath.Join(dir, "debian.torrent")
	if err := os.WriteFile(torrentPath, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}

	picker := newTorrentPicker(dir)
	for i, entry := range picker.entries {
		if entry.name == "debian.torrent" {
			picker.cursor = i
		}
	}

	selected, ok, err := picker.Select()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ok || selected != torrentPath {
		t.Fatalf("expected %q, got %q (selected=%v)", torrentPath, selected, ok)
	}
}
