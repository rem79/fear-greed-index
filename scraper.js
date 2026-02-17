const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('브라우저 실행 중 (CNN 공포와 탐욕 지수 캡처)...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            viewport: { width: 400, height: 1000 }
        });
        const page = await context.newPage();

        console.log('CNN 마켓 페이지로 이동 중...');
        await page.goto('https://www.cnn.com/markets/fear-and-greed', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        // 1. 개인정보 동의(Cookie/Privacy) 팝업 제거
        console.log('개인정보 동의 팝업 확인 및 제거 중...');
        try {
            // "Agree" 또는 "Accept" 버튼 찾아서 클릭
            const agreeButton = await page.$('button#onetrust-accept-btn-handler') ||
                await page.$('button:has-text("Agree")') ||
                await page.$('button:has-text("Accept")');
            if (agreeButton) {
                await agreeButton.click();
                console.log('팝업 버튼 클릭 완료.');
                await page.waitForTimeout(2000); // 팝업이 사라질 때까지 대기
            }
        } catch (e) {
            console.log('팝업 제거 중 오류 발생 (무시하고 진행):', e.message);
        }

        // 2. 게이지 요소가 나타날 때까지 대기
        console.log('게이지 요소 대기 중...');
        const selectors = [
            '.fear-and-greed-meter__container',
            '.fear-and-greed-indicator',
            '[class*="fear-and-greed"]'
        ];

        let foundSelector = null;
        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 15000 });
                console.log(`요소 발견: ${selector}`);
                foundSelector = selector;
                break;
            } catch (e) { }
        }

        // 애니메이션 안정화를 위해 조금 더 대기
        await page.waitForTimeout(3000);

        // 3. 스크린샷 캡처
        const container = await page.$(foundSelector || 'body');
        if (container) {
            await container.screenshot({
                path: 'cnn-gauge.png',
                padding: 10
            });
            console.log('스크린샷 저장 완료: cnn-gauge.png');
        }

        // 4. 데이터 추출
        let score = 50;
        let rating = 'neutral';

        try {
            // 여러 Selector 시도
            const scoreElement = await page.$('.fear-and-greed-meter__value') ||
                await page.$('[class*="meter__value"]');
            const ratingElement = await page.$('.fear-and-greed-meter__rating') ||
                await page.$('[class*="meter__rating"]');

            if (scoreElement) {
                const scoreText = await scoreElement.innerText();
                const cleanScore = scoreText.replace(/[^0-9]/g, '');
                if (cleanScore) score = parseFloat(cleanScore);
            }
            if (ratingElement) {
                rating = (await ratingElement.innerText()).toLowerCase().trim();
            }

            // 만약 여전히 50(기본값)이라면 텍스트에서 강제로 찾기
            if (score === 50) {
                const bodyText = await page.innerText('body');
                const match = bodyText.match(/Fear & Greed Index.*?(\d+)/i) || bodyText.match(/Now: (\d+)/i);
                if (match) {
                    score = parseFloat(match[1]);
                    console.log('텍스트 검색으로 점수 발견:', score);
                }
            }

            console.log(`추출된 데이터: 점수 ${score}, 상태 ${rating}`);
        } catch (e) {
            console.log('데이터 추출 실패, 기본값 사용:', e.message);
        }

        const output = {
            stock: {
                score: score,
                rating: rating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('data.json 업데이트 완료.');

    } catch (error) {
        console.error('스크래핑 중 치명적 오류 발생:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();
