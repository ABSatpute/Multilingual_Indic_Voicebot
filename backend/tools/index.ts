import { Tool, ToolExecutionContext } from './Tool';
import { RAGKnowledgeBaseTool } from './RAGKnowledgeBaseTool';

export { Tool, ToolExecutionContext };

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async execute(name: string, params: unknown, context?: ToolExecutionContext): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute(params, context);
  }

  getToolSpecs() {
    return Array.from(this.tools.values()).map(tool => ({
      toolSpec: {
        name: tool.name,
        description: tool.description,
        inputSchema: { json: JSON.stringify(tool.inputSchema) },
      },
    }));
  }
}

export function createDefaultToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(RAGKnowledgeBaseTool);
  return registry;
}
