/**
 * Phase 15 — skills barrel. Importing this registers every operations workflow
 * (side-effect imports), so any entrypoint (admin API, Temporal/Conductor workers,
 * live-checks) has the full catalog available via getWorkflow(skill).
 */
import "./kycReviewSkill";
import "./complianceSkill";
import "./backOfficeSkills";
import "./corporateAgentSkills";
import "./productSquadSkills";
