"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const react_1 = require("react");
const framer_motion_1 = require("framer-motion");
const lucide_react_1 = require("lucide-react");
function App() {
    const [task, setTask] = (0, react_1.useState)('');
    const [status, setStatus] = (0, react_1.useState)('idle');
    return (<div className="flex flex-col h-screen text-gray-300 p-4 font-mono relative overflow-hidden">
      {/* Background glowing orb */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-brand-purple blur-[120px] opacity-20 pointer-events-none"/>
      <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-brand-neon blur-[120px] opacity-10 pointer-events-none"/>

      {/* Header */}
      <header className="flex items-center justify-between mb-6 z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 flex items-center justify-center border border-brand-neon bg-brand-darker text-brand-neon shadow-[0_0_10px_rgba(0,240,255,0.3)]">
            <lucide_react_1.Zap size={16}/>
          </div>
          <div>
            <h1 className="font-heading font-bold text-lg tracking-widest text-white glow-text">GOALpilot</h1>
            <p className="text-[10px] text-brand-neon tracking-widest uppercase">Autonomous Core</p>
          </div>
        </div>
        <button className="text-gray-500 hover:text-white transition-colors">
          <lucide_react_1.Settings2 size={18}/>
        </button>
      </header>

      {/* Main Chat/Log Area */}
      <div className="flex-1 overflow-y-auto mb-4 z-10 glass-panel p-4 flex flex-col gap-4">
        {status === 'idle' ? (<div className="flex flex-col items-center justify-center h-full text-center opacity-50">
            <lucide_react_1.Terminal size={48} className="mb-4 text-gray-600"/>
            <p className="text-sm tracking-wide">SYSTEM IDLE. AWAITING DIRECTIVES.</p>
          </div>) : (<framer_motion_1.motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-3">
            <div className="flex items-start gap-3">
              <span className="text-brand-neon mt-1"><lucide_react_1.Code2 size={14}/></span>
              <div className="border-l border-brand-border pl-3">
                <span className="text-xs text-gray-500 uppercase">Directive Initialized</span>
                <p className="text-sm text-gray-200">{task}</p>
              </div>
            </div>
            
            <div className="flex items-start gap-3">
              <span className="text-brand-purple mt-1"><lucide_react_1.Terminal size={14}/></span>
              <div className="border-l border-brand-border pl-3">
                <span className="text-xs text-gray-500 uppercase">Reasoning Trace</span>
                <div className="mt-1 p-2 bg-black/50 border border-brand-border rounded text-xs text-gray-400 font-mono">
                  <span className="text-brand-neon animate-pulse">&gt;</span> Analyzing workspace structure...<br />
                  <span className="text-brand-neon animate-pulse">&gt;</span> Planning implementation steps...
                </div>
              </div>
            </div>
            
          </framer_motion_1.motion.div>)}
      </div>

      {/* Input Area */}
      <div className="z-10 flex flex-col gap-2">
        <div className="relative">
          <textarea value={task} onChange={(e) => setTask(e.target.value)} placeholder="Assign a task..." className="w-full bg-brand-darker border border-brand-border rounded-none p-3 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-brand-neon focus:ring-1 focus:ring-brand-neon transition-all resize-none h-20 font-sans" onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (task.trim())
                    setStatus('running');
            }
        }}/>
          <div className="absolute bottom-2 right-2 flex gap-2">
            {status === 'running' ? (<button onClick={() => setStatus('idle')} className="w-8 h-8 flex items-center justify-center bg-red-900/30 text-red-400 border border-red-900/50 hover:bg-red-900/50 transition-colors" title="Stop Agent">
                <lucide_react_1.Square size={14}/>
              </button>) : (<button onClick={() => {
                if (task.trim())
                    setStatus('running');
            }} className="w-8 h-8 flex items-center justify-center bg-brand-neon/10 text-brand-neon border border-brand-neon/30 hover:bg-brand-neon/20 transition-colors shadow-[0_0_10px_rgba(0,240,255,0.1)]" title="Start Task">
                <lucide_react_1.Play size={14}/>
              </button>)}
          </div>
        </div>
        
        {/* Status Bar */}
        <div className="flex items-center justify-between text-[10px] text-gray-500 uppercase tracking-widest px-1">
          <div className="flex items-center gap-2">
            {status === 'running' ? (<span className="flex items-center gap-1 text-brand-neon"><lucide_react_1.Loader2 size={10} className="animate-spin"/> EXECUTING</span>) : (<span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 block"/> READY</span>)}
          </div>
          <span>v0.0.1 ALPHA</span>
        </div>
      </div>
    </div>);
}
exports.default = App;
//# sourceMappingURL=App.js.map