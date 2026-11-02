import "dotenv/config";
import express from "express";
import cors from "cors";
import { pathToFileURL } from "node:url";
import { generateCandidates } from "./ai.js";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "64kb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "xpath-agent-backend" }));

app.post("/api/locators", async (req, res) => {
  const target = typeof req.body?.target === "string" ? req.body.target.trim() : "";
  if (!target) return res.status(400).json({ error: "target is required" });
  if (target.length > 300) return res.status(400).json({ error: "target must be 300 characters or fewer" });
  const elements = Array.isArray(req.body?.elements) ? req.body.elements : [];
  if (elements.length > 100) return res.status(400).json({ error: "elements must contain at most 100 entries" });
  try {
    const result = await generateCandidates({ target, page: req.body.page || {}, elements });
    return res.json(result);
  } catch (error) {
    const message = String(error?.message || error);
    const status = message.includes("AI_API_KEY is not configured") ? 503 : 502;
    return res.status(status).json({ error: message });
  }
});

const port = Number(process.env.PORT || 8787);
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`XPath Agent backend listening on http://127.0.0.1:${port}`);
  });
}

export default app;
