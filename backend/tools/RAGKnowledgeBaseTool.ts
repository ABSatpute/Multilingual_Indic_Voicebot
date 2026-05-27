/**
 * RAG Knowledge Base Tool - Queries AWS Bedrock Knowledge Base
 */

import { Tool, ToolExecutionContext } from './Tool';
import { 
    BedrockAgentRuntimeClient, 
    RetrieveAndGenerateCommand,
    RetrieveAndGenerateCommandInput
} from '@aws-sdk/client-bedrock-agent-runtime';

// Configuration - Update these with your KB details
const KB_REGION = process.env.KB_REGION || 'ap-south-1';
const KB_KNOWLEDGE_BASE_ID = process.env.KB_KNOWLEDGE_BASE_ID || 'KYSHCFGHSC';
const KB_MODEL_ARN = process.env.KB_MODEL_ARN || 'arn:aws:bedrock:ap-south-1:968396880463:inference-profile/apac.amazon.nova-micro-v1:0';
const KB_CHUNK_CONFIDENCE_THRESHOLD = parseFloat(process.env.KB_CHUNK_CONFIDENCE_THRESHOLD || '0.8');
const KB_MIN_HIGH_CONFIDENCE_CHUNKS = parseInt(process.env.KB_MIN_HIGH_CONFIDENCE_CHUNKS || '1');

const KB_SYSTEM_PROMPT = `You are a retrieval assistant for Jain Sales Corporation. Your job is to extract and return the exact answer from the knowledge base context below.

$search_results$

CRITICAL RULES:
1. Answer using ONLY the information in the context above. No external knowledge.
2. Format your answer as SHORT, NATURAL SPOKEN SENTENCES — as if speaking on a phone call.
3. NO bullet points, NO numbered lists, NO asterisks, NO markdown, NO headers, NO quotes.
4. Include exact product names, model types, series names exactly as written in the context.
5. Keep the answer under 3 sentences. Be direct and specific.
6. If the context contains ANY relevant information about the question, provide an answer.
7. ONLY respond with "NO_INFORMATION_FOUND" if the context is completely unrelated to the question.
8. Do not say "according to the documentation" or "based on the context" — just answer directly.
9. Do not wrap your answer in quotation marks.

Example of GOOD format (spoken, natural):
"For borewell applications, Kirloskar offers the KS7 series for 7 inch borewells, the KS9 series for 9 inch borewells, and the KP3S series for 3 inch borewells."

Example of BAD format (do not do this):
"* 7 inch Borewell Submersible (Type: KS7)\\n* 9 inch Borewell (Type: KS9)"
`;

// Initialize Bedrock Agent Runtime client
const bedrockAgentClient = new BedrockAgentRuntimeClient({ region: KB_REGION });

interface RAGToolInput {
    query: string;
    language?: string;
}

export const RAGKnowledgeBaseTool: Tool = {
    name: 'search_knowledge_base',
    description: `Call this tool for ANY question about which product to use, product recommendations, specifications, or technical details.

ALWAYS call this tool when customer asks:
- "Which pump for..." (borewell, domestic, irrigation, etc.)
- "What type of pump for..." (any application)
- "Which motor/cable/pipe for..."
- Product specifications, models, or series
- Pricing or availability
- Brand recommendations

DO NOT call for:
- Company information (location, experience, brands we carry)
- Greetings ("hello", "namaste")
- Contact details (phone numbers, address)

If unsure whether to call - CALL THE TOOL. Better to call unnecessarily than to answer from memory.`,

    inputSchema: {
        type: 'object',
        properties: {
            query: {
                type: 'string',
                description: 'The customer\'s question or search query in their original language (English/Hindi/Hinglish)'
            },
            language: {
                type: 'string',
                enum: ['english', 'hindi', 'hinglish'],
                description: 'The language of the query for better context'
            }
        },
        required: ['query']
    },

    async execute(params: unknown, context?: ToolExecutionContext): Promise<unknown> {
        const input = params as RAGToolInput;
        
        if (!input.query || typeof input.query !== 'string') {
            return {
                error: 'Invalid input: query is required and must be a string'
            };
        }

        try {
            console.log(`[RAG Tool] Querying Knowledge Base with: "${input.query}"`);

            // Use RetrieveAndGenerate for better accuracy
            const commandInput: RetrieveAndGenerateCommandInput = {
                input: {
                    text: input.query
                },
                retrieveAndGenerateConfiguration: {
                    type: 'KNOWLEDGE_BASE',
                    knowledgeBaseConfiguration: {
                        knowledgeBaseId: KB_KNOWLEDGE_BASE_ID,
                        modelArn: KB_MODEL_ARN,
                        generationConfiguration: {
                            promptTemplate: {
                                textPromptTemplate: KB_SYSTEM_PROMPT
                            }
                        },
                        retrievalConfiguration: {
                            vectorSearchConfiguration: {
                                numberOfResults: 5,
                                overrideSearchType: 'SEMANTIC'
                            }
                        }
                    }
                }
            };

            const command = new RetrieveAndGenerateCommand(commandInput);
            const response = await bedrockAgentClient.send(command);

            if (!response.output?.text) {
                throw new Error('No response from Knowledge Base');
            }

            // Remove quotes from answer
            let answer = response.output.text.trim().replace(/^["']|["']$/g, '');

            // Check if no information found
            if (answer === 'NO_INFORMATION_FOUND') {
                console.log('[RAG Tool] KB returned NO_INFORMATION_FOUND');
                return {
                    answer: null,
                    noInformation: true,
                    fallback: 'I don\'t have that specific information in our system right now. Let me check with our technical team and get back to you with the exact details.'
                };
            }

            console.log(`[RAG Tool] Retrieved answer from KB (${answer.length} chars)`);

            return {
                answer: answer,
                fromKnowledgeBase: true
            };

        } catch (error) {
            console.error('[RAG Tool] Error querying knowledge base:', error);
            
            return {
                error: 'Unable to query knowledge base at this time',
                details: error instanceof Error ? error.message : String(error),
                fallback: 'I\'ll check with our technical team and get back to you with the exact details.'
            };
        }
    }
};
