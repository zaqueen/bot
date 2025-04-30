// Generate a unique ticket number
function generateTicket() {

    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    
    // Combine timestamp and random number for uniqueness
    const ticketNumber = `${timestamp % 10000}${random}`;
    
    return ticketNumber;
  }
  
  // Validate a ticket number format
  function isValidTicket(ticketNumber) {
    const ticketRegex = /^\d+$/;
    return ticketRegex.test(ticketNumber);
  }
  
  module.exports = {
    generateTicket,
    isValidTicket
  };