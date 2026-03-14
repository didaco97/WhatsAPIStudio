require("dotenv").config();
const path = require("path");
const fs = require("fs");
const http = require("http");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const open = require("open").default;
const { Server } = require("socket.io");
const qrcode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { getReplyAsJeet, setRuntimeApiKey, getApiKey, setPersona, getPersona, clearHistory, getAllHistoryStats } = require("./gpt");
const { upsertContact, saveMessage, getMessages, getContacts, clearMessages } = require("./db");

const API_KEY_COOKIE = "jeet_api_key";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 * 1000; // 1 year

const FILES_FOLDER = path.join(__dirname, "files");
const PORT = process.env.PORT || 3000;

// Ensure files folder exists
if (!fs.existsSync(FILES_FOLDER)) {
  fs.mkdirSync(FILES_FOLDER, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, FILES_FOLDER),
  filename: (req, file, cb) => {
    const base = (file.originalname || `chat-${Date.now()}.txt`).replace(/[^a-zA-Z0-9._-]/g, "_") || "chat.txt";
    cb(null, base);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === "text/plain" || (file.originalname && file.originalname.toLowerCase().endsWith(".txt"));
    cb(ok ? null : new Error("Only .txt files allowed"), ok);
  },
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use((req, res, next) => {
  if (req.cookies && req.cookies[API_KEY_COOKIE] && !getApiKey()) {
    setRuntimeApiKey(req.cookies[API_KEY_COOKIE]);
  }
  next();
});
const clientDist = path.join(__dirname, "client", "dist");
const publicDir = path.join(__dirname, "public");
const staticDir = fs.existsSync(clientDist) ? clientDist : publicDir;
app.use(express.static(staticDir));

app.get("/", (req, res) => {
  const indexPath = fs.existsSync(clientDist)
    ? path.join(clientDist, "index.html")
    : path.join(publicDir, "index.html");
  res.sendFile(indexPath);
});

app.get("/api/config", (req, res) => {
  let hasChats = false;
  let hasClosestPerson = false;
  try {
    if (fs.existsSync(FILES_FOLDER)) {
      const files = fs.readdirSync(FILES_FOLDER).filter((f) => f.endsWith(".txt"));
      hasChats = files.length > 0;
      hasClosestPerson = files.includes("closest-person.txt");
    }
  } catch (_) { }
  res.json({ hasApiKey: !!getApiKey(), hasChats, hasClosestPerson });
});

app.post("/api/clear-key", (req, res) => {
  setRuntimeApiKey(null);
  res.clearCookie(API_KEY_COOKIE);
  res.json({ ok: true });
});

app.post("/api/set-key", (req, res) => {
  const key = req.body && req.body.apiKey;
  if (!key || typeof key !== "string" || !key.trim()) {
    return res.status(400).json({ ok: false, error: "API key is required" });
  }
  const trimmed = key.trim();
  setRuntimeApiKey(trimmed);
  res.cookie(API_KEY_COOKIE, trimmed, {
    httpOnly: true,
    maxAge: COOKIE_MAX_AGE,
    sameSite: "lax",
  });
  res.json({ ok: true });
});

// --- Persona ---
app.get("/api/persona", (req, res) => {
  res.json({ persona: getPersona() });
});

app.post("/api/persona", (req, res) => {
  const text = req.body && req.body.persona;
  setPersona(text || "");
  res.json({ ok: true, persona: getPersona() });
});

// --- Memory ---
app.post("/api/clear-memory", (req, res) => {
  const contactId = req.body && req.body.contactId;
  clearHistory(contactId || null);
  res.json({ ok: true, message: contactId ? `Cleared memory for ${contactId}` : "Cleared all conversation memory" });
});

app.get("/api/memory-stats", (req, res) => {
  res.json({ conversations: getAllHistoryStats() });
});

// --- Persisted Activity & Contacts ---
app.get("/api/activity", (req, res) => {
  const contactId = req.query.contact || null;
  const limit = parseInt(req.query.limit) || 200;
  const rows = getMessages(contactId, limit);
  res.json({ messages: rows });
});

app.get("/api/contacts-list", (req, res) => {
  const rows = getContacts();
  res.json({ contacts: rows });
});

app.post("/api/clear-activity", (req, res) => {
  const contactId = req.body && req.body.contactId;
  clearMessages(contactId || null);
  res.json({ ok: true });
});

app.get("/api/chats", (req, res) => {
  try {
    if (!fs.existsSync(FILES_FOLDER)) {
      return res.json({ files: [] });
    }
    const files = fs
      .readdirSync(FILES_FOLDER)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => ({ name: f, isClosest: f === "closest-person.txt" }));
    res.json({ files });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/upload-chat", upload.single("chat"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, error: "No file uploaded. Choose a .txt chat export." });
  }
  const asClosest = req.body && (req.body.asClosest === "true" || req.body.asClosest === true);
  let filename = req.file.filename;
  if (asClosest) {
    const targetPath = path.join(FILES_FOLDER, "closest-person.txt");
    try {
      fs.renameSync(req.file.path, targetPath);
      filename = "closest-person.txt";
    } catch (err) {
      return res.status(500).json({ ok: false, error: "Failed to save as closest-person chat." });
    }
  }
  res.json({
    ok: true,
    filename,
    asClosest: !!asClosest,
    message: asClosest
      ? "Chat saved as your closest-person reference. Replies will match this style most closely."
      : "Chat uploaded. It will be used as additional style reference.",
  });
});

// Auto-detect Chrome path based on OS
function findChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  if (process.platform === "win32") {
    const paths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      process.env.LOCALAPPDATA + "\\Google\\Chrome\\Application\\chrome.exe",
    ];
    for (const p of paths) { if (fs.existsSync(p)) return p; }
  } else if (process.platform === "darwin") {
    return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  }
  return undefined; // let puppeteer find it
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    executablePath: findChromePath(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", async (qr) => {
  try {
    const dataUrl = await qrcode.toDataURL(qr, { margin: 2, width: 280 });
    io.emit("qr", { dataUrl });
  } catch (err) {
    console.error("QR to image error:", err.message);
  }
});

let isReady = false;

client.on("ready", () => {
  isReady = true;
  console.log("WhatsApp client is READY");
  io.emit("ready");
});

io.on("connection", (socket) => {
  console.log("Socket client connected:", socket.id);
  if (isReady) socket.emit("ready");
});

app.post("/api/wa-logout", async (req, res) => {
  try {
    await client.logout();
    isReady = false;
    io.emit("disconnected");
    res.json({ ok: true, message: "WhatsApp logged out. Scan QR to reconnect." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

client.on("disconnected", (reason) => {
  isReady = false;
  io.emit("disconnected");
  console.log("WhatsApp disconnected:", reason);
  // Re-initialize to get a new QR
  setTimeout(() => client.initialize(), 3000);
});

client.on("message_create", async (msg) => {
  if (msg.fromMe) return;
  const text = (msg.body || "").trim();
  console.log("Message received from:", msg.from, "body:", text.substring(0, 50));

  // Resolve contact name (pushname = WhatsApp profile name)
  let fromName = null;
  try {
    const contact = await msg.getContact();
    fromName = contact.pushname || contact.name || contact.shortName || null;
  } catch (_) { }
  const displayName = fromName || msg.from;

  // Never reply to status updates
  if (msg.isStatus) return;

  // Only process personal (direct) chats, not groups or broadcasts
  let isPrivate = false;
  try {
    const chat = await msg.getChat();
    const chatId = (chat.id && chat.id._serialized) ? chat.id._serialized : String(chat.id || "");
    const isStatusChat = /status@broadcast|@\w*broadcast\b/.test(chatId);
    isPrivate = !chat.isGroup && !isStatusChat;
  } catch (_) { }
  if (!isPrivate) return;

  // Now save to DB + emit (only for private chats, after filtering)
  upsertContact(msg.from, fromName); // only saves actual name, null if unknown
  saveMessage(msg.from, "incoming", text || msg.body || "", null, null);

  const payload = {
    id: (msg.id && msg.id._serialized) ? msg.id._serialized : `${msg.from}-${Date.now()}`,
    from: msg.from,
    fromName: displayName,
    body: msg.body || "",
    timestamp: msg.timestamp,
    hasMedia: msg.hasMedia,
  };
  io.emit("message", payload);

  if (!text) return;

  if (!getApiKey()) {
    const errMsg = "Bot is not configured: add your OpenAI API key in the web app first.";
    saveMessage(msg.from, "error", text, null, errMsg);
    io.emit("bot-error", { from: msg.from, fromName: displayName, incomingBody: text, error: errMsg });
    await msg.reply(errMsg);
    return;
  }

  try {
    const reply = await getReplyAsJeet(FILES_FOLDER, text, msg.from);
    const replyText = reply || "👍";
    await msg.reply(replyText);
    saveMessage(msg.from, "reply", text, replyText, null);
    io.emit("bot-reply", { from: msg.from, fromName: displayName, incomingBody: text, reply: replyText });
  } catch (err) {
    const errorDetail = `${err.message || "Unknown error"}${err.status ? ` (HTTP ${err.status})` : ""}${err.code ? ` [${err.code}]` : ""}`;
    console.error("Jeet reply error:", errorDetail);
    saveMessage(msg.from, "error", text, null, errorDetail);
    io.emit("bot-error", { from: msg.from, fromName: displayName, incomingBody: text, error: errorDetail });
    await msg.reply("Something went wrong, try again in a bit.");
  }
});

// --- Bulk Send ---
app.get("/api/wa-status", (req, res) => {
  res.json({ connected: isReady });
});

let bulkSending = false;

app.post("/api/bulk-send", async (req, res) => {
  const { numbers, message } = req.body || {};

  if (!isReady) {
    return res.status(400).json({ ok: false, error: "WhatsApp is not connected. Scan the QR code first." });
  }
  if (bulkSending) {
    return res.status(409).json({ ok: false, error: "A bulk send is already in progress. Wait for it to finish." });
  }
  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({ ok: false, error: "Message is required." });
  }
  if (!Array.isArray(numbers) || numbers.length === 0) {
    return res.status(400).json({ ok: false, error: "At least one phone number is required." });
  }

  // Sanitize numbers — strip non-digits, ensure they have @c.us suffix
  const cleaned = numbers
    .map((n) => String(n).replace(/[^\d]/g, ""))
    .filter((n) => n.length >= 7 && n.length <= 15);

  if (cleaned.length === 0) {
    return res.status(400).json({ ok: false, error: "No valid phone numbers found. Use country code + number (e.g. 919876543210)." });
  }

  res.json({ ok: true, total: cleaned.length, message: `Sending to ${cleaned.length} number(s)…` });

  // Run bulk send in background
  bulkSending = true;
  const total = cleaned.length;
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const num of cleaned) {
    const chatId = num.includes("@c.us") ? num : `${num}@c.us`;
    try {
      await client.sendMessage(chatId, message.trim());
      sent++;
      results.push({ number: num, status: "sent" });
      io.emit("bulk-progress", { total, sent, failed, current: num, status: "sent" });
    } catch (err) {
      failed++;
      results.push({ number: num, status: "failed", error: err.message });
      io.emit("bulk-progress", { total, sent, failed, current: num, status: "failed", error: err.message });
    }

    // Human-like random delay: 3-8 seconds between each message
    if (sent + failed < total) {
      const delay = Math.floor(Math.random() * 5000) + 3000; // 3000-8000ms
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  bulkSending = false;
  io.emit("bulk-done", { total, sent, failed, results });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`Web app: ${url}`);
  open(url).catch(() => { });
  client.initialize();
});
