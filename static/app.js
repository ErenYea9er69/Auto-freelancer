document.addEventListener("DOMContentLoaded", () => {
    fetchLeads();
    // In a real app, we'd poll or use websockets
    // setInterval(fetchLeads, 30000); 
});

async function fetchLeads() {
    try {
        // Use empty secret for local dev if not configured
        const response = await fetch('/leads', {
            headers: { 'X-Webhook-Secret': 'change-me' }
        });
        const data = await response.json();
        
        if (data.leads) {
            renderDashboard(data.leads);
        }
    } catch (error) {
        console.error("Failed to fetch leads:", error);
        document.getElementById('leads-container').innerHTML = 
            '<div class="loading mono t-hot">Failed to load data from API.</div>';
    }
}

function renderDashboard(leads) {
    // 1. Update Metrics
    document.getElementById('metric-active').textContent = leads.length;
    
    const proposals = leads.filter(l => ['proposal_sent', 'proposal_followup_1', 'proposal_followup_2'].includes(l.status));
    document.getElementById('metric-proposals').textContent = proposals.length;
    
    // Calculate simple stats
    let newL = 0, qual = 0, fol = 0, prop = 0, won = 0;
    
    const container = document.getElementById('leads-container');
    container.innerHTML = '';
    
    // Sort leads by newest first
    const sortedLeads = [...leads].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    sortedLeads.forEach(lead => {
        // Count for sidebar
        if (lead.status === 'new') newL++;
        else if (lead.status.startsWith('qualified')) qual++;
        else if (lead.status.startsWith('followup')) fol++;
        else if (lead.status.startsWith('proposal')) prop++;
        else if (['signed', 'onboarded'].includes(lead.status)) won++;
        
        // Render card
        container.appendChild(createLeadCard(lead));
    });
    
    // Update sidebar counts
    document.getElementById('count-new').textContent = newL;
    document.getElementById('count-qualified').textContent = qual;
    document.getElementById('count-followup').textContent = fol;
    document.getElementById('count-proposal').textContent = prop;
    document.getElementById('count-won').textContent = won;
}

function createLeadCard(lead) {
    const div = document.createElement('div');
    
    // Determine colors/icons based on temperature and status
    let tempClass = 'default', tempIcon = '👤', tempColor = 't-muted', tempName = 'NEW';
    
    if (lead.temperature === 'hot') {
        tempClass = 'hot'; tempIcon = '🔥'; tempColor = 't-hot'; tempName = 'HOT';
    } else if (lead.temperature === 'warm') {
        tempClass = 'warm'; tempIcon = '💡'; tempColor = 't-warm'; tempName = 'WARM';
    } else if (lead.temperature === 'cold') {
        tempClass = 'default'; tempIcon = '❄️'; tempColor = 't-muted'; tempName = 'COLD';
    }
    
    let statusText = lead.status.replace(/_/g, ' ');
    let timeAgo = timeSince(new Date(lead.last_contact_at || lead.created_at));
    
    div.className = `lead-card lead-border-${tempClass}`;
    div.innerHTML = `
        <div class="lead-header">
            <div class="lead-icon-bg bg-${tempClass}-subtle">${tempIcon}</div>
            <div class="lead-name t-primary">${lead.name}</div>
            <div class="temp-badge bg-${tempClass}-subtle mono ${tempColor}">${tempName}</div>
        </div>
        <div class="lead-desc t-secondary">${lead.project_description || 'No description provided.'}</div>
        <div class="lead-meta mono t-muted">Budget: ${lead.budget || 'N/A'} · Timeline: ${lead.timeline || 'N/A'}</div>
        <div class="lead-footer">
            <div class="status-info">
                <div class="status-dot bg-${tempClass}"></div>
                <span class="mono ${tempColor}">${statusText} - ${timeAgo}</span>
            </div>
            <div class="t-muted mono text-xs">${lead.source || 'Direct'}</div>
        </div>
    `;
    
    div.addEventListener('click', () => showLeadDetails(lead));
    return div;
}

function showLeadDetails(lead) {
    const modal = document.getElementById('lead-modal');
    const body = document.getElementById('modal-lead-details');
    
    let actionsHtml = '';
    if (lead.status !== 'archived' && lead.status !== 'signed' && lead.status !== 'onboarded') {
        actionsHtml = `
            <div style="margin-top: 30px; display: flex; gap: 10px;">
                <button class="action-btn btn-mint" onclick="bookCall('${lead.email}')">📅 Mark Call Booked</button>
                <button class="action-btn btn-purple" onclick="alert('Open Proposal form')">📝 Submit Post-Call</button>
            </div>
        `;
    }
    
    body.innerHTML = `
        <h2 class="syne t-primary" style="font-size: 24px; margin-bottom: 10px;">${lead.name}</h2>
        <div class="mono t-accent" style="margin-bottom: 20px;">${lead.email} | Status: ${lead.status}</div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
            <div>
                <div class="mono t-muted text-xs mb-3">PROJECT</div>
                <div class="t-secondary">${lead.project_description}</div>
            </div>
            <div>
                <div class="mono t-muted text-xs mb-3">DETAILS</div>
                <div class="t-secondary">Budget: ${lead.budget || 'N/A'}</div>
                <div class="t-secondary">Timeline: ${lead.timeline || 'N/A'}</div>
                <div class="t-secondary">Source: ${lead.source || 'N/A'}</div>
            </div>
        </div>
        
        <div style="background: rgba(0,255,178,0.05); padding: 20px; border-radius: 8px; border: 1px solid rgba(0,255,178,0.2);">
            <div class="mono t-accent text-xs mb-3">AI QUALIFICATION</div>
            <div class="t-primary">Temperature: ${lead.temperature || 'Unknown'}</div>
        </div>
        
        ${actionsHtml}
    `;
    
    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('lead-modal').style.display = 'none';
}

// Simple time since formatter
function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 31536000;
    if (interval > 1) return Math.floor(interval) + " years ago";
    interval = seconds / 2592000;
    if (interval > 1) return Math.floor(interval) + " months ago";
    interval = seconds / 86400;
    if (interval > 1) return Math.floor(interval) + " days ago";
    interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hours ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " mins ago";
    return Math.floor(seconds) + " seconds ago";
}

// Action functions
async function triggerFollowups() {
    if(!confirm("Run follow-up job now?")) return;
    try {
        const res = await fetch('/admin/run-followups', { method: 'POST', headers: { 'X-Webhook-Secret': 'change-me' } });
        const data = await res.json();
        alert(`Processed ${data.processed} follow-ups.`);
        fetchLeads();
    } catch(e) { alert("Error"); }
}

async function triggerProposalFollowups() {
    if(!confirm("Run proposal follow-up job now?")) return;
    try {
        const res = await fetch('/admin/run-proposal-followups', { method: 'POST', headers: { 'X-Webhook-Secret': 'change-me' } });
        const data = await res.json();
        alert(`Processed ${data.processed} proposal follow-ups.`);
        fetchLeads();
    } catch(e) { alert("Error"); }
}

async function flagStaleLeads() {
    try {
        const res = await fetch('/admin/flag-stale', { method: 'POST', headers: { 'X-Webhook-Secret': 'change-me' } });
        const data = await res.json();
        alert(`Flagged ${data.flagged} stale leads.`);
        fetchLeads();
    } catch(e) { alert("Error"); }
}

async function bookCall(email) {
    try {
        const res = await fetch('/webhook/call-booked', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'change-me' },
            body: JSON.stringify({ lead_email: email, call_date: new Date().toISOString() })
        });
        await res.json();
        closeModal();
        fetchLeads();
    } catch(e) { alert("Error"); }
}
