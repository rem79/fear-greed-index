const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('브라우저 실행 중...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        // 실제 브라우저처럼 보이도록 더 최신 User-Agent 사용
        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 900 }
        });
        const page = await context.newPage();

        console.log('CNN 페이지 접속 중...');
        await page.goto('https://www.cnn.com/markets/fear-and-greed', {
            waitUntil: 'domcontentloaded', // 우선 빠르게 접속
            timeout: 60000
        });

        // 1. 팝업창 처리 (클릭 및 삭제)
        console.log('팝업창 처리 시작...');
        await page.waitForTimeout(5000); // 팝업이 뜰 시간 확보

        try {
            // 버튼 텍스트로 찾아서 클릭 시도
            const agreeButton = page.locator('button:has-text("Agree"), button:has-text("Accept"), #onetrust-accept-btn-handler').first();
            if (await agreeButton.isVisible()) {
                await agreeButton.click();
                console.log('Agree 버튼 클릭 성공.');
            } else {
                console.log('Agree 버튼이 보이지 않음. 강제 제거 시도...');
            }
        } catch (e) {
            console.log('버튼 클릭 실패, 다음 단계 진행.');
        }

        // 2. 팝업창 및 배경 레이어 강제 숨기기 (이중 장치)
        await page.evaluate(() => {
            const popupSelectors = [
                '#onetrust-consent-sdk',
                '.onetrust-pc-dark-filter',
                '.ot-sdk-container',
                '[id^="onetrust-"]'
            ];
            popupSelectors.forEach(s => {
                const els = document.querySelectorAll(s);
                els.forEach(el => {
                    el.style.display = 'none';
                    el.style.opacity = '0';
                    el.style.pointerEvents = 'none';
                });
            });
        });

        // 3. 지수 데이터가 로드될 때까지 대기
        console.log('지수 데이터 로드 대기 중...');
        await page.waitForSelector('.fear-and-greed-meter__value', { timeout: 30000 }).catch(() => {
            console.log('지수 요소를 찾는 데 시간이 너무 오래 걸립니다.');
        });

        await page.waitForTimeout(5000); // 애니메이션 완료 대기

        // 4. 데이터 추출
        const data = await page.evaluate(() => {
            const valEl = document.querySelector('.fear-and-greed-meter__value');
            const ratEl = document.querySelector('.fear-and-greed-meter__rating');

            let s = null;
            if (valEl) {
                const match = valEl.innerText.match(/\d+/);
                if (match) s = parseInt(match[0]);
            }

            // 만약 못 찾았다면 전체 텍스트에서 검색
            if (s === null) {
                const fullText = document.body.innerText;
                const match = fullText.match(/Now: (\d+)/i) || fullText.match(/Fear & Greed Index.*?(\d+)/i);
                if (match) s = parseInt(match[1]);
            }

            return {
                score: s !== null ? s : 50, // 실패 시 50
                rating: ratEl ? ratEl.innerText.toLowerCase().trim() : 'neutral'
            };
        });

        console.log(`추출 데이터: ${data.score} (${data.rating})`);

        // 5. 스크린샷 저장 (팝업 제거된 상태)
        const element = await page.$('.fear-and-greed-meter__container') ||
            await page.$('.fear-and-greed-indicator');

        if (element) {
            await element.screenshot({ path: 'cnn-gauge.png', padding: 10 });
        } else {
            // 모바일 뷰포트로 바꿔서 다시 시도 (가끔 레이아웃이 바뀜)
            await page.setViewportSize({ width: 375, height: 800 });
            await page.waitForTimeout(2000);
            await page.screenshot({ path: 'cnn-gauge.png' });
        }

        const output = {
            stock: {
                score: data.score,
                rating: data.rating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('data.json 저장 완료.');

    } catch (error) {
        console.error('스크래핑 에러:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();
