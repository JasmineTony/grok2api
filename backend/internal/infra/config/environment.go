package config

import (
	"fmt"
	"net/url"
	"os"
	"strings"
)

// applyEnvironmentOverrides applies application-owned environment overrides.
// It intentionally remains separate from YAML decoding so deployment adapters
// can test environment semantics without filesystem fixtures.
func applyEnvironmentOverrides(cfg *Config) error {
	value := strings.TrimSpace(os.Getenv(DatabaseURLEnv))
	if value == "" {
		return nil
	}
	dsn, err := validatePostgresEnvironmentURL(value)
	if err != nil {
		return err
	}
	cfg.Database.Driver = "postgres"
	cfg.Database.Postgres.DSN = dsn
	return nil
}

func validatePostgresEnvironmentURL(value string) (string, error) {
	lower := strings.ToLower(value)
	if strings.HasPrefix(lower, "postgresql+asyncpg://") {
		return "", fmt.Errorf("%s does not support SQLAlchemy asyncpg URLs; use postgresql://", DatabaseURLEnv)
	}
	if !strings.HasPrefix(lower, "postgres://") && !strings.HasPrefix(lower, "postgresql://") {
		return "", fmt.Errorf("%s must use a postgres:// or postgresql:// URL", DatabaseURLEnv)
	}
	parsed, err := url.ParseRequestURI(value)
	if err != nil || parsed.Scheme == "" || parsed.Fragment != "" {
		return "", fmt.Errorf("%s is not a valid PostgreSQL URL", DatabaseURLEnv)
	}
	return value, nil
}
