import React, { useState, useEffect, useRef } from 'react';
import {
  Layers, Users, Terminal, Settings, Play, CheckCircle2,
  RefreshCw, Search, Eye, Video, Database, Sparkles, 
  ExternalLink, Globe, ArrowRight, Mail, FileText, Check, 
  RotateCcw, Volume2, Trash2, Shield
} from 'lucide-react';

interface Lead {
  id: string;
  fullName: string;
  email: string;
  companyName: string;
  domain: string;
  jobTitle: string;
  blindSpot: string;
  createdAt: string;
  status: string; // Captured, Enriched, Qualified, VideoGenerated, Synced, Outreached, Replied, Disqualified, Needs Clarification
  engagementStatus: string; // Pending, Sent, Opened, Clicked, Replied, SMS_Sent, WhatsApp_Sent
  qualification?: string; // Hot, Warm, Cold
  score?: number;
  primaryPainPoint?: string;
  reasoning?: string;
  clarifyingQuestion?: string | null;
  videoScript?: string;
  videoUrl?: string;
  voiceFileUrl?: string | null;
  hubspotSynced?: boolean;
  hubspotContactId?: string | null;
  emailSent?: boolean;
  timeline?: Array<{ status: string; timestamp: string; message: string }>;
  enrichment?: {
    title?: string;
    description?: string;
    h1?: string;
    bodySnippet?: string;
    reason?: string;
  } | null;
}

interface Log {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  module: string;
  message: string;
  details?: any;
}

interface SettingsConfig {
  groqApiKey: string;
  geminiApiKey: string;
  openaiApiKey: string;
  hubspotAccessToken: string;
  resendApiKey: string;
  elevenlabsApiKey: string;
  twilioSid: string;
  twilioToken: string;
  twilioPhone: string;
  testRecipientPhone?: string;
  discordWebhookUrl?: string;
  telegramBotToken?: string;
  telegramChatId?: string;
  clientBaseUrl?: string;
}

const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000'
  : window.location.origin;

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'leads' | 'logs' | 'settings'>('simulator');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [settings, setSettings] = useState<SettingsConfig>({
    groqApiKey: '',
    geminiApiKey: '',
    openaiApiKey: '',
    hubspotAccessToken: '',
    resendApiKey: '',
    elevenlabsApiKey: '',
    twilioSid: '',
    twilioToken: '',
    twilioPhone: '',
    testRecipientPhone: '',
    discordWebhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    clientBaseUrl: window.location.origin
  });

  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPlayingVideo, setIsPlayingVideo] = useState(false);
  const [clarificationAnswer, setClarificationAnswer] = useState('');
  const [selectedForm, setSelectedForm] = useState<'demo' | 'checker'>('demo');
  const [logFilter, setLogFilter] = useState<string>('all');
  const [simulatingAction, setSimulatingAction] = useState<string | null>(null);
  const [hasAutoOpened, setHasAutoOpened] = useState(false);

  // Lead Intake Form State
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [blindSpot, setBlindSpot] = useState('');

  // Settings status message
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);

  // Video playback speaking tracking
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [spokenCaption, setSpokenCaption] = useState('');
  const [speakingProgress, setSpeakingProgress] = useState(0);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Poll leads and logs every 1.5 seconds to capture background processing
  useEffect(() => {
    fetchLeads();
    fetchLogs();
    fetchSettings();
    synthRef.current = window.speechSynthesis;

    const interval = setInterval(() => {
      fetchLeads();
      fetchLogs();
    }, 1500);

    return () => {
      clearInterval(interval);
      if (synthRef.current) {
        synthRef.current.cancel();
      }
    };
  }, []);

  // Update selected lead details if it updates in the backend
  useEffect(() => {
    if (selectedLead) {
      const updated = leads.find(l => l.id === selectedLead.id);
      if (updated) setSelectedLead(updated);
    }
  }, [leads]);

  // Deep link routing check
  useEffect(() => {
    if (hasAutoOpened) return;
    const path = window.location.pathname;
    const match = path.match(/\/video\/([0-9a-zA-Z]+)/);
    if (match && match[1] && leads.length > 0) {
      const targetId = match[1];
      const lead = leads.find(l => l.id === targetId);
      if (lead && lead.videoScript) {
        setHasAutoOpened(true);
        // Auto open the video portal for the prospect
        openVideoPortal(lead);

        // Automatically track the link click in the background
        if (lead.engagementStatus !== 'Clicked' && lead.engagementStatus !== 'Replied') {
          fetch(`${BACKEND_URL}/api/leads/${targetId}/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'click' })
          })
          .then(res => {
            if (res.ok) fetchLeads();
          })
          .catch(err => console.error('Click tracking failed:', err));
        }
      }
    }
  }, [leads, hasAutoOpened]);

  const fetchLeads = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads`);
      const data = await response.json();
      setLeads(data.reverse()); // latest first
    } catch (err) {
      console.error('Error fetching leads:', err);
    }
  };

  const fetchLogs = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/logs`);
      const data = await response.json();
      setLogs(data.reverse()); // latest first
    } catch (err) {
      console.error('Error fetching logs:', err);
    }
  };

  const fetchSettings = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`);
      const data = await response.json();
      setSettings(prev => ({ ...prev, ...data }));
    } catch (err) {
      console.error('Error fetching settings:', err);
    }
  };

  const handleSettingsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSettingsStatus('Saving...');
    try {
      const response = await fetch(`${BACKEND_URL}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (response.ok) {
        setSettingsStatus('Settings saved successfully!');
        setTimeout(() => setSettingsStatus(null), 3000);
      } else {
        setSettingsStatus('Error saving settings.');
      }
    } catch (err) {
      setSettingsStatus('Connection failed.');
    }
  };

  const handleLeadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Auto-fill values for Checker form
    let payload = {
      fullName,
      email,
      companyName,
      domain,
      jobTitle,
      blindSpot
    };

    if (selectedForm === 'checker') {
      const domainName = domain.replace(/^(https?:\/\/)?(www\.)?/, '').split('.')[0];
      const capitalized = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      payload = {
        fullName: fullName || 'Exposure Score Requester',
        email: email || `security@${domain.replace(/^(https?:\/\/)?(www\.)?/, '')}`,
        companyName: companyName || capitalized,
        domain: domain,
        jobTitle: jobTitle || 'Security/IT Administrator',
        blindSpot: blindSpot || 'Exposed credentials, shadow subdomains, and cloud posture audit.'
      };
    }

    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (response.ok) {
        const newLead = await response.json();
        setSelectedLead(newLead);
        // Clear inputs
        if (selectedForm === 'demo') {
          setFullName('');
          setEmail('');
          setCompanyName('');
          setDomain('');
          setJobTitle('');
          setBlindSpot('');
        }
      }
    } catch (err) {
      console.error('Submit lead error:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSimulate = async (leadId: string, action: string) => {
    setSimulatingAction(action);
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/${leadId}/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action })
      });
      if (response.ok) {
        fetchLeads();
        setSimulatingAction(`${action}_success`);
        setTimeout(() => setSimulatingAction(null), 1500);
      } else {
        setSimulatingAction(null);
      }
    } catch (err) {
      console.error('Simulate error:', err);
      setSimulatingAction(null);
    }
  };

  const handleRetry = async (leadId: string) => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/${leadId}/retry`, {
        method: 'POST'
      });
      if (response.ok) {
        fetchLeads();
      }
    } catch (err) {
      console.error('Retry error:', err);
    }
  };

  const handleDeleteLead = async (leadId: string) => {
    if (!window.confirm('Are you sure you want to delete this lead?')) return;
    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/${leadId}`, {
        method: 'DELETE'
      });
      if (response.ok) {
        fetchLeads();
        if (selectedLead && selectedLead.id === leadId) {
          setSelectedLead(null);
        }
      }
    } catch (err) {
      console.error('Delete lead error:', err);
    }
  };

  const handleClarification = async (e: React.FormEvent, leadId: string) => {
    e.preventDefault();
    if (!clarificationAnswer) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/leads/${leadId}/submit-clarification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: clarificationAnswer })
      });
      if (response.ok) {
        setClarificationAnswer('');
        fetchLeads();
      }
    } catch (err) {
      console.error('Clarification submit error:', err);
    }
  };

  const clearLeads = async () => {
    if (!window.confirm('Are you sure you want to purge all leads database data?')) return;
    try {
      await fetch(`${BACKEND_URL}/api/leads/clear`, { method: 'POST' });
      setLeads([]);
      setSelectedLead(null);
    } catch (err) {
      console.error('Clear leads error:', err);
    }
  };

  const clearLogs = async () => {
    try {
      await fetch(`${BACKEND_URL}/api/logs/clear`, { method: 'POST' });
      setLogs([]);
    } catch (err) {
      console.error('Clear logs error:', err);
    }
  };

  // Video avatar synthesis speech logic
  const startVideoAudio = (lead: Lead) => {
    if (!lead.videoScript) return;
    
    // Stop any current voiceovers
    stopVideoAudio();

    if (lead.voiceFileUrl) {
      // Play ElevenLabs audio
      const audioUrl = `${BACKEND_URL}${lead.voiceFileUrl}`;
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      setIsSpeaking(true);
      setSpokenCaption(lead.videoScript);
      
      audio.play();
      audio.ontimeupdate = () => {
        if (audio.duration) {
          setSpeakingProgress((audio.currentTime / audio.duration) * 100);
        }
      };
      audio.onended = () => {
        setIsSpeaking(false);
        setSpeakingProgress(100);
      };
    } else if (synthRef.current) {
      // Fallback Web Speech synthesis
      setIsSpeaking(true);
      const text = lead.videoScript;
      const utterance = new SpeechSynthesisUtterance(text);
      utteranceRef.current = utterance;
      
      // Try to find a nice English voice
      const voices = synthRef.current.getVoices();
      const premiumVoice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha') || v.name.includes('Natural') || v.lang === 'en-US');
      if (premiumVoice) utterance.voice = premiumVoice;
      
      utterance.rate = 0.95;
      utterance.pitch = 1.0;

      // Word-level text highlights (mock dynamic captions)
      const words = text.split(' ');
      let currentWordIndex = 0;
      
      utterance.onboundary = (event) => {
        if (event.name === 'word') {
          const charIndex = event.charIndex;
          // Find which word index this charIndex corresponds to
          let charAccumulator = 0;
          for (let i = 0; i < words.length; i++) {
            charAccumulator += words[i].length + 1; // +1 for space
            if (charAccumulator > charIndex) {
              currentWordIndex = i;
              break;
            }
          }
          const wordsToShow = words.slice(Math.max(0, currentWordIndex - 4), currentWordIndex + 6).join(' ');
          setSpokenCaption(`... ${wordsToShow} ...`);
          setSpeakingProgress((currentWordIndex / words.length) * 100);
        }
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setSpokenCaption(text);
        setSpeakingProgress(100);
      };

      utterance.onerror = () => {
        setIsSpeaking(false);
      };

      synthRef.current.speak(utterance);
    }
  };

  const stopVideoAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    setIsSpeaking(false);
    setSpokenCaption('');
    setSpeakingProgress(0);
  };

  const openVideoPortal = (lead: Lead) => {
    setSelectedLead(lead);
    setIsPlayingVideo(true);
    // Slight delay to ensure modal renders
    setTimeout(() => {
      startVideoAudio(lead);
    }, 500);
  };

  const closeVideoPortal = () => {
    stopVideoAudio();
    setIsPlayingVideo(false);
  };

  // Helper to determine node execution status colors in Graph
  const getNodeStatus = (nodeName: string, lead: Lead | null) => {
    if (!lead) return { color: 'var(--text-dark)', active: false, success: false, label: 'Pending' };

    const statusIndex: { [key: string]: number } = {
      'Captured': 1,
      'Enriched': 2,
      'Qualified': 3,
      'VideoGenerated': 4,
      'Synced': 5,
      'Outreached': 6,
      'Needs Clarification': 3,
      'Disqualified': 3,
      'Replied': 6,
      'Error': 0
    };

    const currentIdx = statusIndex[lead.status] || 0;
    const nodeIndexMap: { [key: string]: number } = {
      'capture': 1,
      'enrich': 2,
      'qualify': 3,
      'script': 4,
      'video': 4,
      'crm': 5,
      'email': 6,
      'sms': 6
    };

    const targetIdx = nodeIndexMap[nodeName];

    // Handle Disqualification
    if (lead.status === 'Disqualified' && targetIdx >= 3) {
      if (targetIdx === 3) return { color: 'var(--tier-cold)', active: false, success: false, error: true, label: 'Disqualified' };
      return { color: 'var(--text-dark)', active: false, success: false, label: 'Skipped' };
    }

    // Handle Needs Clarification
    if (lead.status === 'Needs Clarification' && targetIdx >= 3) {
      if (targetIdx === 3) return { color: 'var(--color-warning)', active: false, success: false, label: 'Needs Clarification' };
      return { color: 'var(--text-dark)', active: false, success: false, label: 'Waiting...' };
    }

    if (lead.status === 'Error') {
      return { color: 'var(--color-error)', active: false, success: false, error: true, label: 'Failed' };
    }

    if (currentIdx === targetIdx) {
      return { color: 'var(--color-primary)', active: true, success: false, label: 'Processing...' };
    } else if (currentIdx > targetIdx) {
      return { color: 'var(--color-success)', active: false, success: true, label: 'Completed' };
    } else {
      return { color: 'var(--text-dark)', active: false, success: false, label: 'Pending' };
    }
  };

  const filteredLogs = logs.filter(l => {
    if (logFilter === 'all') return true;
    return l.level === logFilter;
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navbar */}
      <header className="glass-panel" style={{ borderRadius: 0, borderTop: 'none', borderLeft: 'none', borderRight: 'none', zIndex: 10, padding: '0 24px' }}>
        <div style={{ maxWidth: '1600px', margin: '0 auto', height: '70px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1e3a8a 100%)', width: '40px', height: '40px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 12px rgba(59,130,246,0.3)' }}>
              <Shield size={22} color="white" />
            </div>
            <div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 800, background: 'linear-gradient(to right, #ffffff, #9ca3af)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>NimbusGuard</h1>
              <span style={{ fontSize: '0.7rem', color: 'var(--color-primary)', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Revenue Operations & Video Engine</span>
            </div>
          </div>

          <nav style={{ display: 'flex', gap: '8px' }}>
            <button className={`tab-btn ${activeTab === 'simulator' ? 'active' : ''}`} onClick={() => setActiveTab('simulator')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Layers size={18} />
                Live Simulator
              </div>
            </button>
            <button className={`tab-btn ${activeTab === 'leads' ? 'active' : ''}`} onClick={() => setActiveTab('leads')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Users size={18} />
                Leads Directory
                {leads.length > 0 && <span style={{ background: 'var(--color-primary-glow)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '10px', fontSize: '0.65rem', fontWeight: 700 }}>{leads.length}</span>}
              </div>
            </button>
            <button className={`tab-btn ${activeTab === 'logs' ? 'active' : ''}`} onClick={() => setActiveTab('logs')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Terminal size={18} />
                System Logs & Prompts
              </div>
            </button>
            <button className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Settings size={18} />
                Integrations Setup
              </div>
            </button>
          </nav>
        </div>
      </header>

      {/* Main Workspace Area */}
      <main style={{ flex: 1, padding: '24px 0' }}>
        <div className="dashboard-container">
          
          {/* TAB 1: LIVE SIMULATOR */}
          {activeTab === 'simulator' && (
            <div className="dashboard-grid">
              
              {/* Left Column: Form Capture */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="glass-panel" style={{ padding: '24px' }}>
                  <div style={{ display: 'flex', gap: '12px', borderBottom: '1px solid var(--border-color)', paddingBottom: '16px', marginBottom: '20px' }}>
                    <button 
                      className={`btn-secondary`} 
                      style={{ flex: 1, background: selectedForm === 'demo' ? 'var(--color-primary-glow)' : 'transparent', borderColor: selectedForm === 'demo' ? 'var(--color-primary)' : 'var(--border-color)', color: selectedForm === 'demo' ? 'white' : 'var(--text-muted)' }}
                      onClick={() => setSelectedForm('demo')}
                    >
                      Demo Form Intake
                    </button>
                    <button 
                      className={`btn-secondary`} 
                      style={{ flex: 1, background: selectedForm === 'checker' ? 'var(--color-primary-glow)' : 'transparent', borderColor: selectedForm === 'checker' ? 'var(--color-primary)' : 'var(--border-color)', color: selectedForm === 'checker' ? 'white' : 'var(--text-muted)' }}
                      onClick={() => setSelectedForm('checker')}
                    >
                      Exposure score Tool
                    </button>
                  </div>

                  {selectedForm === 'demo' ? (
                    <form onSubmit={handleLeadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ textAlign: 'left' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '6px' }}>Request a Live Demo</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Simulates the corporate demo request pathway with enrichment and scoring.</p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Full Name *</label>
                        <input type="text" placeholder="e.g. Sarah Jenkins" value={fullName} onChange={e => setFullName(e.target.value)} required />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Work Email *</label>
                        <input type="email" placeholder="e.g. sjenkins@stripe.com" value={email} onChange={e => setEmail(e.target.value)} required />
                      </div>

                      <div style={{ display: 'flex', gap: '12px' }}>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Company Name *</label>
                          <input type="text" placeholder="Stripe" value={companyName} onChange={e => setCompanyName(e.target.value)} required />
                        </div>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Company Domain *</label>
                          <input type="text" placeholder="stripe.com" value={domain} onChange={e => setDomain(e.target.value)} required />
                        </div>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Job Title *</label>
                        <input type="text" placeholder="e.g. CISO or VP of Engineering" value={jobTitle} onChange={e => setJobTitle(e.target.value)} required />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>What is the biggest blind spot in your external attack surface? *</label>
                        <textarea placeholder="e.g., Leaked developer credentials and forgotten testing subdomains on AWS." rows={3} value={blindSpot} onChange={e => setBlindSpot(e.target.value)} required />
                      </div>

                      <button type="submit" className="btn-primary" disabled={isSubmitting} style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        {isSubmitting ? <RefreshCw className="node-pulse-active" size={16} /> : <Play size={16} />}
                        Submit Demo Request
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleLeadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div style={{ textAlign: 'left' }}>
                        <h3 style={{ fontSize: '1.1rem', marginBottom: '6px' }}>Exposure Score Checker</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Simulates the interactive tool. Enter a domain to trigger a real external scrape.</p>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Target Company Domain *</label>
                        <input type="text" placeholder="e.g. github.com or local-hospital.org" value={domain} onChange={e => setDomain(e.target.value)} required />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Your Full Name (Optional)</label>
                        <input type="text" placeholder="John Doe" value={fullName} onChange={e => setFullName(e.target.value)} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Your Business Email (Optional)</label>
                        <input type="email" placeholder="john@company.com" value={email} onChange={e => setEmail(e.target.value)} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Your Job Title (Optional)</label>
                        <input type="text" placeholder="Security Engineer" value={jobTitle} onChange={e => setJobTitle(e.target.value)} />
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>Specific Concerns / Blind Spots (Optional)</label>
                        <textarea placeholder="e.g., exposed APIs, public S3 buckets" rows={2} value={blindSpot} onChange={e => setBlindSpot(e.target.value)} />
                      </div>

                      <button type="submit" className="btn-primary" disabled={isSubmitting} style={{ marginTop: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 12px rgba(16,185,129,0.3)' }}>
                        {isSubmitting ? <RefreshCw className="node-pulse-active" size={16} /> : <Sparkles size={16} />}
                        Analyze Attack Surface
                      </button>
                    </form>
                  )}
                </div>

                {/* Quick Presets for Demo Reviewers */}
                <div className="glass-panel" style={{ padding: '20px' }}>
                  <h4 style={{ fontSize: '0.9rem', marginBottom: '12px', color: 'var(--text-muted)' }}>Quick Load Test Cases</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <button className="btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => {
                      setSelectedForm('demo');
                      setFullName('Alexander Thorne');
                      setEmail('a.thorne@coinbase.com');
                      setCompanyName('Coinbase');
                      setDomain('coinbase.com');
                      setJobTitle('Head of Information Security');
                      setBlindSpot('We recently underwent an audit and are highly concerned about shadow IT cloud environments and exposed dev credentials on GitHub.');
                    }}>
                      <span>Hot Lead (FinTech CISO)</span>
                      <span className="badge badge-hot" style={{ fontSize: '0.55rem' }}>Hot ICP</span>
                    </button>

                    <button className="btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => {
                      setSelectedForm('demo');
                      setFullName('Robert Chen');
                      setEmail('r.chen@medline.org');
                      setCompanyName('MedLine Healthcare');
                      setDomain('medline.com');
                      setJobTitle('General IT Manager');
                      setBlindSpot('We want to verify if any SaaS logins are exposed.');
                    }}>
                      <span>Warm Lead (Healthcare IT Mgr)</span>
                      <span className="badge badge-warm" style={{ fontSize: '0.55rem' }}>Warm ICP</span>
                    </button>

                    <button className="btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => {
                      setSelectedForm('demo');
                      setFullName('Toby Baker');
                      setEmail('tobybaker99@gmail.com');
                      setCompanyName('Baker Local Bakery');
                      setDomain('bakerybaker.com');
                      setJobTitle('Owner');
                      setBlindSpot('Not sure if my website is secure, testing this out.');
                    }}>
                      <span>Cold Lead (Personal Email / Retail)</span>
                      <span className="badge badge-cold" style={{ fontSize: '0.55rem' }}>Cold ICP</span>
                    </button>

                    <button className="btn-secondary" style={{ padding: '8px 12px', fontSize: '0.85rem', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => {
                      setSelectedForm('demo');
                      setFullName('Clara Oswald');
                      setEmail('clara@tardis.io');
                      setCompanyName('Time Travel Corp');
                      setDomain('tardis.io');
                      setJobTitle('VP Operations');
                      setBlindSpot('none');
                    }}>
                      <span>Conversational AI (Vague Pain Point)</span>
                      <span className="badge badge-warm" style={{ fontSize: '0.55rem', backgroundColor: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}>Clarify</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Right Column: Live Orchestrator Node Graph */}
              <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%', minHeight: '600px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <div>
                    <h3 style={{ fontSize: '1.1rem' }}>Revenue Operations Automation Pipeline</h3>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Visual execution chart of the system node runs in real-time.</p>
                  </div>
                  {selectedLead && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Focus Lead:</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>{selectedLead.fullName.split(' ')[0]} ({selectedLead.companyName})</span>
                    </div>
                  )}
                </div>

                {!selectedLead ? (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dark)', gap: '16px' }}>
                    <Layers size={48} />
                    <p style={{ textAlign: 'center', fontSize: '0.95rem' }}>No lead has been processed in this session yet.<br/>Submit a form on the left or select an existing lead in the leads directory to watch the orchestrator graph activate.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
                    
                    {/* Node Graph Container */}
                    <div style={{ background: 'rgba(0,0,0,0.4)', borderRadius: '12px', border: '1px solid var(--border-color)', padding: '24px', position: 'relative', overflow: 'hidden' }}>
                      
                      {/* Connection lines background */}
                      <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }}>
                        {/* We draw beautiful connecting wire representations with simple CSS */}
                      </div>

                      {/* Node Graph Grid */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', zIndex: 2, position: 'relative' }}>
                        
                        {/* Row 1: Captures & Enrichment */}
                        <div style={{ display: 'flex', justifyContent: 'space-around', gap: '16px', flexWrap: 'wrap' }}>
                          
                          {/* Node 1: Capture */}
                          {(() => {
                            const node = getNodeStatus('capture', selectedLead);
                            return (
                              <div className={`glass-panel ${node.active ? 'node-pulse-active' : ''} ${node.success ? 'node-pulse-success' : ''}`} style={{ width: '220px', padding: '16px', borderLeft: `4px solid ${node.color}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                  <FileText size={18} color={node.color} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>1. Form Capture</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{selectedLead.domain ? `Domain: ${selectedLead.domain}` : 'Lead Captured'}</p>
                                <span style={{ fontSize: '0.65rem', color: node.color, fontWeight: 700, textTransform: 'uppercase', marginTop: '6px', display: 'block' }}>{node.label}</span>
                              </div>
                            );
                          })()}

                          {/* Node 2: Enrichment */}
                          {(() => {
                            const node = getNodeStatus('enrich', selectedLead);
                            return (
                              <div className={`glass-panel ${node.active ? 'node-pulse-active' : ''} ${node.success ? 'node-pulse-success' : ''}`} style={{ width: '220px', padding: '16px', borderLeft: `4px solid ${node.color}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                  <Globe size={18} color={node.color} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>2. Web Scraper</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {selectedLead.enrichment?.title 
                                    ? `Scraped: ${selectedLead.enrichment.title.substring(0, 20)}...` 
                                    : selectedLead.enrichment?.reason 
                                      ? selectedLead.enrichment.reason 
                                      : 'Analyzing domain metadata'
                                  }
                                </p>
                                <span style={{ fontSize: '0.65rem', color: node.color, fontWeight: 700, textTransform: 'uppercase', marginTop: '6px', display: 'block' }}>{node.label}</span>
                              </div>
                            );
                          })()}

                          {/* Node 3: AI Qualification */}
                          {(() => {
                            const node = getNodeStatus('qualify', selectedLead);
                            return (
                              <div className={`glass-panel ${node.active ? 'node-pulse-active' : ''} ${node.success ? 'node-pulse-success' : ''}`} style={{ width: '220px', padding: '16px', borderLeft: `4px solid ${node.color}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                  <Sparkles size={18} color={node.color} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>3. AI Agent Score</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {selectedLead.qualification 
                                    ? `ICP fit: ${selectedLead.qualification} (${selectedLead.score}/100)` 
                                    : 'Evaluating criteria metrics'
                                  }
                                </p>
                                <span style={{ fontSize: '0.65rem', color: node.color, fontWeight: 700, textTransform: 'uppercase', marginTop: '6px', display: 'block' }}>{node.label}</span>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Connection Arrows Row */}
                        <div style={{ display: 'flex', justifyContent: 'center', margin: '-10px 0', color: 'var(--text-dark)' }}>
                          <ArrowRight style={{ transform: 'rotate(90deg)' }} />
                        </div>

                        {/* Row 2: Video, CRM and Outreach Channels */}
                        <div style={{ display: 'flex', justifyContent: 'space-around', gap: '16px', flexWrap: 'wrap' }}>
                          
                          {/* Node 4: Video Avatar */}
                          {(() => {
                            const node = getNodeStatus('video', selectedLead);
                            return (
                              <div className={`glass-panel ${node.active ? 'node-pulse-active' : ''} ${node.success ? 'node-pulse-success' : ''}`} style={{ width: '220px', padding: '16px', borderLeft: `4px solid ${node.color}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                  <Video size={18} color={node.color} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>4. Video Generator</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {selectedLead.videoScript 
                                    ? `Created speech & video`
                                    : 'Awaiting qualification'
                                  }
                                </p>
                                <span style={{ fontSize: '0.65rem', color: node.color, fontWeight: 700, textTransform: 'uppercase', marginTop: '6px', display: 'block' }}>{node.label}</span>
                              </div>
                            );
                          })()}

                          {/* Node 5: CRM Sync */}
                          {(() => {
                            const node = getNodeStatus('crm', selectedLead);
                            return (
                              <div className={`glass-panel ${node.active ? 'node-pulse-active' : ''} ${node.success ? 'node-pulse-success' : ''}`} style={{ width: '220px', padding: '16px', borderLeft: `4px solid ${node.color}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                  <Database size={18} color={node.color} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>5. CRM Database</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {selectedLead.hubspotContactId 
                                    ? `Synced HubSpot: #${selectedLead.hubspotContactId}`
                                    : selectedLead.hubspotSynced === false
                                      ? 'Logged in Local CRM'
                                      : 'CRM Synchronization'
                                  }
                                </p>
                                <span style={{ fontSize: '0.65rem', color: node.color, fontWeight: 700, textTransform: 'uppercase', marginTop: '6px', display: 'block' }}>{node.label}</span>
                              </div>
                            );
                          })()}

                          {/* Node 6: Messaging Outreach */}
                          {(() => {
                            const node = getNodeStatus('email', selectedLead);
                            return (
                              <div className={`glass-panel ${node.active ? 'node-pulse-active' : ''} ${node.success ? 'node-pulse-success' : ''}`} style={{ width: '220px', padding: '16px', borderLeft: `4px solid ${node.color}` }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                                  <Mail size={18} color={node.color} />
                                  <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>6. Email Send (Day 0)</span>
                                </div>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                  {selectedLead.engagementStatus !== 'Pending' 
                                    ? `Delivered: ${selectedLead.engagementStatus}` 
                                    : 'Awaiting dispatch'
                                  }
                                </p>
                                <span style={{ fontSize: '0.65rem', color: node.color, fontWeight: 700, textTransform: 'uppercase', marginTop: '6px', display: 'block' }}>{node.label}</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>

                    {/* Node Console Diagnostic Summary */}
                    <div className="glass-panel" style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>Active Status Diagnostic Log</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 600 }}>Pipeline stage: {selectedLead.status}</span>
                      </div>

                      {/* Diagnostic detail box */}
                      <div style={{ background: 'rgba(0,0,0,0.3)', borderRadius: '8px', padding: '12px', fontSize: '0.85rem', fontFamily: 'monospace', flex: 1, minHeight: '120px', overflowY: 'auto' }}>
                        <p style={{ color: 'var(--text-muted)' }}>[Timeline Node Trail]</p>
                        {selectedLead.timeline?.map((t, idx) => (
                          <p key={idx} style={{ margin: '4px 0' }}>
                            <span style={{ color: 'var(--color-primary)' }}>[{new Date(t.timestamp).toLocaleTimeString()}]</span> {t.message}
                          </p>
                        ))}
                        
                        {selectedLead.status === 'Needs Clarification' && (
                          <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '12px', paddingTop: '12px' }}>
                            <p style={{ color: 'var(--color-warning)', fontWeight: 600 }}>AI Request: Clarification Needed</p>
                            <p style={{ color: 'white', margin: '4px 0', fontStyle: 'italic' }}>"{selectedLead.clarifyingQuestion}"</p>
                            
                            <form onSubmit={(e) => handleClarification(e, selectedLead.id)} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                              <input 
                                type="text" 
                                placeholder="Enter details to clarify..." 
                                value={clarificationAnswer} 
                                onChange={e => setClarificationAnswer(e.target.value)} 
                                style={{ padding: '8px', fontSize: '0.8rem' }}
                              />
                              <button type="submit" className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.8rem' }}>Submit</button>
                            </form>
                          </div>
                        )}

                        {selectedLead.status === 'Disqualified' && (
                          <p style={{ color: 'var(--tier-hot)', marginTop: '8px' }}>
                            Disqualified reasoning: {selectedLead.reasoning}
                          </p>
                        )}

                        {selectedLead.status === 'Outreached' && selectedLead.videoUrl && (
                          <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '12px', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--color-success)' }}>Personalized video synthesized successfully.</span>
                            <button className="btn-primary" style={{ padding: '8px 16px', fontSize: '0.8rem', background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' }} onClick={() => openVideoPortal(selectedLead)}>
                              <Video size={14} style={{ marginRight: '6px', inlineSize: 'auto' }} /> Watch Video
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: LEADS DIRECTORY */}
          {activeTab === 'leads' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              
              {/* Header options */}
              <div className="glass-panel" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                  <Search size={18} color="var(--text-muted)" />
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Database Contacts Ledger</span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button className="btn-danger" style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px', fontSize: '0.85rem' }} onClick={clearLeads}>
                    <Trash2 size={16} /> Purge Ledger
                  </button>
                </div>
              </div>

              {/* Leads grid display */}
              <div className="glass-panel" style={{ overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Lead Details</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Company & Domain</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Fit Score</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Stage</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Engagement</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600 }}>Actions</th>
                      <th style={{ padding: '16px', fontSize: '0.85rem', color: 'var(--text-muted)', fontWeight: 600, width: '60px', textAlign: 'center' }}>Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: '48px', textAlign: 'center', color: 'var(--text-dark)' }}>
                          <Users size={32} style={{ marginBottom: '8px' }} />
                          <p>No leads in database yet. Use the simulator tab to submit form data.</p>
                        </td>
                      </tr>
                    ) : (
                      leads.map(lead => (
                        <tr key={lead.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'var(--transition-smooth)' }} className="lead-row" onClick={() => setSelectedLead(lead)}>
                          <td style={{ padding: '16px' }}>
                            <div style={{ fontWeight: 600, color: 'white' }}>{lead.fullName}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{lead.jobTitle || 'No Title'}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginTop: '4px' }}>{lead.email}</div>
                          </td>
                          <td style={{ padding: '16px' }}>
                            <div style={{ fontWeight: 500 }}>{lead.companyName}</div>
                            <a href={`https://${lead.domain}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.8rem', color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
                              {lead.domain} <ExternalLink size={12} />
                            </a>
                          </td>
                          <td style={{ padding: '16px' }}>
                            {lead.qualification ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className={`badge badge-${lead.qualification.toLowerCase()}`}>
                                  {lead.qualification}
                                </span>
                                <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>{lead.score}/100</span>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-dark)' }}>Pending</span>
                            )}
                          </td>
                          <td style={{ padding: '16px' }}>
                            <span style={{ fontSize: '0.85rem', color: lead.status === 'Error' ? 'var(--color-error)' : 'var(--text-primary)' }}>{lead.status}</span>
                          </td>
                          <td style={{ padding: '16px' }}>
                            <span className="badge" style={{ 
                              backgroundColor: lead.engagementStatus === 'Clicked' || lead.engagementStatus === 'Replied' ? 'var(--color-success-glow)' : 'rgba(255,255,255,0.04)',
                              color: lead.engagementStatus === 'Clicked' || lead.engagementStatus === 'Replied' ? 'var(--color-success)' : 'var(--text-muted)'
                            }}>
                              {lead.engagementStatus}
                            </span>
                          </td>
                          <td style={{ padding: '16px' }} onClick={e => e.stopPropagation()}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button className="btn-secondary" style={{ padding: '6px 10px', fontSize: '0.8rem' }} onClick={() => setSelectedLead(lead)} title="View Details">
                                <Eye size={14} />
                              </button>
                              
                              {lead.videoScript && (
                                <button className="btn-primary" style={{ padding: '6px 10px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => openVideoPortal(lead)} title="Watch Video">
                                  <Video size={14} /> Watch
                                </button>
                              )}
                              
                              {lead.status === 'Error' && (
                                <button className="btn-secondary" style={{ padding: '6px 10px', fontSize: '0.8rem', color: 'var(--color-warning)' }} onClick={() => handleRetry(lead.id)} title="Retry Processing">
                                  <RotateCcw size={14} /> Retry
                                </button>
                              )}
                            </div>
                          </td>
                          <td style={{ padding: '16px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                            <button className="btn-danger" style={{ padding: '6px 10px', fontSize: '0.8rem', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.4)', color: 'rgb(239, 68, 68)' }} onClick={() => handleDeleteLead(lead.id)} title="Delete Lead">
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {/* Selected Lead details panel */}
              {selectedLead && (
                <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                    <h3 style={{ fontSize: '1.2rem' }}>Lead Analysis Overview: {selectedLead.fullName}</h3>
                    <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => setSelectedLead(null)}>Close Panel</button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }} className="leads-detail-grid">
                    {/* Left details grid */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Stated Pain Point</span>
                        <p style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontSize: '0.9rem', border: '1px solid var(--border-color)' }}>
                          "{selectedLead.blindSpot}"
                        </p>
                      </div>

                      {selectedLead.enrichment && (
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Website Scrape Enrichment Data</span>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid var(--border-color)' }}>
                            <p><strong>Meta Title:</strong> {selectedLead.enrichment.title || 'N/A'}</p>
                            <p><strong>Meta Description:</strong> {selectedLead.enrichment.description || 'N/A'}</p>
                            <p><strong>Header (H1):</strong> {selectedLead.enrichment.h1 || 'N/A'}</p>
                            {selectedLead.enrichment.bodySnippet && (
                              <details>
                                <summary style={{ cursor: 'pointer', color: 'var(--color-primary)', fontSize: '0.8rem', marginTop: '4px' }}>View Scraped Body Snippet</summary>
                                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px', maxHeight: '100px', overflowY: 'auto', fontFamily: 'monospace' }}>
                                  {selectedLead.enrichment.bodySnippet}
                                </p>
                              </details>
                            )}
                          </div>
                        </div>
                      )}

                      {selectedLead.reasoning && (
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>AI Fit Justification</span>
                          <p style={{ fontSize: '0.9rem', color: 'white', background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            {selectedLead.reasoning}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right action simulators panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                      <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.02)' }}>
                        <h4 style={{ fontSize: '0.95rem', marginBottom: '12px', fontWeight: 600 }}>Pipeline Interaction Simulator</h4>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '16px' }}>Simulate outreach callbacks to update HubSpot and status states automatically.</p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                          <button 
                            className="btn-secondary" 
                            disabled={!selectedLead.emailSent || simulatingAction !== null} 
                            style={{ fontSize: '0.8rem', padding: '10px' }}
                            onClick={() => handleSimulate(selectedLead.id, 'open')}
                          >
                            {simulatingAction === 'open' ? 'Simulating...' : 
                             simulatingAction === 'open_success' ? 'Email Opened! ✔' : 
                             'Simulate Email Open'}
                          </button>
                          <button 
                            className="btn-secondary" 
                            disabled={!selectedLead.emailSent || simulatingAction !== null} 
                            style={{ fontSize: '0.8rem', padding: '10px' }}
                            onClick={() => handleSimulate(selectedLead.id, 'click')}
                          >
                            {simulatingAction === 'click' ? 'Simulating...' : 
                             simulatingAction === 'click_success' ? 'Link Clicked! ✔' : 
                             'Simulate Link Click'}
                          </button>
                          <button 
                            className="btn-primary" 
                            disabled={!selectedLead.emailSent || simulatingAction !== null} 
                            style={{ fontSize: '0.8rem', padding: '10px', gridColumn: 'span 2' }}
                            onClick={() => handleSimulate(selectedLead.id, 'reply')}
                          >
                            {simulatingAction === 'reply' ? 'Simulating...' : 
                             simulatingAction === 'reply_success' ? 'Response Saved! ✔' : 
                             'Simulate Response (Calendar Invite)'}
                          </button>
                          <button 
                            className="btn-secondary" 
                            disabled={simulatingAction !== null}
                            style={{ fontSize: '0.8rem', padding: '10px', gridColumn: 'span 2', borderColor: 'var(--color-primary)' }}
                            onClick={() => handleSimulate(selectedLead.id, 'triggerSMS')}
                          >
                            {simulatingAction === 'triggerSMS' ? 'Sending SMS...' : 
                             simulatingAction === 'triggerSMS_success' ? 'SMS Sent! ✔' : 
                             'Trigger Twilio SMS Outreach'}
                          </button>
                        </div>
                      </div>

                      {selectedLead.videoScript && (
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Personalized Video Script</span>
                          <div style={{ background: 'rgba(0,0,0,0.2)', padding: '12px', borderRadius: '8px', fontSize: '0.85rem', border: '1px solid var(--border-color)', maxHeight: '160px', overflowY: 'auto' }}>
                            <p style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>"{selectedLead.videoScript}"</p>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SYSTEM LOGS & PROMPTS */}
          {activeTab === 'logs' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '24px' }}>
              
              {/* Top System Prompts panel */}
              <div className="glass-panel" style={{ padding: '24px' }}>
                <h3 style={{ fontSize: '1.2rem', marginBottom: '16px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>Engineered AI Prompts Overview</h3>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '20px' }}>
                  
                  <div>
                    <h4 style={{ fontSize: '0.95rem', color: 'var(--color-primary)', marginBottom: '8px', fontWeight: 600 }}>Pillar 1: AI Lead Qualification System Prompt</h4>
                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', fontSize: '0.8rem', overflowX: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--border-color)', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
{`You are an expert Sales Development Representative (SDR) and Growth Operations Specialist at NimbusGuard.
Your task is to analyze inbound lead data, enrich it, and qualify it using the following Ideal Customer Profile (ICP) criteria:

- Company Size:
  * Strong-Fit: 50 to 2,000 employees.
  * Disqualifying: Fewer than 10 employees, or huge enterprise procurement (>2,000 employees is complex enterprise procurement, categorise as Warm instead of Hot unless title/pain point is extremely strong, <10 is Cold).
- Industry:
  * Strong-Fit: Technology, SaaS, FinTech, Healthcare, E-commerce.
  * Disqualifying: Local retail, hospitality, personal/non-business.
- Job Title:
  * Strong-Fit: CISO, Head of Security, IT Director, VP Engineering, DevOps Lead, Security Engineer.
  * Disqualifying: Marketing, HR, student, competitor domain, or unrelated functions.
- Stated Pain Point:
  * Strong-Fit: References exposed assets, shadow IT, compliance/audit, recent breach, M&A diligence, open ports, leaking credentials.
  * Disqualifying: Empty, spam-like, or unrelated to security.
- Geography:
  * Strong-Fit: US, UK, EU, MENA.
  * Disqualifying: Regions outside coverage.

Analyze the input lead data and return a JSON object with:
1. "status": "complete" or "needs_clarification".
   Choose "needs_clarification" if any critical detail (like job title or company name) is missing, or if the "biggest blind spot" answer is extremely vague (e.g., "nothing", "asdf", "test", "not sure", or left empty).
2. "qualification": "Hot", "Warm", or "Cold".
   - "Hot": Strong-fit across size, industry, job title, and pain point.
   - "Warm": Matches some fit signals but has moderate criteria (e.g., larger company size, minor title mismatch like General IT Admin, or slightly vague but valid pain point).
   - "Cold": Matches disqualifying signals (e.g., personal email, tiny company, unrelated job, or spam pain point).
3. "score": An integer from 0 to 100 representing ICP alignment.
4. "primary_pain_point": A summary of the core security angle to use for personalized messaging and video script (e.g., "prevention of shadow IT and exposed cloud buckets").
5. "reasoning": A 1-2 sentence justification for the decision.
6. "clarifying_question": If status is "needs_clarification", write a highly professional, context-aware follow-up question to retrieve the missing/vague info. Otherwise, return null.

You MUST respond strictly in valid JSON format.`}
                    </pre>
                  </div>

                  <div>
                    <h4 style={{ fontSize: '0.95rem', color: 'var(--color-primary)', marginBottom: '8px', fontWeight: 600 }}>Pillar 2: Personalized Video Script System Prompt</h4>
                    <pre style={{ background: 'rgba(0,0,0,0.3)', padding: '16px', borderRadius: '8px', fontSize: '0.8rem', overflowX: 'auto', whiteSpace: 'pre-wrap', border: '1px solid var(--border-color)', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
{`You are an expert sales scriptwriter for NimbusGuard, an external attack surface management platform.
Your task is to write a highly personalized, natural 30-45 second video outreach script for a lead.
The script will be read by an AI avatar. Speak directly to the lead. Refer to them by name and reference their company.
Address their primary pain point and connect it back to NimbusGuard's value proposition.

Guidelines:
- Keep the script short (90 to 120 words).
- Write ONLY the spoken text. Do not include scene descriptions, speaker headers, or formatting.
- Make the tone professional, friendly, and helpful.
- End with a clear call-to-action: a quick 10-minute preview of their exposure report.

Return a JSON object with:
{
  "script": "The spoken script text...",
  "estimated_duration": "30s"
}`}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Server Console Logs console */}
              <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px' }}>
                  <h3 style={{ fontSize: '1.2rem' }}>Execution Diagnostic Console Logs</h3>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select value={logFilter} onChange={e => setLogFilter(e.target.value)} style={{ padding: '6px 12px', fontSize: '0.8rem', width: '140px' }}>
                      <option value="all">All Logs</option>
                      <option value="success">Success</option>
                      <option value="info">Info</option>
                      <option value="warning">Warning</option>
                      <option value="error">Error</option>
                    </select>
                    <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={clearLogs}>Clear Logs</button>
                  </div>
                </div>

                <div style={{ background: '#05070c', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', height: '400px', overflowY: 'auto', fontFamily: 'monospace', fontSize: '0.85rem' }}>
                  {filteredLogs.length === 0 ? (
                    <p style={{ color: 'var(--text-dark)', textAlign: 'center', marginTop: '160px' }}>Console ledger is empty. Pipeline actions will stream here.</p>
                  ) : (
                    filteredLogs.map(log => {
                      let logColor = '#9ca3af'; // info
                      if (log.level === 'success') logColor = 'var(--color-success)';
                      else if (log.level === 'warning') logColor = 'var(--color-warning)';
                      else if (log.level === 'error') logColor = 'var(--color-error)';

                      return (
                        <div key={log.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', padding: '6px 0' }}>
                          <span style={{ color: '#6b7280' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>{' '}
                          <span style={{ color: '#3b82f6', fontWeight: 600 }}>[{log.module}]</span>{' '}
                          <span style={{ color: logColor }}>{log.message}</span>
                          {log.details && (
                            <details style={{ marginTop: '4px', marginLeft: '20px' }}>
                              <summary style={{ cursor: 'pointer', color: '#6b7280', fontSize: '0.75rem' }}>Raw API details</summary>
                              <pre style={{ background: 'rgba(255,255,255,0.02)', padding: '8px', borderRadius: '4px', marginTop: '4px', fontSize: '0.75rem', overflowX: 'auto', whiteSpace: 'pre' }}>
                                {JSON.stringify(log.details, null, 2)}
                              </pre>
                            </details>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: INTEGRATIONS SETUP */}
          {activeTab === 'settings' && (
            <div className="glass-panel" style={{ padding: '24px', maxWidth: '800px', margin: '0 auto' }}>
              <h3 style={{ fontSize: '1.2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', marginBottom: '24px' }}>API Configurations Setup</h3>
              
              <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '20px' }}>
                NimbusGuard automation works natively with local heuristics. Plug in real third-party API Keys here to activate actual live connections (e.g. creating real HubSpot contacts or actual Resend outbound mail sends).
              </p>

              {settingsStatus && (
                <div style={{ background: 'var(--color-success-glow)', border: '1px solid var(--color-success)', color: 'white', padding: '12px', borderRadius: '8px', marginBottom: '20px', fontSize: '0.9rem' }}>
                  {settingsStatus}
                </div>
              )}

              <form onSubmit={handleSettingsSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '16px' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '12px' }}>AI Model Credentials (Pillar 1)</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Groq API Key (Primary — Free, Llama 3.3 70B)</label>
                      <input type="password" placeholder="gsk_..." value={settings.groqApiKey} onChange={e => setSettings({ ...settings, groqApiKey: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Google Gemini API Key (Fallback)</label>
                      <input type="password" placeholder="AIzaSy..." value={settings.geminiApiKey} onChange={e => setSettings({ ...settings, geminiApiKey: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>OpenAI API Key (Fallback)</label>
                      <input type="password" placeholder="sk-proj-..." value={settings.openaiApiKey} onChange={e => setSettings({ ...settings, openaiApiKey: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '16px' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '12px' }}>Voice Nurturing Audio API (Pillar 2)</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>ElevenLabs TTS API Key</label>
                    <input type="password" placeholder="Enter ElevenLabs Key" value={settings.elevenlabsApiKey} onChange={e => setSettings({ ...settings, elevenlabsApiKey: e.target.value })} />
                  </div>
                </div>

                <div style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: '16px' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '12px' }}>CRM & Outbound Delivery Integrations (Pillar 3)</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>HubSpot Private Access Token (Bearer Token)</label>
                      <input type="password" placeholder="pat-na1-..." value={settings.hubspotAccessToken} onChange={e => setSettings({ ...settings, hubspotAccessToken: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Resend Email API Key</label>
                      <input type="password" placeholder="re_..." value={settings.resendApiKey} onChange={e => setSettings({ ...settings, resendApiKey: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '12px' }}>Conditional Second Channel outreach</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Twilio Account SID</label>
                      <input type="text" placeholder="AC..." value={settings.twilioSid} onChange={e => setSettings({ ...settings, twilioSid: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Twilio Auth Token</label>
                      <input type="password" placeholder="Token" value={settings.twilioToken} onChange={e => setSettings({ ...settings, twilioToken: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Twilio Outbound Phone Number (Sender ID)</label>
                      <input type="text" placeholder="+15015555555" value={settings.twilioPhone} onChange={e => setSettings({ ...settings, twilioPhone: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Test Recipient Phone Number (Your Mobile)</label>
                      <input type="text" placeholder="+1XXXXXXXXXX" value={settings.testRecipientPhone || ''} onChange={e => setSettings({ ...settings, testRecipientPhone: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: '16px' }}>
                  <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--color-primary)', marginBottom: '12px' }}>Free Alternative Channels (Bypass Twilio Limits)</h4>
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '12px' }}>
                    Setup a free Discord Webhook or Telegram Bot to receive instant messages on your mobile device for testing.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', gridColumn: 'span 2' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Discord Webhook URL</label>
                      <input type="text" placeholder="https://discord.com/api/webhooks/..." value={settings.discordWebhookUrl || ''} onChange={e => setSettings({ ...settings, discordWebhookUrl: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Telegram Bot Token</label>
                      <input type="text" placeholder="12345678:ABC..." value={settings.telegramBotToken || ''} onChange={e => setSettings({ ...settings, telegramBotToken: e.target.value })} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Telegram Chat ID</label>
                      <input type="text" placeholder="123456789" value={settings.telegramChatId || ''} onChange={e => setSettings({ ...settings, telegramChatId: e.target.value })} />
                    </div>
                  </div>
                </div>

                <button type="submit" className="btn-primary" style={{ marginTop: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <CheckCircle2 size={16} /> Save API Settings Config
                </button>
              </form>
            </div>
          )}

        </div>
      </main>

      {/* FOOTER */}
      <footer className="glass-panel" style={{ borderRadius: 0, borderBottom: 'none', borderLeft: 'none', borderRight: 'none', padding: '16px 24px', textAlign: 'center', color: 'var(--text-dark)', fontSize: '0.8rem' }}>
        <p>© 2026 NimbusGuard Inc. Technical Assessment Portfolio Piece — Sales & Marketing Automation Challenge.</p>
      </footer>

      {/* PILLAR 2: INTERACTIVE VIDEO AVATAR NURTURING PORTAL MODAL */}
      {isPlayingVideo && selectedLead && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', background: 'rgba(5, 7, 12, 0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '24px' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '1000px', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 24px 64px rgba(0,0,0,0.8)' }}>
            
            {/* Modal Title Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="badge badge-hot" style={{ fontSize: '0.65rem' }}>Personalized AI Nurturing</span>
                <span style={{ fontSize: '0.9rem', color: 'white', fontWeight: 600 }}>outreach_video_{selectedLead.id}.mp4</span>
              </div>
              <button className="btn-secondary" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={closeVideoPortal}>Close Portal</button>
            </div>

            {/* Video Layout Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0' }} className="video-portal-grid">
              
              {/* Upper Screen: Loom video representation */}
              <div style={{ background: '#0b0f17', aspectRatio: '16/9', position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--border-color)' }}>
                
                {/* Background: Simulated NimbusGuard scanning dashboard interface */}
                <div style={{ width: '100%', height: '100%', padding: '32px', display: 'flex', flexDirection: 'column', gap: '16px', opacity: 0.35 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px' }}>
                    <span style={{ fontWeight: 800, fontSize: '1rem', color: 'white' }}>NIMBUSGUARD EASM SCANNER v2.8</span>
                    <span style={{ color: 'var(--color-error)', fontSize: '0.8rem', fontWeight: 600 }} className="node-pulse-active">LIVE DEPLOYMENT ANALYZER</span>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                    <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.01)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>DOMAINS SCANNED</span>
                      <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'white', marginTop: '6px' }}>{selectedLead.domain || 'stripe.com'}</p>
                    </div>
                    <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.01)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>SECTOR THREAT LEVEL</span>
                      <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-warning)', marginTop: '6px' }}>CRITICAL FIT</p>
                    </div>
                    <div className="glass-panel" style={{ padding: '16px', background: 'rgba(255,255,255,0.01)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>ICP SCORE CLASSIFIER</span>
                      <p style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--tier-hot)', marginTop: '6px' }}>{selectedLead.score}/100</p>
                    </div>
                  </div>

                  <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', padding: '16px', background: 'rgba(0,0,0,0.4)', fontFamily: 'monospace', fontSize: '0.8rem', flex: 1, overflow: 'hidden' }}>
                    <p style={{ color: 'var(--color-success)' }}>$ nimbusguard-scan --target {selectedLead.domain}</p>
                    <p style={{ color: 'var(--text-muted)', margin: '4px 0' }}>Scanning DNS registry records... Done.</p>
                    <p style={{ color: 'var(--text-muted)', margin: '4px 0' }}>Detecting exposed cloud buckets (AWS S3, Azure Blob)...</p>
                    <p style={{ color: 'var(--color-warning)', margin: '4px 0' }}>[!] Warning: Found exposed subdomains under testing namespace.</p>
                    <p style={{ color: 'var(--color-error)', margin: '4px 0' }}>[!!] Threat Assessment: Target aligns with primary blind spot concern: {selectedLead.primaryPainPoint}.</p>
                  </div>
                </div>

                {/* Bottom Right Overlay: Simulated Talking Head AI Avatar */}
                <div style={{ position: 'absolute', bottom: '24px', right: '24px', width: '180px', height: '180px', borderRadius: '50%', border: '4px solid var(--color-primary)', background: '#111827', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.6)', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                  
                  {/* Visual Talking Waveform */}
                  {isSpeaking ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '40px' }}>
                      <span className="node-pulse-active" style={{ width: '4px', height: '30px', backgroundColor: 'var(--color-primary)', borderRadius: '2px', display: 'inline-block' }}></span>
                      <span className="node-pulse-active" style={{ width: '4px', height: '45px', backgroundColor: 'var(--color-primary)', borderRadius: '2px', display: 'inline-block', animationDelay: '0.2s' }}></span>
                      <span className="node-pulse-active" style={{ width: '4px', height: '20px', backgroundColor: 'var(--color-primary)', borderRadius: '2px', display: 'inline-block', animationDelay: '0.4s' }}></span>
                      <span className="node-pulse-active" style={{ width: '4px', height: '35px', backgroundColor: 'var(--color-primary)', borderRadius: '2px', display: 'inline-block', animationDelay: '0.1s' }}></span>
                      <span className="node-pulse-active" style={{ width: '4px', height: '15px', backgroundColor: 'var(--color-primary)', borderRadius: '2px', display: 'inline-block', animationDelay: '0.5s' }}></span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', height: '40px' }}>
                      <span style={{ width: '4px', height: '4px', backgroundColor: 'var(--text-dark)', borderRadius: '2px' }}></span>
                      <span style={{ width: '4px', height: '4px', backgroundColor: 'var(--text-dark)', borderRadius: '2px' }}></span>
                      <span style={{ width: '4px', height: '4px', backgroundColor: 'var(--text-dark)', borderRadius: '2px' }}></span>
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', marginTop: '10px' }}>
                    <Volume2 size={16} color={isSpeaking ? 'var(--color-primary)' : 'var(--text-dark)'} />
                    <span style={{ fontSize: '0.65rem', color: isSpeaking ? 'white' : 'var(--text-dark)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                      {isSpeaking ? 'SDR Speaking' : 'Muted'}
                    </span>
                  </div>

                  {/* High Tech Ring Glow */}
                  <div className={isSpeaking ? 'node-pulse-active' : ''} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', borderRadius: '50%', border: '2px solid rgba(59,130,246,0.2)', pointerEvents: 'none' }}></div>
                </div>

                {/* Captions Overlay Bar */}
                <div style={{ position: 'absolute', bottom: '24px', left: '24px', right: '220px', background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)', border: '1px solid var(--border-color)', borderRadius: '8px', padding: '16px', minHeight: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <p style={{ textAlign: 'center', fontSize: '0.9rem', color: 'white', lineHeight: '1.4', fontWeight: 500 }}>
                    {spokenCaption || 'Awaiting script trigger... Click play voice below.'}
                  </p>
                </div>
              </div>

              {/* Lower Screen: Control Dashboard */}
              <div style={{ padding: '20px 24px', background: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1 }}>
                  <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px', background: isSpeaking ? 'var(--color-error)' : 'var(--color-success)', boxShadow: 'none' }} onClick={() => isSpeaking ? stopVideoAudio() : startVideoAudio(selectedLead)}>
                    <Play size={16} /> {isSpeaking ? 'Stop Audition' : 'Play Voice Synthesizer'}
                  </button>
                  
                  {/* Progress Line */}
                  <div style={{ flex: 1, height: '4px', backgroundColor: 'var(--bg-tertiary)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ width: `${speakingProgress}%`, height: '100%', backgroundColor: 'var(--color-primary)', transition: 'width 0.1s linear' }}></div>
                  </div>
                </div>

                {selectedLead.voiceFileUrl && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '24px', color: 'var(--color-success)', fontSize: '0.8rem', fontWeight: 600 }}>
                    <Check size={14} /> ElevenLabs Premium Audio Loaded
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
