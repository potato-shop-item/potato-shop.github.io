# HEX to UF2 Converter for XIAO nRF52840

Seeed Studio XIAO nRF52840用のIntel HEXファイルを、UF2ファイルへ変換するWebツールです。

ブラウザ上で変換処理を行うため、HEXファイルが外部サーバーへ送信されることはありません。

## Features

- Intel HEX形式のファイルをUF2形式へ変換
- `.hex`ファイルのクリック選択
- ドラッグ＆ドロップ対応
- Intel HEXチェックサムの検証
- 拡張リニアアドレスレコード対応
- 拡張セグメントアドレスレコード対応
- Seeed Studio XIAO nRF52840用のUF2 Family IDを使用
- 変換後のUF2ファイルを自動ダウンロード
- Python版の`uf2conv.py`で生成したUF2ファイルとバイナリ一致を確認済み
- ブラウザだけで動作し、追加ソフトウェアのインストール不要

## Target Device

本ツールの主な対象は、以下のボードです。

- Seeed Studio XIAO nRF52840
- Seeed Studio XIAO nRF52840 Sense

使用するUF2 Family ID：

```text
0xADA52840
