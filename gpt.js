const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
require("dotenv").config();
const { saveConversation, getConversationHistory, clearConversationHistory, getSetting, setSetting } = require("./db");

let runtimeApiKey = null;

function setRuntimeApiKey(key) {
  runtimeApiKey = key ? String(key).trim() : null;
}

function getApiKey() {
  return runtimeApiKey || process.env.OPENAI_API_KEY;
}

// ===== PERSONA (stored in DB settings) =====
function getPersona() {
  return getSetting("persona") || "";
}

function setPersona(text) {
  setSetting("persona", (text || "").trim());
}

// ===== CONVERSATION MEMORY (DB-backed) =====
const MAX_HISTORY = 40; // last 40 messages (20 pairs) loaded from DB

function clearHistory(contactId) {
  clearConversationHistory(contactId || null);
}

function getAllHistoryStats() {
  // Quick stats from DB
  const { db } = require("./db");
  const rows = db.prepare(`
    SELECT contact_id, COUNT(*) as count 
    FROM conversations 
    GROUP BY contact_id
  `).all();
  return rows.map(r => ({ contactId: r.contact_id, messageCount: r.count }));
}

/**
 * Clean WhatsApp-exported chat text for AI
 */
function cleanChatForAI(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  const lines = rawText.split(/\r?\n/);
  const out = [];
  const timestampPrefix = /^\s*\u200E?\s*\[\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M\]\s*/;

  for (const line of lines) {
    let cleaned = line.replace(timestampPrefix, "").trim();
    if (!cleaned) continue;
    cleaned = cleaned.replace(/\u200E/g, "");
    if (/^.+:\s*image omitted\.?$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*image omitted\.?\s*$/i, " [image]");
    } else if (/^.+:\s*video omitted\.?$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*video omitted\.?\s*$/i, " [video]");
    } else if (/^.+:\s*audio omitted\.?$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*audio omitted\.?\s*$/i, " [audio]");
    } else if (/^.+:\s*document omitted\.?$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*document omitted\.?\s*$/i, " [document]");
    } else if (/^.+:\s*sticker omitted\.?$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*sticker omitted\.?\s*$/i, " [sticker]");
    } else if (/^.+:\s*You deleted this message\.?\s*$/i.test(cleaned)) {
      cleaned = cleaned.replace(/\s*You deleted this message\.?\s*$/i, " [deleted]");
    }
    out.push(cleaned);
  }

  return out.join("\n");
}

/**
 * Get AI reply with per-contact conversation memory (DB-backed)
 */
async function getReplyAsJeet(folderPath, userMessage, contactId) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("No OpenAI API key. Set OPENAI_API_KEY in .env or enter it in the web app.");
  }
  const openai = new OpenAI({ apiKey });
  const fullPath = path.isAbsolute(folderPath) ? folderPath : path.join(process.cwd(), folderPath);

  // Try to load chat reference files (optional)
  let combinedText = "";
  let hasChats = false;

  if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
    let filePaths = fs
      .readdirSync(fullPath)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => path.join(fullPath, f));

    if (filePaths.length > 0) {
      hasChats = true;
      const closestName = "closest-person.txt";
      const closestPath = filePaths.find((p) => path.basename(p) === closestName);
      if (closestPath) {
        filePaths = [closestPath, ...filePaths.filter((p) => p !== closestPath)];
      }

      const documents = filePaths.map((filePath) => {
        const raw = fs.readFileSync(filePath, "utf8");
        const content = cleanChatForAI(raw);
        const name = path.basename(filePath);
        const isClosest = name === closestName;
        return `--- ${name}${isClosest ? " (PRIMARY style reference)" : ""} ---\n${content}`;
      });

      combinedText = documents.join("\n\n");
    }
  }

  // Check for custom persona (from DB)
  const persona = getPersona();

  // Build system prompt
  let systemPrompt;
  if (persona) {
    systemPrompt = `${persona}

IMPORTANT RULES:
- You are chatting on WhatsApp. Keep replies short and natural like a real person.
- Remember the conversation history — refer to what the user said before.
- NEVER say you are an AI, bot, or assistant. Stay in character at all times.
- Keep replies concise — 1-3 sentences max unless the user asks for detailed info.`;
    if (hasChats) {
      systemPrompt += `\n\nFor additional style reference, here are past chat examples:\n${combinedText}`;
    }
  } else if (hasChats) {
    systemPrompt = `You are Jeet Vani—a real person texting friends, not an assistant or chatbot.

VOICE & STYLE (must match the past chats, especially the "closest person" chat if present):
- Casual Hinglish: mix English + Hindi naturally.
- Short, punchy messages. Often 1–2 lines.
- Informal texting style. Occasional harmless typos are fine.
- NEVER sound like a bot: no "I'd be happy to", "Certainly!", bullet lists, or polished paragraphs.
- Remember conversation history — refer to what the user said before.

Reference chats:\n${combinedText}

Match the tone and vocabulary from these chats. Reply as one short, natural message.`;
  } else {
    systemPrompt = `You are a real person texting on WhatsApp—NOT an assistant, NOT a chatbot.

RULES:
- Talk like a real human. Casual, short, natural.
- Use informal texting style: abbreviations, slang are fine.
- Keep messages SHORT — 1-3 sentences max.
- NEVER sound like a bot: no "I'd be happy to", "Certainly!", bullet lists, or polished paragraphs.
- Be friendly, warm, and conversational.
- Remember the conversation history — refer to what was discussed before.
- Reply with ONE short message only.`;
  }

  // Build messages array with conversation history from DB
  const messages = [{ role: "system", content: systemPrompt }];

  // Load conversation history from DB
  const history = getConversationHistory(contactId, MAX_HISTORY);
  for (const msg of history) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add current user message
  messages.push({ role: "user", content: userMessage });

  let reply;
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 512,
    });
    reply = response.choices?.[0]?.message?.content || "";
  } catch (apiErr) {
    console.error("OpenAI API error:", apiErr.message);
    if (apiErr.status) console.error("  HTTP status:", apiErr.status);
    if (apiErr.code) console.error("  Error code:", apiErr.code);
    throw apiErr;
  }

  // Save to conversation history in DB
  saveConversation(contactId, "user", userMessage);
  saveConversation(contactId, "assistant", reply);

  console.log(`[${contactId}] AI reply:`, reply);
  return reply;
}

module.exports = {
  getReplyAsJeet,
  setRuntimeApiKey,
  getApiKey,
  setPersona,
  getPersona,
  cleanChatForAI,
  clearHistory,
  getAllHistoryStats,
};
