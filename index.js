import express from "express";
import cors from "cors";
import OpenAI from "openai";
import fetch from "node-fetch";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * ENV VARIABLES REQUIRED (Render)
 * --------------------------------
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Update LeadSquared Lead using ProspectID
 */
async function updateLead(prospectId, payload) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = {
    ProspectID: prospectId,
    ...payload
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(text);
  }

  return text;
}

/**
 * Intent Classifier Webhook
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    // 🔑 THIS IS THE CRITICAL FIX
    const prospectId = req.body.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID is required"
      });
    }

    // Safely read CRM fields
    const studentInquiry = req.body["Student Inquiry"] || "";
    const enrollmentTimeline = req.body["Enrollment Timeline"] || "";
    const engagementReadiness = req.body["Engagement Readiness"] || "";
    const freeText = req.body["Last User Message"] || "";

    // OpenAI classification
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
- free_text: ${freeText}

Return JSON ONLY in this format:
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

    // Update CRM fields (exact names you confirmed)
    await updateLead(prospectId, {
      "AI Detected Intent": result.intent,
      "AI Readiness Score": result.readiness_score,
      "Readiness Bucket": readinessBucket,
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
  } catch (err) {
    console.error("Intent classifier error:", err.message);

    return res.status(500).json({
      error: "Intent classification failed",
      details: err.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
