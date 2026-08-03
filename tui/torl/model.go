package torl

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

var (
	titleStyle    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7D56F4")).MarginBottom(1)
	errorStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#FF5F87")).Bold(true)
	infoStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("#A3A3A3"))
	activeStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#04B575"))
	labelStyle    = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FAFAFA"))
	selectedStyle = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7D56F4"))
	pausedStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#F59E0B"))
	panelStyle    = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("#874BFD")).Padding(1).Width(70)
	itemStyle     = lipgloss.NewStyle().Border(lipgloss.HiddenBorder()).Padding(0, 1).Width(66)
	peerStyle     = lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
	footerStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#737373")).MarginTop(1)
)

type tickMsg time.Time

type interactionMode int

const (
	dashboardMode interactionMode = iota
	sourceInputMode
	outputInputMode
	filePickerMode
)

func NewModel(torlPath string, inputs []string, output string) *Model {
	queuePath, _ := defaultQueuePath()
	return NewModelWithQueuePath(torlPath, inputs, output, queuePath)
}

// NewModelWithQueuePath builds a model that persists incomplete downloads at queuePath.
// An empty queuePath disables persistence (useful in tests).
func NewModelWithQueuePath(torlPath string, inputs []string, output string, queuePath string) *Model {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#7D56F4"))

	prog := progress.New(progress.WithDefaultGradient())
	prog.Width = 50

	workingDirectory, _ := os.Getwd()

	downloads := make(map[string]*Download)
	var ordered []string
	pending := 0

	if queuePath != "" {
		if items, err := LoadQueue(queuePath); err == nil {
			for _, item := range items {
				source := canonicalizeSource(item.Source)
				if _, exists := downloads[source]; exists {
					continue
				}
				out := item.Output
				if out == "" {
					out = output
				}
				downloads[source] = &Download{
					ID:     source,
					Output: out,
					Status: "Paused",
					Paused: true,
					Peers:  []string{},
				}
				ordered = append(ordered, source)
			}
		}
	}

	for _, input := range inputs {
		source := canonicalizeSource(input)
		if d, exists := downloads[source]; exists {
			d.Paused = false
			d.Status = "Starting"
			d.Output = output
			d.Done = false
			d.Err = nil
			pending++
			continue
		}
		downloads[source] = &Download{
			ID:     source,
			Output: output,
			Status: "Starting",
			Peers:  []string{},
		}
		ordered = append(ordered, source)
		pending++
	}

	return &Model{
		TorlPath:     torlPath,
		Inputs:       ordered,
		Output:       output,
		Downloads:    downloads,
		pendingCount: pending,
		processes:    make(map[string]*exec.Cmd),
		stderrBufs:   make(map[string]string),
		spinner:      sp,
		progress:     prog,
		messages:     []string{},
		picker:       newTorrentPicker(workingDirectory),
		queuePath:    queuePath,
	}
}

type Download struct {
	ID              string
	Name            string
	Total           int64
	Downloaded      int64
	Percent         float64
	CompletedPieces int
	TotalPieces     int
	ActivePeers     int
	AvailablePeers  int
	Peers           []string
	Status          string
	Err             error
	Done            bool
	Started         bool
	LastUpdate      time.Time
	LastDownloaded  int64
	SpeedBps        float64
	Paused          bool
	Output          string
}

type Model struct {
	TorlPath string
	Inputs   []string
	Output   string

	mu           sync.Mutex
	Downloads    map[string]*Download
	messages     []string
	pendingCount int
	processErr   error
	cursor       int
	processes    map[string]*exec.Cmd
	stderrBufs   map[string]string
	mode         interactionMode
	inputValue   string
	inputCursor  int
	inputError   string
	picker       *torrentPicker
	queuePath    string

	spinner  spinner.Model
	progress progress.Model
}

func (m *Model) Init() tea.Cmd {
	cmds := []tea.Cmd{m.spinner.Tick, m.tick()}
	for _, input := range m.Inputs {
		d := m.Downloads[input]
		if d == nil || d.Paused {
			continue
		}
		output := d.Output
		if output == "" {
			output = m.Output
		}
		cmds = append(cmds, m.spawnProcess(input, output))
	}
	return tea.Batch(cmds...)
}

func (m *Model) tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m *Model) spawnProcess(input, output string) tea.Cmd {
	return func() tea.Msg {
		args := []string{input, "--json", "-o", output}
		cmd := exec.Command(m.TorlPath, args...)
		cmd.Env = os.Environ()

		m.mu.Lock()
		m.processes[input] = cmd
		m.mu.Unlock()

		stdout, err := cmd.StdoutPipe()
		if err != nil {
			m.mu.Lock()
			delete(m.processes, input)
			delete(m.stderrBufs, input)
			m.mu.Unlock()
			return procErrMsg{input: input, err: err}
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			m.mu.Lock()
			delete(m.processes, input)
			delete(m.stderrBufs, input)
			m.mu.Unlock()
			return procErrMsg{input: input, err: err}
		}

		if err := cmd.Start(); err != nil {
			m.mu.Lock()
			delete(m.processes, input)
			delete(m.stderrBufs, input)
			m.mu.Unlock()
			return procErrMsg{input: input, err: err}
		}

		go m.readStderr(stderr, input)

		scanner := bufio.NewScanner(stdout)
		for scanner.Scan() {
			line := scanner.Bytes()
			if len(line) == 0 {
				continue
			}
			event, err := ParseEvent(line)
			if err != nil {
				m.appendMessage(fmt.Sprintf("parse error: %v", err))
				continue
			}
			m.handleEvent(event)
		}

		if err := scanner.Err(); err != nil {
			m.mu.Lock()
			lastStderr := m.stderrBufs[input]
			delete(m.stderrBufs, input)
			delete(m.processes, input)
			m.mu.Unlock()
			return procErrMsg{input: input, err: err, stderr: lastStderr}
		}

		if err := cmd.Wait(); err != nil {
			m.mu.Lock()
			shouldIgnore := m.Downloads[input] != nil && m.Downloads[input].Paused
			lastStderr := m.stderrBufs[input]
			delete(m.stderrBufs, input)
			delete(m.processes, input)
			m.mu.Unlock()
			if shouldIgnore {
				return nil
			}
			return procErrMsg{input: input, err: err, stderr: lastStderr}
		}

		m.mu.Lock()
		delete(m.processes, input)
		m.mu.Unlock()
		return procDoneMsg{input: input}
	}
}

func (m *Model) readStderr(stderr io.ReadCloser, input string) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		line := scanner.Text()
		m.mu.Lock()
		m.stderrBufs[input] = line
		m.mu.Unlock()
		m.appendMessage(line)
	}
}

func (m *Model) appendMessage(msg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, sanitizeTerminalText(msg))
	if len(m.messages) > 5 {
		m.messages = m.messages[1:]
	}
}

func (m *Model) download(id string) *Download {
	d, ok := m.Downloads[id]
	if !ok {
		d = &Download{ID: id, Status: "Unknown", Peers: []string{}}
		m.Downloads[id] = d
	}
	return d
}

func (m *Model) handleEvent(event Event) {
	m.mu.Lock()
	defer m.mu.Unlock()

	d := m.download(event.ID)

	switch event.Type {
	case "start":
		d.Started = true
		d.Name = event.Name
		d.Total = event.Total
		d.TotalPieces = event.TotalPieces
		if d.Status == "Resuming" {
			// stay as Resuming until the first progress comes in
		} else {
			d.Status = "Downloading"
		}
	case "progress":
		now := time.Now()
		if !d.LastUpdate.IsZero() {
			elapsed := now.Sub(d.LastUpdate).Seconds()
			if elapsed > 0 {
				delta := event.Downloaded - d.LastDownloaded
				instant := float64(delta) / elapsed
				if d.SpeedBps == 0 {
					d.SpeedBps = instant
				} else {
					d.SpeedBps = 0.7*d.SpeedBps + 0.3*instant
				}
			}
		}
		d.LastUpdate = now
		d.LastDownloaded = event.Downloaded
		d.Downloaded = event.Downloaded
		d.Total = event.Total
		d.Percent = event.Percent
		d.CompletedPieces = event.CompletedPieces
		d.TotalPieces = event.TotalPieces
		d.ActivePeers = event.ActivePeers
		d.AvailablePeers = event.AvailablePeers
		d.Status = "Downloading"
		d.Paused = false
	case "peer":
		peer := fmt.Sprintf("%s %s", peerActionIcon(event.Action), event.Peer)
		d.Peers = append(d.Peers, peer)
		if len(d.Peers) > 10 {
			d.Peers = d.Peers[1:]
		}
	case "complete":
		d.Done = true
		d.Status = "Complete"
		d.Percent = 1.0
		d.Paused = false
		m.persistQueueLocked()
	case "error":
		d.Err = fmt.Errorf("%s", event.Message)
		d.Status = "Error"
		d.Paused = true
		m.persistQueueLocked()
	}
}

func (m *Model) allDone() bool {
	for _, d := range m.Downloads {
		if !d.Done && d.Err == nil && !d.Paused {
			return false
		}
	}
	return true
}

func (m *Model) anyError() error {
	for _, d := range m.Downloads {
		if d.Err != nil {
			return d.Err
		}
	}
	return nil
}

func peerActionIcon(action string) string {
	if action == "connected" {
		return activeStyle.Render("+")
	}
	return infoStyle.Render("-")
}

type procErrMsg struct {
	input  string
	err    error
	stderr string
}

type procDoneMsg struct {
	input string
}

type errMsg struct{ err error }
type doneMsg struct{}

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "ctrl+c" {
			m.shutdownAll()
			return m, tea.Quit
		}
		if m.mode == sourceInputMode {
			return m.updateSourceInput(msg)
		}
		if m.mode == outputInputMode {
			return m.updateOutputInput(msg)
		}
		if m.mode == filePickerMode {
			return m.updateFilePicker(msg)
		}
		switch msg.String() {
		case "q":
			m.shutdownAll()
			return m, tea.Quit
		case "a":
			return m, m.openSourceInput()
		case "f":
			if err := m.picker.setDirectory(m.picker.directory); err != nil {
				m.appendMessage(err.Error())
				return m, nil
			}
			m.mode = filePickerMode
			m.inputError = ""
		case "o":
			return m, m.openOutputInput()
		case "up", "k":
			if m.cursor > 0 {
				m.cursor--
			}
		case "down", "j":
			if m.cursor < len(m.Inputs)-1 {
				m.cursor++
			}
		case "p":
			return m, m.togglePause(m.cursor)
		}
	case tickMsg:
		return m, m.tick()
	case procErrMsg:
		m.mu.Lock()
		d := m.download(msg.input)
		if d.Paused {
			delete(m.processes, msg.input)
			delete(m.stderrBufs, msg.input)
			m.mu.Unlock()
			return m, nil
		}
		if msg.stderr != "" {
			m.processErr = fmt.Errorf("torrent %s: %s", path.Base(msg.input), msg.stderr)
		} else {
			m.processErr = fmt.Errorf("torrent %s: %w", path.Base(msg.input), msg.err)
		}
		d.Err = msg.err
		d.Status = "Error"
		d.Paused = true
		m.pendingCount--
		m.persistQueueLocked()
		m.mu.Unlock()
		m.appendMessage(msg.err.Error())
	case procDoneMsg:
		m.mu.Lock()
		d := m.download(msg.input)
		if d.Paused {
			delete(m.processes, msg.input)
			m.mu.Unlock()
			return m, nil
		}
		m.pendingCount--
		if d.Done {
			m.persistQueueLocked()
		}
		m.mu.Unlock()
	case errMsg:
		m.appendMessage(msg.err.Error())
		return m, tea.Quit
	case doneMsg:
		return m, tea.Quit
	case spinner.TickMsg:
		var cmd tea.Cmd
		m.spinner, cmd = m.spinner.Update(msg)
		return m, cmd
	case progress.FrameMsg:
		pm, cmd := m.progress.Update(msg)
		m.progress = pm.(progress.Model)
		return m, cmd
	}
	return m, nil
}

func (m *Model) openSourceInput() tea.Cmd {
	m.mode = sourceInputMode
	m.inputError = ""
	m.inputValue = ""
	m.inputCursor = 0
	return nil
}

func (m *Model) openOutputInput() tea.Cmd {
	m.mode = outputInputMode
	m.inputError = ""
	m.inputValue = m.Output
	m.inputCursor = len([]rune(m.inputValue))
	return nil
}

func (m *Model) updateSourceInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.inputError = ""
		m.mode = dashboardMode
		return m, nil
	case "enter":
		cmd, err := m.queueSource(m.inputValue)
		if err != nil {
			m.inputError = err.Error()
			return m, nil
		}
		m.inputError = ""
		m.mode = dashboardMode
		return m, cmd
	}
	m.updateInputValue(msg)
	return m, nil
}

func (m *Model) updateOutputInput(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.inputError = ""
		m.mode = dashboardMode
		return m, nil
	case "enter":
		output, err := normalizeOutputDirectory(m.inputValue)
		if err != nil {
			m.inputError = err.Error()
			return m, nil
		}
		m.Output = output
		m.inputError = ""
		m.mode = dashboardMode
		m.appendMessage("New downloads will be saved to " + output)
		return m, nil
	}
	m.updateInputValue(msg)
	return m, nil
}

func (m *Model) updateInputValue(msg tea.KeyMsg) {
	switch msg.String() {
	case "left":
		if m.inputCursor > 0 {
			m.inputCursor--
		}
	case "right":
		if m.inputCursor < len([]rune(m.inputValue)) {
			m.inputCursor++
		}
	case "home":
		m.inputCursor = 0
	case "end":
		m.inputCursor = len([]rune(m.inputValue))
	case "backspace":
		m.inputValue, m.inputCursor = deleteInputRune(m.inputValue, m.inputCursor, -1)
	case "delete":
		m.inputValue, m.inputCursor = deleteInputRune(m.inputValue, m.inputCursor, 0)
	default:
		if msg.Type == tea.KeyRunes {
			for _, char := range msg.Runes {
				if unicode.IsControl(char) {
					m.inputError = "control characters are not allowed"
					return
				}
			}
			limit := maxSourceInputRunes
			if m.mode == outputInputMode {
				limit = maxPathInputRunes
			}
			if len([]rune(m.inputValue))+len(msg.Runes) > limit {
				m.inputError = "input is too long"
				return
			}
			m.inputValue, m.inputCursor = insertInputRunes(m.inputValue, m.inputCursor, msg.Runes)
			m.inputError = ""
		}
	}
}

func (m *Model) updateFilePicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch msg.String() {
	case "esc":
		m.mode = dashboardMode
		m.inputError = ""
	case "up", "k":
		m.picker.Move(-1)
	case "down", "j":
		m.picker.Move(1)
	case "left", "h", "backspace":
		if err := m.picker.Parent(); err != nil {
			m.inputError = err.Error()
		}
	case "enter":
		selected, ok, err := m.picker.Select()
		if err != nil {
			m.inputError = err.Error()
			return m, nil
		}
		if !ok {
			return m, nil
		}
		cmd, err := m.queueSource(selected)
		if err != nil {
			m.inputError = err.Error()
			return m, nil
		}
		m.mode = dashboardMode
		m.inputError = ""
		return m, cmd
	}
	return m, nil
}

func (m *Model) queueSource(raw string) (tea.Cmd, error) {
	source, err := normalizeSource(raw)
	if err != nil {
		return nil, err
	}

	m.mu.Lock()
	if _, exists := m.Downloads[source]; exists {
		m.mu.Unlock()
		return nil, fmt.Errorf("download is already in the list")
	}
	m.Inputs = append(m.Inputs, source)
	m.Downloads[source] = &Download{
		ID:     source,
		Output: m.Output,
		Status: "Starting",
		Peers:  []string{},
	}
	m.pendingCount++
	m.persistQueueLocked()
	m.mu.Unlock()

	return m.spawnProcess(source, m.Output), nil
}

func (m *Model) togglePause(idx int) tea.Cmd {
	m.mu.Lock()
	defer m.mu.Unlock()

	if idx < 0 || idx >= len(m.Inputs) {
		return nil
	}
	input := m.Inputs[idx]
	d := m.Downloads[input]
	if d == nil {
		return nil
	}

	if d.Paused {
		d.Paused = false
		d.Status = "Resuming"
		d.SpeedBps = 0
		d.Err = nil
		m.persistQueueLocked()
		output := d.Output
		if output == "" {
			output = m.Output
		}
		return m.spawnProcess(input, output)
	}

	if d.Status != "Complete" && d.Status != "Error" {
		d.Paused = true
		d.Status = "Paused"
		d.SpeedBps = 0
		if cmd, ok := m.processes[input]; ok && cmd.Process != nil {
			_ = cmd.Process.Signal(syscall.SIGTERM)
		}
		m.persistQueueLocked()
	}
	return nil
}

func (m *Model) shutdownAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for input, d := range m.Downloads {
		if !d.Done && d.Err == nil {
			d.Paused = true
			d.Status = "Paused"
			d.SpeedBps = 0
			if cmd, ok := m.processes[input]; ok && cmd.Process != nil {
				_ = cmd.Process.Signal(syscall.SIGTERM)
			}
		}
	}
	m.persistQueueLocked()
}

func (m *Model) persistQueueLocked() {
	if m.queuePath == "" {
		return
	}
	items := make([]QueueItem, 0, len(m.Inputs))
	for _, input := range m.Inputs {
		d := m.Downloads[input]
		if d == nil || d.Done {
			continue
		}
		output := d.Output
		if output == "" {
			output = m.Output
		}
		items = append(items, QueueItem{
			Source: canonicalizeSource(input),
			Output: output,
			Status: "paused",
		})
	}
	if err := SaveQueue(m.queuePath, items); err != nil {
		m.messages = append(m.messages, sanitizeTerminalText("queue save failed: "+err.Error()))
		if len(m.messages) > 5 {
			m.messages = m.messages[1:]
		}
	}
}

func canonicalizeSource(source string) string {
	if source == "" || strings.HasPrefix(strings.ToLower(source), "magnet:") {
		return source
	}
	abs, err := filepath.Abs(source)
	if err != nil {
		return source
	}
	return filepath.Clean(abs)
}

func (m *Model) View() string {
	m.mu.Lock()
	defer m.mu.Unlock()

	var b strings.Builder
	b.WriteString(titleStyle.Render("torl"))
	b.WriteString("\n\n")
	if len(m.Inputs) == 0 && m.mode == dashboardMode {
		b.WriteString(labelStyle.Render("No downloads yet") + "\n")
		b.WriteString(infoStyle.Render("  a add a magnet or path   f browse .torrent files") + "\n\n")
	}

	for i, input := range m.Inputs {
		d := m.Downloads[input]
		b.WriteString(m.renderDownload(d, i == m.cursor))
		b.WriteString("\n")
	}

	switch m.mode {
	case sourceInputMode:
		b.WriteString(labelStyle.Render("Add download") + "\n")
		b.WriteString(infoStyle.Render("Paste a magnet link or enter a .torrent path") + "\n")
		b.WriteString("› " + renderInput(m.inputValue, m.inputCursor, 58) + "\n")
		if m.inputError != "" {
			b.WriteString(errorStyle.Render(m.inputError) + "\n")
		}
		b.WriteString(footerStyle.Render("enter add  esc cancel"))
		return panelStyle.Render(b.String())
	case outputInputMode:
		b.WriteString(labelStyle.Render("Output for new downloads") + "\n")
		b.WriteString(infoStyle.Render("The directory may be created when a download starts") + "\n")
		b.WriteString("› " + renderInput(m.inputValue, m.inputCursor, 58) + "\n")
		if m.inputError != "" {
			b.WriteString(errorStyle.Render(m.inputError) + "\n")
		}
		b.WriteString(footerStyle.Render("enter save  esc cancel"))
		return panelStyle.Render(b.String())
	case filePickerMode:
		b.WriteString(labelStyle.Render("Choose a .torrent file") + "\n")
		b.WriteString(m.picker.View(10) + "\n")
		if m.inputError != "" {
			b.WriteString(errorStyle.Render(m.inputError) + "\n")
		}
		b.WriteString(footerStyle.Render("↑↓ navigate  enter open/select  ← parent  esc cancel"))
		return panelStyle.Render(b.String())
	}

	if len(m.messages) > 0 {
		b.WriteString(labelStyle.Render("Messages") + "\n")
		for _, msg := range m.messages {
			b.WriteString("  " + infoStyle.Render(truncate(msg, 50)) + "\n")
		}
		b.WriteString("\n")
	}

	b.WriteString(footerStyle.Render("a add  f browse  o output  ↑↓ select  p pause/resume  q quit"))

	return panelStyle.Render(b.String())
}

func (m *Model) renderDownload(d *Download, selected bool) string {
	var b strings.Builder

	cursor := "  "
	if selected {
		cursor = "▸ "
	}

	name := downloadDisplayName(d)
	header := cursor + labelStyle.Render("File: ") + name
	if selected {
		header = selectedStyle.Render(header)
	}
	b.WriteString(header + "\n")
	b.WriteString(cursor + labelStyle.Render("Status: ") + statusBadge(d.Status) + "\n")

	if d.Status == "Starting" || d.Status == "Resuming" {
		b.WriteString(fmt.Sprintf("\n%s %s Connecting to peers...\n", cursor, m.spinner.View()))
	} else {
		b.WriteString("\n" + cursor + m.progress.ViewAs(d.Percent) + "\n")
		speed := ""
		if d.SpeedBps > 0 {
			speed = fmt.Sprintf("  %s/s", formatBytes(int64(d.SpeedBps)))
		}
		b.WriteString(infoStyle.Render(fmt.Sprintf("%s%.1f%%  %s / %s%s  %d / %d pieces  peers: %d",
			cursor,
			d.Percent*100,
			formatBytes(d.Downloaded),
			formatBytes(d.Total),
			speed,
			d.CompletedPieces,
			d.TotalPieces,
			d.ActivePeers)) + "\n")
	}

	return itemStyle.Render(b.String())
}

func statusBadge(status string) string {
	switch status {
	case "Complete":
		return activeStyle.Render("Complete")
	case "Error":
		return errorStyle.Render("Error")
	case "Paused":
		return pausedStyle.Render("Paused")
	case "Resuming":
		return infoStyle.Render("Resuming")
	case "Starting":
		return infoStyle.Render("Starting")
	default:
		return infoStyle.Render(status)
	}
}

func formatBytes(n int64) string {
	if n >= 1<<30 {
		return fmt.Sprintf("%.2f GiB", float64(n)/(1<<30))
	}
	if n >= 1<<20 {
		return fmt.Sprintf("%.2f MiB", float64(n)/(1<<20))
	}
	if n >= 1<<10 {
		return fmt.Sprintf("%.2f KiB", float64(n)/(1<<10))
	}
	return fmt.Sprintf("%d B", n)
}

func truncate(s string, max int) string {
	runes := []rune(s)
	if len(runes) <= max {
		return s
	}
	if max <= 3 {
		return string(runes[:max])
	}
	return string(runes[:max-3]) + "..."
}

func downloadDisplayName(d *Download) string {
	name := d.Name
	if name == "" {
		if strings.HasPrefix(strings.ToLower(d.ID), "magnet:") {
			name = "Magnet download"
		} else {
			name = filepath.Base(d.ID)
		}
	}
	return truncate(sanitizeTerminalText(name), 58)
}

func lastN(items []string, n int) []string {
	if len(items) <= n {
		return items
	}
	return items[len(items)-n:]
}

func (m *Model) Err() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.anyError()
}

func (m *Model) Done() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.allDone()
}

func (m *Model) ProcessErr() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.processErr
}

// PausedDownloads returns a snapshot of which inputs are currently paused,
// so main.go can skip reporting them as failures on exit.
func (m *Model) PausedInputs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []string
	for _, input := range m.Inputs {
		if d, ok := m.Downloads[input]; ok && d.Paused {
			out = append(out, input)
		}
	}
	return out
}
