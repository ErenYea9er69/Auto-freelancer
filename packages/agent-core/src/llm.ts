import OpenAI from 'openai';

export async function generateResponse(prompt: string, history: any[], tools: any[], apiKey: string) {
    if (!apiKey) {
        throw new Error("No API Key provided. Please configure your LongCat AI API Key in VS Code settings.");
    }

    const openai = new OpenAI({
      apiKey: apiKey,
      baseURL: 'https://api.longcat.chat/openai',
    });

    // Map Gemini-style history to OpenAI format
    const messages: any[] = history.map(h => {
        if (h.role === 'user') {
            if (h.parts[0].text) return { role: 'user', content: h.parts[0].text };
            if (h.parts[0].functionResponse) {
                return {
                    role: 'tool',
                    tool_call_id: "call_" + h.parts[0].functionResponse.name, 
                    content: h.parts[0].functionResponse.response.result
                }
            }
        } else if (h.role === 'model') {
            if (h.parts[0].text) return { role: 'assistant', content: h.parts[0].text };
            if (h.parts[0].functionCall) {
                return {
                    role: 'assistant',
                    content: null,
                    tool_calls: [{
                        id: "call_" + h.parts[0].functionCall.name,
                        type: 'function',
                        function: {
                            name: h.parts[0].functionCall.name,
                            arguments: JSON.stringify(h.parts[0].functionCall.args)
                        }
                    }]
                }
            }
        }
        return { role: 'user', content: '' };
    });

    messages.push({ role: 'user', content: prompt });

    const openAiTools = tools.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters
        }
    }));

    try {
        const response = await openai.chat.completions.create({
            model: 'LongCat-2.0-Preview', // Strongest smartest LongCat model
            messages: messages as any,
            tools: openAiTools as any,
            temperature: 0.2,
        });

        const choice = response.choices[0].message;
        
        // Map back to Gemini-like response format for agent.ts compatibility
        const result: any = { text: choice.content };
        if (choice.tool_calls && choice.tool_calls.length > 0) {
            const toolCall = choice.tool_calls[0] as any;
            result.functionCalls = [{
                name: toolCall.function.name,
                args: JSON.parse(toolCall.function.arguments)
            }];
        }
        
        return result;
    } catch (error) {
        console.error("LLM Error:", error);
        throw error;
    }
}
