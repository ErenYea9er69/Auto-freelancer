import OpenAI from 'openai';

let openaiInstance: OpenAI | null = null;

export async function generateResponse(prompt: string, history: any[], tools: any[], apiKey: string, apiBaseUrl: string = 'https://api.longcat.chat/openai', modelName: string = 'LongCat-Flash-Thinking-2601', onChunk?: (text: string) => void) {
    if (!apiKey) {
        throw new Error("No API Key provided. Please configure your API Key in VS Code settings.");
    }

    if (!openaiInstance || openaiInstance.apiKey !== apiKey || openaiInstance.baseURL !== apiBaseUrl) {
        openaiInstance = new OpenAI({
            apiKey: apiKey,
            baseURL: apiBaseUrl,
        });
    }
    
    const openai = openaiInstance;

    // Map Gemini-style history to OpenAI format
    const messages: any[] = history.map(h => {
        if (h.role === 'user') {
            if (h.parts[0].text) return { role: 'user', content: h.parts[0].text };
            if (h.parts[0].functionResponse) {
                return {
                    role: 'tool',
                    tool_call_id: h.parts[0].functionResponse.id || ("call_" + h.parts[0].functionResponse.name + "_" + Math.random().toString(36).substring(7)), 
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
                        id: h.parts[0].functionCall.id || ("call_" + h.parts[0].functionCall.name + "_" + Math.random().toString(36).substring(7)),
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
        const stream = await openai.chat.completions.create({
            model: modelName,
            messages: messages as any,
            tools: openAiTools.length > 0 ? (openAiTools as any) : undefined,
            stream: true,
            stream_options: { include_usage: true } as any
        });

        let fullContent = "";
        let toolCallParams: any = null;
        let finalUsage: any = null;

        for await (const chunk of stream) {
            const delta = chunk.choices && chunk.choices[0] ? chunk.choices[0].delta : null;
            if (delta?.content) {
                fullContent += delta.content;
                if (onChunk) onChunk(delta.content);
            }
            if (delta?.tool_calls) {
                const tc = delta.tool_calls[0];
                if (tc.function?.name) {
                    toolCallParams = { id: tc.id, name: tc.function.name, arguments: tc.function.arguments || "" };
                } else if (tc.function?.arguments && toolCallParams) {
                    toolCallParams.arguments += tc.function.arguments;
                }
            }
            if ((chunk as any).usage) {
                finalUsage = (chunk as any).usage;
            }
        }
        
        // Map back to Gemini-like response format for agent.ts compatibility
        const result: any = { text: fullContent, usage: finalUsage };
        if (toolCallParams) {
            result.functionCalls = [{
                id: toolCallParams.id,
                name: toolCallParams.name,
                args: JSON.parse(toolCallParams.arguments)
            }];
        }
        
        return result;
    } catch (error) {
        console.error("LLM Error:", error);
        throw error;
    }
}
