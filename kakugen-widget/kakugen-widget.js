// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: pink; icon-glyph: magic;
// 格言ウィジェット（Scriptable）
// File Bookmarks（既定名: Obsidian）に登録した Vault の、Kanban ボードの「Active」列のカードを読み、
// ランダムに1件を表示します。設定は Scriptable のフォルダの kakugen-config.json で上書きできます。

// 初期値（汎用）。個人の環境に合わせる値は kakugen-config.json に書きます。
const DEFAULTS = {
  BOOKMARK: "Obsidian",
  NOTE_PATH: "kakugen.md",
  ICON_PATH: "icon.png",
  ACTIVE_COLUMN: "Active",
  REFRESH_MINUTES: 60,
};
const CONFIG_FILE = "kakugen-config.json";

const fm = FileManager.iCloud();
const CFG = Object.assign({}, DEFAULTS);

// Scriptable フォルダの kakugen-config.json があれば、その値で初期値を上書きする
async function loadConfig() {
  const p = fm.joinPath(fm.documentsDirectory(), CONFIG_FILE);
  try {
    await fm.downloadFileFromiCloud(p);
  } catch (e) {
    // すでにダウンロード済みなどの場合は無視する
  }
  if (!fm.fileExists(p)) return;
  let data;
  try {
    data = JSON.parse(fm.readString(p));
  } catch (e) {
    throw new Error(`${CONFIG_FILE} のJSONが壊れています（${e.message}）。カンマや引用符を確認してください。`);
  }
  for (const key of Object.keys(DEFAULTS)) {
    if (data[key] !== undefined) CFG[key] = data[key];
  }
}

function vaultPath(rel) {
  if (!fm.bookmarkExists(CFG.BOOKMARK)) {
    throw new Error(`File Bookmarks「${CFG.BOOKMARK}」が未設定です。Scriptableの設定で、Vault を「${CFG.BOOKMARK}」の名前で登録してください。`);
  }
  return fm.joinPath(fm.bookmarkedPath(CFG.BOOKMARK), rel);
}

// 先にダウンロードを試み、そのあと存在を確認する
async function ensureFile(p, rel) {
  try {
    await fm.downloadFileFromiCloud(p);
  } catch (e) {
    // すでにダウンロード済みなどの場合は無視して、存在確認に進む
  }
  if (!fm.fileExists(p)) {
    throw new Error(`ファイルが見つかりません: ${rel}`);
  }
}

async function readNote() {
  const p = vaultPath(CFG.NOTE_PATH);
  await ensureFile(p, CFG.NOTE_PATH);
  return fm.readString(p);
}

async function readIcon() {
  const p = vaultPath(CFG.ICON_PATH);
  await ensureFile(p, CFG.ICON_PATH);
  return fm.readImage(p);
}

// Kanban ボードの指定列（既定は「Active」）だけを読む。
// ・列の見出しは行頭の「## 」。列の並び順には依存しない。
// ・カードは「- [ ] 才能名」で始まる。チェック状態（[ ] / [x]）は無視する。
// ・続きの行は、Kanban の保存形式によりタブや空白でインデントされるため、行頭の空白は捨てる。
// ・「::」を含む行と空行は表示しない。
// ・末尾の「%% kanban:settings」以降は読まない。
function parseCards(text, column) {
  let body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const settingsAt = body.indexOf("%% kanban:settings");
  if (settingsAt >= 0) body = body.slice(0, settingsAt);

  const cards = [];
  let inColumn = false;
  let current = null;
  for (const raw of body.split("\n")) {
    if (raw.startsWith("## ")) {
      inColumn = raw.slice(3).trim() === column;
      current = null;
      continue;
    }
    if (!inColumn) continue;
    const line = raw.trim();
    if (/^-\s\[[ xX]\]\s/.test(line)) {
      current = { title: line.replace(/^-\s\[[ xX]\]\s+/, "").trim(), lines: [] };
      cards.push(current);
      continue;
    }
    if (!current || line === "" || line.includes("::")) continue;
    current.lines.push(line);
  }
  return cards.filter(c => c.title && c.lines.length > 0);
}

function fontSizeFor(n) {
  if (n >= 4) return 13;
  if (n === 3) return 15;
  return 17;
}

function baseWidget() {
  const w = new ListWidget();
  w.backgroundColor = Color.dynamic(new Color("#ffffff"), new Color("#1c1c1e"));
  w.setPadding(14, 16, 12, 16);
  return w;
}

function buildWidget(card, icon) {
  const w = baseWidget();
  const main = Color.dynamic(new Color("#1c1c1e"), new Color("#f2f2f7"));
  const sub = Color.dynamic(new Color("#8e8e93"), new Color("#98989d"));

  const head = w.addStack();
  head.centerAlignContent();
  if (icon) {
    // 白い背景でも輪郭が見えるよう、薄いグレーの縁（1pt）を付ける
    const frame = head.addStack();
    frame.borderWidth = 1;
    frame.borderColor = Color.dynamic(new Color("#c7c7cc"), new Color("#48484a"));
    frame.cornerRadius = 14;
    const img = frame.addImage(icon);
    img.imageSize = new Size(26, 26);
    img.cornerRadius = 13;
    head.addSpacer(6);
  }
  const title = head.addText(card.title);
  title.font = Font.boldSystemFont(14);
  title.textColor = sub;
  title.lineLimit = 1;
  title.minimumScaleFactor = 0.7;

  w.addSpacer(8);

  const size = fontSizeFor(card.lines.length);
  const last = card.lines.length - 1;
  card.lines.forEach((line, i) => {
    const t = w.addText(line);
    t.font = (i === 0 || i === last) ? Font.boldSystemFont(size) : Font.systemFont(size);
    t.textColor = main;
    t.lineLimit = 1;
    t.minimumScaleFactor = 0.6;
    if (i < last) w.addSpacer(4);
  });
  return w;
}

function buildError(message) {
  const w = baseWidget();
  const t = w.addText("格言を表示できません\n" + message);
  t.font = Font.systemFont(12);
  t.textColor = Color.red();
  t.minimumScaleFactor = 0.7;
  return w;
}

async function run() {
  let w;
  try {
    await loadConfig();
    const cards = parseCards(await readNote(), CFG.ACTIVE_COLUMN);
    if (cards.length === 0) {
      throw new Error(`${CFG.NOTE_PATH} の「## ${CFG.ACTIVE_COLUMN}」列に表示できるカードがありません。`);
    }
    // アイコンが読めなくても、格言だけは表示する
    let icon = null;
    try {
      icon = await readIcon();
    } catch (e) {
      icon = null;
    }
    const card = cards[Math.floor(Math.random() * cards.length)];
    w = buildWidget(card, icon);
  } catch (e) {
    w = buildError(e.message);
  }
  w.refreshAfterDate = new Date(Date.now() + CFG.REFRESH_MINUTES * 60 * 1000);
  return w;
}

const widget = await run();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentMedium();
}
Script.complete();
