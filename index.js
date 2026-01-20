import express from "express";

const app = express();
app.use(express.json());

app.get("/", (_, res) => {
  res.status(200).send("AI Lead Readiness Scoring Service – Stable");
});

/* -------------------- HELPERS -------------------- */
function normalize(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/* -------------------- SCORE MAPS (UNCHANGED) -------------------- */
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

/* -------------------- INTENT LOGIC (NEW, EXPANDED) -------------------- */

const PROGRAM_KEYWORDS = [
  { keywords: ["mba", "business administration"], label: "MBA" },
  { keywords: ["business", "management", "accounting", "finance"], label: "Business" },
  { keywords: ["architecture"], label: "Architecture" },
  { keywords: ["biology", "biotech", "life science"], label: "Biology" },
  { keywords: ["art", "design", "fashion", "visual"], label: "Art & Design" },
  { keywords: ["cosmetology", "beauty", "aesthetics"], label: "Cosmetology" },
  { keywords: ["criminal justice", "criminology"], label: "Criminal Justice" },
  { keywords: ["international relations", "global studies"], label: "International Relations" }
];

const LEVEL_KEYWORDS = [
  { keywords: ["bachelor", "undergraduate", "ug"], label: "Undergraduate" },
  { keywords: ["master", "msc", "ma", "postgraduate", "pg"], label: "Postgraduate" }
];

const INQUIRY_THEMES = [
  { keywords: ["scholarship", "funding", "financial aid"], label: "Scholarships" },
  { keywords: ["fee", "fees", "tuition", "cost"], label: "Fees" },
  { keywords: ["eligibility", "eligible", "requirements"], label: "Eligibility" },
  { keywords: ["apply", "application", "admission", "deadline", "asap", "urgent"], label: "Admissions" }
];

function classifyIntent(text) {
  if (!text) {
    return { intent: "General inquiry", strength: "Weak" };
  }

  let program = null;
  let level = null;
  let theme = null;

  for (const p of PROGRAM_KEYWORDS) {
    if (p.keywords.some(k => text.includes(k))) {
      program = p.label;
      break;
    }
  }

  for (const l of LEVEL_KEYWORDS) {
    if (l.keywords.some(k => text.includes(k))) {
      level = l.label;
      break;
    }
  }

  for (const t of INQUIRY_THEMES) {
    if (t.keywords.some(k => text.includes(k))) {
      theme = t.label;
      break;
    }
  }

  // Intent strength
  let strength = "Weak";
  if (["apply", "application", "admission", "urgent", "asap"].some(k => text.includes(k))) {
    strength = "Strong";
  } else if (theme) {
    strength = "Medium";
  }

  // Compose intent label
  let intentParts = [];
  if (level) intentParts.push(level);
  if (program) intentParts.push(program);
  if (theme) intentParts.push(theme);

  const intent =
    intentParts.length > 0
      ? intentParts.join(" – ")
      : "General inquiry";

  return { intent, strength };
}

function intentStrengthScore(strength) {
  if (strength === "Strong") return 20;
  if (strength === "Medium") return 12;
  return 6;
}

/* -------------------- WEBHOOK -------------------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const payload = req.body || {};

    const inquiry = normalize(payload.student_inquiry);
    const engagement = normalize(payload.engagement_readiness);
    const timeline = normalize(payload.enrollment_timeline);

    const engagementScore = mapScore(engagement, ENGAGEMENT_SCORE_MAP);
    const timelineScore = mapScore(timeline, TIMELINE_SCORE_MAP);

    const intentResult = classifyIntent(inquiry);
    const inquiryScore = intentStrengthScore(intentResult.strength);

    let readinessScore = engagementScore + timelineScore + inquiryScore;

    // Safety rule
    if (
      readinessScore < 40 &&
      (timeline.includes("30") || engagement.includes("ready") || engagement.includes("fa"))
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
