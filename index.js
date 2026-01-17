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

async function updateLeadSquaredAsync(prospectId, fields) {
  const url = `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.UpdateAsync?accessKey=${process.env.LSQ_ACCESS_KEY}&secretKey=${process.env.LSQ_SECRET_KEY}`;

  const payload = [
    {
      ProspectID: prospectId,
      Fields: fields
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
    const prospectId =
      req.body?.Current?.ProspectID ||
      req.body?.After?.ProspectID ||
      req.body?.Before?.ProspectID;

    if (!prospectId) {
      return res.status(400).json({ error: "ProspectID missing" });
    }

    const inquiry = req.body?.Current?.mx_Student_Inquiry || "";
    const timeline = req.body?.Current?.mx_Enrollment_Timeline || "";
    const engagement = req.body?.Current?.mx_Engagement_Readiness || "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        { role: "system", content: "Return ONLY valid JSON." },
        {
          role: "user",
          content: `
Classify intent.

Inquiry: ${inquiry}
Timeline: ${timeline}
Engagement: ${engagement}

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

    const ai = JSON.parse(completion.choices[0].message.content);

    const readinessBucket = ai.readiness_score >= 0.75 ? "HIGH" : "LOW";

    const fields = [
      { Attribute: "mx_AI_Detected_Intent", Value: ai.intent },
      { Attribute: "mx_AI_Readiness_Score", Value: ai.readiness_score },
      { Attribute: "mx_Readiness_Bucket", Value: readinessBucket },
      { Attribute: "mx_AI_Risk_Category", Value: ai.risk_category },
      { Attribute: "mx_AI_Propensity_Score", Value: ai.propensity_score },
      { Attribute: "mx_Last_AI_Decision", Value: ai.decision_summary }
    ];

    await updateLeadSquaredAsync(prospectId, fields);

    res.json({ status: "success", prospectId });
  } catch (err) {
    console.error("Intent classifier failed:", err.message);
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
