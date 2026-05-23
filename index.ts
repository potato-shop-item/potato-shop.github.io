// @ts-ignore
import { requestSerialPort } from "./webusb-serial.js";

// --- 既存のUI要素の取得 ---
const baudrates = document.getElementById("baudrates") as HTMLSelectElement;
const consoleBaudrates = document.getElementById("consoleBaudrates") as HTMLSelectElement;
const reconnectDelay = document.getElementById("reconnectDelay") as HTMLInputElement;
const maxRetriesInput = document.getElementById("maxRetries") as HTMLInputElement;
const connectButton = document.getElementById("connectButton") as HTMLButtonElement;
const traceButton = document.getElementById("copyTraceButton") as HTMLButtonElement;
const disconnectButton = document.getElementById("disconnectButton") as HTMLButtonElement;
const resetButton = document.getElementById("resetButton") as HTMLButtonElement;
const consoleStartButton = document.getElementById("consoleStartButton") as HTMLButtonElement;
const consoleStopButton = document.getElementById("consoleStopButton") as HTMLButtonElement;
const eraseButton = document.getElementById("eraseButton") as HTMLButtonElement;
const addFileButton = document.getElementById("addFile") as HTMLButtonElement;
const programButton = document.getElementById("programButton");
const filesDiv = document.getElementById("files");
const terminal = document.getElementById("terminal");
const programDiv = document.getElementById("program");
const consoleDiv = document.getElementById("console");
const lblBaudrate = document.getElementById("lblBaudrate");
const lblConsoleBaudrate = document.getElementById("lblConsoleBaudrate");
const lblConsoleFor = document.getElementById("lblConsoleFor");
const lblConnTo = document.getElementById("lblConnTo");
const table = document.getElementById("fileTable") as HTMLTableElement;
const alertDiv = document.getElementById("alertDiv");
const flashMode = document.getElementById("flashMode") as HTMLSelectElement;
const flashFreq = document.getElementById("flashFreq") as HTMLSelectElement;
const flashSize = document.getElementById("flashSize") as HTMLSelectElement;
const lblFlashMode = document.getElementById("lblFlashMode");
const lblFlashFreq = document.getElementById("lblFlashFreq");
const lblFlashSize = document.getElementById("lblFlashSize");
const debugLogging = document.getElementById("debugLogging") as HTMLInputElement;

// --- ポータル固有のUI要素の追加取得 ---
const tabMain = document.getElementById("tabMain") as HTMLElement;
const tabBle = document.getElementById("tabBle") as HTMLElement;
const panelMain = document.getElementById("panelMain") as HTMLElement;
const panelBle = document.getElementById("panelBle") as HTMLElement;
const userIdInput = document.getElementById("userIdInput") as HTMLInputElement;
const sendIdBtn = document.getElementById("sendIdBtn") as HTMLButtonElement;
const bleSendBtn = document.getElementById("bleSendBtn") as HTMLButtonElement;

import {
  ESPLoader,
  FlashOptions,
  FlashModeValues,
  FlashFreqValues,
  FlashSizeValues,
  LoaderOptions,
  Transport,
} from "../../../lib";
import { serial } from "web-serial-polyfill";

const serialLib = !navigator.serial && navigator.usb ? serial : navigator.serial;

declare let Terminal; // Terminal is imported in HTML script
declare let CryptoJS; // CryptoJS is imported in HTML script

const term = new Terminal({ cols: 120, rows: 40 });
term.open(terminal);

let device = null;
let deviceInfo = null;
let transport: Transport;
let chip: string = null;
let esploader: ESPLoader;

// 初期状態のUI制御
disconnectButton.style.display = "none";
traceButton.style.display = "none";
eraseButton.style.display = "none";
consoleStopButton.style.display = "none";
resetButton.style.display = "none";
filesDiv.style.display = "none";
flashMode.style.display = "none";
flashFreq.style.display = "none";
flashSize.style.display = "none";
lblFlashMode.style.display = "none";
lblFlashFreq.style.display = "none";
lblFlashSize.style.display = "none";

// ポータル用初期状態：ID設定ボタンは接続されるまで無効化
if (sendIdBtn) sendIdBtn.disabled = true;

// ==========================================
// 1. ポータル画面用：タブ切り替えロジック
// ==========================================
if (tabMain && tabBle && panelMain && panelBle) {
  tabMain.onclick = () => {
    tabMain.classList.add("active");
    tabBle.classList.remove("active");
    panelMain.classList.add("active");
    panelBle.classList.remove("active");
  };

  tabBle.onclick = () => {
    tabBle.classList.add("active");
    tabMain.classList.remove("active");
    panelBle.classList.add("active");
    panelMain.classList.remove("active");
  };
}

// ==========================================
// 2. ポータル画面用：BLE（無線）送信ロジック
// ==========================================
if (bleSendBtn) {
  bleSendBtn.onclick = async () => {
    const bleUserIdInput = document.getElementById("bleUserIdInput") as HTMLInputElement;
    if (!bleUserIdInput || !bleUserIdInput.value) {
      alert("ユーザーIDを入力してください。");
      return;
    }

    const idVal = parseInt(bleUserIdInput.value, 10);
    if (isNaN(idVal) || idVal < 0 || idVal > 65535) {
      alert("IDは0〜65535の範囲で入力してください。");
      return;
    }

    try {
      term.writeln("\n[BLE] デバイスを検索中...");
      // PTT用サービスUUID（仮定）でデバイスをリクエスト
      const bleDevice = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: ["0000ffe0-0000-1000-8000-00805f9b34fb"] 
      });

      term.writeln(`[BLE] 接続中: ${bleDevice.name}`);
      const server = await bleDevice.gatt.connect();
      
      term.writeln("[BLE] サービスを取得中...");
      const services = await server.getPrimaryServices();
      if (services.length === 0) throw new Error("サービスが見つかりません。");
      
      const characteristics = await services[0].getCharacteristics();
      if (characteristics.length === 0) throw new Error("キャラクタリスティクスが見つかりません。");
      
      // 送信用バッファ生成 (SET_IDコマンド = 0x01, 引数2バイト)
      const buffer = new ArrayBuffer(3);
      const view = new DataView(buffer);
      view.setUint8(0, 0x01);
      view.setUint16(1, idVal, false); // Big-Endian

      term.writeln(`[BLE] ID送信中: ${idVal}`);
      await characteristics[0].writeValue(buffer);
      term.writeln("[BLE] 送信成功完了！");
      alert("BLE経由でIDを送信しました。");
      
      await bleDevice.gatt.disconnect();
    } catch (err) {
      term.writeln(`[BLE ERROR] ${err.message}`);
      alert(`BLE送信失敗: ${err.message}`);
    }
  };
}

// ==========================================
// 3. 親機（シリアル接続）処理の安全なドッキング
// ==========================================
function handleFileSelect(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev: ProgressEvent<FileReader>) => {
    if (ev.target.result instanceof ArrayBuffer) {
      evt.target.data = new Uint8Array(ev.target.result);
    } else {
      evt.target.data = ev.target.result;
    }
  };
  reader.readAsArrayBuffer(file);
}

const espLoaderTerminal = {
  clean() { term.clear(); },
  writeLine(data) { term.writeln(data); },
  write(data) { term.write(data); },
};

function populateFlashDropdowns() {
  if (!esploader || !esploader.chip) return;

  flashFreq.innerHTML = '<option value="keep">keep</option>';
  const flashFreqKeys = Object.keys(esploader.chip.FLASH_FREQUENCY).sort((a, b) => {
    const freqOrder = ["80m", "60m", "48m", "40m", "30m", "26m", "24m", "20m", "16m", "15m", "12m"];
    const indexA = freqOrder.indexOf(a);
    const indexB = freqOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });
  flashFreqKeys.forEach((freq) => {
    const option = document.createElement("option");
    option.value = freq;
    option.textContent = freq;
    flashFreq.appendChild(option);
  });
  flashFreq.options[0].selected = true;

  flashSize.innerHTML = '<option value="detect">detect</option><option value="keep">keep</option>';
  const flashSizeKeys = Object.keys(esploader.chip.FLASH_SIZES).sort((a, b) => {
    const sizeOrder = ["256KB", "512KB", "1MB", "2MB", "2MB-c1", "4MB", "4MB-c1", "8MB", "16MB", "32MB", "64MB", "128MB"];
    const indexA = sizeOrder.indexOf(a);
    const indexB = sizeOrder.indexOf(b);
    if (indexA !== -1 && indexB !== -1) return indexA - indexB;
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;
    return a.localeCompare(b);
  });
  flashSizeKeys.forEach((size) => {
    const option = document.createElement("option");
    option.value = size;
    option.textContent = size;
    flashSize.appendChild(option);
  });
  flashSize.options[1].selected = true;
}

// 接続ボタン押下時
connectButton.onclick = async () => {
  try {
    if (device === null) {
      // Android/PCを自動判別し、低パケットサイズ（64Byte制限）を効かせてフリーズを防ぐ
      device = await requestSerialPort(true);
      deviceInfo = device.getInfo();
      transport = new Transport(device, true);
    }
    const flashOptions = {
      transport,
      baudrate: parseInt(baudrates.value),
      terminal: espLoaderTerminal,
      debugLogging: debugLogging.checked,
    } as LoaderOptions;
    esploader = new ESPLoader(flashOptions);

    traceButton.style.display = "initial";
    chip = await esploader.main(); // ここで自動リセットとブート同期が安全に完了する

    populateFlashDropdowns();

    console.log("Settings done for :" + chip);
    lblBaudrate.style.display = "none";
    lblConnTo.innerHTML = "Connected to device: " + chip;
    lblConnTo.style.display = "block";
    baudrates.style.display = "none";
    connectButton.style.display = "none";
    disconnectButton.style.display = "initial";
    eraseButton.style.display = "initial";
    filesDiv.style.display = "initial";
    flashMode.style.display = "initial";
    flashFreq.style.display = "initial";
    flashSize.style.display = "initial";
    lblFlashMode.style.display = "initial";
    lblFlashFreq.style.display = "initial";
    lblFlashSize.style.display = "initial";
    consoleDiv.style.display = "none";

    // 【重要】安全に接続が完了したので、ポータル側のID設定ボタンを有効化
    if (sendIdBtn) sendIdBtn.disabled = false;

  } catch (e) {
    console.error(e);
    term.writeln(`Error: ${e.message}`);
  }
};

// ==========================================
// 4. ポータル画面用：シリアル経由のID送信ロジック
// ==========================================
if (sendIdBtn) {
  sendIdBtn.onclick = async () => {
    if (!transport) {
      alert("親機が接続されていません。");
      return;
    }
    if (!userIdInput.value) {
      alert("ユーザーIDを入力してください。");
      return;
    }

    const idVal = parseInt(userIdInput.value, 10);
    if (isNaN(idVal) || idVal < 0 || idVal > 65535) {
      alert("IDは0〜65535の範囲で入力してください。");
      return;
    }

    try {
      sendIdBtn.disabled = true;
      term.writeln(`\n[SERIAL] ID送信準備中: ${idVal}`);

      // ESPLoaderのシリアル転送インスタンスから直接RawStreamを書き込む
      // esptool-jsの「transport.write」はスリップパケットや型を安全にラップしてくれます
      const buffer = new ArrayBuffer(2);
      const view = new DataView(buffer);
      view.setUint16(0, idVal, false); // 2バイト (Big-Endian)
      
      const uint8Array = new Uint8Array(buffer);
      
      // esptoolが掴んでいる既存のシリアルポートから、生の書き込みメソッドを安全に実行
      await transport.write(uint8Array);
      
      term.writeln(`[SERIAL] 送信成功: 0x${idVal.toString(16).toUpperCase()}`);
      alert("シリアル経由で親機にIDを書き込みました！");
    } catch (err) {
      term.writeln(`[SERIAL ERROR] 送信失敗: ${err.message}`);
      alert(`シリアル送信失敗: ${err.message}`);
    } finally {
      sendIdBtn.disabled = false;
    }
  };
}

// --- その他の既存ロジック（そのまま維持） ---
traceButton.onclick = async () => {
  if (transport) transport.returnTrace();
};

resetButton.onclick = async () => {
  if (transport) {
    await transport.setDTR(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await transport.setDTR(true);
  }
};

eraseButton.onclick = async () => {
  eraseButton.disabled = true;
  try {
    await esploader.eraseFlash();
  } catch (e) {
    console.error(e);
    term.writeln(`Error: ${e.message}`);
  } finally {
    eraseButton.disabled = false;
  }
};

addFileButton.onclick = () => {
  const rowCount = table.rows.length;
  const row = table.insertRow(rowCount);

  const cell1 = row.insertCell(0);
  const element1 = document.createElement("input");
  element1.type = "text";
  element1.id = "offset" + rowCount;
  element1.value = "0x1000";
  cell1.appendChild(element1);

  const cell2 = row.insertCell(1);
  const element2 = document.createElement("input");
  element2.type = "file";
  element2.id = "selectFile" + rowCount;
  element2.name = "selected_File" + rowCount;
  element2.addEventListener("change", handleFileSelect, false);
  cell2.appendChild(element2);

  const cell3 = row.insertCell(2);
  cell3.classList.add("progress-cell");
  cell3.style.display = "none";
  cell3.innerHTML = `<progress value="0" max="100"></progress>`;

  const cell4 = row.insertCell(3);
  cell4.classList.add("action-cell");
  if (rowCount > 1) {
    const element4 = document.createElement("input");
    element4.type = "button";
    const btnName = "button" + rowCount;
    element4.name = btnName;
    element4.setAttribute("class", "btn");
    element4.setAttribute("value", "Remove");
    element4.onclick = function () { removeRow(row); };
    cell4.appendChild(element4);
  }
};

function removeRow(row: HTMLTableRowElement) {
  const rowIndex = Array.from(table.rows).indexOf(row);
  table.deleteRow(rowIndex);
}

function cleanUp() {
  device = null;
  deviceInfo = null;
  transport = null;
  chip = null;
  if (sendIdBtn) sendIdBtn.disabled = true;
}

disconnectButton.onclick = async () => {
  if (transport) await transport.disconnect();
  term.reset();
  lblBaudrate.style.display = "initial";
  baudrates.style.display = "initial";
  consoleBaudrates.style.display = "initial";
  connectButton.style.display = "initial";
  disconnectButton.style.display = "none";
  traceButton.style.display = "none";
  eraseButton.style.display = "none";
  lblConnTo.style.display = "none";
  filesDiv.style.display = "none";
  flashMode.style.display = "none";
  flashFreq.style.display = "none";
  flashSize.style.display = "none";
  lblFlashMode.style.display = "none";
  lblFlashFreq.style.display = "none";
  lblFlashSize.style.display = "none";
  alertDiv.style.display = "none";
  consoleDiv.style.display = "initial";
  cleanUp();
};

let isConsoleClosed = false;
let isReconnecting = false;

const sleep = async (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

consoleStartButton.onclick = async () => {
  if (device === null) {
    device = await serialLib.requestPort({});
    transport = new Transport(device, true);
    deviceInfo = device.getInfo();

    transport.setDeviceLostCallback(async () => {
      if (!isConsoleClosed && !isReconnecting) {
        term.writeln("\n[DEVICE LOST] Device disconnected. Trying to reconnect...");
        await sleep(parseInt(reconnectDelay.value));
        isReconnecting = true;

        const maxRetries = parseInt(maxRetriesInput.value);
        let retryCount = 0;

        while (retryCount < maxRetries && !isConsoleClosed) {
          retryCount++;
          term.writeln(`\n[RECONNECT] Attempt ${retryCount}/${maxRetries}...`);

          if (serialLib && serialLib.getPorts) {
            const ports = await serialLib.getPorts();
            if (ports.length > 0) {
              const newDevice = ports.find(
                (port) =>
                  port.getInfo().usbVendorId === deviceInfo.usbVendorId &&
                  port.getInfo().usbProductId === deviceInfo.usbProductId,
              );

              if (newDevice) {
                device = newDevice;
                transport.updateDevice(device);
                term.writeln("[RECONNECT] Found previously authorized device, connecting...");
                await transport.connect(parseInt(consoleBaudrates.value));
                term.writeln("[RECONNECT] Successfully reconnected!");
                consoleStopButton.style.display = "initial";
                resetButton.style.display = "initial";
                isReconnecting = false;
                startConsoleReading();
                return;
              }
            }
          }

          if (retryCount < maxRetries) {
            term.writeln(`[RECONNECT] Device not found, retrying in ${parseInt(reconnectDelay.value)}ms...`);
            await sleep(parseInt(reconnectDelay.value));
          }
        }

        if (retryCount >= maxRetries) {
          term.writeln("\n[RECONNECT] Failed to reconnect after 5 attempts. Please manually reconnect.");
          isReconnecting = false;
        }
      }
    });
  }

  lblConsoleFor.style.display = "block";
  lblConsoleBaudrate.style.display = "none";
  consoleBaudrates.style.display = "none";
  consoleStartButton.style.display = "none";
  consoleStopButton.style.display = "initial";
  resetButton.style.display = "initial";
  programDiv.style.display = "none";

  await transport.connect(parseInt(consoleBaudrates.value));
  isConsoleClosed = false;
  isReconnecting = false;

  startConsoleReading();
};

const IDF_LOG_LEVEL_REGEX = /^(I|W|E) \([\d.: -]+\)/;
const ANSI = {
  RED: "\x1b[1;31m",
  GREEN: "\x1b[0;32m",
  YELLOW: "\x1b[0;33m",
  NORMAL: "\x1b[0m",
};

function colorizeIdfLine(line: string): string {
  const match = IDF_LOG_LEVEL_REGEX.exec(line);
  if (!match) return line;
  const color = match[1] === "E" ? ANSI.RED : match[1] === "W" ? ANSI.YELLOW : ANSI.GREEN;
  return color + line + ANSI.NORMAL;
}

async function startConsoleReading() {
  if (isConsoleClosed || !transport) return;

  const decoder = new TextDecoder("utf-8");
  let lineBuffer = "";
  try {
    await transport.rawRead(
      (value) => {
        lineBuffer += decoder.decode(value);
        let idx: number;
        while ((idx = lineBuffer.indexOf("\n")) !== -1) {
          const lineWithEol = lineBuffer.slice(0, idx + 1);
          lineBuffer = lineBuffer.slice(idx + 1);
          const lineStripped = lineWithEol.replace(/\r?\n$/, "");
          const eol = lineWithEol.slice(lineStripped.length);
          term.write(colorizeIdfLine(lineStripped) + eol);
        }
      },
      () => isConsoleClosed,
    );
    if (lineBuffer.length > 0) {
      term.write(colorizeIdfLine(lineBuffer));
    }
  } catch (error) {
    if (!isConsoleClosed) {
      term.writeln(`\n[CONSOLE ERROR] ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (!isConsoleClosed) {
    term.writeln("\n[CONSOLE] Connection lost, waiting for reconnection...");
  }
}

consoleStopButton.onclick = async () => {
  isConsoleClosed = true;
  isReconnecting = false;
  if (transport) {
    await transport.disconnect();
    await transport.waitForUnlock(1500);
  }
  term.reset();
  lblConsoleBaudrate.style.display = "initial";
  consoleBaudrates.style.display = "initial";
  consoleStartButton.style.display = "initial";
  consoleStopButton.style.display = "none";
  resetButton.style.display = "none";
  lblConsoleFor.style.display = "none";
  programDiv.style.display = "initial";
  cleanUp();
};

function validateProgramInputs() {
  const offsetArr = [];
  const rowCount = table.rows.length;
  let row;
  let offset = 0;
  let fileData = null;

  for (let index = 1; index < rowCount; index++) {
    row = table.rows[index];
    const offSetObj = row.cells[0].childNodes[0] as HTMLInputElement;
    offset = parseInt(offSetObj.value);

    if (Number.isNaN(offset)) return "Offset field in row " + index + " is not a valid address!";
    else if (offsetArr.includes(offset)) return "Offset field in row " + index + " is already in use!";
    else offsetArr.push(offset);

    const fileObj = row.cells[1].childNodes[0] as any;
    fileData = fileObj.data;
    if (fileData == null) return "No file selected for row " + index + "!";
  }
  return "success";
}

programButton.onclick = async () => {
  const alertMsg = document.getElementById("alertmsg");
  const err = validateProgramInputs();

  if (err != "success") {
    alertMsg.innerHTML = "<strong>" + err + "</strong>";
    alertDiv.style.display = "block";
    return;
  }

  alertDiv.style.display = "none";
  const fileArray = [];
  const progressBars = [];

  for (let index = 1; index < table.rows.length; index++) {
    const row = table.rows[index];
    const offSetObj = row.cells[0].childNodes[0] as HTMLInputElement;
    const offset = parseInt(offSetObj.value);
    const fileObj = row.cells[1].childNodes[0] as ChildNode & { data: Uint8Array };
    const progressBar = row.cells[2].childNodes[0] as any;

    progressBar.textContent = "0";
    progressBars.push(progressBar);
    row.cells[2].style.display = "initial";
    row.cells[3].style.display = "none";

    fileArray.push({ data: fileObj.data, address: offset });
  }

  try {
    const flashOptions: FlashOptions = {
      fileArray: fileArray,
      eraseAll: false,
      compress: true,
      flashMode: flashMode.value as FlashModeValues,
      flashFreq: flashFreq.value as FlashFreqValues,
      flashSize: flashSize.value as FlashSizeValues,
      reportProgress: (fileIndex, written, total) => {
        progressBars[fileIndex].value = (written / total) * 100;
      },
      calculateMD5Hash: (image: Uint8Array) => {
        const latin1String = Array.from(image, (byte) => String.fromCharCode(byte)).join("");
        return CryptoJS.MD5(CryptoJS.enc.Latin1.parse(latin1String)).toString();
      },
    };
    await esploader.writeFlash(flashOptions);
    await esploader.after();
  } catch (e) {
    console.error(e);
    term.writeln(`Error: ${e.message}`);
  } finally {
    for (let index = 1; index < table.rows.length; index++) {
      table.rows[index].cells[2].style.display = "none";
      table.rows[index].cells[3].style.display = "initial";
    }
  }
};

// 初回テーブル初期化のトリガー（安全策）
if (addFileButton) {
  addFileButton.click();
}