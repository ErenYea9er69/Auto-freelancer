import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Code2, Zap, Settings2, Play, Square, Loader2, Check, X, FileDiff, Network, Users, AlertTriangle } from 'lucide-react'
import ForceGraph2D from 'react-force-graph-2d'

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

type Proposal = {type: 'writeFile' | 'runCommand', filePath?: string, content?: string, command?: string};

function App() {
  const [task, setTask] = useState('')
  const [activeAgentId, setActiveAgentId] = useState<string>('core')
  
  // Swarm State
  const [agentStatus, setAgentStatus] = useState<Record<string, 'idle' | 'running' | 'completed'>>({ core: 'idle' })
  const [agentTraces, setAgentTraces] = useState<Record<string, string[]>>({ core: [] })
  const [agentProposals, setAgentProposals] = useState<Record<string, Proposal | null>>({ core: null })
  
  const [graphData, setGraphData] = useState<{nodes: any[], links: any[]}>({ nodes: [{id: 'Agent Core', group: 0}], links: [] })
  const [graphWidth, setGraphWidth] = useState(300)
  const [ghostAlert, setGhostAlert] = useState<{filePath: string, error: string} | null>(null)
  
  const wsRef = useRef<WebSocket | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [agentTraces, agentProposals, activeAgentId])

  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setGraphWidth(containerRef.current.clientWidth - 32);
      }
    };
    window.addEventListener('resize', updateWidth);
    setTimeout(updateWidth, 100);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const handleVSCodeMessage = (event: MessageEvent) => {
      const message = event.data;
      if (message.type === 'diagnostic_event') {
        setGhostAlert(message.payload);
      }
    };
    window.addEventListener('message', handleVSCodeMessage);
    return () => window.removeEventListener('message', handleVSCodeMessage);
  }, []);

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
        const agentId = data.agentId || 'core';

        if (data.type === 'trace') {
          setAgentTraces(prev => ({
            ...prev,
            [agentId]: [...(prev[agentId] || []), data.payload]
          }));
          setAgentStatus(prev => ({ ...prev, [agentId]: 'running' }));
        } else if (data.type === 'completed') {
          setAgentStatus(prev => ({ ...prev, [agentId]: 'completed' }));
          setAgentTraces(prev => ({
            ...prev,
            [agentId]: [...(prev[agentId] || []), '--- TASK COMPLETE ---']
          }));
        } else if (data.type === 'proposal') {
          setAgentProposals(prev => ({
            ...prev,
            [agentId]: data.payload
          }));
        } else if (data.type === 'graph_update') {
          setGraphData(data.payload);
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
    
    // Reset swarm state
    setActiveAgentId('core');
    setAgentStatus({ core: 'running' });
    setAgentTraces({ core: [] });
    setAgentProposals({ core: null });
    
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ command: 'startTask', text: task }));
    } else {
      setAgentTraces({ core: ['Error: Agent Core not connected.'] });
      setAgentStatus({ core: 'idle' });
    }
  };

  const handleApprove = (agentId: string) => {
    const proposal = agentProposals[agentId];
    if (!proposal || !wsRef.current) return;
    if (proposal.type === 'writeFile') {
      wsRef.current.send(JSON.stringify({ command: 'approve', filePath: proposal.filePath, agentId }));
    } else if (proposal.type === 'runCommand') {
      wsRef.current.send(JSON.stringify({ command: 'approve_run', runCommand: proposal.command, agentId }));
    }
    setAgentProposals(prev => ({ ...prev, [agentId]: null }));
  };

  const handleReject = (agentId: string) => {
    const proposal = agentProposals[agentId];
    if (!proposal || !wsRef.current) return;
    if (proposal.type === 'writeFile') {
      wsRef.current.send(JSON.stringify({ command: 'reject', filePath: proposal.filePath, agentId }));
    } else if (proposal.type === 'runCommand') {
      wsRef.current.send(JSON.stringify({ command: 'reject_run', runCommand: proposal.command, agentId }));
    }
    setAgentProposals(prev => ({ ...prev, [agentId]: null }));
  };

  const handleViewDiff = (agentId: string) => {
    const proposal = agentProposals[agentId];
    if (!proposal || !window.vscode) return;
    window.vscode.postMessage({
      command: 'showDiff',
      filePath: proposal.filePath,
      content: proposal.content
    });
  };

  const handleRewind = (agentId: string, traceIndex: number) => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ command: 'rewind', agentId, traceIndex }));
      setAgentTraces(prev => ({
        ...prev,
        [agentId]: prev[agentId].slice(0, traceIndex + 1)
      }));
      setAgentStatus(prev => ({ ...prev, [agentId]: 'idle' }));
    }
  };

  const agentIds = Object.keys(agentTraces);
  const coreStatus = agentStatus['core'] || 'idle';
  const activeTraces = agentTraces[activeAgentId] || [];
  const activeProposal = agentProposals[activeAgentId];
  const activeStatus = agentStatus[activeAgentId] || 'idle';

  return (
    <div className="flex flex-col h-screen text-gray-300 p-4 font-mono relative overflow-hidden" ref={containerRef}>
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
        
        <div className="flex items-center gap-3">
          <AnimatePresence>
            {ghostAlert && (
              <motion.button 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={() => {
                  setTask(`Fix diagnostic error: ${ghostAlert.error} in ${ghostAlert.filePath}`);
                  setGhostAlert(null);
                }}
                className="text-[10px] bg-red-900/40 text-red-400 px-2 py-1 flex items-center gap-1 hover:bg-red-900/60 transition-colors border border-red-500/50 shadow-[0_0_10px_rgba(255,0,0,0.2)] font-bold tracking-wider"
                title={ghostAlert.error}
              >
                <AlertTriangle size={12} className="animate-pulse" /> GHOST FIX
              </motion.button>
            )}
          </AnimatePresence>
          <button className="text-gray-500 hover:text-white transition-colors">
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto mb-4 z-10 glass-panel p-4 flex flex-col gap-4">
        {coreStatus === 'idle' ? (
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
              {graphData.nodes.length > 1 && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 180 }}
                  className="w-full border border-brand-purple/30 bg-black/50 rounded-lg overflow-hidden relative flex-shrink-0"
                >
                  <div className="absolute top-2 left-2 z-10 flex items-center gap-1 text-[10px] text-brand-purple uppercase tracking-widest font-bold">
                    <Network size={12} /> Neural Map
                  </div>
                  <ForceGraph2D
                    graphData={graphData}
                    width={graphWidth}
                    height={180}
                    nodeRelSize={4}
                    linkColor={() => 'rgba(138,43,226,0.3)'}
                    nodeCanvasObject={(node, ctx, globalScale) => {
                      const label = String(node.id);
                      const fontSize = 12/globalScale;
                      ctx.font = `${fontSize}px Sans-Serif`;
                      const textWidth = ctx.measureText(label).width;
                      const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);
                      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
                      ctx.fillRect((node.x || 0) - bckgDimensions[0] / 2, (node.y || 0) - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'middle';
                      ctx.fillStyle = node.group === 0 ? '#00f0ff' : '#8a2be2';
                      ctx.fillText(label, node.x || 0, node.y || 0);
                    }}
                  />
                </motion.div>
              )}

              {/* Swarm Tabs */}
              {agentIds.length > 1 && (
                <div className="flex gap-2 w-full overflow-x-auto pb-1 flex-shrink-0">
                  {agentIds.map(id => (
                    <button
                      key={id}
                      onClick={() => setActiveAgentId(id)}
                      className={`px-3 py-1.5 text-xs flex items-center gap-2 border transition-colors ${
                        activeAgentId === id 
                          ? 'bg-brand-neon/20 border-brand-neon text-brand-neon' 
                          : 'bg-black/50 border-brand-border text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      <Users size={12} /> {id}
                      {agentStatus[id] === 'running' && !agentProposals[id] && <Loader2 size={10} className="animate-spin" />}
                      {agentProposals[id] && <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />}
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-start gap-3 w-full h-full overflow-hidden">
                <span className="text-brand-purple mt-1"><Terminal size={14} /></span>
                <div className="border-l border-brand-border pl-3 flex flex-col h-full w-full overflow-hidden">
                  <span className="text-xs text-gray-500 uppercase flex-shrink-0">Reasoning Trace [{activeAgentId}]</span>
                  <div className="mt-1 p-2 bg-black/50 border border-brand-border rounded text-xs text-gray-400 font-mono overflow-y-auto flex-1 break-words">
                    {activeTraces.map((trace, i) => (
                      <div key={i} className="mb-1 group flex items-start justify-between">
                        <div><span className="text-brand-neon">&gt;</span> {trace}</div>
                        <button 
                          onClick={() => handleRewind(activeAgentId, i)}
                          className="opacity-0 group-hover:opacity-100 text-[10px] bg-brand-purple/20 text-brand-purple hover:bg-brand-purple/40 px-2 rounded transition-opacity"
                          title="Rewind Agent to this step"
                        >
                          Rewind
                        </button>
                      </div>
                    ))}
                    {activeStatus === 'running' && !activeProposal && (
                      <div className="animate-pulse text-brand-neon mt-2">_</div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              </div>

              {/* Proposal UI */}
              <AnimatePresence>
                {activeProposal && activeProposal.type === 'writeFile' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full mt-2 border border-brand-neon/50 bg-brand-darker p-3 shadow-[0_0_15px_rgba(0,240,255,0.15)]"
                  >
                    <div className="flex items-center gap-2 mb-2 text-brand-neon">
                      <FileDiff size={16} />
                      <span className="text-xs uppercase font-bold tracking-wider">File Edit Proposal [{activeAgentId}]</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-3 truncate" title={activeProposal.filePath}>
                      Agent wants to modify: <span className="text-white">{activeProposal.filePath?.split(/[/\\]/).pop()}</span>
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleViewDiff(activeAgentId)}
                        className="flex-1 bg-brand-dark border border-brand-border text-gray-300 hover:text-white hover:border-gray-500 text-xs py-1.5 transition-colors"
                      >
                        View Diff
                      </button>
                      <button 
                        onClick={() => handleApprove(activeAgentId)}
                        className="flex-1 bg-green-900/20 border border-green-500/50 text-green-400 hover:bg-green-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button 
                        onClick={() => handleReject(activeAgentId)}
                        className="flex-1 bg-red-900/20 border border-red-500/50 text-red-400 hover:bg-red-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <X size={14} /> Reject
                      </button>
                    </div>
                  </motion.div>
                )}
                {activeProposal && activeProposal.type === 'runCommand' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full mt-2 border border-brand-purple/50 bg-brand-darker p-3 shadow-[0_0_15px_rgba(138,43,226,0.15)]"
                  >
                    <div className="flex items-center gap-2 mb-2 text-brand-purple">
                      <Terminal size={16} />
                      <span className="text-xs uppercase font-bold tracking-wider">Command Proposal [{activeAgentId}]</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-3 truncate" title={activeProposal.command}>
                      Agent wants to run: <span className="text-brand-purple font-mono bg-black/50 px-1 py-0.5 rounded">{activeProposal.command}</span>
                    </p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleApprove(activeAgentId)}
                        className="flex-1 bg-green-900/20 border border-green-500/50 text-green-400 hover:bg-green-900/40 text-xs py-1.5 flex items-center justify-center gap-1 transition-colors"
                      >
                        <Check size={14} /> Approve
                      </button>
                      <button 
                        onClick={() => handleReject(activeAgentId)}
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
            disabled={coreStatus === 'running'}
          />
          <div className="absolute bottom-2 right-2 flex gap-2">
            {coreStatus === 'running' ? (
              <button 
                onClick={() => setAgentStatus({ core: 'idle' })}
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
            {coreStatus === 'running' ? (
              Object.values(agentProposals).some(p => p !== null) ? (
                 <span className="flex items-center gap-1 text-yellow-500"><Loader2 size={10} className="animate-spin" /> AWAITING APPROVAL</span>
              ) : (
                 <span className="flex items-center gap-1 text-brand-neon"><Loader2 size={10} className="animate-spin" /> EXECUTING ({agentIds.length} AGENTS)</span>
              )
            ) : coreStatus === 'completed' ? (
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
