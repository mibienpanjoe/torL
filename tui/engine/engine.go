package engine

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"github.com/anacrolix/torrent"
	"github.com/anacrolix/torrent/storage"
)

const (
	defaultProgressInterval = time.Second
	maxErrorLength          = 512
)

type Config struct {
	ID               string
	Source           string
	Output           string
	ProgressInterval time.Duration
	configureTorrent func(*torrent.Torrent)
}

func (cfg Config) Validate() error {
	if cfg.ID == "" {
		return errors.New("download id is required")
	}
	if cfg.Source == "" {
		return errors.New("torrent source is required")
	}
	if cfg.Output == "" {
		return errors.New("output directory is required")
	}
	return nil
}

type Event struct {
	Type            string  `json:"type"`
	ID              string  `json:"id,omitempty"`
	Name            string  `json:"name,omitempty"`
	Total           int64   `json:"total,omitempty"`
	Downloaded      int64   `json:"downloaded,omitempty"`
	Uploaded        int64   `json:"uploaded,omitempty"`
	DownloadRate    float64 `json:"downloadRate,omitempty"`
	UploadRate      float64 `json:"uploadRate,omitempty"`
	Percent         float64 `json:"percent,omitempty"`
	CompletedPieces int     `json:"completedPieces,omitempty"`
	TotalPieces     int     `json:"totalPieces,omitempty"`
	ActivePeers     int     `json:"activePeers,omitempty"`
	AvailablePeers  int     `json:"availablePeers,omitempty"`
	Path            string  `json:"path,omitempty"`
	Message         string  `json:"message,omitempty"`
}

type counters struct {
	downloaded int64
	uploaded   int64
	at         time.Time
}

func sampleRates(previous, current counters) (float64, float64) {
	elapsed := current.at.Sub(previous.at).Seconds()
	if elapsed <= 0 {
		return 0, 0
	}
	return float64(max(0, current.downloaded-previous.downloaded)) / elapsed,
		float64(max(0, current.uploaded-previous.uploaded)) / elapsed
}

func waitFor(ctx context.Context, done <-chan struct{}) error {
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func SanitizeError(message string) string {
	message = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, message)
	message = strings.TrimSpace(message)
	runes := []rune(message)
	if len(runes) > maxErrorLength {
		message = string(runes[:maxErrorLength])
	}
	return message
}

func Run(ctx context.Context, cfg Config, emit func(Event) error) error {
	if err := cfg.Validate(); err != nil {
		return err
	}
	if emit == nil {
		return errors.New("event emitter is required")
	}
	if err := os.MkdirAll(cfg.Output, 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	clientConfig := torrent.NewDefaultClientConfig()
	clientConfig.DataDir = cfg.Output
	clientConfig.ListenPort = 0
	clientConfig.Seed = false
	client, err := torrent.NewClient(clientConfig)
	if err != nil {
		return fmt.Errorf("start torrent client: %w", err)
	}
	defer client.Close()

	var download *torrent.Torrent
	if strings.HasPrefix(cfg.Source, "magnet:") {
		download, err = client.AddMagnet(cfg.Source)
	} else {
		download, err = client.AddTorrentFromFile(cfg.Source)
	}
	if err != nil {
		return fmt.Errorf("add torrent: %w", err)
	}
	if err := waitFor(ctx, download.GotInfo()); err != nil {
		return err
	}
	if cfg.configureTorrent != nil {
		cfg.configureTorrent(download)
	}

	total := download.Length()
	totalPieces := int(download.NumPieces())
	safeName, err := storage.ToSafeFilePath(download.Name())
	if err != nil {
		return fmt.Errorf("unsafe torrent name: %w", err)
	}
	if err := emit(Event{Type: "start", ID: cfg.ID, Name: SanitizeError(download.Name()), Total: total, TotalPieces: totalPieces}); err != nil {
		return err
	}
	download.DownloadAll()

	interval := cfg.ProgressInterval
	if interval <= 0 {
		interval = defaultProgressInterval
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	stats := download.Stats()
	previous := counters{downloaded: stats.BytesReadUsefulData.Int64(), uploaded: stats.BytesWrittenData.Int64(), at: time.Now()}

	emitProgress := func(now time.Time) error {
		stats := download.Stats()
		current := counters{downloaded: stats.BytesReadUsefulData.Int64(), uploaded: stats.BytesWrittenData.Int64(), at: now}
		downloadRate, uploadRate := sampleRates(previous, current)
		previous = current
		completed := download.BytesCompleted()
		percent := 0.0
		if total > 0 {
			percent = min(1, float64(completed)/float64(total))
		}
		return emit(Event{
			Type: "progress", ID: cfg.ID, Total: total, Downloaded: completed,
			Uploaded: current.uploaded, DownloadRate: downloadRate, UploadRate: uploadRate,
			Percent: percent, CompletedPieces: stats.PiecesComplete, TotalPieces: totalPieces,
			ActivePeers: stats.ActivePeers, AvailablePeers: max(0, stats.TotalPeers-stats.ActivePeers),
		})
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			if err := emitProgress(time.Now()); err != nil {
				return err
			}
		case <-download.Complete().On():
			if err := emitProgress(time.Now()); err != nil {
				return err
			}
			return emit(Event{Type: "complete", ID: cfg.ID, Path: filepath.Join(cfg.Output, safeName)})
		}
	}
}
