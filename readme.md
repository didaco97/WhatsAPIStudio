<div align="center">
  <img src="https://raw.githubusercontent.com/didaco97/WhatsAPIStudio/main/public/icon.svg" alt="Open-TrulyChat Logo" width="120" />

# 🤖 Open-TrulyChat

**Your Open-Source, Self-Hosted WhatsApp Digital Twin.**  
*Powered by WhatsApp Web JS & OpenAI.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-≥18.x-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19.2-61dafb.svg)](https://react.dev/)
[![Socket.io](https://img.shields.io/badge/WebSockets-Socket.io-black.svg)](https://socket.io/)

</div>

---

## 🌟 What is Open-TrulyChat?

**Open-TrulyChat** is an intelligent, self-hosted auto-reply bot for WhatsApp. Instead of robotic, generic "I am currently away" messages, this bot uses **OpenAI** to analyze your exported chat history and **learn your true texting style**. 

When deployed, it quietly monitors your 1:1 private chats and responds on your behalf just like your digital twin—perfect for when you're traveling, offline, or focusing on deep work.

### ✨ Core Features

- 🎭 **Digital Twin Persona**: Upload your exported `.txt` WhatsApp chats to train the bot to speak exactly like you do. Designate a "closest person" chat for the strongest stylistic match.
- 📱 **Real-Time Web Dashboard**: A beautiful React-based UI to manage your API keys, view live incoming/outgoing messages, monitor activity logs, and link your WhatsApp device via QR code.
- 🧠 **Smart Contextual Memory**: Uses SQLite (`better-sqlite3`) to remember ongoing conversations contextually. It knows exactly what you and your contact talked about recently.
- 🚀 **Bulk Messaging**: Need to send an announcement? Send customized messages to a curated list of numbers right from the web dashboard with human-like randomized delays to prevent bans.
- 🔒 **Privacy-First & Self-Hosted**: All your chat logs, SQLite databases, and API keys stay on **your** device. Open-TrulyChat never calls home. 
- 🛡️ **Safe Auto-Replies**: Automatically ignores WhatsApp Groups, Status replies, and Broadcast lists to prevent accidental spam.

---

## 📸 Screenshots

*(To be added: Web UI showcasing the visual real-time dashboard layout and WhatsApp QR code scanning).*

---

## 🚀 Quick Start Guide

You can run Open-TrulyChat on any environment supporting Node.js!

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/didaco97/WhatsAPIStudio.git
cd WhatsAPIStudio
```

### 2️⃣ Install Dependencies
```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client
npm install
cd ..
```

### 3️⃣ Configure Environment
Create a `.env` file in the root directory (or use `.env.example` as a template):
```env
PORT=3000
PUPPETEER_EXECUTABLE_PATH=""  # Leave empty to let puppeteer auto-detect, or set a path to Chrome.
OPENAI_API_KEY=""             # Fill this here, or supply it via the Web UI later.
```

### 4️⃣ Start the Server
```bash
npm start
```
*Note: This command runs both the backend server and builds/serves the frontend React App.*

Open your browser to `http://localhost:3000`. Set up your OpenAI API key (if you haven't), upload a sample WhatsApp chat export `.txt` file for training, and scan the QR code to log into WhatsApp Web!

---

## 📱 Running on Android (Termux)

You can easily run your Digital Twin directly on your phone using **Termux**!

1. Download [Termux from F-Droid](https://f-droid.org/en/packages/com.termux/).
2. Open Termux and install dependencies:
   ```bash
   pkg update && pkg upgrade
   pkg install git nodejs chromium
   ```
3. Clone the repo and navigate into it:
   ```bash
   git clone https://github.com/didaco97/WhatsAPIStudio.git
   cd WhatsAPIStudio
   ```
4. Configure Puppeteer to use the Termux Chromium in your `.env` file:
   ```env
   PUPPETEER_EXECUTABLE_PATH=/data/data/com.termux/files/usr/bin/chromium-browser
   ```
5. Install packages and run:
   ```bash
   npm install
   npm start
   ```

*(You will need a second device to scan the QR code displayed in the local Termux dashboard URL).*

---

## 🛠️ Built With

- **Backend**: Node.js, Express, `whatsapp-web.js`, Socket.io
- **Frontend**: React (Vite), TailwindCSS, Socket.io-client
- **Database**: `better-sqlite3` (WAL-mode for high concurrency)
- **AI Brain**: OpenAI API (`gpt-4o-mini` or configurable)

---

## ⚠️ Disclaimer

This project is an independent tool and is **not affiliated with, authorized, maintained, sponsored, or endorsed by WhatsApp or any of its affiliates or subsidiaries.** Use responsibly and respect your contacts' privacy. Ensure you comply with WhatsApp's Terms of Service when using automated scripts.

---

<div align="center">
Made with ❤️ by the Open Source Community.
</div>
