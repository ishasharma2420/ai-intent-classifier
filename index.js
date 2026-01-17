import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/intent-classifier", async (req, res) => {
  try {
    const {
      student_inquiry = "",
      enrollment_timeline = "",
      ready_now = "",
      free_text = ""
    } = req.body;

    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not set");
    }

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
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

    const raw = response.output_text;

    const result = JSON.parse(raw);

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
    console.error("Classifier error FULL:", error);
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
