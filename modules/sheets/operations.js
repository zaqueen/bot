const sheetsClient = require('./client');
const mqttClient = require('../mqtt/client');

async function addNewRequest(requestData) {
  try {
    const doc = sheetsClient.getDoc();
    const sheet = doc.sheetsByTitle['Requests'];
    
    const rowData = {
      ticketNumber: requestData.ticketNumber,
      timestamp: requestData.timestamp,
      senderNumber: requestData.senderNumber,
      senderName: requestData.senderName,
      goodsName: requestData.goodsName,
      quantity: requestData.quantity,
      link: requestData.link,
      reason: requestData.reason,
      status: requestData.status,
      approvalSekdep: requestData.approvalSekdep || '',
      statusBendahara: requestData.statusBendahara || '',
      reasonSekdep: requestData.reasonSekdep || '',
      reasonBendahara: requestData.reasonBendahara || '',
      lastUpdated: new Date().toISOString()
    };
    
    await sheet.addRow(rowData);
    console.log('Permintaan baru ditambahkan ke Google Sheets:', requestData.ticketNumber);
    
    return true;
  } catch (error) {
    console.error('Gagal menambahkan permintaan ke Google Sheets:', error);
    throw error;
  }
}

async function getTicketData(ticketNumber) {
  try {
    console.log(`Searching for ticket: "${ticketNumber}"`);
    
    const doc = sheetsClient.getDoc();
    const sheet = doc.sheetsByTitle['Requests'];
    
    await sheet.loadCells();
    const rows = await sheet.getRows();
    
    console.log(`Found ${rows.length} rows in sheet`);
    
    const ticketRow = rows.find(row => {
      const rowTicketNumber = row.get('ticketNumber') || row._rawData[0];
      return String(rowTicketNumber).trim().toLowerCase() === String(ticketNumber).trim().toLowerCase();
    });
    
    console.log(`Ticket match found: ${ticketRow ? 'Yes' : 'No'}`);
    
    if (!ticketRow) {
      return null;
    }
    
    return {
      ticketNumber: ticketRow.get('ticketNumber') || ticketRow._rawData[0],
      timestamp: ticketRow.get('timestamp') || ticketRow._rawData[1],
      senderNumber: ticketRow.get('senderNumber') || ticketRow._rawData[2],
      senderName: ticketRow.get('senderName') || ticketRow._rawData[3],
      goodsName: ticketRow.get('goodsName') || ticketRow._rawData[4],
      quantity: ticketRow.get('quantity') || ticketRow._rawData[5],
      link: ticketRow.get('link') || ticketRow._rawData[6],
      reason: ticketRow.get('reason') || ticketRow._rawData[7],
      status: ticketRow.get('status') || ticketRow._rawData[8],
      approvalSekdep: ticketRow.get('approvalSekdep') || ticketRow._rawData[9],
      statusBendahara: ticketRow.get('statusBendahara') || ticketRow._rawData[10],
      reasonSekdep: ticketRow.get('reasonSekdep') || ticketRow._rawData[11],
      reasonBendahara: ticketRow.get('reasonBendahara') || ticketRow._rawData[12],
      lastUpdated: ticketRow.get('lastUpdated') || ticketRow._rawData[13]
    };
  } catch (error) {
    console.error('Gagal mendapatkan data tiket dari Google Sheets:', error);
    console.error(error.stack);
    throw error;
  }
}

async function updateTicketStatus(ticketNumber, updates) {
  try {
    const doc = sheetsClient.getDoc();
    const sheet = doc.sheetsByTitle['Requests'];
    
    await sheet.loadCells();
    const rows = await sheet.getRows();
    
    const ticketRowIndex = rows.findIndex(row => {
      const rowTicketNumber = row.get('ticketNumber') || row._rawData[0];
      return String(rowTicketNumber).trim().toLowerCase() === String(ticketNumber).trim().toLowerCase();
    });

    if (ticketRowIndex === -1) {
      console.error(`Tiket tidak ditemukan: ${ticketNumber}`);
      return false;
    }
    
    const ticketRow = rows[ticketRowIndex];
    
    Object.keys(updates).forEach(key => {
      try {
        ticketRow.set(key, updates[key]);
      } catch(e) {
        console.error(`Error updating field ${key}:`, e);
      }
    });
    
    ticketRow.set('lastUpdated', new Date().toISOString());
    
    await ticketRow.save();
    
    console.log(`Status tiket diperbarui: ${ticketNumber}`);
    
    if (updates.status || updates.statusBendahara) {
      await handleStatusChange(ticketNumber, updates, {
        senderNumber: ticketRow.get('senderNumber') || ticketRow._rawData[2],
        goodsName: ticketRow.get('goodsName') || ticketRow._rawData[3],
        quantity: ticketRow.get('quantity') || ticketRow._rawData[4],
        link: ticketRow.get('link') || ticketRow._rawData[5],
        reason: ticketRow.get('reason') || ticketRow._rawData[6],
        reasonSekdep: ticketRow.get('reasonSekdep') || ticketRow._rawData[10],
        reasonBendahara: ticketRow.get('reasonBendahara') || ticketRow._rawData[11]
      });
    }
    
    return true;
  } catch (error) {
    console.error('Gagal memperbarui status tiket di Google Sheets:', error);
    throw error;
  }
}

async function handleStatusChange(ticketNumber, updates, ticketData) {
  try {
    let notificationType = null;
    let notificationData = {
      ticketNumber,
      goodsName: ticketData.goodsName,
      quantity: ticketData.quantity,
      link: ticketData.link,
      reason: ticketData.reason,
      senderNumber: ticketData.senderNumber
    };
    
    if (updates.status) {
      switch (updates.status) {
        case 'PENDING_PROCESS':
          notificationType = 'SEKDEP_APPROVED';
          break;
        
        case 'REJECTED':
          notificationType = 'SEKDEP_REJECTED';
          notificationData.reason = ticketData.reasonSekdep;
          break;
      }
    }
    
    if (updates.statusBendahara) {
      switch (updates.statusBendahara) {
        case 'PROCESSED':
          notificationType = 'BENDAHARA_PROCESSED';
          break;
      }
    }
    

  } catch (error) {
    console.error('Gagal menangani perubahan status:', error);
  }
}

async function setupChangeWatcher() {
  try {
    console.log('Setting up sheet change watcher...');
    
    let lastProcessedUpdate = new Date();
    
    setInterval(async () => {
      try {
        const doc = sheetsClient.getDoc();
        const sheet = doc.sheetsByTitle['Requests'];
        
        await sheet.getRows();
        
        const rows = await sheet.getRows();
        const updatedRows = rows.filter(row => {
          const lastUpdated = new Date(row.lastUpdated);
          return lastUpdated > lastProcessedUpdate && row.status !== 'PROCESSED';
        });
        
        if (updatedRows.length > 0) {
          console.log(`${updatedRows.length} rows updated since last check`);
          
          for (const row of updatedRows) {
            await processUpdatedRow(row);
          }
          
          lastProcessedUpdate = new Date();
        }
      } catch (error) {
        console.error('Error checking for sheet changes:', error);
      }
    }, 60000); 
    
    console.log('Sheet change watcher set up successfully');
  } catch (error) {
    console.error('Failed to set up sheet change watcher:', error);
    throw error;
  }
}

async function processUpdatedRow(row) {
  try {
    const status = row.get('status') || row._rawData[7];
    const statusBendahara = row.get('statusBendahara') || row._rawData[9];
    
    const notificationData = {
      ticketNumber: row.get('ticketNumber') || row._rawData[0],
      senderNumber: row.get('senderNumber') || row._rawData[2],
      goodsName: row.get('goodsName') || row._rawData[3],
      quantity: row.get('quantity') || row._rawData[4],
      link: row.get('link') || row._rawData[5],
      reason: row.get('reason') || row._rawData[6],
      reasonSekdep: row.get('reasonSekdep') || row._rawData[10],
      reasonBendahara: row.get('reasonBendahara') || row._rawData[11]
    };

    if (status === 'PENDING_PROCESS' && !row.sekdepNotified) {
      row.set('sekdepNotified', 'YES');
      await row.save();
    } 
    else if (status === 'REJECTED' && !row.rejectNotified) {
      notificationData.reason = row.get('reasonSekdep') || row._rawData[10];
      row.set('rejectNotified', 'YES');
      await row.save();
    }
    else if (statusBendahara === 'PROCESSED' && !row.processedNotified) {
      row.set('processedNotified', 'YES');
      await row.save();
    }
  } catch (error) {
    console.error(`Error processing updated row for ticket ${row.ticketNumber}:`, error);
  }
}

module.exports = {
  addNewRequest,
  getTicketData,
  updateTicketStatus,
  setupChangeWatcher
};
