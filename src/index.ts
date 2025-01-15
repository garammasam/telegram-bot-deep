import { AgentManager } from './agent-manager';

async function main() {
  try {
    const agentManager = new AgentManager();
    await agentManager.startAllAgents();
    console.log('\n=== Bot is running ===');
    console.log('Use Ctrl+C to stop');
  } catch (error) {
    console.error('Failed to start the bot:', error);
    process.exit(1);
  }
}

main(); 