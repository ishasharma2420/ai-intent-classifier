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
      student_inquiry,
      enrollment_timeline,
      ready_now,
      free_text
    } = req.body;

    const prompt = `
You are an intent classifier for an education counselor chatbot.

Inputs:
- student_inquiry: ${student_inquiry}
- enrollment_timeline: ${enrollment_timeline}
- ready_now: ${ready_now}
- free_text: ${free_text}

Return STRICT JSON only (no markdown, no explanations):
{
  "intent": "schedule | explore | nurture",
  "readiness_score": number between 0 and 1,
  "risk_category": "low | medium | high",
  "propensity_score": number between 0 and 100,
  "decision_summary": string
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2
    });

    // 🔧 FIX: safely clean OpenAI response before parsing
    const rawText = completion.choices[0].message.content || "";

    const cleanedText = rawText
      .replace(/```json/g, "")
      .replace(/```/g, "")
      .trim();

    const parsed = JSON.parse(cleanedText);

    // 🔧 FIX: bucket readiness for LSQ condition nodes
    const readiness_bucket =
      parsed.readiness_score >= 0.75 ? "HIGH" : "LOW";

    res.json({
      intent: parsed.intent,
      readiness_score: parsed.readiness_score,
      risk_category: parsed.risk_category,
      propensity_score: parsed.propensity_score,
      decision_summary: parsed.decision_summary,
      readiness_bucket
    });

  } catch (err) {
    console.error("Intent classifier error:", err);

    // 🚑 SAFETY FALLBACK — prevents bot spinner from hanging
    res.json({
      intent: "explore",
      readiness_score: 0.4,
      risk_category: "medium",
      propensity_score: 40,
      decision_summary: "Fallback response due to temporary AI issue",
      readiness_bucket: "LOW"
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
