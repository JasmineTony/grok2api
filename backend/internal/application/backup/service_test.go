package backup

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
)

func TestSQLiteBackupManifestRoundTripAndTamperDetection(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := relational.OpenSQLite(ctx, filepath.Join(root, "source.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	mediaRoot := filepath.Join(root, "media")
	if err := os.MkdirAll(filepath.Join(mediaRoot, "images", "aa"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mediaRoot, "images", "aa", "asset.bin"), []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(database, mediaRoot, "v3.0.5")
	service.now = func() time.Time { return time.Date(2026, 7, 20, 12, 0, 0, 0, time.UTC) }
	backupRoot := filepath.Join(root, "backup")
	result, err := service.Create(ctx, backupRoot)
	if err != nil {
		t.Fatal(err)
	}
	if result.Manifest.DatabaseDriver != "sqlite" || result.Manifest.DatabaseSnapshot != "database.sqlite" || result.Manifest.DatabaseSHA256 == "" || len(result.Manifest.MediaFiles) != 1 || result.Manifest.ExternalBackupRequired {
		t.Fatalf("manifest = %#v", result.Manifest)
	}
	verified, err := service.Verify(ctx, backupRoot)
	if err != nil || verified.DatabaseSHA256 != result.Manifest.DatabaseSHA256 {
		t.Fatalf("verify = %#v, err = %v", verified, err)
	}
	if err := os.WriteFile(filepath.Join(backupRoot, "media", "images", "aa", "asset.bin"), []byte("tampered"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Verify(ctx, backupRoot); err == nil {
		t.Fatal("tampered backup was accepted")
	}

	// Recreate a clean backup and verify restore into stopped, separate paths.
	if err := os.WriteFile(filepath.Join(backupRoot, "media", "images", "aa", "asset.bin"), []byte("media"), 0o600); err != nil { t.Fatal(err) }
	targetDB := filepath.Join(root, "restored", "backend.db")
	targetMedia := filepath.Join(root, "restored", "media")
	if err := os.MkdirAll(targetMedia, 0o700); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(targetMedia, "old.txt"), []byte("old"), 0o600); err != nil { t.Fatal(err) }
	if err := service.Restore(ctx, backupRoot, targetDB, targetMedia); err != nil { t.Fatal(err) }
	if _, err := os.Stat(targetDB); err != nil { t.Fatal(err) }
	if _, err := os.Stat(filepath.Join(targetMedia, "images", "aa", "asset.bin")); err != nil { t.Fatal(err) }
	if _, err := os.Stat(targetDB + ".pre-restore-20260720T120000Z"); err == nil { t.Fatal("unexpected database backup was created for a new target") }
}
