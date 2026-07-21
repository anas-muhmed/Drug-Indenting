// AI drug-profile / alternative-drug routes — moved out of server.js
// unchanged, mounted at /api. GROQ_API_KEY missing only disables these
// two routes (see askAI's guard), not the whole server — that was a
// real crash-the-whole-app bug fixed earlier this project.

import express from 'express';
import fetch from 'node-fetch';
import { getConn } from '../db/pool.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { ALL_PROFILE_SYSTEM_PROMPT, ALL_PROFILE_SYSTEM_PROMPT2 } from '../prompts/drugProfilePrompts.js';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = "openai/gpt-oss-120b";

if (!GROQ_API_KEY) {
  console.warn("⚠️  GROQ_API_KEY missing in .env — AI drug-profile endpoints will return errors until it's set.");
}

const router = express.Router();

// ── AI CALL FUNCTION ─────────────────────────────────────

async function askAI(userPrompt, systemPrompt) {
  if (!GROQ_API_KEY) {
    throw new Error("AI service unavailable: GROQ_API_KEY not configured");
  }
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
        top_p: 0.1,
        max_tokens: 3200
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

router.post("/drug-profile", requireAuth, async (req, res) => {
  const conn = await getConn();
  try {

    const { drug_name } = req.body;

    if (!drug_name) {
      return res.status(400).json({ error: "drug_name required" });
    }

    const result = await askAI(
      `Generate complete drug profile for: ${drug_name}`,
      ALL_PROFILE_SYSTEM_PROMPT
    );

    if (!result) {
      return res.status(500).json({ error: "AI failed to generate content" });
    }

    let rowsAffected = 0;
    let formattedResult = result.replace(/\n/g, '<br>');

    try {
      const dbResult = await conn.execute(
        `UPDATE drug_requests
     SET ai_content = :result
     WHERE brand_name = :drug_name`,
        { result: formattedResult, drug_name }
      );

      rowsAffected = dbResult?.rowsAffected || dbResult?.affectedRows;

      console.log("Rows affected:", rowsAffected);

    } catch (dbErr) {
      console.error("DB ERROR:", dbErr);
    }

    return res.json({
      success: true,
      drug_name,
      data: result
    });

  } catch (err) {
    console.error("Error in /api/drug-profile:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
  finally {
    conn.close();
  }
});
// api  for  alternative  durg 
router.post("/alternative-drug", requireAuth, async (req, res) => {
  const conn = await getConn();
  try {

    const { drug_name } = req.body;

    if (!drug_name) {
      return res.status(400).json({ error: "drug_name required" });
    }

    const result = await askAI(
      `Generate complete alternative drug profile for: ${drug_name}`,
      ALL_PROFILE_SYSTEM_PROMPT2
    );

    if (!result) {
      return res.status(500).json({ error: "AI failed to generate content" });
    }

    let rowsAffected = 0;
    let formattedResult = result.replace(/\n/g, '<br>');

    // try {
    //   const dbResult = await conn.execute(
    //     `UPDATE drug_requests
    //  SET ai_content = :result
    //  WHERE brand_name = :drug_name`,
    //     { result: formattedResult, drug_name }
    //   );

    //   rowsAffected = dbResult?.rowsAffected || dbResult?.affectedRows;

    //   console.log("Rows affected:", rowsAffected);

    // } catch (dbErr) {
    //   console.error("DB ERROR:", dbErr);
    // }

    return res.json({
      success: true,
      drug_name,
      data: result
    });

  } catch (err) {
    console.error("Error in /api/alternative-drug:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error"
    });
  }
  finally {
    conn.close();
    console.log("alternative drug called")
  }
});

export default router;
