import { InferenceConfig } from '../types';

export interface ToolExecutionContext {
  inferenceConfig?: InferenceConfig;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute(params: unknown, context?: ToolExecutionContext): Promise<unknown>;
}
