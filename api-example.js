import http from 'http';
import https from 'https';
import Proxy from './lib/Proxy.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
    .locale('en')
    .option('api-url', {
        description: 'API URL',
        default: 'http://127.0.0.1:3000',
        type: 'string'
    })
    .option('client-key', {
        description: 'Client Key',
        demandOption: true,
        type: 'string'
    })
    .option('url', {
        description: 'Target URL to access',
        default: 'https://2captcha.com/demo/cloudflare-turnstile-challenge',
        demandOption: true,
        type: 'string'
    })
    .option('proxy-scheme', {
        description: 'Proxy scheme',
        default: 'http',
        type: 'string'
    })
    .option('proxy-host', {
        description: 'Proxy host',
        default: '127.0.0.1',
        type: 'string'
    })
    .option('proxy-port', {
        description: 'Proxy port',
        default: 1080,
        type: 'number'
    })
    .help()
    .argv;

const API_URL = argv['api-url'];
const proxyConfig = argv['proxy-host'] && argv['proxy-port'] ? {
    scheme: argv['proxy-scheme'],
    host: argv['proxy-host'],
    port: argv['proxy-port']
} : null;

function makeRequest(url, options, data = null) {
    return new Promise((resolve, reject) => {
        const isHttps = url.startsWith('https');
        const client = isHttps ? https : http;
        
        console.log(`Accessing ${options.method} ${url}`);

        const req = client.request(url, options, (res) => {
            let responseData = '';

            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(res.headers)
                console.log(`Redirecting to ${res.headers.location}`);

                // Create new options object for redirect request
                const redirectOptions = { ...options };
                const redirectUrl = new URL(res.headers.location, url).href;
                
                // Follow the redirect with the same method and headers
                return makeRequest(redirectUrl, redirectOptions, data)
                    .then(resolve)
                    .catch(reject);
            }

            res.on('data', (chunk) => {
                responseData += chunk;
            });
            
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 400) {
                    try {
                        const jsonData = JSON.parse(responseData);
                        resolve({ ok: true, data: jsonData, text: responseData });
                    } catch (e) {
                        resolve({ ok: true, text: responseData });
                    }
                } else {
                    reject(new Error(`HTTP Error: ${res.statusCode} ${responseData}`));
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        if (data) {
            req.write(JSON.stringify(data));
        }
        
        req.end();
    });
}

async function solveTurnstile(clientKey, url, siteKey, action = null, proxyConfig = null) {
    const createTaskData = {
        clientKey: clientKey,
        type: "Turnstile",
        url: url,
    };

    if (siteKey) createTaskData.sitekey = siteKey;
    if (action) createTaskData.action = action;
    if (proxyConfig) createTaskData.proxy = proxyConfig;

    console.debug("Call new captcha task:", createTaskData);

    const isHttps = url.startsWith('https');
    const proxy = proxyConfig ? new Proxy({
        [proxyConfig.scheme === 'socks5' ? 'socks' : (isHttps ? 'https' : 'http')]: 
            proxyConfig.scheme === 'socks5' 
                ? `socks5://${proxyConfig.host}:${proxyConfig.port}`
                : `${proxyConfig.scheme}://${proxyConfig.host}:${proxyConfig.port}`
    }) : null;
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        agent: proxy?.getAgent()
    };

    const response = await makeRequest(`${API_URL}/createTask`, options, createTaskData);
    const taskData = response.data;
    const taskId = taskData.taskId;

    if (!taskId) {
        throw new Error("No taskId received");
    }
    console.debug(`New captcha task started: ${taskId}`);

    for (let i = 0; i < 30; i++) {
        const checkData = { clientKey, taskId };
        const checkResponse = await makeRequest(
            `${API_URL}/getTaskResult`,
            options,
            checkData
        );

        const data = checkResponse.data;

        if (data.status === "failed") {
            throw new Error(`Task failed: ${data.errormessage || 'Unknown error occurs.'}`);
        }

        if (data.status === "completed") {
            const result = data.result;
            if (!result.success) {
                throw new Error(`Task failed: ${result.errormessage || 'Unknown error occurs.'}`);
            }
            return result.response;
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error("timeout to get result");
}

async function solveChallenge(clientKey, url, proxyConfig = null) {
    const createTaskData = {
        clientKey: clientKey,
        type: "CloudflareChallenge",
        url: url,
        proxy: proxyConfig,
    };

    if (proxyConfig) createTaskData.proxy = proxyConfig;

    console.debug("Call new captcha task:", createTaskData);

    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    };

    const response = await makeRequest(`${API_URL}/createTask`, options, createTaskData);
    const taskData = response.data;
    const taskId = taskData.taskId;

    if (!taskId) {
        throw new Error("No taskId received");
    }
    console.debug(`New captcha task started: ${taskId}`);

    for (let i = 0; i < 30; i++) {
        const checkData = { clientKey, taskId };
        const checkResponse = await makeRequest(
            `${API_URL}/getTaskResult`,
            options,
            checkData
        );

        const data = checkResponse.data;

        if (data.status === "failed") {
            throw new Error(`Task failed: ${data.error || 'Unknown error occurs.'}`);
        }

        if (data.status === "completed") {
            const result = data.result || {};
            if (!result.success) {
                throw new Error(`Task failed: ${result.error || 'Unknown error occurs.'}`);
            }
            return [result.response, result.data.userAgent];
        }

        await new Promise(resolve => setTimeout(resolve, 5000));
    }

    throw new Error("timeout to get result");
}

async function getContent(url, proxyConfig = null, cfClearance = null, userAgent = null) {
    const headers = {
        ...(userAgent && { 'User-Agent': userAgent }),
        ...(cfClearance && { 'Cookie': `cf_clearance=${cfClearance}` })
    };

    const isHttps = url.startsWith('https');
    const proxy = proxyConfig ? new Proxy({
        [proxyConfig.scheme === 'socks5' ? 'socks' : (isHttps ? 'https' : 'http')]: 
            proxyConfig.scheme === 'socks5' 
                ? `socks5://${proxyConfig.host}:${proxyConfig.port}`
                : `${proxyConfig.scheme}://${proxyConfig.host}:${proxyConfig.port}`
    }) : null;
    
    const options = {
        method: 'GET',
        headers,
        agent: proxy?.getAgent(),
        timeout: 30000
    };

    const response = await makeRequest(url, options);
    const content = response.text;

    if (content.includes("cf-wrapper") || content.includes("Enable JavaScript and cookies to continue")) {
        return null;
    }
    return content;
}

async function main() {
    try {
        const [cfClearance, ua] = await solveChallenge(
            argv['client-key'],
            argv['url'],
            proxyConfig
        );

        console.log('CF Clearance:', cfClearance);
        console.log('User Agent:', ua);

        const content = await getContent(
            argv['url'],
            proxyConfig,
            cfClearance,
            ua
        );

        console.log('Content:', content);
    } catch (error) {
        console.error(error);
    }
}

// Run the main function
main();
