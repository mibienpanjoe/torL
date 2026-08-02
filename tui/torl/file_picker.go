package torl

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type pickerEntry struct {
	name  string
	path  string
	isDir bool
}

type torrentPicker struct {
	directory string
	entries   []pickerEntry
	cursor    int
	err       error
}

func newTorrentPicker(directory string) *torrentPicker {
	picker := &torrentPicker{}
	if directory == "" {
		directory, _ = os.Getwd()
	}
	picker.err = picker.setDirectory(directory)
	return picker
}

func (p *torrentPicker) setDirectory(directory string) error {
	absolute, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	items, err := os.ReadDir(absolute)
	if err != nil {
		return err
	}

	entries := make([]pickerEntry, 0, len(items)+1)
	parent := filepath.Dir(absolute)
	if parent != absolute {
		entries = append(entries, pickerEntry{name: "..", path: parent, isDir: true})
	}
	for _, item := range items {
		if strings.HasPrefix(item.Name(), ".") || item.Name() == "node_modules" {
			continue
		}
		if !item.IsDir() && !strings.EqualFold(filepath.Ext(item.Name()), ".torrent") {
			continue
		}
		name := sanitizeTerminalText(item.Name())
		if item.IsDir() {
			name += string(filepath.Separator)
		}
		entries = append(entries, pickerEntry{
			name:  name,
			path:  filepath.Join(absolute, item.Name()),
			isDir: item.IsDir(),
		})
	}

	p.directory = absolute
	p.entries = entries
	p.cursor = 0
	p.err = nil
	return nil
}

func (p *torrentPicker) Move(delta int) {
	if len(p.entries) == 0 {
		return
	}
	p.cursor += delta
	if p.cursor < 0 {
		p.cursor = 0
	}
	if p.cursor >= len(p.entries) {
		p.cursor = len(p.entries) - 1
	}
}

func (p *torrentPicker) Parent() error {
	return p.setDirectory(filepath.Dir(p.directory))
}

func (p *torrentPicker) Select() (string, bool, error) {
	if len(p.entries) == 0 {
		return "", false, nil
	}
	entry := p.entries[p.cursor]
	if entry.isDir {
		return "", false, p.setDirectory(entry.path)
	}
	return entry.path, true, nil
}

func (p *torrentPicker) View(maxRows int) string {
	var b strings.Builder
	b.WriteString(infoStyle.Render(p.directory) + "\n")
	if p.err != nil {
		b.WriteString(errorStyle.Render(p.err.Error()))
		return b.String()
	}
	if len(p.entries) == 0 {
		b.WriteString(infoStyle.Render("  No folders or .torrent files here"))
		return b.String()
	}

	if maxRows < 1 {
		maxRows = 1
	}
	start := 0
	if p.cursor >= maxRows {
		start = p.cursor - maxRows + 1
	}
	end := start + maxRows
	if end > len(p.entries) {
		end = len(p.entries)
	}
	for i := start; i < end; i++ {
		cursor := "  "
		name := p.entries[i].name
		if i == p.cursor {
			cursor = "▸ "
			name = selectedStyle.Render(name)
		}
		b.WriteString(fmt.Sprintf("%s%s\n", cursor, name))
	}
	return strings.TrimSuffix(b.String(), "\n")
}
