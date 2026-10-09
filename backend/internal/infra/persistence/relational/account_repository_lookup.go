package relational

import (
	"context"
	"errors"

	"github.com/chenyme/grok2api/backend/internal/domain/account"
	"github.com/chenyme/grok2api/backend/internal/repository"
	"gorm.io/gorm"
)

func (r *AccountRepository) ListEnabled(ctx context.Context, provider account.Provider) ([]account.Credential, error) {
	rows, err := r.listActiveProviderAccountRows(ctx, provider, nil)
	if err != nil {
		return nil, err
	}
	out := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		out = append(out, toAccountDomain(row))
	}
	if err := r.attachRoutingEgressIdentities(ctx, provider, out); err != nil {
		return nil, err
	}
	return out, nil
}

func (r *AccountRepository) ListEnabledAccountIDs(ctx context.Context, provider account.Provider, refreshableOnly bool) ([]uint64, error) {
	query := r.db.db.WithContext(ctx).
		Table("provider_accounts AS account").
		Select("account.id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status = ?", provider, true, account.AuthStatusActive)
	if refreshableOnly {
		query = query.
			Joins("JOIN account_credentials AS credential ON credential.account_id = account.id").
			Where("credential.encrypted_refresh <> ''")
	}
	var ids []uint64
	err := query.Order("account.priority DESC, account.id ASC").Scan(&ids).Error
	return ids, err
}

func (r *AccountRepository) ListEnabledCredentialRefreshAccountIDs(ctx context.Context, provider account.Provider, refreshableOnly bool) ([]uint64, error) {
	query := r.db.db.WithContext(ctx).
		Table("provider_accounts AS account").
		Select("account.id").
		Where("account.provider = ? AND account.enabled = ? AND account.auth_status IN ?", provider, true, []account.AuthStatus{account.AuthStatusActive, account.AuthStatusReauthRequired})
	if refreshableOnly {
		query = query.
			Joins("JOIN account_credentials AS credential ON credential.account_id = account.id").
			Where("credential.encrypted_refresh <> ''")
	}
	var ids []uint64
	err := query.Order("account.id ASC").Scan(&ids).Error
	return ids, err
}

func (r *AccountRepository) FilterMissingBuildConversionIDs(ctx context.Context, ids []uint64) ([]uint64, error) {
	if len(ids) == 0 {
		return []uint64{}, nil
	}
	var linkedIDs []uint64
	if err := r.db.db.WithContext(ctx).Model(&accountProviderLinkModel{}).
		Where("web_account_id IN ?", ids).Pluck("web_account_id", &linkedIDs).Error; err != nil {
		return nil, err
	}
	linked := make(map[uint64]struct{}, len(linkedIDs))
	for _, id := range linkedIDs {
		linked[id] = struct{}{}
	}
	values := make([]uint64, 0, len(ids)-len(linked))
	for _, id := range ids {
		if _, exists := linked[id]; !exists {
			values = append(values, id)
		}
	}
	return values, nil
}

func (r *AccountRepository) ListUnlinkedWebAccountIDs(ctx context.Context, afterID uint64, limit int) ([]uint64, int64, error) {
	if limit < 1 {
		return []uint64{}, 0, nil
	}
	query := func() *gorm.DB {
		return r.db.db.WithContext(ctx).
			Table("provider_accounts AS account").
			Joins("LEFT JOIN account_provider_links AS link ON link.web_account_id = account.id").
			Where("account.provider = ? AND link.web_account_id IS NULL", account.ProviderWeb)
	}
	var total int64
	if afterID == 0 {
		if err := query().Count(&total).Error; err != nil {
			return nil, 0, err
		}
	}
	var ids []uint64
	err := query().
		Select("account.id").
		Where("account.id > ?", afterID).
		Order("account.id ASC").
		Limit(limit).
		Scan(&ids).Error
	return ids, total, err
}

func (r *AccountRepository) ListMissingConsoleSyncAccounts(ctx context.Context, ids []uint64) ([]account.Credential, error) {
	if len(ids) == 0 {
		return []account.Credential{}, nil
	}
	var existing int64
	if err := r.db.db.WithContext(ctx).Model(&accountModel{}).
		Where("id IN ? AND provider = ?", ids, account.ProviderWeb).Count(&existing).Error; err != nil {
		return nil, err
	}
	if existing != int64(len(ids)) {
		return nil, repository.ErrNotFound
	}
	var rows []accountModel
	if err := r.db.db.WithContext(ctx).
		Preload("Credential").Preload("WebProfile").
		Where("id IN ? AND provider = ?", ids, account.ProviderWeb).
		Where(missingConsoleAccountPredicate, account.ProviderConsole).
		Order("id ASC").Find(&rows).Error; err != nil {
		return nil, err
	}
	values := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		values = append(values, toAccountDomain(row))
	}
	return values, nil
}

func (r *AccountRepository) ListMissingConsoleSyncBatch(ctx context.Context, afterID uint64, limit int) ([]account.Credential, int64, int64, error) {
	if limit < 1 {
		return []account.Credential{}, 0, 0, nil
	}
	query := func() *gorm.DB {
		return r.db.db.WithContext(ctx).Model(&accountModel{}).
			Where("provider = ?", account.ProviderWeb).
			Where(missingConsoleAccountPredicate, account.ProviderConsole)
	}
	var total, skipped int64
	if afterID == 0 {
		if err := query().Count(&total).Error; err != nil {
			return nil, 0, 0, err
		}
		var all int64
		if err := r.db.db.WithContext(ctx).Model(&accountModel{}).Where("provider = ?", account.ProviderWeb).Count(&all).Error; err != nil {
			return nil, 0, 0, err
		}
		skipped = max(0, all-total)
	}
	var rows []accountModel
	if err := query().Preload("Credential").Preload("WebProfile").
		Where("id > ?", afterID).Order("id ASC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, 0, 0, err
	}
	values := make([]account.Credential, 0, len(rows))
	for _, row := range rows {
		values = append(values, toAccountDomain(row))
	}
	return values, total, skipped, nil
}

func (r *AccountRepository) HasActive(ctx context.Context, provider account.Provider) (bool, error) {
	var row struct{ ID uint64 }
	err := r.db.db.WithContext(ctx).Model(&accountModel{}).Select("id").Where("provider = ? AND enabled = ? AND auth_status = ?", provider, true, account.AuthStatusActive).Take(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return false, nil
	}
	return row.ID > 0, err
}

func (r *AccountRepository) Get(ctx context.Context, id uint64) (account.Credential, error) {
	var row accountModel
	if err := r.db.db.WithContext(ctx).Preload("Credential").Preload("WebProfile").First(&row, id).Error; err != nil {
		return account.Credential{}, mapError(err)
	}
	value := toAccountDomain(row)
	values := []account.Credential{value}
	if err := r.attachAccountLinks(ctx, values); err != nil {
		return account.Credential{}, err
	}
	return values[0], nil
}

// GetCredentialMaterial hydrates the encrypted provider data for one account
// after routing has selected it. Routing candidate queries intentionally never
// load these encrypted columns.
func (r *AccountRepository) GetCredentialMaterial(ctx context.Context, accountID uint64, provider account.Provider) (account.CredentialMaterial, error) {
	var row accountCredentialModel
	if err := r.db.db.WithContext(ctx).
		Table("account_credentials AS credential").
		Select("credential.*").
		Joins("JOIN provider_accounts AS account ON account.id = credential.account_id").
		Where("credential.account_id = ? AND account.provider = ? AND account.enabled = TRUE AND account.auth_status = ?", accountID, provider, account.AuthStatusActive).
		Take(&row).Error; err != nil {
		return account.CredentialMaterial{}, mapError(err)
	}
	return toCredentialMaterialDomain(row, provider), nil
}
