package engine

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
)

type runFunc func(context.Context, Config, func(Event) error) error

func ParseCommandArgs(args []string) (Config, error) {
	var cfg Config
	for i := 0; i < len(args); i++ {
		switch arg := args[i]; arg {
		case "--id":
			if i+1 >= len(args) {
				return cfg, errors.New("--id requires a value")
			}
			cfg.ID = args[i+1]
			i++
		case "-o", "--output":
			if i+1 >= len(args) {
				return cfg, fmt.Errorf("%s requires a value", arg)
			}
			cfg.Output = args[i+1]
			i++
		default:
			if strings.HasPrefix(arg, "-") {
				return cfg, fmt.Errorf("unknown engine option: %s", arg)
			}
			if cfg.Source != "" {
				return cfg, errors.New("engine accepts exactly one torrent source")
			}
			cfg.Source = arg
		}
	}
	if err := cfg.Validate(); err != nil {
		return cfg, err
	}
	return cfg, nil
}

func RunCommand(ctx context.Context, args []string, output io.Writer, run runFunc) error {
	cfg, err := ParseCommandArgs(args)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(output)
	emit := func(event Event) error { return encoder.Encode(event) }
	if err := run(ctx, cfg, emit); err != nil {
		if errors.Is(err, context.Canceled) {
			return nil
		}
		_ = emit(Event{Type: "error", ID: cfg.ID, Message: SanitizeError(err.Error())})
		return err
	}
	return nil
}
