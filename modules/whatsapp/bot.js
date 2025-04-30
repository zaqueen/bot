// bot.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const handlers = require('./handlers');

// Ensure auth directory exists
const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
if (!fs.existsSync(AUTH_FOLDER)) {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

let sock = null;

async function initialize() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  
  // Logger with reduced verbosity
  const logger = pino({ level: 'warn' });
  
  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
    logger: logger,
    browser: ['WhatsApp Bot', 'Chrome', '10.0'],
    version: [2, 2323, 4]  // Specify WhatsApp web version
  });

  // Handle QR code and connection events
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    
    // Log the update for debugging
    console.log('Connection update:', JSON.stringify(update, null, 2));
    
    if (qr) {
      console.log('QR Code diterima, silahkan scan dengan WhatsApp Anda:');
      qrcode.generate(qr, { small: true });
    }
    
    if (connection === 'open') {
      console.log('WhatsApp Bot siap digunakan!');
      
      // Send test message to yourself to confirm connectivity
      try {
        const myNumber = sock.user.id.split(':')[0];
        await sock.sendMessage(myNumber + '@s.whatsapp.net', { text: 'Bot started successfully!' });
        console.log('Test message sent successfully');
      } catch (err) {
        console.log('Failed to send test message:', err);
      }
    }
    
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom && 
        lastDisconnect.error.output.statusCode !== DisconnectReason.loggedOut);
      
      console.log('Koneksi terputus karena:', lastDisconnect?.error?.output?.payload?.message || 'Alasan tidak diketahui');
      
      if (shouldReconnect) {
        console.log('Mencoba menyambung kembali...');
        setTimeout(() => {
          console.log('Melakukan inisialisasi ulang...');
          initialize();
        }, 5000); // Wait 5 seconds before reconnecting
      } else {
        console.log('Koneksi ditutup secara permanen. Silakan restart bot secara manual.');
      }
    }
  });

  // Save credentials when updated
  sock.ev.on('creds.update', saveCreds);

  // Handle incoming messages with improved reliability
  sock.ev.on('messages.upsert', async ({ messages }) => {
    try {
      console.log('Received message:', JSON.stringify(messages, null, 2));
      
      for (const msg of messages) {
        // Ignore status updates and messages from self
        if (msg.key.remoteJid === 'status@broadcast' || msg.key.fromMe) continue;
        
        // Extract message content with better handling of different message types
        const messageContent = msg.message || {};
        const messageType = Object.keys(messageContent)[0];
        let body = '';
        
        if (messageType === 'conversation') {
          body = messageContent.conversation;
        } else if (messageType === 'extendedTextMessage') {
          body = messageContent.extendedTextMessage.text;
        } else if (messageType === 'imageMessage' && messageContent.imageMessage.caption) {
          body = messageContent.imageMessage.caption;
        } else if (messageType === 'documentWithCaptionMessage' && messageContent.documentWithCaptionMessage?.message?.documentMessage?.caption) {
          body = messageContent.documentWithCaptionMessage.message.documentMessage.caption;
        } else if (messageType === 'videoMessage' && messageContent.videoMessage?.caption) {
          body = messageContent.videoMessage.caption;
        } else {
          console.log(`Unhandled message type: ${messageType}`);
        }
        
        // Create a compatible message format for the handlers
        const compatMsg = {
          from: msg.key.remoteJid,
          body: body,
          id: msg.key.id,
          timestamp: msg.messageTimestamp,
          raw: msg,
          reply: async (text) => {
            await sock.sendMessage(msg.key.remoteJid, { text }, { quoted: msg });
          }
        };
        
        // Handle the message with proper error catching
        try {
          await handlers.handleMessage(sock, compatMsg);
        } catch (error) {
          console.error('Error in message handler:', error);
          // Try to notify about the error
          try {
            await sock.sendMessage(msg.key.remoteJid, { 
              text: 'Terjadi kesalahan saat memproses pesan. Silakan coba lagi.' 
            }, { quoted: msg });
          } catch (replyError) {
            console.error('Failed to send error notification:', replyError);
          }
        }
      }
    } catch (globalError) {
      console.error('Critical error in message processing:', globalError);
    }
  });

  // Add group participants event handling if needed
  sock.ev.on('group-participants.update', async (update) => {
    console.log('Group participants update:', update);
    // You can handle group join/leave events here
  });

  // Monitor state changes
  sock.ev.on('CB:Blocklist', json => {
    if (json.blocklist) {
      console.log('Blocklist updated');
    }
  });

  // Catch and log any unexpected errors
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // Keep the bot running despite errors
  });

  return sock;
}

// Function to send a message to a specific number with improved error handling
async function sendMessage(to, message) {
  try {
    console.log(`Mencoba mengirim pesan ke ${to}...`);
    // Ensure the number is in the correct format
    const formattedNumber = to.endsWith('@s.whatsapp.net') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    
    await sock.sendMessage(formattedNumber, { text: message });
    console.log(`Pesan terkirim ke ${to}`);
    return true;
  } catch (error) {
    console.error(`Gagal mengirim pesan ke ${to}:`, error);
    return false;
  }
}

// Function to shutdown the bot gracefully
async function shutdown() {
  console.log('Menutup koneksi WhatsApp Bot...');
  if (sock) {
    try {
      await sock.end();
      console.log('WhatsApp Bot ditutup.');
    } catch (error) {
      console.error('Error shutting down bot:', error);
    }
  }
}

// Maintain backward compatibility with your previous implementation
module.exports = {
  initialize,
  sendMessage,
  shutdown,
  client: {}, // Placeholder for compatibility
  getSocket: () => sock
};