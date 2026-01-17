import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// --- helper: safely extract JSON from OpenAI output ---
function extractJSON(text) {
  // Remove ```json and ``` if present
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  return JSON.parse(cleaned);
}

app.post("/intent-classifier", async (req, res) => {
  try {
    const {
      student_inquiry = "",
      enrollment_timeline = "",
      ready_now = "",
      free_text = ""
    } = req.body;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an intent classifier. Respond ONLY with valid JSON. Do not wrap in markdown. No explanations."
        },
        {
          role: "user",
          content: `
Classify the student intent.

Inputs:
- student_inquiry: ${student_inquiry}
- enrollment_timeline: ${enrollment_timeline}
- ready_now: ${ready_now}
- free_text: ${free_text}

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

    const raw = completion.choices[0].message.content;

    // 👇 TEMPORARY LOG (keep for now)
    console.log("RAW OPENAI RESPONSE:\n", raw);

    const result = extractJSON(raw);

    const readiness_bucket =
      result.readiness_score >= 0.75 ? "HIGH" : "LOW";

    res.json({
      intent: result.intent,
      readiness_score: result.readiness_score,
      risk_category: result.risk_category,
      propensity_score: result.propensity_score,
      decision_summary: result.decision_summary,
      readiness_bucket
    });
  } catch (error) {
    console.error("Classifier error:", error);
    res.status(500).json({
      error: "Intent classification failed",
      details: error.message
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
