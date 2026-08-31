# Transaction Sync Design

## Goal

Prevent transactions from being lost or overwritten when multiple iPads use the POS at the same time, while keeping the current free Render deployment and JSON storage.

The checkout workflow, reports, product data, and existing sales history remain compatible.

## Constraints

- Keep the Render service on the free plan.
- Keep `data/cloud-storage.json`; do not add a paid database or persistent disk.
- Keep the existing Google Drive backup and restore mechanism.
- Allow checkout while the network is unavailable.
- Preserve existing transactions without a migration step.
- Continue requiring the Render URL or iPad app for cloud sync. A `file://` page remains local-only.

## Architecture

The browser stores the completed sale locally first, then records an operation in a persistent pending queue. The queue is flushed to Render one operation at a time. Render applies each operation by transaction ID instead of replacing an entire business day's sales.

The existing `/api/storage` API remains for products, categories, settings, daily sheets, and backward compatibility. New clients no longer write `pos-sales` through the whole-value storage endpoint during ordinary checkout or deletion.

## API

### Upsert a sale

`PUT /api/sales/:id`

Request body is one complete sale object. The path ID must match `sale.id`. The server validates the required structure and then:

- replaces the existing sale with the same ID; or
- appends the sale when the ID is new.

Repeating the same request is safe and does not create duplicates.

### Delete a sale

`DELETE /api/sales/:id`

The server removes only the sale with that ID. Repeating a delete for an already missing sale still succeeds.

### Read shared state

`GET /api/storage` remains unchanged and continues returning the full sales history under `pos-sales`.

## Local Pending Queue

The browser stores pending operations under `pos-pending-sale-ops` in `localStorage`.

Each operation contains:

- a unique operation ID;
- `upsert` or `delete`;
- the sale ID;
- the complete sale for an upsert;
- the time the operation was created.

On checkout, the sale is added to `pos-sales` and an upsert operation is added to the queue before the cart is cleared. On deletion, the local sale is removed and a delete operation is queued.

The browser flushes the queue:

- immediately after checkout or deletion;
- every five seconds;
- when the app initializes;
- when the browser reports that it is online again.

An operation is removed only after Render confirms success. Failed operations remain available after closing and reopening the app.

## Pull And Merge Rules

Cloud refresh must not overwrite pending local changes.

After downloading shared state:

1. Start with the cloud sales list.
2. Apply pending upserts by sale ID.
3. Apply pending deletes by sale ID.
4. Keep the merged current-day list in `state.sales` and local storage.
5. Keep the full merged history in `state.historySales` for reports.

This allows other iPads' completed sales to appear locally without erasing operations that this device has not uploaded yet.

## Sync Status

Add a compact status indicator to the checkout cart heading:

- `已同步`: the pending queue is empty and the latest request succeeded;
- `同步中`: operations are currently being uploaded;
- `尚未同步 N 筆`: the queue contains pending operations;
- `離線 N 筆`: the browser is offline and operations are waiting.

The indicator is informational and never blocks checkout.

## Other Shared Data

Products, categories, settings, daily sheet values, daily card order, and delivery rows continue using the existing key-value storage API. Their behavior is outside this change.

## Google Drive Backup

Every successful server write still calls `writeDb`, which schedules the existing Google Drive backup. No paid Render service is added.

This design reduces multi-device overwrite risk but does not make Render's free disk permanent. Google Drive backup configuration and restore must remain enabled and should be checked separately through `/api/backup-status` after login.

## Validation And Errors

The server rejects malformed sale payloads with HTTP 400 and does not modify the data file. Authentication behavior remains unchanged.

The client treats HTTP 401 as an expired login and opens the login page. Network errors and other server errors keep the operation queued for retry. The POS does not report a sale as cloud-synced until the server confirms it.

## Tests

Automated tests cover:

- two different iPads upserting different sales without overwriting each other;
- repeating an upsert without creating a duplicate;
- deleting exactly one sale by ID;
- repeating a delete safely;
- pending operations surviving a failed upload;
- cloud refresh merging pending upserts and deletes;
- existing `pos-sales` history remaining readable;
- other key-value storage behavior remaining unchanged.

Manual verification covers the checkout status indicator at iPad landscape size and confirms that checkout, deletion, daily reports, and monthly reports still render correctly.

## Rollout

Deploy the compatible server and client together. The new API reads and updates the existing `pos-sales` array, so no data migration or downtime is required. The legacy whole-day merge endpoint remains available during rollout but is no longer used by the updated client for sales.
