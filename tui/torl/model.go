package torl

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
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
	panelStyle   = lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).BorderForeground(lipgloss.Color("#874BFD")).Padding(1).Width(60)
	peerStyle    = lipgloss.NewStyle().Foreground(lipgloss.Color("#6B7280"))
	footerStyle  = lipgloss.NewStyle().Foreground(lipgloss.Color("#737373")).MarginTop(1)
)

type tickMsg time.Time

func NewModel(torlPath, input, output string) *Model {
	sp := spinner.New()
	sp.Spinner = spinner.Dot
	sp.Style = lipgloss.NewStyle().Foreground(lipgloss.Color("#7D56F4"))

	prog := progress.New(progress.WithDefaultGradient())
	prog.Width = 50

	return &Model{
		TorlPath: torlPath,
		Input:    input,
		Output:   output,
		Status:   "Starting",
		spinner:  sp,
		progress: prog,
		Peers:    []string{},
		messages: []string{},
	}
}

type Model struct {
	TorlPath string
	Input    string
	Output   string

	mu       sync.Mutex
	Name     string
	Total    int64
	Downloaded int64
	Percent  float64
	CompletedPieces int
	TotalPieces int
	ActivePeers int
	AvailablePeers int
	Peers    []string
	Err      error
	Done     bool
	Started  bool
	Status   string
	messages []string

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
		cmd := exec.Command(m.TorlPath, m.Input, "--json", "-o", m.Output)
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

func (m *Model) handleEvent(event Event) {
	m.mu.Lock()
	defer m.mu.Unlock()

	switch event.Type {
	case "start":
		m.Started = true
		m.Name = event.Name
		m.Total = event.Total
		m.TotalPieces = event.TotalPieces
		m.Status = "Downloading"
	case "progress":
		m.Downloaded = event.Downloaded
		m.Total = event.Total
		m.Percent = event.Percent
		m.CompletedPieces = event.CompletedPieces
		m.TotalPieces = event.TotalPieces
		m.ActivePeers = event.ActivePeers
		m.AvailablePeers = event.AvailablePeers
		m.Status = "Downloading"
	case "peer":
		peer := fmt.Sprintf("%s %s", peerActionIcon(event.Action), event.Peer)
		m.Peers = append(m.Peers, peer)
		if len(m.Peers) > 20 {
			m.Peers = m.Peers[1:]
		}
	case "complete":
		m.Done = true
		m.Status = "Complete"
		m.Percent = 1.0
	case "error":
		m.Err = fmt.Errorf(event.Message)
		m.Status = "Error"
	}
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
		m.Err = msg.err
		m.Status = "Error"
		return m, tea.Quit
	case doneMsg:
		m.Done = true
		m.Status = "Complete"
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

	if m.Name != "" {
		b.WriteString(labelStyle.Render("File: ") + m.Name + "\n")
	}
	b.WriteString(labelStyle.Render("Status: ") + statusBadge(m.Status) + "\n")

	if m.Status == "Starting" {
		b.WriteString(fmt.Sprintf("\n%s Connecting to peers...\n", m.spinner.View()))
	} else {
		b.WriteString("\n" + m.progress.ViewAs(m.Percent) + "\n")
		b.WriteString(infoStyle.Render(fmt.Sprintf("%.1f%%  %s / %s  %d / %d pieces",
			m.Percent*100,
			formatBytes(m.Downloaded),
			formatBytes(m.Total),
			m.CompletedPieces,
			m.TotalPieces)) + "\n")
	}

	b.WriteString("\n" + labelStyle.Render("Peers") + "\n")
	b.WriteString(fmt.Sprintf("  Active: %s  Available: %s\n",
		activeStyle.Render(fmt.Sprintf("%d", m.ActivePeers)),
		infoStyle.Render(fmt.Sprintf("%d", m.AvailablePeers))))

	if len(m.Peers) > 0 {
		b.WriteString("\n")
		for _, peer := range lastN(m.Peers, 5) {
			b.WriteString("  " + peerStyle.Render(peer) + "\n")
		}
	}

	if len(m.messages) > 0 {
		b.WriteString("\n" + labelStyle.Render("Messages") + "\n")
		for _, msg := range m.messages {
			b.WriteString("  " + infoStyle.Render(truncate(msg, 50)) + "\n")
		}
	}

	if m.Err != nil {
		b.WriteString("\n" + errorStyle.Render("Error: "+m.Err.Error()) + "\n")
	}

	b.WriteString("\n" + footerStyle.Render("Press 'q' or Ctrl+C to quit"))

	return panelStyle.Render(b.String())
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
