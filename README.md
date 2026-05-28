<div align="center">

```
 ███████╗███████╗███╗   ██╗████████╗██████╗ ██╗██╗  ██╗
 ╚══███╔╝██╔════╝████╗  ██║╚══██╔══╝██╔══██╗██║╚██╗██╔╝
   ███╔╝ █████╗  ██╔██╗ ██║   ██║   ██████╔╝██║ ╚███╔╝ 
  ███╔╝  ██╔══╝  ██║╚██╗██║   ██║   ██╔══██╗██║ ██╔██╗ 
 ███████╗███████╗██║ ╚████║   ██║   ██║  ██║██║██╔╝ ██╗
 ╚══════╝╚══════╝╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═╝
```

### ⚡ BAILEYS — Multi-Device WhatsApp API

[![Version](https://img.shields.io/badge/version-4.1.3-blue?style=for-the-badge&logo=npm)](https://github.com/ZENTRIX-TECH1/zentrix-baileys)
[![License](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen?style=for-the-badge&logo=node.js)](https://nodejs.org)
[![Stars](https://img.shields.io/github/stars/ZENTRIX-TECH1/zentrix-baileys?style=for-the-badge&logo=github)](https://github.com/ZENTRIX-TECH1/zentrix-baileys/stargazers)

> **A heavily patched & improved WhatsApp Multi-Device API**  
> Built on top of Baileys — enhanced with critical bug fixes, stability improvements, and extended features.

</div>

---

## 📦 Installation

Pick your preferred install method:

```json
"@zentrix/baileys": "latest"
```
```json
"@zentrix/baileys": "^4.1.3"
```
```json
"baileys": "npm:@zentrix/baileys@latest"
```
```json
"whiskeysockets/baileys": "npm:@zentrix/baileys@latest"
```

Then install:
```bash
npm install
# or
yarn install
```

**Import in your project:**
```js
// CommonJS
const { makeWASocket } = require('@zentrix/baileys')

// ESM
import { makeWASocket } from '@zentrix/baileys'
```

---

## 🔧 Drop-in Replacement

Already using `@whiskeysockets/baileys`? No code changes needed — just alias it:

```json
"dependencies": {
    "@whiskeysockets/baileys": "npm:@zentrix/baileys@latest"
}
```

All your existing imports will resolve to ZENTRIX Baileys automatically. ✅

---

## 🐛 Bugs Fixed

### 1. 🔁 Bad MAC Retry Loops
**Symptom:** Messages fail to decrypt, bot gets stuck in an infinite retry loop.

**Fix:** Replaced plain `Map` with a full `MessageRetryManager` class that:
- Detects MAC errors via `RetryReason` enum and forces **immediate session recreation**
- Tracks retry counts per message with LRU expiry (15-min TTL)
- Prevents session recreation hammering with a 1-hour cooldown
- Supports phone-based resend fallback with cancellable timeouts

---

### 2. 🔄 Permanent Bad MAC After Contact Re-registers
**Symptom:** After a contact reinstalls WhatsApp, every message from them fails to decrypt permanently.

**Fix:** Added `handleIdentityChange()` which:
- Listens for identity change push notifications
- Debounces rapid identity changes per JID
- Forces Signal session teardown and rebuild via `assertSessions(force=true)`

---

### 3. ⚡ Pre-key Race Conditions
**Symptom:** Intermittent decryption failures under high message load.

**Fix:** Added `PreKeyManager` which:
- Creates a separate `PQueue` (concurrency: 1) per key type
- Serialises all reads/writes, eliminating race conditions

---

### 4. 🧊 Event Loop Blocking on Reconnect
**Symptom:** Bot becomes unresponsive for seconds after reconnecting with a large backlog.

**Fix:** Added `makeOfflineNodeProcessor()` which:
- Yields to the event loop every 10 nodes
- Catches per-node errors without crashing the processing loop

---

### 5. 📨 Incorrect ACK Stanza Construction
**Symptom:** Some ACKs were missing the `from` field, causing server-side routing issues.

**Fix:** Added `buildAckStanza()` — always includes correct fields matching WA Web behaviour.

---

### 6. 🪪 LID-Addressed Messages Failing to Decrypt
**Symptom:** Messages from LID-format JIDs silently fail to decrypt.

**Fix:** Added `LIDMappingStore` with:
- Bidirectional LID ↔ Phone Number mapping
- LRU in-memory cache (3-day TTL)
- In-flight request deduplication

---

### 7. ❌ Error 463 on 1-to-1 Message Sends
**Symptom:** Occasional `463` error — message never delivered.

**Fix:** Full tctoken system — reads, stores, and attaches privacy tokens to outgoing messages.

---

## ✨ New Exports

| Export | Description |
|--------|-------------|
| `isPnUser(jid)` | Checks `@s.whatsapp.net` |
| `isHostedPnUser(jid)` | Checks `@hosted` server |
| `isHostedLidUser(jid)` | Checks `@hosted.lid` server |
| `isJidMetaAI(jid)` | Checks `@bot` server (Meta AI) |
| `isJidBot(jid)` | Checks bot phone number pattern |
| `isJidNewsletter(jid)` | Fixed spelling (old alias kept) |
| `WAJIDDomains` | Enum: `WHATSAPP=0, LID=1, HOSTED=128, HOSTED_LID=129` |
| `META_AI_JID` | Constant: `'13135550002@c.us'` |

---

## 📁 File Structure

```
zentrix-baileys/
├── lib/
│   ├── Utils/
│   │   ├── index.js                    ← Updated barrel
│   │   ├── message-retry-manager.js    ← NEW
│   │   ├── identity-change-handler.js  ← NEW
│   │   ├── pre-key-manager.js          ← NEW
│   │   ├── offline-node-processor.js   ← NEW
│   │   ├── stanza-ack.js               ← NEW
│   │   └── tc-token-utils.js           ← NEW
│   ├── Signal/
│   │   └── lid-mapping.js              ← NEW
│   └── WABinary/
│       └── jid-utils.js                ← Updated
```

---

## 🔗 New Dependencies

```bash
npm install lru-cache p-queue
# or
yarn add lru-cache p-queue
```

> `lru-cache` may already be present in your `package.json` — check before installing.

---

## 🔗 Links

- 📁 **Repository:** [github.com/ZENTRIX-TECH1/zentrix-baileys](https://github.com/ZENTRIX-TECH1/zentrix-baileys)
- 🐛 **Issues:** [github.com/ZENTRIX-TECH1/zentrix-baileys/issues](https://github.com/ZENTRIX-TECH1/zentrix-baileys/issues)
- 🌐 **Upstream:** [WhiskeySockets/Baileys](https://github.com/WhiskeySockets/Baileys)

---

<div align="center">

**Thanks for using ZENTRIX Baileys! 🙏**

*Built with 💙 by the Zentrix Team*

</div>
