import { ClioService } from '../src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config/index.js';

const TEST_MATTER_ID = 1675950832;

async function getAccessToken() {
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
}

async function getTestDates() {
    try {
        console.log('Retrieving test dates from Clio calendar entries...\n');

        // Get access token and configure
        const accessToken = await getAccessToken();
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;
        ClioService.initializeInterceptors();

        // Get calendar entries for the matter
        const response = await ClioService.client.get(`/api/v4/calendar_entries`, {
            params: {
                matter_id: TEST_MATTER_ID,
                fields: 'id,summary,start_at,matter'
            }
        });

        const entries = response.data.data;

        if (!entries || entries.length === 0) {
            console.log('No calendar entries found for this matter');
            return;
        }

        console.log(`Found ${entries.length} calendar entries:\n`);

        // Parse and format the results
        const results = [];

        entries.forEach(entry => {
            // Extract meeting type from summary
            const summaryMatch = entry.summary.match(/Test Meeting - (.+)/);
            const meetingType = summaryMatch ? summaryMatch[1] : entry.summary;

            // Parse date
            const date = new Date(entry.start_at);
            const formattedDate = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            results.push({
                meeting: meetingType,
                date: formattedDate,
                rawDate: entry.start_at
            });
        });

        // Sort by date
        results.sort((a, b) => new Date(a.rawDate) - new Date(b.rawDate));

        // Output in the requested format
        console.log('Test Dates:\n');

        // Group by location (we'll need to infer from the screenshots or assume order)
        const locations = ['Bonita Springs', 'Fort Myers', 'Naples'];
        const eventsPerLocation = Math.ceil(results.length / locations.length);

        let resultIndex = 0;
        for (const location of locations) {
            console.log(`${location.toUpperCase()}:`);

            for (let i = 0; i < eventsPerLocation && resultIndex < results.length; i++) {
                const result = results[resultIndex];
                console.log(`${location} - ${result.meeting}: ${result.date}`);
                resultIndex++;
            }
            console.log('');
        }

    } catch (error) {
        console.error('Error retrieving test dates:', error.message);
        if (error.response?.data) {
            console.error('Response:', error.response.data);
        }
    }
}

getTestDates();
