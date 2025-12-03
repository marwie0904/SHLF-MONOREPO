import { chromium } from 'playwright';

/**
 * Logs into Clio using Playwright automation
 * @param {Object} browser - Playwright browser instance (optional, creates new if not provided)
 * @returns {Object} - { browser, context, page } - Authenticated browser objects
 */
export async function loginToClio(browser = null) {
    const shouldCloseBrowser = browser === null;

    try {
        // Launch browser if not provided
        if (!browser) {
            console.log('Launching browser...');
            browser = await chromium.launch({
                headless: false, // Set to true for headless mode
                slowMo: 100 // Slow down operations for visibility
            });
        }

        // Create new context and page
        const context = await browser.newContext({
            viewport: { width: 1920, height: 1080 },
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const page = await context.newPage();

        console.log('Navigating to Clio login page...');
        await page.goto('https://app.clio.com/login', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Wait for email input field and enter email
        console.log('Entering email...');
        await page.waitForSelector('input[type="email"]#email', { timeout: 10000 });
        await page.fill('input[type="email"]#email', 'gabby@safeharborlawfirm.com');

        // Click the "Next: Password" button
        console.log('Clicking Next button...');
        await page.click('button#next[type="submit"]');

        // Wait for password input field and enter password
        console.log('Entering password...');
        await page.waitForSelector('input[type="password"]#password', { timeout: 10000 });
        await page.fill('input[type="password"]#password', 'Gabby@2025!SHLF');

        // Click the "Sign In" button and wait for navigation
        console.log('Clicking Sign In button...');
        await Promise.all([
            page.waitForURL('**/nc/#/**', { timeout: 60000 }),
            page.click('button#signin[type="submit"]')
        ]);

        // Additional wait to ensure the Clio app is fully initialized
        console.log('Waiting for Clio app to initialize...');
        await page.waitForTimeout(3000);

        console.log('Successfully logged in to Clio!');

        return { browser, context, page };
    } catch (error) {
        console.error('Login failed:', error.message);

        // Close browser if we created it and login failed
        if (shouldCloseBrowser && browser) {
            await browser.close();
        }

        throw error;
    }
}

/**
 * Closes browser, context, and page
 * @param {Object} param0 - { browser, context, page }
 */
export async function closeBrowser({ browser, context, page }) {
    try {
        if (page) await page.close();
        if (context) await context.close();
        if (browser) await browser.close();
        console.log('Browser closed successfully');
    } catch (error) {
        console.error('Error closing browser:', error.message);
    }
}
