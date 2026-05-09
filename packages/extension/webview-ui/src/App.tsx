import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Code2, Zap, Settings2, Play, Square, Loader2, Check, X, FileDiff } from 'lucide-react'

// Define VS Code API type
declare global {
  interface Window {
    vscode: any;
    goalpilotConfig: {
      storagePath: string;
      userId: string;
      workspaceRoot: string;
      apiKey: string;
    };
  }
}

function App() {
  const [task, setTask] = useState('')
  const [status, setStatus] = useState<'idle' | 'running' | 'completed'>('idle')
  const [traces, setTraces] = useState<string[]>([])
  const [proposal, setProposal] = useState<{type: 'writeFile' | 'runCommand', filePath?: string, content?: string, command?: string} | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [traces, proposal])

  const connectWebSocket = () => {
    if (wsRef.current) return;
    const ws = new WebSocket('ws://localhost:8080');
    
    ws.onopen = () => {
      console.log('Connected to Agent Core');
      const config = window.goalpilotConfig;
      if (config) {
        ws.send(JSON.stringify({ 
          command: 'init', 
          workspaceRoot: config.workspaceRoot,
          storagePath: config.storagePath,
          userId: config.userId,
          apiKey: config.apiKey
        }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'trace') {
          setTraces(prev => [...prev, data.payload]);
        } else if (data.type === 'completed') {
          setStatus('completed');
          setTraces(prev => [...prev, '--- TASK COMPLETE ---']);
        } else if (data.type === 'proposal') {
          setProposal(data.payload);
        }
      } catch (e) {
        console.error("Parse error", e);
      }
    };

    ws.onclose = () => {
      console.log('Disconnected from Agent Core');
      wsRef.current = null;
    };

    wsRef.current = ws;
  };

  useEffect(() => {
    connectWebSocket();
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleStartTask = () => {
    if (!task.trim()) return;
    setStatus('running');
    setTraces([]);
    setProposal(null);
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'startTask', text: task }));
    } else {
      setTraces(['Error: Agent Core not connected. Is the backend running?']);
      setStatus('idle');
    }
  };

  const handleApprove = () => {
    if (!proposal || !wsRef.current) return;
    if (proposal.type === 'writeFile') {
      wsRef.current.send(JSON.stringify({ command: 'approve', filePath: proposal.filePath }));
    } else if (proposal.type === 'runCommand') {
      wsRef.current.send(JSON.stringify({ command: 'approve_run', runCommand: proposal.command }));
    }
    setProposal(null);
  };

  const handleReject = () => {
    if (!proposal || !wsRef.current) return;
    if (proposal.type === 'writeFile') {
      wsRef.current.send(JSON.stringify({ command: 'reject', filePath: proposal.filePath }));
    } else if (proposal.type === 'runCommand') {
      wsRef.current.send(JSON.stringify({ command: 'reject_run', runCommand: proposal.command }));
    }
    setProposal(null);
  };

  const handleViewDiff = () => {
    if (!proposal || !window.vscode) return;
    window.vscode.postMessage({
      command: 'showDiff',
      filePath: proposal.filePath,
      content: proposal.content
    });
  };

  return (
    <div className="flex flex-col h-screen text-gray-300 p-4 font-mono relative overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-purple blur-[120px] opacity-20 pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-brand-neon blur-[120px] opacity-10 pointer-events-none" />

      <header className="flex items-center justify-between mb-6 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center border border-brand-neon bg-brand-darker text-brand-neon shadow-[0_0_10px_rgba(0,240,255,0.3)]">
            <Zap size={16} />
          </div>
          <div>
            <h1 className="font-heading font-bold text-lg tracking-widest text-white glow-text">GOALpilot</h1>
            <p className="text-[10px] text-brand-neon tracking-widest uppercase">Autonomous Core</p>
          </div>
        </div>
        <button className="text-gray-500 hover:text-white transition-colors">
          <Settings2 size={18} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto mb-4 z-10 glass-panel p-4 flex flex-col gap-4">
        {status === 'idle' ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <Terminal size={48} className="mb-4 text-gray-600" />
            <p className="text-sm tracking-wide">SYSTEM IDLE. AWAITING DIRECTIVES.</p>
          </div>
        ) : (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col gap-3 h-full"
          >
            <div className="flex items-start gap-3 flex-shrink-0">
              <span className="text-brand-neon mt-1"><Code2 size={14} /></span>
              <div className="border-l border-brand-border pl-3">
                <span className="text-xs text-gray-500 uppercase">Directive Initialized</span>
                <p className="text-sm text-gray-200">{task}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3 flex-1 overflow-hidden flex-col">
              <div className="flex items-start gap-3 w-full">
                <span className="text-brand-purple mt-1"><Terminal size={14} /></span>
                <div className="border-l border-brand-border pl-3 flex flex-col h-full w-full overflow-hidden">
                  <span className="text-xs text-gray-500 uppercase flex-shrink-0">Reasoning Trace</span>
                  <div className="mt-1 p-2 bg-black/50 border border-brand-border rounded text-xs text-gray-400 font-mono overflow-y-auto flex-1 break-words">
                    {traces.map((trace, i) => (
                      <div key={i} className="mb-1">
                        <span className="text-brand-neon">&gt;</span> {trace}
                      </div>
                    ))}
                    {status === 'running' && !proposal && (
                      <div className="animate-pulse text-brand-neon mt-2">_</div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              </div>

              {/* Proposal UI */}
              <AnimatePresence>
                {proposal && proposal.type === 'writeFile' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full mt-2 border border-brand-neon/50 bg-brand-darker p-3 shadow-[0_0_15px_rgba(0,240,255,0.15)]"
                  >
                    <div className="flex items-center gap-2 mb-2 text-brand-neon">
                      <FileDiff size={16} />
                      <span className="text-xs uppercase font-bold tracking-wider">File Edit Proposal</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-3 truncate" title={proposal.filePath}>
                      Agent wants to modify: <span className="text-white">{proposal.filePath?.split(/[/\\]/).pop()}</span>
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={handleViewDiff}
                        className="flex-1 bg-brand-dark border border-brand-border text-gray-300 hover:text-white hover:border-gray-500 text-xs py-1.5 transition-colors"
                      >
                        View Diff
                      </button>
                      <button 
                        onClick={handleApprove}
                        className="flex-1 bg-green-900/20 border border-green-500/50 text-green-400 hover:bg-green-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button 
                        onClick={handleReject}
                        className="flex-1 bg-red-900/20 border border-red-500/50 text-red-400 hover:bg-red-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  </motion.div>
                )}
                {proposal && proposal.type === 'runCommand' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full mt-2 border border-brand-purple/50 bg-brand-darker p-3 shadow-[0_0_15px_rgba(138,43,226,0.15)]"
                  >
                    <div className="flex items-center gap-2 mb-2 text-brand-purple">
                      <Terminal size={16} />
                      <span className="text-xs uppercase font-bold tracking-wider">Command Proposal</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-3 truncate" title={proposal.command}>
                      Agent wants to run: <span className="text-brand-purple font-mono bg-black/50 px-1 py-0.5 rounded">{proposal.command}</span>
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={handleApprove}
                        className="flex-1 bg-green-900/20 border border-green-500/50 text-green-400 hover:bg-green-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button 
                        onClick={handleReject}
                        className="flex-1 bg-red-900/20 border border-red-500/50 text-red-400 hover:bg-red-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            
          </motion.div>
        )}
      </div>

      <div className="z-10 flex flex-col gap-2">
        <div className="relative">
          <textarea 
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Assign a task..."
            className="w-full bg-brand-darker border border-brand-border rounded-none p-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon transition-all resize-none h-20 font-sans"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleStartTask();
              }
            }}
            disabled={status === 'running'}
          />
          <div className="absolute bottom-2 right-2 flex gap-2">
            {status === 'running' ? (
              <button 
                onClick={() => setStatus('idle')}
                className="w-8 h-8 flex items-center justify-center bg-red-900/30 text-red-400 border border-red-900/50 hover:bg-red-900/50 transition-colors"
                title="Stop Agent"
              >
                <Square size={14} />
              </button>
            ) : (
              <button 
                onClick={handleStartTask}
                className="w-8 h-8 flex items-center justify-center bg-brand-neon/10 text-brand-neon border border-brand-neon/30 hover:bg-brand-neon/20 transition-colors shadow-[0_0_10px_rgba(0,240,255,0.1)]"
                title="Start Task"
              >
                <Play size={14} />
              </button>
            )}
          </div>
        </div>
        
        <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-widest px-1">
          <div className="flex items-center gap-2">
            {status === 'running' ? (
              proposal ? (
                 <span className="flex items-center gap-1 text-yellow-500"><Loader2 size={10} className="animate-spin" /> AWAITING APPROVAL</span>
              ) : (
                 <span className="flex items-center gap-1 text-brand-neon"><Loader2 size={10} className="animate-spin" /> EXECUTING</span>
              )
            ) : status === 'completed' ? (
               <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand-purple block" /> COMPLETED</span>
            ) : (
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 block" /> READY</span>
            )}
          </div>
          <span>v0.0.1 ALPHA</span>
        </div>
      </div>
    </div>
  )
}

export default App
