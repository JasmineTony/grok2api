package cli

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	configcode "github.com/chenyme/grok2api/backend/internal/application/configcode"
	policydomain "github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"github.com/chenyme/grok2api/backend/internal/infra/config"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
)

func TestDefaultConfigPathFindsRepositoryRoot(t *testing.T) {
	root := t.TempDir()
	backendDir := filepath.Join(root, "backend")
	if err := os.Mkdir(backendDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.yaml"), []byte("server: {}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(backendDir)

	if path := defaultConfigPath(); path != filepath.Join("..", "config.yaml") {
		t.Fatalf("defaultConfigPath() = %q", path)
	}
}

func TestRunCommandVersion(t *testing.T) {
	if err := runCommand([]string{"version"}); err != nil {
		t.Fatal(err)
	}
}

func TestParseOptionsSupportsContainerListenOverride(t *testing.T) {
	options, err := parseOptions([]string{"--config", "/app/config.yaml", "--listen", "0.0.0.0:8000"})
	if err != nil {
		t.Fatal(err)
	}
	if options.configPath != "/app/config.yaml" || options.listen != "0.0.0.0:8000" {
		t.Fatalf("options = %#v", options)
	}
	if _, err := parseOptions([]string{"--listen"}); err == nil {
		t.Fatal("missing --listen value was accepted")
	}
}

func TestApplyDeclarativeConfigIsIdempotent(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{Database: config.DatabaseConfig{Driver: "sqlite", SQLite: config.SQLiteDatabaseConfig{Path: filepath.Join(t.TempDir(), "config-code.db")}}, Secrets: config.Secrets{CredentialEncryptionKey: base64.StdEncoding.EncodeToString(key)}}
	desired := configcode.File{Policies: []policydomain.Rule{{Name: "default audit", Priority: 10, Enabled: true, DryRun: true, Action: policydomain.Action{Kind: policydomain.ActionRequireAudit}}}}
	for i := 0; i < 2; i++ {
		if _, err := applyDeclarativeConfig(context.Background(), cfg, desired); err != nil {
			t.Fatal(err)
		}
	}
	db, err := relational.OpenSQLite(context.Background(), cfg.Database.SQLite.Path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := db.InitializeSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	values, err := relational.NewRequestPolicyRepository(db).ListRequestPolicies(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(values) != 1 {
		t.Fatalf("policies=%#v", values)
	}
}
