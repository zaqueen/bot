// handlers.js
const ticketingService = require('../../services/ticketing');
const mqttClient = require('../mqtt/client');
const sheetsOperations = require('../sheets/operations');

// Command prefixes
const COMMANDS = {
  REQUEST: '/request',
  HELP: '/help',
  REPLY: '/jawab'
};

const userStates = {}; // Menyimpan state pengguna berdasarkan nomor pengirim

async function handleMessage(sock, msg) {
  const senderNumber = msg.from.split('@')[0];
  const messageBody = msg.body.trim();

  if (messageBody.startsWith(COMMANDS.REPLY)) {
    await handleReplyToSekdep(sock, msg);
    return;
  }
  
  // Jika pengguna mengirim /request
  if (messageBody === COMMANDS.REQUEST) {
    // Mulai alur baru dengan format baris
    userStates[senderNumber] = { step: 'waitingForCompleteData' };
    
    // Bubble chat pertama (contoh)
    await msg.reply(
      'Contoh request:\n' +
      'Nama Lengkap: Charles Subianto\n' +
      'Nama Barang: Proyektor\n' +
      'Jumlah: 1 unit\n' +
      'Link: https://ekatalog.its.ac.id/shop/product/proyektor (Link produk harus dari e-katalog ITS)\n' +
      'Keperluan: Untuk presentasi di ruang rapat\n\n' +
      'Silahkan masukkan keterangan barang yang ingin diajukan dengan format seperti diatas dengan menyalin pesan dibawah:'
    );
    
    // Bubble chat kedua (template kosong)
    await msg.reply(
      'Nama Lengkap:\n' +
      'Nama Barang:\n' +
      'Jumlah:\n' +
      'Link:\n' +
      'Keperluan:'
    );
    return;
  }

  // Jika pengguna sedang dalam alur pembuatan request
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForCompleteData') {
    // Parse format baris
    const inputLines = messageBody.split('\n');
    const requestData = {};
    
    // Ekstrak data dari tiap baris
    for (const line of inputLines) {
      if (line.startsWith('Nama Lengkap:')) {
        requestData.senderName = line.replace('Nama Lengkap:', '').trim();
      } else if (line.startsWith('Nama Barang:')) {
        requestData.goodsName = line.replace('Nama Barang:', '').trim();
      } else if (line.startsWith('Jumlah:')) {
        requestData.quantity = line.replace('Jumlah:', '').trim();
      } else if (line.startsWith('Link:')) {
        requestData.link = line.replace('Link:', '').trim();
      } else if (line.startsWith('Keperluan:')) {
        requestData.reason = line.replace('Keperluan:', '').trim();
      }
    }
    
    // Validasi data
    const requiredFields = ['senderName', 'goodsName', 'quantity', 'link', 'reason'];
    const missingFields = requiredFields.filter(field => !requestData[field]);
    
    if (missingFields.length > 0) {
      await msg.reply(
        '❌ Format data tidak lengkap. Pastikan Anda memasukkan semua informasi yang dibutuhkan.\n\n' +
        'Format:\nNama Lengkap:\nNama Barang:\nJumlah:\nLink:\nKeperluan:\n\n' +
        'Contoh:\nNama Lengkap: John Doe\nNama Barang: Proyektor\nJumlah: 1 unit\nLink: https://ekatalog.its.ac.id/shop/product/proyektor\nKeperluan: Untuk presentasi di ruang rapat'
      );
      return;
    }

    // Generate ticket number
    const ticketNumber = ticketingService.generateTicket();

    // Simpan data ke Google Sheets
    await sheetsOperations.addNewRequest({
      ticketNumber,
      senderNumber,
      senderName: requestData.senderName,
      timestamp: getWIBTimestamp(),
      goodsName: requestData.goodsName,
      quantity: requestData.quantity,
      link: requestData.link,
      reason: requestData.reason,
      status: 'PENDING_APPROVAL',
      approvalSekdep: null,
      statusBendahara: null,
      reasonSekdep: null,
      reasonBendahara: null,
      lastUpdated: getWIBTimestamp()
    });

    // Kirim notifikasi ke Sekdep
    await notifySekdep(ticketNumber, requestData.goodsName, requestData.quantity, 
                     requestData.reason, requestData.link, senderNumber, requestData.senderName);
    await notifyBendahara(ticketNumber, requestData.goodsName, requestData.quantity, 
                     requestData.reason, requestData.link, senderNumber, requestData.senderName);
    // Beri tahu pengguna
    await msg.reply(
      `✅ Permintaan Anda telah diterima!\n\n*Nomor Tiket: ${ticketNumber}*\n\nGunakan nomor tiket ini untuk memeriksa status permintaan Anda. Ketik *${ticketNumber}* untuk memeriksa status.`
    
    );

    // Hapus state pengguna setelah selesai
    delete userStates[senderNumber];
    return;
  }

  // Handle approval/rejection dari Sekdep (format: "1 123" atau "2 123 Alasan")
  if (senderNumber === process.env.SEKDEP_NUMBER && /^\d+\s\d+/.test(messageBody)) {
    const parts = messageBody.split(' ');
    const action = parts[0]; // angka aksi
    const ticketNumber = parts[1];
    const reason = parts.slice(2).join(' ');

    // Cek apakah tiket ada
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    if (!ticketData) {
      await msg.reply(`❌ Tiket dengan nomor *${ticketNumber}* tidak ditemukan. Silakan periksa kembali nomor tiket.`);
      return;
    }

    // Cek apakah aksi valid (1, 2, atau 3)
    if (action !== '1' && action !== '2' && action !== '3') {
      await msg.reply(
        `❌ Format tidak valid. Gunakan:\n` +
        `*1 ${ticketNumber}* untuk menyetujui\n` +
        `*2 ${ticketNumber} [alasan]* untuk menolak\n` +
        `*3 ${ticketNumber}* untuk bertanya kepada pengaju`
      );
      return;
    }

    if (action === '1') {
      // Handle approval
      const updates = {
        status: 'PENDING_PROCESS',
        approvalSekdep: 'APPROVED',
        lastUpdated: getWIBTimestamp()
      };
      
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      await msg.reply(`✅ Anda telah menyetujui permintaan *${ticketNumber}*`);
      
      // Notify Bendahara
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterApproved(
        ticketNumber, 
        `${ticketData.goodsName} (${ticketData.quantity})`, 
        ticketData.senderNumber, 
        reason
      );
      await notifyBendaharaForProcessing(ticketNumber, ticketData);
      
    } else if (action === '2') {
      // Handle rejection
      if (!reason) {
        userStates[senderNumber] = { step: 'waitingForRejectionReason', ticketNumber };
        await msg.reply(`Silakan berikan alasan penolakan untuk tiket *${ticketNumber}*:`);
        return;
      }
      
      const updates = {
        status: 'REJECTED',
        approvalSekdep: 'REJECTED',
        reasonSekdep: reason,
        lastUpdated: getWIBTimestamp()
      };
      
      await sheetsOperations.updateTicketStatus(ticketNumber, updates);
      await msg.reply(`❌ Anda telah menolak permintaan *${ticketNumber}* dengan alasan: ${reason}`);
      
      // Notify requester
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterRejected(
        ticketNumber, 
        `${ticketData.goodsName} (${ticketData.quantity})`, 
        ticketData.senderNumber, 
        reason
      );
    } else if (action === '3') {
      // Handle question to requester
      // Set state to waiting for question
      userStates[senderNumber] = { 
        step: 'waitingForQuestionToRequester', 
        ticketNumber,
        requesterNumber: ticketData.senderNumber,
        requesterName: ticketData.senderName,
        goodsName: ticketData.goodsName
      };
      
      await msg.reply(
        `Silakan kirimkan pertanyaan yang ingin Anda tanyakan kepada *${ticketData.senderName}* mengenai:\n\n` +
        `Tiket: *${ticketNumber}*\n` +
        `Barang: ${ticketData.goodsName}\n` +
        `Jumlah: ${ticketData.quantity}\n` +
        `Link: ${ticketData.link || '-'}\n` +
        `Keperluan: ${ticketData.reason}`
      );
      return;
    }
    return;
  }

  // Handle Sekdep's question input after selecting ticket
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForQuestionToRequester') {
    const question = messageBody;
    const { ticketNumber, requesterNumber, requesterName, goodsName } = userStates[senderNumber];
    
    // Send question to requester
    try {
      await sendQuestionToRequester(
        ticketNumber,
        goodsName,
        requesterNumber,
        requesterName,
        senderNumber,
        question
      );
      
      await msg.reply(`✅ Pertanyaan Anda telah dikirimkan kepada ${requesterName} (${requesterNumber})`);
    } catch (error) {
      console.error('Error sending question to requester:', error);
      await msg.reply(`❌ Gagal mengirimkan pertanyaan. Silakan coba lagi nanti.`);
    }
    
    delete userStates[senderNumber];
    return;
  }

  // Handle requester's reply after using /jawab command
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForReplyToSekdep') {
    const reply = messageBody;
    const { ticketNumber, sekdepNumber, goodsName } = userStates[senderNumber];
    
    try {
      // Get ticket data to include requester name in the reply
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      const requesterName = ticketData ? ticketData.senderName : senderNumber;
      
      // Send reply to Sekdep
      await sendReplyToSekdep(
        ticketNumber,
        goodsName,
        senderNumber,
        requesterName,
        sekdepNumber,
        reply
      );
      
      await msg.reply(`✅ Balasan Anda telah dikirimkan kepada Sekretaris Departemen`);
    } catch (error) {
      console.error('Error sending reply to Sekdep:', error);
      await msg.reply(`❌ Gagal mengirimkan balasan. Silakan coba lagi nanti.`);
    }
    
    delete userStates[senderNumber];
    return;
  }

  // Handle pengguna sedang menunggu alasan penolakan
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForRejectionReason') {
    const reason = messageBody;
    const ticketNumber = userStates[senderNumber].ticketNumber;
    
    const updates = {
      status: 'REJECTED',
      approvalSekdep: 'REJECTED',
      reasonSekdep: reason,
      lastUpdated: getWIBTimestamp()
    };
    
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    await msg.reply(`❌ Permintaan *${ticketNumber}* ditolak dengan alasan: ${reason}`);
    
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    await notifyRequesterRejected(
      ticketNumber, 
      `${ticketData.goodsName} (${ticketData.quantity})`, 
      ticketData.senderNumber, 
      reason
    );
    
    delete userStates[senderNumber];
    return;
  }

  // Handle input dari Bendahara
  if (senderNumber === process.env.BENDAHARA_NUMBER && /^\d+\s\d+/.test(messageBody)) {
    const parts = messageBody.split(' ');
    const statusCode = parts[0]; // 1, 2, atau 3
    const ticketNumber = parts[1];
    const reason = parts.slice(2).join(' ');

    // Cek apakah tiket ada
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    if (!ticketData) {
      await msg.reply(`❌ Tiket dengan nomor *${ticketNumber}* tidak ditemukan. Silakan periksa kembali nomor tiket.`);
      return;
    }

    // Cek apakah aksi valid (hanya 1, 2, atau 3)
    if (statusCode !== '1' && statusCode !== '2' && statusCode !== '3') {
      await msg.reply(
        `❌ Format tidak valid. Gunakan:\n` +
        `*1 ${ticketNumber}* untuk status belum diproses\n` +
        `*2 ${ticketNumber} [alasan]* untuk status sedang diproses\n` +
        `*3 ${ticketNumber} [alasan]* untuk status sudah diproses`
      );
      return;
    }

    // Determine status
    let status;
    switch (statusCode) {
      case '1': status = 'NOT_PROCESSED'; break;
      case '2': status = 'IN_PROGRESS'; break;
      case '3': status = 'PROCESSED'; break;
    }

    // Jika statusCode 2 atau 3 dan alasan tidak diberikan, minta alasan
    if ((statusCode === '2' || statusCode === '3') && !reason) {
      userStates[senderNumber] = { 
        step: 'waitingForBendaharaReason', 
        ticketNumber, 
        statusCode 
      };
      
      const actionText = statusCode === '2' ? 'sedang diproses' : 'sudah diproses';
      await msg.reply(`Silakan berikan alasan/keterangan untuk status ${actionText} pada tiket *${ticketNumber}*:`);
      return;
    }

    const defaultReason = statusCode === '1' ? 'Belum diproses' : 
                         statusCode === '2' ? 'Sedang diproses' : 'Sudah diproses';
    const finalReason = reason || defaultReason;

    // Update sheet
    const updates = {
      status: statusCode === '3' ? 'PROCESSED' : 'PENDING_PROCESS',
      statusBendahara: status,
      reasonBendahara: finalReason,
      lastUpdated: getWIBTimestamp()
    };
    
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    await msg.reply(`✅ Status permintaan *${ticketNumber}* diupdate menjadi: *${status}*\nAlasan: ${finalReason}`);
    
    if (status === 'PROCESSED') {
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterProcessed(
        ticketNumber,
        `${ticketData.goodsName} (${ticketData.quantity})`,
        ticketData.senderNumber,
        finalReason
      );
    }
    return;
  }

  // Handle pengguna sedang menunggu alasan dari Bendahara
  if (userStates[senderNumber] && userStates[senderNumber].step === 'waitingForBendaharaReason') {
    const reason = messageBody;
    const ticketNumber = userStates[senderNumber].ticketNumber;
    const statusCode = userStates[senderNumber].statusCode;
    
    let status;
    switch (statusCode) {
      case '1': status = 'NOT_PROCESSED'; break;
      case '2': status = 'IN_PROGRESS'; break;
      case '3': status = 'PROCESSED'; break;
    }
    
    const updates = {
      status: statusCode === '3' ? 'PROCESSED' : 'PENDING_PROCESS',
      statusBendahara: status,
      reasonBendahara: reason,
      lastUpdated: getWIBTimestamp()
    };
    
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    
    const statusText = statusCode === '1' ? 'belum diproses' : 
                      statusCode === '2' ? 'sedang diproses' : 'sudah diproses';
    
    await msg.reply(`✅ Status permintaan *${ticketNumber}* diupdate menjadi: *${statusText}*\nAlasan: ${reason}`);

    if (statusCode === '2') {
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterInProgress(
        ticketNumber,
        `${ticketData.goodsName} (${ticketData.quantity})`,
        ticketData.senderNumber,
        reason
      );
    }
    if (statusCode === '3') {
      const ticketData = await sheetsOperations.getTicketData(ticketNumber);
      await notifyRequesterProcessed(
        ticketNumber,
        `${ticketData.goodsName} (${ticketData.quantity})`,
        ticketData.senderNumber,
        reason
      );
    }
    
    delete userStates[senderNumber];
    return;
  }

  if (messageBody.startsWith(COMMANDS.HELP)) {
    await handleHelpCommand(sock, msg);
    return;
  }

  if (/^\d+$/.test(messageBody)) {
    await handleTicketCheck(sock, msg, messageBody);
    return;
  }

  // Jika pesan tidak dikenali
  await msg.reply(
    '⚠️ *Pesan tidak dikenali*\n\n' +
    'Silakan ketik */help* untuk informasi lebih lanjut.'
  );
}


// Fungsi untuk mendapatkan timestamp dalam format WIB (UTC+7)
function getWIBTimestamp() {
  // Get current UTC time
  const now = new Date();
  
  // Format the date to ISO string but set the timezone to UTC+7 explicitly
  // This ensures the date is interpreted correctly as WIB
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  
  // Calculate hours in UTC+7
  let hours = now.getUTCHours() + 7;
  let dayAdjustment = 0;
  
  // Handle day rollover if hours go over 23
  if (hours >= 24) {
    hours -= 24;
    dayAdjustment = 1;
  }
  
  const adjustedDay = String(parseInt(day) + dayAdjustment).padStart(2, '0');
  const hoursStr = String(hours).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  const seconds = String(now.getUTCSeconds()).padStart(2, '0');
  const milliseconds = String(now.getUTCMilliseconds()).padStart(3, '0');
  
  // Create a proper ISO string with Jakarta timezone info
  return `${year}-${month}-${adjustedDay}T${hoursStr}:${minutes}:${seconds}.${milliseconds}+07:00`;
}


function formatDateToIndonesian(dateString) {
  // Parse the ISO date string
  const date = new Date(dateString);
  
  // Format using Intl.DateTimeFormat for Indonesian locale
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

// This function handles the initial command from Sekdep to initiate a question
async function handleSekdepQuestionCommand(sock, msg, ticketNumber) {
  const senderNumber = msg.from.split('@')[0];
  
  // Fetch ticket data to get requester information
  const ticketData = await sheetsOperations.getTicketData(ticketNumber);
  if (!ticketData) {
    await msg.reply(`❌ Tiket dengan nomor *${ticketNumber}* tidak ditemukan.`);
    return;
  }
  
  // Set state for Sekdep to capture their question
  userStates[senderNumber] = { 
    step: 'waitingForQuestionToRequester', 
    ticketNumber,
    requesterNumber: ticketData.senderNumber,
    requesterName: ticketData.senderName,
    goodsName: ticketData.goodsName
  };
  
  await msg.reply(
    `Silakan kirimkan pertanyaan yang ingin Anda tanyakan kepada *${ticketData.senderName}* mengenai:\n\n` +
    `Tiket: *${ticketNumber}*\n` +
    `Barang: ${ticketData.goodsName}\n` +
    `Jumlah: ${ticketData.quantity}\n` +
    `Link: ${ticketData.link || '-'}\n` +
    `Keperluan: ${ticketData.reason}`
  );
}

// Function to send question from Sekdep to the requester
async function sendQuestionToRequester(ticketNumber, goodsName, requesterNumber, requesterName, sekdepNumber, question) {
  try {
    const notificationMessage = 
      `❓ *PERTANYAAN DARI SEKRETARIS DEPARTEMEN*\n\n` +
      `Nomor Tiket: *${ticketNumber}*\n` +
      `Barang: ${goodsName}\n\n` +
      `Pertanyaan:\n"${question}"\n\n` +
      `Untuk membalas, ketik *${COMMANDS.REPLY}*`;

    const botModule = require('./bot');
    await botModule.sendMessage(`${requesterNumber}@s.whatsapp.net`, notificationMessage);
    
    // Set user state for the requester
    userStates[requesterNumber] = {
      step: 'pendingReplyToSekdep',
      ticketNumber: ticketNumber,
      sekdepNumber: sekdepNumber,
      goodsName: goodsName
    };
    
    console.log(`Question sent to requester: ${requesterNumber}`);
    return true;
  } catch (error) {
    console.error('Error sending question to requester:', error);
    return false;
  }
}

// Function to handle the reply command from requester
async function handleReplyToSekdep(sock, msg) {
  const senderNumber = msg.from.split('@')[0];
  
  // Check if user has a pending question to reply to
  if (!userStates[senderNumber] || userStates[senderNumber].step !== 'pendingReplyToSekdep') {
    await msg.reply('⚠️ Tidak ada pertanyaan yang perlu dijawab saat ini.');
    return;
  }
  
  // Set state to waiting for reply
  userStates[senderNumber] = { 
    ...userStates[senderNumber],
    step: 'waitingForReplyToSekdep'
  };
  
  await msg.reply(
    `Silakan kirimkan balasan Anda untuk Sekretaris Departemen terkait permintaan barang *${userStates[senderNumber].goodsName}* (Tiket: *${userStates[senderNumber].ticketNumber}*):`
  );
}

// Function to send reply from requester back to Sekdep
async function sendReplyToSekdep(ticketNumber, goodsName, requesterNumber, requesterName, sekdepNumber, reply) {
  try {
    const notificationMessage = 
      `✉️ *BALASAN DARI PENGAJU PERMINTAAN*\n\n` +
      `Nomor Tiket: *${ticketNumber}*\n` +
      `Barang: ${goodsName}\n` +
      `Dari: ${requesterName} (${requesterNumber})\n\n` +
      `Balasan:\n"${reply}"\n\n` +
      `Untuk menanyakan hal lain, gunakan perintah:\n` +
      `*3 ${ticketNumber}*`;

    const botModule = require('./bot');
    await botModule.sendMessage(`${sekdepNumber}@s.whatsapp.net`, notificationMessage);
    
    console.log(`Reply sent to Sekdep: ${sekdepNumber}`);
    return true;
  } catch (error) {
    console.error('Error sending reply to Sekdep:', error);
    return false;
  }
}

async function handleTicketCheck(sock, msg, ticketNumber) {
  try {
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      await msg.reply(`❌ Tiket *${ticketNumber}* tidak ditemukan. Periksa kembali nomor tiket Anda.`);
      return;
    }
    
    let statusMessage = `📋 *Status Tiket: ${ticketNumber}*\n\n`;
    
    statusMessage += `Pemohon: ${ticketData.senderName}\n`;
    statusMessage += `Permintaan: ${ticketData.goodsName}\n`;
    statusMessage += `Jumlah: ${ticketData.quantity}\n`;
    if (ticketData.link) statusMessage += `Link: ${ticketData.link}\n`;
    statusMessage += `Keperluan: ${ticketData.reason}\n`;
    statusMessage += `Waktu pengajuan: ${formatDateToIndonesian(ticketData.timestamp)}\n\n`;
    
    // Status gabungan yang lebih jelas
    if (ticketData.status === 'PENDING_APPROVAL') {
      statusMessage += '⏳ *Status: Menunggu persetujuan Sekretaris Departemen*';
    } 
    else if (ticketData.status === 'REJECTED') {
      statusMessage += `❌ *Status: Ditolak oleh Sekretaris Departemen*\n`;
      statusMessage += `Alasan: ${ticketData.reasonSekdep || 'Tidak ada alasan yang diberikan'}`;
    }
    else if (ticketData.status === 'PENDING_PROCESS' || ticketData.status === 'PROCESSED') {
      // Tampilkan status dari bendahara jika sudah disetujui oleh Sekdep
      if (ticketData.statusBendahara === 'NOT_PROCESSED') {
        statusMessage += '✅ *Status: Disetujui oleh Sekdep, namun belum diproses oleh Bendahara*';
      } 
      else if (ticketData.statusBendahara === 'IN_PROGRESS') {
        statusMessage += '🔄 *Status: Sedang diproses oleh Bendahara*';
        if (ticketData.reasonBendahara) {
          statusMessage += `\nKeterangan: ${ticketData.reasonBendahara}`;
        }
      }
      else if (ticketData.statusBendahara === 'PROCESSED') {
        statusMessage += '✅ *Status: Selesai diproses oleh Bendahara*';
        if (ticketData.reasonBendahara) {
          statusMessage += `\nKeterangan: ${ticketData.reasonBendahara}`;
        }
      }
    }
    else {
      statusMessage += '❓ *Status: Tidak diketahui*';
    }
    
    await msg.reply(statusMessage);
    
  } catch (error) {
    console.error('Error handling ticket check:', error);
    await msg.reply('Terjadi kesalahan saat memeriksa status tiket. Silakan coba lagi nanti.');
  }
}

// Handle help command
async function handleHelpCommand(sock, msg) {
  const helpMessage = 
    `🔹 *PANDUAN PENGGUNAAN BOT PENGADAAN BARANG* 🔹\n\n` +
    `Berikut adalah perintah-perintah yang tersedia:\n\n` +
    `1️⃣ *${COMMANDS.REQUEST}*\n` +
    `   Untuk mengajukan permintaan pengadaan barang\n` +
    `   Format:\n` +
    `   Nama Lengkap: [isi nama lengkap]\n` +
    `   Nama Barang: [isi nama barang]\n` +
    `   Jumlah: [isi jumlah barang]\n` +
    `   Link: [isi link barang]\n` +
    `   Alasan: [isi alasan permintaan]\n\n` +
    `2️⃣ *[nomor_tiket]*\n` +
    `   Untuk memeriksa status permintaan, cukup ketikkan nomor tiket\n` +
    `   Contoh: 123\n\n` +
    `3️⃣ *${COMMANDS.REPLY}*\n` +
    `   Untuk membalas pertanyaan dari Sekretaris Departemen\n\n` +
    `4️⃣ *${COMMANDS.HELP}*\n` +
    `   Untuk menampilkan panduan ini\n\n` +
    (msg.from.split('@')[0] === process.env.SEKDEP_NUMBER ? 
    `\n*KHUSUS SEKRETARIS DEPARTEMEN:*\n` +
    `5️⃣ *3 [nomor_tiket]*\n` +
    `   Untuk mengirim pertanyaan kepada pengaju permintaan\n` +
    `   Contoh: 3 123\n` : '');
    `ℹ️ Setelah mengajukan permintaan, Anda akan menerima nomor tiket yang dapat digunakan untuk memeriksa status permintaan.`;
    
  await msg.reply(helpMessage);
}

// Function to notify Sekdep about new requests
async function notifySekdep(ticketNumber, goodsName, quantity, reason, link, requesterNumber, requesterName) {
  const sekdepNumber = process.env.SEKDEP_NUMBER;
  if (!sekdepNumber) return;

  const notificationMessage = 
    `🔔 *PERMINTAAN BARU*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Dari: ${requesterName} (${requesterNumber})\n` +
    `Permintaan: ${goodsName}\n` +
    `Jumlah: ${quantity}\n` +
    `Link: ${link}\n` +
    `Keperluan: ${reason}\n\n` +
    `Permintaan ini memerlukan persetujuan Sekretaris Departemen terlebih dahulu.\n\n` +
    `Link spreadsheet: https://docs.google.com/spreadsheets/d/1wh3MvjfAFeOGAp3UiMNjI5Ao3rHtuCHAS-ymd2M1dA4/edit?usp=sharing\n\n` +
    `Balas dengan:\n` +
    `*1 ${ticketNumber}* untuk menyetujui\n` +
    `*2 ${ticketNumber} [alasan]* untuk menolak\n\n` +
    `*3 ${ticketNumber}* untuk bertanya kepada user\n\n` +
    `Contoh:\n` +
    `*2 ${ticketNumber} tidak sesuai kebutuhan*`;

  const botModule = require('./bot');
  await botModule.sendMessage(sekdepNumber, notificationMessage);
  userStates[sekdepNumber] = { ticketNumber };
}

async function notifyBendahara(ticketNumber, goodsName, quantity, reason, link, requesterNumber, requesterName) {
  const bendaharaNumber = process.env.BENDAHARA_NUMBER;
  if (!bendaharaNumber) {
    console.error('Nomor Bendahara tidak dikonfigurasi di .env');
    return;
  }

  const notificationMessage = 
    `🔔 *NOTIFIKASI PERMINTAAN BARU*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Dari: ${requesterName} (${requesterNumber})\n` +
    `Permintaan: ${goodsName}\n` +
    `Jumlah: ${quantity}\n` +
    `Link: ${link}\n` +
    `Keperluan: ${reason}\n\n` +
    `Permintaan ini memerlukan persetujuan Sekretaris Departemen terlebih dahulu.\n\n` +
    `Link spreadsheet: https://docs.google.com/spreadsheets/d/1wh3MvjfAFeOGAp3UiMNjI5Ao3rHtuCHAS-ymd2M1dA4/edit?usp=sharing`;

  // Use the bot module to send message
  const botModule = require('./bot');
  await botModule.sendMessage(bendaharaNumber, notificationMessage);
}

// Updated notification function for Bendahara
async function notifyBendaharaForProcessing(ticketNumber, ticketData) {
  const bendaharaNumber = process.env.BENDAHARA_NUMBER;
  if (!bendaharaNumber) return;

  const notificationMessage = 
    `🔔 *PERMINTAAN UNTUK DIPROSES*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Dari: ${ticketData.senderName} (${ticketData.senderNumber})\n` +
    `Permintaan: ${ticketData.goodsName}\n` +
    `Jumlah: ${ticketData.quantity}\n` +
    `Link: ${ticketData.link || '-'}\n` +
    `Keperluan: ${ticketData.reason}\n\n` +
    `Balas dengan:\n\n` +
    `*1 ${ticketNumber}* (belum diproses)\n` +
    `*2 ${ticketNumber} [alasan]* (sedang diproses)\n` +
    `*3 ${ticketNumber} [alasan]* (sudah diproses)\n\n` +
    `Contoh:\n` +
    `*2 ${ticketNumber} sedang dicari vendor terbaik*`;

  const botModule = require('./bot');
  await botModule.sendMessage(bendaharaNumber, notificationMessage);
  userStates[bendaharaNumber] = { ticketNumber };
}

// Function to notify requester about approved request
async function notifyRequesterApproved(ticketNumber, requestData, requesterNumber) {
  const notificationMessage = 
    `✅ *PERMINTAAN ANDA DISETUJUI*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Permintaan Anda telah disetujui oleh Sekretaris Departemen.\n` +
    `Permintaan Anda akan segera diproses oleh Bendahara.`;

  // Use the bot module to send message
  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}

// Function to notify requester about rejected request
async function notifyRequesterRejected(ticketNumber, requestData, requesterNumber, reason) {
  const notificationMessage = 
    `❌ *PERMINTAAN ANDA DITOLAK*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Permintaan Anda ditolak oleh Sekretaris Departemen dengan alasan:\n` +
    `"${reason}"\n\n` +
    `Jika ada pertanyaan, silakan hubungi Sekretaris Departemen untuk informasi lebih lanjut.`;

  // Use the bot module to send message
  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}

async function notifyRequesterInProgress(ticketNumber, requestData, requesterNumber, reason) {
  const notificationMessage = 
    `✅ *PERMINTAAN ANDA SEDANG DIPROSES BENDAHARA*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Status: Sedang diproses\n` +
    `Keterangan: ${reason}`;

  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}
async function notifyRequesterProcessed(ticketNumber, requestData, requesterNumber, reason) {
  const notificationMessage = 
    `✅ *PERMINTAAN ANDA SELESAI DIPROSES BENDAHARA*\n\n` +
    `Nomor Tiket: *${ticketNumber}*\n` +
    `Permintaan: ${requestData}\n\n` +
    `Status: Sudah diproses\n` +
    `Keterangan: ${reason}`;

  const botModule = require('./bot');
  await botModule.sendMessage(requesterNumber, notificationMessage);
}

module.exports = {
  handleMessage,
  notifyBendaharaForProcessing
};
