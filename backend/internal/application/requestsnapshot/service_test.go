package requestsnapshot

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/chenyme/grok2api/backend/internal/infra/security"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestCaptureRedactsEncryptsAndViews(t *testing.T) {
	ctx := context.Background()
	db := openSnapshotDB(t)
	defer db.Close()
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatal(err)
	}
	cipher, err := security.NewCipher(base64.StdEncoding.EncodeToString(key))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewService(relational.NewRequestSnapshotRepository(db), cipher, true, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	value, err := service.Capture(ctx, "req-1", "openai_chat_completions", "chat", "grok-4", []byte(`{"model":"grok-4","authorization":"secret","messages":[{"role":"user","content":"private"}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if value.EncryptedPayload == "" || strings.Contains(value.EncryptedPayload, "secret") {
		t.Fatalf("snapshot leaked payload: %#v", value)
	}
	view, err := service.View(ctx, value.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !view.DryRun || strings.Contains(string(mustJSON(view.Payload)), "private") {
		t.Fatalf("view leaked content: %#v", view.Payload)
	}
	if _, err := service.Replay(ctx, value.ID, true); err == nil {
		t.Fatal("actual replay unexpectedly enabled")
	}
}
func mustJSON(value any) []byte { data, _ := json.Marshal(value); return data }
func openSnapshotDB(t *testing.T) *relational.Database {
	t.Helper()
	db, err := relational.OpenSQLite(context.Background(), filepath.Join(t.TempDir(), "snapshot.db"))
	if err != nil {
		t.Fatal(err)
	}
	if err := db.InitializeSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	return db
}
