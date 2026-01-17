import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * ENV VARIABLES REQUIRED
 *
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// -----------------------------
// MAIN WEBHOOK ENDPOINT
// -----------------------------
app.post("/intent-classifier", async (req, res) => {
  try {
    // 1️⃣ Extract payload from LeadSquared automation
    const {
      LeadId,
      StudentInquiry = "",
      EnrollmentTimeline = "",
      ReadyNow = "",
      FreeText = ""
    } = req.body;

    if (!LeadId) {
      return res.status(400).json({ error: "Missing LeadId" });
    }

    // 2️⃣ Call OpenAI
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
- student_inquiry: ${StudentInquiry}
- enrollment_timeline: ${EnrollmentTimeline}
- ready_now: ${ReadyNow}
- free_text: ${FreeText}

Return JSON EXACTLY:
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

    const aiRaw = completion.choices[0].message.content.trim();
    const ai = JSON.parse(aiRaw);

    const readiness_bucket =
      ai.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // 3️⃣ Prepare LeadSquared update payload
    const updatePayload = [
      {
        LeadId,
        AI_Intent: ai.intent,
        AI_ReadinessScore: ai.readiness_score,
        AI_RiskCategory: ai.risk_category,
        AI_PropensityScore: ai.propensity_score,
        AI_DecisionSummary: ai.decision_summary,
        AI_ReadinessBucket: readiness_bucket
      }
    ];

    // 4️⃣ Call LeadSquared Update Lead API
    const lsqUrl = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

    const lsqResponse = await fetch(lsqUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(updatePayload)
    });

    const lsqResult = await lsqResponse.json();

    console.log("Lead updated:", lsqResult);

    // 5️⃣ Respond to automation (no data needed)
    res.status(200).json({ status: "success" });
  } catch (error) {
    console.error("Intent classifier failed:", error);
    res.status(500).json({ error: "Intent classification failed" });
  }
});

// -----------------------------
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
