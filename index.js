import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * REQUIRED ENV VARIABLES (Render)
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
 * -----------------------------------------
 * Helper: Update Lead in LeadSquared
 * IMPORTANT: Lead.Update expects ARRAY payload
 * -----------------------------------------
 */
async function updateLeadSquared(prospectId, payload) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = [
    {
      ProspectID: prospectId,
      ...payload
    }
  ];

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
 * -----------------------------------------
 * Intent Classifier Endpoint
 * -----------------------------------------
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    /**
     * LeadSquared automation webhook payload
     * ProspectID ALWAYS lives inside:
     *  - req.body.Before
     *  - req.body.After
     *  - req.body.Current
     */
    const prospectId =
      req.body?.Current?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID is required",
        receivedKeys: Object.keys(req.body || {})
      });
    }

    /**
     * Input fields from CRM
     * (using EXACT field names you confirmed)
     */
    const studentInquiry =
      req.body?.Current?.mx_Student_Inquiry || "";

    const enrollmentTimeline =
      req.body?.Current?.mx_Enrollment_Timeline || "";

    const engagementReadiness =
      req.body?.Current?.mx_Engagement_Readiness || "";

    /**
     * -----------------------------------------
     * OpenAI Classification
     * -----------------------------------------
     */
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
- student_inquiry: ${studentInquiry}
- enrollment_timeline: ${enrollmentTimeline}
- engagement_readiness: ${engagementReadiness}

Return JSON in this EXACT structure:
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

    /**
     * -----------------------------------------
     * Update LeadSquared fields
     * (EXACT field names you finalized)
     * -----------------------------------------
     */
    await updateLeadSquared(prospectId, {
      "AI Detected Intent": result.intent,
      "AI Readiness Score": result.readiness_score,
      "Readiness Bucket": readinessBucket,
      "AI Risk Category": result.risk_category,
      "AI Propensity Score": result.propensity_score,
      "Last AI Decision": result.decision_summary
    });

    /**
     * Respond success to automation
     */
    res.json({
      status: "success",
      prospectId,
      intent: result.intent,
      readiness_bucket: readinessBucket
    });
  } catch (error) {
    console.error("Intent classifier error:", error);
    res.status(500).json({
      error: "Intent classification failed",
      details: error.message
    });
  }
});

/**
 * -----------------------------------------
 * Server
 * -----------------------------------------
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
