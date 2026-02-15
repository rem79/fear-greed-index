const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('Launching browser to capture CNN Fear & Greed index...');
        browser = await chromium.launch();
        const page = await browser.newPage();

        // Mobile viewport helps capture a cleaner, more focused gauge
        await page.setViewportSize({ width: 375, height: 812 });

        await page.goto('https://www.cnn.com/markets/fear-and-greed', { waitUntil: 'networkidle' });

        // Wait for the gauge to element to be visible
        const selector = '.fear-and-greed-meter__container';
        await page.waitForSelector(selector);

        // Get the score text for data.json
        const scoreElement = await page.$('.fear-and-greed-meter__value');
        const scoreText = await scoreElement.innerText();
        const score = parseFloat(scoreText) || 36;

        const ratingElement = await page.$('.fear-and-greed-meter__rating');
        const rating = await ratingElement.innerText();

        // Capture screenshot of just the gauge
        const element = await page.$(selector);
        await element.screenshot({ path: 'cnn-gauge.png' });
        console.log('Screenshot saved as cnn-gauge.png');

        const output = {
            stock: {
                score: score,
                rating: rating.toLowerCase().trim(),
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('data.json updated.');

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();

