const https = require('https');
const fs = require('fs');

const CNN_URL = 'https://www.cnn.com/markets/fear-and-greed';

function fetchData() {
    return new Promise((resolve, reject) => {
        const options = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
            }
        };

        https.get(CNN_URL, options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', (err) => reject(err));
    });
}

async function run() {
    try {
        console.log('Fetching data from CNN...');
        const html = await fetchData();
        
        // Regex to find "rating":"...", "score":...
        const scoreMatch = html.match(/"score":(\d+\.?\d*)/);
        const ratingMatch = html.match(/"rating":"(\w+)"/);
        
        const stockScore = scoreMatch ? parseFloat(scoreMatch[1]) : 36;
        const stockRating = ratingMatch ? ratingMatch[1] : 'unknown';

        console.log(`Stock Score Found: ${stockScore} (${stockRating})`);

        const output = {
            stock: {
                score: stockScore,
                rating: stockRating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('data.json has been updated successfully.');

    } catch (error) {
        console.error('Error fetching or parsing data:', error);
        process.exit(1);
    }
}

run();
