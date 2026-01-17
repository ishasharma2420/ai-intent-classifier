import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * REQUIRED ENV VARIABLES (SET ONLY IN RENDER)
 *
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 * PORT       (optional, Render sets this)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * -----------------------------
 * Helper: Update Lead in LeadSquared
 * -----------------------------
 */
async function updateLeadInLSQ(leadId, attributes) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = {
    LeadId: leadId,
    ...attributes
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LeadSquared update failed: ${text}`);
  }

  return text;
}

/**
 * -----------------------------
 * Intent Classifier Endpoint
 * -----------------------------
 */
app.post("/intent-classifier", async (req, res) => {
  try {
    /* -----------------------------
       1. Read LeadSquared payload
    ------------------------------ */

    const leadId = req.body.LeadId;

    if (!leadId) {
      return res.status(400).json({ error: "LeadId is required" });
    }

    const studentInquiry =
      req.body["Student Inquiry"] || "";

    const enrollmentTimeline =
      req.body["Enrollment Timeline"] || "";

    const readyNow =
      req.body["Ready Now"] || "";

    const freeText =
      req.body["Last User Message"] || "";

    /* -----------------------------
       2. Call OpenAI
    ------------------------------ */

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
- ready_now: ${readyNow}
- free_text: ${freeText}

Return JSON in this exact structure:
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

    let result;
    try {
      result = JSON.parse(raw);
    } catch (err) {
      throw new Error("OpenAI returned invalid JSON");
    }

    /* -----------------------------
       3. Derive Readiness Bucket
    ------------------------------ */

    const readinessBucket =
      Number(result.readiness_score) >= 0.75 ? "HIGH" : "LOW";

    /* -----------------------------
       4. Update LeadSquared fields
       (MATCHING YOUR CRM EXACTLY)
    ------------------------------ */

    await updateLeadInLSQ(leadId, {
      "Readiness Bucket": readinessBucket,                 // dropdown (HIGH / LOW)
      "AI Readiness Score": Number(result.readiness_score),
      "AI Detected Intent": result.intent,
      "AI Risk Category": result.risk_category,             // low / medium / high
      "AI Propensity Score": Number(result.propensity_score),
      "Last AI Decision": result.decision_summary
    });

    /* -----------------------------
       5. Respond to Automation
    ------------------------------ */

    res.json({
      status: "success",
      leadId,
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

/**
 * -----------------------------
 * Server
 * -----------------------------
 */
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
