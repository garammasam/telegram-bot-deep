# Telegram Bot Deep

An intelligent Islamic Q&A Telegram bot with specialized agents for different aspects of Islamic knowledge.

## Features

- Multiple specialized agents for different Islamic topics
- Opinion synthesis from multiple perspectives
- Natural language understanding
- Support for both English and Malay languages
- Docker containerization for easy deployment
- 24/7 operation on Render

## Tech Stack

- Node.js 18+
- TypeScript
- Grammy (Telegram Bot Framework)
- Express.js
- Docker
- Render for deployment

## Prerequisites

- Node.js 18 or higher
- npm
- Docker (for containerized deployment)
- Telegram Bot Token
- DeepSeek API Key

## Environment Variables

Create a `.env` file in the root directory with:

```env
TELEGRAM_TOKEN=your_telegram_bot_token
DEEPSEEK_API_KEY=your_deepseek_api_key
GROUP_IDS=comma,separated,group,ids
```

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/telegram-bot-deep.git
cd telegram-bot-deep
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

4. Start the bot:
```bash
npm start
```

## Docker Deployment

1. Build the Docker image:
```bash
docker build -t telegram-bot-deep .
```

2. Run the container:
```bash
docker run -d --env-file .env telegram-bot-deep
```

## Deployment on Render

1. Fork/push this repository to your GitHub account
2. Create a new Web Service on Render
3. Connect your GitHub repository
4. Choose Docker as the environment
5. Set up environment variables in Render dashboard
6. Deploy!

## Development

For local development:
```bash
npm run dev
```

## License

MIT

## Author

Your Name 