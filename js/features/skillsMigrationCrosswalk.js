// Skills migration crosswalk (Draft 3), from claude/skills_migration_crosswalk_draft3_v1.json.
// Data only: the tool matches these names (never ids). Any change to Draft 3 means a new file and a new crosswalkId.
const SKILLS_CROSSWALK_DRAFT3 = {
  "crosswalkId": "draft3-2026-11-v1",
  "source": "Engineering_Program_Skills_List_Draft3.md (22 Sep 2026, final) - Library migration crosswalk and Migration rules",
  "matching": "Skill names are matched trimmed and case-insensitively, then must equal the stored spelling exactly. Never by id.",
  "expectedCategories": [
    "Analytical",
    "Communication",
    "Design",
    "Digital/CAD",
    "Fabrication",
    "Knowledge",
    "Measurement",
    "Professional",
    "Safety"
  ],
  "rows": [
    {
      "from": "Statistical Analysis for Design",
      "fromCategory": "Analytical",
      "class": "retire",
      "draft3Class": "retire",
      "to": null,
      "toCategory": null
    },
    {
      "from": "Normal Distribution",
      "fromCategory": "Analytical",
      "class": "retire",
      "draft3Class": "retire",
      "to": null,
      "toCategory": null
    },
    {
      "from": "Written Communication",
      "fromCategory": "Communication",
      "class": "recategorize",
      "draft3Class": "recategorize",
      "to": "Written Communication",
      "toCategory": "Professional"
    },
    {
      "from": "Presentation Skills",
      "fromCategory": "Communication",
      "class": "rename",
      "draft3Class": "recategorize",
      "to": "Presentation & Oral Communication",
      "toCategory": "Professional"
    },
    {
      "from": "Design Challenge Problem-Solving",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Problem Definition & Research",
      "toCategory": "Design"
    },
    {
      "from": "Engineering Design Process",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Problem Definition & Research",
      "toCategory": "Design"
    },
    {
      "from": "Spatial Visualization",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Sketching & Visualization",
      "toCategory": "Design"
    },
    {
      "from": "Isometric Sketching",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Sketching & Visualization",
      "toCategory": "Design"
    },
    {
      "from": "Orthographic Projection Sketching",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Sketching & Visualization",
      "toCategory": "Design"
    },
    {
      "from": "Concept Sketching & Brainstorming",
      "fromCategory": "Design",
      "class": "rename",
      "draft3Class": "rename",
      "to": "Concept Generation & Selection",
      "toCategory": "Design"
    },
    {
      "from": "Design Iteration",
      "fromCategory": "Design",
      "class": "rename",
      "draft3Class": "rename",
      "to": "Prototyping, Testing & Iteration",
      "toCategory": "Design"
    },
    {
      "from": "Reverse Engineering (Introduction)",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Reverse Engineering",
      "toCategory": "Design"
    },
    {
      "from": "Reverse Engineering (Applied)",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Reverse Engineering",
      "toCategory": "Design"
    },
    {
      "from": "Design for Manufacturability",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Manufacturing Processes",
      "toCategory": "Knowledge"
    },
    {
      "from": "Material Selection",
      "fromCategory": "Design",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Material Selection & Properties",
      "toCategory": "Design"
    },
    {
      "from": "Troubleshooting & Repair",
      "fromCategory": "Design",
      "class": "retire",
      "draft3Class": "retire",
      "to": null,
      "toCategory": null
    },
    {
      "from": "Sketch Creation in Fusion 360",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "3D Solid Modeling (CAD)",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Sketch Constraining",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "3D Solid Modeling (CAD)",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Sketch Dimensioning",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "3D Solid Modeling (CAD)",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "3D Modeling from Sketches",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "3D Solid Modeling (CAD)",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "3D Modeling from Primitives",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "3D Solid Modeling (CAD)",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "3D Solid Modeling (Intermediate)",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "3D Solid Modeling (CAD)",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Multiview Drawing Creation",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Drawings & Views",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Technical Drawing Production",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Drawings & Views",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Assembly Drawing Documentation",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Drawings & Views",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Working Drawings",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Technical Drawings & Views",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "CAD Assembly Modeling (Bottom-Up)",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "CAD Assemblies & Motion",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "CAD Assembly Modeling (Top-Down)",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "CAD Assemblies & Motion",
      "toCategory": "Digital/CAD"
    },
    {
      "from": "Assigning Materials in CAD",
      "fromCategory": "Digital/CAD",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Material Selection & Properties",
      "toCategory": "Design"
    },
    {
      "from": "Additive Manufacturing / 3D Printing",
      "fromCategory": "Fabrication",
      "class": "rename",
      "draft3Class": "rename",
      "to": "Additive Manufacturing (3D Printing)",
      "toCategory": "Fabrication"
    },
    {
      "from": "Mechanical Fasteners & Joining Methods",
      "fromCategory": "Knowledge",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Manufacturing Processes",
      "toCategory": "Knowledge"
    },
    {
      "from": "Material Properties & Identification",
      "fromCategory": "Knowledge",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Material Selection & Properties",
      "toCategory": "Design"
    },
    {
      "from": "Precision Measurement with Dial Calipers",
      "fromCategory": "Measurement",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Precision Measurement",
      "toCategory": "Measurement"
    },
    {
      "from": "Precision vs. Accuracy",
      "fromCategory": "Measurement",
      "class": "merge",
      "draft3Class": "merge",
      "to": "Precision Measurement",
      "toCategory": "Measurement"
    },
    {
      "from": "Tolerance, Fit, and Allowance",
      "fromCategory": "Measurement",
      "class": "rename",
      "draft3Class": "rename",
      "to": "Dimensioning & Tolerancing",
      "toCategory": "Measurement"
    },
    {
      "from": "Teamwork & Collaboration",
      "fromCategory": "Professional",
      "class": "keep",
      "draft3Class": "keep",
      "to": "Teamwork & Collaboration",
      "toCategory": "Professional"
    },
    {
      "from": "Punctuality & Time Management",
      "fromCategory": "Professional",
      "class": "keep",
      "draft3Class": "keep",
      "to": "Punctuality & Time Management",
      "toCategory": "Professional"
    },
    {
      "from": "Personal Responsibility & Accountability",
      "fromCategory": "Professional",
      "class": "keep",
      "draft3Class": "keep",
      "to": "Personal Responsibility & Accountability",
      "toCategory": "Professional"
    },
    {
      "from": "Following Classroom Norms & Expectations",
      "fromCategory": "Professional",
      "class": "keep",
      "draft3Class": "keep",
      "to": "Following Classroom Norms & Expectations",
      "toCategory": "Professional"
    }
  ],
  "createTargets": [
    {
      "name": "Problem Definition & Research",
      "category": "Design",
      "description": "Defines the goal, user needs, measurable criteria, and constraints, backed by credible research.",
      "mergedFrom": [
        "Design Challenge Problem-Solving",
        "Engineering Design Process"
      ]
    },
    {
      "name": "Technical Sketching & Visualization",
      "category": "Design",
      "description": "Produces clear, proportional, annotated sketches that communicate a design without explanation.",
      "mergedFrom": [
        "Spatial Visualization",
        "Isometric Sketching",
        "Orthographic Projection Sketching"
      ]
    },
    {
      "name": "Reverse Engineering",
      "category": "Design",
      "description": "Analyzes and documents a product's function, structure, and materials and produces drawings from it.",
      "mergedFrom": [
        "Reverse Engineering (Introduction)",
        "Reverse Engineering (Applied)"
      ]
    },
    {
      "name": "Manufacturing Processes",
      "category": "Knowledge",
      "description": "Explains how common processes work and matches processes to materials, geometry, and volume.",
      "mergedFrom": [
        "Design for Manufacturability",
        "Mechanical Fasteners & Joining Methods"
      ]
    },
    {
      "name": "Material Selection & Properties",
      "category": "Design",
      "description": "Selects materials against several criteria (properties, cost, availability, manufacturability) and tests properties.",
      "mergedFrom": [
        "Material Selection",
        "Assigning Materials in CAD",
        "Material Properties & Identification"
      ]
    },
    {
      "name": "3D Solid Modeling (CAD)",
      "category": "Digital/CAD",
      "description": "Creates accurate, fully constrained parametric models that match design intent and suit the manufacturing process.",
      "mergedFrom": [
        "Sketch Creation in Fusion 360",
        "Sketch Constraining",
        "Sketch Dimensioning",
        "3D Modeling from Sketches",
        "3D Modeling from Primitives",
        "3D Solid Modeling (Intermediate)"
      ]
    },
    {
      "name": "Technical Drawings & Views",
      "category": "Digital/CAD",
      "description": "Produces complete drawings with correct views, sections, and title block that someone else could manufacture from.",
      "mergedFrom": [
        "Multiview Drawing Creation",
        "Technical Drawing Production",
        "Assembly Drawing Documentation",
        "Working Drawings"
      ]
    },
    {
      "name": "CAD Assemblies & Motion",
      "category": "Digital/CAD",
      "description": "Builds assemblies with correct joints, subassemblies, and library parts, and verifies motion.",
      "mergedFrom": [
        "CAD Assembly Modeling (Bottom-Up)",
        "CAD Assembly Modeling (Top-Down)"
      ]
    },
    {
      "name": "Precision Measurement",
      "category": "Measurement",
      "description": "Selects the right instrument, measures accurately and consistently, and converts between systems.",
      "mergedFrom": [
        "Precision Measurement with Dial Calipers",
        "Precision vs. Accuracy"
      ]
    }
  ],
  "renameDescriptions": {
    "Presentation & Oral Communication": "Presents clearly and logically with supporting visuals and answers questions accurately.",
    "Concept Generation & Selection": "Generates distinct concepts and selects one with a decision matrix tied to the criteria.",
    "Prototyping, Testing & Iteration": "Builds a fit-for-purpose prototype, tests against criteria, and revises using the data.",
    "Additive Manufacturing (3D Printing)": "Selects material, process, and settings and prepares, configures, and runs prints that meet specifications.",
    "Dimensioning & Tolerancing": "Fully dimensions parts to convention and applies and interprets tolerances correctly."
  },
  "alreadyPresent": [
    {
      "name": "Design Analysis: Failure Modes & Life Cycle",
      "category": "Design"
    },
    {
      "name": "Design Documentation",
      "category": "Communication"
    },
    {
      "name": "Blueprint Reading",
      "category": "Communication"
    },
    {
      "name": "Schematic Reading",
      "category": "Communication"
    },
    {
      "name": "Forces, Stress & Simulation",
      "category": "Analytical"
    },
    {
      "name": "Production Planning & Scheduling",
      "category": "Fabrication"
    },
    {
      "name": "Subtractive Manufacturing (CNC Milling)",
      "category": "Fabrication"
    },
    {
      "name": "Units & Technical Math",
      "category": "Analytical"
    },
    {
      "name": "Physics of Engineering",
      "category": "Knowledge"
    },
    {
      "name": "Electrical Theory & Circuits",
      "category": "Knowledge"
    },
    {
      "name": "Wiring, Connections & Power",
      "category": "Fabrication"
    },
    {
      "name": "Motors & Mechanical Drives",
      "category": "Knowledge"
    },
    {
      "name": "Fluid Power: Hydraulics, Pneumatics & Pumps",
      "category": "Knowledge"
    },
    {
      "name": "Robot Systems & Applications",
      "category": "Knowledge"
    },
    {
      "name": "Robot Programming & Operation",
      "category": "Digital/CAD"
    },
    {
      "name": "Robot Troubleshooting",
      "category": "Analytical"
    },
    {
      "name": "End-of-Arm Tooling",
      "category": "Fabrication"
    },
    {
      "name": "Automation & PLC Fundamentals",
      "category": "Knowledge"
    },
    {
      "name": "Shop & Electrical Safety",
      "category": "Fabrication"
    },
    {
      "name": "Systems Thinking",
      "category": "Design"
    },
    {
      "name": "CNC Programming & CAM",
      "category": "Digital/CAD"
    },
    {
      "name": "Drone Operation & Airspace",
      "category": "Knowledge"
    },
    {
      "name": "Project Management",
      "category": "Professional"
    },
    {
      "name": "Career Readiness & Planning",
      "category": "Professional"
    },
    {
      "name": "Professional Ethics & Law",
      "category": "Professional"
    },
    {
      "name": "Critical Thinking & Resilience",
      "category": "Professional"
    },
    {
      "name": "Digital Workplace Skills",
      "category": "Professional"
    }
  ],
  "mustBeAbsent": [
    "PLC Programming & Ladder Logic",
    "Digital Logic Circuit Design",
    "Machine Maintenance & Calibration",
    "CAD Stress Analysis & Simulation",
    "Motors & Motor Control",
    "Power Supply Design & Construction",
    "Precision Measurement — Advanced Instruments",
    "Process Planning & Production Documentation"
  ],
  "expectedVisibleAfter": 46
};
