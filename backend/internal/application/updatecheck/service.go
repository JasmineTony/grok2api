package updatecheck

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

const (
	latestReleaseAPI = "https://api.github.com/repos/JasmineTony/grok2api/releases/latest"
	upstreamLatestReleaseAPI = "https://api.github.com/repos/chenyme/grok2api/releases/latest"
	maxReleaseBytes  = 1 << 20
	maxNotesRunes    = 4096
)

type Status string

const (
	StatusUnchecked       Status = "unchecked"
	StatusUpToDate        Status = "up_to_date"
	StatusUpdateAvailable Status = "update_available"
	StatusCheckFailed     Status = "check_failed"
)

type Snapshot struct {
	CurrentVersion  string     `json:"currentVersion"`
	LatestVersion   string     `json:"latestVersion"`
	UpdateAvailable bool       `json:"updateAvailable"`
	Status          Status     `json:"status"`
	CheckedAt       *time.Time `json:"checkedAt"`
	ReleaseURL      string     `json:"releaseUrl"`
	ReleaseNotes    string     `json:"releaseNotes"`
	Error                 string     `json:"error"`
	Repository            string     `json:"repository"`
	UpstreamRepository    string     `json:"upstreamRepository"`
	UpstreamLatestVersion string     `json:"upstreamLatestVersion"`
	UpstreamReleaseURL    string     `json:"upstreamReleaseUrl"`
	UpstreamError         string     `json:"upstreamError"`
}

type Service struct {
	current string
	client  *http.Client
	now     func() time.Time

	mu       sync.RWMutex
	snapshot Snapshot
	checks   singleflight.Group
}

func NewService(currentVersion string, client *http.Client) *Service {
	currentVersion = strings.TrimSpace(currentVersion)
	if currentVersion == "" {
		currentVersion = "dev"
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &Service{
		current: currentVersion,
		client:  client,
		now:     time.Now,
		snapshot: Snapshot{
			CurrentVersion: currentVersion,
			Status:         StatusUnchecked, Repository: "JasmineTony/grok2api", UpstreamRepository: "chenyme/grok2api",
		},
	}
}

func (s *Service) Snapshot() Snapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneSnapshot(s.snapshot)
}

func (s *Service) Check(ctx context.Context) Snapshot {
	result, err, _ := s.checks.Do("latest", func() (any, error) {
		return s.fetchLatestFrom(ctx, latestReleaseAPI)
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.snapshot.Status = StatusCheckFailed
		s.snapshot.Error = err.Error()
		return cloneSnapshot(s.snapshot)
	}
	release := result.(latestRelease)
	checkedAt := s.now().UTC()
	current, currentOK := parseSemanticVersion(s.current)
	latest, latestOK := parseSemanticVersion(release.Tag)
	if !currentOK || !latestOK {
		s.snapshot.LatestVersion = release.Tag
		s.snapshot.ReleaseURL = release.URL
		s.snapshot.ReleaseNotes = release.Notes
		s.snapshot.Status = StatusCheckFailed
		s.snapshot.Error = "当前版本或最新版本不是有效的语义化版本，无法比较"
		return cloneSnapshot(s.snapshot)
	}
	available := compareSemanticVersion(latest, current) > 0
	s.snapshot = Snapshot{
		CurrentVersion: s.current, LatestVersion: release.Tag,
		UpdateAvailable: available, CheckedAt: &checkedAt,
		ReleaseURL: release.URL, ReleaseNotes: release.Notes,
		Status: StatusUpToDate,
	}
	if available {
		s.snapshot.Status = StatusUpdateAvailable
	}
	return cloneSnapshot(s.snapshot)
}

// CheckUpstream refreshes the source repository version separately from the maintained repository.
// An upstream outage never hides a successful target release check.
func (s *Service) CheckUpstream(ctx context.Context) Snapshot {
	result, err, _ := s.checks.Do("upstream", func() (any, error) {
		return s.fetchLatestFrom(ctx, upstreamLatestReleaseAPI)
	})
	s.mu.Lock()
	defer s.mu.Unlock()
	if err != nil {
		s.snapshot.UpstreamError = err.Error()
		return cloneSnapshot(s.snapshot)
	}
	release := result.(latestRelease)
	s.snapshot.UpstreamLatestVersion = release.Tag
	s.snapshot.UpstreamReleaseURL = release.URL
	s.snapshot.UpstreamError = ""
	return cloneSnapshot(s.snapshot)
}

type latestRelease struct {
	Tag   string
	URL   string
	Notes string
}

func (s *Service) fetchLatest(ctx context.Context) (latestRelease, error) {
	return s.fetchLatestFrom(ctx, latestReleaseAPI)
}

func (s *Service) fetchLatestFrom(ctx context.Context, endpoint string) (latestRelease, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return latestRelease{}, err
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	request.Header.Set("User-Agent", "grok2api/"+s.current)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	response, err := s.client.Do(request)
	if err != nil {
		return latestRelease{}, fmt.Errorf("检查 GitHub Release 失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return latestRelease{}, fmt.Errorf("GitHub Release 检查失败（HTTP %d）", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxReleaseBytes+1))
	if err != nil {
		return latestRelease{}, fmt.Errorf("读取 GitHub Release 响应: %w", err)
	}
	if len(data) > maxReleaseBytes {
		return latestRelease{}, errors.New("GitHub Release 响应超过安全上限")
	}
	var payload struct {
		Tag  string `json:"tag_name"`
		Body string `json:"body"`
	}
	if err := json.Unmarshal(data, &payload); err != nil {
		return latestRelease{}, fmt.Errorf("解析 GitHub Release 响应: %w", err)
	}
	payload.Tag = strings.TrimSpace(payload.Tag)
	if payload.Tag == "" {
		return latestRelease{}, errors.New("GitHub Release 未返回版本号")
	}
	return latestRelease{
		Tag:   payload.Tag,
		URL:   releasePageURL(endpoint, payload.Tag),
		Notes: truncateRunes(strings.TrimSpace(payload.Body), maxNotesRunes),
	}, nil
}

func releasePageURL(endpoint, tag string) string {
	repository := strings.TrimSuffix(strings.TrimPrefix(endpoint, "https://api.github.com/repos/"), "/releases/latest")
	if repository == "" || repository == endpoint {
		return ""
	}
	return "https://github.com/" + repository + "/releases/tag/" + url.PathEscape(tag)
}

type semanticVersion struct {
	major, minor, patch uint64
	prerelease          string
}

func parseSemanticVersion(value string) (semanticVersion, bool) {
	value = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(value), "v"))
	if before, _, ok := strings.Cut(value, "+"); ok {
		value = before
	}
	prerelease := ""
	if before, after, ok := strings.Cut(value, "-"); ok {
		value, prerelease = before, after
	}
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return semanticVersion{}, false
	}
	numbers := make([]uint64, 3)
	for index, part := range parts {
		if part == "" || (len(part) > 1 && part[0] == '0') {
			return semanticVersion{}, false
		}
		value, err := strconv.ParseUint(part, 10, 64)
		if err != nil {
			return semanticVersion{}, false
		}
		numbers[index] = value
	}
	return semanticVersion{major: numbers[0], minor: numbers[1], patch: numbers[2], prerelease: prerelease}, true
}

func compareSemanticVersion(left, right semanticVersion) int {
	for _, pair := range [][2]uint64{{left.major, right.major}, {left.minor, right.minor}, {left.patch, right.patch}} {
		if pair[0] < pair[1] {
			return -1
		}
		if pair[0] > pair[1] {
			return 1
		}
	}
	if left.prerelease == right.prerelease {
		return 0
	}
	if left.prerelease == "" {
		return 1
	}
	if right.prerelease == "" {
		return -1
	}
	return strings.Compare(left.prerelease, right.prerelease)
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func cloneSnapshot(value Snapshot) Snapshot {
	if value.CheckedAt != nil {
		checkedAt := *value.CheckedAt
		value.CheckedAt = &checkedAt
	}
	return value
}
