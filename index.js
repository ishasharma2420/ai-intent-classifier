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
 * Update LeadSquared
 * IMPORTANT:
 * - ProspectID (not LeadId)
 * - Payload MUST be an array
 * - Field KEYS must be mx_*
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

  if (!res.ok || text.toLowerCase().includes("error")) {
    throw new Error(text);
  }

  return text;
}

app.post("/intent-classifier", async (req, res) => {
  try {
    // ProspectID always comes from these blocks
    const prospectId =
      req.body?.Current?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID missing",
        receivedKeys: Object.keys(req.body || {})
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
            "You are an intent classifier. Respond with STRICT valid JSON only."
        },
        {
          role: "user",
          content: `
Classify the student intent.

Inputs:
- student_inquiry: ${studentInquiry}
- enrollment_timeline: ${enrollmentTimeline}
- engagement_readiness: ${engagementReadiness}

Return JSON exactly:
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

    // 🔑 USE INTERNAL mx_ FIELD KEYS ONLY
    await updateLeadSquared(prospectId, {
      mx_AI_Detected_Intent: result.intent,
      mx_AI_Readiness_Score: result.readiness_score,
      mx_AI_Risk_Category: result.risk_category,
      mx_AI_Propensity_Score: result.propensity_score,
      mx_Last_AI_Decision: result.decision_summary,
      mx_Readiness_Bucket: readinessBucket
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
