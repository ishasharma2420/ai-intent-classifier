import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * ENV VARIABLES REQUIRED
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Helper: Update Lead in LeadSquared
async function updateLead(leadId, payload) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = {
    LeadId: leadId,
    ...payload
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`LeadSquared update failed: ${text}`);
  }

  return text;
}

app.post("/intent-classifier", async (req, res) => {
  try {
   const leadId = req.body.LeadId;

const student_inquiry =
  req.body["Student Inquiry"] || "";

const enrollment_timeline =
  req.body["Enrollment Timeline"] || "";

const ready_now =
  req.body["Ready Now"] || "";

const free_text =
  req.body["Last User Message"] || "";

    if (!leadId) {
      return res.status(400).json({ error: "leadId is required" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond with STRICT valid JSON only. No text outside JSON."
        },
        {
          role: "user",
          content: `
Classify the student intent.

Inputs:
- student_inquiry: ${student_inquiry}
- enrollment_timeline: ${enrollment_timeline}
- ready_now: ${ready_now}
- free_text: ${free_text}

Return JSON in this exact structure:
{
  "intent": "schedule | explore | nurture",
  "readiness_score": 0.0,
  "risk_category": "low | medium | high",
  "propensity_score": 0,
  "decision_summary": ""
}
`
        }
      ]
    });

    const raw = completion.choices[0].message.content.trim();
    const result = JSON.parse(raw);

    const readiness_bucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // 🔹 Update LeadSquared fields
    await updateLead(leadId, {
      "Detected Intent": result.intent,
      "Readiness Score": result.readiness_score,
      "Readiness Bucket": readiness_bucket,
      "Risk Category": result.risk_category,
      "AI Propensity Score": result.propensity_score,
      "Last AI Decision": result.decision_summary
    });

    res.json({
      status: "success",
      readiness_bucket,
      intent: result.intent
    });
  } catch (error) {
    console.error("Classifier error:", error);
    res.status(500).json({
      error: "Intent classification failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
