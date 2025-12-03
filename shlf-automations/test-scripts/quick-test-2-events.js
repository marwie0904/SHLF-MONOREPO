import { ClioService } from '../src/services/clio.js';
import { SupabaseService } from '../src/services/supabase.js';
import { loginToClio, closeBrowser, takeScreenshot } from '../utilities/playwright/index.js';

const matterId = 1675950832;

// TEST: 1 location, 2 events
const location = ["Bonita Springs"];
const attorneyIds = [357520756];

// Global browser session
let browserSession = null;

async function main(){
    try {
        console.log('=====================================');
        console.log('  QUICK TEST: 1 Location, 2 Events');
        console.log('=====================================\n');

        // Initialize async data
        console.log('📝 Step 1: Getting access token...');
        const accessToken = await getAccessToken();

        // Configure ClioService with fresh token
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();
        console.log('✅ Access token configured\n');

        console.log('📋 Step 2: Getting calendar events...');
        const calendarEvents = await getCalendarEvents();

        // Use first 2 events
        const testEvents = calendarEvents.slice(0, 2);
        console.log(`✅ Using ${testEvents.length} events:`);
        testEvents.forEach(e => console.log(`   - ${e.EventName}`));
        console.log('');

        // Login to Clio once at the start
        console.log('🌐 Step 3: Logging into Clio...');
        browserSession = await loginToClio();
        console.log('✅ Browser opened and logged in\n');

        for (let i = 0; i < location.length; i++){
            const currentLocation = location[i];
            const currentAttorney = attorneyIds[i];

            console.log(`\n${'='.repeat(50)}`);
            console.log(`Testing: ${currentLocation} - Attorney: ${currentAttorney}`);
            console.log('='.repeat(50));

            await updateMatterLocation(currentLocation);
            await updateMatterAttorney(currentAttorney);

            await loopCalendarEvents(currentLocation, currentAttorney, testEvents);
        }

        // Close browser session when done
        if (browserSession) {
            console.log('\n🔒 Step 4: Closing browser session...');
            console.log('   Browser should close now...');
            await closeBrowser(browserSession);
            console.log('✅ Browser closed successfully');
        }

        console.log('\n=====================================');
        console.log('  TEST COMPLETED! ✅');
        console.log('=====================================');
        console.log('\n📊 Summary:');
        console.log(`   - Browser opened: 1 time (at start)`);
        console.log(`   - Screenshots taken: ${testEvents.length}`);
        console.log(`   - Browser closed: 1 time (at end)`);
        console.log('');

    } catch (error) {
        console.error('\n❌ Test flow failed:', error);

        // Ensure browser is closed on error
        if (browserSession) {
            console.log('🔒 Closing browser due to error...');
            await closeBrowser(browserSession);
        }

        throw error;
    }
}

async function loopCalendarEvents(currentLocation, currentAttorney, calendarEvents){
    for(let eventIndex = 0; eventIndex < calendarEvents.length; eventIndex++){
        const event = calendarEvents[eventIndex];
        try {
            console.log(`\n📅 Event ${eventIndex + 1}/${calendarEvents.length}: ${event.EventName} (ID: ${event.EventId})`);

            console.log('   🧹 Cleaning old data...');
            await cleanData();
            await sleep(2000);

            console.log('   📆 Creating calendar entry...');
            await createCalendarEntry(event.StartDate, event.EndDate, event.EventId, event.EventName);
            await sleep(10000);

            console.log('   📸 Taking screenshot (browser still open)...');
            const screenshotName = `${currentAttorney}-${event.EventName.replace(/\s+/g, '-').toLowerCase()}`;
            await playWrightScreenshot(screenshotName, currentLocation);

            console.log(`   ✅ Event ${eventIndex + 1} completed`);
        } catch (error) {
            console.error(`   ❌ Error processing event ${event.EventId}:`, error.message);
            continue;
        }
    }
}

async function updateMatterLocation(location){
    try {
        console.log(`\n📍 Updating matter location to: ${location}`);
        const result = await ClioService.updateMatter(matterId, {
            location: location
        });
        console.log(`✅ Location updated`);
        return result;
    } catch (error) {
        console.error(`❌ Failed to update location:`, error.message);
        throw error;
    }
}

async function updateMatterAttorney(attorneyID) {
    try {
        console.log(`👤 Updating responsible attorney to: ${attorneyID}`);
        const result = await ClioService.updateMatter(matterId, {
            responsible_attorney: {
                id: attorneyID
            }
        });
        console.log(`✅ Attorney updated`);
        return result;
    } catch (error) {
        console.error(`❌ Failed to update attorney:`, error.message);
        throw error;
    }
}

async function getCalendarEvents(){
    try {
        const mappings = await SupabaseService.getAllCalendarEventMappings();

        if (!mappings || mappings.length === 0) {
            console.warn('⚠️  No calendar event mappings found');
            return [];
        }

        const events = mappings.map(mapping => ({
            EventId: mapping.calendar_event_id,
            EventName: mapping.calendar_event_name,
            StageId: mapping.stage_id,
            StartDate: null,
            EndDate: null
        }));

        return events;
    } catch (error) {
        console.error('❌ Failed to fetch calendar events:', error.message);
        throw error;
    }
}

async function getAccessToken(){
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const { config } = await import('../src/config/index.js');

        const supabase = createClient(config.supabase.url, config.supabase.key);

        const { data, error } = await supabase
            .from('clio_tokens')
            .select('access_token')
            .eq('id', 1)
            .single();

        if (error || !data?.access_token) {
            throw new Error('Failed to get access token');
        }

        return data.access_token;
    } catch (error) {
        console.error('❌ Failed to get access token:', error.message);
        throw error;
    }
}

async function createCalendarEntry(StartDate, EndDate, EventId, EventName){
    try {
        const dateOptions = ['2025-11-11', '2025-11-13'];
        const selectedDate = dateOptions[Math.floor(Math.random() * 2)];

        const startAt = `${selectedDate}T10:00:00-05:00`;
        const endAt = `${selectedDate}T11:00:00-05:00`;

        const summary = `Test Meeting - ${EventName}`;

        const result = await ClioService.createCalendarEntry({
            summary: summary,
            eventTypeId: EventId,
            calendarOwnerId: 7077963,
            matterId: matterId,
            startAt: startAt,
            endAt: endAt
        });

        console.log(`   ✅ Calendar entry created (ID: ${result.id})`);
        return result;
    } catch (error) {
        console.error('   ❌ Failed to create calendar entry:', error.message);
        throw error;
    }
}

async function playWrightScreenshot(screenshotName, locationFolder){
    try {
        if (!browserSession || !browserSession.page) {
            throw new Error('Browser session not initialized');
        }

        const { page } = browserSession;
        const tasksUrl = `https://app.clio.com/nc/#/matters/${matterId}/tasks`;
        const currentUrl = page.url();

        if (currentUrl.includes(`matters/${matterId}/tasks`)) {
            await page.reload({ waitUntil: 'load', timeout: 60000 });
        } else {
            await page.goto(tasksUrl, { waitUntil: 'load', timeout: 60000 });
        }

        await page.waitForTimeout(5000);

        // Create organized directory structure
        const os = await import('os');
        const path = await import('path');
        const fs = await import('fs');

        const desktopPath = path.join(os.homedir(), 'Desktop');
        const mainTestFolder = path.join(desktopPath, 'SHLF meeting tests');
        const locationFolderPath = path.join(mainTestFolder, locationFolder);

        if (!fs.existsSync(mainTestFolder)) {
            fs.mkdirSync(mainTestFolder, { recursive: true });
        }
        if (!fs.existsSync(locationFolderPath)) {
            fs.mkdirSync(locationFolderPath, { recursive: true });
        }

        await takeScreenshot(page, screenshotName, locationFolderPath);

        console.log(`   ✅ Screenshot saved: ${locationFolder}/${screenshotName}.png`);
    } catch (error) {
        console.error(`   ❌ Screenshot failed:`, error.message);
        throw error;
    }
}

async function cleanData() {
    try {
        const { createClient } = await import('@supabase/supabase-js');
        const { config } = await import('../src/config/index.js');
        const supabase = createClient(config.supabase.url, config.supabase.key);

        // Delete calendar entries from Clio
        const { data: meetingRecords } = await supabase
            .from('matters-meetings-booked')
            .select('calendar_entry_id')
            .eq('matter_id', matterId);

        if (meetingRecords && meetingRecords.length > 0) {
            for (const record of meetingRecords) {
                try {
                    await ClioService.client.delete(`/api/v4/calendar_entries/${record.calendar_entry_id}`);
                } catch (error) {
                    // Ignore 404 errors
                    if (error.response?.status !== 404) {
                        console.error(`      Failed to delete calendar entry ${record.calendar_entry_id}`);
                    }
                }
            }
        }

        // Delete tasks from Clio
        const tasks = await ClioService.getTasksByMatter(matterId);
        if (tasks && tasks.length > 0) {
            for (const task of tasks) {
                try {
                    await ClioService.deleteTask(task.id);
                } catch (error) {
                    console.error(`      Failed to delete task ${task.id}`);
                }
            }
        }

        // Delete from Supabase
        await supabase.from('tasks').delete().eq('matter_id', matterId);
        await supabase.from('matters-meetings-booked').delete().eq('matter_id', matterId);

    } catch (error) {
        console.error('   ⚠️  Cleanup warning:', error.message);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
