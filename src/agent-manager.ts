import { config } from 'dotenv';
import { Bot, Context } from 'grammy';
import { FatwaAgent, MazhabAgent, JakimAgent, MalaysianFatwaAgent, IbadhahAgent, OpinionAgent, BaseIslamicAgent } from './islamic-agents';

// Load environment variables
config();

interface AgentInfo {
  agent: FatwaAgent | MazhabAgent | JakimAgent | MalaysianFatwaAgent | IbadhahAgent | OpinionAgent;
  isRunning: boolean;
}

export class AgentManager {
  private agents: Map<string, AgentInfo> = new Map();
  private bot: Bot;
  private botUsername: string = '';

  constructor() {
    console.log('\n=== Initializing Agent Manager ===');
    
    // Validate environment variables
    console.log('Checking environment variables...');
    if (!process.env.TELEGRAM_TOKEN) {
      throw new Error('TELEGRAM_TOKEN is not set in environment variables');
    }
    if (!process.env.DEEPSEEK_API_KEY) {
      throw new Error('DEEPSEEK_API_KEY is not set in environment variables');
    }
    if (!process.env.GROUP_IDS) {
      throw new Error('GROUP_IDS is not set in environment variables');
    }

    // Create single bot instance
    this.bot = new Bot(process.env.TELEGRAM_TOKEN);

    const config = {
      telegramToken: process.env.TELEGRAM_TOKEN,
      deepseekKey: process.env.DEEPSEEK_API_KEY,
      groupIds: process.env.GROUP_IDS.split(','),
      responseThreshold: 0.7,
      messageHistory: new Map()
    };

    console.log('Creating agents with configuration...');
    console.log('- Group IDs:', config.groupIds);
    
    // Initialize specialized agents first
    const specializedAgents = [
      new FatwaAgent(config, this.bot),
      new MazhabAgent(config, this.bot),
      new JakimAgent(config, this.bot),
      new MalaysianFatwaAgent(config, this.bot),
      new IbadhahAgent(config, this.bot)
    ];

    // Set up specialized agents
    this.agents.set('fatwa', { 
      agent: specializedAgents[0], 
      isRunning: false 
    });
    console.log('✓ Fatwa Agent created');

    this.agents.set('mazhab', { 
      agent: specializedAgents[1], 
      isRunning: false 
    });
    console.log('✓ Mazhab Agent created');

    this.agents.set('jakim', { 
      agent: specializedAgents[2], 
      isRunning: false 
    });
    console.log('✓ JAKIM Agent created');

    this.agents.set('malaysianfatwa', { 
      agent: specializedAgents[3], 
      isRunning: false 
    });
    console.log('✓ Malaysian Fatwa Agent created');

    this.agents.set('ibadah', { 
      agent: specializedAgents[4], 
      isRunning: false 
    });
    console.log('✓ Ibadah Agent created');

    // Initialize the Opinion agent with all other agents and lower threshold
    const opinionConfig = {
      ...config,
      responseThreshold: 0.3
    };
    
    this.agents.set('opinion', {
      agent: new OpinionAgent(opinionConfig, this.bot, specializedAgents),
      isRunning: false
    });
    console.log('✓ Opinion Agent created');

    // Configure bot to handle messages and commands
    this.bot.on('message:text', async (ctx) => {
      console.log('\n=== Incoming message ===');
      console.log('Chat ID:', ctx.chat?.id);
      console.log('Allowed groups:', config.groupIds);
      console.log('Message text:', ctx.message.text);
      
      if (ctx.chat?.id && config.groupIds.includes(ctx.chat.id.toString())) {
        console.log('✓ Message is from allowed group');

        // Get bot info if we don't have it yet
        if (!this.botUsername && ctx.me) {
          this.botUsername = ctx.me.username || '';
        }

        // Check if message is a reply
        const isReply = !!ctx.message.reply_to_message;
        console.log('Is reply:', isReply);

        // Get the full context of the question
        let questionText = ctx.message.text;
        
        // Handle replies to bot's messages
        if (isReply) {
          const repliedMessage = ctx.message.reply_to_message;
          const isBotMessage = repliedMessage?.from?.id === ctx.me?.id;
          const isBotMentioned = this.isBotMentioned(questionText);

          if (isBotMessage || isBotMentioned) {
            // Include the replied message for context
            if (repliedMessage?.text) {
              questionText = `Context: ${repliedMessage.text}\n\nFollow-up: ${questionText}`;
            }
            console.log('Processing as follow-up question:', questionText);
          } else {
            // Not a reply to bot's message and bot not mentioned, ignore
            return;
          }
        }

        const isMentioned = this.isBotMentioned(questionText);
        const isCommand = questionText.startsWith('/');
        const isGetKeywords = questionText.toLowerCase().includes('getkeywords');

        console.log('Is mentioned:', isMentioned);
        console.log('Is command:', isCommand);
        console.log('Is getKeywords:', isGetKeywords);

        // Handle commands separately
        if (isCommand) {
          for (const [_, info] of this.agents) {
            await info.agent.setupHandlers();
          }
          return;
        }

        // Handle mentions and natural language queries
        if (isMentioned || isReply) {
          console.log('Processing message...');
          const question = isMentioned ? this.removeBotMention(questionText) : questionText;
          console.log('Cleaned question:', question);

          // If just mentioned without a question, prompt for one
          if (!question.trim()) {
            console.log('Empty question after cleaning, prompting user');
            await ctx.reply('Yes? How can I help you?', {
              reply_to_message_id: ctx.message.message_id
            });
            return;
          }

          // Check if it's a simple interaction
          const simpleCheck = this.isSimpleInteraction(question);
          if (simpleCheck.isSimple && simpleCheck.response) {
            console.log('Handling simple interaction');
            await ctx.reply(simpleCheck.response, {
              reply_to_message_id: ctx.message.message_id
            });
            return;
          }

          // Process with appropriate agent
          if (isGetKeywords) {
            // Use OpinionAgent for comprehensive analysis
            console.log('Processing with OpinionAgent (getKeywords requested)...');
            const opinionAgent = this.agents.get('opinion')?.agent as OpinionAgent;
            if (opinionAgent) {
              try {
                const response = await opinionAgent.generateResponse(question);
                await this.replyWithFormattedResponse(ctx, response);
              } catch (error) {
                console.error('Error generating opinion:', error);
                await ctx.reply(
                  'I apologize, but I encountered an error while processing your question. Please try again later.',
                  { reply_to_message_id: ctx.message.message_id }
                );
              }
            }
          } else {
            // Use the most relevant specialized agent
            console.log('Finding most relevant specialized agent...');
            let bestAgent: BaseIslamicAgent | null = null;
            let highestRelevance = 0;

            for (const [name, info] of this.agents) {
              if (name === 'opinion') continue; // Skip OpinionAgent for regular queries
              
              const agent = info.agent;
              const relevanceScore = await agent.shouldRespond(question);
              if (typeof relevanceScore === 'number' && relevanceScore > highestRelevance) {
                highestRelevance = relevanceScore;
                bestAgent = agent;
              }
            }

            if (bestAgent) {
              try {
                const response = await bestAgent.generateResponse(question);
                await this.replyWithFormattedResponse(ctx, response);
              } catch (error) {
                console.error('Error generating response:', error);
                await ctx.reply(
                  'I apologize, but I encountered an error while processing your question. Please try again later.',
                  { reply_to_message_id: ctx.message.message_id }
                );
              }
            } else {
              // No agent found relevant enough, use default response
              await ctx.reply(
                'I\'m not sure I understand your question. Could you please rephrase it or use one of my commands?\n\n' +
                'Use /help to see available commands.',
                { reply_to_message_id: ctx.message.message_id }
              );
            }
          }
        }
      } else {
        console.log('❌ Message is not from allowed group');
      }
    });

    // Set up command handlers separately
    this.bot.on('message', async (ctx, next) => {
      if (ctx.message?.text?.startsWith('/')) {
        await next();
      }
    });
  }

  private isBotMentioned(text: string): boolean {
    // Check for Telegram username mention
    if (this.botUsername) {
      const lowerText = text.toLowerCase();
      const lowerUsername = this.botUsername.toLowerCase();
      
      if (lowerText.includes(`@${lowerUsername}`) || lowerText.includes(lowerUsername)) {
        console.log('Bot mentioned via username');
        return true;
      }
    }
    
    // Check for "tok ayah" mentions (case insensitive)
    const tokAyahVariations = [
      'tok ayah',
      'tokayah',
      'tok ayoh',
      'tokayoh',
      'tok aya',
      'tokaya',
      'tokayahh',
      'tok ayahh'
    ];

    const lowerText = text.toLowerCase();
    const isTokAyahMentioned = tokAyahVariations.some(variation => lowerText.includes(variation));
    
    if (isTokAyahMentioned) {
      console.log('Bot mentioned as tok ayah');
      return true;
    }

    return false;
  }

  private removeBotMention(text: string): string {
    let cleaned = text;

    // Remove Telegram username mentions if present
    if (this.botUsername) {
      cleaned = cleaned.replace(new RegExp(`@${this.botUsername}\\s*`, 'gi'), '');
      cleaned = cleaned.replace(new RegExp(`${this.botUsername}\\s*`, 'gi'), '');
    }
    
    // Remove tok ayah variations with word boundaries
    const tokAyahVariations = [
      'tok ayah',
      'tokayah',
      'tok ayoh',
      'tokayoh',
      'tok aya',
      'tokaya',
      'tokayahh',
      'tok ayahh'
    ];

    // Create a regex pattern that matches any of the variations with word boundaries
    const pattern = new RegExp(`\\b(${tokAyahVariations.join('|')})\\b[,\\s]*`, 'gi');
    cleaned = cleaned.replace(pattern, '');
    
    // Clean up any remaining punctuation at the start
    cleaned = cleaned.replace(/^[,\\s]+/, '');
    
    console.log('Cleaned text:', cleaned);
    return cleaned.trim();
  }

  private splitResponse(text: string): string[] {
    const MAX_LENGTH = 4000; // Leave some room for formatting
    const chunks: string[] = [];
    
    while (text.length > 0) {
      if (text.length <= MAX_LENGTH) {
        chunks.push(text);
        break;
      }

      // Find a good breaking point
      let splitIndex = text.lastIndexOf('\n\n', MAX_LENGTH);
      if (splitIndex === -1) {
        splitIndex = text.lastIndexOf('. ', MAX_LENGTH);
      }
      if (splitIndex === -1) {
        splitIndex = MAX_LENGTH;
      }

      chunks.push(text.slice(0, splitIndex));
      text = text.slice(splitIndex).trim();

      // Add continuation marker if there's more
      if (text.length > 0) {
        chunks[chunks.length - 1] += '\n\n<i>(continued...)</i>';
        text = '<i>(continuation)</i>\n\n' + text;
      }
    }

    return chunks;
  }

  private formatResponseForTelegram(text: string): string {
    try {
      // First, escape any existing HTML tags
      let formatted = text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      // Then apply our formatting
      formatted = formatted
        // Headers
        .replace(/^### (.*?)$/gm, '<b>$1</b>')
        .replace(/^## (.*?)$/gm, '<b>$1</b>')
        .replace(/^# (.*?)$/gm, '<b>$1</b>')
        
        // Bold - non-greedy match to prevent overlapping tags
        .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
        
        // Italic - non-greedy match to prevent overlapping tags
        .replace(/\*(.*?)\*/g, '<i>$1</i>')
        
        // Quotes
        .replace(/^> (.*?)$/gm, '\n<i>$1</i>\n')
        
        // Lists
        .replace(/^\d\. /gm, '\n• ')
        .replace(/^- /gm, '\n• ')
        
        // Clean up multiple newlines
        .replace(/\n\s*\n/g, '\n\n')
        .trim();

      // Add spacing around tags for better readability
      formatted = formatted
        .replace(/></g, '> <')
        .replace(/([^\s])<(b|i)>/g, '$1 <$2>') // Add space before tags
        .replace(/<\/(b|i)>([^\s])/g, '</$1> $2'); // Add space after tags

      // Validate HTML tags are properly nested
      const stack: string[] = [];
      let isValid = true;
      const tagRegex = /<\/?[bi]>/g;
      let match;

      while ((match = tagRegex.exec(formatted)) !== null) {
        const tag = match[0];
        if (tag.startsWith('</')) {
          // Closing tag
          const expectedTag = stack.pop();
          if (!expectedTag || !tag.includes(expectedTag.slice(1, -1))) {
            isValid = false;
            break;
          }
        } else {
          // Opening tag
          stack.push(tag);
        }
      }

      if (!isValid || stack.length > 0) {
        // If tags are not properly nested, fall back to simpler formatting
        console.log('Invalid HTML tags detected, falling back to simple formatting');
        return this.simpleFormatting(text);
      }

      return formatted;
    } catch (error) {
      console.error('Error formatting response:', error);
      return this.simpleFormatting(text);
    }
  }

  private simpleFormatting(text: string): string {
    // Simple, safe formatting that avoids HTML tag issues
    return text
      .replace(/^### (.*?)$/gm, '▶ $1')
      .replace(/^## (.*?)$/gm, '▶ $1')
      .replace(/^# (.*?)$/gm, '▶ $1')
      .replace(/\*\*(.*?)\*\*/g, '▶ $1 ◀')
      .replace(/\*(.*?)\*/g, '• $1 •')
      .replace(/^> (.*?)$/gm, '  » $1')
      .replace(/^\d\. /gm, '• ')
      .replace(/^- /gm, '• ')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();
  }

  public async startAllAgents() {
    console.log('\n=== Starting All Agents ===');
    
    try {
      // Initialize all agents first
      for (const [name, info] of this.agents) {
        try {
          console.log(`Starting ${name} agent...`);
          await info.agent.setupHandlers();
          info.isRunning = true;
          console.log(`✓ ${name} agent started successfully`);
        } catch (error) {
          console.error(`❌ Error starting ${name} agent:`, error);
          throw error;
        }
      }

      // Start the bot with error handling and retries
      console.log('\nStarting bot...');
      try {
        await this.bot.start({
          onStart: () => {
            console.log('✓ Bot started successfully');
          },
          drop_pending_updates: true, // Drop any pending updates to avoid conflicts
          allowed_updates: ['message', 'callback_query'], // Only listen for specific updates
          timeout: 30, // Reduce timeout for faster error detection
        });
      } catch (error: any) {
        // Check if it's a conflict error (409)
        if (error.error_code === 409) {
          console.log('⚠️ Detected another bot instance running. Attempting to stop and restart...');
          
          // Wait a bit for the other instance to potentially clear
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Try to stop the bot if it's running
          try {
            await this.bot.stop();
          } catch (stopError) {
            console.error('Error stopping bot:', stopError);
          }
          
          // Try to start again with cleared updates
          console.log('Attempting to restart bot...');
          await this.bot.start({
            drop_pending_updates: true,
            allowed_updates: ['message', 'callback_query'],
            timeout: 30,
          });
        } else {
          // If it's not a conflict error, rethrow
          throw error;
        }
      }

      console.log('\n✓ All agents started successfully');
      this.setupShutdownHandlers();
    } catch (error) {
      console.error('\n❌ Failed to start all agents:', error);
      // Stop any agents that did start
      await this.stopAllAgents();
      throw error;
    }
  }

  public async stopAllAgents() {
    console.log('\n=== Stopping All Agents ===');
    try {
      // Stop the bot instance with a timeout
      const stopTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Bot stop timeout')), 5000);
      });
      
      try {
        await Promise.race([
          this.bot.stop(),
          stopTimeout
        ]);
        console.log('✓ Bot stopped successfully');
      } catch (error) {
        console.warn('⚠️ Bot stop timed out or failed:', error);
      }

      // Mark all agents as stopped
      for (const [name, info] of this.agents) {
        info.isRunning = false;
        console.log(`✓ ${name} agent marked as stopped`);
      }
    } catch (error) {
      console.error('❌ Error stopping agents:', error);
      throw error;
    }
  }

  private setupShutdownHandlers() {
    console.log('\n=== Setting up shutdown handlers ===');
    
    process.on('SIGTERM', async () => {
      console.log('\nReceived SIGTERM signal');
      await this.stopAllAgents();
      process.exit(0);
    });

    process.on('SIGINT', async () => {
      console.log('\nReceived SIGINT signal');
      await this.stopAllAgents();
      process.exit(0);
    });

    console.log('Shutdown handlers configured');
  }

  private isOpinionQuery(text: string): boolean {
    const lowerText = text.toLowerCase().trim();

    // First, check if it's a simple interaction
    const simpleCheck = this.isSimpleInteraction(text);
    if (simpleCheck.isSimple) {
      return false;
    }

    // Get the OpinionAgent instance
    const opinionAgent = this.agents.get('opinion')?.agent as OpinionAgent;
    if (!opinionAgent) {
      return false;
    }

    // Check if the text contains any of the keywords from OpinionAgent
    const keywords = opinionAgent.getKeywords();
    return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
  }

  private hasIslamicContext(text: string): boolean {
    const lowerText = text.toLowerCase();
    const islamicTerms = [
      // Basic Islamic terms
      'islam', 'muslim', 'allah', 'nabi', 'rasul',
      'hukum', 'fatwa', 'syariah', 'shariah', 'fiqh',
      'hadith', 'sunnah', 'quran', 'dalil', 'mazhab',
      
      // Practices
      'solat', 'sembahyang', 'puasa', 'zakat', 'haji',
      'umrah', 'doa', 'sedekah', 'ibadah', 'wudhu',
      'wudu', 'aurat', 'halal', 'haram',
      
      // Common phrases
      'insyaallah', 'alhamdulillah', 'subhanallah',
      'astaghfirullah', 'bismillah', 'mashaallah',
      
      // Malaysian Islamic context
      'jakim', 'mufti', 'masjid', 'surau', 'ustaz',
      'ustazah', 'madrasah', 'pondok', 'tahfiz',
      
      // Additional Islamic terms
      'syahadah', 'syahadat', 'tauhid', 'aqidah',
      'akhlak', 'adab', 'sunnah', 'wajib', 'makruh',
      'mubah', 'syirik', 'kufur', 'iman', 'taqwa'
    ];

    // Check if any Islamic term is present
    return islamicTerms.some(term => lowerText.includes(term));
  }

  private isSimpleInteraction(text: string): { isSimple: boolean; response?: string } {
    const lowerText = text.toLowerCase().trim();
    
    // Time-based greetings with proper type definition
    const timeGreetings: Record<string, string[]> = {
      morning: ['good morning', 'morning', 'selamat pagi', 'pagi'],
      afternoon: ['good afternoon', 'afternoon', 'selamat tengahari', 'tengahari'],
      evening: ['good evening', 'evening', 'selamat petang', 'petang'],
      night: ['good night', 'night', 'selamat malam', 'malam']
    };

    // Check time-based greetings first
    for (const [timeOfDay, greetings] of Object.entries(timeGreetings)) {
      if (greetings.some(g => lowerText.includes(g))) {
        return {
          isSimple: true,
          response: `Waalaikumussalam! ${timeOfDay === 'night' ? 'Good night!' : 'How can I help you today?'}`
        };
      }
    }
    
    // Basic greetings and common phrases
    const greetings = [
      'hi', 'hello', 'hey', 'assalamualaikum', 'salam',
      // Malay greetings and common phrases
      'apa khabar', 'apa kabar', 'apa macam',
      'sihat?', 'sihat ke', 'sihat tak',
      'macam mana', 'cemana', 'camne',
      'hai', 'helo', 'oi', 'weh'
    ];
    if (greetings.some(greeting => lowerText.includes(greeting))) {
      return {
        isSimple: true,
        response: 'Waalaikumussalam! Alhamdulillah, I\'m doing well. How can I help you today?'
      };
    }

    // Thanks
    const thanks = [
      'thank', 'thanks', 'terima kasih', 'tq', 'tenkiu',
      'tq ye', 'thank you', 'thanks ye', 'terima kasih ye'
    ];
    if (thanks.some(t => lowerText.includes(t))) {
      return {
        isSimple: true,
        response: 'You\'re welcome! Feel free to ask if you have any questions.'
      };
    }

    // Test messages
    const testMessages = ['test', 'testing', 'check', 'cuba', 'try'];
    if (testMessages.some(t => lowerText === t)) {
      return {
        isSimple: true,
        response: 'Yes, I\'m here and working properly. How can I assist you?'
      };
    }

    // Introduction requests - check these patterns first as they're more specific
    const introPatterns = [
      'who are you', 'who r u', 'who are u', 'who r you',
      'siapa kamu', 'siapa anda', 'siapa awak',
      'intro', 'introduce', 'perkenal', 'kenalkan',
      'intro sikit', 'cerita sikit', 'tell me about yourself',
      'what is your name', 'apa nama', 'nama apa',
      'what are you', 'apa kamu', 'apa awak'
    ];
    
    // Use more flexible matching for intro patterns
    if (introPatterns.some(pattern => {
      // Exact match
      if (lowerText === pattern) return true;
      // Contains pattern
      if (lowerText.includes(pattern)) return true;
      // Special case for "who are you" variations
      if (pattern.startsWith('who are') && lowerText.match(/\bwho\s+(?:are|r)\s*(?:you|u)\b/)) return true;
      return false;
    })) {
      return {
        isSimple: true,
        response: `Assalamualaikum! I am Tok Ayah, an Islamic knowledge assistant that specializes in Malaysian Islamic context. I can help you with:

• Questions about Islamic rulings (fatwa)
• Understanding different mazhab perspectives
• Information about JAKIM guidelines
• Malaysian Islamic practices and customs
• Comprehensive analysis of Islamic topics

Feel free to ask me any questions about Islamic matters, and I'll do my best to help you understand them from various authentic perspectives.`
      };
    }

    // Bot capability questions
    const capabilityPatterns = [
      'what can you do', 'what do you do', 'apa you boleh buat',
      'how to use', 'macam mana nak guna', 'cara guna',
      'help', 'tolong', 'bantuan', 'command', 'arahan',
      'how does this work', 'how do you work',
      'what are your functions', 'apa fungsi'
    ];
    if (capabilityPatterns.some(pattern => lowerText.includes(pattern))) {
      return {
        isSimple: true,
        response: `I can help you in several ways:

1. Direct commands:
/fatwa - Get fatwa rulings
/mazhab - Learn about different mazhab views
/jakim - Get JAKIM guidelines
/malaysianfatwa - Access Malaysian fatwa decisions
/ibadah - Learn about Islamic practices

2. Natural conversations:
Just mention "tok ayah" in your message and ask your question naturally in English or Malay.

For example:
• "tok ayah, apa hukum..."
• "tok ayah, what is the ruling on..."
• "tok ayah, boleh terangkan tentang..."

I'll analyze your question and provide a comprehensive response considering various Islamic perspectives.`
      };
    }

    // Status checks
    const statusChecks = [
      'are you there', 'you there', 'ada tak', 'ada ke',
      'you ok', 'ok tak', 'working', 'can you hear',
      'masih ada', 'masih hidup', 'tok ayah ada', 'tok ayah?'
    ];
    if (statusChecks.some(check => lowerText.includes(check))) {
      return {
        isSimple: true,
        response: 'Yes, I\'m here and ready to help! What would you like to know?'
      };
    }

    return { isSimple: false };
  }

  private async replyWithFormattedResponse(ctx: Context, response: string) {
    try {
      const formattedResponse = this.formatResponseForTelegram(response);
      const chunks = this.splitResponse(formattedResponse);
      
      for (const chunk of chunks) {
        await ctx.reply(chunk, {
          reply_to_message_id: ctx.message?.message_id,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      console.error('Error sending formatted response:', error);
      await ctx.reply('I apologize, but I encountered an error while formatting the response.');
    }
  }
} 