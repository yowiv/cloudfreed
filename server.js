import express from "express";
import CloudFreed from "./index.js";
import Queue from "better-queue";
import path from "path";
import { fileURLToPath } from "url";

// Get current file's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CLIENT_KEY = process.env.CLIENT_KEY;
if (!CLIENT_KEY) {
  console.error("Error: CLIENT_KEY environment variable is not set");
  process.exit(1);
}

const app = express();
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf, encoding) => {
      req.rawBody = buf;
    },
  }),
);

app.use((err, req, res, next) => {
  if (err.type === "request.aborted") {
    return;
  }
  next(err);
});

const SUPPORTED_TYPES = {
  Turnstile: "Turnstile",
  CloudflareChallenge: "V3",
  TurnstileInvisible: "Invisible",
  CloudflareIUAM: "IUAM",
  RecaptchaInvisible: "RecaptchaInvisible",
};
const MAX_CONCURRENT_TASKS =
  parseInt(process.env.MAX_CONCURRENT_TASKS, 10) || 1;

const instancePool = [];
for (let i = 0; i < MAX_CONCURRENT_TASKS; i++) {
  const CF = new CloudFreed();
  instancePool.push(CF.start(false, true));
}
const instances = await Promise.all(instancePool);

const taskResults = new Map();
let currentInstanceIndex = 0;

const taskQueue = new Queue(
  async (task, cb) => {
    try {
      const instance = instances[currentInstanceIndex];
      currentInstanceIndex = (currentInstanceIndex + 1) % instances.length;

      // Add timeout to prevent infinite hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Task timeout after 90 seconds")),
          90000,
        );
      });

      try {
        const result = await Promise.race([
          instance.Solve({
            type: task.mappedType,
            url: task.url,
            sitekey: task.sitekey,
            action: task.action,
            proxy: task.proxy,
          }),
          timeoutPromise,
        ]);

        taskResults.set(task.taskId, { status: "completed", result });
        cb(null, result);
      } catch (error) {
        // If it's a timeout error, close and replace the instance
        if (error.message.includes("Task timeout")) {
          console.log("Task timeout, replacing instance...");
          // Try to close the instance within 10 seconds
          const closePromise = Promise.race([
            instance.Close(),
            new Promise((resolve) => setTimeout(resolve, 10000)),
          ]);
          await closePromise;

          // Create and replace with a new instance
          const newInstance = new CloudFreed();
          const startedInstance = await newInstance.start(false, true);
          instances[currentInstanceIndex] = startedInstance;
        }
        throw error;
      }
    } catch (error) {
      console.error(`Task ${task.taskId} failed: ${error.message}`);
      taskResults.set(task.taskId, {
        status: "failed",
        error: error.message,
        timestamp: Date.now(),
      });
      cb(error);
    }
  },
  {
    concurrent: MAX_CONCURRENT_TASKS,
    maxRetries: 2, // Add retry limit
    retryDelay: 1000, // Retry after 1 second
    timeout: 65000, // Queue-level timeout slightly higher than task timeout
  },
);

const validateClientKey = (req, res, next) => {
  const { clientKey } = req.body;
  if (clientKey !== CLIENT_KEY) {
    return res.status(401).json({ error: "Invalid client key" });
  }
  next();
};

app.post("/createTask", validateClientKey, (req, res) => {
  const { type, url, sitekey, action, userAgent, proxy } = req.body;

  if (!type || !url) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  const mappedType = SUPPORTED_TYPES[type];
  if (!mappedType) {
    return res.status(400).json({ error: "Unsupported type" });
  }

  const taskId = Date.now().toString(36) + Math.random().toString(36).substr(2);

  taskResults.set(taskId, {
    status: "pending",
    timestamp: Date.now(), // Add timestamp for cleanup
  });

  taskQueue.push({
    taskId,
    mappedType,
    url,
    sitekey,
    action,
    userAgent,
    proxy,
  });

  res.json({ taskId });
});

app.post("/getTaskResult", validateClientKey, (req, res) => {
  const { taskId } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: "Missing taskId" });
  }

  const taskResult = taskResults.get(taskId);

  if (!taskResult) {
    return res.status(404).json({ error: "Task not found" });
  }

  res.json(taskResult);
});

setInterval(() => {
  const oneHourAgo = Date.now() - 3600000;
  for (const [taskId, result] of taskResults.entries()) {
    if (result.timestamp < oneHourAgo) {
      taskResults.delete(taskId);
    }
  }
}, 300000);

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "localhost";
app.listen(PORT, HOST, () => {
  console.log(`Server running on ${HOST}:${PORT}`);
});

const shutdown = async () => {
  console.log("Shutting down gracefully...");
  await Promise.all(instances.map((instance) => instance.Close()));
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
