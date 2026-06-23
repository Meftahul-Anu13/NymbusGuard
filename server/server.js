const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client/dist')));
app.use(express.static(path.join(__dirname, 'public')));

// Helper: Check for public email domain
function isPublicDomain(domain) {
  const publicDomains = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'aol.com',
    'icloud.com', 'zoho.com', 'protonmail.com', 'proton.me', 'yandex.com', 'mail.com'
  ];
  return publicDomains.includes(domain.toLowerCase().trim());
}

// Scrape website helper
async function getAIEnrichmentFallback(cleanDomain) {
  const settings = db.getSettings();
  const companyName = cleanDomain.split('.')[0];
  
  if (settings.groqApiKey || settings.openaiApiKey || settings.geminiApiKey) {
    try {
      db.addLog('info', 'Enrichment', `Initiating AI LLM Enrichment fallback for ${cleanDomain}...`);
      
      const systemPrompt = `You are a web scraper simulator. Based on your knowledge of the company domain "${cleanDomain}" (likely named "${companyName}"), return a JSON object representing the homepage metadata that would be found if you scraped it.
Return a JSON object with:
{
  "title": "The exact homepage meta title or a very accurate description (e.g. 'Coinbase - Buy & Sell Bitcoin')",
  "description": "The meta description of the page.",
  "h1": "A main header likely found on their page",
  "bodySnippet": "A 2-3 sentence overview of their business value proposition and technical focus."
}
Respond only with valid JSON.`;

      const response = await callLLM(systemPrompt, { domain: cleanDomain }, settings);
      if (response && response.title) {
        return {
          scraped: true,
          method: 'AI Fallback',
          data: {
            title: response.title,
            description: response.description || 'N/A',
            keywords: '',
            h1: response.h1 || 'N/A',
            bodySnippet: response.bodySnippet || 'N/A'
          }
        };
      }
    } catch (err) {
      db.addLog('warning', 'Enrichment', `AI Enrichment fallback failed: ${err.message}`);
    }
  }
  return null;
}

async function scrapeWebsite(domain) {
  let url = domain.trim();
  if (!url) {
    return { scraped: false, reason: 'Empty URL', data: null };
  }

  // Prepend https:// if no protocol is present
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  // Autocorrect simple company names without extensions (e.g. "Microsoft" -> "https://Microsoft.com")
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes('.')) {
      url = url.replace(parsed.hostname, parsed.hostname + '.com');
    }
  } catch (e) {
    // Fallback if URL parsing fails
    if (!url.includes('.')) {
      url += '.com';
    }
  }

  // Extract clean domain hostname for public domain check
  let cleanDomain = '';
  try {
    const parsed = new URL(url);
    cleanDomain = parsed.hostname.replace(/^(www\.)?/, '').toLowerCase();
  } catch (e) {
    cleanDomain = url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0].trim().toLowerCase();
  }

  if (isPublicDomain(cleanDomain)) {
    return {
      scraped: false,
      reason: 'Public email domain (e.g. Gmail) - scraping skipped.',
      data: null
    };
  }

  // 1. Try Jina Reader first (completely free markdown reader proxy that bypasses Cloudflare/bot blockers)
  try {
    db.addLog('info', 'Enrichment', `Attempting to scrape company website via Jina Reader: ${url}`);
    const response = await axios.get(`https://r.jina.ai/${url}`, {
      timeout: 10000,
      headers: {
        'Accept': 'application/json'
      }
    });

    let title = '';
    let description = '';
    let h1 = '';
    let bodyText = '';

    if (response.data && response.data.data) {
      title = response.data.data.title || '';
      description = response.data.data.description || '';
      const content = response.data.data.content || '';
      const h1Match = content.match(/^#\s*(.*?)$/m);
      h1 = h1Match ? h1Match[1].trim() : '';
      bodyText = content.substring(0, 1500).trim();
    } else {
      // Fallback text parser
      const markdown = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
      const titleMatch = markdown.match(/^Title:\s*(.*?)$/m);
      const descMatch = markdown.match(/^(?:Description|description|Meta Description):\s*(.*?)$/im);
      const h1Match = markdown.match(/^#\s*(.*?)$/m);

      title = titleMatch ? titleMatch[1].trim() : '';
      description = descMatch ? descMatch[1].trim() : '';
      h1 = h1Match ? h1Match[1].trim() : '';
      bodyText = markdown.substring(0, 1500).trim();
    }

    db.addLog('success', 'Enrichment', `Scraped homepage successfully via Jina Reader: ${url}`, {
      title,
      descriptionLength: description.length,
      snippetLength: bodyText.length
    });

    return {
      scraped: true,
      data: {
        title: title || 'N/A',
        description: description || 'N/A',
        keywords: '',
        h1: h1 || 'N/A',
        bodySnippet: bodyText
      }
    };
  } catch (jinaError) {
    db.addLog('warning', 'Enrichment', `Jina Reader scrape failed (${jinaError.message}). Trying direct scrape...`);
  }

  // 2. Try direct scrape fallback (Cheerio + Axios)
  try {
    db.addLog('info', 'Enrichment', `Attempting direct scrape of company website: ${url}`);

    const response = await axios.get(url, {
      timeout: 6000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });

    const $ = cheerio.load(response.data);
    const title = $('title').text().trim();
    
    // Check multiple meta tags for description (case-insensitive and og:description fallback)
    const description = 
      $('meta[name="description"]').attr('content')?.trim() ||
      $('meta[name="Description"]').attr('content')?.trim() ||
      $('meta[property="og:description"]').attr('content')?.trim() ||
      $('meta[name="twitter:description"]').attr('content')?.trim() ||
      '';

    const keywords = 
      $('meta[name="keywords"]').attr('content')?.trim() ||
      $('meta[name="Keywords"]').attr('content')?.trim() ||
      '';

    const h1 = $('h1').first().text().trim() || $('h2').first().text().trim() || '';

    // Extract a text snippet from body, removing script/style tags and extra whitespace
    $('script, style, iframe, noscript').remove();
    const bodyText = $('body').text().replace(/\s+/g, ' ').substring(0, 1500).trim();

    db.addLog('success', 'Enrichment', `Scraped homepage successfully: ${url}`, {
      title,
      descriptionLength: description.length,
      snippetLength: bodyText.length
    });

    return {
      scraped: true,
      data: {
        title: title || 'N/A',
        description: description || 'N/A',
        keywords: keywords || '',
        h1: h1 || 'N/A',
        bodySnippet: bodyText
      }
    };
  } catch (error) {
    db.addLog('warning', 'Enrichment', `HTTPS scrape failed for ${url} (${error.message}). Retrying with HTTP...`);

    try {
      const httpUrl = url.replace(/^https:/i, 'http:');
      const response = await axios.get(httpUrl, {
        timeout: 6000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.162 Safari/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const title = $('title').text().trim();
      
      const description = 
        $('meta[name="description"]').attr('content')?.trim() ||
        $('meta[name="Description"]').attr('content')?.trim() ||
        $('meta[property="og:description"]').attr('content')?.trim() ||
        $('meta[name="twitter:description"]').attr('content')?.trim() ||
        '';

      const h1 = $('h1').first().text().trim() || $('h2').first().text().trim() || '';
      $('script, style').remove();
      const bodyText = $('body').text().replace(/\s+/g, ' ').substring(0, 1500).trim();

      db.addLog('success', 'Enrichment', `Scraped homepage via HTTP: ${httpUrl}`);
      return {
        scraped: true,
        data: {
          title: title || 'N/A',
          description: description || 'N/A',
          keywords: '',
          h1: h1 || 'N/A',
          bodySnippet: bodyText
        }
      };
    } catch (httpError) {
      db.addLog('warning', 'Enrichment', `HTTP scrape failed entirely for ${url}: ${httpError.message}`);
      
      // 3. Try AI LLM Enrichment as final fallback
      const aiResult = await getAIEnrichmentFallback(cleanDomain);
      if (aiResult) {
        db.addLog('success', 'Enrichment', `Enriched site metadata using AI LLM Fallback for ${cleanDomain}`);
        return aiResult;
      }

      return {
        scraped: false,
        reason: `Scrape failed: ${httpError.message}`,
        data: null
      };
    }
  }
}

// Local heuristic rule-based fallback for LLM
function mockLLMHandler(systemPrompt, userPromptJsonStr) {
  let payload;
  try {
    payload = JSON.parse(userPromptJsonStr);
  } catch (e) {
    payload = { lead: {}, enrichment: {} };
  }

  const lead = payload.lead || {};
  const enrichment = payload.enrichment || {};

  // 1. Check for Missing critical fields or Vague answers
  const isVague = (str) => {
    if (!str) return true;
    const v = str.toLowerCase().trim();
    return v === 'none' || v === 'nothing' || v === 'asdf' || v === 'test' || v === 'idk' || v === 'not sure' || v.length < 5;
  };

  // Determine if needs clarification
  if (isVague(lead.blindSpot) || !lead.jobTitle || !lead.fullName || !lead.companyName) {
    let question = 'To help us tailor our security audit for your infrastructure, could you tell us what public-facing assets (like subdomains, SaaS portals, or cloud storage buckets) you are currently most concerned about protecting?';
    if (!lead.jobTitle) {
      question = `Could you share your current job title or role at ${lead.companyName || 'your company'} so we can map out the correct technical reporting dashboard for you?`;
    }
    return {
      status: "needs_clarification",
      qualification: "Cold",
      score: 15,
      primary_pain_point: "Unknown - Requires Clarification",
      reasoning: "Lead submission is incomplete or the stated pain point is too vague to evaluate.",
      clarifying_question: question
    };
  }

  // 2. Perform Heuristic Qualification Scoring (0-100)
  let score = 50; // start at 50 (neutral)
  let reasons = [];
  let isDisqualified = false;

  // Company Size Guess (from enrichment or form)
  let headcount = 100; // default middle
  if (enrichment && enrichment.title) {
    const text = (enrichment.title + ' ' + (enrichment.description || '')).toLowerCase();
    if (text.includes('enterprise') || text.includes('corporate')) headcount = 1500;
    else if (text.includes('startup') || text.includes('agency')) headcount = 35;
  }

  // Job Title scoring
  const title = lead.jobTitle.toLowerCase();
  const strongTitles = ['ciso', 'security', 'it director', 'director of it', 'vp engineering', 'devops', 'vp tech', 'cto', 'infrastructure', 'compliance', 'network admin'];
  const weakTitles = ['marketing', 'sales', 'hr', 'student', 'recruiter', 'intern', 'accountant', 'writer', 'editor'];

  let matchesStrongTitle = strongTitles.some(t => title.includes(t));
  let matchesWeakTitle = weakTitles.some(t => title.includes(t));

  if (matchesStrongTitle) {
    score += 20;
    reasons.push('Title aligns with IT/Security decision-maker');
  } else if (matchesWeakTitle) {
    score -= 25;
    isDisqualified = true;
    reasons.push('Role is in an unrelated business function');
  } else {
    reasons.push('Role is neutral / technical manager');
  }

  // Domain & Email checks
  const emailDomain = lead.email.split('@')[1] || '';
  const domain = lead.domain || emailDomain;
  if (isPublicDomain(domain)) {
    score -= 20;
    isDisqualified = true;
    reasons.push('Personal email domain used');
  }
  if (domain.includes('competitor') || domain.includes('nimbusguard')) {
    score -= 30;
    isDisqualified = true;
    reasons.push('Internal or competitor domain');
  }

  // Pain point analysis
  const pain = lead.blindSpot.toLowerCase();
  const strongPains = ['shadow it', 'exposed', 'leaking', 'bucket', 'compliance', 'audit', 'breach', 'hack', 'credential', 'api', 'subdomain', 'port', 'dns', 'vulnerability', 'phishing'];
  let matchesStrongPain = strongPains.some(p => pain.includes(p));

  if (matchesStrongPain) {
    score += 15;
    reasons.push('Pain point references specific attack surface vulnerabilities');
  } else {
    reasons.push('Pain point is generic but security-related');
  }

  // Industry estimation from enrichment / domain
  let industry = 'Technology';
  if (enrichment && enrichment.title) {
    const text = (enrichment.title + ' ' + (enrichment.description || '')).toLowerCase();
    if (text.includes('hospital') || text.includes('medical') || text.includes('care')) industry = 'Healthcare';
    else if (text.includes('bank') || text.includes('fintech') || text.includes('finance') || text.includes('pay')) industry = 'FinTech';
    else if (text.includes('shop') || text.includes('store') || text.includes('e-commerce') || text.includes('wear')) industry = 'E-commerce';
    else if (text.includes('hotel') || text.includes('restaurant') || text.includes('travel')) {
      industry = 'Hospitality';
      score -= 15;
      reasons.push('Industry (Hospitality) is outside core ICP');
    }
  }

  // Cap score
  score = Math.max(0, Math.min(100, score));

  // Decide Qualification Tier
  let qualification = 'Warm';
  if (score >= 70 && !isDisqualified) {
    qualification = 'Hot';
  } else if (score < 40 || isDisqualified) {
    qualification = 'Cold';
  }

  // Primary Pain Point Extraction
  let primaryPainPoint = 'Continuous External Attack Surface Management';
  if (pain.includes('shadow') || pain.includes('forgotten')) {
    primaryPainPoint = 'Shadow IT and forgotten subdomains';
  } else if (pain.includes('api') || pain.includes('endpoint')) {
    primaryPainPoint = 'Exposed developer APIs and credentials';
  } else if (pain.includes('bucket') || pain.includes('cloud') || pain.includes('s3')) {
    primaryPainPoint = 'Unsecured cloud storage buckets';
  } else if (pain.includes('compliance') || pain.includes('audit')) {
    primaryPainPoint = 'Meeting compliance audits (SOC2/ISO)';
  } else if (pain.includes('breach') || pain.includes('leak') || pain.includes('hack')) {
    primaryPainPoint = 'Preventing data breaches and credential leakage';
  }

  return {
    status: "complete",
    qualification,
    score,
    primary_pain_point: primaryPainPoint,
    reasoning: `Score: ${score}. ${reasons.join(', ')}.`,
    clarifying_question: null
  };
}

// Main AI API Call function
async function callLLM(systemPrompt, userPromptJson, settings) {
  const userPromptStr = JSON.stringify(userPromptJson);

  // Groq (Primary — Free, fast inference)
  if (settings.groqApiKey) {
    try {
      db.addLog('info', 'AI Sales Agent', 'Calling Groq API (llama-3.3-70b-versatile)...');
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: 'llama-3.3-70b-versatile',
        response_format: { type: 'json_object' },
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemPrompt + '\n\nYou MUST respond strictly in valid JSON format. No markdown, no code fences, just the raw JSON object.' },
          { role: 'user', content: userPromptStr }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${settings.groqApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      });

      let text = response.data.choices[0].message.content;
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(text);
      db.addLog('success', 'AI Sales Agent', `Groq (Llama 3.3 70B) qualification completed. Score: ${result.score}, Tier: ${result.qualification}`);
      return result;
    } catch (err) {
      const errMsg = err.response?.data?.error?.message || err.message;
      db.addLog('error', 'AI Sales Agent', `Groq call failed (${errMsg}). Falling back to next provider.`);
    }
  }

  if (settings.openaiApiKey) {
    try {
      db.addLog('info', 'AI Sales Agent', 'Calling OpenAI API (gpt-4o-mini)...');
      const response = await axios.post('https://api.openai.com/v1/chat/completions', {
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPromptStr }
        ]
      }, {
        headers: {
          'Authorization': `Bearer ${settings.openaiApiKey}`,
          'Content-Type': 'application/json'
        }
      });

      const result = JSON.parse(response.data.choices[0].message.content);
      db.addLog('success', 'AI Sales Agent', `OpenAI qualification completed. Score: ${result.score}, Tier: ${result.qualification}`);
      return result;
    } catch (err) {
      db.addLog('error', 'AI Sales Agent', `OpenAI call failed (${err.message}). Falling back to local heuristics.`);
    }
  }

  if (settings.geminiApiKey) {
    try {
      db.addLog('info', 'AI Sales Agent', 'Calling Google Gemini API (gemini-1.5-flash)...');
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${settings.geminiApiKey}`,
        {
          contents: [{
            parts: [{
              text: `${systemPrompt}\n\nUser Input Data (JSON format):\n${userPromptStr}\n\nYou must return a JSON response matching the requested schema. Do not enclose the output in code fences (e.g. \`\`\`json). Just return the raw JSON object string.`
            }]
          }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      let text = response.data.candidates[0].content.parts[0].text;
      // Strip markdown code block wrappers if any are returned
      text = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const result = JSON.parse(text);
      db.addLog('success', 'AI Sales Agent', `Gemini qualification completed. Score: ${result.score}, Tier: ${result.qualification}`);
      return result;
    } catch (err) {
      db.addLog('error', 'AI Sales Agent', `Gemini call failed (${err.message}). Falling back to local heuristics.`);
    }
  }

  // Fallback
  db.addLog('info', 'AI Sales Agent', 'Running local rule-based heuristic classifier (No API keys active)...');
  // simulate a small delay to make the UI animation feel real
  await new Promise(resolve => setTimeout(resolve, 1500));
  const result = mockLLMHandler(systemPrompt, userPromptStr);
  db.addLog('success', 'AI Sales Agent', `Local qualification completed. Score: ${result.score}, Tier: ${result.qualification}`);
  return result;
}

// Script generator helper
async function generateScript(lead, qualificationData, settings) {
  const systemPrompt = `You are an expert sales scriptwriter for NimbusGuard, an external attack surface management platform.
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
}`;

  const userPrompt = {
    prospectName: lead.fullName,
    companyName: lead.companyName,
    jobTitle: lead.jobTitle,
    domain: lead.domain,
    qualificationScore: qualificationData.score,
    primaryPainPoint: qualificationData.primary_pain_point
  };

  if (settings.groqApiKey || settings.openaiApiKey || settings.geminiApiKey) {
    try {
      db.addLog('info', 'Video Avatar', 'Generating customized video script via AI...');
      const response = await callLLM(systemPrompt, userPrompt, settings);
      if (response && response.script) {
        return response;
      }
    } catch (err) {
      db.addLog('error', 'Video Avatar', `AI script generation failed: ${err.message}. Using template fallback.`);
    }
  }

  // Template-based script fallback
  db.addLog('info', 'Video Avatar', 'Generating script via personalized template (Local Fallback)...');
  const name = lead.fullName.split(' ')[0];
  const script = `Hi ${name}, I wanted to reach out personally after seeing your interest in our Exposure Checker. As the ${lead.jobTitle} at ${lead.companyName}, I understand that monitoring ${qualificationData.primary_pain_point || 'your public assets'} is a top priority. With NimbusGuard, we continuously scan subdomains, cloud buckets, and APIs to show you exactly what an attacker sees first. I've prepared a brief report showing three exposed points on ${lead.domain || 'your domain'}. Let me know if you have ten minutes this Thursday for a quick walkthrough.`;

  return {
    script,
    estimated_duration: '35s'
  };
}

// ElevenLabs TTS Helper
async function generateElevenLabsAudio(script, settings, leadId) {
  if (!settings.elevenlabsApiKey) {
    return null;
  }

  try {
    db.addLog('info', 'Video Avatar', 'Calling ElevenLabs API to synthesize custom voiceover...');
    const response = await axios.post(
      'https://api.elevenlabs.io/v1/text-to-speech/Xb7hH8MSUJpSbSDYk0k2', // Alice voice (premade, works on free tier)
      {
        text: script,
        model_id: 'eleven_multilingual_v2', // works on free tier, monolingual v1 is deprecated
        voice_settings: {
          stability: 0.75,
          similarity_boost: 0.75
        }
      },
      {
        headers: {
          'xi-api-key': settings.elevenlabsApiKey,
          'Content-Type': 'application/json'
        },
        responseType: 'arraybuffer'
      }
    );

    // Save audio file to server public folder
    const audioDir = path.join(__dirname, 'public', 'audio');
    if (!fs.existsSync(audioDir)) {
      fs.mkdirSync(audioDir, { recursive: true });
    }

    const audioFilename = `lead_${leadId}.mp3`;
    const audioPath = path.join(audioDir, audioFilename);
    fs.writeFileSync(audioPath, response.data);

    db.addLog('success', 'Video Avatar', `ElevenLabs voice synthesized: /audio/${audioFilename}`);
    return `/audio/${audioFilename}`;
  } catch (err) {
    db.addLog('error', 'Video Avatar', `ElevenLabs voice synthesis failed: ${err.message}`);
    return null;
  }
}

// HubSpot CRM Sync Helper
async function syncToHubSpot(lead, qualificationData, videoUrl, settings) {
  if (!settings.hubspotAccessToken) {
    db.addLog('info', 'CRM', 'HubSpot API Token missing. CRM sync will write to local simulated ledger.');
    return { synced: false, reason: 'No API Key' };
  }

  try {
    db.addLog('info', 'CRM', 'Attempting to sync lead data to HubSpot CRM...');
    const nameParts = lead.fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || 'Lead';

    const hsStatusMap = {
      'Hot': 'IN_PROGRESS',
      'Warm': 'OPEN',
      'Cold': 'DISQUALIFIED'
    };

    // We write custom enrichment data to the description notes field so that it
    // integrates perfectly with any free/sandbox HubSpot account out of the box
    // without requiring custom properties schema setup.
    const description = `
=== NIMBUSGUARD LEAD AUTOMATION ===
Qualification: ${qualificationData.qualification}
ICP Score: ${qualificationData.score}/100
Primary Pain Point: ${qualificationData.primary_pain_point}
AI Reasoning: ${qualificationData.reasoning}
Personalized Video: ${videoUrl}
Engagement Status: ${lead.engagementStatus || 'Pending'}
===================================
`.trim();

    const payload = {
      properties: {
        firstname: firstName,
        lastname: lastName,
        email: lead.email,
        company: lead.companyName,
        jobtitle: lead.jobTitle,
        website: lead.domain,
        hs_lead_status: hsStatusMap[qualificationData.qualification] || 'NEW',
        description: description
      }
    };

    let url = 'https://api.hubspot.com/crm/v3/objects/contacts';
    const headers = {
      'Content-Type': 'application/json'
    };

    if (settings.hubspotAccessToken.startsWith('pat-')) {
      headers['Authorization'] = `Bearer ${settings.hubspotAccessToken}`;
    } else {
      url += `?hapikey=${settings.hubspotAccessToken}`;
    }

    let response;
    try {
      response = await axios.post(
        url,
        payload,
        { headers }
      );
    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message;
      if (errorMsg.includes('description') && payload.properties.description) {
        db.addLog('warning', 'CRM', 'HubSpot "description" contact property is not enabled/supported in this CRM portal. Retrying sync without it...');

        // Strip the unsupported description property and retry
        delete payload.properties.description;
        response = await axios.post(
          url,
          payload,
          { headers }
        );
      } else {
        throw err;
      }
    }

    db.addLog('success', 'CRM', `HubSpot contact synced successfully! Contact ID: ${response.data.id}`);
    return { synced: true, hubspotId: response.data.id };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    db.addLog('error', 'CRM', `HubSpot contact sync failed: ${errorMsg}`);
    return { synced: false, error: errorMsg };
  }
}

// Resend Email Helper
async function sendResendEmail(lead, qualificationData, videoUrl, settings) {
  if (!settings.resendApiKey) {
    db.addLog('info', 'Messaging', 'Resend API key missing. Email outreach logged & previewed locally.');
    return { sent: false, reason: 'No API Key' };
  }

  try {
    db.addLog('info', 'Messaging', `Sending outreach email to ${lead.email} via Resend...`);

    const name = lead.fullName.split(' ')[0];
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #1e3a8a;">Hi ${name},</h2>
        <p>I reviewed your exposure score request for <strong>${lead.companyName}</strong>. Given your concern about <strong>${qualificationData.primary_pain_point}</strong>, I created a short, personalized video for you.</p>
        
        <div style="margin: 25px 0; text-align: center;">
          <a href="${videoUrl}" style="display: inline-block; background-color: #3b82f6; color: white; padding: 12px 24px; font-weight: bold; text-decoration: none; border-radius: 6px;">
            Watch Your Personalized Video
          </a>
        </div>
        
        <p>In the video, I walk through the primary external vulnerabilities visible on <strong>${lead.domain}</strong> and how NimbusGuard handles them.</p>
        <p>Best regards,<br/>The NimbusGuard Team</p>
      </div>
    `;

    // On Resend free tier, test emails can only be sent to the account owner's verified email.
    // In production, verify a domain at resend.com/domains and send to lead.email directly.
    const resendTestEmail = settings.resendTestEmail || 'meftahul.jannati.anonna@gmail.com';
    const actualRecipient = resendTestEmail;

    db.addLog('info', 'Messaging', `Resend free tier: routing to verified address (${actualRecipient}). Production would send to ${lead.email}.`);

    const response = await axios.post(
      'https://api.resend.com/emails',
      {
        from: 'NimbusGuard Team <onboarding@resend.dev>',
        to: actualRecipient,
        subject: `[LIVE DEMO] Personalized Risk Video for ${lead.companyName} — Lead: ${lead.fullName}`,
        html: htmlContent
      },
      {
        headers: {
          'Authorization': `Bearer ${settings.resendApiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    db.addLog('success', 'Messaging', `Outreach email delivered via Resend. Email ID: ${response.data.id}`);
    return { sent: true, emailId: response.data.id };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    db.addLog('error', 'Messaging', `Resend email delivery failed: ${errorMsg}`);
    return { sent: false, error: errorMsg };
  }
}

// Fallback Notification Channels
async function sendFallbackChannels(lead, messageBody, settings) {
  let sentAny = false;
  if (settings.discordWebhookUrl) {
    try {
      await axios.post(settings.discordWebhookUrl, {
        content: `**[Outreach Notification]**\n${messageBody}`
      });
      db.addLog('success', 'Messaging', 'Outreach notification sent via Discord Webhook successfully.');
      sentAny = true;
    } catch (err) {
      db.addLog('error', 'Messaging', `Discord Webhook delivery failed: ${err.message}`);
    }
  }

  if (settings.telegramBotToken && settings.telegramChatId) {
    try {
      const formattedText = `<b>[Outreach Notification]</b>\n${messageBody}`;
      await axios.post(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
        chat_id: settings.telegramChatId,
        text: formattedText,
        parse_mode: 'HTML'
      });
      db.addLog('success', 'Messaging', 'Outreach notification sent via Telegram Bot successfully.');
      sentAny = true;
    } catch (err) {
      db.addLog('error', 'Messaging', `Telegram Bot delivery failed: ${err.message}`);
    }
  }
  return sentAny;
}

// Twilio SMS Helper
async function sendTwilioSMS(lead, videoUrl, settings) {
  let fromPhone = settings.twilioPhone;
  let isWhatsApp = false;

  // Auto-detect Twilio phone number if not explicitly set
  if (!fromPhone && settings.twilioSid && settings.twilioToken) {
    try {
      db.addLog('info', 'Messaging', 'Twilio phone number not configured. Fetching active numbers from Twilio account...');
      const auth = Buffer.from(`${settings.twilioSid}:${settings.twilioToken}`).toString('base64');
      const numbersRes = await axios.get(
        `https://api.twilio.com/2010-04-01/Accounts/${settings.twilioSid}/IncomingPhoneNumbers.json`,
        {
          headers: { 'Authorization': `Basic ${auth}` }
        }
      );
      if (numbersRes.data.incoming_phone_numbers && numbersRes.data.incoming_phone_numbers.length > 0) {
        fromPhone = numbersRes.data.incoming_phone_numbers[0].phone_number;
        db.addLog('info', 'Messaging', `Auto-detected active Twilio phone number: ${fromPhone}`);
      } else {
        db.addLog('warning', 'Messaging', 'No active incoming phone numbers found on this Twilio account.');
      }
    } catch (lookupErr) {
      db.addLog('warning', 'Messaging', `Could not auto-detect Twilio phone number: ${lookupErr.message}`);
    }
  }

  const messageBody = `Hi ${lead.fullName.split(' ')[0]}, we sent a personalized security analysis video for ${lead.companyName} to your email. You can also watch it here: ${videoUrl}`;

  if (!settings.twilioSid || !settings.twilioToken || !fromPhone) {
    const fallbackSent = await sendFallbackChannels(lead, messageBody, settings);
    if (fallbackSent) {
      db.addLog('info', 'Messaging', 'Twilio configuration missing, but fallback channel notification delivered successfully.');
      return { sent: true, method: 'fallback' };
    }
    db.addLog('info', 'Messaging', 'Twilio credentials or active phone number missing. Multi-channel follow-up logged locally.');
    return { sent: false, reason: 'Missing Twilio Config' };
  }

  try {
    let toPhone = settings.testRecipientPhone || lead.phone || '+15555555555';
    isWhatsApp = false;

    // Detect if we are using WhatsApp (either explicit prefix or using the Twilio Sandbox number)
    if (fromPhone.startsWith('whatsapp:') || fromPhone.includes('4155238886')) {
      isWhatsApp = true;
      if (!fromPhone.startsWith('whatsapp:')) {
        fromPhone = `whatsapp:${fromPhone.trim()}`;
      }
      if (!toPhone.startsWith('whatsapp:')) {
        toPhone = `whatsapp:${toPhone.trim()}`;
      }
    }

    db.addLog('info', 'Messaging', `Sending follow-up ${isWhatsApp ? 'WhatsApp' : 'SMS'} touchpoint to ${lead.fullName} (To: ${toPhone})...`);
    // Basic auth header for Twilio
    const auth = Buffer.from(`${settings.twilioSid}:${settings.twilioToken}`).toString('base64');

    const params = new URLSearchParams();
    params.append('To', toPhone);
    params.append('From', fromPhone);
    params.append('Body', messageBody);

    const response = await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${settings.twilioSid}/Messages.json`,
      params,
      {
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    db.addLog('success', 'Messaging', `Twilio ${isWhatsApp ? 'WhatsApp' : 'SMS'} follow-up sent: SID ${response.data.sid}`);
    
    // Also mirror to fallback channels if configured
    await sendFallbackChannels(lead, messageBody, settings);
    
    return { sent: true, smsSid: response.data.sid };
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message;
    db.addLog('error', 'Messaging', `Twilio ${isWhatsApp ? 'WhatsApp' : 'SMS'} delivery failed: ${errorMsg}`);
    
    // Attempt fallback sending on Twilio error
    const fallbackSent = await sendFallbackChannels(lead, messageBody, settings);
    if (fallbackSent) {
      db.addLog('info', 'Messaging', 'Twilio outreach failed, but fallback channel notification delivered successfully.');
      return { sent: true, method: 'fallback' };
    }
    
    return { sent: false, error: errorMsg };
  }
}

// Core Async Processing Workflow Orchestrator
async function processLeadPipeline(leadId, requestOrigin) {
  const settings = db.getSettings();
  const lead = db.getLeadById(leadId);
  if (!lead) return;

  try {
    // ---- PILLAR 1: ENRICHMENT & QUALIFICATION ----

    // Step 1: Web scraping / enrichment
    db.updateLead(leadId, { status: 'Enriched' });
    const scrapeResult = await scrapeWebsite(lead.domain);

    const enrichmentData = scrapeResult.scraped ? {
      title: scrapeResult.data.title,
      description: scrapeResult.data.description,
      h1: scrapeResult.data.h1,
      industry: 'Technology (Assumed)', // will refine in qualification
      headcount: '50-100 (Assumed)'
    } : null;

    db.updateLead(leadId, {
      enrichment: enrichmentData || { reason: scrapeResult.reason || 'Failed to scrape' }
    });

    // Step 2: AI Agent Qualification
    db.updateLead(leadId, { status: 'Qualified' });

    const systemPrompt = `You are an expert Sales Development Representative (SDR) and Growth Operations Specialist at NimbusGuard.
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

You MUST respond strictly in valid JSON format.`;

    const userPayload = {
      lead: {
        fullName: lead.fullName,
        email: lead.email,
        companyName: lead.companyName,
        domain: lead.domain,
        jobTitle: lead.jobTitle,
        blindSpot: lead.blindSpot
      },
      enrichment: scrapeResult.data || {}
    };

    const qualificationResult = await callLLM(systemPrompt, userPayload, settings);

    // Update lead with qualification outputs
    db.updateLead(leadId, {
      qualification: qualificationResult.qualification,
      score: qualificationResult.score,
      primaryPainPoint: qualificationResult.primary_pain_point,
      reasoning: qualificationResult.reasoning,
      status: qualificationResult.status === 'needs_clarification' ? 'Needs Clarification' : 'Qualified',
      clarifyingQuestion: qualificationResult.clarifying_question
    });

    // If Needs Clarification, stop and wait for answer. If Cold, disqualify and stop.
    if (qualificationResult.status === 'needs_clarification') {
      db.updateLead(leadId, { status: 'Needs Clarification', engagementStatus: 'Needs Clarification Sent' });
      db.addLog('info', 'Router', `Lead ${lead.fullName} (${lead.companyName}) needs clarification. Clarifying question generated.`);
      db.addLog('success', 'Messaging', `Sent clarifying questions to ${lead.fullName}`);
      return;
    }

    if (qualificationResult.qualification === 'Cold') {
      db.updateLead(leadId, { status: 'Disqualified' });
      db.addLog('warning', 'Router', `Lead ${lead.fullName} (${lead.companyName}) disqualified as COLD. Stopping workflow.`);
      return;
    }

    // ---- PILLAR 2: PERSONALIZED VIDEO GENERATION ----
    db.updateLead(leadId, { status: 'VideoGenerated' });
    const scriptResult = await generateScript(lead, qualificationResult, settings);

    // Generate a visual URL path (Vite client will pick this up for simulated video playback)
    const baseUrl = settings.clientBaseUrl || requestOrigin || 'http://localhost:5173';
    const videoUrl = `${baseUrl}/video/${leadId}`;

    // Optional ElevenLabs TTS integration
    const voiceFileUrl = await generateElevenLabsAudio(scriptResult.script, settings, leadId);

    db.updateLead(leadId, {
      videoScript: scriptResult.script,
      videoUrl: videoUrl,
      voiceFileUrl: voiceFileUrl || null
    });

    // ---- PILLAR 3: CRM SYNC & EMAIL OUTREACH ----

    // Step 1: HubSpot sync
    db.updateLead(leadId, { status: 'Synced' });
    const crmResult = await syncToHubSpot(lead, qualificationResult, videoUrl, settings);
    db.updateLead(leadId, {
      hubspotSynced: crmResult.synced,
      hubspotContactId: crmResult.hubspotId || null
    });

    // Step 2: Day 0 Email
    db.updateLead(leadId, { status: 'Outreached', engagementStatus: 'Sent' });
    const emailResult = await sendResendEmail(lead, qualificationResult, videoUrl, settings);
    db.updateLead(leadId, {
      emailSent: emailResult.sent,
      emailMessageId: emailResult.emailId || null
    });

    // Step 3: Twilio SMS outreach
    if (settings.twilioSid && settings.twilioToken) {
      db.addLog('info', 'Messaging', 'Initiating Twilio SMS follow-up touchpoint...');
      const smsResult = await sendTwilioSMS(lead, videoUrl, settings);
      db.updateLead(leadId, {
        twilioSent: smsResult.sent,
        twilioSid: smsResult.smsSid || null
      });
    }

    db.addLog('success', 'Router', `Lead pipeline successfully completed for ${lead.fullName}!`);

  } catch (error) {
    db.addLog('error', 'Router', `Pipeline execution error for lead ID ${leadId}: ${error.message}`);
    db.updateLead(leadId, { status: 'Error', errorDetails: error.message });
  }
}

// REST API Endpoints

// 1. Settings Configuration
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/settings', (req, res) => {
  const updated = db.updateSettings(req.body);
  db.addLog('info', 'Settings', 'API configuration settings updated successfully.');
  res.json(updated);
});

// 2. Fetch Leads
app.get('/api/leads', (req, res) => {
  res.json(db.getLeads());
});

// 3. Form Submission Handler
app.post('/api/leads/submit', async (req, res) => {
  const { fullName, email, companyName, domain, jobTitle, blindSpot } = req.body;

  if (!fullName || !email || !companyName) {
    return res.status(400).json({ error: 'Full Name, Email, and Company Name are required.' });
  }

  db.addLog('info', 'Router', `New lead intake captured: ${fullName} (${companyName})`);

  // Create lead in local DB
  const newLead = db.addLead({
    fullName,
    email,
    companyName,
    domain: domain || email.split('@')[1] || '',
    jobTitle: jobTitle || '',
    blindSpot: blindSpot || ''
  });

  const protocol = req.protocol;
  const host = req.get('host');
  const requestOrigin = `${protocol}://${host}`;

  // Run lead processing pipeline in background
  processLeadPipeline(newLead.id, requestOrigin).catch(err => {
    console.error('Async lead pipeline failed:', err);
  });

  res.status(201).json(newLead);
});

// 4. Submit Clarifying Answer
app.post('/api/leads/:id/submit-clarification', async (req, res) => {
  const { answer } = req.body;
  const leadId = req.params.id;
  const lead = db.getLeadById(leadId);

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  db.addLog('info', 'Router', `Clarification answer received from ${lead.fullName}: "${answer}"`);

  // Update blindSpot with the clarified answer
  db.updateLead(leadId, {
    blindSpot: `${lead.blindSpot} [Clarification: ${answer}]`,
    status: 'Captured',
    engagementStatus: 'Pending',
    clarifyingQuestion: null
  });

  const protocol = req.protocol;
  const host = req.get('host');
  const requestOrigin = `${protocol}://${host}`;

  // Re-run pipeline
  processLeadPipeline(leadId, requestOrigin).catch(err => {
    console.error('Async lead pipeline retry failed:', err);
  });

  res.json({ message: 'Clarification submitted. Processing lead pipeline again...' });
});

// 5. Retry Processing Lead
app.post('/api/leads/:id/retry', async (req, res) => {
  const leadId = req.params.id;
  const lead = db.getLeadById(leadId);

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  db.addLog('info', 'Router', `Manual pipeline retry requested for ${lead.fullName}`);
  db.updateLead(leadId, { status: 'Captured', errorDetails: null });

  const protocol = req.protocol;
  const host = req.get('host');
  const requestOrigin = `${protocol}://${host}`;

  processLeadPipeline(leadId, requestOrigin).catch(err => {
    console.error('Async lead pipeline retry failed:', err);
  });

  res.json({ message: 'Pipeline process restarted.' });
});

// 6. Simulate Interaction (Email Open / Click / SMS trigger)
app.post('/api/leads/:id/simulate', async (req, res) => {
  const leadId = req.params.id;
  const { action } = req.body; // open, click, reply, triggerSMS
  const lead = db.getLeadById(leadId);
  const settings = db.getSettings();

  if (!lead) {
    return res.status(404).json({ error: 'Lead not found.' });
  }

  db.addLog('info', 'Router', `Simulated interaction: ${action} for lead ${lead.fullName}`);

  if (action === 'open') {
    db.updateLead(leadId, { engagementStatus: 'Opened' });
    db.addLog('success', 'Messaging', `Email opened by lead: ${lead.fullName}`);
    // Sync back to CRM
    await syncToHubSpot(lead, {
      qualification: lead.qualification,
      score: lead.score,
      primary_pain_point: lead.primaryPainPoint,
      reasoning: lead.reasoning
    }, lead.videoUrl, settings);
  }
  else if (action === 'click') {
    db.updateLead(leadId, { engagementStatus: 'Clicked' });
    db.addLog('success', 'Messaging', `Video link clicked by lead: ${lead.fullName}`);
    await syncToHubSpot(lead, {
      qualification: lead.qualification,
      score: lead.score,
      primary_pain_point: lead.primaryPainPoint,
      reasoning: lead.reasoning
    }, lead.videoUrl, settings);
  }
  else if (action === 'reply') {
    db.updateLead(leadId, { engagementStatus: 'Replied', status: 'Replied' });
    db.addLog('success', 'Messaging', `Lead replied to email: "${lead.fullName} requested calendar invite."`);
    await syncToHubSpot(lead, {
      qualification: lead.qualification,
      score: lead.score,
      primary_pain_point: lead.primaryPainPoint,
      reasoning: lead.reasoning
    }, lead.videoUrl, settings);
  }
  else if (action === 'triggerSMS') {
    db.updateLead(leadId, { engagementStatus: 'SMS_Sent' });
    await sendTwilioSMS(lead, lead.videoUrl, settings);
  }

  res.json(db.getLeadById(leadId));
});

// 7. Get System Logs
app.get('/api/logs', (req, res) => {
  res.json(db.getLogs());
});

app.post('/api/logs/clear', (req, res) => {
  db.clearLogs();
  res.json({ message: 'Logs cleared.' });
});

app.delete('/api/leads/:id', (req, res) => {
  const leadId = req.params.id;
  const lead = db.getLeadById(leadId);
  if (!lead) {
    return res.status(404).json({ error: 'Lead not found.' });
  }
  db.deleteLead(leadId);
  db.addLog('info', 'Router', `Lead deleted: ${lead.fullName}`);
  res.json({ message: 'Lead deleted successfully.' });
});

app.post('/api/leads/clear', (req, res) => {
  db.clearLeads();
  res.json({ message: 'Leads cleared.' });
});

// Catch-all route to serve Vite production index.html for frontend SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// Listen to port
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  db.addLog('info', 'Router', `NimbusGuard Automation Server booted successfully on port ${PORT}`);
});
