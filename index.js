import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * ENV VARIABLES (Render)
 * ---------------------
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST (e.g. https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * LeadSquared Update — MUST be array
 */
async function updateLeadSquared(prospectId, fields) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const payload = [
    {
      ProspectID: prospectId,
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
    // ✅ Correct ProspectID extraction
    const prospectId =
      req.body?.Before?.ProspectID ||
      req.body?.Current?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID is required",
        receivedKeys: Object.keys(req.body || {})
      });
    }

    // CRM fields
    const studentInquiry = req.body?.Current?.["Student Inquiry"] || "";
    const enrollmentTimeline = req.body?.Current?.["Enrollment Timeline"] || "";
    const engagementReadiness = req.body?.Current?.["Engagement Readiness"] || "";
    const lastUserMessage = req.body?.Current?.["Last User Message"] || "";

    // OpenAI
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
Inputs:
- student_inquiry: ${studentInquiry}
- enrollment_timeline: ${enrollmentTimeline}
- engagement_readiness: ${engagementReadiness}
- last_user_message: ${lastUserMessage}

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

    const result = JSON.parse(
      completion.choices[0].message.content.trim()
    );

    const readinessBucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // ✅ Correct Lead.Update call
    await updateLeadSquared(prospectId, {
      "Readiness Bucket": readinessBucket,
      "AI Readiness Score": result.readiness_score,
      "AI Detected Intent": result.intent,
      "AI Risk Category": result.risk_category,
      "AI Propensity Score": result.propensity_score,
      "Last AI Decision": result.decision_summary
    });

    return res.json({
      status: "success",
      prospectId,
      readinessBucket,
      intent: result.intent
    });
  } catch (error) {
    console.error("Intent classifier error:", error);
    return res.status(500).json({
      error: "Intent classification failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
