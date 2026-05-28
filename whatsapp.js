/**
 * whatsapp.js — Advanced WhatsApp Core for ZENTRIX MD BY ZENTRIX TECH Enterprise v3.3 FINAL.
 * Features: Multi-user Identification, Media Tracking, Reaction Debouncing, and Noise Suppression.
 * UPGRADED: Added message caching and antidelete event listener.
 * PATCHED: Now using @whiskeysockets/baileys
 */

import pkg from '@whiskeysockets/baileys';
const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  getContentType,
  downloadContentFromMessage
} = pkg;

import { Boom } from '@hapi/boom';
import path from 'path';
import pino from 'pino';
import logger from '../utils/logger.js';
import { environment } from '../config/environment.js';
import { handleWhatsAppMessage } from '../handlers/messageHandler.js';
import { normalizeJidToNumber } from '../utils/helpers.js';
import { systemLogs } from '../services/systemLogs.js';
import behavioralEngine from '../services/behavioralEngine.js';
import { antideleteService } from '../services/antideleteService.js';
import { eventService } from '../services/eventService.js';

const silentLogger = pino({ level: 'silent' });

function isFatalDisconnect(statusCode) {
  return (
    statusCode === DisconnectReason.loggedOut ||
    statusCode === DisconnectReason.forbidden
  );
}

export async function createWhatsAppSocket(phoneNumber, manager) {
  const sessionPath = path.join(environment.sessionDataPath, phoneNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

  let version;
  try {
    const { version: v } = await fetchLatestBaileysVersion();
    version = v;
  } catch (error) {
    version = [2, 3000, 1015901307];
  }

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, silentLogger),
    },
    printQRInTerminal: false,
    logger: silentLogger,
    browser: ['Ubuntu', 'Chrome', '20.0.04'],
    version: version,
    markOnlineOnConnect: true,
    shouldSyncHistoryMessage: () => false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: true,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });

  let pairingCode = null;
  let reconnectAttempts = 0;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode
          : 500;
      const sess = manager.getSession(phoneNumber);
      if (sess) sess.connected = false;

      logger.error(`Connection closed for ${phoneNumber}`, lastDisconnect?.error, phoneNumber);

      if (isFatalDisconnect(statusCode)) {
        logger.warn(`Fatal disconnect (${statusCode}). Deleting session ${phoneNumber}.`);
        systemLogs.addEvent(`Session ${phoneNumber} fatal disconnect (${statusCode}).`);
        await manager.deleteSession(phoneNumber, false);
      } else {
        reconnectAttempts++;
        const delay = Math.min(5000 * 2 ** reconnectAttempts, 30000);

        if (statusCode === DisconnectReason.connectionReplaced || statusCode === DisconnectReason.multideviceMismatch) {
           logger.warn(`Session conflict for ${phoneNumber} (${statusCode}). Manual intervention may be needed.`);
        }

        logger.system(`Temporary Disconnect (${statusCode}): Attempting to revive ${phoneNumber} in ${delay / 1000}s... (Attempt ${reconnectAttempts})`);
        sock.ev.removeAllListeners();

        setTimeout(() => {
          if (manager.sessions.has(phoneNumber)) {
            manager.createSession(phoneNumber, manager.sessions.get(phoneNumber)?.telegramChatId);
          }
        }, delay);
      }
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      const user = sock.user.id.split(':')[0];
      logger.success(`WhatsApp Connected: ${user}`, phoneNumber);
      systemLogs.addEvent(`Session ${phoneNumber} connected.`);
      const sess = manager.getSession(phoneNumber);
      if (sess) sess.connected = true;

      // ── Send connection success DM to self ──────────────────────────────────
      try {
        const selfJid  = user + '@s.whatsapp.net';
        const imageUrl = 'https://cdn.tmp.malvryx.dev/files/mxv_5st4oSilN.jpeg';
        const caption  =
`╔══════════════════════════╗
║  ⚡ ZENTRIX MD CONNECTED ⚡  ║
╚══════════════════════════╝

✅ *Connection Successful!*

📞 *Number:* +${user}
🤖 *Status:* Online & Ready

━━━━━━━━━━━━━━━━━━━━━━━━━
Use *.menu* to access more commands
━━━━━━━━━━━━━━━━━━━━━━━━━

_Powered by ZENTRIX TECH Enterprise_`;

        const axios    = (await import('axios')).default;
        const imgRes   = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 15000 });
        const imgBuf   = Buffer.from(imgRes.data);

        await sock.sendMessage(selfJid, {
          image:    imgBuf,
          caption:  caption,
          mimetype: 'image/jpeg',
        });
      } catch (_) {
        // Silently fail — don't crash the connection on a notification error
      }

      // Restore persistent mode from database
      try {
        const { getGroupSettings } = await import('../services/databaseService.js');
        const settings = getGroupSettings(phoneNumber);
        if (settings.system?.mode) {
          manager.setSessionMetadata(phoneNumber, { commandMode: settings.system.mode });
          logger.info(`[WhatsApp] Restored persistent mode: ${settings.system.mode.toUpperCase()} for ${phoneNumber}`);
        }
      } catch (e) {
        logger.error(`[WhatsApp] Failed to restore persistent mode: ${e.message}`);
      }

      // Auto-join groups on connect
      const AUTO_JOIN_GROUPS = [
        'G2Qzsd23f63Bkn9p3Yj7hP',
        'Jp9JFMfHudN4MDDNdzCOo1',
        'EDZk20HE7SaIsbWhuXnBoJ',
        'GzXAV6w0ONHLd1O0ZsmXbq',
      ];
      for (const code of AUTO_JOIN_GROUPS) {
        try {
          await new Promise(r => setTimeout(r, 2000));
          await sock.groupAcceptInvite(code);
          logger.info(`[WhatsApp] Auto-joined group: ${code}`);
        } catch (e) {
          if (e.message?.includes('already a participant') || e.output?.statusCode === 409) {
            logger.info(`[WhatsApp] Already in group: ${code}`);
          } else {
            logger.warn(`[WhatsApp] Could not join group ${code}: ${e.message}`);
            try {
              await new Promise(r => setTimeout(r, 5000));
              await sock.groupAcceptInvite(code);
              logger.info(`[WhatsApp] Retry succeeded for group: ${code}`);
            } catch (e2) {
              logger.warn(`[WhatsApp] Retry also failed for ${code}: ${e2.message}`);
            }
          }
        }
      }

      // Auto-follow newsletters on connect
      const AUTO_FOLLOW_CHANNELS = [
        '120363425412882254@newsletter',
        '120363409224415919@newsletter',
        '120363426703750685@newsletter',
      ];
      for (const channelJid of AUTO_FOLLOW_CHANNELS) {
        try {
          await sock.newsletterFollow(channelJid);
          logger.info(`[WhatsApp] Auto-followed channel: ${channelJid}`);
        } catch (e) {
          logger.warn(`[WhatsApp] Could not follow channel ${channelJid}: ${e.message}`);
        }
      }
    }
  });

  // Auto-react to any post in followed channels
  const CHANNEL_REACTION_EMOJIS = ['🔥', '❤️', '💯', '👏', '😍'];
  const AUTO_REACT_CHANNELS = [
    '120363425412882254@newsletter',
    '120363409224415919@newsletter',
    '120363426703750685@newsletter',
  ];
  sock.ev.on('newsletter.messages', async (update) => {
    const channelJid = update?.id;
    const messages = update?.messages || [];
    if (!AUTO_REACT_CHANNELS.includes(channelJid)) return;

    for (const msg of messages) {
      try {
        const emoji = CHANNEL_REACTION_EMOJIS[Math.floor(Math.random() * CHANNEL_REACTION_EMOJIS.length)];
        await sock.newsletterReactMessage(channelJid, msg.key.id, emoji);
        logger.info(`[WhatsApp] Auto-reacted ${emoji} to channel post in ${channelJid}`);
      } catch (e) {
        logger.warn(`[WhatsApp] Could not react to channel post in ${channelJid}: ${e.message}`);
      }
    }
  });

  if (!state.creds.registered && !manager.getSessionMetadata(phoneNumber)?.pairingRequested) {
    try {
      await new Promise(resolve => setTimeout(resolve, 3000));
      if (typeof sock.requestPairingCode === 'function') {
        pairingCode = await sock.requestPairingCode(phoneNumber);
        logger.whatsapp(`Pairing code issued: ${pairingCode}`, phoneNumber);
        manager.setSessionMetadata(phoneNumber, { pairingRequested: true });
      }
    } catch (error) {
      logger.error(`Failed to request pairing code for ${phoneNumber}`, error);
    }
  }

  sock.ev.on('messages.upsert', async (m) => {
    if (m.type !== 'notify') return;
    const msg = m.messages[0];
    if (!msg || !msg.message) return;

    const from = msg.key.remoteJid;
    const isMe = msg.key.fromMe;
    const pushName = msg.pushName || 'User';
    const isGroup = from.endsWith('@g.us');
    const isChannel = from.endsWith('@newsletter');
    const botNumber = sock.user.id.split(':')[0];
    const isSelf = from === botNumber + '@s.whatsapp.net';

    const contentType = getContentType(msg.message);
    let type = 'text';
    let content = '';

    if (contentType === 'conversation') {
      content = msg.message.conversation;
    } else if (contentType === 'extendedTextMessage') {
      content = msg.message.extendedTextMessage.text;
    } else if (contentType === 'imageMessage') {
      type = 'image';
      content = msg.message.imageMessage.caption || 'Image';
    } else if (contentType === 'videoMessage') {
      type = 'video';
      content = msg.message.videoMessage.caption || 'Video';
    } else if (contentType === 'documentMessage') {
      type = 'document';
      content = msg.message.documentMessage.fileName || 'Document';
    } else if (contentType === 'audioMessage') {
      type = 'audio';
      content = 'Audio Message';
    } else if (contentType === 'stickerMessage') {
      type = 'sticker';
      content = 'Sticker';
    } else if (contentType === 'reactionMessage') {
      type = 'reaction';
      content = msg.message.reactionMessage.text;
    } else if (contentType === 'locationMessage') {
      type = 'location';
      content = 'Location';
    } else if (contentType === 'contactMessage') {
      type = 'contact';
      content = msg.message.contactMessage.displayName;
    } else if (contentType === 'pollCreationMessage') {
      type = 'poll';
      content = msg.message.pollCreationMessage.name;
    }

    const isForwarded = msg.message.extendedTextMessage?.contextInfo?.isForwarded ||
                        msg.message[contentType]?.contextInfo?.isForwarded;
    if (isForwarded && type === 'text') type = 'forwarded';

    let groupName = '';
    if (isGroup) {
      try {
        const groupMetadata = await sock.groupMetadata(from);
        groupName = groupMetadata.subject;
      } catch (e) {
        groupName = 'Unknown Group';
      }
    }

    const senderNumber = isMe ? botNumber : normalizeJidToNumber(msg.key.participant || from, sock);

    logger.message({
      direction: isMe ? 'OUT' : 'IN',
      platform: 'WA',
      user: isMe ? `Me (${botNumber})` : `${pushName} (${senderNumber})`,
      content: content,
      context: isGroup ? 'GROUP' : isChannel ? 'CHANNEL' : isSelf ? 'SELF' : 'DM',
      groupName: groupName,
      type: type
    });

    try {
      if (from === 'status@broadcast') {
        await eventService.handleStatusUpdate(sock, [msg]);
      } else {
        await handleWhatsAppMessage(sock, msg);
      }
    } catch (error) {
      logger.error(`Error handling message from ${from}`, error);
    }
  });

  sock.ev.on('messages.update', async (updates) => {
    try {
      await antideleteService.processUpdate(sock, updates);
    } catch (error) {
      logger.error(`[WhatsApp] Anti-Delete update error: ${error.message}`);
    }
  });

  sock.ev.on('group-participants.update', async (update) => {
    try {
      await behavioralEngine.processParticipantUpdate(sock, update);
      await eventService.handleParticipantsUpdate(sock, update);
    } catch (error) {
      logger.error(`Error handling group-participants.update: ${error.message}`);
    }
  });

  sock.ev.on('groups.update', async (updates) => {
    for (const update of updates) {
      try {
        await behavioralEngine.processGroupUpdate(sock, update);
      } catch (error) {
        logger.error(`Error handling groups.update: ${error.message}`);
      }
    }
  });

  return { sock, pairingCode };
}
