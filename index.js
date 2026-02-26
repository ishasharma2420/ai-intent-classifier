import express from "express";

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/", (_, res) => {
  res.send("Agent Flash – AI Lead Readiness Scoring");
});

/* ---------- NORMALIZATION ---------- */
const norm = v => (v || "").toLowerCase().replace(/\s+/g, " ").trim();

/* ---------- MAP ACTUAL LS FIELD VALUES → SCORING KEYS ----------
   These are the real dropdown values coming from LeadSquared.
   We translate them into scoring matrix keys before any logic runs.
   If you add new LS dropdown options, add them here.
-------------------------------------------------------------------*/
const READINESS_MAP = {
  // Low_Readiness_Concern field values
  "program details":         "questions on admission",
  "fees & scholarships":     "financial assistance",
  "career outcomes / roi":   "career outcomes",
  "admission requirements":  "questions on admission",
  "speak to an advisor":     "need counselling",
  "just browsing":           "just exploring options",
};

const TIMELINE_MAP = {
  // Reconnect_Timeline field values
  "within 3 months":                   "within 30 days",
  "fall 2025":                         "1-3 months",
  "spring 2026":                       "this academic cycle",
  "fall 2026":                         "next year",
  "just exploring (no fixed timeline)":"just researching",
};

/* ---------- BASE SCORE MATRIX ----------
   Rows = engagement_readiness (mapped from LS Low_Readiness_Concern)
   Cols = enrollment_timeline  (mapped from LS Reconnect_Timeline)
-------------------------------------------------------------------*/
const BASE_SCORE = {
  "questions on admission": {
    "within 30 days":      80,
    "1-3 months":          72,
    "this academic cycle": 65,
    "next year":           50,
    "just researching":    38,
  },
  "financial assistance": {
    "within 30 days":      78,
    "1-3 months":          70,
    "this academic cycle": 62,
    "next year":           48,
    "just researching":    36,
  },
  "career outcomes": {
    "within 30 days":      72,
    "1-3 months":          65,
    "this academic cycle": 58,
    "next year":           45,
    "just researching":    33,
  },
  "need counselling": {
    "within 30 days":      68,
    "1-3 months":          60,
    "this academic cycle": 53,
    "next year":           43,
    "just researching":    35,
  },
  "just exploring options": {
    "within 30 days":      40,
    "1-3 months":          34,
    "this academic cycle": 28,
    "next year":           22,
    "just researching":    15,
  },
};

/* ---------- INQUIRY CLASSIFICATION ----------
   Runs on the free-text general_inquiry field.
   Returns a human-readable intent label.
-------------------------------------------------------------------*/
function classifyInquiry(text) {
  if (!text || text.length < 3) return "General Inquiry";

  const t = text.toLowerCase();

  if (/(apply|application|admission|enroll|deadline|next step|how do i start|ready to apply|want to apply|asap)/.test(t))
    return "Admissions Inquiry";
  if (/(fee|fees|scholarship|financial|cost|tuition|funding|afford)/.test(t))
    return "Fees & Financial Aid";
  if (/(eligible|eligibility|requirement|qualify|qualification|gpa|score|grades)/.test(t))
    return "Eligibility Check";
  if (/(which program|choose|compare|best course|options|difference between|what program)/.test(t))
    return "Program Selection";
  if (/(career|job|salary|placement|outcome|roi|after graduation|work)/.test(t))
    return "Career Outcomes";
  if (/(campus|location|accommodation|hostel|housing|visit|tour)/.test(t))
    return "Campus & Experience";
  if (/(counsellor|counseling|advisor|guidance|help me decide|talk to someone|speak)/.test(t))
    return "Counselling Request";
  if (/(research|explore|browsing|looking|just checking|information|tell me more|learn)/.test(t))
    return "Early Research";

  return "General Inquiry";
}

/* ---------- INQUIRY SCORE ADJUSTMENT ----------
   Softly nudges the base score up or down based on free-text intent.
   Capped so it cannot cross a bucket boundary on its own.
-------------------------------------------------------------------*/
const INQUIRY_ADJUSTMENT = {
  "Admissions Inquiry":    8,
  "Fees & Financial Aid":  5,
  "Eligibility Check":     4,
  "Program Selection":     3,
  "Career Outcomes":       2,
  "Campus & Experience":   0,
  "Counselling Request":   1,
  "Early Research":       -5,
  "General Inquiry":       0,
};

/* ---------- REASONING GENERATOR ----------
   Produces a plain-English summary of exactly why this lead
   received its score and bucket. Shown in the LS activity log.
   This is the "AI thinking" layer that creates the WOW factor.
-------------------------------------------------------------------*/
function generateReasoning(params) {
  const {
    rawReadiness,
    rawTimeline,
    mappedReadiness,
    mappedTimeline,
    baseScore,
    inquiryType,
    adjustment,
    finalScore,
    bucket,
    generalInquiry,
    programInterest,
  } = params;

  const urgencyLabel = {
    "within 30 days":      "very near-term (within 30 days)",
    "1-3 months":          "near-term (1–3 months)",
    "this academic cycle": "this academic cycle",
    "next year":           "next year",
    "just researching":    "no fixed timeline",
  }[mappedTimeline] || mappedTimeline;

  const intentSentence = generalInquiry && generalInquiry.length > 3
    ? `The student's own words — "${generalInquiry}" — indicate a ${inquiryType.toLowerCase()}, which ${adjustment > 0 ? `added ${adjustment} points` : adjustment < 0 ? `reduced the score by ${Math.abs(adjustment)} points` : "did not change the score"}.`
    : `No free-text inquiry was provided, so intent was inferred from structured inputs alone.`;

  const bucketExplanation = bucket === "High"
    ? `At ${finalScore}/100, this lead crosses the High readiness threshold (≥70). Agent Flash recommends immediate counselor scheduling.`
    : `At ${finalScore}/100, this lead is below the High readiness threshold (<70). Routed to voice qualification before counselor time is allocated.`;

  const programNote = programInterest
    ? `The student has expressed interest in ${programInterest}.`
    : "";

  return [
    `Agent Flash assessed this lead based on two structured signals: their stated need ("${rawReadiness}") and enrollment timeline ("${rawTimeline}").`,
    `This combination produced a base score of ${baseScore}/100 — reflecting a ${urgencyLabel} intent window with a focus on ${mappedReadiness}.`,
    intentSentence,
    programNote,
    bucketExplanation,
  ].filter(Boolean).join(" ");
}

/* ---------- API ENDPOINT ---------- */
app.post("/intent-classifier", (req, res) => {
  try {
    const body = req.body || {};

    /* Raw values from LeadSquared */
    const rawReadiness     = norm(body.engagement_readiness);  // Low_Readiness_Concern
    const rawTimeline      = norm(body.enrollment_timeline);   // Reconnect_Timeline
    const generalInquiry   = (body.student_inquiry || "").trim();
    const programInterest  = (body.program_interest || "").trim();

    /* Validate presence */
    if (!rawReadiness) {
      return res.status(400).json({
        success: false,
        error: "engagement_readiness is required. Expected one of: " + Object.keys(READINESS_MAP).join(", "),
      });
    }
    if (!rawTimeline) {
      return res.status(400).json({
        success: false,
        error: "enrollment_timeline is required. Expected one of: " + Object.keys(TIMELINE_MAP).join(", "),
      });
    }

    /* Map LS values → scoring keys */
    const mappedReadiness = READINESS_MAP[rawReadiness];
    const mappedTimeline  = TIMELINE_MAP[rawTimeline];

    /* Validate mapping succeeded */
    if (!mappedReadiness) {
      return res.status(400).json({
        success: false,
        error: `Unrecognised engagement_readiness value: "${rawReadiness}". Expected one of: ` + Object.keys(READINESS_MAP).join(", "),
      });
    }
    if (!mappedTimeline) {
      return res.status(400).json({
        success: false,
        error: `Unrecognised enrollment_timeline value: "${rawTimeline}". Expected one of: ` + Object.keys(TIMELINE_MAP).join(", "),
      });
    }

    /* Base score lookup */
    const baseScore = BASE_SCORE[mappedReadiness]?.[mappedTimeline] ?? 30;

    /* Inquiry classification + adjustment */
    const inquiryType  = classifyInquiry(generalInquiry);
    const adjustment   = INQUIRY_ADJUSTMENT[inquiryType] ?? 0;

    /* Final score */
    let finalScore = baseScore + adjustment;
    finalScore = Math.max(0, Math.min(100, finalScore));

    /* Bucket — binary only, matches LS automation conditions */
    const bucket = finalScore >= 70 ? "High" : "Low";

    /* Reasoning */
    const reasoning = generateReasoning({
      rawReadiness,
      rawTimeline,
      mappedReadiness,
      mappedTimeline,
      baseScore,
      inquiryType,
      adjustment,
      finalScore,
      bucket,
      generalInquiry,
      programInterest,
    });

    /* Response */
    res.json({
      success: true,
      ai_output: {
        detected_intent:  inquiryType,
        readiness_score:  finalScore,
        readiness_bucket: bucket,
        reasoning:        reasoning,
      },
    });

  } catch (err) {
    console.error("Agent Flash error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/* ---------- START ---------- */
const PORT = Number(process.env.PORT) || 10000;
app.listen(PORT, () => {
  console.log(`Agent Flash listening on port ${PORT}`);
});
