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
      default:
        // デフォルトはメニューページのまま
        break;
    }
  }

  const htmlOutput = HtmlService.createHtmlOutputFromFile(page)
      .setTitle(title)
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // QuaggaJSなどの外部ライブラリ読み込み許可
  return htmlOutput;
}

/**
 * WebアプリのURLを取得する関数
 * @return {string} WebアプリのURL
 */
function getWebAppUrl() {
  return ScriptApp.getService().getUrl();
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
  if (!isbn) return false;
  const normalized = isbn.toString().replace(/[-\s]/g, "");
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
 * メールアドレスの形式を簡易検証する共通関数
 * @param {string} email - 検証するメールアドレス
 * @return {boolean} 妥当なら true
 */
function isValidEmail_(email) {
  if (!email) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.toString().trim());
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
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    const data = bookSheet.getDataRange().getValues();
    
    // 新しいデータ構造のチェック
    if (data.length > 0 && data[0][0] === "管理番号") {
      const managementNumColIndex = 0; // A列
      const isbnColIndex = 1;         // B列
      const titleColIndex = 2;        // C列
      const statusColIndex = 6;       // G列
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowIsbn = row[isbnColIndex] ? row[isbnColIndex].toString().trim() : "";
        const status = row[statusColIndex] || "在庫";
        
        // ISBNが一致し、かつ在庫がある本を探す
        if (rowIsbn === isbn.trim() && status === "在庫") {
          const managementNum = row[managementNumColIndex] || "";
          const bookTitle = row[titleColIndex] || "タイトル不明";
          console.log(`利用可能な書籍発見: ${bookTitle} (管理番号: ${managementNum})`);
          return {
            title: bookTitle,
            managementNumber: managementNum,
            isbn: isbn,
            status: status
          };
        }
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
function getBookDetails(bookId) {
  if (!bookId) {
    console.error("書籍IDが指定されていません。");
    return null;
  }
  console.log(`書籍情報検索開始: 書籍ID=${bookId}`);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const bookSheet = ss.getSheetByName("書籍DB");
    if (!bookSheet) {
      console.error("シート「書籍DB」が見つかりません。");
      throw new Error("書籍DBシートが見つかりません。");
    }

    const data = bookSheet.getDataRange().getValues();
    
    // 新しいデータ構造のチェック（管理番号がある場合）
    if (data.length > 0 && data[0][0] === "管理番号") {
      // 新構造: A:管理番号, B:ISBN, C:書籍名, D:著者名, E:出版社, F:備考, G:状態
      const managementNumColIndex = 0; // A列
      const isbnColIndex = 1;         // B列
      const titleColIndex = 2;         // C列
      const statusColIndex = 6;        // G列
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const managementNum = row[managementNumColIndex] ? row[managementNumColIndex].toString().trim() : "";
        const isbn = row[isbnColIndex] ? row[isbnColIndex].toString().trim() : "";
        
        // 管理番号またはISBNで検索
        if ((managementNum && managementNum === bookId.trim()) || 
            (isbn && isbn === bookId.trim())) {
          const bookTitle = row[titleColIndex] || "タイトル不明";
          const status = row[statusColIndex] || "在庫";
          console.log(`書籍情報取得成功: ${bookTitle} (管理番号: ${managementNum}, 状態: ${status})`);
          return { 
            title: bookTitle,
            managementNumber: managementNum,
            isbn: isbn,
            status: status
          };
        }
      }
    } else {
      // 旧構造: A:書籍ID(ISBN), B:書籍名
      const bookIdColIndex = 0; // A列
      const titleColIndex = 1;  // B列
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        if (row[bookIdColIndex] && row[bookIdColIndex].toString().trim() === bookId.trim()) {
          const bookTitle = row[titleColIndex] || "タイトル不明";
          console.log(`書籍情報取得成功: ${bookTitle}`);
          return { 
            title: bookTitle,
            managementNumber: bookId,
            isbn: bookId,
            status: "在庫"
          };
        }
      }
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
 * @return {object|null} 利用者情報オブジェクト {name: string, email: string|null} または null
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

     const data = userSheet.getDataRange().getValues();
    // ヘッダー: A:利用者ID, B:氏名, C:メールアドレス
    const userIdColIndex = 0; // A列
    const nameColIndex = 1;   // B列
    const emailColIndex = 2;  // C列

    // ヘッダー行を除く (1行目から検索)
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // 利用者IDが一致するか確認（大文字小文字を無視）
      if (row[userIdColIndex] && row[userIdColIndex].toString().trim().toLowerCase() === userId.trim().toLowerCase()) {
        const userName = row[nameColIndex] || "氏名不明";
        const userEmail = row[emailColIndex] || null; // メールアドレスがない場合はnull
        console.log(`利用者情報取得成功: ${userName}, Email: ${userEmail}`);
        return { name: userName, email: userEmail };
      }
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
 * HTMLフォームから送信された貸出情報をスプレッドシートに記録する関数
 * @param {object} formData - フォームデータ {bookId: string, bookTitle: string, userId: string, userName: string}
 * @return {string} 処理結果メッセージ
 */
function processLendingForm(formData) {
  return runWithScriptLock_(
    () => processLendingForm_(formData),
    { success: false, message: LOCK_BUSY_MESSAGE }
  );
}

function processLendingForm_(formData) {
  console.log("貸出フォームデータ受信:", formData);
  try {
    // 入力チェック
    if (!formData.bookId || !formData.bookTitle || !formData.userId || !formData.userName) {
       throw new Error("必要な情報（書籍ID, 書籍名, 利用者ID, 利用者名）が不足しています。");
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const lendingSheet = ss.getSheetByName("貸出記録");
    const bookSheet = ss.getSheetByName("書籍DB");
    
    if (!lendingSheet) {
      console.error("シート「貸出記録」が見つかりません。");
      throw new Error("貸出記録シートが見つかりません。");
    }
    
    if (!bookSheet) {
      console.error("シート「書籍DB」が見つかりません。");
      throw new Error("書籍DBシートが見つかりません。");
    }
    
    // 書籍の状態をチェック（複数冊管理対応）
    const bookInfo = getBookDetails(formData.bookId);
    if (!bookInfo) {
      throw new Error("指定された書籍が見つかりません。");
    }
    
    if (bookInfo.status === "貸出中") {
      throw new Error("この書籍は既に貸出中です。");
    }

    // 貸出記録側にも未返却レコードがないか確認する
    // (過去データで書籍DBの状態が「在庫」のまま貸出中の本による二重貸出を防ぐ)
    const lendingData = lendingSheet.getDataRange().getValues();
    const targetBookId = formData.bookId.toString().trim();
    for (let i = 1; i < lendingData.length; i++) {
      const rowBookId = lendingData[i][0] ? lendingData[i][0].toString().trim() : "";
      if (rowBookId === targetBookId && lendingData[i][6] === "未返却") {
        throw new Error("この書籍には未返却の貸出記録があります。先に返却処理を行ってください。");
      }
    }

    const lendingDate = new Date(); // 現在日時を貸出日時とする

    // 設定から貸出期間を取得
    let lendingDays = 14; // デフォルト値
    try {
      const settings = getLibrarySettings();
      if (settings && settings.lendingDays) {
        lendingDays = settings.lendingDays;
      }
    } catch (e) {
      console.log("設定の取得に失敗したため、デフォルトの貸出期間を使用します:", e);
    }

    // スプレッドシートに追記するデータ配列
    // ヘッダー: 書籍ID, 書籍名, 利用者ID, 利用者名, 貸出日時, 返却予定日, 返却状況
    const dueDate = new Date(lendingDate.getTime() + lendingDays * 24 * 60 * 60 * 1000); // 貸出日から設定日数後
    const returnStatus = "未返却"; // 初期状態

    const newRow = [
      formData.bookId, // Changed from isbn
      formData.bookTitle,
      formData.userId,
      formData.userName,
      lendingDate,
      dueDate,
      returnStatus
    ];

    lendingSheet.appendRow(newRow);
    console.log("貸出記録を追加しました:", newRow);
    
    // 書籍DBの状態を「貸出中」に更新（複数冊管理対応）
    updateBookStatus(formData.bookId, "貸出中");

    return {
      success: true,
      message: `貸出登録成功: ${formData.bookTitle} を ${formData.userName} さんに貸し出しました。`
    };

  } catch (error) {
    console.error(`貸出情報の記録中にエラーが発生しました: ${error}`);
    console.error(error); // スタックトレースも出力
    // クライアントにエラーメッセージを返す
    return { success: false, message: `登録失敗: ${error.message}` };
  }
}


/**
 * 指定された書籍IDの未返却の貸出記録を取得する関数
 * @param {string} bookId - 検索する書籍ID
 * @return {object} 貸出情報とログ情報を含むオブジェクト
 */
function getLendingInfo(bookId) { // Changed parameter name
  // ログを収集するための配列
  const logs = [];
  
  if (!bookId) {
    logs.push("書籍IDが指定されていません。");
    return { lendingInfo: null, logs: logs };
  }
  
  logs.push(`未返却の貸出情報検索開始: 書籍ID=${bookId}`);
  console.log(`未返却の貸出情報検索開始: 書籍ID=${bookId}`);
  Logger.log(`デバッグ\t未返却の貸出情報検索開始: 書籍ID=${bookId}`);
  
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
    const bookIdColIndex = 0;     // A列 (Changed from isbnColIndex)
    const titleColIndex = 1;      // B列
    const userNameColIndex = 3;   // D列
    const lendingDateColIndex = 4;// E列
    const statusColIndex = 6;     // G列

    logs.push(`検索開始: 貸出記録シートの行数=${data.length}`);
    
    // 上から順に検索して、該当書籍IDの「未返却」レコードを見つける
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // デバッグ: 各行の書籍IDと状態を出力
      const rowBookId = row[bookIdColIndex] ? row[bookIdColIndex].toString().trim() : "空";
      const rowStatus = row[statusColIndex] || "空";
      const logMsg = `行 ${i + 1} 検証中: シートの書籍ID=[${rowBookId}], 検索対象の書籍ID=[${bookId.trim()}], 返却状況=[${rowStatus}]`;
      logs.push(logMsg);
      console.log(logMsg);
      Logger.log(`デバッグ\t${logMsg}`);
      
      // 詳細なデバッグ情報を追加
      const rowBookIdLower = rowBookId.toLowerCase();
      const bookIdLower = bookId.trim().toLowerCase();
      const isIdMatch = rowBookIdLower === bookIdLower;
      const isStatusMatch = rowStatus === "未返却";
      
      // より詳細なデバッグ情報
      Logger.log(`デバッグ\t行 ${i + 1} 詳細比較: ID一致=${isIdMatch}(${rowBookIdLower}=${bookIdLower}), 状態一致=${isStatusMatch}, 状態の実際の値=[${rowStatus}]`);
      
      // 大文字小文字を区別せずに比較し、状態が「未返却」かどうかを厳密に確認
      if (rowBookId && isIdMatch && isStatusMatch) {
        const lendingDate = row[lendingDateColIndex];
        const lendingInfo = {
          bookTitle: row[titleColIndex] || "",
          userName: row[userNameColIndex] || "",
          // Dateオブジェクトが存在し、有効な日付であればISO文字列に変換
          lendingDate: (lendingDate instanceof Date && !isNaN(lendingDate)) ? lendingDate.toISOString() : null
        };
        const foundMsg = `未返却の貸出情報発見 (行 ${i + 1}): ${lendingInfo.bookTitle}, ${lendingInfo.userName}`;
        logs.push(foundMsg);
        console.log(foundMsg);
        Logger.log(`デバッグ\t${foundMsg}`);
        return { lendingInfo: lendingInfo, logs: logs };
      }
    }

    const notFoundMsg = `書籍ID ${bookId} の未返却の貸出記録が見つかりませんでした。`;
    logs.push(notFoundMsg);
    console.warn(notFoundMsg);
    return { lendingInfo: null, logs: logs }; // 見つからなかった場合
  } catch (error) {
    const errorMsg = `貸出情報の取得中にエラーが発生しました: ${error}`;
    logs.push(errorMsg);
    console.error(errorMsg);
    console.error(error);
    throw new Error(`貸出情報の取得に失敗しました: ${error.message}`);
  }
}


/**
 * 返却処理を実行し、貸出記録シートを更新する関数
 * @param {string} bookId - 返却する本の書籍ID
 * @return {object} 処理結果メッセージとログ情報を含むオブジェクト
 */
function processReturnForm(bookId) { // Changed parameter name
  return runWithScriptLock_(
    () => processReturnForm_(bookId),
    { success: false, message: `返却処理失敗: ${LOCK_BUSY_MESSAGE}`, logs: ["スクリプトロックを取得できませんでした。"] }
  );
}

function processReturnForm_(bookId) {
  // ログを収集するための配列
  const logs = [];
  
  if (!bookId) {
    return {
      success: false,
      message: "返却処理失敗: 書籍IDが指定されていません。",
      logs: ["書籍IDが指定されていません。"]
    };
  }
  
  const startMsg = `返却処理開始: 書籍ID=${bookId}`;
  logs.push(startMsg);
  console.log(startMsg);
  Logger.log(`デバッグ\t${startMsg}`);
  
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
    const bookIdColIndex = 0;     // A列 (Changed from isbnColIndex)
    const statusColIndex = 6;     // G列 (0から数えて6番目)
    const returnDateColIndex = 7; // H列 (0から数えて7番目)

    logs.push(`検索開始: 貸出記録シートの行数=${data.length}`);
    
    let recordFound = false;
    // 上から順に検索して、該当書籍IDの「未返却」レコードを見つける
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      // デバッグ: 各行の書籍IDと状態を出力
      const rowBookId = row[bookIdColIndex] ? row[bookIdColIndex].toString().trim() : "空";
      const rowStatus = row[statusColIndex] || "空";
      const logMsg = `行 ${i + 1} 検証中: シートの書籍ID=[${rowBookId}], 検索対象の書籍ID=[${bookId.trim()}], 返却状況=[${rowStatus}]`;
      logs.push(logMsg);
      console.log(logMsg);
      Logger.log(`デバッグ\t${logMsg}`);
      
      // 詳細なデバッグ情報を追加
      const rowBookIdLower = rowBookId.toLowerCase();
      const bookIdLower = bookId.trim().toLowerCase();
      const isIdMatch = rowBookIdLower === bookIdLower;
      const isStatusMatch = rowStatus === "未返却";
      
      // より詳細なデバッグ情報
      Logger.log(`デバッグ\t行 ${i + 1} 詳細比較: ID一致=${isIdMatch}(${rowBookIdLower}=${bookIdLower}), 状態一致=${isStatusMatch}, 状態の実際の値=[${rowStatus}]`);
      
      // 大文字小文字を区別せずに比較し、状態が「未返却」かどうかを厳密に確認
      if (rowBookId && isIdMatch && isStatusMatch) {

        // 返却処理の詳細をログに記録
        const bookTitle = data[i][1]; // 書籍名を取得 (B列)
        const userName = data[i][3]; // 利用者名を取得 (D列)
        const lendingDate = data[i][4]; // 貸出日時を取得 (E列)
        const dueDate = data[i][5]; // 返却予定日を取得 (F列)
        
        const lendingDateStr = lendingDate ? Utilities.formatDate(lendingDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss") : "不明";
        const dueDateStr = dueDate ? Utilities.formatDate(dueDate, Session.getScriptTimeZone(), "yyyy/MM/dd") : "不明";
        const currentDate = new Date();
        
        Logger.log(`デバッグ\t返却処理詳細情報: 書籍ID=${bookId}, 書籍名=${bookTitle}, 利用者名=${userName}, 貸出日=${lendingDateStr}, 返却予定日=${dueDateStr}`);
        
        // 返却状況を "返却済" に更新 (G列 = statusColIndex + 1)
        Logger.log(`デバッグ\t返却状況を更新: "未返却" → "返却済" (行 ${i + 1}, 列 ${statusColIndex + 1})`);
        lendingSheet.getRange(i + 1, statusColIndex + 1).setValue("返却済");
        
        // 返却日時を記録 (H列 = returnDateColIndex + 1)
        const returnDateStr = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
        Logger.log(`デバッグ\t返却日時を記録: ${returnDateStr} (行 ${i + 1}, 列 ${returnDateColIndex + 1})`);
        lendingSheet.getRange(i + 1, returnDateColIndex + 1).setValue(currentDate);

        // 返却期限との比較
        if (dueDate && currentDate > dueDate) {
          const daysDiff = Math.floor((currentDate - dueDate) / (1000 * 60 * 60 * 24));
          Logger.log(`デバッグ\t返却期限超過: ${daysDiff}日の延滞`);
        } else {
          Logger.log(`デバッグ\t返却期限内に返却されました`);
        }

        // 書籍DBの状態を「在庫」に更新（複数冊管理対応）
        updateBookStatus(bookId, "在庫");
        
        const successMsg = `書籍ID ${bookId} (書籍名: ${bookTitle}) の返却処理完了 (行 ${i + 1})`;
        logs.push(successMsg);
        console.log(successMsg);
        Logger.log(`デバッグ\t${successMsg}`);
        recordFound = true;
        return {
          success: true,
          message: `返却処理成功: ${bookTitle} を返却しました。`,
          logs: logs
        };
      }
    }

    if (!recordFound) {
      // 未返却の貸出記録が見つからなかった場合、追加の診断情報を提供
      Logger.log(`デバッグ\t未返却の貸出記録が見つかりませんでした。追加診断を実行します。`);
      
      // 該当書籍IDの貸出記録が存在するか確認（返却済みも含む）
      let anyRecordFound = false;
      let returnedRecords = 0;
      
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rowBookId = row[bookIdColIndex] ? row[bookIdColIndex].toString().trim().toLowerCase() : "";
        const bookIdLower = bookId.trim().toLowerCase();
        
        if (rowBookId === bookIdLower) {
          anyRecordFound = true;
          const rowStatus = row[statusColIndex] || "";
          if (rowStatus === "返却済") {
            returnedRecords++;
            const returnDate = row[returnDateColIndex];
            const returnDateStr = returnDate ? Utilities.formatDate(returnDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss") : "不明";
            Logger.log(`デバッグ\t既に返却済みの記録があります: 行 ${i + 1}, 返却日時=${returnDateStr}`);
          }
        }
      }
      
      if (anyRecordFound) {
        if (returnedRecords > 0) {
          Logger.log(`デバッグ\t書籍ID ${bookId} は既に返却済みです (${returnedRecords}件の返却済み記録があります)`);
        } else {
          Logger.log(`デバッグ\t書籍ID ${bookId} の貸出記録はありますが、返却状況が「未返却」ではありません`);
        }
      } else {
        Logger.log(`デバッグ\t書籍ID ${bookId} の貸出記録が見つかりません。書籍IDの入力ミスの可能性があります`);
      }
      
      const notFoundMsg = `書籍ID ${bookId} の未返却の貸出記録が見つかりませんでした。`;
      logs.push(notFoundMsg);
      console.warn(notFoundMsg);
      return {
        success: false,
        message: `返却処理失敗: この本の未返却の貸出記録が見つかりませんでした。書籍IDを確認してください。`,
        logs: logs
      };
    }

  } catch (error) {
    const errorMsg = `返却処理中にエラーが発生しました: ${error}`;
    logs.push(errorMsg);
    console.error(errorMsg);
    console.error(error);
    return {
      success: false,
      message: `返却処理失敗: ${error.message}`,
      logs: logs
    };
  }
}


/**
 * 返却期限を過ぎた未返却の本のリマインドメールを送信する関数
 * GASのトリガー（時間主導型、例: 毎日午前1時〜2時）で実行することを想定
 */
 function sendOverdueReminders() {
   console.log("延滞リマインダー処理開始");
   
   // 設定を取得
   let settings;
   try {
     settings = getLibrarySettings();
   } catch (e) {
     console.error("設定の取得に失敗しました:", e);
     settings = {}; // デフォルト値を使用
   }
   
   // メール通知が無効の場合は処理をスキップ
   if (settings.enableOverdue === false) {
     console.log("延滞通知が無効になっているため、処理をスキップします。");
     return;
   }
   
   const ss = SpreadsheetApp.getActiveSpreadsheet();
   const lendingSheet = ss.getSheetByName("貸出記録");
   const userSheet = ss.getSheetByName("利用者DB"); // getUserInfo内で使用 & 存在チェック

   if (!lendingSheet || !userSheet) {
     console.error("必要なシート（貸出記録または利用者DB）が見つかりません。処理を中断します。");
     return;
   }

  const data = lendingSheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 時刻部分をリセットして日付のみで比較

  // ヘッダー: A:書籍ID, B:書籍名, C:利用者ID, D:利用者名, E:貸出日時, F:返却予定日, G:返却状況
  const bookIdColIndex = 0;     // A列 (Changed from isbnColIndex)
  const titleColIndex = 1;      // B列
  const userIdColIndex = 2;     // C列
  const dueDateColIndex = 5;    // F列
  const statusColIndex = 6;     // G列

  let remindersSentCount = 0;
  const errors = [];

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
          const userId = row[userIdColIndex];
          const bookTitle = row[titleColIndex]; // 書籍名は貸出記録シートのB列から取得
          const bookId = row[bookIdColIndex]; // 書籍IDも取得しておく (ログ用など)
          const dueDateString = Utilities.formatDate(dueDate, Session.getScriptTimeZone(), "yyyy/MM/dd");

          console.log(`延滞発見: 行 ${i + 1}, 書籍ID: ${bookId}, 利用者ID: ${userId}, 書籍名: ${bookTitle}, 返却予定日: ${dueDateString}`); // Updated log

          try {
            // 利用者情報を取得（メールアドレスを含む）
            const userInfo = getUserInfo(userId);

            if (userInfo && userInfo.email) {
              const recipient = userInfo.email;
              const libraryName = settings.libraryName || "図書館";
              const subject = `【${libraryName}】書籍返却のお願い: ${bookTitle}`;
              const body = `${userInfo.name} 様\n\n`
                         + `いつも${libraryName}をご利用いただきありがとうございます。\n\n`
                         + `貸出中の書籍『${bookTitle}』の返却期限（${dueDateString}）が過ぎています。\n`
                         + `ご確認の上、速やかにご返却いただけますようお願いいたします。\n\n`
                         + `ご不明な点がございましたら、${libraryName}カウンターまでお問い合わせください。\n\n`
                         + `--\n${libraryName}図書管理システム`;

              // メールの送信量を確認 (クォータ対策)
              if (MailApp.getRemainingDailyQuota() > 0) {
                MailApp.sendEmail(recipient, subject, body);
                console.log(`リマインドメール送信成功: ${recipient}, 書籍: ${bookTitle}`);
                remindersSentCount++;
              } else {
                 const quotaErrorMsg = "メール送信クォータ上限に達したため、これ以上のメール送信を停止しました。";
                 console.error(quotaErrorMsg);
                 errors.push(quotaErrorMsg);
                 break; // クォータ超過したらループを抜ける
              }
            } else {
              const noEmailMsg = `利用者ID ${userId} のメールアドレスが見つからないため、メールを送信できませんでした。`;
              console.warn(noEmailMsg);
              errors.push(noEmailMsg);
            }
          } catch (e) {
             const sendErrorMsg = `行 ${i + 1} (利用者ID: ${userId}) のメール送信中にエラーが発生しました: ${e.message}`;
             console.error(sendErrorMsg);
             console.error(e);
             errors.push(sendErrorMsg);
          }
           // 短時間に大量の処理を避けるための待機（任意）
           // Utilities.sleep(500); // 0.5秒待機
        }
      } else {
         // 返却予定日のデータが不正な場合（日付でないなど）
         if (dueDateValue !== "") { // 空欄でない場合のみ警告
            console.warn(`行 ${i + 1} の返却予定日 (${dueDateValue}) が不正な形式です。スキップします。`);
         }
      }
    }
  }

  console.log(`延滞リマインダー処理完了。送信数: ${remindersSentCount}`);
  if (errors.length > 0) {
      console.warn("処理中に以下の警告/エラーが発生しました:");
      errors.forEach(err => console.warn(`- ${err}`));
      // 必要であれば管理者にエラーレポートをメールするなどの処理を追加
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
      const isIdMatch = rowBookIdLower === bookIdLower;
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

    // 書籍DBの情報を先に読み込んでおく（効率化のため）
    // 新レイアウト: A=管理番号, B=ISBN, C=書籍名, G=状態 / 旧レイアウト: A=書籍ID, B=書籍名
    const bookData = bookSheet.getDataRange().getValues();
    const isNewLayout = bookData.length > 0 && bookData[0][0] === "管理番号";
    const titleColIndex = isNewLayout ? 2 : 1;
    const bookMap = new Map(); // 管理番号をキー、{title, status, rowNumber} を値とするMap
    const copiesByIsbn = new Map(); // ISBNをキー、同一ISBNの蔵書 [{managementNumber, entry}] を値とするMap
    for (let i = 1; i < bookData.length; i++) {
      const bookId = bookData[i][0] ? bookData[i][0].toString().trim() : null;
      if (bookId) {
        const entry = {
          title: bookData[i][titleColIndex] || "タイトル不明",
          status: isNewLayout ? (bookData[i][6] || "在庫") : "在庫",
          rowNumber: i + 1
        };
        bookMap.set(bookId, entry);
        // 新レイアウトではISBN(B列)でも検索できるようにする(getBookDetails と同じ挙動)
        if (isNewLayout && bookData[i][1]) {
          const isbn = bookData[i][1].toString().trim();
          if (isbn) {
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
    const lendingData = lendingSheet.getDataRange().getValues();
    const activeLoanIds = new Set();
    for (let i = 1; i < lendingData.length; i++) {
      if (lendingData[i][6] === "未返却" && lendingData[i][0]) {
        activeLoanIds.add(lendingData[i][0].toString().trim());
      }
    }

    // 設定から貸出期間を取得
    let lendingDays = 14; // デフォルト値
    try {
      const settings = getLibrarySettings();
      if (settings && settings.lendingDays) {
        lendingDays = settings.lendingDays;
      }
    } catch (e) {
      console.log("設定の取得に失敗したため、デフォルトの貸出期間を使用します:", e);
    }

    const lendingDate = new Date(); // 現在日時を貸出日時とする
    const dueDate = new Date(lendingDate.getTime() + lendingDays * 24 * 60 * 60 * 1000); // 貸出日から設定日数後
    const returnStatus = "未返却"; // 初期状態

    const rowsToAdd = [];
    const rowsToMarkLent = []; // 貸出中に更新する書籍DBの行番号

    bulkData.bookIds.forEach(bookId => {
      const trimmedBookId = bookId.trim();
      if (!trimmedBookId) return; // 空のIDはスキップ

      let book = bookMap.get(trimmedBookId);
      let lendId = trimmedBookId; // 実際に貸出記録へ書き込むID(管理番号)

      // 管理番号で見つからない場合はISBNとして解釈し、貸出可能なコピーを探す
      if (!book && copiesByIsbn.has(trimmedBookId)) {
        const availableCopy = copiesByIsbn.get(trimmedBookId).find(copy =>
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
      if (isNewLayout) {
        rowsToMarkLent.push(book.rowNumber);
      }
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

// processReturnForm と getLendingInfo のテスト関数も同様に bookId ベースで作成可能
// sendOverdueReminders のテストは、実際にメールが飛ぶため注意が必要


/**
 * Google Books APIを使用して書籍情報を取得する関数
 * @param {string} isbn - 書籍のISBNコード
 * @return {object} 書籍情報オブジェクト
 */
function fetchBookInfo(isbn) {
  if (!isbn) {
    return { error: "ISBNが指定されていません。" };
  }
  
  try {
    // Google Books APIのURLを構築
    const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}&country=JP`;
    
    // APIリクエストを送信
    const response = UrlFetchApp.fetch(url);
    const data = JSON.parse(response.getContentText());
    
    // 検索結果がない場合
    if (!data.items || data.items.length === 0) {
      return { error: "書籍情報が見つかりませんでした。" };
    }
    
    // 最初の検索結果から書籍情報を抽出
    const volumeInfo = data.items[0].volumeInfo;
    
    // 書籍情報オブジェクトを作成
    const bookInfo = {
      isbn: isbn,
      title: volumeInfo.title || "",
      authors: volumeInfo.authors ? volumeInfo.authors.join(", ") : "",
      publisher: volumeInfo.publisher || "",
      thumbnail: volumeInfo.imageLinks ? volumeInfo.imageLinks.smallThumbnail : null
    };
    
    return bookInfo;
  } catch (error) {
    console.error(`書籍情報の取得中にエラーが発生しました: ${error}`);
    return { error: `APIリクエスト中にエラーが発生しました: ${error.message}` };
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
    if (!range || range.getNumRows() === 0) {
      console.log("書籍DBが空です。ヘッダー行を追加します。");
      // 新しいヘッダー行を追加（管理番号カラムを含む）
      bookSheet.getRange(1, 1, 1, 7).setValues([["管理番号", "書籍ID(ISBN)", "書籍名", "著者名", "出版社", "備考", "状態"]]);
    }
    
    const data = bookSheet.getDataRange().getValues();
    const quantity = parseInt(bookData.quantity) || 1; // 登録冊数（デフォルト1冊）
    
    // 同じISBNの最大コピー番号を取得
    let maxCopyNumber = 0;
    const isbnColIndex = 1; // B列: ISBN
    
    if (data.length > 1) {
      for (let i = 1; i < data.length; i++) {
        const existingIsbn = data[i][isbnColIndex];
        if (existingIsbn && existingIsbn.toString().trim() === bookData.isbn.trim()) {
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
    
    const data = bookSheet.getDataRange().getValues();
    
    // 新しいデータ構造のチェック
    if (data.length > 0 && data[0][0] === "管理番号") {
      const managementNumColIndex = 0; // A列
      const statusColIndex = 6;        // G列
      
      for (let i = 1; i < data.length; i++) {
        const managementNum = data[i][managementNumColIndex];
        if (managementNum && managementNum.toString().trim() === bookId.trim()) {
          // 状態を更新
          bookSheet.getRange(i + 1, statusColIndex + 1).setValue(status);
          console.log(`書籍状態更新: ${bookId} → ${status}`);
          return;
        }
      }
    } else {
      // 旧構造の場合は何もしない（状態管理カラムがないため）
      console.log("旧構造のデータベースのため、状態更新をスキップします。");
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
    
    const data = userSheet.getDataRange().getValues();
    const userIdColIndex = 0; // A列
    const nameColIndex = 1; // B列
    const emailColIndex = 2; // C列
    
    console.log(`getUserDetails: データ行数: ${data.length}`);
    
    // ヘッダー行の内容をログ出力
    if (data.length > 0) {
      console.log(`getUserDetails: ヘッダー行: ${JSON.stringify(data[0])}`);
    }
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      // 空の行をスキップ
      if (!data[i] || data[i].length === 0 || !data[i][userIdColIndex]) {
        continue;
      }
      
      const rowUserId = data[i][userIdColIndex].toString().trim();
      // デバッグ用: 最初の数行の利用者IDを表示
      if (i <= 3) {
        console.log(`getUserDetails: 行${i + 1} - DB内のID: "${rowUserId}" (長さ:${rowUserId.length}), 検索ID: "${userId.trim()}" (長さ:${userId.trim().length})`);
      }
      
      // IDが完全一致するかチェック（大文字小文字を無視）
      if (rowUserId.toLowerCase() === userId.trim().toLowerCase()) {
        // 追加のカラムがある場合の取得
        const phoneColIndex = 3; // D列（電話番号）
        const addressColIndex = 4; // E列（住所）
        const registrationDateColIndex = 5; // F列（登録日）
        
        // カラム数をチェックして安全にアクセス
        const rowLength = data[i].length;
        console.log(`getUserDetails: 行${i + 1}のカラム数: ${rowLength}`);
        
        // 日付を文字列に変換して返す
        const registrationDate = rowLength > registrationDateColIndex ? data[i][registrationDateColIndex] : null;
        const lastUseDate = getLastUseDate(userId);
        
        const userDetails = {
          userId: rowUserId,
          name: data[i][nameColIndex] || "",
          email: data[i][emailColIndex] || "",
          phone: rowLength > phoneColIndex ? (data[i][phoneColIndex] || "") : "",
          address: rowLength > addressColIndex ? (data[i][addressColIndex] || "") : "",
          registrationDate: registrationDate instanceof Date ? registrationDate.toISOString() : (registrationDate || new Date().toISOString()),
          lastUseDate: lastUseDate instanceof Date ? lastUseDate.toISOString() : null
        };
        console.log(`getUserDetails: 利用者情報取得成功:`, userDetails);
        console.log(`getUserDetails: 返却するデータのJSON:`, JSON.stringify(userDetails));
        return userDetails;
      }
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
          lendingDate: data[i][4] || "",
          dueDate: data[i][5] || "",
          status: data[i][6] || "",
          returnDate: data[i][7] || ""
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
        // 行を削除
        userSheet.deleteRow(i + 1);
        console.log(`利用者を削除しました: ${userId}`);
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
function testUserDatabase() {
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
function testGetUserDetails() {
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
function getAllUserIds() {
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
  SpreadsheetApp.getUi()
      .createMenu('管理メニュー')
      .addItem('初期セットアップ', 'setupLibrarySystemFromMenu')
      .addItem('バーコード生成', 'generateBarcodesForSheet')
      .addItem('延滞リマインダー送信', 'sendOverdueReminders')
      .addItem('貸出状況レポート作成', 'generateLendingReport')
      .addItem('返却済データのバックアップ', 'showBackupDialog')
      .addToUi();
}

/**
 * 図書館管理システムの初期セットアップを行う関数
 * 必要な4シート(書籍DB・利用者DB・貸出記録・設定DB)を存在しなければ作成し、
 * 正しいヘッダー行を設定する。既存のデータには一切触れない(冪等)。
 * @return {object} 処理結果 {success: boolean, message: string, created: string[], skipped: string[]}
 */
function setupLibrarySystem() {
  // 各シートのヘッダー定義。列の並びはコード全体でハードコードされた
  // 列インデックスと一致させる必要がある(特に書籍DBのA1は「管理番号」必須)。
  const sheetDefinitions = [
    {
      name: "書籍DB",
      headers: ["管理番号", "書籍ID(ISBN)", "書籍名", "著者名", "出版社", "備考", "状態"]
    },
    {
      name: "利用者DB",
      headers: ["利用者ID", "氏名", "メールアドレス", "電話番号", "住所", "登録日"]
    },
    {
      name: "貸出記録",
      headers: ["書籍ID", "書籍名", "利用者ID", "利用者名", "貸出日時", "返却予定日", "返却状況", "返却日時"]
    }
  ];

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

    // 設定DBは getLibrarySettings がデフォルト設定込みで初期化する
    // (シートが存在しない場合と、空タブとして手動作成済みの場合の両方に対応)
    const existingSettingsSheet = ss.getSheetByName("設定DB");
    const settingsExisted = !!existingSettingsSheet && existingSettingsSheet.getLastRow() > 0;
    getLibrarySettings();
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
    
    // 元データの全行を取得
    const data = lendingSheet.getDataRange().getValues();
    if (data.length <= 1) { // ヘッダー行のみの場合
      return { success: true, count: 0, message: "バックアップ対象のデータがありません。" };
    }
    
    // ヘッダー行
    const headers = data[0];
    
    // 返却状況の列インデックスを特定
    const statusColIndex = headers.findIndex(header => header === "返却状況");
    if (statusColIndex === -1) {
      return { success: false, count: 0, message: "返却状況の列が見つかりません。" };
    }
    
    // 返却済みデータを抽出
    const returnedData = data.filter((row, index) => 
      index > 0 && row[statusColIndex] === "返却済"
    );
    
    if (returnedData.length === 0) {
      return { success: true, count: 0, message: "バックアップ対象の返却済データがありません。" };
    }
    
    // バックアップ先のシートにヘッダーがなければ追加
    const targetData = targetSheet.getDataRange().getValues();
    if (targetData.length === 0 || targetData[0].join() !== headers.join()) {
      targetSheet.clearContents(); // 既存のデータをクリア
      targetSheet.appendRow(headers); // ヘッダー行を追加
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
  if (data.length > 1) {
    reportSheet.getRange(2, 1, data.length - 1, data[0].length).setValues(data.slice(1));
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
 * 「バーコード生成」シートのIDに基づいてバーコード画像を生成する関数
 */
function generateBarcodesForSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = "バーコード生成"; // 対象シート名
  const sheet = ss.getSheetByName(sheetName);
  const idColumn = 1; // ID列 (A列 = 1)
  const barcodeColumn = 3; // バーコード画像列 (C列 = 3)

  if (!sheet) {
    SpreadsheetApp.getUi().alert(`シート「${sheetName}」が見つかりません。`);
    return;
  }

  const dataRange = sheet.getDataRange();
  const values = dataRange.getValues(); // シート全体のデータを取得

  // ヘッダー行を除き、指定列にデータがある行を処理
  const formulas = [];
  for (let i = 1; i < values.length; i++) { // i = 0 はヘッダーなのでスキップ
    const id = values[i][idColumn - 1]; // 指定されたID列の値を取得 (0-based index)
    if (id) { // IDが空でない場合のみ処理
      // barcode.tec-it.com APIを使用してCode 128バーコードURLを生成 (DPIを300に戻す)
      const barcodeUrl = `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(id)}&code=Code128&dpi=300&borderwidth=10&bordercolor=FFFFFF`;
      // IMAGE関数を作成 (モード2: セルに合わせて伸縮表示)
      formulas.push([`=IMAGE("${barcodeUrl}", 2)`]);
    } else {
      formulas.push(['']); // IDがない場合は空文字を設定
    }
  }

  // 指定列のデータ範囲に数式を設定 (ヘッダー行を除く)
  if (formulas.length > 0) {
    // 書き込み範囲を計算
    sheet.getRange(2, barcodeColumn, formulas.length, 1).setFormulas(formulas);
    SpreadsheetApp.getUi().alert(`「${sheetName}」シートのバーコード生成が完了しました。`);
  } else {
    SpreadsheetApp.getUi().alert('処理対象のIDがありませんでした。');
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
function getLibrarySettings() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let settingsSheet = ss.getSheetByName("設定DB");

    // 設定DBシートが存在しない場合は作成
    if (!settingsSheet) {
      settingsSheet = ss.insertSheet("設定DB");
    }

    // シートが空(手動で作られた空タブを含む)ならヘッダーとデフォルト設定を投入
    if (settingsSheet.getLastRow() === 0) {
      // ヘッダー行を設定
      const headers = [
        ["設定項目", "設定値", "説明", "更新日時"]
      ];
      settingsSheet.getRange(1, 1, 1, 4).setValues(headers);
      settingsSheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#f3f3f3");
      
      // デフォルト設定を追加
      const defaultSettings = [
        ["lendingDays", "14", "貸出期間（日数）", new Date()],
        ["maxBooks", "5", "一人あたりの最大貸出冊数", new Date()],
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
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let settingsSheet = ss.getSheetByName("設定DB");
    
    if (!settingsSheet) {
      // 設定DBシートが存在しない場合は作成
      getLibrarySettings(); // この関数内でシートが作成される
      settingsSheet = ss.getSheetByName("設定DB");
    }
    
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
    reminderDays: "返却リマインダー（日前）",
    enableEmail: "メール通知を有効にする",
    enableOverdue: "延滞通知を有効にする",
    libraryEmail: "図書館メールアドレス",
    libraryName: "図書館名",
    operationMode: "運用モード"
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
    
    const data = lendingSheet.getDataRange().getValues();
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
              lendingDate: row[lendingDateColIndex],
              dueDate: dueDateValue,
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
          Utilities.formatDate(item.lendingDate, Session.getScriptTimeZone(), "yyyy/MM/dd"),
          Utilities.formatDate(item.dueDate, Session.getScriptTimeZone(), "yyyy/MM/dd"),
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
    
    const data = lendingSheet.getDataRange().getValues();
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
        lendingDate: lendingDate,
        dueDate: dueDate,
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
          lendingDate: row[lendingDateColIndex],
          dueDate: row[dueDateColIndex],
          returnDate: row[returnDateColIndex] || null,
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
          record.lendingDate ? Utilities.formatDate(record.lendingDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm") : "",
          record.dueDate ? Utilities.formatDate(record.dueDate, Session.getScriptTimeZone(), "yyyy/MM/dd") : "",
          record.returnDate ? Utilities.formatDate(record.returnDate, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm") : "",
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
    const isNewStructure = bookData.length > 0 && bookData[0][0] === "管理番号";
    
    // 管理番号/書籍IDをキーとして、現在の貸出状況を格納するMap
    const lendingMap = new Map();
    
    // 貸出記録から現在貸出中の書籍を抽出
    for (let i = 1; i < lendingData.length; i++) {
      const bookId = lendingData[i][0]; // A列: 書籍ID（管理番号またはISBN）
      const status = lendingData[i][6];  // G列: 返却状況
      
      if (status === "未返却") {
        lendingMap.set(bookId, {
          borrowerName: lendingData[i][3],  // D列: 利用者名
          borrowerId: lendingData[i][2],    // C列: 利用者ID
          lendingDate: lendingData[i][4],   // E列: 貸出日時
          dueDate: lendingData[i][5]        // F列: 返却予定日
        });
      }
    }
    
    // 書籍在庫情報を作成
    const inventory = [];
    
    if (isNewStructure) {
      // 新構造: A:管理番号, B:ISBN, C:書籍名, D:著者名, E:出版社, F:備考, G:状態
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
          status: dbStatus === "貸出中" ? "貸出中" : (lendingInfo ? "貸出中" : "在庫"),
          borrowerName: lendingInfo ? lendingInfo.borrowerName : null,
          borrowerId: lendingInfo ? lendingInfo.borrowerId : null,
          lendingDate: lendingInfo ? lendingInfo.lendingDate : null,
          dueDate: lendingInfo ? lendingInfo.dueDate : null
        });
      }
    } else {
      // 旧構造: A:書籍ID(ISBN), B:書籍名, C:著者名, D:出版社
      for (let i = 1; i < bookData.length; i++) {
        const bookId = bookData[i][0];           // A列: 書籍ID
        const title = bookData[i][1];            // B列: 書籍名
        const author = bookData[i][2] || "";     // C列: 著者名
        const publisher = bookData[i][3] || "";  // D列: 出版社
        
        if (!bookId) continue; // 書籍IDがない行はスキップ
        
        const lendingInfo = lendingMap.get(bookId);
        
        inventory.push({
          managementNumber: bookId,
          isbn: bookId,
          bookId: bookId,
          title: title || "タイトル不明",
          author: author,
          publisher: publisher,
          status: lendingInfo ? 'borrowed' : 'available',
          borrowerName: lendingInfo ? lendingInfo.borrowerName : null,
          borrowerId: lendingInfo ? lendingInfo.borrowerId : null,
          lendingDate: lendingInfo ? lendingInfo.lendingDate : null,
          dueDate: lendingInfo ? lendingInfo.dueDate : null
        });
      }
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
    
    const bookData = bookSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < bookData.length; i++) {
      const rowBookId = bookData[i][bookIdColIndex] ? bookData[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookId.trim().toLowerCase()) {
        // 基本情報
        const bookInfo = {
          bookId: rowBookId,
          title: bookData[i][1] || "",
          author: bookData[i][2] || "",
          publisher: bookData[i][3] || "",
          note: bookData[i][4] || "",
          category: bookData[i][5] || "",
          location: bookData[i][6] || "",
          registrationDate: bookData[i][7] || new Date(),
          isAvailable: true,
          lastLendingDate: null
        };
        
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
          lendingDate: data[i][4] || "",
          dueDate: data[i][5] || "",
          status: data[i][6] || "",
          returnDate: data[i][7] || ""
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
    
    const data = bookSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowBookId = data[i][bookIdColIndex] ? data[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookData.bookId.trim().toLowerCase()) {
        // 既存の登録日を保持
        const registrationDate = data[i][7] || new Date();
        
        // 更新する行のデータを作成
        const updatedRow = [
          rowBookId, // 書籍ID（変更不可）
          bookData.title || "",
          bookData.author || "",
          bookData.publisher || "",
          bookData.note || "",
          bookData.category || "",
          bookData.location || "",
          registrationDate
        ];
        
        // 行を更新
        bookSheet.getRange(i + 1, 1, 1, updatedRow.length).setValues([updatedRow]);
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
    
    const data = bookSheet.getDataRange().getValues();
    const bookIdColIndex = 0; // A列
    
    // ヘッダー行を除いて検索
    for (let i = 1; i < data.length; i++) {
      const rowBookId = data[i][bookIdColIndex] ? data[i][bookIdColIndex].toString().trim() : "";
      if (rowBookId.toLowerCase() === bookId.trim().toLowerCase()) {
        // 行を削除
        bookSheet.deleteRow(i + 1);
        console.log(`書籍を削除しました: ${bookId}`);
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
    
    // サマリー情報
    const totalBooks = inventory.length;
    const availableBooks = inventory.filter(book => book.status === 'available').length;
    const borrowedBooks = inventory.filter(book => book.status === 'borrowed').length;
    
    const summaryData = [
      ["書籍在庫リスト", ""],
      ["作成日時", Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss")],
      ["", ""],
      ["総蔵書数", totalBooks + "冊"],
      ["貸出可能", availableBooks + "冊"],
      ["貸出中", borrowedBooks + "冊"],
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
        const statusText = book.status === 'available' ? '貸出可能' : '貸出中';
        return [
          book.bookId,
          book.title,
          book.author,
          book.publisher,
          statusText,
          book.borrowerName || "",
          book.lendingDate ? Utilities.formatDate(book.lendingDate, Session.getScriptTimeZone(), "yyyy/MM/dd") : "",
          book.dueDate ? Utilities.formatDate(book.dueDate, Session.getScriptTimeZone(), "yyyy/MM/dd") : ""
        ];
      });
      
      reportSheet.getRange(currentRow + 1, 1, dataRows.length, headers.length).setValues(dataRows);
      
      // 状態に応じて行の色を設定
      for (let i = 0; i < inventory.length; i++) {
        const row = currentRow + 1 + i;
        if (inventory[i].status === 'borrowed') {
          reportSheet.getRange(row, 1, 1, headers.length).setBackground("#fff3e0"); // 貸出中はオレンジ
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
