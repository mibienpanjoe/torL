package engine

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestConfigValidate(t *testing.T) {
	valid := Config{ID: "id", Source: "file.torrent", Output: t.TempDir()}
	if err := valid.Validate(); err != nil {
		t.Fatalf("valid config rejected: %v", err)
	}
	for _, cfg := range []Config{
		{Source: "file.torrent", Output: t.TempDir()},
		{ID: "id", Output: t.TempDir()},
		{ID: "id", Source: "file.torrent"},
	} {
		if err := cfg.Validate(); err == nil {
			t.Fatalf("invalid config accepted: %+v", cfg)
		}
	}
}

func TestSanitizeError(t *testing.T) {
	message := SanitizeError(strings.Repeat("x", maxErrorLength) + "\nsecret")
	if strings.ContainsAny(message, "\r\n") || len(message) > maxErrorLength {
		t.Fatalf("unsafe error message: %q", message)
	}
}

func TestSampleRates(t *testing.T) {
	previous := counters{downloaded: 100, uploaded: 50, at: time.Unix(1, 0)}
	current := counters{downloaded: 1124, uploaded: 178, at: time.Unix(2, 0)}
	downloadRate, uploadRate := sampleRates(previous, current)
	if downloadRate != 1024 || uploadRate != 128 {
		t.Fatalf("unexpected rates: %v %v", downloadRate, uploadRate)
	}
}

func TestWaitForInfoHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := waitFor(ctx, make(chan struct{})); err != context.Canceled {
		t.Fatalf("expected cancellation, got %v", err)
	}
}
