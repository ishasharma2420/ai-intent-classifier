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

Return STRICT JSON only:
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

    const text = completion.choices[0].message.content;
    const json = JSON.parse(text);

    res.json(json);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI classification failed" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
