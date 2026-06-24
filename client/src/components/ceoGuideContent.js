// =====================================================================
// ceoGuideContent.js — Structured Guide Data for CEO Training Center
// =====================================================================

export const ceoGuideContent = [
  {
    id: "introduction",
    title: "Introduction",
    icon: "🏥",
    paragraphs: [
      "Welcome to the CEO Training Center for the Drug Indenting System. As the Chief Executive Officer (CEO), you are the final approving authority for all drug additions, substitutions, and modifications to the hospital's official formulary.",
      "This system streamlines the drug evaluation pipeline, aligning clinical justifications, HOD endorsements, detailed pharmacist commercial analysis, and DTC Committee reviews into a unified workflow.",
      "This built-in training guide is designed to help you confidently navigate the dashboard, review complex comparison sheets, interpret DTC recommendations, and make informed decisions that optimize clinical efficacy and hospital cost-efficiency."
    ]
  },
  {
    id: "ceo-responsibilities",
    title: "CEO Responsibilities",
    icon: "👔",
    paragraphs: [
      "As the final gatekeeper of the hospital formulary, the CEO holds key executive responsibilities:",
      "• Final Sign-off: Granting final approval to drugs that have successfully cleared the HOD, Pharmacy Head, and DTC Committee reviews, thereby adding them to the hospital catalog.",
      "• Financial Gatekeeping: Reviewing commercial terms, price comparisons, and profit margins to ensure the hospital maintains its financial viability while delivering quality care.",
      "• Operational Oversight: Identifying bottlenecks and delays in the approval pipeline using the Workflow Tracker to ensure smooth hospital operations.",
      "• Policy Compliance: Ensuring all drug inclusions conform to hospital therapeutic protocols and standard operating guidelines."
    ]
  },
  {
    id: "awaiting-decision",
    title: "Awaiting Decision",
    icon: "⏳",
    paragraphs: [
      "The 'Awaiting Decision' tab is your primary inbox. It contains requests that have passed all preliminary review stages and are ready for your final verdict. Each request card or table row provides three main actions:",
      "1. View details (👁): Open the complete digital dossier of the request. This includes clinical justifications, submitted brand details, and the historical workflow timeline.",
      "2. Approve (🏆): Confirm adding the drug to the formulary. An optional remarks panel allows you to record any specific approval instructions or conditions.",
      "3. Reject (✕): Deny the addition. You will be prompted to select one or more predefined reasons (such as 'Therapeutic alternative exists', 'Unfavorable margins', or 'High cost') and append custom remarks. This decision is final and will notify the requesting Doctor, HOD, Pharmacy Head, and DTC."
    ]
  },
  {
    id: "comparison-sheet",
    title: "Comparison Sheet Review",
    icon: "📊",
    paragraphs: [
      "The Comparison Sheet is a critical commercial evaluation tool accessed via the 'View Details' modal. It allows you to analyze proposed brands against existing options in the market or hospital inventory.",
      "Key commercial metrics to evaluate include:",
      "• MRP vs. Rate: Understand the price difference. The rate is the hospital's purchase price, while MRP is the maximum retail price charged to patients.",
      "• Markup and Net Margin: Review margins (absolute and percentage) to verify hospital profitability.",
      "• Negotiated Pricing: Look for negotiated commercial rates and special volume schemes (e.g., buy 10, get 2 free) secured by the pharmacy head.",
      "• Alternative Comparison: Compare the requested drug against existing generics or identical molecules already active in the formulary to prevent duplicates."
    ]
  },
  {
    id: "final-recommendation",
    title: "Final Recommendation Review",
    icon: "🏛️",
    paragraphs: [
      "Before a request reaches you, the DTC (Drug and Therapeutics Committee) conducts a scientific and therapeutic review. Their recommendation is presented in three formats:",
      "• Original Requested Brand: The committee endorses the exact brand requested by the initiating clinician.",
      "• Alternative Brand: The committee recommends a different brand or generic substitute that is therapeutically equivalent but commercial or quality-wise superior.",
      "• Multiple Recommendations: The committee recommends multiple brands or packages to give the hospital procurement department flexibilities.",
      "Always read the DTC final selection notes and clinical comments to align your financial approval with their clinical findings."
    ]
  },
  {
    id: "dashboard-overview",
    title: "Dashboard Overview",
    icon: "📊",
    paragraphs: [
      "The Dashboard tab provides a read-only Analytics Console containing multiple reporting modules. It serves as your main source of truth for hospital formulary performance and request statistics.",
      "The dashboard displays key modules such as System-Wide KPIs, Request Source Split, Formulary Type Split, and Workflow Stage Distribution. By monitoring these, you can instantly gauge the volume of drug additions, approval-to-rejection ratios, and active review cycle distributions."
    ]
  },
  {
    id: "system-overview",
    title: "System Overview",
    icon: "📉",
    paragraphs: [
      "Under the 'Overview' tab of the dashboard, you will find system-wide KPI counters that provide high-level stats:",
      "• Total Requests: The total volume of drug requests initiated in the system.",
      "• Pending Requests: Active requests currently moving through the workflow stages.",
      "• Approved / Rejected: Aggregated totals of outcomes across all review stages.",
      "• Emergency Requests: Urgent requests that bypass standard timelines to address life-threatening patient situations.",
      "• Orders Placed: Requests that have finished the cycle and had purchase orders submitted.",
      "• Final Approved: Requests finalized by the CEO, signifying successful addition to the active formulary.",
      "• Under DTC / CEO Review: The active load sitting with the DTC committee or your office.",
      "Interpretation: A spike in emergency requests may indicate formulary gaps, while a low ratio of orders placed vs approved suggests procurement delays."
    ]
  },
  {
    id: "workflow-tracker",
    title: "Workflow Tracker",
    icon: "🔄",
    paragraphs: [
      "The Workflow Tracker tab helps you monitor the active pipeline and spot administrative bottlenecks:",
      "• Current Stage & Owner: Displays exactly which reviewer (HOD, Pharmacist, Pharmacy Head, DTC, CEO) holds the request.",
      "• Days in Stage (SLA Indicator): Tracks elapsed days at the current stage. A duration of over 3 days turns yellow, and over 7 days turns red, signifying a bottleneck.",
      "• Timeline Stepper: An interactive timeline detailing the chronological path of each request, indicating completed reviews, reverts, or rejections.",
      "• Doctor Journey: Aggregates active, approved, rejected, and completed requests by individual clinicians.",
      "Interpretation: If multiple requests are red (SLA breached) in 'PH Review 1' or 'DTC Review 1', you can intervene to expedite the process."
    ]
  },
  {
    id: "doctor-analytics",
    title: "Doctor Analytics",
    icon: "👨‍⚕️",
    paragraphs: [
      "The 'Doctors & HODs' tab helps you analyze request volumes and habits among clinicians:",
      "• Individual Volume: Identifies which doctors submit the most drug addition requests.",
      "• Departmental Trends: Highlights which specialties (e.g., Cardiology, Oncology) drive formulary growth.",
      "• Approval & Rejection Rates: Shows the quality and justification of requests per physician. Doctors with high rejection rates may require guidance on formulary submission guidelines."
    ]
  },
  {
    id: "hod-analytics",
    title: "HOD Analytics",
    icon: "👤",
    paragraphs: [
      "HODs (Heads of Departments) act as the first line of evaluation. HOD Analytics shows:",
      "• HOD Turnaround & Volumes: The total requests reviewed, approved, or rejected by HODs.",
      "• Department Endorsements: How HOD approval rates vary by specialty. A department with 100% approval rates may indicate a lack of strict vetting at the HOD level, whereas balanced rates indicate strong internal controls."
    ]
  },
  {
    id: "rejection-analytics",
    title: "Rejection Analytics",
    icon: "❌",
    paragraphs: [
      "The 'Rejections' tab highlights where and why requests fail to clear the review process:",
      "• Rejection by Role: Displays stats on rejections occurring at the HOD, Pharmacy Head, DTC, or CEO level.",
      "• Top Rejection Remarks: Identifies recurring issues by analyzing common rejection comments (e.g., 'Duplicate molecule already exists', 'Price exceeds hospital cap', 'Vendor profile unapproved').",
      "Interpretation: High rejections at the Pharmacy Head stage often indicate commercially unviable requests, whereas HOD-level rejections are usually clinical."
    ]
  },
  {
    id: "procurement-analytics",
    title: "Procurement Analytics",
    icon: "💊",
    paragraphs: [
      "The 'Procurement' tab tracks therapeutic trends and brand performance across the hospital:",
      "• Top Requested Brands & Generics: Highlights which molecules are in highest demand by clinicians.",
      "• Most Approved vs. Rejected Brands: Identifies which pharmaceutical manufacturers or brands successfully navigate quality and price negotiations.",
      "Interpretation: Use this data to negotiate hospital-wide volume discounts with manufacturers of high-volume generics, minimizing acquisition costs."
    ]
  },
  {
    id: "orders-monitoring",
    title: "Orders Monitoring",
    icon: "📦",
    paragraphs: [
      "The 'Orders' tab monitors the purchasing status of approved formulary drugs:",
      "• Order Fulfillment Rate: The percentage of CEO-approved requests that have had purchase orders successfully placed by the pharmacist.",
      "• Order Pipeline: Displays the gap between approved items and active purchase orders.",
      "Interpretation: If your office has approved 20 drugs but the pharmacist has only ordered 5, you can immediately detect procurement delays and investigate supplier or logistics issues."
    ]
  },
  {
    id: "notifications",
    title: "Notifications",
    icon: "🔔",
    paragraphs: [
      "The 'Notifications' tab is your real-time alert center. It instantly notifies you of:",
      "• New requests arriving in your inbox (Awaiting CEO Decision).",
      "• DTC recommendation updates.",
      "• Urgent emergency requests requiring rapid response.",
      "You can read and clear notifications to keep your inbox organized, ensuring no high-priority request goes unnoticed."
    ]
  },
  {
    id: "audit-trail",
    title: "Audit Trail",
    icon: "📜",
    paragraphs: [
      "The 'Audit Trail' tab provides absolute transparency and compliance records for the entire system:",
      "• System-Wide Logs: Displays the 100 most recent actions and state transitions across the hospital.",
      "• Log Details: Shows who performed the action (doctor, pharmacist, CEO, etc.), the action type (submission, approval, revert, rejection), transition details (e.g., DTC_FINAL -> CEO), and associated remarks.",
      "Interpretation: The audit trail ensures compliance with healthcare standards and provides a reviewable record in case of administrative disputes."
    ]
  },
  {
    id: "best-practices",
    title: "Best Practices",
    icon: "💡",
    paragraphs: [
      "To operate the Drug Indenting System efficiently, observe the following best practices:",
      "• Review Historical Timeline: Before approving, scroll to the bottom of the View Details modal to read comments left by the HOD, Pharmacist, and DTC. Their clinical and commercial insights are invaluable.",
      "• Check margins: Look closely at the net rate and margin calculations on the comparison sheet. Ensure that the brand recommended has competitive margins.",
      "• Monitor SLAs: Check the Workflow Tracker weekly. Address delayed (red) requests to prevent clinical disruption in departments.",
      "• Select clear rejection reasons: When rejecting, choose accurate reasons and write descriptive notes. This helps doctors submit better-justified requests in the future."
    ]
  },
  {
    id: "faq",
    title: "FAQ",
    icon: "❓",
    paragraphs: [
      "Q: Can a rejected request be revived?",
      "A: No. A final rejection terminates the request. The doctor must submit a new request with updated justifications or commercial parameters.",
      "Q: What is the difference between Formulary and Non-Formulary?",
      "A: Formulary drugs are added to the regular hospital stock and can be prescribed generally. Non-Formulary drugs are approved for a restricted, patient-specific, or one-off basis.",
      "Q: Who places the actual purchase order?",
      "A: The hospital pharmacist. Once you grant final approval, the request flows to the pharmacist's order desk, where they record the purchase order placement details.",
      "Q: How is the 'Effective Created Date' determined?",
      "A: It defaults to the initial submission date, but can be updated by the pharmacist or DTC to align with official formulary publication cycles."
    ]
  }
];
