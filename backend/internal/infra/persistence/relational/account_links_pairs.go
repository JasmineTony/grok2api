package relational

import (
	"sort"

	"gorm.io/gorm"
)

func uniqueSortedIDs(ids []uint64) []uint64 {
	if len(ids) == 0 {
		return nil
	}
	seen := make(map[uint64]struct{}, len(ids))
	out := make([]uint64, 0, len(ids))
	for _, id := range ids {
		if id == 0 {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// accountLinkPair maps a root account to its final peer, including two-hop paths.
type accountLinkPair struct {
	RootID uint64
	PeerID uint64
}

func listWebBuildPairs(db *gorm.DB, webIDs []uint64) ([]accountLinkPair, error) {
	if len(webIDs) == 0 {
		return nil, nil
	}
	var pairs []accountLinkPair
	err := db.Table("account_provider_links").
		Select("web_account_id AS root_id, build_account_id AS peer_id").
		Where("web_account_id IN ?", webIDs).Scan(&pairs).Error
	return pairs, err
}

func listWebConsolePairs(db *gorm.DB, webIDs []uint64) ([]accountLinkPair, error) {
	if len(webIDs) == 0 {
		return nil, nil
	}
	var pairs []accountLinkPair
	err := db.Table("web_console_account_links").
		Select("web_account_id AS root_id, console_account_id AS peer_id").
		Where("web_account_id IN ?", webIDs).Scan(&pairs).Error
	return pairs, err
}

func listBuildWebPairs(db *gorm.DB, buildIDs []uint64) ([]accountLinkPair, error) {
	if len(buildIDs) == 0 {
		return nil, nil
	}
	var pairs []accountLinkPair
	err := db.Table("account_provider_links").
		Select("build_account_id AS root_id, web_account_id AS peer_id").
		Where("build_account_id IN ?", buildIDs).Scan(&pairs).Error
	return pairs, err
}

// listBuildConsolePairs follows Build to Web to Console without returning the intermediate Web.
func listBuildConsolePairs(db *gorm.DB, buildIDs []uint64) ([]accountLinkPair, error) {
	if len(buildIDs) == 0 {
		return nil, nil
	}
	var pairs []accountLinkPair
	err := db.Table("account_provider_links apl").
		Select("apl.build_account_id AS root_id, wcal.console_account_id AS peer_id").
		Joins("JOIN web_console_account_links wcal ON wcal.web_account_id = apl.web_account_id").
		Where("apl.build_account_id IN ?", buildIDs).Scan(&pairs).Error
	return pairs, err
}

func listConsoleWebPairs(db *gorm.DB, consoleIDs []uint64) ([]accountLinkPair, error) {
	if len(consoleIDs) == 0 {
		return nil, nil
	}
	var pairs []accountLinkPair
	err := db.Table("web_console_account_links").
		Select("console_account_id AS root_id, web_account_id AS peer_id").
		Where("console_account_id IN ?", consoleIDs).Scan(&pairs).Error
	return pairs, err
}

// listConsoleBuildPairs follows Console to Web to Build without returning the intermediate Web.
func listConsoleBuildPairs(db *gorm.DB, consoleIDs []uint64) ([]accountLinkPair, error) {
	if len(consoleIDs) == 0 {
		return nil, nil
	}
	var pairs []accountLinkPair
	err := db.Table("web_console_account_links wcal").
		Select("wcal.console_account_id AS root_id, apl.build_account_id AS peer_id").
		Joins("JOIN account_provider_links apl ON apl.web_account_id = wcal.web_account_id").
		Where("wcal.console_account_id IN ?", consoleIDs).Scan(&pairs).Error
	return pairs, err
}
