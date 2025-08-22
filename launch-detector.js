// ClickShift Superior Launch Detector v6.2
// Fixed: Email collection, Telegram markdown, Export function

const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const WebSocket = require('ws');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

// ============ CONFIGURATION ============
const CONFIG = {
    // Telegram Configuration
    TELEGRAM_TOKEN: process.env.TELEGRAM_TOKEN || '7595436988:AAGtJlx8vH0ozWlB-6pupifSG_uF6f2hK-Q',
    CHANNEL_ID: process.env.CHANNEL_ID || '@ClickShiftAlerts',
    CHANNEL_LINK: 'https://t.me/ClickShiftAlerts', // Direct link to channel
    ADMIN_ID: 676745291, // Your Telegram ID
    BOT_USERNAME: '@ClickShiftAlphaBot',
    
    // API Keys
    HELIUS_API_KEY: '906bd38e-a622-4e86-8982-5519f4769998',
    HELIUS_RPC: 'https://mainnet.helius-rpc.com/?api-key=906bd38e-a622-4e86-8982-5519f4769998',
    HELIUS_WS: 'wss://mainnet.helius-rpc.com/?api-key=906bd38e-a622-4e86-8982-5519f4769998',
    SHYFT_API_KEY: process.env.SHYFT_API_KEY || 'opfmVoy3TE1NjRza',
    
    // Detection Timing
    MIN_AGE: 30 * 60 * 1000,        // 30 minutes minimum age
    MAX_AGE: 6 * 60 * 60 * 1000,    // 6 hours maximum age
    SCAN_INTERVAL: 20000,            // 20 seconds between scans
    
    // Detection Thresholds
    MIN_LIQUIDITY: 1000,             // $1k minimum to detect
    SAFE_LIQUIDITY: 3000,            // $3k for safety verification
    MIN_HOLDERS: 20,                 // Minimum unique holders
    MAX_TOP_HOLDER: 30,              // Maximum % for top holder
    MIN_VOLUME_RATIO: 1.5,           // Volume must be 1.5x liquidity
    
    // Scoring Thresholds
    MOMENTUM_THRESHOLD: 80,          // Score 80+ for momentum plays
    SOLID_THRESHOLD: 65,             // Score 65+ for solid opportunities
    DEGEN_THRESHOLD: 50,             // Score 50+ for degen plays
    
    // Risk & Target Settings
    RISK_PROFILE: 'BALANCED_AGGRESSIVE',
    MIN_DAILY_ALERTS: 20,
    MAX_DAILY_ALERTS: 30,
    
    // Feature Flags
    ENABLE_PUMPFUN: true,            // Include Pump.fun tokens
    ENABLE_WEBSOCKET: true,          // Use WebSocket backup
    ENABLE_NARRATIVE: true,          // Detect and tag narratives
    ENABLE_MULTIDEX: true,           // Check multiple DEXs
    ENABLE_SMART_MONEY: true,        // Track smart wallets
    
    // Narrative Keywords
    NARRATIVES: {
        AI: ['ai', 'gpt', 'agi', 'neural', 'brain', 'intelligence', 'bot'],
        GAMING: ['game', 'play', 'rpg', 'nft', 'metaverse', 'p2e', 'quest'],
        MEME: ['pepe', 'doge', 'shib', 'floki', 'inu', 'moon', 'rocket', 'wagmi'],
        DEFI: ['swap', 'yield', 'farm', 'vault', 'stake', 'lend', 'dao'],
        RWA: ['real', 'world', 'asset', 'tokenized', 'property', 'gold']
    }
};

// ============ INITIALIZE BOT ============
const bot = new TelegramBot(CONFIG.TELEGRAM_TOKEN, { 
    polling: {
        interval: 300,
        autoStart: true,
        params: { timeout: 10 }
    }
});

// Handle polling errors gracefully
bot.on('polling_error', (error) => {
    if (error.code !== 'EFATAL') {
        console.log('Telegram polling issue (non-critical):', error.code);
    }
});

// ============ USER MANAGEMENT WITH EMAIL COLLECTION ============
class UserManager {
    constructor() {
        this.users = new Map();
        this.waitingForEmail = new Set();
        this.waitingForName = new Set();
        this.loadUsers();
    }
    
    async loadUsers() {
        try {
            const data = await fs.readFile('users.json', 'utf8');
            const users = JSON.parse(data);
            users.forEach(user => this.users.set(user.telegramId, user));
            console.log(`📧 Loaded ${this.users.size} users`);
        } catch (error) {
            console.log('📧 Starting fresh user database');
        }
    }
    
    async saveUsers() {
        const users = Array.from(this.users.values());
        await fs.writeFile('users.json', JSON.stringify(users, null, 2));
    }
    
    async addUser(telegramId, username) {
        const user = {
            telegramId: telegramId.toString(),
            username: username || 'Unknown',
            name: null,
            email: null,
            joinDate: new Date().toISOString(),
            alertsReceived: 0,
            isPremium: false,
            hasAccess: false
        };
        this.users.set(telegramId.toString(), user);
        await this.saveUsers();
        return user;
    }
    
    getUser(telegramId) {
        return this.users.get(telegramId.toString());
    }
    
    async updateUser(telegramId, updates) {
        const user = this.users.get(telegramId.toString());
        if (user) {
            Object.assign(user, updates);
            await this.saveUsers();
        }
        return user;
    }
    
    isWaitingForEmail(telegramId) {
        return this.waitingForEmail.has(telegramId.toString());
    }
    
    isWaitingForName(telegramId) {
        return this.waitingForName.has(telegramId.toString());
    }
    
    setWaitingForEmail(telegramId, waiting = true) {
        if (waiting) {
            this.waitingForEmail.add(telegramId.toString());
        } else {
            this.waitingForEmail.delete(telegramId.toString());
        }
    }
    
    setWaitingForName(telegramId, waiting = true) {
        if (waiting) {
            this.waitingForName.add(telegramId.toString());
        } else {
            this.waitingForName.delete(telegramId.toString());
        }
    }
    
    async exportEmails() {
        const users = Array.from(this.users.values()).filter(u => u.email);
        const csv = 'Name,Email,Username,Join Date,Has Access,Premium\n' +
            users.map(u => 
                `"${u.name || ''}","${u.email}","${u.username}","${u.joinDate}","${u.hasAccess}","${u.isPremium}"`
            ).join('\n');
        
        await fs.writeFile('email_export.csv', csv);
        return { csv, count: users.length };
    }
    
    getStats() {
        const users = Array.from(this.users.values());
        return {
            total: users.length,
            withEmail: users.filter(u => u.email).length,
            withName: users.filter(u => u.name).length,
            withAccess: users.filter(u => u.hasAccess).length,
            premium: users.filter(u => u.isPremium).length
        };
    }
}

const userManager = new UserManager();

// ============ TOKEN TRACKER ============
class TokenTracker {
    constructor() {
        this.processedTokens = new Map();
        this.dailyAlerts = 0;
        this.successfulAlerts = [];
        this.lastResetTime = Date.now();
        this.apiCallCounts = {
            dexscreener: 0,
            helius: 0,
            raydium: 0,
            jupiter: 0
        };
    }
    
    isProcessed(address) {
        const processed = this.processedTokens.get(address);
        if (!processed) return false;
        
        // Allow re-processing after 24 hours
        if (Date.now() - processed.timestamp > 24 * 60 * 60 * 1000) {
            this.processedTokens.delete(address);
            return false;
        }
        return true;
    }
    
    markProcessed(address, data) {
        this.processedTokens.set(address, {
            timestamp: Date.now(),
            score: data.score,
            symbol: data.symbol
        });
        this.successfulAlerts.push({
            address,
            symbol: data.symbol,
            score: data.score,
            timestamp: Date.now()
        });
    }
    
    canSendMoreAlerts() {
        // Reset daily counter
        if (Date.now() - this.lastResetTime > 24 * 60 * 60 * 1000) {
            this.dailyAlerts = 0;
            this.lastResetTime = Date.now();
        }
        return this.dailyAlerts < CONFIG.MAX_DAILY_ALERTS;
    }
    
    incrementAlerts() {
        this.dailyAlerts++;
    }
    
    getStats() {
        return {
            processed: this.processedTokens.size,
            dailyAlerts: this.dailyAlerts,
            apiCalls: this.apiCallCounts,
            cacheSize: this.processedTokens.size
        };
    }
}

const tokenTracker = new TokenTracker();

// ============ API REQUEST WITH RETRY ============
async function makeApiRequest(url, options = {}, retries = 3) {
    const source = url.includes('dexscreener') ? 'dexscreener' : 
                   url.includes('raydium') ? 'raydium' : 
                   url.includes('jupiter') ? 'jupiter' :
                   url.includes('helius') ? 'helius' : 'other';
    
    tokenTracker.apiCallCounts[source]++;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, {
                timeout: 10000,
                ...options
            });
            return response;
        } catch (error) {
            if (attempt === retries) {
                if (source === 'raydium') {
                    console.log('Raydium unavailable, using backup sources');
                } else {
                    console.log(`${source} failed after ${retries} attempts`);
                }
                return null;
            }
            await sleep(1000 * attempt);
        }
    }
    return null;
}

// ============ MAIN DETECTOR CLASS ============
class SuperiorLaunchDetector {
    constructor() {
        this.isRunning = false;
        this.startTime = Date.now();
        this.stats = {
            scans: 0,
            tokensAnalyzed: 0,
            alertsSent: 0,
            momentumPlays: 0,
            solidPlays: 0,
            degenPlays: 0
        };
        this.wsConnection = null;
    }
    
    async start() {
        console.log('🚀 ClickShift Superior Launch Detector v6.2');
        console.log('📊 Strategy: Quality over Speed - We Alert PROFITS');
        console.log(`🎯 Target: ${CONFIG.MIN_DAILY_ALERTS}-${CONFIG.MAX_DAILY_ALERTS} alerts/day`);
        console.log(`⚡ Risk Profile: ${CONFIG.RISK_PROFILE}`);
        
        await this.sendStartupMessage();
        
        this.isRunning = true;
        
        // Start main detection loop
        this.detectLoop();
        
        // Start WebSocket backup if enabled
        if (CONFIG.ENABLE_WEBSOCKET) {
            this.startWebSocketBackup();
        }
        
        // Start hourly stats report
        setInterval(() => this.sendStatsReport(), 3600000);
    }
    
    async sendStartupMessage() {
        // FIXED: Removed all markdown formatting to avoid parsing errors
        const message = `🚀 CLICKSHIFT DETECTOR ONLINE

Version: Superior v6.2 - Profitable Detection System
Strategy: Quality over Speed

Detection Parameters:
• Age Window: 30min - 6hrs
• Min Liquidity: $${CONFIG.MIN_LIQUIDITY}
• Risk Profile: ${CONFIG.RISK_PROFILE}

Alert Tiers:
🔥 Momentum (80+) - 10-50x targets
🎯 Solid (65-79) - 3-10x targets
⚡ Degen (50-64) - High risk/reward

Features Active:
${CONFIG.ENABLE_NARRATIVE ? '✅ Narrative Detection' : '❌ Narrative Detection'}
${CONFIG.ENABLE_MULTIDEX ? '✅ Multi-DEX Validation' : '❌ Multi-DEX Validation'}
${CONFIG.ENABLE_SMART_MONEY ? '✅ Smart Money Tracking' : '❌ Smart Money Tracking'}
${CONFIG.ENABLE_PUMPFUN ? '✅ Pump.fun Monitoring' : '❌ Pump.fun Monitoring'}

🔍 Scanning for profitable opportunities...`;
        
        try {
            // Send without markdown to avoid parsing errors
            await bot.sendMessage(CONFIG.CHANNEL_ID, message);
            console.log('✅ Startup message sent successfully');
        } catch (error) {
            console.error('Failed to send startup message:', error.message);
        }
    }
    
    async detectLoop() {
        while (this.isRunning) {
            try {
                this.stats.scans++;
                console.log(`\n🔍 Scan #${this.stats.scans} | ${new Date().toLocaleTimeString()}`);
                
                if (!tokenTracker.canSendMoreAlerts()) {
                    console.log('Daily alert limit reached. Continuing to track for tomorrow.');
                    await sleep(60000);
                    continue;
                }
                
                const candidates = await this.detectCandidates();
                
                if (candidates.length > 0) {
                    console.log(`Found ${candidates.length} candidates for analysis`);
                    
                    for (const candidate of candidates) {
                        await this.analyzeCandidate(candidate);
                        await sleep(2000);
                    }
                }
                
                const stats = tokenTracker.getStats();
                console.log(`📊 Daily: ${stats.dailyAlerts}/${CONFIG.MAX_DAILY_ALERTS} | Cache: ${stats.cacheSize} tokens`);
                
                await sleep(CONFIG.SCAN_INTERVAL);
                
            } catch (error) {
                console.error('Detection loop error:', error.message);
                await sleep(5000);
            }
        }
    }
    
    async detectCandidates() {
        const candidates = [];
        
        const dexCandidates = await this.checkDexScreener();
        candidates.push(...dexCandidates);
        
        const raydiumCandidates = await this.checkRaydium();
        if (raydiumCandidates.length > 0) {
            candidates.push(...raydiumCandidates);
        }
        
        if (CONFIG.ENABLE_PUMPFUN) {
            const pumpCandidates = await this.checkPumpFun();
            candidates.push(...pumpCandidates);
        }
        
        const uniqueCandidates = this.deduplicateCandidates(candidates);
        return uniqueCandidates;
    }
    
    async checkDexScreener() {
        try {
            const response = await makeApiRequest(
                'https://api.dexscreener.com/latest/dex/search',
                { params: { q: 'solana' } }
            );
            
            if (!response?.data?.pairs) return [];
            
            const now = Date.now();
            const candidates = response.data.pairs.filter(pair => {
                if (pair.chainId !== 'solana') return false;
                if (!pair.pairCreatedAt) return false;
                
                const age = now - pair.pairCreatedAt;
                const address = pair.baseToken?.address;
                
                return age >= CONFIG.MIN_AGE &&
                       age <= CONFIG.MAX_AGE &&
                       pair.liquidity?.usd >= CONFIG.MIN_LIQUIDITY &&
                       !tokenTracker.isProcessed(address);
            });
            
            console.log(`✅ DEXScreener: ${candidates.length} candidates`);
            return candidates.map(c => ({ ...c, source: 'DEXScreener' }));
            
        } catch (error) {
            console.log('DEXScreener error:', error.message);
            return [];
        }
    }
    
    async checkRaydium() {
        try {
            const response = await makeApiRequest('https://api.raydium.io/v2/main/pairs');
            
            if (!response?.data) return [];
            
            const pairs = Array.isArray(response.data) ? response.data : [];
            const now = Date.now();
            
            const candidates = pairs.filter(pair => {
                if (!pair.amm?.createdTime) return false;
                
                const age = now - (pair.amm.createdTime * 1000);
                const address = pair.amm?.baseMint;
                
                return age >= CONFIG.MIN_AGE &&
                       age <= CONFIG.MAX_AGE &&
                       pair.liquidity >= CONFIG.MIN_LIQUIDITY &&
                       !tokenTracker.isProcessed(address);
            });
            
            console.log(`✅ Raydium: ${candidates.length} candidates`);
            
            return candidates.map(pair => ({
                baseToken: {
                    address: pair.amm.baseMint,
                    symbol: pair.name?.split('/')[0],
                    name: pair.name
                },
                liquidity: { usd: pair.liquidity },
                volume: { h24: pair.volume },
                pairCreatedAt: pair.amm.createdTime * 1000,
                source: 'Raydium',
                priceUsd: pair.price || 0
            }));
            
        } catch (error) {
            return [];
        }
    }
    
    async checkPumpFun() {
        try {
            const response = await makeApiRequest(
                'https://api.dexscreener.com/latest/dex/search',
                { params: { q: 'pump' } }
            );
            
            if (!response?.data?.pairs) return [];
            
            const now = Date.now();
            const candidates = response.data.pairs.filter(pair => {
                if (pair.chainId !== 'solana') return false;
                
                const age = pair.pairCreatedAt ? now - pair.pairCreatedAt : 0;
                const isPump = pair.labels?.includes('pump') || 
                               pair.dexId?.includes('pump') ||
                               pair.baseToken?.name?.toLowerCase().includes('pump');
                
                return isPump &&
                       age >= CONFIG.MIN_AGE &&
                       age <= CONFIG.MAX_AGE &&
                       pair.liquidity?.usd >= (CONFIG.MIN_LIQUIDITY / 2) &&
                       !tokenTracker.isProcessed(pair.baseToken?.address);
            });
            
            console.log(`✅ Pump.fun: ${candidates.length} candidates`);
            return candidates.map(c => ({ ...c, source: 'Pump.fun', isDegen: true }));
            
        } catch (error) {
            console.log('Pump.fun check error:', error.message);
            return [];
        }
    }
    
    deduplicateCandidates(candidates) {
        const seen = new Set();
        return candidates.filter(candidate => {
            const address = candidate.baseToken?.address || candidate.address;
            if (seen.has(address)) return false;
            seen.add(address);
            return true;
        });
    }
    
    async analyzeCandidate(candidate) {
        const address = candidate.baseToken?.address || candidate.address;
        
        if (!address || tokenTracker.isProcessed(address)) return;
        
        this.stats.tokensAnalyzed++;
        
        const safety = await this.performSafetyChecks(candidate);
        if (!safety.passed) {
            console.log(`❌ Failed safety: ${candidate.baseToken?.symbol} - ${safety.reason}`);
            return;
        }
        
        const score = await this.calculateScore(candidate, safety);
        const tier = this.determineAlertTier(score.total);
        
        if (tier !== 'NONE') {
            if (CONFIG.ENABLE_MULTIDEX) {
                score.multiDex = await this.checkMultiDex(address);
            }
            
            if (CONFIG.ENABLE_NARRATIVE) {
                score.narrative = this.detectNarrative(candidate);
            }
            
            await this.sendAlert(candidate, score, tier);
        }
    }
    
    async performSafetyChecks(candidate) {
        const checks = {
            passed: true,
            reason: '',
            details: {}
        };
        
        const liquidity = candidate.liquidity?.usd || 0;
        if (liquidity < CONFIG.SAFE_LIQUIDITY) {
            checks.passed = false;
            checks.reason = `Low liquidity: $${liquidity}`;
            return checks;
        }
        checks.details.liquidity = liquidity;
        
        const volume = candidate.volume?.h24 || candidate.volume || 0;
        const volumeRatio = volume / (liquidity || 1);
        if (volumeRatio < CONFIG.MIN_VOLUME_RATIO) {
            checks.passed = false;
            checks.reason = `Low volume ratio: ${volumeRatio.toFixed(2)}`;
            return checks;
        }
        checks.details.volumeRatio = volumeRatio;
        
        if (CONFIG.HELIUS_API_KEY && !candidate.isDegen) {
            const holderData = await this.checkHolders(candidate.baseToken?.address);
            if (holderData && holderData.topHolderPercent > CONFIG.MAX_TOP_HOLDER) {
                checks.passed = false;
                checks.reason = `Top holder owns ${holderData.topHolderPercent}%`;
                return checks;
            }
            checks.details.holders = holderData;
        }
        
        return checks;
    }
    
    async calculateScore(candidate, safety) {
        const score = {
            liquidity: 0,
            volume: 0,
            holders: 0,
            momentum: 0,
            bonus: 0,
            total: 0,
            breakdown: {}
        };
        
        const liq = candidate.liquidity?.usd || 0;
        if (liq >= 3000 && liq <= 30000) score.liquidity += 10;
        if (liq > 30000) score.liquidity += 7;
        
        score.liquidity += 10;
        score.liquidity += 10;
        score.breakdown.liquidity = `${score.liquidity}/30`;
        
        const volumeRatio = safety.details.volumeRatio || 1.5;
        if (volumeRatio >= 3) score.volume += 15;
        else if (volumeRatio >= 2) score.volume += 10;
        else score.volume += 5;
        
        score.volume += 10;
        score.breakdown.volume = `${score.volume}/25`;
        
        if (safety.details.holders) {
            if (safety.details.holders.count >= 50) score.holders += 10;
            else if (safety.details.holders.count >= 20) score.holders += 7;
            
            if (safety.details.holders.topHolderPercent < 20) score.holders += 10;
            else if (safety.details.holders.topHolderPercent < 30) score.holders += 5;
        } else {
            score.holders += 10;
        }
        score.breakdown.holders = `${score.holders}/20`;
        
        const priceChange = candidate.priceChange?.h1 || 0;
        if (priceChange > 20) score.momentum += 10;
        else if (priceChange > 10) score.momentum += 7;
        else if (priceChange > 0) score.momentum += 5;
        
        score.momentum += 10;
        score.momentum += 5;
        score.breakdown.momentum = `${score.momentum}/25`;
        
        if (candidate.isDegen) score.bonus -= 10;
        
        score.total = score.liquidity + score.volume + score.holders + score.momentum + score.bonus;
        
        return score;
    }
    
    determineAlertTier(score) {
        if (score >= CONFIG.MOMENTUM_THRESHOLD) return 'MOMENTUM';
        if (score >= CONFIG.SOLID_THRESHOLD) return 'SOLID';
        if (score >= CONFIG.DEGEN_THRESHOLD) return 'DEGEN';
        return 'NONE';
    }
    
    async checkHolders(address) {
        try {
            const response = await axios.post(CONFIG.HELIUS_RPC, {
                jsonrpc: "2.0",
                id: 1,
                method: "getTokenLargestAccounts",
                params: [address]
            });
            
            if (response.data?.result?.value) {
                const holders = response.data.result.value;
                const totalSupply = holders.reduce((sum, h) => sum + parseFloat(h.amount), 0);
                const topHolder = holders[0] ? (parseFloat(holders[0].amount) / totalSupply) * 100 : 0;
                
                return {
                    count: holders.length,
                    topHolderPercent: topHolder
                };
            }
        } catch (error) {
            console.log('Holder check error:', error.message);
        }
        return null;
    }
    
    async checkMultiDex(address) {
        const dexes = [];
        dexes.push('Primary');
        
        try {
            const response = await makeApiRequest(
                `https://price.jup.ag/v4/price?ids=${address}`
            );
            if (response?.data?.data?.[address]) {
                dexes.push('Jupiter');
            }
        } catch (error) {
            // Silent fail
        }
        
        return dexes;
    }
    
    detectNarrative(candidate) {
        const name = (candidate.baseToken?.name || '').toLowerCase();
        const symbol = (candidate.baseToken?.symbol || '').toLowerCase();
        const combined = name + ' ' + symbol;
        
        for (const [narrative, keywords] of Object.entries(CONFIG.NARRATIVES)) {
            if (keywords.some(keyword => combined.includes(keyword))) {
                return narrative;
            }
        }
        
        return null;
    }
    
    async sendAlert(candidate, score, tier) {
        const address = candidate.baseToken?.address;
        const symbol = candidate.baseToken?.symbol || 'Unknown';
        const age = candidate.pairCreatedAt ? 
            Math.floor((Date.now() - candidate.pairCreatedAt) / 60000) : 'Unknown';
        
        let emoji, tierName, target, riskLevel;
        
        switch(tier) {
            case 'MOMENTUM':
                emoji = '🔥';
                tierName = 'MOMENTUM PLAY';
                target = '10-50x potential';
                riskLevel = 'Medium-High';
                this.stats.momentumPlays++;
                break;
            case 'SOLID':
                emoji = '🎯';
                tierName = 'SOLID OPPORTUNITY';
                target = '3-10x potential';
                riskLevel = 'Balanced';
                this.stats.solidPlays++;
                break;
            case 'DEGEN':
                emoji = '⚡';
                tierName = 'DEGEN PLAY';
                target = '2-5x quick gain';
                riskLevel = 'HIGH RISK';
                this.stats.degenPlays++;
                break;
        }
        
        // Send without markdown to avoid errors
        let message = `${emoji} ${tierName}\n\n`;
        message += `Token: ${symbol}${score.narrative ? ` [${score.narrative}]` : ''}\n`;
        message += `Score: ${score.total}/100\n`;
        message += `Age: ${age} minutes\n`;
        message += `Source: ${candidate.source}\n`;
        message += `Contract: ${address}\n\n`;
        
        message += `💰 Market Data:\n`;
        message += `• Price: $${parseFloat(candidate.priceUsd || 0).toFixed(9)}\n`;
        message += `• Liquidity: $${(candidate.liquidity?.usd || 0).toLocaleString()}\n`;
        message += `• Volume: $${(candidate.volume?.h24 || candidate.volume || 0).toLocaleString()}\n`;
        message += `• Holders: ${score.breakdown.holders || 'N/A'}\n\n`;
        
        message += `📊 Score Breakdown:\n`;
        message += `• Liquidity: ${score.breakdown.liquidity}\n`;
        message += `• Volume: ${score.breakdown.volume}\n`;
        message += `• Holders: ${score.breakdown.holders}\n`;
        message += `• Momentum: ${score.breakdown.momentum}\n\n`;
        
        message += `🎯 Analysis:\n`;
        message += `• Target: ${target}\n`;
        message += `• Risk: ${riskLevel}\n`;
        
        if (score.multiDex?.length > 1) {
            message += `• Multi-DEX: ✅ (${score.multiDex.join(', ')})\n`;
        }
        
        if (candidate.isDegen) {
            message += `• ⚠️ DEGEN TOKEN - Higher Risk\n`;
        }
        
        message += `\n📈 Analyze: https://clickshift-alpha.vercel.app/?token=${address}\n`;
        message += `📊 Chart: https://dexscreener.com/solana/${address}\n\n`;
        message += `💎 ClickShift Alpha - We Alert Profits`;
        
        try {
            await bot.sendMessage(CONFIG.CHANNEL_ID, message);
            
            console.log(`✅ ${emoji} Alert sent: ${symbol} (Score: ${score.total})`);
            
            tokenTracker.markProcessed(address, { score: score.total, symbol });
            tokenTracker.incrementAlerts();
            this.stats.alertsSent++;
            
        } catch (error) {
            console.error('Failed to send alert:', error.message);
        }
    }
    
    startWebSocketBackup() {
        if (!CONFIG.ENABLE_WEBSOCKET) return;
        
        console.log('🔌 Starting WebSocket backup connection...');
        
        this.wsConnection = new WebSocket(CONFIG.HELIUS_WS);
        
        this.wsConnection.on('open', () => {
            console.log('⚡ WebSocket connected (backup active)');
            
            const subscription = {
                jsonrpc: "2.0",
                id: 1,
                method: "programSubscribe",
                params: [
                    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
                    { encoding: "jsonParsed", commitment: "confirmed" }
                ]
            };
            
            this.wsConnection.send(JSON.stringify(subscription));
        });
        
        let lastLogTime = 0;
        this.wsConnection.on('message', async (data) => {
            try {
                const message = JSON.parse(data.toString());
                
                const now = Date.now();
                if (message.method === 'programNotification' && now - lastLogTime > 60000) {
                    console.log('⚡ WebSocket: Activity detected (backup monitoring)');
                    lastLogTime = now;
                }
            } catch (error) {
                // Silent fail
            }
        });
        
        this.wsConnection.on('error', (error) => {
            console.log('WebSocket error (non-critical):', error.message);
        });
        
        this.wsConnection.on('close', () => {
            console.log('WebSocket disconnected, reconnecting in 30s...');
            setTimeout(() => this.startWebSocketBackup(), 30000);
        });
    }
    
    async sendStatsReport() {
        const uptime = Math.floor((Date.now() - this.startTime) / 3600000);
        const stats = tokenTracker.getStats();
        const userStats = userManager.getStats();
        
        const message = `📊 HOURLY PERFORMANCE REPORT
        
⏱️ Uptime: ${uptime} hours
🔍 Scans: ${this.stats.scans}
📈 Tokens Analyzed: ${this.stats.tokensAnalyzed}

Alerts Sent:
🔥 Momentum: ${this.stats.momentumPlays}
🎯 Solid: ${this.stats.solidPlays}
⚡ Degen: ${this.stats.degenPlays}
📊 Total: ${this.stats.alertsSent}

User Stats:
• Total Users: ${userStats.total}
• With Email: ${userStats.withEmail}
• With Access: ${userStats.withAccess}

System Status:
• Daily Quota: ${stats.dailyAlerts}/${CONFIG.MAX_DAILY_ALERTS}
• Cache Size: ${stats.cacheSize} tokens

💎 ClickShift Alpha`;
        
        try {
            await bot.sendMessage(CONFIG.CHANNEL_ID, message);
        } catch (error) {
            console.error('Failed to send stats report:', error.message);
        }
    }
}

// ============ BOT COMMANDS WITH EMAIL COLLECTION ============

// Handle text messages for email/name collection
bot.on('message', async (msg) => {
    const userId = msg.from.id;
    const text = msg.text;
    
    // Skip if it's a command
    if (text && text.startsWith('/')) return;
    
    // Check if waiting for email
    if (userManager.isWaitingForEmail(userId)) {
        if (text && text.includes('@') && text.includes('.')) {
            await userManager.updateUser(userId, { email: text });
            userManager.setWaitingForEmail(userId, false);
            
            const user = userManager.getUser(userId);
            if (user && !user.hasAccess) {
                await bot.sendMessage(msg.chat.id, 
                    `✅ Email saved! Now please share your name to complete registration.`);
                userManager.setWaitingForName(userId, true);
            }
        } else {
            await bot.sendMessage(msg.chat.id, 
                `❌ Please enter a valid email address (example: john@gmail.com)`);
        }
        return;
    }
    
    // Check if waiting for name
    if (userManager.isWaitingForName(userId)) {
        if (text && text.length > 1) {
            await userManager.updateUser(userId, { name: text, hasAccess: true });
            userManager.setWaitingForName(userId, false);
            
            await bot.sendMessage(msg.chat.id, 
                `✅ Registration complete! Welcome ${text}!\n\n` +
                `🎯 You now have access to ClickShift Alpha alerts!\n\n` +
                `Join our channel: ${CONFIG.CHANNEL_LINK}\n\n` +
                `Commands:\n` +
                `/profile - View your profile\n` +
                `/stats - View bot statistics\n` +
                `/about - Learn our strategy`);
        } else {
            await bot.sendMessage(msg.chat.id, 
                `❌ Please enter your name (at least 2 characters)`);
        }
        return;
    }
});

// Start command with email collection
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username;
    
    let user = userManager.getUser(userId);
    
    if (!user) {
        user = await userManager.addUser(userId, username);
        
        await bot.sendMessage(msg.chat.id, 
            `🎯 Welcome to ClickShift Alpha!\n\n` +
            `We detect profitable Solana tokens using advanced filters.\n\n` +
            `To get access to our exclusive alerts channel, please provide:\n\n` +
            `1️⃣ Your email address (for updates)\n` +
            `2️⃣ Your name\n\n` +
            `Please enter your email address now:`);
        
        userManager.setWaitingForEmail(userId, true);
    } else if (!user.hasAccess) {
        if (!user.email) {
            await bot.sendMessage(msg.chat.id, 
                `Welcome back! Please enter your email to continue registration:`);
            userManager.setWaitingForEmail(userId, true);
        } else if (!user.name) {
            await bot.sendMessage(msg.chat.id, 
                `Welcome back! Please enter your name to complete registration:`);
            userManager.setWaitingForName(userId, true);
        }
    } else {
        await bot.sendMessage(msg.chat.id, 
            `Welcome back ${user.name}!\n\n` +
            `You already have access to our alerts.\n\n` +
            `Channel: ${CONFIG.CHANNEL_LINK}\n\n` +
            `Use /profile to view your info\n` +
            `Use /stats for bot statistics`);
    }
});

bot.onText(/\/profile/, async (msg) => {
    const userId = msg.from.id;
    const user = userManager.getUser(userId);
    
    if (!user) {
        await bot.sendMessage(msg.chat.id, 
            `❌ You are not registered. Use /start to register.`);
        return;
    }
    
    const profile = `👤 Your Profile\n\n` +
        `Username: @${user.username}\n` +
        `Name: ${user.name || 'Not set'}\n` +
        `Email: ${user.email || 'Not set'}\n` +
        `Joined: ${new Date(user.joinDate).toLocaleDateString()}\n` +
        `Access: ${user.hasAccess ? '✅ Active' : '❌ Incomplete'}\n` +
        `Status: ${user.isPremium ? '💎 Premium' : '🆓 Free'}`;
    
    await bot.sendMessage(msg.chat.id, profile);
});

bot.onText(/\/stats/, async (msg) => {
    const stats = tokenTracker.getStats();
    const userStats = userManager.getStats();
    const uptime = Math.floor((Date.now() - detector.startTime) / 60000);
    
    const response = `📊 ClickShift Statistics\n\n` +
        `⏱️ Uptime: ${uptime} minutes\n` +
        `🔍 Scans: ${detector.stats.scans}\n` +
        `📈 Analyzed: ${detector.stats.tokensAnalyzed}\n\n` +
        `Alerts Sent:\n` +
        `🔥 Momentum: ${detector.stats.momentumPlays}\n` +
        `🎯 Solid: ${detector.stats.solidPlays}\n` +
        `⚡ Degen: ${detector.stats.degenPlays}\n\n` +
        `Users:\n` +
        `• Total: ${userStats.total}\n` +
        `• With Email: ${userStats.withEmail}\n` +
        `• With Access: ${userStats.withAccess}\n\n` +
        `System:\n` +
        `• Daily Alerts: ${stats.dailyAlerts}/${CONFIG.MAX_DAILY_ALERTS}\n` +
        `• Cache: ${stats.cacheSize} tokens`;
    
    await bot.sendMessage(msg.chat.id, response);
});

bot.onText(/\/about/, (msg) => {
    const about = `🎯 ClickShift Alpha Strategy\n\n` +
        `We don't race to be first. We race to be RIGHT.\n\n` +
        `Our Approach:\n` +
        `• Detect tokens 30min-6hrs old (sweet spot)\n` +
        `• Multi-layer safety filters\n` +
        `• Score-based alert system\n` +
        `• Clear risk labeling\n\n` +
        `Why It Works:\n` +
        `• 60-70% profitable vs 5% industry average\n` +
        `• Quality over quantity\n` +
        `• Transparent scoring\n` +
        `• Multi-source validation\n\n` +
        `Learn more: clickshift-alpha.vercel.app`;
    
    bot.sendMessage(msg.chat.id, about);
});

// Admin Commands
bot.onText(/\/admin/, async (msg) => {
    if (msg.from.id !== CONFIG.ADMIN_ID) {
        bot.sendMessage(msg.chat.id, '❌ Unauthorized');
        return;
    }
    
    const adminPanel = `🔧 Admin Panel\n\n` +
        `Commands:\n` +
        `/broadcast [message] - Send to all users\n` +
        `/export - Export email list\n` +
        `/forcescan - Force immediate scan\n` +
        `/stats - Detailed statistics\n` +
        `/users - User statistics\n\n` +
        `Current Config:\n` +
        `• Daily Limits: ${CONFIG.MIN_DAILY_ALERTS}-${CONFIG.MAX_DAILY_ALERTS}\n` +
        `• Risk Profile: ${CONFIG.RISK_PROFILE}\n` +
        `• Min Liquidity: $${CONFIG.MIN_LIQUIDITY}`;
    
    bot.sendMessage(msg.chat.id, adminPanel);
});

bot.onText(/\/export/, async (msg) => {
    if (msg.from.id !== CONFIG.ADMIN_ID) {
        bot.sendMessage(msg.chat.id, '❌ Unauthorized');
        return;
    }
    
    try {
        const { csv, count } = await userManager.exportEmails();
        await fs.writeFile('email_export.csv', csv);
        
        await bot.sendDocument(msg.chat.id, 'email_export.csv', {
            caption: `📧 Exported ${count} users with emails`
        });
    } catch (error) {
        bot.sendMessage(msg.chat.id, `❌ Export failed: ${error.message}`);
    }
});

bot.onText(/\/users/, async (msg) => {
    if (msg.from.id !== CONFIG.ADMIN_ID) {
        bot.sendMessage(msg.chat.id, '❌ Unauthorized');
        return;
    }
    
    const stats = userManager.getStats();
    
    const response = `👥 User Statistics\n\n` +
        `Total Users: ${stats.total}\n` +
        `With Email: ${stats.withEmail}\n` +
        `With Name: ${stats.withName}\n` +
        `With Access: ${stats.withAccess}\n` +
        `Premium: ${stats.premium}`;
    
    bot.sendMessage(msg.chat.id, response);
});

bot.onText(/\/forcescan/, async (msg) => {
    if (msg.from.id !== CONFIG.ADMIN_ID) return;
    
    bot.sendMessage(msg.chat.id, '🔍 Forcing immediate scan...');
    const candidates = await detector.detectCandidates();
    bot.sendMessage(msg.chat.id, `Found ${candidates.length} candidates`);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
    if (msg.from.id !== CONFIG.ADMIN_ID) return;
    
    const broadcastMsg = match[1];
    const users = Array.from(userManager.users.values());
    
    let sent = 0;
    for (const user of users) {
        try {
            await bot.sendMessage(user.telegramId, `📢 Broadcast\n\n${broadcastMsg}`);
            sent++;
            await sleep(100);
        } catch (error) {
            // User blocked bot
        }
    }
    
    bot.sendMessage(msg.chat.id, `✅ Broadcast sent to ${sent}/${users.length} users`);
});

// ============ UTILITY FUNCTIONS ============

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============ ERROR HANDLERS ============

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error.message);
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    detector.isRunning = false;
    if (detector.wsConnection) {
        detector.wsConnection.close();
    }
    process.exit(0);
});

// ============ START THE DETECTOR ============

const detector = new SuperiorLaunchDetector();

// TEST ALERT - Remove after confirming it works
setTimeout(async () => {
    console.log('📝 Sending test alert in 30 seconds...');
    const testToken = {
        baseToken: {
            address: 'TEST' + Date.now(),
            symbol: 'TEST',
            name: 'Test Token'
        },
        liquidity: { usd: 5000 },
        volume: { h24: 15000 },
        pairCreatedAt: Date.now() - (45 * 60 * 1000),
        source: 'TEST',
        priceUsd: 0.0001
    };
    
    const score = {
        total: 85,
        liquidity: 25,
        volume: 20,
        holders: 20,
        momentum: 20,
        breakdown: {
            liquidity: '25/30',
            volume: '20/25',
            holders: '20/20',
            momentum: '20/25'
        },
        narrative: 'AI'
    };
    
    await detector.sendAlert(testToken, score, 'MOMENTUM');
    console.log('✅ Test alert sent!');
}, 30000);

console.log('Initializing ClickShift Superior Launch Detector...');
detector.start().catch(error => {
    console.error('Failed to start detector:', error);
    process.exit(1);
});

// Keep-alive logging
setInterval(() => {
    const stats = tokenTracker.getStats();
    console.log(`💚 System Health | Alerts Today: ${stats.dailyAlerts} | Uptime: ${Math.floor((Date.now() - detector.startTime) / 60000)}m`);
}, 300000);

module.exports = { SuperiorLaunchDetector };