package egress

import (
	"context"
	"net"
	"path/filepath"
	"testing"

	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
)

func TestCheckRecordsHealthyProxyHistory(t *testing.T) {
	ctx := context.Background()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = listener.Close() })
	go func() {
		for {
			connection, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			_ = connection.Close()
		}
	}()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "health.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	cipher, err := security.NewCipher("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
	if err != nil {
		t.Fatal(err)
	}
	proxyURL, err := cipher.Encrypt("http://" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	repository := relational.NewEgressRepository(database)
	node, err := repository.CreateEgressNode(ctx, egressdomain.Node{Name: "health", Scope: egressdomain.ScopeWeb, Enabled: true, EncryptedProxyURL: proxyURL, Health: 0.5})
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(repository, cipher, "")
	result, err := service.Check(ctx, node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Healthy || result.ErrorCode != "" {
		t.Fatalf("result = %#v", result)
	}
	stored, err := repository.GetEgressNode(ctx, node.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.FailureCount != 0 || stored.Health <= 0.5 || stored.CooldownUntil != nil {
		t.Fatalf("stored node = %#v", stored)
	}
	history, err := service.ListHealthChecks(ctx, node.ID, 10)
	if err != nil || len(history) != 1 || !history[0].Healthy {
		t.Fatalf("history = %#v, err=%v", history, err)
	}
}
