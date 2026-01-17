import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * REQUIRED ENV VARIABLES
 * ----------------------
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Safely extract ProspectID from LeadSquared Automation payload
 */
function extractProspectId(body) {
  return (
    body?.Current?.ProspectID ||
    body?.After?.ProspectID ||
    body?.Before?.ProspectID ||
    body?.ProspectID || // fallback (Postman/manual)
    null
  );
}

/**
 * Update LeadSquared Prospect
 */
async function updateLeadSquared(prospectId, payload) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = {
    ProspectID: prospectId,
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

/**
 * Intent Classifier Endpoint
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    const prospectId = extractProspectId(req.body);

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID is required",
        receivedKeys: Object.keys(req.body || {})
      });
    }

    // Pull fields from LeadSquared payload
    const studentInquiry =
      req.body?.Current?.["Student Inquiry"] ||
      req.body?.After?.["Student Inquiry"] ||
      "";

    const enrollmentTimeline =
      req.body?.Current?.["Enrollment Timeline"] ||
      req.body?.After?.["Enrollment Timeline"] ||
      "";

    const engagementReadiness =
      req.body?.Current?.["Engagement Readiness"] ||
      req.body?.After?.["Engagement Readiness"] ||
      "";

    const freeText =
      req.body?.Current?.["Last User Message"] ||
      "";

    // OpenAI Classification
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
Classify student intent.

Inputs:
- student_inquiry: ${studentInquiry}
- enrollment_timeline: ${enrollmentTimeline}
- engagement_readiness: ${engagementReadiness}
- free_text: ${freeText}

Return JSON ONLY:
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

    const readinessBucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // Update LeadSquared
    await updateLeadSquared(prospectId, {
      "AI Detected Intent": result.intent,
      "AI Readiness Score": result.readiness_score,
      "Readiness Bucket": readinessBucket,
      "AI Risk Category": result.risk_category,
      "AI Propensity Score": result.propensity_score,
      "Last AI Decision": result.decision_summary
    });

    res.json({
      status: "success",
      prospectId,
      readiness_bucket: readinessBucket,
      intent: result.intent
    });
  } catch (error) {
    console.error("Intent classifier error:", error);
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
