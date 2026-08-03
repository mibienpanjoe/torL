package torl

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

const queueFileVersion = 1

// QueueItem is one incomplete download restored across TUI sessions.
type QueueItem struct {
	Source string `json:"source"`
	Output string `json:"output"`
	Status string `json:"status"`
}

type queueFile struct {
	Version int         `json:"version"`
	Items   []QueueItem `json:"items"`
}

func defaultQueuePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve config directory: %w", err)
	}
	return filepath.Join(configDir, "torl", "queue.json"), nil
}

// LoadQueue reads incomplete downloads from path.
// Missing or unreadable files yield an empty list (not an error).
func LoadQueue(path string) ([]QueueItem, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, nil
	}
	var file queueFile
	if err := json.Unmarshal(data, &file); err != nil {
		return nil, nil
	}
	if file.Version != queueFileVersion {
		return nil, nil
	}
	items := make([]QueueItem, 0, len(file.Items))
	for _, item := range file.Items {
		if item.Source == "" || item.Output == "" {
			continue
		}
		items = append(items, QueueItem{
			Source: item.Source,
			Output: item.Output,
			Status: "paused",
		})
	}
	return items, nil
}

// SaveQueue writes incomplete downloads atomically with restrictive permissions.
func SaveQueue(path string, items []QueueItem) error {
	if path == "" {
		return nil
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create queue directory: %w", err)
	}

	normalized := make([]QueueItem, 0, len(items))
	for _, item := range items {
		if item.Source == "" || item.Output == "" {
			continue
		}
		normalized = append(normalized, QueueItem{
			Source: item.Source,
			Output: item.Output,
			Status: "paused",
		})
	}

	payload, err := json.MarshalIndent(queueFile{
		Version: queueFileVersion,
		Items:   normalized,
	}, "", "  ")
	if err != nil {
		return fmt.Errorf("encode queue: %w", err)
	}
	payload = append(payload, '\n')

	tmp, err := os.CreateTemp(dir, "queue-*.json")
	if err != nil {
		return fmt.Errorf("create temp queue file: %w", err)
	}
	tmpName := tmp.Name()
	defer func() {
		_ = os.Remove(tmpName)
	}()

	if err := tmp.Chmod(0o600); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("set queue permissions: %w", err)
	}
	if _, err := tmp.Write(payload); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("write queue: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close queue: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("replace queue file: %w", err)
	}
	return nil
}
