/**
 * Isaac Team Service Offerings and Value Propositions
 * Used by sales coach and discovery tools to tailor recommendations
 */

const isaacServices = {
  companyInfo: {
    name: "Isaac Team",
    website: "www.isaacteam.com",
    description: "Operational transformation partner specializing in front-line operational and financial performance improvement through hands-on implementation"
  },
  
  serviceLines: [
    {
      name: "Isaac Operations",
      description: "Partners with clients from diagnostic phase through plan design and hands-on implementation",
      approach: [
        "Embeds with client teams on-site for hands-on coaching and implementation",
        "Practical, scientific problem-solving methodology",
        "Collaborative identification and prioritization of opportunities",
        "Custom solutions tailored to real-world complexities (not generic methodologies)",
        "Ensures solutions are owned and sustained by client's team"
      ],
      guarantee: "Measurable results guaranteed - fees are staked on achieving agreed outcomes ('No results, no fees')"
    },
    {
      name: "Isaac Technology",
      description: "Combines business intelligence, custom applications, and process automation",
      capabilities: [
        "Re-engineers processes to help clients fully realize the potential of their data",
        "Custom technology solutions tailored to client needs",
        "Process automation to enable scalability",
        "Business intelligence for data-driven decision making"
      ]
    }
  ],
  
  coreCapabilities: {
    operationsImprovement: {
      name: "Operations Improvement (Produce More with Existing People & Assets)",
      description: "Rapid, no-CapEx growth by maximizing existing resources",
      keyFocus: [
        "OEE (Overall Equipment Effectiveness) improvement",
        "Bottleneck identification and elimination through rapid diagnostics",
        "Line balancing and capacity analysis",
        "Changeover time reduction",
        "Throughput maximization without major capital investment",
        "Streamlining roles and eliminating waste",
        "Reallocating existing assets for maximum utilization",
        "Building scalable processes to avoid new shifts/buildings/equipment"
      ]
    },
    deliveryPerformance: {
      name: "Improved Service & On-Time Delivery",
      description: "Meet timelines using current teams and tools through optimized workflows",
      keyFocus: [
        "Improved coordination between departments",
        "Workflow optimization",
        "Lead time reduction",
        "Distribution network optimization",
        "Inventory positioning strategy",
        "Safety stock vs. service level optimization"
      ]
    },
    costReduction: {
      name: "Cost Reduction & Margin Improvement",
      description: "Maximize utilization of current staff and assets before considering new purchases",
      keyFocus: [
        "Direct and indirect labor spend reduction",
        "Material spend optimization",
        "Manufacturing cost per unit reduction",
        "Freight and logistics cost optimization",
        "Working capital reduction through inventory optimization",
        "Waste elimination (materials, time, quality defects)"
      ]
    },
    organizationalScaling: {
      name: "Organizational Scaling",
      description: "Reduce reliance on individual expertise by systemizing best practices",
      keyFocus: [
        "Creating processes and training programs",
        "Upskilling current employees with tailored training",
        "Analyzing roles/responsibilities to rebalance workloads",
        "Documenting and standardizing best practices",
        "Knowledge transfer and sustainability planning"
      ]
    }
  },
  
  valueProposition: {
    tagline: "Drive tangible operational and financial performance improvements by producing more with existing people and assets, improving delivery performance to customers, and reducing costs - all without major capital investment",
    differentiators: [
      "Results-based guarantee: 'No results, no fees'",
      "Hands-on, embedded approach working directly with client teams on-site",
      "Diagnostic-first methodology to ensure project viability and set guarantees",
      "Practical, scientific problem-solving (not consulting theory)",
      "Custom solutions over generic methodologies",
      "Focus on sustained impact - solutions owned by client team",
      "Specializes in no-CapEx growth and rapid improvements",
      "Long-term partnerships for continuous value creation",
      "Positive, collaborative, and enjoyable change initiatives"
    ]
  },
  
  typicalPainPoints: {
    growthConstraints: [
      "Capacity constraints limiting growth without CapEx investment",
      "Need to scale operations without adding new shifts, buildings, or equipment",
      "Equipment uptime and effectiveness issues limiting throughput",
      "Bottlenecks in processes constraining overall capacity",
      "Changeover times reducing available production capacity",
      "Cannot grow profitably with current operational structure"
    ],
    marginPressure: [
      "Operating margins compressed by inefficient resource utilization",
      "Manufacturing cost per unit too high",
      "Direct and indirect labor costs not optimized",
      "Material spend and waste issues",
      "Rising logistics and freight costs",
      "Need to improve profitability without sacrificing quality or service"
    ],
    deliveryPerformance: [
      "On-time delivery performance below customer expectations",
      "Lack of coordination between departments causing delays",
      "Long lead times impacting customer satisfaction",
      "Excess inventory tying up working capital yet still missing deliveries",
      "Distribution network inefficiencies",
      "Supply chain volatility and unpredictability"
    ],
    organizationalScaling: [
      "Over-reliance on specific individuals' knowledge and expertise",
      "Lack of documented processes and standard work",
      "Difficulty scaling operations as business grows",
      "Inconsistent execution across shifts or facilities",
      "Training gaps and skill shortages in workforce",
      "Tribal knowledge not captured in systems or processes"
    ],
    operationalInefficiency: [
      "Waste in materials, time, and quality (scrap/rework)",
      "Poor workflow design causing unnecessary handoffs",
      "Roles and responsibilities not optimized",
      "Communication breakdowns between functions",
      "Equipment and asset underutilization",
      "Manual processes that could be automated or streamlined"
    ],
    regulatory: [
      "FDA/ISO compliance requirements adding complexity",
      "Need for validated processes and documentation",
      "Quality management system maintenance overhead",
      "Audit readiness and traceability challenges",
      "Balancing compliance requirements with operational efficiency"
    ]
  },
  
  industryExperience: [
    "Medical Devices & Diagnostics",
    "Pharmaceuticals & Life Sciences",
    "Industrial Manufacturing",
    "Aerospace & Defense",
    "Automotive & Heavy Equipment",
    "Consumer Products"
  ],
  
  projectTypes: [
    {
      name: "Operations Transformation Programs",
      description: "Full-scale redesign and implementation of improvement plans",
      includes: [
        "Identification and resolution of operational constraints",
        "Support for key elements of Value Creation Plans (VCPs)",
        "Comprehensive diagnostic followed by structured implementation"
      ]
    },
    {
      name: "Improvement Plan Design & Implementation",
      description: "Data-driven approach to uncover and resolve inefficiencies",
      includes: [
        "Diagnostics to uncover bottlenecks and inefficiencies",
        "Structured roll-out of improvement levers",
        "Hands-on coaching and training of client teams"
      ]
    },
    {
      name: "Prepare for Sale / Pre-Transaction Projects",
      description: "Rapid financial improvement for private equity or owner exits",
      includes: [
        "Rapid financial improvement and stabilization",
        "Visible modernization to increase business attractiveness",
        "Quick wins to improve EBITDA ahead of sale"
      ]
    },
    {
      name: "CIM to Handover (M&A Support)",
      description: "Commercial Information Memorandum support for buyers",
      includes: [
        "Identification of opportunities and risks for buyers",
        "Guaranteed improvement opportunities for acquirers",
        "Due diligence and value creation planning"
      ]
    }
  ],
  
  engagementProcess: {
    diagnostic: {
      name: "Diagnostic Phase (Always First)",
      duration: "1-2 weeks",
      description: "Come in and learn the business, study processes, determine what can be guaranteed as an outcome, and assess if a project makes sense",
      purpose: [
        "Understand the business and its processes deeply",
        "Identify constraints and opportunities through rapid diagnostics",
        "Determine guaranteed outcomes (basis for 'No results, no fees')",
        "Assess project viability and fit",
        "Build relationship and trust with client team"
      ]
    },
    implementation: {
      name: "Implementation Phase",
      duration: "3-18 months (depending on scope)",
      description: "Hands-on, embedded implementation with client teams",
      approach: [
        "Isaac consultants embed with client operations teams",
        "Work collaboratively to design and implement improvements",
        "Provide hands-on coaching and training",
        "Ensure solutions are practical and sustainable",
        "Track results against guaranteed outcomes"
      ]
    }
  },
  
  successMetrics: [
    "Throughput improvement (%)",
    "OEE increase (percentage points)",
    "On-time delivery improvement (%)",
    "Lead time reduction (days/weeks)",
    "Cost reduction ($ or %)",
    "Inventory reduction ($ or days of supply)",
    "Quality improvement (defect rate reduction)",
    "Working capital improvement ($)"
  ]
};

module.exports = isaacServices;

