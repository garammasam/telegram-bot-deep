import express, { Request, Response } from 'express';
import { AgentManager } from './agent-manager';

const app = express();
const port = process.env.PORT || 3000;

// Create and start the agent manager
const agentManager = new AgentManager();
agentManager.startAllAgents().catch(console.error);

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.status(200).send('OK');
});

// Start the server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 