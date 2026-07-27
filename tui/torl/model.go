package torl

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/charmbracelet/bubbles/progress"
	"github.com/charmbracelet/bubbles/spinner"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

var (
	titleStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#7D56F4")).MarginBottom(1)
	errorStyle   = lipgloss.NewStyle().Foreground(lipgloss.Color("#FF5F87")).Bold(true)
	infoStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#A3A3A3"))
	activeStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#04B575"))
	labelStyle   = lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#FAFAFA"))
	panelStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("#874BFD")).Padding(1).Width(70)
	itemStyle    = lipgloss.NewStyle().Border(lipgloss.HiddenBorder()).Padding(0, 1).Width(66)
	peerStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
	footerStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#737373")).MarginTop(1)
)

type tickMsg time.Time

func NewModel(torlPath string, inputs []string, output string) *Model {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#7D56F4"))

	prog := progress.New(progress.WithDefaultGradient())
	prog.Width = 50

	downloads := make(map[string]*Download)
	for _, input := range inputs {
		downloads[input] = &Download{
			ID:     input,
			Status: "Starting",
			Peers:  []string{},
		}
	}

	return &Model{
		TorlPath:  torlPath,
		Inputs:    inputs,
		Output:    output,
		Downloads: downloads,
		spinner:   sp,
		progress:  prog,
		messages:  []string{},
	}
}

// Download holds state for a single torrent download.
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
}

// Model manages the whole TUI and multiple downloads.
type Model struct {
	TorlPath  string
	Inputs    []string
	Output    string

	mu         sync.Mutex
	Downloads  map[string]*Download
	messages   []string
	processErr error

	spinner  spinner.Model
	progress progress.Model
}

func (m *Model) Init() tea.Cmd {
	return tea.Batch(
		m.spinner.Tick,
		m.spawnTorl(),
		m.tick(),
	)
}

func (m *Model) tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m *Model) spawnTorl() tea.Cmd {
	return func() tea.Msg {
		args := append([]string{}, m.Inputs...)
		args = append(args, "--json", "-o", m.Output)
		cmd := exec.Command(m.TorlPath, args...)
		cmd.Env = os.Environ()
		stdout, err := cmd.StdoutPipe()
		if err != nil {
			return errMsg{err}
		}
		stderr, err := cmd.StderrPipe()
		if err != nil {
			return errMsg{err}
		}

		if err := cmd.Start(); err != nil {
			return errMsg{err}
		}

		go m.readStderr(stderr)

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
			return errMsg{err}
		}

		if err := cmd.Wait(); err != nil {
			return errMsg{err}
		}

		return doneMsg{}
	}
}

func (m *Model) readStderr(stderr io.ReadCloser) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		m.appendMessage(scanner.Text())
	}
}

func (m *Model) appendMessage(msg string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.messages = append(m.messages, msg)
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
		d.Status = "Downloading"
	case "progress":
		now := time.Now()
		if !d.LastUpdate.IsZero() {
			elapsed := now.Sub(d.LastUpdate).Seconds()
			if elapsed > 0 {
				delta := event.Downloaded - d.LastDownloaded
				instant := float64(delta) / elapsed
				// Simple exponential smoothing to avoid jitter.
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
	case "error":
		d.Err = fmt.Errorf(event.Message)
		d.Status = "Error"
	}
}

func (m *Model) allDone() bool {
	for _, d := range m.Downloads {
		if !d.Done && d.Err == nil {
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

type errMsg struct{ err error }
type doneMsg struct{}

func (m *Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		if msg.String() == "q" || msg.String() == "ctrl+c" {
			return m, tea.Quit
		}
	case tickMsg:
		return m, m.tick()
	case errMsg:
		m.mu.Lock()
		m.processErr = msg.err
		m.mu.Unlock()
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

func (m *Model) View() string {
	m.mu.Lock()
	defer m.mu.Unlock()

	var b strings.Builder
	b.WriteString(titleStyle.Render("torl"))
	b.WriteString("\n\n")

	for _, input := range m.Inputs {
		d := m.Downloads[input]
		b.WriteString(m.renderDownload(d))
		b.WriteString("\n")
	}

	if len(m.messages) > 0 {
		b.WriteString(labelStyle.Render("Messages") + "\n")
		for _, msg := range m.messages {
			b.WriteString("  " + infoStyle.Render(truncate(msg, 50)) + "\n")
		}
		b.WriteString("\n")
	}

	b.WriteString(footerStyle.Render("Press 'q' or Ctrl+C to quit"))

	return panelStyle.Render(b.String())
}

func (m *Model) renderDownload(d *Download) string {
	var b strings.Builder

	name := d.Name
	if name == "" {
		name = path.Base(d.ID)
	}
	b.WriteString(labelStyle.Render("File: ") + name + "\n")
	b.WriteString(labelStyle.Render("Status: ") + statusBadge(d.Status) + "\n")

	if d.Status == "Starting" {
		b.WriteString(fmt.Sprintf("\n%s Connecting to peers...\n", m.spinner.View()))
	} else {
		b.WriteString("\n" + m.progress.ViewAs(d.Percent) + "\n")
		speed := ""
		if d.SpeedBps > 0 {
			speed = fmt.Sprintf("  %s/s", formatBytes(int64(d.SpeedBps)))
		}
		b.WriteString(infoStyle.Render(fmt.Sprintf("%.1f%%  %s / %s%s  %d / %d pieces  peers: %d",
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
	if len(s) <= max {
		return s
	}
	return s[:max-3] + "..."
}

func lastN(items []string, n int) []string {
	if len(items) <= n {
		return items
	}
	return items[len(items)-n:]
}

// Err returns any download error.
func (m *Model) Err() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.anyError()
}

// Done returns true if all downloads are finished or errored.
func (m *Model) Done() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.allDone()
}

// ProcessErr returns any error from the downloader process itself.
func (m *Model) ProcessErr() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.processErr
}
