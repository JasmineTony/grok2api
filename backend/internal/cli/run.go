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
	"strings"
	"syscall"
	"time"

	"github.com/chenyme/grok2api/backend/internal/app"
	backupapp "github.com/chenyme/grok2api/backend/internal/application/backup"
	configcode "github.com/chenyme/grok2api/backend/internal/application/configcode"
	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	"github.com/chenyme/grok2api/backend/internal/buildinfo"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
	"github.com/chenyme/grok2api/backend/internal/infra/observability"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"github.com/chenyme/grok2api/backend/internal/mcp"
	"github.com/chenyme/grok2api/backend/internal/repository"
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
		return runMCPCommand(args[1:])
	default:
		return fmt.Errorf("unsupported command: %s", args[0])
	}
}
func runMCPCommand(args []string) error {
	if len(args) < 1 || args[0] != "serve" {
		return errors.New("mcp serve is the only supported MCP command")
	}
	options, err := parseOptions(args[1:])
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
	modelRepo := relational.NewModelRepository(db)
	accountRepo := relational.NewAccountRepository(db)
	auditRepo := relational.NewAuditRepository(db)
	egressRepo := relational.NewEgressRepository(db)
	server := &mcp.Server{Tools: mcp.ReadOnlyTools()}
	server.Call = func(name string, _ map[string]any) (any, error) {
		switch name {
		case "models.list":
			values, total, callErr := modelRepo.List(ctx, repository.ModelListQuery{Page: repository.PageQuery{Limit: 200}})
			if callErr != nil {
				return nil, callErr
			}
			result := make([]map[string]any, 0, len(values))
			for _, value := range values {
				result = append(result, map[string]any{"id": value.ID, "publicId": value.PublicID, "provider": string(value.Provider), "enabled": value.Enabled, "capability": string(value.Capability)})
			}
			return map[string]any{"total": total, "items": result}, nil
		case "accounts.health":
			states, callErr := accountRepo.CountStates(ctx)
			if callErr != nil {
				return nil, callErr
			}
			result := map[string]uint64{}
			for state, count := range states {
				result[string(state)] = count
			}
			return map[string]any{"states": result}, nil
		case "usage.summary":
			summary, callErr := auditRepo.Summarize(ctx, repository.AuditSummaryQuery{Start: time.Now().UTC().Add(-24 * time.Hour), End: time.Now().UTC()})
			if callErr != nil {
				return nil, callErr
			}
			return summary, nil
		case "errors.recent":
			values, _, callErr := auditRepo.List(ctx, 0, 50)
			if callErr != nil {
				return nil, callErr
			}
			result := make([]map[string]any, 0)
			for _, value := range values {
				if value.StatusCode >= 400 || value.ErrorCode != "" {
					result = append(result, map[string]any{"statusCode": value.StatusCode, "errorCode": value.ErrorCode, "provider": value.Provider, "operation": string(value.Operation), "createdAt": value.CreatedAt})
				}
			}
			return map[string]any{"items": result}, nil
		case "egress.health":
			values, callErr := egressRepo.ListEgressNodes(ctx, "", repository.SortQuery{})
			if callErr != nil {
				return nil, callErr
			}
			result := make([]map[string]any, 0, len(values))
			for _, value := range values {
				result = append(result, map[string]any{"id": value.ID, "enabled": value.Enabled, "health": value.Health, "failureCount": value.FailureCount, "cooldownUntil": value.CooldownUntil, "lastError": value.LastError})
			}
			return map[string]any{"items": result}, nil
		case "version.status":
			return map[string]any{"version": buildinfo.CurrentVersion(), "repository": "JasmineTony/grok2api", "upstreamRepository": "chenyme/grok2api"}, nil
		case "config.validate":
			return map[string]any{"valid": true, "databaseDriver": cfg.Database.Driver, "runtimeStore": cfg.RuntimeStore.Driver}, nil
		default:
			return nil, fmt.Errorf("unknown read-only tool: %s", name)
		}
	}
	return server.Serve(os.Stdin, os.Stdout)
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
		if args[0] == "plan" {
			return printJSON(map[string]any{"changes": changes, "destructive": false})
		}
		options, err := parseOptions(args[2:])
		if err != nil {
			return err
		}
		cfg, err := config.Load(options.configPath)
		if err != nil {
			return err
		}
		result, err := applyDeclarativeConfig(context.Background(), cfg, desired)
		if err != nil {
			return err
		}
		result["changes"] = changes
		result["destructive"] = false
		return printJSON(result)
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

func applyDeclarativeConfig(ctx context.Context, cfg config.Config, desired configcode.File) (map[string]any, error) {
	db, err := openDatabase(ctx, cfg)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	if err := db.InitializeSchema(ctx); err != nil {
		return nil, err
	}
	policyRepo := relational.NewRequestPolicyRepository(db)
	modelRepo := relational.NewModelRepository(db)
	egressRepo := relational.NewEgressRepository(db)
	cipher, err := security.NewCipher(cfg.Secrets.CredentialEncryptionKey)
	if err != nil {
		return nil, err
	}
	egressService := egressapp.NewService(egressRepo, cipher, "")
	counts := map[string]int{"models": 0, "egress": 0, "policies": 0, "notifications": 0}
	for _, spec := range desired.Models {
		route, err := modelRepo.GetByPublicID(ctx, spec.Name)
		if err != nil {
			return nil, fmt.Errorf("model %s: %w", spec.Name, err)
		}
		if spec.Provider != "" && string(route.Provider) != spec.Provider {
			return nil, fmt.Errorf("model %s provider mismatch", spec.Name)
		}
		if spec.Enabled != nil && route.Enabled != *spec.Enabled {
			route.Enabled = *spec.Enabled
			if _, err := modelRepo.Update(ctx, route, nil); err != nil {
				return nil, err
			}
			counts["models"]++
		}
	}
	currentNodes, err := egressRepo.ListEgressNodes(ctx, "", repository.SortQuery{})
	if err != nil {
		return nil, err
	}
	nodesByName := map[string]uint64{}
	for _, node := range currentNodes {
		nodesByName[node.Name] = node.ID
	}
	for _, spec := range desired.Egress {
		enabled := true
		if spec.Enabled != nil {
			enabled = *spec.Enabled
		}
		var proxy *string
		if spec.ProxyURL != "" {
			value, resolveErr := resolveEnvReference(spec.ProxyURL)
			if resolveErr != nil {
				return nil, resolveErr
			}
			proxy = &value
		}
		input := egressapp.Input{Name: spec.Name, Scope: egressdomain.Scope(spec.Scope), Enabled: enabled, ProxyURL: proxy}
		if id := nodesByName[spec.Name]; id != 0 {
			if _, err := egressService.Update(ctx, id, input); err != nil {
				return nil, err
			}
		} else {
			if _, err := egressService.Create(ctx, input); err != nil {
				return nil, err
			}
		}
		counts["egress"]++
	}
	currentPolicies, err := policyRepo.ListRequestPolicies(ctx)
	if err != nil {
		return nil, err
	}
	policiesByName := map[string]uint64{}
	for _, current := range currentPolicies {
		policiesByName[current.Name] = current.ID
	}
	for _, rule := range desired.Policies {
		if rule.ID == 0 {
			rule.ID = policiesByName[rule.Name]
		}
		if rule.ID == 0 {
			if _, err := policyRepo.CreateRequestPolicy(ctx, rule); err != nil {
				return nil, err
			}
		} else {
			if _, err := policyRepo.UpdateRequestPolicy(ctx, rule); err != nil {
				return nil, err
			}
		}
		counts["policies"]++
	}
	counts["notifications"] = len(desired.Notifications)
	return map[string]any{"applied": true, "idempotent": true, "deleted": 0, "counts": counts}, nil
}

func resolveEnvReference(value string) (string, error) {
	value = strings.TrimSpace(value)
	if !strings.HasPrefix(value, "env:") {
		return "", errors.New("secret values must use env:VAR")
	}
	name := strings.TrimSpace(strings.TrimPrefix(value, "env:"))
	if name == "" {
		return "", errors.New("empty environment reference")
	}
	resolved, ok := os.LookupEnv(name)
	if !ok {
		return "", fmt.Errorf("environment variable %s is not set", name)
	}
	return resolved, nil
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
	service.SetManagedRoot(cfg.Backup.Root)
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
