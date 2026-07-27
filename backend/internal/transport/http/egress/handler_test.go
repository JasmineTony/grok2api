package egress

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	egressapp "github.com/chenyme/grok2api/backend/internal/application/egress"
	accountdomain "github.com/chenyme/grok2api/backend/internal/domain/account"
	egressdomain "github.com/chenyme/grok2api/backend/internal/domain/egress"
	"github.com/chenyme/grok2api/backend/internal/infra/persistence/relational"
	"github.com/gin-gonic/gin"
)

func TestAccountEgressPolicyEndpointsRoundTrip(t *testing.T) {
	gin.SetMode(gin.TestMode)
	ctx := context.Background()
	database, err := relational.OpenSQLite(ctx, filepath.Join(t.TempDir(), "egress-policy-api.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if err := database.InitializeSchema(ctx); err != nil {
		t.Fatal(err)
	}
	accounts := relational.NewAccountRepository(database)
	egressRepository := relational.NewEgressRepository(database)
	credential, _, err := accounts.UpsertByIdentity(ctx, accountdomain.Credential{
		Provider: accountdomain.ProviderBuild, Name: "api-policy", SourceKey: "api-policy",
		EncryptedAccessToken: "encrypted", AuthStatus: accountdomain.AuthStatusActive,
	})
	if err != nil {
		t.Fatal(err)
	}
	node, err := egressRepository.CreateEgressNode(ctx, egressdomain.Node{Name: "build", Scope: egressdomain.ScopeBuild, Enabled: true})
	if err != nil {
		t.Fatal(err)
	}
	router := gin.New()
	NewHandler(egressapp.NewService(egressRepository, nil, "")).Register(router.Group("/api/admin/v1"))

	body, err := json.Marshal(map[string]any{"strategy": "node", "egressNodeId": strconv.FormatUint(node.ID, 10), "allowDirectFallback": true})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/admin/v1/accounts/"+strconv.FormatUint(credential.ID, 10)+"/egress-policy", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("PUT status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var updated struct {
		Data accountPolicyResponse `json:"data"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &updated); err != nil {
		t.Fatal(err)
	}
	if updated.Data.Strategy != "node" || updated.Data.EgressNodeID == nil || *updated.Data.EgressNodeID != node.ID || !updated.Data.AllowDirectFallback {
		t.Fatalf("updated policy = %#v", updated.Data)
	}

	request = httptest.NewRequest(http.MethodGet, "/api/admin/v1/accounts/"+strconv.FormatUint(credential.ID, 10)+"/egress-policy", nil)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte("\"strategy\":\"node\"")) {
		t.Fatalf("GET status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	request = httptest.NewRequest(http.MethodPost, "/api/admin/v1/egress-nodes/"+strconv.FormatUint(node.ID, 10)+"/check", nil)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte("\"healthy\":true")) {
		t.Fatalf("check status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	request = httptest.NewRequest(http.MethodGet, "/api/admin/v1/egress-nodes/"+strconv.FormatUint(node.ID, 10)+"/health-checks", nil)
	recorder = httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !bytes.Contains(recorder.Body.Bytes(), []byte("\"items\":[{")) {
		t.Fatalf("history status=%d body=%s", recorder.Code, recorder.Body.String())
	}

}

func TestNewNodeResponseIncludesIPv4AndIPv6ProbeDetails(t *testing.T) {
	testedAt := time.Now().UTC().Truncate(time.Second)
	response := newNodeResponse(egressdomain.PublicNode{
		ProbeStatus:   egressdomain.ProbeStatusHealthy,
		ProbeProvider: egressdomain.ProbeProviderCloudflare,
		IPv4Probe: egressdomain.ProbeFamilyResult{
			Status: egressdomain.ProbeStatusHealthy, TestedAt: testedAt, LatencyMS: 21, ExitIP: "198.51.100.2",
		},
		IPv6Probe: egressdomain.ProbeFamilyResult{
			Status: egressdomain.ProbeStatusUnhealthy, TestedAt: testedAt, LatencyMS: 48, Error: "浠ｇ悊杩炴帴澶辫触",
		},
	})
	if response.ProbeProvider != "cloudflare" || response.IPv4Probe.ExitIP != "198.51.100.2" || response.IPv4Probe.TestedAt == nil || response.IPv6Probe.Status != "unhealthy" || response.IPv6Probe.Error == "" {
		t.Fatalf("node response = %#v", response)
	}
}

func TestOperationsConfigRequestParsesFallbacks(t *testing.T) {
	input, err := (operationsConfigRequest{
		ProbeProvider: "cloudflare", ProbeIntervalSeconds: 900, AssignmentIntervalSeconds: 300,
		Fallbacks: map[string]operationsFallbackRequest{
			"grok_build": {Mode: "fixed", NodeID: "42"},
			"grok_web":   {Mode: "direct"},
		},
	}).input()
	if err != nil {
		t.Fatal(err)
	}
	if fallback := input.Fallbacks[egressdomain.ScopeBuild]; fallback.Mode != egressdomain.FallbackModeFixed || fallback.NodeID != 42 {
		t.Fatalf("Build fallback = %#v", fallback)
	}
	if fallback := input.Fallbacks[egressdomain.ScopeWeb]; fallback.Mode != egressdomain.FallbackModeDirect || fallback.NodeID != 0 {
		t.Fatalf("Web fallback = %#v", fallback)
	}
	if input.ProbeProvider != egressdomain.ProbeProviderCloudflare {
		t.Fatalf("probe provider = %q", input.ProbeProvider)
	}
}

func TestOperationsConfigRequestRejectsInvalidFallbackNodeID(t *testing.T) {
	_, err := (operationsConfigRequest{
		Fallbacks: map[string]operationsFallbackRequest{"grok_build": {Mode: "fixed", NodeID: "zero"}},
	}).input()
	if !errors.Is(err, egressapp.ErrInvalidInput) {
		t.Fatalf("invalid node ID error = %v", err)
	}
}
