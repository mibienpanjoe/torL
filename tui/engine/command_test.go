package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"testing"
)

func TestParseCommandArgs(t *testing.T) {
	cfg, err := ParseCommandArgs([]string{"--id", "job", "-o", "/tmp/out", "magnet:?xt=urn:btih:test"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ID != "job" || cfg.Output != "/tmp/out" || cfg.Source != "magnet:?xt=urn:btih:test" {
		t.Fatalf("unexpected config: %+v", cfg)
	}
}

func TestParseCommandArgsRejectsUnknownOption(t *testing.T) {
	if _, err := ParseCommandArgs([]string{"--shell", "value"}); err == nil {
		t.Fatal("unknown option accepted")
	}
}

func TestRunCommandEmitsSanitizedError(t *testing.T) {
	var output bytes.Buffer
	err := RunCommand(context.Background(), []string{"--id", "job", "-o", "/tmp/out", "file.torrent"}, &output,
		func(context.Context, Config, func(Event) error) error { return errors.New("bad\nterminal") })
	if err == nil {
		t.Fatal("expected command error")
	}
	var event Event
	if decodeErr := json.Unmarshal(output.Bytes(), &event); decodeErr != nil {
		t.Fatalf("invalid event: %v", decodeErr)
	}
	if event.Type != "error" || event.ID != "job" || event.Message != "bad terminal" {
		t.Fatalf("unexpected event: %+v", event)
	}
}

func TestRunCommandTreatsCancellationAsSuccess(t *testing.T) {
	var output bytes.Buffer
	err := RunCommand(context.Background(), []string{"--id", "job", "-o", "/tmp/out", "file.torrent"}, &output,
		func(context.Context, Config, func(Event) error) error { return context.Canceled })
	if err != nil || output.Len() != 0 {
		t.Fatalf("cancellation should be quiet success, err=%v output=%q", err, output.String())
	}
}
