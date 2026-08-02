package torl

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"unicode"
)

const (
	maxSourceInputRunes = 4096
	maxPathInputRunes   = 4096
)

func normalizeSource(raw string) (string, error) {
	source := trimOuterQuotes(strings.TrimSpace(raw))
	if source == "" {
		return "", fmt.Errorf("enter a magnet link or .torrent path")
	}
	if len([]rune(source)) > maxSourceInputRunes {
		return "", fmt.Errorf("download source is too long")
	}
	if containsControlRune(source) {
		return "", fmt.Errorf("control characters are not allowed")
	}

	if strings.HasPrefix(strings.ToLower(source), "magnet:") {
		if !strings.HasPrefix(source, "magnet:?") {
			return "", fmt.Errorf("invalid magnet link")
		}
		parsed, err := url.Parse(source)
		if err != nil || !strings.EqualFold(parsed.Scheme, "magnet") {
			return "", fmt.Errorf("invalid magnet link")
		}
		infoHash := parsed.Query().Get("xt")
		if !strings.HasPrefix(strings.ToLower(infoHash), "urn:btih:") {
			return "", fmt.Errorf("magnet link is missing a BitTorrent info hash")
		}
		if !validInfoHash(infoHash[len("urn:btih:"):]) {
			return "", fmt.Errorf("magnet link has an invalid BitTorrent info hash")
		}
		return source, nil
	}

	if !strings.EqualFold(filepath.Ext(source), ".torrent") {
		return "", fmt.Errorf("select a .torrent file or paste a magnet link")
	}

	expanded, err := expandUserPath(source)
	if err != nil {
		return "", err
	}
	absolute, err := filepath.Abs(expanded)
	if err != nil {
		return "", fmt.Errorf("resolve torrent path: %w", err)
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", fmt.Errorf("torrent file not found")
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("torrent path is not a file")
	}
	return filepath.Clean(absolute), nil
}

func normalizeOutputDirectory(raw string) (string, error) {
	value := trimOuterQuotes(strings.TrimSpace(raw))
	if value == "" {
		return "", fmt.Errorf("enter an output directory")
	}
	if len([]rune(value)) > maxPathInputRunes {
		return "", fmt.Errorf("output path is too long")
	}
	if containsControlRune(value) {
		return "", fmt.Errorf("control characters are not allowed")
	}
	expanded, err := expandUserPath(value)
	if err != nil {
		return "", err
	}
	absolute, err := filepath.Abs(expanded)
	if err != nil {
		return "", fmt.Errorf("resolve output directory: %w", err)
	}
	info, err := os.Stat(absolute)
	if err == nil && !info.IsDir() {
		return "", fmt.Errorf("output path is not a directory")
	}
	if err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("inspect output directory: %w", err)
	}
	return filepath.Clean(absolute), nil
}

func validInfoHash(value string) bool {
	switch len(value) {
	case 40:
		for _, char := range value {
			if !strings.ContainsRune("0123456789abcdefABCDEF", char) {
				return false
			}
		}
		return true
	case 32:
		for _, char := range value {
			upper := unicode.ToUpper(char)
			if (upper < 'A' || upper > 'Z') && (upper < '2' || upper > '7') {
				return false
			}
		}
		return true
	default:
		return false
	}
}

func containsControlRune(value string) bool {
	for _, char := range value {
		if unicode.IsControl(char) {
			return true
		}
	}
	return false
}

func sanitizeTerminalText(value string) string {
	return strings.Map(func(char rune) rune {
		if unicode.IsControl(char) {
			return '�'
		}
		return char
	}, value)
}

func trimOuterQuotes(value string) string {
	if len(value) < 2 {
		return value
	}
	first, last := value[0], value[len(value)-1]
	if (first == '\'' && last == '\'') || (first == '"' && last == '"') {
		return strings.TrimSpace(value[1 : len(value)-1])
	}
	return value
}

func expandUserPath(value string) (string, error) {
	if value != "~" && !strings.HasPrefix(value, "~/") && !strings.HasPrefix(value, `~\`) {
		return value, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve home directory: %w", err)
	}
	if value == "~" {
		return home, nil
	}
	return filepath.Join(home, value[2:]), nil
}

func insertInputRunes(value string, cursor int, inserted []rune) (string, int) {
	runes := []rune(value)
	if cursor < 0 {
		cursor = 0
	}
	if cursor > len(runes) {
		cursor = len(runes)
	}
	result := make([]rune, 0, len(runes)+len(inserted))
	result = append(result, runes[:cursor]...)
	result = append(result, inserted...)
	result = append(result, runes[cursor:]...)
	return string(result), cursor + len(inserted)
}

func deleteInputRune(value string, cursor, offset int) (string, int) {
	runes := []rune(value)
	index := cursor + offset
	if index < 0 || index >= len(runes) {
		return value, cursor
	}
	runes = append(runes[:index], runes[index+1:]...)
	if offset < 0 {
		cursor--
	}
	return string(runes), cursor
}

func renderInput(value string, cursor, width int) string {
	runes := []rune(value)
	if cursor < 0 {
		cursor = 0
	}
	if cursor > len(runes) {
		cursor = len(runes)
	}
	if width < 2 {
		return "█"
	}

	start := 0
	if cursor >= width-1 {
		start = cursor - width + 2
	}
	end := start + width - 1
	if end > len(runes) {
		end = len(runes)
	}
	visible := append([]rune(nil), runes[start:end]...)
	visibleCursor := cursor - start
	if visibleCursor > len(visible) {
		visibleCursor = len(visible)
	}
	visible = append(visible, 0)
	copy(visible[visibleCursor+1:], visible[visibleCursor:])
	visible[visibleCursor] = '█'
	if start > 0 {
		visible[0] = '…'
	}
	return string(visible)
}
