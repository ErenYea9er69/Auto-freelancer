import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Terminal, Code2, Zap, Settings2, Play, Square, Loader2, Check, X, FileDiff, Network, Users, AlertTriangle, Bot, Sparkles } from 'lucide-react'
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

type Proposal = {type: 'writeFile' | 'runCommand' | 'editFile', filePath?: string, content?: string, command?: string, target?: string, replacement?: string};
type AgentMode = 'autonomous' | 'copilot';

function App() {
  const [task, setTask] = useState('')
  const [activeAgentId, setActiveAgentId] = useState<string>('core')
  const [mode, setMode] = useState<AgentMode>('autonomous')
  
  // Swarm State
  const [agentStatus, setAgentStatus] = useState<Record<string, 'idle' | 'running' | 'completed'>>({ core: 'idle' })
  const [agentTraces, setAgentTraces] = useState<Record<string, { type: 'system'|'user'|'agent', text: string }[]>>({ core: [] })
  const [agentStream, setAgentStream] = useState<Record<string, string>>({})
  const [agentProposals, setAgentProposals] = useState<Record<string, Proposal | null>>({ core: null })
  
  const [graphData, setGraphData] = useState<{nodes: any[], links: any[]}>({ nodes: [{id: 'Agent Core', group: 0}], links: [] })
  const [graphWidth, setGraphWidth] = useState(300)
  const [ghostAlert, setGhostAlert] = useState<{filePath: string, error: string} | null>(null)
  
  const [showSettings, setShowSettings] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [historyList, setHistoryList] = useState<any[]>([])
  const [apiKeyInput, setApiKeyInput] = useState(window.goalpilotConfig?.apiKey || '')
  
  const [tokenUsage, setTokenUsage] = useState({ prompt: 0, completion: 0, total: 0 })
  
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
      } else if (message.type === 'trigger_mind_meld') {
        handleStartTask(message.payload);
      } else if (message.type === 'copilot_context') {
        // Extension host collected the active file context, now send to WS
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            command: 'startCopilotTask',
            text: message.payload.text,
            fileContext: message.payload.fileContext,
            filePath: message.payload.filePath
          }));
        }
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

    ws.onclose = () => {
      console.log('Disconnected. Reconnecting in 3s...');
      wsRef.current = null;
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const agentId = data.agentId || 'core';

        if (data.type === 'trace') {
          // If there was an active stream, flush it to an agent message
          setAgentStream(prev => {
             if (prev[agentId]) {
                 setAgentTraces(tPrev => ({
                     ...tPrev,
                     [agentId]: [...(tPrev[agentId] || []), { type: 'agent', text: prev[agentId] }]
                 }));
             }
             return { ...prev, [agentId]: '' };
          });
          
          let msgType: 'system' | 'user' | 'agent' = 'system';
          if (data.payload.startsWith('Final Output:')) {
             msgType = 'agent';
             data.payload = data.payload.replace('Final Output: ', '');
          }
          
          setAgentTraces(prev => ({
            ...prev,
            [agentId]: [...(prev[agentId] || []), { type: msgType, text: data.payload }]
          }));
          setAgentStatus(prev => ({ ...prev, [agentId]: 'running' }));
        } else if (data.type === 'stream') {
          setAgentStream(prev => ({
             ...prev,
             [agentId]: (prev[agentId] || '') + data.payload
          }));
        } else if (data.type === 'completed') {
          setAgentStream(prev => {
             if (prev[agentId]) {
                 setAgentTraces(tPrev => ({
                     ...tPrev,
                     [agentId]: [...(tPrev[agentId] || []), { type: 'agent', text: prev[agentId] }]
                 }));
             }
             return { ...prev, [agentId]: '' };
          });
          setAgentStatus(prev => ({ ...prev, [agentId]: 'completed' }));
          setAgentTraces(prev => ({
            ...prev,
            [agentId]: [...(prev[agentId] || []), { type: 'system', text: '--- TASK COMPLETE ---' }]
          }));
        } else if (data.type === 'history_list') {
          setHistoryList(data.payload || []);
        } else if (data.type === 'usage') {
          setTokenUsage(prev => ({
             prompt: prev.prompt + (data.payload.prompt_tokens || 0),
             completion: prev.completion + (data.payload.completion_tokens || 0),
             total: prev.total + (data.payload.total_tokens || 0)
          }));
        } else if (data.type === 'proposal') {
          setAgentProposals(prev => ({
            ...prev,
            [agentId]: data.payload
          }));
          
          if (data.payload.type === 'writeFile') {
            window.vscode?.postMessage({
              command: 'liquidCode',
              filePath: data.payload.filePath,
              content: data.payload.content
            });
          }
        } else if (data.type === 'graph_update') {
          setGraphData(data.payload);
        }
      } catch (e) {
        console.error("Parse error", e);
      }
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

  const handleStartTask = (directTask?: string) => {
    const textToRun = typeof directTask === 'string' ? directTask : task;
    if (!textToRun.trim()) return;
    
    if (mode === 'copilot') {
      // Copilot Mode: route through extension host to grab active file context
      setActiveAgentId('copilot');
      setAgentStatus(prev => ({ ...prev, copilot: 'running' }));
      setAgentTraces(prev => ({ ...prev, copilot: [...(prev['copilot'] || []), { type: 'user', text: textToRun }] }));
      setAgentProposals(prev => ({ ...prev, copilot: null }));
      
      // Ask extension host for the active editor context
      window.vscode?.postMessage({ command: 'copilotTask', text: textToRun });
    } else {
      // Autonomous Mode: full agent
      setActiveAgentId('core');
      setAgentStatus(prev => ({ ...prev, core: 'running' }));
      setAgentTraces(prev => ({ ...prev, core: [...(prev['core'] || []), { type: 'user', text: textToRun }] }));
      setAgentProposals(prev => ({ ...prev, core: null }));
      
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ command: 'startTask', text: textToRun }));
      } else {
        setAgentTraces(prev => ({ ...prev, core: [...(prev['core'] || []), { type: 'system', text: 'Error: Agent Core not connected.' }] }));
        setAgentStatus(prev => ({ ...prev, core: 'idle' }));
      }
    }
  };

  const handleApprove = (agentId: string) => {
    const proposal = agentProposals[agentId];
    if (!proposal || !wsRef.current) return;
    if (proposal.type === 'writeFile' || proposal.type === 'editFile') {
      wsRef.current.send(JSON.stringify({ command: 'approve', filePath: proposal.filePath, agentId }));
    } else if (proposal.type === 'runCommand') {
      wsRef.current.send(JSON.stringify({ command: 'approve_run', runCommand: proposal.command, agentId }));
    }
    setAgentProposals(prev => ({ ...prev, [agentId]: null }));
  };

  const handleReject = (agentId: string) => {
    const proposal = agentProposals[agentId];
    if (!proposal || !wsRef.current) return;
    if (proposal.type === 'writeFile' || proposal.type === 'editFile') {
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

  // Feature 4: God's Eye Cascade Approval - Finding pending files
  const pendingFilesMap = new Map<string, string>(); // Map filename to agentId
  Object.entries(agentProposals).forEach(([aId, p]) => {
    if (p && (p.type === 'writeFile' || p.type === 'editFile') && p.filePath) {
      const fileName = p.filePath.split(/[/\\]/).pop();
      if (fileName) pendingFilesMap.set(fileName, aId);
    }
  });

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
            <p className="text-[10px] text-brand-neon tracking-widest uppercase">{mode === 'copilot' ? 'Copilot Mode' : 'Autonomous Core'}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          {/* Mode Toggle */}
          <button
            onClick={() => setMode(mode === 'autonomous' ? 'copilot' : 'autonomous')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider border transition-all duration-300 ${
              mode === 'copilot'
                ? 'bg-emerald-900/40 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]'
                : 'bg-brand-purple/20 border-brand-purple/50 text-brand-purple shadow-[0_0_10px_rgba(176,38,255,0.2)]'
            }`}
            title={mode === 'copilot' ? 'Switch to Autonomous Mode' : 'Switch to Copilot Mode'}
          >
            {mode === 'copilot' ? <><Bot size={12} /> Copilot</> : <><Sparkles size={12} /> Auto</>}
          </button>
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
          <button 
            className={`transition-colors ${showHistory ? 'text-brand-neon' : 'text-gray-500 hover:text-white'}`}
            onClick={() => {
              setShowHistory(!showHistory);
              setShowSettings(false);
              if (!showHistory && wsRef.current) wsRef.current.send(JSON.stringify({ command: 'getHistory' }));
            }}
            title="Chat History"
          >
            <Bot size={18} />
          </button>
          <button 
            className={`transition-colors ${showSettings ? 'text-brand-purple' : 'text-gray-500 hover:text-white'}`}
            onClick={() => {
              setShowSettings(!showSettings);
              setShowHistory(false);
            }}
            title="Settings"
          >
            <Settings2 size={18} />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto mb-4 z-10 glass-panel p-4 flex flex-col gap-4 relative">
        <AnimatePresence>
          {showHistory && (
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 20 }}
              className="absolute inset-0 bg-brand-darker/95 backdrop-blur-md z-50 p-4 overflow-y-auto border-l border-brand-neon/30 flex flex-col gap-3"
            >
              <div className="flex justify-between items-center mb-2 border-b border-brand-neon/20 pb-2">
                <h2 className="text-brand-neon font-bold text-sm tracking-widest uppercase flex items-center gap-2"><Bot size={16}/> Conversation History</h2>
                <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-white"><X size={16}/></button>
              </div>
              {historyList.length === 0 ? (
                <p className="text-xs text-gray-500 text-center mt-10">No past conversations found.</p>
              ) : (
                historyList.map((chat) => (
                  <div key={chat.id} className="bg-black/40 border border-brand-border p-3 cursor-pointer hover:border-brand-neon transition-colors">
                    <p className="text-sm text-gray-200 truncate">{chat.title || 'Untitled Task'}</p>
                    <p className="text-[10px] text-gray-500 mt-1">{new Date(chat.updatedAt).toLocaleString()}</p>
                  </div>
                ))
              )}
            </motion.div>
          )}

          {showSettings && (
            <motion.div 
              initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }} transition={{ type: 'spring', damping: 20 }}
              className="absolute inset-0 bg-brand-darker/95 backdrop-blur-md z-50 p-4 overflow-y-auto border-l border-brand-purple/30 flex flex-col gap-4"
            >
              <div className="flex justify-between items-center mb-2 border-b border-brand-purple/20 pb-2">
                <h2 className="text-brand-purple font-bold text-sm tracking-widest uppercase flex items-center gap-2"><Settings2 size={16}/> Settings</h2>
                <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-white"><X size={16}/></button>
              </div>
              
              <div className="flex flex-col gap-2">
                <label className="text-xs text-gray-400 uppercase tracking-wider">LongCat API Key</label>
                <input 
                  type="password" 
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  className="bg-black/50 border border-brand-border p-2 text-sm text-white focus:outline-none focus:border-brand-purple"
                  placeholder="sk-..."
                />
                <button 
                  className="bg-brand-purple/20 text-brand-purple border border-brand-purple/50 py-1.5 text-xs font-bold uppercase hover:bg-brand-purple/40 transition-colors mt-1"
                  onClick={() => {
                    window.vscode?.postMessage({ command: 'saveSettings', apiKey: apiKeyInput });
                    setShowSettings(false);
                  }}
                >
                  Save API Key
                </button>
              </div>

              <div className="flex flex-col gap-2 mt-4">
                <label className="text-xs text-gray-400 uppercase tracking-wider">Self-Healing Loop</label>
                <div className="flex items-center gap-2 text-sm text-gray-300 bg-black/40 p-2 border border-brand-border">
                  <input type="checkbox" defaultChecked className="accent-brand-purple" />
                  <span>Auto-run <code className="text-brand-neon bg-black px-1">npm run build</code></span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {coreStatus === 'idle' ? (
          <div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <Terminal size={48} className="mb-4 text-gray-600" />
            {mode === 'copilot' 
              ? <p className="text-sm tracking-wide">COPILOT READY. TELL ME WHAT TO CHANGE.</p>
              : <p className="text-sm tracking-wide">SYSTEM IDLE. AWAITING DIRECTIVES.</p>
            }
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
                    {pendingFilesMap.size > 0 && <span className="ml-2 text-yellow-500 animate-pulse">[CASCADE APPROVAL MODE]</span>}
                  </div>
                  <ForceGraph2D
                    graphData={graphData}
                    width={graphWidth}
                    height={180}
                    nodeRelSize={4}
                    linkColor={() => 'rgba(138,43,226,0.3)'}
                    onNodeClick={(node) => {
                      const label = String(node.id);
                      const agentOwnerId = pendingFilesMap.get(label);
                      if (agentOwnerId) {
                        setActiveAgentId(agentOwnerId);
                        handleViewDiff(agentOwnerId);
                      }
                    }}
                    nodeCanvasObject={(node, ctx, globalScale) => {
                      const label = String(node.id);
                      const isPending = pendingFilesMap.has(label);
                      const fontSize = 12/globalScale;
                      ctx.font = `${isPending ? 'bold ' : ''}${fontSize}px Sans-Serif`;
                      const textWidth = ctx.measureText(label).width;
                      const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2);
                      
                      if (isPending) {
                          ctx.beginPath();
                          ctx.arc(node.x || 0, node.y || 0, 15, 0, 2 * Math.PI, false);
                          ctx.fillStyle = 'rgba(255, 170, 0, 0.3)';
                          ctx.fill();
                      }

                      ctx.fillStyle = isPending ? 'rgba(50, 20, 0, 0.9)' : 'rgba(0, 0, 0, 0.8)';
                      ctx.fillRect((node.x || 0) - bckgDimensions[0] / 2, (node.y || 0) - bckgDimensions[1] / 2, bckgDimensions[0], bckgDimensions[1]);
                      ctx.textAlign = 'center';
                      ctx.textBaseline = 'middle';
                      
                      if (isPending) {
                        ctx.fillStyle = '#ffaa00'; // Warning/Pending
                      } else {
                        ctx.fillStyle = node.group === 0 ? '#00f0ff' : '#8a2be2';
                      }
                      
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
                  <span className="text-xs text-gray-500 uppercase flex-shrink-0">Chat Thread [{activeAgentId}]</span>
                  <div className="mt-1 p-3 bg-black/40 border border-brand-border rounded flex-1 overflow-y-auto flex flex-col gap-3">
                    {activeTraces.map((trace, i) => {
                      if (trace.type === 'user') {
                        return (
                          <div key={i} className="self-end bg-brand-purple/20 border border-brand-purple/50 text-white p-2 rounded-lg rounded-tr-none max-w-[85%] text-xs shadow-[0_0_10px_rgba(176,38,255,0.1)]">
                            {trace.text}
                          </div>
                        );
                      } else if (trace.type === 'agent') {
                        return (
                          <div key={i} className="self-start bg-brand-darker border border-brand-neon/30 text-gray-200 p-3 rounded-lg rounded-tl-none max-w-[90%] text-sm shadow-[0_0_10px_rgba(0,240,255,0.05)] whitespace-pre-wrap font-sans">
                            {trace.text}
                          </div>
                        );
                      } else {
                        // System/Tool trace
                        return (
                          <div key={i} className="self-start group flex items-start justify-between w-full text-[11px] text-gray-500 font-mono">
                            <div className="flex gap-2 w-full">
                              <span className="text-gray-600 mt-0.5">&gt;</span> 
                              <span className="flex-1 break-words">{trace.text}</span>
                            </div>
                            <button 
                              onClick={() => handleRewind(activeAgentId, i)}
                              className="opacity-0 group-hover:opacity-100 bg-brand-purple/20 text-brand-purple hover:bg-brand-purple/40 px-2 py-0.5 rounded transition-opacity flex-shrink-0 ml-2"
                              title="Rewind Agent to this step"
                            >
                              Rewind
                            </button>
                          </div>
                        );
                      }
                    })}
                    
                    {agentStream[activeAgentId] && (
                      <div className="self-start bg-brand-darker border border-brand-neon/50 text-gray-200 p-3 rounded-lg rounded-tl-none max-w-[90%] text-sm shadow-[0_0_15px_rgba(0,240,255,0.1)] whitespace-pre-wrap font-sans relative">
                        {agentStream[activeAgentId]}
                        <span className="inline-block w-1.5 h-4 ml-1 bg-brand-neon animate-pulse align-middle"></span>
                      </div>
                    )}
                    
                    {activeStatus === 'running' && !activeProposal && !agentStream[activeAgentId] && (
                      <div className="self-start text-[11px] text-brand-neon font-mono animate-pulse flex gap-2 items-center">
                        <Loader2 size={10} className="animate-spin" /> THINKING...
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </div>
              </div>

              {/* Proposal UI */}
              <AnimatePresence>
                {activeProposal && (activeProposal.type === 'writeFile' || activeProposal.type === 'editFile') && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="w-full mt-2 border border-brand-neon/50 bg-brand-darker p-3 shadow-[0_0_15px_rgba(0,240,255,0.15)]"
                  >
                    <div className="flex items-center gap-2 mb-2 text-brand-neon">
                      <FileDiff size={16} />
                      <span className="text-xs uppercase font-bold tracking-wider">File {activeProposal.type === 'editFile' ? 'Edit' : 'Write'} Proposal [{activeAgentId}]</span>
                    </div>
                    <p className="text-xs text-gray-400 mb-3 truncate" title={activeProposal.filePath}>
                      Agent wants to {activeProposal.type === 'editFile' ? 'edit' : 'write'}: <span className="text-white">{activeProposal.filePath?.split(/[/\\]/).pop()}</span>
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
            placeholder={mode === 'copilot' ? 'Tell me what to change...' : 'Assign a task...'}
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
                onClick={() => {
                  setAgentStatus(prev => ({ ...prev, [activeAgentId]: 'idle' }));
                  if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({ command: 'cancel', agentId: activeAgentId }));
                  }
                }}
                className="w-8 h-8 flex items-center justify-center bg-red-900/30 text-red-400 border border-red-900/50 hover:bg-red-900/50 transition-colors"
                title="Stop Agent"
              >
                <Square size={14} />
              </button>
            ) : (
              <button 
                onClick={() => handleStartTask()}
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
          <div className="flex items-center gap-3">
             {tokenUsage.total > 0 && (
                <span className="text-gray-400 font-mono tracking-normal lowercase" title={`Prompt: ${tokenUsage.prompt} | Completion: ${tokenUsage.completion}`}>
                   ⚡ {tokenUsage.total.toLocaleString()} tokens
                </span>
             )}
             <span>v0.0.1 ALPHA</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
