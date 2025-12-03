import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function updateFundingTableAssignee() {
  console.log('🔄 Updating "Update Funding Table" task assignee from FUNDING to Attorney...\n');

  // Update the task
  const { data, error } = await supabase
    .from('task-list-non-meeting')
    .update({ assignee: 'Attorney' })
    .eq('task_title', 'Update Funding Table')
    .eq('stage_id', '828768')
    .select();

  if (error) {
    console.error('❌ Error updating task:', error.message);
  } else if (data && data.length > 0) {
    console.log('✅ Successfully updated task:\n');
    data.forEach(task => {
      console.log('Task:', task.task_title);
      console.log('  Task Number:', task.task_number);
      console.log('  Old Assignee: FUNDING');
      console.log('  New Assignee:', task.assignee);
      console.log('  Stage:', task.stage_name);
    });
  } else {
    console.log('❌ No task found to update');
  }
}

updateFundingTableAssignee();
