package configcode

import (
	"fmt"
	"github.com/chenyme/grok2api/backend/internal/domain/requestpolicy"
	"gopkg.in/yaml.v3"
	"os"
	"strings"
)

type File struct {
	Models        []ModelSpec          `yaml:"models" json:"models"`
	Egress        []EgressSpec         `yaml:"egress" json:"egress"`
	Policies      []requestpolicy.Rule `yaml:"policies" json:"policies"`
	Notifications []NotificationSpec   `yaml:"notifications" json:"notifications"`
}
type ModelSpec struct {
	Name     string `yaml:"name" json:"name"`
	Provider string `yaml:"provider" json:"provider"`
	Enabled  *bool  `yaml:"enabled" json:"enabled"`
}
type EgressSpec struct {
	Name     string `yaml:"name" json:"name"`
	Scope    string `yaml:"scope" json:"scope"`
	Enabled  *bool  `yaml:"enabled" json:"enabled"`
	ProxyURL string `yaml:"proxyUrl" json:"proxyUrl"`
}
type NotificationSpec struct {
	Name       string `yaml:"name" json:"name"`
	Event      string `yaml:"event" json:"event"`
	WebhookEnv string `yaml:"webhookEnv" json:"webhookEnv"`
}
type Change struct {
	Kind   string `json:"kind"`
	Key    string `json:"key"`
	Action string `json:"action"`
	Detail string `json:"detail,omitempty"`
}

func Load(path string) (File, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return File{}, err
	}
	var value File
	if err := yaml.Unmarshal(data, &value); err != nil {
		return File{}, err
	}
	if err := Validate(value); err != nil {
		return File{}, err
	}
	return value, nil
}
func Validate(value File) error {
	seen := map[string]bool{}
	for _, item := range value.Models {
		if strings.TrimSpace(item.Name) == "" || strings.TrimSpace(item.Provider) == "" {
			return fmt.Errorf("model name and provider are required")
		}
		key := "model:" + item.Name
		if seen[key] {
			return fmt.Errorf("duplicate %s", key)
		}
		seen[key] = true
	}
	for _, item := range value.Egress {
		if strings.TrimSpace(item.Name) == "" || strings.TrimSpace(item.Scope) == "" {
			return fmt.Errorf("egress name and scope are required")
		}
		if strings.TrimSpace(item.ProxyURL) != "" && !strings.HasPrefix(item.ProxyURL, "env:") {
			return fmt.Errorf("egress %s proxyUrl must reference env:VAR", item.Name)
		}
	}
	for _, item := range value.Notifications {
		if item.WebhookEnv != "" && !strings.HasPrefix(item.WebhookEnv, "env:") {
			return fmt.Errorf("notification %s webhookEnv must reference env:VAR", item.Name)
		}
	}
	for _, rule := range value.Policies {
		if err := requestpolicy.ValidateRule(rule); err != nil {
			return err
		}
	}
	return nil
}
func Plan(desired File) []Change {
	changes := make([]Change, 0)
	for _, item := range desired.Models {
		changes = append(changes, Change{Kind: "model", Key: item.Name, Action: "ensure"})
	}
	for _, item := range desired.Egress {
		changes = append(changes, Change{Kind: "egress", Key: item.Name, Action: "ensure"})
	}
	for _, item := range desired.Policies {
		changes = append(changes, Change{Kind: "policy", Key: fmt.Sprint(item.ID), Action: "ensure"})
	}
	for _, item := range desired.Notifications {
		changes = append(changes, Change{Kind: "notification", Key: item.Name, Action: "ensure"})
	}
	return changes
}
