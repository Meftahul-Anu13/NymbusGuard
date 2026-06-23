const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');

const defaultDb = {
  leads: [],
  settings: {
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
    telegramChatId: ''
  },
  logs: []
};

function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, JSON.stringify(defaultDb, null, 2));
      return defaultDb;
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading database:', err);
    return defaultDb;
  }
}

function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (err) {
    console.error('Error writing database:', err);
    return false;
  }
}

const db = {
  getLeads: () => {
    return readDb().leads;
  },
  
  getLeadById: (id) => {
    return readDb().leads.find(l => l.id === id);
  },

  addLead: (lead) => {
    const data = readDb();
    const newLead = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      status: 'Captured', // Captured, Enriched, Qualified, VideoGenerated, Synced, Outreached, Replied, Disqualified
      engagementStatus: 'Pending', // Sent, Opened, Clicked, Replied, SMS_Sent, WhatsApp_Sent
      timeline: [
        {
          status: 'Captured',
          timestamp: new Date().toISOString(),
          message: 'Lead captured from form submission'
        }
      ],
      ...lead
    };
    data.leads.push(newLead);
    writeDb(data);
    return newLead;
  },

  updateLead: (id, updates) => {
    const data = readDb();
    const index = data.leads.findIndex(l => l.id === id);
    if (index === -1) return null;

    const oldLead = data.leads[index];
    const newLead = {
      ...oldLead,
      ...updates,
      timeline: [
        ...(oldLead.timeline || []),
        ...(updates.status && updates.status !== oldLead.status ? [{
          status: updates.status,
          timestamp: new Date().toISOString(),
          message: `Lead status updated to ${updates.status}`
        }] : [])
      ]
    };
    
    data.leads[index] = newLead;
    writeDb(data);
    return newLead;
  },

  deleteLead: (id) => {
    const data = readDb();
    data.leads = data.leads.filter(l => l.id !== id);
    writeDb(data);
  },

  getSettings: () => {
    const fileSettings = readDb().settings || {};
    return {
      groqApiKey: process.env.GROQ_API_KEY || fileSettings.groqApiKey || '',
      geminiApiKey: process.env.GEMINI_API_KEY || fileSettings.geminiApiKey || '',
      openaiApiKey: process.env.OPENAI_API_KEY || fileSettings.openaiApiKey || '',
      hubspotAccessToken: process.env.HUBSPOT_ACCESS_TOKEN || fileSettings.hubspotAccessToken || '',
      resendApiKey: process.env.RESEND_API_KEY || fileSettings.resendApiKey || '',
      elevenlabsApiKey: process.env.ELEVENLABS_API_KEY || fileSettings.elevenlabsApiKey || '',
      twilioSid: process.env.TWILIO_SID || fileSettings.twilioSid || '',
      twilioToken: process.env.TWILIO_TOKEN || fileSettings.twilioToken || '',
      twilioPhone: process.env.TWILIO_PHONE || fileSettings.twilioPhone || '',
      testRecipientPhone: process.env.TEST_RECIPIENT_PHONE || fileSettings.testRecipientPhone || '',
      discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || fileSettings.discordWebhookUrl || '',
      telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || fileSettings.telegramBotToken || '',
      telegramChatId: process.env.TELEGRAM_CHAT_ID || fileSettings.telegramChatId || ''
    };
  },

  updateSettings: (settings) => {
    const data = readDb();
    data.settings = {
      ...data.settings,
      ...settings
    };
    writeDb(data);
    return data.settings;
  },

  getLogs: () => {
    return readDb().logs;
  },

  addLog: (level, moduleName, message, details = null) => {
    const data = readDb();
    const newLog = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      level, // info, success, warning, error
      module: moduleName, // Enrichment, AI Sales Agent, Video Avatar, CRM, Messaging, Router
      message,
      details
    };
    data.logs.push(newLog);
    // Keep only last 1000 logs
    if (data.logs.length > 1000) {
      data.logs.shift();
    }
    writeDb(data);
    return newLog;
  },

  clearLogs: () => {
    const data = readDb();
    data.logs = [];
    writeDb(data);
  },

  clearLeads: () => {
    const data = readDb();
    data.leads = [];
    writeDb(data);
  }
};

module.exports = db;
