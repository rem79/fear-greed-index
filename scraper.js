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

        // Wait for the gauge components to be ready
        await page.waitForSelector('.fear-and-greed-meter__container');

        // Find the parent container that includes the "Fear & Greed Index" title
        // Usually, this is a section tagged with a specific data attribute or a parent div
        const containerSelector = '.fear-and-greed-meter__container';

        // We'll zoom out slightly or adjust the clip to include the header "Fear & Greed Index"
        // To be safe and get exactly what was shown in the screenshot:
        const element = await page.$('.fear-and-greed-meter__container');

        // Let's take a slightly larger screenshot by targeting the section or a bounding box
        // CNN's structure often has the title just above the meter.
        // We will try to capture the component including the header.
        const indicator = await page.$('.fear-and-greed-indicator'); // Common parent for the whole module
        const captureElement = indicator ? indicator : element;

        await captureElement.screenshot({
            path: 'cnn-gauge.png',
            padding: 20 // Add some padding for a cleaner look
        });
        console.log('Screenshot saved as cnn-gauge.png');

        // Extract score/rating for data.json
        const scoreText = await page.innerText('.fear-and-greed-meter__value');
        const ratingText = await page.innerText('.fear-and-greed-meter__rating');

        const output = {
            stock: {
                score: parseFloat(scoreText) || 36,
                rating: ratingText.toLowerCase().trim(),
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

