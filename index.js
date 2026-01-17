import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * LeadSquared Update Helper
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

app.post("/intent-classifier", async (req, res) => {
  try {
    /**
     * ✅ FINAL, CORRECT PROSPECT ID RESOLUTION
     */
    const prospectId =
      req.query?.entityId ||
      req.body?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID ||
      req.body?.Current?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID not found",
        query: req.query,
        bodyKeys: Object.keys(req.body || {})
      });
    }

    /**
     * Extract Lead Data
     */
    const studentInquiry =
      req.body?.After?.mx_Student_Inquiry || "";

    const enrollmentTimeline =
      req.body?.After?.mx_Enrollment_Timeline || "";

    const engagementReadiness =
      req.body?.After?.mx_Engagement_Readiness || "";

    /**
     * OpenAI Classification
     */
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond ONLY with valid JSON."
        },
        {
          role: "user",
          content: `
Classify the student intent.

student_inquiry: ${studentInquiry}
enrollment_timeline: ${enrollmentTimeline}
engagement_readiness: ${engagementReadiness}

Return JSON EXACTLY as:
{
  "intent": "ready | explore | nurture",
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

    /**
     * Update LeadSquared
     */
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
      readinessBucket
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
