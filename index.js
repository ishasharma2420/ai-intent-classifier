import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * ENV REQUIRED
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST  (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * 🔑 CORRECT API FOR AUTOMATION UPDATES
 */
async function updateProspect(prospectId, payload) {
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

app.post("/intent-classifier", async (req, res) => {
  try {
    /**
     * 🔑 ALWAYS PRESENT IN AUTOMATION PAYLOADS
     */
    const prospectId =
      req.body?.Current?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID missing from automation payload"
      });
    }

    const studentInquiry =
      req.body?.Current?.mx_Student_Inquiry || "";

    const enrollmentTimeline =
      req.body?.Current?.mx_Enrollment_Timeline || "";

    const engagementReadiness =
      req.body?.Current?.mx_Engagement_Readiness || "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Return STRICT JSON only."
        },
        {
          role: "user",
          content: `
Classify the student intent.

Inputs:
- student_inquiry: ${studentInquiry}
- enrollment_timeline: ${enrollmentTimeline}
- engagement_readiness: ${engagementReadiness}

Return JSON:
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

    const result = JSON.parse(
      completion.choices[0].message.content.trim()
    );

    const readinessBucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    await updateProspect(prospectId, {
      "mx_AI_Detected_Intent": result.intent,
      "mx_AI_Readiness_Score": result.readiness_score,
      "mx_Readiness_Bucket": readinessBucket,
      "mx_AI_Risk_Category": result.risk_category,
      "mx_AI_Propensity_Score": result.propensity_score,
      "mx_Last_AI_Decision": result.decision_summary
    });

    res.json({
      status: "success",
      prospectId,
      readinessBucket,
      intent: result.intent
    });
  } catch (err) {
    console.error("Intent classifier error:", err);
    res.status(500).json({
      error: "Intent classification failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
