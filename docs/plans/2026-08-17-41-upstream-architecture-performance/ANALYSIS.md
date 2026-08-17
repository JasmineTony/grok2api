# Architecture and performance audit

- Date: 2026-08-17
- Branch: `fix/account-request-parity-20260817`
- Current commit: `5cafe69cc772f7ba7cfbb1d0ee354236cc40aa9e`
- Fork main: `094d9a58967a4ee4295bb1343dcc7a29edc017fd`
- Upstream main: `f42ba1765fa520c6a587387daf8b22612168b397`

## Confirmed problems

### P1: Current upstream media contracts are not integrated

Seven upstream commits after `f06d6fe79fd51b002b3a25b2f0be7532a455a298` update current Grok media behavior:

- Image edits now use `mediaGenInput.imageToImage.inputAssets` with the exact `fileMetadataId`.
- Basic Web accounts can use the confirmed 720p video quota product.
- Imagine model aliases, generation parameters, quota resets, and catalog reconciliation changed.
- Mid-stream transport cuts use a short soft cooldown instead of an exponential account failure cooldown.
- Soft cooldown persistence now distinguishes the previous failure baseline from the next hard-failure count.

Leaving these commits unreviewed would preserve known protocol drift and incorrect quota or health behavior.

### P2: Video status polling opens a media body only to prove existence

`gateway.Service.GetVideo` calls `OpenVideo`, receives an `io.ReadCloser`, and immediately closes it. This makes every completed-job status poll allocate a reader and open a file descriptor even though no content is read.

The media boundary lacks a metadata/existence inspection operation, forcing status checks through a content-reading API.

### P2: Video input preflight opens every local input body

`validateVideoInputReferences` calls `OpenInputAsset` and immediately closes the body. The worker later calls `OpenInputAsset` again to materialize the same input.

The create path needs metadata, expiry, kind, size, and object existence only. Reusing the content-opening API causes avoidable file descriptor churn and obscures the distinction between inspection and materialization.

### P2: Accounts query invalidation is overly broad and duplicated

The accounts list, summary, state history, and mutation previews share the `["accounts", ...]` prefix. Mutations invalidate `["accounts"]` and then invalidate `["accounts", "summary"]` again.

Consequences:

- summary invalidation is duplicated;
- state-history and preview queries can refetch after unrelated list mutations;
- query-key structure is repeated as untyped string arrays across several files.

### P3: Large orchestration files hide boundaries

- `frontend/src/features/accounts/use-accounts-page-controller.ts` combines filters, queries, dialogs, imports, bulk tasks, and mutations.
- `backend/internal/application/account/service.go` and gateway/provider files remain large.

This iteration will not split large files only to reduce line count. It will first extract stable query-key and media-inspection boundaries that reduce coupling and measurable runtime work.

## Selected implementation

1. Integrate and reconcile upstream `f42ba176`.
2. Add media asset inspection operations and use them for video polling and input preflight.
3. Centralize Accounts query keys and narrow list/summary invalidation.
4. Add focused tests proving polling/preflight do not open bodies and query keys remain separated.

## Deferred work

- Splitting the account application service by use case.
- Migrating video retry account scope into the persisted job model.
- Broad visual redesign or route restructuring.
- Live provider calls requiring credentials.
