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
```

The script ID is in `.clasp.json`. Manual test helpers exist in コード.js (`testUserDatabase`, `testGetUserDetails`) and are run from the Apps Script editor, not locally.

## Architecture

**Server:** the entire backend lives in a single file, `コード.js` (~3,500 lines of standalone functions). `doGet(e)` is the entry point: it maps the `?page=` URL parameter (e.g. `checkout`, `return`, `register`, `overdue`) to an HTML file name via a switch statement. **Adding a new page requires both a new HTML file and a new case in `doGet`.**

**Client:** each `*.html` file is a fully self-contained page (inline CSS and JS, no shared templates or includes). Pages call server functions with `google.script.run.withSuccessHandler(...).withFailureHandler(...).functionName(args)`. Barcode scanning (ISBN / user cards) uses QuaggaJS loaded from a CDN, which is why `doGet` sets `XFrameOptionsMode.ALLOWALL`.

**Data store:** the container-bound Google Spreadsheet is the database (`SpreadsheetApp.getActiveSpreadsheet()`). Sheets are looked up by hard-coded Japanese names:

- `書籍DB` — books, one row per physical copy: 管理番号 (management number, col A, the unique copy ID), ISBN (B), 書籍名 (C), ..., 状態 (G: `在庫` or `貸出中`). Multiple copies of the same ISBN share the ISBN but have distinct management numbers.
- `利用者DB` — registered users, keyed by user ID.
- `貸出記録` — lending log; columns: 書籍ID, 書籍名, 利用者ID, 利用者名, 貸出日時, 返却予定日, 返却状況 (`未返却` / returned). Returns update this sheet and flip the book's status in 書籍DB.
- `設定DB` — key/value settings (e.g. lending period in days), read via `getLibrarySettings()`.

Column positions and header names are hard-coded as array indices throughout コード.js; several functions detect old vs. new data layouts by checking whether `data[0][0] === "管理番号"`. Changing a sheet's column order breaks many functions.

**Conventions in コード.js:**
- "書籍ID" (bookId) may be either a 管理番号 or an ISBN; `getBookDetails` resolves both.
- Mutating functions return either a result object `{success, message}` or a plain string message (`貸出登録成功: ...` / `登録失敗: ...`) — match the pattern of the specific function you're extending, since the HTML page's success handler parses that shape.
- Book metadata for registration is fetched from the Google Books API (`fetchBookInfo`) via `UrlFetchApp`.

**Deployment config (`appsscript.json`):** web app runs as the deploying user with `ANYONE_ANONYMOUS` access; timezone is Asia/Tokyo; V8 runtime.
