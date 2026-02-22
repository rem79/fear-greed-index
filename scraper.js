const { chromium } = require('playwright');
const fs = require('fs');

async function run() {
    let browser;
    try {
        console.log('브라우저 실행 중 (API 인터셉트 + DOM 분석 병행 버전)...');
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            viewport: { width: 1280, height: 1000 }
        });

        // 팝업 금지 스타일 주입
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

        // ========================================
        // 전략 1: CNN 내부 API 응답을 인터셉트
        // ========================================
        let apiData = null;

        page.on('response', async (response) => {
            const url = response.url();
            if (url.includes('fearandgreed') && (url.includes('graphdata') || url.includes('current'))) {
                try {
                    const json = await response.json();
                    console.log(`API 인터셉트 성공: ${url}`);
                    apiData = json;
                } catch (e) {
                    console.log(`API 응답 파싱 실패: ${url}`);
                }
            }
        });

        console.log('CNN 접속 중...');
        await page.goto('https://www.cnn.com/markets/fear-and-greed', {
            waitUntil: 'networkidle',
            timeout: 90000
        });

        // 팝업 요소 제거
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
                document.querySelectorAll('div').forEach(div => {
                    const style = window.getComputedStyle(div);
                    if (style.position === 'fixed' && !div.innerText.includes('Fear & Greed')) {
                        div.remove();
                    }
                });
            };
            removeElements();
            setTimeout(removeElements, 2000);
        });

        await page.waitForTimeout(6000); // UI 안정화 및 API 응답 대기

        // ========================================
        // 전략 2: API 데이터가 없으면 DOM에서 추출
        // ========================================
        let score = null;
        let rating = null;

        // 2-1. API 인터셉트 데이터 활용
        if (apiData) {
            console.log('API 데이터 분석 중...');
            try {
                // CNN API 응답 구조: { fear_and_greed: { score: N, rating: "..." } } 또는 유사
                if (apiData.fear_and_greed) {
                    score = Math.round(apiData.fear_and_greed.score);
                    rating = apiData.fear_and_greed.rating;
                    console.log(`API에서 추출: score=${score}, rating=${rating}`);
                } else if (apiData.score !== undefined) {
                    score = Math.round(apiData.score);
                    rating = apiData.rating;
                    console.log(`API에서 추출 (단순): score=${score}, rating=${rating}`);
                } else {
                    // 전체 데이터에서 score 찾기
                    const dataStr = JSON.stringify(apiData);
                    console.log(`API 데이터 구조: ${dataStr.substring(0, 500)}`);
                    const scoreMatch = dataStr.match(/"score"\s*:\s*([\d.]+)/);
                    if (scoreMatch) {
                        score = Math.round(parseFloat(scoreMatch[1]));
                        console.log(`API 데이터에서 score 파싱: ${score}`);
                    }
                    const ratingMatch = dataStr.match(/"rating"\s*:\s*"([^"]+)"/);
                    if (ratingMatch) {
                        rating = ratingMatch[1];
                    }
                }
            } catch (e) {
                console.log('API 데이터 파싱 실패:', e.message);
            }
        }

        // 2-2. DOM 기반 추출 (다양한 선택자 시도)
        if (score === null) {
            console.log('DOM에서 데이터 추출 시도...');
            const domData = await page.evaluate(() => {
                let s = null;
                let r = null;

                // 시도 1: 기존 선택자
                const meterValue = document.querySelector('.fear-and-greed-meter__value');
                if (meterValue) {
                    const match = meterValue.innerText.match(/\d+/);
                    if (match) s = parseInt(match[0]);
                }

                // 시도 2: market-fng-gauge 관련 선택자
                if (s === null) {
                    const gaugeEl = document.querySelector('[class*="market-fng-gauge"] [class*="dial-number"]') ||
                        document.querySelector('[class*="fng"] [class*="number"]') ||
                        document.querySelector('[class*="index-value"]') ||
                        document.querySelector('[class*="gauge"] [class*="score"]');
                    if (gaugeEl) {
                        const match = gaugeEl.innerText.match(/\d+/);
                        if (match) s = parseInt(match[0]);
                    }
                }

                // 시도 3: 큰 숫자를 가진 요소 검색 (Fear & Greed 근처)
                if (s === null) {
                    const allEls = document.querySelectorAll('span, div, p, h1, h2, h3, h4');
                    for (const el of allEls) {
                        const text = el.innerText?.trim();
                        if (text && /^\d{1,3}$/.test(text)) {
                            const num = parseInt(text);
                            if (num >= 0 && num <= 100) {
                                // Fear & Greed 근처에 있는지 확인
                                const parent = el.closest('[class*="fear"], [class*="greed"], [class*="fng"], [class*="gauge"], [class*="index"], [class*="meter"]');
                                if (parent) {
                                    s = num;
                                    break;
                                }
                            }
                        }
                    }
                }

                // 시도 4: aria-label 또는 data 속성
                if (s === null) {
                    const ariaEls = document.querySelectorAll('[aria-label*="fear"], [aria-label*="greed"], [data-value]');
                    for (const el of ariaEls) {
                        const dataVal = el.getAttribute('data-value') || el.getAttribute('aria-valuenow');
                        if (dataVal) {
                            s = Math.round(parseFloat(dataVal));
                            break;
                        }
                        const ariaLabel = el.getAttribute('aria-label');
                        if (ariaLabel) {
                            const match = ariaLabel.match(/(\d+)/);
                            if (match) {
                                s = parseInt(match[1]);
                                break;
                            }
                        }
                    }
                }

                // 시도 5: 페이지 전체 텍스트에서 패턴 매칭
                if (s === null) {
                    const bodyText = document.body.innerText;
                    const patterns = [
                        /Fear & Greed (?:Index |Now[:\s]*)(\d+)/i,
                        /Now:\s*(\d+)/i,
                        /Index is at (\d+)/i,
                        /score[:\s]*(\d+)/i
                    ];
                    for (const pattern of patterns) {
                        const match = bodyText.match(pattern);
                        if (match) {
                            s = parseInt(match[1]);
                            break;
                        }
                    }
                }

                // rating 추출
                const meterRating = document.querySelector('.fear-and-greed-meter__rating') ||
                    document.querySelector('[class*="market-fng-gauge"] [class*="label"]') ||
                    document.querySelector('[class*="fng"] [class*="rating"]') ||
                    document.querySelector('[class*="gauge"] [class*="status"]');
                if (meterRating) {
                    r = meterRating.innerText.toLowerCase().trim();
                }

                return { score: s, rating: r };
            });

            if (domData.score !== null) {
                score = domData.score;
                rating = domData.rating;
                console.log(`DOM에서 추출 성공: score=${score}, rating=${rating}`);
            }
        }

        // 2-3. 마지막 수단: 페이지 전체 HTML에서 뽑아보기
        if (score === null) {
            console.log('HTML 소스에서 직접 검색 시도...');
            const html = await page.content();

            // CNN이 서버사이드에서 데이터를 __NEXT_DATA__ 등에 넣는 경우
            const nextDataMatch = html.match(/__NEXT_DATA__[^{]*(\{[\s\S]*?\})\s*<\/script>/);
            if (nextDataMatch) {
                try {
                    const nextData = JSON.parse(nextDataMatch[1]);
                    const dataStr = JSON.stringify(nextData);
                    const scoreMatch = dataStr.match(/"score"\s*:\s*([\d.]+)/);
                    if (scoreMatch) {
                        score = Math.round(parseFloat(scoreMatch[1]));
                        console.log(`__NEXT_DATA__에서 score 추출: ${score}`);
                    }
                } catch (e) {
                    console.log('__NEXT_DATA__ 파싱 실패');
                }
            }

            // JSON-LD 또는 인라인 JSON에서 검색
            if (score === null) {
                const scorePatterns = [
                    /"score"\s*:\s*([\d.]+)/g,
                    /fear[_-]?and[_-]?greed[^}]*?"?(?:score|value)"?\s*:\s*([\d.]+)/gi
                ];
                for (const pattern of scorePatterns) {
                    const matches = [...html.matchAll(pattern)];
                    for (const match of matches) {
                        const val = Math.round(parseFloat(match[1]));
                        if (val >= 0 && val <= 100) {
                            score = val;
                            console.log(`HTML 소스에서 score 추출: ${score}`);
                            break;
                        }
                    }
                    if (score !== null) break;
                }
            }
        }

        // 최종 검증
        if (score === null || score < 0 || score > 100) {
            console.error('⚠️ 경고: 유효한 score를 추출하지 못했습니다!');
            // 이전 데이터 유지를 위해 기존 data.json에서 읽어옴
            try {
                const existingData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
                if (existingData.stock && existingData.stock.score) {
                    score = existingData.stock.score;
                    rating = existingData.stock.rating;
                    console.log(`기존 데이터 유지: score=${score}, rating=${rating}`);
                }
            } catch (e) {
                console.log('기존 데이터도 없음, 프로세스 종료');
                process.exit(1);
            }
        } else {
            // rating이 없으면 score로 판단
            if (!rating) {
                if (score <= 25) rating = 'extreme fear';
                else if (score <= 44) rating = 'fear';
                else if (score <= 55) rating = 'neutral';
                else if (score <= 74) rating = 'greed';
                else rating = 'extreme greed';
            }
        }

        console.log(`✅ 최종 데이터: score=${score}, rating=${rating}`);

        // 스크린샷 캡처
        console.log('스크린샷 캡처 중...');

        // 방해 요소 한번 더 제거
        await page.evaluate(() => {
            document.querySelectorAll('#onetrust-consent-sdk, #onetrust-banner-sdk, .onetrust-pc-dark-filter, .ot-sdk-container').forEach(el => el.remove());
            document.querySelectorAll('div').forEach(div => {
                const style = window.getComputedStyle(div);
                if (style.position === 'fixed' && !div.innerText.includes('Fear & Greed')) {
                    div.remove();
                }
            });
        });

        // 게이지 컨테이너를 찾아서 캡처
        const containerSelectors = [
            '.fear-and-greed-indicator',
            '.fear-and-greed-meter__container',
            '[class*="market-fng-gauge"]',
            '[class*="fear-and-greed"]',
            '[class*="fng-gauge"]',
            '[class*="gauge-container"]'
        ];

        let container = null;
        for (const sel of containerSelectors) {
            container = await page.$(sel);
            if (container) {
                console.log(`컨테이너 발견: ${sel}`);
                break;
            }
        }

        if (container) {
            const box = await container.boundingBox();
            if (box) {
                await page.screenshot({
                    path: 'cnn-gauge.png',
                    clip: {
                        x: Math.max(0, box.x - 20),
                        y: Math.max(0, box.y - 20),
                        width: Math.min(box.width + 40, 1280),
                        height: Math.min(box.height + 300, 1000)
                    }
                });
                console.log('게이지 스크린샷 저장 완료.');
            } else {
                await container.screenshot({ path: 'cnn-gauge.png' });
            }
        } else {
            console.log('컨테이너 미발견, 전체 화면 캡처...');
            await page.screenshot({ path: 'cnn-gauge.png', fullPage: false });
        }

        // 데이터 저장
        const output = {
            stock: {
                score: score,
                rating: rating,
                lastUpdated: new Date().toISOString()
            }
        };

        fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
        console.log('✅ data.json 저장 완료.');

    } catch (error) {
        console.error('크리티컬 오류:', error);
        process.exit(1);
    } finally {
        if (browser) await browser.close();
    }
}

run();
