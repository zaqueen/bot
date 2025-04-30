const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const app = express();
app.use(express.json());

// Import modules
const whatsappBot = require('./modules/whatsapp/bot');
const mqttClient = require('./modules/mqtt/client');
const sheetsClient = require('./modules/sheets/client');

// Webhook endpoint buat terima notif dari Google Sheets
app.post('/notif', async (req, res) => {
  const token = req.headers.authorization;
  if (token !== `Bearer ${process.env.AUTH_TOKEN}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { phone, message } = req.body;
  try {
    // Kirim pesan WA via bot
    await whatsappBot.sendMessage(phone, message); // pastikan fungsi ini ada
    res.json({ status: 'Message sent' });
  } catch (error) {
    console.error('Gagal kirim pesan:', error);
    res.status(500).json({ error: 'Gagal kirim pesan' });
  }
});

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Express webhook server aktif di port ${PORT}`);
});

// Start WhatsApp Bot and handle setup async
(async () => {
  try {
    console.log('Menginisialisasi WhatsApp Bot...');
    await whatsappBot.initialize();
    
    // Connect to MQTT broker
    mqttClient.connect();
    
    // Initialize Google Sheets connection
    sheetsClient.initialize();
    
    console.log('Sistem Pengadaan Barang dimulai...');
  } catch (error) {
    console.error('Error saat menginisialisasi aplikasi:', error);
    process.exit(1);
  }
})();

// Handle process termination
process.on('SIGINT', async () => {
  console.log('Menutup aplikasi...');
  await whatsappBot.shutdown();
  mqttClient.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Menerima sinyal SIGTERM. Menutup aplikasi...');
  await whatsappBot.shutdown();
  mqttClient.disconnect();
  process.exit(0);
});
