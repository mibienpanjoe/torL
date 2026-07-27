package main

import (
	"fmt"
	"os"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/torl/tui/torl"
)

func main() {
	torlPath := "torl"
	outputDir := "."

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
			printUsage()
			os.Exit(0)
		} else if strings.HasPrefix(arg, "-") {
			fmt.Fprintf(os.Stderr, "Error: unknown option %s\n", arg)
			printUsage()
			os.Exit(1)
		} else {
			inputs = append(inputs, arg)
		}
	}

	if len(inputs) == 0 {
		printUsage()
		os.Exit(1)
	}

	model := torl.NewModel(torlPath, inputs, outputDir)
	p := tea.NewProgram(model, tea.WithAltScreen())
	if err := p.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error running TUI: %v\n", err)
		os.Exit(1)
	}

	if err := model.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "Download failed: %v\n", err)
		os.Exit(1)
	}

	if !model.Done() {
		fmt.Fprintln(os.Stderr, "Download cancelled")
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Fprintf(os.Stderr, "Usage: torl-tui [options] <torrent-file|magnet-link>...\n\n")
	fmt.Fprintf(os.Stderr, "Options:\n")
	fmt.Fprintf(os.Stderr, "  -o, --output <dir>  Output directory (default: current directory)\n")
	fmt.Fprintf(os.Stderr, "  -torl-path <path>    Path to the torl executable (default: torl)\n")
	fmt.Fprintf(os.Stderr, "  -h, --help           Show this help message\n")
}
