const express = require('express');
const maxmind = require('maxmind');
const geoip = require('geoip-lite');
const axios = require('axios');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./db'); // Include the SQLite database
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

const maxmindDbPath = './GeoLite2-City.mmdb';
let maxmindLookup;

maxmind.open(maxmindDbPath)
    .then((lookup) => {
        maxmindLookup = lookup;
        console.log('MaxMind database loaded');
    })
    .catch((err) => {
        console.error('Error loading MaxMind database:', err);
    });

const fetchAdditionalData = async (ip) => {
    try {
        const response = await axios.get(`https://ipinfo.io/${ip}?token=${process.env.IPINFO_TOKEN}`);
        return response.data;
    } catch (error) {
        console.error(`Error fetching data for IP ${ip} from ipinfo.io:`, error);
        return null;
    }
};

const getGeoLocationFromDatabases = (ip) => {
    return new Promise((resolve, reject) => {
        db.get("SELECT * FROM ip_info WHERE ip = ?", [ip], (err, row) => {
            if (err) {
                console.error(`Error querying database for IP ${ip}:`, err);
                reject(err);
            } else if (row) {
                console.log(`Found IP ${ip} in local database:`, row);
                resolve(row);
            } else {
                const maxMindData = maxmindLookup.get(ip);
                const geoipData = geoip.lookup(ip);

                const city = maxMindData?.city?.names?.en || geoipData?.city || 'Unknown city';
                const region = maxMindData?.subdivisions?.[0]?.names?.en || geoipData?.region || 'Unknown region';
                const country = maxMindData?.country?.iso_code || geoipData?.country || 'Unknown country';

                console.log(`MaxMind/GeoIP lookup result for IP ${ip}:`, { city, region, country });
                resolve({ ip, city, region, country });
            }
        });
    });
};

const getGeoLocation = async (ip) => {
    const localData = await getGeoLocationFromDatabases(ip);

    if (localData.city !== 'Unknown city' && localData.region !== 'Unknown region' && localData.country !== 'Unknown country') {
        return localData;
    }

    const additionalData = await fetchAdditionalData(ip);

    const city = additionalData?.city || localData.city;
    const region = additionalData?.region || localData.region;
    const country = additionalData?.country || localData.country;

    console.log(`Final resolved data for IP ${ip}:`, { city, region, country });

    db.run("INSERT OR REPLACE INTO ip_info (ip, city, region, country) VALUES (?, ?, ?, ?)", [ip, city, region, country], (err) => {
        if (err) {
            console.error(`Error inserting data into database for IP ${ip}:`, err);
        } else {
            console.log(`Inserted/Updated data for IP ${ip} in local database`);
        }
    });

    return { ip, city, region, country };
};

app.post('/translate', async (req, res) => {
    const ipAddresses = req.body.ipAddresses;
    const translatedIPs = [];
    const batchSize = 100;

    try {
        for (let i = 0; i < ipAddresses.length; i += batchSize) {
            const batch = ipAddresses.slice(i, i + batchSize);
            const results = await Promise.all(batch.map(ip => getGeoLocation(ip)));
            translatedIPs.push(...results);
        }

        // Send the JSON response
        res.json(translatedIPs);
    } catch (error) {
        console.error('Translation failed:', error);
        res.status(500).json({ error: 'Translation failed' });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
