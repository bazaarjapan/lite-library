# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A library management system (図書館管理システム) built as a Google Apps Script (GAS) web app. All UI text, comments, and data values are in Japanese. There is no build step, linter, or test framework — code is deployed to Google Apps Script via clasp.

## Commands

```sh
clasp push          # Upload local files to the Apps Script project
clasp pull          # Download remote changes
clasp open-script   # Open the project in the Apps Script editor
clasp deploy        # Create a new web app deployment
node --check コード.js  # Verify syntax locally before pushing (the only local check)
```

The script ID is in `.clasp.json`. Manual test helpers exist in コード.js (`testUserDatabase_`, `testGetUserDetails_`) and are run from the Apps Script editor, not locally (trailing underscore hides them from `google.script.run`).

## Architecture

**Server:** the entire backend lives in a single file, `コード.js` (~4,400 lines of standalone functions). `doGet(e)` is the entry point: it maps the `?page=` URL parameter (e.g. `checkout`, `return`, `register`, `overdue`) to an HTML file name via a switch statement. **Adding a new page requires both a new HTML file and a new case in `doGet`.**

**Client:** each `*.html` file is a mostly self-contained page (inline CSS and JS). Pages are served via `HtmlService.createTemplateFromFile(page).evaluate()`, so scriptlets work; shared partials are pulled in with `<?!= includeHtml_('...'); ?>`: `responsive_scale.html` (included in every page's `<head>`; on wide screens — iPad 768px+, PC 1024px+ — it applies `body { zoom }` to shrink the phone-tuned px sizes, leaving smartphone rendering untouched) and `barcode_scanner.html`. The latter exposes `window.LiteLibraryBarcodeScanner` (`configure` / `open` / `close` / `switchCamera`) — pages call `configure({contexts, onScan, ...})` rather than implementing their own QuaggaJS scanner. Pages call server functions with `google.script.run.withSuccessHandler(...).withFailureHandler(...).functionName(args)`. `doGet` uses `XFrameOptionsMode.DEFAULT` (embedding restricted to Google's own wrappers; CDN library loading is unrelated to this setting). In-app links use `getWebAppUrl()`, which rewrites the deployment URL to the domain-scoped form (`/a/macros/bazaarjapan.com/s/...`) so Google Workspace accounts don't hit 404s.

**Data store:** the container-bound Google Spreadsheet is the database (`SpreadsheetApp.getActiveSpreadsheet()`). Sheets are looked up by hard-coded Japanese names:

- `書籍DB` — books, one row per physical copy: 管理番号 (management number, col A, the unique copy ID), ISBN (B), 書籍名 (C), ..., 状態 (G: `在庫` or `貸出中`). Multiple copies of the same ISBN share the ISBN but have distinct management numbers.
- `利用者DB` — registered users, keyed by user ID.
- `貸出記録` — lending log; columns: 書籍ID, 書籍名, 利用者ID, 利用者名, 貸出日時, 返却予定日, 返却状況 (`未返却` / returned). Returns update this sheet and flip the book's status in 書籍DB.
- `設定DB` — key/value settings (e.g. lending period in days), read via `getLibrarySettings()`.

Column positions and header names are hard-coded as array indices throughout コード.js; several functions detect old vs. new data layouts by checking whether `data[0][0] === "管理番号"`. Changing a sheet's column order breaks many functions.

**Conventions in コード.js:**
- "書籍ID" (bookId) may be either a 管理番号 or an ISBN; `getBookDetails` (and bulk lending) resolve both.
- **Locking:** every public mutating function is a thin wrapper that calls a private `xxx_()` implementation through `runWithScriptLock_(operation, busyResult)`. New mutating functions must follow this pattern (the trailing-underscore name also hides the implementation from `google.script.run`). Pass an `Error` as `busyResult` for functions whose failure contract is throwing.
- **Return shape:** mutating functions return `{success: boolean, message: string, ...}`; clients branch on `response.success` (never on message text). Return-heavy functions also include `logs`, `successCount`, etc.
- **Sheet lookups:** use the TextFinder helpers — `findRowByValue_(sheet, col, value, {matchCase})` for unique IDs (fast path + trimmed-scan fallback) and `findRowsByValue_` for all matches (always a single-column trimmed scan). Avoid `getDataRange().getValues()` full scans in per-transaction paths; bulk operations read the sheet once up front.
- **Validation:** shared helpers `isValidIsbn_` (ISBN-10 format / ISBN-13 checksum), `validateRequired_`, `isValidEmail_` are applied server-side in registration paths.
- **No Date objects across `google.script.run`:** a raw `Date` anywhere in a return value makes the call fail silently (neither success nor failure handler fires — the page hangs on its loading message). Convert date cells read via `getValues()` with `toIsoString_(value)` at the return boundary; clients parse with `new Date(str)`. Conversely, `Utilities.formatDate` accepts only `Date` — wrap ISO strings in `new Date(...)` first (see `createOverdueReport` / `createHistoryReport` / `createInventoryReport`).
- Book metadata for registration is fetched by `fetchBookInfo` via `UrlFetchApp`: openBD first (`fetchBookInfoFromOpenBd_`), falling back to the Google Books API (`fetchBookInfoFromGoogleBooks_`) only when openBD has no hit.

**Operational features (run from the spreadsheet's 管理メニュー, defined in `onOpen`):**
- `setupLibrarySystem` — idempotent initial setup: creates the 4 sheets with correct headers on a blank spreadsheet; never overwrites existing data.
- `sendOverdueNotifications` — overdue email notifications; dedupes via a `最終通知日` column (located by header name, col ≥ I) and respects the daily MailApp quota. `installOverdueTrigger`/`removeOverdueTrigger` manage a daily 9:00 time-driven trigger (needs the `script.scriptapp` OAuth scope in appsscript.json).
- `backupReturnedData` — archives returned rows to another spreadsheet; header-compatibility checks protect against appending to mismatched sheets and never clear existing backups.

**Deployment config (`appsscript.json`):** web app runs as the deploying user with `DOMAIN` access (bazaarjapan.com Google accounts only — protects 利用者DB PII from anonymous access; server functions are otherwise directly callable via `google.script.run`); timezone is Asia/Tokyo; V8 runtime. Never return more PII than the client actually renders (e.g. `getUserInfo` returns only `{name}`).

## Development workflow

Loop engineering against GitHub (`bazaarjapan/lite-library`): file an issue with goals and labels → branch `issue-N-<topic>` → implement → PR → request review by commenting `@codex review` → address findings and re-request until Codex replies "Didn't find any major issues" (posted as an issue comment) → squash-merge. Verify syntax locally with `node --check コード.js` before pushing.
