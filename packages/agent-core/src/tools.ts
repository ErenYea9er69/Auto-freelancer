import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export const tools = {
    async readFile(filePath: string, workspaceRoot: string): Promise<string> {
        const fullPath = path.resolve(workspaceRoot, filePath);
        if (!fullPath.startsWith(workspaceRoot)) throw new Error("Access denied: path outside workspace");
        return await fs.readFile(fullPath, 'utf-8');
    },

    async writeFile(filePath: string, content: string, workspaceRoot: string): Promise<string> {
        const fullPath = path.resolve(workspaceRoot, filePath);
        if (!fullPath.startsWith(workspaceRoot)) throw new Error("Access denied: path outside workspace");
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, content, 'utf-8');
        return `Successfully wrote to ${filePath}`;
    },

    async listDirectory(dirPath: string, workspaceRoot: string): Promise<string> {
        const fullPath = path.resolve(workspaceRoot, dirPath);
        if (!fullPath.startsWith(workspaceRoot)) throw new Error("Access denied: path outside workspace");
        const files = await fs.readdir(fullPath);
        return files.join('\n');
    },

    async runCommand(command: string, cwd: string): Promise<string> {
        try {
            const { stdout, stderr } = await execAsync(command, { cwd });
            return stdout || stderr || "Command executed successfully with no output.";
        } catch (error: any) {
            return `Command failed: ${error.message}\nOutput: ${error.stdout || ''}\nError: ${error.stderr || ''}`;
        }
    },

    async gitCommit(branchName: string, message: string, workspaceRoot: string): Promise<string> {
        try {
            await execAsync(`git checkout -b ${branchName}`, { cwd: workspaceRoot });
            await execAsync(`git add .`, { cwd: workspaceRoot });
            const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: workspaceRoot });
            return `Successfully created branch ${branchName} and committed changes.\n${stdout}`;
        } catch (error: any) {
            return `Git command failed: ${error.message}`;
        }
    }
};

export const toolDefinitions = [
    {
        name: "readFile",
        description: "Read the contents of a file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file relative to the workspace root." }
            },
            required: ["filePath"]
        }
    },
    {
        name: "writeFile",
        description: "Write content to a file. Overwrites if it exists.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file relative to the workspace root." },
                content: { type: "string", description: "The content to write." }
            },
            required: ["filePath", "content"]
        }
    },
    {
        name: "listDirectory",
        description: "List the contents of a directory.",
        parameters: {
            type: "object",
            properties: {
                dirPath: { type: "string", description: "Directory path relative to the workspace root. Use '.' for root." }
            },
            required: ["dirPath"]
        }
    },
    {
        name: "runCommand",
        description: "Run a terminal command in the workspace.",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "The shell command to execute." }
            },
            required: ["command"]
        }
    },
    {
        name: "gitCommit",
        description: "Create a new git branch and commit all current changes.",
        parameters: {
            type: "object",
            properties: {
                branchName: { type: "string", description: "Name of the new branch." },
                message: { type: "string", description: "Commit message." }
            },
            required: ["branchName", "message"]
        }
    },
    {
        name: "delegateTask",
        description: "Spawn a specialized sub-agent to handle a specific part of the project in parallel.",
        parameters: {
            type: "object",
            properties: {
                agentName: { type: "string", description: "Name/Role of the sub-agent (e.g. 'frontend-dev', 'backend-dev'). Use short, descriptive names." },
                task: { type: "string", description: "Detailed description of what the sub-agent needs to accomplish." }
            },
            required: ["agentName", "task"]
        }
    }
];
