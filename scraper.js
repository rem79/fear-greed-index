const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('Launching browser to capture CNN Fear & Greed index...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 375, height: 1000 }
        });
        const page = await context.newPage();

        console.log('Navigating to CNN Markets...');
        await page.goto('https://www.cnn.com/markets/fear-and-greed', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        // Wait for any of the common selectors to appear
        console.log('Waiting for gauge elements...');
        let containerFound = false;
        const selectors = ['.fear-and-greed-meter__container', '.fear-and-greed-indicator', '[class*="fear-and-greed"]'];

        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 10000 });
                console.log(`Found selector: ${selector}`);
                containerFound = true;
                break;
            } catch (e) {
                console.log(`Selector ${selector} not found, trying next...`);
            }
        }

        // Add a small delay for animations to settle
        await page.waitForTimeout(5000);

        // Find the gauge container
        const container = await page.$('.fear-and-greed-meter__container') ||
            await page.$('.fear-and-greed-indicator') ||
            await page.$('[class*="fear-and-greed"]');

        if (container) {
            await container.screenshot({
                path: 'cnn-gauge.png',
                padding: 10
            });
            console.log('Screenshot saved as cnn-gauge.png');
        } else {
            console.log('Could not find a suitable container for screenshot. Taking full page screenshot as fallback...');
            await page.screenshot({ path: 'cnn-gauge.png' });
        }

        // Extract score/rating for data.json
        let score = 50;
        let rating = 'neutral';

        try {
            const scoreElement = await page.$('.fear-and-greed-meter__value');
            const ratingElement = await page.$('.fear-and-greed-meter__rating');

            if (scoreElement) {
                const scoreText = await scoreElement.innerText();
                score = parseFloat(scoreText) || 50;
            }
            if (ratingElement) {
                const ratingText = await ratingElement.innerText();
                rating = ratingText.toLowerCase().trim();
            }
            console.log(`Extracted: ${score} (${rating})`);
        } catch (e) {
            console.log('Failed to extract data via specific selectors. Trying text content fallback...');
            const pageText = await page.innerText('body');
            const match = pageText.match(/Fear & Greed Index.*?(\d+)/i);
            if (match) {
                score = parseFloat(match[1]);
                console.log('Found score in text content:', score);
            }
        }

        const output = {
            stock: {
                score: score,
                rating: rating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('data.json updated successfully.');

    } catch (error) {
        console.error('Error during scraping:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();
