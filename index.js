import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * REQUIRED ENV VARIABLES (Render → Environment)
 *
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Update Lead in LeadSquared
 * NOTE: LeadSquared expects an ARRAY payload
 */
async function updateLeadInLSQ(leadId, fields) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const payload = [
    {
      LeadId: leadId,
      ...fields
    }
  ];

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text);
  }

  return text;
}

app.post("/intent-classifier", async (req, res) => {
  try {
    /**
     * LeadSquared Automation payload ALWAYS contains:
     * - LeadId
     */
    const leadId =
      req.body?.LeadId ||
      req.body?.ProspectID ||
      req.body?.["ProspectID"];

    if (!leadId) {
      return res.status(400).json({ error: "LeadId is required" });
    }

    /**
     * These may or may not exist depending on your automation.
     * Keep defaults safe.
     */
    const student_inquiry =
      req.body["Student Inquiry"] || "";

    const enrollment_timeline =
      req.body["Enrollment Timeline"] || "";

    const ready_now =
      req.body["Engagement Readiness"] || "";

    const free_text =
      req.body["Last User Message"] || "";

    // 🔹 Call OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond with STRICT valid JSON only."
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

Return JSON exactly in this format:
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
    const ai = JSON.parse(raw);

    const readiness_bucket =
      ai.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // 🔹 Update EXACT CRM fields you confirmed
    await updateLeadInLSQ(leadId, {
      "Readiness Bucket": readiness_bucket,
      "AI Readiness Score": ai.readiness_score,
      "AI Detected Intent": ai.intent,
      "AI Risk Category": ai.risk_category,
      "AI Propensity Score": ai.propensity_score,
      "Last AI Decision": ai.decision_summary
    });

    res.json({
      status: "success",
      leadId,
      readiness_bucket,
      intent: ai.intent
    });
  } catch (error) {
    console.error("Intent classifier error:", error.message);
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
