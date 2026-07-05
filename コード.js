/**
 * シート構成の一元定義。
 * シート名・ヘッダー・列インデックスはここが唯一の定義であり、
 * setupLibrarySystem / registerBook_ / migrateBookDbLayout_ などのヘッダー生成と
 * validateSchema_ の検証はすべてこの定数を参照する。
 * 列の並びはコード全体でハードコードされた列インデックスと一致させる必要が
 * あるため、列を追加する場合は必ず末尾に追加すること。
 * (貸出記録の「最終通知日」列だけは例外的にヘッダー名でI列以降から動的に検索される)
 */
const SCHEMA = {
  "書籍DB": {
    headers: ["管理番号", "書籍ID(ISBN)", "書籍名", "著者名", "出版社", "備考", "状態"],
    col: { 管理番号: 0, ISBN: 1, 書籍名: 2, 著者名: 3, 出版社: 4, 備考: 5, 状態: 6 }
  },
  "利用者DB": {
    // 状態: 空または「有効」= 有効 / 「削除済み」= 論理削除(行は残し、貸出記録との参照を守る)
    headers: ["利用者ID", "氏名", "メールアドレス", "電話番号", "住所", "登録日", "状態"],
    col: { 利用者ID: 0, 氏名: 1, メールアドレス: 2, 電話番号: 3, 住所: 4, 登録日: 5, 状態: 6 }
  },
  "貸出記録": {
    headers: ["書籍ID", "書籍名", "利用者ID", "利用者名", "貸出日時", "返却予定日", "返却状況", "返却日時"],
    col: { 書籍ID: 0, 書籍名: 1, 利用者ID: 2, 利用者名: 3, 貸出日時: 4, 返却予定日: 5, 返却状況: 6, 返却日時: 7 }
  },
  "設定DB": {
    headers: ["設定項目", "設定値", "説明", "更新日時"],
    col: { 設定項目: 0, 設定値: 1, 説明: 2, 更新日時: 3 }
  },
  "予約DB": {
    // 書籍ID: 本にISBNがあれば正規化ISBN、なければ管理番号(複本のどのコピーが
    // 返却されても予約に反応させるため)。照合は常に「管理番号 or そのISBN」の両方で行う
    // 状態: 予約中 / 貸出済 / 取消
    headers: ["予約ID", "書籍ID", "書籍名", "利用者ID", "利用者名", "予約日時", "状態", "処理日時"],
    col: { 予約ID: 0, 書籍ID: 1, 書籍名: 2, 利用者ID: 3, 利用者名: 4, 予約日時: 5, 状態: 6, 処理日時: 7 }
  }
};

/**
 * WebアプリケーションとしてアクセスされたときにHTMLを表示する関数
 * @param {Object} e - イベントオブジェクト
 * @return {HtmlOutput} HTMLサービスのアウトプット
 */
function doGet(e) {
  let page = 'menu'; // デフォルトはメニューページ
  let title = '図書館管理システム';
  
  if (e && e.parameter && e.parameter.page) {
    // URLパラメータに基づいてページを切り替え
    switch (e.parameter.page) {
      case 'checkout':
        page = 'lending';
        title = '図書貸出システム';
        break;
      case 'return':
        page = 'returning';
        title = '図書返却システム';
        break;
      case 'finder':
        page = 'rental_books_finder';
        title = '貸出書籍検索システム';
        break;
      case 'search':
        page = 'book_search';
        title = '蔵書検索';
        break;
      case 'reservations':
        page = 'reservations';
        title = '予約管理';
        break;
      case 'user_returns':
        page = 'user_returns';
        title = '利用者別返却システム';
        break;
      case 'register':
        page = 'book_register';
        title = '書籍登録システム';
        break;
      case 'user_register':
        page = 'user_register';
        title = '利用者登録システム';
        break;
      case 'card_issue':
        page = 'card_issue';
        title = '図書カード発行システム';
        break;
      case 'settings':
        page = 'settings';
        title = '図書館設定';
        break;
      case 'overdue':
        page = 'overdue_list';
        title = '延滞者リスト';
        break;
      case 'statistics':
        page = 'statistics';
        title = '貸出統計';
        break;
      case 'history':
        page = 'lending_history';
        title = '貸出履歴検索';
        break;
      case 'inventory':
        page = 'inventory';
        title = '書籍在庫管理';
        break;
      case 'user_edit':
        page = 'user_edit';
        title = '利用者情報編集';
        break;
      case 'book_edit':
        page = 'book_edit';
        title = '書籍情報編集';
        break;
      case 'labels':
        page = 'labels';
        title = 'バーコードラベル印刷';
        break;
      default:
        // デフォルトはメニューページのまま
        break;
    }
  }

  const htmlOutput = HtmlService.createTemplateFromFile(page).evaluate()
      .setTitle(title)
      // GASはページをGoogleのラッパー(iframe)内で配信するため、各HTML内の
      // <meta name="viewport">は効かない。ここで付与しないとスマホが約980pxの
      // デスクトップ仮想幅で描画し、メディアクエリが誤判定してUIが極小になる
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      // 外部サイトからの埋め込み(クリックジャッキング)を防ぐためGoogle標準の制限に戻す。
      // CDNからのライブラリ読み込み(QuaggaJS等)はこの設定と無関係で影響しない
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  return htmlOutput;
}

/**
 * HTMLテンプレートから共通部品を読み込む。
 * @param {string} filename - 読み込むHTMLファイル名
 * @return {string} HTML文字列
 */
function includeHtml_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * WebアプリのURLを取得する関数
 * @return {string} WebアプリのURL
 */
function getWebAppUrl() {
  const url = ScriptApp.getService().getUrl();
  const domain = 'bazaarjapan.com';

  if (!url) {
    return url;
  }

  // Google WorkspaceアカウントのChromeでは /macros/u/1/s/... に補正されて404になることがあるため、
  // 同じデプロイIDのドメイン付きURLをアプリ内リンクに使う。
  return url.replace(
    'https://script.google.com/macros/s/',
    `https://script.google.com/a/macros/${domain}/s/`
  );
}

/**
 * スクリプトロックを取得して処理を実行する共通ヘルパー
 * 貸出・返却・登録などスプレッドシートを更新する処理は、複数端末からの
 * 同時実行で二重貸出やデータ不整合が起きないよう、必ずこのヘルパー経由で実行する。
 * @param {Function} operation - ロック取得後に実行する処理
 * @param {*} busyResult - ロックを取得できなかった場合に呼び出し元へ返す値
 *                         (Error インスタンスを渡した場合は返さずに throw する)
 * @return {*} operation の戻り値、またはロック取得失敗時は busyResult
 */
function runWithScriptLock_(operation, busyResult) {
  const lock = LockService.getScriptLock();
  // 最大10秒待ってもロックが取れない場合は、他の処理が長時間実行中とみなして中断する
  if (!lock.tryLock(10000)) {
    console.warn("スクリプトロックを取得できませんでした。他の処理が実行中です。");
    if (busyResult instanceof Error) {
      throw busyResult;
    }
    return busyResult;
  }
  try {
    return operation();
  } finally {
    lock.releaseLock();
  }
}

/** ロック取得失敗時にユーザーへ返す共通メッセージ */
const LOCK_BUSY_MESSAGE = "他の貸出・返却処理が実行中です。しばらく待ってから再度お試しください。";

/**
 * ISBNの形式を検証する共通関数
 * ハイフン・空白を除去した上で、ISBN-10(9桁+数字またはX)または
 * ISBN-13(13桁・チェックディジット検証付き)として妥当か判定する。
 * @param {string} isbn - 検証するISBN
 * @return {boolean} 妥当なら true
 */
function isValidIsbn_(isbn) {
  const normalized = normalizeIsbn_(isbn);
  if (!normalized) return false;
  if (/^\d{9}[\dXx]$/.test(normalized)) {
    return true; // ISBN-10 (チェックディジットは形式のみ確認)
  }
  if (/^\d{13}$/.test(normalized)) {
    // ISBN-13 のチェックディジット検証
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(normalized[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return checkDigit === parseInt(normalized[12], 10);
  }
  return false;
}

/**
 * ISBNをAPI検索・保存に使いやすい形へ正規化する。
 * 全角数字・全角Xを半角にし、ハイフン・空白を除去する。
 * @param {string} isbn - ISBN
 * @return {string} 正規化したISBN
 */
function normalizeIsbn_(isbn) {
  if (!isbn) return "";
  return isbn.toString()
    .trim()
    .replace(/[０-９Ｘｘ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[-‐‑‒–—―ー－\s]/g, "")
    .toUpperCase();
}

/**
 * 必須項目の存在を検証する共通関数
 * @param {object} obj - 検証対象オブジェクト
 * @param {Object<string,string>} fields - {プロパティ名: 表示名} の対応
 * @return {string[]} 不足している項目の表示名の配列(不足なしなら空配列)
 */
function validateRequired_(obj, fields) {
  const missing = [];
  for (const [key, label] of Object.entries(fields)) {
    const value = obj ? obj[key] : null;
    if (value === undefined || value === null || value.toString().trim() === "") {
      missing.push(label);
    }
  }
  return missing;
}

/**
 * google.script.run の返却値に含める日付をISO文字列へ変換する共通ヘルパー
 * 返却値に生のDateオブジェクトが含まれるとシリアライズに失敗し、
 * クライアント側で成功・失敗どちらのハンドラも呼ばれず黙って失敗するため、
 * シートから getValues() で読んだ日付セルは必ずこの関数を通して返すこと。
 * @param {*} value - シートから読み込んだセル値
 * @return {string} Date なら ISO 8601 文字列、それ以外は文字列化した値(空値は "")
 */
function toIsoString_(value) {
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "" : value.toISOString();
  }
  return value === undefined || value === null ? "" : value.toString();
}

/**
 * メールアドレスの形式を簡易検証する共通関数
 * @param {string} email - 検証するメールアドレス
 * @return {boolean} 妥当なら true
 */
function isValidEmail_(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toString().trim());
}

/**
 * 指定シートの1列を完全一致で検索し、一致した行番号をすべて返す共通ヘルパー
 * getDataRange().getValues() による全行読み込みを避け、大量データでも高速に検索する。
 * @param {Sheet} sheet - 検索対象シート
 * @param {number} column - 検索する列(1始まり)
 * @param {string} value - 検索する値(完全一致)
 * @param {object} [options] - {matchCase: boolean} 大文字小文字を区別するか(デフォルト true)
 * @return {number[]} 一致した行番号(1始まり)の配列。ヘッダー行(1行目)は検索対象外
 */
function findRowsByValue_(sheet, column, value, options) {
  const opts = options || {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || value === undefined || value === null || value.toString().trim() === "") {
    return [];
  }
  // 全行が必要な検索では、前後空白付きのセルと正常なセルが混在していても漏れなく拾えるよう、
  // 常に対象1列を読み込んでトリム比較する(TextFinder の完全一致では空白付きの重複行を
  // 見逃すため。1列のみの読み込みなので getDataRange 全走査よりは十分軽い)
  const range = sheet.getRange(2, column, lastRow - 1, 1);
  return findRowsByTrimmedScan_(range, value.toString().trim(), opts.matchCase !== false);
}

/**
 * 1列分の値を読み込み、トリム後の完全一致で行番号を探すフォールバック検索
 * @param {Range} range - 検索対象の1列レンジ(2行目以降)
 * @param {string} searchValue - トリム済みの検索値
 * @param {boolean} matchCase - 大文字小文字を区別するか
 * @return {number[]} 一致した行番号(1始まり)の配列
 */
function findRowsByTrimmedScan_(range, searchValue, matchCase) {
  const values = range.getValues();
  const target = matchCase ? searchValue : searchValue.toLowerCase();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const cell = values[i][0];
    if (cell === "" || cell === null || cell === undefined) continue;
    let cellText = cell.toString().trim();
    if (!matchCase) cellText = cellText.toLowerCase();
    if (cellText === target) {
      rows.push(i + 2); // レンジは2行目開始
    }
  }
  return rows;
}

/**
 * ISBN列を正規化して検索し、ハイフン・空白・全角数字が混在する旧データにも一致させる。
 * @param {Sheet} sheet - 検索対象シート
 * @param {number} column - ISBNが入っている列(1始まり)
 * @param {string} isbn - 検索するISBN
 * @return {number[]} 一致した行番号(1始まり)の配列
 */
function findRowsByNormalizedIsbn_(sheet, column, isbn) {
  const normalized = normalizeIsbn_(isbn);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || !normalized) {
    return [];
  }

  const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    const cellIsbn = normalizeIsbn_(values[i][0]);
    if (cellIsbn && cellIsbn === normalized) {
      rows.push(i + 2);
    }
  }
  return rows;
}

/**
 * 指定シートの1列を完全一致で検索し、最初に一致した行番号を返す共通ヘルパー
 * @param {Sheet} sheet - 検索対象シート
 * @param {number} column - 検索する列(1始まり)
 * @param {string} value - 検索する値(完全一致)
 * @param {object} [options] - {matchCase: boolean} 大文字小文字を区別するか(デフォルト true)
 * @return {number} 一致した行番号(1始まり)。見つからなければ -1
 */
function findRowByValue_(sheet, column, value, options) {
  const opts = options || {};
  const lastRow = sheet.getLastRow();
  if (lastRow < 2 || value === undefined || value === null || value.toString().trim() === "") {
    return -1;
  }
  const searchValue = value.toString().trim();
  const range = sheet.getRange(2, column, lastRow - 1, 1);
  const found = range.createTextFinder(searchValue)
    .matchEntireCell(true)
    .matchCase(opts.matchCase !== false)
    .findNext();
  if (found) {
    return found.getRow();
  }
  // フォールバック: 前後空白が残っている旧データに対応(1列のみのトリム比較)
  const rows = findRowsByTrimmedScan_(range, searchValue, opts.matchCase !== false);
  return rows.length > 0 ? rows[0] : -1;
}

/**
 * 書籍DBが新レイアウト(A1=管理番号)かどうかを、A1セルのみ読み取って判定する
 * @param {Sheet} bookSheet - 書籍DBシート
 * @return {boolean} 新レイアウトなら true
 */
function isNewBookLayout_(bookSheet) {
  return bookSheet.getLastRow() > 0 && bookSheet.getRange(1, 1).getValue() === "管理番号";
}

/**
 * 利用可能な書籍を取得する関数（複数冊管理対応）
 * @param {string} isbn - ISBN
 * @return {object|null} 利用可能な書籍情報（在庫がある最初の本）
 */
function getAvailableBook(isbn) {
  if (!isbn) {
    console.error("ISBNが指定されていません。");
    return null;
  }
  const normalizedIsbn = normalizeIsbn_(isbn);
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    // ISBN(B列)を正規化して一致する行だけを取得し、その中から在庫のある本を探す
    const rowNumbers = findRowsByNormalizedIsbn_(bookSheet, 2, normalizedIsbn);
    for (const rowNumber of rowNumbers) {
      const row = bookSheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
      const status = row[6] || "在庫";
      if (status === "在庫") {
        const managementNum = row[0] || "";
        const storedIsbn = row[1] ? row[1].toString().trim() : normalizedIsbn;
        const bookTitle = row[2] || "タイトル不明";
        console.log(`利用可能な書籍発見: ${bookTitle} (管理番号: ${managementNum})`);
        return {
          title: bookTitle,
          managementNumber: managementNum,
          isbn: normalizeIsbn_(storedIsbn) || storedIsbn,
          status: status
        };
      }
    }

    console.log(`ISBN ${isbn} の利用可能な書籍が見つかりませんでした。`);
    return null;
  } catch (error) {
    console.error(`利用可能な書籍の検索中にエラーが発生しました: ${error}`);
    throw new Error(`書籍検索エラー: ${error.message}`);
  }
}

/**
 * 書籍ID（管理番号またはISBN）からスプレッドシートの書籍DBを検索して書籍情報を取得する関数
 * @param {string} bookId - 書籍ID（管理番号またはISBN）
 * @return {object|null} 書籍情報オブジェクト {title: string, managementNumber: string, isbn: string, status: string} または null
 */
/**
 * 貸出を延長する関数(公開ラッパー)
 * @param {string} bookId - 延長する貸出記録の書籍ID(管理番号)
 * @param {number} rowNumber - 貸出記録シートの行番号(1始まり)。同一管理番号の
 *                             未返却が重複する異常データでも、クリックした行だけを延長するため
 * @param {string} userId - クリックした記録の利用者ID(行ずれ検証用)
 * @param {string} lendingDate - クリックした記録の貸出日時(ISO文字列・行ずれ検証用)
 * @return {object} 処理結果 {success: boolean, message: string, newDueDate?: string}
 */
function renewLending(bookId, rowNumber, userId, lendingDate) {
  return runWithScriptLock_(
    () => renewLending_(bookId, rowNumber, userId, lendingDate),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

/**
 * 貸出延長の実装。未返却の貸出記録の返却予定日を
 * 「max(今日, 現在の返却予定日)+貸出期間」に更新する(延長は必ず期限を延ばす)。
 * - 延滞中(返却予定日が今日より前)は延長不可
 * - 「延長回数」列(ヘッダー名で特定・なければI列以降に追加)で回数を管理し、
 *   設定 maxRenewals(既定1、0以下で延長禁止)を超える延長を拒否する
 * - 延長成功時は「最終通知日」「リマインダー送信日」をクリアし、
 *   新しい期限に対して通知・リマインダーが再送されるようにする
 */
function renewLending_(bookId, rowNumber, userId, lendingDate) {
  try {
    const id = bookId ? bookId.toString().trim() : "";
    if (!id) {
      return { success: false, message: "書籍IDが指定されていません。" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) {
      throw new Error("貸出記録シートが見つかりません。");
    }

    // 設定から貸出期間と延長上限を取得
    let lendingDays = 14;
    let maxRenewals = 1;
    try {
      const settings = getLibrarySettings();
      if (settings && settings.lendingDays) {
        lendingDays = settings.lendingDays;
      }
      if (settings && settings.maxRenewals !== undefined && settings.maxRenewals !== "") {
        const m = Number(settings.maxRenewals);
        if (!isNaN(m)) {
          maxRenewals = Math.floor(m);
        }
      }
    } catch (e) {
      console.log("設定の取得に失敗したため、デフォルト値(貸出期間14日・延長上限1回)を使用します:", e);
    }
    if (maxRenewals <= 0) {
      return { success: false, message: "貸出延長は設定で無効になっています(maxRenewals=0)。" };
    }

    const data = lendingSheet.getDataRange().getValues();

    // 「延長回数」列をヘッダー名で特定する(最終通知日と同じ流儀。
    // H列=返却日時は予約済みのため最低でもI列以降に追加する)
    let renewCol = data.length > 0 ? data[0].indexOf("延長回数") + 1 : 0; // 1始まり
    if (renewCol === 0) {
      renewCol = Math.max((data.length > 0 ? data[0].length : 8) + 1, 9);
      if (data.length > 0 && (data[0].length < 8 || !data[0][7])) {
        lendingSheet.getRange(1, 8).setValue("返却日時");
      }
      lendingSheet.getRange(1, renewCol).setValue("延長回数");
    }

    // 対象行の特定。クライアントが行番号を持っている場合はそれを使い、
    // 書籍ID・未返却であることを検証する(同一管理番号の未返却が重複する
    // 異常データでも、クリックした行以外を延長しないため。行番号は返却処理や
    // アーカイブでずれることがあるので、検証に失敗したら再検索を促す)
    let targetIndex = -1;
    const parsedRowNumber = parseInt(rowNumber, 10);
    if (!isNaN(parsedRowNumber) && parsedRowNumber >= 2) {
      if (parsedRowNumber > data.length) {
        return { success: false, message: "貸出記録が更新されています。もう一度検索してから延長してください。" };
      }
      const candidate = data[parsedRowNumber - 1];
      const candidateId = candidate[0] ? candidate[0].toString().trim() : "";
      // 書籍ID+未返却だけでは、アーカイブ等の行ずれと重複未返却が重なった場合に
      // 別の行を誤って受理し得るため、利用者IDと貸出日時も照合する
      const candidateUserId = candidate[2] ? candidate[2].toString().trim().toLowerCase() : "";
      const expectedUserId = userId ? userId.toString().trim().toLowerCase() : "";
      const candidateLendingDate = (candidate[4] instanceof Date && !isNaN(candidate[4]))
        ? candidate[4].toISOString()
        : "";
      const expectedLendingDate = lendingDate ? lendingDate.toString().trim() : "";
      if (candidateId !== id || candidate[6] !== "未返却" ||
          (expectedUserId !== "" && candidateUserId !== expectedUserId) ||
          (expectedLendingDate !== "" && candidateLendingDate !== expectedLendingDate)) {
        return { success: false, message: "貸出記録が更新されています。もう一度検索してから延長してください。" };
      }
      targetIndex = parsedRowNumber - 1;
    } else {
      // 行番号なしの呼び出しは書籍ID(管理番号)で探す(未返却は本来1件のみ)
      for (let i = 1; i < data.length; i++) {
        if (data[i][6] === "未返却" && data[i][0] && data[i][0].toString().trim() === id) {
          targetIndex = i;
          break;
        }
      }
      if (targetIndex === -1) {
        return { success: false, message: `書籍ID ${id} の未返却の貸出記録が見つかりません。` };
      }
    }

    const row = data[targetIndex];

    // 予約が入っている本は延長不可(次の予約者を待たせないため)
    const reservationActives = loadActiveReservations_().actives;
    if (reservationActives.length > 0) {
      let bookIsbn = "";
      const bookSheet = ss.getSheetByName("書籍DB");
      if (bookSheet) {
        const bookRowNum = findRowByValue_(bookSheet, 1, id);
        if (bookRowNum !== -1) {
          const isbnValue = bookSheet.getRange(bookRowNum, 2).getValue();
          bookIsbn = isbnValue ? isbnValue.toString() : "";
        }
      }
      if (findReservationForBook_(reservationActives, id, bookIsbn)) {
        return { success: false, message: `「${row[1] || id}」は予約が入っているため延長できません。` };
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDateValue = row[5];
    // 延長の起点は「今日」と「現在の返却予定日」の遅い方にする
    // (今日起点だと、期限まで貸出期間ちょうど残っている本は延長しても期限が
    //  変わらず、期限がさらに先の本は逆に縮んでしまうため。延長は必ず期限を延ばす)
    let baseDate = today;
    if (dueDateValue instanceof Date && !isNaN(dueDateValue)) {
      const dueDate = new Date(dueDateValue);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate < today) {
        return { success: false, message: "返却期限を過ぎているため延長できません。いったん返却してください。" };
      }
      if (dueDate > baseDate) {
        baseDate = dueDate;
      }
    }

    const currentRenewals = row.length > renewCol - 1 ? (Number(row[renewCol - 1]) || 0) : 0;
    if (currentRenewals >= maxRenewals) {
      return { success: false, message: `延長は${maxRenewals}回までです(既に${currentRenewals}回延長済み)。` };
    }

    const newDueDate = new Date(baseDate.getTime() + lendingDays * 24 * 60 * 60 * 1000);
    lendingSheet.getRange(targetIndex + 1, 6).setValue(newDueDate);
    lendingSheet.getRange(targetIndex + 1, renewCol).setValue(currentRenewals + 1);

    // 旧期限に対する通知記録をクリアし、新期限で再送されるようにする
    ["最終通知日", "リマインダー送信日"].forEach(header => {
      const col = data.length > 0 ? data[0].indexOf(header) + 1 : 0;
      if (col > 0) {
        lendingSheet.getRange(targetIndex + 1, col).setValue("");
      }
    });

    const newDueStr = Utilities.formatDate(newDueDate, "Asia/Tokyo", "yyyy年MM月dd日");
    console.log(`貸出延長: 書籍ID ${id} の返却予定日を ${newDueStr} に更新(${currentRenewals + 1}回目)`);
    return {
      success: true,
      message: `「${row[1] || id}」の返却期限を${newDueStr}まで延長しました(${currentRenewals + 1}回目/最大${maxRenewals}回)。`,
      newDueDate: toIsoString_(newDueDate)
    };
  } catch (error) {
    console.error(`貸出延長中にエラーが発生しました: ${error}`);
    return { success: false, message: `貸出延長に失敗しました: ${error.message}` };
  }
}

/**
 * 予約DBシートを取得する(存在しない・空の場合はヘッダーを投入して作成する。冪等)。
 * @return {Sheet} 予約DBシート
 */
function ensureReservationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("予約DB");
  if (!sheet) {
    sheet = ss.insertSheet("予約DB");
  }
  if (sheet.getLastRow() === 0) {
    const headers = SCHEMA["予約DB"].headers;
    const headerRange = sheet.getRange(1, 1, 1, headers.length);
    headerRange.setValues([headers]);
    headerRange.setFontWeight("bold").setBackground("#f3f3f3");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 予約中の予約を行順(=予約順)に読み込む補助関数。
 * 予約DBシートが存在しない環境では actives が空になる(機能未使用としてスキップできる)。
 * @return {object} {sheet: Sheet|null, actives: Array<{rowNumber, reservationId, bookKey, bookTitle, userId, userName, reservedAt}>}
 */
function loadActiveReservations_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("予約DB");
  if (!sheet || sheet.getLastRow() < 2) {
    return { sheet: sheet, actives: [] };
  }
  const col = SCHEMA["予約DB"].col;
  const data = sheet.getDataRange().getValues();
  const actives = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][col.状態] === "予約中" && data[i][col.書籍ID]) {
      actives.push({
        rowNumber: i + 1,
        reservationId: data[i][col.予約ID] ? data[i][col.予約ID].toString().trim() : "",
        bookKey: data[i][col.書籍ID].toString().trim(),
        bookTitle: data[i][col.書籍名] ? data[i][col.書籍名].toString() : "",
        userId: data[i][col.利用者ID] ? data[i][col.利用者ID].toString().trim() : "",
        userName: data[i][col.利用者名] ? data[i][col.利用者名].toString() : "",
        reservedAt: data[i][col.予約日時]
      });
    }
  }
  return { sheet: sheet, actives: actives };
}

/**
 * 本(管理番号+ISBN)に一致する最先頭(最古)の予約中の予約を返す補助関数。
 * 予約キー規約: 予約DB.書籍ID は正規化ISBN(なければ管理番号)なので、両方で照合する。
 * @param {Array} actives - loadActiveReservations_ の actives
 * @param {string} managementNumber - 管理番号
 * @param {string} isbn - ISBN(未正規化でもよい・空可)
 * @return {object|null} 一致する予約、なければ null
 */
function findReservationForBook_(actives, managementNumber, isbn) {
  if (!actives || actives.length === 0) return null;
  const keys = [];
  if (managementNumber) {
    keys.push(managementNumber.toString().trim());
  }
  const normalized = isbn ? normalizeIsbn_(isbn) : "";
  if (normalized) {
    keys.push(normalized);
  }
  if (keys.length === 0) return null;
  for (const reservation of actives) { // 行順=予約順(最古優先)
    if (keys.indexOf(reservation.bookKey) !== -1) {
      return reservation;
    }
  }
  return null;
}

/**
 * 予約を登録する関数(公開ラッパー)
 * @param {string} bookId - 書籍ID(管理番号またはISBN)
 * @param {string} userId - 予約する利用者ID
 * @return {object} 処理結果 {success: boolean, message: string, reservationId?: string}
 */
function createReservation(bookId, userId) {
  return runWithScriptLock_(
    () => createReservation_(bookId, userId),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

/**
 * 予約登録の実装。
 * - 利用者が有効(削除済みでない)・本が存在(廃棄でない)ことを検証する
 * - 同一ISBNのコピーに在庫があれば予約せず貸出を案内する
 * - 同一キー×同一利用者の予約中重複を拒否する
 */
function createReservation_(bookId, userId) {
  try {
    const id = bookId ? bookId.toString().trim() : "";
    const uid = userId ? userId.toString().trim() : "";
    if (!id || !uid) {
      return { success: false, message: "書籍IDと利用者IDを指定してください。" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 利用者の検証(削除済みは不可)
    const userSheet = ss.getSheetByName("利用者DB");
    if (!userSheet) {
      throw new Error("利用者DBシートが見つかりません。");
    }
    const userRowNum = findRowByValue_(userSheet, 1, uid);
    if (userRowNum === -1) {
      return { success: false, message: `利用者ID ${uid} が見つかりません。` };
    }
    const userValues = userSheet.getRange(userRowNum, 1, 1, 7).getValues()[0];
    if ((userValues[6] || "").toString().trim() === "削除済み") {
      return { success: false, message: `利用者ID ${uid} が見つかりません。` };
    }
    const userName = userValues[1] ? userValues[1].toString() : "";

    // 本の特定(管理番号→ISBNの順)と検証
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }
    let bookRowNum = findRowByValue_(bookSheet, 1, id);
    const normalizedInputIsbn = isValidIsbn_(id) ? normalizeIsbn_(id) : "";
    if (bookRowNum === -1 && normalizedInputIsbn) {
      const isbnRows = findRowsByNormalizedIsbn_(bookSheet, 2, normalizedInputIsbn);
      // 廃棄(論理削除)済みのコピーは行順で先にあってもスキップし、有効なコピーを採用する
      for (const candidateRowNum of isbnRows) {
        const candidateStatus = (bookSheet.getRange(candidateRowNum, 7).getValue() || "").toString().trim();
        if (candidateStatus !== "廃棄") {
          bookRowNum = candidateRowNum;
          break;
        }
      }
      // 全コピーが廃棄の場合は先頭を採用し、後段の廃棄チェックで拒否させる
      if (bookRowNum === -1 && isbnRows.length > 0) {
        bookRowNum = isbnRows[0];
      }
    }
    if (bookRowNum === -1) {
      return { success: false, message: `書籍 ${id} が見つかりません。` };
    }
    const bookValues = bookSheet.getRange(bookRowNum, 1, 1, 7).getValues()[0];
    const managementNumber = bookValues[0] ? bookValues[0].toString().trim() : "";
    const isbn = bookValues[1] ? normalizeIsbn_(bookValues[1]) : "";
    const title = bookValues[2] ? bookValues[2].toString() : "";
    if ((bookValues[6] || "").toString().trim() === "廃棄") {
      return { success: false, message: `「${title}」は廃棄済みのため予約できません。` };
    }

    // 在庫チェック: 同一ISBNのいずれかのコピー(ISBNなしなら当該コピー)に在庫があれば予約不要。
    // 状態セルが空欄の行は他コード(貸出の status || "在庫" 等)と同様に在庫として扱う
    const normalizeBookStatus_ = value => {
      const status = (value === null || value === undefined) ? "" : value.toString().trim();
      return status === "" ? "在庫" : status;
    };
    let hasAvailableCopy = false;
    if (isbn) {
      const copyRows = findRowsByNormalizedIsbn_(bookSheet, 2, isbn);
      for (const rowNum of copyRows) {
        if (normalizeBookStatus_(bookSheet.getRange(rowNum, 7).getValue()) === "在庫") {
          hasAvailableCopy = true;
          break;
        }
      }
    } else {
      hasAvailableCopy = normalizeBookStatus_(bookValues[6]) === "在庫";
    }
    if (hasAvailableCopy) {
      return { success: false, message: `「${title}」は在庫があります。予約せずにそのまま貸出できます。` };
    }

    const reservationKey = isbn || managementNumber;
    const sheet = ensureReservationSheet_();
    const actives = loadActiveReservations_().actives;

    // 同一キー×同一利用者の重複予約を拒否
    const duplicate = actives.find(r =>
      r.bookKey === reservationKey && r.userId.toLowerCase() === uid.toLowerCase()
    );
    if (duplicate) {
      return { success: false, message: `「${title}」は既に ${userName} さんが予約中です(予約ID: ${duplicate.reservationId})。` };
    }
    const queuePosition = actives.filter(r => r.bookKey === reservationKey).length + 1;

    const reservationId = "R" + new Date().getTime();
    sheet.appendRow([reservationId, reservationKey, title, uid, userName, new Date(), "予約中", ""]);
    console.log(`予約登録: ${reservationId} 「${title}」 利用者 ${uid} (順番 ${queuePosition})`);
    return {
      success: true,
      message: `「${title}」を ${userName} さんの名前で予約しました(予約順: ${queuePosition}番目)。返却され次第、取り置きの案内が表示されます。`,
      reservationId: reservationId
    };
  } catch (error) {
    console.error(`予約登録中にエラーが発生しました: ${error}`);
    return { success: false, message: `予約登録に失敗しました: ${error.message}` };
  }
}

/**
 * 予約を取り消す関数(公開ラッパー)
 * @param {string} reservationId - 予約ID
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function cancelReservation(reservationId) {
  return runWithScriptLock_(
    () => cancelReservation_(reservationId),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function cancelReservation_(reservationId) {
  try {
    const id = reservationId ? reservationId.toString().trim() : "";
    if (!id) {
      return { success: false, message: "予約IDが指定されていません。" };
    }
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("予約DB");
    if (!sheet) {
      return { success: false, message: "予約DBシートが見つかりません。" };
    }
    const rowNum = findRowByValue_(sheet, 1, id);
    if (rowNum === -1) {
      return { success: false, message: `予約ID ${id} が見つかりません。` };
    }
    const col = SCHEMA["予約DB"].col;
    const rowValues = sheet.getRange(rowNum, 1, 1, SCHEMA["予約DB"].headers.length).getValues()[0];
    if (rowValues[col.状態] !== "予約中") {
      return { success: false, message: `この予約は既に処理済みです(状態: ${rowValues[col.状態]})。` };
    }
    sheet.getRange(rowNum, col.状態 + 1).setValue("取消");
    sheet.getRange(rowNum, col.処理日時 + 1).setValue(new Date());
    const title = rowValues[col.書籍名] ? rowValues[col.書籍名].toString() : id;
    console.log(`予約取消: ${id} 「${title}」`);
    return { success: true, message: `「${title}」の予約を取り消しました。` };
  } catch (error) {
    console.error(`予約取消中にエラーが発生しました: ${error}`);
    return { success: false, message: `予約取消に失敗しました: ${error.message}` };
  }
}

/**
 * 予約中の一覧を取得する関数(読み取り専用・予約管理ページ用)
 * @return {object} {success: boolean, message: string, reservations: Array<object>}
 */
function getActiveReservations() {
  try {
    const actives = loadActiveReservations_().actives;
    return {
      success: true,
      message: actives.length === 0 ? "予約中の本はありません。" : `${actives.length}件の予約があります。`,
      reservations: actives.map(r => ({
        reservationId: r.reservationId,
        bookKey: r.bookKey,
        bookTitle: r.bookTitle,
        userId: r.userId,
        userName: r.userName,
        reservedAt: (r.reservedAt instanceof Date && !isNaN(r.reservedAt)) ? r.reservedAt.toISOString() : ""
      }))
    };
  } catch (error) {
    console.error(`予約一覧の取得中にエラーが発生しました: ${error}`);
    return { success: false, message: `予約一覧の取得に失敗しました: ${error.message}`, reservations: [] };
  }
}

/**
 * 返却された本に予約が入っていれば取り置き案内を作り、予約者へ入荷メールを送る補助関数。
 * 予約の状態は変更しない(貸出成立時に processBulkLending_ が「貸出済」へ更新する)。
 * メールはベストエフォート(enableEmail=false・アドレス未登録・クォータ枯渇時はスキップ)。
 * @param {Array<string>} returnedBookIds - 返却された管理番号の配列
 * @return {Array<string>} 結果メッセージへ追記する案内文の配列
 */
function buildReservationNoticesForReturns_(returnedBookIds) {
  try {
    if (!returnedBookIds || returnedBookIds.length === 0) return [];
    const { actives } = loadActiveReservations_();
    if (actives.length === 0) return [];

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    const notices = [];
    const noticedReservationIds = new Set(); // 同一返却処理内の重複案内を防ぐ
    let settings = null;
    let emailByUserId = null; // 必要になったときだけ利用者DBを読む

    returnedBookIds.forEach(bookId => {
      const trimmedId = bookId ? bookId.toString().trim() : "";
      if (!trimmedId) return;
      let isbn = "";
      if (bookSheet) {
        const rowNum = findRowByValue_(bookSheet, 1, trimmedId);
        if (rowNum !== -1) {
          const value = bookSheet.getRange(rowNum, 2).getValue();
          isbn = value ? value.toString() : "";
        }
      }
      const reservation = findReservationForBook_(actives, trimmedId, isbn);
      if (!reservation || noticedReservationIds.has(reservation.reservationId)) return;
      noticedReservationIds.add(reservation.reservationId);
      notices.push(`⚠ 「${reservation.bookTitle}」は ${reservation.userName} さん(ID: ${reservation.userId})が予約中です。取り置きしてください。`);

      // 予約者への入荷メール(ベストエフォート)
      try {
        if (settings === null) {
          try {
            settings = getLibrarySettings();
          } catch (e) {
            settings = {};
          }
        }
        if (settings.enableEmail === false) return;
        if (emailByUserId === null) {
          emailByUserId = {};
          const userSheet = ss.getSheetByName("利用者DB");
          if (userSheet) {
            const userData = userSheet.getDataRange().getValues();
            for (let i = 1; i < userData.length; i++) {
              const rowUserId = userData[i][0] ? userData[i][0].toString().trim().toLowerCase() : "";
              const email = userData[i][2] ? userData[i][2].toString().trim() : "";
              if (rowUserId && email) {
                emailByUserId[rowUserId] = email;
              }
            }
          }
        }
        const email = emailByUserId[reservation.userId.toLowerCase()];
        if (!email || MailApp.getRemainingDailyQuota() <= 0) return;
        const libraryName = settings.libraryName || "図書館";
        MailApp.sendEmail({
          to: email,
          subject: `【${libraryName}】ご予約の本が返却されました`,
          body: `${reservation.userName} 様\n\n` +
            `${libraryName}をご利用いただきありがとうございます。\n` +
            `ご予約中の以下の本が返却されました。取り置きしていますので、お早めにお越しください。\n\n` +
            `書籍名: ${reservation.bookTitle}\n\n` +
            `${libraryName}`
        });
        console.log(`予約入荷メール送信: ${reservation.userId} (${email}) - ${reservation.bookTitle}`);
      } catch (mailError) {
        console.error(`予約入荷メールの送信に失敗しました: ${mailError}`);
      }
    });

    return notices;
  } catch (error) {
    // 予約案内の失敗で返却処理自体を失敗にしない
    console.error(`予約案内の作成中にエラーが発生しました: ${error}`);
    return [];
  }
}

/**
 * 蔵書を横断検索する関数(読み取り専用)。
 * 管理番号・ISBN・書籍名・著者名・出版社の部分一致(大文字小文字無視)で検索する。
 * ISBNはハイフン有無を正規化して照合し、廃棄済みの本は結果から除外する。
 * 貸出中の本には貸出記録(未返却)の返却予定日を付与する。
 * @param {string} query - 検索語
 * @return {object} {success: boolean, message: string, results: Array<object>}
 *                  results要素: {managementNumber, isbn, title, author, publisher, status, dueDate(ISO文字列または空)}
 */
function searchCatalog(query) {
  const SEARCH_LIMIT = 100;
  try {
    const q = query ? query.toString().trim() : "";
    if (!q) {
      return { success: false, message: "検索語を入力してください。", results: [] };
    }
    const qLower = q.toLowerCase();
    const qIsbn = isValidIsbn_(q) ? normalizeIsbn_(q) : "";

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    // 貸出中の返却予定日: 貸出記録の未返却行から 管理番号→返却予定日 を引けるようにする
    const lendingSheet = ss.getSheetByName("貸出記録");
    const dueByBookId = new Map();
    if (lendingSheet) {
      const lendingData = lendingSheet.getDataRange().getValues();
      for (let i = 1; i < lendingData.length; i++) {
        if (lendingData[i][6] === "未返却" && lendingData[i][0]) {
          dueByBookId.set(lendingData[i][0].toString().trim(), lendingData[i][5]);
        }
      }
    }

    // 検索は全文一致条件が自由(部分一致・複数列)のため一括読み込みで走査する
    // (per-transactionの単一ID検索ではないので TextFinder のfast pathは使えない)
    const data = bookSheet.getDataRange().getValues();
    const results = [];
    let truncated = false;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const managementNumber = row[0] ? row[0].toString().trim() : "";
      if (!managementNumber) continue;
      const status = row[6] ? row[6].toString().trim() : "在庫";
      if (status === "廃棄") continue; // 論理削除済みは蔵書として扱わない

      const isbn = row[1] ? row[1].toString().trim() : "";
      const haystack = [managementNumber, isbn, row[2], row[3], row[4]]
        .map(v => (v === null || v === undefined) ? "" : v.toString())
        .join("\n")
        .toLowerCase();
      const isbnNormalized = normalizeIsbn_(isbn);
      const hit = haystack.indexOf(qLower) !== -1 ||
        (qIsbn !== "" && isbnNormalized !== "" && isbnNormalized === qIsbn);
      if (!hit) continue;

      if (results.length >= SEARCH_LIMIT) {
        truncated = true;
        break;
      }
      const dueDateValue = dueByBookId.get(managementNumber);
      results.push({
        managementNumber: managementNumber,
        isbn: isbn,
        title: row[2] ? row[2].toString() : "",
        author: row[3] ? row[3].toString() : "",
        publisher: row[4] ? row[4].toString() : "",
        // G列が更新漏れでも未返却の貸出記録があれば貸出中として表示する
        status: dueByBookId.has(managementNumber) ? "貸出中" : status,
        dueDate: dueDateValue ? toIsoString_(dueDateValue) : ""
      });
    }

    const message = results.length === 0
      ? `「${q}」に一致する蔵書は見つかりませんでした。`
      : `${results.length}件見つかりました。` + (truncated ? `(該当が多いため先頭${SEARCH_LIMIT}件のみ表示。検索語を絞り込んでください)` : "");
    return { success: true, message: message, results: results };
  } catch (error) {
    console.error(`蔵書検索中にエラーが発生しました: ${error}`);
    return { success: false, message: `蔵書検索に失敗しました: ${error.message}`, results: [] };
  }
}

function getBookDetails(bookId) {
  if (!bookId) {
    console.error("書籍IDが指定されていません。");
    return null;
  }
  const normalizedInputIsbn = isValidIsbn_(bookId) ? normalizeIsbn_(bookId) : "";
  console.log(`書籍情報検索開始: 書籍ID=${bookId}`);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      console.error("シート「書籍DB」が見つかりません。");
      throw new Error("書籍DBシートが見つかりません。");
    }

    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    // A:管理番号, B:ISBN, C:書籍名, D:著者名, E:出版社, F:備考, G:状態
    // TextFinderで管理番号(A列)→ISBN(B列)の順に検索し、全行読み込みを避ける
    let rowNumber = findRowByValue_(bookSheet, 1, bookId);
    if (rowNumber === -1 && normalizedInputIsbn) {
      const isbnRows = findRowsByNormalizedIsbn_(bookSheet, 2, normalizedInputIsbn);
      rowNumber = isbnRows.length > 0 ? isbnRows[0] : -1;
    }
    if (rowNumber !== -1) {
      const row = bookSheet.getRange(rowNumber, 1, 1, 7).getValues()[0];
      const managementNum = row[0] ? row[0].toString().trim() : "";
      const isbn = row[1] ? row[1].toString().trim() : "";
      const bookTitle = row[2] || "タイトル不明";
      const status = row[6] || "在庫";
      console.log(`書籍情報取得成功: ${bookTitle} (管理番号: ${managementNum}, 状態: ${status})`);
      return {
        title: bookTitle,
        managementNumber: managementNum,
        isbn: isbn,
        status: status
      };
    }

    console.warn(`書籍ID ${bookId} の情報が見つかりませんでした。`);
    return null;
  } catch (error) {
    console.error(`書籍情報の取得中にエラーが発生しました: ${error}`);
    console.error(error);
    throw new Error(`書籍情報の取得に失敗しました: ${error.message}`);
  }
}


/**
 * 利用者IDからスプレッドシートの利用者DBを検索して利用者情報を取得する関数
 * @param {string} userId - 利用者ID
 * @return {object|null} 利用者情報オブジェクト {name: string} または null
 */
function getUserInfo(userId) {
  if (!userId) {
    console.error("利用者IDが指定されていません。");
    return null;
  }
   console.log(`利用者情報検索開始: UserID=${userId}`);
   try {
     const ss = SpreadsheetApp.getActiveSpreadsheet();
     const userSheet = ss.getSheetByName("利用者DB"); // "利用者DB"シートを指定
     if (!userSheet) {
       console.error("シート「利用者DB」が見つかりません。");
       throw new Error("利用者DBシートが見つかりません。"); // エラーをスローしてクライアントに伝える
     }

    // ヘッダー: A:利用者ID, B:氏名, C:メールアドレス
    // TextFinderでA列を検索(既存挙動に合わせて大文字小文字は無視)
    const rowNumber = findRowByValue_(userSheet, 1, userId, { matchCase: false });
    if (rowNumber !== -1) {
      // 既存シートが6列(状態列なし)の場合に範囲外エラーにならないよう実列数でクランプする
      const row = userSheet.getRange(rowNumber, 1, 1, Math.min(SCHEMA["利用者DB"].headers.length, userSheet.getMaxColumns())).getValues()[0];
      // 論理削除された利用者は「見つからない」扱いにする
      if ((row[SCHEMA["利用者DB"].col.状態] || "").toString().trim() === "削除済み") {
        console.warn(`利用者ID ${userId} は削除済みです。`);
        return null;
      }
      const userName = row[1] || "氏名不明";
      console.log(`利用者情報取得成功: ${userName}`);
      // クライアントは氏名しか使わないため、メールアドレス等のPIIは返さない
      return { name: userName };
    }
    console.warn(`利用者ID ${userId} の情報が見つかりませんでした。`);
    return null; // 見つからなかった場合
  } catch (error) {
    console.error(`利用者情報の取得中にエラーが発生しました: ${error}`);
    console.error(error); // スタックトレースも出力
    // クライアントにエラーを伝える
    throw new Error(`利用者情報の取得に失敗しました: ${error.message}`);
  }
}


/**
 * 指定された書籍IDの貸出記録を検索する関数
 * @param {string} bookId - 検索する書籍ID
 * @return {object} 貸出記録とログ情報を含むオブジェクト
 */
function findRentalRecords(bookId) {
  // ログを収集するための配列
  const logs = [];
  
  if (!bookId) {
    logs.push("書籍IDが指定されていません。");
    return { records: [], logs: logs };
  }
  
  logs.push(`貸出記録検索開始: 書籍ID=${bookId}`);
  console.log(`貸出記録検索開始: 書籍ID=${bookId}`);
  Logger.log(`デバッグ\t貸出記録検索開始: 書籍ID=${bookId}`);

  // 入力が妥当なISBNの場合は、管理番号(ISBN-001等)で記録された行もヒットさせる。
  // 貸出時はISBN→在庫のある管理番号に解決して記録するため、返却時も逆方向の解決が必要
  const normalizedInputIsbn = isValidIsbn_(bookId) ? normalizeIsbn_(bookId) : "";

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) {
      const errorMsg = "シート「貸出記録」が見つかりません。";
      logs.push(errorMsg);
      console.error(errorMsg);
      throw new Error("貸出記録シートが見つかりません。");
    }

    const data = lendingSheet.getDataRange().getValues();
    // ヘッダー: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時, F:返却予定日, G:返却状況, H:返却日時
    const bookIdColIndex = 0;     // A列
    const titleColIndex = 1;      // B列
    const userIdColIndex = 2;     // C列
    const userNameColIndex = 3;   // D列
    const lendingDateColIndex = 4;// E列
    const dueDateColIndex = 5;    // F列
    const statusColIndex = 6;     // G列

    logs.push(`検索開始: 貸出記録シートの行数=${data.length}`);
    
    // 検索結果を格納する配列
    const records = [];
    
    // ヘッダー行を除く (1行目から検索)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowBookId = row[bookIdColIndex] ? row[bookIdColIndex].toString().trim() : "";
      
      // デバッグ用にログ出力
      logs.push(`行 ${i + 1} 検証中: シートの書籍ID=[${rowBookId}], 検索対象の書籍ID=[${bookId.trim()}]`);
      Logger.log(`デバッグ\t行 ${i + 1} 検証中: シートの書籍ID=[${rowBookId}], 検索対象の書籍ID=[${bookId.trim()}]`);
      
      // 書籍IDが一致する行を探す
      // 詳細なデバッグ情報を追加
      const rowBookIdLower = rowBookId.toLowerCase();
      const bookIdLower = bookId.trim().toLowerCase();
      // ①完全一致(管理番号や旧形式のIDをそのまま入力した場合)
      // ②ISBN一致: 記録側は「ハイフン付きISBNそのもの(978-4-296-00276-4)」と
      //   「管理番号(ISBN-001)」の両方がありうるため、全体の正規化と
      //   複製番号サフィックス(-nnn)除去後の正規化の両方で比較する
      //   (前者を先に剥がすとISBNのチェックデジットを誤って除去してしまう)
      const rowIsbnFull = normalizeIsbn_(rowBookId);
      const rowIsbnPart = normalizeIsbn_(rowBookId.replace(/-\d+$/, ""));
      const isIdMatch = rowBookIdLower === bookIdLower ||
        (normalizedInputIsbn !== "" &&
          (rowIsbnFull === normalizedInputIsbn || rowIsbnPart === normalizedInputIsbn));
      Logger.log(`デバッグ\t行 ${i + 1} 詳細比較: ID一致=${isIdMatch}(${rowBookIdLower}=${bookIdLower})`);
      
      // 大文字小文字を区別せずに比較
      if (rowBookId && isIdMatch) {
        // 貸出記録情報を作成 (DateオブジェクトをISO文字列に変換)
        const lendingDate = row[lendingDateColIndex];
        const dueDate = row[dueDateColIndex];
        
        const record = {
          rowNumber: i + 1, // 行番号を追加（1ベース）
          bookId: rowBookId,
          bookTitle: row[titleColIndex] || "",
          userId: row[userIdColIndex] || "",
          userName: row[userNameColIndex] || "",
          // Dateオブジェクトが存在し、有効な日付であればISO文字列に変換
          lendingDate: (lendingDate instanceof Date && !isNaN(lendingDate)) ? lendingDate.toISOString() : null,
          dueDate: (dueDate instanceof Date && !isNaN(dueDate)) ? dueDate.toISOString() : null,
          status: row[statusColIndex] || ""
        };
        
        records.push(record);
        logs.push(`貸出記録発見 (行 ${i + 1}): ${record.bookTitle}, ${record.userName}, 状態=${record.status}`);
        Logger.log(`デバッグ\t貸出記録発見 (行 ${i + 1}): ${record.bookTitle}, ${record.userName}, 状態=${record.status}`);
        
        // デバッグ: 追加したレコードの詳細をログに出力
        Logger.log(`デバッグ\t追加したレコード詳細: ${JSON.stringify(record)}`);
      }
    }

    if (records.length > 0) {
      logs.push(`書籍ID ${bookId} の貸出記録が ${records.length} 件見つかりました。`);
      Logger.log(`デバッグ\t検索結果: ${records.length}件の記録が見つかりました。records配列=${JSON.stringify(records)}`);
    } else {
      logs.push(`書籍ID ${bookId} の貸出記録が見つかりませんでした。`);
      Logger.log(`デバッグ\t検索結果: 記録が見つかりませんでした。records配列は空です。`);
    }
    
    // 返却する直前のデータ構造を詳細にログ出力
    const finalResult = { records: records, logs: logs };
    try {
      Logger.log(`デバッグ\t返却直前のデータ(JSON): ${JSON.stringify(finalResult)}`);
    } catch (e) {
      Logger.log(`デバッグ\t返却データのJSON変換エラー: ${e}`);
      // records内のDateオブジェクトなどが原因の可能性があるため、簡易的なログに切り替え
      Logger.log(`デバッグ\t返却データ構造 (簡易): { records: [${records.length}件], logs: [${logs.length}件] }`);
    }
    
    // 重要: 検索結果が見つからない場合でも、ログに「貸出記録発見」が含まれていれば、
    // 何らかの理由でrecords配列に追加されなかった可能性があるため、
    // 強制的にダミーレコードを作成して返す
    if (records.length === 0) {
      for (const log of logs) {
        if (log.includes("貸出記録発見")) {
          // ログから情報を抽出
          const match = log.match(/貸出記録発見 \(行 \d+\): (.*), (.*), 状態=(.*)/);
          if (match) {
            const bookTitle = match[1];
            const userName = match[2];
            const status = match[3];
            
            // ダミーレコードを作成 (DateオブジェクトをISO文字列に変換)
            const now = new Date();
            const dummyDueDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
            
            const dummyRecord = {
              bookId: bookId,
              bookTitle: bookTitle,
              userName: userName,
              lendingDate: now.toISOString(),
              dueDate: dummyDueDate.toISOString(),
              status: status
            };
            
            records.push(dummyRecord);
            logs.push(`警告: records配列が空でしたが、ログに貸出記録発見の記録があったため、ダミーレコードを作成しました。`);
            Logger.log(`デバッグ\t警告: ダミーレコード作成: ${JSON.stringify(dummyRecord)}`);
          }
          break;
        }
      }
    }
    
    // 本来の返却処理
    return finalResult;
    
  } catch (error) {
    const errorMsg = `貸出記録の検索中にエラーが発生しました: ${error} (スタック: ${error.stack})`;
    logs.push(errorMsg);
    console.error(errorMsg);
    console.error(error);
    throw new Error(`貸出記録の検索に失敗しました: ${error.message}`);
  }
}

/**
 * 複数の書籍IDを一括で返却処理する関数
 * @param {string[]} bookIds - 返却する書籍IDの配列
 * @return {object} 処理結果メッセージ { message: string }
 */
/**
 * 選択された書籍を一括返却する関数（行番号ベース）
 * @param {Array} records - 返却する書籍の行番号配列 [{rowNumber: number, bookId: string}, ...]
 * @return {Object} 処理結果とメッセージ
 */
/**
 * 返却された書籍の書籍DB状態を「在庫」に戻す補助関数
 * 貸出記録側の返却処理は既に成功しているため、状態更新の失敗はログに留めて処理を継続する。
 * @param {string[]} bookIds - 返却された書籍ID(管理番号)の配列
 */
function markBooksAsAvailable_(bookIds) {
  const uniqueIds = [...new Set(bookIds.filter(id => id))];
  uniqueIds.forEach(bookId => {
    try {
      updateBookStatus(bookId, "在庫");
    } catch (e) {
      console.error(`書籍DBの状態更新に失敗しました (ID: ${bookId}): ${e}`);
    }
  });
}

function processBulkReturnByRowNumbers(records) {
  return runWithScriptLock_(
    () => processBulkReturnByRowNumbers_(records),
    { success: false, message: `返却処理失敗: ${LOCK_BUSY_MESSAGE}` }
  );
}

function processBulkReturnByRowNumbers_(records) {
  console.log("一括返却データ受信（行番号版）:", records);
  let successCount = 0;
  let errorCount = 0;
  const errorMessages = [];

  if (!Array.isArray(records) || records.length === 0) {
    return { success: false, message: "返却処理失敗: 書籍が指定されていません。" };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) {
      throw new Error("シート「貸出記録」が見つかりません。");
    }

    const statusColIndex = 7;     // G列（1ベース）
    const returnDateColIndex = 8; // H列（1ベース）
    const currentDate = new Date();

    // 行番号でソート（大きい順）して、行の削除や更新で番号がずれないようにする
    const sortedRecords = records.sort((a, b) => b.rowNumber - a.rowNumber);
    const returnedBookIds = [];

    sortedRecords.forEach(record => {
      const { rowNumber, bookId } = record;

      try {
        // 行番号を使用して直接セルを更新
        lendingSheet.getRange(rowNumber, statusColIndex).setValue("返却済");
        lendingSheet.getRange(rowNumber, returnDateColIndex).setValue(currentDate);
        successCount++;
        returnedBookIds.push(bookId);
        console.log(`返却処理完了: 書籍ID=${bookId} (行 ${rowNumber})`);
      } catch (e) {
        errorCount++;
        errorMessages.push(`行 ${rowNumber} の更新中にエラー: ${e.message}`);
        console.error(`行 ${rowNumber} の更新エラー:`, e);
      }
    });

    // 書籍DBの状態を「在庫」に戻す
    markBooksAsAvailable_(returnedBookIds);

    // 結果メッセージを生成
    let message = "";
    if (successCount > 0) {
      message = `${successCount} 冊の本を返却しました。`;
    }
    if (errorCount > 0) {
      message += ` ${errorCount} 件のエラーが発生しました。`;
    }

    // 返却した本に予約が入っていれば取り置き案内を追記し、予約者へ入荷メールを送る
    const reservationNotices = buildReservationNoticesForReturns_(returnedBookIds);
    if (reservationNotices.length > 0) {
      message += "\n" + reservationNotices.join("\n");
    }

    console.log("一括返却処理完了:", message);
    return {
      success: successCount > 0,
      message: message,
      successCount: successCount,
      errorCount: errorCount,
      errorMessages: errorMessages
    };
    
  } catch (error) {
    const errorMsg = `一括返却処理中にエラーが発生しました: ${error}`;
    console.error(errorMsg);
    console.error(error);
    return { success: false, message: `返却処理失敗: ${error.message}` };
  }
}

/**
 * 選択された書籍を一括返却する関数（詳細情報付き）
 * @param {Array} bookRecords - 返却する書籍の詳細情報配列 [{bookId, userId, lendingDate}, ...]
 * @return {Object} 処理結果とメッセージ
 */
function processBulkReturnWithDetails(bookRecords) {
  return runWithScriptLock_(
    () => processBulkReturnWithDetails_(bookRecords),
    { success: false, message: `返却処理失敗: ${LOCK_BUSY_MESSAGE}` }
  );
}

function processBulkReturnWithDetails_(bookRecords) {
  console.log("一括返却データ受信（詳細版）:", bookRecords);
  let successCount = 0;
  let notFoundCount = 0;
  let alreadyReturnedCount = 0;
  let errorCount = 0;
  const notFoundIds = [];
  const alreadyReturnedIds = [];
  const errorMessages = [];

  if (!Array.isArray(bookRecords) || bookRecords.length === 0) {
    return { success: false, message: "返却処理失敗: 書籍が指定されていません。" };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) {
      throw new Error("シート「貸出記録」が見つかりません。");
    }

    const data = lendingSheet.getDataRange().getValues();
    const bookIdColIndex = 0;     // A列
    const userIdColIndex = 2;     // C列
    const lendingDateColIndex = 4;// E列
    const statusColIndex = 6;     // G列
    const returnDateColIndex = 7; // H列
    const currentDate = new Date();

    const updates = []; // 更新内容を一時保存

    bookRecords.forEach(record => {
      const { bookId, userId, lendingDate } = record;
      if (!bookId) return; // 空のIDはスキップ

      let recordFound = false;
      
      // 特定のレコードを探す
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowBookId = row[bookIdColIndex] ? row[bookIdColIndex].toString().trim() : "";
        const rowUserId = row[userIdColIndex] ? row[userIdColIndex].toString().trim() : "";
        const rowLendingDate = row[lendingDateColIndex];
        const rowStatus = row[statusColIndex];
        
        // 書籍ID、利用者ID、貸出日時が一致するレコードを探す
        if (rowBookId.toLowerCase() === bookId.toLowerCase() && 
            rowUserId === userId && 
            rowStatus === "未返却") {
          
          // 貸出日時の比較（文字列またはDateオブジェクト）
          let dateMatch = false;
          if (lendingDate && rowLendingDate) {
            const lendingDateStr = new Date(lendingDate).toISOString();
            const rowLendingDateStr = rowLendingDate instanceof Date ? 
              rowLendingDate.toISOString() : new Date(rowLendingDate).toISOString();
            dateMatch = lendingDateStr === rowLendingDateStr;
          }
          
          if (dateMatch || (!lendingDate && !rowLendingDate)) {
            recordFound = true;
            // 更新リストに追加
            updates.push({ row: i + 1, col: statusColIndex + 1, value: "返却済", bookId: bookId });
            updates.push({ row: i + 1, col: returnDateColIndex + 1, value: currentDate });
            successCount++;
            console.log(`返却処理準備完了: 書籍ID=${bookId}, 利用者ID=${userId} (行 ${i + 1})`);
            break;
          }
        }
      }
      
      if (!recordFound) {
        notFoundCount++;
        notFoundIds.push(bookId);
        console.warn(`書籍ID ${bookId} の指定されたレコードが見つかりませんでした。`);
      }
    });

    // まとめて更新
    const returnedBookIds = [];
    if (updates.length > 0) {
      updates.forEach(update => {
        try {
          lendingSheet.getRange(update.row, update.col).setValue(update.value);
          if (update.bookId) {
            returnedBookIds.push(update.bookId);
          }
        } catch (e) {
          console.error(`行 ${update.row}, 列 ${update.col} の更新中にエラー: ${e}`);
          errorCount++;
          if (update.col === statusColIndex + 1) successCount--;
        }
      });
    }

    // 書籍DBの状態を「在庫」に戻す
    markBooksAsAvailable_(returnedBookIds);

    // 結果メッセージを生成
    let message = "";
    if (successCount > 0) {
      message += `${successCount} 冊の本を返却しました。`;
    }
    if (notFoundCount > 0) {
      message += ` ${notFoundCount} 冊の本が見つかりませんでした。`;
    }
    if (alreadyReturnedCount > 0) {
      message += ` ${alreadyReturnedCount} 冊は既に返却済みでした。`;
    }
    if (errorCount > 0) {
      message += ` ${errorCount} 件の更新エラーが発生しました。`;
    }

    if (successCount === 0 && notFoundCount === 0 && alreadyReturnedCount === 0) {
      message = "返却処理に失敗しました。選択された本の貸出記録が見つかりませんでした。";
    }

    console.log("一括返却処理完了:", message);
    return {
      success: successCount > 0,
      message: message,
      successCount: successCount,
      notFoundIds: notFoundIds,
      alreadyReturnedIds: alreadyReturnedIds
    };
    
  } catch (error) {
    const errorMsg = `一括返却処理中にエラーが発生しました: ${error}`;
    console.error(errorMsg);
    console.error(error);
    return { success: false, message: `返却処理失敗: ${error.message}` };
  }
}

// 既存の関数（互換性のため残す）
function processBulkReturn(bookIds) {
  return runWithScriptLock_(
    () => processBulkReturn_(bookIds),
    { success: false, message: `一括返却処理失敗: ${LOCK_BUSY_MESSAGE}` }
  );
}

function processBulkReturn_(bookIds) {
  console.log("一括返却データ受信:", bookIds);
  let successCount = 0;
  let notFoundCount = 0;
  let alreadyReturnedCount = 0;
  let errorCount = 0;
  const notFoundIds = [];
  const alreadyReturnedIds = [];
  const errorMessages = [];

  if (!Array.isArray(bookIds) || bookIds.length === 0) {
    return { success: false, message: "返却処理失敗: 書籍IDが指定されていません。" };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) {
      throw new Error("シート「貸出記録」が見つかりません。");
    }

    const data = lendingSheet.getDataRange().getValues();
    const bookIdColIndex = 0;     // A列
    const statusColIndex = 6;     // G列
    const returnDateColIndex = 7; // H列
    const currentDate = new Date();

    // シートのデータをMapに格納して高速化 (書籍IDをキー、行インデックスと行データの配列を値)
    // 同じ書籍IDで複数の未返却レコードがある場合も全て処理する
    const lendingMap = new Map();
    for (let i = 1; i < data.length; i++) {
      const rowBookId = data[i][bookIdColIndex] ? data[i][bookIdColIndex].toString().trim().toLowerCase() : null;
      if (rowBookId) {
         const rowStatus = data[i][statusColIndex];
         if(rowStatus === "未返却") {
            // 同じIDが複数ある場合は配列に追加
            if (!lendingMap.has(rowBookId)) {
              lendingMap.set(rowBookId, []);
            }
            lendingMap.get(rowBookId).push({ index: i + 1, rowData: data[i] });
         }
      }
    }

    const updates = []; // 更新内容を一時保存 [(rowIndex, statusCol, value), (rowIndex, dateCol, value)]

    bookIds.forEach(bookId => {
      const trimmedBookId = bookId.trim();
      if (!trimmedBookId) return; // 空のIDはスキップ

      const bookIdLower = trimmedBookId.toLowerCase();
      const recordInfoArray = lendingMap.get(bookIdLower);

      if (recordInfoArray && recordInfoArray.length > 0) {
        // 同じ書籍IDの未返却レコードを全て処理
        recordInfoArray.forEach(recordInfo => {
          const rowIndex = recordInfo.index;
          const rowStatus = recordInfo.rowData[statusColIndex];

          if (rowStatus === "未返却") {
            // 更新リストに追加
            updates.push({ row: rowIndex, col: statusColIndex + 1, value: "返却済", bookId: trimmedBookId });
            updates.push({ row: rowIndex, col: returnDateColIndex + 1, value: currentDate });
            successCount++;
            console.log(`返却処理準備完了: 書籍ID=${trimmedBookId} (行 ${rowIndex})`);
          } else {
            // これは発生しないはず（Mapには未返却のみ格納）
            alreadyReturnedCount++;
            alreadyReturnedIds.push(trimmedBookId);
            console.warn(`書籍ID ${trimmedBookId} は既に返却済みです (行 ${rowIndex})`);
          }
        });
      } else {
        notFoundCount++;
        notFoundIds.push(trimmedBookId);
        console.warn(`書籍ID ${trimmedBookId} の未返却の貸出記録が見つかりませんでした。`);
      }
    });

    // まとめて更新 (GASのAPI呼び出し回数を減らすため)
    const returnedBookIds = [];
    if (updates.length > 0) {
      updates.forEach(update => {
        try {
          lendingSheet.getRange(update.row, update.col).setValue(update.value);
          if (update.bookId) {
            returnedBookIds.push(update.bookId);
          }
        } catch (e) {
           // 個別の更新エラー処理
           console.error(`行 ${update.row}, 列 ${update.col} の更新中にエラー: ${e}`);
           errorCount++;
           // 成功カウントを減らす（ステータス更新が失敗した場合）
           if (update.col === statusColIndex + 1) successCount--;
           // エラーが発生した書籍IDを特定（少し複雑になる）
           // updates配列はステータスと日付のペアなので、インデックス/2で元のbookIds配列のインデックスに近づける
           const failedBookIdIndex = Math.floor(updates.indexOf(update) / 2);
           const failedBookId = bookIds[failedBookIdIndex] || `不明(Index:${failedBookIdIndex})`;
           errorMessages.push(`ID ${failedBookId} の更新失敗`);
        }
      });
      console.log(`${successCount}件の返却処理を更新しました。`);
    }

    // 書籍DBの状態を「在庫」に戻す
    markBooksAsAvailable_(returnedBookIds);

    // 結果メッセージの組み立て
    let message = `${successCount}件の返却処理に成功しました。`;
    if (notFoundCount > 0) {
      message += ` ${notFoundCount}件は見つかりませんでした (${notFoundIds.join(', ')})。`;
    }
    if (alreadyReturnedCount > 0) {
      message += ` ${alreadyReturnedCount}件は既に返却済みでした (${alreadyReturnedIds.join(', ')})。`;
    }
     if (errorCount > 0) {
      message += ` ${errorCount}件の更新中にエラーが発生しました。`;
    }

    return { success: successCount > 0, message: message };

  } catch (error) {
    console.error(`一括返却処理中にエラーが発生しました: ${error}`);
    console.error(error);
    return { success: false, message: `一括返却処理失敗: ${error.message}` };
  }
}


/**
 * 複数の書籍IDを一括で貸出登録する関数
 * @param {object} bulkData - { userId: string, userName: string, bookIds: string[] }
 * @return {string} 処理結果メッセージ
 */
function processBulkLending(bulkData) {
  return runWithScriptLock_(
    () => processBulkLending_(bulkData),
    { success: false, message: LOCK_BUSY_MESSAGE, successCount: 0, errorCount: 0 }
  );
}

function processBulkLending_(bulkData) {
  console.log("一括貸出データ受信:", bulkData);
  let successCount = 0;
  let errorCount = 0;
  const errorMessages = [];

  try {
    // 入力チェック
    if (!bulkData || !bulkData.userId || !bulkData.userName || !Array.isArray(bulkData.bookIds) || bulkData.bookIds.length === 0) {
       throw new Error("必要な情報（利用者ID, 利用者名, 書籍IDリスト）が不足しているか、形式が正しくありません。");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    const bookSheet = ss.getSheetByName("書籍DB"); // 書籍名取得用

    if (!lendingSheet || !bookSheet) {
      console.error("必要なシート（貸出記録または書籍DB）が見つかりません。");
      throw new Error("必要なシートが見つかりません。");
    }

    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    // 書籍DBの情報を先に読み込んでおく（効率化のため）
    // A=管理番号, B=ISBN, C=書籍名, G=状態
    const bookData = bookSheet.getDataRange().getValues();
    const bookMap = new Map(); // 管理番号をキー、{title, status, rowNumber} を値とするMap
    const copiesByIsbn = new Map(); // ISBNをキー、同一ISBNの蔵書 [{managementNumber, entry}] を値とするMap
    for (let i = 1; i < bookData.length; i++) {
      const bookId = bookData[i][0] ? bookData[i][0].toString().trim() : null;
      if (bookId) {
        const entry = {
          title: bookData[i][2] || "タイトル不明",
          status: bookData[i][6] || "在庫",
          rowNumber: i + 1,
          bookId: bookId
        };
        bookMap.set(bookId, entry);
        // ISBN(B列)でも検索できるようにする(getBookDetails と同じ挙動)
        if (bookData[i][1]) {
          const isbn = normalizeIsbn_(bookData[i][1]);
          if (isbn) {
            entry.isbn = isbn; // 予約照合用(予約キーはISBN優先)
            if (!copiesByIsbn.has(isbn)) {
              copiesByIsbn.set(isbn, []);
            }
            copiesByIsbn.get(isbn).push({ managementNumber: bookId, entry: entry });
          }
        }
      }
    }

    // 貸出記録から未返却の書籍IDを収集する
    // (旧レイアウトや過去データで書籍DBのG列が「在庫」のまま貸出中の本があっても二重貸出を防ぐ)
    // あわせて、この利用者の未返却冊数を数える(貸出上限チェック用。
    // 利用者IDの照合は getUserRentals と同じく trim + 大文字小文字無視)
    const lendingData = lendingSheet.getDataRange().getValues();
    const activeLoanIds = new Set();
    const normalizedUserId = bulkData.userId.toString().trim().toLowerCase();
    let userActiveLoanCount = 0;
    for (let i = 1; i < lendingData.length; i++) {
      if (lendingData[i][6] === "未返却" && lendingData[i][0]) {
        activeLoanIds.add(lendingData[i][0].toString().trim());
        const rowUserId = lendingData[i][2] ? lendingData[i][2].toString().trim().toLowerCase() : "";
        if (rowUserId === normalizedUserId) {
          userActiveLoanCount++;
        }
      }
    }

    // 設定から貸出期間と一人あたりの最大貸出冊数を取得
    let lendingDays = 14; // デフォルト値
    let maxBooks = 0; // 0以下は上限チェックなし(設定が読めない場合に貸出業務を止めない)
    try {
      const settings = getLibrarySettings();
      if (settings && settings.lendingDays) {
        lendingDays = settings.lendingDays;
      }
      if (settings && typeof settings.maxBooks === "number" && settings.maxBooks > 0) {
        maxBooks = Math.floor(settings.maxBooks);
      }
    } catch (e) {
      console.log("設定の取得に失敗したため、デフォルトの貸出期間を使用します(貸出上限チェックはスキップ):", e);
    }

    // 予約中の本の貸出制御(予約DBが無い環境では actives が空でチェックはスキップされる)
    const reservationState = loadActiveReservations_();
    const reservationsToFulfill = []; // 予約者本人への貸出が成立したら「貸出済」に更新する

    const lendingDate = new Date(); // 現在日時を貸出日時とする
    const dueDate = new Date(lendingDate.getTime() + lendingDays * 24 * 60 * 60 * 1000); // 貸出日から設定日数後
    const returnStatus = "未返却"; // 初期状態

    const rowsToAdd = [];
    const rowsToMarkLent = []; // 貸出中に更新する書籍DBの行番号

    bulkData.bookIds.forEach(bookId => {
      const trimmedBookId = bookId.trim();
      if (!trimmedBookId) return; // 空のIDはスキップ
      const normalizedInputIsbn = isValidIsbn_(trimmedBookId) ? normalizeIsbn_(trimmedBookId) : "";

      let book = bookMap.get(trimmedBookId);
      if (!book && normalizedInputIsbn) {
        book = bookMap.get(normalizedInputIsbn);
      }
      let lendId = book && book.bookId ? book.bookId : trimmedBookId; // 実際に貸出記録へ書き込むID(管理番号)

      // 管理番号で見つからない場合はISBNとして解釈し、貸出可能なコピーを探す
      if (!book && normalizedInputIsbn && copiesByIsbn.has(normalizedInputIsbn)) {
        const availableCopy = copiesByIsbn.get(normalizedInputIsbn).find(copy =>
          copy.entry.status === "在庫" && !activeLoanIds.has(copy.managementNumber)
        );
        if (!availableCopy) {
          errorCount++;
          errorMessages.push(`${trimmedBookId}（在庫なし）`);
          console.warn(`貸出スキップ: ISBN ${trimmedBookId} に貸出可能な在庫がありません。`);
          return;
        }
        book = availableCopy.entry;
        lendId = availableCopy.managementNumber;
        console.log(`ISBN ${trimmedBookId} の在庫コピー ${lendId} を貸出対象に選択しました。`);
      }

      // 在庫チェック: DB未登録・貸出中の本は貸し出さない（二重貸出防止）
      if (!book) {
        errorCount++;
        errorMessages.push(`${trimmedBookId}（DB未登録）`);
        console.warn(`貸出スキップ: 書籍ID ${trimmedBookId} はDBに登録されていません。`);
        return;
      }
      if (book.status !== "在庫") {
        errorCount++;
        errorMessages.push(`${trimmedBookId}（${book.status}）`);
        console.warn(`貸出スキップ: 書籍ID ${trimmedBookId} は「${book.status}」のため貸出できません。`);
        return;
      }
      if (activeLoanIds.has(lendId)) {
        errorCount++;
        errorMessages.push(`${lendId}（未返却の貸出記録あり）`);
        console.warn(`貸出スキップ: 書籍ID ${lendId} には未返却の貸出記録が存在します。`);
        return;
      }

      // 貸出上限チェック: 未返却冊数 + 今回のリクエストで確定済みの冊数が
      // 設定 maxBooks に達していたらこの本は貸し出さない(他の理由で弾かれた本は数えない)
      if (maxBooks > 0 && userActiveLoanCount + successCount >= maxBooks) {
        errorCount++;
        errorMessages.push(`${trimmedBookId}（貸出上限超過: 未返却${userActiveLoanCount}冊+今回${successCount}冊/最大${maxBooks}冊）`);
        console.warn(`貸出スキップ: 利用者 ${bulkData.userId} は貸出上限（${maxBooks}冊）に達しています。`);
        return;
      }

      // 予約チェック: 予約中の本は最先頭の予約者本人にのみ貸し出す
      const reservation = findReservationForBook_(reservationState.actives, lendId, book.isbn || "");
      if (reservation) {
        if (reservation.userId.toLowerCase() !== normalizedUserId) {
          errorCount++;
          errorMessages.push(`${lendId}（予約あり: ${reservation.userName} さんが予約中）`);
          console.warn(`貸出スキップ: 書籍ID ${lendId} は他の利用者(${reservation.userId})が予約中です。`);
          return;
        }
        reservationsToFulfill.push(reservation);
      }

      // 同一リクエスト内で同じ管理番号が重複指定された場合も2冊目以降を弾く
      book.status = "貸出中";
      activeLoanIds.add(lendId);

      // スプレッドシートに追加するデータ配列(貸出記録には管理番号を記録する)
      rowsToAdd.push([
        lendId,
        book.title,
        bulkData.userId,
        bulkData.userName,
        lendingDate,
        dueDate,
        returnStatus
      ]);
      rowsToMarkLent.push(book.rowNumber);
      successCount++;
      console.log(`貸出準備完了: ${book.title} (ID: ${lendId})`);
    });

    // まとめて追記
    if (rowsToAdd.length > 0) {
      lendingSheet.getRange(lendingSheet.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length).setValues(rowsToAdd);
      console.log(`${successCount}件の貸出記録を追加しました。`);

      // 書籍DBの状態を「貸出中」に更新（G列）
      rowsToMarkLent.forEach(rowNumber => {
        bookSheet.getRange(rowNumber, 7).setValue("貸出中");
      });

      // 予約者本人への貸出が成立した予約を「貸出済」に更新する
      if (reservationsToFulfill.length > 0 && reservationState.sheet) {
        const resCol = SCHEMA["予約DB"].col;
        const fulfilledRows = new Set(); // 同一予約への二重更新を防ぐ(複本を同時貸出した場合)
        reservationsToFulfill.forEach(r => {
          if (fulfilledRows.has(r.rowNumber)) return;
          fulfilledRows.add(r.rowNumber);
          reservationState.sheet.getRange(r.rowNumber, resCol.状態 + 1).setValue("貸出済");
          reservationState.sheet.getRange(r.rowNumber, resCol.処理日時 + 1).setValue(new Date());
        });
      }
    }

    // 構造化された結果を返す(クライアントは success フラグで成否判定する)
    if (successCount === 0 && errorCount > 0) {
      return {
        success: false,
        message: `一括貸出登録失敗: すべての書籍を貸出できませんでした。${errorMessages.join(', ')}`,
        successCount: successCount,
        errorCount: errorCount
      };
    }
    if (errorCount > 0) {
      return {
        success: true,
        message: `貸出登録完了 (${successCount}件成功、${errorCount}件失敗)。失敗した書籍ID: ${errorMessages.join(', ')}`,
        successCount: successCount,
        errorCount: errorCount
      };
    }
    return {
      success: true,
      message: `${successCount}件の貸出登録に成功しました。`,
      successCount: successCount,
      errorCount: 0
    };

  } catch (error) {
    console.error(`一括貸出処理中にエラーが発生しました: ${error}`);
    console.error(error); // スタックトレースも出力
    // クライアントにエラーメッセージを返す
    return { success: false, message: `一括貸出登録失敗: ${error.message}`, successCount: 0, errorCount: 0 };
  }
}


/**
 * 利用者IDに基づいて貸出記録を検索する関数
 * @param {string} userId - 利用者ID
 * @return {object} 貸出記録とログ情報を含むオブジェクト
 */
function getUserRentals(userId) {
  // ログを収集するための配列
  const logs = [];
  
  if (!userId) {
    logs.push("利用者IDが指定されていません。");
    return { records: [], logs: logs };
  }
  
  logs.push(`利用者の貸出記録検索開始: 利用者ID=${userId}`);
  console.log(`利用者の貸出記録検索開始: 利用者ID=${userId}`);
  Logger.log(`デバッグ\t利用者の貸出記録検索開始: 利用者ID=${userId}`);
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) {
      const errorMsg = "シート「貸出記録」が見つかりません。";
      logs.push(errorMsg);
      console.error(errorMsg);
      throw new Error("貸出記録シートが見つかりません。");
    }

    const data = lendingSheet.getDataRange().getValues();
    // ヘッダー: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時, F:返却予定日, G:返却状況, H:返却日時
    const bookIdColIndex = 0;     // A列
    const titleColIndex = 1;      // B列
    const userIdColIndex = 2;     // C列
    const userNameColIndex = 3;   // D列
    const lendingDateColIndex = 4;// E列
    const dueDateColIndex = 5;    // F列
    const statusColIndex = 6;     // G列

    logs.push(`検索開始: 貸出記録シートの行数=${data.length}`);
    
    // 検索結果を格納する配列
    const records = [];
    
    // ヘッダー行を除く (1行目から検索)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowUserId = row[userIdColIndex] ? row[userIdColIndex].toString().trim() : "";
      
      // デバッグ用にログ出力
      logs.push(`行 ${i + 1} 検証中: シートの利用者ID=[${rowUserId}], 検索対象の利用者ID=[${userId.trim()}]`);
      Logger.log(`デバッグ\t行 ${i + 1} 検証中: シートの利用者ID=[${rowUserId}], 検索対象の利用者ID=[${userId.trim()}]`);
      
      // 利用者IDが一致する行を探す
      // 詳細なデバッグ情報を追加
      const rowUserIdLower = rowUserId.toLowerCase();
      const userIdLower = userId.trim().toLowerCase();
      const isIdMatch = rowUserIdLower === userIdLower;
      Logger.log(`デバッグ\t行 ${i + 1} 詳細比較: ID一致=${isIdMatch}(${rowUserIdLower}=${userIdLower})`);
      
      // 大文字小文字を区別せずに比較
      if (rowUserId && isIdMatch) {
        // 貸出記録情報を作成 (DateオブジェクトをISO文字列に変換)
        const lendingDate = row[lendingDateColIndex];
        const dueDate = row[dueDateColIndex];
        
        const record = {
          rowNumber: i + 1, // 行番号を追加（1ベース）
          bookId: row[bookIdColIndex] || "",
          bookTitle: row[titleColIndex] || "",
          userId: rowUserId,
          userName: row[userNameColIndex] || "",
          // Dateオブジェクトが存在し、有効な日付であればISO文字列に変換
          lendingDate: (lendingDate instanceof Date && !isNaN(lendingDate)) ? lendingDate.toISOString() : null,
          dueDate: (dueDate instanceof Date && !isNaN(dueDate)) ? dueDate.toISOString() : null,
          status: row[statusColIndex] || ""
        };
        
        records.push(record);
        logs.push(`貸出記録発見 (行 ${i + 1}): ${record.bookTitle}, ${record.userName}, 状態=${record.status}`);
        Logger.log(`デバッグ\t貸出記録発見 (行 ${i + 1}): ${record.bookTitle}, ${record.userName}, 状態=${record.status}`);
        
        // デバッグ: 追加したレコードの詳細をログに出力
        Logger.log(`デバッグ\t追加したレコード詳細: ${JSON.stringify(record)}`);
      }
    }

    if (records.length > 0) {
      logs.push(`利用者ID ${userId} の貸出記録が ${records.length} 件見つかりました。`);
      Logger.log(`デバッグ\t検索結果: ${records.length}件の記録が見つかりました。records配列=${JSON.stringify(records)}`);
    } else {
      logs.push(`利用者ID ${userId} の貸出記録が見つかりませんでした。`);
      Logger.log(`デバッグ\t検索結果: 記録が見つかりませんでした。records配列は空です。`);
    }
    
    return { records: records, logs: logs };
    
  } catch (error) {
    const errorMsg = `貸出記録の検索中にエラーが発生しました: ${error} (スタック: ${error.stack})`;
    logs.push(errorMsg);
    console.error(errorMsg);
    console.error(error);
    throw new Error(`貸出記録の検索に失敗しました: ${error.message}`);
  }
}

// sendOverdueReminders のテストは、実際にメールが飛ぶため注意が必要


/**
 * ISBNから書籍情報を取得する関数。
 * openBDを優先し、見つからない場合のみGoogle Books APIを予備として使う。
 * @param {string} isbn - 書籍のISBNコード
 * @return {object} 書籍情報オブジェクト
 */
function fetchBookInfo(isbn) {
  const normalizedIsbn = normalizeIsbn_(isbn);
  if (!normalizedIsbn) {
    return { error: "ISBNが指定されていません。" };
  }
  if (!isValidIsbn_(normalizedIsbn)) {
    return { error: `ISBNの形式が正しくありません: ${isbn}` };
  }

  try {
    const openBdResult = fetchBookInfoFromOpenBd_(normalizedIsbn);
    if (openBdResult && !openBdResult.error) {
      return openBdResult;
    }

    const googleResult = fetchBookInfoFromGoogleBooks_(normalizedIsbn);
    if (googleResult && !googleResult.error) {
      return googleResult;
    }

    const errors = [];
    if (openBdResult && openBdResult.error) errors.push(`openBD: ${openBdResult.error}`);
    if (googleResult && googleResult.error) errors.push(`Google Books: ${googleResult.error}`);
    if (errors.length > 0) {
      return { error: `書籍情報を取得できませんでした。${errors.join(" / ")}` };
    }
    return { error: "書籍情報が見つかりませんでした。" };
  } catch (error) {
    console.error(`書籍情報の取得中にエラーが発生しました: ${error}`);
    return { error: `APIリクエスト中にエラーが発生しました: ${error.message}` };
  }
}

/**
 * openBDからISBN書籍情報を取得する。
 * @param {string} isbn - 正規化済みISBN
 * @return {object|null} 書籍情報、未検出ならnull、APIエラーなら{error}
 */
function fetchBookInfoFromOpenBd_(isbn) {
  try {
    const url = `https://api.openbd.jp/v1/get?isbn=${encodeURIComponent(isbn)}`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const statusCode = response.getResponseCode();
    const body = response.getContentText();

    if (statusCode < 200 || statusCode >= 300) {
      return { error: `HTTP ${statusCode}` };
    }

    let data;
    try {
      data = JSON.parse(body);
    } catch (error) {
      return { error: `レスポンスJSONの解析に失敗しました: ${error.message}` };
    }

    const item = Array.isArray(data) ? data[0] : null;
    if (!item || !item.summary) {
      return null;
    }

    const summary = item.summary;
    if (!summary.title) {
      return null;
    }

    return {
      isbn: summary.isbn || isbn,
      title: summary.title || "",
      authors: summary.author || "",
      publisher: summary.publisher || "",
      thumbnail: summary.cover || null
    };
  } catch (error) {
    console.error(`openBDからの書籍情報取得に失敗しました: ${error}`);
    return { error: error.message };
  }
}

/**
 * Google Books APIからISBN書籍情報を取得する。
 * @param {string} isbn - 正規化済みISBN
 * @return {object|null} 書籍情報、未検出ならnull、APIエラーなら{error}
 */
function fetchBookInfoFromGoogleBooks_(isbn) {
  try {
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&country=JP`;
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    const statusCode = response.getResponseCode();
    const body = response.getContentText();

    let data = null;
    try {
      data = JSON.parse(body);
    } catch (error) {
      if (statusCode >= 200 && statusCode < 300) {
        return { error: `レスポンスJSONの解析に失敗しました: ${error.message}` };
      }
    }

    if (statusCode < 200 || statusCode >= 300) {
      const apiMessage = data && data.error && data.error.message ? data.error.message : body.slice(0, 200);
      return { error: `HTTP ${statusCode}: ${apiMessage}` };
    }

    if (!data.items || data.items.length === 0) {
      return null;
    }

    const volumeInfo = data.items[0].volumeInfo || {};
    return {
      isbn: isbn,
      title: volumeInfo.title || "",
      authors: volumeInfo.authors ? volumeInfo.authors.join(", ") : "",
      publisher: volumeInfo.publisher || "",
      thumbnail: volumeInfo.imageLinks ? volumeInfo.imageLinks.smallThumbnail : null
    };
  } catch (error) {
    console.error(`Google Booksからの書籍情報取得に失敗しました: ${error}`);
    return { error: error.message };
  }
}

/**
 * 書籍情報をスプレッドシートの書籍DBに登録する関数（複数冊管理対応）
 * @param {object} bookData - 書籍データ {isbn, title, author, publisher, note, quantity}
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function registerBook(bookData) {
  return runWithScriptLock_(
    () => registerBook_(bookData),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function registerBook_(bookData) {
  bookData = bookData || {};
  bookData.isbn = normalizeIsbn_(bookData.isbn);
  console.log("registerBook関数が呼び出されました:", JSON.stringify(bookData));
  
  const missing = validateRequired_(bookData, { isbn: "書籍ID(ISBN)", title: "書籍名" });
  if (missing.length > 0) {
    return { success: false, message: `次の必須項目が入力されていません: ${missing.join("、")}` };
  }
  if (!isValidIsbn_(bookData.isbn)) {
    return { success: false, message: `ISBNの形式が正しくありません: ${bookData.isbn}(10桁または13桁のISBNを入力してください)` };
  }
  const quantityNum = parseInt(bookData.quantity, 10);
  if (bookData.quantity !== undefined && bookData.quantity !== null && bookData.quantity !== "" &&
      (isNaN(quantityNum) || quantityNum < 1 || quantityNum > 100)) {
    return { success: false, message: "登録冊数は1〜100の数値で指定してください。" };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    
    if (!bookSheet) {
      console.error("書籍DBシートが見つかりません");
      return { success: false, message: "書籍DBシートが見つかりません。" };
    }
    
    // ヘッダー行の確認と設定
    const range = bookSheet.getDataRange();
    if (!range || bookSheet.getLastRow() === 0) {
      console.log("書籍DBが空です。ヘッダー行を追加します。");
      // 新しいヘッダー行を追加（管理番号カラムを含む）
      bookSheet.getRange(1, 1, 1, SCHEMA["書籍DB"].headers.length).setValues([SCHEMA["書籍DB"].headers]);
    } else if (!isNewBookLayout_(bookSheet)) {
      // 旧レイアウトのシートに新形式の行を追記すると列がずれて混在し、
      // 書籍IDが正しく認識されなくなるため、先に移行を促す
      return {
        success: false,
        message: "書籍DBが旧レイアウトのままです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してから登録してください。"
      };
    }
    
    const data = bookSheet.getDataRange().getValues();
    const quantity = parseInt(bookData.quantity) || 1; // 登録冊数（デフォルト1冊）
    
    // 同じISBNの最大コピー番号を取得
    let maxCopyNumber = 0;
    const isbnColIndex = 1; // B列: ISBN
    
    if (data.length > 1) {
      for (let i = 1; i < data.length; i++) {
        const existingIsbn = data[i][isbnColIndex];
        const normalizedExistingIsbn = normalizeIsbn_(existingIsbn);
        if (normalizedExistingIsbn && normalizedExistingIsbn === bookData.isbn) {
          // 管理番号から番号部分を抽出（例: "9784123456789-003" → 3）
          const managementNumber = data[i][0];
          if (managementNumber) {
            const match = managementNumber.toString().match(/-(\d+)$/);
            if (match) {
              const copyNumber = parseInt(match[1]);
              maxCopyNumber = Math.max(maxCopyNumber, copyNumber);
            }
          }
        }
      }
    }
    
    // 指定された冊数分の書籍を登録
    const registeredBooks = [];
    for (let i = 0; i < quantity; i++) {
      const copyNumber = maxCopyNumber + i + 1;
      const managementNumber = `${bookData.isbn}-${String(copyNumber).padStart(3, '0')}`;
      
      const newRow = [
        managementNumber,           // A列: 管理番号
        bookData.isbn,             // B列: ISBN
        bookData.title,            // C列: 書籍名
        bookData.author || "",     // D列: 著者名
        bookData.publisher || "",  // E列: 出版社
        bookData.note || "",       // F列: 備考
        "在庫"                     // G列: 状態（在庫/貸出中）
      ];
      
      console.log(`新規登録データ ${i + 1}/${quantity}:`, newRow);
      bookSheet.appendRow(newRow);
      registeredBooks.push(managementNumber);
    }
    
    const message = quantity > 1 
      ? `書籍「${bookData.title}」を${quantity}冊登録しました。\n管理番号: ${registeredBooks.join(', ')}`
      : `書籍「${bookData.title}」を登録しました。\n管理番号: ${registeredBooks[0]}`;
    
    return { success: true, message: message };
  } catch (error) {
    console.error(`書籍登録中にエラーが発生しました: ${error}`);
    return { success: false, message: `書籍登録中にエラーが発生しました: ${error.message}` };
  }
}

/**
 * 書籍の状態を更新する関数（複数冊管理対応）
 * @param {string} bookId - 書籍ID（管理番号）
 * @param {string} status - 新しい状態（"在庫" or "貸出中"）
 */
function updateBookStatus(bookId, status) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    // TextFinderで管理番号(A列)の行を特定し、G列(状態)のみ更新する
    const rowNumber = findRowByValue_(bookSheet, 1, bookId);
    if (rowNumber !== -1) {
      bookSheet.getRange(rowNumber, 7).setValue(status);
      console.log(`書籍状態更新: ${bookId} → ${status}`);
      return;
    }

    console.warn(`書籍ID ${bookId} が見つかりませんでした。`);
  } catch (error) {
    console.error(`書籍状態の更新中にエラーが発生しました: ${error}`);
    throw error;
  }
}

/**
 * 利用者の詳細情報を取得する関数
 * @param {string} userId - 利用者ID
 * @return {object|null} 利用者情報オブジェクト
 */
function getUserDetails(userId) {
  if (!userId) {
    console.error("利用者IDが指定されていません。");
    return null;
  }
  
  console.log(`getUserDetails: 利用者情報検索開始: UserID=${userId}`);
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("利用者DB");
    if (!userSheet) {
      console.error("利用者DBシートが見つかりません。");
      return null;
    }
    
    // ヘッダー: A:利用者ID, B:氏名, C:メール, D:電話番号, E:住所, F:登録日
    // TextFinderでA列を検索(既存挙動に合わせて大文字小文字は無視)
    const rowNumber = findRowByValue_(userSheet, 1, userId, { matchCase: false });
    if (rowNumber !== -1) {
      // 既存シートが6列(状態列なし)の場合に範囲外エラーにならないよう実列数でクランプする
      const row = userSheet.getRange(rowNumber, 1, 1, Math.min(SCHEMA["利用者DB"].headers.length, userSheet.getMaxColumns())).getValues()[0];
      const rowUserId = row[0] ? row[0].toString().trim() : "";

      // 論理削除された利用者は「見つからない」扱いにする(PIIも返さない)
      if ((row[SCHEMA["利用者DB"].col.状態] || "").toString().trim() === "削除済み") {
        console.warn(`getUserDetails: 利用者ID ${userId} は削除済みです。`);
        return null;
      }

      // 日付を文字列に変換して返す
      const registrationDate = row[5] || null;
      const lastUseDate = getLastUseDate(userId);

      const userDetails = {
        userId: rowUserId,
        name: row[1] || "",
        email: row[2] || "",
        phone: row[3] || "",
        address: row[4] || "",
        registrationDate: registrationDate instanceof Date ? registrationDate.toISOString() : (registrationDate || new Date().toISOString()),
        lastUseDate: lastUseDate instanceof Date ? lastUseDate.toISOString() : null
      };
      console.log(`getUserDetails: 利用者情報取得成功:`, userDetails);
      return userDetails;
    }

    console.log(`getUserDetails: 利用者ID ${userId} の情報が見つかりませんでした。`);
    return null;
  } catch (error) {
    console.error(`利用者情報の取得中にエラーが発生しました: ${error}`);
    throw new Error(`利用者情報の取得に失敗しました: ${error.message}`);
  }
}

/**
 * 利用者の最終利用日を取得する関数
 * @param {string} userId - 利用者ID
 * @return {Date|null} 最終利用日
 */
function getLastUseDate(userId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) return null;
    
    const data = lendingSheet.getDataRange().getValues();
    const userIdColIndex = 2; // C列
    const lendingDateColIndex = 4; // E列
    
    let lastDate = null;
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowUserId = data[i][userIdColIndex] ? data[i][userIdColIndex].toString().trim() : "";
      if (rowUserId.toLowerCase() === userId.trim().toLowerCase()) {
        const lendingDate = data[i][lendingDateColIndex];
        if (lendingDate instanceof Date && (!lastDate || lendingDate > lastDate)) {
          lastDate = lendingDate;
        }
      }
    }
    
    return lastDate;
  } catch (error) {
    console.error(`最終利用日の取得中にエラーが発生しました: ${error}`);
    return null;
  }
}

/**
 * 利用者の貸出履歴を取得する関数
 * @param {string} userId - 利用者ID
 * @return {Array} 貸出履歴の配列
 */
function getUserLendingHistory(userId) {
  if (!userId) return [];
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) return [];
    
    const data = lendingSheet.getDataRange().getValues();
    const userIdColIndex = 2; // C列
    const history = [];
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowUserId = data[i][userIdColIndex] ? data[i][userIdColIndex].toString().trim() : "";
      if (rowUserId.toLowerCase() === userId.trim().toLowerCase()) {
        history.push({
          bookId: data[i][0] || "",
          bookTitle: data[i][1] || "",
          lendingDate: toIsoString_(data[i][4]),
          dueDate: toIsoString_(data[i][5]),
          status: data[i][6] || "",
          returnDate: toIsoString_(data[i][7])
        });
      }
    }
    
    // 貸出日の降順でソート
    history.sort((a, b) => {
      const dateA = new Date(a.lendingDate);
      const dateB = new Date(b.lendingDate);
      return dateB - dateA;
    });
    
    return history;
  } catch (error) {
    console.error(`貸出履歴の取得中にエラーが発生しました: ${error}`);
    return [];
  }
}

/**
 * 利用者情報を更新する関数
 * @param {object} userData - 更新する利用者データ
 * @return {boolean} 更新成功の可否
 */
function updateUserInfo(userData) {
  return runWithScriptLock_(
    () => updateUserInfo_(userData),
    new Error(LOCK_BUSY_MESSAGE)
  );
}

function updateUserInfo_(userData) {
  if (!userData || !userData.userId) {
    throw new Error("利用者IDが指定されていません。");
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("利用者DB");
    if (!userSheet) {
      throw new Error("利用者DBシートが見つかりません。");
    }
    
    const data = userSheet.getDataRange().getValues();
    const userIdColIndex = 0; // A列
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowUserId = data[i][userIdColIndex] ? data[i][userIdColIndex].toString().trim() : "";
      if (rowUserId.toLowerCase() === userData.userId.trim().toLowerCase()) {
        // 既存の登録日を保持
        const registrationDate = data[i][5] || new Date();
        
        // 更新する行のデータを作成
        const updatedRow = [
          rowUserId, // 利用者ID（変更不可）
          userData.name || "",
          userData.email || "",
          userData.phone || "",
          userData.address || "",
          registrationDate
        ];
        
        // 行を更新
        userSheet.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
        console.log(`利用者情報を更新しました: ${userData.userId}`);
        return true;
      }
    }
    
    throw new Error("指定された利用者IDが見つかりません。");
  } catch (error) {
    console.error(`利用者情報の更新中にエラーが発生しました: ${error}`);
    throw new Error(`利用者情報の更新に失敗しました: ${error.message}`);
  }
}

/**
 * 利用者を削除する関数
 * @param {string} userId - 削除する利用者ID
 * @return {boolean} 削除成功の可否
 */
function deleteUser(userId) {
  return runWithScriptLock_(
    () => deleteUser_(userId),
    new Error(LOCK_BUSY_MESSAGE)
  );
}

function deleteUser_(userId) {
  if (!userId) {
    throw new Error("利用者IDが指定されていません。");
  }
  
  try {
    // まず貸出中の書籍がないか確認
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (lendingSheet) {
      const lendingData = lendingSheet.getDataRange().getValues();
      const userIdColIndex = 2; // C列
      const statusColIndex = 6; // G列
      
      for (let i = 1; i < lendingData.length; i++) {
        const rowUserId = lendingData[i][userIdColIndex] ? lendingData[i][userIdColIndex].toString().trim() : "";
        const status = lendingData[i][statusColIndex];
        if (rowUserId.toLowerCase() === userId.trim().toLowerCase() && status === "未返却") {
          throw new Error("貸出中の書籍があるため、利用者を削除できません。");
        }
      }
    }
    
    // 利用者DBから削除
    const userSheet = ss.getSheetByName("利用者DB");
    if (!userSheet) {
      throw new Error("利用者DBシートが見つかりません。");
    }
    
    const data = userSheet.getDataRange().getValues();
    const userIdColIndex = 0; // A列

    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowUserId = data[i][userIdColIndex] ? data[i][userIdColIndex].toString().trim() : "";
      if (rowUserId.toLowerCase() === userId.trim().toLowerCase()) {
        // 論理削除: 行は残して状態を「削除済み」にする。
        // 過去の貸出記録との参照を守り、同じ利用者IDの再発行も防ぐ
        ensureUserStatusColumn_();
        userSheet.getRange(i + 1, SCHEMA["利用者DB"].col.状態 + 1).setValue("削除済み");
        console.log(`利用者を論理削除しました: ${userId}`);
        return true;
      }
    }
    
    throw new Error("指定された利用者IDが見つかりません。");
  } catch (error) {
    console.error(`利用者の削除中にエラーが発生しました: ${error}`);
    throw new Error(`利用者の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 利用者DBの構造を確認するテスト関数
 */
function testUserDatabase_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName("利用者DB");
  
  if (!userSheet) {
    console.log("利用者DBシートが見つかりません");
    return "利用者DBシートが見つかりません";
  }
  
  const data = userSheet.getDataRange().getValues();
  let result = "=== 利用者DBシート構造 ===\n";
  result += "総行数: " + data.length + "\n";
  
  if (data.length > 0) {
    result += "ヘッダー行: " + JSON.stringify(data[0]) + "\n";
    result += "カラム数: " + data[0].length + "\n\n";
  }
  
  // 最初の5行のデータを表示
  for (let i = 0; i < Math.min(5, data.length); i++) {
    result += `行${i + 1}: ` + JSON.stringify(data[i]) + "\n";
  }
  
  // getUserDetailsをテスト
  if (data.length > 1 && data[1][0]) {
    const testUserId = data[1][0].toString();
    result += "\n=== getUserDetailsテスト ===\n";
    result += "テストするユーザーID: " + testUserId + "\n";
    const testResult = getUserDetails(testUserId);
    result += "getUserDetails結果: " + JSON.stringify(testResult) + "\n";
  }
  
  return result;
}

/**
 * getUserDetailsの簡易テスト関数
 */
function testGetUserDetails_() {
  const testId = "R00001";
  console.log("テスト開始: getUserDetails(" + testId + ")");
  
  try {
    const result = getUserDetails(testId);
    console.log("結果:", result);
    console.log("JSON:", JSON.stringify(result));
    return result;
  } catch (error) {
    console.error("エラー:", error);
    return { error: error.message };
  }
}

/**
 * 利用者DBのすべての利用者IDを取得する関数
 */
function getAllUserIds_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("利用者DB");
    
    if (!userSheet) {
      return { error: "利用者DBシートが見つかりません" };
    }
    
    const data = userSheet.getDataRange().getValues();
    const userIds = [];
    
    // ヘッダー行を除いて利用者IDを収集
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        userIds.push({
          id: data[i][0].toString(),
          name: data[i][1] || "名前なし",
          row: i + 1
        });
      }
    }
    
    return {
      count: userIds.length,
      users: userIds,
      headers: data[0] || []
    };
  } catch (error) {
    return { error: error.message };
  }
}

/**
 * スプレッドシートが開かれたときにカスタムメニューを追加する関数
 */
function onOpen() {
  // 日常運用で使う項目のみ表示する。運用開始時・環境再構築時のみ必要な
  // 一回きり系は下のコメントアウトを外して使う(関数自体は残している)。
  // コメントを外してもチェーンが壊れないよう、コメント行は必ず有効な
  // .addItem より前(セミコロンより前)に置くこと
  const menu = SpreadsheetApp.getUi()
      .createMenu('管理メニュー')
      // .addItem('初期セットアップ', 'setupLibrarySystemFromMenu')
      // .addItem('書籍DBを新レイアウトへ移行', 'migrateBookDbLayoutFromMenu')
      // .addItem('延滞通知トリガー設置(毎日9時)', 'installOverdueTriggerFromMenu')
      // .addItem('延滞通知トリガー解除', 'removeOverdueTriggerFromMenu')
      // .addItem('月次アーカイブトリガー設置(毎月1日)', 'installArchiveTriggerFromMenu')
      // .addItem('月次アーカイブトリガー解除', 'removeArchiveTriggerFromMenu')
      .addItem('スキーマ検証', 'validateSchemaFromMenu')
      .addItem('状態の整合性チェック・修復', 'checkBookStatusConsistencyFromMenu')
      .addItem('延滞リマインダー送信', 'sendOverdueRemindersFromMenu')
      .addItem('貸出状況レポート作成', 'generateLendingReport')
      .addItem('返却済データのバックアップ', 'showBackupDialog')
      .addItem('トリガー一括設置(延滞通知+返却リマインダー+月次アーカイブ)', 'installAllTriggersFromMenu')
      .addItem('トリガー一括解除', 'removeAllTriggersFromMenu');

  // 破壊的な開発用メニューは、設定DBの operationMode が development の
  // ときだけ表示する(本番データの誤リセット防止。設定読み取りに失敗しても
  // メニュー全体は壊さない)
  if (isDevelopmentMode_()) {
    menu.addItem('【開発用】データ初期化+ダミーデータ投入', 'seedDummyDataFromMenu');
  }
  menu.addToUi();
}

/**
 * 設定DBの operationMode が development かどうかを返す関数
 * 破壊的操作のガードに使うため、getLibrarySettings のキャッシュ(最大5分)を
 * 介さず設定DBシートを直接読む(シートを直接 normal に戻した直後でも
 * 古いキャッシュで実行できてしまわないように)。
 * 読み取りに失敗した場合は安全側に倒して false。
 * @return {boolean} 開発モードなら true
 */
function isDevelopmentMode_() {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("設定DB");
    if (!sheet || sheet.getLastRow() < 2) return false;
    const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
    for (const row of data) {
      if ((row[0] || "").toString().trim() === "operationMode") {
        return (row[1] || "").toString().trim() === "development";
      }
    }
    return false;
  } catch (error) {
    console.warn(`運用モードの取得に失敗しました(開発モード無効として扱います): ${error}`);
    return false;
  }
}

/**
 * 図書館管理システムの初期セットアップを行う関数
 * 必要な4シート(書籍DB・利用者DB・貸出記録・設定DB)を存在しなければ作成し、
 * 正しいヘッダー行を設定する。既存のデータには一切触れない(冪等)。
 * @return {object} 処理結果 {success: boolean, message: string, created: string[], skipped: string[]}
 */
function setupLibrarySystem() {
  // ヘッダー定義はSCHEMAが唯一の定義(設定DBは ensureSettingsSheet_ が担当)
  const sheetDefinitions = ["書籍DB", "利用者DB", "貸出記録", "予約DB"].map(name => ({
    name: name,
    headers: SCHEMA[name].headers
  }));

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const created = [];
    const skipped = [];

    sheetDefinitions.forEach(def => {
      let sheet = ss.getSheetByName(def.name);
      if (!sheet) {
        sheet = ss.insertSheet(def.name);
        created.push(def.name);
      } else if (sheet.getLastRow() > 0) {
        // 既にデータ(またはヘッダー)がある場合は上書きしない
        skipped.push(def.name);
        return;
      } else {
        created.push(def.name);
      }
      const headerRange = sheet.getRange(1, 1, 1, def.headers.length);
      headerRange.setValues([def.headers]);
      headerRange.setFontWeight("bold").setBackground("#f3f3f3");
      sheet.setFrozenRows(1);
      sheet.autoResizeColumns(1, def.headers.length);
    });

    // 既存の利用者DBに「状態」列(論理削除用・末尾追加)がなければヘッダーだけ補完する
    // (データには触れない。空=有効として扱われる)
    ensureUserStatusColumn_();

    // 設定DBは ensureSettingsSheet_ がデフォルト設定込みで初期化する
    // (シートが存在しない場合と、空タブとして手動作成済みの場合の両方に対応。
    //  getLibrarySettings はキャッシュヒット時にシートを作成しないためここでは使わない)
    const existingSettingsSheet = ss.getSheetByName("設定DB");
    const settingsExisted = !!existingSettingsSheet && existingSettingsSheet.getLastRow() > 0;
    ensureSettingsSheet_();
    if (settingsExisted) {
      skipped.push("設定DB");
    } else {
      created.push("設定DB");
    }

    const parts = [];
    if (created.length > 0) parts.push(`作成: ${created.join("、")}`);
    if (skipped.length > 0) parts.push(`既存のためスキップ: ${skipped.join("、")}`);
    const message = `初期セットアップが完了しました。${parts.join(" / ")}`;
    console.log(message);
    return { success: true, message: message, created: created, skipped: skipped };
  } catch (error) {
    console.error(`初期セットアップ中にエラーが発生しました: ${error}`);
    return { success: false, message: `初期セットアップに失敗しました: ${error.message}`, created: [], skipped: [] };
  }
}

/**
 * スプレッドシートのメニューから初期セットアップを実行し、結果をダイアログ表示する関数
 */
function setupLibrarySystemFromMenu() {
  const result = setupLibrarySystem();
  SpreadsheetApp.getUi().alert(
    result.success ? '初期セットアップ' : '初期セットアップ失敗',
    result.message,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * 管理メニューからスキーマ検証を実行する関数
 */
function validateSchemaFromMenu() {
  const result = validateSchema_();
  SpreadsheetApp.getUi().alert(
    result.success ? 'スキーマ検証: 問題なし' : 'スキーマ検証: ずれを検出',
    result.message,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * 各シートの実ヘッダーをSCHEMAの定義と突き合わせて検証する関数
 * 列のずれ・欠落・シート不在を検出する(読み取りのみで何も変更しない)。
 * @return {object} 検証結果 {success: boolean, message: string, problems: string[]}
 */
function validateSchema_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const problems = [];

    for (const [sheetName, def] of Object.entries(SCHEMA)) {
      const sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        problems.push(`シート「${sheetName}」が存在しません(初期セットアップ未実行の可能性)`);
        continue;
      }
      if (sheet.getLastRow() === 0) {
        problems.push(`シート「${sheetName}」が空です(ヘッダーがありません)`);
        continue;
      }
      // グリッドが定義より狭いシートでも範囲外エラーにせず「(列なし)」として報告する
      const width = Math.min(def.headers.length, sheet.getMaxColumns());
      const actual = sheet.getRange(1, 1, 1, width).getValues()[0]
        .map(v => (v === undefined || v === null) ? "" : v.toString().trim());
      def.headers.forEach((expected, idx) => {
        const actualValue = idx < width ? actual[idx] : "(列なし)";
        if (actualValue !== expected) {
          const colLetter = String.fromCharCode(65 + idx);
          problems.push(`「${sheetName}」${colLetter}列: 期待「${expected}」/ 実際「${actualValue || "(空)"}」`);
        }
      });
    }

    if (problems.length === 0) {
      return { success: true, message: "全シートのヘッダーはSCHEMA定義と一致しています。", problems: [] };
    }
    return {
      success: false,
      message: "スキーマのずれを検出しました。列の並びが定義と異なるとデータが誤読されます:\n\n" +
        problems.join("\n") +
        "\n\n書籍DBが旧レイアウトの場合はonOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。",
      problems: problems
    };
  } catch (error) {
    console.error(`スキーマ検証中にエラーが発生しました: ${error}`);
    return { success: false, message: `スキーマ検証に失敗しました: ${error.message}`, problems: [] };
  }
}

/**
 * 管理メニューから状態の整合性チェック(必要なら修復)を実行する関数
 * 真実は貸出記録側にあると定義し、書籍DB.状態のずれを検知・修復する。
 */
function checkBookStatusConsistencyFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const analysis = analyzeBookStatusConsistency_();
  if (!analysis.success) {
    ui.alert('整合性チェック失敗', analysis.message, ui.ButtonSet.OK);
    return;
  }
  if (analysis.mismatches.length === 0 && analysis.orphans.length === 0 && analysis.doubleLent.length === 0) {
    ui.alert('整合性チェック: 問題なし', analysis.message, ui.ButtonSet.OK);
    return;
  }
  if (analysis.mismatches.length === 0) {
    // 修復対象(状態のずれ)はないが、警告(孤児・二重貸出)はある
    ui.alert('整合性チェック: 警告あり', analysis.message, ui.ButtonSet.OK);
    return;
  }
  const confirm = ui.alert(
    '整合性チェック: ずれを検出',
    analysis.message + '\n\n書籍DBの状態列を貸出記録に合わせて修復しますか?',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  const result = repairBookStatus();
  ui.alert(result.success ? '修復完了' : '修復失敗', result.message, ui.ButtonSet.OK);
}

/**
 * 書籍DB.状態と貸出記録(未返却)のずれを分析する関数(読み取りのみ)
 * @return {object} {success, message, mismatches: [{rowNumber, managementNumber, title, actual, expected}],
 *                   orphans: string[](書籍DBに存在しない未返却書籍ID),
 *                   doubleLent: string[](未返却が2件以上ある書籍ID)}
 */
function analyzeBookStatusConsistency_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!bookSheet || !lendingSheet) {
      return { success: false, message: "書籍DBまたは貸出記録シートが見つかりません。", mismatches: [], orphans: [], doubleLent: [] };
    }
    if (!isNewBookLayout_(bookSheet)) {
      return { success: false, message: "書籍DBが旧レイアウトです。先にonOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。", mismatches: [], orphans: [], doubleLent: [] };
    }

    // 貸出記録から未返却の書籍IDごとの件数を集計
    const unreturnedCounts = new Map();
    if (lendingSheet.getLastRow() > 1) {
      const lendingData = lendingSheet.getRange(1, 1, lendingSheet.getLastRow(), SCHEMA["貸出記録"].headers.length).getValues();
      for (let i = 1; i < lendingData.length; i++) {
        if (lendingData[i][SCHEMA["貸出記録"].col.返却状況] === "未返却" && lendingData[i][SCHEMA["貸出記録"].col.書籍ID]) {
          const id = lendingData[i][SCHEMA["貸出記録"].col.書籍ID].toString().trim().toLowerCase();
          unreturnedCounts.set(id, (unreturnedCounts.get(id) || 0) + 1);
        }
      }
    }

    // 書籍DBの各行の状態を照合
    const mismatches = [];
    const knownIds = new Set();
    if (bookSheet.getLastRow() > 1) {
      const bookData = bookSheet.getRange(1, 1, bookSheet.getLastRow(), SCHEMA["書籍DB"].headers.length).getValues();
      for (let i = 1; i < bookData.length; i++) {
        const managementNumber = bookData[i][SCHEMA["書籍DB"].col.管理番号];
        if (!managementNumber) continue;
        const idKey = managementNumber.toString().trim().toLowerCase();
        knownIds.add(idKey);
        const actual = (bookData[i][SCHEMA["書籍DB"].col.状態] || "在庫").toString().trim();
        // 論理削除(廃棄)の本は未返却がない限り対象外(修復で在庫に戻さない)
        if (actual === "廃棄" && !unreturnedCounts.has(idKey)) continue;
        const expected = unreturnedCounts.has(idKey) ? "貸出中" : "在庫";
        if (actual !== expected) {
          mismatches.push({
            rowNumber: i + 1,
            managementNumber: managementNumber.toString().trim(),
            title: bookData[i][SCHEMA["書籍DB"].col.書籍名] || "",
            actual: actual,
            expected: expected
          });
        }
      }
    }

    // 警告: 書籍DBに存在しない未返却書籍ID(孤児)と、二重貸出
    const orphans = [];
    const doubleLent = [];
    for (const [id, count] of unreturnedCounts.entries()) {
      if (!knownIds.has(id)) orphans.push(id);
      if (count > 1) doubleLent.push(`${id}(未返却${count}件)`);
    }

    const lines = [];
    const LIST_LIMIT = 20;
    if (mismatches.length > 0) {
      lines.push(`状態のずれ: ${mismatches.length}件`);
      mismatches.slice(0, LIST_LIMIT).forEach(m =>
        lines.push(`  ${m.managementNumber}「${m.title}」: ${m.actual} → ${m.expected}`));
      if (mismatches.length > LIST_LIMIT) lines.push(`  …他 ${mismatches.length - LIST_LIMIT}件`);
    }
    if (orphans.length > 0) {
      lines.push(`書籍DBに存在しない未返却の書籍ID(要手動確認): ${orphans.slice(0, LIST_LIMIT).join(", ")}${orphans.length > LIST_LIMIT ? " …" : ""}`);
    }
    if (doubleLent.length > 0) {
      lines.push(`同じ本に未返却が複数ある(二重貸出の疑い・要手動確認): ${doubleLent.slice(0, LIST_LIMIT).join(", ")}${doubleLent.length > LIST_LIMIT ? " …" : ""}`);
    }
    if (lines.length === 0) {
      lines.push("書籍DBの状態と貸出記録は一致しています。");
    }

    return { success: true, message: lines.join("\n"), mismatches: mismatches, orphans: orphans, doubleLent: doubleLent };
  } catch (error) {
    console.error(`整合性チェック中にエラーが発生しました: ${error}`);
    return { success: false, message: `整合性チェックに失敗しました: ${error.message}`, mismatches: [], orphans: [], doubleLent: [] };
  }
}

/**
 * 書籍DB.状態のずれを貸出記録に合わせて修復する関数
 * @return {object} 処理結果 {success: boolean, message: string, repaired: number}
 */
function repairBookStatus() {
  return runWithScriptLock_(
    () => repairBookStatus_(),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function repairBookStatus_() {
  try {
    // ロック取得後に再分析する(確認ダイアログ表示中の変化に備える)
    const analysis = analyzeBookStatusConsistency_();
    if (!analysis.success) {
      return { success: false, message: analysis.message, repaired: 0 };
    }
    if (analysis.mismatches.length === 0) {
      return { success: true, message: "修復対象のずれはありませんでした。", repaired: 0 };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    const statusColNumber = SCHEMA["書籍DB"].col.状態 + 1;
    analysis.mismatches.forEach(m => {
      bookSheet.getRange(m.rowNumber, statusColNumber).setValue(m.expected);
    });

    const message = `書籍DBの状態を${analysis.mismatches.length}件修復しました(貸出記録の未返却に合わせて更新)。`;
    console.log(message);
    return { success: true, message: message, repaired: analysis.mismatches.length };
  } catch (error) {
    console.error(`状態の修復中にエラーが発生しました: ${error}`);
    return { success: false, message: `状態の修復に失敗しました: ${error.message}`, repaired: 0 };
  }
}

/**
 * 管理メニューから書籍DBのレイアウト移行を実行する関数
 */
function migrateBookDbLayoutFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const confirm = ui.alert(
    '書籍DBを新レイアウトへ移行',
    '書籍DBを新レイアウト(管理番号/ISBN/書籍名/著者名/出版社/備考/状態)へ変換します。\n' +
    '旧形式の行は列をずらして変換し、既に新形式の行はそのまま維持します。\n実行しますか?',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  const result = migrateBookDbLayout();
  ui.alert(
    result.success ? '書籍DB移行' : '書籍DB移行失敗',
    result.message,
    ui.ButtonSet.OK
  );
}

/**
 * 書籍DBを新レイアウトへ移行する関数
 * 旧レイアウト(A:書籍ID, B:書籍名, C:著者名, D:出版社, E:備考)のヘッダーのまま
 * 新レイアウトの行が追記されて混在した状態を解消する。冪等(新形式の行はそのまま)。
 * @return {object} 処理結果 {success: boolean, message: string, migrated: number, kept: number}
 */
function migrateBookDbLayout() {
  return runWithScriptLock_(
    () => migrateBookDbLayout_(),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function migrateBookDbLayout_() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      return { success: false, message: "書籍DBシートが見つかりません。" };
    }
    if (bookSheet.getLastRow() === 0) {
      return { success: false, message: "書籍DBが空のため移行は不要です。初期セットアップを実行してください。" };
    }
    if (isNewBookLayout_(bookSheet)) {
      return { success: true, message: "書籍DBは既に新レイアウトです。移行は不要です。", migrated: 0, kept: 0 };
    }

    const data = bookSheet.getDataRange().getValues();

    // 状態(在庫/貸出中)の導出用に、貸出記録から未返却の書籍IDを集める
    const unreturnedIds = new Set();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (lendingSheet && lendingSheet.getLastRow() > 1) {
      const lendingData = lendingSheet.getRange(1, 1, lendingSheet.getLastRow(), 7).getValues();
      for (let i = 1; i < lendingData.length; i++) {
        if (lendingData[i][6] === "未返却" && lendingData[i][0]) {
          unreturnedIds.add(lendingData[i][0].toString().trim().toLowerCase());
        }
      }
    }

    const newRows = [];
    let migrated = 0;
    let kept = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const colA = row[0] === undefined || row[0] === null ? "" : row[0].toString().trim();
      const colB = row[1] === undefined || row[1] === null ? "" : row[1].toString().trim();
      if (!colA) continue; // 空行は除去

      // 新形式の行の判定: B列が妥当なISBNで、A列(管理番号)がそのISBNから始まる
      const normalizedB = normalizeIsbn_(colB);
      const isNewFormatRow = isValidIsbn_(normalizedB) && colA.indexOf(normalizedB) === 0;

      // 状態は既存のG列を信用せず、全行とも貸出記録(未返却)から導出する。
      // 旧ヘッダーのシートでは貸出・返却時の状態更新が正しい列に届いておらず、
      // 新形式の行でもG列が古いままの可能性があるため
      const status = unreturnedIds.has(colA.toLowerCase()) ? "貸出中" : "在庫";

      if (isNewFormatRow) {
        newRows.push([colA, normalizedB, row[2] || "", row[3] || "", row[4] || "", row[5] || "", status]);
        kept++;
      } else {
        // 旧形式: A=書籍ID(通常ISBN), B=書籍名, C=著者名, D=出版社, E=備考
        // 管理番号には元の書籍IDをそのまま使い、貸出記録との対応を維持する
        const normalizedA = normalizeIsbn_(colA);
        const isbn = isValidIsbn_(normalizedA) ? normalizedA : "";
        newRows.push([colA, isbn, colB, row[2] || "", row[3] || "", row[4] || "", status]);
        migrated++;
      }
    }

    // ヘッダーと全データ行を新レイアウトで書き戻す
    bookSheet.getRange(1, 1, 1, SCHEMA["書籍DB"].headers.length).setValues([SCHEMA["書籍DB"].headers]);
    bookSheet.getRange(1, 1, 1, 7).setFontWeight("bold").setBackground("#f3f3f3");
    if (newRows.length > 0) {
      bookSheet.getRange(2, 1, newRows.length, 7).setValues(newRows);
    }
    // 空行除去などで行数が減った場合、残った旧データをクリアする
    const oldDataRows = data.length - 1;
    if (oldDataRows > newRows.length) {
      bookSheet.getRange(2 + newRows.length, 1, oldDataRows - newRows.length, bookSheet.getLastColumn()).clearContent();
    }

    const message = `書籍DBを新レイアウトへ移行しました。旧形式から変換: ${migrated}件 / 既に新形式: ${kept}件`;
    console.log(message);
    return { success: true, message: message, migrated: migrated, kept: kept };
  } catch (error) {
    console.error(`書籍DBの移行中にエラーが発生しました: ${error}`);
    return { success: false, message: `書籍DBの移行に失敗しました: ${error.message}` };
  }
}

/**
 * 返却済データのバックアップ用ダイアログを表示する関数
 */
function showBackupDialog() {
  const ui = SpreadsheetApp.getUi();
  const result = ui.prompt(
    '返却済データのバックアップ',
    'バックアップ先のスプレッドシートIDを入力してください：\n（例: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms）',
    ui.ButtonSet.OK_CANCEL
  );

  // OKボタンがクリックされた場合
  if (result.getSelectedButton() == ui.Button.OK) {
    const targetSpreadsheetId = result.getResponseText().trim();
    
    // 入力値の検証
    if (!targetSpreadsheetId) {
      ui.alert('エラー', 'スプレッドシートIDが入力されていません。', ui.ButtonSet.OK);
      return;
    }
    
    try {
      // バックアップ処理を実行
      const result = backupReturnedData(targetSpreadsheetId);
      
      // 結果をアラートで表示
      if (result.success) {
        ui.alert('成功', `${result.count}件の返却済データをバックアップし、元のシートから削除しました。`, ui.ButtonSet.OK);
      } else {
        ui.alert('エラー', `バックアップ処理に失敗しました: ${result.message}`, ui.ButtonSet.OK);
      }
    } catch (error) {
      ui.alert('エラー', `予期せぬエラーが発生しました: ${error.message}`, ui.ButtonSet.OK);
    }
  }
}

/**
 * 返却済データをバックアップし、元のシートから削除する関数
 * @param {string} targetSpreadsheetId - バックアップ先のスプレッドシートID
 * @return {object} 処理結果 {success: boolean, count: number, message: string}
 */
function backupReturnedData(targetSpreadsheetId) {
  return runWithScriptLock_(
    () => backupReturnedData_(targetSpreadsheetId),
    { success: false, count: 0, message: LOCK_BUSY_MESSAGE }
  );
}

function backupReturnedData_(targetSpreadsheetId) {
  try {
    // 現在のスプレッドシート（元データ）を取得
    const sourceSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = sourceSpreadsheet.getSheetByName("貸出記録");
    
    if (!lendingSheet) {
      return { success: false, count: 0, message: "貸出記録シートが見つかりません。" };
    }
    
    // バックアップ先のスプレッドシートを取得
    let targetSpreadsheet;
    try {
      targetSpreadsheet = SpreadsheetApp.openById(targetSpreadsheetId);
    } catch (e) {
      return { success: false, count: 0, message: "指定されたスプレッドシートが見つかりません。IDを確認してください。" };
    }
    
    // バックアップ先のシート1を取得（なければ作成）
    let targetSheet = targetSpreadsheet.getSheetByName("Sheet1");
    if (!targetSheet) {
      targetSheet = targetSpreadsheet.getSheets()[0]; // 最初のシートを取得
      if (!targetSheet) {
        return { success: false, count: 0, message: "バックアップ先にシートが見つかりません。" };
      }
    }
    
    // 元データの全行を取得。ヘッダー行のみでも早期リターンせず、
    // バックアップ先の互換性・書き込み可否の検証まで進める
    // (トリガー設置時の疎通確認が素通りしないように)
    const data = lendingSheet.getDataRange().getValues();
    if (data.length === 0 || data[0].every(cell => cell === "")) {
      return { success: false, count: 0, message: "貸出記録シートにヘッダーがありません。初期セットアップを実行してください。" };
    }

    // ヘッダー行
    const headers = data[0];

    // 旧形式のシートは返却処理がH列へ返却日時を書いてもH1ヘッダーが空のままのことがある。
    // ヘッダーと実データの列がずれたままバックアップすると、返却日時が
    // バックアップ先の別名列(最終通知日など)に紛れ込むため、先にH1を正規化する
    if (headers.length >= 8 && !headers[7]) {
      lendingSheet.getRange(1, 8).setValue("返却日時");
      headers[7] = "返却日時";
    }

    // 返却状況の列インデックスを特定
    const statusColIndex = headers.findIndex(header => header === "返却状況");
    if (statusColIndex === -1) {
      return { success: false, count: 0, message: "返却状況の列が見つかりません。" };
    }
    
    // バックアップ先のヘッダーを確認する(既存のバックアップデータは決して消さない)。
    // 対象0件でも先に互換性・書き込み可否を検証することで、トリガー設置時の
    // 疎通確認としても機能させる(0件成功で検証をスキップしない)
    const targetData = targetSheet.getDataRange().getValues();
    const targetIsEmpty = targetData.length === 0 ||
      (targetData.length === 1 && targetData[0].every(cell => cell === ""));
    if (targetIsEmpty) {
      targetSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    } else {
      // 末尾の空セルのみ除去する(途中の空セルは列ずれとして検出したいので位置を保持する)
      // 元シート側のH1は上で正規化済みのため、双方とも末尾の空セル除去だけで比較できる
      const trimTrailingBlanks = arr => {
        const copy = arr.slice();
        while (copy.length > 0 && copy[copy.length - 1] === "") {
          copy.pop();
        }
        return copy;
      };
      // バックアップ先も過去のバックアップでH列に返却日時が入っているのにH1が空の
      // 旧形式のことがあるため、元シートと同様に正規化する。誤って無関係なシートへ
      // ヘッダーを書き込まないよう、A〜Gの7列が元シートと一致する場合に限る
      const targetHeaderRow = targetData[0].slice();
      const targetPrefixMatches =
        targetHeaderRow.slice(0, 7).join("\t") === headers.slice(0, 7).join("\t");
      if (targetPrefixMatches && targetData.length > 1 &&
          targetHeaderRow.length >= 8 && !targetHeaderRow[7]) {
        targetSheet.getRange(1, 8).setValue("返却日時");
        targetHeaderRow[7] = "返却日時";
      }
      const targetHeaders = trimTrailingBlanks(targetHeaderRow);
      const sourceHeaders = trimTrailingBlanks(headers);
      // 貸出記録の元来の列構成(A:書籍ID〜G:返却状況、H:返却日時があればそこまで)は
      // 最低限そろっていることを要求する(先頭数列だけ偶然一致する無関係なシートへの誤追記を防ぐ)
      const returnDateHeaderIndex = sourceHeaders.findIndex(h => h === "返却日時");
      const requiredColumnCount = returnDateHeaderIndex >= 0
        ? returnDateHeaderIndex + 1
        : Math.min(sourceHeaders.length, 7);
      const overlap = Math.min(targetHeaders.length, sourceHeaders.length);
      // 片側にしか存在しない列は通知系の管理列(最終通知日・リマインダー送信日)のみ許容する
      // (無関係な列を持つシートへの誤追記や、返却日時が別名列に紛れ込むのを防ぐ)
      const allowedExtraColumns = ["最終通知日", "リマインダー送信日", "延長回数"];
      const extraColumnsAllowed =
        targetHeaders.slice(overlap).every(h => allowedExtraColumns.indexOf(h) !== -1) &&
        sourceHeaders.slice(overlap).every(h => allowedExtraColumns.indexOf(h) !== -1);
      const isCompatible = targetHeaders.length >= requiredColumnCount &&
        targetHeaders.slice(0, overlap).join("\t") === sourceHeaders.slice(0, overlap).join("\t") &&
        extraColumnsAllowed;
      if (!isCompatible) {
        return {
          success: false,
          count: 0,
          message: "バックアップ先のヘッダーが貸出記録と一致しません。既存データ保護のため処理を中止しました。"
        };
      }
      // 元シートに列が追加された場合(例: 最終通知日)はヘッダー行だけ拡張する
      if (headers.length > targetHeaders.length) {
        targetSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
    }
    
    // 書き込み権限の確認(先頭セルへ同じ値を書き戻す無害なプローブ。
    // 閲覧のみの権限だとここで例外になり、空振りするトリガーの設置を防げる)
    try {
      const probe = targetSheet.getRange(1, 1);
      probe.setValue(probe.getValue());
    } catch (e) {
      return { success: false, count: 0, message: `バックアップ先に書き込めません(編集権限を確認してください): ${e.message}` };
    }

    // 返却済みデータを抽出
    const returnedData = data.filter((row, index) =>
      index > 0 && row[statusColIndex] === "返却済"
    );

    if (returnedData.length === 0) {
      return { success: true, count: 0, message: "バックアップ対象の返却済データはありません(バックアップ先の検証は成功しました)。" };
    }

    // 返却済みデータをバックアップ先に追加
    targetSheet.getRange(
      targetSheet.getLastRow() + 1,
      1,
      returnedData.length,
      headers.length
    ).setValues(returnedData);
    
    // 元シートから返却済みデータを削除（下から削除していく）
    const rowsToDelete = [];
    for (let i = data.length - 1; i > 0; i--) {
      if (data[i][statusColIndex] === "返却済") {
        rowsToDelete.push(i + 1); // シートの行番号は1から始まるため+1
      }
    }
    
    // 行を削除
    rowsToDelete.forEach(rowNum => {
      lendingSheet.deleteRow(rowNum);
    });
    
    return { 
      success: true, 
      count: returnedData.length, 
      message: `${returnedData.length}件の返却済データをバックアップしました。` 
    };
    
  } catch (error) {
    console.error("バックアップ処理中にエラーが発生しました:", error);
    return { success: false, count: 0, message: error.message };
  }
}

/**
 * 貸出状況レポートを生成する関数
 * 現在の貸出状況を新しいシートに出力する
 */
function generateLendingReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const lendingSheet = ss.getSheetByName("貸出記録");
  
  if (!lendingSheet) {
    SpreadsheetApp.getUi().alert("シート「貸出記録」が見つかりません。");
    return;
  }
  
  // 現在の日時を取得してレポート名に使用
  const now = new Date();
  const reportName = `貸出状況レポート_${Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmm")}`;
  
  // 既存のレポートシートがあれば削除
  const existingSheet = ss.getSheetByName(reportName);
  if (existingSheet) {
    ss.deleteSheet(existingSheet);
  }
  
  // 新しいシートを作成
  const reportSheet = ss.insertSheet(reportName);
  
  // ヘッダー行を設定
  reportSheet.getRange("A1:H1").setValues([["書籍ID", "書籍名", "利用者ID", "利用者名", "貸出日時", "返却予定日", "返却状況", "返却日時"]]);
  reportSheet.getRange("A1:H1").setFontWeight("bold").setBackground("#f3f3f3");
  
  // 貸出記録データを取得
  const data = lendingSheet.getDataRange().getValues();
  
  // ヘッダー行を除いたデータを新しいシートにコピー
  // (レポートのヘッダーはA:Hの8列固定のため、最終通知日などI列以降は含めない)
  if (data.length > 1) {
    const reportColumnCount = Math.min(data[0].length, 8);
    reportSheet.getRange(2, 1, data.length - 1, reportColumnCount)
      .setValues(data.slice(1).map(row => row.slice(0, reportColumnCount)));
  }
  
  // 列幅を自動調整
  reportSheet.autoResizeColumns(1, 8);
  
  // 未返却の行を強調表示
  const statusColumn = 7; // G列
  for (let i = 2; i <= data.length; i++) {
    if (reportSheet.getRange(i, statusColumn).getValue() === "未返却") {
      reportSheet.getRange(i, 1, 1, 8).setBackground("#ffebee"); // 薄い赤色
    }
  }
  
  // 返却期限が過ぎている行をさらに強調
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 時刻部分をリセット
  const dueDateColumn = 6; // F列
  
  for (let i = 2; i <= data.length; i++) {
    const status = reportSheet.getRange(i, statusColumn).getValue();
    const dueDate = reportSheet.getRange(i, dueDateColumn).getValue();
    
    if (status === "未返却" && dueDate instanceof Date && !isNaN(dueDate) && dueDate < today) {
      reportSheet.getRange(i, 1, 1, 8).setBackground("#f8bbd0"); // より濃い赤色
      reportSheet.getRange(i, dueDateColumn).setFontWeight("bold").setFontColor("#d32f2f"); // 返却期限を赤太字
    }
  }
  
  // フィルターを設定
  reportSheet.getRange(1, 1, data.length, 8).createFilter();
  
  // 作成したシートをアクティブにする
  ss.setActiveSheet(reportSheet);
  
  SpreadsheetApp.getUi().alert(`貸出状況レポート「${reportName}」を作成しました。`);
}

/**
 * ラベル印刷用の対象一覧を取得する関数
 * @param {string} type - "books"(書籍・廃棄を除く) または "users"(利用者・削除済みを除く)
 * @return {Array<{id: string, label: string}>} ラベル対象の配列
 */
function getLabelItems(type) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (type === "users") {
      const userSheet = ss.getSheetByName("利用者DB");
      if (!userSheet || userSheet.getLastRow() < 2) return [];
      const col = SCHEMA["利用者DB"].col;
      const width = Math.min(SCHEMA["利用者DB"].headers.length, userSheet.getMaxColumns());
      const data = userSheet.getRange(2, 1, userSheet.getLastRow() - 1, width).getValues();
      return data
        .filter(row => row[col.利用者ID] &&
          ((row[col.状態] === undefined ? "" : row[col.状態]) || "").toString().trim() !== "削除済み")
        .map(row => ({
          id: row[col.利用者ID].toString().trim(),
          label: (row[col.氏名] || "").toString()
        }));
    }

    // 既定は書籍(廃棄を除く)
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) return [];
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }
    if (bookSheet.getLastRow() < 2) return [];
    const col = SCHEMA["書籍DB"].col;
    const data = bookSheet.getRange(2, 1, bookSheet.getLastRow() - 1, SCHEMA["書籍DB"].headers.length).getValues();
    return data
      .filter(row => row[col.管理番号] && (row[col.状態] || "").toString().trim() !== "廃棄")
      .map(row => ({
        id: row[col.管理番号].toString().trim(),
        label: (row[col.書籍名] || "").toString()
      }));
  } catch (error) {
    console.error(`ラベル対象の取得中にエラーが発生しました: ${error}`);
    throw new Error(`ラベル対象の取得に失敗しました: ${error.message}`);
  }
}

/**
 * 新しい利用者IDを生成する関数
 * @return {string} 新しい利用者ID (例: R00001)
 */
function generateNewUserId() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("利用者DB");
    
    if (!userSheet) {
      throw new Error("利用者DBシートが見つかりません。");
    }
    
    // 既存の利用者IDを取得
    const data = userSheet.getDataRange().getValues();
    const userIdColIndex = 0; // A列
    
    console.log(`利用者DBのデータ行数: ${data.length}`);
    
    let maxNumber = 0;
    
    // データが1行以下（ヘッダーのみまたは空）の場合
    if (data.length <= 1) {
      console.log("利用者DBが空です。最初のIDを生成します。");
      return 'R00001';
    }
    
    // ヘッダー行を除いて最大の番号を探す
    for (let i = 1; i < data.length; i++) {
      const userId = data[i][userIdColIndex];
      console.log(`行 ${i + 1}: userId = ${userId}`);
      if (userId && typeof userId === 'string' && userId.startsWith('R')) {
        // "R00001" から数字部分を抽出
        const numberPart = userId.substring(1);
        const number = parseInt(numberPart, 10);
        console.log(`数字部分: ${numberPart}, 数値: ${number}`);
        if (!isNaN(number) && number > maxNumber) {
          maxNumber = number;
        }
      }
    }
    
    // 次の番号を生成
    const nextNumber = maxNumber + 1;
    const nextUserId = 'R' + nextNumber.toString().padStart(5, '0');
    
    console.log(`生成された新しい利用者ID: ${nextUserId}`);
    return nextUserId;
  } catch (error) {
    console.error(`利用者ID生成中にエラーが発生しました: ${error}`);
    throw new Error(`利用者IDの生成に失敗しました: ${error.message}`);
  }
}

/**
 * 利用者をスプレッドシートの利用者DBに登録する関数
 * @param {object} userData - 利用者データ {userId, userName, userAddress, userEmail, userPhone}
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function registerUser(userData) {
  return runWithScriptLock_(
    () => registerUser_(userData),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function registerUser_(userData) {
  const missing = validateRequired_(userData, { userName: "氏名", userAddress: "住所" });
  if (missing.length > 0) {
    return { success: false, message: `次の必須項目が入力されていません: ${missing.join("、")}` };
  }
  if (userData.userEmail && !isValidEmail_(userData.userEmail)) {
    return { success: false, message: `メールアドレスの形式が正しくありません: ${userData.userEmail}` };
  }

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const userSheet = ss.getSheetByName("利用者DB");

    if (!userSheet) {
      return { success: false, message: "利用者DBシートが見つかりません。" };
    }

    // 利用者IDの重複チェック（クライアント側でIDを採番してから登録するまでの間に
    // 別端末が同じIDで登録している可能性があるため、ロック内で再採番する）
    if (userData.userId) {
      const existingIds = userSheet.getDataRange().getValues()
        .slice(1)
        .map(row => (row[0] || "").toString().trim());
      if (existingIds.includes(userData.userId.toString().trim())) {
        userData.userId = generateNewUserId();
      }
    }

    // 新しい行を追加
    const newRow = [
      userData.userId,
      userData.userName,
      userData.userEmail || "",
      userData.userPhone || "",
      userData.userAddress,
      new Date() // 登録日
    ];
    
    userSheet.appendRow(newRow);
    
    // メールが入力されている場合は登録完了メールを送信
    if (userData.userEmail) {
      // 設定を確認
      try {
        const settings = getLibrarySettings();
        if (settings.enableEmail !== false) {
          sendRegistrationEmail(userData);
        }
      } catch (e) {
        // 設定取得に失敗してもメールは送信する（デフォルト動作）
        sendRegistrationEmail(userData);
      }
    }
    
    return { success: true, message: `利用者「${userData.userName}」を登録しました。利用者ID: ${userData.userId}` };
  } catch (error) {
    console.error(`利用者登録中にエラーが発生しました: ${error}`);
    return { success: false, message: `利用者登録中にエラーが発生しました: ${error.message}` };
  }
}

/**
 * 利用者登録完了メールを送信する関数
 * @param {object} userData - 利用者データ
 */
function sendRegistrationEmail(userData) {
  try {
    // 設定から図書館名を取得
    let libraryName = "図書館";
    try {
      const settings = getLibrarySettings();
      if (settings.libraryName) {
        libraryName = settings.libraryName;
      }
    } catch (e) {
      // デフォルト値を使用
    }
    
    const subject = `${libraryName}利用者登録完了のお知らせ`;
    
    const body = `
${userData.userName} 様

この度は、${libraryName}システムにご登録いただきありがとうございます。
以下の内容で利用者登録が完了しました。

【登録情報】
利用者ID: ${userData.userId}
氏名: ${userData.userName}
住所: ${userData.userAddress}
メールアドレス: ${userData.userEmail}
電話番号: ${userData.userPhone || "未登録"}

利用者IDは図書の貸出・返却時に必要となりますので、大切に保管してください。

今後ともよろしくお願いいたします。

${libraryName}管理システム
`;

    GmailApp.sendEmail(userData.userEmail, subject, body);
    console.log(`登録完了メールを送信しました: ${userData.userEmail}`);
  } catch (error) {
    console.error(`メール送信中にエラーが発生しました: ${error}`);
    // メール送信に失敗しても登録は成功とする
  }
}

/**
 * 図書館の設定情報を取得する関数
 * @return {object} 設定情報オブジェクト
 */
// 設定キャッシュのキーとTTL(秒)。設定はシート読み込みが毎トランザクションで
// 発生するためキャッシュする。saveLibrarySettings_ で無効化されるが、
// 設定DBシートを直接編集した場合は最大TTL秒だけ古い値が使われる。
const SETTINGS_CACHE_KEY = "librarySettings_v1";
const SETTINGS_CACHE_TTL_SECONDS = 300;

/**
 * 利用者DBに「状態」列(論理削除用)のヘッダーがなければ補完する関数(冪等)。
 * 末尾列の追加のみでデータには触れない。既に別のヘッダーが入っている場合は
 * 上書きせず、validateSchema_ の検出に委ねる。
 */
function ensureUserStatusColumn_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const userSheet = ss.getSheetByName("利用者DB");
  if (!userSheet || userSheet.getLastRow() === 0) return;

  const statusColNumber = SCHEMA["利用者DB"].col.状態 + 1;
  // グリッドが6列ちょうどに切り詰められたシートでは getRange(1, 7) が
  // 範囲外エラーになるため、先に物理列を追加する
  if (userSheet.getMaxColumns() < statusColNumber) {
    userSheet.insertColumnsAfter(userSheet.getMaxColumns(), statusColNumber - userSheet.getMaxColumns());
  }
  const headerCell = userSheet.getRange(1, statusColNumber);
  const current = headerCell.getValue();
  if (current === "" || current === null) {
    headerCell.setValue("状態");
    headerCell.setFontWeight("bold").setBackground("#f3f3f3");
  }
}

/**
 * 設定DBシートを取得する(存在しない・空の場合はヘッダーとデフォルト設定を投入して作成)。
 * キャッシュの状態に依存しないため、シートの存在を保証したい初期化・保存経路は
 * getLibrarySettings() ではなくこの関数を使うこと。
 * @return {Sheet} 設定DBシート
 */
function ensureSettingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let settingsSheet = ss.getSheetByName("設定DB");

  // 設定DBシートが存在しない場合は作成
  if (!settingsSheet) {
    settingsSheet = ss.insertSheet("設定DB");
  }

  // シートが空(手動で作られた空タブを含む)ならヘッダーとデフォルト設定を投入
  if (settingsSheet.getLastRow() === 0) {
    // ヘッダー行を設定(定義はSCHEMAが唯一)
    settingsSheet.getRange(1, 1, 1, SCHEMA["設定DB"].headers.length).setValues([SCHEMA["設定DB"].headers]);
    settingsSheet.getRange(1, 1, 1, SCHEMA["設定DB"].headers.length).setFontWeight("bold").setBackground("#f3f3f3");

    // デフォルト設定を追加
    const defaultSettings = [
      ["lendingDays", "14", "貸出期間（日数）", new Date()],
      ["maxBooks", "5", "一人あたりの最大貸出冊数", new Date()],
      ["maxRenewals", "1", "貸出延長の上限回数", new Date()],
      ["reminderDays", "3", "返却リマインダー（日前）", new Date()],
      ["enableEmail", "true", "メール通知を有効にする", new Date()],
      ["enableOverdue", "true", "延滞通知を有効にする", new Date()],
      ["libraryEmail", "", "図書館メールアドレス", new Date()],
      ["libraryName", "", "図書館名", new Date()],
      ["operationMode", "normal", "運用モード", new Date()]
    ];

    settingsSheet.getRange(2, 1, defaultSettings.length, 4).setValues(defaultSettings);
    settingsSheet.autoResizeColumns(1, 4);
  }

  return settingsSheet;
}

function getLibrarySettings() {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(SETTINGS_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached);
    }

    const settingsSheet = ensureSettingsSheet_();

    // 設定データを取得
    const data = settingsSheet.getDataRange().getValues();
    const settings = {};
    
    // ヘッダー行を除いて設定を読み込む
    for (let i = 1; i < data.length; i++) {
      const settingName = data[i][0];
      const settingValue = data[i][1];
      
      if (settingName) {
        // boolean値の変換
        if (settingValue === "true") {
          settings[settingName] = true;
        } else if (settingValue === "false") {
          settings[settingName] = false;
        } else if (!isNaN(settingValue) && settingValue !== "") {
          // 数値の変換
          settings[settingName] = Number(settingValue);
        } else {
          // 文字列としてそのまま使用
          settings[settingName] = settingValue;
        }
      }
    }
    
    console.log("設定取得成功:", settings);
    cache.put(SETTINGS_CACHE_KEY, JSON.stringify(settings), SETTINGS_CACHE_TTL_SECONDS);
    return settings;

  } catch (error) {
    console.error(`設定の取得中にエラーが発生しました: ${error}`);
    throw new Error(`設定の取得に失敗しました: ${error.message}`);
  }
}

/**
 * 図書館の設定情報を保存する関数
 * @param {object} settings - 設定情報オブジェクト
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function saveLibrarySettings(settings) {
  return runWithScriptLock_(
    () => saveLibrarySettings_(settings),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function saveLibrarySettings_(settings) {
  try {
    // 設定DBシートが存在しない・空の場合も作成される(キャッシュに依存しない)
    const settingsSheet = ensureSettingsSheet_();

    // 現在のデータを取得
    const data = settingsSheet.getDataRange().getValues();
    const currentDate = new Date();
    
    // 設定項目ごとに更新
    for (const [key, value] of Object.entries(settings)) {
      let found = false;
      
      // 既存の設定を探して更新
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] === key) {
          // 設定値と更新日時を更新
          settingsSheet.getRange(i + 1, 2).setValue(String(value));
          settingsSheet.getRange(i + 1, 4).setValue(currentDate);
          found = true;
          break;
        }
      }
      
      // 新しい設定項目の場合は追加
      if (!found) {
        const description = getSettingDescription(key);
        settingsSheet.appendRow([key, String(value), description, currentDate]);
      }
    }
    
    // 保存した設定が即座に反映されるようキャッシュを無効化
    CacheService.getScriptCache().remove(SETTINGS_CACHE_KEY);

    console.log("設定保存成功:", settings);
    return { success: true, message: "設定を保存しました。" };
    
  } catch (error) {
    console.error(`設定の保存中にエラーが発生しました: ${error}`);
    return { success: false, message: `設定の保存に失敗しました: ${error.message}` };
  }
}

/**
 * 設定項目の説明を取得する補助関数
 * @param {string} key - 設定項目のキー
 * @return {string} 設定項目の説明
 */
function getSettingDescription(key) {
  const descriptions = {
    lendingDays: "貸出期間（日数）",
    maxBooks: "一人あたりの最大貸出冊数",
    maxRenewals: "貸出延長の上限回数",
    reminderDays: "返却リマインダー（日前）",
    enableEmail: "メール通知を有効にする",
    enableOverdue: "延滞通知を有効にする",
    libraryEmail: "図書館メールアドレス",
    libraryName: "図書館名",
    operationMode: "運用モード",
    notifyIntervalDays: "延滞通知の再送間隔（日数）",
    overdueTemplate: "延滞通知メールの文面テンプレート",
    reminderTemplate: "返却リマインダーメールの文面テンプレート",
    backupSpreadsheetId: "返却済データのバックアップ先スプレッドシートID"
  };
  
  return descriptions[key] || "";
}

/**
 * 延滞者リストを取得する関数
 * @return {Array} 延滞者情報の配列
 */
function getOverdueList() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    
    if (!lendingSheet) {
      throw new Error("貸出記録シートが見つかりません。");
    }
    
    // 必要なA〜G列のみ読み込む(H列以降の返却日時・最終通知日は延滞判定に不要)
    const lendingLastRow = lendingSheet.getLastRow();
    const data = lendingLastRow > 0 ? lendingSheet.getRange(1, 1, lendingLastRow, 7).getValues() : [];
    const today = new Date();
    today.setHours(0, 0, 0, 0); // 時刻部分をリセット

    // ヘッダー: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時, F:返却予定日, G:返却状況
    const bookIdColIndex = 0;     // A列
    const titleColIndex = 1;      // B列
    const userIdColIndex = 2;     // C列
    const userNameColIndex = 3;   // D列
    const lendingDateColIndex = 4;// E列
    const dueDateColIndex = 5;    // F列
    const statusColIndex = 6;     // G列
    
    const overdueList = [];
    
    // ヘッダー行を除く (i=1から)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const status = row[statusColIndex];
      const dueDateValue = row[dueDateColIndex];
      
      // 返却状況が "未返却" かどうかチェック
      if (status === "未返却") {
        // 返却予定日が有効な日付オブジェクトかチェック
        if (dueDateValue instanceof Date && !isNaN(dueDateValue)) {
          const dueDate = new Date(dueDateValue);
          dueDate.setHours(0, 0, 0, 0); // 時刻部分をリセット
          
          // 返却予定日が今日より前（つまり延滞している）かチェック
          if (dueDate < today) {
            const overdueDays = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));
            
            overdueList.push({
              userId: row[userIdColIndex] || "",
              userName: row[userNameColIndex] || "",
              bookId: row[bookIdColIndex] || "",
              bookTitle: row[titleColIndex] || "",
              lendingDate: toIsoString_(row[lendingDateColIndex]),
              dueDate: toIsoString_(dueDateValue),
              overdueDays: overdueDays
            });
          }
        }
      }
    }
    
    // 延滞日数の多い順にソート
    overdueList.sort((a, b) => b.overdueDays - a.overdueDays);
    
    console.log(`延滞者リスト取得完了: ${overdueList.length}件`);
    return overdueList;
    
  } catch (error) {
    console.error(`延滞者リストの取得中にエラーが発生しました: ${error}`);
    throw new Error(`延滞者リストの取得に失敗しました: ${error.message}`);
  }
}

/**
 * 延滞者レポートを作成する関数
 * @return {object} 処理結果
 */
function createOverdueReport() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const overdueList = getOverdueList();
    
    // 現在の日時を取得してレポート名に使用
    const now = new Date();
    const reportName = `延滞者レポート_${Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmm")}`;
    
    // 既存のレポートシートがあれば削除
    const existingSheet = ss.getSheetByName(reportName);
    if (existingSheet) {
      ss.deleteSheet(existingSheet);
    }
    
    // 新しいシートを作成
    const reportSheet = ss.insertSheet(reportName);
    
    // ヘッダー行を設定
    const headers = ["利用者ID", "利用者名", "書籍ID", "書籍名", "貸出日", "返却予定日", "延滞日数", "連絡先"];
    reportSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    reportSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f3f3");
    
    if (overdueList.length > 0) {
      // 利用者の連絡先情報を取得するため、利用者DBを参照
      const userSheet = ss.getSheetByName("利用者DB");
      const userData = userSheet ? userSheet.getDataRange().getValues() : [];
      const userMap = new Map();
      
      // 利用者情報をMapに格納（効率化のため）
      for (let i = 1; i < userData.length; i++) {
        const userId = userData[i][0];
        const email = userData[i][2] || "";
        const phone = userData[i][3] || "";
        if (userId) {
          userMap.set(userId, { email: email, phone: phone });
        }
      }
      
      // レポートデータを作成
      const reportData = overdueList.map(item => {
        const userInfo = userMap.get(item.userId) || { email: "", phone: "" };
        const contact = userInfo.email || userInfo.phone || "連絡先なし";
        
        return [
          item.userId,
          item.userName,
          item.bookId,
          item.bookTitle,
          item.lendingDate ? Utilities.formatDate(new Date(item.lendingDate), Session.getScriptTimeZone(), "yyyy/MM/dd") : "",
          item.dueDate ? Utilities.formatDate(new Date(item.dueDate), Session.getScriptTimeZone(), "yyyy/MM/dd") : "",
          item.overdueDays + "日",
          contact
        ];
      });
      
      // データをシートに書き込み
      reportSheet.getRange(2, 1, reportData.length, headers.length).setValues(reportData);
      
      // 延滞日数に応じて行の色を設定
      for (let i = 0; i < overdueList.length; i++) {
        const row = i + 2;
        if (overdueList[i].overdueDays >= 30) {
          reportSheet.getRange(row, 1, 1, headers.length).setBackground("#ffcdd2"); // 濃い赤
        } else if (overdueList[i].overdueDays >= 14) {
          reportSheet.getRange(row, 1, 1, headers.length).setBackground("#ffebee"); // 薄い赤
        } else {
          reportSheet.getRange(row, 1, 1, headers.length).setBackground("#fff3e0"); // 薄いオレンジ
        }
      }
    }
    
    // 列幅を自動調整
    reportSheet.autoResizeColumns(1, headers.length);
    
    // サマリー情報を追加
    const summaryRow = overdueList.length + 4;
    reportSheet.getRange(summaryRow, 1).setValue("サマリー");
    reportSheet.getRange(summaryRow, 1).setFontWeight("bold");
    reportSheet.getRange(summaryRow + 1, 1).setValue("総延滞件数:");
    reportSheet.getRange(summaryRow + 1, 2).setValue(overdueList.length + "件");
    
    if (overdueList.length > 0) {
      const maxOverdue = Math.max(...overdueList.map(item => item.overdueDays));
      reportSheet.getRange(summaryRow + 2, 1).setValue("最大延滞日数:");
      reportSheet.getRange(summaryRow + 2, 2).setValue(maxOverdue + "日");
    }
    
    // フィルターを設定
    if (overdueList.length > 0) {
      reportSheet.getRange(1, 1, overdueList.length + 1, headers.length).createFilter();
    }
    
    // 作成したシートをアクティブにする
    ss.setActiveSheet(reportSheet);
    
    console.log(`延滞者レポート作成完了: ${reportName}`);
    return { success: true, message: `延滞者レポート「${reportName}」を作成しました。` };
    
  } catch (error) {
    console.error(`延滞者レポート作成中にエラーが発生しました: ${error}`);
    throw new Error(`レポート作成に失敗しました: ${error.message}`);
  }
}

/**
 * 延滞者へ通知メールを自動送信する関数（時間主導トリガーから毎日実行される）
 * 設定DBの enableOverdue が false の場合は何もしない。
 * 同一貸出への重複通知を防ぐため、貸出記録のI列(最終通知日)に送信日を記録し、
 * notifyIntervalDays(デフォルト7日)以上経過するまで再通知しない。
 * @return {object} 処理結果 {success: boolean, sent: number, skipped: number, failed: number, message: string}
 */
function sendOverdueNotifications() {
  // トリガーとリマインダーが同時に走って貸出記録のヘッダー列
  // (最終通知日/リマインダー送信日)を取り合わないよう直列化する。
  // ロックが取れない場合はスキップし、翌日の実行で再送される
  return runWithScriptLock_(
    () => sendOverdueNotifications_(),
    { success: false, sent: 0, skipped: 0, failed: 0, message: LOCK_BUSY_MESSAGE }
  );
}

function sendOverdueNotifications_() {
  try {
    const settings = getLibrarySettings();
    if (settings.enableOverdue === false) {
      const msg = "延滞通知は設定で無効になっています(enableOverdue=false)。";
      console.log(msg);
      return { success: true, sent: 0, skipped: 0, failed: 0, message: msg };
    }
    const notifyIntervalDays = Number(settings.notifyIntervalDays) || 7;
    const libraryName = settings.libraryName || "図書館";

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    const userSheet = ss.getSheetByName("利用者DB");
    if (!lendingSheet) {
      throw new Error("貸出記録シートが見つかりません。");
    }
    if (!userSheet) {
      throw new Error("利用者DBシートが見つかりません。");
    }

    // 利用者ID → メールアドレスの対応表を作成（利用者DB: A列=ID, C列=メール）
    // 貸出記録側のIDは大文字小文字が揺れることがある(getUserInfo が大文字小文字を無視して照合するため)ので小文字キーで持つ
    const userData = userSheet.getDataRange().getValues();
    const emailByUserId = {};
    for (let i = 1; i < userData.length; i++) {
      const userId = userData[i][0] ? userData[i][0].toString().trim().toLowerCase() : "";
      const email = userData[i][2] ? userData[i][2].toString().trim() : "";
      if (userId && email) {
        emailByUserId[userId] = email;
      }
    }

    // 貸出記録: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時,
    //           F:返却予定日, G:返却状況, H:返却日時, +「最終通知日」列
    const data = lendingSheet.getDataRange().getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 「最終通知日」列をヘッダー名で特定する。存在しない場合は末尾に追加する
    // (I列に別の用途の列が既にあるシートを上書きしないため、位置は固定しない)
    let lastNotifiedCol = data.length > 0 ? data[0].indexOf("最終通知日") + 1 : 0; // 1始まり
    if (lastNotifiedCol === 0) {
      // H列(8列目)は返却日時用に予約されているため、最低でもI列(9列目)以降に配置する
      // (貸出直後の行は7列しかなくヘッダーも7列のことがある)
      lastNotifiedCol = Math.max((data.length > 0 ? data[0].length : 8) + 1, 9);
      // 予約済みのH1(返却日時)が空のままだとヘッダーに空セルが挟まるため、先に埋めておく
      if (data.length > 0 && (data[0].length < 8 || !data[0][7])) {
        lendingSheet.getRange(1, 8).setValue("返却日時");
      }
      lendingSheet.getRange(1, lastNotifiedCol).setValue("最終通知日");
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let quotaExhausted = false;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[6] !== "未返却") continue;
      const dueDateValue = row[5];
      if (!(dueDateValue instanceof Date) || isNaN(dueDateValue)) continue;
      const dueDate = new Date(dueDateValue);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate >= today) continue; // 延滞していない

      const overdueDays = Math.floor((today - dueDate) / (1000 * 60 * 60 * 24));

      // 通知間隔チェック: 最終通知日から notifyIntervalDays 未満なら再通知しない
      const lastNotified = row.length > lastNotifiedCol - 1 ? row[lastNotifiedCol - 1] : "";
      if (lastNotified instanceof Date && !isNaN(lastNotified)) {
        // 時刻成分を切り捨てて日付単位で比較する(9時送信の時刻が残ると間隔が1日長く判定されるため)
        const lastNotifiedDay = new Date(lastNotified);
        lastNotifiedDay.setHours(0, 0, 0, 0);
        const daysSinceNotified = Math.floor((today - lastNotifiedDay) / (1000 * 60 * 60 * 24));
        if (daysSinceNotified < notifyIntervalDays) {
          skipped++;
          continue;
        }
      }

      const userId = row[2] ? row[2].toString().trim() : "";
      const email = emailByUserId[userId.toLowerCase()];
      if (!email) {
        console.log(`利用者 ${userId} のメールアドレスが未登録のため通知をスキップします。`);
        skipped++;
        continue;
      }

      // メール送信クォータを確認し、残量がなければ以降の送信を打ち切る
      // (残りは翌日のトリガー実行時に再送される)
      if (MailApp.getRemainingDailyQuota() <= 0) {
        console.warn("メール送信の1日あたりのクォータを使い切ったため、残りの延滞通知を中断します。");
        skipped++;
        quotaExhausted = true;
        break;
      }

      const body = buildOverdueMailBody_(settings, {
        userName: row[3] || "利用者",
        bookTitle: row[1] || "書籍",
        dueDate: Utilities.formatDate(dueDateValue, "Asia/Tokyo", "yyyy年MM月dd日"),
        overdueDays: overdueDays,
        libraryName: libraryName
      });

      try {
        MailApp.sendEmail({
          to: email,
          subject: `【${libraryName}】返却期限超過のお知らせ`,
          body: body
        });
        lendingSheet.getRange(i + 1, lastNotifiedCol).setValue(new Date());
        sent++;
        console.log(`延滞通知送信: ${userId} (${email}) - ${row[1]}`);
      } catch (mailError) {
        console.error(`延滞通知の送信に失敗しました (${email}): ${mailError}`);
        failed++;
      }
    }

    const message = `延滞通知処理完了: 送信 ${sent}件 / スキップ ${skipped}件 / 失敗 ${failed}件` +
      (quotaExhausted ? "(メール送信クォータ上限のため中断。残りは翌日の実行で送信されます)" : "");
    console.log(message);
    return { success: true, sent: sent, skipped: skipped, failed: failed, message: message };
  } catch (error) {
    console.error(`延滞通知処理中にエラーが発生しました: ${error}`);
    return { success: false, sent: 0, skipped: 0, failed: 0, message: `延滞通知処理に失敗しました: ${error.message}` };
  }
}

/**
 * 延滞通知メールの本文を組み立てる補助関数
 * 設定DBの overdueTemplate があればそれを使用し、プレースホルダー
 * {userName} {bookTitle} {dueDate} {overdueDays} {libraryName} を置換する。
 * @param {object} settings - 図書館設定
 * @param {object} values - 置換値
 * @return {string} メール本文
 */
function buildOverdueMailBody_(settings, values) {
  const defaultTemplate =
    "{userName} 様\n\n" +
    "{libraryName}をご利用いただきありがとうございます。\n" +
    "貸出中の以下の書籍が返却期限を過ぎています。ご返却をお願いいたします。\n\n" +
    "書籍名: {bookTitle}\n" +
    "返却期限: {dueDate}({overdueDays}日超過)\n\n" +
    "既にご返却済みの場合は行き違いですのでご容赦ください。\n\n" +
    "{libraryName}";
  const template = (typeof settings.overdueTemplate === "string" && settings.overdueTemplate.trim() !== "")
    ? settings.overdueTemplate
    : defaultTemplate;
  return template
    .replace(/\{userName\}/g, values.userName)
    .replace(/\{bookTitle\}/g, values.bookTitle)
    .replace(/\{dueDate\}/g, values.dueDate)
    .replace(/\{overdueDays\}/g, String(values.overdueDays))
    .replace(/\{libraryName\}/g, values.libraryName);
}

/**
 * 旧来の時間主導トリガーとの互換ハンドラー(トリガー安全: UIを一切使わない)
 * 既存デプロイに sendOverdueReminders を呼ぶトリガーが残っていてもそのまま動作する。
 * 旧実装(重複通知防止なし)は sendOverdueNotifications に置き換えた。
 */
function sendOverdueReminders() {
  return sendOverdueNotifications();
}

/**
 * onOpen メニューの「延滞リマインダー送信」から実行し、結果をダイアログ表示する関数
 */
function sendOverdueRemindersFromMenu() {
  const result = sendOverdueNotifications();
  SpreadsheetApp.getUi().alert(
    '延滞リマインダー送信',
    result.message,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * 延滞通知の時間主導トリガー(毎日9時台)を設置する関数(冪等)
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function installOverdueTrigger() {
  try {
    removeOverdueTrigger(); // 二重設置を防ぐ
    ScriptApp.newTrigger('sendOverdueNotifications')
      .timeBased()
      .everyDays(1)
      .atHour(9)
      .create();
    const msg = "延滞通知トリガーを設置しました(毎日9時台に実行)。";
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    console.error(`トリガー設置中にエラーが発生しました: ${error}`);
    return { success: false, message: `トリガー設置に失敗しました: ${error.message}` };
  }
}

/**
 * 延滞通知の時間主導トリガーを解除する関数
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function removeOverdueTrigger() {
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(trigger => {
      // 旧ハンドラー名(sendOverdueReminders)で設置済みのトリガーも合わせて解除する
      const handler = trigger.getHandlerFunction();
      if (handler === 'sendOverdueNotifications' || handler === 'sendOverdueReminders') {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });
    const msg = removed > 0
      ? `延滞通知トリガーを${removed}件解除しました。`
      : "設置済みの延滞通知トリガーはありません。";
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    console.error(`トリガー解除中にエラーが発生しました: ${error}`);
    return { success: false, message: `トリガー解除に失敗しました: ${error.message}` };
  }
}

/**
 * メニューから延滞通知トリガーを設置し、結果をダイアログ表示する関数
 */
function installOverdueTriggerFromMenu() {
  const result = installOverdueTrigger();
  SpreadsheetApp.getUi().alert('延滞通知トリガー設置', result.message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * メニューから延滞通知トリガーを解除し、結果をダイアログ表示する関数
 */
function removeOverdueTriggerFromMenu() {
  const result = removeOverdueTrigger();
  SpreadsheetApp.getUi().alert('延滞通知トリガー解除', result.message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 返却期限前のリマインダーメールを送信する関数(トリガー安全: UIを一切使わない)
 * 未返却かつ返却予定日が今日〜reminderDays日後の貸出に、1貸出につき1回だけ送信する。
 * 重複送信は「リマインダー送信日」列(ヘッダー名で特定・なければ末尾に追加)で防ぐ。
 * @return {object} 処理結果 {success: boolean, sent: number, skipped: number, failed: number, message: string}
 */
function sendReturnReminders() {
  // 延滞通知と同時に走って貸出記録のヘッダー列を取り合わないよう直列化する。
  // ロックが取れない場合はスキップし、翌日の実行で再送される
  return runWithScriptLock_(
    () => sendReturnReminders_(),
    { success: false, sent: 0, skipped: 0, failed: 0, message: LOCK_BUSY_MESSAGE }
  );
}

function sendReturnReminders_() {
  try {
    const settings = getLibrarySettings();
    if (settings.enableEmail === false) {
      const msg = "リマインダーはメール通知の設定で無効になっています(enableEmail=false)。";
      console.log(msg);
      return { success: true, sent: 0, skipped: 0, failed: 0, message: msg };
    }
    const reminderDays = Number(settings.reminderDays);
    if (!reminderDays || reminderDays <= 0) {
      const msg = "reminderDays が未設定または0以下のためリマインダーをスキップしました。";
      console.log(msg);
      return { success: true, sent: 0, skipped: 0, failed: 0, message: msg };
    }
    const libraryName = settings.libraryName || "図書館";

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    const userSheet = ss.getSheetByName("利用者DB");
    if (!lendingSheet) {
      throw new Error("貸出記録シートが見つかりません。");
    }
    if (!userSheet) {
      throw new Error("利用者DBシートが見つかりません。");
    }

    // 利用者ID → メールアドレスの対応表(sendOverdueNotifications と同じ小文字キー)
    const userData = userSheet.getDataRange().getValues();
    const emailByUserId = {};
    for (let i = 1; i < userData.length; i++) {
      const userId = userData[i][0] ? userData[i][0].toString().trim().toLowerCase() : "";
      const email = userData[i][2] ? userData[i][2].toString().trim() : "";
      if (userId && email) {
        emailByUserId[userId] = email;
      }
    }

    const data = lendingSheet.getDataRange().getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const reminderLimit = new Date(today.getTime() + reminderDays * 24 * 60 * 60 * 1000);

    // 「リマインダー送信日」列をヘッダー名で特定する(最終通知日と同じ流儀。
    // H列=返却日時は予約済みのため最低でもI列以降に追加する)
    let reminderCol = data.length > 0 ? data[0].indexOf("リマインダー送信日") + 1 : 0; // 1始まり
    if (reminderCol === 0) {
      reminderCol = Math.max((data.length > 0 ? data[0].length : 8) + 1, 9);
      if (data.length > 0 && (data[0].length < 8 || !data[0][7])) {
        lendingSheet.getRange(1, 8).setValue("返却日時");
      }
      lendingSheet.getRange(1, reminderCol).setValue("リマインダー送信日");
    }

    let sent = 0;
    let skipped = 0;
    let failed = 0;
    let quotaExhausted = false;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      if (row[6] !== "未返却") continue;
      const dueDateValue = row[5];
      if (!(dueDateValue instanceof Date) || isNaN(dueDateValue)) continue;
      const dueDate = new Date(dueDateValue);
      dueDate.setHours(0, 0, 0, 0);
      if (dueDate < today) continue; // 延滞済みは延滞通知に任せる
      if (dueDate > reminderLimit) continue; // まだリマインド対象期間でない

      // 同一貸出への重複送信防止(1貸出1回)
      const alreadySent = row.length > reminderCol - 1 ? row[reminderCol - 1] : "";
      if (alreadySent instanceof Date && !isNaN(alreadySent)) {
        skipped++;
        continue;
      }

      const userId = row[2] ? row[2].toString().trim() : "";
      const email = emailByUserId[userId.toLowerCase()];
      if (!email) {
        console.log(`利用者 ${userId} のメールアドレスが未登録のためリマインダーをスキップします。`);
        skipped++;
        continue;
      }

      // メール送信クォータを確認し、残量がなければ以降の送信を打ち切る
      // (リマインダー送信日が未記入のまま残るため、翌日の実行で再送される)
      if (MailApp.getRemainingDailyQuota() <= 0) {
        console.warn("メール送信の1日あたりのクォータを使い切ったため、残りのリマインダーを中断します。");
        skipped++;
        quotaExhausted = true;
        break;
      }

      const daysLeft = Math.floor((dueDate - today) / (1000 * 60 * 60 * 24));
      const body = buildReminderMailBody_(settings, {
        userName: row[3] || "利用者",
        bookTitle: row[1] || "書籍",
        dueDate: Utilities.formatDate(dueDateValue, "Asia/Tokyo", "yyyy年MM月dd日"),
        daysLeft: daysLeft,
        libraryName: libraryName
      });

      try {
        MailApp.sendEmail({
          to: email,
          subject: `【${libraryName}】返却期限が近づいています`,
          body: body
        });
        lendingSheet.getRange(i + 1, reminderCol).setValue(new Date());
        sent++;
        console.log(`返却リマインダー送信: ${userId} (${email}) - ${row[1]}`);
      } catch (mailError) {
        console.error(`返却リマインダーの送信に失敗しました (${email}): ${mailError}`);
        failed++;
      }
    }

    const message = `返却リマインダー処理完了: 送信 ${sent}件 / スキップ ${skipped}件 / 失敗 ${failed}件` +
      (quotaExhausted ? "(メール送信クォータ上限のため中断。残りは翌日の実行で送信されます)" : "");
    console.log(message);
    return { success: true, sent: sent, skipped: skipped, failed: failed, message: message };
  } catch (error) {
    console.error(`返却リマインダー処理中にエラーが発生しました: ${error}`);
    return { success: false, sent: 0, skipped: 0, failed: 0, message: `返却リマインダー処理に失敗しました: ${error.message}` };
  }
}

/**
 * 返却リマインダーメールの本文を組み立てる補助関数
 * 設定DBの reminderTemplate があればそれを使用し、プレースホルダー
 * {userName} {bookTitle} {dueDate} {daysLeft} {libraryName} を置換する。
 * @param {object} settings - 図書館設定
 * @param {object} values - 置換値
 * @return {string} メール本文
 */
function buildReminderMailBody_(settings, values) {
  const defaultTemplate =
    "{userName} 様\n\n" +
    "{libraryName}をご利用いただきありがとうございます。\n" +
    "貸出中の以下の書籍の返却期限が近づいています。\n\n" +
    "書籍名: {bookTitle}\n" +
    "返却期限: {dueDate}(あと{daysLeft}日)\n\n" +
    "引き続きご利用の場合も、期限までに一度カウンターへお持ちください。\n\n" +
    "{libraryName}";
  const template = (typeof settings.reminderTemplate === "string" && settings.reminderTemplate.trim() !== "")
    ? settings.reminderTemplate
    : defaultTemplate;
  return template
    .replace(/\{userName\}/g, values.userName)
    .replace(/\{bookTitle\}/g, values.bookTitle)
    .replace(/\{dueDate\}/g, values.dueDate)
    .replace(/\{daysLeft\}/g, String(values.daysLeft))
    .replace(/\{libraryName\}/g, values.libraryName);
}

/**
 * 返却リマインダーの時間主導トリガー(毎日10時台)を設置する関数(冪等)。
 * 延滞通知(9時台)と時間帯をずらし、貸出記録のヘッダー列作成が並行しないようにする
 * (両ハンドラーのスクリプトロックに加えた二重の防御)。
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function installReminderTrigger() {
  try {
    removeReminderTrigger(); // 二重設置を防ぐ
    ScriptApp.newTrigger('sendReturnReminders')
      .timeBased()
      .everyDays(1)
      .atHour(10)
      .create();
    const msg = "返却リマインダートリガーを設置しました(毎日10時台に実行)。";
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    console.error(`リマインダートリガー設置中にエラーが発生しました: ${error}`);
    return { success: false, message: `リマインダートリガー設置に失敗しました: ${error.message}` };
  }
}

/**
 * 返却リマインダーの時間主導トリガーを解除する関数
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function removeReminderTrigger() {
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getHandlerFunction() === 'sendReturnReminders') {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });
    const msg = removed > 0
      ? `返却リマインダートリガーを${removed}件解除しました。`
      : "設置済みの返却リマインダートリガーはありません。";
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    console.error(`リマインダートリガー解除中にエラーが発生しました: ${error}`);
    return { success: false, message: `リマインダートリガー解除に失敗しました: ${error.message}` };
  }
}

/**
 * 運用に必要な時間主導トリガーを一括で設置する関数(冪等)。
 * 延滞通知(毎日9時)+返却リマインダー(毎日10時)+月次アーカイブ(毎月1日3時)。
 * 月次アーカイブは backupSpreadsheetId が設定済みかつ疎通確認(実バックアップ1回)に
 * 成功した場合のみ設置する(未設定のまま設置すると毎月黙ってスキップされるため)。
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function installAllTriggers() {
  const results = [installOverdueTrigger(), installReminderTrigger()];

  let backupId = "";
  try {
    const settings = getLibrarySettings();
    backupId = settings.backupSpreadsheetId ? settings.backupSpreadsheetId.toString().trim() : "";
  } catch (e) {
    console.warn("設定の取得に失敗したため月次アーカイブトリガーの設置を見送ります:", e);
  }
  if (!backupId) {
    // 設定されていないのは新規環境では正常な状態なので、全体の成否には含めず
    // 未設置であることと設定手順をメッセージで明示する
    results.push({
      success: true,
      message: "月次アーカイブトリガーは未設置です(backupSpreadsheetId が未設定)。onOpen内でコメントアウトされている「月次アーカイブトリガー設置(毎月1日)」を有効化して実行すると、保存先の入力・検証込みで設置できます。"
    });
  } else {
    // installArchiveTriggerFromMenu と同じく、本番と同じ経路で疎通確認してから設置する
    const testRun = backupReturnedData(backupId);
    if (!testRun.success) {
      results.push({
        success: false,
        message: `月次アーカイブトリガーは未設置: バックアップ先の検証に失敗しました(${testRun.message})`
      });
    } else {
      const archiveResult = installArchiveTrigger();
      results.push({
        success: archiveResult.success,
        message: `${archiveResult.message}(疎通確認として初回バックアップを実行: ${testRun.message})`
      });
    }
  }

  return {
    success: results.every(r => r.success),
    message: results.map(r => r.message).join("\n")
  };
}

/**
 * 運用の時間主導トリガーを一括で解除する関数
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function removeAllTriggers() {
  const results = [removeOverdueTrigger(), removeReminderTrigger(), removeArchiveTrigger()];
  return {
    success: results.every(r => r.success),
    message: results.map(r => r.message).join("\n")
  };
}

/**
 * メニューからトリガーを一括設置し、結果をダイアログ表示する関数
 */
function installAllTriggersFromMenu() {
  const result = installAllTriggers();
  SpreadsheetApp.getUi().alert('トリガー一括設置', result.message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * メニューからトリガーを一括解除し、結果をダイアログ表示する関数
 */
function removeAllTriggersFromMenu() {
  const result = removeAllTriggers();
  SpreadsheetApp.getUi().alert('トリガー一括解除', result.message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * 月次アーカイブのトリガーエントリ関数。
 * 設定DBの backupSpreadsheetId を使い、返却済データをバックアップ先へ
 * 移動して貸出記録シートを痩せさせる(未設定の場合は何もしない)。
 * @return {object} 処理結果 {success: boolean, count?: number, message: string}
 */
function archiveReturnedRecords() {
  try {
    const settings = getLibrarySettings();
    const targetId = settings.backupSpreadsheetId ? settings.backupSpreadsheetId.toString().trim() : "";
    if (!targetId) {
      const msg = "backupSpreadsheetId が未設定のため月次アーカイブをスキップしました。管理メニューから再設置してください。";
      console.warn(msg);
      return { success: false, message: msg };
    }
    const result = backupReturnedData(targetId);
    console.log(`月次アーカイブ: ${result.message}`);
    return result;
  } catch (error) {
    console.error(`月次アーカイブ中にエラーが発生しました: ${error}`);
    return { success: false, message: `月次アーカイブに失敗しました: ${error.message}` };
  }
}

/**
 * 月次アーカイブの時間主導トリガーを設置する関数(毎月1日の3時台)
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function installArchiveTrigger() {
  try {
    removeArchiveTrigger(); // 二重設置を防ぐ
    ScriptApp.newTrigger('archiveReturnedRecords')
      .timeBased()
      .onMonthDay(1)
      .atHour(3)
      .create();
    const msg = "月次アーカイブトリガーを設置しました(毎月1日の3時台に実行)。";
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    console.error(`アーカイブトリガー設置中にエラーが発生しました: ${error}`);
    return { success: false, message: `トリガー設置に失敗しました: ${error.message}` };
  }
}

/**
 * 月次アーカイブの時間主導トリガーを解除する関数
 * @return {object} 処理結果 {success: boolean, message: string}
 */
function removeArchiveTrigger() {
  try {
    let removed = 0;
    ScriptApp.getProjectTriggers().forEach(trigger => {
      if (trigger.getHandlerFunction() === 'archiveReturnedRecords') {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });
    const msg = removed > 0 ? `月次アーカイブトリガーを${removed}件解除しました。` : "設置済みの月次アーカイブトリガーはありません。";
    console.log(msg);
    return { success: true, message: msg };
  } catch (error) {
    console.error(`アーカイブトリガー解除中にエラーが発生しました: ${error}`);
    return { success: false, message: `トリガー解除に失敗しました: ${error.message}` };
  }
}

/**
 * メニューから月次アーカイブトリガーを設置する関数。
 * バックアップ先スプレッドシートIDの入力(または既存設定の確認)と
 * 接続確認を行い、設定DBへ保存してからトリガーを設置する。
 */
function installArchiveTriggerFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const settings = getLibrarySettings();
  const current = settings.backupSpreadsheetId ? settings.backupSpreadsheetId.toString().trim() : "";

  const prompt = ui.prompt(
    '月次アーカイブトリガー設置',
    'バックアップ先のスプレッドシートIDを入力してください。\n' +
    '(疎通確認のため、設置時に初回バックアップを1回実行します)\n' +
    (current
      ? `現在の設定: ${current}\n(空のままOKを押すと現在の設定を使用します)`
      : '(例: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms)'),
    ui.ButtonSet.OK_CANCEL
  );
  if (prompt.getSelectedButton() !== ui.Button.OK) return;

  const input = prompt.getResponseText().trim();
  const targetId = input || current;
  if (!targetId) {
    ui.alert('エラー', 'バックアップ先のスプレッドシートIDが必要です。', ui.ButtonSet.OK);
    return;
  }

  // 疎通確認を兼ねて実際にバックアップを1回実行する。
  // openByIdだけでは「開けるが書き込めない」「バックアップシートのヘッダーが
  // 不適合」を検出できず、毎月空振りするトリガーが設置されてしまうため、
  // 本番と同じ経路(権限・ヘッダー互換チェック込み)で検証する
  const testRun = backupReturnedData(targetId);
  if (!testRun.success) {
    ui.alert('エラー', `バックアップ先の検証に失敗したため、トリガーは設置しません:\n${testRun.message}`, ui.ButtonSet.OK);
    return;
  }

  const saveResult = saveLibrarySettings({ backupSpreadsheetId: targetId });
  if (!saveResult.success) {
    ui.alert('エラー', `バックアップ先の保存に失敗しました: ${saveResult.message}`, ui.ButtonSet.OK);
    return;
  }

  const result = installArchiveTrigger();
  ui.alert(
    result.success ? '月次アーカイブトリガー設置' : '設置失敗',
    `${result.message}\n(疎通確認として初回バックアップを実行しました: ${testRun.message})`,
    ui.ButtonSet.OK
  );
}

/**
 * メニューから月次アーカイブトリガーを解除する関数
 */
function removeArchiveTriggerFromMenu() {
  const result = removeArchiveTrigger();
  SpreadsheetApp.getUi().alert('月次アーカイブトリガー解除', result.message, SpreadsheetApp.getUi().ButtonSet.OK);
}

/**
 * メニューからデータ初期化+ダミーデータ投入を実行する関数(開発・デモ用)
 * 書籍DB・利用者DB・貸出記録の既存データをすべて消して置き換えるため、
 * 実行前に確認ダイアログを出す。
 */
function seedDummyDataFromMenu() {
  const ui = SpreadsheetApp.getUi();

  // メニュー表示ガードと二重に、実行時にも開発モードを確認する
  if (!isDevelopmentMode_()) {
    ui.alert(
      '実行できません',
      'この機能は開発モード専用です。設定DBの operationMode を development にすると使用できます。',
      ui.ButtonSet.OK
    );
    return;
  }

  const confirm = ui.alert(
    '【開発用】データ初期化+ダミーデータ投入',
    '書籍DB・利用者DB・貸出記録の既存データをすべて削除し、ダミーデータに置き換えます。\n' +
    'この操作は元に戻せません(設定DBは変更しません)。実行しますか?',
    ui.ButtonSet.OK_CANCEL
  );
  if (confirm !== ui.Button.OK) return;

  // 公開ラッパーは作らない: google.script.run から確認なしで呼べると
  // Webアプリの利用者が全データを消せてしまうため、メニュー経由でのみ実行する
  // (この関数自体は SpreadsheetApp.getUi() がWebアプリ文脈では例外になるため悪用できない)
  const result = runWithScriptLock_(
    () => seedDummyData_(),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
  ui.alert(result.success ? 'ダミーデータ投入完了' : 'ダミーデータ投入失敗', result.message, ui.ButtonSet.OK);
}

function seedDummyData_() {
  try {
    // 確認ダイアログ表示中に運用モードが戻された場合に備え、ロック内で再確認する
    if (!isDevelopmentMode_()) {
      return { success: false, message: "開発モードではないため中止しました。設定DBの operationMode を確認してください。" };
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = new Date();
    const daysAgo = n => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);
    const daysLater = n => new Date(now.getTime() + n * 24 * 60 * 60 * 1000);

    // シートを取得し、ヘッダーをSCHEMAで書き直してデータ行をクリアする
    const resetSheet = (sheetName, dataRowCount) => {
      let sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      }
      sheet.clearContents();
      const headers = SCHEMA[sheetName].headers;
      // グリッドが定義より狭い場合は列・行を足す(切り詰められたシートで範囲外エラーにしない)
      if (sheet.getMaxColumns() < headers.length) {
        sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
      }
      const requiredRows = dataRowCount + 1; // ヘッダー行を含む
      if (sheet.getMaxRows() < requiredRows) {
        sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
      }
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setValues([headers]);
      headerRange.setFontWeight("bold").setBackground("#f3f3f3");
      sheet.setFrozenRows(1);
      return sheet;
    };

    // --- 利用者DB: 5名(1名は削除済み) ---
    // 電話番号は先頭の0が消えないよう书式を「テキスト」にして書き込む
    const userSheet = resetSheet("利用者DB", 5);
    const users = [
      ["R00001", "山田太郎", "taro.yamada@example.com", "090-0000-0001", "東京都千代田区1-1-1", daysAgo(400), ""],
      ["R00002", "佐藤花子", "hanako.sato@example.com", "090-0000-0002", "東京都中央区2-2-2", daysAgo(300), ""],
      ["R00003", "鈴木一郎", "ichiro.suzuki@example.com", "090-0000-0003", "東京都港区3-3-3", daysAgo(200), ""],
      ["R00004", "田中美咲", "misaki.tanaka@example.com", "090-0000-0004", "東京都新宿区4-4-4", daysAgo(100), ""],
      ["R00005", "高橋健", "ken.takahashi@example.com", "090-0000-0005", "東京都渋谷区5-5-5", daysAgo(500), "削除済み"]
    ];
    userSheet.getRange(2, 4, users.length, 1).setNumberFormat("@"); // 電話番号列
    userSheet.getRange(2, 1, users.length, users[0].length).setValues(users);

    // --- 書籍DB: 6冊(実在ISBN・複数コピー・1冊は廃棄) ---
    const bookSheet = resetSheet("書籍DB", 6);
    const books = [
      ["9784815615604-001", "9784815615604", "22世紀の民主主義", "成田悠輔", "SBクリエイティブ", "", "貸出中"],
      ["9784815615604-002", "9784815615604", "22世紀の民主主義", "成田悠輔", "SBクリエイティブ", "", "在庫"],
      ["9784046067012-001", "9784046067012", "ラスボスに負けても", "ハネハネ", "KADOKAWA", "", "在庫"],
      ["9784588007040-001", "9784588007040", "報酬主義をこえて", "アルフィ・コーン", "法政大学出版局", "", "貸出中"],
      ["9784296002764-001", "9784296002764", "「考える力」と「好奇心」をぐんぐん伸ばす AI×学び入門", "安井正樹", "日経BP", "", "在庫"],
      ["9784296002764-002", "9784296002764", "「考える力」と「好奇心」をぐんぐん伸ばす AI×学び入門", "安井正樹", "日経BP", "水濡れのため", "廃棄"]
    ];
    bookSheet.getRange(2, 1, books.length, books[0].length).setValues(books);

    // --- 貸出記録: 3件(延滞1・貸出中1・返却済1)。書籍DBの状態と整合させる ---
    const lendingSheet = resetSheet("貸出記録", 3);
    const lendings = [
      // 延滞中: 30日前に貸出、16日前が返却期限
      ["9784815615604-001", "22世紀の民主主義", "R00001", "山田太郎", daysAgo(30), daysAgo(16), "未返却", ""],
      // 貸出中(期限内): 3日前に貸出、11日後が返却期限
      ["9784588007040-001", "報酬主義をこえて", "R00002", "佐藤花子", daysAgo(3), daysLater(11), "未返却", ""],
      // 返却済: 60日前に貸出、46日前期限、50日前に返却
      ["9784046067012-001", "ラスボスに負けても", "R00003", "鈴木一郎", daysAgo(60), daysAgo(46), "返却済", daysAgo(50)]
    ];
    lendingSheet.getRange(2, 1, lendings.length, lendings[0].length).setValues(lendings);

    const message =
      `ダミーデータを投入しました。\n` +
      `利用者: ${users.length}名(うち削除済み1名) / 書籍: ${books.length}冊(うち廃棄1冊) / ` +
      `貸出記録: ${lendings.length}件(延滞1・貸出中1・返却済1)`;
    console.log(message);
    return { success: true, message: message };
  } catch (error) {
    console.error(`ダミーデータ投入中にエラーが発生しました: ${error}`);
    return { success: false, message: `ダミーデータ投入に失敗しました: ${error.message}` };
  }
}

/**
 * 図書館の統計データを取得する関数
 * @return {object} 統計データ
 */
function getLibraryStatistics() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    
    if (!lendingSheet) {
      throw new Error("貸出記録シートが見つかりません。");
    }
    
    // 必要なA〜G列のみ読み込む(H列以降は統計に不要)
    const lendingLastRow = lendingSheet.getLastRow();
    const data = lendingLastRow > 0 ? lendingSheet.getRange(1, 1, lendingLastRow, 7).getValues() : [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // ヘッダー: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時, F:返却予定日, G:返却状況
    const bookIdColIndex = 0;
    const titleColIndex = 1;
    const userIdColIndex = 2;
    const userNameColIndex = 3;
    const lendingDateColIndex = 4;
    const dueDateColIndex = 5;
    const statusColIndex = 6;

    const records = [];
    
    // ヘッダー行を除く
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const lendingDate = row[lendingDateColIndex];
      const dueDate = row[dueDateColIndex];
      const status = row[statusColIndex];
      
      // 延滞判定
      let isOverdue = false;
      if (status === "未返却" && dueDate instanceof Date && !isNaN(dueDate)) {
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        isOverdue = due < today;
      }
      
      records.push({
        bookId: row[bookIdColIndex] || "",
        bookTitle: row[titleColIndex] || "",
        userId: row[userIdColIndex] || "",
        userName: row[userNameColIndex] || "",
        lendingDate: toIsoString_(lendingDate),
        dueDate: toIsoString_(dueDate),
        status: status,
        isOverdue: isOverdue
      });
    }
    
    return { records: records };
    
  } catch (error) {
    console.error(`統計データの取得中にエラーが発生しました: ${error}`);
    throw new Error(`統計データの取得に失敗しました: ${error.message}`);
  }
}

/**
 * 統計レポートを作成する関数
 * @param {string} period - 集計期間 (week, month, year, all)
 * @return {object} 処理結果
 */
function createStatisticsReport(period) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const statisticsData = getLibraryStatistics();
    
    // 期間の計算
    const now = new Date();
    let startDate;
    let periodText;
    
    switch (period) {
      case 'week':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        periodText = "今週";
        break;
      case 'month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        periodText = "今月";
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        periodText = "今年";
        break;
      default:
        startDate = new Date(0);
        periodText = "全期間";
    }
    
    // 期間でフィルタリング
    const filteredRecords = statisticsData.records.filter(record => {
      const lendingDate = new Date(record.lendingDate);
      return lendingDate >= startDate;
    });
    
    // 統計の計算
    const stats = {
      totalLending: filteredRecords.length,
      currentLending: 0,
      returned: 0,
      overdue: 0,
      bookCount: {},
      userCount: {}
    };
    
    filteredRecords.forEach(record => {
      if (record.status === '未返却') {
        stats.currentLending++;
        if (record.isOverdue) {
          stats.overdue++;
        }
      } else {
        stats.returned++;
      }
      
      // 書籍カウント
      if (!stats.bookCount[record.bookTitle]) {
        stats.bookCount[record.bookTitle] = 0;
      }
      stats.bookCount[record.bookTitle]++;
      
      // 利用者カウント
      if (!stats.userCount[record.userName]) {
        stats.userCount[record.userName] = 0;
      }
      stats.userCount[record.userName]++;
    });
    
    // レポート名
    const reportName = `貸出統計レポート_${periodText}_${Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmm")}`;
    
    // 既存のレポートシートがあれば削除
    const existingSheet = ss.getSheetByName(reportName);
    if (existingSheet) {
      ss.deleteSheet(existingSheet);
    }
    
    // 新しいシートを作成
    const reportSheet = ss.insertSheet(reportName);
    
    // サマリー情報
    const summaryData = [
      ["貸出統計レポート", ""],
      ["集計期間", periodText],
      ["集計開始日", Utilities.formatDate(startDate, Session.getScriptTimeZone(), "yyyy/MM/dd")],
      ["作成日時", Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss")],
      ["", ""],
      ["総貸出数", stats.totalLending + "件"],
      ["貸出中", stats.currentLending + "件"],
      ["返却済", stats.returned + "件"],
      ["延滞中", stats.overdue + "件"],
      ["", ""]
    ];
    
    reportSheet.getRange(1, 1, summaryData.length, 2).setValues(summaryData);
    reportSheet.getRange(1, 1, 1, 2).merge().setFontWeight("bold").setFontSize(14);
    
    let currentRow = summaryData.length + 2;
    
    // 人気書籍ランキング
    const bookRanking = Object.entries(stats.bookCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    reportSheet.getRange(currentRow, 1).setValue("人気書籍ランキング TOP20");
    reportSheet.getRange(currentRow, 1, 1, 3).merge().setFontWeight("bold").setBackground("#f3f3f3");
    currentRow++;
    
    reportSheet.getRange(currentRow, 1, 1, 3).setValues([["順位", "書籍名", "貸出回数"]]);
    reportSheet.getRange(currentRow, 1, 1, 3).setFontWeight("bold");
    currentRow++;
    
    bookRanking.forEach((item, index) => {
      reportSheet.getRange(currentRow, 1, 1, 3).setValues([[index + 1, item[0], item[1] + "回"]]);
      currentRow++;
    });
    
    currentRow += 2;
    
    // アクティブ利用者ランキング
    const userRanking = Object.entries(stats.userCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    
    reportSheet.getRange(currentRow, 1).setValue("アクティブ利用者ランキング TOP20");
    reportSheet.getRange(currentRow, 1, 1, 3).merge().setFontWeight("bold").setBackground("#f3f3f3");
    currentRow++;
    
    reportSheet.getRange(currentRow, 1, 1, 3).setValues([["順位", "利用者名", "貸出冊数"]]);
    reportSheet.getRange(currentRow, 1, 1, 3).setFontWeight("bold");
    currentRow++;
    
    userRanking.forEach((item, index) => {
      reportSheet.getRange(currentRow, 1, 1, 3).setValues([[index + 1, item[0], item[1] + "冊"]]);
      currentRow++;
    });
    
    // 列幅を自動調整
    reportSheet.autoResizeColumns(1, 3);
    
    // 作成したシートをアクティブにする
    ss.setActiveSheet(reportSheet);
    
    console.log(`統計レポート作成完了: ${reportName}`);
    return { success: true, message: `統計レポート「${reportName}」を作成しました。` };
    
  } catch (error) {
    console.error(`統計レポート作成中にエラーが発生しました: ${error}`);
    throw new Error(`レポート作成に失敗しました: ${error.message}`);
  }
}

/**
 * 貸出履歴を検索する関数
 * @param {object} criteria - 検索条件
 * @return {Array} 検索結果の配列
 */
function searchLendingHistory(criteria) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    
    if (!lendingSheet) {
      throw new Error("貸出記録シートが見つかりません。");
    }
    
    const data = lendingSheet.getDataRange().getValues();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // ヘッダー: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時, F:返却予定日, G:返却状況, H:返却日時
    const bookIdColIndex = 0;
    const titleColIndex = 1;
    const userIdColIndex = 2;
    const userNameColIndex = 3;
    const lendingDateColIndex = 4;
    const dueDateColIndex = 5;
    const statusColIndex = 6;
    const returnDateColIndex = 7;
    
    const results = [];
    
    // ヘッダー行を除く
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      
      // 検索条件でフィルタリング
      let match = true;
      
      // 書籍ID
      if (criteria.bookId && row[bookIdColIndex]) {
        if (row[bookIdColIndex].toString().toLowerCase() !== criteria.bookId.toLowerCase()) {
          match = false;
        }
      }
      
      // 書籍名（部分一致）
      if (criteria.bookTitle && row[titleColIndex]) {
        if (!row[titleColIndex].toString().toLowerCase().includes(criteria.bookTitle.toLowerCase())) {
          match = false;
        }
      }
      
      // 利用者ID
      if (criteria.userId && row[userIdColIndex]) {
        if (row[userIdColIndex].toString().toLowerCase() !== criteria.userId.toLowerCase()) {
          match = false;
        }
      }
      
      // 利用者名（部分一致）
      if (criteria.userName && row[userNameColIndex]) {
        if (!row[userNameColIndex].toString().toLowerCase().includes(criteria.userName.toLowerCase())) {
          match = false;
        }
      }
      
      // 貸出日（開始）
      if (criteria.dateFrom && row[lendingDateColIndex]) {
        const lendingDate = new Date(row[lendingDateColIndex]);
        const dateFrom = new Date(criteria.dateFrom);
        if (lendingDate < dateFrom) {
          match = false;
        }
      }
      
      // 貸出日（終了）
      if (criteria.dateTo && row[lendingDateColIndex]) {
        const lendingDate = new Date(row[lendingDateColIndex]);
        const dateTo = new Date(criteria.dateTo);
        dateTo.setHours(23, 59, 59, 999); // その日の終わりまで含める
        if (lendingDate > dateTo) {
          match = false;
        }
      }
      
      // 返却状況
      const status = row[statusColIndex];
      const dueDate = row[dueDateColIndex];
      let isOverdue = false;
      
      if (status === "未返却" && dueDate instanceof Date && !isNaN(dueDate)) {
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        isOverdue = due < today;
      }
      
      if (criteria.status) {
        if (criteria.status === "延滞中") {
          if (!isOverdue || status !== "未返却") {
            match = false;
          }
        } else if (criteria.status !== status) {
          match = false;
        }
      }
      
      if (match) {
        results.push({
          bookId: row[bookIdColIndex] || "",
          bookTitle: row[titleColIndex] || "",
          userId: row[userIdColIndex] || "",
          userName: row[userNameColIndex] || "",
          lendingDate: toIsoString_(row[lendingDateColIndex]),
          dueDate: toIsoString_(row[dueDateColIndex]),
          returnDate: row[returnDateColIndex] ? toIsoString_(row[returnDateColIndex]) : null,
          status: status,
          isOverdue: isOverdue
        });
      }
    }
    
    // 貸出日の新しい順にソート
    results.sort((a, b) => {
      const dateA = new Date(a.lendingDate);
      const dateB = new Date(b.lendingDate);
      return dateB - dateA;
    });
    
    console.log(`貸出履歴検索完了: ${results.length}件`);
    return results;
    
  } catch (error) {
    console.error(`貸出履歴の検索中にエラーが発生しました: ${error}`);
    throw new Error(`貸出履歴の検索に失敗しました: ${error.message}`);
  }
}

/**
 * 貸出履歴レポートを作成する関数
 * @param {Array} historyData - 履歴データの配列
 * @return {object} 処理結果
 */
function createHistoryReport(historyData) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const now = new Date();
    const reportName = `貸出履歴レポート_${Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmm")}`;
    
    // 既存のレポートシートがあれば削除
    const existingSheet = ss.getSheetByName(reportName);
    if (existingSheet) {
      ss.deleteSheet(existingSheet);
    }
    
    // 新しいシートを作成
    const reportSheet = ss.insertSheet(reportName);
    
    // ヘッダー行を設定
    const headers = ["書籍ID", "書籍名", "利用者ID", "利用者名", "貸出日", "返却予定日", "返却日", "状態"];
    reportSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    reportSheet.getRange(1, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f3f3");
    
    if (historyData.length > 0) {
      // レポートデータを作成
      const reportData = historyData.map(record => {
        let statusText = record.status;
        if (record.status === "未返却" && record.isOverdue) {
          statusText = "延滞中";
        }
        
        return [
          record.bookId,
          record.bookTitle,
          record.userId,
          record.userName,
          record.lendingDate ? Utilities.formatDate(new Date(record.lendingDate), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm") : "",
          record.dueDate ? Utilities.formatDate(new Date(record.dueDate), Session.getScriptTimeZone(), "yyyy/MM/dd") : "",
          record.returnDate ? Utilities.formatDate(new Date(record.returnDate), Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm") : "",
          statusText
        ];
      });
      
      // データをシートに書き込み
      reportSheet.getRange(2, 1, reportData.length, headers.length).setValues(reportData);
      
      // 状態に応じて行の色を設定
      for (let i = 0; i < historyData.length; i++) {
        const row = i + 2;
        if (historyData[i].status === "未返却") {
          if (historyData[i].isOverdue) {
            reportSheet.getRange(row, 1, 1, headers.length).setBackground("#ffcdd2"); // 延滞中は赤
          } else {
            reportSheet.getRange(row, 1, 1, headers.length).setBackground("#fff3e0"); // 未返却はオレンジ
          }
        }
      }
    }
    
    // 列幅を自動調整
    reportSheet.autoResizeColumns(1, headers.length);
    
    // フィルターを設定
    if (historyData.length > 0) {
      reportSheet.getRange(1, 1, historyData.length + 1, headers.length).createFilter();
    }
    
    // 作成したシートをアクティブにする
    ss.setActiveSheet(reportSheet);
    
    console.log(`貸出履歴レポート作成完了: ${reportName}`);
    return { success: true, message: `貸出履歴レポート「${reportName}」を作成しました。` };
    
  } catch (error) {
    console.error(`貸出履歴レポート作成中にエラーが発生しました: ${error}`);
    throw new Error(`履歴レポート作成に失敗しました: ${error.message}`);
  }
}

/**
 * 書籍在庫情報を取得する関数（複数冊管理対応）
 * @return {Array} 書籍在庫情報の配列
 */
function getBookInventory() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    const lendingSheet = ss.getSheetByName("貸出記録");
    
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    const bookData = bookSheet.getDataRange().getValues();
    const lendingData = lendingSheet ? lendingSheet.getDataRange().getValues() : [];
    
    // ヘッダー行をチェックして新旧構造を判定
    if (!(bookData.length > 0 && bookData[0][0] === "管理番号")) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }


    // 管理番号/書籍IDをキーとして、現在の貸出状況を格納するMap
    const lendingMap = new Map();
    
    // 貸出記録から現在貸出中の書籍を抽出
    for (let i = 1; i < lendingData.length; i++) {
      const bookId = lendingData[i][0]; // A列: 書籍ID（管理番号またはISBN）
      const status = lendingData[i][6];  // G列: 返却状況
      
      if (status === "未返却") {
        lendingMap.set(bookId, {
          borrowerName: lendingData[i][3],              // D列: 利用者名
          borrowerId: lendingData[i][2],                // C列: 利用者ID
          lendingDate: toIsoString_(lendingData[i][4]), // E列: 貸出日時
          dueDate: toIsoString_(lendingData[i][5])      // F列: 返却予定日
        });
      }
    }
    
    // 書籍在庫情報を作成
    const inventory = [];
    
    // A:管理番号, B:ISBN, C:書籍名, D:著者名, E:出版社, F:備考, G:状態
    for (let i = 1; i < bookData.length; i++) {
      const managementNumber = bookData[i][0]; // A列: 管理番号
      const isbn = bookData[i][1];             // B列: ISBN
      const title = bookData[i][2];            // C列: 書籍名
      const author = bookData[i][3] || "";     // D列: 著者名
      const publisher = bookData[i][4] || "";  // E列: 出版社
      const dbStatus = bookData[i][6] || "在庫"; // G列: 状態

      if (!managementNumber) continue; // 管理番号がない行はスキップ

      const lendingInfo = lendingMap.get(managementNumber);

      inventory.push({
        managementNumber: managementNumber,
        isbn: isbn || "",
        bookId: managementNumber, // 互換性のため
        title: title || "タイトル不明",
        author: author,
        publisher: publisher,
        status: dbStatus === "廃棄" ? "廃棄" : (dbStatus === "貸出中" || lendingInfo ? "貸出中" : "在庫"),
        borrowerName: lendingInfo ? lendingInfo.borrowerName : null,
        borrowerId: lendingInfo ? lendingInfo.borrowerId : null,
        lendingDate: lendingInfo ? lendingInfo.lendingDate : null,
        dueDate: lendingInfo ? lendingInfo.dueDate : null
      });
    }
    
    // 管理番号でソート
    inventory.sort((a, b) => {
      if (a.managementNumber < b.managementNumber) return -1;
      if (a.managementNumber > b.managementNumber) return 1;
      return 0;
    });
    
    console.log(`書籍在庫情報取得完了: ${inventory.length}件`);
    return inventory;
    
  } catch (error) {
    console.error(`書籍在庫情報の取得中にエラーが発生しました: ${error}`);
    throw new Error(`書籍在庫情報の取得に失敗しました: ${error.message}`);
  }
}

/**
 * 書籍の詳細情報を取得する関数（編集用）
 * @param {string} bookId - 書籍ID
 * @return {object|null} 書籍情報オブジェクト
 */
function getBookFullDetails(bookId) {
  if (!bookId) {
    console.error("書籍IDが指定されていません。");
    return null;
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    const lendingSheet = ss.getSheetByName("貸出記録");
    
    if (!bookSheet) {
      console.error("書籍DBシートが見つかりません。");
      return null;
    }
    
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    const bookData = bookSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < bookData.length; i++) {
      const rowBookId = bookData[i][bookIdColIndex] ? bookData[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookId.trim().toLowerCase()) {
        // 基本情報(新レイアウト: A=管理番号, B=ISBN, C=書籍名, D=著者名, E=出版社, F=備考, G=状態)
        const col = SCHEMA["書籍DB"].col;
        const bookInfo = {
          bookId: rowBookId,
          title: bookData[i][col.書籍名] || "",
          author: bookData[i][col.著者名] || "",
          publisher: bookData[i][col.出版社] || "",
          note: bookData[i][col.備考] || "",
          category: "",
          location: "",
          registrationDate: null,
          isAvailable: true,
          status: (bookData[i][col.状態] || "").toString().trim(),
          lastLendingDate: null
        };

        // 論理削除(廃棄)された本は貸出可能と誤表示しない
        if (bookInfo.status === "廃棄") {
          bookInfo.isAvailable = false;
        }
        
        // 貸出状態と最終貸出日を確認
        if (lendingSheet) {
          const lendingData = lendingSheet.getDataRange().getValues();
          for (let j = 1; j < lendingData.length; j++) {
            if (lendingData[j][0] && lendingData[j][0].toString().trim().toLowerCase() === bookId.trim().toLowerCase()) {
              // 貸出日を更新
              const lendingDate = lendingData[j][4];
              if (lendingDate && (!bookInfo.lastLendingDate || lendingDate > bookInfo.lastLendingDate)) {
                bookInfo.lastLendingDate = lendingDate;
              }
              
              // 未返却の場合
              if (lendingData[j][6] === "未返却") {
                bookInfo.isAvailable = false;
              }
            }
          }
        }

        // Dateのままだと google.script.run が黙って失敗するためISO文字列へ変換
        bookInfo.lastLendingDate = bookInfo.lastLendingDate ? toIsoString_(bookInfo.lastLendingDate) : null;

        return bookInfo;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`書籍情報の取得中にエラーが発生しました: ${error}`);
    throw new Error(`書籍情報の取得に失敗しました: ${error.message}`);
  }
}

/**
 * 書籍の貸出履歴を取得する関数
 * @param {string} bookId - 書籍ID
 * @return {Array} 貸出履歴の配列
 */
function getBookLendingHistory(bookId) {
  if (!bookId) return [];
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (!lendingSheet) return [];
    
    const data = lendingSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列
    const history = [];
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowBookId = data[i][bookIdColIndex] ? data[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookId.trim().toLowerCase()) {
        history.push({
          userId: data[i][2] || "",
          userName: data[i][3] || "",
          lendingDate: toIsoString_(data[i][4]),
          dueDate: toIsoString_(data[i][5]),
          status: data[i][6] || "",
          returnDate: toIsoString_(data[i][7])
        });
      }
    }
    
    // 貸出日の降順でソート
    history.sort((a, b) => {
      const dateA = new Date(a.lendingDate);
      const dateB = new Date(b.lendingDate);
      return dateB - dateA;
    });
    
    return history;
  } catch (error) {
    console.error(`貸出履歴の取得中にエラーが発生しました: ${error}`);
    return [];
  }
}

/**
 * 書籍情報を更新する関数
 * @param {object} bookData - 更新する書籍データ
 * @return {boolean} 更新成功の可否
 */
function updateBookInfo(bookData) {
  return runWithScriptLock_(
    () => updateBookInfo_(bookData),
    new Error(LOCK_BUSY_MESSAGE)
  );
}

function updateBookInfo_(bookData) {
  if (!bookData || !bookData.bookId) {
    throw new Error("書籍IDが指定されていません。");
  }
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。onOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    const data = bookSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowBookId = data[i][bookIdColIndex] ? data[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookData.bookId.trim().toLowerCase()) {
        // 書籍名(C)〜備考(F)のみ更新する。
        // A=管理番号・B=ISBN・G=状態(在庫/貸出中/廃棄)は編集で変更しない
        const col = SCHEMA["書籍DB"].col;
        bookSheet.getRange(i + 1, col.書籍名 + 1, 1, 4).setValues([[
          bookData.title || "",
          bookData.author || "",
          bookData.publisher || "",
          bookData.note || ""
        ]]);
        console.log(`書籍情報を更新しました: ${bookData.bookId}`);
        return true;
      }
    }
    
    throw new Error("指定された書籍IDが見つかりません。");
  } catch (error) {
    console.error(`書籍情報の更新中にエラーが発生しました: ${error}`);
    throw new Error(`書籍情報の更新に失敗しました: ${error.message}`);
  }
}

/**
 * 書籍を削除する関数
 * @param {string} bookId - 削除する書籍ID
 * @return {boolean} 削除成功の可否
 */
function deleteBook(bookId) {
  return runWithScriptLock_(
    () => deleteBook_(bookId),
    new Error(LOCK_BUSY_MESSAGE)
  );
}

function deleteBook_(bookId) {
  if (!bookId) {
    throw new Error("書籍IDが指定されていません。");
  }
  
  try {
    // まず貸出中でないか確認
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    if (lendingSheet) {
      const lendingData = lendingSheet.getDataRange().getValues();
      const bookIdColIndex = 0; // A列
      const statusColIndex = 6; // G列
      
      for (let i = 1; i < lendingData.length; i++) {
        const rowBookId = lendingData[i][bookIdColIndex] ? lendingData[i][bookIdColIndex].toString().trim() : "";
        const status = lendingData[i][statusColIndex];
        if (rowBookId.toLowerCase() === bookId.trim().toLowerCase() && status === "未返却") {
          throw new Error("貸出中の書籍は削除できません。");
        }
      }
    }
    
    // 書籍DBから削除
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    if (!isNewBookLayout_(bookSheet)) {
      throw new Error("書籍DBが旧レイアウトです。先にonOpen内でコメントアウトされている管理メニュー「書籍DBを新レイアウトへ移行」を有効化して実行してください。");
    }

    const data = bookSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列

    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowBookId = data[i][bookIdColIndex] ? data[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookId.trim().toLowerCase()) {
        // 論理削除: 行は残して状態を「廃棄」にする。
        // 過去の貸出記録との参照を守る(在庫扱いされないため貸出対象にはならない)
        bookSheet.getRange(i + 1, SCHEMA["書籍DB"].col.状態 + 1).setValue("廃棄");
        console.log(`書籍を論理削除(廃棄)しました: ${bookId}`);
        return true;
      }
    }

    throw new Error("指定された書籍IDが見つかりません。");
  } catch (error) {
    console.error(`書籍の削除中にエラーが発生しました: ${error}`);
    throw new Error(`書籍の削除に失敗しました: ${error.message}`);
  }
}

/**
 * 在庫リストレポートを作成する関数
 * @return {object} 処理結果
 */
function createInventoryReport() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const inventory = getBookInventory();
    const now = new Date();
    const reportName = `書籍在庫リスト_${Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyyMMdd_HHmm")}`;
    
    // 既存のレポートシートがあれば削除
    const existingSheet = ss.getSheetByName(reportName);
    if (existingSheet) {
      ss.deleteSheet(existingSheet);
    }
    
    // 新しいシートを作成
    const reportSheet = ss.insertSheet(reportName);
    
    // 状態値を正規化する(getBookInventory は日本語の状態を返す)
    const normalizeStatus = book => {
      if (book.status === '在庫' || book.status === 'available') return '在庫';
      if (book.status === '廃棄' || book.status === 'discarded') return '廃棄';
      return '貸出中';
    };

    // サマリー情報(廃棄は総蔵書数に含めず別掲する)
    const discardedBooks = inventory.filter(book => normalizeStatus(book) === '廃棄').length;
    const totalBooks = inventory.length - discardedBooks;
    const availableBooks = inventory.filter(book => normalizeStatus(book) === '在庫').length;
    const borrowedBooks = inventory.filter(book => normalizeStatus(book) === '貸出中').length;

    const summaryData = [
      ["書籍在庫リスト", ""],
      ["作成日時", Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss")],
      ["", ""],
      ["総蔵書数", totalBooks + "冊"],
      ["貸出可能", availableBooks + "冊"],
      ["貸出中", borrowedBooks + "冊"],
      ["廃棄", discardedBooks + "冊"],
      ["", ""]
    ];
    
    reportSheet.getRange(1, 1, summaryData.length, 2).setValues(summaryData);
    reportSheet.getRange(1, 1, 1, 2).merge().setFontWeight("bold").setFontSize(14);
    
    // ヘッダー行を設定
    const currentRow = summaryData.length + 2;
    const headers = ["書籍ID", "書籍名", "著者", "出版社", "状態", "貸出者", "貸出日", "返却予定日"];
    reportSheet.getRange(currentRow, 1, 1, headers.length).setValues([headers]);
    reportSheet.getRange(currentRow, 1, 1, headers.length).setFontWeight("bold").setBackground("#f3f3f3");
    
    // データ行を作成
    if (inventory.length > 0) {
      const dataRows = inventory.map(book => {
        const normalized = normalizeStatus(book);
        const statusText = normalized === '在庫' ? '貸出可能' : normalized;
        return [
          book.bookId,
          book.title,
          book.author,
          book.publisher,
          statusText,
          book.borrowerName || "",
          book.lendingDate ? Utilities.formatDate(new Date(book.lendingDate), Session.getScriptTimeZone(), "yyyy/MM/dd") : "",
          book.dueDate ? Utilities.formatDate(new Date(book.dueDate), Session.getScriptTimeZone(), "yyyy/MM/dd") : ""
        ];
      });
      
      reportSheet.getRange(currentRow + 1, 1, dataRows.length, headers.length).setValues(dataRows);
      
      // 状態に応じて行の色を設定
      for (let i = 0; i < inventory.length; i++) {
        const row = currentRow + 1 + i;
        const normalized = normalizeStatus(inventory[i]);
        if (normalized === '貸出中') {
          reportSheet.getRange(row, 1, 1, headers.length).setBackground("#fff3e0"); // 貸出中はオレンジ
        } else if (normalized === '廃棄') {
          reportSheet.getRange(row, 1, 1, headers.length).setBackground("#eceff1"); // 廃棄はグレー
        }
      }
      
      // フィルターを設定
      reportSheet.getRange(currentRow, 1, inventory.length + 1, headers.length).createFilter();
    }
    
    // 列幅を自動調整
    reportSheet.autoResizeColumns(1, headers.length);
    
    // 作成したシートをアクティブにする
    ss.setActiveSheet(reportSheet);
    
    console.log(`在庫リストレポート作成完了: ${reportName}`);
    return { success: true, message: `在庫リスト「${reportName}」を作成しました。` };
    
  } catch (error) {
    console.error(`在庫リストレポート作成中にエラーが発生しました: ${error}`);
    throw new Error(`在庫リスト作成に失敗しました: ${error.message}`);
  }
}
