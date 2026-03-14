// db.js - Fetches your User/Device settings from Glide/Google Sheets
const axios = require('axios');

// Replace this with your Google Sheet JSON URL or Glide API URL
const DATA_SOURCE_URL = "YOUR_GLIDE_DATA_JSON_URL";

async function getAllDevicesFromDB() {
    try {
        const response = await axios.get(DATA_SOURCE_URL);
        // Assuming your data is an array of rows
        return response.data; 
    } catch (error) {
        console.error("❌ Error fetching database:", error.message);
        return [];
    }
}

module.exports = { getAllDevicesFromDB };