import express from 'express';
import CloudFreed from "./index.js";
import Queue from 'better-queue';

const app = express();
app.use(express.json());

// Constants
const CLIENT_KEY = "your_predefined_client_key";
const SUPPORTED_TYPES = {
    "Turnstile": "Turnstile",
    "CloudflareChallenge": "V3",
    "TurnstileInvisible": "Invisible",
    "CloudflareIUAM": "IUAM"
};
const MAX_CONCURRENT_TASKS = 1;

// Initialize CloudFreed instances pool
const instancePool = [];
for (let i = 0; i < MAX_CONCURRENT_TASKS; i++) {
    const CF = new CloudFreed();
    instancePool.push(CF.start(false, true));
}
const instances = await Promise.all(instancePool);

// Task storage
const taskResults = new Map();
let currentInstanceIndex = 0;

const taskQueue = new Queue(async (task, cb) => {
    try {
        // Round-robin instance selection
        const instance = instances[currentInstanceIndex];
        currentInstanceIndex = (currentInstanceIndex + 1) % instances.length;

        const result = await instance.Solve({
            type: task.mappedType,
            url: task.url,
            sitekey: task.sitekey,
            action: task.action,
            userAgent: task.userAgent,
            proxy: task.proxy
        });
        taskResults.set(task.taskId, { status: 'completed', result });
        cb(null, result);
    } catch (error) {
        taskResults.set(task.taskId, { status: 'failed', error: error.message });
        cb(error);
    }
}, { concurrent: MAX_CONCURRENT_TASKS });

// Update middleware for API key validation
const validateClientKey = (req, res, next) => {
    const { clientKey } = req.body;
    if (clientKey !== CLIENT_KEY) {
        return res.status(401).json({ error: 'Invalid client key' });
    }
    next();
};

app.post('/createTask', validateClientKey, (req, res) => {
    const { type, url, sitekey, action, userAgent, proxy } = req.body;
    
    if (!type || !url) {
        return res.status(400).json({ error: 'Missing required parameters' });
    }

    const mappedType = SUPPORTED_TYPES[type];
    if (!mappedType) {
        return res.status(400).json({ error: 'Unsupported type' });
    }

    const taskId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    
    taskResults.set(taskId, { 
        status: 'pending',
        timestamp: Date.now()  // Add timestamp for cleanup
    });
    
    taskQueue.push({
        taskId,
        mappedType,
        url,
        sitekey,
        action,
        userAgent,
        proxy
    });

    res.json({ taskId });
});

// Update getTaskResult to use POST and accept JSON body
app.post('/getTaskResult', validateClientKey, (req, res) => {
    const { taskId } = req.body;
    
    if (!taskId) {
        return res.status(400).json({ error: 'Missing taskId' });
    }
    
    const taskResult = taskResults.get(taskId);
    
    if (!taskResult) {
        return res.status(404).json({ error: 'Task not found' });
    }

    res.json(taskResult);
});

// Cleanup old results periodically
setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    for (const [taskId, result] of taskResults.entries()) {
        if (result.timestamp < oneHourAgo) {
            taskResults.delete(taskId);
        }
    }
}, 300000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Graceful shutdown
const shutdown = async () => {
    console.log('Shutting down gracefully...');
    await Promise.all(instances.map(instance => instance.Close()));
    process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);  // Add handler for Ctrl+C