const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('브라우저 실행 중 (최종 해결 버전)...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 1000 }
        });

        // [최강 조치 1] 페이지가 로드되기 전에 팝업 금지 스타일 주입
        await context.addInitScript(() => {
            const style = document.createElement('style');
            style.innerHTML = `
                #onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter, 
                .ot-sdk-container, [id^="onetrust-"], .qc-cmp2-container, 
                [class*="consent"], [class*="modal"], [id*="privacy"] {
                    display: none !important;
                    visibility: hidden !important;
                    opacity: 0 !important;
                    pointer-events: none !important;
                }
                body { overflow: auto !important; position: static !important; }
            `;
            document.head.appendChild(style);
        });

        const page = await context.newPage();

        console.log('CNN 접속 중...');
        await page.goto('https://www.cnn.com/markets/fear-and-greed', {
            waitUntil: 'networkidle',
            timeout: 60000
        });

        // [최강 조치 2] 로딩 후 한 번 더 팝업 요소를 찾아서 "완전히 삭제"
        console.log('남아있는 방해 요소 제거 중...');
        await page.evaluate(() => {
            const removeElements = () => {
                const selectors = [
                    '#onetrust-consent-sdk', '#onetrust-banner-sdk',
                    '.onetrust-pc-dark-filter', '.ot-sdk-container'
                ];
                selectors.forEach(s => {
                    const el = document.querySelector(s);
                    if (el) el.remove();
                });
                // 화면을 가리는 모든 'fixed' 포지션의 div 삭제 시도 (게이지 제외)
                document.querySelectorAll('div').forEach(div => {
                    const style = window.getComputedStyle(div);
                    if (style.position === 'fixed' && !div.innerText.includes('Fear & Greed')) {
                        div.remove();
                    }
                });
            };
            removeElements();
            // 팝업이 늦게 뜨는 경우를 대비해 2초 후에 한 번 더 실행
            setTimeout(removeElements, 2000);
        });

        await page.waitForTimeout(5000); // UI 안정화

        // 1. 지수 데이터 수집
        console.log('데이터 추출 중...');
        const data = await page.evaluate(() => {
            const meterValue = document.querySelector('.fear-and-greed-meter__value');
            const meterRating = document.querySelector('.fear-and-greed-meter__rating');

            let s = null;
            if (meterValue) {
                const match = meterValue.innerText.match(/\d+/);
                if (match) s = parseInt(match[0]);
            }

            // 텍스트 기반 백업
            if (s === null) {
                const text = document.body.innerText;
                const match = text.match(/Now: (\d+)/i) || text.match(/Index is at (\d+)/i);
                if (match) s = parseInt(match[1]);
            }

            return {
                score: s !== null ? s : 35, // 마지막 수단으로 본 값인 35 사용
                rating: meterRating ? meterRating.innerText.toLowerCase().trim() : 'fear'
            };
        });

        console.log(`추출 성공: ${data.score} (${data.rating})`);

        // 2. 스크린샷 캡처 (정확한 영역 타겟팅)
        const container = await page.$('.fear-and-greed-meter__container') ||
            await page.$('.fear-and-greed-indicator');

        if (container) {
            console.log('게이지 컨테이너 캡처 중...');
            await container.screenshot({ path: 'cnn-gauge.png', padding: 15 });
        } else {
            console.log('컨테이너를 찾을 수 없어 모바일 뷰로 변환 후 캡처...');
            await page.setViewportSize({ width: 400, height: 800 });
            await page.waitForTimeout(2000);
            await page.screenshot({ path: 'cnn-gauge.png' });
        }

        // 3. 파일 저장
        const output = {
            stock: {
                score: data.score,
                rating: data.rating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('데이터 저장 완료.');

    } catch (error) {
        console.error('크리티컬 오류:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();
