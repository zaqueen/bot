const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
const handlers = require('./handlers');

// Config
const AUTH_FOLDER = path.join(__dirname, 'auth_info_baileys');
const RECONNECT_INTERVAL = 5000; // 5 detik
const MAX_RECONNECT_ATTEMPTS = 10;
let reconnectAttempts = 0;
let isShuttingDown = false;

// Ensure auth directory exists
if (!fs.existsSync(AUTH_FOLDER)) {
  fs.mkdirSync(AUTH_FOLDER, { recursive: true });
}

let sock = null;

// Fungsi untuk handle reconnect dengan exponential backoff
const delayedReconnect = () => {
  if (isShuttingDown) return;
  
  reconnectAttempts++;
  const delay = Math.min(RECONNECT_INTERVAL * Math.pow(2, reconnectAttempts), 30000); // Max 30 detik
  
  console.log(`Mencoba reconnect (attempt ${reconnectAttempts}) dalam ${delay}ms...`);
  
  setTimeout(() => {
    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
      initialize().catch(err => {
        console.error('Gagal reconnect:', err);
        delayedReconnect();
      });
    } else {
      console.error('Max reconnect attempts reached. Silakan restart manual.');
    }
  }, delay);
};

async function initialize() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
    
    const logger = pino({ level: 'warn' });
    
    sock = makeWASocket({
      printQRInTerminal: true,
      auth: state,
      logger: logger,
      browser: ['WhatsApp Bot', 'Chrome', '10.0'],
      version: [2, 2323, 4],
      getMessage: async (key) => {
        // Implement cache jika diperlukan
        return null;
      }
    });

    // Handle connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      console.log('Connection update:', JSON.stringify(update, null, 2));
      
      if (qr) {
        qrcode.generate(qr, { small: true });
      }
      
      if (connection === 'open') {
        console.log('✅ Connected to WhatsApp');
        reconnectAttempts = 0; // Reset counter saat connect sukses
        
        // Test message
        try {
          const myNumber = sock.user?.id?.split(':')[0];
          if (myNumber) {
            await sock.sendMessage(myNumber + '@s.whatsapp.net', { text: 'Bot reconnected successfully!' });
          }
        } catch (err) {
          console.log('Test message error:', err);
        }
      }
      
      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isIntentionalDisconnect = [
          DisconnectReason.loggedOut,
          DisconnectReason.badSession
        ].includes(statusCode);
        
        console.log('Disconnect reason:', statusCode || 'unknown');
        
        if (!isShuttingDown && !isIntentionalDisconnect) {
          delayedReconnect();
        } else {
          console.log('Disconnect permanen. Harus restart manual.');
        }
      }
    });

    // Credentials handler
    sock.ev.on('creds.update', saveCreds);

    // Message handler (existing code)
    sock.ev.on('messages.upsert', ({ messages }) => {
      // ... (kode message handling yang sudah ada)
    });

    // Error handling
    sock.ev.on('connection.phone.code', (code) => {
      console.log('Kode verifikasi:', code);
    });

    sock.ev.on('connection.gsm.error', (error) => {
      console.error('GSM error:', error);
    });

    return sock;
  } catch (err) {
    console.error('Initialization error:', err);
    throw err;
  }
}

async function sendMessage(to, message) {
  if (!sock) {
    console.error('WhatsApp client not initialized');
    return false;
  }

  try {
    const formattedNumber = to.endsWith('@s.whatsapp.net') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
    await sock.sendMessage(formattedNumber, { text: message });
    return true;
  } catch (error) {
    console.error('Send message error:', error);
    
    // Auto-reconnect jika error terkait koneksi
    if (error.message.includes('Socket closed') || error.message.includes('Connection failed')) {
      console.log('Triggering reconnect due to send error...');
      delayedReconnect();
    }
    
    return false;
  }
}

async function shutdown() {
  isShuttingDown = true;
  
  if (sock) {
    try {
      await sock.end();
      console.log('WhatsApp connection closed gracefully');
    } catch (error) {
      console.error('Shutdown error:', error);
    } finally {
      sock = null;
    }
  }
}

// Export dengan fitur tambahan
module.exports = {
  initialize,
  sendMessage,
  shutdown,
  getSocket: () => sock,
  isConnected: () => sock?.user ? true : false
};
