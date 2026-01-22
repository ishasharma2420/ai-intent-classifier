import express from "express";

const app = express();
app.use(express.json());

app.get("/", (_, res) => {
  res.status(200).send("AI Lead Readiness Scoring – Hardened");
});

/* -------------------- HELPERS -------------------- */
function normalize(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isEmpty(value) {
  return !value || value.trim() === "";
}

/* -------------------- SCORE MAPS -------------------- */
const ENGAGEMENT_SCORE_MAP = {
  "ready to apply": 40,
  "need fa support": 24,
  "need financial aid support": 24,
  "questions on admission": 36,
  "need counselling": 30,
  "shortlisting colleges": 26,
  "just exploring options": 16
};

const TIMELINE_SCORE_MAP = {
  "within 30 days": 40,
  "1-3 months": 32,
  "this academic cycle": 28,
  "next year": 20,
  "just researching": 10
};

function mapScore(value, map) {
  for (const key in map) {
    if (value.includes(key)) return map[key];
  }
  return 0;
}

/* -------------------- INTENT LOGIC -------------------- */
function classifyIntent(text) {
  if (!text) {
    return { intent: "General inquiry", strength: "Weak" };
  }

  const strongSignals = ["apply", "application", "urgent", "asap", "deadline"];
  const mediumSignals = ["fee", "fees", "finance", "scholarship", "eligibility"];

  let strength = "Weak";
  if (strongSignals.some(k => text.includes(k))) {
    strength = "Strong";
  } else if (mediumSignals.some(k => text.includes(k))) {
    strength = "Medium";
  }

  let intent = "General inquiry";
  if (text.includes("mba")) intent = "MBA – Admissions";
  else if (text.includes("international relations")) intent = "Postgraduate – International Relations";
  else if (text.includes("criminal justice")) intent = "Postgraduate – Criminal Justice";
  else if (text.includes("masters") || text.includes("ma") || text.includes("msc"))
    intent = "Postgraduate – Admissions";

  return { intent, strength };
}

function intentScore(strength) {
  if (strength === "Strong") return 20;
  if (strength === "Medium") return 12;
  return 6;
}

/* -------------------- WEBHOOK -------------------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const payload = req.body || {};

    const inquiryRaw = payload.student_inquiry;
    const timelineRaw = payload.enrollment_timeline;
    const engagementRaw = payload.engagement_readiness;

    const inquiry = normalize(inquiryRaw);
    const timeline = normalize(timelineRaw);
    const engagement = normalize(engagementRaw);

    const missingInputs =
      isEmpty(inquiryRaw) ||
      isEmpty(timelineRaw) ||
      isEmpty(engagementRaw);

    /* -------------------- SAFETY NET -------------------- */
    if (missingInputs) {
      return res.status(200).json({
        success: true,
        ai_output: {
          detected_intent: "Postgraduate – Admissions",
          readiness_score: 75,
          readiness_bucket: "High",
          reason: "Fallback applied due to incomplete payload from UDS"
        }
      });
    }

    /* -------------------- NORMAL SCORING -------------------- */
    const engagementScore = mapScore(engagement, ENGAGEMENT_SCORE_MAP);
    const timelineScore = mapScore(timeline, TIMELINE_SCORE_MAP);

    const intentResult = classifyIntent(inquiry);
    const inquiryScore = intentScore(intentResult.strength);

    let readinessScore =
      engagementScore + timelineScore + inquiryScore;

    if (
      readinessScore < 40 &&
      (timeline.includes("30") || engagement.includes("ready"))
    ) {
      readinessScore = 75;
    }

    readinessScore = Math.round(readinessScore);
    const readinessBucket = readinessScore >= 70 ? "High" : "Low";

    return res.status(200).json({
      success: true,
      ai_output: {
        detected_intent: intentResult.intent,
        readiness_score: readinessScore,
        readiness_bucket: readinessBucket
      }
    });
  } catch (err) {
    console.error("Scoring error:", err);
    return res.status(500).json({ success: false });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
