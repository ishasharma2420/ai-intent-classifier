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
 * ✅ CORRECT ASYNC UPDATE (ARRAY PAYLOAD)
 */
async function updateProspectAsync(prospectId, attributes) {
  const url = `${process.env.LSQ_HOST}/async-api/lead/update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = {
    Leads: [
      {
        ProspectID: prospectId,
        Attributes: attributes
      }
    ]
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await res.text();

  // Async API returns 202 Accepted
  if (![200, 202].includes(res.status)) {
    throw new Error(`LeadSquared async update failed: ${text}`);
  }

  return text;
}

app.post("/intent-classifier", async (req, res) => {
  try {
    // ✅ ALWAYS PRESENT IN AUTOMATION
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

    // 🔹 OpenAI classification
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond with STRICT JSON only."
        },
        {
          role: "user",
          content: `
Classify the student intent.

Inputs:
- student_inquiry: ${studentInquiry}
- enrollment_timeline: ${enrollmentTimeline}
- engagement_readiness: ${engagementReadiness}

Return:
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

    // ✅ ASYNC UPDATE — CORRECT FORMAT
    await updateProspectAsync(prospectId, {
      mx_AI_Detected_Intent: result.intent,
      mx_AI_Readiness_Score: result.readiness_score,
      mx_Readiness_Bucket: readinessBucket,
      mx_AI_Risk_Category: result.risk_category,
      mx_AI_Propensity_Score: result.propensity_score,
      mx_Last_AI_Decision: result.decision_summary
    });

    res.json({
      status: "success",
      prospectId,
      intent: result.intent,
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
v
