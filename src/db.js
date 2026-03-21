// db.js - Fetches your settings directly from Glide Tables API
const axios = require('axios');

const GLIDE_API_TOKEN = "YOUR_GLIDE_TOKEN_HERE";
const APP_ID = "YOUR_APP_ID_HERE";
const TABLE_ID = "native-table-XXXXX"; // Your Device Table ID

async function getAllDevicesFromDB() {
    try {
        const response = await axios.post(
            `https://api.glideapp.io/api/function/queryTables`,
            {
                appID: APP_ID,
                queries: [
                    {
                        tableName: TABLE_ID,
                        utc: true
                    }
                ]
            },
            {
                headers: {
                    'Authorization': `Bearer ${GLIDE_API_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // Glide returns an array of rows. We return them so server.js can use them.
        return response.data[0].rows; 
    } catch (error) {
        console.error("❌ Glide API Error:", error.response ? error.response.data : error.message);
        return [];
    }
}

module.exports = { getAllDevicesFromDB };