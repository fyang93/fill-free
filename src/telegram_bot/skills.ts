import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const PROJECT_SKILLS_DIR = path.join(process.cwd(), ".agents/skills");

export type SkillDescriptor = {
  name: string;
  description: string;
  location: string;
};

function projectSkillPath(skillName: string): string {
  return path.join(PROJECT_SKILLS_DIR, skillName, "SKILL.md");
}

function loadSkillPromptSync(skillPath: string): string {
  try {
    return readFileSync(skillPath, "utf8").trim();
  } catch {
    return "";
  }
}

function parseSkillFrontmatter(content: string): { name?: string; description?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const result: { name?: string; description?: string } = {};
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key === "name" && value) result.name = value;
    if (key === "description" && value) result.description = value;
  }
  return result;
}

export function loadAvailableProjectSkills(): SkillDescriptor[] {
  try {
    return readdirSync(PROJECT_SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = projectSkillPath(entry.name);
        const content = loadSkillPromptSync(skillPath);
        if (!content) return null;
        const frontmatter = parseSkillFrontmatter(content);
        if (!frontmatter.name || !frontmatter.description) return null;
        return {
          name: frontmatter.name,
          description: frontmatter.description,
          location: skillPath,
        } satisfies SkillDescriptor;
      })
      .filter((item): item is SkillDescriptor => Boolean(item));
  } catch {
    return [];
  }
}

export function formatAvailableSkills(skills: SkillDescriptor[]): string {
  if (skills.length === 0) return "";
  return [
    "Available project skills:",
    "Use these descriptions to decide which project rules are relevant for this request.",
    "When a relevant skill is preloaded below, follow it strictly.",
    "",
    "<available_skills>",
    ...skills.flatMap((skill) => [
      "  <skill>",
      `    <name>${skill.name}</name>`,
      `    <description>${skill.description}</description>`,
      `    <location>${skill.location}</location>`,
      "  </skill>",
    ]),
    "</available_skills>",
  ].join("\n");
}
