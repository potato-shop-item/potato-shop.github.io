"use strict";

/*
 * UF2設定
 */

const FAMILY_ID = 0xADA52840;

const MAGIC_START0 = 0x0A324655;
const MAGIC_START1 = 0x9E5D5157;
const MAGIC_END = 0x0AB16F30;

const UF2_FLAG_FAMILY_ID_PRESENT = 0x00002000;

const CHUNK_SIZE = 256;
const UF2_BLOCK_SIZE = 512;


/*
 * HTML要素
 */

const dropArea = document.getElementById("dropArea");
const fileInput = document.getElementById("fileInput");
const convertButton = document.getElementById("convertButton");
const status = document.getElementById("status");

let selectedFile = null;


/*
 * ファイル選択
 */

dropArea.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", () => {
  if (fileInput.files.length > 0) {
    selectFile(fileInput.files[0]);
  }
});


/*
 * ドラッグ＆ドロップ
 */

dropArea.addEventListener("dragover", (event) => {
  event.preventDefault();
  dropArea.classList.add("dragover");
});

dropArea.addEventListener("dragleave", () => {
  dropArea.classList.remove("dragover");
});

dropArea.addEventListener("drop", (event) => {
  event.preventDefault();
  dropArea.classList.remove("dragover");

  if (event.dataTransfer.files.length > 0) {
    selectFile(event.dataTransfer.files[0]);
  }
});


/*
 * ファイル選択処理
 */

function selectFile(file) {
  if (!file.name.toLowerCase().endsWith(".hex")) {
    selectedFile = null;
    convertButton.disabled = true;

    setStatus(
      "HEXファイルを選択してください。",
      true
    );

    return;
  }

  selectedFile = file;
  convertButton.disabled = false;

  setStatus(
    "選択中: " + file.name + "\n" +
    "ファイルサイズ: " + file.size + " bytes",
    false
  );
}


/*
 * 変換処理
 */

convertButton.addEventListener("click", async () => {
  if (!selectedFile) {
    return;
  }

  convertButton.disabled = true;

  try {
    setStatus(
      "HEXファイルを解析しています……",
      false
    );

    const hexText = await selectedFile.text();

    const memory = parseIntelHex(hexText);

    if (memory.size === 0) {
      throw new Error(
        "HEXファイル内にデータがありません。"
      );
    }

    setStatus(
      "UF2ファイルを生成しています……",
      false
    );

    const uf2Data = convertMemoryToUf2(memory);

    const outputName =
      selectedFile.name.replace(/\.hex$/i, "") +
      ".uf2";

    downloadFile(uf2Data, outputName);

    setStatus(
      "変換完了\n\n" +
      "入力ファイル: " + selectedFile.name + "\n" +
      "出力ファイル: " + outputName + "\n" +
      "HEXデータサイズ: " + memory.size + " bytes\n" +
      "UF2サイズ: " + uf2Data.length + " bytes\n" +
      "UF2ブロック数: " +
        (uf2Data.length / UF2_BLOCK_SIZE) + "\n" +
      "Family ID: 0x" +
        FAMILY_ID.toString(16).toUpperCase(),
      false
    );

  } catch (error) {
    setStatus(
      "エラー:\n" + error.message,
      true
    );

  } finally {
    convertButton.disabled = false;
  }
});


/*
 * ステータス表示
 */

function setStatus(message, isError) {
  status.textContent = message;

  status.className = isError
    ? "error"
    : "success";
}


/*
 * Intel HEX解析
 *
 * 戻り値：
 *   Map<絶対アドレス, データ>
 */

function parseIntelHex(text) {
  const memory = new Map();

  let upperAddress = 0;

  const lines = text.split(/\r?\n/);

  for (
    let lineNumber = 0;
    lineNumber < lines.length;
    lineNumber++
  ) {
    const line = lines[lineNumber].trim();

    if (line === "") {
      continue;
    }

    if (!line.startsWith(":")) {
      throw new Error(
        "Intel HEX形式ではない行があります。" +
        " 行番号: " + (lineNumber + 1)
      );
    }

    const hex = line.substring(1);

    if (hex.length % 2 !== 0) {
      throw new Error(
        "HEX文字数が不正です。" +
        " 行番号: " + (lineNumber + 1)
      );
    }

    const bytes = [];

    for (let i = 0; i < hex.length; i += 2) {
      const value = parseInt(
        hex.substring(i, i + 2),
        16
      );

      if (Number.isNaN(value)) {
        throw new Error(
          "HEX文字が不正です。" +
          " 行番号: " + (lineNumber + 1)
        );
      }

      bytes.push(value);
    }

    if (bytes.length < 5) {
      throw new Error(
        "HEXレコードが短すぎます。" +
        " 行番号: " + (lineNumber + 1)
      );
    }

    const byteCount = bytes[0];

    const address =
      (bytes[1] << 8) |
      bytes[2];

    const recordType = bytes[3];

    if (bytes.length !== byteCount + 5) {
      throw new Error(
        "レコード長が不正です。" +
        " 行番号: " + (lineNumber + 1)
      );
    }

    /*
     * チェックサム検証
     */

    let checksum = 0;

    for (const value of bytes) {
      checksum =
        (checksum + value) & 0xFF;
    }

    if (checksum !== 0) {
      throw new Error(
        "チェックサムエラーです。" +
        " 行番号: " + (lineNumber + 1)
      );
    }

    /*
     * データレコード
     */

    if (recordType === 0x00) {
      const dataStart = 4;

      for (let i = 0; i < byteCount; i++) {
        const absoluteAddress =
          upperAddress +
          address +
          i;

        memory.set(
          absoluteAddress,
          bytes[dataStart + i]
        );
      }
    }

    /*
     * ファイル終了レコード
     */

    else if (recordType === 0x01) {
      break;
    }

    /*
     * 拡張リニアアドレス
     */

    else if (recordType === 0x04) {
      if (byteCount !== 2) {
        throw new Error(
          "拡張リニアアドレスレコードが不正です。" +
          " 行番号: " + (lineNumber + 1)
        );
      }

      upperAddress =
        ((bytes[4] << 8) | bytes[5]) << 16;
    }

    /*
     * 拡張セグメントアドレス
     */

    else if (recordType === 0x02) {
      if (byteCount !== 2) {
        throw new Error(
          "拡張セグメントアドレスレコードが不正です。" +
          " 行番号: " + (lineNumber + 1)
        );
      }

      upperAddress =
        ((bytes[4] << 8) | bytes[5]) << 4;
    }

    /*
     * その他のレコードは無視
     */

    else {
      continue;
    }
  }

  return memory;
}


/*
 * メモリMapをUF2へ変換
 */

function convertMemoryToUf2(memory) {
  const addresses = Array.from(
    memory.keys()
  ).sort((a, b) => a - b);

  if (addresses.length === 0) {
    throw new Error(
      "変換対象のデータがありません。"
    );
  }

  const minAddress = addresses[0];
  const maxAddress = addresses[addresses.length - 1];

  let blockStart =
    Math.floor(minAddress / CHUNK_SIZE) *
    CHUNK_SIZE;

  const blocks = [];

  while (blockStart <= maxAddress) {
    const blockData =
      new Uint8Array(CHUNK_SIZE);

    /*
     * Python版と同じく未使用部分は0x00
     */

    blockData.fill(0x00);

    let hasData = false;

    for (let i = 0; i < CHUNK_SIZE; i++) {
      const address =
        blockStart + i;

      if (memory.has(address)) {
        blockData[i] =
          memory.get(address);

        hasData = true;
      }
    }

    if (hasData) {
      const block =
        createUf2Block(
          blockStart,
          blockData,
          blocks.length
        );

      blocks.push(block);
    }

    blockStart += CHUNK_SIZE;
  }

  /*
   * 総ブロック数を設定
   */

  const totalBlocks = blocks.length;

  for (let i = 0; i < blocks.length; i++) {
    const view =
      new DataView(blocks[i].buffer);

    view.setUint32(
      24,
      totalBlocks,
      true
    );
  }

  /*
   * UF2ファイル全体を結合
   */

  const output =
    new Uint8Array(
      blocks.length * UF2_BLOCK_SIZE
    );

  for (let i = 0; i < blocks.length; i++) {
    output.set(
      blocks[i],
      i * UF2_BLOCK_SIZE
    );
  }

  return output;
}


/*
 * UF2ブロック生成
 */

function createUf2Block(
  targetAddress,
  data,
  blockNumber
) {
  const block =
    new Uint8Array(UF2_BLOCK_SIZE);

  const view =
    new DataView(block.buffer);

  /*
   * UF2マジック値
   */

  view.setUint32(
    0,
    MAGIC_START0,
    true
  );

  view.setUint32(
    4,
    MAGIC_START1,
    true
  );

  /*
   * フラグ
   */

  view.setUint32(
    8,
    UF2_FLAG_FAMILY_ID_PRESENT,
    true
  );

  /*
   * 書き込み先アドレス
   */

  view.setUint32(
    12,
    targetAddress,
    true
  );

  /*
   * データサイズ
   */

  view.setUint32(
    16,
    CHUNK_SIZE,
    true
  );

  /*
   * ブロック番号
   */

  view.setUint32(
    20,
    blockNumber,
    true
  );

  /*
   * 総ブロック数
   *
   * convertMemoryToUf2()で設定
   */

  view.setUint32(
    24,
    0,
    true
  );

  /*
   * Family ID
   */

  view.setUint32(
    28,
    FAMILY_ID,
    true
  );

  /*
   * データ本体
   */

  block.set(
    data,
    32
  );

  /*
   * UF2末尾マジック値
   */

  view.setUint32(
    508,
    MAGIC_END,
    true
  );

  return block;
}


/*
 * ファイルダウンロード
 */

function downloadFile(data, filename) {
  const blob =
    new Blob(
      [data],
      {
        type: "application/octet-stream"
      }
    );

  const url =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement("a");

  anchor.href = url;
  anchor.download = filename;

  document.body.appendChild(anchor);

  anchor.click();

  anchor.remove();

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}