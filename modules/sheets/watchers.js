const sheetsClient = require('./client');

async function initialize() {
  try {
    console.log('Initializing Google Sheets watcher...');
    await startPolling();
    
    console.log('Google Sheets watcher initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Google Sheets watcher:', error);
    throw error;
  }
}

async function startPolling() {
  try {
    console.log('Starting sheet polling...');
    
    let lastCheckTime = new Date();
    setInterval(async () => {
      try {
        await checkForChanges(lastCheckTime);
        lastCheckTime = new Date();
      } catch (error) {
        console.error('Error during sheet polling:', error);
      }
    }, 60000); 
    
    console.log('Sheet polling started');
  } catch (error) {
    console.error('Failed to start sheet polling:', error);
    throw error;
  }
}

async function checkForChanges(lastCheckTime) {
  try {
    const doc = sheetsClient.getDoc();
    const sheet = doc.sheetsByTitle['Requests'];
    
    await sheet.loadCells();
    const rows = await sheet.getRows();
    
    for (const row of rows) {
      const lastUpdated = new Date(row.lastUpdated);
      
      if (lastUpdated <= lastCheckTime) {
        continue;
      }
      
      console.log(`Found updated row: ${row.ticketNumber}, status: ${row.status}`);
      
      await processUpdatedRow(row);
    }
  } catch (error) {
    console.error('Error checking for sheet changes:', error);
    throw error;
  }
}

async function processUpdatedRow(row) {
  try {
    switch (row.status) {
      case 'PENDING_APPROVAL_1':
        if (row.kadepNotified !== 'YES') {

          row.kadepNotified = 'YES';
          await row.save();
        }
        break;
      
      case 'PENDING_APPROVAL_2':
        if (row.bendaharaNotified !== 'YES') {

          
          row.bendaharaNotified = 'YES';
          await row.save();
        }
        break;
      
      case 'APPROVED':
      case 'REJECTED_1':
      case 'REJECTED_2':
        if (row.requesterNotified !== 'YES') {

          
          row.requesterNotified = 'YES';
          await row.save();
        }
        break;
    }
  } catch (error) {
    console.error(`Error processing updated row for ticket ${row.ticketNumber}:`, error);
  }
}

module.exports = {
  initialize
};
