package engine

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/metainfo"
)

func TestRunDownloadsFromLocalSeeder(t *testing.T) {
	sourceDir := t.TempDir()
	payload := bytes.Repeat([]byte("torl-anacrolix-"), 4096)
	payloadPath := filepath.Join(sourceDir, "payload.bin")
	if err := os.WriteFile(payloadPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	info := metainfo.Info{PieceLength: 16 * 1024}
	if err := info.BuildFromFilePath(payloadPath); err != nil {
		t.Fatal(err)
	}
	infoBytes, err := bencode.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	meta := metainfo.MetaInfo{InfoBytes: infoBytes}
	torrentPath := filepath.Join(t.TempDir(), "payload.torrent")
	torrentFile, err := os.Create(torrentPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := meta.Write(torrentFile); err != nil {
		torrentFile.Close()
		t.Fatal(err)
	}
	if err := torrentFile.Close(); err != nil {
		t.Fatal(err)
	}

	seederConfig := torrent.TestingConfig(t)
	seederConfig.DataDir = sourceDir
	seederConfig.Seed = true
	seederConfig.MaxAllocPeerRequestDataPerConn = 1 << 20
	seeder, err := torrent.NewClient(seederConfig)
	if err != nil {
		if errors.Is(err, syscall.EPERM) || strings.Contains(err.Error(), "operation not permitted") {
			t.Skip("sandbox does not permit local listen sockets")
		}
		t.Fatal(err)
	}
	defer seeder.Close()
	seedTorrent, err := seeder.AddTorrent(&meta)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-seedTorrent.Complete().On():
	case <-time.After(5 * time.Second):
		t.Fatal("seeder did not verify fixture")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var events []Event
	outputDir := t.TempDir()
	err = Run(ctx, Config{
		ID: "fixture", Source: torrentPath, Output: outputDir, ProgressInterval: 10 * time.Millisecond,
		configureTorrent: func(download *torrent.Torrent) { download.AddClientPeer(seeder) },
	}, func(event Event) error {
		events = append(events, event)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	downloaded, err := os.ReadFile(filepath.Join(outputDir, "payload.bin"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(downloaded, payload) {
		t.Fatal("downloaded payload differs from source")
	}
	if len(events) < 2 || events[0].Type != "start" || events[len(events)-1].Type != "complete" {
		t.Fatalf("unexpected events: %+v", events)
	}
}
