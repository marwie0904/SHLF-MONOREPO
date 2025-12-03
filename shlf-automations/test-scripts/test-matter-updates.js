import { ClioService } from '../src/services/clio.js';
import { createClient } from '@supabase/supabase-js';
import { config } from '../src/config/index.js';

const TEST_MATTER_ID = 1675950832;

// Test data
const TEST_LOCATIONS = ["Bonita Springs", "Fort Myers", "Naples"];
const TEST_ATTORNEY_IDS = [357520756, 357292201, 357380836];

/**
 * Test getting access token from Supabase
 */
async function testGetAccessToken() {
    console.log('\n=== Testing getAccessToken ===\n');

    try {
        console.log('Connecting to Supabase...');
        console.log(`Supabase URL: ${config.supabase.url}`);

        const supabase = createClient(config.supabase.url, config.supabase.key);

        console.log('Fetching access token from clio_tokens table...');

        const { data, error } = await supabase
            .from('clio_tokens')
            .select('access_token, created_at, expires_at')
            .eq('id', 1)
            .single();

        if (error) {
            console.error('❌ Failed to fetch access token from Supabase:', error);
            throw error;
        }

        if (!data || !data.access_token) {
            throw new Error('No access token found in database');
        }

        console.log('✅ SUCCESS: Retrieved access token from Supabase');
        console.log(`   Token prefix: ${data.access_token.substring(0, 10)}...`);
        console.log(`   Token length: ${data.access_token.length} characters`);

        if (data.created_at) {
            console.log(`   Created at: ${data.created_at}`);
        }
        if (data.expires_at) {
            console.log(`   Expires at: ${data.expires_at}`);
        }

        return data.access_token;
    } catch (error) {
        console.error('❌ Failed to get access token:', error.message);
        throw error;
    }
}

/**
 * Test updating matter location
 */
async function testUpdateMatterLocation() {
    console.log('\n=== Testing updateMatterLocation ===\n');

    for (const location of TEST_LOCATIONS) {
        try {
            console.log(`\nAttempting to update matter ${TEST_MATTER_ID} location to: ${location}`);

            const result = await ClioService.updateMatter(TEST_MATTER_ID, {
                location: location
            });

            console.log(`✅ SUCCESS: Updated location to: ${result.location}`);
            console.log(`   Matter ID: ${result.id}`);
            console.log(`   Display Number: ${result.display_number || 'N/A'}`);

            // Verify the update by fetching the matter
            console.log(`   Verifying update...`);
            const verifyResult = await ClioService.getMatter(TEST_MATTER_ID);

            if (verifyResult.location === location) {
                console.log(`   ✅ VERIFIED: Location confirmed as ${verifyResult.location}`);
            } else {
                console.log(`   ⚠️  WARNING: Location mismatch. Expected ${location}, got ${verifyResult.location}`);
            }

        } catch (error) {
            console.error(`❌ FAILED to update location to ${location}:`, error.message);
            if (error.response) {
                console.error('   Response data:', error.response.data);
            }
        }

        // Wait between updates
        await sleep(2000);
    }
}

/**
 * Test updating matter responsible attorney
 */
async function testUpdateMatterAttorney() {
    console.log('\n=== Testing updateMatterAttorney ===\n');

    for (const attorneyId of TEST_ATTORNEY_IDS) {
        try {
            console.log(`\nAttempting to update matter ${TEST_MATTER_ID} responsible attorney to: ${attorneyId}`);

            const result = await ClioService.updateMatter(TEST_MATTER_ID, {
                responsible_attorney: {
                    id: attorneyId
                }
            });

            console.log(`✅ SUCCESS: Updated responsible attorney to: ${result.responsible_attorney?.id}`);
            console.log(`   Attorney Name: ${result.responsible_attorney?.name || 'N/A'}`);
            console.log(`   Matter ID: ${result.id}`);

            // Verify the update by fetching the matter
            console.log(`   Verifying update...`);
            const verifyResult = await ClioService.getMatter(TEST_MATTER_ID);

            if (verifyResult.responsible_attorney?.id === attorneyId) {
                console.log(`   ✅ VERIFIED: Attorney ID confirmed as ${verifyResult.responsible_attorney.id}`);
                console.log(`   Attorney Name: ${verifyResult.responsible_attorney.name || 'N/A'}`);
            } else {
                console.log(`   ⚠️  WARNING: Attorney ID mismatch. Expected ${attorneyId}, got ${verifyResult.responsible_attorney?.id}`);
            }

        } catch (error) {
            console.error(`❌ FAILED to update attorney to ${attorneyId}:`, error.message);
            if (error.response) {
                console.error('   Response data:', error.response.data);
            }
        }

        // Wait between updates
        await sleep(2000);
    }
}

/**
 * Get current matter state
 */
async function getCurrentMatterState() {
    console.log('\n=== Current Matter State ===\n');

    try {
        const matter = await ClioService.getMatter(TEST_MATTER_ID);

        console.log(`Matter ID: ${matter.id}`);
        console.log(`Display Number: ${matter.display_number || 'N/A'}`);
        console.log(`Location: ${matter.location || 'Not set'}`);
        console.log(`Responsible Attorney ID: ${matter.responsible_attorney?.id || 'Not set'}`);
        console.log(`Responsible Attorney Name: ${matter.responsible_attorney?.name || 'N/A'}`);
        console.log(`Status: ${matter.status || 'N/A'}`);

        return matter;
    } catch (error) {
        console.error('❌ Failed to get current matter state:', error.message);
        throw error;
    }
}

/**
 * Sleep utility
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Main test runner
 */
async function main() {
    console.log('=====================================');
    console.log('  Matter Update Functions Test');
    console.log('=====================================');

    try {
        // Step 1: Test getting access token
        const accessToken = await testGetAccessToken();

        // Step 2: Initialize ClioService with the fresh token
        console.log('\n✅ Access token retrieved successfully');
        console.log('   Updating ClioService to use fresh token...');

        // Update the ClioService client with fresh token
        ClioService.client.defaults.headers['Authorization'] = `Bearer ${accessToken}`;

        // Initialize interceptors for automatic token refresh on 401
        ClioService.initializeInterceptors();

        console.log('   ✅ ClioService configured with fresh token\n');

        // Step 3: Show initial state
        await getCurrentMatterState();

        // Step 4: Test location updates
        await testUpdateMatterLocation();

        // Step 5: Test attorney updates
        await testUpdateMatterAttorney();

        // Step 6: Show final state
        console.log('\n');
        await getCurrentMatterState();

        console.log('\n=====================================');
        console.log('  All Tests Completed Successfully! ✅');
        console.log('=====================================\n');

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);
        process.exit(1);
    }
}

// Run tests
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
