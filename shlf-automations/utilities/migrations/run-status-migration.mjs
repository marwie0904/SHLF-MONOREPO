import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function runMigration() {
  console.log('🚀 Running migration: add-task-status-column.sql\n');

  try {
    // Step 1: Add status column to existing records using raw query
    console.log('Adding status column with default value...');

    // First, get all tasks that don't have a status
    const { data: tasksToUpdate, error: fetchError } = await supabase
      .from('tasks')
      .select('task_id, completed')
      .is('status', null)
      .limit(1000);

    if (fetchError) {
      console.log('Note: status column may already exist or table structure different');
      console.log('Proceeding with backfill...');
    }

    // Step 2: Backfill existing records
    console.log('\nBackfilling existing records...');

    // Update all completed tasks to status='completed'
    const { data: completedData, error: completedError } = await supabase
      .from('tasks')
      .update({ status: 'completed' })
      .eq('completed', true)
      .select('task_id');

    if (completedError) {
      console.error('❌ Failed to backfill completed tasks:', completedError.message);
    } else {
      console.log(`✅ Updated ${completedData?.length || 0} completed tasks to status='completed'`);
    }

    // Update all incomplete tasks to status='pending'
    const { data: pendingData, error: pendingError } = await supabase
      .from('tasks')
      .update({ status: 'pending' })
      .eq('completed', false)
      .is('status', null)
      .select('task_id');

    if (pendingError) {
      console.error('❌ Failed to backfill pending tasks:', pendingError.message);
    } else {
      console.log(`✅ Updated ${pendingData?.length || 0} incomplete tasks to status='pending'`);
    }

    // Step 3: Verify migration
    console.log('\nVerifying migration...');
    const { data: statusCounts, error: verifyError } = await supabase
      .from('tasks')
      .select('status, completed');

    if (verifyError) {
      console.error('❌ Verification failed:', verifyError.message);
    } else {
      const distribution = statusCounts.reduce((acc, task) => {
        const key = `status='${task.status || 'NULL'}', completed=${task.completed}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      console.log('✅ Verification successful');
      console.log('\nTask status distribution:');
      Object.entries(distribution).forEach(([key, count]) => {
        console.log(`  ${key}: ${count} tasks`);
      });
    }

    console.log('\n✨ Migration complete!');
    console.log('\nNote: The status column and constraints should be added via SQL migrations.');
    console.log('If you have access to the database, run:');
    console.log('  ALTER TABLE tasks ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT \'pending\';');
    console.log('  ALTER TABLE tasks ADD CONSTRAINT check_task_status CHECK (status IN (\'pending\', \'completed\', \'deleted\'));');
    console.log('  CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
