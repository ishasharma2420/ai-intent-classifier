import express from "express";

const app = express();
app.use(express.json());

app.get("/", (_, res) => {
  res.send("AI Lead Readiness Scoring – Deterministic");
});

/* ---------- NORMALIZATION ---------- */
const norm = v =>
  (v || "").toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- BASE SCORE MATRIX ---------- */
const BASE_SCORE = {
  "ready to apply": {
    "within 30 days": 85,
    "1-3 months": 78,
    "this academic cycle": 72,
    "next year": 60,
    "just researching": 45
  },
  "questions on admission": {
    "within 30 days": 75,
    "1-3 months": 68,
    "this academic cycle": 62,
    "next year": 50,
    "just researching": 40
  },
  "need counselling": {
    "within 30 days": 65,
    "1-3 months": 58,
    "this academic cycle": 52,
    "next year": 42,
    "just researching": 35
  },
  "shortlisting colleges": {
    "within 30 days": 55,
    "1-3 months": 48,
    "this academic cycle": 42,
    "next year": 35,
    "just researching": 30
  },
  "just exploring options": {
    "within 30 days": 35,
    "1-3 months": 32,
    "this academic cycle": 30,
    "next year": 25,
    "just researching": 20
  }
};

/* ---------- INQUIRY CLASSIFICATION ---------- */
function classifyInquiry(text) {
  if (!text) return "Invalid / Unclear";

  if (/(apply|application|admission|deadline|asap)/.test(text))
    return "Admissions";
  if (/(fee|fees|scholarship|financial)/.test(text))
    return "Financial Assistance";
  if (/(eligible|eligibility|requirement)/.test(text))
    return "Eligibility Check";
  if (/(which|choose|compare|best course)/.test(text))
    return "Program Selection";
  if (/(career|job|salary|placement)/.test(text))
    return "Career Outcomes";
  if (/(campus|location|accommodation)/.test(text))
    return "Campus & Experience";
  if (/(counselling|guidance|help me decide)/.test(text))
    return "Counselling Required";
  if (/(research|explore|browsing|looking)/.test(text))
    return "Early Research";

  return "General inquiry";
}

const INQUIRY_ADJUSTMENT = {
  "Admissions": 5,
  "Financial Assistance": 5,
  "Eligibility Check": 3,
  "Program Selection": 2,
  "Career Outcomes": 2,
  "Campus & Experience": 0,
  "Counselling Required": 0,
  "Early Research": -5,
  "Invalid / Unclear": -10,
  "General inquiry": 0
};

/* ---------- API ---------- */
app.post("/intent-classifier", (req, res) => {
  const inquiry = norm(req.body.student_inquiry);
  const readiness = norm(req.body.engagement_readiness);
  const timeline = norm(req.body.enrollment_timeline);

  const base =
    BASE_SCORE[readiness]?.[timeline] ?? 30;

  const inquiryType = classifyInquiry(inquiry);
  const adjustment = INQUIRY_ADJUSTMENT[inquiryType] ?? 0;

  let score = base + adjustment;
  score = Math.max(0, Math.min(100, score));

  const bucket =
    score >= 70 ? "High" :
    score >= 40 ? "Medium" :
    "Low";

  res.json({
    success: true,
    ai_output: {
      detected_intent: inquiryType,
      readiness_score: score,
      readiness_bucket: bucket
    }
  });
});

app.listen(process.env.PORT || 10000);
