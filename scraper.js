const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('브라우저 실행 중...');
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

        // [핵심] 팝업창 강제 제거 (CSS 주입 방식)
        // 팝업이 뜨기 전/후에 상관없이 화면에서 아예 안 보이게 처리합니다.
        console.log('팝업 및 방해 요소 강제 제거 중...');
        await page.addStyleTag({
            content: `
                #onetrust-consent-sdk, .onetrust-pc-dark-filter, .ot-sdk-container, 
                [id^="onetrust-"], .qc-cmp2-container { 
                    display: none !important; 
                    visibility: hidden !important; 
                    opacity: 0 !important; 
                    pointer-events: none !important; 
                }
            `
        });

        // 추가로 JS를 이용해 오버레이 요소들을 찾아 삭제합니다.
        await page.evaluate(() => {
            const selectors = ['#onetrust-consent-sdk', '.onetrust-pc-dark-filter', '.ot-sdk-container'];
            selectors.forEach(s => {
                const el = document.querySelector(s);
                if (el) el.remove();
            });
        });

        await page.waitForTimeout(3000); // UI 안정화 대기

        // 데이터가 로드될 때까지 충분히 기다림
        console.log('게이지 데이터 대기 중...');
        await page.waitForSelector('.fear-and-greed-meter__value', { timeout: 20000 }).catch(() => { });

        // 스크린샷 찍을 영역 확보
        const gaugeContainer = await page.$('.fear-and-greed-meter__container') ||
            await page.$('.fear-and-greed-indicator');

        if (gaugeContainer) {
            await gaugeContainer.screenshot({ path: 'cnn-gauge.png', padding: 10 });
            console.log('스크린샷 저장 성공.');
        } else {
            await page.screenshot({ path: 'cnn-gauge.png' });
            console.log('컨테이너를 못 찾아 전체 화면을 캡처했습니다.');
        }

        // 데이터 추출
        let score = 50;
        let rating = 'neutral';

        const data = await page.evaluate(() => {
            const valEl = document.querySelector('.fear-and-greed-meter__value');
            const ratEl = document.querySelector('.fear-and-greed-meter__rating');

            // 텍스트에서 숫자만 추출하는 함수
            const extractNum = (txt) => {
                if (!txt) return null;
                const m = txt.match(/\d+/);
                return m ? parseInt(m[0]) : null;
            }

            let s = extractNum(valEl ? valEl.innerText : null);
            let r = ratEl ? ratEl.innerText.toLowerCase().trim() : 'neutral';

            // 만약 선택자로 못 찾았다면 전체 텍스트에서 검색
            if (s === null) {
                const bodyText = document.body.innerText;
                const match = bodyText.match(/Fear & Greed Index.*?(\d+)/i) || bodyText.match(/Now: (\d+)/i);
                if (match) s = parseInt(match[1]);
            }

            return { score: s, rating: r };
        });

        if (data.score !== null) score = data.score;
        if (data.rating) rating = data.rating;

        console.log(`추출 결과: ${score} (${rating})`);

        const output = {
            stock: {
                score: score,
                rating: rating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('data.json 업데이트 성공.');

    } catch (error) {
        console.error('오류 발생:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();
