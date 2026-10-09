package relational

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

func (r *AccountRepository) LinkWebToBuild(ctx context.Context, webAccountID, buildAccountID uint64) error {
	if webAccountID == 0 || buildAccountID == 0 || webAccountID == buildAccountID {
		return repository.ErrConflict
	}
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := lockAccountLinkMutation(tx); err != nil {
			return err
		}
		var webAccount, buildAccount accountModel
		if err := tx.Select("id", "provider").First(&webAccount, webAccountID).Error; err != nil {
			return err
		}
		if err := tx.Select("id", "provider").First(&buildAccount, buildAccountID).Error; err != nil {
			return err
		}
		if webAccount.Provider != string(account.ProviderWeb) || buildAccount.Provider != string(account.ProviderBuild) {
			return repository.ErrConflict
		}
		var existing accountProviderLinkModel
		err := tx.Where("web_account_id = ? OR build_account_id = ?", webAccountID, buildAccountID).First(&existing).Error
		if err == nil {
			if existing.WebAccountID == webAccountID && existing.BuildAccountID == buildAccountID {
				return nil
			}
			return repository.ErrConflict
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		return tx.Create(&accountProviderLinkModel{WebAccountID: webAccountID, BuildAccountID: buildAccountID, CreatedAt: time.Now().UTC()}).Error
	})
	err = mapError(err)
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountCredentialChanged})
	}
	return err
}

func (r *AccountRepository) attachAccountLinks(ctx context.Context, values []account.Credential) error {
	if len(values) == 0 {
		return nil
	}
	ids := make([]uint64, 0, len(values))
	positions := make(map[uint64]int, len(values))
	for index := range values {
		ids = append(ids, values[index].ID)
		positions[values[index].ID] = index
	}
	var buildRows []struct {
		WebAccountID            uint64
		BuildAccountID          uint64
		WebName                 string
		BuildName               string
		WebEmail                string
		BuildEmail              string
		WebUserID               string
		BuildUserID             string
		WebSourceKey            string
		EgressIdentity          string
		WebNSFWEnabledAt        *time.Time
		WebTermsAcceptedAt      *time.Time
		WebTermsAcceptedVersion int
	}
	err := r.db.db.WithContext(ctx).Table("account_provider_links AS link").
		Select("link.web_account_id, link.build_account_id, web.name AS web_name, build.name AS build_name, web.email AS web_email, build.email AS build_email, web.user_id AS web_user_id, build.user_id AS build_user_id, web.source_key AS web_source_key, profile.egress_identity, profile.nsfw_enabled_at AS web_nsfw_enabled_at, profile.terms_accepted_at AS web_terms_accepted_at, profile.terms_accepted_version AS web_terms_accepted_version").
		Joins("JOIN provider_accounts AS web ON web.id = link.web_account_id").
		Joins("JOIN provider_accounts AS build ON build.id = link.build_account_id").
		Joins("LEFT JOIN web_account_profiles AS profile ON profile.account_id = web.id").
		Where("link.web_account_id IN ? OR link.build_account_id IN ?", ids, ids).
		Scan(&buildRows).Error
	if err != nil {
		return err
	}
	for _, row := range buildRows {
		egressIdentity := linkedWebEgressIdentity(row.EgressIdentity, row.WebSourceKey)
		if index, ok := positions[row.WebAccountID]; ok {
			values[index].LinkedAccountID = row.BuildAccountID
			values[index].LinkedAccountName = row.BuildName
			values[index].LinkedProvider = account.ProviderBuild
			values[index].LinkedAccounts = append(values[index].LinkedAccounts, account.LinkedAccount{ID: row.BuildAccountID, Provider: account.ProviderBuild, Name: row.BuildName, Email: row.BuildEmail, UserID: row.BuildUserID})
			if values[index].EgressIdentity == "" {
				values[index].EgressIdentity = egressIdentity
			}
			values[index].WebNSFWEnabledAt = row.WebNSFWEnabledAt
			values[index].WebTermsAcceptedVersion = row.WebTermsAcceptedVersion
			values[index].WebTermsAcceptedAt = currentWebTermsAcceptedAt(row.WebTermsAcceptedAt, row.WebTermsAcceptedVersion)
		}
		if index, ok := positions[row.BuildAccountID]; ok {
			values[index].LinkedAccountID = row.WebAccountID
			values[index].LinkedAccountName = row.WebName
			values[index].LinkedProvider = account.ProviderWeb
			values[index].LinkedAccounts = append(values[index].LinkedAccounts, account.LinkedAccount{ID: row.WebAccountID, Provider: account.ProviderWeb, Name: row.WebName, Email: row.WebEmail, UserID: row.WebUserID})
			values[index].EgressIdentity = egressIdentity
			values[index].WebNSFWEnabledAt = row.WebNSFWEnabledAt
			values[index].WebTermsAcceptedVersion = row.WebTermsAcceptedVersion
			values[index].WebTermsAcceptedAt = currentWebTermsAcceptedAt(row.WebTermsAcceptedAt, row.WebTermsAcceptedVersion)
		}
	}
	var consoleRows []struct {
		WebAccountID            uint64
		ConsoleAccountID        uint64
		WebName                 string
		ConsoleName             string
		WebEmail                string
		ConsoleEmail            string
		WebUserID               string
		ConsoleUserID           string
		WebSourceKey            string
		EgressIdentity          string
		WebNSFWEnabledAt        *time.Time
		WebTermsAcceptedAt      *time.Time
		WebTermsAcceptedVersion int
	}
	if err := r.db.db.WithContext(ctx).Table("web_console_account_links AS link").
		Select("link.web_account_id, link.console_account_id, web.name AS web_name, console.name AS console_name, web.email AS web_email, console.email AS console_email, web.user_id AS web_user_id, console.user_id AS console_user_id, web.source_key AS web_source_key, profile.egress_identity, profile.nsfw_enabled_at AS web_nsfw_enabled_at, profile.terms_accepted_at AS web_terms_accepted_at, profile.terms_accepted_version AS web_terms_accepted_version").
		Joins("JOIN provider_accounts AS web ON web.id = link.web_account_id").
		Joins("JOIN provider_accounts AS console ON console.id = link.console_account_id").
		Joins("LEFT JOIN web_account_profiles AS profile ON profile.account_id = web.id").
		Where("link.web_account_id IN ? OR link.console_account_id IN ?", ids, ids).
		Scan(&consoleRows).Error; err != nil {
		return err
	}
	for _, row := range consoleRows {
		egressIdentity := linkedWebEgressIdentity(row.EgressIdentity, row.WebSourceKey)
		if index, ok := positions[row.WebAccountID]; ok {
			values[index].LinkedAccounts = append(values[index].LinkedAccounts, account.LinkedAccount{ID: row.ConsoleAccountID, Provider: account.ProviderConsole, Name: row.ConsoleName, Email: row.ConsoleEmail, UserID: row.ConsoleUserID})
			if values[index].EgressIdentity == "" {
				values[index].EgressIdentity = egressIdentity
			}
			values[index].WebNSFWEnabledAt = row.WebNSFWEnabledAt
			values[index].WebTermsAcceptedVersion = row.WebTermsAcceptedVersion
			values[index].WebTermsAcceptedAt = currentWebTermsAcceptedAt(row.WebTermsAcceptedAt, row.WebTermsAcceptedVersion)
		}
		if index, ok := positions[row.ConsoleAccountID]; ok {
			values[index].LinkedAccounts = append(values[index].LinkedAccounts, account.LinkedAccount{ID: row.WebAccountID, Provider: account.ProviderWeb, Name: row.WebName, Email: row.WebEmail, UserID: row.WebUserID})
			values[index].EgressIdentity = egressIdentity
			values[index].WebNSFWEnabledAt = row.WebNSFWEnabledAt
			values[index].WebTermsAcceptedVersion = row.WebTermsAcceptedVersion
			values[index].WebTermsAcceptedAt = currentWebTermsAcceptedAt(row.WebTermsAcceptedAt, row.WebTermsAcceptedVersion)
		}
	}
	return nil
}

func currentWebTermsAcceptedAt(value *time.Time, version int) *time.Time {
	if version < account.CurrentWebTermsVersion {
		return nil
	}
	return value
}

func (r *AccountRepository) UpsertByIdentity(ctx context.Context, value account.Credential) (account.Credential, bool, error) {
	var result repository.AccountUpsertResult
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var err error
		result, err = upsertAccountByIdentity(tx, value)
		return err
	})
	if err != nil {
		return account.Credential{}, false, mapError(err)
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: value.Provider, AccountID: result.ID})
	stored, err := r.Get(ctx, result.ID)
	return stored, result.Created, err
}

func (r *AccountRepository) UpsertManyByIdentity(ctx context.Context, values []account.Credential) ([]repository.AccountUpsertResult, error) {
	if len(values) == 0 {
		return []repository.AccountUpsertResult{}, nil
	}
	results := make([]repository.AccountUpsertResult, len(values))
	err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		identityKeys := make([]string, 0, len(values))
		sourceKeysByProvider := make(map[account.Provider][]string)
		for _, value := range values {
			identityKeys = append(identityKeys, fromAccountDomain(value).IdentityKey)
			if strings.TrimSpace(value.SourceKey) != "" {
				sourceKeysByProvider[value.Provider] = append(sourceKeysByProvider[value.Provider], value.SourceKey)
			}
		}
		var existingRows []accountModel
		if err := tx.Where("identity_key IN ?", identityKeys).Find(&existingRows).Error; err != nil {
			return err
		}
		existingByIdentity := make(map[string]accountModel, len(values))
		for _, row := range existingRows {
			existingByIdentity[row.IdentityKey] = row
		}
		existingBySource := make(map[string]accountModel, len(values))
		for providerValue, sourceKeys := range sourceKeysByProvider {
			var sourceRows []accountModel
			if err := tx.Where("provider = ? AND source_key IN ?", providerValue, sourceKeys).Find(&sourceRows).Error; err != nil {
				return err
			}
			for _, row := range sourceRows {
				key := providerSourceLookupKey(row.Provider, row.SourceKey)
				if existing, duplicate := existingBySource[key]; duplicate && existing.ID != row.ID {
					return fmt.Errorf("Provider %s 的来源凭据匹配多个账号", row.Provider)
				}
				existingBySource[key] = row
			}
		}
		for index, value := range values {
			identityKey := fromAccountDomain(value).IdentityKey
			existing, foundByIdentity := existingByIdentity[identityKey]
			bySource, foundBySource := existingBySource[providerSourceLookupKey(string(value.Provider), value.SourceKey)]
			if foundByIdentity && foundBySource && existing.ID != bySource.ID {
				return fmt.Errorf("账号身份与来源凭据指向不同账号")
			}
			if !foundByIdentity && foundBySource {
				existing = bySource
			}
			var current *accountModel
			if foundByIdentity || foundBySource {
				current = &existing
			}
			result, stored, err := upsertKnownAccountByIdentity(tx, value, current)
			if err != nil {
				return err
			}
			results[index] = result
			existingByIdentity[stored.IdentityKey] = stored
			existingBySource[providerSourceLookupKey(stored.Provider, stored.SourceKey)] = stored
		}
		return nil
	})
	if err != nil {
		return nil, mapError(err)
	}
	providers := make(map[account.Provider]struct{})
	for _, value := range values {
		providers[value.Provider] = struct{}{}
	}
	for providerValue := range providers {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: providerValue})
	}
	return results, nil
}

func upsertAccountByIdentity(tx *gorm.DB, value account.Credential) (repository.AccountUpsertResult, error) {
	row := fromAccountDomain(value)
	var byIdentity accountModel
	identityErr := tx.Where("identity_key = ?", row.IdentityKey).First(&byIdentity).Error
	if identityErr != nil && !errors.Is(identityErr, gorm.ErrRecordNotFound) {
		return repository.AccountUpsertResult{}, identityErr
	}
	var sourceRows []accountModel
	if strings.TrimSpace(row.SourceKey) != "" {
		if err := tx.Where("provider = ? AND source_key = ?", row.Provider, row.SourceKey).Limit(2).Find(&sourceRows).Error; err != nil {
			return repository.AccountUpsertResult{}, err
		}
		if len(sourceRows) > 1 {
			return repository.AccountUpsertResult{}, fmt.Errorf("Provider %s 的来源凭据匹配多个账号", row.Provider)
		}
	}
	if identityErr == nil && len(sourceRows) == 1 && byIdentity.ID != sourceRows[0].ID {
		return repository.AccountUpsertResult{}, fmt.Errorf("账号身份与来源凭据指向不同账号")
	}
	if identityErr == nil {
		result, _, err := upsertKnownAccountByIdentity(tx, value, &byIdentity)
		return result, err
	}
	if len(sourceRows) == 1 {
		result, _, err := upsertKnownAccountByIdentity(tx, value, &sourceRows[0])
		return result, err
	}
	result, _, err := upsertKnownAccountByIdentity(tx, value, nil)
	return result, err
}

func providerSourceLookupKey(providerValue, sourceKey string) string {
	return providerValue + "\x00" + sourceKey
}

func upsertKnownAccountByIdentity(tx *gorm.DB, value account.Credential, existing *accountModel) (repository.AccountUpsertResult, accountModel, error) {
	row := fromAccountDomain(value)
	if existing != nil {
		if value.EncryptedCloudflareCookie == "" {
			var storedCredential accountCredentialModel
			if err := tx.Where("account_id = ?", existing.ID).First(&storedCredential).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return repository.AccountUpsertResult{}, accountModel{}, err
			}
			value.EncryptedCloudflareCookie = storedCredential.EncryptedCloudflareCookie
		}
		row.ID = existing.ID
		row.CreatedAt = existing.CreatedAt
		row.Enabled = existing.Enabled
		row.Priority = existing.Priority
		row.MaxConcurrent = existing.MaxConcurrent
		row.MinimumRemaining = existing.MinimumRemaining
		row.FailureCount = existing.FailureCount
		row.CooldownUntil = existing.CooldownUntil
		row.LastError = existing.LastError
		row.LastUsedAt = existing.LastUsedAt
		row.ObservedModel = existing.ObservedModel
		row.ObservedModelAt = existing.ObservedModelAt
		// 账号级 Build 路由、XAI 回退记录与 Super entitlement 在 upsert/转换/刷新路径中保留。
		row.BuildAPIFallback = existing.BuildAPIFallback
		row.BuildRouteMode = existing.BuildRouteMode
		row.BuildSuperEntitled = existing.BuildSuperEntitled
		row.EgressNodeID = existing.EgressNodeID
		row.EgressAssignmentMode = existing.EgressAssignmentMode
		row.EgressAssignedAt = existing.EgressAssignedAt
		// reauth_marked_at 与 Update 路径一致：保持 reauth 时永不被普通 upsert 改写。
		applyReauthMarkedAtTransition(&row, *existing)
		if err := tx.Save(&row).Error; err != nil {
			return repository.AccountUpsertResult{}, accountModel{}, err
		}
		if _, err := deleteInvalidEgressLeaseBlocksForAccount(tx, row); err != nil {
			return repository.AccountUpsertResult{}, accountModel{}, err
		}
		if err := saveAccountRelations(tx, value, row.ID); err != nil {
			return repository.AccountUpsertResult{}, accountModel{}, err
		}
		return repository.AccountUpsertResult{ID: row.ID}, row, nil
	}
	if row.AuthStatus == "" {
		row.AuthStatus = string(account.AuthStatusActive)
	}
	if row.AuthStatus == string(account.AuthStatusReauthRequired) && row.ReauthMarkedAt == nil {
		now := time.Now().UTC()
		row.ReauthMarkedAt = &now
	}
	if row.AuthStatus != string(account.AuthStatusReauthRequired) {
		row.ReauthMarkedAt = nil
	}
	if row.Priority == 0 {
		row.Priority = account.DefaultPriority
	}
	if row.MaxConcurrent == 0 {
		row.MaxConcurrent = account.DefaultMaxConcurrent
	}
	row.Enabled = true
	if err := tx.Create(&row).Error; err != nil {
		return repository.AccountUpsertResult{}, accountModel{}, err
	}
	if err := saveAccountRelations(tx, value, row.ID); err != nil {
		return repository.AccountUpsertResult{}, accountModel{}, err
	}
	return repository.AccountUpsertResult{ID: row.ID, Created: true}, row, nil
}

func (r *AccountRepository) Update(ctx context.Context, value account.Credential) (account.Credential, error) {
	var row accountModel
	var storedProvider account.Provider
	if err := r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing accountModel
		if err := tx.Select("id", "identity_key", "created_at", "provider", "auth_status", "reauth_marked_at").First(&existing, value.ID).Error; err != nil {
			return err
		}
		storedProvider = account.Provider(existing.Provider)
		value.Provider = storedProvider
		row = fromAccountDomain(value)
		row.ID = existing.ID
		// 身份同步补充的 user_id/email 不得让普通编辑重写持久化身份键。
		row.IdentityKey = existing.IdentityKey
		row.CreatedAt = existing.CreatedAt
		applyReauthMarkedAtTransition(&row, existing)
		if err := tx.Save(&row).Error; err != nil {
			return err
		}
		if _, err := deleteInvalidEgressLeaseBlocksForAccount(tx, row); err != nil {
			return err
		}
		return saveAccountRelations(tx, value, row.ID)
	}); err != nil {
		return account.Credential{}, mapError(err)
	}
	r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: storedProvider, AccountID: row.ID})
	return r.Get(ctx, row.ID)
}

// applyReauthMarkedAtTransition 仅在状态切入 reauthRequired 时打锚点；保持 reauth 时保留原锚点；离开 reauth 时清空。
func applyReauthMarkedAtTransition(row *accountModel, existing accountModel) {
	if row.AuthStatus == string(account.AuthStatusReauthRequired) {
		if existing.AuthStatus == string(account.AuthStatusReauthRequired) && existing.ReauthMarkedAt != nil {
			row.ReauthMarkedAt = existing.ReauthMarkedAt
			return
		}
		if row.ReauthMarkedAt == nil {
			now := time.Now().UTC()
			row.ReauthMarkedAt = &now
		}
		return
	}
	row.ReauthMarkedAt = nil
}

func saveAccountRelations(tx *gorm.DB, value account.Credential, accountID uint64) error {
	value.ID = accountID
	credential := fromAccountCredentialDomain(value)
	if err := tx.Save(&credential).Error; err != nil {
		return err
	}
	if profile := fromWebProfileDomain(value); profile != nil {
		updates := []string{"tier", "synced_at"}
		if profile.NSFWEnabledAt != nil {
			updates = append(updates, "nsfw_enabled_at")
		}
		if profile.TermsAcceptedAt != nil {
			updates = append(updates, "terms_accepted_at")
		}
		if profile.TermsAcceptedVersion > 0 {
			updates = append(updates, "terms_accepted_version")
		}
		if profile.BirthDateSetAt != nil {
			updates = append(updates, "birth_date_set_at")
		}
		if strings.TrimSpace(profile.EgressIdentity) != "" {
			updates = append(updates, "egress_identity")
		}
		return tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "account_id"}},
			DoUpdates: clause.AssignmentColumns(updates),
		}).Create(profile).Error
	}
	return tx.Where("account_id = ?", accountID).Delete(&webAccountProfileModel{}).Error
}

// MarkWebNSFWEnabled 幂等保存首次成功开启时间；重复执行不会覆盖已有标记。
func (r *AccountRepository) MarkWebNSFWEnabled(ctx context.Context, id uint64, enabledAt time.Time) error {
	if id == 0 || enabledAt.IsZero() {
		return fmt.Errorf("Web NSFW 标记参数无效")
	}
	err := r.markWebProfileTimestamp(ctx, id, "nsfw_enabled_at", enabledAt)
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: account.ProviderWeb, AccountID: id})
	}
	return err
}

// MarkWebTermsAccepted 幂等保存已完整接受的产品协议版本。
// 协议升级时会同步更新完成时间；相同或更高版本不会被覆盖。
func (r *AccountRepository) MarkWebTermsAccepted(ctx context.Context, id uint64, version int, acceptedAt time.Time) error {
	if id == 0 || version <= 0 || acceptedAt.IsZero() {
		return fmt.Errorf("Web 服务协议标记参数无效")
	}
	acceptedAt = acceptedAt.UTC()
	err := mapError(r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var accountRow accountModel
		if err := tx.Select("id", "provider").First(&accountRow, id).Error; err != nil {
			return err
		}
		if account.Provider(accountRow.Provider) != account.ProviderWeb {
			return fmt.Errorf("仅 Grok Web 账号支持资料状态标记")
		}
		profile := webAccountProfileModel{
			AccountID: id, Tier: string(account.WebTierAuto),
			TermsAcceptedAt: &acceptedAt, TermsAcceptedVersion: version,
		}
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&profile)
		if created.Error != nil || created.RowsAffected > 0 {
			return created.Error
		}
		return tx.Model(&webAccountProfileModel{}).
			Where("account_id = ? AND (terms_accepted_version < ? OR terms_accepted_at IS NULL)", id, version).
			Updates(map[string]any{"terms_accepted_at": acceptedAt, "terms_accepted_version": version}).Error
	}))
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: account.ProviderWeb, AccountID: id})
	}
	return err
}

// MarkWebBirthDateSet 幂等保存首次成功设置或确认已有生日的时间。
func (r *AccountRepository) MarkWebBirthDateSet(ctx context.Context, id uint64, setAt time.Time) error {
	if id == 0 || setAt.IsZero() {
		return fmt.Errorf("Web 生日标记参数无效")
	}
	err := r.markWebProfileTimestamp(ctx, id, "birth_date_set_at", setAt)
	if err == nil {
		r.notifyInvalidation(ctx, repository.InvalidationEvent{Kind: repository.InvalidationAccountStateChanged, Provider: account.ProviderWeb, AccountID: id})
	}
	return err
}

func (r *AccountRepository) markWebProfileTimestamp(ctx context.Context, id uint64, column string, value time.Time) error {
	value = value.UTC()
	return mapError(r.db.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var accountRow accountModel
		if err := tx.Select("id", "provider").First(&accountRow, id).Error; err != nil {
			return err
		}
		if account.Provider(accountRow.Provider) != account.ProviderWeb {
			return fmt.Errorf("仅 Grok Web 账号支持资料状态标记")
		}
		profile := webAccountProfileModel{AccountID: id, Tier: string(account.WebTierAuto)}
		switch column {
		case "nsfw_enabled_at":
			profile.NSFWEnabledAt = &value
		case "birth_date_set_at":
			profile.BirthDateSetAt = &value
		default:
			return fmt.Errorf("Web 资料状态字段无效")
		}
		created := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&profile)
		if created.Error != nil || created.RowsAffected > 0 {
			return created.Error
		}
		switch column {
		case "nsfw_enabled_at":
			return tx.Model(&webAccountProfileModel{}).
				Where("account_id = ? AND nsfw_enabled_at IS NULL", id).
				Update("nsfw_enabled_at", value).Error
		case "birth_date_set_at":
			return tx.Model(&webAccountProfileModel{}).
				Where("account_id = ? AND birth_date_set_at IS NULL", id).
				Update("birth_date_set_at", value).Error
		default:
			return fmt.Errorf("Web 资料状态字段无效")
		}
	}))
}
