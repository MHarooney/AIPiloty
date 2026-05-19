"""Doc Studio document templates — structured prompts + section definitions."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class DocTemplate:
    id: str
    name: str
    description: str
    icon: str          # Lucide icon name used on the frontend card
    gradient: str      # Tailwind gradient classes
    sections: List[str]
    system_prompt_template: str


# ── Template definitions ──────────────────────────────────────────────────────

_BRD = DocTemplate(
    id="brd",
    name="Business Requirements Document",
    description="Formalise stakeholder needs, objectives and functional scope.",
    icon="FileText",
    gradient="from-blue-600 to-indigo-700",
    sections=[
        "Executive Summary",
        "Business Objectives",
        "Stakeholders",
        "Current State & Problem Statement",
        "Proposed Solution",
        "Functional Requirements",
        "Non-Functional Requirements",
        "Constraints & Assumptions",
        "Risk Register",
        "Success Metrics",
        "Timeline & Milestones",
    ],
    system_prompt_template="""You are a senior business analyst writing a Business Requirements Document (BRD).

Use ONLY the context provided below to fill every section.  If information for a section is not in the context, write "[TBD — data not yet available]" rather than guessing.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the document now.  Use Markdown tables where appropriate for requirements and risk registers.  Do not include any preamble — start directly with the first section heading.""",
)

_PT_REPORT = DocTemplate(
    id="pt_report",
    name="PT Report",
    description="Progress & technical report for stakeholders and team leads.",
    icon="BarChart2",
    gradient="from-emerald-600 to-teal-700",
    sections=[
        "Project Overview",
        "Reporting Period",
        "Progress Summary",
        "Completed Milestones",
        "In-Progress Items",
        "Blockers & Issues",
        "Technical Architecture Update",
        "Quality & Testing Status",
        "Next Steps",
        "Appendix",
    ],
    system_prompt_template="""You are a technical project manager writing a Progress & Technical (PT) Report.

Use ONLY the context provided below.  Present facts clearly and concisely.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the report now.  Use bullet lists and status tables where appropriate.  Do not add any preamble.""",
)

_SRS = DocTemplate(
    id="srs",
    name="Software Requirements Specification",
    description="IEEE-style SRS with functional and non-functional requirements.",
    icon="Code2",
    gradient="from-violet-600 to-purple-700",
    sections=[
        "Introduction",
        "Overall Description",
        "System Features",
        "Functional Requirements",
        "Non-Functional Requirements",
        "External Interface Requirements",
        "Constraints",
        "Assumptions & Dependencies",
        "Appendix",
    ],
    system_prompt_template="""You are a software architect writing a Software Requirements Specification (SRS) following IEEE 830 guidelines.

Use ONLY the context provided below.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the SRS now.  Number each requirement (e.g. FR-001, NFR-001).  Do not include any preamble.""",
)

_TEST_PLAN = DocTemplate(
    id="test_plan",
    name="Test Plan",
    description="QA test plan covering scope, strategy, environments and test cases.",
    icon="TestTube2",
    gradient="from-amber-600 to-orange-700",
    sections=[
        "Test Plan Overview",
        "Test Scope",
        "Test Strategy",
        "Test Environments",
        "Entry & Exit Criteria",
        "Test Deliverables",
        "Test Schedule",
        "Risk & Mitigation",
        "Test Cases Summary",
    ],
    system_prompt_template="""You are a QA lead writing a Test Plan document.

Use ONLY the context provided below.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the Test Plan now.  Include a test cases summary table with Test ID, Description, and Expected Result columns.  Do not add any preamble.""",
)

_DEPLOYMENT_RUNBOOK = DocTemplate(
    id="deployment_runbook",
    name="Deployment Runbook",
    description="Step-by-step operational runbook for releases and rollbacks.",
    icon="Rocket",
    gradient="from-sky-600 to-blue-700",
    sections=[
        "Overview & Purpose",
        "Pre-Deployment Checklist",
        "Architecture Summary",
        "Deployment Steps",
        "Post-Deployment Verification",
        "Rollback Procedure",
        "Monitoring & Alerts",
        "Known Issues & Workarounds",
        "Contact & Escalation",
    ],
    system_prompt_template="""You are a senior DevOps engineer writing a Deployment Runbook.

Use ONLY the context provided below.  Every step must be actionable.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the Runbook now.  Use numbered steps and code blocks for commands.  Do not add any preamble.""",
)

_API_REFERENCE = DocTemplate(
    id="api_reference",
    name="API Reference",
    description="Auto-generated API reference from code and design documents.",
    icon="Braces",
    gradient="from-rose-600 to-pink-700",
    sections=[
        "Overview",
        "Authentication",
        "Base URL & Versioning",
        "Endpoints",
        "Request / Response Schemas",
        "Error Codes",
        "Rate Limiting",
        "Examples",
        "Changelog",
    ],
    system_prompt_template="""You are a technical writer generating an API Reference document.

Use ONLY the context provided below.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the API Reference now.  For each endpoint, include Method, Path, Description, Request body, and Response format in a structured Markdown table or code block.  Do not add any preamble.""",
)

_EXECUTIVE_SUMMARY = DocTemplate(
    id="executive_summary",
    name="Executive Summary",
    description="One-page concise summary for C-level and board-level audiences.",
    icon="Presentation",
    gradient="from-indigo-600 to-violet-700",
    sections=[
        "Situation",
        "Key Achievements",
        "Strategic Value",
        "Risks & Issues",
        "Decisions Required",
        "Recommended Next Steps",
    ],
    system_prompt_template="""You are an executive communicator writing an Executive Summary.

Keep language concise and non-technical where possible.  Use ONLY the context provided below.

═══ REQUIRED SECTIONS ═══
Produce each of the following sections as a level-2 Markdown heading (##):
{sections_list}

═══ CONTEXT FROM PROJECT SOURCES ═══
{context}

═══ ADDITIONAL INSTRUCTIONS ═══
{extra_context}

Begin the Executive Summary now.  Total length should be 400–800 words.  Do not add any preamble.""",
)

# ── Registry ──────────────────────────────────────────────────────────────────

DOC_TEMPLATES: Dict[str, DocTemplate] = {
    t.id: t
    for t in [
        _BRD,
        _PT_REPORT,
        _SRS,
        _TEST_PLAN,
        _DEPLOYMENT_RUNBOOK,
        _API_REFERENCE,
        _EXECUTIVE_SUMMARY,
    ]
}


def get_template(template_id: str) -> DocTemplate:
    """Return a DocTemplate by id, raising ValueError for unknown ids."""
    if template_id not in DOC_TEMPLATES:
        raise ValueError(
            f"Unknown template '{template_id}'. "
            f"Available: {sorted(DOC_TEMPLATES.keys())}"
        )
    return DOC_TEMPLATES[template_id]
