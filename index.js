import express from "express";
import cors from "cors";
import OpenAI from "openai";
import crypto from "crypto";

const app = express();
app.use(cors());
app.use(express.json());

/**
 * ENV VARIABLES REQUIRED (SET IN RENDER, NOT GITHUB)
 *
 * OPENAI_API_KEY
 * LSQ_ACCESS_KEY
 * LSQ_SECRET_KEY
 * LSQ_HOST   (example: https://api-in21.leadsquared.com)
 */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---------- Utility: LeadSquared API signer ----------
function buildLSQAuthParams() {
  const timestamp = Date.now();
  const hash = crypto
    .createHmac("sha256", process.env.LSQ_SECRET_KEY)
    .update(`${process.env.LSQ_ACCESS_KEY}${timestamp}`)
    .digest("hex");

  return {
    accessKey: process.env.LSQ_ACCESS_KEY,
    timestamp,
    signature: hash
  };
}

// ---------- MAIN WEBHOOK ----------
app.post("/intent-classifier", async (req, res) => {
  try {
    console.log("Incoming payload:", JSON.stringify(req.body, null, 2));

    const {
      LeadId,
      StudentInquiry = "",
      EnrollmentTimeline = "",
      ReadyNow = "",
      FreeText = ""
    } = req.body;

    if (!LeadId) {
      return res.status(400).json({ error: "LeadId is required" });
    }

    // ---------- OpenAI ----------
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

student_inquiry: ${StudentInquiry}
enrollment_timeline: ${EnrollmentTimeline}
ready_now: ${ReadyNow}
free_text: ${FreeText}

Return JSON ONLY in this structure:
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
    const aiResult = JSON.parse(aiRaw);

    const readiness_bucket =
      aiResult.readiness_score >= 0.75 ? "HIGH" : "LOW";

    // ---------- LeadSquared Update ----------
    const auth = buildLSQAuthParams();

    const updatePayload = [
      {
        Attribute: "AI Intent",
        Value: aiResult.intent
      },
      {
        Attribute: "AI Readiness Score",
        Value: aiResult.readiness_score
      },
      {
        Attribute: "AI Readiness Bucket",
        Value: readiness_bucket
      },
      {
        Attribute: "AI Risk Category",
        Value: aiResult.risk_category
      },
      {
        Attribute: "AI Propensity Score",
        Value: aiResult.propensity_score
      },
      {
        Attribute: "AI Decision Summary",
        Value: aiResult.decision_summary
      }
    ];

    const url =
      `${process.env.LSQ_HOST}/v2/LeadManagement.svc/Lead.Update?` +
      `accessKey=${auth.accessKey}&timestamp=${auth.timestamp}&signature=${auth.signature}`;

    const lsqResponse = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        LeadId,
        Attributes: updatePayload
      })
    });

    const lsqResult = await lsqResponse.json();

    console.log("LSQ update response:", lsqResult);

    res.json({
      status: "success",
      leadId: LeadId,
      intent: aiResult.intent,
      readiness_bucket
    });
  } catch (err) {
    console.error("Fatal error:", err);
    res.status(500).json({ error: "Intent classification failed" });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`AI Intent Classifier running on port ${PORT}`);
});
