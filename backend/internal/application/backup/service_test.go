package backup

import (
	"context"
	"encoding/json"
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
	if err := os.WriteFile(filepath.Join(backupRoot, "media", "images", "aa", "asset.bin"), []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	targetDB := filepath.Join(root, "restored", "backend.db")
	targetMedia := filepath.Join(root, "restored", "media")
	if err := os.MkdirAll(targetMedia, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(targetMedia, "old.txt"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := service.Restore(ctx, backupRoot, targetDB, targetMedia); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(targetDB); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(targetMedia, "images", "aa", "asset.bin")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(targetDB + ".pre-restore-20260720T120000Z"); err == nil {
		t.Fatal("unexpected database backup was created for a new target")
	}
}

func TestPreflightRequiresVerifiedBackup(t *testing.T) {
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "preflight.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	service := NewService(database, filepath.Join(t.TempDir(), "media"), "v3.1.0")
	without := service.Preflight(ctx, "")
	if without.Ready {
		t.Fatalf("preflight without backup = %#v", without)
	}
	root := filepath.Join(t.TempDir(), "backup")
	if _, err := service.Create(ctx, root); err != nil {
		t.Fatal(err)
	}
	with := service.Preflight(ctx, root)
	if !with.Ready {
		t.Fatalf("preflight with backup = %#v", with)
	}
}

func TestVerifyRejectsUnsafeManifestPaths(t *testing.T) {
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
	if err := os.MkdirAll(mediaRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mediaRoot, "asset.bin"), []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(database, mediaRoot, "v3.0.5")

	for _, test := range []struct {
		name   string
		mutate func(*Manifest)
	}{
		{name: "database parent traversal", mutate: func(manifest *Manifest) { manifest.DatabaseSnapshot = "../outside.db" }},
		{name: "database absolute path", mutate: func(manifest *Manifest) { manifest.DatabaseSnapshot = filepath.Join(root, "outside.db") }},
		{name: "media parent traversal", mutate: func(manifest *Manifest) { manifest.MediaFiles[0].Path = "media/../../outside.bin" }},
		{name: "media backslash traversal", mutate: func(manifest *Manifest) { manifest.MediaFiles[0].Path = `media\..\outside.bin` }},
		{name: "media absolute path", mutate: func(manifest *Manifest) {
			manifest.MediaFiles[0].Path = filepath.ToSlash(filepath.Join(root, "outside.bin"))
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			backupRoot := filepath.Join(t.TempDir(), "backup")
			result, err := service.Create(ctx, backupRoot)
			if err != nil {
				t.Fatal(err)
			}
			manifest := result.Manifest
			test.mutate(&manifest)
			data, err := json.MarshalIndent(manifest, "", "  ")
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(backupRoot, "manifest.json"), append(data, '\n'), 0o600); err != nil {
				t.Fatal(err)
			}
			if _, err := service.Verify(ctx, backupRoot); err == nil {
				t.Fatal("unsafe manifest path was accepted")
			}
		})
	}
}

func TestVerifyRejectsBackupSymlinkEscape(t *testing.T) {
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
	if err := os.MkdirAll(mediaRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(mediaRoot, "asset.bin"), []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	service := NewService(database, mediaRoot, "v3.0.5")
	backupRoot := filepath.Join(root, "backup")
	if _, err := service.Create(ctx, backupRoot); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "outside.bin")
	if err := os.WriteFile(outside, []byte("media"), 0o600); err != nil {
		t.Fatal(err)
	}
	backupAsset := filepath.Join(backupRoot, "media", "asset.bin")
	if err := os.Remove(backupAsset); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, backupAsset); err != nil {
		t.Skipf("symlink creation is unavailable: %v", err)
	}
	if _, err := service.Verify(ctx, backupRoot); err == nil {
		t.Fatal("symlink escaping the backup root was accepted")
	}
}

func TestManagedPreflightConfinesBackupNames(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	database, err := relational.OpenSQLite(ctx, filepath.Join(root, "preflight.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	mediaRoot := filepath.Join(root, "media")
	if err := os.MkdirAll(mediaRoot, 0o700); err != nil {
		t.Fatal(err)
	}
	managedRoot := filepath.Join(root, "backups")
	service := NewService(database, mediaRoot, "v3.1.0")
	service.SetManagedRoot(managedRoot)
	if _, err := service.Create(ctx, filepath.Join(managedRoot, "release-20260721")); err != nil {
		t.Fatal(err)
	}
	if report := service.PreflightManaged(ctx, "release-20260721"); !report.Ready {
		t.Fatalf("managed preflight = %#v", report)
	}
	for _, name := range []string{"../outside", `..\\outside`, "nested/backup", "nested\\backup", filepath.Join(root, "outside")} {
		if report := service.PreflightManaged(ctx, name); report.Ready {
			t.Fatalf("unsafe managed backup name %q was accepted: %#v", name, report)
		}
	}
}
