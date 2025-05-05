const sheetsOperations = require('../sheets/operations');

// Handle incoming MQTT messages
async function handleMessage(topic, message) {
  try {
    const data = JSON.parse(message.toString());
    console.log(`Pesan MQTT diterima dari topic ${topic}:`, data);
    
    if (topic === process.env.MQTT_TOPIC_REQUEST) {
      await handleRequestMessage(data);
    } else if (topic === process.env.MQTT_TOPIC_NOTIFICATION) {
      await handleNotificationMessage(data);
    }
  } catch (error) {
    console.error('Error handling MQTT message:', error);
  }
}

// Handle request messages
async function handleRequestMessage(data) {
  try {
    // Save request data to Google Sheets
    await sheetsOperations.addNewRequest(data);
    
    // Notify relevant parties
    if (data.status === 'PENDING_APPROVAL_1') {
      // New request - notify sekdep
      await notificationService.notifySekdep(data);
    }
  } catch (error) {
    console.error('Error handling request message:', error);
  }
}

// Handle notification messages
async function handleNotificationMessage(data) {
  try {
    switch (data.type) {
      case 'APPROVAL_1_UPDATED':
        // sekdep approval updated
        if (data.approved) {
          // sekdep approved - notify Bendahara
          await notificationService.notifyBendahara(data);
        } else {
          // sekdep rejected - notify requester
          await notificationService.notifyRequester(data);
        }
        break;
      
      case 'APPROVAL_2_UPDATED':
        // Bendahara approval updated - notify requester
        await notificationService.notifyRequester(data);
        break;
      
      default:
        console.log('Unknown notification type:', data.type);
    }
  } catch (error) {
    console.error('Error handling notification message:', error);
  }
}

module.exports = {
  handleMessage
};
