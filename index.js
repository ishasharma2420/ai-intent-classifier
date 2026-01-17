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

// -----------------------------
// LeadSquared Update Helper
// -----------------------------
async function updateLead(prospectId, payload) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const body = {
    LeadId: prospectId, // LeadId is the correct key for the Update API
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

// -----------------------------
// Intent Classifier Endpoint
// -----------------------------
app.post("/intent-classifier", async (req, res) => {
  try {
    // ✅ FIX: LeadSquared Webhooks wrap the lead data inside a "Data" object
    const leadData = req.body.Data || req.body; 
    const prospectId = leadData.ProspectID;

    if (!prospectId) {
      return res.status(400).json({
        error: "ProspectID is required",
        receivedKeys: Object.keys(req.body),
        hint: "Ensure 'Include Data' is checked in LeadSquared Automation"
      });
    }

    // Extract fields from the nested leadData
    const student_inquiry = leadData["Student Inquiry"] || "";
    const enrollment_timeline = leadData["Enrollment Timeline"] || "";
    const ready_now = leadData["Engagement Readiness"] || "";
    const free_text = leadData["Last User Message"] || "";

    // OpenAI Call
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: "You are an intent classifier. Respond with STRICT valid JSON only. No text outside JSON."
        },
        {
          role: "user",
          content: `
Classify the student intent based on these inputs:
- inquiry: ${student_inquiry}
- timeline: ${enrollment_timeline}
- readiness: ${ready_now}
- message: ${free_text}

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

    const result = JSON.parse(completion.choices[0].message.content.trim());
    const readiness_bucket = result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // Update LeadSquared
    await updateLead(prospectId, {
      "Readiness Bucket": readiness_bucket,
      "AI Readiness Score": result.readiness_score,
      "AI Detected Intent": result.intent,
      "AI Risk Category": result.risk_category,
      "AI Propensity Score": result.propensity_score,
      "Last AI Decision": result.decision_summary
    });

    return res.json({
      status: "success",
      prospectId,
      intent: result.intent
    });

  } catch (error) {
    console.error("Error:", error.message);
    return res.status(500).json({
      error: "Classification failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Running on port ${PORT}`));
