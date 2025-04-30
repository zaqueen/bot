const mqtt = require('mqtt');
const dotenv = require('dotenv');
const mqttHandlers = require('./handlers');

dotenv.config();

let client;
const options = {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clean: true
};

// Connect to MQTT broker
function connect() {
  try {
    client = mqtt.connect(process.env.MQTT_BROKER, options);
    
    client.on('connect', () => {
      console.log('Terhubung ke MQTT broker:', process.env.MQTT_BROKER);
      
      // Subscribe to topics
      const topics = [
        process.env.MQTT_TOPIC_REQUEST,
        process.env.MQTT_TOPIC_NOTIFICATION
      ];
      
      topics.forEach(topic => {
        client.subscribe(topic, (err) => {
          if (err) {
            console.error(`Gagal subscribe ke ${topic}:`, err);
          } else {
            console.log(`Berhasil subscribe ke ${topic}`);
          }
        });
      });
    });
    
    client.on('message', (topic, message) => {
      mqttHandlers.handleMessage(topic, message);
    });
    
    client.on('error', (error) => {
      console.error('MQTT Error:', error);
    });
    
    client.on('close', () => {
      console.log('Koneksi MQTT ditutup');
    });
    
    return client;
  } catch (error) {
    console.error('Gagal terhubung ke MQTT broker:', error);
    throw error;
  }
}

// Publish request to MQTT
function publishRequest(requestData) {
  if (!client || !client.connected) {
    console.error('MQTT client tidak terhubung');
    return false;
  }
  
  try {
    client.publish(
      process.env.MQTT_TOPIC_REQUEST,
      JSON.stringify(requestData),
      { qos: 1, retain: false }
    );
    
    console.log('Permintaan dipublikasikan ke MQTT:', requestData.ticketNumber);
    return true;
  } catch (error) {
    console.error('Gagal mempublikasikan permintaan ke MQTT:', error);
    return false;
  }
}



// Disconnect from MQTT broker
function disconnect() {
  if (client && client.connected) {
    client.end();
    console.log('Disconnected from MQTT broker');
  }
}

module.exports = {
  connect,
  publishRequest,

  disconnect
};