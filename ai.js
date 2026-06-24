// ============================================================
// Drug Info API — Node.js Version (Groq)
// ============================================================

import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(express.json());

// ── CONFIG ────────────────────────────────────────────────


const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "llama-3.3-70b-versatile";

if (!GROQ_API_KEY) {
  console.error("❌ GROQ_API_KEY missing in .env");
  process.exit(1);
}

// ── SYSTEM PROMPT ─────────────────────────────────────────

const ALL_PROFILE_SYSTEM_PROMPT = `PASTE YOUR FULL PROMPT HERE`;

// ── AI CALL FUNCTION ─────────────────────────────────────

async function askAI(userPrompt, systemPrompt) {
  try {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0,
        max_tokens: 2800
      })
    });

    const data = await response.json();

    return data.choices[0].message.content.trim();

  } catch (error) {
    console.error("❌ AI Error:", error);
    throw new Error("AI service failed");
  }
}

// ─────────────────────────────────────────────────────────
// 🔹 ENDPOINT: DRUG PROFILE
// ─────────────────────────────────────────────────────────

app.post("/drug-profile", async (req, res) => {
  try {
    const { drug_name } = req.body;

    if (!drug_name) {
      return res.status(400).json({ error: "drug_name required" });
    }

    const result = await askAI(
      `Generate complete drug profile for: ${drug_name}`,
      ALL_PROFILE_SYSTEM_PROMPT
    );

    res.json({
      success: true,
      drug_name,
      data: result
    });

  } catch (error) {
    res.status(500).json({ error: "Failed to generate drug profile" });
  }
});
