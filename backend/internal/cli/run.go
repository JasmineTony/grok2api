package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"syscall"

	"github.com/chenyme/grok2api/backend/internal/app"
	backupapp "github.com/chenyme/grok2api/backend/internal/application/backup"
	configcode "github.com/chenyme/grok2api/backend/internal/application/configcode"
	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	"github.com/chenyme/grok2api/backend/internal/buildinfo"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
	"github.com/chenyme/grok2api/backend/internal/infra/observability"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/mcp"
	"gopkg.in/yaml.v3"
)

func Run(args []string) error {
	if len(args) > 0 && args[0] != "serve" && args[0] != "--config" && args[0] != "--listen" {
		return runCommand(args)
	}
	options, err := parseOptions(args)
	if err != nil {
		return err
	}
	return runServer(options)
}

type runOptions struct {
	configPath string
	listen     string
}

func runServer(options runOptions) error {
	cfg, err := config.Load(options.configPath)
	if err != nil {
		return err
	}
	if options.listen != "" {
		cfg.Server.Listen = options.listen
		if err := cfg.Validate(); err != nil {
			return err
		}
	}
	logger := observability.NewLogger()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	application, err := app.New(ctx, cfg, logger)
	if err != nil {
		return err
	}
	defer application.Close()
	return application.Run(ctx)
}

func runCommand(args []string) error {
	switch args[0] {
	case "serve":
		options, err := parseOptions(args[1:])
		if err != nil {
			return err
		}
		return runServer(options)
	case "version":
		return printJSON(map[string]any{"version": buildinfo.CurrentVersion(), "repository": "JasmineTony/grok2api"})
	case "doctor":
		options, err := parseOptions(args[1:])
		if err != nil {
			return err
		}
		cfg, err := config.Load(options.configPath)
		if err != nil {
			return err
		}
		return printJSON(map[string]any{"ok": true, "databaseDriver": cfg.Database.Driver, "runtimeStore": cfg.RuntimeStore.Driver})
	case "config":
		return runConfigCommand(args[1:])
	case "backup":
		return runBackupCommand(args[1:])
	case "egress":
		return runEgressCommand(args[1:])
	case "mcp":
		if len(args) < 2 || args[1] != "serve" {
			return errors.New("mcp serve is the only supported MCP command")
		}
		return (&mcp.Server{Tools: mcp.ReadOnlyTools()}).Serve(os.Stdin, os.Stdout)
	default:
		return fmt.Errorf("unsupported command: %s", args[0])
	}
}
func runConfigCommand(args []string) error {
	if len(args) < 1 {
		return errors.New("config requires validate, export, plan, or apply")
	}
	if args[0] == "plan" || args[0] == "apply" {
		if len(args) < 2 {
			return errors.New("config plan/apply requires a YAML file")
		}
		desired, err := configcode.Load(args[1])
		if err != nil {
			return err
		}
		changes := configcode.Plan(desired)
		if args[0] == "apply" {
			return printJSON(map[string]any{"applied": false, "dryRun": true, "changes": changes, "reason": "resource application requires an explicit repository binding; no undeclared objects are deleted"})
		}
		return printJSON(map[string]any{"changes": changes, "destructive": false})
	}
	options, err := parseOptions(args[1:])
	if err != nil {
		return err
	}
	cfg, err := config.Load(options.configPath)
	if err != nil {
		return err
	}
	switch args[0] {
	case "validate":
		return printJSON(map[string]any{"valid": true})
	case "export":
		cfg.Secrets.JWTSecret = ""
		cfg.Secrets.CredentialEncryptionKey = ""
		cfg.BootstrapAdmin.Password = ""
		data, err := yaml.Marshal(cfg)
		if err != nil {
			return err
		}
		_, err = os.Stdout.Write(data)
		return err
	default:
		return fmt.Errorf("unsupported config command: %s", args[0])
	}
}

func openDatabase(ctx context.Context, cfg config.Config) (*relational.Database, error) {
	switch cfg.Database.Driver {
	case "sqlite":
		return relational.OpenSQLite(ctx, cfg.Database.SQLite.Path)
	case "postgres":
		return relational.OpenPostgres(ctx, cfg.Database.Postgres.DSN, cfg.Database.Postgres.MaxOpenConns, cfg.Database.Postgres.MaxIdleConns)
	default:
		return nil, fmt.Errorf("unsupported database driver: %s", cfg.Database.Driver)
	}
}
func runBackupCommand(args []string) error {
	if len(args) < 2 {
		return errors.New("backup requires create, verify, or restore and a path")
	}
	options, err := parseOptions(args[2:])
	if err != nil {
		return err
	}
	cfg, err := config.Load(options.configPath)
	if err != nil {
		return err
	}
	ctx := context.Background()
	db, err := openDatabase(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.InitializeSchema(ctx); err != nil {
		return err
	}
	service := backupapp.NewService(db, cfg.Media.Local.Path, buildinfo.CurrentVersion())
	switch args[0] {
	case "create":
		result, err := service.Create(ctx, args[1])
		if err != nil {
			return err
		}
		return printJSON(result.Manifest)
	case "verify":
		manifest, err := service.Verify(ctx, args[1])
		if err != nil {
			return err
		}
		return printJSON(manifest)
	case "restore":
		if len(args) < 3 {
			return errors.New("backup restore requires a backup path and target database")
		}
		return service.Restore(ctx, args[1], args[2], cfg.Media.Local.Path)
	default:
		return fmt.Errorf("unsupported backup command: %s", args[0])
	}
}
func runEgressCommand(args []string) error {
	if len(args) < 2 || args[0] != "check" {
		return errors.New("egress check requires a node id")
	}
	options, err := parseOptions(args[2:])
	if err != nil {
		return err
	}
	cfg, err := config.Load(options.configPath)
	if err != nil {
		return err
	}
	ctx := context.Background()
	db, err := openDatabase(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()
	if err := db.InitializeSchema(ctx); err != nil {
		return err
	}
	cipher, err := security.NewCipher(cfg.Secrets.CredentialEncryptionKey)
	if err != nil {
		return err
	}
	id, err := strconv.ParseUint(args[1], 10, 64)
	if err != nil || id == 0 {
		return errors.New("invalid egress node id")
	}
	service := egressapp.NewService(relational.NewEgressRepository(db), cipher, "")
	result, err := service.Check(ctx, id)
	if err != nil {
		return err
	}
	return printJSON(result)
}
func printJSON(value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	_, err = fmt.Println(string(data))
	return err
}

func parseOptions(args []string) (runOptions, error) {
	options := runOptions{configPath: defaultConfigPath()}
	for index := 0; index < len(args); index++ {
		switch args[index] {
		case "--config":
			if index+1 >= len(args) {
				return runOptions{}, errors.New("--config requires a path")
			}
			options.configPath = args[index+1]
			index++
		case "--listen":
			if index+1 >= len(args) {
				return runOptions{}, errors.New("--listen requires an address")
			}
			options.listen = args[index+1]
			index++
		default:
			return runOptions{}, fmt.Errorf("unsupported option: %s", args[index])
		}
	}
	return options, nil
}
func defaultConfigPath() string {
	for _, candidate := range []string{"config.yaml", filepath.Join("..", "config.yaml")} {
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return "config.yaml"
}
