/**
 * Independent test for Playwright screenshot functionality
 * Tests login and screenshot capture for the tasks page
 */

import { loginToClio, closeBrowser, takeScreenshot } from '../utilities/playwright/index.js';

const matterId = 1675950832;

async function testPlaywrightScreenshot() {
    let browserSession = null;

    try {
        console.log('=== Starting Playwright Screenshot Test ===\n');

        // Step 1: Login
        console.log('Step 1: Logging into Clio...');
        browserSession = await loginToClio();
        console.log('✓ Login successful!\n');

        // Step 2: Navigate to tasks page
        const { page } = browserSession;
        const tasksUrl = `https://app.clio.com/nc/#/matters/${matterId}/tasks`;

        console.log(`Step 2: Navigating to tasks page: ${tasksUrl}`);
        await page.goto(tasksUrl, {
            waitUntil: 'load',
            timeout: 60000
        });
        console.log('✓ Navigation successful!\n');

        // Step 3: Wait for page to fully load
        console.log('Step 3: Waiting for tasks to load...');
        await page.waitForTimeout(5000); // Give time for Angular/React to render
        console.log('✓ Page loaded!\n');

        // Step 4: Take screenshot
        console.log('Step 4: Taking screenshot...');
        const screenshotName = `test-screenshot-${Date.now()}`;
        await takeScreenshot(page, screenshotName);
        console.log(`✓ Screenshot saved as: ${screenshotName}.png\n`);

        // Step 5: Verify we're on the correct page
        const currentUrl = page.url();
        console.log(`Step 5: Verifying page URL...`);
        console.log(`Current URL: ${currentUrl}`);

        if (currentUrl.includes(`matters/${matterId}/tasks`)) {
            console.log('✓ Confirmed on tasks page!\n');
        } else {
            console.warn('⚠ Warning: URL does not match expected tasks page\n');
        }

        console.log('=== Test Completed Successfully ===');
        console.log('Check the test-screenshots directory for the captured image.');

    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    } finally {
        // Cleanup: Close browser
        if (browserSession) {
            console.log('\nClosing browser...');
            await closeBrowser(browserSession);
            console.log('✓ Browser closed');
        }
    }
}

// Run the test
testPlaywrightScreenshot().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
