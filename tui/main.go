package main

import (
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/torl/tui/torl"
)

func defaultOutputDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	return filepath.Join(home, "Downloads")
}

func main() {
	programName := filepath.Base(os.Args[0])
	torlPath := "torl-cli"
	outputDir := defaultOutputDir()

	args := os.Args[1:]
	var inputs []string

	for i := 0; i < len(args); i++ {
		arg := args[i]
		if arg == "-torl-path" {
			if i+1 >= len(args) {
				fmt.Fprintln(os.Stderr, "Error: -torl-path requires a value")
				os.Exit(1)
			}
			torlPath = args[i+1]
			i++
		} else if arg == "-o" || arg == "--output" {
			if i+1 >= len(args) {
				fmt.Fprintln(os.Stderr, "Error: -o requires a value")
				os.Exit(1)
			}
			outputDir = args[i+1]
			i++
		} else if arg == "-h" || arg == "--help" {
			printUsage(programName)
			os.Exit(0)
		} else if strings.HasPrefix(arg, "-") {
			fmt.Fprintf(os.Stderr, "Error: unknown option %s\n", arg)
			printUsage(programName)
			os.Exit(1)
		} else {
			inputs = append(inputs, arg)
		}
	}

	if len(inputs) == 0 {
		printUsage(programName)
		os.Exit(1)
	}

	model := torl.NewModel(torlPath, inputs, outputDir)

	// Forward OS signals to the model so paused processes save state.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		// Let the TUI program handle quit via tea.Quit.
		model.Update(tea.KeyMsg{Type: tea.KeyCtrlC})
	}()

	p := tea.NewProgram(model, tea.WithAltScreen())
	if err := p.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running TUI: %v\n", err)
		os.Exit(1)
	}

	if err := model.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "Download failed: %v\n", err)
		os.Exit(1)
	}

	if err := model.ProcessErr(); err != nil {
		fmt.Fprintf(os.Stderr, "Download failed: %v\n", err)
		os.Exit(1)
	}

	if !model.Done() {
		// Downloads that were deliberately paused are fine.
		paused := model.PausedInputs()
		if len(paused) > 0 {
			fmt.Fprintf(os.Stderr, "Paused: %s\n", strings.Join(paused, ", "))
		} else {
			fmt.Fprintln(os.Stderr, "Download cancelled")
		}
		os.Exit(1)
	}
}

func printUsage(name string) {
	fmt.Fprintf(os.Stderr, "Usage: %s [options] <torrent-file|magnet-link>...\n\n", name)
	fmt.Fprintf(os.Stderr, "Options:\n")
	fmt.Fprintf(os.Stderr, "  -o, --output <dir>  Output directory (default: Downloads)\n")
	fmt.Fprintf(os.Stderr, "  -torl-path <path>    Path to the torl-cli executable (default: torl-cli)\n")
	fmt.Fprintf(os.Stderr, "  -h, --help           Show this help message\n")
}
