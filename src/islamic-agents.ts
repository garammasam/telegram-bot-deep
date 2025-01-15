import { Bot, Context } from 'grammy';
import axios from 'axios';

interface AgentConfig {
  telegramToken: string;
  deepseekKey: string;
  groupIds: string[];
  responseThreshold: number;
  messageHistory: Map<string, any>;
}

interface AgentResponse {
  type: string;
  response: string;
}

interface DeepseekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export abstract class BaseIslamicAgent {
  protected bot: Bot;
  protected config: AgentConfig;
  protected deepseekClient;

  constructor(config: AgentConfig, bot: Bot) {
    this.config = config;
    this.bot = bot;
    this.deepseekClient = axios.create({
      baseURL: 'https://api.deepseek.com/v1',
      headers: {
        'Authorization': `Bearer ${config.deepseekKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  abstract setupHandlers(): Promise<void>;
  protected abstract getSystemPrompt(): string;
  public abstract getKeywords(): string[];
  protected abstract getTopics(): string[];

  public async shouldRespond(message: string): Promise<boolean> {
    try {
      const response = await this.createChatCompletion([
        {
          role: 'system',
          content: `You are an expert in determining if a question matches specific Islamic topics.
Given the following specialization:
Topics: ${this.getTopics().join(', ')}
Keywords: ${this.getKeywords().join(', ')}

Respond with a number between 0 and 1 indicating how relevant the question is to these topics.
Only respond with the number, nothing else.`
        },
        { role: 'user', content: message }
      ], 0.1, 10);

      const relevanceScore = parseFloat(response || '0');
      return relevanceScore >= this.config.responseThreshold;
    } catch (error) {
      console.error('Error checking relevance:', error);
      return false;
    }
  }

  protected async createChatCompletion(
    messages: DeepseekMessage[],
    temperature: number = 0.7,
    max_tokens: number = 1000
  ): Promise<string> {
    try {
      const { data } = await this.deepseekClient.post('/chat/completions', {
        model: 'deepseek-chat',
        messages,
        temperature,
        max_tokens
      });

      return data.choices[0]?.message?.content || '';
    } catch (error) {
      console.error('Error calling DeepSeek API:', error);
      throw error;
    }
  }

  public async generateResponse(question: string): Promise<string> {
    try {
      const response = await this.createChatCompletion([
        { role: 'system', content: this.getSystemPrompt() },
        { role: 'user', content: question }
      ]);

      return response || 'I apologize, but I could not generate a response at this time.';
    } catch (error) {
      console.error('Error generating response:', error);
      return 'I apologize, but I encountered an error while processing your question. Please try again later.';
    }
  }

  protected async replyWithFormattedResponse(ctx: Context, response: string) {
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

  protected formatResponseForTelegram(text: string): string {
    // Replace Markdown-style formatting with HTML
    let formatted = text
      // Headers
      .replace(/^### (.*$)/gm, '<b>$1</b>')
      .replace(/^## (.*$)/gm, '<b>$1</b>')
      .replace(/^# (.*$)/gm, '<b>$1</b>')
      
      // Bold
      .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
      
      // Italic
      .replace(/\*(.*?)\*/g, '<i>$1</i>')
      
      // Quotes
      .replace(/^> (.*$)/gm, '\n<i>$1</i>\n')
      
      // Lists
      .replace(/^\d\. /gm, '\n• ')
      .replace(/^- /gm, '\n• ')
      
      // Clean up multiple newlines
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    // Ensure proper spacing around HTML tags
    formatted = formatted
      .replace(/><\//g, '> </')
      .replace(/><b>/g, '> <b>')
      .replace(/><i>/g, '> <i>');

    return formatted;
  }

  protected splitResponse(text: string): string[] {
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
}

export class FatwaAgent extends BaseIslamicAgent {
  async setupHandlers(): Promise<void> {
    this.bot.command('fatwa', async (ctx: Context) => {
      const question = ctx.match?.toString();
      
      if (!question) {
        await ctx.reply('Please provide a question after the /fatwa command.');
        return;
      }

      if (!ctx.chat?.id) {
        await ctx.reply('This command can only be used in a group chat.');
        return;
      }

      const response = await this.generateResponse(question);
      await this.replyWithFormattedResponse(ctx, response);
    });
  }

  public getKeywords(): string[] {
    return [
      'fatwa', 'ruling', 'halal', 'haram', 'permissible', 'forbidden',
      'islamic law', 'shariah', 'syariah', 'hukum', 'dalil',
      'quran', 'hadith', 'sunnah', 'islamic ruling'
    ];
  }

  protected getTopics(): string[] {
    return [
      'General Islamic rulings',
      'Malaysian Islamic context',
      'Sharia compliance',
      'Islamic guidance',
      'Religious verdicts',
      'Islamic principles'
    ];
  }

  protected getSystemPrompt(): string {
    return `You are a knowledgeable Islamic scholar well-versed in Malaysian Islamic context.
Your role is to provide accurate Islamic guidance while:
- Primarily referencing Shafi'i mazhab rulings
- Considering Malaysian context and local customs
- Citing relevant Quran verses and Hadith (always in italics)
- Mentioning relevant Malaysian fatwa when applicable
- Being respectful and clear in explanations
- Acknowledging when a question needs official fatwa ruling

Format your responses using these rules:
1. Use ### for section headers
2. Use ** for bold text (important terms, rulings, conclusions)
3. Use * for italic text (quotes, Arabic terms)
4. Use > for Quran verses and Hadith
5. Use - or 1. for lists
6. Structure your response with clear sections:
   - Main ruling or answer
   - Evidence (Quran, Hadith, Scholarly opinions)
   - Malaysian context
   - Conclusion`;
  }
}

export class MazhabAgent extends BaseIslamicAgent {
  async setupHandlers(): Promise<void> {
    this.bot.command('mazhab', async (ctx: Context) => {
      const question = ctx.match?.toString();
      
      if (!question) {
        await ctx.reply('Please provide a question after the /mazhab command.');
        return;
      }

      if (!ctx.chat?.id) {
        await ctx.reply('This command can only be used in a group chat.');
        return;
      }

      const response = await this.generateResponse(question);
      await this.replyWithFormattedResponse(ctx, response);
    });
  }

  public getKeywords(): string[] {
    return [
      'mazhab', 'shafi\'i', 'hanafi', 'maliki', 'hanbali',
      'school of thought', 'imam shafi\'i', 'fiqh', 'usul fiqh',
      'comparative fiqh', 'ikhtilaf', 'difference of opinion'
    ];
  }

  protected getTopics(): string[] {
    return [
      'Shafi\'i school of thought',
      'Comparative Islamic jurisprudence',
      'Mazhab differences',
      'Fiqh rulings',
      'Islamic legal methodology'
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert in Shafi'i mazhab, the predominant school of thought in Malaysia.
Your role is to:
- Explain Shafi'i rulings on various matters
- Compare with other mazhabs when relevant
- Provide evidence from authenticated sources
- Consider Malaysian context in explanations
- Highlight differences in rulings between mazhabs when applicable

Format your responses using these rules:
1. Use ### for section headers
2. Use ** for bold text (important terms, rulings, conclusions)
3. Use * for italic text (quotes, Arabic terms)
4. Use > for Quran verses and Hadith
5. Use - or 1. for lists
6. Structure your response with clear sections:
   - Main ruling or answer
   - Evidence (Quran, Hadith, Scholarly opinions)
   - Malaysian context
   - Conclusion`;
  }
}

export class JakimAgent extends BaseIslamicAgent {
  async setupHandlers(): Promise<void> {
    this.bot.command('jakim', async (ctx: Context) => {
      const question = ctx.match?.toString();
      
      if (!question) {
        await ctx.reply('Please provide a question after the /jakim command.');
        return;
      }

      if (!ctx.chat?.id) {
        await ctx.reply('This command can only be used in a group chat.');
        return;
      }

      const response = await this.generateResponse(question);
      await this.replyWithFormattedResponse(ctx, response);
    });
  }

  public getKeywords(): string[] {
    return [
      'jakim', 'halal certification', 'malaysian islamic development',
      'jabatan kemajuan islam malaysia', 'halal logo', 'halal status',
      'islamic administration', 'halal certificate', 'halal requirements'
    ];
  }

  protected getTopics(): string[] {
    return [
      'JAKIM administration',
      'Halal certification',
      'Malaysian Islamic regulations',
      'Official Islamic guidelines',
      'Halal compliance',
      'Islamic development in Malaysia'
    ];
  }

  protected getSystemPrompt(): string {
    return `You are a JAKIM (Jabatan Kemajuan Islam Malaysia) specialist.
Your role is to:
- Provide information about JAKIM guidelines and regulations
- Explain halal certification processes
- Address questions about Malaysian Islamic administration
- Reference official JAKIM statements and documents
- Guide users to relevant JAKIM resources and services

Format your responses using these rules:
1. Use ### for section headers
2. Use ** for bold text (important terms, rulings, conclusions)
3. Use * for italic text (quotes, Arabic terms)
4. Use > for Quran verses and Hadith
5. Use - or 1. for lists
6. Structure your response with clear sections:
   - Main guideline or answer
   - Official references
   - Practical steps
   - Additional resources`;
  }
}

export class MalaysianFatwaAgent extends BaseIslamicAgent {
  async setupHandlers(): Promise<void> {
    this.bot.command('malaysianfatwa', async (ctx: Context) => {
      const question = ctx.match?.toString();
      
      if (!question) {
        await ctx.reply('Please provide a question after the /malaysianfatwa command.');
        return;
      }

      if (!ctx.chat?.id) {
        await ctx.reply('This command can only be used in a group chat.');
        return;
      }

      const response = await this.generateResponse(question);
      await this.replyWithFormattedResponse(ctx, response);
    });
  }

  public getKeywords(): string[] {
    return [
      'malaysian fatwa', 'state fatwa', 'national fatwa council',
      'majlis fatwa', 'mufti', 'malaysian islamic ruling',
      'state islamic authority', 'fatwa committee'
    ];
  }

  protected getTopics(): string[] {
    return [
      'Malaysian fatwa rulings',
      'State-specific Islamic rulings',
      'National Fatwa Council decisions',
      'Malaysian Islamic legal opinions',
      'State Mufti declarations'
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert in Malaysian Islamic fatwa.
Your role is to:
- Reference decisions by the National Fatwa Council
- Consider state-specific fatwa rulings
- Explain the context and reasoning behind fatwa decisions
- Highlight differences between state fatwa when applicable
- Guide users on finding official fatwa resources

Format your responses using these rules:
1. Use ### for section headers
2. Use ** for bold text (important terms, rulings, conclusions)
3. Use * for italic text (quotes, Arabic terms)
4. Use > for Quran verses and Hadith
5. Use - or 1. for lists
6. Structure your response with clear sections:
   - Main fatwa ruling
   - Supporting evidence
   - State variations
   - Practical implementation`;
  }
}

export class IbadhahAgent extends BaseIslamicAgent {
  async setupHandlers(): Promise<void> {
    this.bot.command('ibadah', async (ctx: Context) => {
      const question = ctx.match?.toString();
      
      if (!question) {
        await ctx.reply('Please provide a question after the /ibadah command.');
        return;
      }

      if (!ctx.chat?.id) {
        await ctx.reply('This command can only be used in a group chat.');
        return;
      }

      const response = await this.generateResponse(question);
      await this.replyWithFormattedResponse(ctx, response);
    });
  }

  public getKeywords(): string[] {
    return [
      'ibadah', 'worship', 'prayer', 'solat', 'puasa', 'fasting',
      'zakat', 'hajj', 'umrah', 'malaysian customs', 'adat',
      'local practices', 'cultural islam', 'traditional practices'
    ];
  }

  protected getTopics(): string[] {
    return [
      'Islamic worship practices',
      'Malaysian Muslim customs',
      'Local religious traditions',
      'Cultural Islamic practices',
      'Religious rituals in Malaysia'
    ];
  }

  protected getSystemPrompt(): string {
    return `You are an expert in Malaysian Islamic customs and practices.
Your role is to:
- Address questions about local Islamic practices
- Explain the permissibility of Malaysian customs
- Reference relevant fatwa on cultural practices
- Consider both Islamic principles and local context
- Guide on proper conduct of Islamic practices in Malaysian setting

Format your responses using these rules:
1. Use ### for section headers
2. Use ** for bold text (important terms, rulings, conclusions)
3. Use * for italic text (quotes, Arabic terms)
4. Use > for Quran verses and Hadith
5. Use - or 1. for lists
6. Structure your response with clear sections:
   - Main practice explanation
   - Islamic basis
   - Local customs
   - Proper implementation`;
  }
}

export class OpinionAgent extends BaseIslamicAgent {
  private otherAgents: BaseIslamicAgent[];

  constructor(config: AgentConfig, bot: Bot, otherAgents: BaseIslamicAgent[]) {
    super(config, bot);
    this.otherAgents = otherAgents;
  }

  async setupHandlers(): Promise<void> {
    this.bot.command('opinion', async (ctx: Context) => {
      const question = ctx.match?.toString();
      
      if (!question) {
        await ctx.reply('Please provide a question after the /opinion command.');
        return;
      }

      if (!ctx.chat?.id) {
        await ctx.reply('This command can only be used in a group chat.');
        return;
      }

      const response = await this.generateResponse(question);
      await this.replyWithFormattedResponse(ctx, response);
    });
  }

  public getKeywords(): string[] {
    return [
      // English opinion keywords
      'opinion', 'view', 'perspective', 'think', 'consider',
      'analysis', 'evaluate', 'assessment', 'stance', 'position',
      'comprehensive', 'overall', 'complete', 'thorough',
      // Malay opinion keywords
      'pendapat', 'pandangan', 'fikir', 'rasa', 'bagaimana',
      'macam mana', 'apa kata', 'berkenaan', 'tentang', 'pasal',
      'mengenai', 'berkaitan', 'fikiran', 'pertimbangan', 'pendirian',
      'hukum', 'dalil', 'fatwa'
    ];
  }

  protected getTopics(): string[] {
    return [
      // English topics
      'Islamic opinions',
      'Comprehensive analysis',
      'Multiple perspectives',
      'Balanced view',
      'Thorough evaluation',
      // Malay topics
      'Pandangan Islam',
      'Analisis komprehensif',
      'Pelbagai perspektif',
      'Pandangan seimbang',
      'Penilaian menyeluruh'
    ];
  }

  public async shouldRespond(message: string): Promise<boolean> {
    // Always return true for opinion agent as it should handle all natural language queries
    return true;
  }

  public override async generateResponse(question: string): Promise<string> {
    try {
      console.log('=== Generating Comprehensive Opinion ===');
      console.log('Question:', question);
      
      // Get responses from all agents regardless of relevance
      console.log('Collecting responses from all specialized agents...');
      const agentResponses: AgentResponse[] = await Promise.all(
        this.otherAgents.map(async (agent, index) => {
          const agentType = this.getAgentType(index);
          console.log(`Requesting response from ${agentType}...`);
          const response = await agent.generateResponse(question);
          console.log(`Received response from ${agentType}`);
          return {
            type: agentType,
            response: response
          };
        })
      );

      console.log('All agent responses collected. Preparing synthesis...');

      // Combine all perspectives for the synthesis
      const perspectives = agentResponses.map(({ type, response }) => {
        // Clean up the response to remove any existing formatting
        const cleanedResponse = response
          .replace(/^###.*$/gm, '')  // Remove existing headers
          .split('\n')
          .filter(line => line.trim().length > 0)  // Remove empty lines
          .join('\n');
        
        return `${type}:\n${cleanedResponse}`;
      }).join('\n\n');

      console.log('Synthesizing comprehensive opinion...');

      // Use AI to synthesize a comprehensive opinion
      const response = await this.createChatCompletion([
        { 
          role: 'system', 
          content: this.getSystemPrompt() 
        },
        {
          role: 'user',
          content: `Analyze this question from multiple Islamic perspectives and provide a comprehensive response:

Question: ${question}

Here are the different perspectives to consider:

${perspectives}

Please synthesize these viewpoints into a well-structured response that addresses all aspects of the question.`
        }
      ], 0.7, 2000);

      console.log('Successfully generated comprehensive opinion');
      return response || 'I apologize, but I could not generate a comprehensive opinion at this time.';
    } catch (error) {
      console.error('Error generating comprehensive opinion:', error);
      return 'I apologize, but I encountered an error while processing your question. Please try again later.';
    }
  }

  private getAgentType(index: number): string {
    const types = [
      'Fatwa Perspective',
      'Mazhab Analysis',
      'JAKIM Guidelines',
      'Malaysian Fatwa Council View',
      'Islamic Practice Context'
    ];
    return types[index] || 'Additional Perspective';
  }

  protected getSystemPrompt(): string {
    return `You are an expert Islamic scholar tasked with synthesizing multiple perspectives into a comprehensive opinion.
Your role is to:
- Analyze and combine different Islamic viewpoints
- Consider fatwa rulings, mazhab differences, and local context
- Highlight areas of agreement and disagreement
- Provide a balanced and well-reasoned conclusion
- Acknowledge complexity when present
- Maintain respect for differing opinions

When synthesizing the perspectives:
- Give equal consideration to all viewpoints
- Identify common threads and principles
- Note any regional or contextual factors specific to Malaysia
- Provide practical guidance for implementation
- Reference relevant Quran verses and Hadith when applicable
- Acknowledge areas where further scholarly consultation may be needed

Respond in the same language as the question (Malay or English).
For Malay questions, use appropriate Islamic terminology in Malay.

Format your responses using these rules:
1. Use ### for section headers
2. Use ** for bold text (important terms, rulings, conclusions)
3. Use * for italic text (quotes, Arabic terms)
4. Use > for Quran verses and Hadith
5. Use - or 1. for lists
6. Structure your response with clear sections:
   ### Summary of Perspectives
   [Brief overview of all viewpoints]

   ### Key Points of Agreement
   [Areas where all or most perspectives align]

   ### Important Considerations
   [Critical factors and nuances to consider]

   ### Malaysian Context
   [Specific relevance to Malaysian Muslims]

   ### Practical Implementation
   [How to apply this guidance in daily life]

   ### Comprehensive Conclusion
   [Final synthesized opinion with key recommendations]`;
  }
} 