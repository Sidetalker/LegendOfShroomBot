const { OpenAI } = require('openai');

class DeepseekChat {
    constructor() {
        const apiKey = process.env.DEEPSEEK_API_KEY;
        if (!apiKey) {
            throw new Error('DEEPSEEK_API_KEY is required in environment variables');
        }

        this.client = new OpenAI({
            apiKey,
            baseURL: 'https://api.deepseek.com/v1'
        });
    }

    async chat(messages) {
        try {
            console.log('Sending messages to Deepseek:', JSON.stringify(messages, null, 2));
            
            const response = await this.client.chat.completions.create({
                model: 'deepseek-chat',
                messages,
                temperature: 0.7,
                max_tokens: 150,  // Keep responses concise
                presence_penalty: 0.6,  // Encourage varied responses
                frequency_penalty: 0.3   // Reduce repetition
            });

            console.log('Received response from Deepseek:', response.choices[0].message);
            return response.choices[0].message.content;
        } catch (error) {
            console.error('Error in DeepseekChat:', error);
            if (error.response) {
                console.error('API response:', error.response.data);
            }
            return "Sorry, I'm having trouble thinking right now.";
        }
    }
}

module.exports = { DeepseekChat }; 