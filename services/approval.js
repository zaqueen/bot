const sheetsOperations = require('../modules/sheets/operations');
const mqttClient = require('../modules/mqtt/client');

// Process approval from sekdep
async function processSekdepApproval(ticketNumber, approved, reason = null) {
  try {
    // Get current ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      console.error(`Tiket tidak ditemukan: ${ticketNumber}`);
      return {
        success: false,
        message: `Tiket ${ticketNumber} tidak ditemukan`
      };
    }
    
    // Check if ticket is in the correct state
    if (ticketData.status !== 'PENDING_APPROVAL_1') {
      console.error(`Status tiket tidak valid untuk persetujuan sekdep: ${ticketData.status}`);
      return {
        success: false,
        message: `Tiket ini tidak sedang menunggu persetujuan sekdep. Status saat ini: ${ticketData.status}`
      };
    }
    
    // Prepare updates
    const updates = {
      approvalSekdep: approved ? 'APPROVED' : 'REJECTED',
      status: approved ? 'PENDING_APPROVAL_2' : 'REJECTED_1'
    };
    
    // Add reason if provided
    if (reason) {
      updates.reasonSekdep = reason;
    }
    
    // Update ticket in Google Sheets
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    

    
    return {
      success: true,
      message: `Tiket ${ticketNumber} telah ${approved ? 'disetujui' : 'ditolak'} oleh sekdep`
    };
  } catch (error) {
    console.error('Gagal memproses persetujuan sekdep:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat memproses persetujuan'
    };
  }
}

// Process approval from Bendahara
async function processBendaharaApproval(ticketNumber, approved, reason = null) {
  try {
    // Get current ticket data
    const ticketData = await sheetsOperations.getTicketData(ticketNumber);
    
    if (!ticketData) {
      console.error(`Tiket tidak ditemukan: ${ticketNumber}`);
      return {
        success: false,
        message: `Tiket ${ticketNumber} tidak ditemukan`
      };
    }
    
    // Check if ticket is in the correct state
    if (ticketData.status !== 'PENDING_APPROVAL_2') {
      console.error(`Status tiket tidak valid untuk persetujuan Bendahara: ${ticketData.status}`);
      return {
        success: false,
        message: `Tiket ini tidak sedang menunggu persetujuan Bendahara. Status saat ini: ${ticketData.status}`
      };
    }
    
    // Prepare updates
    const updates = {
      statusBendahara: approved ? 'APPROVED' : 'REJECTED',
      status: approved ? 'APPROVED' : 'REJECTED_2'
    };
    
    // Add reason if provided
    if (reason) {
      updates.reasonBendahara = reason;
    }
    
    // Update ticket in Google Sheets
    await sheetsOperations.updateTicketStatus(ticketNumber, updates);
    

    
    return {
      success: true,
      message: `Tiket ${ticketNumber} telah ${approved ? 'disetujui' : 'ditolak'} oleh Bendahara`
    };
  } catch (error) {
    console.error('Gagal memproses persetujuan Bendahara:', error);
    return {
      success: false,
      message: 'Terjadi kesalahan saat memproses persetujuan'
    };
  }
}

module.exports = {
  processSekdepApproval,
  processBendaharaApproval
};