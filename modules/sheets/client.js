const { GoogleSpreadsheet } = require('google-spreadsheet');
const dotenv = require('dotenv');
const { GoogleAuth } = require('google-auth-library');

dotenv.config();

let doc;

async function initialize() {
  try {
    doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID);
    
    const auth = new GoogleAuth({
        credentials: {
          client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });
    
      doc.auth = auth;
    
    await doc.loadInfo();
    console.log(`Terhubung ke Google Sheets: ${doc.title}`);
    
    await ensureRequiredSheets();
    
    return doc;
  } catch (error) {
    console.error('Gagal menginisialisasi Google Sheets:', error);
    throw error;
  }
}

async function ensureRequiredSheets() {
  try {
    let requestSheet = doc.sheetsByTitle['Requests'];
    
    if (!requestSheet) {
      console.log('Membuat sheet "Requests"...');
      requestSheet = await doc.addSheet({
        title: 'Requests',
        headerValues: [
          'ticketNumber',
          'timestamp',
          'senderNumber',
          'request',
          'status',
          'approvalKadep',
          'statusBendahara',
          'reasonKadep',
          'reasonBendahara',
          'lastUpdated'
        ]
      });
    }
    
    console.log('Sheet "Requests" tersedia');
    return true;
  } catch (error) {
    console.error('Gagal memastikan sheet tersedia:', error);
    throw error;
  }
}

function getDoc() {
  if (!doc) {
    throw new Error('Google Sheets belum diinisialisasi. Panggil initialize() terlebih dahulu.');
  }
  return doc;
}

module.exports = {
  initialize,
  getDoc
};