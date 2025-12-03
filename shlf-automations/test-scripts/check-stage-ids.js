import { SupabaseService } from '../src/services/supabase.js';

async function checkStages() {
    try {
        console.log('Checking available Stage IDs in task-list-meeting table...\n');

        // Get all tasks
        const allTasks = await SupabaseService.getAllTaskListMeetings();

        if (!allTasks || allTasks.length === 0) {
            console.log('No tasks found in task-list-meeting table');
            return;
        }

        console.log(`Total tasks in table: ${allTasks.length}\n`);

        // Get unique stage IDs
        const stageIds = [...new Set(allTasks.map(t => t.stage_id))].filter(Boolean);

        console.log(`Available Stage IDs (${stageIds.length} unique):\n`);

        stageIds.sort((a, b) => a - b).forEach(id => {
            const tasksForStage = allTasks.filter(t => t.stage_id === id);
            const dependentTasks = tasksForStage.filter(t => {
                const rel = t['due_date-relational'] || t.due_date_relational || '';
                return rel.toLowerCase().includes('after task');
            });

            console.log(`  Stage ${id}:`);
            console.log(`    Total tasks: ${tasksForStage.length}`);
            console.log(`    Dependent tasks: ${dependentTasks.length}`);

            if (dependentTasks.length > 0) {
                console.log(`    Dependencies:`);
                dependentTasks.forEach(t => {
                    const rel = t['due_date-relational'] || t.due_date_relational || '';
                    console.log(`      - ${t.task_name}: ${rel}`);
                });
            }
            console.log('');
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkStages();
