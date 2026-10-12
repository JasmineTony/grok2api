package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/chenyme/grok2api/backend/internal/infra/config"
)

const sharedMediaMarkerName = ".grok2api-cluster"

// preflightDeployment validates the operator-declared shared media mount with a stable cluster marker and a read/write probe.
func preflightDeployment(cfg config.Config) error {
	if cfg.Deployment.Replicas <= 1 {
		return nil
	}
	directory := cfg.Media.Local.Path
	if err := verifySharedMediaMarker(directory, cfg.Deployment.ClusterID); err != nil {
		return err
	}
	return probeSharedMediaWritable(directory, cfg.Deployment.InstanceID)
}

// verifySharedMediaMarker 校验共享媒体目录的集群标记与配置的集群 ID 一致，必要时创建标记。
func verifySharedMediaMarker(directory, clusterID string) error {
	markerPath := filepath.Join(directory, sharedMediaMarkerName)
	want := strings.TrimSpace(clusterID) + "\n"
	current, err := os.ReadFile(markerPath)
	if errors.Is(err, os.ErrNotExist) {
		created, createErr := createSharedMediaMarker(markerPath, want)
		if createErr != nil {
			return createErr
		}
		current = created
	} else if err != nil {
		return fmt.Errorf("read shared media cluster marker: %w", err)
	}
	if string(current) != want {
		return fmt.Errorf("shared media cluster marker mismatch: configured cluster %q does not own %s", clusterID, markerPath)
	}
	return nil
}

// createSharedMediaMarker 创建集群标记文件；并发创建时回读已存在的标记内容。
func createSharedMediaMarker(markerPath, want string) ([]byte, error) {
	file, createErr := os.OpenFile(markerPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if createErr == nil {
		if _, writeErr := file.WriteString(want); writeErr != nil {
			_ = file.Close()
			return nil, fmt.Errorf("write shared media cluster marker: %w", writeErr)
		}
		if closeErr := file.Close(); closeErr != nil {
			return nil, fmt.Errorf("close shared media cluster marker: %w", closeErr)
		}
		return []byte(want), nil
	}
	if errors.Is(createErr, os.ErrExist) {
		current, readErr := os.ReadFile(markerPath)
		if readErr != nil {
			return nil, fmt.Errorf("read shared media cluster marker: %w", readErr)
		}
		return current, nil
	}
	return nil, fmt.Errorf("create shared media cluster marker: %w", createErr)
}

// probeSharedMediaWritable 通过临时文件读写回环验证共享媒体目录可写。
func probeSharedMediaWritable(directory, instanceID string) error {
	probe, err := os.CreateTemp(directory, ".grok2api-preflight-")
	if err != nil {
		return fmt.Errorf("create shared media preflight file: %w", err)
	}
	probePath := probe.Name()
	defer os.Remove(probePath)
	payload := []byte(strings.TrimSpace(instanceID))
	if _, err := probe.Write(payload); err != nil {
		_ = probe.Close()
		return fmt.Errorf("write shared media preflight file: %w", err)
	}
	if err := probe.Close(); err != nil {
		return fmt.Errorf("close shared media preflight file: %w", err)
	}
	readBack, err := os.ReadFile(probePath)
	if err != nil {
		return fmt.Errorf("read shared media preflight file: %w", err)
	}
	if string(readBack) != string(payload) {
		return errors.New("shared media preflight read-back mismatch")
	}
	return nil
}
