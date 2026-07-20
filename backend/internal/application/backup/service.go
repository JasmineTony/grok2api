package backup

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
)

const manifestVersion = 1

type FileEntry struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type Manifest struct {
	FormatVersion          int         `json:"formatVersion"`
	CreatedAt              time.Time   `json:"createdAt"`
	ApplicationVersion     string      `json:"applicationVersion"`
	DatabaseDriver         string      `json:"databaseDriver"`
	DatabaseSnapshot       string      `json:"databaseSnapshot,omitempty"`
	DatabaseSHA256         string      `json:"databaseSha256,omitempty"`
	MediaRoot              string      `json:"mediaRoot"`
	MediaFiles             []FileEntry `json:"mediaFiles"`
	Encrypted              bool        `json:"encrypted"`
	ExternalBackupRequired bool        `json:"externalBackupRequired"`
	RestoreRequiresStop    bool        `json:"restoreRequiresStop"`
}

type Result struct {
	ManifestPath string
	Manifest     Manifest
}

type PreflightCheck struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail,omitempty"`
}

type PreflightReport struct {
	ApplicationVersion     string           `json:"applicationVersion"`
	DatabaseDriver         string           `json:"databaseDriver"`
	RestoreRequiresStop    bool             `json:"restoreRequiresStop"`
	ExternalBackupRequired bool             `json:"externalBackupRequired"`
	Checks                 []PreflightCheck `json:"checks"`
	Ready                  bool             `json:"ready"`
}

// Preflight validates the locally observable upgrade and backup prerequisites.
// PostgreSQL and Redis are deliberately reported as external responsibilities.
func (s *Service) SetExternalBackupCheck(check func(context.Context) error) {
	s.externalBackupCheck = check
}

func (s *Service) Preflight(ctx context.Context, backupRoot string) PreflightReport {
	report := PreflightReport{ApplicationVersion: s.version, RestoreRequiresStop: true}
	if s == nil || s.database == nil {
		report.Ready = false
		report.Checks = []PreflightCheck{{Name: "database", OK: false, Detail: "database is not configured"}}
		return report
	}
	report.DatabaseDriver = s.database.Driver()
	report.ExternalBackupRequired = s.database.Driver() != "sqlite"
	add := func(name string, ok bool, detail string) {
		report.Checks = append(report.Checks, PreflightCheck{Name: name, OK: ok, Detail: detail})
	}
	add("database", true, s.database.Driver()+" connection is available")
	if s.database.Driver() == "sqlite" {
		add("database_snapshot", true, "VACUUM INTO snapshot is supported")
	} else if s.externalBackupCheck == nil {
		add("external_database_backup", false, "external database backup hook is required")
	} else if err := s.externalBackupCheck(ctx); err != nil {
		add("external_database_backup", false, err.Error())
	} else {
		add("external_database_backup", true, "external database backup hook verified")
	}
	if strings.TrimSpace(s.mediaRoot) == "" {
		add("media_root", false, "media root is empty")
	} else if err := os.MkdirAll(s.mediaRoot, 0o700); err != nil {
		add("media_root", false, err.Error())
	} else {
		add("media_root", true, s.mediaRoot)
	}
	if strings.TrimSpace(backupRoot) != "" {
		if _, err := s.Verify(ctx, backupRoot); err != nil {
			add("backup_manifest", false, err.Error())
		} else {
			add("backup_manifest", true, "backup manifest and checksums verified")
		}
	} else {
		add("backup_manifest", false, "no backup manifest supplied")
	}
	report.Ready = true
	for _, check := range report.Checks {
		if !check.OK && (check.Name == "database" || check.Name == "media_root" || check.Name == "backup_manifest" || check.Name == "external_database_backup") {
			report.Ready = false
		}
	}
	return report
}

type Service struct {
	database            *relational.Database
	mediaRoot           string
	version             string
	now                 func() time.Time
	externalBackupCheck func(context.Context) error
}

func NewService(database *relational.Database, mediaRoot, version string) *Service {
	return &Service{database: database, mediaRoot: filepath.Clean(mediaRoot), version: strings.TrimSpace(version), now: time.Now}
}

func (s *Service) Create(ctx context.Context, destination string) (Result, error) {
	if s == nil || s.database == nil {
		return Result{}, errors.New("backup database is not configured")
	}
	root, err := cleanDestination(destination)
	if err != nil {
		return Result{}, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return Result{}, fmt.Errorf("create backup directory: %w", err)
	}
	manifest := Manifest{FormatVersion: manifestVersion, CreatedAt: s.now().UTC(), ApplicationVersion: s.version, DatabaseDriver: s.database.Driver(), MediaRoot: s.mediaRoot, Encrypted: false, RestoreRequiresStop: true}
	if s.database.Driver() == "sqlite" {
		databasePath := filepath.Join(root, "database.sqlite")
		if err := s.database.BackupSQLite(ctx, databasePath); err != nil {
			return Result{}, fmt.Errorf("create SQLite snapshot: %w", err)
		}
		manifest.DatabaseSnapshot = "database.sqlite"
		entry, err := fileEntry(databasePath, "database.sqlite")
		if err != nil {
			return Result{}, err
		}
		manifest.DatabaseSHA256 = entry.SHA256
	} else {
		manifest.ExternalBackupRequired = true
	}
	mediaDestination := filepath.Join(root, "media")
	if err := copyMediaTree(ctx, s.mediaRoot, mediaDestination); err != nil {
		return Result{}, err
	}
	entries, err := listFiles(mediaDestination, "media")
	if err != nil {
		return Result{}, err
	}
	manifest.MediaFiles = entries
	manifestPath := filepath.Join(root, "manifest.json")
	if err := writeJSONAtomic(manifestPath, manifest); err != nil {
		return Result{}, err
	}
	return Result{ManifestPath: manifestPath, Manifest: manifest}, nil
}

func (s *Service) Verify(ctx context.Context, backupRoot string) (Manifest, error) {
	root, err := cleanDestination(backupRoot)
	if err != nil {
		return Manifest{}, err
	}
	var manifest Manifest
	data, err := os.ReadFile(filepath.Join(root, "manifest.json"))
	if err != nil {
		return Manifest{}, fmt.Errorf("read backup manifest: %w", err)
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("parse backup manifest: %w", err)
	}
	if manifest.FormatVersion != manifestVersion || !manifest.RestoreRequiresStop {
		return Manifest{}, errors.New("unsupported or unsafe backup manifest")
	}
	if manifest.DatabaseSnapshot != "" {
		entry, err := fileEntry(filepath.Join(root, manifest.DatabaseSnapshot), manifest.DatabaseSnapshot)
		if err != nil {
			return Manifest{}, err
		}
		if entry.SHA256 != manifest.DatabaseSHA256 {
			return Manifest{}, errors.New("database snapshot checksum mismatch")
		}
	}
	for _, expected := range manifest.MediaFiles {
		actual, err := fileEntry(filepath.Join(root, filepath.FromSlash(expected.Path)), expected.Path)
		if err != nil {
			return Manifest{}, err
		}
		if actual.Size != expected.Size || actual.SHA256 != expected.SHA256 {
			return Manifest{}, fmt.Errorf("media checksum mismatch: %s", expected.Path)
		}
	}
	if err := ctx.Err(); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

// Restore replaces the target SQLite/media paths and must be called while the application is stopped.
// Existing paths are renamed to a timestamped .pre-restore sibling before replacement.
func (s *Service) Restore(ctx context.Context, backupRoot, targetDatabase, targetMedia string) error {
	manifest, err := s.Verify(ctx, backupRoot)
	if err != nil {
		return err
	}
	if manifest.DatabaseDriver != "sqlite" || manifest.DatabaseSnapshot == "" {
		return errors.New("restore requires a SQLite snapshot; use the external database backup procedure for PostgreSQL")
	}
	targetDatabase, err = filepath.Abs(filepath.Clean(strings.TrimSpace(targetDatabase)))
	if err != nil || targetDatabase == "" {
		return errors.New("restore database path is invalid")
	}
	targetMedia, err = filepath.Abs(filepath.Clean(strings.TrimSpace(targetMedia)))
	if err != nil || targetMedia == "" {
		return errors.New("restore media path is invalid")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	timestamp := s.now().UTC().Format("20060102T150405Z")
	stagedDatabase := targetDatabase + ".restore-" + timestamp
	if err := copyFile(filepath.Join(filepath.Clean(backupRoot), filepath.FromSlash(manifest.DatabaseSnapshot)), stagedDatabase); err != nil {
		return fmt.Errorf("stage database restore: %w", err)
	}
	if err := replacePathWithBackup(stagedDatabase, targetDatabase, timestamp); err != nil {
		_ = os.Remove(stagedDatabase)
		return err
	}
	stagedMedia := targetMedia + ".restore-" + timestamp
	if err := copyTree(filepath.Join(filepath.Clean(backupRoot), "media"), stagedMedia); err != nil {
		return fmt.Errorf("stage media restore: %w", err)
	}
	if err := replacePathWithBackup(stagedMedia, targetMedia, timestamp); err != nil {
		return err
	}
	return nil
}

func replacePathWithBackup(staged, target, timestamp string) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	if _, err := os.Stat(target); err == nil {
		backup := target + ".pre-restore-" + timestamp
		if err := os.Rename(target, backup); err != nil {
			return fmt.Errorf("preserve existing restore target: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(staged, target); err != nil {
		return fmt.Errorf("activate restore target: %w", err)
	}
	return nil
}

func copyTree(source, destination string) error {
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return err
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if entry.Type().IsRegular() {
			return copyFile(path, target)
		}
		return nil
	})
}

func cleanDestination(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", errors.New("backup destination is empty")
	}
	return filepath.Abs(filepath.Clean(value))
}

func copyMediaTree(ctx context.Context, source, destination string) error {
	if strings.TrimSpace(source) == "" {
		return errors.New("media root is empty")
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return fmt.Errorf("create media backup directory: %w", err)
	}
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		if err := copyFile(path, target); err != nil {
			return fmt.Errorf("copy media %s: %w", relative, err)
		}
		return nil
	})
}

func copyFile(source, destination string) error {
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return err
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		_ = output.Close()
		return err
	}
	return output.Close()
}

func fileEntry(path, relative string) (FileEntry, error) {
	info, err := os.Stat(path)
	if err != nil {
		return FileEntry{}, fmt.Errorf("stat backup file %s: %w", relative, err)
	}
	if !info.Mode().IsRegular() {
		return FileEntry{}, fmt.Errorf("backup path is not a regular file: %s", relative)
	}
	file, err := os.Open(path)
	if err != nil {
		return FileEntry{}, err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return FileEntry{}, err
	}
	return FileEntry{Path: filepath.ToSlash(relative), Size: info.Size(), SHA256: hex.EncodeToString(hash.Sum(nil))}, nil
}

func listFiles(root, prefix string) ([]FileEntry, error) {
	entries := make([]FileEntry, 0)
	if _, err := os.Stat(root); errors.Is(err, os.ErrNotExist) {
		return entries, nil
	}
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		item, err := fileEntry(path, filepath.ToSlash(filepath.Join(prefix, relative)))
		if err != nil {
			return err
		}
		entries = append(entries, item)
		return nil
	}); err != nil {
		return nil, err
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Path < entries[j].Path })
	return entries, nil
}

func writeJSONAtomic(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}
