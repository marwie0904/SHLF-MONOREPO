import { loginToClio } from './login.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Takes a screenshot of the Clio tasks page for a specific matter
 * @param {string} screenshotName - Name for the screenshot file (without extension)
 * @param {number} matterId - The Clio matter ID (defaults to 1675950832)
 * @param {Object} browserSession - Optional existing browser session from loginToClio()
 * @returns {string} - Path to the saved screenshot
 */
export async function takeTasksScreenshot(screenshotName, matterId = 1675950832, browserSession = null) {
    const shouldCloseBrowser = browserSession === null;
    let browser, context, page;

    try {
        // Use existing session or create new one
        if (browserSession) {
            ({ browser, context, page } = browserSession);
        } else {
            console.log('No existing browser session, logging in...');
            ({ browser, context, page } = await loginToClio());
        }

        // Navigate to the tasks page
        const tasksUrl = `https://app.clio.com/nc/#/matters/${matterId}/tasks`;
        console.log(`Navigating to tasks page: ${tasksUrl}`);

        await page.goto(tasksUrl, {
            waitUntil: 'load',
            timeout: 60000
        });

        // Wait for tasks to load and render
        console.log('Waiting for tasks to load...');
        await page.waitForTimeout(5000); // Give time for dynamic content to load

        // Create screenshots directory if it doesn't exist
        const screenshotsDir = path.join(process.cwd(), 'test-screenshots');
        if (!fs.existsSync(screenshotsDir)) {
            fs.mkdirSync(screenshotsDir, { recursive: true });
        }

        // Take screenshot
        const screenshotPath = path.join(screenshotsDir, `${screenshotName}.png`);
        console.log(`Taking screenshot: ${screenshotPath}`);

        await page.screenshot({
            path: screenshotPath,
            fullPage: true // Capture full scrollable page
        });

        console.log(`Screenshot saved successfully: ${screenshotPath}`);

        // Close browser if we created it
        if (shouldCloseBrowser) {
            await browser.close();
        }

        return screenshotPath;
    } catch (error) {
        console.error('Screenshot failed:', error.message);

        // Close browser if we created it and operation failed
        if (shouldCloseBrowser && browser) {
            await browser.close();
        }

        throw error;
    }
}

/**
 * Reusable function to take screenshots of any page while maintaining browser session
 * @param {Object} page - Playwright page instance
 * @param {string} screenshotName - Name for the screenshot file
 * @param {string} screenshotsDir - Directory to save screenshots (optional)
 * @returns {string} - Path to the saved screenshot
 */
export async function takeScreenshot(page, screenshotName, screenshotsDir = null) {
    try {
        // Use provided directory or default
        const targetDir = screenshotsDir || path.join(process.cwd(), 'test-screenshots');

        // Create directory if it doesn't exist
        if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
        }

        const screenshotPath = path.join(targetDir, `${screenshotName}.png`);
        console.log(`Taking screenshot: ${screenshotPath}`);

        await page.screenshot({
            path: screenshotPath,
            fullPage: true
        });

        console.log(`Screenshot saved: ${screenshotPath}`);
        return screenshotPath;
    } catch (error) {
        console.error('Error taking screenshot:', error.message);
        throw error;
    }
}
