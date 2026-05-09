import { GoogleGenAI } from '@google/genai';

// Requires process.env.GEMINI_API_KEY
const ai = new GoogleGenAI({});

export async function generateResponse(prompt: string, history: any[], tools: any[]) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
            config: {
                tools: [{ functionDeclarations: tools }],
                temperature: 0.2,
            }
        });
        
        return response;
    } catch (error) {
        console.error("LLM Error:", error);
        throw error;
    }
}
