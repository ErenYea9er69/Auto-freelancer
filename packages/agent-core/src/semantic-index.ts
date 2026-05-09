import * as fs from 'fs/promises';
import * as path from 'path';
import Fuse from 'fuse.js';

interface CodeSnippet {
    filePath: string;
    content: string;
}

export class SemanticSoul {
    private workspaceRoot: string;
    private index: CodeSnippet[] = [];
    private fuse: Fuse<CodeSnippet> | null = null;
    public isReady = false;

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
    }

    async buildIndex() {
        console.log('[Semantic Soul] Building vector-like fuzzy index...');
        await this.scanDirectory(this.workspaceRoot);
        
        this.fuse = new Fuse(this.index, {
            keys: ['filePath', 'content'],
            includeScore: true,
            threshold: 0.4, // Fuzzy matching threshold
            ignoreLocation: true
        });
        
        this.isReady = true;
        console.log(`[Semantic Soul] Index built with ${this.index.length} files.`);
    }

    private async scanDirectory(dir: string) {
        try {
            const entries = await fs.readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist' || entry.name === 'build') {
                    continue; // Skip heavy/ignored dirs
                }
                
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    await this.scanDirectory(fullPath);
                } else if (entry.isFile()) {
                    // Only index text-based code files
                    if (!fullPath.match(/\.(ts|tsx|js|jsx|css|json|md|html)$/)) continue;
                    
                    try {
                        const content = await fs.readFile(fullPath, 'utf-8');
                        // Store limited content to prevent massive memory usage
                        this.index.push({
                            filePath: path.relative(this.workspaceRoot, fullPath),
                            content: content.substring(0, 5000)
                        });
                    } catch (e) {
                        // Ignore read errors
                    }
                }
            }
        } catch (e) {
            console.error('[Semantic Soul] Error scanning dir:', dir, e);
        }
    }

    async search(query: string) {
        if (!this.fuse) return "Index not ready.";
        const results = this.fuse.search(query, { limit: 5 });
        
        if (results.length === 0) return "No relevant files found.";
        
        return results.map(r => `--- File: ${r.item.filePath} (Score: ${r.score}) ---\n${r.item.content.substring(0, 500)}...\n`).join('\n');
    }
}
